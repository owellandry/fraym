// Pexels API client — free stock video search and download

import fs from "fs/promises";
import * as fsSync from "fs";
import { logVideo } from "./logger";

const API_KEY = process.env.PEXELS_API_KEY || "";
const BASE_URL = "https://api.pexels.com/videos";

export function isPexelsConfigured(): boolean {
  return Boolean(API_KEY);
}

export interface PexelsVideo {
  id: number;
  url: string;
  duration: number;
  width: number;
  height: number;
  downloadUrl: string;
}

// Search categories that work well as background content
export const BACKGROUND_CATEGORIES: Record<string, string[]> = {
  satisfying: ["satisfying", "slime asmr", "paint mixing", "sand cutting"],
  nature: ["ocean waves", "waterfall", "clouds timelapse", "forest aerial"],
  city: ["city night", "traffic timelapse", "neon lights", "aerial city"],
  abstract: ["particles", "abstract motion", "liquid", "smoke"],
  food: ["cooking", "food preparation", "kitchen"],
  space: ["space", "galaxy", "stars timelapse", "nebula"],
};

export async function searchVideos(
  query: string,
  minDuration: number = 15,
  orientation: "landscape" | "portrait" = "portrait"
): Promise<PexelsVideo[]> {
  if (!isPexelsConfigured()) {
    throw new Error("Pexels API not configured. Set PEXELS_API_KEY in .env");
  }

  const params = new URLSearchParams({
    query,
    orientation,
    size: "medium",
    per_page: "15",
  });

  const res = await fetch(`${BASE_URL}/search?${params}`, {
    headers: { Authorization: API_KEY },
  });

  if (!res.ok) {
    throw new Error(`Pexels API error: ${res.status}`);
  }

  const data: any = await res.json();
  const videos: PexelsVideo[] = [];

  for (const video of data.videos || []) {
    if (video.duration < minDuration) continue;

    // Find best quality file (prefer HD, portrait-friendly)
    const files = (video.video_files || []).sort(
      (a: any, b: any) => (b.height || 0) - (a.height || 0)
    );

    // Prefer 720p-1080p to save bandwidth
    const best = files.find((f: any) => f.height >= 720 && f.height <= 1080)
      || files.find((f: any) => f.height >= 480)
      || files[0];

    if (best?.link) {
      videos.push({
        id: video.id,
        url: video.url,
        duration: video.duration,
        width: best.width || 1080,
        height: best.height || 1920,
        downloadUrl: best.link,
      });
    }
  }

  return videos;
}

export async function downloadBackground(
  query: string,
  minDuration: number,
  outputPath: string
): Promise<{ path: string; duration: number }> {
  // Try category keywords, then fall back to direct query
  const category = BACKGROUND_CATEGORIES[query.toLowerCase()];
  const queries = category ? category : [query];

  for (const q of queries) {
    logVideo.info(`Buscando fondo: "${q}"...`);

    try {
      const videos = await searchVideos(q, minDuration, "portrait");
      if (videos.length === 0) continue;

      // Pick a random video from results for variety
      const video = videos[Math.floor(Math.random() * Math.min(videos.length, 5))]!;
      logVideo.info(`Descargando fondo: ${video.duration}s (${video.width}x${video.height})`);

      const res = await fetch(video.downloadUrl);
      if (!res.ok || !res.body) continue;

      const writer = fsSync.createWriteStream(outputPath);
      const reader = (res.body as ReadableStream<Uint8Array>).getReader();

      await new Promise<void>((resolve, reject) => {
        const pump = async () => {
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) { writer.end(); break; }
              if (!writer.write(value)) {
                await new Promise(r => writer.once("drain", r));
              }
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

      const stat = await fs.stat(outputPath);
      logVideo.success("Fondo descargado", `${(stat.size / 1024 / 1024).toFixed(1)}MB`);

      return { path: outputPath, duration: video.duration };
    } catch (err: any) {
      logVideo.warn(`Busqueda "${q}" fallida`, err.message);
    }
  }

  throw new Error(`No se encontro video de fondo para: ${query}`);
}
