"use client";

import { useState } from "react";
import {
  Heart, MessageCircle, Share2, Bookmark,
  Music, Download, X, Play, Check,
  ArrowLeft,
} from "lucide-react";
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
  const [preview, setPreview] = useState<number | null>(null);

  function downloadAll(e: React.MouseEvent) {
    e.preventDefault();
    job.outputs.forEach((o) => {
      const a = document.createElement("a");
      a.href = o;
      a.download = "";
      a.click();
    });
  }

  const previewSeg = preview !== null ? job.segments[preview] : null;
  const previewOutput = preview !== null ? job.outputs[preview] : null;

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
        {/* Desktop header */}
        <div className="results-header-desktop desktop-only" style={{ animation: "fadeInUp 0.4s ease" }}>
          <h1 className="results-title">{job.outputs.length} shorts listos.</h1>
          <div className="results-header-actions">
            <span className="results-url">{shortUrl(url)}</span>
            <span className="results-count-pill">{job.outputs.length} de maximo</span>
            <button className="btn-primary" onClick={downloadAll}>
              Descargar todo <Download size={14} />
            </button>
          </div>
        </div>

        {/* Mobile header */}
        <div className="results-header-mobile mobile-only" style={{ animation: "fadeInUp 0.4s ease" }}>
          <div className="results-success-row">
            <span className="results-check"><Check size={12} strokeWidth={3} /></span>
            <span className="results-success-text">Completado</span>
          </div>
          <h1 className="results-title">{job.outputs.length} shorts listos</h1>
          <p className="results-subtitle">Descarga o comparte tus clips</p>
        </div>

        {/* Desktop cards */}
        <div className="cards-grid desktop-only">
          {job.outputs.map((output, i) => {
            const seg = job.segments[i];
            return (
              <div
                key={i}
                className="card"
                style={{ animation: `scaleIn 0.4s ease ${i * 0.08}s both`, cursor: "pointer" }}
                onClick={() => setPreview(i)}
              >
                <video src={output} preload="metadata" />
                <div className="card-body">
                  <p className="card-title">{seg?.title || `Short #${i + 1}`}</p>
                  <div className="card-meta">
                    <span className="card-time">
                      {seg ? `${formatTime(seg.start)} → ${formatTime(seg.end)}` : ""}
                    </span>
                    <a
                      href={output}
                      download
                      className="card-dl"
                      onClick={(e) => e.stopPropagation()}
                    >
                      Descargar <Download size={12} />
                    </a>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Mobile cards */}
        <div className="results-cards mobile-only">
          {job.outputs.map((output, i) => {
            const seg = job.segments[i];
            const duration = seg ? formatTime(seg.end - seg.start) : "—";
            return (
              <div
                key={i}
                className="rcard"
                style={{ animation: `fadeInUp 0.4s ease ${i * 0.08}s both`, cursor: "pointer" }}
                onClick={() => setPreview(i)}
              >
                <div className="rcard-thumb">
                  <video src={output} preload="metadata" />
                  <button className="rcard-play" onClick={(e) => e.stopPropagation()}>
                    <Play size={16} fill="#fff" />
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
                    <a
                      href={output}
                      download
                      className="rcard-dl"
                      title="Descargar"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Download size={14} />
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
            <Download size={16} /> Descargar todo
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

      {/* Preview Modal */}
      {preview !== null && previewOutput && (
        <div
          className="preview-overlay"
          onClick={() => setPreview(null)}
          style={{ animation: "fadeIn 0.25s ease" }}
        >
          <div className="preview-modal" onClick={(e) => e.stopPropagation()}>
            {/* Phone frame with TikTok-style UI */}
            <div className="preview-phone">
              <video
                className="preview-video"
                src={previewOutput}
                controls
                autoPlay
                playsInline
              />
              <div className="preview-gradient" />

              {/* Subtitles */}
              <div className="preview-subs">
                <span className="preview-subs-text">
                  {previewSeg?.title || `Short #${(preview ?? 0) + 1}`}
                </span>
              </div>

              {/* TikTok action buttons */}
              <div className="preview-actions">
                <div className="preview-action-col">
                  <Heart size={26} />
                  <span className="preview-action-count">—</span>
                </div>
                <div className="preview-action-col">
                  <MessageCircle size={24} />
                  <span className="preview-action-count">—</span>
                </div>
                <div className="preview-action-col">
                  <Share2 size={22} />
                  <span className="preview-action-count">—</span>
                </div>
                <div className="preview-action-col">
                  <Bookmark size={22} />
                  <span className="preview-action-count">—</span>
                </div>
              </div>

              {/* Bottom user info */}
              <div className="preview-bottom-info">
                <div className="preview-user-row">
                  <span className="preview-avatar">
                    <span style={{ fontFamily: "var(--font-display)", fontStyle: "italic" }}>f</span>
                  </span>
                  <span className="preview-username">@fraym.clips</span>
                  <span className="preview-follow">Seguir</span>
                </div>
                <p className="preview-desc">
                  {previewSeg?.title || ""} #shorts #viral #fraym
                </p>
                <p className="preview-music"><Music size={11} /> Sonido original — @fraym.clips</p>
              </div>

              {/* Progress bar */}
              <div className="preview-progress">
                <div className="preview-progress-fill" />
              </div>
            </div>

            {/* Info panel (desktop only) */}
            <div className="preview-info desktop-only">
              <div className="preview-info-top">
                <div className="preview-info-header">
                  <span className="preview-label">Vista previa</span>
                  <button className="preview-close" onClick={() => setPreview(null)}>
                    <X size={18} />
                  </button>
                </div>
                <div className="preview-info-content">
                  <span className="preview-clip-badge">CLIP {(preview ?? 0) + 1}</span>
                  <h2 className="preview-clip-title">
                    {previewSeg?.title || `Short #${(preview ?? 0) + 1}`}
                  </h2>
                  <p className="preview-clip-reason">
                    {previewSeg?.reason || "Segmento detectado automaticamente"}
                  </p>
                  <div className="preview-divider" />
                  <div className="preview-meta-grid">
                    <div className="preview-meta-row">
                      <span className="preview-meta-label">Duracion</span>
                      <span className="preview-meta-value">
                        {previewSeg ? formatTime(previewSeg.end - previewSeg.start) : "—"}
                      </span>
                    </div>
                    <div className="preview-meta-row">
                      <span className="preview-meta-label">Timestamp</span>
                      <span className="preview-meta-value">
                        {previewSeg ? `${formatTime(previewSeg.start)} → ${formatTime(previewSeg.end)}` : "—"}
                      </span>
                    </div>
                    <div className="preview-meta-row">
                      <span className="preview-meta-label">Resolucion</span>
                      <span className="preview-meta-value">1080x1920 · 720p</span>
                    </div>
                  </div>
                </div>
              </div>
              <a href={previewOutput} download className="preview-dl-btn">
                <Download size={16} /> Descargar clip
              </a>
            </div>

            {/* Mobile close + download */}
            <div className="preview-mobile-bar mobile-only">
              <button className="preview-close-mobile" onClick={() => setPreview(null)}>
                <X size={16} />
              </button>
              <span className="preview-mobile-label">CLIP {(preview ?? 0) + 1} · {previewSeg ? formatTime(previewSeg.end - previewSeg.start) : ""} · 720p</span>
              <a href={previewOutput} download className="preview-dl-mobile"><Download size={14} /> Descargar</a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
