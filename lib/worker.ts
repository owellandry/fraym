// Background worker — processes a single job through the full pipeline
import { downloadVideo, getVideoDuration, getYtdlpPath, getFfmpegPath, cutSegment, cleanupJob, findNearestSceneCut, getYtdlpAuthArgs } from "./video";
import { parseSubtitles, detectBestMoments } from "./ai";
import { detectCropRegion, buildCropFilter } from "./smartcrop";
import { generateSubtitleFile } from "./subtitles";
import { updateJob, setWorker } from "./queue";
import type { Job } from "./queue";
import { spawn } from "child_process";
import path from "path";
import fs from "fs/promises";

// Smooth progress — animates from current to target over duration
function smoothProgress(
  jobId: string,
  from: number,
  to: number,
  durationMs: number,
  message?: string
): { stop: () => void } {
  const steps = Math.max(1, Math.round(durationMs / 300)); // update every ~300ms
  const increment = (to - from) / steps;
  const interval = durationMs / steps;
  let current = from;
  let step = 0;

  const timer = setInterval(() => {
    step++;
    current = Math.min(to, from + increment * step);
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

async function downloadSubtitles(url: string, jobId: string): Promise<string> {
  const ytdlp = getYtdlpPath();
  const tmpDir = path.join(process.cwd(), "tmp");
  const outputTemplate = path.join(tmpDir, `${jobId}_subs`);

  return new Promise((resolve) => {
    const proc = spawn(ytdlp, [
      ...getYtdlpAuthArgs(),
      "--write-auto-sub",
      "--write-sub",
      "--sub-lang", "es,en,es-419",
      "--sub-format", "vtt",
      "--skip-download",
      "-o", outputTemplate,
      url,
    ]);

    proc.on("close", async () => {
      try {
        const files = await fs.readdir(tmpDir);
        const subFile = files.find(
          (f) => f.startsWith(`${jobId}_subs`) && (f.endsWith(".vtt") || f.endsWith(".srt"))
        );
        if (subFile) {
          console.log(`[Worker] Found subtitles: ${subFile}`);
          resolve(path.join(tmpDir, subFile));
        } else {
          resolve("");
        }
      } catch {
        resolve("");
      }
    });
    proc.on("error", () => resolve(""));
  });
}

async function processJob(job: Job): Promise<void> {
  const { id, url } = job;

  // ====== STEP 1: DOWNLOAD (5% → 25%) ======
  updateJob(id, {
    status: "downloading",
    progress: 5,
    message: "Descargando video...",
  });

  const dlProgress = smoothProgress(id, 5, 24, 15000, "Descargando video...");
  const videoPath = await downloadVideo(url, id);
  dlProgress.stop();

  updateJob(id, {
    progress: 25,
    message: "Video descargado",
    videoPath,
  });

  // ====== STEP 2: ANALYZE (26% → 50%) ======
  updateJob(id, {
    status: "analyzing",
    progress: 26,
    message: "Descargando subtitulos...",
  });

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
    console.log(`[Worker] Parsed ${chunks.length} subtitle chunks`);
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

  updateJob(id, {
    progress: 50,
    segments,
    message: `${segments.length} momentos detectados`,
  });

  // ====== STEP 3: PROCESS (51% → 95%) ======
  updateJob(id, {
    status: "processing",
    progress: 51,
    message: "Ajustando cortes a escenas...",
  });

  // Snap ALL cut points in parallel (2 per segment)
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

  // Detect crop regions with YOLO
  const yoloProgress = smoothProgress(id, 57, 64, 10000, "Detectando encuadre (YOLO)...");
  const cropRegions = await Promise.all(
    segments.map((seg, i) =>
      detectCropRegion(videoPath, seg.start, seg.end - seg.start, id, i, ffmpegPath)
    )
  );
  yoloProgress.stop();

  updateJob(id, { progress: 65, message: "Generando subtitulos..." });

  // Generate subtitle files
  const vttPath = subtitlePath && subtitlePath.endsWith(".vtt") ? subtitlePath : undefined;
  const subtitleFiles = await Promise.all(
    segments.map((seg, i) =>
      generateSubtitleFile(chunks, seg.start, seg.end, id, i, seg.title, vttPath)
    )
  );

  updateJob(id, { progress: 70, message: "Cortando clips..." });

  // Cut ALL clips in parallel — track completions for progress
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

  // ====== STEP 4: DONE ======
  updateJob(id, {
    status: "done",
    progress: 100,
    outputs,
    message: `${outputs.length} shorts generados`,
  });

  // Cleanup temp files (keep outputs)
  await cleanupJob(id).catch(() => {});
  console.log(`[Worker] Job ${id} completed: ${outputs.length} shorts`);
}

// Register the worker
setWorker(processJob);

// Export to ensure this module is loaded
export const workerReady = true;
