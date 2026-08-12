/**
 * Anki .apkg import parser.
 *
 * Anki packages (.apkg, colloquially ".anki") are ZIP archives containing:
 *   - collection.anki2  (schema v11, Anki 2.0/2.1 legacy)
 *   - collection.anki21 (schema v17+, newer Anki 2.1)
 *   - media  (JSON map of numeric index -> media filename)
 *   - <n>    (media files, referenced from note fields via <img src="...">)
 *
 * The SQLite collection stores notes in a `notes` table; each row's `flds`
 * column holds the field values joined by the \x1f (unit separator) character.
 * Note types ("models") live either as JSON in `col.models` (legacy) or in a
 * `notetypes` + `fields` table pair (schema v17+). Each model declares the
 * ordered field names and a type (0 = standard, 1 = cloze).
 *
 * This module extracts Q/A pairs:
 *  - Standard models: first field → front (question), remaining fields joined
 *    with a blank line → back (answer). Field names are honoured when they
 *    match Front/Back conventions.
 *  - Cloze models: the single text field contains {{c1::answer::hint}} markers.
 *    Front = text with cloze deletions replaced by […] ; Back = text with the
 *    answers revealed.
 *
 * HTML in Anki fields is converted to plain text (our cards store plain
 * text / markdown), and media references are stripped since we don't import
 * the binary media files.
 */

import { unzipSync, strFromU8 } from "fflate";
import { Database } from "bun:sqlite";
import { writeFile, unlink, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";

export interface ParsedAnkiCard {
  front: string;
  back: string;
  tags: string;
}

export interface ParsedAnkiDeck {
  deckName: string;
  cards: ParsedAnkiCard[];
}

interface LegacyModel {
  flds: { name: string; ord: number }[];
  type: number; // 0 = standard, 1 = cloze
  name?: string;
}

interface Notetype {
  id: number;
  name: string;
  type: number;
}

interface NotetypeField {
  ntid: number;
  ord: number;
  name: string;
}

/** Strip HTML tags, collapse whitespace, decode common entities. */
function htmlToText(html: string): string {
  if (!html) return "";
  let s = html;
  // Convert <br> and block-level closers to newlines before stripping tags.
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/(div|p|li|tr|h[1-6])>/gi, "\n");
  s = s.replace(/<li[^>]*>/gi, "\n• ");
  // Drop media references entirely (we don't import media files).
  s = s.replace(/<img[^>]*>/gi, "");
  s = s.replace(/\[sound:[^\]]*\]/gi, "");
  // Strip remaining tags.
  s = s.replace(/<[^>]+>/g, "");
  // Decode the handful of entities Anki fields commonly use.
  s = s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
  // Collapse runs of blank lines, trim trailing spaces per line.
  s = s
    .split("\n")
    .map((l) => l.replace(/[ \t]+$/g, "").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return s;
}

/**
 * Transform a cloze field for display.
 *   {{c1::answer::hint}}  → revealed: "answer", hidden: "hint" (or "[…]")
 *   {{c1::answer}}         → revealed: "answer", hidden: "[…]"
 */
function clozeReveal(text: string): string {
  return text.replace(/\{\{c\d+::(.*?)(?:::(.*?))?\}\}/g, (_m, ans: string, hint?: string) =>
    hint && hint.trim() ? hint.trim() : (ans && ans.trim() ? ans.trim() : "[…]")
  );
}

function clozeHide(text: string): string {
  return text.replace(/\{\{c\d+::(.*?)(?:::(.*?))?\}\}/g, (_m, _ans: string, hint?: string) =>
    hint && hint.trim() ? `[${hint.trim()}]` : "[…]"
  );
}

/**
 * Given the raw field values for a note and its model, produce front/back text.
 */
function fieldsToCard(
  fields: string[],
  model: { flds?: { name: string; ord: number }[]; type: number } | undefined
): ParsedAnkiCard | null {
  if (fields.length === 0) return null;

  // Cloze: single text field with {{c1::…}} markers.
  if (model?.type === 1) {
    const text = htmlToText(fields[0]);
    if (!text) return null;
    return { front: clozeHide(text), back: clozeReveal(text), tags: "" };
  }

  // Standard model. Prefer field-name heuristics, fall back to ordinal.
  const fieldNames = model?.flds?.map((f) => f.name.toLowerCase().trim()) ?? [];
  let frontIdx = fieldNames.findIndex((n) => n === "front" || n === "question" || n === "term" || n === "word" || n === "正面");
  let backIdx = fieldNames.findIndex((n) => n === "back" || n === "answer" || n === "definition" || n === "meaning" || n === "背面");

  if (frontIdx === -1) frontIdx = 0;
  if (backIdx === -1) backIdx = fields.length > 1 ? 1 : -1;

  const front = htmlToText(fields[frontIdx] ?? "");
  // Back = the designated back field, or every remaining field joined.
  let back: string;
  if (backIdx >= 0) {
    back = htmlToText(fields[backIdx] ?? "");
  } else {
    back = fields
      .map((f, i) => (i === frontIdx ? "" : htmlToText(f)))
      .filter(Boolean)
      .join("\n\n");
  }

  if (!front && !back) return null;
  return { front: front || "(empty)", back: back || "(empty)", tags: "" };
}

/** Find the SQLite collection file inside the unzipped archive. */
function findCollectionFile(files: Record<string, Uint8Array>): string | null {
  // Prefer the newest schema, fall back to any .anki2/.anki21.
  const names = Object.keys(files);
  return (
    names.find((n) => n.endsWith("collection.anki21")) ??
    names.find((n) => n.endsWith("collection.anki2")) ??
    names.find((n) => n.endsWith(".anki21")) ??
    names.find((n) => n.endsWith(".anki2")) ??
    null
  );
}

/**
 * Parse an Anki .apkg (ZIP) file from raw bytes.
 * Returns the suggested deck name (from the first deck in `col.decks`, if any)
 * and the list of Q/A cards.
 */
export async function parseAnkiPackage(bytes: Uint8Array): Promise<ParsedAnkiDeck> {
  let unzipped: Record<string, Uint8Array>;
  try {
    unzipped = unzipSync(bytes);
  } catch {
    throw new Error("File is not a valid Anki .apkg package (could not unzip).");
  }

  const colFile = findCollectionFile(unzipped);
  if (!colFile) {
    throw new Error("Anki package contains no collection.anki2 / .anki21 database.");
  }

  const dbBytes = unzipped[colFile];
  // bun:sqlite opens from a path, so spill the bytes to a temp file.
  const tmpDir = join(tmpdir(), "athena-anki");
  await mkdir(tmpDir, { recursive: true });
  const tmpPath = join(tmpDir, `col-${randomBytes(8).toString("hex")}.anki2`);
  await writeFile(tmpPath, dbBytes);

  let db: Database | null = null;
  try {
    db = new Database(tmpPath, { readonly: true });

    // --- Resolve note types (models) ---
    // Legacy schema: JSON blob in col.models.
    // v17+ schema: notetypes + fields tables.
    const models = new Map<number, { flds: { name: string; ord: number }[]; type: number; name: string }>();
    let deckName = "Imported Anki Deck";

    // Try legacy col.models first.
    let colRow: { models?: string; decks?: string } | null = null;
    try {
      colRow = db.query("SELECT models, decks FROM col LIMIT 1").get() as { models?: string; decks?: string } | null;
    } catch {
      colRow = null;
    }

    if (colRow?.models) {
      try {
        const parsed = JSON.parse(colRow.models) as Record<string, LegacyModel>;
        for (const [id, m] of Object.entries(parsed)) {
          const flds = (m.flds ?? [])
            .map((f) => ({ name: f.name, ord: f.ord }))
            .sort((a, b) => a.ord - b.ord);
          models.set(Number(id), { flds, type: m.type ?? 0, name: m.name ?? "Note" });
        }
      } catch {
        // malformed models JSON — continue with empty model map (fallback to ordinal mapping)
      }
    }

    // v17+ notetypes + fields tables (overrides legacy if present).
    try {
      const notetypes = db.query("SELECT id, name, type FROM notetypes").all() as Notetype[];
      if (notetypes.length > 0) {
        const fields = db.query("SELECT ntid, ord, name FROM fields ORDER BY ntid, ord").all() as NotetypeField[];
        const byType = new Map<number, { name: string; ord: number }[]>();
        for (const f of fields) {
          if (!byType.has(f.ntid)) byType.set(f.ntid, []);
          byType.get(f.ntid)!.push({ name: f.name, ord: f.ord });
        }
        models.clear();
        for (const nt of notetypes) {
          models.set(nt.id, {
            flds: (byType.get(nt.id) ?? []).sort((a, b) => a.ord - b.ord),
            type: nt.type ?? 0,
            name: nt.name,
          });
        }
      }
    } catch {
      // no notetypes table — legacy path already handled
    }

    // Deck name from col.decks (legacy) — pick the first non-default deck.
    if (colRow?.decks) {
      try {
        const decks = JSON.parse(colRow.decks) as Record<string, { name?: string }>;
        const named = Object.values(decks).find((d) => d.name && d.name !== "Default" && d.name !== "Default deck");
        if (named?.name) deckName = named.name;
      } catch {
        // ignore
      }
    }

    // --- Read notes ---
    // notes.flds is the field values joined by \x1f. We need mid + flds + tags.
    let rows: { mid: number; flds: string; tags: string }[] = [];
    try {
      rows = db.query("SELECT mid, flds, tags FROM notes").all() as { mid: number; flds: string; tags: string }[];
    } catch {
      throw new Error("Anki collection has no readable notes table.");
    }

    const cards: ParsedAnkiCard[] = [];
    for (const row of rows) {
      const fields = row.flds.split("\x1f");
      const model = models.get(row.mid);
      const card = fieldsToCard(fields, model);
      if (!card) continue;
      card.tags = (row.tags ?? "").split(/\s+/).filter(Boolean).join(" ");
      cards.push(card);
    }

    return { deckName, cards };
  } finally {
    try {
      db?.close();
    } catch {
      // ignore
    }
    // Best-effort temp file cleanup.
    unlink(tmpPath).catch(() => {});
  }
}
