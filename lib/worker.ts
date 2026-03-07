import { downloadVideo, downloadSubtitles, getVideoDuration, getFfmpegPath, cutSegment, cleanupJob, findNearestSceneCut } from "./video";
import { parseSubtitles } from "./parser";
import { detectBestMoments } from "./detect";
import { detectCropRegion, buildCropFilter } from "./crop";
import { generateSubtitleFile } from "./subtitles";
import { updateJob, setWorker } from "./queue";
import { createJobLogger } from "./logger";
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
  const jlog = createJobLogger(id);

  jlog.info("Iniciando pipeline", url);

  // Step 1: Download (5% -> 25%)
  jlog.step("Descargando video...");
  updateJob(id, { status: "downloading", progress: 5, message: "Descargando video..." });

  const dlProgress = smoothProgress(id, 5, 24, 15000, "Descargando video...");
  const videoPath = await downloadVideo(url, id);
  dlProgress.stop();

  jlog.success("Video descargado");
  updateJob(id, { progress: 25, message: "Video descargado", videoPath });

  // Step 2: Analyze (26% -> 50%)
  jlog.step("Analizando contenido...");
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
    jlog.info(`Subtitulos parseados`, `${chunks.length} chunks`);
    if (chunks.length > 0) {
      jlog.debug(`Transcripcion preview: "${chunks.slice(0, 3).map(c => c.text).join(" | ")}"`);
    }
  } else {
    jlog.warn("Sin subtitulos disponibles — titulos seran genericos");
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

  jlog.success(`${segments.length} momentos detectados`);
  for (const seg of segments) {
    jlog.info(`  → [${seg.title || "SIN TITULO"}] ${Math.round(seg.start)}s-${Math.round(seg.end)}s | reason: ${seg.reason || "none"}`);
  }
  updateJob(id, { progress: 50, segments, message: `${segments.length} momentos detectados` });

  // Step 3: Process (51% -> 95%)
  jlog.step("Procesando clips...");
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

  jlog.info("Cortes ajustados a scene cuts");
  updateJob(id, { progress: 57, message: "Detectando encuadre (YOLO)..." });

  const ffmpegPath = getFfmpegPath();

  const yoloProgress = smoothProgress(id, 57, 64, 10000, "Detectando encuadre (YOLO)...");
  const cropRegions = await Promise.all(
    segments.map((seg, i) =>
      detectCropRegion(videoPath, seg.start, seg.end - seg.start, id, i, ffmpegPath)
    )
  );
  yoloProgress.stop();

  jlog.info("Encuadre detectado por YOLO");
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
      jlog.info(`Clip ${clipsReady}/${totalClips} renderizado`);
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

  jlog.done(`Pipeline completado — ${outputs.length} shorts`);

  await cleanupJob(id).catch(() => {});
}

setWorker(processJob);
export const workerReady = true;
