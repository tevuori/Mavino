import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import prisma from "../db/client";
import { authMiddleware } from "../middleware/auth";
import { appTierGate } from "../middleware/app-tier";
import { cleanupOrphanLinks } from "../db/links";

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

export default flashcards;
