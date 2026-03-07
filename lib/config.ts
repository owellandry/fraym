import { execSync } from "child_process";
import path from "path";
import fs from "fs/promises";
import * as fsSync from "fs";
import os from "os";
import { log } from "./logger";

export const TMP_DIR = path.join(process.cwd(), "tmp");
export const OUTPUT_DIR = path.join(process.cwd(), "public", "outputs");

function findBinary(name: string): string {
  const platform = os.platform();
  const isWin = platform === "win32";
  const exe = isWin ? `${name}.exe` : name;
  const home = os.homedir();
  const candidates: string[] = [];

  if (isWin) {
    // Windows: WinGet package dirs
    const wingetPkgs = path.join(home, "AppData", "Local", "Microsoft", "WinGet", "Packages");
    const ffmpegPkgDirs = [
      "yt-dlp.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe",
      "Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe",
    ];
    for (const pkg of ffmpegPkgDirs) {
      const pkgPath = path.join(wingetPkgs, pkg);
      try {
        for (const entry of fsSync.readdirSync(pkgPath)) {
          candidates.push(path.join(pkgPath, entry, "bin", exe));
        }
      } catch {}
    }
    candidates.push(
      path.join(home, "AppData", "Local", "Microsoft", "WinGet", "Links", exe),
      path.join("C:", "ProgramData", "chocolatey", "bin", exe),
      path.join(home, "scoop", "shims", exe),
    );
  } else if (platform === "darwin") {
    // macOS: Homebrew (ARM + Intel)
    candidates.push(
      `/opt/homebrew/bin/${name}`,
      `/usr/local/bin/${name}`,
      path.join(home, ".local", "bin", name),
    );
  } else {
    // Linux: common paths
    candidates.push(
      `/usr/bin/${name}`,
      `/usr/local/bin/${name}`,
      `/snap/bin/${name}`,
      path.join(home, ".local", "bin", name),
    );
  }

  for (const c of candidates) {
    try {
      fsSync.accessSync(c);
      log.debug(`Found ${name} at: ${c}`);
      return c;
    } catch {}
  }

  // Fallback: use system lookup (where on Windows, which on Unix)
  try {
    const cmd = isWin ? `where ${name}` : `which ${name}`;
    const result = execSync(cmd, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim().split("\n")[0]!.trim();
    if (result) {
      log.debug(`Found ${name} via ${isWin ? "where" : "which"}: ${result}`);
      return result;
    }
  } catch {}

  return name;
}

export const FFMPEG = findBinary("ffmpeg");
export const FFPROBE = findBinary("ffprobe");

export async function ensureDirs() {
  await fs.mkdir(TMP_DIR, { recursive: true });
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
}
