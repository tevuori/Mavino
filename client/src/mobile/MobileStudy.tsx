import { useCallback, useEffect, useState } from "react";
import {
  BookOpen, Brain, ClipboardPaste, ExternalLink, FileText, Folder,
  GraduationCap, Lightbulb, List, Plus, Sparkles, Globe, NotebookPen,
} from "lucide-react";
import { studyApi, type SourceDescriptor, type SourceKind, type StudySession } from "../services/study";
import { notesApi } from "../services/notes";
import { filesApi } from "../services/files";
import type { Note, VFile } from "../types";
import type { MobileTool } from "./MobileLauncher";
import type { MobileToolPayload } from "./MobileToolPage";
import { useStudyFunctions } from "../apps/study/useStudyFunctions";
import {
  MobileButton, MobileContainer, MobileEmpty, MobileFab, MobileHeader, MobileLoading,
  MobileMarkdown, MobileTextarea,
} from "./MobileUi";

type Action = "summarize" | "explain" | "studyGuide" | "flashcards";

const ALL_ACTIONS: { id: Action; label: string; icon: React.ReactNode; functionId: string }[] = [
  { id: "summarize", label: "Summarize", icon: <FileText size={16} />, functionId: "summarize" },
  { id: "explain", label: "Explain", icon: <Lightbulb size={16} />, functionId: "explain" },
  { id: "studyGuide", label: "Study guide", icon: <List size={16} />, functionId: "study_guide" },
  { id: "flashcards", label: "Flashcards", icon: <Brain size={16} />, functionId: "flashcards" },
];

const SOURCE_KINDS: { id: SourceKind; label: string; icon: React.ReactNode }[] = [
  { id: "paste", label: "Paste text", icon: <ClipboardPaste size={16} /> },
  { id: "note", label: "Note", icon: <NotebookPen size={16} /> },
  { id: "file", label: "File", icon: <Folder size={16} /> },
  { id: "url", label: "URL", icon: <Globe size={16} /> },
];

export default function MobileStudy({
  onClose,
  onOpenTool,
  payload,
}: {
  onClose?: () => void;
  onOpenTool?: (tool: MobileTool, payload?: MobileToolPayload) => void;
  payload?: MobileToolPayload;
}) {
  const { enabled, loading: functionsLoading } = useStudyFunctions();
  const [sessions, setSessions] = useState<StudySession[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"list" | "new" | "detail">("list");
  const [action, setAction] = useState<Action>("summarize");
  const [sourceKind, setSourceKind] = useState<SourceKind>("paste");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [language, setLanguage] = useState<"en" | "cs">("en");
  const [working, setWorking] = useState(false);
  const [result, setResult] = useState<{ title: string; body: string } | null>(null);
  const [resultNoteId, setResultNoteId] = useState<string | null>(null);

  // Source pickers
  const [notes, setNotes] = useState<Note[]>([]);
  const [files, setFiles] = useState<VFile[]>([]);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);

  // Session detail
  const [detailSession, setDetailSession] = useState<StudySession | null>(null);

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

  // Load notes/files lists lazily when entering the "new" view
  const loadSources = useCallback(async () => {
    const [nRes, fRes] = await Promise.all([
      notesApi.list().catch(() => null),
      filesApi.all().catch(() => null),
    ]);
    setNotes(nRes?.notes ?? []);
    setFiles(fRes?.files ?? []);
  }, []);

  // Handle incoming payload (e.g. from Notes "Study" menu)
  useEffect(() => {
    if (!payload?.study) return;
    const sp = payload.study;
    setView("new");
    if (sp.sourceKind) setSourceKind(sp.sourceKind);
    if (sp.mode) {
      const map: Record<string, Action> = {
        summarize: "summarize", explain: "explain", flashcards: "flashcards",
        study_guide: "studyGuide", quiz: "summarize", study: "summarize",
      };
      const mapped = map[sp.mode];
      if (mapped) setAction(mapped);
    }
    if (sp.sourceKind === "note" && sp.sourceId) {
      setSelectedNoteId(sp.sourceId);
      void loadSources();
    }
    if (sp.sourceKind === "file" && sp.sourceId) {
      setSelectedFileId(sp.sourceId);
      void loadSources();
    }
    if (sp.sourceKind === "paste" && sp.text) setText(sp.text);
    if (sp.sourceKind === "url" && sp.sourceUrl) setUrl(sp.sourceUrl);
  }, [payload, loadSources]);

  const openNew = () => {
    setView("new");
    setResult(null);
    void loadSources();
  };

  const buildSource = (): SourceDescriptor | undefined => {
    if (sourceKind === "paste") return { kind: "paste", text: text.trim() };
    if (sourceKind === "note") return selectedNoteId ? { kind: "note", id: selectedNoteId, name: notes.find((n) => n.id === selectedNoteId)?.title } : undefined;
    if (sourceKind === "file") return selectedFileId ? { kind: "file", id: selectedFileId, name: files.find((f) => f.id === selectedFileId)?.name } : undefined;
    if (sourceKind === "url") return { kind: "url", url: url.trim() };
    return undefined;
  };

  const run = async () => {
    const source = buildSource();
    if (!source || !selectedAction) return;
    if (sourceKind === "paste" && !text.trim()) return;
    if (sourceKind === "url" && !url.trim()) return;
    setWorking(true);
    setResult(null);
    setResultNoteId(null);
    try {
      if (selectedAction.id === "summarize") {
        const res = await studyApi.summarize({ source, mode: "keypoints", saveAsNote: true, language });
        setResult({ title: "Summary", body: res.summary });
        setResultNoteId(res.noteId);
      } else if (selectedAction.id === "explain") {
        const res = await studyApi.explain({ source, depth: "standard", saveAsNote: true, language });
        setResult({ title: "Explanation", body: res.explanation });
        setResultNoteId(res.noteId);
      } else if (selectedAction.id === "studyGuide") {
        const res = await studyApi.studyGuide({ sources: [source], saveAsNote: true, language });
        setResult({ title: "Study guide", body: res.guide });
        setResultNoteId(res.noteId);
      } else if (selectedAction.id === "flashcards") {
        const res = await studyApi.flashcards({
          source,
          deckName: `Mobile ${new Date().toLocaleDateString()}`,
          count: 10,
          mode: "mixed",
          create: true,
          language,
        });
        setResult({
          title: `Flashcards: ${res.deckName}`,
          body: res.cards.map((c) => `**Q:** ${c.front}\n\n**A:** ${c.back}`).join("\n\n---\n\n"),
        });
      }
      void load();
    } catch (e) {
      setResult({ title: "Error", body: e instanceof Error ? e.message : "Something went wrong" });
    }
    setWorking(false);
  };

  const openNote = (noteId: string) => {
    onOpenTool?.("notes", {});
    // Notes doesn't accept a noteId payload yet; user can find it in the list.
    void noteId;
  };

  // ===== Session detail view =====
  if (view === "detail" && detailSession) {
    const s = detailSession;
    const metaNoteId = typeof s.meta?.noteId === "string" ? (s.meta.noteId as string) : null;
    return (
      <MobileContainer>
        <MobileHeader compact title={s.title || s.type} subtitle="Session" onBack={() => setView("list")} />
        <div className="space-y-3">
          <div className="rounded-2xl border border-edge bg-surface-2 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Type</p>
            <p className="mt-1 text-sm text-ink">{s.type}</p>
          </div>
          <div className="rounded-2xl border border-edge bg-surface-2 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">When</p>
            <p className="mt-1 text-sm text-ink">{new Date(s.createdAt).toLocaleString()}</p>
          </div>
          {s.sourceRef && (
            <div className="rounded-2xl border border-edge bg-surface-2 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Source</p>
              <p className="mt-1 text-sm text-ink">{s.sourceRef}</p>
            </div>
          )}
          {metaNoteId && (
            <MobileButton onClick={() => openNote(metaNoteId)}>
              <ExternalLink size={16} /> Open saved note
            </MobileButton>
          )}
        </div>
      </MobileContainer>
    );
  }

  // ===== New study view =====
  if (view === "new") {
    return (
      <MobileContainer>
        <MobileHeader compact title="New study" subtitle="AI workflow" onBack={() => { setView("list"); setResult(null); }} />

        {/* Action picker */}
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">Action</p>
        <div className="mb-4 grid grid-cols-2 gap-2">
          {actions.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => { setAction(a.id); setResult(null); }}
              className={`flex items-center justify-center gap-2 rounded-2xl py-2.5 text-sm font-medium ${selectedAction?.id === a.id ? "bg-accent text-accent-fg" : "bg-surface-2 text-ink-muted"}`}
            >
              {a.icon} {a.label}
            </button>
          ))}
        </div>

        {/* Source picker */}
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">Source</p>
        <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
          {SOURCE_KINDS.map((k) => (
            <button
              key={k.id}
              type="button"
              onClick={() => setSourceKind(k.id)}
              className={`flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-sm font-medium ${sourceKind === k.id ? "bg-accent text-accent-fg" : "bg-surface-2 text-ink-muted"}`}
            >
              {k.icon} {k.label}
            </button>
          ))}
        </div>

        {/* Source input by kind */}
        {sourceKind === "paste" && (
          <MobileTextarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste text, notes, or a topic to study" rows={6} className="mb-3" />
        )}
        {sourceKind === "url" && (
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/article"
            className="mb-3 w-full rounded-2xl border border-edge bg-surface-2 px-4 py-3 text-base text-ink outline-none placeholder:text-ink-muted focus:border-accent/60"
          />
        )}
        {sourceKind === "note" && (
          <div className="mb-3 max-h-64 space-y-2 overflow-y-auto">
            {notes.length === 0 ? <MobileEmpty text="No notes found." /> : notes.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => setSelectedNoteId(n.id)}
                className={`flex w-full items-center gap-3 rounded-2xl border p-3 text-left ${selectedNoteId === n.id ? "border-accent bg-accent/10" : "border-edge bg-surface-2"}`}
              >
                <NotebookPen size={18} className="text-accent" />
                <span className="min-w-0 flex-1 truncate text-sm text-ink">{n.title || "Untitled"}</span>
              </button>
            ))}
          </div>
        )}
        {sourceKind === "file" && (
          <div className="mb-3 max-h-64 space-y-2 overflow-y-auto">
            {files.length === 0 ? <MobileEmpty text="No files found." /> : files.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setSelectedFileId(f.id)}
                className={`flex w-full items-center gap-3 rounded-2xl border p-3 text-left ${selectedFileId === f.id ? "border-accent bg-accent/10" : "border-edge bg-surface-2"}`}
              >
                <Folder size={18} className="text-accent" />
                <span className="min-w-0 flex-1 truncate text-sm text-ink">{f.name}</span>
              </button>
            ))}
          </div>
        )}

        {/* Language */}
        <div className="mb-4 flex gap-2">
          <button type="button" onClick={() => setLanguage("en")} className={`rounded-2xl px-4 py-2 text-sm font-medium ${language === "en" ? "bg-accent text-accent-fg" : "bg-surface-2 text-ink-muted"}`}>English</button>
          <button type="button" onClick={() => setLanguage("cs")} className={`rounded-2xl px-4 py-2 text-sm font-medium ${language === "cs" ? "bg-accent text-accent-fg" : "bg-surface-2 text-ink-muted"}`}>Čeština</button>
        </div>

        <MobileButton onClick={() => void run()} disabled={working || !selectedAction} className="mb-4 w-full">
          {working ? "Working…" : `Run ${selectedAction?.label ?? "…"}`}
        </MobileButton>

        {result && (
          <div className="rounded-2xl border border-edge bg-surface-2 p-4">
            <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-accent">
              <Sparkles size={16} /> {result.title}
            </p>
            <MobileMarkdown content={result.body} />
            {resultNoteId && (
              <MobileButton variant="ghost" className="mt-3" onClick={() => openNote(resultNoteId)}>
                <ExternalLink size={14} /> Open saved note
              </MobileButton>
            )}
          </div>
        )}
      </MobileContainer>
    );
  }

  // ===== List view =====
  return (
    <MobileContainer>
      <MobileHeader
        title="Study Hub"
        subtitle="AI study workflows"
        onClose={onClose}
        right={<MobileFab onClick={openNew} icon={<Plus size={22} />} label="New study" />}
      />

      <div className="mb-5 rounded-2xl border border-edge bg-surface-2 p-4">
        <p className="mb-3 text-sm font-semibold text-ink">Quick start</p>
        {onOpenTool && isFunctionEnabled("teach") && (
          <button
            type="button"
            onClick={() => onOpenTool("teach")}
            className="mb-2 flex w-full items-center gap-3 rounded-xl bg-accent/15 px-3 py-3 text-left text-accent active:bg-accent/25"
          >
            <GraduationCap size={18} />
            <span>
              <span className="block text-sm font-medium text-ink">Teach Me</span>
              <span className="block text-xs text-ink-muted">Interactive AI tutor</span>
            </span>
          </button>
        )}
        <div className="grid grid-cols-2 gap-2">
          {actions.slice(0, 4).map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => { setAction(a.id); openNew(); }}
              className="flex items-center gap-2 rounded-xl bg-surface-3 px-3 py-2.5 text-sm text-ink active:bg-surface-3"
            >
              {a.icon} {a.label}
            </button>
          ))}
        </div>
      </div>

      <p className="mb-3 text-sm font-semibold text-ink">Recent sessions</p>
      <div className="space-y-2">
        {loading ? (
          <MobileLoading />
        ) : sessions.length ? (
          sessions.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => { setDetailSession(s); setView("detail"); }}
              className="w-full rounded-2xl border border-edge bg-surface-2 p-4 text-left active:bg-surface-3"
            >
              <div className="flex items-center gap-2 text-ink">
                <BookOpen size={16} className="text-accent" />
                <span className="font-medium">{s.title || s.type}</span>
              </div>
              <p className="mt-1 text-xs text-ink-muted">{new Date(s.createdAt).toLocaleString()}</p>
              {s.sourceRef && <p className="mt-1 text-xs text-ink-muted">Source: {s.sourceRef}</p>}
            </button>
          ))
        ) : (
          <MobileEmpty text="No study sessions yet. Tap + to start learning." />
        )}
      </div>
    </MobileContainer>
  );
}
