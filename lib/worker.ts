import { downloadVideo, downloadSubtitles, getVideoDuration, getFfmpegPath, cutSegment, cleanupJob, findNearestSceneCut } from "./video";
import { parseSubtitles } from "./parser";
import { detectBestMoments } from "./detect";
import { detectCropRegion, buildCropFilter } from "./crop";
import { generateSubtitleFile } from "./subtitles";
import { updateJob, setWorker } from "./queue";
import type { Job } from "./queue";

function smoothProgress(
  jobId: string,
  from: number,
  to: number,
  durationMs: number,
  message?: string
): { stop: () => void } {
  const steps = Math.max(1, Math.round(durationMs / 300));
  const increment = (to - from) / steps;
  const interval = durationMs / steps;
  let step = 0;

  const timer = setInterval(() => {
    step++;
    const current = Math.min(to, from + increment * step);
    const update: any = { progress: Math.round(current) };
    if (message && step === 1) update.message = message;
    updateJob(jobId, update);
    if (step >= steps) clearInterval(timer);
  }, interval);

  return {
    stop: () => {
      clearInterval(timer);
      updateJob(jobId, { progress: Math.round(to) });
    },
  };
}

async function processJob(job: Job): Promise<void> {
  const { id, url } = job;

  // Step 1: Download (5% -> 25%)
  updateJob(id, { status: "downloading", progress: 5, message: "Descargando video..." });

  const dlProgress = smoothProgress(id, 5, 24, 15000, "Descargando video...");
  const videoPath = await downloadVideo(url, id);
  dlProgress.stop();

  updateJob(id, { progress: 25, message: "Video descargado", videoPath });

  // Step 2: Analyze (26% -> 50%)
  updateJob(id, { status: "analyzing", progress: 26, message: "Descargando subtitulos..." });

  const subProgress = smoothProgress(id, 26, 34, 8000, "Descargando subtitulos...");
  const [duration, subtitlePath] = await Promise.all([
    getVideoDuration(videoPath),
    downloadSubtitles(url, id),
  ]);
  subProgress.stop();

  updateJob(id, { progress: 35, message: "Analizando momentos..." });

  let chunks: { text: string; start: number; end: number }[] = [];
  if (subtitlePath) {
    chunks = await parseSubtitles(subtitlePath);
    console.log(`[fraym] Parsed ${chunks.length} subtitle chunks`);
  }

  const aiProgress = smoothProgress(id, 36, 49, 12000, "IA analizando momentos...");
  const segments = await detectBestMoments(chunks, duration, {
    targetClips: job.clipCount,
    minDuration: job.minDuration,
    maxDuration: job.maxDuration,
  });
  aiProgress.stop();

  if (segments.length === 0) {
    throw new Error("No se encontraron momentos adecuados");
  }

  updateJob(id, { progress: 50, segments, message: `${segments.length} momentos detectados` });

  // Step 3: Process (51% -> 95%)
  updateJob(id, { status: "processing", progress: 51, message: "Ajustando cortes a escenas..." });

  const sceneProgress = smoothProgress(id, 51, 56, 6000, "Ajustando cortes a escenas...");
  const sceneCuts = await Promise.all(
    segments.flatMap((seg) => [
      findNearestSceneCut(videoPath, seg.start, 2, 0, seg.end - 15),
      findNearestSceneCut(videoPath, seg.end, 2, seg.start + 15, duration),
    ])
  );
  for (let i = 0; i < segments.length; i++) {
    segments[i]!.start = sceneCuts[i * 2]!;
    segments[i]!.end = sceneCuts[i * 2 + 1]!;
  }
  sceneProgress.stop();

  updateJob(id, { progress: 57, message: "Detectando encuadre (YOLO)..." });

  const ffmpegPath = getFfmpegPath();

  const yoloProgress = smoothProgress(id, 57, 64, 10000, "Detectando encuadre (YOLO)...");
  const cropRegions = await Promise.all(
    segments.map((seg, i) =>
      detectCropRegion(videoPath, seg.start, seg.end - seg.start, id, i, ffmpegPath)
    )
  );
  yoloProgress.stop();

  updateJob(id, { progress: 65, message: "Generando subtitulos..." });

  const vttPath = subtitlePath && subtitlePath.endsWith(".vtt") ? subtitlePath : undefined;
  const subtitleFiles = await Promise.all(
    segments.map((seg, i) =>
      generateSubtitleFile(chunks, seg.start, seg.end, id, i, seg.title, vttPath)
    )
  );

  updateJob(id, { progress: 70, message: "Cortando clips..." });

  const totalClips = segments.length;
  let clipsReady = 0;

  const outputs = await Promise.all(
    segments.map(async (seg, i) => {
      const filter = buildCropFilter(cropRegions[i]!);
      const output = await cutSegment(videoPath, seg, i, id, filter, subtitleFiles[i]);
      clipsReady++;
      updateJob(id, {
        progress: Math.round(70 + (clipsReady / totalClips) * 25),
        message: clipsReady < totalClips
          ? `Clip ${clipsReady} de ${totalClips} listo...`
          : `${totalClips} clips listos`,
      });
      return output;
    })
  );

  // Step 4: Done
  updateJob(id, {
    status: "done",
    progress: 100,
    outputs,
    message: `${outputs.length} shorts generados`,
  });

  await cleanupJob(id).catch(() => {});
  console.log(`[fraym] Job ${id} completed: ${outputs.length} shorts`);
}

setWorker(processJob);
export const workerReady = true;
