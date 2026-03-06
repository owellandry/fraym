"use client";

import { useState, useEffect, useRef } from "react";
import "./globals.css";
import Logo from "./components/Logo";

type JobStatus = "idle" | "downloading" | "analyzing" | "processing" | "done" | "error";

interface Segment {
  start: number;
  end: number;
  title: string;
  reason: string;
}

interface JobState {
  status: JobStatus;
  progress: number;
  message?: string;
  segments: Segment[];
  outputs: string[];
  error?: string;
}

const PIPELINE_STEPS: { key: JobStatus; label: string }[] = [
  { key: "downloading", label: "Video descargado" },
  { key: "analyzing", label: "momentos detectados" },
  { key: "processing", label: "Procesando clips" },
  { key: "done", label: "Listo" },
];

function getStepIndex(status: JobStatus): number {
  return PIPELINE_STEPS.findIndex((s) => s.key === status);
}

const CLIP_COUNTS = [2, 3, 4, 5, 8, 10] as const;
const DURATION_OPTIONS = [
  { label: "15-30s", min: 15, max: 30 },
  { label: "30-60s", min: 30, max: 60 },
  { label: "45-60s", min: 45, max: 60 },
  { label: "60s+", min: 60, max: 0 },
] as const;

export default function Home() {
  const [url, setUrl] = useState("");
  const [clipCount, setClipCount] = useState(4);
  const [durationIdx, setDurationIdx] = useState(1); // default: 30-60s
  const [mounted, setMounted] = useState(false);
  const [job, setJob] = useState<JobState>({
    status: "idle",
    progress: 0,
    segments: [],
    outputs: [],
  });
  const inputRef = useRef<HTMLInputElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => { setMounted(true); }, []);

  // Auto-detect Ctrl+V anywhere on the page — paste URL into input
  useEffect(() => {
    function handlePaste(e: ClipboardEvent) {
      // Skip if already typing in the input
      if (document.activeElement === inputRef.current) return;
      const text = e.clipboardData?.getData("text")?.trim();
      if (!text) return;
      try {
        const parsed = new URL(text);
        if (parsed.hostname.includes("youtube") || parsed.hostname.includes("youtu.be")) {
          e.preventDefault();
          setUrl(text);
          inputRef.current?.focus();
        }
      } catch {}
    }
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, []);

  const isProcessing = !["idle", "done", "error"].includes(job.status);
  const currentStep = getStepIndex(job.status);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim() || isProcessing) return;

    setJob({ status: "downloading", progress: 5, segments: [], outputs: [] });

    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url,
          clipCount,
          minDuration: DURATION_OPTIONS[durationIdx].min,
          maxDuration: DURATION_OPTIONS[durationIdx].max,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Error al crear job");
      }

      const { id } = await res.json();

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
    } catch (err: any) {
      setJob((p) => ({
        ...p,
        status: "error",
        error: err.message || "Algo salio mal",
      }));
    }
  }

  function reset() {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    setJob({ status: "idle", progress: 0, segments: [], outputs: [] });
    setUrl("");
    inputRef.current?.focus();
  }

  useEffect(() => {
    return () => { eventSourceRef.current?.close(); };
  }, []);

  // ====== IDLE VIEW (Home) ======
  if (job.status === "idle") {
    return (
      <div className="page" style={{ animation: mounted ? "fadeIn 0.5s ease" : "none" }}>
        <nav className="nav">
          <span className="logo"><Logo /></span>
          <div className="nav-links">
            <span className="nav-link">GitHub</span>
            <span className="nav-link">API</span>
          </div>
          <span className="mobile-only" style={{ color: "var(--text-muted)", fontSize: 22 }}>&#8801;</span>
        </nav>

        <main className="hero" style={{ animation: mounted ? "fadeInUp 0.6s ease 0.1s both" : "none" }}>
          <div className="badge">
            <div className="badge-dot" />
            <span className="badge-text desktop-only">Tu editor de shorts con IA</span>
            <span className="badge-text mobile-only">Editor de shorts con IA</span>
          </div>

          <div style={{ height: 28 }} />

          {/* Desktop headline */}
          <h1 className="headline desktop-only">
            De YouTube a Shorts<br />en un solo click.
          </h1>
          {/* Mobile headline — shorter */}
          <h1 className="headline mobile-only">
            De YouTube<br />a Shorts.
          </h1>

          <div style={{ height: 20 }} />

          {/* Desktop subtitle */}
          <p className="subtitle desktop-only">
            Pega un enlace, la IA analiza los mejores momentos y genera clips
            verticales con subtitulos, face tracking y todo listo para subir.
          </p>
          {/* Mobile subtitle — shorter */}
          <p className="subtitle mobile-only">
            Pega un enlace. La IA detecta los mejores momentos y genera clips verticales.
          </p>

          <div style={{ height: 36 }} />

          <form onSubmit={handleSubmit} className="input-form">
            <div className="input-row">
              <input
                ref={inputRef}
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://youtube.com/watch?v=..."
                required
                className="url-input"
              />
              <button type="submit" className="submit-btn">
                Generar shorts
              </button>
            </div>
          </form>

          <div className="spacer-pills" />

          {/* Desktop pills — full selectors */}
          <div className="pills-row desktop-only" style={{ animation: mounted ? "fadeInUp 0.6s ease 0.25s both" : "none" }}>
            <div className="pills-group">
              {CLIP_COUNTS.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setClipCount(n)}
                  className={`pill ${clipCount === n ? "pill--on" : "pill--off"}`}
                >
                  {n} clips
                </button>
              ))}
            </div>

            <div className="pills-divider" />

            <div className="pills-group">
              {DURATION_OPTIONS.map((opt, i) => (
                <button
                  key={opt.label}
                  type="button"
                  onClick={() => setDurationIdx(i)}
                  className={`pill ${durationIdx === i ? "pill--on" : "pill--off"}`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Mobile pills — simplified summary */}
          <div className="pills-row mobile-only" style={{ animation: mounted ? "fadeInUp 0.6s ease 0.25s both" : "none" }}>
            <span className="pill pill--off">{clipCount} clips</span>
            <span className="pill pill--off">{DURATION_OPTIONS[durationIdx].label}</span>
            <span className="pill pill--off">9:16</span>
          </div>
        </main>

        <footer className="feature-bar" style={{ animation: mounted ? "fadeIn 0.6s ease 0.3s both" : "none" }}>
          {[
            "Face Tracking YOLO",
            "Subtitulos sincronizados",
            "IA detecta momentos virales",
            "Espejo automatico",
          ].map((feat) => (
            <div key={feat} className="feature-item">
              <span className="feature-dot">&#9673;</span>
              <span className="feature-text">{feat}</span>
            </div>
          ))}
        </footer>
      </div>
    );
  }

  // ====== DONE VIEW (Results) ======
  if (job.status === "done") {
    return (
      <div className="page" style={{ animation: "fadeIn 0.4s ease" }}>
        <nav className="nav">
          <button className="logo" onClick={reset}><Logo /></button>
          <span className="mobile-only" onClick={reset} style={{ color: "var(--accent)", fontSize: 14, fontWeight: 500, cursor: "pointer" }}>+ Nuevo</span>
          <button className="btn-dark desktop-only" onClick={reset}>
            Nuevo video +
          </button>
        </nav>

        <main className="results-main" style={{ animation: "fadeInUp 0.5s ease" }}>
          <div className="results-header">
            <div>
              <h1 className="results-title desktop-only">{job.outputs.length} shorts listos.</h1>
              <h1 className="results-title mobile-only">{job.outputs.length} shorts generados</h1>
              <p className="mobile-subtitle" style={{ fontSize: 14, color: "var(--text-muted)", marginTop: 4 }}>
                Descarga o comparte tus clips
              </p>
            </div>
            <div className="results-actions">
              <span className="results-url">
                {url.replace(/https?:\/\/(www\.)?/, "").slice(0, 30)}
              </span>
              <a
                href="#"
                className="btn-primary"
                onClick={(e) => {
                  e.preventDefault();
                  job.outputs.forEach((o) => {
                    const a = document.createElement("a");
                    a.href = o; a.download = ""; a.click();
                  });
                }}
              >
                Descargar todo &#8595;
              </a>
            </div>
          </div>

          <div className="cards-grid">
            {job.outputs.map((output, i) => {
              const seg = job.segments[i];
              return (
                <div key={i} className="card" style={{ animation: `scaleIn 0.4s ease ${i * 0.08}s both` }}>
                  <video src={output} controls preload="metadata" />
                  <div className="card-body">
                    <p className="card-title">{seg?.title || `Short #${i + 1}`}</p>
                    <div className="card-meta">
                      <span className="card-time">
                        {seg ? `${formatTime(seg.start)} — ${formatTime(seg.end)}  ·  Short #${i + 1}` : ""}
                      </span>
                      {/* Desktop: text link */}
                      <a href={output} download className="card-dl desktop-only">
                        Descargar &#8595;
                      </a>
                    </div>
                    {/* Mobile: coral button */}
                    <a href={output} download className="card-dl-btn mobile-only">
                      Descargar
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        </main>
      </div>
    );
  }

  // ====== PROCESSING / ERROR VIEW ======
  return (
    <div className="page" style={{ animation: "fadeIn 0.4s ease" }}>
      <nav className="nav">
        <span className="logo"><Logo /></span>
        <button className="cancel-btn" onClick={reset}>Cancelar</button>
      </nav>

      <main className="proc-main">
        <span className="proc-pct">{Math.round(job.progress)}%</span>

        <div style={{ height: 8 }} />

        <div className="proc-bar">
          <div className="proc-bar-fill" style={{ width: `${job.progress}%` }} />
        </div>

        <div style={{ height: 28 }} />

        <p className="proc-msg">{job.message || "Iniciando..."}</p>

        <div style={{ height: 48 }} />

        <div className="proc-steps">
          {PIPELINE_STEPS.map((step, i) => {
            const isActive = step.key === job.status;
            const isCompleted = currentStep > i || job.status === "done";

            return (
              <div key={step.key} className="step-row" style={{ animation: `fadeIn 0.4s ease ${i * 0.1}s both` }}>
                <div
                  className="step-dot"
                  style={{
                    background: isCompleted ? "var(--success)"
                      : isActive ? "var(--accent)"
                      : "var(--border-light)",
                  }}
                />
                <span style={{
                  fontSize: isActive ? 14 : 13,
                  fontWeight: isActive ? 600 : 400,
                  color: isCompleted ? "var(--text-muted)"
                    : isActive ? "var(--accent)"
                    : "var(--border-light)",
                  transition: "all 0.3s",
                }}>
                  {step.key === "analyzing" && job.segments.length > 0
                    ? `${job.segments.length} ${step.label}`
                    : step.label}
                </span>
              </div>
            );
          })}
        </div>

        {job.status === "error" && (
          <div className="error-box">
            <p style={{ fontSize: 14, fontWeight: 600, color: "var(--error)", marginBottom: 4 }}>
              Error en el proceso
            </p>
            <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 12 }}>
              {job.error}
            </p>
            <button className="btn-primary" onClick={reset}>
              Reintentar
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
