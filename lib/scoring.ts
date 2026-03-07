import type { Segment, TranscriptChunk, DetectOptions } from "./types";

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

function sanitizeTitle(raw: string): string {
  return raw
    .replace(/\[[^\]]+\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}


export function scoreTranscriptWindow(
  chunks: TranscriptChunk[],
  windowStart: number,
  windowEnd: number
) {
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

export function buildTitle(text: string): string {
  const cleaned = sanitizeTitle(text);

  // Split by punctuation first, fallback to ~8 word chunks for ASR text without punctuation
  let sentences = cleaned.split(/[.!?]+/).filter(s => s.trim().length > 5);
  if (sentences.length <= 1 && cleaned.length > 60) {
    // ASR text without punctuation — split into word groups
    const words = cleaned.split(/\s+/);
    sentences = [];
    for (let i = 0; i < words.length; i += 8) {
      const chunk = words.slice(i, i + 8).join(" ");
      if (chunk.length > 5) sentences.push(chunk);
    }
  }

  // Prefer sentences/chunks with hooks or intensity words
  const interesting = sentences.find(s => {
    const lower = s.toLowerCase();
    return HOOK_OPENERS.some(h => lower.includes(h))
      || INTENSITY_HIGH.some(w => lower.includes(w))
      || CONTRAST_MARKERS.some(m => lower.includes(m))
      || lower.includes("?");
  });

  const best = interesting || sentences[0];
  if (best) {
    const trimmed = best.trim();
    // Capitalize first letter
    const titled = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
    if (titled.length <= 50) return titled;
    // Cut at last word boundary before 50 chars
    const cut = titled.slice(0, 50).replace(/\s\S*$/, "");
    return (cut || titled.slice(0, 47)) + "...";
  }
  const words = cleaned.split(/\s+/).slice(0, 8).join(" ");
  const titled = words.charAt(0).toUpperCase() + words.slice(1);
  return titled.length > 50 ? titled.slice(0, 47) + "..." : titled;
}

export function generateEvenSegments(
  duration: number,
  count: number = 4,
  segDur: number = 35,
  chunks: TranscriptChunk[] = []
): Segment[] {
  count = Math.min(count, Math.floor(duration / segDur));
  const spacing = duration / (count + 1);
  const segments: Segment[] = [];

  for (let i = 0; i < count; i++) {
    const center = spacing * (i + 1);
    const start = Math.max(0, center - segDur / 2);
    const end = Math.min(duration, start + segDur);

    const windowChunks = chunks.filter(c => c.start >= start && c.end <= end);
    const windowText = windowChunks.map(c => c.text).join(" ");
    const title = windowText ? buildTitle(windowText) : "";
    const reason = windowText
      ? "Segmento con transcripcion disponible"
      : "Segmento auto-detectado";

    segments.push({ start, end, title, reason, score: 0 });
  }

  return segments;
}

export function detectWithHeuristics(
  chunks: TranscriptChunk[],
  videoDuration: number,
  options: DetectOptions
): Segment[] {
  const TARGET_SHORTS = options.targetClips || 4;
  const SHORT_MIN = options.minDuration || 15;
  const SHORT_MAX = (options.maxDuration && options.maxDuration > 0) ? options.maxDuration : 300;
  const STEP = 2;

  // Heuristic scoring across chunks

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
    return generateEvenSegments(videoDuration, TARGET_SHORTS, (SHORT_MIN + SHORT_MAX) / 2, chunks);
  }

  return selected.sort((a, b) => a.start - b.start);
}
