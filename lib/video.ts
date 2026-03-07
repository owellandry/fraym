import { spawn, execSync } from "child_process";
import path from "path";
import fs from "fs/promises";
import * as fsSync from "fs";
import os from "os";
import { getYT, extractVideoId } from "./ytclient";

const TMP_DIR = path.join(process.cwd(), "tmp");
const OUTPUT_DIR = path.join(process.cwd(), "public", "outputs");

// Resolve binary paths for Windows (winget installs to non-standard locations)
function findBinary(name: string): string {
  if (os.platform() !== "win32") return name;

  const home = os.homedir();
  const wingetPkgs = path.join(home, "AppData", "Local", "Microsoft", "WinGet", "Packages");
  const candidates: string[] = [];

  const ffmpegPkgDirs = [
    "yt-dlp.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe",
    "Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe",
  ];
  for (const pkg of ffmpegPkgDirs) {
    const pkgPath = path.join(wingetPkgs, pkg);
    try {
      for (const entry of fsSync.readdirSync(pkgPath)) {
        candidates.push(path.join(pkgPath, entry, "bin", `${name}.exe`));
      }
    } catch {}
  }

  candidates.push(
    path.join(home, "AppData", "Local", "Microsoft", "WinGet", "Links", `${name}.exe`),
  );

  for (const c of candidates) {
    try {
      fsSync.accessSync(c);
      console.log(`[ShortsAI] Found ${name} at: ${c}`);
      return c;
    } catch {}
  }

  try {
    const result = execSync(`where ${name}`, { encoding: "utf-8" }).trim().split("\n")[0]!.trim();
    if (result) return result;
  } catch {}

  return name;
}

const FFMPEG = findBinary("ffmpeg");
const FFPROBE = findBinary("ffprobe");

export function getFfmpegPath() { return FFMPEG; }
export function getFfprobePath() { return FFPROBE; }

export async function ensureDirs() {
  await fs.mkdir(TMP_DIR, { recursive: true });
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
}

async function writeStreamToFile(stream: ReadableStream<Uint8Array>, filePath: string) {
  const writer = fsSync.createWriteStream(filePath);
  const reader = stream.getReader();

  return new Promise<void>((resolve, reject) => {
    const pump = async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) { writer.end(); break; }
          if (!writer.write(value)) await new Promise(r => writer.once("drain", r));
        }
        writer.on("finish", resolve);
        writer.on("error", reject);
      } catch (err) {
        writer.destroy();
        reject(err);
      }
    };
    pump();
  });
}

export async function downloadVideo(url: string, jobId: string): Promise<string> {
  await ensureDirs();
  const videoId = extractVideoId(url);
  const outputPath = path.join(TMP_DIR, `${jobId}.mp4`);
  const videoTmpPath = path.join(TMP_DIR, `${jobId}_v.mp4`);
  const audioTmpPath = path.join(TMP_DIR, `${jobId}_a.mp4`);

  const yt = await getYT();

  console.log(`[ShortsAI] Fetching info for ${videoId}...`);
  let info: Awaited<ReturnType<typeof yt.getInfo>> | null = null;

  for (const client of ["ANDROID", "IOS", "TV_EMBEDDED"] as const) {
    try {
      info = await yt.getInfo(videoId, client);
      const status = (info as any)?.playability_status?.status;
      if (status && status !== "OK") {
        console.log(`[ShortsAI] ${client} returned ${status}, trying next...`);
        info = null;
        continue;
      }
      console.log(`[ShortsAI] Using ${client} client`);
      break;
    } catch (err: any) {
      console.log(`[ShortsAI] ${client} failed: ${err.message}`);
    }
  }

  if (!info) {
    throw new Error("No se pudo acceder al video. Puede ser privado, restringido por edad o no disponible.");
  }

  console.log(`[ShortsAI] Downloading: ${info.basic_info.title}`);

  // Download video (up to 1080p) and audio as separate streams, then merge
  const videoStream = await yt.download(videoId, {
    type: "video",
    quality: "1080p",
    client: "ANDROID",
  });
  await writeStreamToFile(videoStream, videoTmpPath);

  const audioStream = await yt.download(videoId, {
    type: "audio",
    quality: "best",
    client: "ANDROID",
  });
  await writeStreamToFile(audioStream, audioTmpPath);

  // Merge video + audio with ffmpeg
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(FFMPEG, [
      "-i", videoTmpPath,
      "-i", audioTmpPath,
      "-c:v", "copy",
      "-c:a", "aac",
      "-movflags", "+faststart",
      "-y", outputPath,
    ]);
    let stderr = "";
    proc.stderr.on("data", d => { stderr += d.toString(); });
    proc.on("close", code => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg merge failed: ${stderr.slice(-300)}`));
    });
    proc.on("error", reject);
  });

  await fs.unlink(videoTmpPath).catch(() => {});
  await fs.unlink(audioTmpPath).catch(() => {});

  console.log(`[ShortsAI] Download complete: ${outputPath}`);
  return outputPath;
}

export async function downloadSubtitles(url: string, jobId: string): Promise<string> {
  try {
    const videoId = extractVideoId(url);
    const yt = await getYT();
    const info = await yt.getInfo(videoId);
    const tracks = info.captions?.caption_tracks ?? [];

    // Prefer Spanish, fallback to English
    const track =
      tracks.find(t => t.language_code === "es" || t.language_code === "es-419") ??
      tracks.find(t => t.language_code?.startsWith("es")) ??
      tracks.find(t => t.language_code?.startsWith("en")) ??
      tracks[0];

    if (!track?.base_url) return "";

    const res = await fetch(`${track.base_url}&fmt=vtt`);
    if (!res.ok) return "";

    const text = await res.text();
    const subPath = path.join(TMP_DIR, `${jobId}_subs.vtt`);
    await fs.writeFile(subPath, text, "utf-8");
    console.log(`[Worker] Subtitles downloaded (${track.language_code}): ${subPath}`);
    return subPath;
  } catch (err: any) {
    console.log(`[Worker] Subtitle download failed: ${err.message}`);
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

interface Segment {
  start: number;
  end: number;
  title: string;
  reason: string;
}

// Detect scene changes near a timestamp to find cleaner cut points
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
    console.log(`[ShortsAI] Burning subtitles: ${assSubtitlePath}`);
  }

  console.log(`[ShortsAI] Cutting segment #${index + 1} with filter: ${vf}`);

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
      if (code === 0) resolve(`/outputs/${outputName}`);
      else reject(new Error(`ffmpeg cut failed for segment ${index + 1}: ${stderr.slice(-200)}`));
    });
    proc.on("error", () => reject(new Error("ffmpeg not found.")));
  });
}

export async function cleanupJob(jobId: string) {
  const files = await fs.readdir(TMP_DIR);
  for (const file of files) {
    if (file.startsWith(jobId)) {
      await fs.unlink(path.join(TMP_DIR, file)).catch(() => {});
    }
  }
}
