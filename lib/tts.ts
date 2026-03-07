// Text-to-speech using Microsoft Edge TTS (free, no API key)

import { EdgeTTS } from "@andresaya/edge-tts";
import path from "path";
import fs from "fs/promises";
import { TMP_DIR } from "./config";
import { logVideo } from "./logger";

export interface TTSResult {
  audioPath: string;
  duration: number;  // estimated from text length
  wordBoundaries: WordBoundary[];
}

export interface WordBoundary {
  text: string;
  offset: number;  // ms from start
  duration: number; // ms
}

// Spanish voices — best quality neural voices
const VOICES: Record<string, string> = {
  "es-mx-f": "es-MX-DaliaNeural",
  "es-mx-m": "es-MX-JorgeNeural",
  "es-co-f": "es-CO-SalomeNeural",
  "es-co-m": "es-CO-GonzaloNeural",
  "es-ar-f": "es-AR-ElenaNeural",
  "es-ar-m": "es-AR-TomasNeural",
  "es-es-f": "es-ES-ElviraNeural",
  "es-es-m": "es-ES-AlvaroNeural",
  "en-us-f": "en-US-JennyNeural",
  "en-us-m": "en-US-GuyNeural",
};

export function getAvailableVoices() {
  return Object.entries(VOICES).map(([key, voice]) => {
    const [lang, region, gender] = key.split("-");
    return { key, voice, lang: `${lang}-${region}`, gender: gender === "f" ? "female" : "male" };
  });
}

export async function synthesize(
  text: string,
  jobId: string,
  voiceKey: string = "es-mx-m"
): Promise<TTSResult> {
  const voice = VOICES[voiceKey] || VOICES["es-mx-m"]!;
  const audioPath = path.join(TMP_DIR, `${jobId}_tts`);

  logVideo.step("Generando audio TTS...", voice);

  const tts = new EdgeTTS();
  await tts.synthesize(text, voice);
  await tts.toFile(audioPath); // creates audioPath.mp3

  const mp3Path = `${audioPath}.mp3`;

  // Verify file exists
  const stat = await fs.stat(mp3Path);
  logVideo.success("Audio TTS generado", `${(stat.size / 1024).toFixed(0)}KB`);

  // Estimate duration from text (~150 words/min for Spanish)
  const wordCount = text.split(/\s+/).length;
  const estimatedDuration = (wordCount / 150) * 60;

  return {
    audioPath: mp3Path,
    duration: estimatedDuration,
    wordBoundaries: [],
  };
}
