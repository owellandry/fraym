// Simple in-memory job queue with concurrency control
// For production: swap with BullMQ + Redis

export type JobStatus = "queued" | "downloading" | "analyzing" | "processing" | "done" | "error";

export interface Job {
  id: string;
  url: string;
  status: JobStatus;
  progress: number;
  message: string;
  clipCount: number;
  minDuration: number;
  maxDuration: number;
  segments: any[];
  outputs: string[];
  error?: string;
  videoPath?: string;
  createdAt: number;
  updatedAt: number;
}

type JobListener = (job: Job) => void;

const MAX_CONCURRENT = 2;
const JOBS = new Map<string, Job>();
const LISTENERS = new Map<string, Set<JobListener>>();
let activeJobs = 0;
const pendingQueue: string[] = [];

// Worker function — set externally to avoid circular imports
let workerFn: ((job: Job) => Promise<void>) | null = null;

export function setWorker(fn: (job: Job) => Promise<void>) {
  workerFn = fn;
}

export function createJob(params: {
  id: string;
  url: string;
  clipCount: number;
  minDuration: number;
  maxDuration: number;
}): Job {
  const job: Job = {
    id: params.id,
    url: params.url,
    status: "queued",
    progress: 0,
    message: "En cola...",
    clipCount: params.clipCount,
    minDuration: params.minDuration,
    maxDuration: params.maxDuration,
    segments: [],
    outputs: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  JOBS.set(job.id, job);
  pendingQueue.push(job.id);
  processQueue();
  return job;
}

export function getJob(id: string): Job | undefined {
  return JOBS.get(id);
}

export function updateJob(id: string, updates: Partial<Job>) {
  const job = JOBS.get(id);
  if (!job) return;

  Object.assign(job, updates, { updatedAt: Date.now() });

  // Notify all listeners
  const listeners = LISTENERS.get(id);
  if (listeners) {
    for (const fn of listeners) {
      try { fn(job); } catch {}
    }
  }
}

export function subscribe(id: string, listener: JobListener): () => void {
  if (!LISTENERS.has(id)) LISTENERS.set(id, new Set());
  LISTENERS.get(id)!.add(listener);

  // Send current state immediately
  const job = JOBS.get(id);
  if (job) listener(job);

  return () => {
    LISTENERS.get(id)?.delete(listener);
    if (LISTENERS.get(id)?.size === 0) LISTENERS.delete(id);
  };
}

async function processQueue() {
  while (pendingQueue.length > 0 && activeJobs < MAX_CONCURRENT) {
    const jobId = pendingQueue.shift();
    if (!jobId) break;

    const job = JOBS.get(jobId);
    if (!job || !workerFn) continue;

    activeJobs++;

    // Run in background — don't await
    workerFn(job)
      .catch((err) => {
        console.error(`[job:${jobId}] ✗ ERROR:`, err.message || err);
        if (err.stack) console.error(err.stack);
        updateJob(jobId, {
          status: "error",
          error: err.message || "Unknown error",
          message: "Error",
        });
      })
      .finally(() => {
        activeJobs--;
        processQueue(); // Process next in queue
      });
  }
}

// Cleanup old jobs (>1 hour)
setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [id, job] of JOBS) {
    if (job.updatedAt < cutoff) {
      JOBS.delete(id);
      LISTENERS.delete(id);
    }
  }
}, 5 * 60 * 1000);
