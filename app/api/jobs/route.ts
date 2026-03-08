import crypto from "node:crypto";
import { createJob, getJob } from "@/lib/queue";
import { logAPI, printBanner } from "@/lib/logger";

// Register workers lazily (dynamic import avoids pulling Node.js builtins into RSC bundle)
let workersLoaded = false;
async function ensureWorkers() {
  if (workersLoaded) return;
  workersLoaded = true;
  await Promise.all([import("@/lib/worker"), import("@/lib/ai-worker")]);
  printBanner();
}

// POST /api/jobs — Create a new job (returns immediately)
export async function POST(request: Request) {
  await ensureWorkers();
  try {
    const body = await request.json();
    const id = crypto.randomUUID().slice(0, 8);

    // AI Video generation
    if (body.type === "ai-video") {
      const { topic, voice, background, style } = body;

      if (!topic || typeof topic !== "string") {
        return Response.json({ error: "Topic is required" }, { status: 400 });
      }

      const job = createJob({
        id,
        type: "ai-video",
        url: "",
        clipCount: 1,
        minDuration: 0,
        maxDuration: 0,
        aiOptions: {
          topic,
          voice: voice || "es-mx-m",
          background: background || "abstract",
          style: style || "facts",
        },
      });

      logAPI.info(`AI Video job ${id} creado`, topic.slice(0, 50));

      return Response.json({
        id: job.id,
        status: job.status,
        message: job.message,
      });
    }

    // YouTube clip extraction (existing flow)
    const { url, clipCount, minDuration, maxDuration } = body;

    if (!url || typeof url !== "string") {
      return Response.json({ error: "URL is required" }, { status: 400 });
    }

    const job = createJob({
      id,
      url,
      clipCount: clipCount || 4,
      minDuration: minDuration || 15,
      maxDuration: maxDuration || 60,
    });

    logAPI.info(`Job ${id} creado`, url);

    return Response.json({
      id: job.id,
      status: job.status,
      message: job.message,
    });
  } catch (err: any) {
    return Response.json({ error: err.message || "Failed to create job" }, { status: 500 });
  }
}

// GET /api/jobs?id=xxx — Get job status
export async function GET(request: Request) {
  await ensureWorkers();
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return Response.json({ error: "Job ID is required" }, { status: 400 });
  }

  const job = getJob(id);
  if (!job) {
    return Response.json({ error: "Job not found" }, { status: 404 });
  }

  return Response.json({
    id: job.id,
    type: job.type,
    status: job.status,
    progress: job.progress,
    message: job.message,
    segments: job.segments,
    outputs: job.outputs,
    script: job.script,
    error: job.error,
  });
}
