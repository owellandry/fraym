export interface Segment {
  start: number;
  end: number;
  title: string;
  reason: string;
  score: number;
}

export interface TranscriptChunk {
  text: string;
  start: number;
  end: number;
}

export interface CropRegion {
  x: number;
  strategy: "face" | "person" | "saliency" | "center" | "letterbox";
}

export interface DetectOptions {
  targetClips?: number;
  minDuration?: number;
  maxDuration?: number;
}

export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
