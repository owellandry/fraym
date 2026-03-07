import { spawn } from "child_process";
import path from "path";
import fs from "fs/promises";
import sharp from "sharp";
import { TMP_DIR } from "./config";
import { detectInFrame, type BoundingBox } from "./yolo";
import { logYolo } from "./logger";
import type { CropRegion } from "./types";

interface FrameDetections {
  boxes: BoundingBox[];
  frameIndex: number;
}

async function extractFrames(
  videoPath: string,
  start: number,
  duration: number,
  jobId: string,
  ffmpegPath: string,
  frameCount: number = 8
): Promise<string[]> {
  const framesDir = path.join(TMP_DIR, `${jobId}_frames`);
  await fs.mkdir(framesDir, { recursive: true });

  const fps = frameCount / duration;

  return new Promise((resolve) => {
    const proc = spawn(ffmpegPath, [
      "-ss", start.toString(),
      "-i", videoPath,
      "-t", duration.toString(),
      "-vf", `fps=${fps.toFixed(4)}`,
      "-q:v", "4",
      "-y",
      path.join(framesDir, "frame_%03d.jpg"),
    ]);

    proc.on("close", async (code) => {
      if (code !== 0) { resolve([]); return; }
      try {
        const files = await fs.readdir(framesDir);
        resolve(
          files
            .filter(f => f.endsWith(".jpg"))
            .sort()
            .map(f => path.join(framesDir, f))
        );
      } catch { resolve([]); }
    });
    proc.on("error", () => resolve([]));
  });
}

function decideCropStrategy(
  allDetections: FrameDetections[],
  videoAspect: number
): CropRegion {
  const allBoxes = allDetections.flatMap(d => d.boxes);

  if (allBoxes.length === 0) {
    logYolo.info("Sin detecciones, usando crop centrado");
    return { x: -1, strategy: "center" };
  }

  const centers: number[] = allBoxes.map(b => (b.x1 + b.x2) / 2);
  centers.sort((a, b) => a - b);
  const medianCenter = centers[Math.floor(centers.length / 2)]!;

  const cropWidthRatio = (9 / 16) / videoAspect;
  const subjectSpread = Math.max(...allBoxes.map(b => b.x2)) - Math.min(...allBoxes.map(b => b.x1));

  if (subjectSpread > cropWidthRatio * 1.5) {
    logYolo.debug("Sujeto amplio, rastreando principal");
  }

  let cropX = medianCenter - cropWidthRatio / 2;
  cropX = Math.max(0, Math.min(cropX, 1 - cropWidthRatio));

  const hasFaces = allBoxes.some(b => b.label === "face");
  const strategy = hasFaces ? "face" : "person";

  logYolo.info(`Estrategia: ${strategy}`, `centro=${(medianCenter * 100).toFixed(0)}% · ${allBoxes.length} detecciones en ${allDetections.length} frames`);

  const filterRatio = (1 - cropWidthRatio) > 0 ? cropX / (1 - cropWidthRatio) : 0;

  return { x: Math.max(0, Math.min(1, filterRatio)), strategy };
}

export async function detectCropRegion(
  videoPath: string,
  start: number,
  duration: number,
  jobId: string,
  segIndex: number,
  ffmpegPath: string
): Promise<CropRegion> {
  logYolo.step(`Analizando segmento #${segIndex + 1}`);

  const frames = await extractFrames(videoPath, start, duration, `${jobId}_s${segIndex}`, ffmpegPath, 6);

  if (frames.length === 0) {
    logYolo.warn("Sin frames extraidos, crop centrado");
    return { x: -1, strategy: "center" };
  }

  const firstMeta = await sharp(frames[0]!).metadata();
  const videoWidth = firstMeta.width || 1920;
  const videoHeight = firstMeta.height || 1080;
  const videoAspect = videoWidth / videoHeight;

  const allDetections: FrameDetections[] = [];
  for (let i = 0; i < frames.length; i++) {
    try {
      const boxes = await detectInFrame(frames[i]!);
      allDetections.push({ boxes, frameIndex: i });
      if (boxes.length > 0) {
        logYolo.debug(`Frame ${i + 1}: ${boxes.length} ${boxes[0]!.label}(s)`);
      }
    } catch (err) {
      logYolo.warn(`Frame ${i + 1} deteccion fallida`, String(err));
    }
  }

  const framesDir = path.dirname(frames[0]!);
  await fs.rm(framesDir, { recursive: true, force: true }).catch(() => {});

  return decideCropStrategy(allDetections, videoAspect);
}

export function buildCropFilter(cropRegion: CropRegion): string {
  if (cropRegion.x < 0 || cropRegion.strategy === "center") {
    return "crop=ih*9/16:ih:(iw-ih*9/16)/2:0,scale=1080:1920,hflip";
  }

  const xExpr = `(iw-ih*9/16)*${cropRegion.x.toFixed(4)}`;
  return `crop=ih*9/16:ih:${xExpr}:0,scale=1080:1920,hflip`;
}
