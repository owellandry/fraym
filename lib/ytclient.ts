// YouTube InnerTube client — uses the same API as official YouTube apps
import { Innertube } from "youtubei.js";
import path from "path";
import fs from "fs/promises";
import { loadCredentials, saveCredentials } from "./ytauth";

let _yt: Innertube | null = null;

export async function getYT(): Promise<Innertube> {
  if (_yt) return _yt;

  await fs.mkdir(path.join(process.cwd(), "tmp"), { recursive: true });

  const yt = await Innertube.create();

  // Load stored OAuth credentials if available
  const credentials = await loadCredentials();
  if (credentials) {
    yt.session.on("update-credentials", async ({ credentials: newCreds }: any) => {
      await saveCredentials(newCreds);
      console.log("[ShortsAI] YouTube credentials refreshed");
    });
    await yt.session.oauth.init(credentials as any);
    console.log("[ShortsAI] YouTube: authenticated with OAuth2");
  } else {
    console.log("[ShortsAI] YouTube: anonymous session (run 'bun run setup:yt' to authenticate if downloads fail)");
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
