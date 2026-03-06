import { spawn } from "child_process";
import path from "path";
import fs from "fs/promises";
import sharp from "sharp";
import * as ort from "onnxruntime-node";

const TMP_DIR = path.join(process.cwd(), "tmp");
const MODELS_DIR = path.join(process.cwd(), "models");

// Model sessions (lazy-loaded)
let faceSession: ort.InferenceSession | null = null;
let personSession: ort.InferenceSession | null = null;

const MODEL_INPUT_SIZE = 640; // YOLOv8 default input

interface BoundingBox {
  x1: number; y1: number; // top-left (ratio 0-1)
  x2: number; y2: number; // bottom-right (ratio 0-1)
  confidence: number;
  label: "face" | "person";
}

export interface CropRegion {
  x: number; // crop X ratio (0-1) from left, or -1 for center
  strategy: "face" | "person" | "saliency" | "center" | "letterbox";
}

// ==========================================
// ONNX MODEL LOADING
// ==========================================

async function loadFaceModel(): Promise<ort.InferenceSession> {
  if (faceSession) return faceSession;
  const modelPath = path.join(MODELS_DIR, "yolov8n-face.onnx");
  console.log("[SmartCrop] Loading YOLOv8n-face model...");
  faceSession = await ort.InferenceSession.create(modelPath, {
    executionProviders: ["cpu"],
  });
  console.log("[SmartCrop] Face model loaded.");
  return faceSession;
}

async function loadPersonModel(): Promise<ort.InferenceSession> {
  if (personSession) return personSession;
  const modelPath = path.join(MODELS_DIR, "yolov8n-person.onnx");
  console.log("[SmartCrop] Loading YOLOv8n-person model...");
  personSession = await ort.InferenceSession.create(modelPath, {
    executionProviders: ["cpu"],
  });
  console.log("[SmartCrop] Person model loaded.");
  return personSession;
}

// ==========================================
// IMAGE PREPROCESSING FOR YOLO
// ==========================================

async function prepareInput(framePath: string): Promise<{
  tensor: ort.Tensor;
  origWidth: number;
  origHeight: number;
}> {
  const image = sharp(framePath);
  const metadata = await image.metadata();
  const origWidth = metadata.width || 640;
  const origHeight = metadata.height || 360;

  // Resize to 640x640 with letterboxing (maintain aspect ratio)
  const resized = await image
    .resize(MODEL_INPUT_SIZE, MODEL_INPUT_SIZE, {
      fit: "contain",
      background: { r: 114, g: 114, b: 114 },
    })
    .removeAlpha()
    .raw()
    .toBuffer();

  // Convert HWC RGB to CHW float32 normalized [0,1]
  const float32 = new Float32Array(3 * MODEL_INPUT_SIZE * MODEL_INPUT_SIZE);
  const pixelCount = MODEL_INPUT_SIZE * MODEL_INPUT_SIZE;

  for (let i = 0; i < pixelCount; i++) {
    float32[i] = resized[i * 3]! / 255.0;                    // R channel
    float32[pixelCount + i] = resized[i * 3 + 1]! / 255.0;   // G channel
    float32[2 * pixelCount + i] = resized[i * 3 + 2]! / 255.0; // B channel
  }

  const tensor = new ort.Tensor("float32", float32, [1, 3, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE]);
  return { tensor, origWidth, origHeight };
}

// ==========================================
// YOLO POST-PROCESSING
// ==========================================

function parseYoloOutput(
  output: ort.Tensor,
  origWidth: number,
  origHeight: number,
  label: "face" | "person",
  confThreshold: number = 0.35
): BoundingBox[] {
  const data = output.data as Float32Array;
  const [, numFeatures, numBoxes] = output.dims; // [1, features, boxes]

  // Calculate letterbox padding
  const scale = Math.min(MODEL_INPUT_SIZE / origWidth, MODEL_INPUT_SIZE / origHeight);
  const padX = (MODEL_INPUT_SIZE - origWidth * scale) / 2;
  const padY = (MODEL_INPUT_SIZE - origHeight * scale) / 2;

  const boxes: BoundingBox[] = [];

  for (let i = 0; i < numBoxes!; i++) {
    // YOLOv8 output format: [cx, cy, w, h, conf, ...]
    const cx = data[0 * numBoxes! + i]!;
    const cy = data[1 * numBoxes! + i]!;
    const w = data[2 * numBoxes! + i]!;
    const h = data[3 * numBoxes! + i]!;

    // For face/person models, confidence is at index 4
    let conf = 0;
    if (numFeatures! > 4) {
      // Could have multiple classes — take max
      for (let c = 4; c < numFeatures!; c++) {
        const score = data[c * numBoxes! + i]!;
        if (score > conf) conf = score;
      }
    }

    if (conf < confThreshold) continue;

    // Convert from letterboxed coords to original image ratios (0-1)
    const x1Abs = (cx - w / 2 - padX) / scale;
    const y1Abs = (cy - h / 2 - padY) / scale;
    const x2Abs = (cx + w / 2 - padX) / scale;
    const y2Abs = (cy + h / 2 - padY) / scale;

    boxes.push({
      x1: Math.max(0, x1Abs / origWidth),
      y1: Math.max(0, y1Abs / origHeight),
      x2: Math.min(1, x2Abs / origWidth),
      y2: Math.min(1, y2Abs / origHeight),
      confidence: conf,
      label,
    });
  }

  // NMS (simple greedy)
  boxes.sort((a, b) => b.confidence - a.confidence);
  const kept: BoundingBox[] = [];
  for (const box of boxes) {
    let dominated = false;
    for (const k of kept) {
      if (iou(box, k) > 0.5) { dominated = true; break; }
    }
    if (!dominated) kept.push(box);
  }

  return kept;
}

function iou(a: BoundingBox, b: BoundingBox): number {
  const x1 = Math.max(a.x1, b.x1);
  const y1 = Math.max(a.y1, b.y1);
  const x2 = Math.min(a.x2, b.x2);
  const y2 = Math.min(a.y2, b.y2);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const areaA = (a.x2 - a.x1) * (a.y2 - a.y1);
  const areaB = (b.x2 - b.x1) * (b.y2 - b.y1);
  return inter / (areaA + areaB - inter + 1e-6);
}

// ==========================================
// FRAME EXTRACTION
// ==========================================

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

// ==========================================
// DETECT FACES/PERSONS IN A FRAME
// ==========================================

async function detectInFrame(framePath: string): Promise<BoundingBox[]> {
  const { tensor, origWidth, origHeight } = await prepareInput(framePath);

  // Try face detection first
  try {
    const faceModel = await loadFaceModel();
    const inputName = faceModel.inputNames[0]!;
    const results = await faceModel.run({ [inputName]: tensor });
    const outputName = faceModel.outputNames[0]!;
    const faces = parseYoloOutput(results[outputName]!, origWidth, origHeight, "face", 0.4);
    if (faces.length > 0) return faces;
  } catch (err) {
    console.error("[SmartCrop] Face detection error:", err);
  }

  // Fallback to person detection
  try {
    const personModel = await loadPersonModel();
    const inputName = personModel.inputNames[0]!;
    const results = await personModel.run({ [inputName]: tensor });
    const outputName = personModel.outputNames[0]!;
    return parseYoloOutput(results[outputName]!, origWidth, origHeight, "person", 0.35);
  } catch (err) {
    console.error("[SmartCrop] Person detection error:", err);
    return [];
  }
}

// ==========================================
// CROP STRATEGY DECISION
// ==========================================

interface FrameDetections {
  boxes: BoundingBox[];
  frameIndex: number;
}

function decideCropStrategy(
  allDetections: FrameDetections[],
  videoAspect: number // width/height
): CropRegion {
  // Collect all boxes across frames
  const allBoxes = allDetections.flatMap(d => d.boxes);

  if (allBoxes.length === 0) {
    console.log("[SmartCrop] No faces/persons detected, using center crop");
    return { x: -1, strategy: "center" };
  }

  // Calculate the median horizontal center of all detections
  const centers: number[] = allBoxes.map(b => (b.x1 + b.x2) / 2);
  centers.sort((a, b) => a - b);
  const medianCenter = centers[Math.floor(centers.length / 2)]!;

  // Check spread: are subjects too spread out for a 9:16 crop?
  const cropWidthRatio = (9 / 16) / videoAspect; // how much of the width we keep
  const minX = Math.min(...allBoxes.map(b => b.x1));
  const maxX = Math.max(...allBoxes.map(b => b.x2));
  const subjectSpread = maxX - minX;

  if (subjectSpread > cropWidthRatio * 1.5) {
    // Subjects are too spread — letterbox would be better
    // But for now, track the most confident/frequent subject
    console.log("[SmartCrop] Wide subject spread, tracking primary subject");
  }

  // Calculate crop X so that the median subject center is in the middle of the crop
  // cropX is the left edge of the crop window as a ratio of video width
  let cropX = medianCenter - cropWidthRatio / 2;
  cropX = Math.max(0, Math.min(cropX, 1 - cropWidthRatio));

  // Determine strategy label
  const hasFaces = allBoxes.some(b => b.label === "face");
  const strategy = hasFaces ? "face" : "person";

  console.log(`[SmartCrop] Strategy: ${strategy}, crop center at ${(medianCenter * 100).toFixed(0)}% from left, ${allBoxes.length} detections across ${allDetections.length} frames`);

  // Convert cropX (left edge of crop as ratio of width) to the format buildCropFilter expects
  // buildCropFilter expects: ratio representing how far the crop window is from left
  // xExpr = (iw - cropW) * ratio
  // cropX = ratio * (1 - cropWidthRatio) → ratio = cropX / (1 - cropWidthRatio)
  const filterRatio = (1 - cropWidthRatio) > 0 ? cropX / (1 - cropWidthRatio) : 0;

  return { x: Math.max(0, Math.min(1, filterRatio)), strategy };
}

// ==========================================
// MAIN: DETECT CROP REGION WITH YOLO
// ==========================================

export async function detectCropRegion(
  videoPath: string,
  start: number,
  duration: number,
  jobId: string,
  segIndex: number,
  ffmpegPath: string
): Promise<CropRegion> {
  console.log(`[SmartCrop] YOLO analyzing segment #${segIndex + 1}...`);

  // Extract frames at full resolution for better detection
  const frames = await extractFrames(videoPath, start, duration, `${jobId}_s${segIndex}`, ffmpegPath, 6);

  if (frames.length === 0) {
    console.log("[SmartCrop] No frames extracted, center crop");
    return { x: -1, strategy: "center" };
  }

  // Get video dimensions from first frame
  const firstMeta = await sharp(frames[0]!).metadata();
  const videoWidth = firstMeta.width || 1920;
  const videoHeight = firstMeta.height || 1080;
  const videoAspect = videoWidth / videoHeight;

  // Run YOLO detection on each frame
  const allDetections: FrameDetections[] = [];
  for (let i = 0; i < frames.length; i++) {
    try {
      const boxes = await detectInFrame(frames[i]!);
      allDetections.push({ boxes, frameIndex: i });
      if (boxes.length > 0) {
        console.log(`[SmartCrop] Frame ${i + 1}: ${boxes.length} ${boxes[0]!.label}(s) detected`);
      }
    } catch (err) {
      console.error(`[SmartCrop] Frame ${i + 1} detection failed:`, err);
    }
  }

  // Clean up frames
  const framesDir = path.dirname(frames[0]!);
  await fs.rm(framesDir, { recursive: true, force: true }).catch(() => {});

  return decideCropStrategy(allDetections, videoAspect);
}

// ==========================================
// FFMPEG FILTER (always mirrors horizontally)
// ==========================================

export function buildCropFilter(cropRegion: CropRegion): string {
  if (cropRegion.x < 0 || cropRegion.strategy === "center") {
    return "crop=ih*9/16:ih:(iw-ih*9/16)/2:0,scale=1080:1920,hflip";
  }

  const xExpr = `(iw-ih*9/16)*${cropRegion.x.toFixed(4)}`;
  return `crop=ih*9/16:ih:${xExpr}:0,scale=1080:1920,hflip`;
}
