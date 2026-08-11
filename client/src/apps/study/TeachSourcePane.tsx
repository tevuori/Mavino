// ===== TeachSourcePane — desktop side-by-side source viewer for Teach Me =====
// Renders the source the teacher is currently discussing INLINE (next to the
// chat) instead of a floating window that can hide behind the chat. Reuses the
// existing show-control channel so the teacher's scroll/highlight commands drive
// the pane exactly like they drove the floating apps.
//
// One pane window id (`paneId`) is used for show-control. The active source is
// swapped via the `source` prop; a `pending` highlight is applied once the
// content has finished loading (so show_source → switch source → highlight
// works even though loading is async).

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { EditorView } from "@codemirror/view";
import { oneDark } from "@codemirror/theme-one-dark";
import { markdown } from "@codemirror/lang-markdown";
import { BookOpen, Loader2, X, AlertTriangle, ExternalLink } from "lucide-react";
import { notesApi } from "../../services/notes";
import { filesApi, isPdfFile, isImageFile } from "../../services/files";
import { browserApi } from "../../services/browser";
import { useSettings } from "../../store/settings";
import { useShowControl, type ShowCommand } from "../../store/showControl";
import { useCodemirrorShowControl } from "../shared/useCodemirrorShowControl";
import { languageForFile } from "../editor/languages";

/** The source currently shown in the pane. */
export interface PaneSource {
  /** Per-source window id (matches the sourceHistory entry) so the LLM can
   *  target focus_source / close_source at a specific source. */
  windowId: string;
  appId: "notes" | "editor" | "viewer" | "browser";
  refId: string;
  name: string;
  kind: string;
  openPayload: Record<string, unknown>;
}

/** A highlight to apply once the source content has loaded. */
export interface PaneHighlight {
  text?: string;
  posStart?: number;
  posEnd?: number;
  line?: number;
  lineEnd?: number;
}

interface Props {
  paneId: string;
  source: PaneSource | null;
  pending: PaneHighlight | null;
  onPendingApplied: () => void;
  onClose: () => void;
}

export default function TeachSourcePane({ paneId, source, pending, onPendingApplied, onClose }: Props) {
  const isDark = useSettings((s) => s.theme === "dark");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex h-full min-w-0 flex-col border-l border-edge bg-surface-1">
      <div className="flex items-center gap-2 border-b border-edge px-3 py-2">
        <BookOpen size={14} className="shrink-0 text-accent" />
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-ink">
          {source?.name ?? "Source"}
        </span>
        {source && (
          <button
            onClick={onClose}
            className="rounded p-1 text-ink-muted hover:bg-surface-3 hover:text-ink"
            title="Close source"
          >
            <X size={14} />
          </button>
        )}
      </div>
      <div className="relative flex-1 overflow-hidden">
        {!source ? (
          <EmptyState />
        ) : loading ? (
          <div className="flex h-full items-center justify-center gap-2 text-xs text-ink-muted">
            <Loader2 size={14} className="animate-spin" /> Loading source…
          </div>
        ) : error ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-xs text-ink-muted">
            <AlertTriangle size={18} className="text-amber-400" />
            <p>{error}</p>
          </div>
        ) : null}
        {source && !error && (
          <SourceContent
            key={source.refId + ":" + source.appId}
            paneId={paneId}
            source={source}
            pending={pending}
            onPendingApplied={onPendingApplied}
            onLoadingChange={setLoading}
            onError={setError}
            isDark={isDark}
          />
        )}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-xs text-ink-muted">
      <BookOpen size={22} className="opacity-40" />
      <p>When Mavino references a source, it appears here with the passage highlighted.</p>
    </div>
  );
}

interface ContentProps {
  paneId: string;
  source: PaneSource;
  pending: PaneHighlight | null;
  onPendingApplied: () => void;
  onLoadingChange: (b: boolean) => void;
  onError: (e: string | null) => void;
  isDark: boolean;
}

function SourceContent(props: ContentProps) {
  const { source, pending, onPendingApplied, onLoadingChange, onError } = props;
  const { appId } = source;

  // Reset state when the source changes.
  useEffect(() => {
    onLoadingChange(true);
    onError(null);
  }, [source.refId, source.appId, onLoadingChange, onError]);

  if (appId === "notes" || appId === "editor") {
    return <CodemirrorPane {...props} />;
  }
  if (appId === "viewer") {
    return <ViewerPane {...props} />;
  }
  if (appId === "browser") {
    return <BrowserPane {...props} />;
  }
  return null;
}

// ----- notes / text files: read-only CodeMirror -----

function CodemirrorPane({ paneId, source, pending, onPendingApplied, onLoadingChange, onError, isDark }: ContentProps) {
  const { extensions: showExtensions, onCreateEditor: onCreateEditorShow } = useCodemirrorShowControl(paneId);
  const issueShowCommand = useShowControl((s) => s.issueCommand);
  const [content, setContent] = useState("");
  const [fileName, setFileName] = useState(source.name);
  const viewReady = useRef(false);
  const pendingRef = useRef<PaneHighlight | null>(pending);
  pendingRef.current = pending;
  const appliedPendingRef = useRef(false);

  // Fetch content.
  useEffect(() => {
    let cancelled = false;
    onLoadingChange(true);
    viewReady.current = false;
    appliedPendingRef.current = false;
    (async () => {
      try {
        if (source.appId === "notes") {
          const { note } = await notesApi.get(source.refId);
          if (cancelled) return;
          setContent(note.content ?? "");
          setFileName(note.title || source.name);
        } else {
          const res = await filesApi.getContent(source.refId);
          if (cancelled) return;
          setContent(res.content ?? "");
          setFileName(res.name || source.name);
        }
      } catch (e) {
        if (!cancelled) onError(e instanceof Error ? e.message : "Failed to load source");
      } finally {
        if (!cancelled) onLoadingChange(false);
      }
    })();
    return () => { cancelled = true; };
  }, [source.refId, source.appId, onLoadingChange, onError]);

  const langExt = useMemo(() => {
    if (source.appId === "notes") return markdown();
    return languageForFile(fileName).extension;
  }, [source.appId, fileName]);

  const onCreateEditor = useCallback((view: EditorView) => {
    onCreateEditorShow(view);
    viewReady.current = true;
  }, [onCreateEditorShow]);

  // Apply the pending highlight AFTER the content has loaded (not in
  // onCreateEditor, which fires while content is still "" — the empty doc
  // would clamp all offsets to 0 and the highlight would fail with "no-match").
  useEffect(() => {
    if (!content || !viewReady.current || appliedPendingRef.current) return;
    const p = pendingRef.current;
    if (!p) return;
    appliedPendingRef.current = true;
    issueShowCommand(paneId, "highlight", {
      text: p.text,
      posStart: p.posStart,
      posEnd: p.posEnd,
      lineStart: p.line,
      lineEnd: p.lineEnd,
    });
    onPendingApplied();
  }, [content, paneId, issueShowCommand, onPendingApplied]);

  return (
    <CodeMirror
      value={content}
      editable={false}
      extensions={[langExt, EditorView.lineWrapping, ...showExtensions]}
      theme={isDark ? oneDark : "light"}
      height="100%"
      className="h-full text-sm"
      onCreateEditor={onCreateEditor}
    />
  );
}

// ----- PDF / image viewer -----

function ViewerPane({ paneId, source, pending, onPendingApplied, onLoadingChange, onError }: ContentProps) {
  const commands = useShowControl((s) => s.commands);
  const reportResult = useShowControl((s) => s.reportResult);
  const [fileMeta, setFileMeta] = useState<{ name: string; mimeType: string } | null>(null);
  const [pdfSearch, setPdfSearch] = useState<string | undefined>(undefined);
  const lastSeq = useRef(0);

  // Fetch file metadata (to decide PDF vs image) + apply the pending highlight.
  useEffect(() => {
    let cancelled = false;
    onLoadingChange(true);
    setPdfSearch(undefined);
    (async () => {
      try {
        const { files } = await filesApi.all();
        const found = files.find((f) => f.id === source.refId);
        if (cancelled) return;
        if (!found) { onError("File not found"); onLoadingChange(false); return; }
        setFileMeta({ name: found.name, mimeType: found.mimeType });
        onLoadingChange(false);
        // Apply pending highlight for PDFs via #search=.
        if (pending?.text) {
          const q = pending.text.length > 60 ? pending.text.slice(0, 60).trim() : pending.text;
          if (q) setPdfSearch(q);
        }
        onPendingApplied();
      } catch (e) {
        if (!cancelled) onError(e instanceof Error ? e.message : "Failed to load file");
      }
    })();
    return () => { cancelled = true; };
  }, [source.refId, onLoadingChange, onError, onPendingApplied, pending]);

  // Consume subsequent show-control commands (highlight/scroll → PDF #search=).
  const cmd = commands[paneId];
  useEffect(() => {
    if (!cmd || cmd.seq === lastSeq.current) return;
    lastSeq.current = cmd.seq;
    if (!fileMeta) { reportResult(paneId, cmd.seq, cmd.kind, false, "not-loaded"); return; }
    if (isPdfFile(fileMeta) && (cmd.kind === "highlight" || cmd.kind === "scroll_to")) {
      const raw = cmd.text ?? "";
      if (raw) {
        const q = raw.length > 60 ? raw.slice(0, 60).trim() : raw;
        setPdfSearch(q || undefined);
        reportResult(paneId, cmd.seq, cmd.kind, Boolean(q));
      } else {
        reportResult(paneId, cmd.seq, cmd.kind, true);
      }
    } else if (cmd.kind === "clear_highlight") {
      setPdfSearch(undefined);
      reportResult(paneId, cmd.seq, cmd.kind, true);
    } else {
      reportResult(paneId, cmd.seq, cmd.kind, false, "unsupported-type");
    }
  }, [cmd, fileMeta, paneId, reportResult]);

  if (!fileMeta) return null;
  const downloadUrl = filesApi.downloadUrl(source.refId);

  if (isPdfFile(fileMeta)) {
    return (
      <iframe
        key={pdfSearch ?? "default"}
        src={pdfSearch ? `${downloadUrl}#search=${encodeURIComponent(pdfSearch)}` : downloadUrl}
        className="h-full w-full border-0"
        title={fileMeta.name}
      />
    );
  }
  if (isImageFile(fileMeta)) {
    return (
      <div className="flex h-full items-center justify-center overflow-auto p-3">
        <img src={downloadUrl} alt={fileMeta.name} className="max-h-full max-w-full object-contain" />
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-xs text-ink-muted">
      <p>Preview not available for this file type.</p>
      <a href={downloadUrl} download className="flex items-center gap-1 text-accent" >
        <ExternalLink size={12} /> Open
      </a>
    </div>
  );
}

// ----- browser / moodle URL: proxied iframe + postMessage bridge -----

function BrowserPane({ paneId, source, pending, onPendingApplied, onLoadingChange, onError }: ContentProps) {
  const commands = useShowControl((s) => s.commands);
  const reportResult = useShowControl((s) => s.reportResult);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const loadedRef = useRef(false);
  const pendingCmdRef = useRef<ShowCommand | null>(null);
  const lastSeq = useRef(0);
  const appliedPending = useRef(false);

  const proxyUrl = useMemo(() => browserApi.proxyUrl(source.refId), [source.refId]);

  // Reset on source change.
  useEffect(() => {
    loadedRef.current = false;
    pendingCmdRef.current = null;
    appliedPending.current = false;
    onLoadingChange(true);
    onError(null);
  }, [source.refId, onLoadingChange, onError]);

  // Apply pending highlight once the iframe has loaded.
  const onIframeLoad = useCallback(() => {
    loadedRef.current = true;
    onLoadingChange(false);
    if (!appliedPending.current) {
      appliedPending.current = true;
      if (pending?.text) {
        pendingCmdRef.current = {
          seq: 0, kind: "highlight", text: pending.text,
        } as ShowCommand;
        // forward below
      }
      onPendingApplied();
    }
    // Flush any queued command.
    const iframe = iframeRef.current;
    if (iframe?.contentWindow && pendingCmdRef.current) {
      const pc = pendingCmdRef.current;
      iframe.contentWindow.postMessage({ __athenaTeacherShow: true, id: pc.seq, kind: pc.kind, text: pc.text }, "*");
      pendingCmdRef.current = null;
    }
  }, [pending, onPendingApplied, onLoadingChange]);

  // Consume show-control commands → forward to the iframe.
  const cmd = commands[paneId];
  useEffect(() => {
    if (!cmd || cmd.seq === lastSeq.current) return;
    if (cmd.kind !== "highlight" && cmd.kind !== "scroll_to" && cmd.kind !== "clear_highlight") return;
    lastSeq.current = cmd.seq;
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow || !loadedRef.current) {
      // Queue until the iframe is ready.
      pendingCmdRef.current = cmd;
      if (!loadedRef.current) reportResult(paneId, cmd.seq, cmd.kind, false, "not-loaded");
      return;
    }
    iframe.contentWindow.postMessage(
      { __athenaTeacherShow: true, id: cmd.seq, kind: cmd.kind, text: cmd.text, selector: cmd.selector },
      "*"
    );
  }, [cmd, paneId, reportResult]);

  // Relay the injected script's results into the show-control store.
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      const data = e.data;
      if (!data || typeof data !== "object" || !data.__athenaTeacherShowResult) return;
      reportResult(paneId, Number(data.id) || 0, (data.kind as ShowCommand["kind"]) ?? "highlight", Boolean(data.ok), data.ok ? undefined : "no-match");
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [paneId, reportResult]);

  return (
    <iframe
      ref={iframeRef}
      src={proxyUrl}
      onLoad={onIframeLoad}
      className="h-full w-full border-0 bg-white"
      title={source.name}
    />
  );
}
