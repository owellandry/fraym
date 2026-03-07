import { spawn } from "child_process";
import path from "path";
import fs from "fs/promises";
import { TMP_DIR, OUTPUT_DIR, FFMPEG, FFPROBE, ensureDirs } from "./config";
import { extractVideoId, getVideoInfo, downloadVideo as ytDownload, downloadCaptionFile } from "./youtube";
import { logVideo, logSubs } from "./logger";
import type { Segment } from "./types";

export { ensureDirs };
export function getFfmpegPath() { return FFMPEG; }
export function getFfprobePath() { return FFPROBE; }

export async function downloadVideo(url: string, jobId: string): Promise<string> {
  await ensureDirs();
  const videoId = extractVideoId(url);
  const outputPath = path.join(TMP_DIR, `${jobId}.mp4`);

  logVideo.info(`Fetching info for ${videoId}`);
  const info = await getVideoInfo(videoId);
  logVideo.info(`Descargando: ${info.title}`, info.bestQuality);

  await ytDownload(videoId, outputPath, "720");

  logVideo.success("Descarga completa", outputPath);
  return outputPath;
}

export async function downloadSubtitles(url: string, jobId: string): Promise<string> {
  try {
    const videoId = extractVideoId(url);
    const info = await getVideoInfo(videoId);
    const tracks = info.captions || [];

    logSubs.info(`Tracks via proxy: ${tracks.length}`);

    for (const t of tracks) {
      logSubs.debug(`  track: lang=${t.languageCode || "?"} kind=${t.kind || "standard"} baseUrl=${t.baseUrl ? "SI" : "NO"}`);
    }

    const track =
      tracks.find((t: any) => t.languageCode === "es" || t.languageCode === "es-419") ??
      tracks.find((t: any) => t.languageCode?.startsWith("es")) ??
      tracks.find((t: any) => t.languageCode?.startsWith("en")) ??
      tracks[0];

    if (!track?.baseUrl) {
      logSubs.warn("No se encontraron tracks de subtitulos");
      return "";
    }

    logSubs.info(`Descargando track: lang=${track.languageCode} kind=${track.kind || "standard"}`);
    const subPath = path.join(TMP_DIR, `${jobId}_subs.vtt`);
    await downloadCaptionFile(track.baseUrl, subPath);

    try {
      const stat = await fs.stat(subPath);
      if (stat.size > 0) {
        logSubs.success(`Subtitulos descargados`, `lang=${track.languageCode} size=${stat.size}b`);
        return subPath;
      }
    } catch {}

    logSubs.warn("No se pudieron obtener subtitulos");
    return "";
  } catch (err: any) {
    logSubs.warn(`Descarga de subtitulos fallida`, err.message);
    return "";
  }
}

export async function getVideoDuration(videoPath: string): Promise<number> {
  try {
    await fs.access(videoPath);
  } catch {
    throw new Error(`Video file not found: ${videoPath}`);
  }

  return new Promise((resolve, reject) => {
    const proc = spawn(FFPROBE, [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      videoPath,
    ]);
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", d => { stdout += d.toString(); });
    proc.stderr.on("data", d => { stderr += d.toString(); });
    proc.on("close", code => {
      if (code === 0) resolve(parseFloat(stdout.trim()));
      else reject(new Error(`ffprobe failed (code ${code}): ${stderr}`));
    });
    proc.on("error", err => reject(new Error(`ffprobe not found: ${err.message}`)));
  });
}

export async function findNearestSceneCut(
  videoPath: string,
  targetTime: number,
  searchRadius: number = 3,
  minTime: number = 0,
  maxTime: number = Infinity
): Promise<number> {
  const searchStart = Math.max(minTime, targetTime - searchRadius);
  const searchDuration = searchRadius * 2;

  return new Promise((resolve) => {
    const proc = spawn(FFMPEG, [
      "-ss", searchStart.toString(),
      "-i", videoPath,
      "-t", searchDuration.toString(),
      "-vf", "select='gt(scene,0.25)',showinfo",
      "-vsync", "vfr",
      "-f", "null",
      "-",
    ]);

    let stderr = "";
    proc.stderr.on("data", d => { stderr += d.toString(); });
    proc.on("close", () => {
      const sceneChanges: number[] = [];
      const regex = /pts_time:(\d+\.?\d*)/g;
      let match;
      while ((match = regex.exec(stderr))) {
        const absTime = searchStart + parseFloat(match[1]!);
        if (absTime >= minTime && absTime <= maxTime) sceneChanges.push(absTime);
      }

      if (sceneChanges.length === 0) { resolve(targetTime); return; }

      let closest = sceneChanges[0]!;
      let minDist = Math.abs(closest - targetTime);
      for (const sc of sceneChanges) {
        const dist = Math.abs(sc - targetTime);
        if (dist < minDist) { closest = sc; minDist = dist; }
      }

      resolve(minDist < searchRadius ? closest : targetTime);
    });
    proc.on("error", () => resolve(targetTime));
  });
}

export async function cutSegment(
  videoPath: string,
  segment: Segment,
  index: number,
  jobId: string,
  cropFilter?: string,
  assSubtitlePath?: string
): Promise<string> {
  await ensureDirs();
  const outputName = `${jobId}_short_${index + 1}.mp4`;
  const outputPath = path.join(OUTPUT_DIR, outputName);
  const duration = segment.end - segment.start;

  let vf = cropFilter || "crop=ih*9/16:ih:(iw-ih*9/16)/2:0,scale=1080:1920,hflip";

  if (assSubtitlePath) {
    const escapedPath = assSubtitlePath.replace(/\\/g, "/").replace(/:/g, "\\:");
    vf += `,ass='${escapedPath}'`;
    logVideo.debug("Quemando subtitulos ASS");
  }

  logVideo.step(`Cortando clip #${index + 1}`, `${Math.round(duration)}s`);

  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG, [
      "-ss", segment.start.toString(),
      "-i", videoPath,
      "-t", duration.toString(),
      "-vf", vf,
      "-c:v", "libx264",
      "-preset", "ultrafast",
      "-crf", "23",
      "-c:a", "aac",
      "-b:a", "128k",
      "-movflags", "+faststart",
      "-y",
      outputPath,
    ]);

    let stderr = "";
    proc.stderr.on("data", d => { stderr += d.toString(); });
    proc.on("close", code => {
      if (code === 0) resolve(`/api/outputs?file=${outputName}`);
      else reject(new Error(`ffmpeg cut failed for segment ${index + 1}: ${stderr.slice(-200)}`));
    });
    proc.on("error", () => reject(new Error("ffmpeg not found.")));
  });
}

export async function cleanupJob(jobId: string) {
  const files = await fs.readdir(TMP_DIR);
  let cleaned = 0;
  for (const file of files) {
    if (file.startsWith(jobId)) {
      await fs.unlink(path.join(TMP_DIR, file)).catch(() => {});
      cleaned++;
    }
  }
  if (cleaned > 0) logVideo.debug(`Limpieza: ${cleaned} archivos temporales eliminados`);
}
