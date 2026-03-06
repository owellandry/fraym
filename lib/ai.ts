import fs from "fs/promises";

interface Segment {
  start: number;
  end: number;
  title: string;
  reason: string;
  score: number;
}

interface TranscriptChunk {
  text: string;
  start: number;
  end: number;
}

// ==========================================
// SUBTITLE PARSING
// ==========================================

export async function parseSubtitles(subtitlePath: string): Promise<TranscriptChunk[]> {
  const content = await fs.readFile(subtitlePath, "utf-8");
  const chunks: TranscriptChunk[] = [];
  const timeRegex = /(\d{1,2}:?\d{2}:\d{2}[.,]\d{3})\s*-->\s*(\d{1,2}:?\d{2}:\d{2}[.,]\d{3})/g;
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const match = timeRegex.exec(lines[i]!);
    if (match) {
      const start = parseTimestamp(match[1]!);
      const end = parseTimestamp(match[2]!);
      const textLines: string[] = [];
      for (let j = i + 1; j < lines.length; j++) {
        const line = lines[j]!.trim();
        if (line === "" || /\d{1,2}:?\d{2}:\d{2}/.test(line)) break;
        const clean = line.replace(/<[^>]+>/g, "").replace(/\{[^}]+\}/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
        if (clean && !/^\d+$/.test(clean)) textLines.push(clean);
      }
      const text = textLines.join(" ").trim();
      if (text) chunks.push({ text, start, end });
      timeRegex.lastIndex = 0;
    }
  }

  // Deduplicate repeated lines (YouTube auto-subs do this a lot)
  const deduped: TranscriptChunk[] = [];
  for (const chunk of chunks) {
    const last = deduped[deduped.length - 1];
    if (last && last.text === chunk.text) {
      last.end = chunk.end;
    } else {
      deduped.push({ ...chunk });
    }
  }

  return deduped;
}

function parseTimestamp(ts: string): number {
  const parts = ts.replace(",", ".").split(":");
  if (parts.length === 3) {
    return parseFloat(parts[0]!) * 3600 + parseFloat(parts[1]!) * 60 + parseFloat(parts[2]!);
  }
  return parseFloat(parts[0]!) * 60 + parseFloat(parts[1]!);
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// ==========================================
// OPENROUTER AI — SMART MOMENT DETECTION
// ==========================================

function buildTimedTranscript(chunks: TranscriptChunk[]): string {
  // Group chunks into ~15s blocks for readability
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
    // Skip if text is substring of previous (YouTube auto-sub duplication)
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

interface DetectOptions {
  targetClips?: number;
  minDuration?: number;
  maxDuration?: number;
}

async function detectWithAI(
  chunks: TranscriptChunk[],
  videoDuration: number,
  options: DetectOptions
): Promise<Segment[] | null> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.log("[ShortsAI] No OPENROUTER_API_KEY, skipping AI detection");
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
    console.log("[ShortsAI] Calling AI for moment detection...");

    // Try models in order — free tiers have rate limits
    const MODELS = [
      "google/gemma-3-27b-it:free",
      "meta-llama/llama-3.3-70b-instruct:free",
      "qwen/qwen3-4b:free",
      "mistralai/mistral-small-3.1-24b-instruct:free",
    ];

    let data: any = null;
    for (const model of MODELS) {
      console.log(`[ShortsAI] Trying model: ${model}`);
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://shortsai.app",
          "X-Title": "ShortsAI",
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
          console.log(`[ShortsAI] Got response from ${model}`);
          break;
        }
      } else {
        const err = await res.text();
        console.log(`[ShortsAI] ${model} failed (${res.status}), trying next...`);
      }
      data = null;
    }

    if (!data) {
      console.log("[ShortsAI] All AI models failed");
      return null;
    }
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) {
      console.log("[ShortsAI] AI returned empty response");
      return null;
    }

    console.log("[ShortsAI] AI response:", content.slice(0, 200));

    // Extract JSON from response (handle potential markdown wrapping)
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.log("[ShortsAI] Could not extract JSON from AI response");
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]) as Array<{
      start: number;
      end: number;
      title: string;
      reason: string;
    }>;

    // Validate and clean segments
    const segments: Segment[] = [];
    for (const seg of parsed) {
      const start = Number(seg.start);
      const end = Number(seg.end);
      const duration = end - start;

      if (
        isNaN(start) || isNaN(end) ||
        start < 0 || end > videoDuration + 5 ||
        duration < MIN_DUR - 5 || (!freeLength && duration > MAX_DUR + 10)
      ) {
        console.log(`[ShortsAI] Skipping invalid segment: ${start}-${end}`);
        continue;
      }

      // Check overlap with already selected
      const overlaps = segments.some(
        (s) => start < s.end + 10 && end > s.start - 10
      );
      if (overlaps) continue;

      segments.push({
        start: Math.max(0, start),
        end: Math.min(videoDuration, end),
        title: (seg.title || "").slice(0, 60),
        reason: (seg.reason || "AI detected").slice(0, 100),
        score: 100 - segments.length * 10, // AI-ranked order
      });

      if (segments.length >= TARGET) break;
    }

    if (segments.length === 0) {
      console.log("[ShortsAI] AI returned no valid segments");
      return null;
    }

    for (const seg of segments) {
      console.log(`[ShortsAI] AI picked: ${formatTime(seg.start)}-${formatTime(seg.end)} "${seg.title}"`);
    }

    return segments.sort((a, b) => a.start - b.start);
  } catch (err: any) {
    console.log(`[ShortsAI] AI detection failed: ${err.message}`);
    return null;
  }
}

// ==========================================
// MAIN ENTRY — AI-first with heuristic fallback
// ==========================================

export async function detectBestMoments(
  chunks: TranscriptChunk[],
  videoDuration: number,
  options: DetectOptions = {}
): Promise<Segment[]> {
  const TARGET_SHORTS = options.targetClips || 4;
  const SHORT_MIN = options.minDuration || 15;
  const freeLength = !options.maxDuration || options.maxDuration <= 0;
  const SHORT_MAX = freeLength ? 300 : options.maxDuration!;

  if (chunks.length === 0) {
    console.log("[ShortsAI] No transcript, using evenly spaced segments");
    return generateEvenSegments(videoDuration, TARGET_SHORTS, (SHORT_MIN + SHORT_MAX) / 2);
  }

  // Try AI detection first
  const aiSegments = await detectWithAI(chunks, videoDuration, options);
  if (aiSegments && aiSegments.length >= 2) {
    console.log(`[ShortsAI] Using AI-detected segments (${aiSegments.length})`);
    return aiSegments;
  }

  // Fallback to heuristic scoring
  console.log("[ShortsAI] Falling back to heuristic scoring");
  return detectWithHeuristics(chunks, videoDuration, options);
}

// ==========================================
// HEURISTIC FALLBACK
// ==========================================

function detectWithHeuristics(
  chunks: TranscriptChunk[],
  videoDuration: number,
  options: DetectOptions
): Segment[] {
  const TARGET_SHORTS = options.targetClips || 4;
  const SHORT_MIN = options.minDuration || 15;
  const SHORT_MAX = (options.maxDuration && options.maxDuration > 0) ? options.maxDuration : 300;
  const STEP = 2;

  console.log(`[ShortsAI] Heuristic: analyzing ${chunks.length} chunks`);

  interface ScoredWindow {
    start: number;
    end: number;
    score: number;
    text: string;
    reasons: string[];
  }

  const windows: ScoredWindow[] = [];

  for (let winStart = 0; winStart < videoDuration - SHORT_MIN; winStart += STEP) {
    const range = SHORT_MAX - SHORT_MIN;
    const windowSizes = [
      SHORT_MIN,
      SHORT_MIN + Math.floor(range * 0.33),
      SHORT_MIN + Math.floor(range * 0.66),
      SHORT_MAX,
    ];
    for (const winDuration of windowSizes) {
      const winEnd = winStart + winDuration;
      if (winEnd > videoDuration) continue;

      const windowChunks = chunks.filter(c => c.start >= winStart && c.end <= winEnd);
      if (windowChunks.length < 2) continue;

      const { score, reasons } = scoreTranscriptWindow(chunks, winStart, winEnd);

      if (score > 10) {
        const firstChunk = windowChunks[0]!;
        const lastChunk = windowChunks[windowChunks.length - 1]!;
        const snappedStart = Math.max(0, firstChunk.start - 0.5);
        const snappedEnd = Math.min(videoDuration, lastChunk.end + 0.3);
        const snappedDuration = snappedEnd - snappedStart;

        if (snappedDuration >= SHORT_MIN && snappedDuration <= SHORT_MAX + 5) {
          const text = windowChunks.map(c => c.text).join(" ");
          windows.push({ start: snappedStart, end: snappedEnd, score, text, reasons });
        }
      }
    }
  }

  windows.sort((a, b) => b.score - a.score);

  const MIN_GAP = 10;
  const selected: Segment[] = [];

  for (const win of windows) {
    if (selected.length >= TARGET_SHORTS) break;
    const overlaps = selected.some(
      (s) => win.start < s.end + MIN_GAP && win.end > s.start - MIN_GAP
    );
    if (overlaps) continue;

    selected.push({
      start: win.start,
      end: win.end,
      title: buildTitle(win.text),
      reason: win.reasons.slice(0, 3).join(" / ") || "High engagement score",
      score: win.score,
    });
  }

  if (selected.length < 2) {
    return generateEvenSegments(videoDuration, TARGET_SHORTS, (SHORT_MIN + SHORT_MAX) / 2);
  }

  return selected.sort((a, b) => a.start - b.start);
}

// ==========================================
// SCORING HELPERS
// ==========================================

const HOOK_OPENERS = [
  "les voy a contar", "les cuento", "esto es", "miren esto",
  "no van a creer", "no vas a creer", "sabían que", "sabias que",
  "la verdad es que", "el problema es", "lo que pasa es",
  "aqui viene", "aquí viene", "atencion", "atención",
  "esto es increible", "lo mas importante", "lo más importante",
  "primer lugar", "segundo lugar", "tercer lugar",
  "número uno", "numero uno", "el secreto es",
  "la clave es", "lo que nadie te dice", "nadie habla de",
  "let me tell you", "here's the thing", "the truth is",
  "what nobody tells you", "the secret is", "number one",
  "listen", "watch this", "check this out",
];

const INTENSITY_HIGH = [
  "increible", "increíble", "impresionante", "terrible", "horrible",
  "espectacular", "brutal", "bestial", "tremendo", "absurdo",
  "imposible", "perfecto", "desastre", "catastrofe", "catástrofe",
  "genio", "genial", "locura", "maravilla", "pesadilla",
  "unbelievable", "incredible", "insane", "crazy", "amazing",
  "terrible", "horrible", "perfect", "disaster", "genius",
  "nightmare", "mind-blowing", "game-changer", "breakthrough",
];

const INTENSITY_MED = [
  "importante", "interesante", "diferente", "especial", "unico", "único",
  "mejor", "peor", "grande", "grave", "serio", "clave", "fundamental",
  "secreto", "truco", "error", "problema", "solucion", "solución",
  "gratis", "dinero", "ganar", "perder", "cambiar", "transformar",
  "important", "interesting", "different", "special", "unique",
  "best", "worst", "serious", "key", "secret", "trick", "mistake",
  "problem", "solution", "free", "money",
];

const CONTRAST_MARKERS = [
  "pero", "sin embargo", "aunque", "resulta que", "en realidad",
  "la verdad", "el problema", "lo curioso", "lo interesante",
  "lo peor", "lo mejor", "lo raro", "lo increible",
  "but", "however", "actually", "turns out", "the truth",
  "the problem", "the thing is", "in reality", "plot twist",
];

function scoreTranscriptWindow(chunks: TranscriptChunk[], windowStart: number, windowEnd: number) {
  let score = 0;
  const reasons: string[] = [];
  const windowText = chunks
    .filter(c => c.start >= windowStart && c.end <= windowEnd)
    .map(c => c.text)
    .join(" ");
  const lower = windowText.toLowerCase();
  const words = windowText.split(/\s+/).filter(Boolean);
  const duration = windowEnd - windowStart;

  if (words.length === 0) return { score: 0, reasons: [] as string[] };

  const wordsPerSecond = words.length / duration;
  if (wordsPerSecond > 3.5) { score += 15; reasons.push("Ritmo alto"); }
  else if (wordsPerSecond > 2.5) { score += 8; }
  else if (wordsPerSecond < 1.0) { score -= 5; }

  const windowChunks = chunks.filter(c => c.start >= windowStart && c.start < windowStart + 5);
  const openingText = windowChunks.map(c => c.text).join(" ").toLowerCase();
  for (const hook of HOOK_OPENERS) {
    if (openingText.includes(hook)) { score += 20; reasons.push(`Hook: "${hook}"`); break; }
  }

  let intensityHits = 0;
  for (const word of INTENSITY_HIGH) { if (lower.includes(word)) { score += 10; intensityHits++; } }
  for (const word of INTENSITY_MED) { if (lower.includes(word)) { score += 5; intensityHits++; } }
  if (intensityHits >= 3) { score += 10; reasons.push(`${intensityHits} palabras intensas`); }

  for (const marker of CONTRAST_MARKERS) {
    if (lower.includes(marker)) { score += 12; reasons.push("Giro/contraste"); break; }
  }

  const questions = (windowText.match(/\?/g) || []).length;
  if (questions >= 2) { score += 10; reasons.push("Preguntas"); }
  else if (questions === 1) { score += 5; }

  const exclamations = (windowText.match(/!/g) || []).length;
  if (exclamations >= 2) { score += 8; reasons.push("Alta energia"); }
  else if (exclamations === 1) { score += 3; }

  if (words.length > 80) { score += 6; }
  else if (words.length > 50) { score += 3; }
  else if (words.length < 15) { score -= 10; }

  const sentences = windowText.split(/[.!?]+/).filter(s => s.trim().length > 0);
  if (sentences.length >= 3) {
    const lengths = sentences.map(s => s.trim().split(/\s+/).length);
    if (Math.max(...lengths) - Math.min(...lengths) > 8) { score += 6; reasons.push("Ritmo variado"); }
  }

  if (/\b(primero|segundo|tercero|uno|dos|tres|first|second|third)\b/i.test(windowText)) {
    score += 7; reasons.push("Lista");
  }

  return { score, reasons };
}

function buildTitle(text: string): string {
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 5);
  if (sentences.length > 0) {
    const first = sentences[0]!.trim();
    if (first.length <= 50) return first;
    return first.slice(0, 47) + "...";
  }
  const words = text.split(/\s+/).slice(0, 8).join(" ");
  return words.length > 50 ? words.slice(0, 47) + "..." : words;
}

function generateEvenSegments(duration: number, count: number = 4, segDur: number = 35): Segment[] {
  count = Math.min(count, Math.floor(duration / segDur));
  const spacing = duration / (count + 1);
  const segments: Segment[] = [];

  for (let i = 0; i < count; i++) {
    const center = spacing * (i + 1);
    const start = Math.max(0, center - segDur / 2);
    const end = Math.min(duration, start + segDur);
    segments.push({
      start, end,
      title: `Momento ${i + 1}`,
      reason: "Segmento distribuido",
      score: 0,
    });
  }

  return segments;
}
