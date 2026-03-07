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

function shortUrl(url: string): string {
  return url.replace(/https?:\/\/(www\.)?/, "").slice(0, 35);
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
        {/* Desktop header: title + actions on same row */}
        <div className="results-header-desktop desktop-only" style={{ animation: "fadeInUp 0.4s ease" }}>
          <h1 className="results-title">{job.outputs.length} shorts listos.</h1>
          <div className="results-header-actions">
            <span className="results-url">{shortUrl(url)}</span>
            <span className="results-count-pill">{job.outputs.length} de maximo</span>
            <button className="btn-primary" onClick={downloadAll}>
              Descargar todo ↓
            </button>
          </div>
        </div>

        {/* Mobile header: stacked with success badge */}
        <div className="results-header-mobile mobile-only" style={{ animation: "fadeInUp 0.4s ease" }}>
          <div className="results-success-row">
            <span className="results-check">✓</span>
            <span className="results-success-text">Completado</span>
          </div>
          <h1 className="results-title">{job.outputs.length} shorts listos</h1>
          <p className="results-subtitle">Descarga o comparte tus clips</p>
        </div>

        {/* Desktop cards: vertical grid with 9:16 video */}
        <div className="cards-grid desktop-only">
          {job.outputs.map((output, i) => {
            const seg = job.segments[i];
            return (
              <div
                key={i}
                className="card"
                style={{ animation: `scaleIn 0.4s ease ${i * 0.08}s both` }}
              >
                <video src={output} controls preload="metadata" />
                <div className="card-body">
                  <p className="card-title">{seg?.title || `Short #${i + 1}`}</p>
                  <div className="card-meta">
                    <span className="card-time">
                      {seg ? `${formatTime(seg.start)} → ${formatTime(seg.end)}` : ""}
                    </span>
                    <a href={output} download className="card-dl">
                      Descargar ↓
                    </a>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Mobile cards: horizontal with thumbnail */}
        <div className="results-cards mobile-only">
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

        {/* Mobile bottom CTA */}
        <div className="results-bottom mobile-only" style={{ animation: "fadeInUp 0.5s ease 0.2s both" }}>
          <button className="results-dl-btn" onClick={downloadAll}>
            <span>↓</span> Descargar todo
          </button>
          <span className="results-dl-meta">
            {job.outputs.length} clips · {totalDuration(job)} total
          </span>
        </div>
      </main>

      <footer className="feature-bar desktop-only">
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
