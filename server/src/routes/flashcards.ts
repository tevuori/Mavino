import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import prisma from "../db/client";
import { authMiddleware } from "../middleware/auth";
import { appTierGate } from "../middleware/app-tier";
import { cleanupOrphanLinks } from "../db/links";
import { parseAnkiPackage } from "../services/anki-import";

const flashcards = new Hono();
flashcards.use("*", authMiddleware, appTierGate("flashcards"));

// ===== Decks =====
const deckSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional().default(""),
  color: z.string().optional().default("#6366f1"),
});

flashcards.get("/decks", async (c) => {
  const { userId } = c.get("auth");
  const decks = await prisma.flashcardDeck.findMany({
    where: { userId },
    include: { _count: { select: { cards: true } } },
    orderBy: { updatedAt: "desc" },
  });
  return c.json({ decks });
});

flashcards.post("/decks", zValidator("json", deckSchema), async (c) => {
  const { userId } = c.get("auth");
  const body = c.req.valid("json");
  const deck = await prisma.flashcardDeck.create({ data: { ...body, userId } });
  return c.json({ deck }, 201);
});

flashcards.patch("/decks/:id", zValidator("json", deckSchema.partial()), async (c) => {
  const { userId } = c.get("auth");
  const deck = await prisma.flashcardDeck.update({
    where: { id: c.req.param("id"), userId },
    data: c.req.valid("json"),
  });
  return c.json({ deck });
});

flashcards.delete("/decks/:id", async (c) => {
  const { userId } = c.get("auth");
  const id = c.req.param("id");
  await prisma.flashcardDeck.delete({ where: { id, userId } });
  await cleanupOrphanLinks(userId, "flashcardDeck", id);
  return c.json({ ok: true });
});

// ===== Cards =====
const cardSchema = z.object({
  front: z.string().min(1),
  back: z.string().min(1),
});

flashcards.get("/decks/:id/cards", async (c) => {
  const { userId } = c.get("auth");
  const deck = await prisma.flashcardDeck.findFirst({
    where: { id: c.req.param("id"), userId },
  });
  if (!deck) return c.json({ error: "Deck not found" }, 404);
  const cards = await prisma.flashcard.findMany({
    where: { deckId: deck.id },
    orderBy: { dueDate: "asc" },
  });
  return c.json({ cards });
});

flashcards.post("/decks/:id/cards", zValidator("json", cardSchema), async (c) => {
  const { userId } = c.get("auth");
  const deck = await prisma.flashcardDeck.findFirst({
    where: { id: c.req.param("id"), userId },
  });
  if (!deck) return c.json({ error: "Deck not found" }, 404);
  const card = await prisma.flashcard.create({
    data: { ...c.req.valid("json"), deckId: deck.id },
  });
  return c.json({ card }, 201);
});

flashcards.patch("/cards/:cardId", zValidator("json", cardSchema.partial()), async (c) => {
  const { userId } = c.get("auth");
  const cardId = c.req.param("cardId");
  // Verify ownership via deck
  const card = await prisma.flashcard.findUnique({
    where: { id: cardId },
    include: { deck: true },
  });
  if (!card || card.deck.userId !== userId) {
    return c.json({ error: "Not found" }, 404);
  }
  const updated = await prisma.flashcard.update({
    where: { id: cardId },
    data: c.req.valid("json"),
  });
  return c.json({ card: updated });
});

flashcards.delete("/cards/:cardId", async (c) => {
  const { userId } = c.get("auth");
  const cardId = c.req.param("cardId");
  const card = await prisma.flashcard.findUnique({
    where: { id: cardId },
    include: { deck: true },
  });
  if (!card || card.deck.userId !== userId) {
    return c.json({ error: "Not found" }, 404);
  }
  await prisma.flashcard.delete({ where: { id: cardId } });
  return c.json({ ok: true });
});

// ===== Review (SM-2 algorithm) =====
// Quality: 0=again, 1=hard, 2=good, 3=easy (simplified from 0-5 scale)
const reviewSchema = z.object({
  quality: z.number().int().min(0).max(5),
});

flashcards.post("/cards/:cardId/review", zValidator("json", reviewSchema), async (c) => {
  const { userId } = c.get("auth");
  const cardId = c.req.param("cardId");
  const { quality } = c.req.valid("json");

  const card = await prisma.flashcard.findUnique({
    where: { id: cardId },
    include: { deck: true },
  });
  if (!card || card.deck.userId !== userId) {
    return c.json({ error: "Not found" }, 404);
  }

  // SM-2 algorithm
  let { easeFactor, interval, repetitions } = card;
  const q = quality; // 0-5

  if (q < 3) {
    // Failed — reset
    repetitions = 0;
    interval = 1;
  } else {
    repetitions += 1;
    if (repetitions === 1) interval = 1;
    else if (repetitions === 2) interval = 6;
    else interval = Math.round(interval * easeFactor);
  }

  // Update ease factor: EF' = EF + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
  easeFactor = easeFactor + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
  if (easeFactor < 1.3) easeFactor = 1.3;

  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + interval);

  const updated = await prisma.flashcard.update({
    where: { id: cardId },
    data: {
      easeFactor,
      interval,
      repetitions,
      dueDate,
      lastReviewed: new Date(),
    },
  });

  // Log the review event for the Analytics dashboard (reviews/day + retention).
  await prisma.flashcardReview.create({
    data: {
      userId,
      cardId,
      deckId: card.deckId,
      quality: q,
      date: new Date().toISOString().slice(0, 10),
    },
  });

  return c.json({ card: updated });
});

// Get due cards across all decks
flashcards.get("/due", async (c) => {
  const { userId } = c.get("auth");
  const now = new Date();
  const decks = await prisma.flashcardDeck.findMany({
    where: { userId },
    include: {
      cards: {
        where: { dueDate: { lte: now } },
        orderBy: { dueDate: "asc" },
      },
    },
  });
  const result = decks.map((d) => ({
    deckId: d.id,
    deckName: d.name,
    deckColor: d.color,
    dueCount: d.cards.length,
    cards: d.cards,
  }));
  const totalDue = result.reduce((sum, d) => sum + d.dueCount, 0);
  return c.json({ decks: result, totalDue });
});

// ===== Anki (.apkg) import =====
// Anki exports packages as .apkg (a ZIP containing a SQLite collection).
// Users often refer to these as ".anki" files; we accept .apkg, .anki,
// .anki2 and .anki21 extensions. The package is parsed server-side into
// Q/A pairs and bulk-inserted as Flashcard rows.

const ANKI_MAX_BYTES = 100 * 1024 * 1024; // 100 MB — apkg files can be large
const ANKI_ACCEPTED_EXT = new Set(["apkg", "anki", "anki2", "anki21"]);

function getExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/**
 * POST /import  — multipart: file=<.apkg>
 * Creates a NEW deck (named after the Anki deck, or the provided `name` field)
 * and imports all parsed cards into it.
 */
flashcards.post("/import", async (c) => {
  const { userId } = c.get("auth");
  const formData = await c.req.formData();
  const file = formData.get("file");
  const customName = (formData.get("name") as string | null)?.trim() || null;

  if (!(file instanceof File)) {
    return c.json({ error: "No file provided. Upload an Anki .apkg package." }, 400);
  }
  const ext = getExtension(file.name);
  if (!ANKI_ACCEPTED_EXT.has(ext)) {
    return c.json({ error: `Unsupported file type ".${ext}". Expected an Anki .apkg package.` }, 415);
  }
  if (file.size > ANKI_MAX_BYTES) {
    return c.json({ error: `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum is ${ANKI_MAX_BYTES / 1024 / 1024} MB.` }, 413);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  let parsed;
  try {
    parsed = await parseAnkiPackage(bytes);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 422);
  }
  if (parsed.cards.length === 0) {
    return c.json({ error: "No cards could be extracted from this Anki package." }, 422);
  }

  const deck = await prisma.flashcardDeck.create({
    data: {
      name: customName || parsed.deckName || file.name.replace(/\.(apkg|anki2?|anki21)$/i, "") || "Imported Deck",
      userId,
    },
  });

  // Bulk-insert cards. Prisma createMany keeps this efficient for large decks.
  await prisma.flashcard.createMany({
    data: parsed.cards.map((card) => ({
      deckId: deck.id,
      front: card.front,
      back: card.back,
      sourceRef: card.tags ? `anki:${card.tags}` : "anki",
    })),
  });

  const withCount = await prisma.flashcardDeck.findUnique({
    where: { id: deck.id },
    include: { _count: { select: { cards: true } } },
  });
  return c.json({ deck: withCount, imported: parsed.cards.length }, 201);
});

/**
 * POST /decks/:id/import  — multipart: file=<.apkg>
 * Imports parsed cards into an EXISTING deck.
 */
flashcards.post("/decks/:id/import", async (c) => {
  const { userId } = c.get("auth");
  const deck = await prisma.flashcardDeck.findFirst({
    where: { id: c.req.param("id"), userId },
  });
  if (!deck) return c.json({ error: "Deck not found" }, 404);

  const formData = await c.req.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return c.json({ error: "No file provided. Upload an Anki .apkg package." }, 400);
  }
  const ext = getExtension(file.name);
  if (!ANKI_ACCEPTED_EXT.has(ext)) {
    return c.json({ error: `Unsupported file type ".${ext}". Expected an Anki .apkg package.` }, 415);
  }
  if (file.size > ANKI_MAX_BYTES) {
    return c.json({ error: `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum is ${ANKI_MAX_BYTES / 1024 / 1024} MB.` }, 413);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  let parsed;
  try {
    parsed = await parseAnkiPackage(bytes);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 422);
  }
  if (parsed.cards.length === 0) {
    return c.json({ error: "No cards could be extracted from this Anki package." }, 422);
  }

  await prisma.flashcard.createMany({
    data: parsed.cards.map((card) => ({
      deckId: deck.id,
      front: card.front,
      back: card.back,
      sourceRef: card.tags ? `anki:${card.tags}` : "anki",
    })),
  });

  return c.json({ imported: parsed.cards.length });
});

export default flashcards;
