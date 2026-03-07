import fs from "fs/promises";
import type { TranscriptChunk } from "./types";

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
        const clean = line
          .replace(/<[^>]+>/g, "")
          .replace(/\{[^}]+\}/g, "")
          .replace(/\[[^\]]+\]/g, " ")
          .replace(/&nbsp;/g, " ")
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/\s+/g, " ")
          .trim();
        if (clean && !/^\d+$/.test(clean)) textLines.push(clean);
      }
      const text = textLines.join(" ").trim();
      if (text) chunks.push({ text, start, end });
      timeRegex.lastIndex = 0;
    }
  }

  // Deduplicate repeated lines (YouTube auto-subs)
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
