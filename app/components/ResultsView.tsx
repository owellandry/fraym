"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  Heart, MessageCircle, Share2, Bookmark,
  Music, Download, X, Play, Pause, Check,
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

function getSegmentTitle(seg: JobState["segments"][number] | undefined, index: number): string {
  const cleanTitle = (seg?.title || "")
    .replace(/\[[^\]]+\]/g, " ")
    .replace(/\(\d+:\d+[-–]\d+:\d+\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (cleanTitle && !/^(short|clip|segment|momento)\s*#?\s*\d+$/i.test(cleanTitle)) return cleanTitle;

  const cleanReason = (seg?.reason || "").replace(/\s+/g, " ").trim();
  if (cleanReason && !/^(segmento|clip|short)/i.test(cleanReason)) return cleanReason.slice(0, 60);

  return `Clip ${index + 1}`;
}

function PreviewPlayer({ src }: { src: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const [playing, setPlaying] = useState(true);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTime = () => { if (!draggingRef.current) setCurrent(v.currentTime); };
    const onMeta = () => setDuration(v.duration);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnd = () => setPlaying(false);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("loadedmetadata", onMeta);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("ended", onEnd);
    return () => {
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("loadedmetadata", onMeta);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("ended", onEnd);
    };
  }, []);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play();
    else v.pause();
  }, []);

  const seekTo = useCallback((e: React.MouseEvent | MouseEvent) => {
    const bar = progressRef.current;
    const v = videoRef.current;
    if (!bar || !v || !v.duration) return;
    const rect = bar.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const time = pct * v.duration;
    v.currentTime = time;
    setCurrent(time);
  }, []);

  const onPointerDown = useCallback((e: React.MouseEvent) => {
    draggingRef.current = true;
    seekTo(e);
    const onMove = (ev: MouseEvent) => seekTo(ev);
    const onUp = () => {
      draggingRef.current = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [seekTo]);

  const pct = duration > 0 ? (current / duration) * 100 : 0;

  return (
    <>
      <video
        ref={videoRef}
        className="preview-video"
        src={src}
        autoPlay
        playsInline
        disablePictureInPicture
        disableRemotePlayback
        controlsList="nodownload nofullscreen noplaybackrate noremoteplayback"
        onClick={togglePlay}
      />

      <div className="preview-progress" aria-hidden="true">
        <div className="preview-progress-fill" style={{ width: `${pct}%` }} />
      </div>

      {/* Center play/pause tap overlay */}
      <div className="preview-tap-zone" onClick={togglePlay}>
        {!playing && (
          <div className="preview-big-play">
            <Play size={40} color="#fff" fill="#fff" />
          </div>
        )}
      </div>

      {/* Custom progress bar */}
      <div className="preview-controls">
        <button className="preview-play-btn" onClick={togglePlay}>
          {playing
            ? <Pause size={16} color="#fff" fill="#fff" />
            : <Play size={16} color="#fff" fill="#fff" />
          }
        </button>
        <span className="preview-time">{formatTime(current)}</span>
        <div
          ref={progressRef}
          className="preview-seekbar"
          onMouseDown={onPointerDown}
        >
          <div className="preview-seekbar-fill" style={{ width: `${pct}%` }} />
          <div className="preview-seekbar-thumb" style={{ left: `${pct}%` }} />
        </div>
        <span className="preview-time">{formatTime(duration)}</span>
      </div>
    </>
  );
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
                  <p className="card-title">{getSegmentTitle(seg, i)}</p>
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
                    <Play size={16} color="#fff" fill="#fff" />
                  </button>
                </div>
                <div className="rcard-info">
                  <div className="rcard-top">
                    <span className="rcard-badge">CLIP {i + 1}</span>
                    <p className="rcard-title">{getSegmentTitle(seg, i)}</p>
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
          "Face Tracking",
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
            {/* Phone frame */}
            <div className="preview-phone">
              <PreviewPlayer src={previewOutput} />
              <div className="preview-gradient" />

              {/* TikTok action buttons */}
              <div className="preview-actions">
                <div className="preview-action-col">
                  <Heart size={26} color="#fff" />
                  <span className="preview-action-count">—</span>
                </div>
                <div className="preview-action-col">
                  <MessageCircle size={24} color="#fff" />
                  <span className="preview-action-count">—</span>
                </div>
                <div className="preview-action-col">
                  <Share2 size={22} color="#fff" />
                  <span className="preview-action-count">—</span>
                </div>
                <div className="preview-action-col">
                  <Bookmark size={22} color="#fff" />
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
                  {getSegmentTitle(previewSeg || undefined, preview ?? 0)} #shorts #viral #fraym
                </p>
                <p className="preview-music"><Music size={11} color="rgba(255,255,255,0.8)" /> Sonido original — @fraym.clips</p>
              </div>
            </div>

            {/* Info panel (desktop only) */}
            <div className="preview-info desktop-only">
              <div className="preview-info-top">
                <div className="preview-info-header">
                  <span className="preview-label">Vista previa</span>
                  <button className="preview-close" onClick={() => setPreview(null)}>
                    <X size={18} color="#fff" />
                  </button>
                </div>
                <div className="preview-info-content">
                  <span className="preview-clip-badge">CLIP {(preview ?? 0) + 1}</span>
                  <h2 className="preview-clip-title">
                    {getSegmentTitle(previewSeg || undefined, preview ?? 0)}
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
                <X size={16} color="#fff" />
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
