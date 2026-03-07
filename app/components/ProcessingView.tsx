"use client";

import Logo from "./Logo";
import { PIPELINE_STEPS, type JobState } from "../hooks/useJob";

interface Props {
  job: JobState;
  currentStep: number;
  onReset: () => void;
}

export default function ProcessingView({ job, currentStep, onReset }: Props) {
  return (
    <div className="page" style={{ animation: "fadeIn 0.4s ease" }}>
      <nav className="nav">
        <span className="logo"><Logo /></span>
        <button className="cancel-btn" onClick={onReset}>Cancelar</button>
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
            <button className="btn-primary" onClick={onReset}>
              Reintentar
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
