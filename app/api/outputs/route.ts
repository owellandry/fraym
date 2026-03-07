import path from "path";
import * as fs from "fs";

const OUTPUTS_DIR = path.join(process.cwd(), "public", "outputs");

// GET /api/outputs?file=xxx.mp4 — Serve generated clips
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
  const stream = fs.createReadStream(filePath);
  const readable = new ReadableStream({
    start(controller) {
      stream.on("data", (chunk) => controller.enqueue(chunk));
      stream.on("end", () => controller.close());
      stream.on("error", (err) => controller.error(err));
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": stat.size.toString(),
      "Cache-Control": "public, max-age=3600",
    },
  });
}
