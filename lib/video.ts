import { spawn, execSync } from "child_process";
import path from "path";
import fs from "fs/promises";
import * as fsSync from "fs";
import os from "os";

const TMP_DIR = path.join(process.cwd(), "tmp");
const OUTPUT_DIR = path.join(process.cwd(), "public", "outputs");

// Resolve binary paths for Windows (winget installs to non-standard locations)
function findBinary(name: string): string {
  if (os.platform() !== "win32") return name;

  const home = os.homedir();
  const wingetPkgs = path.join(home, "AppData", "Local", "Microsoft", "WinGet", "Packages");
  const candidates: string[] = [];

  if (name === "yt-dlp") {
    candidates.push(
      path.join(wingetPkgs, "yt-dlp.yt-dlp_Microsoft.Winget.Source_8wekyb3d8bbwe", "yt-dlp.exe"),
    );
  } else {
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

  // Last resort: try `where` command on Windows
  try {
    const result = execSync(`where ${name}`, { encoding: "utf-8" }).trim().split("\n")[0]!.trim();
    if (result) {
      console.log(`[ShortsAI] Found ${name} via where: ${result}`);
      return result;
    }
  } catch {}

  console.log(`[ShortsAI] WARNING: ${name} not found anywhere!`);
  return name;
}

const YTDLP = findBinary("yt-dlp");
const FFMPEG = findBinary("ffmpeg");
const FFPROBE = findBinary("ffprobe");
// yt-dlp needs the directory containing ffmpeg for merging
const FFMPEG_DIR = path.dirname(FFMPEG);

export function getYtdlpPath() { return YTDLP; }

export function getYtdlpAuthArgs(): string[] {
  const args: string[] = [];
  const cookiesFile = process.env.YTDLP_COOKIES_FILE?.trim();
  const cookiesFromBrowser = process.env.YTDLP_COOKIES_FROM_BROWSER?.trim();
  const userAgent = process.env.YTDLP_USER_AGENT?.trim();
  const extractorArgs = process.env.YTDLP_EXTRACTOR_ARGS?.trim();

  if (cookiesFile) {
    args.push("--cookies", cookiesFile);
  } else if (cookiesFromBrowser) {
    args.push("--cookies-from-browser", cookiesFromBrowser);
  }

  if (userAgent) args.push("--user-agent", userAgent);
  if (extractorArgs) args.push("--extractor-args", extractorArgs);

  return args;
}

export async function ensureDirs() {
  await fs.mkdir(TMP_DIR, { recursive: true });
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
}

export async function downloadVideo(url: string, jobId: string): Promise<string> {
  await ensureDirs();
  const outputPath = path.join(TMP_DIR, `${jobId}.mp4`);
  const authArgs = getYtdlpAuthArgs();

  return new Promise((resolve, reject) => {
    const proc = spawn(YTDLP, [
      ...authArgs,
      "--ffmpeg-location", FFMPEG_DIR,
      "-f", "bestvideo[height<=1080]+bestaudio/best",
      "--merge-output-format", "mp4",
      "--concurrent-fragments", "4",
      "--no-mtime",
      "--no-part",
      "-o", outputPath,
      "--no-playlist",
      url,
    ]);

    let stderr = "";
    proc.stdout.on("data", (data) => { console.log(`[yt-dlp] ${data.toString().trim()}`); });
    proc.stderr.on("data", (data) => { stderr += data.toString(); });
    proc.on("close", async (code) => {
      if (code === 0) {
        // Verify the merged file exists
        try {
          await fs.access(outputPath);
          console.log(`[ShortsAI] Download complete: ${outputPath}`);
          resolve(outputPath);
        } catch {
          // yt-dlp might have not merged, check for partial files
          const files = await fs.readdir(TMP_DIR);
          const partials = files.filter((f) => f.startsWith(jobId));
          reject(new Error(`yt-dlp finished but merged file not found. Files: ${partials.join(", ")}\nstderr: ${stderr}`));
        }
      } else {
        const blockedByYoutube = /Sign in to confirm you(?:'|’)re not a bot/i.test(stderr);
        const authHint = blockedByYoutube
          ? "\nYouTube blocked anonymous requests. Set YTDLP_COOKIES_FILE (recommended in Docker) or YTDLP_COOKIES_FROM_BROWSER."
          : "";
        reject(new Error(`yt-dlp failed (code ${code}): ${stderr}${authHint}`));
      }
    });
    proc.on("error", (err) => reject(new Error(`yt-dlp not found: ${err.message}`)));
  });
}

export async function getVideoDuration(videoPath: string): Promise<number> {
  console.log(`[ShortsAI] Running ffprobe: ${FFPROBE}`);
  console.log(`[ShortsAI] Video path: ${videoPath}`);

  // Check if video file exists
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
    proc.stdout.on("data", (data) => { stdout += data.toString(); });
    proc.stderr.on("data", (data) => { stderr += data.toString(); });
    proc.on("close", (code) => {
      if (code === 0) resolve(parseFloat(stdout.trim()));
      else reject(new Error(`ffprobe failed (code ${code}): ${stderr}`));
    });
    proc.on("error", (err) => reject(new Error(`ffprobe not found at "${FFPROBE}": ${err.message}`)));
  });
}

export async function extractSubtitles(videoPath: string, jobId: string): Promise<string> {
  await ensureDirs();
  const subtitlePath = path.join(TMP_DIR, `${jobId}.srt`);
  const authArgs = getYtdlpAuthArgs();

  return new Promise((resolve, reject) => {
    const proc = spawn(YTDLP, [
      ...authArgs,
      "--write-auto-sub",
      "--sub-lang", "en,es",
      "--sub-format", "srt",
      "--skip-download",
      "-o", path.join(TMP_DIR, jobId),
      videoPath,
    ]);

    let stderr = "";
    proc.stderr.on("data", (data) => { stderr += data.toString(); });
    proc.on("close", async () => {
      // Try to find any subtitle file
      const files = await fs.readdir(TMP_DIR);
      const subFile = files.find((f) => f.startsWith(jobId) && (f.endsWith(".srt") || f.endsWith(".vtt")));
      if (subFile) {
        resolve(path.join(TMP_DIR, subFile));
      } else {
        resolve(""); // No subtitles found, we'll work without them
      }
    });
    proc.on("error", () => resolve("")); // Non-critical
  });
}

interface Segment {
  start: number;
  end: number;
  title: string;
  reason: string;
}

export function getFfmpegPath() { return FFMPEG; }
export function getFfprobePath() { return FFPROBE; }

// Detect scene changes near a timestamp to find cleaner cut points
export async function findNearestSceneCut(
  videoPath: string,
  targetTime: number,
  searchRadius: number = 3, // search +/- 3 seconds
  minTime: number = 0,
  maxTime: number = Infinity
): Promise<number> {
  const searchStart = Math.max(minTime, targetTime - searchRadius);
  const searchDuration = searchRadius * 2;

  return new Promise((resolve) => {
    const proc = spawn(FFPROBE, [
      "-v", "quiet",
      "-read_intervals", `${searchStart}%+${searchDuration}`,
      "-show_frames",
      "-select_streams", "v",
      "-show_entries", "frame=pts_time,pkt_pts_time",
      "-of", "csv=p=0",
      videoPath,
    ]);

    // Simpler approach: use ffmpeg scene detection
    const proc2 = spawn(FFMPEG, [
      "-ss", searchStart.toString(),
      "-i", videoPath,
      "-t", searchDuration.toString(),
      "-vf", "select='gt(scene,0.25)',showinfo",
      "-vsync", "vfr",
      "-f", "null",
      "-",
    ]);

    let stderr = "";
    proc.kill(); // kill ffprobe approach, use ffmpeg
    proc2.stderr.on("data", (data) => { stderr += data.toString(); });
    proc2.on("close", () => {
      // Parse scene change timestamps from showinfo output
      const sceneChanges: number[] = [];
      const regex = /pts_time:(\d+\.?\d*)/g;
      let match;
      while ((match = regex.exec(stderr))) {
        const absTime = searchStart + parseFloat(match[1]!);
        if (absTime >= minTime && absTime <= maxTime) {
          sceneChanges.push(absTime);
        }
      }

      if (sceneChanges.length === 0) {
        resolve(targetTime); // No scene changes found, keep original
        return;
      }

      // Find the scene change closest to our target
      let closest = sceneChanges[0]!;
      let minDist = Math.abs(closest - targetTime);
      for (const sc of sceneChanges) {
        const dist = Math.abs(sc - targetTime);
        if (dist < minDist) {
          closest = sc;
          minDist = dist;
        }
      }

      if (minDist < searchRadius) {
        console.log(`[SceneCut] Adjusted ${targetTime.toFixed(1)}s -> ${closest.toFixed(1)}s (scene change)`);
        resolve(closest);
      } else {
        resolve(targetTime);
      }
    });
    proc2.on("error", () => resolve(targetTime));
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

  // Default: smart center crop + mirror (no black bars!)
  let vf = cropFilter || "crop=ih*9/16:ih:(iw-ih*9/16)/2:0,scale=1080:1920,hflip";

  // Burn in word-by-word subtitles if available
  if (assSubtitlePath) {
    // FFmpeg needs forward slashes and escaped colons for Windows paths in filter
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
    proc.stderr.on("data", (data) => { stderr += data.toString(); });
    proc.on("close", (code) => {
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
