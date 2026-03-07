"use client";

import { useEffect, useRef } from "react";
import Logo from "./Logo";
import {
  CLIP_COUNTS, DURATION_OPTIONS,
  VOICE_OPTIONS, BG_CATEGORIES, STYLE_OPTIONS,
  type JobMode,
} from "../hooks/useJob";

interface Props {
  mode: JobMode;
  setMode: (m: JobMode) => void;
  url: string;
  setUrl: (url: string) => void;
  clipCount: number;
  setClipCount: (n: number) => void;
  durationIdx: number;
  setDurationIdx: (i: number) => void;
  topic: string;
  setTopic: (t: string) => void;
  voice: string;
  setVoice: (v: string) => void;
  background: string;
  setBackground: (b: string) => void;
  style: string;
  setStyle: (s: string) => void;
  onSubmit: () => void;
  mounted: boolean;
}

export default function HomeView({
  mode, setMode,
  url, setUrl, clipCount, setClipCount,
  durationIdx, setDurationIdx,
  topic, setTopic, voice, setVoice,
  background, setBackground, style, setStyle,
  onSubmit, mounted,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    function handlePaste(e: ClipboardEvent) {
      if (mode !== "clip") return;
      if (document.activeElement === inputRef.current) return;
      let text = e.clipboardData?.getData("text")?.trim();
      if (!text) return;
      const normalized = /^https?:\/\//i.test(text) ? text : `https://${text}`;
      try {
        const parsed = new URL(normalized);
        if (parsed.hostname.includes("youtube") || parsed.hostname.includes("youtu.be")) {
          e.preventDefault();
          setUrl(text);
          inputRef.current?.focus();
        }
      } catch {}
    }
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [setUrl, mode]);

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
          {mode === "clip"
            ? <>De YouTube a Shorts<br />en un solo click.</>
            : <>Crea shorts con IA<br />en segundos.</>
          }
        </h1>
        <h1 className="headline mobile-only">
          {mode === "clip" ? <>De YouTube<br />a Shorts.</> : <>Shorts<br />con IA.</>}
        </h1>

        <div style={{ height: 20 }} />

        <p className="subtitle desktop-only">
          {mode === "clip"
            ? "Pega un enlace, la IA analiza los mejores momentos y genera clips verticales con subtitulos, face tracking y todo listo para subir."
            : "Escribe un tema, la IA genera el guion, la voz y lo combina con un video de fondo para crear un short viral."
          }
        </p>
        <p className="subtitle mobile-only">
          {mode === "clip"
            ? "Pega un enlace. La IA detecta los mejores momentos y genera clips verticales."
            : "Escribe un tema. La IA genera guion, voz y video."
          }
        </p>

        <div style={{ height: 24 }} />

        {/* Mode tabs */}
        <div className="mode-tabs" style={{ animation: mounted ? "fadeInUp 0.6s ease 0.15s both" : "none" }}>
          <button
            className={`mode-tab ${mode === "clip" ? "mode-tab--active" : ""}`}
            onClick={() => setMode("clip")}
          >
            YouTube a Shorts
          </button>
          <button
            className={`mode-tab ${mode === "ai-video" ? "mode-tab--active" : ""}`}
            onClick={() => setMode("ai-video")}
          >
            Crear con IA
          </button>
        </div>

        <div style={{ height: 20 }} />

        {mode === "clip" ? (
          /* === CLIP MODE === */
          <>
            <form onSubmit={handleSubmit} className="input-form">
              <div className="input-row">
                <input
                  ref={inputRef}
                  type="text"
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
          </>
        ) : (
          /* === AI VIDEO MODE === */
          <>
            <form onSubmit={handleSubmit} className="input-form">
              <div className="ai-input-area">
                <textarea
                  ref={textareaRef}
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="Escribe el tema del video... ej: 5 datos curiosos sobre el espacio que no sabias"
                  required
                  className="topic-input"
                  rows={3}
                />
                <button type="submit" className="submit-btn" style={{ marginTop: 12 }}>
                  Generar video
                </button>
              </div>
            </form>

            <div className="spacer-pills" />

            <div className="ai-options" style={{ animation: mounted ? "fadeInUp 0.6s ease 0.25s both" : "none" }}>
              {/* Style */}
              <div className="ai-option-group">
                <span className="ai-option-label">Estilo</span>
                <div className="pills-group">
                  {STYLE_OPTIONS.map((s) => (
                    <button
                      key={s.key}
                      type="button"
                      onClick={() => setStyle(s.key)}
                      className={`pill ${style === s.key ? "pill--on" : "pill--off"}`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Voice */}
              <div className="ai-option-group">
                <span className="ai-option-label">Voz</span>
                <div className="pills-group">
                  {VOICE_OPTIONS.slice(0, 6).map((v) => (
                    <button
                      key={v.key}
                      type="button"
                      onClick={() => setVoice(v.key)}
                      className={`pill ${voice === v.key ? "pill--on" : "pill--off"}`}
                    >
                      {v.flag} {v.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Background */}
              <div className="ai-option-group">
                <span className="ai-option-label">Fondo</span>
                <div className="pills-group">
                  {BG_CATEGORIES.map((b) => (
                    <button
                      key={b.key}
                      type="button"
                      onClick={() => setBackground(b.key)}
                      className={`pill ${background === b.key ? "pill--on" : "pill--off"}`}
                    >
                      {b.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}
      </main>

      <footer className="feature-bar" style={{ animation: mounted ? "fadeIn 0.6s ease 0.3s both" : "none" }}>
        {(mode === "clip"
          ? ["Face Tracking", "Subtitulos sincronizados", "IA detecta momentos virales", "Espejo automatico"]
          : ["Guion con IA", "Voz neural (TTS)", "Videos de fondo HD", "Subtitulos animados"]
        ).map((feat) => (
          <div key={feat} className="feature-item">
            <span className="feature-dot">&#9673;</span>
            <span className="feature-text">{feat}</span>
          </div>
        ))}
      </footer>
    </div>
  );
}
