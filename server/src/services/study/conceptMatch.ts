// ===== Fuzzy concept matching =====
// The tutor model reports covered/assessed concepts as free-form strings that
// are often paraphrased or truncated versions of the lesson plan's keyConcepts
// (e.g. plan "Příkaz je nejmenší prvek programu…" vs covered "Příkaz – definice…").
// Exact-string matching therefore silently drops coverage. This matcher
// normalizes text (diacritics/case/punctuation-insensitive) and matches on
// equality, prefix (covers truncation), or a shared leading label term.

export function normalizeConcept(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Segment before the first label delimiter (": ", " – ", ";", "."). */
function headTerm(s: string): string {
  const i = s.search(/[:;.–—-]/);
  return normalizeConcept(i < 0 ? s : s.slice(0, i));
}

// Cap head-term length so a long head can't falsely "prefix" an unrelated concept.
const MAX_HEAD_LEN = 40;
const MIN_PREFIX_LEN = 10;

export function conceptsMatch(a: string, b: string): boolean {
  const na = normalizeConcept(a);
  const nb = normalizeConcept(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  // Prefix either way — one string is a truncation of the other.
  if (na.length >= MIN_PREFIX_LEN && nb.length >= MIN_PREFIX_LEN && (na.startsWith(nb) || nb.startsWith(na))) {
    return true;
  }
  // Shared leading label term — paraphrased variants of "Concept: details…".
  const ha = headTerm(a);
  const hb = headTerm(b);
  if (ha.length >= 3 && ha.length <= MAX_HEAD_LEN && nb.startsWith(ha)) return true;
  if (hb.length >= 3 && hb.length <= MAX_HEAD_LEN && na.startsWith(hb)) return true;
  return false;
}

/** First element of `list` that fuzzy-matches `concept`. */
export function findMatchingConcept<T extends string>(list: readonly T[], concept: string): T | undefined {
  return list.find((c) => conceptsMatch(c, concept));
}
