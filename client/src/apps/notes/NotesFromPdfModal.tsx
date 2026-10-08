// ===== Notes from PDF (AI) modal =====
// Lets the user generate structured notes from a PDF in their file manager
// (or pasted text) using the Athena LLM, with control over detail level,
// note style, and an optional freeform "how should the notes be structured"
// description. Posts to /api/study/notes-from-source and hands the new note
// id back to the Notes app so it can be selected.

import { useState, useEffect, useMemo, useCallback } from "react";
import {
  FileText, ClipboardPaste, Search, Loader2, AlertCircle,
  Sparkles, Check,
} from "lucide-react";
import { filesApi, isPdfFile, formatBytes } from "../../services/files";
import { studyApi, type SourceDescriptor, type NoteStyle, type NoteDetail, type NotesFromSourceResult } from "../../services/study";
import type { VFile } from "../../types";
import { Dialog } from "../../ui/overlays";
import { Alert, Button, Switch } from "../../ui/primitives";

type SourceTab = "pdf" | "paste";

const IMAGE_NOTES_KEY = "image-aware-notes";

const DETAIL_OPTIONS: { value: NoteDetail; label: string; hint: string }[] = [
  { value: "brief", label: "Brief", hint: "Key points & definitions only" },
  { value: "standard", label: "Standard", hint: "Balanced detail" },
  { value: "detailed", label: "Detailed", hint: "Thorough, with examples" },
];

const STYLE_OPTIONS: { value: NoteStyle; label: string; hint: string }[] = [
  { value: "outline", label: "Outline", hint: "Hierarchical headings + bullets" },
  { value: "cornell", label: "Cornell", hint: "Cues / Notes / Summary" },
  { value: "summary", label: "Summary", hint: "Overview + key bullets" },
  { value: "bullets", label: "Bullets", hint: "Topic-grouped bullet points" },
];

interface Props {
  /** Currently selected note folder (so the new note lands in it). */
  folderId: string | null;
  onCreated: (result: NotesFromSourceResult) => void;
  onClose: () => void;
}

export default function NotesFromPdfModal({ folderId, onCreated, onClose }: Props) {
  const [tab, setTab] = useState<SourceTab>("pdf");

  // PDF picker state
  const [files, setFiles] = useState<VFile[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [fileQuery, setFileQuery] = useState("");
  const [selectedFileId, setSelectedFileId] = useState<string>("");

  // Paste state
  const [pasteText, setPasteText] = useState("");

  // Options
  const [detail, setDetail] = useState<NoteDetail>("standard");
  const [style, setStyle] = useState<NoteStyle>("outline");
  const [customStructure, setCustomStructure] = useState("");
  const [title, setTitle] = useState("");
  const [includeImages, setIncludeImages] = useState(() => localStorage.getItem(IMAGE_NOTES_KEY) !== "false");

  // Submission state
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");

  // Load PDF files when the PDF tab is opened.
  const loadFiles = useCallback(async () => {
    setFilesLoading(true);
    try {
      const { files } = await filesApi.all();
      setFiles(files.filter(isPdfFile));
    } catch (e) {
      console.error("Failed to load files", e);
    } finally {
      setFilesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === "pdf" && files.length === 0 && !filesLoading) {
      void loadFiles();
    }
  }, [tab, files.length, filesLoading, loadFiles]);

  // Escape closes the modal (but not while generating).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !generating) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [generating, onClose]);

  const filteredFiles = useMemo(() => {
    if (!fileQuery.trim()) return files;
    const q = fileQuery.toLowerCase();
    return files.filter((f) => f.name.toLowerCase().includes(q));
  }, [files, fileQuery]);

  const canGenerate =
    !generating &&
    ((tab === "pdf" && !!selectedFileId) || (tab === "paste" && pasteText.trim().length > 0));

  const generate = async () => {
    setError("");
    if (!canGenerate) return;

    const source: SourceDescriptor =
      tab === "pdf"
        ? { kind: "file", id: selectedFileId }
        : { kind: "paste", text: pasteText };

    setGenerating(true);
    try {
      const result = await studyApi.notesFromSource({
        source,
        style,
        detail,
        customStructure: customStructure.trim() || undefined,
        title: title.trim() || undefined,
        folderId: folderId ?? undefined,
        includeImages: tab === "pdf" ? includeImages : false,
      });
      onCreated(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Note generation failed");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <Dialog
      open
      onClose={() => { if (!generating) onClose(); }}
      title="Create notes from a source"
      description="Turn a PDF or pasted text into structured study notes."
      className="max-w-lg"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={generating}>Cancel</Button>
          <Button size="sm" onClick={() => void generate()} disabled={!canGenerate} loading={generating} leadingIcon={<Sparkles size={13} />}>
            {generating ? "Generating…" : "Generate notes"}
          </Button>
        </>
      }
    >
        <div className="max-h-[65vh] overflow-y-auto pr-1">
          {/* Source tabs */}
          <div className="mb-2 flex gap-1">
            <TabButton active={tab === "pdf"} onClick={() => setTab("pdf")} icon={FileText} label="PDF file" />
            <TabButton active={tab === "paste"} onClick={() => setTab("paste")} icon={ClipboardPaste} label="Paste text" />
          </div>

          {tab === "pdf" ? (
            <div className="mb-3">
              <div className="relative mb-2">
                <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-muted" />
                <input
                  value={fileQuery}
                  onChange={(e) => setFileQuery(e.target.value)}
                  placeholder="Search PDFs…"
                  className="w-full rounded-md border border-edge bg-surface-2 px-7 py-1.5 text-xs text-ink outline-none focus:border-focus"
                />
              </div>
              <div className="max-h-44 overflow-y-auto rounded-md border border-edge bg-surface-2">
                {filesLoading ? (
                  <div className="flex items-center gap-2 p-3 text-xs text-ink-muted">
                    <Loader2 size={12} className="animate-spin" /> Loading PDFs…
                  </div>
                ) : filteredFiles.length === 0 ? (
                  <div className="p-3 text-xs text-ink-muted">
                    No PDF files found. Upload a PDF in the Files app first.
                  </div>
                ) : (
                  filteredFiles.map((f) => (
                    <button
                      key={f.id}
                      onClick={() => setSelectedFileId(f.id)}
                      className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs transition ${
                        selectedFileId === f.id ? "bg-accent/10 text-accent" : "text-ink hover:bg-surface-3"
                      }`}
                    >
                      <FileText size={12} className="shrink-0 opacity-70" />
                      <span className="flex-1 truncate">{f.name}</span>
                      <span className="shrink-0 text-[10px] text-ink-muted">{formatBytes(f.size)}</span>
                      {selectedFileId === f.id && <Check size={12} className="shrink-0" />}
                    </button>
                  ))
                )}
              </div>
              <div className="mt-2 flex min-h-11 items-center justify-between border-y border-edge py-2 text-xs text-ink">
                <span>Include useful images &amp; diagrams</span>
                <Switch
                  checked={includeImages}
                  label="Include useful images and diagrams"
                  onClick={() => setIncludeImages((current) => {
                    const next = !current;
                    localStorage.setItem(IMAGE_NOTES_KEY, String(next));
                    return next;
                  })}
                />
              </div>
              <p className="mt-1.5 text-[10px] text-ink-muted">
                Text is extracted server-side. With a vision-capable model, full PDF pages—including scans,
                formulas, diagrams, and useful figures—are analyzed and useful figures are embedded in the notes.
              </p>
            </div>
          ) : (
            <div className="mb-3">
              <textarea
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder="Paste the text you want notes from…"
                rows={6}
                className="w-full resize-y rounded-md border border-edge bg-surface-2 px-2.5 py-2 text-xs text-ink outline-none focus:border-focus"
              />
            </div>
          )}

          {/* Detail level */}
          <FieldLabel>Detail level</FieldLabel>
          <div className="mb-3 grid grid-cols-3 gap-1.5">
            {DETAIL_OPTIONS.map((opt) => (
              <OptionTile
                key={opt.value}
                active={detail === opt.value}
                onClick={() => setDetail(opt.value)}
                label={opt.label}
                hint={opt.hint}
              />
            ))}
          </div>

          {/* Style */}
          <FieldLabel>Note style</FieldLabel>
          <div className="mb-3 grid grid-cols-2 gap-1.5 @sm:grid-cols-4">
            {STYLE_OPTIONS.map((opt) => (
              <OptionTile
                key={opt.value}
                active={style === opt.value}
                onClick={() => setStyle(opt.value)}
                label={opt.label}
                hint={opt.hint}
              />
            ))}
          </div>

          {/* Custom structure description */}
          <FieldLabel>
            Custom structure <span className="font-normal text-ink-muted">(optional)</span>
          </FieldLabel>
          <textarea
            value={customStructure}
            onChange={(e) => setCustomStructure(e.target.value)}
            placeholder="e.g. &quot;Start with a glossary of key terms, then one section per chapter with definitions and examples, end with 5 review questions.&quot;"
            rows={3}
            maxLength={2000}
            className="mb-1 w-full resize-y rounded-md border border-edge bg-surface-2 px-2.5 py-2 text-xs text-ink outline-none focus:border-focus"
          />
          <div className="mb-3 flex justify-end text-[10px] text-ink-muted">
            {customStructure.length}/2000
          </div>

          {/* Title */}
          <FieldLabel>
            Note title <span className="font-normal text-ink-muted">(optional)</span>
          </FieldLabel>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={tab === "pdf" ? "Defaults to &quot;Notes: &lt;filename&gt;&quot;" : "Defaults to &quot;Notes: Pasted text&quot;"}
            maxLength={200}
            className="w-full rounded-md border border-edge bg-surface-2 px-2.5 py-1.5 text-xs text-ink outline-none focus:border-focus"
          />
          {error && (
            <Alert variant="danger" className="mt-3 flex items-start gap-2 text-xs">
              <AlertCircle size={13} className="mt-0.5 shrink-0" />
              <span className="flex-1">{error}</span>
            </Alert>
          )}
        </div>
    </Dialog>
  );
}

// ===== Small UI helpers =====

function TabButton({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof FileText;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition ${
        active ? "bg-accent text-accent-fg" : "text-ink-muted hover:bg-surface-3 hover:text-ink"
      }`}
    >
      <Icon size={13} /> {label}
    </button>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
      {children}
    </div>
  );
}

function OptionTile({
  active,
  onClick,
  label,
  hint,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  hint: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-start rounded-md border px-2.5 py-1.5 text-left transition ${
        active ? "border-accent bg-accent/10" : "border-edge bg-surface-2 hover:bg-surface-3"
      }`}
    >
      <span className={`text-xs font-medium ${active ? "text-accent" : "text-ink"}`}>{label}</span>
      <span className="text-[10px] leading-tight text-ink-muted">{hint}</span>
    </button>
  );
}
