// YouTube InnerTube client — uses the same API as official YouTube apps
import { Innertube, UniversalCache } from "youtubei.js";
import path from "path";
import fs from "fs/promises";

const CACHE_DIR = path.join(process.cwd(), "tmp", ".ytcache");
let _yt: Innertube | null = null;

export async function getYT(): Promise<Innertube> {
  if (_yt) return _yt;

  await fs.mkdir(CACHE_DIR, { recursive: true });

  const yt = await Innertube.create({
    cache: new UniversalCache(true, CACHE_DIR),
  });

  // Try loading OAuth from cache (saved by setup:yt script)
  try {
    yt.session.on("update-credentials", () => {
      console.log("[ShortsAI] YouTube credentials auto-refreshed");
    });
    await yt.session.oauth.init();
    if (yt.session.logged_in) {
      console.log("[ShortsAI] YouTube: authenticated with OAuth2");
    } else {
      console.log("[ShortsAI] YouTube: anonymous session (run 'bun run setup:yt' if downloads fail)");
    }
  } catch {
    console.log("[ShortsAI] YouTube: anonymous session");
  }

  _yt = yt;
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
