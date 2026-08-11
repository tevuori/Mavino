// ===== Shared highlight-range resolution (client) =====
// Resolves a highlight request (character offsets and/or a phrase) to an exact
// [from, to) char range in a source text. Used by the CodeMirror show-control
// hook AND the mobile Teach source sheet so both surfaces highlight the RIGHT
// passage instead of the first occurrence of a common word.
//
// Resolution order:
//   1. Explicit character offsets (posStart/posEnd) — exact, no guessing.
//   2. Exact (normalized) substring match — first occurrence.
//   3. Fuzzy token-overlap clustering — finds the densest cluster of phrase
//      tokens so a paraphrased phrase still lands on the right passage.

/** Strip surrounding punctuation + lowercase for fuzzy token matching. */
function tokenKey(w: string): string {
  return w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "").toLowerCase();
}

/** Normalize whitespace/quotes for exact substring matching. */
function normalizeForMatch(s: string): string {
  return s
    .replace(/[\u2018\u2019\u201b]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Fuzzy-find the best-matching span in `text` for `phrase` via token-overlap
 *  clustering. Returns the char range [from, to) of the densest cluster, or
 *  null when no cluster scores ≥ 0.5. */
export function fuzzyFindRange(text: string, phrase: string): { from: number; to: number } | null {
  const pWords = normalizeForMatch(phrase).split(" ").map(tokenKey).filter(Boolean);
  if (pWords.length === 0) return null;
  const pTokens = new Set(pWords);
  const lower = text.toLowerCase();
  const words: { start: number; end: number; key: string }[] = [];
  let i = 0;
  while (i < lower.length) {
    while (i < lower.length && /\s/.test(lower[i])) i++;
    if (i >= lower.length) break;
    const start = i;
    while (i < lower.length && !/\s/.test(lower[i])) i++;
    words.push({ start, end: i, key: tokenKey(lower.slice(start, i)) });
  }
  if (words.length === 0) return null;
  const hits: number[] = [];
  for (let k = 0; k < words.length; k++) if (pTokens.has(words[k].key)) hits.push(k);

  const maxGap = Math.max(2, Math.ceil(pWords.length * 0.6));
  const maxSpan = pWords.length * 2 + 4;
  let best = { score: 0, start: -1, end: -1 };
  for (let h = 0; h < hits.length; h++) {
    const seen = new Set<string>();
    let first = hits[h];
    let last = hits[h];
    seen.add(words[first].key);
    for (let k = h + 1; k < hits.length; k++) {
      const cur = hits[k];
      if (cur - last > maxGap) break;
      if (cur - first >= maxSpan) break;
      last = cur;
      seen.add(words[cur].key);
    }
    const score = seen.size / pTokens.size;
    if (score > best.score || (score === best.score && best.start >= 0 && (last - first) < (best.end - best.start))) {
      best = { score, start: first, end: last };
    }
  }
  if (best.score >= 0.5 && best.start >= 0) {
    return { from: words[best.start].start, to: words[best.end].end };
  }
  return null;
}

export interface HighlightRangeOpts {
  posStart?: number;
  posEnd?: number;
  text?: string;
}

/** Resolve a highlight request to a [from, to) range in `source`. */
export function findHighlightRange(source: string, opts: HighlightRangeOpts): { from: number; to: number } | null {
  if (typeof opts.posStart === "number" && typeof opts.posEnd === "number") {
    const from = Math.max(0, Math.min(opts.posStart, source.length));
    const to = Math.max(from, Math.min(opts.posEnd, source.length));
    if (to > from) return { from, to };
  }
  if (opts.text) {
    const lower = source.toLowerCase();
    const idx = lower.indexOf(opts.text.toLowerCase());
    if (idx >= 0) return { from: idx, to: idx + opts.text.length };
    const fuzzy = fuzzyFindRange(source, opts.text);
    if (fuzzy) return fuzzy;
  }
  return null;
}
