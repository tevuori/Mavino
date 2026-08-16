// ===== Study Hub: learning workspace editor =====
// Create or edit a named group of sources. Sources can be picked from the
// existing source library or added on the fly via SourcePicker (which
// resolves + caches them into the library first).

import { useState, useEffect, useCallback } from "react";
import {
  X, Plus, Trash2, FileText, File as FileIcon, Link2, GraduationCap,
  Loader2, Save, AlertCircle, Check,
} from "lucide-react";
import {
  studyWorkspacesApi,
  type LearningWorkspace,
} from "../../services/study-workspaces";
import { studySourcesApi, type StudySource } from "../../services/study-sources";
import type { SourceDescriptor } from "../../services/study";
import SourcePicker from "./SourcePicker";
import { ActionButton, ErrorBanner } from "./ui";

const KIND_ICON: Record<string, typeof FileText> = {
  note: FileText,
  file: FileIcon,
  paste: FileText,
  url: Link2,
};

const COLOR_PRESETS = ["#6366f1", "#8b5cf6", "#ec4899", "#f59e0b", "#10b981", "#06b6d4", "#ef4444"];

interface Props {
  /** Existing workspace to edit; omit for create mode. */
  workspace?: LearningWorkspace | null;
  onSaved: (w: LearningWorkspace) => void;
  onCancel: () => void;
}

export default function WorkspaceEditor({ workspace, onSaved, onCancel }: Props) {
  const editing = !!workspace;
  const [name, setName] = useState(workspace?.name ?? "");
  const [description, setDescription] = useState(workspace?.description ?? "");
  const [color, setColor] = useState(workspace?.color ?? COLOR_PRESETS[0]);
  const [library, setLibrary] = useState<StudySource[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    new Set(workspace?.sourceIds ?? [])
  );
  const [showPicker, setShowPicker] = useState(false);
  const [pickerValue, setPickerValue] = useState<SourceDescriptor | null>(null);
  const [addingSource, setAddingSource] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const loadLibrary = useCallback(async () => {
    try {
      const { sources } = await studySourcesApi.list();
      setLibrary(sources);
    } catch { /* non-fatal */ }
  }, []);

  useEffect(() => { void loadLibrary(); }, [loadLibrary]);

  const [justAdded, setJustAdded] = useState<string | null>(null);

  const addPickerSource = async (closeAfter: boolean) => {
    if (!pickerValue) return;
    setAddingSource(true);
    setError("");
    try {
      const { source } = await studySourcesApi.create(pickerValue);
      setLibrary((prev) => [source, ...prev.filter((s) => s.id !== source.id)]);
      setSelectedIds((prev) => new Set([...prev, source.id]));
      setJustAdded(source.name);
      setPickerValue(null);
      if (closeAfter) {
        setShowPicker(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add source");
    } finally {
      setAddingSource(false);
    }
  };

  const toggleSource = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const save = async () => {
    if (!name.trim()) {
      setError("Give the workspace a name.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const sourceIds = [...selectedIds];
      if (editing && workspace) {
        const { workspace: updated } = await studyWorkspacesApi.patch(workspace.id, {
          name: name.trim(),
          description: description.trim() || null,
          color,
          sourceIds,
        });
        onSaved(updated);
      } else {
        const { workspace: created } = await studyWorkspacesApi.create({
          name: name.trim(),
          description: description.trim() || undefined,
          color,
          sourceIds,
        });
        onSaved(created);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save workspace");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-edge bg-surface-2 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-ink">
          {editing ? "Edit workspace" : "New learning workspace"}
        </h3>
        <button onClick={onCancel} className="rounded p-1 text-ink-muted hover:text-ink">
          <X size={15} />
        </button>
      </div>

      {/* Name + color */}
      <div className="flex flex-col gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Workspace name (e.g. Calculus II — Final)"
          className="w-full rounded-md border border-edge bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
        />
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Optional description"
          className="w-full rounded-md border border-edge bg-surface px-3 py-1.5 text-xs text-ink outline-none focus:border-accent"
        />
        <div className="flex items-center gap-1.5">
          {COLOR_PRESETS.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              className={`h-5 w-5 rounded-full border-2 transition ${color === c ? "border-ink" : "border-transparent"}`}
              style={{ background: c }}
              title={c}
            />
          ))}
        </div>
      </div>

      {/* Sources */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Sources ({selectedIds.size})
          </span>
          <button
            onClick={() => setShowPicker(true)}
            className="flex items-center gap-1 rounded-md border border-edge px-2 py-1 text-[11px] text-ink-muted hover:bg-surface-3 hover:text-ink"
          >
            <Plus size={11} /> Add source
          </button>
        </div>

        {library.length === 0 && !showPicker ? (
          <p className="rounded-md border border-edge bg-surface p-3 text-xs text-ink-muted">
            No sources in your library yet. Click "Add source" to add a note, file (incl. PDF), URL, or pasted text.
          </p>
        ) : (
          <div className="flex max-h-52 flex-col gap-1 overflow-y-auto">
            {library.map((s) => {
              const Icon = KIND_ICON[s.kind] ?? FileText;
              const checked = selectedIds.has(s.id);
              return (
                <button
                  key={s.id}
                  onClick={() => toggleSource(s.id)}
                  className={`flex items-center gap-2 rounded-md border px-3 py-2 text-left text-xs transition ${
                    checked ? "border-accent bg-accent/10" : "border-edge bg-surface hover:bg-surface-3"
                  }`}
                >
                  <Icon size={13} className="shrink-0 opacity-70" />
                  <span className="flex-1 truncate text-ink">{s.name}</span>
                  <span className="shrink-0 text-[10px] uppercase opacity-60">{s.kind}</span>
                </button>
              );
            })}
          </div>
        )}

        {showPicker && (
          <div className="flex flex-col gap-2 rounded-lg border border-edge bg-surface p-3">
            {justAdded && !pickerValue && (
              <div className="flex items-center gap-1.5 rounded-md bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-400">
                <Check size={11} /> Added "{justAdded}" — add another or close.
              </div>
            )}
            <SourcePicker value={pickerValue} onChange={(v) => { setPickerValue(v); setJustAdded(null); }} />
            <div className="flex justify-end gap-2">
              <ActionButton onClick={() => { setShowPicker(false); setPickerValue(null); setJustAdded(null); }} variant="ghost">
                Done
              </ActionButton>
              <ActionButton
                onClick={() => void addPickerSource(false)}
                disabled={!pickerValue}
                loading={addingSource}
              >
                <Plus size={13} /> Add another
              </ActionButton>
              <ActionButton
                onClick={() => void addPickerSource(true)}
                disabled={!pickerValue}
                loading={addingSource}
              >
                <Plus size={13} /> Add & close
              </ActionButton>
            </div>
          </div>
        )}
      </div>

      {error && <ErrorBanner message={error} />}

      <div className="flex justify-end gap-2">
        <ActionButton onClick={onCancel} variant="ghost">Cancel</ActionButton>
        <ActionButton onClick={save} disabled={saving || !name.trim()} loading={saving}>
          <Save size={13} /> {editing ? "Save changes" : "Create workspace"}
        </ActionButton>
      </div>
    </div>
  );
}
