// AI Video Generation Pipeline
// Topic/text → Script (AI) → TTS → Background video → Subtitles → Final short

import { spawn } from "child_process";
import path from "path";
import fs from "fs/promises";
import { TMP_DIR, OUTPUT_DIR, FFMPEG, FFPROBE, ensureDirs } from "./config";
import { synthesize, type WordTiming } from "./tts";
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
- Duracion del texto: entre 200 y 350 palabras (60-120 segundos al hablar). Para historias, usa MINIMO 300 palabras
- Empieza con un GANCHO que atrape en los primeros 3 segundos
- Lenguaje natural y coloquial, como si hablaras con un amigo
- NO uses emojis, hashtags, ni indicaciones de edicion
- NO escribas titulos, solo el texto narrado
- Termina con algo memorable o un llamado a la accion
- Escribe SOLO el texto del guion, nada mas
- NO empieces con "Aqui tienes", "Vale", "Claro", "Titulo:", ni ninguna introduccion. Empieza DIRECTAMENTE con el gancho del video`;

  const MODELS = [
    "qwen/qwen3-next-80b-a3b-instruct:free",
    "openai/gpt-oss-120b:free",
    "nousresearch/hermes-3-llama-3.1-405b:free",
    "google/gemma-3-27b-it:free",
    "meta-llama/llama-3.3-70b-instruct:free",
    "stepfun/step-3.5-flash:free",
    "mistralai/mistral-small-3.1-24b-instruct:free",
    "nvidia/nemotron-3-nano-30b-a3b:free",
    "qwen/qwen3-4b:free",
    "google/gemma-3-12b-it:free",
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
          max_tokens: 2000,
        }),
      });

      if (!res.ok) {
        logAI.warn(`Modelo fallido (${res.status})`, model);
        continue;
      }

      const data: any = await res.json();
      const content = data.choices?.[0]?.message?.content?.trim();
      if (content && content.length > 50) {
        // Clean up AI preamble, markdown, thinking tags
        const cleaned = content
          .replace(/<think>[\s\S]*?<\/think>/g, "")
          .replace(/^```[\s\S]*?```$/gm, "")
          .replace(/^#+\s/gm, "")
          .replace(/^\*\*/gm, "")
          .replace(/\*\*/g, "")
          // Remove common AI preambles before the actual script
          .replace(/^(vale|ok|claro|aqu[ií]|bien|listo|perfecto|por supuesto)[^.!?\n]*?(guion|historia|texto|script|narración)[^.!?\n]*?[.:!\n]/i, "")
          .replace(/^(here'?s?|sure|okay)[^.!?\n]*?(script|story|text)[^.!?\n]*?[.:!\n]/i, "")
          // Remove lines that are just labels like "Guion:", "Historia:", etc.
          .replace(/^\s*(guion|historia|texto|script|narración|título|title)\s*[:]\s*\n?/gim, "")
          .replace(/^\s*---+\s*$/gm, "")
          .trim();

        logAI.success("Guion generado", `${cleaned.split(/\s+/).length} palabras`);
        logAI.info("--- GUION ---");
        console.log(cleaned);
        logAI.info("--- FIN GUION ---");
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
  words: WordTiming[],
  jobId: string,
): Promise<string> {
  await ensureDirs();
  const outputName = `${jobId}_ai_short.mp4`;
  const outputPath = path.join(OUTPUT_DIR, outputName);

  // Generate ASS subtitle file with precise word timing and color highlight
  const assPath = path.join(TMP_DIR, `${jobId}_ai_subs.ass`);
  await generateScriptSubtitles(words, audioDuration, assPath);

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

// --- Generate ASS subtitles with precise word timing and color highlight ---

// Accent color in ASS BGR format (FF5C35 → 355CFF in BGR)
const HIGHLIGHT_COLOR = "&H00355CFF&";
const NORMAL_COLOR = "&H00FFFFFF&";

async function generateScriptSubtitles(
  words: WordTiming[],
  totalDuration: number,
  outputPath: string
): Promise<void> {
  if (words.length === 0) {
    await fs.writeFile(outputPath, "", "utf-8");
    return;
  }

  // Group words into phrases of 3-4 words based on timing
  const WORDS_PER_PHRASE = 3;
  const phrases: { words: WordTiming[]; start: number; end: number }[] = [];

  for (let i = 0; i < words.length; i += WORDS_PER_PHRASE) {
    const chunk = words.slice(i, i + WORDS_PER_PHRASE);
    phrases.push({
      words: chunk,
      start: chunk[0]!.start,
      end: chunk[chunk.length - 1]!.end,
    });
  }

  // ASS header
  let ass = `[Script Info]
Title: AI Generated Subtitles
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,72,${NORMAL_COLOR},&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,4,0,2,40,40,400,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  // For each phrase, generate one dialogue line per word (with karaoke highlight)
  // Each word gets its own timing — the full phrase shows but the active word is colored
  for (const phrase of phrases) {
    for (let w = 0; w < phrase.words.length; w++) {
      const activeWord = phrase.words[w]!;
      const start = activeWord.start;
      const end = activeWord.end;

      // Build text with highlight on the active word
      const parts = phrase.words.map((word, idx) => {
        const upper = word.text.toUpperCase();
        if (idx === w) {
          return `{\\c${HIGHLIGHT_COLOR}}${upper}{\\c${NORMAL_COLOR}}`;
        }
        return upper;
      });

      ass += `Dialogue: 0,${formatASSTime(start)},${formatASSTime(end)},Default,,0,0,0,,${parts.join(" ")}\n`;
    }
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
    bg.path, tts.audioPath, audioDuration, bg.duration, tts.words, jobId
  );
  onProgress(95, "Video casi listo...");

  // Cleanup temp files
  await fs.unlink(tts.audioPath).catch(() => {});
  await fs.unlink(bgPath).catch(() => {});
  const assPath = path.join(TMP_DIR, `${jobId}_ai_subs.ass`);
  await fs.unlink(assPath).catch(() => {});

  return { output, script };
}
