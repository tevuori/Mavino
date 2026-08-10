import { useCallback, useEffect, useState } from "react";
import { BookOpen, Brain, FileText, GraduationCap, Lightbulb, List, Plus, Sparkles } from "lucide-react";
import { studyApi, type SourceDescriptor, type StudySession } from "../services/study";
import { flashcardsApi } from "../services/flashcards";
import type { MobileTool } from "./MobileLauncher";
import { useStudyFunctions } from "../apps/study/useStudyFunctions";
import { MobileContainer, MobileEmpty, MobileFab, MobileHeader, MobileLoading, MobileTextarea } from "./MobileUi";

type Action = "summarize" | "explain" | "studyGuide" | "flashcards";

const ALL_ACTIONS: { id: Action; label: string; icon: React.ReactNode; functionId: string }[] = [
  { id: "summarize", label: "Summarize", icon: <FileText size={16} />, functionId: "summarize" },
  { id: "explain", label: "Explain", icon: <Lightbulb size={16} />, functionId: "explain" },
  { id: "studyGuide", label: "Study guide", icon: <List size={16} />, functionId: "study_guide" },
  { id: "flashcards", label: "Flashcards", icon: <Brain size={16} />, functionId: "flashcards" },
];

export default function MobileStudy({
  onClose,
  onOpenTool,
}: {
  onClose?: () => void;
  onOpenTool?: (tool: MobileTool) => void;
}) {
  const { enabled, loading: functionsLoading } = useStudyFunctions();
  const [sessions, setSessions] = useState<StudySession[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"list" | "new">("list");
  const [action, setAction] = useState<Action>("summarize");
  const [text, setText] = useState("");
  const [language, setLanguage] = useState<"en" | "cs">("en");
  const [working, setWorking] = useState(false);
  const [result, setResult] = useState<{ title: string; body: string } | null>(null);

  const isFunctionEnabled = (fn: string) => functionsLoading || enabled.has(fn);
  const actions = ALL_ACTIONS.filter((a) => isFunctionEnabled(a.functionId));
  const selectedAction = actions.find((a) => a.id === action) ?? actions[0];

  const load = useCallback(async () => {
    setLoading(true);
    const res = await studyApi.sessions().catch(() => null);
    setSessions(res?.sessions ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async () => {
    if (!text.trim() || !selectedAction) return;
    const source: SourceDescriptor = { kind: "paste", text: text.trim() };
    setWorking(true);
    try {
      if (selectedAction.id === "summarize") {
        const res = await studyApi.summarize({ source, mode: "keypoints", saveAsNote: true, language });
        setResult({ title: "Summary", body: res.summary });
      } else if (selectedAction.id === "explain") {
        const res = await studyApi.explain({ source, depth: "standard", saveAsNote: true, language });
        setResult({ title: "Explanation", body: res.explanation });
      } else if (selectedAction.id === "studyGuide") {
        const res = await studyApi.studyGuide({ sources: [source], saveAsNote: true, language });
        setResult({ title: "Study guide", body: res.guide });
      } else if (selectedAction.id === "flashcards") {
        const res = await studyApi.flashcards({
          source,
          deckName: `Mobile ${new Date().toLocaleDateString()}`,
          count: 10,
          mode: "mixed",
          create: true,
          language,
        });
        if (res.deckId) {
          await flashcardsApi.createCard(res.deckId, { front: res.cards[0]?.front ?? "", back: res.cards[0]?.back ?? "" });
        }
        setResult({
          title: `Flashcards: ${res.deckName}`,
          body: res.cards.map((c) => `Q: ${c.front}\nA: ${c.back}`).join("\n\n"),
        });
      }
    } catch (e) {
      setResult({ title: "Error", body: e instanceof Error ? e.message : "Something went wrong" });
    }
    setWorking(false);
  };

  if (view === "new") {
    return (
      <MobileContainer>
        <MobileHeader title="New study" subtitle="AI workflow" onBack={() => { setView("list"); setResult(null); }} />

        <div className="mb-4 grid grid-cols-2 gap-2">
          {actions.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => { setAction(a.id); setResult(null); }}
              className={`flex items-center justify-center gap-2 rounded-2xl py-2.5 text-sm font-medium ${
                selectedAction?.id === a.id ? "bg-indigo-500 text-white" : "bg-white/[.06] text-slate-300"
              }`}
            >
              {a.icon} {a.label}
            </button>
          ))}
        </div>

        <MobileTextarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste text, notes, or a topic to study"
          rows={6}
          className="mb-3"
        />

        <div className="mb-4 flex gap-2">
          <button
            type="button"
            onClick={() => setLanguage("en")}
            className={`rounded-2xl px-4 py-2 text-sm font-medium ${language === "en" ? "bg-indigo-500 text-white" : "bg-white/[.06] text-slate-300"}`}
          >
            English
          </button>
          <button
            type="button"
            onClick={() => setLanguage("cs")}
            className={`rounded-2xl px-4 py-2 text-sm font-medium ${language === "cs" ? "bg-indigo-500 text-white" : "bg-white/[.06] text-slate-300"}`}
          >
            Čeština
          </button>
        </div>

        <button
          type="button"
          onClick={() => void run()}
          disabled={working || !text.trim() || !selectedAction}
          className="mb-4 w-full rounded-2xl bg-indigo-500 py-3 text-sm font-semibold text-white disabled:opacity-50"
        >
          {working ? "Working…" : `Run ${selectedAction?.label ?? "…"}`}
        </button>

        {result && (
          <div className="rounded-2xl border border-white/10 bg-white/[.045] p-4">
            <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-indigo-300">
              <Sparkles size={16} /> {result.title}
            </p>
            <p className="whitespace-pre-wrap text-sm leading-6 text-slate-300">{result.body}</p>
          </div>
        )}
      </MobileContainer>
    );
  }

  return (
    <MobileContainer>
      <MobileHeader
        title="Study Hub"
        subtitle="AI study workflows"
        onClose={onClose}
        right={<MobileFab onClick={() => setView("new")} icon={<Plus size={22} />} />}
      />

      <div className="mb-5 rounded-2xl border border-white/10 bg-white/[.045] p-4">
        <p className="mb-3 text-sm font-semibold text-white">Quick start</p>
        {onOpenTool && isFunctionEnabled("teach") && (
          <button
            type="button"
            onClick={() => onOpenTool("teach")}
            className="mb-2 flex w-full items-center gap-3 rounded-xl bg-indigo-500/15 px-3 py-3 text-left text-indigo-200 active:bg-indigo-500/25"
          >
            <GraduationCap size={18} />
            <span>
              <span className="block text-sm font-medium text-white">Teach Me</span>
              <span className="block text-xs text-indigo-200/75">Interactive AI tutor</span>
            </span>
          </button>
        )}
        <div className="grid grid-cols-2 gap-2">
          {actions.slice(0, 4).map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => { setAction(a.id); setView("new"); }}
              className="flex items-center gap-2 rounded-xl bg-white/[.06] px-3 py-2.5 text-sm text-slate-300 active:bg-white/[.1]"
            >
              {a.icon} {a.label}
            </button>
          ))}
        </div>
      </div>

      <p className="mb-3 text-sm font-semibold text-white">Recent sessions</p>
      <div className="space-y-2">
        {loading ? (
          <MobileLoading />
        ) : sessions.length ? (
          sessions.map((s) => (
            <article key={s.id} className="rounded-2xl border border-white/10 bg-white/[.045] p-4">
              <div className="flex items-center gap-2 text-white">
                <BookOpen size={16} className="text-indigo-300" />
                <span className="font-medium">{s.title || s.type}</span>
              </div>
              <p className="mt-1 text-xs text-slate-500">{new Date(s.createdAt).toLocaleString()}</p>
              {s.sourceRef && <p className="mt-1 text-xs text-slate-400">Source: {s.sourceRef}</p>}
            </article>
          ))
        ) : (
          <MobileEmpty text="No study sessions yet. Tap + to start learning." />
        )}
      </div>
    </MobileContainer>
  );
}
