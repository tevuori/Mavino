import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { EditorView } from "@codemirror/view";
import { oneDark } from "@codemirror/theme-one-dark";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import {
  Save, Loader2, Eye, Pencil, Columns2, WrapText, Download,
  FileText, AlertCircle,
} from "lucide-react";
import { filesApi, isMarkdownFile, formatBytes } from "../../services/files";
import { languageForFile } from "./languages";
import { useSettings } from "../../store/settings";
import { useWindows } from "../../store/windows";
import { useShowControl } from "../../store/showControl";
import { useCodemirrorShowControl } from "../shared/useCodemirrorShowControl";
import { useCodemirrorHighlights } from "../shared/useCodemirrorHighlights";
import CodemirrorHighlightToolbar from "../shared/CodemirrorHighlightToolbar";
import type { WindowInstance } from "../../store/windows";
import type { VFile } from "../../types";

type Mode = "edit" | "preview" | "split";

export default function EditorApp({ win }: { win: WindowInstance }) {
  const fileId = win.payload?.fileId as string | undefined;
  const initialName = (win.payload?.name as string) || "Untitled.txt";
  const initialFolderId = (win.payload?.folderId as string | null) ?? null;
  // When opened with pre-supplied content (e.g. Compass "Open in Editor" on a
  // generated literature review), start with that text as a new unsaved file.
  // The user saves via the existing Save flow (prompts for a name → createText).
  const initialContent = win.payload?.initialContent as string | undefined;

  const isDark = useSettings((s) => s.theme === "dark");
  const setTitle = useWindows((s) => s.setTitle);

  const [currentFileId, setCurrentFileId] = useState<string | undefined>(fileId);
  const [name, setName] = useState(initialName);
  const [content, setContent] = useState(initialContent ?? "");
  const [savedContent, setSavedContent] = useState("");
  const [loading, setLoading] = useState(!!fileId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wrap, setWrap] = useState(true);
  const [mode, setMode] = useState<Mode>("edit");
  const [fileMeta, setFileMeta] = useState<VFile | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadedRef = useRef(false);

  // Auto-switch out of split view when the window is too narrow for two panes.
  // @4xl (56rem = 896px) is the breakpoint where split is comfortable.
  useEffect(() => {
    if (mode === "split" && win.rect.width < 896) setMode("edit");
  }, [win.rect.width, mode]);

  const isMarkdown = useMemo(
    () => isMarkdownFile({ name, mimeType: fileMeta?.mimeType ?? "text/plain" }),
    [name, fileMeta]
  );

  const lang = useMemo(() => languageForFile(name), [name]);

  const dirty = content !== savedContent;

  // Load existing file content
  const loadFile = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const { content: text, name: fname, mimeType } = await filesApi.getContent(id);
      setContent(text);
      setSavedContent(text);
      setName(fname);
      setFileMeta({
        id,
        name: fname,
        mimeType,
        size: new Blob([text]).size,
        storageKey: "",
        folderId: null,
        starred: false,
        createdAt: "",
        updatedAt: "",
        lastOpenedAt: null,
      });
      filesApi.markOpened(id).catch(() => {});
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load file";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (fileId && !loadedRef.current) {
      loadedRef.current = true;
      loadFile(fileId);
    }
  }, [fileId, loadFile]);

  // Update window title
  useEffect(() => {
    setTitle(win.id, dirty ? `● ${name}` : name);
  }, [name, dirty, setTitle, win.id]);

  const doSave = useCallback(async () => {
    if (saving) return;
    setError(null);
    // New file: need a name → create via /text
    if (!currentFileId) {
      const finalName = prompt("Save as (file name):", name) ?? "";
      if (!finalName.trim()) return;
      setSaving(true);
      try {
        const { file } = await filesApi.createText({
          name: finalName.trim(),
          folderId: initialFolderId,
          content,
        });
        setCurrentFileId(file.id);
        setName(file.name);
        setFileMeta(file);
        setSavedContent(content);
        filesApi.markOpened(file.id).catch(() => {});
      } catch (e) {
        setError(e instanceof Error ? e.message : "Save failed");
      } finally {
        setSaving(false);
      }
      return;
    }
    // Existing file
    setSaving(true);
    try {
      const { file } = await filesApi.saveContent(currentFileId, content);
      setFileMeta(file);
      setSavedContent(content);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [saving, currentFileId, name, content, initialFolderId]);

  // Debounced auto-save for existing files only
  useEffect(() => {
    if (!currentFileId || !dirty || loading) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void doSave();
    }, 1500);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [content, currentFileId, dirty, loading, doSave]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        void doSave();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doSave]);

  const download = useCallback(async () => {
    if (!currentFileId) {
      // Download unsaved new file from current content
      const blob = new Blob([content], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
      return;
    }
    try {
      const res = await filesApi.download(currentFileId);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download failed");
    }
  }, [currentFileId, content, name]);

  const extensions = useMemo(
    () => [lang.extension, ...(wrap ? [EditorView.lineWrapping] : [])],
    [lang, wrap]
  );

  // Interactive Teacher: wire this editor window to the show-control channel.
  const { extensions: showExtensions, onCreateEditor: onCreateEditorShow } = useCodemirrorShowControl(win.id);
  const removeShowWindow = useShowControl((s) => s.removeWindow);
  useEffect(() => {
    return () => { if (win.id) removeShowWindow(win.id); };
  }, [win.id, removeShowWindow]);

  // Persistent user highlights (Study Hub feature). Scoped to the file id.
  const {
    extensions: hlExtensions, onCreateEditor: onCreateEditorHl,
    selection: hlSelection, clearSelection: clearHlSelection,
    createHighlight: hlCreate, updateHighlight: hlUpdate, removeHighlight: hlRemove,
  } = useCodemirrorHighlights({
    winId: win.id,
    scope: "editor",
    scopeId: currentFileId,
    sourceName: currentFileId ? `Editor: ${name}` : undefined,
  });
  const onCreateEditor = useCallback(
    (view: EditorView) => {
      onCreateEditorShow(view);
      onCreateEditorHl(view);
    },
    [onCreateEditorShow, onCreateEditorHl]
  );

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 size={24} className="animate-spin text-ink-muted" />
      </div>
    );
  }

  if (error && !content && !currentFileId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-ink-muted">
        <AlertCircle size={32} className="text-red-400" />
        <p className="text-sm">{error}</p>
      </div>
    );
  }

  const showEditor = mode === "edit" || mode === "split";
  const showPreview = mode === "preview" || mode === "split";

  return (
    <div className="flex h-full flex-col">
      <CodemirrorHighlightToolbar
        selection={hlSelection}
        onCreate={(color, annotation) => {
          void hlCreate({
            text: hlSelection!.text,
            contextBefore: hlSelection!.contextBefore,
            contextAfter: hlSelection!.contextAfter,
            color,
            annotation,
          });
          clearHlSelection();
        }}
        onUpdate={hlUpdate}
        onDelete={hlRemove}
        onDismiss={clearHlSelection}
      />
      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b border-edge bg-surface-2 px-3 py-1.5">
        <div className="flex items-center gap-1.5 text-xs text-ink">
          <FileText size={14} className="text-accent" />
          <span className="font-medium">{name}</span>
          {dirty && <span className="text-amber-400" title="Unsaved changes">●</span>}
        </div>
        <div className="ml-auto flex items-center gap-1">
          {isMarkdown && (
            <div className="mr-1 flex items-center rounded-lg border border-edge">
              <ToolToggle active={mode === "edit"} onClick={() => setMode("edit")} title="Editor only">
                <Pencil size={13} />
              </ToolToggle>
              <ToolToggle active={mode === "split"} onClick={() => setMode("split")} title="Split view" className="hidden @4xl:flex">
                <Columns2 size={13} />
              </ToolToggle>
              <ToolToggle active={mode === "preview"} onClick={() => setMode("preview")} title="Preview only">
                <Eye size={13} />
              </ToolToggle>
            </div>
          )}
          <button
            onClick={() => setWrap((w) => !w)}
            title="Toggle word wrap"
            className={`flex h-7 w-7 items-center justify-center rounded-lg border border-edge ${
              wrap ? "bg-surface-3 text-ink" : "text-ink-muted hover:bg-surface-3"
            }`}
          >
            <WrapText size={13} />
          </button>
          <button
            onClick={download}
            title="Download"
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-edge text-ink-muted hover:bg-surface-3 hover:text-ink"
          >
            <Download size={13} />
          </button>
          <button
            onClick={doSave}
            disabled={saving || !dirty}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-2.5 py-1.5 text-xs text-accent-fg hover:opacity-90 disabled:opacity-40"
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
            Save
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 border-b border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs text-red-400">
          <AlertCircle size={13} /> {error}
        </div>
      )}

      {/* Editor / Preview */}
      <div className="flex flex-1 overflow-hidden">
        {showEditor && (
          <div className={showPreview ? "w-1/2 border-r border-edge" : "w-full"}>
            <CodeMirror
              value={content}
              onChange={(val) => setContent(val)}
              extensions={[...extensions, ...showExtensions, ...hlExtensions]}
              theme={isDark ? oneDark : "light"}
              height="100%"
              className="h-full text-sm"
              basicSetup={{
                lineNumbers: true,
                foldGutter: true,
                highlightActiveLine: true,
                highlightActiveLineGutter: true,
                bracketMatching: true,
                closeBrackets: true,
                autocompletion: true,
                searchKeymap: true,
                tabSize: 2,
              }}
              onCreateEditor={onCreateEditor}
            />
          </div>
        )}
        {showPreview && (
          <div className={`${showEditor ? "w-1/2" : "w-full"} overflow-auto bg-surface p-4`}>
            <div className="selectable markdown-body mx-auto max-w-none @5xl:max-w-2xl">
              <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>{content || "*Nothing to preview yet*"}</ReactMarkdown>
            </div>
          </div>
        )}
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-between border-t border-edge bg-surface-2 px-3 py-1 text-[11px] text-ink-muted">
        <div className="flex items-center gap-3">
          <span>{lang.label}</span>
          <span className="@3xl:inline hidden">{content.length} chars</span>
          <span className="@3xl:inline hidden">{content.split("\n").length} lines</span>
          {fileMeta && <span className="@3xl:inline hidden">{formatBytes(fileMeta.size)}</span>}
        </div>
        <div>
          {saving ? "Saving…" : dirty ? "Unsaved" : currentFileId ? "Saved" : "Not saved yet"}
        </div>
      </div>
    </div>
  );
}

function ToolToggle({
  active,
  onClick,
  title,
  className = "",
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`flex h-7 w-7 items-center justify-center ${className} ${
        active ? "bg-surface-3 text-ink" : "text-ink-muted hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}
