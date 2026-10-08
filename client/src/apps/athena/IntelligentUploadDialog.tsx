// ===== Intelligent upload dialog =====
// Pops up after the user uploads multiple files. Lets them pick what Mavino
// should do: create a folder, build a folder structure, generate notes,
// flashcards, or start a Teach Me session.

import { useState, useEffect, useMemo } from "react";
import { Folder, FileText, Sparkles, Loader2, Brain, GraduationCap, BookOpen, AlertCircle, Languages } from "lucide-react";
import { formatBytes } from "../../services/files";
import {
  suggestUploadPlan,
  processUploads,
  type IntelligentUploadFile,
  type IntelligentUploadPlan,
  type IntelligentProcessActions,
  type IntelligentProcessResult,
  type StudyLanguage,
} from "../../services/athena";
import { useLanguage, type LanguagePreference } from "../../store/language";
import { Dialog } from "../../ui/overlays";
import { Alert, Button, Switch } from "../../ui/primitives";

interface Props {
  staged: IntelligentUploadFile[];
  targetFolderId?: string | null;
  onClose: () => void;
  onResult: (result: IntelligentProcessResult) => void;
}

const NOTE_STYLES: { value: NonNullable<IntelligentProcessActions["notes"]>["style"]; label: string }[] = [
  { value: "outline", label: "Outline" },
  { value: "cornell", label: "Cornell" },
  { value: "summary", label: "Summary" },
  { value: "bullets", label: "Bullets" },
];

const NOTE_DETAILS: { value: NonNullable<IntelligentProcessActions["notes"]>["detail"]; label: string }[] = [
  { value: "brief", label: "Brief" },
  { value: "standard", label: "Standard" },
  { value: "detailed", label: "Detailed" },
];

const FLASHCARD_MODES: { value: NonNullable<IntelligentProcessActions["flashcards"]>["mode"]; label: string }[] = [
  { value: "mixed", label: "Mixed" },
  { value: "concept", label: "Concept" },
  { value: "factual", label: "Factual" },
  { value: "cloze", label: "Cloze" },
];

const TEACH_LEVELS: { value: NonNullable<IntelligentProcessActions["teach"]>["level"]; label: string }[] = [
  { value: "beginner", label: "Beginner" },
  { value: "intermediate", label: "Intermediate" },
  { value: "advanced", label: "Advanced" },
];

const IMAGE_NOTES_KEY = "image-aware-notes";

export default function IntelligentUploadDialog({ staged, targetFolderId = null, onClose, onResult }: Props) {
  const globalLanguage = useLanguage((state) => state.language);
  const languagePreference = useLanguage((state) => state.overrides["intelligent-upload"]);
  const setLanguageOverride = useLanguage((state) => state.setOverride);
  const language: StudyLanguage = languagePreference === "global" ? globalLanguage : languagePreference;
  const [actions, setActions] = useState<IntelligentProcessActions>({
    targetFolderId,
    createFolder: false,
    folderName: null,
    createStructure: false,
    structure: null,
    notes: null,
    flashcards: null,
    teach: null,
    workspace: null,
  });
  const [planReasoning, setPlanReasoning] = useState<string | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasTextual = useMemo(
    () => staged.some((f) => f.mimeType === "application/pdf" || f.mimeType.startsWith("text/")),
    [staged]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !processing && !suggesting) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, processing, suggesting]);

  const handleSuggest = async () => {
    setSuggesting(true);
    setError(null);
    try {
      const { plan } = await suggestUploadPlan(
        staged.map((f) => ({ name: f.name, text: f.text, mimeType: f.mimeType })),
        language
      );
      setPlanReasoning(plan.reasoning || null);
      setActions({
        targetFolderId,
        createFolder: plan.createFolder,
        folderName: plan.folderName,
        createStructure: plan.createStructure,
        structure: plan.structure,
        notes: plan.notes ? { ...plan.notes, includeImages: localStorage.getItem(IMAGE_NOTES_KEY) !== "false" } : null,
        flashcards: plan.flashcards,
        teach: plan.teach,
        workspace: plan.workspace ?? { name: "Study materials" },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Suggestion failed");
    } finally {
      setSuggesting(false);
    }
  };

  const handleProcess = async () => {
    setProcessing(true);
    setError(null);
    try {
      const { result } = await processUploads(
        staged.map((f) => ({ tempId: f.tempId, name: f.name })),
        actions,
        language
      );
      onResult(result);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Processing failed");
    } finally {
      setProcessing(false);
    }
  };

  const setAction = <K extends keyof IntelligentProcessActions>(key: K, value: IntelligentProcessActions[K]) => {
    setActions((prev) => ({ ...prev, [key]: value }));
  };

  const toggleNote = (enabled: boolean) => {
    setActions((prev) => ({
      ...prev,
      notes: enabled
        ? { style: "outline", detail: "standard", customStructure: "", title: "", includeImages: localStorage.getItem(IMAGE_NOTES_KEY) !== "false" }
        : null,
    }));
  };

  const updateNote = (patch: Partial<NonNullable<IntelligentProcessActions["notes"]>>) => {
    setActions((prev) => ({
      ...prev,
      notes: prev.notes ? { ...prev.notes, ...patch } : { style: "outline", detail: "standard", customStructure: "", title: "", includeImages: localStorage.getItem(IMAGE_NOTES_KEY) !== "false", ...patch },
    }));
  };

  const toggleFlashcards = (enabled: boolean) => {
    setActions((prev) => ({
      ...prev,
      flashcards: enabled
        ? { count: 10, mode: "mixed", deckName: "" }
        : null,
    }));
  };

  const updateFlashcards = (patch: Partial<NonNullable<IntelligentProcessActions["flashcards"]>>) => {
    setActions((prev) => ({
      ...prev,
      flashcards: prev.flashcards
        ? { ...prev.flashcards, ...patch }
        : { count: 10, mode: "mixed", deckName: "", ...patch },
    }));
  };

  const toggleTeach = (enabled: boolean) => {
    setActions((prev) => ({
      ...prev,
      teach: enabled
        ? { level: "intermediate", title: "" }
        : null,
    }));
  };

  const updateTeach = (patch: Partial<NonNullable<IntelligentProcessActions["teach"]>>) => {
    setActions((prev) => ({
      ...prev,
      teach: prev.teach ? { ...prev.teach, ...patch } : { level: "intermediate", title: "", ...patch },
    }));
  };

  const toggleWorkspace = (enabled: boolean) => {
    setActions((prev) => ({
      ...prev,
      workspace: enabled
        ? { name: prev.workspace?.name ?? "Study materials" }
        : null,
    }));
  };

  const updateWorkspace = (patch: Partial<NonNullable<IntelligentProcessActions["workspace"]>>) => {
    setActions((prev) => ({
      ...prev,
      workspace: prev.workspace ? { ...prev.workspace, ...patch } : { name: "", ...patch },
    }));
  };

  const canProcess = staged.length > 0;
  const hasEnhancements = Boolean(actions.createFolder || actions.createStructure || actions.notes || actions.flashcards || actions.teach || actions.workspace);

  return (
    <Dialog
      open
      onClose={() => { if (!processing && !suggesting) onClose(); }}
      title="Process uploaded files"
      description="Choose what Mavino should create from these files."
      className="max-w-2xl"
      footer={
        <>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void handleSuggest()}
            disabled={suggesting || processing || !hasTextual}
            loading={suggesting}
            leadingIcon={<Sparkles size={13} />}
            className="mr-auto"
          >
            {suggesting ? "Suggesting…" : "Suggest a plan"}
          </Button>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={processing || suggesting}>Cancel</Button>
          <Button
            size="sm"
            onClick={() => void handleProcess()}
            disabled={!canProcess || processing || suggesting}
            loading={processing}
            leadingIcon={hasEnhancements ? <Sparkles size={13} /> : <FileText size={13} />}
          >
            {processing ? "Uploading…" : hasEnhancements ? "Process files" : "Upload files"}
          </Button>
        </>
      }
    >
        <div className="mb-3 flex justify-end">
          <label className="flex items-center gap-1 rounded-md border border-edge px-1.5 py-0.5 text-[10px] font-medium text-ink-muted">
            <Languages size={11} />
            <span className="sr-only">Output language</span>
            <select
              value={languagePreference}
              onChange={(event) => setLanguageOverride("intelligent-upload", event.target.value as LanguagePreference)}
              disabled={processing || suggesting}
              className="bg-transparent outline-none disabled:opacity-40"
              aria-label="Output language"
            >
              <option value="global">Global ({globalLanguage.toUpperCase()})</option>
              <option value="en">EN</option>
              <option value="cs">CS</option>
            </select>
          </label>
        </div>
        <div className="max-h-[62vh] overflow-y-auto pr-1">
          {/* File list */}
          <div className="mb-3 rounded-md border border-edge bg-surface-2 p-2">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Files ({staged.length})</div>
            {staged.map((f, i) => (
              <div key={f.tempId} className="flex items-center gap-2 py-1 text-xs text-ink">
                <FileText size={12} className="shrink-0 text-ink-muted" />
                <span className="flex-1 truncate">{i + 1}. {f.name}</span>
                <span className="shrink-0 text-ink-muted">{formatBytes(f.size)}</span>
              </div>
            ))}
            {!hasTextual && (
              <p className="mt-1 text-[10px] text-warning">No text-extractable files found. Notes / flashcards / Teach Me will not be available.</p>
            )}
          </div>

          {planReasoning && (
            <div className="mb-3 rounded-md border border-accent/20 bg-accent/5 p-2 text-[11px] text-ink">
              <span className="font-medium text-accent">Suggested plan:</span> {planReasoning}
            </div>
          )}

          {/* Folder */}
          <ActionRow
            icon={Folder}
            label="Create a folder"
            checked={actions.createFolder}
            onToggle={(v) => setAction("createFolder", v)}
          >
            <input
              value={actions.folderName ?? ""}
              onChange={(e) => setAction("folderName", e.target.value || null)}
              placeholder="Folder name"
              className="mt-1 w-full rounded border border-edge bg-surface-2 px-2 py-1 text-xs text-ink outline-none focus:border-focus"
            />
          </ActionRow>

          <ActionRow
            icon={Folder}
            label="Create folder structure"
            checked={actions.createStructure}
            onToggle={(v) => setAction("createStructure", v)}
          >
            {actions.structure && actions.structure.length > 0 ? (
              <div className="mt-1 space-y-1">
                {actions.structure.map((s, i) => (
                  <div key={i} className="rounded border border-edge bg-surface-2 p-1.5 text-[11px] text-ink">
                    <span className="font-medium">{s.folderName}</span>
                    <span className="text-ink-muted"> — {s.fileIndexes.length} file(s)</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-1 text-[10px] text-ink-muted">No suggested structure. Click "Suggest a plan".</p>
            )}
          </ActionRow>

          {/* Notes */}
          <ActionRow
            icon={FileText}
            label="Generate notes"
            checked={!!actions.notes}
            onToggle={toggleNote}
          >
            {actions.notes && (
              <div className="mt-1 grid grid-cols-2 gap-1.5">
                <select
                  value={actions.notes.style}
                  onChange={(e) => updateNote({ style: e.target.value as any })}
                  className="rounded border border-edge bg-surface-2 px-2 py-1 text-xs text-ink outline-none focus:border-focus"
                >
                  {NOTE_STYLES.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
                <select
                  value={actions.notes.detail}
                  onChange={(e) => updateNote({ detail: e.target.value as any })}
                  className="rounded border border-edge bg-surface-2 px-2 py-1 text-xs text-ink outline-none focus:border-focus"
                >
                  {NOTE_DETAILS.map((d) => (
                    <option key={d.value} value={d.value}>{d.label}</option>
                  ))}
                </select>
                <input
                  value={actions.notes.title}
                  onChange={(e) => updateNote({ title: e.target.value })}
                  placeholder="Note title (optional)"
                  className="col-span-2 rounded border border-edge bg-surface-2 px-2 py-1 text-xs text-ink outline-none focus:border-focus"
                />
                <textarea
                  value={actions.notes.customStructure}
                  onChange={(e) => updateNote({ customStructure: e.target.value })}
                  placeholder="Custom structure instructions (optional)"
                  rows={2}
                  className="col-span-2 resize-y rounded border border-edge bg-surface-2 px-2 py-1 text-xs text-ink outline-none focus:border-focus"
                />
                <div className="col-span-2 flex min-h-10 items-center justify-between border-y border-edge py-1.5 text-left text-[11px] text-ink">
                  <span>Include useful PDF images &amp; diagrams</span>
                  <Switch
                    checked={actions.notes.includeImages !== false}
                    label="Include useful PDF images and diagrams"
                    onClick={() => {
                      const next = actions.notes?.includeImages === false;
                      localStorage.setItem(IMAGE_NOTES_KEY, String(next));
                      updateNote({ includeImages: next });
                    }}
                  />
                </div>
              </div>
            )}
          </ActionRow>

          {/* Flashcards */}
          <ActionRow
            icon={Brain}
            label="Generate flashcards"
            checked={!!actions.flashcards}
            onToggle={toggleFlashcards}
          >
            {actions.flashcards && (
              <div className="mt-1 grid grid-cols-2 gap-1.5">
                <input
                  type="number"
                  min={1}
                  max={40}
                  value={actions.flashcards.count}
                  onChange={(e) => updateFlashcards({ count: Math.max(1, Math.min(40, Number(e.target.value) || 1)) })}
                  className="rounded border border-edge bg-surface-2 px-2 py-1 text-xs text-ink outline-none focus:border-focus"
                />
                <select
                  value={actions.flashcards.mode}
                  onChange={(e) => updateFlashcards({ mode: e.target.value as any })}
                  className="rounded border border-edge bg-surface-2 px-2 py-1 text-xs text-ink outline-none focus:border-focus"
                >
                  {FLASHCARD_MODES.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
                <input
                  value={actions.flashcards.deckName}
                  onChange={(e) => updateFlashcards({ deckName: e.target.value })}
                  placeholder="Deck name (optional)"
                  className="col-span-2 rounded border border-edge bg-surface-2 px-2 py-1 text-xs text-ink outline-none focus:border-focus"
                />
              </div>
            )}
          </ActionRow>

          {/* Teach */}
          <ActionRow
            icon={GraduationCap}
            label="Start Teach Me session"
            checked={!!actions.teach}
            onToggle={toggleTeach}
          >
            {actions.teach && (
              <div className="mt-1 grid grid-cols-2 gap-1.5">
                <select
                  value={actions.teach.level}
                  onChange={(e) => updateTeach({ level: e.target.value as any })}
                  className="rounded border border-edge bg-surface-2 px-2 py-1 text-xs text-ink outline-none focus:border-focus"
                >
                  {TEACH_LEVELS.map((l) => (
                    <option key={l.value} value={l.value}>{l.label}</option>
                  ))}
                </select>
                <input
                  value={actions.teach.title}
                  onChange={(e) => updateTeach({ title: e.target.value })}
                  placeholder="Session title (optional)"
                  className="rounded border border-edge bg-surface-2 px-2 py-1 text-xs text-ink outline-none focus:border-focus"
                />
              </div>
            )}
          </ActionRow>

          {/* Workspace */}
          <ActionRow
            icon={BookOpen}
            label="Create Study Hub workspace"
            checked={!!actions.workspace}
            onToggle={toggleWorkspace}
          >
            {actions.workspace && (
              <div className="mt-1">
                <input
                  value={actions.workspace.name}
                  onChange={(e) => updateWorkspace({ name: e.target.value })}
                  placeholder="Workspace name"
                  className="w-full rounded border border-edge bg-surface-2 px-2 py-1 text-xs text-ink outline-none focus:border-focus"
                />
              </div>
            )}
          </ActionRow>

          {error && (
            <Alert variant="danger" className="mt-3 flex items-start gap-2 text-xs">
              <AlertCircle size={13} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </Alert>
          )}
        </div>
    </Dialog>
  );
}

function ActionRow({
  icon: Icon,
  label,
  checked,
  onToggle,
  children,
}: {
  icon: typeof Folder;
  label: string;
  checked: boolean;
  onToggle: (v: boolean) => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-2 rounded-md border border-edge bg-surface-2 p-2.5">
      <label className="flex cursor-pointer items-center gap-2">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onToggle(e.target.checked)}
          className="h-3.5 w-3.5 rounded border-edge accent-accent"
        />
        <Icon size={13} className="text-ink-muted" />
        <span className="text-xs font-medium text-ink">{label}</span>
      </label>
      {checked && children}
    </div>
  );
}
