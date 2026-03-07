// Smart cropping pipeline — context-aware reframing from 16:9 to 9:16
//
// Approach inspired by Google AutoFlip and RetargetVid:
// 1. Sample frames every ~0.5s (not just 6 per segment)
// 2. Run face AND person detection on each frame
// 3. Compute weighted region of interest per frame
// 4. Generate per-frame crop positions with EMA smoothing
// 5. Apply dead zone to prevent micro-jitter
// 6. Output keyframed crop filter for ffmpeg

import { spawn } from "child_process";
import path from "path";
import fs from "fs/promises";
import sharp from "sharp";
import { TMP_DIR } from "./config";
import { detectInFrame, type BoundingBox, type FrameDetection } from "./yolo";
import { logYolo } from "./logger";
import type { CropRegion, CropKeyframe } from "./types";

// --- Constants ---

const SAMPLE_INTERVAL = 0.5;       // seconds between frame samples
const MAX_FRAMES = 40;             // cap to avoid huge segments killing perf
const FACE_WEIGHT = 3.0;           // face importance weight
const PERSON_WEIGHT = 1.0;         // person importance weight
const PADDING_RATIO = 0.25;        // 25% padding around subject
const EMA_ALPHA = 0.2;             // smoothing factor (lower = smoother)
const DEAD_ZONE = 0.03;            // 3% of frame width — ignore tiny movements
const KEYFRAME_MIN_CHANGE = 0.02;  // min position change to emit a new keyframe

// --- Types ---

interface FrameAnalysis {
  time: number;           // seconds relative to segment start
  faces: BoundingBox[];
  persons: BoundingBox[];
  roi: { cx: number; width: number } | null;  // region of interest (normalized 0-1)
}

// --- Frame extraction ---

async function extractFrames(
  videoPath: string,
  start: number,
  duration: number,
  jobId: string,
  ffmpegPath: string,
): Promise<{ paths: string[]; times: number[] }> {
  const frameCount = Math.min(MAX_FRAMES, Math.max(4, Math.ceil(duration / SAMPLE_INTERVAL)));
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
      path.join(framesDir, "frame_%04d.jpg"),
    ]);

    proc.on("close", async (code) => {
      if (code !== 0) { resolve({ paths: [], times: [] }); return; }
      try {
        const files = await fs.readdir(framesDir);
        const sorted = files.filter(f => f.endsWith(".jpg")).sort();
        const interval = duration / sorted.length;
        resolve({
          paths: sorted.map(f => path.join(framesDir, f)),
          times: sorted.map((_, i) => i * interval),
        });
      } catch { resolve({ paths: [], times: [] }); }
    });
    proc.on("error", () => resolve({ paths: [], times: [] }));
  });
}

// --- Region of interest calculation ---

function computeROI(
  detection: FrameDetection,
  cropWidthRatio: number
): { cx: number; width: number } | null {
  const { faces, persons } = detection;
  if (faces.length === 0 && persons.length === 0) return null;

  // Build weighted regions from all detections
  const regions: { cx: number; left: number; right: number; weight: number }[] = [];

  for (const f of faces) {
    const w = f.x2 - f.x1;
    const padded = w * PADDING_RATIO;
    regions.push({
      cx: (f.x1 + f.x2) / 2,
      left: Math.max(0, f.x1 - padded),
      right: Math.min(1, f.x2 + padded),
      weight: FACE_WEIGHT * f.confidence,
    });
  }

  for (const p of persons) {
    // If this person overlaps with a detected face, boost the face region instead
    const overlapsWithFace = faces.some(f => {
      const fCx = (f.x1 + f.x2) / 2;
      return fCx >= p.x1 && fCx <= p.x2;
    });

    if (overlapsWithFace) {
      // Person body gives context — extend the ROI to include hands/body
      const w = p.x2 - p.x1;
      const padded = w * (PADDING_RATIO * 0.5);
      regions.push({
        cx: (p.x1 + p.x2) / 2,
        left: Math.max(0, p.x1 - padded),
        right: Math.min(1, p.x2 + padded),
        weight: PERSON_WEIGHT * 0.5 * p.confidence, // lower weight, just for context
      });
    } else {
      // Standalone person (no face detected) — treat as primary
      const w = p.x2 - p.x1;
      const padded = w * PADDING_RATIO;
      regions.push({
        cx: (p.x1 + p.x2) / 2,
        left: Math.max(0, p.x1 - padded),
        right: Math.min(1, p.x2 + padded),
        weight: PERSON_WEIGHT * p.confidence,
      });
    }
  }

  if (regions.length === 0) return null;

  // Weighted center of mass
  let totalWeight = 0;
  let weightedCx = 0;
  let minLeft = 1;
  let maxRight = 0;

  for (const r of regions) {
    weightedCx += r.cx * r.weight;
    totalWeight += r.weight;
    minLeft = Math.min(minLeft, r.left);
    maxRight = Math.max(maxRight, r.right);
  }

  const cx = weightedCx / totalWeight;
  const subjectWidth = maxRight - minLeft;

  // If subjects fit within crop width, center on weighted center
  // If subjects are wider than crop, prioritize highest-weight region
  if (subjectWidth <= cropWidthRatio) {
    return { cx, width: subjectWidth };
  }

  // Too wide — focus on the highest-weight region
  const primary = regions.reduce((a, b) => a.weight > b.weight ? a : b);
  return { cx: primary.cx, width: primary.right - primary.left };
}

// --- EMA smoothing with dead zone ---

function smoothPositions(frames: FrameAnalysis[], cropWidthRatio: number): number[] {
  const positions: number[] = [];
  let smoothed = -1; // uninitialized

  for (const frame of frames) {
    let targetCx: number;

    if (frame.roi) {
      targetCx = frame.roi.cx;
    } else if (smoothed >= 0) {
      // No detection — hold last position
      targetCx = smoothed;
    } else {
      // No detection ever — center
      targetCx = 0.5;
    }

    // Convert center to crop X position (left edge of crop window)
    let cropX = targetCx - cropWidthRatio / 2;
    cropX = Math.max(0, Math.min(cropX, 1 - cropWidthRatio));

    if (smoothed < 0) {
      // First frame
      smoothed = cropX;
    } else {
      // Dead zone — ignore tiny movements
      const delta = Math.abs(cropX - smoothed);
      if (delta > DEAD_ZONE) {
        smoothed = EMA_ALPHA * cropX + (1 - EMA_ALPHA) * smoothed;
      }
      // else: keep smoothed unchanged
    }

    positions.push(smoothed);
  }

  return positions;
}

// --- Convert positions to sparse keyframes ---

function positionsToKeyframes(
  positions: number[],
  times: number[],
  cropWidthRatio: number
): CropKeyframe[] {
  if (positions.length === 0) return [];

  const maxX = 1 - cropWidthRatio;
  const keyframes: CropKeyframe[] = [];

  // Always emit first frame
  const firstRatio = maxX > 0 ? positions[0]! / maxX : 0;
  keyframes.push({ time: times[0]!, x: Math.max(0, Math.min(1, firstRatio)) });

  for (let i = 1; i < positions.length; i++) {
    const ratio = maxX > 0 ? positions[i]! / maxX : 0;
    const prevRatio = maxX > 0 ? positions[i - 1]! / maxX : 0;

    if (Math.abs(ratio - prevRatio) >= KEYFRAME_MIN_CHANGE) {
      keyframes.push({ time: times[i]!, x: Math.max(0, Math.min(1, ratio)) });
    }
  }

  // Always emit last frame
  const lastRatio = maxX > 0 ? positions[positions.length - 1]! / maxX : 0;
  const lastTime = times[times.length - 1]!;
  if (keyframes[keyframes.length - 1]!.time !== lastTime) {
    keyframes.push({ time: lastTime, x: Math.max(0, Math.min(1, lastRatio)) });
  }

  return keyframes;
}

// --- Main detection pipeline ---

export async function detectCropRegion(
  videoPath: string,
  start: number,
  duration: number,
  jobId: string,
  segIndex: number,
  ffmpegPath: string
): Promise<CropRegion> {
  logYolo.step(`Analizando segmento #${segIndex + 1}`, `${Math.round(duration)}s`);

  const { paths, times } = await extractFrames(
    videoPath, start, duration, `${jobId}_s${segIndex}`, ffmpegPath
  );

  if (paths.length === 0) {
    logYolo.warn("Sin frames extraidos, crop centrado");
    return { strategy: "center", keyframes: [] };
  }

  // Get video dimensions
  const firstMeta = await sharp(paths[0]!).metadata();
  const videoWidth = firstMeta.width || 1920;
  const videoHeight = firstMeta.height || 1080;
  const videoAspect = videoWidth / videoHeight;
  const cropWidthRatio = (9 / 16) / videoAspect;

  // Analyze all frames
  const frames: FrameAnalysis[] = [];
  let totalFaces = 0;
  let totalPersons = 0;

  for (let i = 0; i < paths.length; i++) {
    try {
      const detection = await detectInFrame(paths[i]!);
      const roi = computeROI(detection, cropWidthRatio);

      frames.push({
        time: times[i]!,
        faces: detection.faces,
        persons: detection.persons,
        roi,
      });

      totalFaces += detection.faces.length;
      totalPersons += detection.persons.length;

      if (i % 5 === 0 || i === paths.length - 1) {
        logYolo.debug(`Frame ${i + 1}/${paths.length}: ${detection.faces.length}F ${detection.persons.length}P`);
      }
    } catch (err) {
      frames.push({ time: times[i]!, faces: [], persons: [], roi: null });
      logYolo.warn(`Frame ${i + 1} fallido`, String(err));
    }
  }

  // Cleanup frames
  const framesDir = path.dirname(paths[0]!);
  await fs.rm(framesDir, { recursive: true, force: true }).catch(() => {});

  // Check if we have any detections at all
  const hasDetections = frames.some(f => f.roi !== null);
  if (!hasDetections) {
    logYolo.info("Sin detecciones — crop centrado");
    return { strategy: "center", keyframes: [] };
  }

  // Smooth positions and generate keyframes
  const positions = smoothPositions(frames, cropWidthRatio);
  const keyframes = positionsToKeyframes(positions, times, cropWidthRatio);
  const strategy = totalFaces > 0 ? "face" : "person";

  // Log summary
  const posRange = Math.max(...positions) - Math.min(...positions);
  const isDynamic = keyframes.length > 2;
  logYolo.info(
    `Segmento #${segIndex + 1}: ${strategy}`,
    `${totalFaces}F ${totalPersons}P · ${keyframes.length} keyframes · ${isDynamic ? "dinamico" : "estatico"} · rango=${(posRange * 100).toFixed(0)}%`
  );

  return { strategy, keyframes };
}

// --- Build ffmpeg crop filter ---

export function buildCropFilter(cropRegion: CropRegion): string {
  const { keyframes, strategy } = cropRegion;

  // No keyframes or center strategy — static centered crop
  if (strategy === "center" || keyframes.length === 0) {
    return "crop=ih*9/16:ih:(iw-ih*9/16)/2:0,scale=1080:1920,hflip";
  }

  // Single keyframe or all keyframes at same position — static positioned crop
  const allSame = keyframes.every(k => Math.abs(k.x - keyframes[0]!.x) < 0.01);
  if (keyframes.length === 1 || allSame) {
    const x = keyframes[0]!.x;
    const xExpr = `(iw-ih*9/16)*${x.toFixed(4)}`;
    return `crop=ih*9/16:ih:${xExpr}:0,scale=1080:1920,hflip`;
  }

  // Dynamic crop — use ffmpeg expressions with timeline interpolation
  // Build a piecewise linear interpolation using nested if() expressions
  // x(t) = lerp between keyframes based on current time (t)
  const xExpr = buildInterpolationExpr(keyframes);
  return `crop=ih*9/16:ih:${xExpr}:0,scale=1080:1920,hflip`;
}

function buildInterpolationExpr(keyframes: CropKeyframe[]): string {
  // ffmpeg filter expressions use 't' for current timestamp
  // Build: if(lt(t,t1), lerp(t0,t1,x0,x1), if(lt(t,t2), lerp(t1,t2,x1,x2), ...))
  //
  // For each segment between keyframes:
  //   lerp = x0 + (x1-x0) * (t-t0) / (t1-t0)
  //   in ffmpeg: (iw-ih*9/16) * (x0 + (x1-x0)*(t-t0)/(t1-t0))

  const range = "(iw-ih*9/16)";

  if (keyframes.length === 2) {
    const k0 = keyframes[0]!;
    const k1 = keyframes[1]!;
    const dt = k1.time - k0.time;
    if (dt < 0.01) {
      return `${range}*${k0.x.toFixed(4)}`;
    }
    // Simple linear interpolation
    const x0 = k0.x.toFixed(4);
    const dx = (k1.x - k0.x).toFixed(6);
    const t0 = k0.time.toFixed(3);
    const invDt = (1 / dt).toFixed(6);
    return `${range}*(${x0}+${dx}*(t-${t0})*${invDt})`;
  }

  // Multiple keyframes — build nested if() chain
  // Clamp to first/last keyframe values outside range
  let expr = `${range}*${keyframes[keyframes.length - 1]!.x.toFixed(4)}`; // default: last value

  for (let i = keyframes.length - 2; i >= 0; i--) {
    const k0 = keyframes[i]!;
    const k1 = keyframes[i + 1]!;
    const dt = k1.time - k0.time;

    if (dt < 0.01) continue;

    const x0 = k0.x.toFixed(4);
    const dx = (k1.x - k0.x).toFixed(6);
    const t0 = k0.time.toFixed(3);
    const t1 = k1.time.toFixed(3);
    const invDt = (1 / dt).toFixed(6);

    const lerp = `${range}*(${x0}+${dx}*(t-${t0})*${invDt})`;
    expr = `if(lt(t\\,${t1})\\,${lerp}\\,${expr})`;
  }

  return expr;
}
