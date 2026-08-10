// ===== Athena flashcard tools =====
// list_flashcard_decks, delete_flashcard_deck, delete_flashcard.
// Lets the Athena chat assistant inspect and remove flashcard decks / cards.

import { type ToolDef, paidOnly } from "./plugin";
import prisma from "../../../db/client";
import { cleanupOrphanLinks } from "../../../db/links";

// Flashcards is a Paid-tier app — all flashcard tools are paid-only.
export const flashcardsTools: ToolDef[] = paidOnly([
  {
    name: "list_flashcard_decks",
    description:
      "List the user's flashcard decks with card counts. Use to find a deck id before deleting it or inspecting its cards.",
    parameters: [
      { name: "search", type: "string", description: "Optional substring to filter deck names by" },
    ],
    handler: async (args, { userId }) => {
      const where: Record<string, unknown> = { userId };
      if (args.search) where.name = { contains: String(args.search) };
      const decks = await prisma.flashcardDeck.findMany({
        where: where as never,
        include: { _count: { select: { cards: true } } },
        orderBy: { updatedAt: "desc" },
        take: 100,
      });
      return {
        count: decks.length,
        decks: decks.map((d) => ({
          id: d.id,
          name: d.name,
          description: d.description,
          color: d.color,
          cardCount: d._count.cards,
          updatedAt: d.updatedAt.toISOString(),
        })),
      };
    },
  },
  {
    name: "delete_flashcard_deck",
    description:
      "Delete a flashcard deck and all of its cards permanently. Use list_flashcard_decks first to get the deck id. This cannot be undone.",
    destructive: true,
    parameters: [
      { name: "deckId", type: "string", description: "Deck id from list_flashcard_decks", required: true },
    ],
    handler: async (args, { userId }) => {
      const id = String(args.deckId);
      const deck = await prisma.flashcardDeck.findUnique({
        where: { id, userId },
        include: { _count: { select: { cards: true } } },
      });
      if (!deck) return { error: "Deck not found" };
      const cardCount = deck._count.cards;
      await prisma.flashcardDeck.delete({ where: { id, userId } });
      await cleanupOrphanLinks(userId, "flashcardDeck", id);
      return { deleted: true, deckId: id, name: deck.name, cardCount };
    },
  },
  {
    name: "delete_flashcard",
    description:
      "Delete a single flashcard permanently. Verify ownership via the parent deck. This cannot be undone.",
    destructive: true,
    parameters: [
      { name: "cardId", type: "string", description: "Flashcard id to delete", required: true },
    ],
    handler: async (args, { userId }) => {
      const cardId = String(args.cardId);
      const card = await prisma.flashcard.findUnique({
        where: { id: cardId },
        include: { deck: true },
      });
      if (!card || card.deck.userId !== userId) {
        return { error: "Card not found" };
      }
      await prisma.flashcard.delete({ where: { id: cardId } });
      return { deleted: true, cardId, deckId: card.deckId };
    },
  },
]);
