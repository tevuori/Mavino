// ===== Admin: Plugin Management =====
// Admins publish, edit, feature, and remove plugins from the marketplace
// catalog. Also supports pasting a raw JSON manifest to publish a new plugin.

import { useState, useEffect, useCallback } from "react";
import {
  Puzzle, Loader2, Plus, Trash2, Star, StarOff, Eye, EyeOff, Save, X, Download,
} from "lucide-react";
import { pluginsAdminApi, type AdminPlugin, type PluginManifestInput } from "../../../services/plugins";
import { SectionHeader, Card, MsgBox, inputClass } from "../ui";

export default function PluginsAdminSection() {
  const [plugins, setPlugins] = useState<AdminPlugin[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<AdminPlugin | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const data = await pluginsAdminApi.list();
      setPlugins(data.plugins ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load plugins");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const toggleFeatured = async (p: AdminPlugin) => {
    setBusyKey(p.pluginKey);
    try {
      await pluginsAdminApi.setFeatured(p.pluginKey, !p.featured);
      void refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusyKey(null);
    }
  };

  const togglePublished = async (p: AdminPlugin) => {
    setBusyKey(p.pluginKey);
    try {
      await pluginsAdminApi.setPublished(p.pluginKey, !p.published);
      void refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusyKey(null);
    }
  };

  const remove = async (p: AdminPlugin) => {
    if (!confirm(`Delete "${p.name}" from the catalog? This uninstalls it from all users.`)) return;
    setBusyKey(p.pluginKey);
    try {
      await pluginsAdminApi.remove(p.pluginKey);
      void refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <section id="plugins-admin" className="mb-8">
      <SectionHeader
        icon={<Puzzle size={18} />}
        title="Plugin Marketplace"
        description="Publish and manage community plugins. Plugins are loaded from a remote ES module URL (default export = React component). Optionally declare Athena tools (proxied to a webhook). Only published plugins appear in the marketplace."
      />

      <div className="mb-4 flex items-center gap-2">
        <button
          onClick={() => { setEditing(null); setShowForm(true); }}
          className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-fg hover:opacity-90"
        >
          <Plus size={14} /> Publish plugin
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8 text-ink-muted">
          <Loader2 size={18} className="animate-spin" />
        </div>
      ) : plugins.length === 0 && !showForm ? (
        <Card>
          <p className="text-sm text-ink-muted text-center py-4">
            No plugins published yet. Click "Publish plugin" to add one.
          </p>
        </Card>
      ) : (
        <div className="space-y-2">
          {plugins.map((p) => (
            <Card key={p.pluginKey} className="flex items-center justify-between gap-3 p-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-ink">{p.name}</span>
                  {p.featured && <Star size={12} className="shrink-0 text-amber-500" />}
                  {!p.published && (
                    <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-500">
                      Unpublished
                    </span>
                  )}
                </div>
                <p className="truncate text-xs text-ink-muted">
                  {p.pluginKey} · v{p.version} · by {p.author || "unknown"} · {p.installCount} installs
                </p>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => toggleFeatured(p)}
                  disabled={busyKey === p.pluginKey}
                  title={p.featured ? "Unfeature" : "Feature"}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-3 hover:text-ink"
                >
                  {p.featured ? <StarOff size={14} /> : <Star size={14} />}
                </button>
                <button
                  onClick={() => togglePublished(p)}
                  disabled={busyKey === p.pluginKey}
                  title={p.published ? "Unpublish" : "Publish"}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-3 hover:text-ink"
                >
                  {p.published ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
                <button
                  onClick={() => { setEditing(p); setShowForm(true); }}
                  disabled={busyKey === p.pluginKey}
                  title="Edit"
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-3 hover:text-ink"
                >
                  <Save size={14} />
                </button>
                <button
                  onClick={() => remove(p)}
                  disabled={busyKey === p.pluginKey}
                  title="Delete"
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-red-500 hover:bg-red-500/15"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {showForm && (
        <PluginForm
          editing={editing}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSaved={() => { setShowForm(false); setEditing(null); void refresh(); }}
        />
      )}

      <MsgBox msg={err} error />
    </section>
  );
}

function PluginForm({
  editing,
  onClose,
  onSaved,
}: {
  editing: AdminPlugin | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [rawManifest, setRawManifest] = useState(() => {
    if (editing) {
      try {
        const m = JSON.parse(editing.manifest) as PluginManifestInput;
        return JSON.stringify(m, null, 2);
      } catch {
        return "";
      }
    }
    return JSON.stringify({
      id: "my-plugin",
      name: "My Plugin",
      description: "A community plugin for Mavino",
      icon: "Puzzle",
      version: "1.0.0",
      author: "your-name",
      category: "productivity",
      entryUrl: "https://cdn.example.com/my-plugin.js",
      minTier: "paid",
      permissions: [],
      tools: [],
    }, null, 2);
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setErr(null);
    try {
      const manifest = JSON.parse(rawManifest) as PluginManifestInput;
      if (editing) {
        await pluginsAdminApi.update(editing.pluginKey, manifest);
      } else {
        await pluginsAdminApi.create(manifest);
      }
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to save plugin");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-4 rounded-lg border border-edge bg-surface-2 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-sm font-semibold text-ink">
          {editing ? `Edit: ${editing.name}` : "Publish new plugin"}
        </h4>
        <button onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-3">
          <X size={15} />
        </button>
      </div>
      <p className="mb-2 text-xs text-ink-muted">
        Paste the plugin manifest JSON. See the schema in the Prisma model comment.
      </p>
      <textarea
        value={rawManifest}
        onChange={(e) => setRawManifest(e.target.value)}
        rows={18}
        className={`${inputClass} font-mono text-xs`}
        spellCheck={false}
      />
      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={save}
          disabled={saving}
          className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-fg hover:opacity-90 disabled:opacity-40"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
          {editing ? "Update" : "Publish"}
        </button>
        <MsgBox msg={err} error />
      </div>
    </div>
  );
}
