"use client";

import { useState, useEffect } from "react";
import "./globals.css";
import { useJob } from "./hooks/useJob";
import HomeView from "./components/HomeView";
import ResultsView from "./components/ResultsView";
import ProcessingView from "./components/ProcessingView";

export default function Home() {
  const [mounted, setMounted] = useState(false);
  const {
    mode, setMode,
    url, setUrl,
    clipCount, setClipCount,
    durationIdx, setDurationIdx,
    topic, setTopic,
    voice, setVoice,
    background, setBackground,
    style, setStyle,
    job, currentStep,
    submit, reset,
  } = useJob();

  useEffect(() => { setMounted(true); }, []);

  if (job.status === "idle") {
    return (
      <HomeView
        mode={mode}
        setMode={setMode}
        url={url}
        setUrl={setUrl}
        clipCount={clipCount}
        setClipCount={setClipCount}
        durationIdx={durationIdx}
        setDurationIdx={setDurationIdx}
        topic={topic}
        setTopic={setTopic}
        voice={voice}
        setVoice={setVoice}
        background={background}
        setBackground={setBackground}
        style={style}
        setStyle={setStyle}
        onSubmit={submit}
        mounted={mounted}
      />
    );
  }

  if (job.status === "done") {
    return <ResultsView job={job} url={url || topic} onReset={reset} />;
  }

  return <ProcessingView job={job} currentStep={currentStep} onReset={reset} />;
}
