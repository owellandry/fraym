// YouTube InnerTube client — uses the same API as official YouTube apps
import { Innertube } from "youtubei.js";
import path from "path";
import fs from "fs/promises";

const CACHE_DIR = path.join(process.cwd(), "tmp", ".ytcache");
let _yt: Innertube | null = null;

export async function getYT(): Promise<Innertube> {
  if (_yt) return _yt;
  await fs.mkdir(CACHE_DIR, { recursive: true });
  _yt = await Innertube.create();
  return _yt;
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
  throw new Error(`URL de YouTube inválida: ${url}`);
}
