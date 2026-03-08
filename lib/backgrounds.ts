// Free background videos from OrbitalNCG YouTube channel (parkour, no copyright)
// Round-robin cycle through 100 videos, download via YT proxy with byte limit

import * as fsSync from "fs";
import fs from "fs/promises";
import { logVideo } from "./logger";

const PROXY_URL = process.env.YT_PROXY_URL || "";
const PROXY_SECRET = process.env.YT_PROXY_SECRET || "";

// 100 videos from OrbitalNCG parkour playlist (PLmSs-0cFIbfVWhkZx0i4UMiZdr2C0Z8w7)
const VIDEO_IDS = [
  "_-2ZUciZgls", "_A3po0HYwkY", "_H2cLn-OlIU", "_SunVlCWeLc", "0c4KWfPhgWA",
  "0iq61NOllG8", "0vPT4tUFKWA", "1DmWDZOdl6U", "2BFfhOqlUss", "2SWW4U4TKOA",
  "37_wnD3jUbw", "3wsa4LTBUxo", "3xeJ1CxEqaU", "4JBMIIwel9Q", "5ksFZIlktBY",
  "70ggyLzxl_4", "75McClC40mw", "7mTTdWTw5p0", "7yl7Wc1dtWc", "85z7jqGAGcc",
  "8KdXeDSGvZw", "952ILTHDgC4", "97yjvUm5z6w", "9hTw1f1--to", "aMg7kFHD11o",
  "b2bW6FrgfMI", "bBOBn1Jx5BY", "bcWB8RH6Cik", "BUJmtj4hhC4", "BXUA2FncVPI",
  "cgWTN9tgC5g", "COXVxAIdAC4", "Cu-R8HZlJTA", "dGfxit2VoB0", "D-IQowqMC4U",
  "dJ_IRzfEuAE", "dqg2lQfq_4A", "dvMzleUa4lM", "ENnGcUvrhXQ", "Ey5YXBINl2Q",
  "f5Rz5xLHcs4", "FzI-c9qRnAo", "G0WXGGtqQj4", "Gqt_SFgdG9I", "GvzgNxcdW-I",
  "Gz6X88MUqwY", "i3uZK8K9ZnQ", "icLXMm9YUeM", "IzzQq3rQpgU", "jA8DzT7BDSo",
  "KlfDfGc0VW0", "l9_9M1TetJQ", "LJyRdmI6G3o", "-LZceM7L8AE", "lzg-k2miDyk",
  "LZWfD_cO3cc", "m9WRa5D5Cxk", "mOq0WERKhoQ", "mTHNDZiDd5A", "n38yBf1687k",
  "nIypcghmWFs", "NJv_xJa3E8k", "OH8jAR3adv4", "ovbkGkNZj30", "pKN0GfLwmRw",
  "pQx_2LmNF8M", "q1KxcrN4vnc", "Qf7GiHUTHPM", "qmnv7bf7V2k", "qOFX00DjjxM",
  "qra8ZLN0caA", "qwepUFpTSME", "QZRncjexa0I", "r7QxFKBBTM8", "REvEyFEaBgI",
  "Ry411rteqww", "S3ZDCz-zQuM", "s600FYgI5-s", "sbTzn7jVeXE", "Sd-ybPlZ6G8",
  "sLWHKDBrgqM", "t_r-ST06jR4", "tCBOhczn6Ok", "u7kdVe8q5zs", "UlOslEIUJoc",
  "UTbPtgjZRMY", "UtFhapzu030", "vrcSq1-r25U", "wxgSCIpoMQE", "X8lhIytfINQ",
  "Xd2zzj9pN28", "xQdQDz4-1EY", "y7rMWcvwh1g", "-YhCuBsYEPg", "-yPjP85CbQE",
  "YtOl-6YM6N8", "YW7NV8J8oxI", "Z_Rlorr_a0w", "z84bmLDzIIk", "zxmENLsNzPo",
];

// Round-robin counter (persists across calls, resets on server restart)
let currentIndex = 0;

function nextVideoId(): string {
  const id = VIDEO_IDS[currentIndex % VIDEO_IDS.length]!;
  currentIndex++;
  return id;
}

// Max bytes to download (~200MB ≈ ~10 min of 720p)
const MAX_DOWNLOAD_BYTES = 200 * 1024 * 1024;

export async function downloadYTBackground(
  audioDuration: number,
  outputPath: string,
): Promise<{ path: string; duration: number }> {
  if (!PROXY_URL || !PROXY_SECRET) {
    throw new Error("YT proxy not configured for background downloads");
  }

  // Try up to 3 videos in case one fails
  for (let attempt = 0; attempt < 3; attempt++) {
    const videoId = nextVideoId();
    logVideo.info(`Fondo YT: ${videoId} (${currentIndex}/${VIDEO_IDS.length} ciclo)`);

    try {
      // Step 1: Get download URL from proxy
      const dlRes = await fetch(`${PROXY_URL}/download?v=${videoId}&q=720`, {
        headers: { Authorization: `Bearer ${PROXY_SECRET}` },
      });

      if (!dlRes.ok) {
        logVideo.warn(`Fondo ${videoId}: proxy error ${dlRes.status}`);
        continue;
      }

      const dlData: any = await dlRes.json();
      if (dlData.status !== "OK" || !dlData.url) {
        logVideo.warn(`Fondo ${videoId}: no download URL`);
        continue;
      }

      // Step 2: Stream download with byte limit
      const streamUrl = `${PROXY_URL}/stream?url=${encodeURIComponent(dlData.url)}`;
      const res = await fetch(streamUrl, {
        headers: { Authorization: `Bearer ${PROXY_SECRET}` },
      });

      if (!res.ok || !res.body) {
        logVideo.warn(`Fondo ${videoId}: stream error ${res.status}`);
        continue;
      }

      logVideo.step("Descargando fondo...", videoId);

      const writer = fsSync.createWriteStream(outputPath);
      const reader = (res.body as ReadableStream<Uint8Array>).getReader();
      let totalBytes = 0;

      await new Promise<void>((resolve, reject) => {
        const pump = async () => {
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) { writer.end(); break; }

              totalBytes += value.byteLength;
              if (!writer.write(value)) {
                await new Promise(r => writer.once("drain", r));
              }

              // Stop after enough bytes (video will be trimmed by ffmpeg anyway)
              if (totalBytes >= MAX_DOWNLOAD_BYTES) {
                logVideo.info("Limite de descarga alcanzado", `${(totalBytes / 1024 / 1024).toFixed(0)}MB`);
                reader.cancel().catch(() => {});
                writer.end();
                break;
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
      logVideo.success("Fondo descargado", `${(stat.size / 1024 / 1024).toFixed(1)}MB · ${videoId}`);

      // These videos are long (hours), duration is always > audioDuration
      // Return a generous estimate — ffmpeg will trim to exact audio length
      return { path: outputPath, duration: Math.max(audioDuration * 2, 600) };

    } catch (err: any) {
      logVideo.warn(`Fondo ${videoId} fallido`, err.message);
    }
  }

  throw new Error("No se pudo descargar video de fondo (3 intentos fallidos)");
}
