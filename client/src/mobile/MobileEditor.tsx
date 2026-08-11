import { useCallback, useEffect, useMemo, useState } from "react";
import { FileText, Plus, Save, Search, Trash2 } from "lucide-react";
import { filesApi, isTextFile } from "../services/files";
import type { VFile } from "../types";
import { MobileContainer, MobileEmpty, MobileFab, MobileHeader, MobileInput, MobileLoading, MobileTextarea } from "./MobileUi";

export default function MobileEditor({ onClose }: { onClose?: () => void }) {
  const [files, setFiles] = useState<VFile[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<VFile | null>(null);
  const [content, setContent] = useState("");
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const res = await filesApi.all({ q: query.trim() || undefined }).catch(() => null);
    const list = (res?.files ?? []).filter((f) => isTextFile(f));
    setFiles(list);
    setLoading(false);
  }, [query]);

  useEffect(() => {
    const t = setTimeout(() => { void load(); }, 250);
    return () => clearTimeout(t);
  }, [load]);

  const open = async (f: VFile) => {
    const res = await filesApi.getContent(f.id).catch(() => null);
    if (!res) return;
    setSelected(f);
    setName(res.name);
    setContent(res.content);
  };

  const save = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      if (name !== selected.name) await filesApi.rename(selected.id, name);
      await filesApi.saveContent(selected.id, content);
      setFiles((list) => list.map((f) => f.id === selected.id ? { ...f, name, updatedAt: new Date().toISOString() } : f));
      setSelected((s) => (s ? { ...s, name } : null));
    } catch { /* ignore */ }
    setSaving(false);
  };

  const create = async () => {
    if (!newName.trim()) return;
    const res = await filesApi.createText({ name: newName.trim(), content: "" }).catch(() => null);
    if (res?.file) {
      setFiles((list) => [res.file, ...list]);
      setCreating(false);
      setNewName("");
      void open(res.file);
    }
  };

  const remove = async (f: VFile) => {
    if (!window.confirm(`Delete ${f.name}?`)) return;
    await filesApi.delete(f.id).catch(() => {});
    setFiles((list) => list.filter((x) => x.id !== f.id));
    if (selected?.id === f.id) setSelected(null);
  };

  const filtered = useMemo(() => files.filter((f) => f.name.toLowerCase().includes(query.toLowerCase())), [files, query]);

  if (selected) {
    return (
      <MobileContainer>
        <MobileHeader
          title={name || "Editor"}
          subtitle="Text file"
          onBack={() => { setSelected(null); setContent(""); }}
          right={
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="flex h-11 w-11 items-center justify-center rounded-2xl bg-accent text-ink disabled:opacity-50"
            >
              <Save size={20} />
            </button>
          }
        />
        {saving && <p className="mb-2 text-xs text-ink-muted">Saving…</p>}
        <MobileInput value={name} onChange={(e) => setName(e.target.value)} placeholder="Filename" className="mb-3" />
        <MobileTextarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Start typing…"
          rows={18}
        />
      </MobileContainer>
    );
  }

  return (
    <MobileContainer>
      <MobileHeader
        title="Editor"
        subtitle="Text & code"
        onClose={onClose}
        right={<MobileFab onClick={() => setCreating(true)} icon={<Plus size={22} />} />}
      />

      <div className="mb-4 flex items-center gap-2 rounded-2xl border border-edge bg-surface-2 px-3 py-2">
        <Search size={18} className="text-ink-muted" />
        <MobileInput
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search text files"
          className="border-0 bg-transparent px-2 py-1 text-sm"
        />
      </div>

      <div className="space-y-2">
        {loading ? (
          <MobileLoading />
        ) : filtered.length ? (
          filtered.map((f) => (
            <article
              key={f.id}
              className="flex items-center gap-3 rounded-2xl border border-edge bg-surface-2 p-4"
            >
              <button type="button" onClick={() => void open(f)} className="min-w-0 flex-1 text-left">
                <div className="flex items-center gap-2">
                  <FileText size={18} className="shrink-0 text-accent" />
                  <span className="min-w-0 flex-1 truncate font-medium text-ink">{f.name}</span>
                </div>
                <p className="mt-1 text-xs text-ink-muted">
                  {new Date(f.updatedAt).toLocaleDateString()}
                </p>
              </button>
              <button
                type="button"
                onClick={() => void remove(f)}
                className="shrink-0 rounded-xl p-2 text-ink-muted active:text-rose-400"
              >
                <Trash2 size={18} />
              </button>
            </article>
          ))
        ) : (
          <MobileEmpty text="No text files. Create one to start editing." />
        )}
      </div>

      {creating && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center" onClick={() => setCreating(false)}>
          <div className="w-full max-w-md rounded-2xl border border-edge bg-surface p-4" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-3 text-lg font-semibold text-ink">New file</h2>
            <MobileInput value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="filename.txt" className="mb-4" />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setCreating(false)} className="rounded-xl px-4 py-2 text-sm text-ink-muted">Cancel</button>
              <button type="button" onClick={() => void create()} className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-ink">Create</button>
            </div>
          </div>
        </div>
      )}
    </MobileContainer>
  );
}
