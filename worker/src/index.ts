// Cloudflare Worker — YouTube video proxy for fraym
// Uses dlsrv.online API for HD video downloads (up to 4K)

interface Env {
  PROXY_SECRET: string;
}

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";
const DLSRV = "https://embed.dlsrv.online";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };

    if (request.method === "OPTIONS") return new Response(null, { headers: cors });

    if (request.headers.get("Authorization") !== `Bearer ${env.PROXY_SECRET}`) {
      return Response.json({ error: "Unauthorized" }, { status: 401, headers: cors });
    }

    try {
      if (url.pathname === "/info") {
        const v = url.searchParams.get("v");
        if (!v) return Response.json({ error: "Missing video ID" }, { status: 400, headers: cors });
        return Response.json(await getVideoInfo(v), { headers: cors });
      }

      if (url.pathname === "/download") {
        const v = url.searchParams.get("v");
        const q = url.searchParams.get("q") || "720";
        if (!v) return Response.json({ error: "Missing video ID" }, { status: 400, headers: cors });
        return Response.json(await getDownloadUrl(v, q), { headers: cors });
      }

      if (url.pathname === "/stream") {
        const su = url.searchParams.get("url");
        if (!su) return Response.json({ error: "Missing stream URL" }, { status: 400, headers: cors });
        return proxyStream(su, request, cors);
      }

      if (url.pathname === "/caption-file") {
        const cu = url.searchParams.get("url");
        if (!cu) return Response.json({ error: "Missing caption URL" }, { status: 400, headers: cors });
        const r = await fetch(cu, { headers: { "User-Agent": UA } });
        return new Response(await r.text(), { headers: { ...cors, "Content-Type": "text/vtt" } });
      }

      if (url.pathname === "/health") return Response.json({ ok: true }, { headers: cors });
      return Response.json({ error: "Not found" }, { status: 404, headers: cors });
    } catch (err: any) {
      return Response.json({ error: err.message || "Internal error" }, { status: 500, headers: cors });
    }
  },
};

// ===== VIDEO INFO =====

async function getVideoInfo(videoId: string) {
  const res = await fetch(`${DLSRV}/api/info`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Origin": DLSRV,
      "Referer": `${DLSRV}/v1/full?videoId=${videoId}`,
      "User-Agent": UA,
    },
    body: JSON.stringify({ videoId }),
  });

  if (!res.ok) throw new Error(`Info API error: ${res.status}`);

  const data: any = await res.json();
  if (data.status !== "info" || !data.info) {
    throw new Error(data.message || "Failed to get video info");
  }

  const info = data.info;
  const videoFormats = (info.formats || []).filter((f: any) => f.type === "video");
  const audioFormats = (info.formats || []).filter((f: any) => f.type === "audio");

  // Find best video quality up to 1080p
  const qualities = ["1080p", "720p", "480p", "360p"];
  let bestQuality = "720p";
  for (const q of qualities) {
    if (videoFormats.find((f: any) => f.quality === q)) {
      bestQuality = q;
      break;
    }
  }

  // Get captions from YouTube page
  let captions: any[] = [];
  try { captions = await getCaptions(videoId); } catch {}

  return {
    status: "OK",
    title: info.title,
    author: info.author,
    duration: info.duration,
    thumbnail: info.thumbnail,
    bestQuality,
    formats: videoFormats.map((f: any) => ({
      quality: f.quality,
      format: f.format,
      fileSize: f.fileSize,
    })),
    captions,
  };
}

// ===== DOWNLOAD URL =====

async function getDownloadUrl(videoId: string, quality: string) {
  const res = await fetch(`${DLSRV}/api/download/mp4`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Origin": DLSRV,
      "Referer": `${DLSRV}/v1/full?videoId=${videoId}`,
      "User-Agent": UA,
    },
    body: JSON.stringify({ videoId, format: "mp4", quality }),
  });

  if (!res.ok) throw new Error(`Download API error: ${res.status}`);

  const data: any = await res.json();
  if (data.status !== "tunnel" || !data.url) {
    throw new Error(data.message || "Failed to get download URL");
  }

  return {
    status: "OK",
    url: data.url,
    filename: data.filename,
    duration: data.duration,
  };
}

// ===== CAPTIONS =====

async function getCaptions(videoId: string): Promise<any[]> {
  const res = await fetch(
    `https://www.youtube.com/watch?v=${videoId}&has_verified=1`,
    {
      headers: {
        "User-Agent": UA,
        "Accept-Language": "en-US,en;q=0.5",
        "Cookie": "CONSENT=PENDING+987",
      },
    }
  );
  if (!res.ok) return [];

  const html = await res.text();
  const marker = "var ytInitialPlayerResponse = ";
  const idx = html.indexOf(marker);
  if (idx === -1) return [];

  const start = idx + marker.length;
  if (html[start] !== "{") return [];

  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (esc) { esc = false; continue; }
    if (c === "\\") { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        try {
          const data = JSON.parse(html.slice(start, i + 1));
          return data.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
        } catch { return []; }
      }
    }
  }
  return [];
}

// ===== STREAM PROXY =====

async function proxyStream(
  streamUrl: string,
  request: Request,
  cors: Record<string, string>
): Promise<Response> {
  const h: Record<string, string> = { "User-Agent": UA };
  const range = request.headers.get("Range");
  if (range) h["Range"] = range;

  const res = await fetch(streamUrl, { headers: h });

  const rh: Record<string, string> = {
    ...cors,
    "Content-Type": res.headers.get("Content-Type") || "video/mp4",
  };
  for (const k of ["Content-Length", "Content-Range", "Accept-Ranges"]) {
    const v = res.headers.get(k);
    if (v) rh[k] = v;
  }

  return new Response(res.body, { status: res.status, headers: rh });
}
