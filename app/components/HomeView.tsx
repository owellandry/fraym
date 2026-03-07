"use client";

import { useEffect, useRef } from "react";
import Logo from "./Logo";
import { CLIP_COUNTS, DURATION_OPTIONS } from "../hooks/useJob";

interface Props {
  url: string;
  setUrl: (url: string) => void;
  clipCount: number;
  setClipCount: (n: number) => void;
  durationIdx: number;
  setDurationIdx: (i: number) => void;
  onSubmit: () => void;
  mounted: boolean;
}

export default function HomeView({
  url, setUrl, clipCount, setClipCount,
  durationIdx, setDurationIdx, onSubmit, mounted,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handlePaste(e: ClipboardEvent) {
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
  }, [setUrl]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit();
  }

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

        <h1 className="headline desktop-only">
          De YouTube a Shorts<br />en un solo click.
        </h1>
        <h1 className="headline mobile-only">
          De YouTube<br />a Shorts.
        </h1>

        <div style={{ height: 20 }} />

        <p className="subtitle desktop-only">
          Pega un enlace, la IA analiza los mejores momentos y genera clips
          verticales con subtitulos, face tracking y todo listo para subir.
        </p>
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

        <div className="pills-row mobile-only" style={{ animation: mounted ? "fadeInUp 0.6s ease 0.25s both" : "none" }}>
          <span className="pill pill--off">{clipCount} clips</span>
          <span className="pill pill--off">{DURATION_OPTIONS[durationIdx]!.label}</span>
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
