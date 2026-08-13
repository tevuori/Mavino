// ===== Scribe app (Pro-tier thesis/essay writing coach) =====
// A writing coach that analyzes the user's drafts and provides AI feedback:
// structure analysis, paragraph-level critique, citation gap detection
// (against Compass), and overall scoring.
//
// UI: two-state layout —
//   1. Document list: shows all drafts with metadata + "New" button
//   2. Editor view: split-pane with Markdown editor on the left and
//      feedback panel on the right (with polling for building feedback)
//
// Integrates with Compass (citation gaps) and Atlas (concept coverage).

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  PenLine, Plus, Trash2, RefreshCw, Loader2, AlertCircle, X,
  ChevronLeft, Sparkles, FileText, CheckCircle2, AlertTriangle,
  Info, Award, Save, Eye, EyeOff,
} from "lucide-react";
import {
  scribeApi,
  type ScribeDocumentSummary, type ScribeDocument, type ScribeFeedback, type ScribeIssue,
} from "../../services/scribe";
import type { WindowInstance } from "../../store/windows";

// ----- helpers -----

const DOC_TYPE_LABELS: Record<string, string> = {
  essay: "Essay",
  thesis: "Thesis",
  report: "Report",
  literature_review: "Literature Review",
  other: "Document",
};

const SEVERITY_META: Record<ScribeIssue["severity"], { label: string; color: string; icon: typeof Info }> = {
  info: { label: "Info", color: "text-blue-400", icon: Info },
  warning: { label: "Warning", color: "text-amber-400", icon: AlertTriangle },
  critical: { label: "Critical", color: "text-red-400", icon: AlertCircle },
};

// ----- main component -----

export default function ScribeApp({ win }: { win: WindowInstance }) {
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

  const loadDocument = useCallback(async (docId: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await scribeApi.getDocument(docId);
      setActiveDoc(res.document);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load document");
    } finally {
      setLoading(false);
    }
  }, []);

  // Focus on a specific document (from Athena open_scribe client action).
  useEffect(() => {
    const focusDocId = sessionStorage.getItem(`scribe:focus:${win.id}`);
    if (focusDocId) {
      sessionStorage.removeItem(`scribe:focus:${win.id}`);
      loadDocument(focusDocId);
    } else {
      loadDocuments();
    }
  }, [win.id, loadDocuments, loadDocument]);

  const handleDelete = async (docId: string) => {
    if (!confirm("Delete this document and all its feedback?")) return;
    try {
      await scribeApi.deleteDocument(docId);
      setActiveDoc(null);
      await loadDocuments();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete document");
    }
  };

  if (loading && !activeDoc && documents.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-ink-muted">
        <Loader2 className="animate-spin" size={24} />
      </div>
    );
  }

  if (error && !activeDoc) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <AlertCircle className="text-red-400" size={32} />
        <p className="text-sm text-red-400">{error}</p>
        <button
          onClick={() => { setError(null); loadDocuments(); }}
          className="rounded-lg bg-surface-3 px-3 py-1.5 text-xs hover:brightness-110"
        >
          Retry
        </button>
      </div>
    );
  }

  if (activeDoc) {
    return (
      <EditorView
        doc={activeDoc}
        onBack={() => { setActiveDoc(null); loadDocuments(); }}
        onDelete={() => handleDelete(activeDoc.id)}
        onRefresh={() => loadDocument(activeDoc.id)}
      />
    );
  }

  return (
    <DocumentListView
      documents={documents}
      onOpen={loadDocument}
      onCreate={() => setShowCreate(true)}
      onRefresh={loadDocuments}
    >
      {showCreate && (
        <CreateDocumentDialog
          onComplete={(docId) => { setShowCreate(false); loadDocument(docId); }}
          onCancel={() => setShowCreate(false)}
        />
      )}
    </DocumentListView>
  );
}

// ----- document list view -----

function DocumentListView({
  documents, onOpen, onCreate, onRefresh, children,
}: {
  documents: ScribeDocumentSummary[];
  onOpen: (id: string) => void;
  onCreate: () => void;
  onRefresh: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-surface-3 px-4 py-2">
        <div className="flex items-center gap-2">
          <PenLine className="text-cyan-400" size={18} />
          <h2 className="text-sm font-semibold text-ink">Scribe</h2>
          <span className="rounded-full bg-surface-3 px-2 py-0.5 text-[10px] text-ink-muted">
            {documents.length} doc{documents.length !== 1 ? "s" : ""}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onRefresh}
            className="rounded-lg p-1.5 text-ink-muted hover:bg-surface-3 hover:text-ink"
            title="Refresh"
          >
            <RefreshCw size={14} />
          </button>
          <button
            onClick={onCreate}
            className="flex items-center gap-1 rounded-lg bg-cyan-600 px-2 py-1 text-xs text-white hover:bg-cyan-500"
          >
            <Plus size={14} /> New Document
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {documents.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <PenLine className="text-ink-muted" size={48} />
            <p className="text-sm text-ink-muted">No writing documents yet.</p>
            <p className="text-xs text-ink-muted">Create a draft and get AI feedback on structure, argument, evidence, and citations.</p>
            <button
              onClick={onCreate}
              className="flex items-center gap-1 rounded-lg bg-cyan-600 px-3 py-1.5 text-xs text-white hover:bg-cyan-500"
            >
              <Plus size={14} /> Create First Document
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {documents.map((doc) => (
              <div
                key={doc.id}
                className="group cursor-pointer rounded-xl border border-surface-3 bg-surface-2 p-4 transition hover:border-cyan-500/50 hover:bg-surface-3"
                onClick={() => onOpen(doc.id)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-sm font-medium text-ink">{doc.title}</h3>
                    <div className="mt-1 flex items-center gap-2 text-[10px] text-ink-muted">
                      <span>{DOC_TYPE_LABELS[doc.docType] ?? doc.docType}</span>
                      <span>·</span>
                      <span>{(doc.contentLength / 1000).toFixed(1)}k chars</span>
                    </div>
                  </div>
                </div>
                {doc.thesisStatement && (
                  <p className="mt-2 line-clamp-2 text-xs text-ink-muted">{doc.thesisStatement}</p>
                )}
                <div className="mt-3 flex items-center gap-2 text-[10px]">
                  {doc.feedbackCount > 0 && (
                    <span className="flex items-center gap-1 rounded-full bg-surface-4 px-2 py-0.5 text-ink-muted">
                      <Sparkles size={10} /> {doc.feedbackCount} feedback
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

// ----- editor view -----

function EditorView({
  doc, onBack, onDelete, onRefresh,
}: {
  doc: ScribeDocument;
  onBack: () => void;
  onDelete: () => void;
  onRefresh: () => void;
}) {
  const [content, setContent] = useState(doc.content);
  const [title, setTitle] = useState(doc.title);
  const [thesis, setThesis] = useState(doc.thesisStatement);
  const [showPreview, setShowPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [feedbackType, setFeedbackType] = useState<"outline" | "draft" | "citations" | "full">("full");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Update local state when the document prop changes (e.g. after refresh).
  useEffect(() => {
    setContent(doc.content);
    setTitle(doc.title);
    setThesis(doc.thesisStatement);
    setDirty(false);
  }, [doc.id, doc.updatedAt]);

  // Auto-save (debounced, like Notes app).
  useEffect(() => {
    if (!dirty) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSaving(true);
      try {
        await scribeApi.updateDocument(doc.id, { content, title, thesisStatement: thesis });
        setDirty(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Save failed");
      } finally {
        setSaving(false);
      }
    }, 1500);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [content, title, thesis, dirty, doc.id]);

  // Poll for building feedback.
  useEffect(() => {
    const hasBuilding = doc.feedbacks.some((f) => f.status === "building");
    if (!hasBuilding) return;
    const interval = setInterval(async () => {
      try {
        await onRefresh();
      } catch { /* ignore polling errors */ }
    }, 2500);
    return () => clearInterval(interval);
  }, [doc.feedbacks.some((f) => f.status === "building"), onRefresh]);

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    try {
      await scribeApi.generateFeedback(doc.id, feedbackType);
      await onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  };

  const latestFeedback = doc.feedbacks[0] ?? null;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-surface-3 px-4 py-2">
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={onBack}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-ink-muted hover:bg-surface-3 hover:text-ink"
          >
            <ChevronLeft size={14} /> Documents
          </button>
          <span className="text-ink-muted">/</span>
          <input
            value={title}
            onChange={(e) => { setTitle(e.target.value); setDirty(true); }}
            className="bg-transparent text-sm font-semibold text-ink outline-none"
          />
          {saving && <Loader2 className="animate-spin text-ink-muted" size={12} />}
          {dirty && !saving && <span className="text-[10px] text-amber-400">unsaved</span>}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowPreview((v) => !v)}
            className="rounded-lg p-1.5 text-ink-muted hover:bg-surface-3 hover:text-ink"
            title={showPreview ? "Edit" : "Preview"}
          >
            {showPreview ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
          <button
            onClick={onDelete}
            className="rounded-lg p-1.5 text-ink-muted hover:bg-red-500/10 hover:text-red-400"
            title="Delete document"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* Thesis statement */}
      <div className="border-b border-surface-3 bg-surface-2 px-4 py-2">
        <input
          value={thesis}
          onChange={(e) => { setThesis(e.target.value); setDirty(true); }}
          placeholder="Thesis statement or research question..."
          className="w-full bg-transparent text-xs text-ink-muted placeholder:text-ink-muted/50 outline-none"
        />
      </div>

      {/* Split-pane: editor + feedback */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: editor / preview */}
        <div className="flex-1 overflow-hidden">
          {showPreview ? (
            <div className="h-full overflow-y-auto p-6">
              <div className="mx-auto max-w-2xl prose prose-sm prose-invert max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
              </div>
            </div>
          ) : (
            <textarea
              value={content}
              onChange={(e) => { setContent(e.target.value); setDirty(true); }}
              placeholder="Start writing your essay, thesis, or report..."
              className="h-full w-full resize-none bg-surface p-6 text-sm text-ink placeholder:text-ink-muted/50 outline-none font-mono"
            />
          )}
        </div>

        {/* Right: feedback panel */}
        <div className="w-96 shrink-0 overflow-y-auto border-l border-surface-3 bg-surface-2">
          {/* Generate feedback */}
          <div className="border-b border-surface-3 p-4">
            <h3 className="mb-2 flex items-center gap-1 text-xs font-medium text-ink">
              <Sparkles className="text-cyan-400" size={12} /> Writing Coach
            </h3>
            <div className="mb-2 flex gap-1">
              {([
                { key: "full", label: "Full" },
                { key: "outline", label: "Outline" },
                { key: "draft", label: "Draft" },
                { key: "citations", label: "Citations" },
              ] as const).map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setFeedbackType(key)}
                  className={`rounded px-2 py-0.5 text-[10px] ${
                    feedbackType === key ? "bg-cyan-600 text-white" : "bg-surface-3 text-ink-muted hover:brightness-110"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              onClick={handleGenerate}
              disabled={generating || content.trim().length < 100}
              className="flex w-full items-center justify-center gap-1 rounded-lg bg-cyan-600 px-3 py-1.5 text-xs text-white hover:bg-cyan-500 disabled:opacity-50"
            >
              {generating ? <Loader2 className="animate-spin" size={12} /> : <Sparkles size={12} />}
              Get Feedback
            </button>
            {content.trim().length < 100 && (
              <p className="mt-1 text-[10px] text-ink-muted">Write at least 100 characters first.</p>
            )}
          </div>

          {/* Latest feedback */}
          {latestFeedback ? (
            <FeedbackPanel feedback={latestFeedback} />
          ) : (
            <div className="p-4 text-center text-xs text-ink-muted">
              No feedback yet. Click "Get Feedback" to analyze your writing.
            </div>
          )}

          {error && (
            <div className="m-4 rounded-lg bg-red-500/10 p-3 text-xs text-red-400">{error}</div>
          )}
        </div>
      </div>
    </div>
  );
}

// ----- feedback panel -----

function FeedbackPanel({ feedback }: { feedback: ScribeFeedback }) {
  if (feedback.status === "building") {
    return (
      <div className="flex flex-col items-center gap-2 p-8 text-center">
        <Loader2 className="animate-spin text-cyan-400" size={24} />
        <p className="text-xs text-ink-muted">Analyzing your writing...</p>
      </div>
    );
  }

  if (feedback.status === "error") {
    return (
      <div className="m-4 rounded-lg bg-red-500/10 p-3 text-xs text-red-400">
        <AlertCircle size={14} className="mb-1 inline" /> {feedback.error}
      </div>
    );
  }

  return (
    <div className="p-4">
      {/* Score */}
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-3">
          <span className={`text-sm font-bold ${
            feedback.score >= 80 ? "text-emerald-400" : feedback.score >= 60 ? "text-amber-400" : "text-red-400"
          }`}>
            {feedback.score}
          </span>
        </div>
        <div>
          <p className="text-xs font-medium text-ink">Overall Score</p>
          <p className="text-[10px] text-ink-muted capitalize">{feedback.feedbackType} feedback</p>
        </div>
      </div>

      {/* Issues */}
      {feedback.issues.length > 0 && (
        <div className="mb-4 space-y-2">
          <h4 className="text-xs font-medium text-ink">Issues ({feedback.issues.length})</h4>
          {feedback.issues.slice(0, 10).map((issue, i) => {
            const meta = SEVERITY_META[issue.severity] ?? SEVERITY_META.info;
            const Icon = meta.icon;
            return (
              <div key={i} className="rounded-lg bg-surface-3 p-2 text-xs">
                <div className="flex items-center gap-1 mb-1">
                  <Icon className={meta.color} size={10} />
                  <span className={`font-medium ${meta.color}`}>{meta.label}</span>
                  <span className="text-ink-muted">·</span>
                  <span className="text-ink-muted truncate">{issue.section}</span>
                </div>
                <p className="text-ink-muted">{issue.issue}</p>
                {issue.suggestion && (
                  <p className="mt-1 text-ink-muted italic">→ {issue.suggestion}</p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Full feedback content */}
      {feedback.content && (
        <div>
          <h4 className="mb-2 text-xs font-medium text-ink">Detailed Feedback</h4>
          <div className="prose prose-sm prose-invert max-w-none text-xs">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{feedback.content}</ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
}

// ----- create document dialog -----

function CreateDocumentDialog({
  onComplete, onCancel,
}: {
  onComplete: (docId: string) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [docType, setDocType] = useState("essay");
  const [thesis, setThesis] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!title.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await scribeApi.createDocument({
        title: title.trim(),
        docType,
        thesisStatement: thesis.trim() || undefined,
      });
      onComplete(res.document.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Creation failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-2xl border border-surface-3 bg-surface-1 p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
            <PenLine className="text-cyan-400" size={16} /> New Document
          </h3>
          <button onClick={onCancel} className="rounded p-1 text-ink-muted hover:bg-surface-3">
            <X size={16} />
          </button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs text-ink-muted">Title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. The Impact of Climate Change on Biodiversity"
              className="w-full rounded-lg border border-surface-3 bg-surface-2 px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:border-cyan-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-ink-muted">Document type</label>
            <select
              value={docType}
              onChange={(e) => setDocType(e.target.value)}
              className="w-full rounded-lg border border-surface-3 bg-surface-2 px-3 py-2 text-sm text-ink focus:border-cyan-500 focus:outline-none"
            >
              <option value="essay">Essay</option>
              <option value="thesis">Thesis</option>
              <option value="report">Report</option>
              <option value="literature_review">Literature Review</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-ink-muted">Thesis statement (optional)</label>
            <textarea
              value={thesis}
              onChange={(e) => setThesis(e.target.value)}
              placeholder="Your main argument or research question..."
              rows={2}
              className="w-full rounded-lg border border-surface-3 bg-surface-2 px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:border-cyan-500 focus:outline-none"
            />
          </div>
          {error && <div className="rounded-lg bg-red-500/10 p-3 text-xs text-red-400">{error}</div>}
          <div className="flex justify-end gap-2">
            <button onClick={onCancel} className="rounded-lg bg-surface-3 px-4 py-2 text-xs text-ink-muted hover:brightness-110">
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={loading || !title.trim()}
              className="flex items-center gap-1 rounded-lg bg-cyan-600 px-4 py-2 text-xs text-white hover:bg-cyan-500 disabled:opacity-50"
            >
              {loading ? <Loader2 className="animate-spin" size={14} /> : <Plus size={14} />}
              Create
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
