// ===== Mobile Scribe (Pro-tier thesis/essay writing coach) =====
// Mobile-optimized view of Scribe — a document list, then a read-only
// rendered-Markdown view of the active document with a tap-to-edit mode
// (plain textarea + Save), a "Get feedback" action, and a feedback panel
// showing overall score + paragraph-level issues grouped by severity.
// The full split-pane editor is desktop-only (long-document editing on a
// phone keyboard is uncomfortable) — MobileDesktopNote points that out.

import { useState, useEffect, useCallback, useRef } from "react";
import {
  PenLine, Plus, Trash2, Loader2, AlertCircle, Sparkles,
  AlertTriangle, Info, Award, Save,
} from "lucide-react";
import {
  scribeApi,
  type ScribeDocumentSummary, type ScribeDocument, type ScribeFeedback, type ScribeIssue,
} from "../services/scribe";
import type { MobileTool } from "./MobileLauncher";
import {
  MobileContainer, MobileHeader, MobileEmpty, MobileLoading, MobileCard,
  MobileButton, MobileModal, MobileMarkdown, MobileTextarea, MobileSelect,
  MobileDesktopNote, MobileToggle,
} from "./MobileUi";

const DOC_TYPE_LABELS: Record<string, string> = {
  essay: "Essay",
  thesis: "Thesis",
  report: "Report",
  literature_review: "Literature Review",
  other: "Document",
};

const SEVERITY_META: Record<ScribeIssue["severity"], { label: string; color: string; bg: string; icon: typeof Info }> = {
  info: { label: "Info", color: "text-blue-400", bg: "bg-blue-500/10", icon: Info },
  warning: { label: "Warning", color: "text-amber-400", bg: "bg-amber-500/10", icon: AlertTriangle },
  critical: { label: "Critical", color: "text-red-400", bg: "bg-red-500/10", icon: AlertCircle },
};

export default function MobileScribe({ onClose }: { onClose: () => void; onOpenTool: (tool: MobileTool) => void }) {
  const [documents, setDocuments] = useState<ScribeDocumentSummary[]>([]);
  const [activeDoc, setActiveDoc] = useState<ScribeDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const loadDocuments = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await scribeApi.listDocuments();
      setDocuments(res.documents);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load documents");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDocument = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await scribeApi.getDocument(id);
      setActiveDoc(res.document);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load document");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadDocuments(); }, [loadDocuments]);

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this document and all its feedback?")) return;
    try {
      await scribeApi.deleteDocument(id);
      await loadDocuments();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete document");
    }
  };

  if (activeDoc) {
    return (
      <DocumentView
        doc={activeDoc}
        onBack={() => { setActiveDoc(null); void loadDocuments(); }}
        onDelete={async () => { await handleDelete(activeDoc.id); setActiveDoc(null); }}
        onRefresh={() => loadDocument(activeDoc.id)}
      />
    );
  }

  return (
    <MobileContainer>
      <MobileHeader
        title="Scribe"
        subtitle="Writing coach"
        onClose={onClose}
        right={
          <button
            onClick={() => setShowCreate(true)}
            className="flex h-11 w-11 items-center justify-center rounded-2xl bg-accent text-accent-fg active:scale-[.97]"
            aria-label="New document"
          >
            <Plus size={20} />
          </button>
        }
      />

      <MobileDesktopNote text="Scribe's full split-pane editor (side-by-side draft + feedback) is more comfortable for long documents on desktop." />

      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {loading ? (
        <MobileLoading />
      ) : documents.length === 0 ? (
        <div className="flex flex-col items-center gap-4 py-10 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-accent/15">
            <PenLine size={32} className="text-accent" />
          </div>
          <p className="max-w-xs text-sm leading-6 text-ink-muted">
            Scribe reviews your essays, theses, and reports — structure, argument, evidence, and citations — with an overall score.
          </p>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 rounded-2xl bg-accent px-5 py-3 text-sm font-semibold text-accent-fg active:scale-[.98]"
          >
            <Plus size={16} /> New document
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {documents.map((doc) => (
            <MobileCard key={doc.id} onClick={() => void loadDocument(doc.id)}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-ink">{doc.title}</p>
                  <div className="mt-1 flex items-center gap-2 text-[11px] text-ink-muted">
                    <span>{DOC_TYPE_LABELS[doc.docType] ?? doc.docType}</span>
                    <span>·</span>
                    <span>{(doc.contentLength / 1000).toFixed(1)}k chars</span>
                  </div>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); void handleDelete(doc.id); }}
                  className="shrink-0 rounded-lg p-1.5 text-ink-muted active:bg-surface-3 active:text-red-300"
                >
                  <Trash2 size={15} />
                </button>
              </div>
              {doc.thesisStatement && (
                <p className="mt-2 line-clamp-2 text-xs leading-5 text-ink-muted">{doc.thesisStatement}</p>
              )}
              {doc.feedbackCount > 0 && (
                <div className="mt-3">
                  <span className="flex w-fit items-center gap-1 rounded-full bg-surface-3 px-2 py-0.5 text-[11px] text-ink-muted">
                    <Sparkles size={10} /> {doc.feedbackCount} feedback{doc.feedbackCount === 1 ? "" : "s"}
                  </span>
                </div>
              )}
            </MobileCard>
          ))}
        </div>
      )}

      <CreateDocumentSheet
        open={showCreate}
        onCancel={() => setShowCreate(false)}
        onComplete={(id) => { setShowCreate(false); void loadDocument(id); }}
      />
    </MobileContainer>
  );
}

// ----- document view -----

function DocumentView({
  doc, onBack, onDelete, onRefresh,
}: {
  doc: ScribeDocument;
  onBack: () => void;
  onDelete: () => void;
  onRefresh: () => Promise<void>;
}) {
  const [mode, setMode] = useState<"read" | "edit">("read");
  const [content, setContent] = useState(doc.content);
  const [title, setTitle] = useState(doc.title);
  const [thesis, setThesis] = useState(doc.thesisStatement);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [feedbackType, setFeedbackType] = useState<"outline" | "draft" | "citations" | "full">("full");
  const [error, setError] = useState<string | null>(null);
  const refreshRef = useRef(onRefresh);
  refreshRef.current = onRefresh;

  useEffect(() => {
    setContent(doc.content);
    setTitle(doc.title);
    setThesis(doc.thesisStatement);
    setDirty(false);
  }, [doc.id, doc.updatedAt]);

  // Poll while feedback is building.
  useEffect(() => {
    const hasBuilding = doc.feedbacks.some((f) => f.status === "building");
    if (!hasBuilding) return;
    const interval = setInterval(() => { void refreshRef.current(); }, 2500);
    return () => clearInterval(interval);
  }, [doc.feedbacks]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await scribeApi.updateDocument(doc.id, { title, content, thesisStatement: thesis });
      setDirty(false);
      await onRefresh();
      setMode("read");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    try {
      await scribeApi.generateFeedback(doc.id, feedbackType);
      await onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Feedback generation failed");
    } finally {
      setGenerating(false);
    }
  };

  const latestFeedback = doc.feedbacks[0] ?? null;

  return (
    <MobileContainer>
      <MobileHeader
        title={doc.title}
        subtitle="Scribe"
        onBack={onBack}
        compact
        right={
          <button
            onClick={onDelete}
            className="flex h-11 w-11 items-center justify-center rounded-2xl bg-surface-2 text-red-300 active:bg-surface-3"
            aria-label="Delete"
          >
            <Trash2 size={18} />
          </button>
        }
      />

      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      <div className="mb-4 flex items-center justify-between gap-2">
        <MobileToggle
          value={mode}
          onChange={setMode}
          options={[{ value: "read", label: "Read" }, { value: "edit", label: "Edit" }]}
        />
        {mode === "edit" && (
          <MobileButton onClick={handleSave} disabled={saving || !dirty}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            Save
          </MobileButton>
        )}
      </div>

      {mode === "edit" ? (
        <div className="mb-6 space-y-3">
          <input
            value={title}
            onChange={(e) => { setTitle(e.target.value); setDirty(true); }}
            placeholder="Title"
            className="w-full rounded-xl border border-edge bg-surface-2 px-3 py-2.5 text-sm font-semibold text-ink outline-none"
          />
          <input
            value={thesis}
            onChange={(e) => { setThesis(e.target.value); setDirty(true); }}
            placeholder="Thesis statement or research question…"
            className="w-full rounded-xl border border-edge bg-surface-2 px-3 py-2.5 text-xs text-ink-muted outline-none"
          />
          <MobileTextarea
            value={content}
            onChange={(e) => { setContent(e.target.value); setDirty(true); }}
            placeholder="Start writing your essay, thesis, or report…"
            rows={14}
            className="font-mono text-sm"
          />
        </div>
      ) : (
        <div className="mb-6">
          {doc.thesisStatement && (
            <p className="mb-3 rounded-2xl border border-edge bg-surface-2 px-4 py-3 text-xs italic leading-5 text-ink-muted">
              {doc.thesisStatement}
            </p>
          )}
          {content.trim() ? (
            <div className="rounded-2xl border border-edge bg-surface-2 p-4">
              <MobileMarkdown content={content} />
            </div>
          ) : (
            <MobileEmpty text="This document is empty. Switch to Edit to start writing." />
          )}
        </div>
      )}

      {/* Feedback request */}
      <div className="mb-4 rounded-2xl border border-edge bg-surface-2 p-4">
        <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-ink">
          <Sparkles size={14} className="text-accent" /> Writing coach
        </h3>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {([
            { key: "full", label: "Full" },
            { key: "outline", label: "Outline" },
            { key: "draft", label: "Draft" },
            { key: "citations", label: "Citations" },
          ] as const).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setFeedbackType(key)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                feedbackType === key ? "bg-accent text-accent-fg" : "bg-surface-3 text-ink-muted"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <MobileButton onClick={handleGenerate} disabled={generating || content.trim().length < 100} className="w-full">
          {generating ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
          Get feedback
        </MobileButton>
        {content.trim().length < 100 && (
          <p className="mt-2 text-[11px] text-ink-muted">Write at least 100 characters first.</p>
        )}
      </div>

      {/* Feedback panel */}
      {latestFeedback && <FeedbackPanel feedback={latestFeedback} />}
    </MobileContainer>
  );
}

function FeedbackPanel({ feedback }: { feedback: ScribeFeedback }) {
  if (feedback.status === "building") {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-edge bg-surface-2 py-10 text-center">
        <Loader2 size={22} className="animate-spin text-accent" />
        <p className="text-sm text-ink-muted">Analyzing your writing…</p>
      </div>
    );
  }

  if (feedback.status === "error") {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
        <AlertCircle size={16} /> {feedback.error || "Feedback generation failed."}
      </div>
    );
  }

  const grouped: Record<ScribeIssue["severity"], ScribeIssue[]> = { critical: [], warning: [], info: [] };
  for (const issue of feedback.issues) {
    (grouped[issue.severity] ?? grouped.info).push(issue);
  }

  return (
    <div className="space-y-4">
      {/* Score */}
      <div className="flex items-center gap-3 rounded-2xl border border-edge bg-surface-2 p-4">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-surface-3">
          <span className={`text-lg font-bold ${
            feedback.score >= 80 ? "text-emerald-400" : feedback.score >= 60 ? "text-amber-400" : "text-red-400"
          }`}>
            {feedback.score}
          </span>
        </div>
        <div>
          <p className="text-sm font-semibold text-ink">Overall score</p>
          <p className="text-xs capitalize text-ink-muted">{feedback.feedbackType} feedback</p>
        </div>
      </div>

      {/* Issues grouped by severity */}
      {feedback.issues.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-ink">Issues ({feedback.issues.length})</h4>
          {(["critical", "warning", "info"] as const).map((sev) =>
            grouped[sev].map((issue, i) => {
              const meta = SEVERITY_META[sev];
              const Icon = meta.icon;
              return (
                <div key={`${sev}-${i}`} className={`rounded-2xl border border-edge p-3 ${meta.bg}`}>
                  <div className="mb-1 flex items-center gap-1.5 text-xs">
                    <Icon size={13} className={meta.color} />
                    <span className={`font-semibold ${meta.color}`}>{meta.label}</span>
                    <span className="text-ink-muted">·</span>
                    <span className="truncate text-ink-muted">{issue.section}</span>
                  </div>
                  <p className="text-xs leading-5 text-ink">{issue.issue}</p>
                  {issue.suggestion && (
                    <p className="mt-1 text-xs italic leading-5 text-ink-muted">→ {issue.suggestion}</p>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Full feedback content */}
      {feedback.content && (
        <div className="rounded-2xl border border-edge bg-surface-2 p-4">
          <h4 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-ink">
            <Award size={13} /> Detailed feedback
          </h4>
          <MobileMarkdown content={feedback.content} />
        </div>
      )}
    </div>
  );
}

// ----- create document sheet -----

function CreateDocumentSheet({
  open, onComplete, onCancel,
}: {
  open: boolean;
  onComplete: (docId: string) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [docType, setDocType] = useState("essay");
  const [thesis, setThesis] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!title.trim()) { setError("Please enter a title."); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await scribeApi.createDocument({
        title: title.trim(),
        docType,
        thesisStatement: thesis.trim() || undefined,
      });
      setTitle("");
      setThesis("");
      onComplete(res.document.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Creation failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <MobileModal open={open} onClose={onCancel} title="New document">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Document title"
        className="w-full rounded-xl border border-edge bg-surface-2 px-3 py-2.5 text-sm text-ink outline-none placeholder:text-ink-muted"
      />
      <MobileSelect value={docType} onChange={(e) => setDocType(e.target.value)}>
        <option value="essay">Essay</option>
        <option value="thesis">Thesis</option>
        <option value="report">Report</option>
        <option value="literature_review">Literature Review</option>
        <option value="other">Other</option>
      </MobileSelect>
      <input
        value={thesis}
        onChange={(e) => setThesis(e.target.value)}
        placeholder="Thesis statement or research question (optional)"
        className="w-full rounded-xl border border-edge bg-surface-2 px-3 py-2.5 text-sm text-ink outline-none placeholder:text-ink-muted"
      />
      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-xs text-red-300">
          <AlertCircle size={14} /> {error}
        </div>
      )}
      <MobileButton onClick={handleSubmit} disabled={loading} className="w-full">
        {loading ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
        Create
      </MobileButton>
    </MobileModal>
  );
}
