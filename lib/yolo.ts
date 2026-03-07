import path from "path";
import sharp from "sharp";
import * as ort from "onnxruntime-node";

const MODELS_DIR = path.join(process.cwd(), "models");
const MODEL_INPUT_SIZE = 640;

let faceSession: ort.InferenceSession | null = null;
let personSession: ort.InferenceSession | null = null;

interface BoundingBox {
  x1: number; y1: number;
  x2: number; y2: number;
  confidence: number;
  label: "face" | "person";
}

export type { BoundingBox };

async function loadFaceModel(): Promise<ort.InferenceSession> {
  if (faceSession) return faceSession;
  const modelPath = path.join(MODELS_DIR, "yolov8n-face.onnx");
  console.log("[fraym] Loading YOLOv8n-face model...");
  faceSession = await ort.InferenceSession.create(modelPath, {
    executionProviders: ["cpu"],
  });
  console.log("[fraym] Face model loaded.");
  return faceSession;
}

async function loadPersonModel(): Promise<ort.InferenceSession> {
  if (personSession) return personSession;
  const modelPath = path.join(MODELS_DIR, "yolov8n-person.onnx");
  console.log("[fraym] Loading YOLOv8n-person model...");
  personSession = await ort.InferenceSession.create(modelPath, {
    executionProviders: ["cpu"],
  });
  console.log("[fraym] Person model loaded.");
  return personSession;
}

async function prepareInput(framePath: string): Promise<{
  tensor: ort.Tensor;
  origWidth: number;
  origHeight: number;
}> {
  const image = sharp(framePath);
  const metadata = await image.metadata();
  const origWidth = metadata.width || 640;
  const origHeight = metadata.height || 360;

  const resized = await image
    .resize(MODEL_INPUT_SIZE, MODEL_INPUT_SIZE, {
      fit: "contain",
      background: { r: 114, g: 114, b: 114 },
    })
    .removeAlpha()
    .raw()
    .toBuffer();

  const float32 = new Float32Array(3 * MODEL_INPUT_SIZE * MODEL_INPUT_SIZE);
  const pixelCount = MODEL_INPUT_SIZE * MODEL_INPUT_SIZE;

  for (let i = 0; i < pixelCount; i++) {
    float32[i] = resized[i * 3]! / 255.0;
    float32[pixelCount + i] = resized[i * 3 + 1]! / 255.0;
    float32[2 * pixelCount + i] = resized[i * 3 + 2]! / 255.0;
  }

  const tensor = new ort.Tensor("float32", float32, [1, 3, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE]);
  return { tensor, origWidth, origHeight };
}

function parseYoloOutput(
  output: ort.Tensor,
  origWidth: number,
  origHeight: number,
  label: "face" | "person",
  confThreshold: number = 0.35
): BoundingBox[] {
  const data = output.data as Float32Array;
  const [, numFeatures, numBoxes] = output.dims;

  const scale = Math.min(MODEL_INPUT_SIZE / origWidth, MODEL_INPUT_SIZE / origHeight);
  const padX = (MODEL_INPUT_SIZE - origWidth * scale) / 2;
  const padY = (MODEL_INPUT_SIZE - origHeight * scale) / 2;

  const boxes: BoundingBox[] = [];

  for (let i = 0; i < numBoxes!; i++) {
    const cx = data[0 * numBoxes! + i]!;
    const cy = data[1 * numBoxes! + i]!;
    const w = data[2 * numBoxes! + i]!;
    const h = data[3 * numBoxes! + i]!;

    let conf = 0;
    if (numFeatures! > 4) {
      for (let c = 4; c < numFeatures!; c++) {
        const score = data[c * numBoxes! + i]!;
        if (score > conf) conf = score;
      }
    }

    if (conf < confThreshold) continue;

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

  // NMS (greedy)
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

export async function detectInFrame(framePath: string): Promise<BoundingBox[]> {
  const { tensor, origWidth, origHeight } = await prepareInput(framePath);

  try {
    const faceModel = await loadFaceModel();
    const inputName = faceModel.inputNames[0]!;
    const results = await faceModel.run({ [inputName]: tensor });
    const outputName = faceModel.outputNames[0]!;
    const faces = parseYoloOutput(results[outputName]!, origWidth, origHeight, "face", 0.4);
    if (faces.length > 0) return faces;
  } catch (err) {
    console.error("[fraym] Face detection error:", err);
  }

  try {
    const personModel = await loadPersonModel();
    const inputName = personModel.inputNames[0]!;
    const results = await personModel.run({ [inputName]: tensor });
    const outputName = personModel.outputNames[0]!;
    return parseYoloOutput(results[outputName]!, origWidth, origHeight, "person", 0.35);
  } catch (err) {
    console.error("[fraym] Person detection error:", err);
    return [];
  }
}
