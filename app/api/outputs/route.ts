import path from "path";
import * as fs from "fs";

const OUTPUTS_DIR = path.join(process.cwd(), "public", "outputs");

// GET /api/outputs?file=xxx.mp4 — Serve generated clips (supports Range requests for seeking)
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const file = searchParams.get("file");

  if (!file || file.includes("..") || file.includes("/") || file.includes("\\")) {
    return new Response("Bad request", { status: 400 });
  }

  const filePath = path.join(OUTPUTS_DIR, file);

  if (!fs.existsSync(filePath)) {
    return new Response("Not found", { status: 404 });
  }

  const stat = fs.statSync(filePath);
  const total = stat.size;
  const range = request.headers.get("range");

  if (range) {
    const match = range.match(/bytes=(\d+)-(\d*)/);
    if (!match) {
      return new Response("Bad range", { status: 416, headers: { "Content-Range": `bytes */${total}` } });
    }

    const start = parseInt(match[1]!, 10);
    const end = match[2] ? parseInt(match[2], 10) : total - 1;

    if (start >= total || end >= total) {
      return new Response("Range not satisfiable", {
        status: 416,
        headers: { "Content-Range": `bytes */${total}` },
      });
    }

    const chunkSize = end - start + 1;
    const stream = fs.createReadStream(filePath, { start, end });
    const readable = toReadableStream(stream);

    return new Response(readable, {
      status: 206,
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": chunkSize.toString(),
        "Content-Range": `bytes ${start}-${end}/${total}`,
        "Accept-Ranges": "bytes",
        "Cache-Control": "public, max-age=3600",
      },
    });
  }

  // No range — serve full file
  const stream = fs.createReadStream(filePath);
  const readable = toReadableStream(stream);

  return new Response(readable, {
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": total.toString(),
      "Accept-Ranges": "bytes",
      "Cache-Control": "public, max-age=3600",
    },
  });
}

function toReadableStream(stream: fs.ReadStream): ReadableStream {
  return new ReadableStream({
    start(controller) {
      let closed = false;
      stream.on("data", (chunk) => {
        if (!closed) {
          try { controller.enqueue(chunk); } catch { closed = true; }
        }
      });
      stream.on("end", () => {
        if (!closed) { closed = true; try { controller.close(); } catch {} }
      });
      stream.on("error", (err) => {
        if (!closed) { closed = true; try { controller.error(err); } catch {} }
      });
    },
    cancel() {
      stream.destroy();
    },
  });
}
