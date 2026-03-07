import type { Segment, TranscriptChunk, DetectOptions } from "./types";
import { formatTime } from "./types";
import { detectWithHeuristics, generateEvenSegments } from "./scoring";
import { logAI } from "./logger";

function buildTimedTranscript(chunks: TranscriptChunk[]): string {
  if (chunks.length === 0) return "";

  const blocks: string[] = [];
  let blockStart = chunks[0]!.start;
  let blockTexts: string[] = [];

  for (const c of chunks) {
    if (c.start - blockStart > 15 && blockTexts.length > 0) {
      blocks.push(`[${formatTime(blockStart)}] ${blockTexts.join(" ")}`);
      blockStart = c.start;
      blockTexts = [];
    }
    const prev = blockTexts[blockTexts.length - 1];
    if (!prev || !c.text.includes(prev)) {
      blockTexts.push(c.text);
    }
  }
  if (blockTexts.length > 0) {
    blocks.push(`[${formatTime(blockStart)}] ${blockTexts.join(" ")}`);
  }

  return blocks.join("\n");
}

function safeSegmentTitle(title: string | undefined, start: number, end: number, index: number): string {
  const clean = (title || "")
    .replace(/\[[^\]]+\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (clean && !/^short\s*#?\s*\d+$/i.test(clean)) {
    return clean.slice(0, 60);
  }

  const startTs = formatTime(start);
  const endTs = formatTime(end);
  return `Clip ${index + 1} (${startTs}-${endTs})`;
}

async function detectWithAI(
  chunks: TranscriptChunk[],
  videoDuration: number,
  options: DetectOptions
): Promise<Segment[] | null> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    logAI.warn("Sin OPENROUTER_API_KEY — omitiendo deteccion IA");
    return null;
  }

  const TARGET = options.targetClips || 4;
  const MIN_DUR = options.minDuration || 15;
  const MAX_DUR = options.maxDuration || 0;
  const freeLength = !MAX_DUR || MAX_DUR <= 0;

  const transcript = buildTimedTranscript(chunks);
  if (!transcript) return null;

  const durationRule = freeLength
    ? `- Cada clip debe durar MINIMO ${MIN_DUR}s. NO hay limite maximo. Haz clips LARGOS: 90s, 120s, 150s o mas. NO hagas clips de exactamente ${MIN_DUR}s — eso es el minimo, no el objetivo. Busca momentos completos que duren lo que necesiten. Prefiere clips de 90-180s.`
    : `- Cada clip debe durar entre ${MIN_DUR}s y ${MAX_DUR}s`;

  const prompt = `Eres un experto en contenido viral para TikTok y YouTube Shorts. Analiza esta transcripción de un video y encuentra los ${TARGET} mejores momentos para hacer shorts verticales virales.

REGLAS:
${durationRule}
- El video dura ${formatTime(videoDuration)} (${Math.round(videoDuration)}s total)
- Busca: momentos de tensión, humor, drama, reacciones fuertes, giros inesperados, frases impactantes, conflicto, confesiones
- Los clips NO deben solaparse (mínimo 10s de separación)
- El inicio del clip debe tener un "gancho" — algo que atrape al espectador en los primeros 3 segundos
- Genera un título VIRAL corto para cada clip (máx 50 chars, estilo TikTok, usa emojis si queda bien)

TRANSCRIPCIÓN:
${transcript}

Responde SOLO con un JSON array, sin explicaciones ni markdown:
[{"start": SEGUNDOS, "end": SEGUNDOS, "title": "título viral", "reason": "por qué es viral"}]`;

  try {
    logAI.step("Iniciando deteccion con IA...");

    const MODELS = [
      "google/gemma-3-27b-it:free",
      "meta-llama/llama-3.3-70b-instruct:free",
      "qwen/qwen3-4b:free",
      "mistralai/mistral-small-3.1-24b-instruct:free",
    ];

    let data: any = null;
    for (const model of MODELS) {
      logAI.info(`Probando modelo`, model);
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
          temperature: 0.7,
          max_tokens: 2000,
        }),
      });

      if (res.ok) {
        data = await res.json();
        if (data.choices?.[0]?.message?.content) {
          logAI.success(`Respuesta recibida`, model);
          break;
        }
      } else {
        logAI.warn(`Modelo fallido (${res.status})`, model);
      }
      data = null;
    }

    if (!data) {
      logAI.error("Todos los modelos fallaron");
      return null;
    }

    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) return null;

    logAI.debug("Respuesta IA", content.slice(0, 120) + "...");

    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]) as Array<{
      start: number; end: number; title: string; reason: string;
    }>;

    const segments: Segment[] = [];
    for (const seg of parsed) {
      const start = Number(seg.start);
      const end = Number(seg.end);
      const duration = end - start;

      if (
        isNaN(start) || isNaN(end) ||
        start < 0 || end > videoDuration + 5 ||
        duration < MIN_DUR - 5 || (!freeLength && duration > MAX_DUR + 10)
      ) continue;

      const overlaps = segments.some(
        (s) => start < s.end + 10 && end > s.start - 10
      );
      if (overlaps) continue;

      const idx = segments.length;
      segments.push({
        start: Math.max(0, start),
        end: Math.min(videoDuration, end),
        title: safeSegmentTitle(seg.title, start, end, idx),
        reason: (seg.reason || "AI detected").slice(0, 100),
        score: 100 - idx * 10,
      });

      if (segments.length >= TARGET) break;
    }

    if (segments.length === 0) return null;

    for (const seg of segments) {
      logAI.info(`Momento: ${formatTime(seg.start)}-${formatTime(seg.end)}`, `"${seg.title}"`);
    }

    return segments.sort((a, b) => a.start - b.start);
  } catch (err: any) {
    logAI.error("Deteccion IA fallida", err.message);
    return null;
  }
}

export async function detectBestMoments(
  chunks: TranscriptChunk[],
  videoDuration: number,
  options: DetectOptions = {}
): Promise<Segment[]> {
  const TARGET = options.targetClips || 4;
  const MIN = options.minDuration || 15;
  const freeLength = !options.maxDuration || options.maxDuration <= 0;
  const MAX = freeLength ? 300 : options.maxDuration!;

  if (chunks.length === 0) {
    logAI.warn("Sin transcripcion — usando segmentos equidistantes");
    return generateEvenSegments(videoDuration, TARGET, (MIN + MAX) / 2, []);
  }

  const aiSegments = await detectWithAI(chunks, videoDuration, options);
  if (aiSegments && aiSegments.length >= 2) {
    logAI.success(`Usando segmentos IA`, `${aiSegments.length} detectados`);
    return aiSegments;
  }

  logAI.info("Fallback a scoring heuristico");
  return detectWithHeuristics(chunks, videoDuration, options);
}
