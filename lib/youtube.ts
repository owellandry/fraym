// YouTube client — routes through Cloudflare Worker proxy (dlsrv HD downloads)
import fs from "fs/promises";
import * as fsSync from "fs";
import { logYoutube } from "./logger";

const PROXY_URL = process.env.YT_PROXY_URL || "";
const PROXY_SECRET = process.env.YT_PROXY_SECRET || "";

function proxyHeaders() {
  return { "Authorization": `Bearer ${PROXY_SECRET}` };
}

export function isProxyConfigured(): boolean {
  return Boolean(PROXY_URL && PROXY_SECRET);
}

export interface VideoInfo {
  title: string;
  duration: number;
  bestQuality: string;
  captions: any[];
}

export async function getVideoInfo(videoId: string): Promise<VideoInfo> {
  if (!isProxyConfigured()) {
    throw new Error("YouTube proxy not configured. Set YT_PROXY_URL and YT_PROXY_SECRET in .env");
  }

  const res = await fetch(`${PROXY_URL}/info?v=${videoId}`, {
    headers: proxyHeaders(),
  });

  if (!res.ok) {
    const data: any = await res.json().catch(() => ({}));
    throw new Error(data.error || `Proxy error: ${res.status}`);
  }

  const data: any = await res.json();
  if (data.status !== "OK") throw new Error("Video not available");

  logYoutube.info(`${data.title}`, `${data.bestQuality} · ${data.duration}s`);

  return {
    title: data.title,
    duration: data.duration,
    bestQuality: data.bestQuality,
    captions: data.captions || [],
  };
}

export async function downloadVideo(videoId: string, filePath: string, quality = "720"): Promise<void> {
  if (!isProxyConfigured()) {
    throw new Error("YouTube proxy not configured");
  }

  // Step 1: Get the download tunnel URL
  const dlRes = await fetch(`${PROXY_URL}/download?v=${videoId}&q=${quality}`, {
    headers: proxyHeaders(),
  });

  if (!dlRes.ok) {
    const data: any = await dlRes.json().catch(() => ({}));
    throw new Error(data.error || `Download error: ${dlRes.status}`);
  }

  const dlData: any = await dlRes.json();
  if (dlData.status !== "OK" || !dlData.url) {
    throw new Error("Failed to get download URL");
  }

  logYoutube.step(`Descargando ${quality}p`, dlData.filename || videoId);

  // Step 2: Download the video through our proxy (to avoid IP issues)
  const streamUrl = `${PROXY_URL}/stream?url=${encodeURIComponent(dlData.url)}`;
  const res = await fetch(streamUrl, {
    headers: proxyHeaders(),
  });

  if (!res.ok || !res.body) {
    throw new Error(`Stream download failed: ${res.status}`);
  }

  // Step 3: Write to file
  const writer = fsSync.createWriteStream(filePath);
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();

  return new Promise<void>((resolve, reject) => {
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
}

export async function downloadCaptionFile(baseUrl: string, filePath: string): Promise<void> {
  // Handle data URIs (from maestra fallback in Worker)
  if (baseUrl.startsWith("data:")) {
    const base64 = baseUrl.split(",")[1] || "";
    const vtt = Buffer.from(base64, "base64").toString("utf-8");
    if (vtt && vtt.length > 10) {
      await fs.writeFile(filePath, vtt, "utf-8");
      logYoutube.debug(`Caption from data URI: ${vtt.length} chars`);
    }
    return;
  }

  if (!isProxyConfigured()) return;

  // Download through proxy
  const proxyUrl = `${PROXY_URL}/caption-file?url=${encodeURIComponent(baseUrl)}`;
  const res = await fetch(proxyUrl, { headers: proxyHeaders() });
  if (!res.ok) return;

  const text = await res.text();
  if (text && text.length > 10) {
    await fs.writeFile(filePath, text, "utf-8");
    logYoutube.debug(`Caption file downloaded: ${text.length} chars`);
  }
}


export function extractVideoId(url: string): string {
  const patterns = [
    /[?&]v=([a-zA-Z0-9_-]{11})/,
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /\/embed\/([a-zA-Z0-9_-]{11})/,
    /\/shorts\/([a-zA-Z0-9_-]{11})/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1]!;
  }
  throw new Error(`URL de YouTube invalida: ${url}`);
}
