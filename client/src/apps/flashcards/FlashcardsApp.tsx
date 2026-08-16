import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Brain, Plus, Trash2, ArrowLeft, ChevronRight, RotateCcw,
  Check, X, AlertCircle, Layers, Sparkles, FileText, Upload, Users,
} from "lucide-react";
import { flashcardsApi } from "../../services/flashcards";
import { linksApi } from "../../services/links";
import type { Flashcard, FlashcardDeck } from "../../types";
import { useWindows } from "../../store/windows";
import type { WindowInstance } from "../../store/windows";
import { useDataRefreshVersion } from "../../store/dataRefresh";
import { setLinkPayload } from "../links/linkDnd";
import LinkDragHandle from "../links/LinkDragHandle";
import LinkBadge from "../links/LinkBadge";
import { useLinkDrop } from "../links/useLinkDrop";

type View = "decks" | "cards" | "review";

const DECK_COLORS = ["#6366f1", "#ec4899", "#22c55e", "#f59e0b", "#06b6d4", "#8b5cf6"];

export default function FlashcardsApp({ win }: { win: WindowInstance }) {
  const [view, setView] = useState<View>("decks");
  const openWindow = useWindows((s) => s.open);
  const refreshVersion = useDataRefreshVersion("flashcards");
  const [decks, setDecks] = useState<(FlashcardDeck & { _count: { cards: number } })[]>([]);
  const [selectedDeck, setSelectedDeck] = useState<FlashcardDeck | null>(null);
  const [cards, setCards] = useState<Flashcard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Deck form
  const [showDeckForm, setShowDeckForm] = useState(false);
  const [deckName, setDeckName] = useState("");
  const [deckDesc, setDeckDesc] = useState("");
  const [deckColor, setDeckColor] = useState(DECK_COLORS[0]);

  // Card form
  const [showCardForm, setShowCardForm] = useState(false);
  const [cardFront, setCardFront] = useState("");
  const [cardBack, setCardBack] = useState("");

  // Review state
  const [reviewQueue, setReviewQueue] = useState<Flashcard[]>([]);
  const [reviewIdx, setReviewIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [reviewStats, setReviewStats] = useState({ again: 0, hard: 0, good: 0, easy: 0 });

  // Permission of the currently-open shared deck (null for own decks).
  const [sharedDeckPermission, setSharedDeckPermission] = useState<"read" | "write" | null>(null);

  // Anki import state
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // "new" = create a new deck from the .apkg; "into" = add to the open deck.
  const importModeRef = useRef<"new" | "into">("new");

  const loadDecks = useCallback(async () => {
    setLoading(true);
    try {
      const { decks } = await flashcardsApi.listDecks();
      setDecks(decks);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadDecks(); }, [loadDecks]);

  // Refresh when Athena generates flashcards (generate_flashcards tool)
  useEffect(() => {
    if (refreshVersion > 0) loadDecks();
  }, [refreshVersion, loadDecks]);

  // Auto-open a deck when opened with a deckId payload (e.g. from Athena's
  // generate_flashcards tool or the Study Hub "Open deck" button).
  useEffect(() => {
    const deckId = win.payload?.deckId;
    if (!deckId || decks.length === 0) return;
    const deck = decks.find((d) => d.id === deckId);
    if (deck) openDeck(deck);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [win.payload, decks]);

  const loadCards = useCallback(async (deckId: string) => {
    setLoading(true);
    try {
      const res = await flashcardsApi.listCards(deckId);
      setCards(res.cards);
      setSharedDeckPermission(res.sharedDeckPermission ?? null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  const openDeck = (deck: FlashcardDeck) => {
    setSelectedDeck(deck);
    setView("cards");
    loadCards(deck.id);
  };

  // Whether the open deck is a Circle-shared deck.
  const isSharedDeck = !!selectedDeck?.shared;
  const isReadOnlyShared = isSharedDeck && sharedDeckPermission !== "write";

  const createDeck = async () => {
    if (!deckName.trim()) return;
    try {
      await flashcardsApi.createDeck({ name: deckName, description: deckDesc, color: deckColor });
      setShowDeckForm(false);
      setDeckName(""); setDeckDesc(""); setDeckColor(DECK_COLORS[0]);
      loadDecks();
    } catch (e) { setError((e as Error).message); }
  };

  const deleteDeck = async (id: string) => {
    try {
      await flashcardsApi.deleteDeck(id);
      loadDecks();
    } catch (e) { setError((e as Error).message); }
  };

  const createCard = async () => {
    if (!cardFront.trim() || !cardBack.trim() || !selectedDeck) return;
    try {
      await flashcardsApi.createCard(selectedDeck.id, { front: cardFront, back: cardBack });
      setShowCardForm(false);
      setCardFront(""); setCardBack("");
      loadCards(selectedDeck.id);
      loadDecks(); // update card count
    } catch (e) { setError((e as Error).message); }
  };

  const deleteCard = async (cardId: string) => {
    if (!confirm("Delete this card?")) return;
    try {
      await flashcardsApi.deleteCard(cardId);
      setCards((cs) => cs.filter((c) => c.id !== cardId));
      loadDecks();
    } catch (e) { setError((e as Error).message); }
  };

  const confirmDeleteDeck = (deck: FlashcardDeck & { _count: { cards: number } }) => {
    if (!confirm(`Delete deck "${deck.name}" and all ${deck._count.cards} card${deck._count.cards === 1 ? "" : "s"}?`)) return;
    deleteDeck(deck.id);
  };

  const startReview = async () => {
    if (!selectedDeck) return;
    // Use due cards, or all cards if none are due
    const dueCards = cards.filter((c) => new Date(c.dueDate) <= new Date());
    const queue = dueCards.length > 0 ? dueCards : cards;
    if (queue.length === 0) return;
    setReviewQueue(queue);
    setReviewIdx(0);
    setFlipped(false);
    setReviewStats({ again: 0, hard: 0, good: 0, easy: 0 });
    setView("review");
  };

  const triggerImport = (mode: "new" | "into") => {
    importModeRef.current = mode;
    fileInputRef.current?.click();
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset the input so the same file can be re-selected later.
    e.target.value = "";
    if (!file) return;
    setImporting(true);
    setError(null);
    try {
      if (importModeRef.current === "new") {
        const { deck } = await flashcardsApi.importAnkiNew(file);
        await loadDecks();
        openDeck(deck);
      } else if (selectedDeck) {
        const { imported } = await flashcardsApi.importAnkiInto(selectedDeck.id, file);
        await loadCards(selectedDeck.id);
        loadDecks();
        setError(null);
        // Reuse the error band briefly as a success toast.
        console.info(`Imported ${imported} cards from Anki package.`);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setImporting(false);
    }
  };

  const reviewCard = async (quality: number) => {
    const card = reviewQueue[reviewIdx];
    if (!card) return;
    try {
      await flashcardsApi.reviewCard(card.id, quality);
      const labels = ["again", "hard", "good", "easy"] as const;
      setReviewStats((s) => ({ ...s, [labels[quality]]: s[labels[quality]] + 1 }));
      if (reviewIdx + 1 < reviewQueue.length) {
        setReviewIdx(reviewIdx + 1);
        setFlipped(false);
      } else {
        // Review complete — go back to cards
        setView("cards");
        if (selectedDeck) loadCards(selectedDeck.id);
        loadDecks();
      }
    } catch (e) { setError((e as Error).message); }
  };

  // ===== Decks View =====
  if (view === "decks") {
    return (
      <div className="flex h-full flex-col bg-surface">
        <div className="flex items-center justify-between border-b border-edge px-4 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
            <Brain size={16} className="text-accent" /> Flashcard Decks
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => triggerImport("new")}
              disabled={importing}
              className="flex items-center gap-1 rounded-lg border border-edge px-3 py-1.5 text-xs font-medium text-ink-muted transition hover:bg-surface-3 hover:text-ink disabled:opacity-50"
              title="Import an Anki .apkg package as a new deck"
            >
              <Upload size={14} /> {importing ? "Importing…" : "Import .apkg"}
            </button>
            <button
              onClick={() => setShowDeckForm(true)}
              className="flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white transition hover:bg-accent/90"
            >
              <Plus size={14} /> New Deck
            </button>
          </div>
        </div>

        {error && <p className="px-4 py-2 text-xs text-red-400">{error}</p>}

        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <p className="py-8 text-center text-sm text-ink-muted">Loading...</p>
          ) : decks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Layers size={48} className="mb-3 text-ink-muted opacity-40" />
              <p className="text-sm text-ink-muted">No decks yet. Create one to start studying!</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 @2xl:grid-cols-2 @4xl:grid-cols-3">
              {decks.map((deck) => (
                <DeckCard
                  key={deck.id}
                  deck={deck}
                  onOpen={() => openDeck(deck)}
                  onDelete={deck.shared ? undefined : () => confirmDeleteDeck(deck)}
                />
              ))}
            </div>
          )}
        </div>

        {/* New deck modal */}
        <AnimatePresence>
          {showDeckForm && (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowDeckForm(false)}>
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-sm rounded-xl border border-edge bg-surface p-5 shadow-window"
              >
                <h3 className="mb-4 text-sm font-semibold text-ink">New Deck</h3>
                <input
                  autoFocus value={deckName} onChange={(e) => setDeckName(e.target.value)}
                  placeholder="Deck name"
                  className="mb-3 w-full rounded-lg border border-edge bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                />
                <textarea
                  value={deckDesc} onChange={(e) => setDeckDesc(e.target.value)}
                  placeholder="Description (optional)" rows={2}
                  className="mb-3 w-full rounded-lg border border-edge bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                />
                <div className="mb-4 flex gap-2">
                  {DECK_COLORS.map((c) => (
                    <button
                      key={c} onClick={() => setDeckColor(c)}
                      className={`h-7 w-7 rounded-full transition ${deckColor === c ? "ring-2 ring-offset-2 ring-offset-surface ring-accent" : ""}`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
                <div className="flex justify-end gap-2">
                  <button onClick={() => setShowDeckForm(false)} className="rounded-lg px-3 py-1.5 text-xs text-ink-muted hover:text-ink">Cancel</button>
                  <button onClick={createDeck} className="rounded-lg bg-accent px-4 py-1.5 text-xs font-medium text-white hover:bg-accent/90">Create</button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Hidden file input for Anki .apkg import (shared via ref) */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".apkg,.anki,.anki2,.anki21"
          className="hidden"
          onChange={(e) => void handleImportFile(e)}
        />
      </div>
    );
  }

  // ===== Cards View =====
  if (view === "cards" && selectedDeck) {
    return (
      <div className="flex h-full flex-col bg-surface">
        <div className="flex items-center justify-between border-b border-edge px-4 py-3">
          <div className="flex items-center gap-2">
            <button onClick={() => { setView("decks"); setSelectedDeck(null); }} className="text-ink-muted hover:text-ink">
              <ArrowLeft size={16} />
            </button>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
              <div className="h-3 w-3 rounded-full" style={{ backgroundColor: selectedDeck.color }} />
              {selectedDeck.name}
              {isSharedDeck && (
                <span className="flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[9px] font-medium text-emerald-400" title={`Shared via ${selectedDeck.sharedGroupName ?? "Circle"}`}>
                  <Users size={9} /> {sharedDeckPermission === "write" ? "write" : "read"}
                </span>
              )}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            {cards.length > 0 && (
              <button
                onClick={startReview}
                className="flex items-center gap-1 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-green-700"
              >
                <Brain size={14} /> Study
              </button>
            )}
            {!isReadOnlyShared && (
              <button
                onClick={() => {
                  if (!selectedDeck) return;
                  openWindow({
                    appId: "study",
                    title: "Study Hub",
                    icon: "GraduationCap",
                    payload: { mode: "flashcards", appendDeckId: selectedDeck.id, appendDeckName: selectedDeck.name },
                  });
                }}
                className="flex items-center gap-1 rounded-lg border border-edge px-3 py-1.5 text-xs font-medium text-ink-muted transition hover:bg-surface-3 hover:text-ink"
                title="Generate AI flashcards and add them to this deck"
              >
                <Sparkles size={14} /> Generate more
              </button>
            )}
            {!isReadOnlyShared && (
              <button
                onClick={() => triggerImport("into")}
                disabled={importing}
                className="flex items-center gap-1 rounded-lg border border-edge px-3 py-1.5 text-xs font-medium text-ink-muted transition hover:bg-surface-3 hover:text-ink disabled:opacity-50"
                title="Import cards from an Anki .apkg package into this deck"
              >
                <Upload size={14} /> {importing ? "Importing…" : "Import"}
              </button>
            )}
            {!isReadOnlyShared && (
              <button
                onClick={() => setShowCardForm(true)}
                className="flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white transition hover:bg-accent/90"
              >
                <Plus size={14} /> Add Card
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <p className="py-8 text-center text-sm text-ink-muted">Loading...</p>
          ) : cards.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Plus size={48} className="mb-3 text-ink-muted opacity-40" />
              <p className="text-sm text-ink-muted">No cards yet. Add some to start studying!</p>
            </div>
          ) : (
            <div className="space-y-2">
              {cards.map((card) => {
                const isDue = new Date(card.dueDate) <= new Date();
                return (
                  <div key={card.id} className="group flex items-start gap-3 rounded-lg border border-edge bg-surface-2 p-3">
                    <div className="min-w-0 flex-1">
                      <p className="mb-1 text-sm font-medium text-ink">{card.front}</p>
                      <p className="text-xs text-ink-muted">{card.back}</p>
                      {card.sourceRef && (
                        <span className="mt-1 inline-flex items-center gap-1 rounded bg-surface-3 px-1.5 py-0.5 text-[10px] text-ink-muted" title="Source this card was generated from">
                          <FileText size={9} /> {card.sourceRef}
                        </span>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                        isDue ? "bg-amber-500/20 text-amber-400" : "bg-surface-3 text-ink-muted"
                      }`}>
                        {isDue ? "Due" : `${card.interval}d`}
                      </span>
                      {!isReadOnlyShared && (
                        <button
                          onClick={() => deleteCard(card.id)}
                          className="text-ink-muted opacity-0 transition hover:text-red-400 group-hover:opacity-100"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Add card modal */}
        <AnimatePresence>
          {showCardForm && (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowCardForm(false)}>
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-md rounded-xl border border-edge bg-surface p-5 shadow-window"
              >
                <h3 className="mb-4 text-sm font-semibold text-ink">New Card</h3>
                <label className="mb-1 block text-xs text-ink-muted">Front (question)</label>
                <textarea
                  autoFocus value={cardFront} onChange={(e) => setCardFront(e.target.value)}
                  placeholder="What is...?" rows={2}
                  className="mb-3 w-full rounded-lg border border-edge bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                />
                <label className="mb-1 block text-xs text-ink-muted">Back (answer)</label>
                <textarea
                  value={cardBack} onChange={(e) => setCardBack(e.target.value)}
                  placeholder="The answer is..." rows={3}
                  className="mb-4 w-full rounded-lg border border-edge bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                />
                <div className="flex justify-end gap-2">
                  <button onClick={() => setShowCardForm(false)} className="rounded-lg px-3 py-1.5 text-xs text-ink-muted hover:text-ink">Cancel</button>
                  <button onClick={createCard} className="rounded-lg bg-accent px-4 py-1.5 text-xs font-medium text-white hover:bg-accent/90">Add</button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Hidden file input for Anki .apkg import (shared via ref) */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".apkg,.anki,.anki2,.anki21"
          className="hidden"
          onChange={(e) => void handleImportFile(e)}
        />
      </div>
    );
  }

  // ===== Review View =====
  if (view === "review" && selectedDeck) {
    const card = reviewQueue[reviewIdx];
    if (!card) {
      setView("cards");
      return null;
    }
    const progress = ((reviewIdx + 1) / reviewQueue.length) * 100;

    return (
      <div className="flex h-full flex-col bg-surface">
        {/* Header */}
        <div className="border-b border-edge px-4 py-3">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
              <Brain size={16} className="text-accent" />
              {selectedDeck.name} — Review
            </h2>
            <button
              onClick={() => setView("cards")}
              className="text-xs text-ink-muted hover:text-ink"
            >
              Exit
            </button>
          </div>
          {/* Progress bar */}
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
            <motion.div
              className="h-full rounded-full bg-accent"
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.3 }}
            />
          </div>
          <p className="mt-1 text-xs text-ink-muted">{reviewIdx + 1} of {reviewQueue.length}</p>
        </div>

        {/* Flashcard — single face rendered at a time (no 3D backface-visibility,
            which is unreliable across browsers/GPUs and causes mirrored/bleeding
            answers). A lightweight fade conveys the flip. */}
        <div className="flex flex-1 flex-col items-center justify-center p-6">
          <motion.div
            key={card.id + (flipped ? "-back" : "-front")}
            initial={{ opacity: 0, rotateY: flipped ? -90 : 90 }}
            animate={{ opacity: 1, rotateY: 0 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="relative w-full max-w-md"
            style={{ transformStyle: "preserve-3d" }}
          >
            <div
              onClick={() => setFlipped(!flipped)}
              className="relative min-h-[280px] cursor-pointer rounded-2xl border border-edge p-8 shadow-window"
              style={{ backgroundColor: selectedDeck.color + "15" }}
            >
              {!flipped ? (
                <div className="flex h-full min-h-[280px] flex-col items-center justify-center p-8">
                  <p className="mb-4 text-xs font-semibold uppercase tracking-wide text-ink-muted">Question</p>
                  <p className="text-center text-xl font-medium text-ink">{card.front}</p>
                  <p className="absolute bottom-4 text-xs text-ink-muted">Click to flip</p>
                </div>
              ) : (
                <div className="flex h-full min-h-[280px] flex-col items-center justify-center p-8">
                  <p className="mb-4 text-xs font-semibold uppercase tracking-wide" style={{ color: selectedDeck.color }}>Answer</p>
                  <p className="text-center text-lg text-ink">{card.back}</p>
                  <p className="absolute bottom-4 text-xs text-ink-muted">How well did you know this?</p>
                </div>
              )}
            </div>
          </motion.div>

          {/* Rating buttons (only show after flip) */}
          <AnimatePresence>
            {flipped && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                className="mt-6 grid w-full max-w-md grid-cols-2 @3xl:grid-cols-4 gap-2"
              >
                <button
                  onClick={() => reviewCard(0)}
                  className="flex flex-col items-center gap-1 rounded-xl bg-red-500/15 py-3 text-red-400 transition hover:bg-red-500/25"
                >
                  <X size={18} />
                  <span className="text-xs font-medium">Again</span>
                </button>
                <button
                  onClick={() => reviewCard(1)}
                  className="flex flex-col items-center gap-1 rounded-xl bg-orange-500/15 py-3 text-orange-400 transition hover:bg-orange-500/25"
                >
                  <AlertCircle size={18} />
                  <span className="text-xs font-medium">Hard</span>
                </button>
                <button
                  onClick={() => reviewCard(2)}
                  className="flex flex-col items-center gap-1 rounded-xl bg-blue-500/15 py-3 text-blue-400 transition hover:bg-blue-500/25"
                >
                  <Check size={18} />
                  <span className="text-xs font-medium">Good</span>
                </button>
                <button
                  onClick={() => reviewCard(3)}
                  className="flex flex-col items-center gap-1 rounded-xl bg-green-500/15 py-3 text-green-400 transition hover:bg-green-500/25"
                >
                  <RotateCcw size={18} />
                  <span className="text-xs font-medium">Easy</span>
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Review stats footer */}
        <div className="border-t border-edge px-4 py-2">
          <div className="flex justify-center gap-4 text-xs text-ink-muted">
            <span className="text-red-400">Again: {reviewStats.again}</span>
            <span className="text-orange-400">Hard: {reviewStats.hard}</span>
            <span className="text-blue-400">Good: {reviewStats.good}</span>
            <span className="text-green-400">Easy: {reviewStats.easy}</span>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

function DeckCard({ deck, onOpen, onDelete }: { deck: FlashcardDeck & { _count: { cards: number } }; onOpen: () => void; onDelete?: () => void }) {
  const [refreshSignal, setRefreshSignal] = useState(0);
  const { onDragOver, onDragEnter, onDragLeave, onDrop, isOver } = useLinkDrop(
    "flashcardDeck",
    deck.id,
    async (payload) => {
      try {
        await linksApi.create(payload.type, payload.id, "flashcardDeck", deck.id);
        setRefreshSignal((n) => n + 1);
      } catch (e) {
        console.error("Link failed", e);
      }
    }
  );
  return (
    <div
      onDragOver={onDragOver}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`group relative rounded-xl border bg-surface-2 p-4 transition hover:border-accent/50 ${
        isOver ? "border-accent ring-2 ring-accent/30" : "border-edge"
      }`}
    >
      {deck.shared && (
        <div className="absolute left-2 top-2 z-10 flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[9px] font-medium text-emerald-400" title={`Shared via ${deck.sharedGroupName ?? "Circle"}`}>
          <Users size={9} /> {deck.sharedPermission === "write" ? "Shared · write" : "Shared · read"}
        </div>
      )}
      <button
        draggable={!deck.shared}
        onDragStart={(e) => {
          e.stopPropagation();
          setLinkPayload(e, { type: "flashcardDeck", id: deck.id, title: deck.name });
        }}
        onClick={onOpen}
        className="group relative w-full overflow-hidden rounded-lg text-left"
      >
        <div
          className="absolute right-0 top-0 h-20 w-20 rounded-bl-full opacity-20"
          style={{ backgroundColor: deck.color }}
        />
        <div className="relative">
          <div className="mb-2 h-1.5 w-10 rounded-full" style={{ backgroundColor: deck.color }} />
          <h3 className="mb-1 font-semibold text-ink">{deck.name}</h3>
          <p className="mb-3 line-clamp-2 text-xs text-ink-muted">{deck.description || "No description"}</p>
          <div className="flex items-center justify-between">
            <span className="text-xs text-ink-muted">{deck._count.cards} cards</span>
            <ChevronRight size={16} className="text-ink-muted transition group-hover:translate-x-0.5" />
          </div>
        </div>
      </button>
      <div className="relative mt-2 flex items-center justify-between">
        <LinkDragHandle type="flashcardDeck" id={deck.id} title={deck.name} className="opacity-60" />
        <div className="flex items-center gap-1">
          <LinkBadge type="flashcardDeck" id={deck.id} refreshSignal={refreshSignal} />
          {onDelete && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              title="Delete deck"
              className="text-ink-muted opacity-0 transition hover:text-red-400 group-hover:opacity-100"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
