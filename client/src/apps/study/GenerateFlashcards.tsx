// ===== Study Hub: Generate Flashcards =====

import { useState } from "react";
import { Sparkles, Plus, Trash2, Save } from "lucide-react";
import WorkspaceSourceSelector, { studySourceToDescriptor } from "./WorkspaceSourceSelector";
import { studySourcesApi, type StudySource } from "../../services/study-sources";
import { ActionButton, ErrorBanner, Loading, PinnedGraph, PreselectedSource, SuccessBanner, TruncationNote } from "./ui";
import { studyApi, type SourceDescriptor, type GeneratedCard } from "../../services/study";
import { flashcardsApi } from "../../services/flashcards";
import { useWindows } from "../../store/windows";

export default function GenerateFlashcards({ initialSource, initialGraphId, appendDeck, language }: {
  initialSource?: SourceDescriptor | null;
  initialGraphId?: string | null;
  appendDeck?: { id: string; name: string } | null;
  language?: "en" | "cs";
}) {
  const [selectedSourceIds, setSelectedSourceIds] = useState<Set<string>>(new Set());
  const [pinnedSource, setPinnedSource] = useState<SourceDescriptor | null>(initialSource ?? null);
  const [graphId, setGraphId] = useState<string | null>(initialGraphId ?? null);
  const toggleSource = (id: string) => {
    setSelectedSourceIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const getSources = async (): Promise<SourceDescriptor[]> => {
    if (pinnedSource) return [pinnedSource];
    const { sources: lib } = await studySourcesApi.list();
    return [...selectedSourceIds].map((id) => {
      const s = lib.find((x) => x.id === id);
      return s ? studySourceToDescriptor(s) : null;
    }).filter((x): x is SourceDescriptor => x !== null);
  };
  const [count, setCount] = useState(10);
  const [mode, setMode] = useState<"concept" | "factual" | "mixed" | "cloze">("mixed");
  const [deckName, setDeckName] = useState(appendDeck?.name ?? "");
  const [targetDeckId, setTargetDeckId] = useState<string | null>(appendDeck?.id ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [cards, setCards] = useState<GeneratedCard[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [createdDeckId, setCreatedDeckId] = useState<string | null>(null);
  const openWindow = useWindows((s) => s.open);

  const hasSource = graphId !== null || pinnedSource !== null || selectedSourceIds.size > 0;

  const run = async () => {
    if (!hasSource) return;
    setLoading(true);
    setError("");
    setSuccess("");
    setCards([]);
    setCreatedDeckId(null);
    try {
      const res = await studyApi.flashcards({
        ...(graphId ? { graphId } : { sources: await getSources() }),
        count,
        mode,
        deckName: deckName.trim() || undefined,
        create: false, // preview first
        language,
      });
      setCards(res.cards);
      setTruncated(res.truncated);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate flashcards");
    } finally {
      setLoading(false);
    }
  };

  const updateCard = (i: number, field: "front" | "back", val: string) => {
    setCards((prev) => prev.map((c, idx) => (idx === i ? { ...c, [field]: val } : c)));
  };

  const removeCard = (i: number) => {
    setCards((prev) => prev.filter((_, idx) => idx !== i));
  };

  const addCard = () => {
    setCards((prev) => [...prev, { front: "", back: "" }]);
  };

  const saveDeck = async () => {
    const valid = cards.filter((c) => c.front.trim() && c.back.trim());
    if (valid.length === 0) return;
    setLoading(true);
    setError("");
    try {
      let deckId: string;
      let name: string;
      if (targetDeckId) {
        // Append to existing deck
        deckId = targetDeckId;
        name = deckName.trim() || "AI Flashcards";
        for (const c of valid) {
          await flashcardsApi.createCard(deckId, c);
        }
      } else {
        // Create a new deck + cards
        name = deckName.trim() || "AI Flashcards";
        const deck = await flashcardsApi.createDeck({ name });
        deckId = deck.deck.id;
        for (const c of valid) {
          await flashcardsApi.createCard(deckId, c);
        }
      }
      setCreatedDeckId(deckId);
      setSuccess(`${targetDeckId ? "Added" : "Saved"} ${valid.length} cards ${targetDeckId ? "to" : "to a new deck:"} "${name}".`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save deck");
    } finally {
      setLoading(false);
    }
  };

  const openDeck = () => {
    if (!createdDeckId) return;
    openWindow({ appId: "flashcards", title: "Flashcards", icon: "Brain", payload: { deckId: createdDeckId } });
  };

  return (
    <div className="flex flex-col gap-3">
      {graphId ? (
        <PinnedGraph graphId={graphId} onDismiss={() => setGraphId(null)} />
      ) : pinnedSource ? (
        <PreselectedSource source={pinnedSource} onDismiss={() => setPinnedSource(null)} />
      ) : (
        <WorkspaceSourceSelector selectedIds={selectedSourceIds} onToggle={toggleSource} disabled={loading} />
      )}

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-ink-muted">
          Count
          <input
            type="number"
            min={1}
            max={40}
            value={count}
            onChange={(e) => setCount(Math.max(1, Math.min(40, Number(e.target.value) || 10)))}
            className="w-20 rounded-md border border-edge bg-surface-2 px-2 py-1.5 text-ink outline-none focus:border-accent"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-muted">
          Style
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as typeof mode)}
            className="rounded-md border border-edge bg-surface-2 px-2 py-1.5 text-ink outline-none focus:border-accent"
          >
            <option value="mixed">Mixed</option>
            <option value="concept">Concepts</option>
            <option value="factual">Facts</option>
            <option value="cloze">Cloze (fill-in-the-blank)</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-muted">
          {targetDeckId ? "Append to deck" : "Deck name (optional)"}
          <input
            value={deckName}
            onChange={(e) => setDeckName(e.target.value)}
            placeholder={targetDeckId ? "Existing deck" : "AI Flashcards"}
            disabled={!!targetDeckId}
            className="w-48 rounded-md border border-edge bg-surface-2 px-2 py-1.5 text-ink outline-none focus:border-accent disabled:opacity-60"
          />
        </label>
        {targetDeckId && (
          <button
            onClick={() => { setTargetDeckId(null); setDeckName(""); }}
            className="flex items-center gap-1 rounded-md border border-edge px-2 py-1.5 text-[11px] text-ink-muted hover:bg-surface-2 hover:text-ink"
            title="Create a new deck instead"
          >
            <Trash2 size={12} /> New deck
          </button>
        )}
        <ActionButton onClick={run} disabled={!hasSource} loading={loading}>
          <Sparkles size={13} /> Generate
        </ActionButton>
      </div>

      {loading && <Loading label="Generating flashcards…" />}
      {error && <ErrorBanner message={error} />}
      <TruncationNote show={truncated} />
      {success && (
        <div className="flex items-center gap-2">
          <SuccessBanner message={success} />
          {createdDeckId && (
            <ActionButton onClick={openDeck} variant="ghost">
              Open deck
            </ActionButton>
          )}
        </div>
      )}

      {cards.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-ink-muted">
              {cards.length} cards — edit, then {targetDeckId ? "append to deck" : "save to a deck"}
            </span>
            <div className="flex gap-1.5">
              <button
                onClick={addCard}
                className="flex items-center gap-1 rounded-md border border-edge px-2 py-1 text-[11px] text-ink-muted hover:bg-surface-2 hover:text-ink"
              >
                <Plus size={12} /> Add
              </button>
              <ActionButton onClick={saveDeck} loading={loading}>
                <Save size={13} /> {targetDeckId ? "Append cards" : "Save deck"}
              </ActionButton>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            {cards.map((c, i) => (
              <div key={i} className="flex items-start gap-2 rounded-md border border-edge bg-surface-2 p-2">
                <div className="flex flex-1 flex-col gap-1.5">
                  <input
                    value={c.front}
                    onChange={(e) => updateCard(i, "front", e.target.value)}
                    placeholder="Front (question)"
                    className="w-full rounded border border-edge bg-surface px-2 py-1 text-xs text-ink outline-none focus:border-accent"
                  />
                  <input
                    value={c.back}
                    onChange={(e) => updateCard(i, "back", e.target.value)}
                    placeholder="Back (answer)"
                    className="w-full rounded border border-edge bg-surface px-2 py-1 text-xs text-ink outline-none focus:border-accent"
                  />
                </div>
                <button
                  onClick={() => removeCard(i)}
                  className="mt-1 rounded p-1 text-ink-muted hover:bg-red-500/10 hover:text-red-400"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
