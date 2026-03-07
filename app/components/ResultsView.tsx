"use client";

import Logo from "./Logo";
import type { JobState, Segment } from "../hooks/useJob";

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

export default function ResultsView({ job, url, onReset }: Props) {
  return (
    <div className="page" style={{ animation: "fadeIn 0.4s ease" }}>
      <nav className="nav">
        <button className="logo" onClick={onReset}><Logo /></button>
        <span className="mobile-only" onClick={onReset} style={{ color: "var(--accent)", fontSize: 14, fontWeight: 500, cursor: "pointer" }}>+ Nuevo</span>
        <button className="btn-dark desktop-only" onClick={onReset}>
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
                    <a href={output} download className="card-dl desktop-only">
                      Descargar &#8595;
                    </a>
                  </div>
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
