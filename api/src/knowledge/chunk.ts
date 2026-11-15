/**
 * Splits text into ~800-character chunks on paragraph and sentence boundaries,
 * with a small overlap so facts that straddle a boundary stay findable.
 * Handles Indian-language sentence enders (।, ॥) as well as . ? !
 */
const TARGET = 800;
const MAX = 1200;
const OVERLAP = 150;

function sentences(paragraph: string): string[] {
  const parts = paragraph.split(/(?<=[.?!।॥])\s+/u).filter(Boolean);
  // Hard-split anything still too long (tables, run-on text).
  return parts.flatMap((s) => {
    if (s.length <= MAX) return [s];
    const out: string[] = [];
    for (let i = 0; i < s.length; i += TARGET) out.push(s.slice(i, i + TARGET));
    return out;
  });
}

export function chunkText(text: string, title?: string): string[] {
  const units = text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s*\n\s*/g, ' ').trim())
    .filter(Boolean)
    .flatMap((p) => [...sentences(p), '\n']);

  const chunks: string[] = [];
  let cur = '';
  for (const u of units) {
    if (u === '\n') {
      if (cur.length >= TARGET) {
        chunks.push(cur.trim());
        cur = cur.slice(-OVERLAP);
      } else if (cur) {
        cur += '\n';
      }
      continue;
    }
    if (cur.length + u.length + 1 > MAX && cur.trim()) {
      chunks.push(cur.trim());
      cur = cur.slice(-OVERLAP);
    }
    cur += (cur && !cur.endsWith('\n') ? ' ' : '') + u;
  }
  if (cur.trim().length > OVERLAP || (!chunks.length && cur.trim())) chunks.push(cur.trim());

  // Prefix the document title so each chunk carries its context.
  return title ? chunks.map((c) => `${title}\n${c}`) : chunks;
}
