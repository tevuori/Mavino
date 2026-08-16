import { api } from "./api";
import type { Flashcard, FlashcardDeck } from "../types";

export const flashcardsApi = {
  listDecks: () => api.get<{ decks: (FlashcardDeck & { _count: { cards: number } })[] }>("/api/flashcards/decks"),
  createDeck: (data: { name: string; description?: string; color?: string }) =>
    api.post<{ deck: FlashcardDeck }>("/api/flashcards/decks", data),
  updateDeck: (id: string, data: Partial<{ name: string; description: string; color: string }>) =>
    api.patch<{ deck: FlashcardDeck }>(`/api/flashcards/decks/${id}`, data),
  deleteDeck: (id: string) => api.delete(`/api/flashcards/decks/${id}`),

  listCards: (deckId: string) =>
    api.get<{ cards: Flashcard[]; sharedDeckPermission?: "read" | "write" }>(`/api/flashcards/decks/${deckId}/cards`),
  createCard: (deckId: string, data: { front: string; back: string }) =>
    api.post<{ card: Flashcard }>(`/api/flashcards/decks/${deckId}/cards`, data),
  updateCard: (cardId: string, data: Partial<{ front: string; back: string }>) =>
    api.patch<{ card: Flashcard }>(`/api/flashcards/cards/${cardId}`, data),
  deleteCard: (cardId: string) => api.delete(`/api/flashcards/cards/${cardId}`),
  reviewCard: (cardId: string, quality: number) =>
    api.post<{ card: Flashcard }>(`/api/flashcards/cards/${cardId}/review`, { quality }),

  getDue: () => api.get<{ decks: { deckId: string; deckName: string; deckColor: string; dueCount: number; cards: Flashcard[] }[]; totalDue: number }>("/api/flashcards/due"),

  /** Import an Anki .apkg package as a NEW deck. Returns the created deck + count. */
  importAnkiNew: (file: File, name?: string) => {
    const fd = new FormData();
    fd.append("file", file);
    if (name) fd.append("name", name);
    return api.post<{ deck: FlashcardDeck & { _count: { cards: number } }; imported: number }>(
      "/api/flashcards/import",
      fd
    );
  },

  /** Import an Anki .apkg package into an EXISTING deck. */
  importAnkiInto: (deckId: string, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return api.post<{ imported: number }>(`/api/flashcards/decks/${deckId}/import`, fd);
  },
};
