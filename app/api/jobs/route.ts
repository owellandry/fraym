import crypto from "crypto";
import { createJob, getJob } from "@/lib/queue";
import { logAPI, printBanner } from "@/lib/logger";
// Import worker to register it
import "@/lib/worker";

// Print startup banner on first load
printBanner();

// POST /api/jobs — Create a new job (returns immediately)
export async function POST(request: Request) {
  try {
    const { url, clipCount, minDuration, maxDuration } = await request.json();

    if (!url || typeof url !== "string") {
      return Response.json({ error: "URL is required" }, { status: 400 });
    }

    const id = crypto.randomUUID().slice(0, 8);

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
    status: job.status,
    progress: job.progress,
    message: job.message,
    segments: job.segments,
    outputs: job.outputs,
    error: job.error,
  });
}
