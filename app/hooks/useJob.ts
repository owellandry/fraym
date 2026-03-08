"use client";

import { useState, useEffect, useRef, useCallback } from "react";

export type JobStatus = "idle" | "downloading" | "analyzing" | "processing" | "done" | "error";
export type JobMode = "clip" | "ai-video";

export interface Segment {
  start: number;
  end: number;
  title: string;
  reason: string;
}

export interface JobState {
  status: JobStatus;
  progress: number;
  message?: string;
  segments: Segment[];
  outputs: string[];
  script?: string;
  error?: string;
}

export const PIPELINE_STEPS: { key: JobStatus; label: string }[] = [
  { key: "downloading", label: "Video descargado" },
  { key: "analyzing", label: "momentos detectados" },
  { key: "processing", label: "Procesando clips" },
  { key: "done", label: "Listo" },
];

export const CLIP_COUNTS = [2, 3, 4, 5, 8, 10] as const;
export const DURATION_OPTIONS = [
  { label: "15-30s", min: 15, max: 30 },
  { label: "30-60s", min: 30, max: 60 },
  { label: "45-60s", min: 45, max: 60 },
  { label: "60s+", min: 60, max: 0 },
] as const;

export const VOICE_OPTIONS = [
  { key: "es-mx-m", label: "Jorge (Mexico)", flag: "🇲🇽" },
  { key: "es-mx-f", label: "Dalia (Mexico)", flag: "🇲🇽" },
  { key: "es-co-m", label: "Gonzalo (Colombia)", flag: "🇨🇴" },
  { key: "es-co-f", label: "Salome (Colombia)", flag: "🇨🇴" },
  { key: "es-ar-m", label: "Tomas (Argentina)", flag: "🇦🇷" },
  { key: "es-ar-f", label: "Elena (Argentina)", flag: "🇦🇷" },
  { key: "es-es-m", label: "Alvaro (España)", flag: "🇪🇸" },
  { key: "en-us-m", label: "Guy (English)", flag: "🇺🇸" },
  { key: "en-us-f", label: "Jenny (English)", flag: "🇺🇸" },
] as const;

export const BG_CATEGORIES = [
  { key: "parkour", label: "Parkour" },
  { key: "satisfying", label: "Satisfying" },
  { key: "nature", label: "Naturaleza" },
  { key: "city", label: "Ciudad" },
  { key: "abstract", label: "Abstracto" },
  { key: "food", label: "Cocina" },
  { key: "space", label: "Espacio" },
] as const;

export const STYLE_OPTIONS = [
  { key: "facts", label: "Datos curiosos" },
  { key: "story", label: "Historia" },
  { key: "motivation", label: "Motivacion" },
  { key: "news", label: "Noticia" },
] as const;

const INITIAL_STATE: JobState = {
  status: "idle",
  progress: 0,
  segments: [],
  outputs: [],
};

export function useJob() {
  const [mode, setMode] = useState<JobMode>("clip");
  const [url, setUrl] = useState("");
  const [clipCount, setClipCount] = useState(4);
  const [durationIdx, setDurationIdx] = useState(1);
  // AI video options
  const [topic, setTopic] = useState("");
  const [voice, setVoice] = useState("es-mx-m");
  const [background, setBackground] = useState("parkour");
  const [style, setStyle] = useState("facts");

  const [job, setJob] = useState<JobState>(INITIAL_STATE);
  const eventSourceRef = useRef<EventSource | null>(null);

  const isProcessing = !["idle", "done", "error"].includes(job.status);
  const currentStep = PIPELINE_STEPS.findIndex((s) => s.key === job.status);

  const reset = useCallback(() => {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    setJob(INITIAL_STATE);
    setUrl("");
    setTopic("");
  }, []);

  function connectSSE(id: string) {
    const sse = new EventSource(`/api/jobs/status?id=${id}`);
    eventSourceRef.current = sse;

    sse.onmessage = (event) => {
      const data = JSON.parse(event.data);
      setJob({
        status: data.status,
        progress: data.progress,
        message: data.message,
        segments: data.segments || [],
        outputs: data.outputs || [],
        script: data.script,
        error: data.error,
      });

      if (data.status === "done" || data.status === "error") {
        sse.close();
        eventSourceRef.current = null;
      }
    };

    sse.onerror = () => {
      sse.close();
      eventSourceRef.current = null;
    };
  }

  async function submit() {
    if (isProcessing) return;

    if (mode === "ai-video") {
      if (!topic.trim()) return;

      setJob({ status: "processing", progress: 5, segments: [], outputs: [] });

      try {
        const res = await fetch("/api/jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "ai-video",
            topic: topic.trim(),
            voice,
            background,
            style,
          }),
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Error al crear job");
        }

        const { id } = await res.json();
        connectSSE(id);
      } catch (err: any) {
        setJob((p) => ({ ...p, status: "error", error: err.message || "Algo salio mal" }));
      }
      return;
    }

    // Clip mode
    if (!url.trim()) return;

    let finalUrl = url.trim();
    if (!/^https?:\/\//i.test(finalUrl)) {
      finalUrl = `https://${finalUrl}`;
    }

    setJob({ status: "downloading", progress: 5, segments: [], outputs: [] });

    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: finalUrl,
          clipCount,
          minDuration: DURATION_OPTIONS[durationIdx]!.min,
          maxDuration: DURATION_OPTIONS[durationIdx]!.max,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Error al crear job");
      }

      const { id } = await res.json();
      connectSSE(id);
    } catch (err: any) {
      setJob((p) => ({ ...p, status: "error", error: err.message || "Algo salio mal" }));
    }
  }

  useEffect(() => {
    return () => { eventSourceRef.current?.close(); };
  }, []);

  return {
    mode, setMode,
    url, setUrl,
    clipCount, setClipCount,
    durationIdx, setDurationIdx,
    topic, setTopic,
    voice, setVoice,
    background, setBackground,
    style, setStyle,
    job, isProcessing, currentStep,
    submit, reset,
  };
}
