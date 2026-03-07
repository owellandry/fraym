import { subscribe, getJob } from "@/lib/queue";

// GET /api/jobs/status?id=xxx — Server-Sent Events for real-time updates
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

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      function send(data: any) {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          // Stream closed
        }
      }

      const unsubscribe = subscribe(id!, (updatedJob) => {
        send({
          status: updatedJob.status,
          progress: updatedJob.progress,
          message: updatedJob.message,
          segments: updatedJob.segments,
          outputs: updatedJob.outputs,
          script: updatedJob.script,
          error: updatedJob.error,
        });

        // Close stream when job is done or errored
        if (updatedJob.status === "done" || updatedJob.status === "error") {
          setTimeout(() => {
            try {
              unsubscribe();
              controller.close();
            } catch {}
          }, 500);
        }
      });

      // Cleanup on client disconnect
      request.signal.addEventListener("abort", () => {
        unsubscribe();
        try { controller.close(); } catch {}
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}
