// Worker for AI-generated video jobs

import { generateAIVideo } from "./ai-video";
import { updateJob, setAIVideoWorker } from "./queue";
import { createJobLogger } from "./logger";
import type { Job } from "./queue";

async function processAIVideoJob(job: Job): Promise<void> {
  const { id } = job;
  const jlog = createJobLogger(id);

  if (!job.aiOptions) {
    throw new Error("Missing AI video options");
  }

  jlog.info("Iniciando generacion de video IA", job.aiOptions.topic);

  updateJob(id, { status: "processing", progress: 5, message: "Iniciando..." });

  const { output, script } = await generateAIVideo(
    {
      topic: job.aiOptions.topic,
      voice: job.aiOptions.voice,
      background: job.aiOptions.background,
      style: job.aiOptions.style as any,
    },
    id,
    (progress, message) => {
      updateJob(id, { progress, message });
    }
  );

  updateJob(id, {
    status: "done",
    progress: 100,
    outputs: [output],
    script,
    message: "Video generado",
  });

  jlog.done("Video IA completado");
}

setAIVideoWorker(processAIVideoJob);
export const aiWorkerReady = true;
