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

export interface CropKeyframe {
  time: number;   // seconds relative to segment start
  x: number;      // crop X position as ratio [0-1] of available range
}

export interface CropRegion {
  strategy: "face" | "person" | "center";
  keyframes: CropKeyframe[];  // dynamic crop positions over time
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
