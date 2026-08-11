import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Brain, MoreVertical, Pencil, Plus, Trash2 } from "lucide-react";
import { flashcardsApi } from "../services/flashcards";
import type { Flashcard, FlashcardDeck } from "../types";
import {
  MobileButton, MobileContainer, MobileEmpty, MobileFab, MobileHeader, MobileInput,
  MobileLoading, MobileMarkdown, MobileModal, MobileTextarea,
} from "./MobileUi";

const DECK_COLORS = ["#6366f1", "#ec4899", "#22c55e", "#f59e0b", "#06b6d4", "#8b5cf6"];

export default function MobileFlashcards({ onClose }: { onClose?: () => void }) {
  const [decks, setDecks] = useState<(FlashcardDeck & { _count: { cards: number } })[]>([]);
  const [view, setView] = useState<"decks" | "cards" | "review">("decks");
  const [selectedDeck, setSelectedDeck] = useState<FlashcardDeck | null>(null);
  const [cards, setCards] = useState<Flashcard[]>([]);
  const [loading, setLoading] = useState(true);

  // Deck form (create + edit)
  const [deckFormOpen, setDeckFormOpen] = useState(false);
  const [editingDeck, setEditingDeck] = useState<FlashcardDeck | null>(null);
  const [deckName, setDeckName] = useState("");
  const [deckDesc, setDeckDesc] = useState("");
  const [deckColor, setDeckColor] = useState(DECK_COLORS[0]);

  // Card form (create + edit)
  const [cardFormOpen, setCardFormOpen] = useState(false);
  const [editingCard, setEditingCard] = useState<Flashcard | null>(null);
  const [cardFront, setCardFront] = useState("");
  const [cardBack, setCardBack] = useState("");

  // Card/Deck menus
  const [cardMenu, setCardMenu] = useState<Flashcard | null>(null);
  const [deckMenu, setDeckMenu] = useState<FlashcardDeck | null>(null);

  // Review
  const [reviewQueue, setReviewQueue] = useState<Flashcard[]>([]);
  const [reviewIdx, setReviewIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);

  const loadDecks = useCallback(async () => {
    setLoading(true);
    const res = await flashcardsApi.listDecks().catch(() => null);
    setDecks(res?.decks ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadDecks();
  }, [loadDecks]);

  const openDeck = useCallback(async (deck: FlashcardDeck) => {
    setSelectedDeck(deck);
    setView("cards");
    setLoading(true);
    const res = await flashcardsApi.listCards(deck.id).catch(() => null);
    setCards(res?.cards ?? []);
    setLoading(false);
  }, []);

  const openDeckForm = (deck?: FlashcardDeck) => {
    if (deck) {
      setEditingDeck(deck);
      setDeckName(deck.name);
      setDeckDesc(deck.description ?? "");
      setDeckColor(deck.color || DECK_COLORS[0]);
    } else {
      setEditingDeck(null);
      setDeckName("");
      setDeckDesc("");
      setDeckColor(DECK_COLORS[0]);
    }
    setDeckFormOpen(true);
    setDeckMenu(null);
  };

  const saveDeck = async () => {
    if (!deckName.trim()) return;
    if (editingDeck) {
      const res = await flashcardsApi.updateDeck(editingDeck.id, {
        name: deckName.trim(),
        description: deckDesc,
        color: deckColor,
      }).catch(() => null);
      if (res?.deck) {
        setDecks((list) => list.map((d) => (d.id === res.deck.id ? { ...res.deck, _count: d._count } : d)));
        if (selectedDeck?.id === res.deck.id) setSelectedDeck(res.deck);
      }
    } else {
      await flashcardsApi.createDeck({ name: deckName.trim(), description: deckDesc, color: deckColor }).catch(() => {});
      await loadDecks();
    }
    setDeckFormOpen(false);
  };

  const deleteDeck = async (deck: FlashcardDeck) => {
    const fullDeck = decks.find((d) => d.id === deck.id);
    const cardCount = fullDeck?._count?.cards ?? 0;
    if (!window.confirm(`Delete "${deck.name}" and its ${cardCount} cards?`)) return;
    await flashcardsApi.deleteDeck(deck.id).catch(() => {});
    await loadDecks();
    setDeckMenu(null);
    if (selectedDeck?.id === deck.id) setView("decks");
  };

  const openCardForm = (card?: Flashcard) => {
    if (card) {
      setEditingCard(card);
      setCardFront(card.front);
      setCardBack(card.back);
    } else {
      setEditingCard(null);
      setCardFront("");
      setCardBack("");
    }
    setCardFormOpen(true);
    setCardMenu(null);
  };

  const saveCard = async () => {
    if (!cardFront.trim() || !cardBack.trim() || !selectedDeck) return;
    if (editingCard) {
      const res = await flashcardsApi.updateCard(editingCard.id, { front: cardFront.trim(), back: cardBack.trim() }).catch(() => null);
      if (res?.card) setCards((list) => list.map((c) => (c.id === res.card.id ? res.card : c)));
    } else {
      await flashcardsApi.createCard(selectedDeck.id, { front: cardFront.trim(), back: cardBack.trim() }).catch(() => {});
      if (selectedDeck) await openDeck(selectedDeck);
      await loadDecks();
    }
    setCardFormOpen(false);
  };

  const deleteCard = async (id: string) => {
    if (!window.confirm("Delete this card?")) return;
    await flashcardsApi.deleteCard(id).catch(() => {});
    if (selectedDeck) await openDeck(selectedDeck);
    await loadDecks();
    setCardMenu(null);
  };

  const startReview = () => {
    if (!selectedDeck) return;
    const due = cards.filter((c) => new Date(c.dueDate) <= new Date());
    const queue = due.length ? due : cards;
    if (queue.length === 0) return;
    setReviewQueue(queue);
    setReviewIdx(0);
    setFlipped(false);
    setView("review");
  };

  const reviewCard = async (quality: number) => {
    const card = reviewQueue[reviewIdx];
    if (!card) return;
    await flashcardsApi.reviewCard(card.id, quality).catch(() => {});
    if (reviewIdx + 1 < reviewQueue.length) {
      setReviewIdx((i) => i + 1);
      setFlipped(false);
    } else {
      setView("cards");
      if (selectedDeck) await openDeck(selectedDeck);
      await loadDecks();
    }
  };

  // ===== Review view =====
  if (view === "review" && selectedDeck && reviewQueue[reviewIdx]) {
    const card = reviewQueue[reviewIdx];
    const progress = ((reviewIdx + 1) / reviewQueue.length) * 100;
    return (
      <div className="flex h-full flex-col bg-surface px-5 pb-7 pt-[max(1.5rem,env(safe-area-inset-top))]">
        <header className="mb-4 flex items-center gap-3">
          <button type="button" onClick={() => setView("cards")} className="flex h-10 w-10 items-center justify-center rounded-2xl bg-surface-2 text-ink active:bg-surface-3" aria-label="Back">
            <ArrowLeft size={20} />
          </button>
          <div className="flex-1">
            <p className="text-sm font-medium text-accent">Reviewing {selectedDeck.name}</p>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
              <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${progress}%` }} />
            </div>
            <p className="mt-1 text-[11px] text-ink-muted">{reviewIdx + 1} / {reviewQueue.length}</p>
          </div>
        </header>

        <div className="flex flex-1 flex-col items-center justify-center">
          <div onClick={() => setFlipped(!flipped)} className="relative w-full max-w-sm" style={{ perspective: "1000px" }}>
            <div
              className="relative min-h-[280px] w-full rounded-3xl border border-edge p-8 text-center transition-transform duration-500"
              style={{ transformStyle: "preserve-3d", transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)", backgroundColor: (selectedDeck.color || "#6366f1") + "15" }}
            >
              <div className="absolute inset-0 flex flex-col items-center justify-center p-8" style={{ backfaceVisibility: "hidden" }}>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">Question</p>
                <div className="text-xl font-medium text-ink"><MobileMarkdown content={card.front} /></div>
                <p className="absolute bottom-6 text-xs text-ink-muted">Tap to flip</p>
              </div>
              <div className="absolute inset-0 flex flex-col items-center justify-center p-8" style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide" style={{ color: selectedDeck.color }}>Answer</p>
                <div className="text-lg text-ink"><MobileMarkdown content={card.back} /></div>
                <p className="absolute bottom-6 text-xs text-ink-muted">How well did you know this?</p>
              </div>
            </div>
          </div>
        </div>

        {flipped ? (
          <div className="grid grid-cols-2 gap-2 pt-4">
            {[
              { label: "Again", quality: 0, color: "bg-rose-500" },
              { label: "Hard", quality: 1, color: "bg-orange-500" },
              { label: "Good", quality: 2, color: "bg-emerald-500" },
              { label: "Easy", quality: 3, color: "bg-sky-500" },
            ].map(({ label, quality, color }) => (
              <button key={label} type="button" onClick={() => void reviewCard(quality)} className={`rounded-2xl py-3 text-sm font-semibold text-ink ${color}`}>
                {label}
              </button>
            ))}
          </div>
        ) : (
          <p className="py-4 text-center text-sm text-ink-muted">Tap the card to see the answer</p>
        )}
      </div>
    );
  }

  // ===== Cards view =====
  if (view === "cards" && selectedDeck) {
    return (
      <MobileContainer>
        <MobileHeader
          compact
          title={selectedDeck.name}
          subtitle="Deck"
          onBack={() => setView("decks")}
          right={
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setDeckMenu(selectedDeck)} className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-2 text-ink-muted active:bg-surface-3" aria-label="Deck options">
                <MoreVertical size={20} />
              </button>
              {cards.some((c) => new Date(c.dueDate) <= new Date()) && (
                <button type="button" onClick={startReview} className="rounded-2xl bg-emerald-500 px-3 py-2 text-sm font-semibold text-ink">
                  <Brain size={16} className="mr-1 inline" /> Study
                </button>
              )}
              <MobileFab onClick={() => openCardForm()} icon={<Plus size={22} />} label="New card" />
            </div>
          }
        />

        {/* Deck menu */}
        {deckMenu && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setDeckMenu(null)} />
            <div className="absolute right-5 top-20 z-50 w-44 rounded-2xl border border-edge bg-surface p-1.5 shadow-2xl">
              <button type="button" onClick={() => openDeckForm(selectedDeck)} className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-sm text-ink active:bg-surface-2">
                <Pencil size={16} /> Edit deck
              </button>
              <button type="button" onClick={() => void deleteDeck(selectedDeck)} className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-sm text-rose-400 active:bg-surface-2">
                <Trash2 size={16} /> Delete deck
              </button>
            </div>
          </>
        )}

        <div className="space-y-2">
          {loading ? (
            <MobileLoading />
          ) : cards.length ? (
            cards.map((card) => (
              <article key={card.id} className="relative rounded-2xl border border-edge bg-surface-2 p-4">
                <div className="flex items-start justify-between gap-2">
                  <button type="button" onClick={() => setCardMenu(card)} className="min-w-0 flex-1 text-left">
                    <div className="font-medium text-ink"><MobileMarkdown content={card.front} /></div>
                    <div className="mt-2 text-sm text-ink-muted"><MobileMarkdown content={card.back} /></div>
                    {card.sourceRef && <p className="mt-2 text-[11px] text-ink-muted">From {card.sourceRef}</p>}
                  </button>
                  <button type="button" onClick={() => setCardMenu(card)} className="shrink-0 text-ink-muted active:text-ink" aria-label="Card options">
                    <MoreVertical size={18} />
                  </button>
                </div>
                <span className={`mt-2 inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${new Date(card.dueDate) <= new Date() ? "bg-amber-500/15 text-amber-400" : "bg-surface-3 text-ink-muted"}`}>
                  {new Date(card.dueDate) <= new Date() ? "Due" : `${card.interval}d`}
                </span>
              </article>
            ))
          ) : (
            <MobileEmpty text="No cards yet. Add some to start studying." />
          )}
        </div>

        {/* Card menu */}
        {cardMenu && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setCardMenu(null)} />
            <div className="fixed bottom-0 left-1/2 z-50 w-full max-w-md -translate-x-1/2 rounded-t-3xl border border-edge bg-surface p-2 shadow-2xl sm:bottom-auto sm:top-1/3 sm:rounded-3xl">
              <button type="button" onClick={() => openCardForm(cardMenu)} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm text-ink active:bg-surface-2">
                <Pencil size={18} /> Edit card
              </button>
              <button type="button" onClick={() => void deleteCard(cardMenu.id)} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm text-rose-400 active:bg-surface-2">
                <Trash2 size={18} /> Delete card
              </button>
            </div>
          </>
        )}

        {cardFormOpen && (
          <MobileModal
            open={cardFormOpen}
            onClose={() => setCardFormOpen(false)}
            title={editingCard ? "Edit card" : "New card"}
            footer={
              <>
                <MobileButton variant="ghost" onClick={() => setCardFormOpen(false)}>Cancel</MobileButton>
                <MobileButton onClick={() => void saveCard()}>{editingCard ? "Save" : "Add"}</MobileButton>
              </>
            }
          >
            <label className="block text-xs font-medium text-ink-muted">Front (question) — markdown</label>
            <MobileTextarea value={cardFront} onChange={(e) => setCardFront(e.target.value)} placeholder="Question" rows={2} />
            <label className="block text-xs font-medium text-ink-muted">Back (answer) — markdown</label>
            <MobileTextarea value={cardBack} onChange={(e) => setCardBack(e.target.value)} placeholder="Answer" rows={3} />
          </MobileModal>
        )}

        {deckFormOpen && (
          <MobileModal
            open={deckFormOpen}
            onClose={() => setDeckFormOpen(false)}
            title={editingDeck ? "Edit deck" : "New deck"}
            footer={
              <>
                <MobileButton variant="ghost" onClick={() => setDeckFormOpen(false)}>Cancel</MobileButton>
                <MobileButton onClick={() => void saveDeck()}>{editingDeck ? "Save" : "Create"}</MobileButton>
              </>
            }
          >
            <label className="block text-xs font-medium text-ink-muted">Name</label>
            <MobileInput value={deckName} onChange={(e) => setDeckName(e.target.value)} placeholder="Deck name" />
            <label className="block text-xs font-medium text-ink-muted">Description</label>
            <MobileTextarea value={deckDesc} onChange={(e) => setDeckDesc(e.target.value)} placeholder="Description (optional)" rows={2} />
            <label className="block text-xs font-medium text-ink-muted">Color</label>
            <div className="flex gap-2">
              {DECK_COLORS.map((c) => (
                <button key={c} type="button" onClick={() => setDeckColor(c)} className={`h-8 w-8 rounded-full border-2 ${deckColor === c ? "border-ink" : "border-transparent"}`} style={{ backgroundColor: c }} aria-label="Pick color" />
              ))}
            </div>
          </MobileModal>
        )}
      </MobileContainer>
    );
  }

  // ===== Decks list =====
  return (
    <MobileContainer>
      <MobileHeader
        title="Flashcards"
        subtitle="Study what matters"
        onClose={onClose}
        right={<MobileFab onClick={() => openDeckForm()} icon={<Plus size={22} />} label="New deck" />}
      />

      <div className="space-y-3">
        {loading ? (
          <MobileLoading />
        ) : decks.length ? (
          decks.map((deck) => (
            <article key={deck.id} className="relative flex items-center gap-3 rounded-2xl border border-edge bg-surface-2 p-4">
              <button type="button" onClick={() => void openDeck(deck)} className="min-w-0 flex-1 text-left">
                <div className="flex items-center gap-2">
                  <span className="h-4 w-4 shrink-0 rounded-full" style={{ backgroundColor: deck.color }} />
                  <span className="font-medium text-ink">{deck.name}</span>
                </div>
                <p className="mt-1 line-clamp-2 text-sm text-ink-muted">{deck.description}</p>
                <p className="mt-2 text-[11px] text-ink-muted">{deck._count.cards} cards</p>
              </button>
              <button type="button" onClick={() => setDeckMenu(deck)} className="shrink-0 text-ink-muted active:text-ink" aria-label="Deck options">
                <MoreVertical size={18} />
              </button>
            </article>
          ))
        ) : (
          <MobileEmpty text="No decks yet. Create a deck to start studying." />
        )}
      </div>

      {/* Deck list menu */}
      {deckMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setDeckMenu(null)} />
          <div className="fixed bottom-0 left-1/2 z-50 w-full max-w-md -translate-x-1/2 rounded-t-3xl border border-edge bg-surface p-2 shadow-2xl sm:bottom-auto sm:top-1/3 sm:rounded-3xl">
            <p className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">{deckMenu.name}</p>
            <button type="button" onClick={() => void openDeck(deckMenu)} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm text-ink active:bg-surface-2">
              <Brain size={18} /> Open
            </button>
            <button type="button" onClick={() => openDeckForm(deckMenu)} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm text-ink active:bg-surface-2">
              <Pencil size={18} /> Edit
            </button>
            <button type="button" onClick={() => void deleteDeck(deckMenu)} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm text-rose-400 active:bg-surface-2">
              <Trash2 size={18} /> Delete
            </button>
          </div>
        </>
      )}

      {deckFormOpen && (
        <MobileModal
          open={deckFormOpen}
          onClose={() => setDeckFormOpen(false)}
          title={editingDeck ? "Edit deck" : "New deck"}
          footer={
            <>
              <MobileButton variant="ghost" onClick={() => setDeckFormOpen(false)}>Cancel</MobileButton>
              <MobileButton onClick={() => void saveDeck()}>{editingDeck ? "Save" : "Create"}</MobileButton>
            </>
          }
        >
          <label className="block text-xs font-medium text-ink-muted">Name</label>
          <MobileInput value={deckName} onChange={(e) => setDeckName(e.target.value)} placeholder="Deck name" />
          <label className="block text-xs font-medium text-ink-muted">Description</label>
          <MobileTextarea value={deckDesc} onChange={(e) => setDeckDesc(e.target.value)} placeholder="Description (optional)" rows={2} />
          <label className="block text-xs font-medium text-ink-muted">Color</label>
          <div className="flex gap-2">
            {DECK_COLORS.map((c) => (
              <button key={c} type="button" onClick={() => setDeckColor(c)} className={`h-8 w-8 rounded-full border-2 ${deckColor === c ? "border-ink" : "border-transparent"}`} style={{ backgroundColor: c }} aria-label="Pick color" />
            ))}
          </div>
        </MobileModal>
      )}
    </MobileContainer>
  );
}
