// AI Video Generation Pipeline
// Topic/text → Script (AI) → TTS → Background video → Subtitles → Final short

import { spawn } from "child_process";
import path from "path";
import fs from "fs/promises";
import { TMP_DIR, OUTPUT_DIR, FFMPEG, FFPROBE, ensureDirs } from "./config";
import { synthesize } from "./tts";
import { downloadBackground, isPexelsConfigured } from "./pexels";
import { logVideo, logAI } from "./logger";

export interface AIVideoOptions {
  topic: string;
  voice: string;       // voice key from tts.ts
  background: string;  // category key or search term
  style: "story" | "facts" | "motivation" | "news";
}

// --- Script generation with AI ---

async function generateScript(topic: string, style: string): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY not configured");

  const stylePrompts: Record<string, string> = {
    story: `Cuenta una historia fascinante y dramatica sobre el tema. Usa primera persona cuando sea posible. Crea tension y un desenlace sorprendente. Estilo storytime de TikTok.`,
    facts: `Presenta 3-5 datos curiosos e impactantes sobre el tema. Cada dato debe sorprender al espectador. Estilo "sabias que..." de TikTok.`,
    motivation: `Crea un discurso motivacional corto e impactante sobre el tema. Usa frases poderosas y directas. Estilo coach motivacional de TikTok.`,
    news: `Presenta la noticia o tema de forma directa e impactante. Empieza con lo mas sorprendente. Estilo noticiero viral de TikTok.`,
  };

  const prompt = `Genera un guion para un video corto viral de TikTok/YouTube Shorts sobre: "${topic}"

ESTILO: ${stylePrompts[style] || stylePrompts.facts}

REGLAS:
- Duracion del texto: entre 100 y 200 palabras (30-60 segundos al hablar)
- Empieza con un GANCHO que atrape en los primeros 3 segundos
- Lenguaje natural y coloquial, como si hablaras con un amigo
- NO uses emojis, hashtags, ni indicaciones de edicion
- NO escribas titulos, solo el texto narrado
- Termina con algo memorable o un llamado a la accion
- Escribe SOLO el texto del guion, nada mas`;

  const MODELS = [
    "google/gemma-3-27b-it:free",
    "meta-llama/llama-3.3-70b-instruct:free",
    "qwen/qwen3-4b:free",
    "mistralai/mistral-small-3.1-24b-instruct:free",
    "deepseek/deepseek-r1-0528:free",
    "google/gemma-3-4b-it:free",
    "meta-llama/llama-4-scout:free",
  ];

  for (const model of MODELS) {
    logAI.info("Generando guion...", model);
    try {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://fraym.xyz",
          "X-Title": "fraym",
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
          temperature: 0.8,
          max_tokens: 1000,
        }),
      });

      if (!res.ok) {
        logAI.warn(`Modelo fallido (${res.status})`, model);
        continue;
      }

      const data: any = await res.json();
      const content = data.choices?.[0]?.message?.content?.trim();
      if (content && content.length > 50) {
        // Clean up any markdown or thinking tags
        const cleaned = content
          .replace(/<think>[\s\S]*?<\/think>/g, "")
          .replace(/^```[\s\S]*?```$/gm, "")
          .replace(/^#+\s/gm, "")
          .replace(/^\*\*/gm, "")
          .replace(/\*\*/g, "")
          .trim();

        logAI.success("Guion generado", `${cleaned.split(/\s+/).length} palabras`);
        return cleaned;
      }
    } catch (err: any) {
      logAI.warn(`Error con ${model}`, err.message);
    }
  }

  throw new Error("No se pudo generar el guion — todos los modelos fallaron");
}

// --- Get real audio duration with ffprobe ---

async function getAudioDuration(audioPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFPROBE, [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      audioPath,
    ]);
    let stdout = "";
    proc.stdout.on("data", d => { stdout += d.toString(); });
    proc.on("close", code => {
      if (code === 0) resolve(parseFloat(stdout.trim()));
      else reject(new Error("ffprobe failed on audio"));
    });
    proc.on("error", () => reject(new Error("ffprobe not found")));
  });
}

// --- Compose final video ---

async function composeVideo(
  bgVideoPath: string,
  audioPath: string,
  audioDuration: number,
  bgDuration: number,
  script: string,
  jobId: string,
): Promise<string> {
  await ensureDirs();
  const outputName = `${jobId}_ai_short.mp4`;
  const outputPath = path.join(OUTPUT_DIR, outputName);

  // Generate ASS subtitle file from script
  const assPath = path.join(TMP_DIR, `${jobId}_ai_subs.ass`);
  await generateScriptSubtitles(script, audioDuration, assPath);

  // Build ffmpeg command:
  // 1. Loop/trim background video to match audio duration
  // 2. Scale to 1080x1920 (portrait)
  // 3. Overlay subtitles
  // 4. Mix with TTS audio
  const escapedAss = assPath.replace(/\\/g, "/").replace(/:/g, "\\:");

  // If background is shorter than audio, loop it
  const needsLoop = bgDuration < audioDuration;

  const args: string[] = [];

  if (needsLoop) {
    args.push("-stream_loop", "-1"); // infinite loop
  }
  args.push("-i", bgVideoPath);        // input 0: background video
  args.push("-i", audioPath);           // input 1: TTS audio
  args.push("-t", audioDuration.toFixed(2)); // trim to audio length
  args.push(
    "-vf", `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,ass='${escapedAss}'`,
    "-map", "0:v:0",                    // video from background
    "-map", "1:a:0",                    // audio from TTS
    "-c:v", "libx264",
    "-preset", "fast",
    "-crf", "21",
    "-c:a", "aac",
    "-b:a", "192k",
    "-movflags", "+faststart",
    "-shortest",
    "-y",
    outputPath,
  );

  logVideo.step("Componiendo video final...", `${Math.round(audioDuration)}s`);

  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG, args);
    let stderr = "";
    proc.stderr.on("data", d => { stderr += d.toString(); });
    proc.on("close", code => {
      if (code === 0) resolve(`/api/outputs?file=${outputName}`);
      else reject(new Error(`ffmpeg compose failed: ${stderr.slice(-300)}`));
    });
    proc.on("error", () => reject(new Error("ffmpeg not found")));
  });
}

// --- Generate ASS subtitles from script text ---

async function generateScriptSubtitles(
  script: string,
  totalDuration: number,
  outputPath: string
): Promise<void> {
  // Split into short phrases (2-5 words each) for TikTok-style captions
  const words = script.split(/\s+/).filter(Boolean);
  const phrases: string[] = [];
  const WORDS_PER_PHRASE = 3;

  for (let i = 0; i < words.length; i += WORDS_PER_PHRASE) {
    const phrase = words.slice(i, i + WORDS_PER_PHRASE).join(" ");
    if (phrase) phrases.push(phrase);
  }

  const phraseDuration = totalDuration / phrases.length;

  // ASS header with TikTok-style formatting
  let ass = `[Script Info]
Title: AI Generated Subtitles
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,72,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,4,0,2,40,40,400,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  for (let i = 0; i < phrases.length; i++) {
    const start = i * phraseDuration;
    const end = Math.min((i + 1) * phraseDuration, totalDuration);
    const startStr = formatASSTime(start);
    const endStr = formatASSTime(end);
    // Uppercase for impact
    const text = phrases[i]!.toUpperCase();
    ass += `Dialogue: 0,${startStr},${endStr},Default,,0,0,0,,${text}\n`;
  }

  await fs.writeFile(outputPath, ass, "utf-8");
}

function formatASSTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h}:${m.toString().padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}`;
}

// --- Main pipeline ---

export async function generateAIVideo(
  options: AIVideoOptions,
  jobId: string,
  onProgress: (progress: number, message: string) => void
): Promise<{ output: string; script: string }> {
  await ensureDirs();

  // Step 1: Generate script (0% → 15%)
  onProgress(5, "Generando guion con IA...");
  const script = await generateScript(options.topic, options.style);
  onProgress(15, "Guion listo");

  // Step 2: Generate TTS audio (15% → 35%)
  onProgress(20, "Generando voz...");
  const tts = await synthesize(script, jobId, options.voice);
  const audioDuration = await getAudioDuration(tts.audioPath);
  logVideo.info("Duracion real del audio", `${audioDuration.toFixed(1)}s`);
  onProgress(35, "Voz generada");

  // Step 3: Download background video (35% → 60%)
  onProgress(40, "Buscando video de fondo...");
  const bgPath = path.join(TMP_DIR, `${jobId}_bg.mp4`);
  const bg = await downloadBackground(options.background, Math.min(audioDuration, 30), bgPath);
  onProgress(60, "Fondo descargado");

  // Step 4: Compose final video (60% → 95%)
  onProgress(65, "Componiendo video...");
  const output = await composeVideo(
    bg.path, tts.audioPath, audioDuration, bg.duration, script, jobId
  );
  onProgress(95, "Video casi listo...");

  // Cleanup temp files
  await fs.unlink(tts.audioPath).catch(() => {});
  await fs.unlink(bgPath).catch(() => {});
  const assPath = path.join(TMP_DIR, `${jobId}_ai_subs.ass`);
  await fs.unlink(assPath).catch(() => {});

  return { output, script };
}
