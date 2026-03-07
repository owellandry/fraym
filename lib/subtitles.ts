// Generates ASS subtitles with word-by-word highlight for TikTok-style captions
// Parses YouTube VTT inline word timestamps for precise sync
import fs from "fs/promises";
import path from "path";

interface WordTiming {
  word: string;
  start: number; // seconds (absolute)
  end: number;
}

const TMP_DIR = path.join(process.cwd(), "tmp");

function sanitizeCaptionText(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/\[[^\]]+\]/g, " ")
    .replace(/pasted\s*text\s*#?\d+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ==========================================
// VTT WORD-LEVEL PARSING
// ==========================================

function parseVttTimestamp(ts: string): number {
  const parts = ts.replace(",", ".").split(":");
  if (parts.length === 3) {
    return parseFloat(parts[0]!) * 3600 + parseFloat(parts[1]!) * 60 + parseFloat(parts[2]!);
  }
  return parseFloat(parts[0]!) * 60 + parseFloat(parts[1]!);
}

// Parse YouTube VTT with inline word timestamps
// Format: text<00:00:00.320><c> word</c><00:00:00.560><c> word2</c>
function parseVttWordTimings(vttContent: string): WordTiming[] {
  const allWords: WordTiming[] = [];
  const lines = vttContent.split("\n");
  const cueTimeRegex = /^(\d{1,2}:?\d{2}:\d{2}[.,]\d{3})\s*-->\s*(\d{1,2}:?\d{2}:\d{2}[.,]\d{3})/;

  for (let i = 0; i < lines.length; i++) {
    const timeMatch = cueTimeRegex.exec(lines[i]!);
    if (!timeMatch) continue;

    const cueStart = parseVttTimestamp(timeMatch[1]!);
    const cueEnd = parseVttTimestamp(timeMatch[2]!);

    // YouTube auto-subs have 2 text lines per cue:
    // Line 1: previous text (plain, no timestamps) — SKIP
    // Line 2: new text WITH inline timestamps — PARSE THIS
    // Some cues are "echo" cues (duration ~0.01s) with just plain text — skip those too
    if (cueEnd - cueStart < 0.05) continue;

    // Collect text lines for this cue
    const textLines: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j]!;
      if (line.trim() === "") break;
      if (cueTimeRegex.test(line)) break;
      textLines.push(line);
    }

    if (textLines.length === 0) continue;

    // Take the line with inline timestamps (contains <c> tags)
    // In 2-line cues, it's the second line. In single-line cues, it's the first.
    let timedLine = "";
    for (const tl of textLines) {
      if (tl.includes("<c>") || tl.includes("</c>")) {
        timedLine = tl;
        break;
      }
    }

    if (!timedLine) continue;

    // Parse: "FirstWord<00:00:01.200><c> second</c><00:00:01.500><c> third</c>"
    // The first word starts at cueStart, subsequent words have inline timestamps
    const wordPattern = /<(\d{1,2}:?\d{2}:\d{2}[.,]\d{3})><c>(.*?)<\/c>/g;
    const inlineWords: { word: string; start: number }[] = [];

    // Extract first word (before any <timestamp> tag)
    const firstWordMatch = timedLine.match(/^([^<]+)/);
    if (firstWordMatch && firstWordMatch[1]!.trim()) {
      const cleanWord = sanitizeCaptionText(firstWordMatch[1]!);
      if (cleanWord) {
        inlineWords.push({ word: cleanWord, start: cueStart });
      }
    }

    // Extract subsequent words with their timestamps
    let wMatch;
    while ((wMatch = wordPattern.exec(timedLine))) {
      const wordStart = parseVttTimestamp(wMatch[1]!);
      const cleanWord = sanitizeCaptionText(wMatch[2]!);
      if (cleanWord) {
        inlineWords.push({ word: cleanWord, start: wordStart });
      }
    }

    // Convert to WordTiming with end times
    for (let w = 0; w < inlineWords.length; w++) {
      const word = inlineWords[w]!;
      const nextStart = w < inlineWords.length - 1 ? inlineWords[w + 1]!.start : cueEnd;
      allWords.push({
        word: word.word,
        start: word.start,
        end: nextStart,
      });
    }
  }

  // Deduplicate: YouTube VTT repeats words across overlapping cues
  const deduped: WordTiming[] = [];
  for (const word of allWords) {
    const last = deduped[deduped.length - 1];
    // Skip if same word at ~same time (within 0.1s)
    if (last && last.word === word.word && Math.abs(last.start - word.start) < 0.1) {
      continue;
    }
    deduped.push(word);
  }

  return deduped;
}

// Fallback: estimate word timings from chunk-level data
function estimateWordTimings(chunks: { text: string; start: number; end: number }[]): WordTiming[] {
  const words: WordTiming[] = [];
  for (const chunk of chunks) {
    const chunkWords = sanitizeCaptionText(chunk.text).split(/\s+/).filter(w => w.length > 0);
    if (chunkWords.length === 0) continue;
    const totalChars = chunkWords.reduce((sum, w) => sum + w.length, 0);
    const chunkDuration = chunk.end - chunk.start;
    let currentTime = chunk.start;
    for (const word of chunkWords) {
      const wordDuration = (word.length / totalChars) * chunkDuration;
      words.push({ word, start: currentTime, end: currentTime + wordDuration });
      currentTime += wordDuration;
    }
  }
  return words;
}

// ==========================================
// ASS FILE GENERATION
// ==========================================

function formatAssTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h}:${m.toString().padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}`;
}

function assHeader(): string {
  return `[Script Info]
Title: ShortsAI Subtitles
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial Black,58,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,3,0,2,40,40,180,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
}

// Group words into display lines (max ~4 words per line for vertical video)
interface DisplayGroup {
  words: WordTiming[];
  start: number;
  end: number;
}

function groupWordsForDisplay(words: WordTiming[], maxWordsPerGroup: number = 4): DisplayGroup[] {
  const groups: DisplayGroup[] = [];

  for (let i = 0; i < words.length; i += maxWordsPerGroup) {
    const groupWords = words.slice(i, i + maxWordsPerGroup);
    if (groupWords.length === 0) continue;

    groups.push({
      words: groupWords,
      start: groupWords[0]!.start,
      end: groupWords[groupWords.length - 1]!.end,
    });
  }

  return groups;
}

// Generate ASS dialogue lines with word-by-word highlight
function generateAssEvents(groups: DisplayGroup[], timeOffset: number = 0): string {
  let events = "";

  for (const group of groups) {
    const groupStart = group.start - timeOffset;
    const groupEnd = group.end - timeOffset;

    if (groupStart < 0 && groupEnd < 0) continue;

    for (let w = 0; w < group.words.length; w++) {
      const wordStart = group.words[w]!.start - timeOffset;
      const wordEnd = group.words[w]!.end - timeOffset;

      if (wordEnd < 0) continue;

      let text = "";
      for (let j = 0; j < group.words.length; j++) {
        const word = group.words[j]!.word.toUpperCase();
        if (j === w) {
          text += `{\\c&H00FFFFFF&\\fscx110\\fscy110}${word}{\\r}`;
        } else {
          text += word;
        }
        if (j < group.words.length - 1) text += " ";
      }

      const start = formatAssTime(Math.max(0, wordStart));
      const end = formatAssTime(Math.max(0, wordEnd));

      events += `Dialogue: 0,${start},${end},Default,,0,0,0,,${text}\n`;
    }
  }

  return events;
}

// Generate a hook title overlay for the first 2 seconds
function generateHookTitle(title: string): string {
  const cleanTitle = title.replace(/[{}\\]/g, "");
  const start = formatAssTime(0);
  const end = formatAssTime(2.2);
  return `Dialogue: 1,${start},${end},Default,,0,0,0,,{\\an8\\pos(540,400)\\fscx130\\fscy130\\fad(300,500)\\c&H00FFFFFF&\\b1}${cleanTitle.toUpperCase()}\n`;
}

// ==========================================
// MAIN: GENERATE ASS FILE FOR A CLIP
// ==========================================

export async function generateSubtitleFile(
  chunks: { text: string; start: number; end: number }[],
  segmentStart: number,
  segmentEnd: number,
  jobId: string,
  clipIndex: number,
  clipTitle?: string,
  vttPath?: string
): Promise<string> {
  let words: WordTiming[] = [];

  // Try to parse precise word timings from raw VTT
  if (vttPath) {
    try {
      const vttContent = await fs.readFile(vttPath, "utf-8");
      const allWords = parseVttWordTimings(vttContent);
      // Filter words within our segment
      words = allWords.filter(w => w.end > segmentStart && w.start < segmentEnd);
      console.log(`[Subtitles] Parsed ${words.length} words with precise VTT timing for clip #${clipIndex + 1}`);
    } catch (err) {
      console.error("[Subtitles] VTT parsing failed, falling back to estimation:", err);
    }
  }

  // Fallback: estimate from chunk data
  if (words.length === 0) {
    const relevantChunks = chunks.filter(c => c.end > segmentStart && c.start < segmentEnd);
    if (relevantChunks.length > 0) {
      const clampedChunks = relevantChunks.map(c => ({
        text: c.text,
        start: Math.max(c.start, segmentStart),
        end: Math.min(c.end, segmentEnd),
      }));
      words = estimateWordTimings(clampedChunks);
    }
  }

  let events = "";

  // Add hook title in first 2 seconds
  if (clipTitle) {
    events += generateHookTitle(clipTitle);
  }

  if (words.length > 0) {
    const groups = groupWordsForDisplay(words, 4);
    events += generateAssEvents(groups, segmentStart);
  }

  if (!events) return "";

  const assContent = assHeader() + events;
  const assPath = path.join(TMP_DIR, `${jobId}_clip${clipIndex}.ass`);
  await fs.writeFile(assPath, assContent, "utf-8");

  console.log(`[Subtitles] Generated captions for clip #${clipIndex + 1}${clipTitle ? ` with hook: "${clipTitle}"` : ""}`);
  return assPath;
}
