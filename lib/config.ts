import { execSync } from "child_process";
import path from "path";
import fs from "fs/promises";
import * as fsSync from "fs";
import os from "os";
import { log } from "./logger";

export const TMP_DIR = path.join(process.cwd(), "tmp");
export const OUTPUT_DIR = path.join(process.cwd(), "public", "outputs");

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
      log.debug(`Found ${name} at: ${c}`);
      return c;
    } catch {}
  }

  try {
    const result = execSync(`where ${name}`, { encoding: "utf-8" }).trim().split("\n")[0]!.trim();
    if (result) return result;
  } catch {}

  return name;
}

export const FFMPEG = findBinary("ffmpeg");
export const FFPROBE = findBinary("ffprobe");

export async function ensureDirs() {
  await fs.mkdir(TMP_DIR, { recursive: true });
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
}
