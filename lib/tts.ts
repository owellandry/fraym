// Text-to-speech using Microsoft Edge TTS (free, no API key)

import { EdgeTTS } from "@andresaya/edge-tts";
import path from "path";
import fs from "fs/promises";
import { TMP_DIR } from "./config";
import { logVideo } from "./logger";

export interface WordTiming {
  text: string;
  start: number;  // seconds
  end: number;    // seconds
}

export interface TTSResult {
  audioPath: string;
  words: WordTiming[];
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

const MAX_TTS_RETRIES = 4;

export async function synthesize(
  text: string,
  jobId: string,
  voiceKey: string = "es-mx-m"
): Promise<TTSResult> {
  const voice = VOICES[voiceKey] || VOICES["es-mx-m"]!;
  const audioPath = path.join(TMP_DIR, `${jobId}_tts`);

  logVideo.step("Generando audio TTS...", voice);

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_TTS_RETRIES; attempt++) {
    try {
      const tts = new EdgeTTS();
      await tts.synthesize(text, voice);
      await tts.toFile(audioPath); // creates audioPath.mp3

      const mp3Path = `${audioPath}.mp3`;

      // Get precise word timing from TTS engine
      const boundaries = tts.getWordBoundaries() || [];
      const TICKS_TO_SEC = 10_000_000; // 1 tick = 100 nanoseconds

      const words: WordTiming[] = boundaries.map((wb: any) => ({
        text: wb.text,
        start: wb.offset / TICKS_TO_SEC,
        end: (wb.offset + wb.duration) / TICKS_TO_SEC,
      }));

      // Verify file exists
      const stat = await fs.stat(mp3Path);
      logVideo.success("Audio TTS generado", `${(stat.size / 1024).toFixed(0)}KB · ${words.length} palabras`);

      return { audioPath: mp3Path, words };
    } catch (err: any) {
      lastError = err;
      if (attempt < MAX_TTS_RETRIES) {
        const waitSec = attempt * 3; // 3s, 6s, 9s
        logVideo.warn(`TTS intento ${attempt} fallido (${err.message}), reintentando en ${waitSec}s...`);
        await new Promise(r => setTimeout(r, waitSec * 1000));
      }
    }
  }

  throw new Error(`TTS fallido despues de ${MAX_TTS_RETRIES} intentos: ${lastError?.message}`);
}
