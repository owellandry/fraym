"use client";

import type { JobState } from "../hooks/useJob";

interface Props {
  job: JobState;
  url: string;
  onReset: () => void;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function totalDuration(job: JobState): string {
  const total = job.segments.reduce((acc, s) => acc + (s.end - s.start), 0);
  return formatTime(total);
}

export default function ResultsView({ job, url, onReset }: Props) {
  function downloadAll(e: React.MouseEvent) {
    e.preventDefault();
    job.outputs.forEach((o) => {
      const a = document.createElement("a");
      a.href = o;
      a.download = "";
      a.click();
    });
  }

  return (
    <div className="page" style={{ animation: "fadeIn 0.4s ease" }}>
      {/* Nav */}
      <nav className="nav">
        <button className="logo" onClick={onReset}>
          <span className="logo-wordmark">
            <span style={{ color: "var(--accent)" }}>f</span>raym
          </span>
        </button>
        <button className="btn-dark desktop-only" onClick={onReset}>
          Nuevo video +
        </button>
        <span
          className="mobile-only"
          onClick={onReset}
          style={{ color: "var(--accent)", fontSize: 14, fontWeight: 500, cursor: "pointer" }}
        >
          + Nuevo
        </span>
      </nav>

      <main className="results-main">
        {/* Header */}
        <div className="results-header" style={{ animation: "fadeInUp 0.4s ease" }}>
          <div className="results-success-row">
            <span className="results-check">✓</span>
            <span className="results-success-text">Completado</span>
          </div>
          <h1 className="results-title">{job.outputs.length} shorts listos</h1>
          <p className="results-subtitle desktop-only">
            Toca un clip para previsualizarlo o descarga todos.
          </p>
          <p className="results-subtitle mobile-only">
            Descarga o comparte tus clips
          </p>
        </div>

        {/* Cards */}
        <div className="results-cards">
          {job.outputs.map((output, i) => {
            const seg = job.segments[i];
            const duration = seg ? formatTime(seg.end - seg.start) : "—";
            return (
              <div
                key={i}
                className="rcard"
                style={{ animation: `fadeInUp 0.4s ease ${i * 0.08}s both` }}
              >
                <div className="rcard-thumb">
                  <video src={output} preload="metadata" />
                  <button
                    className="rcard-play"
                    onClick={(e) => {
                      const video = e.currentTarget.parentElement?.querySelector("video");
                      if (video) {
                        if (video.paused) video.play();
                        else video.pause();
                      }
                    }}
                  >
                    ▶
                  </button>
                </div>
                <div className="rcard-info">
                  <div className="rcard-top">
                    <span className="rcard-badge">CLIP {i + 1}</span>
                    <p className="rcard-title">{seg?.title || `Short #${i + 1}`}</p>
                    <p className="rcard-reason">{seg?.reason || ""}</p>
                  </div>
                  <div className="rcard-bottom">
                    <span className="rcard-meta">{duration} · 720p</span>
                    <a href={output} download className="rcard-dl" title="Descargar">
                      ↓
                    </a>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Bottom CTA */}
        <div className="results-bottom" style={{ animation: "fadeInUp 0.5s ease 0.2s both" }}>
          <button className="results-dl-btn" onClick={downloadAll}>
            <span>↓</span> Descargar todo
          </button>
          <span className="results-dl-meta">
            {job.outputs.length} clips · {totalDuration(job)} total
          </span>
        </div>
      </main>
    </div>
  );
}
