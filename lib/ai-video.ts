// AI Video Generation Pipeline
// Topic/text → Script (AI) → TTS → Background video → Subtitles → Final short

import { spawn } from "child_process";
import path from "path";
import fs from "fs/promises";
import { TMP_DIR, OUTPUT_DIR, FFMPEG, FFPROBE, ensureDirs } from "./config";
import { synthesize, type WordTiming } from "./tts";
import { downloadBackground } from "./pexels";
import { downloadYTBackground } from "./backgrounds";
import { logVideo, logAI } from "./logger";

export interface AIVideoOptions {
  topic: string;
  voice: string;       // voice key from tts.ts
  background: string;  // category key or search term
  style: "story" | "facts" | "motivation" | "news";
}

// --- Generate viral title ---

function generateTitle(script: string, topic: string): string {
  // Split script into sentences and find the most impactful one for a title
  const sentences = script
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 15 && s.length <= 65);

  // Prefer sentences with drama/tension keywords
  const hookWords = /nunca|jamás|increíble|imposible|secreto|verdad|descubr|revel|muerte|muer|sangre|traicion|mentir|destruy|última|peor|mejor|nadie|todo cambió/i;
  const hookSentence = sentences.find(s => hookWords.test(s));
  if (hookSentence) {
    return hookSentence.replace(/[.!?]+$/, "");
  }

  // Fallback: first sentence if short enough
  const firstLine = script.split(/[.\n!?]/)[0]?.trim() || "";
  if (firstLine.length > 15 && firstLine.length <= 60) {
    return firstLine;
  }

  // Last resort: topic
  return topic.length <= 50 ? topic : topic.slice(0, 47) + "...";
}

// --- Script generation with AI ---

async function generateScript(topic: string, style: string): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY not configured");

  const stylePrompts: Record<string, string> = {
    story: `Eres el mejor narrador de historias del mundo. Tu trabajo es crear una historia que sea IMPOSIBLE de dejar de escuchar.

ESTRUCTURA NARRATIVA OBLIGATORIA (sigue CADA paso):

1. GANCHO BRUTAL (primeras 2 frases): Empieza con algo tan impactante que sea fisicamente imposible hacer scroll. Ejemplos: "A las 3 de la madrugada sono mi telefono y lo que escuche me helo la sangre", "Lo que voy a contar paso hace exactamente 47 dias y todavia no puedo dormir por las noches"

2. CONTEXTO INMERSIVO (200-400 palabras): NO me digas "habia un hombre". Dame su nombre, su edad, que hacia ahi, como se sentia. Describe el lugar — la temperatura, los sonidos, los olores. Haz que el oyente ESTE ahi. Construye el mundo donde va a pasar todo. Presenta las relaciones entre personajes. Siembra pistas sutiles de lo que viene.

3. PRIMER PUNTO DE TENSION (200-300 palabras): Algo cambia. Algo no cuadra. Alguien dice algo que no deberia. Un detalle que parecia insignificante ahora cobra sentido. El oyente siente que algo va mal pero no sabe que. Mantén la incertidumbre.

4. ESCALADA Y DESARROLLO (500-800 palabras): AQUI es donde la historia cobra vida. Cada parrafo sube la tension un nivel. Incluye:
   - Dialogos cortos y naturales ("Me miro a los ojos y me dijo: no abras esa puerta")
   - Pensamientos internos del protagonista
   - Detalles fisicos de tension (manos sudando, corazon acelerado, boca seca)
   - Decisiones imposibles que el protagonista debe tomar
   - Al menos un momento donde todo parece resolverse... pero NO
   - Giros que el oyente NO veia venir
   - Consecuencias reales de las acciones

5. CLIMAX DEVASTADOR (200-400 palabras): Todo explota. La verdad sale a la luz. Lo que el oyente pensaba que pasaba NO era lo que realmente pasaba. Este momento debe dejar al oyente literalmente con la boca abierta. Describe cada segundo de este momento con detalle cinematografico.

6. DESENLACE MEMORABLE (100-200 palabras): Cierra la historia de forma que se quede en la mente del oyente. Puede ser una reflexion profunda, una ultima revelacion, algo agridulce, o una frase final que cambie TODO el significado de lo que acaba de escuchar.

USA PRIMERA PERSONA siempre que sea posible. Describe emociones con el cuerpo: "senti un nudo en la garganta", "las piernas me fallaron", "me quede paralizado". NO resumas NUNCA — cada momento importante debe sentirse vivido, detallado, real.`,

    facts: `Presenta 8-12 datos absolutamente INCREIBLES sobre el tema. Pero NO los listes como una wikipedia — cuenta cada dato como una mini-historia:

Para CADA dato:
1. Empieza con algo que suene imposible ("Existe un lugar en la Tierra donde llueve hacia arriba")
2. Da el contexto completo — donde, cuando, quien lo descubrio, por que pasa
3. Compara con algo cotidiano para que se entienda la magnitud ("eso es como si tomaras todo el agua del mediterraneo y...")
4. Explica las implicaciones — por que deberia importarnos
5. Conecta con el siguiente dato creando un hilo narrativo fluido

Cada dato debe tener su propio mini-arco narrativo de al menos 150-300 palabras. El oyente debe sentir que esta descubriendo algo nuevo con cada uno.`,

    motivation: `Crea un discurso motivacional que deje marcas. NO uses cliches como "tu puedes" o "nunca te rindas" sin contexto.

ESTRUCTURA:
1. Empieza con una historia REAL de fracaso brutal — alguien que lo perdio TODO
2. Describe el momento mas oscuro con detalles que el oyente pueda sentir
3. Luego muestra el punto de quiebre — ese momento exacto donde todo cambio
4. Desarrolla paso a paso como esa persona reconstruyo todo, con detalles concretos
5. Alterna entre la historia y reflexiones directas al oyente ("Y seguramente tu ahora mismo estas pensando que es imposible...")
6. Construye hasta un climax emocional con repeticion retorica
7. Cierra con una frase que se quede grabada en la mente

Usa pausas dramaticas (frases cortas despues de parrafos largos). Alterna entre susurro y grito retorico. Haz que cada frase PEGUE.`,

    news: `Presenta esto como un documental investigativo completo:

1. Abre con el dato mas IMPACTANTE de toda la noticia — lo que nadie esperaba
2. Retrocede al principio y cuenta TODA la cronologia con fechas, nombres, lugares
3. Incluye multiples perspectivas — que dijo cada parte involucrada
4. Revela detalles que el publico general NO conoce
5. Analiza las causas profundas — como llegamos a este punto
6. Explica las consecuencias a corto y largo plazo
7. Cierra con una reflexion que conecte con la vida del oyente

Cada seccion debe tener suficiente detalle como para que el oyente sienta que esta viendo un documental de Netflix, no leyendo un tweet.`,
  };

  const prompt = `Genera un guion MUY LARGO, DETALLADO y ENVOLVENTE para un video viral sobre: "${topic}"

ESTILO: ${stylePrompts[style] || stylePrompts.facts}

REGLAS ABSOLUTAS — LEE CADA UNA:
- EXTENSION: entre 800 y 5000 palabras. Apunta a MINIMO 1500 palabras. El guion debe durar entre 3 y 10 minutos hablando. Cuanto mas largo y detallado, MEJOR. NO te limites — escribe TODO lo que la historia necesite
- Empieza DIRECTAMENTE con el gancho. La primera frase decide si el oyente se queda o se va
- Lenguaje 100% natural y coloquial. Como si estuvieras en una fogata contandole la historia a tus amigos. Nada de lenguaje formal ni de enciclopedia
- DESARROLLA cada momento. Si un personaje entra a una habitacion, describe que ve, que huele, que siente. Si alguien dice algo importante, pon el dialogo textual
- NUNCA resumas. NUNCA digas "paso el tiempo" o "despues de varios intentos". CUENTA cada intento, cada momento, cada detalle
- NO uses emojis, hashtags, ni indicaciones de edicion
- NO escribas titulos ni encabezados, solo el texto narrado continuo
- Termina con algo que el oyente NO pueda olvidar
- Escribe UNICAMENTE el texto del guion. NADA mas
- NO empieces con "Aqui tienes", "Vale", "Claro", "Titulo:", "Guion:", ni ninguna meta-introduccion. La PRIMERA palabra debe ser parte del gancho de la historia
- GROSERIAS: puedes usar lenguaje fuerte pero MODERADO (idiota, pendejo, cabron, maldito, imbecil, carajo, demonios, mierda). NUNCA uses insultos sexuales explícitos ni palabras como puto, puta, emp*tado, verga, coger, ni slurs. El audio sera narrado por una voz sintetica y debe sonar natural sin cruzar la linea
- EVITA repetir la misma idea o descripcion mas de una vez. Si ya describiste algo, avanza la historia. Nada de loops narrativos
- Incluye MINIMO 2 giros argumentales inesperados que cambien la direccion de la historia. El oyente debe decir "no me esperaba eso"
- El climax debe ser un momento CONCRETO y dramatico, no una reflexion abstracta. Algo PASA, alguien HACE algo, se revela algo ESPECIFICO`;

  // Models prioritized: Spanish-fluent first, then large output capacity
  // Avoid Chinese-native models (stepfun) — they leak CJK characters in Spanish
  const MODELS = [
    "nousresearch/hermes-3-llama-3.1-405b:free",        // 405B, excellent Spanish
    "meta-llama/llama-3.3-70b-instruct:free",            // 70B, great Spanish
    "qwen/qwen3-next-80b-a3b-instruct:free",             // 80B, good multilingual
    "google/gemma-3-27b-it:free",                         // 27B, solid Spanish
    "mistralai/mistral-small-3.1-24b-instruct:free",     // 24B, European languages
    "arcee-ai/trinity-large-preview:free",                // 131K context
    "arcee-ai/trinity-mini:free",                         // 131K context
    "nvidia/nemotron-3-nano-30b-a3b:free",                // 256K context
    "stepfun/step-3.5-flash:free",                        // 256K output — leaks CJK, last resort
  ];

  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

  for (let i = 0; i < MODELS.length; i++) {
    const model = MODELS[i]!;
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
          temperature: 0.85,
          max_tokens: 16384,
        }),
      });

      if (res.status === 429) {
        // Rate limited — wait before trying next model
        const retryAfter = parseInt(res.headers.get("retry-after") || "0") * 1000;
        const waitMs = Math.max(retryAfter, 3000 + i * 2000); // escalating: 3s, 5s, 7s...
        logAI.warn(`Rate limited (429), esperando ${(waitMs / 1000).toFixed(0)}s...`, model);
        await sleep(waitMs);
        continue;
      }

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
          // Remove CJK characters and AI self-correction loops
          .replace(/[\u2E80-\u9FFF\uF900-\uFAFF]/g, "")                         // strip CJK chars
          .replace(/\(esto es un error[^)]*\)/gi, "")                             // remove "(esto es un error...)"
          .replace(/\([^)]*es chino[^)]*\)/gi, "")                                // remove "(... es chino ...)"
          .replace(/\([^)]*quitadlo[^)]*\)/gi, "")                                // remove "(... quitadlo ...)"
          .replace(/([""][^""]*[""][\s,]*no\s+(sé|se)[^.!?\n]*){2,}/gi, "")       // remove repetitive correction loops
          .replace(/\s{2,}/g, " ")                                                 // collapse multiple spaces
          .trim();

        const wordCount = cleaned.split(/\s+/).length;

        // Reject scripts with too many non-Latin characters (model leaked CJK)
        const cjkCount = (content.match(/[\u2E80-\u9FFF\uF900-\uFAFF]/g) || []).length;
        if (cjkCount > 5) {
          logAI.warn(`Guion contiene ${cjkCount} caracteres CJK, modelo no apto para español`, model);
          continue;
        }

        // Reject scripts that are too short — try next model
        if (wordCount < 600) {
          logAI.warn(`Guion demasiado corto (${wordCount} palabras, minimo 600), probando otro modelo...`, model);
          continue;
        }

        logAI.success("Guion generado", `${wordCount} palabras`);
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

// --- Re-mux a potentially truncated video to fix container ---

async function remuxVideo(input: string, output: string, maxDuration: number): Promise<void> {
  logVideo.step("Re-muxing fondo...", `max ${Math.round(maxDuration)}s`);
  return new Promise((resolve, reject) => {
    const args = [
      "-i", input,
      "-t", Math.ceil(maxDuration + 10).toString(), // trim to needed length + buffer
      "-c", "copy",         // no re-encode, just fix container
      "-movflags", "+faststart",
      "-y", output,
    ];
    const proc = spawn(FFMPEG, args);
    let stderr = "";
    proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
    proc.on("close", (code) => {
      if (code === 0) {
        logVideo.success("Fondo re-muxed OK");
        resolve();
      } else {
        logVideo.error("Re-mux failed:", stderr.slice(-300));
        reject(new Error(`ffmpeg remux failed: ${stderr.slice(-300)}`));
      }
    });
    proc.on("error", () => reject(new Error("ffmpeg not found for remux")));
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
  // 2. Anti-detection: hflip + speed shift + color shift + grain
  // 3. Scale to 1080x1920 (portrait)
  // 4. Overlay subtitles
  // 5. Strip metadata
  // 6. Mix with TTS audio
  const escapedAss = assPath.replace(/\\/g, "/").replace(/:/g, "\\:");

  // If background is shorter than audio, loop it
  const needsLoop = bgDuration < audioDuration;

  // Random anti-detection parameters (vary per video)
  const speedFactor = 1.03 + Math.random() * 0.04;    // 1.03x – 1.07x
  const hueShift = Math.floor(5 + Math.random() * 15); // 5° – 20° hue rotation
  const satBoost = (1.05 + Math.random() * 0.15).toFixed(2); // 1.05 – 1.20
  const brightness = (Math.random() > 0.5 ? 0.02 : -0.02).toFixed(2); // slight +/- brightness

  // Video filter chain: anti-detection → scale → subtitles
  const vf = [
    `setpts=${(1 / speedFactor).toFixed(4)}*PTS`,       // slight speed up
    "hflip",                                              // mirror
    `hue=h=${hueShift}:s=${satBoost}:b=${brightness}`,   // color shift
    "noise=c0s=3:c0f=t",                                  // subtle film grain
    "scale=1080:1920:force_original_aspect_ratio=increase",
    "crop=1080:1920",
    `ass='${escapedAss}'`,
  ].join(",");

  logVideo.info("Anti-deteccion:", `speed=${speedFactor.toFixed(2)}x hue=${hueShift}° sat=${satBoost} grain=3`);

  const args: string[] = [];

  if (needsLoop) {
    args.push("-stream_loop", "-1"); // infinite loop
  }
  args.push("-i", bgVideoPath);        // input 0: background video
  args.push("-i", audioPath);           // input 1: TTS audio
  args.push("-t", audioDuration.toFixed(2)); // trim to audio length
  args.push(
    "-vf", vf,
    "-map", "0:v:0",                    // video from background
    "-map", "1:a:0",                    // audio from TTS
    "-c:v", "libx264",
    "-preset", audioDuration > 180 ? "ultrafast" : "fast", // ultrafast for long videos to avoid OOM
    "-crf", audioDuration > 180 ? "23" : "21",
    "-c:a", "aac",
    "-b:a", "192k",
    "-map_metadata", "-1",              // strip all metadata
    "-fflags", "+bitexact",             // deterministic output, no fingerprint leaks
    "-movflags", "+faststart",
    "-shortest",
    "-y",
    outputPath,
  );

  logVideo.step("Componiendo video final...", `${Math.round(audioDuration)}s`);
  logVideo.info("ffmpeg args:", args.join(" "));

  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG, args);
    let stderr = "";
    let lastProgress = "";

    proc.stderr.on("data", (d: Buffer) => {
      const chunk = d.toString();
      stderr += chunk;

      // Log ffmpeg progress lines (contain "time=" or "frame=")
      const lines = chunk.split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.includes("time=") || trimmed.includes("frame=")) {
          // Only log every ~10s of progress to avoid spam
          const timeMatch = trimmed.match(/time=(\d+:\d+:\d+)/);
          if (timeMatch && timeMatch[1] && timeMatch[1] !== lastProgress) {
            lastProgress = timeMatch[1]!
            logVideo.info("ffmpeg progress:", lastProgress);
          }
        } else if (trimmed && !trimmed.startsWith("frame=") && trimmed.length > 5) {
          // Log any non-progress stderr (errors, warnings)
          logVideo.warn("ffmpeg stderr:", trimmed.slice(0, 200));
        }
      }
    });

    proc.on("close", (code, signal) => {
      if (code === 0) {
        logVideo.success("Video compuesto", outputName);
        resolve(`/api/outputs?file=${outputName}`);
      } else {
        const reason = signal
          ? `killed by signal ${signal} (likely OOM)`
          : `exit code ${code}`;
        logVideo.error(`ffmpeg compose failed: ${reason}`);
        logVideo.error("ffmpeg last stderr:", stderr.slice(-500));
        reject(new Error(`ffmpeg compose failed (${reason}): ${stderr.slice(-300)}`));
      }
    });

    proc.on("error", (err) => {
      logVideo.error("ffmpeg spawn error:", err.message);
      reject(new Error(`ffmpeg not found: ${err.message}`));
    });
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
): Promise<{ output: string; script: string; title: string }> {
  await ensureDirs();

  // Step 1: Generate script (0% → 15%)
  onProgress(5, "Generando guion con IA...");
  const script = await generateScript(options.topic, options.style);
  const title = generateTitle(script, options.topic);
  logVideo.info("Titulo generado", title);
  onProgress(15, "Guion listo");

  // Step 2: Generate TTS audio (15% → 35%)
  onProgress(20, "Generando voz...");
  const tts = await synthesize(script, jobId, options.voice);
  const audioDuration = await getAudioDuration(tts.audioPath);
  logVideo.info("Duracion real del audio", `${audioDuration.toFixed(1)}s`);
  onProgress(35, "Voz generada");

  // Step 3: Download background video (35% → 60%)
  onProgress(40, "Descargando video de fondo...");
  const bgRawPath = path.join(TMP_DIR, `${jobId}_bg_raw.mp4`);
  const bgPath = path.join(TMP_DIR, `${jobId}_bg.mp4`);
  let bg: { path: string; duration: number };
  if (options.background === "parkour") {
    // Free YT parkour videos (OrbitalNCG, no copyright)
    bg = await downloadYTBackground(audioDuration, bgRawPath);
  } else {
    // Pexels stock videos for other categories
    bg = await downloadBackground(options.background, audioDuration, bgRawPath);
  }

  // Re-mux downloaded video to fix potentially truncated/corrupt container
  onProgress(55, "Preparando video de fondo...");
  await remuxVideo(bgRawPath, bgPath, audioDuration);
  await fs.unlink(bgRawPath).catch(() => {});
  bg.path = bgPath;

  // Get actual background duration via ffprobe
  try {
    bg.duration = await getAudioDuration(bgPath);
    logVideo.info("Duracion real del fondo", `${bg.duration.toFixed(1)}s`);
  } catch {
    logVideo.warn("No se pudo leer duracion del fondo, usando estimada");
  }
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

  return { output, script, title };
}
