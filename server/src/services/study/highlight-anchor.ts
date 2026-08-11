// ===== Highlight anchor resolution =====
// Resolves an LLM-supplied highlight phrase to a precise, verbatim span in the
// source text. Used by the teacher tools (show_source / highlight_source) so
// the client can highlight by CHARACTER OFFSET (exact, no first-occurrence
// guessing) instead of by fragile first-match text search.
//
// Why this exists: LLMs are bad at copying text verbatim from long context.
// They paraphrase, drop words, merge sentences. The old verifier required a
// near-verbatim match and otherwise returned null (→ nothing highlighted) or
// shrank to a common 3-word fragment (→ the client highlighted the FIRST
// occurrence of a common phrase = the "one wrong word" glitch). This module
// instead finds the best-matching span in the source via token overlap and
// returns its exact character offsets, so the client always lands on the right
// passage even when the model paraphrased.

/** Normalize a string for matching: collapse whitespace, replace smart
 *  quotes/dashes, lowercase. Length-preserving per character except for
 *  whitespace collapsing and trimming. */
export function normalizeForMatch(s: string): string {
  return buildNormalizedMap(s).norm;
}

/** Build a normalized form of `src` together with a map from each normalized
 *  character index back to its index in the ORIGINAL string. This lets us
 *  resolve a match found in normalized space back to exact original offsets. */
export function buildNormalizedMap(src: string): { norm: string; map: number[] } {
  const normChars: string[] = [];
  const map: number[] = [];
  let i = 0;
  // skip leading whitespace (mirrors .trim())
  while (i < src.length && /\s/.test(src[i])) i++;
  let lastWasSpace = false;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      if (!lastWasSpace) {
        normChars.push(" ");
        map.push(i);
        lastWasSpace = true;
      }
      continue;
    }
    let nc = ch;
    if (nc === "\u2018" || nc === "\u2019" || nc === "\u201b") nc = "'";
    else if (nc === "\u201c" || nc === "\u201d") nc = '"';
    else if (nc === "\u2013" || nc === "\u2014") nc = "-";
    normChars.push(nc.toLowerCase());
    map.push(i);
    lastWasSpace = false;
  }
  // trim trailing space
  while (normChars.length && normChars[normChars.length - 1] === " ") {
    normChars.pop();
    map.pop();
  }
  return { norm: normChars.join(""), map };
}

interface NormWord {
  /** Inclusive start index in the normalized string. */
  start: number;
  /** Exclusive end index in the normalized string. */
  end: number;
  token: string;
}

function wordsOf(norm: string): NormWord[] {
  const out: NormWord[] = [];
  let i = 0;
  while (i < norm.length) {
    while (i < norm.length && norm[i] === " ") i++;
    if (i >= norm.length) break;
    const start = i;
    while (i < norm.length && norm[i] !== " ") i++;
    out.push({ start, end: i, token: norm.slice(start, i) });
  }
  return out;
}

export interface AnchorResult {
  /** Verbatim substring of the source text to highlight (null if nothing matched). */
  text: string | null;
  /** Character offset of the start in the ORIGINAL source text. */
  posStart?: number;
  /** Character offset (exclusive) of the end in the ORIGINAL source text. */
  posEnd?: number;
  /** True when the phrase matched the source literally (after normalization). */
  exact: boolean;
  /** 0..1 token-overlap score of the chosen span. */
  score: number;
}

/** Minimum token-overlap score for the fuzzy fallback to be accepted. */
const FUZZY_MIN_SCORE = 0.5;

/**
 * Resolve a highlight phrase to a verbatim span + offsets in the source text.
 *
 * Strategy:
 *  1. Exact (normalized) substring match → return its verbatim text + offsets.
 *  2. Fuzzy: slide a word window the same length as the phrase across the
 *     source and score it by token multiset overlap. Return the best window
 *     if its score ≥ FUZZY_MIN_SCORE.
 *  3. Otherwise return null (nothing to highlight).
 */
export function resolveAnchor(
  requested: string,
  sourceText: string | undefined | null
): AnchorResult {
  const phrase = requested.trim();
  if (!phrase) return { text: null, exact: false, score: 0 };
  if (!sourceText) return { text: phrase, exact: false, score: 0 }; // can't verify — pass through

  const { norm, map } = buildNormalizedMap(sourceText);
  const phraseNorm = normalizeForMatch(phrase);
  if (!phraseNorm) return { text: null, exact: false, score: 0 };

  // 1. Exact normalized match.
  const idx = norm.indexOf(phraseNorm);
  if (idx >= 0) {
    const posStart = map[idx];
    const lastNormIdx = idx + phraseNorm.length - 1;
    const posEnd = map[lastNormIdx] + 1;
    return { text: sourceText.slice(posStart, posEnd), posStart, posEnd, exact: true, score: 1 };
  }

  // 2. Fuzzy: cluster the source words that match phrase tokens, allowing the
  //    model to drop/reorder filler words. The span grows to cover the full
  //    original passage even when the phrase is a paraphrase.
  const pWords = phraseNorm.split(" ").filter(Boolean);
  if (pWords.length === 0) return { text: null, exact: false, score: 0 };
  const sWords = wordsOf(norm);
  if (sWords.length === 0) return { text: null, exact: false, score: 0 };

  // Strip surrounding punctuation so "quoted" matches `"quoted"` and cell matches (cell).
  const tokenKey = (w: string) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
  const pTokens = new Set(pWords.map(tokenKey).filter(Boolean));
  // Max gap (in source words) between two consecutive matched tokens within one
  // cluster — tolerates dropped filler words like "the/a/of". Max span caps the
  // total cluster width so a common token can't stretch across the whole doc.
  const maxGap = Math.max(2, Math.ceil(pWords.length * 0.6));
  const maxSpan = pWords.length * 2 + 4;

  // Hits: source word indices whose token (punctuation-stripped) is in the phrase.
  const hits: number[] = [];
  for (let i = 0; i < sWords.length; i++) {
    if (pTokens.has(tokenKey(sWords[i].token))) hits.push(i);
  }

  let best = { score: 0, start: -1, end: -1 };
  for (let h = 0; h < hits.length; h++) {
    const seen = new Set<string>();
    let first = hits[h];
    let last = hits[h];
    seen.add(tokenKey(sWords[first].token));
    // Extend forward through consecutive hits within maxGap, capped at maxSpan.
    for (let k = h + 1; k < hits.length; k++) {
      const cur = hits[k];
      if (cur - last > maxGap) break;
      if (cur - first >= maxSpan) break;
      last = cur;
      seen.add(tokenKey(sWords[cur].token));
    }
    const score = seen.size / pTokens.size;
    if (score > best.score || (score === best.score && best.start >= 0 && (last - first) < (best.end - best.start))) {
      best = { score, start: first, end: last };
    }
  }

  if (best.score >= FUZZY_MIN_SCORE && best.start >= 0) {
    const posStart = map[sWords[best.start].start];
    const posEnd = map[sWords[best.end].end - 1] + 1;
    return {
      text: sourceText.slice(posStart, posEnd),
      posStart,
      posEnd,
      exact: false,
      score: best.score,
    };
  }

  return { text: null, exact: false, score: best.score };
}
