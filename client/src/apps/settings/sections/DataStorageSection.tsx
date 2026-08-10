import { useState, useEffect } from "react";
import { Database, Download, Trash2, AlertTriangle, Loader2, HardDrive } from "lucide-react";
import { filesApi } from "../../../services/files";
import { useAuth } from "../../../store/auth";
import { getToken, apiUrl } from "../../../services/api";
import { SectionHeader, Card, MsgBox, inputClass } from "../ui";

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export default function DataStorageSection() {
  const { deleteAccount } = useAuth();
  const [storage, setStorage] = useState<{ total: number; count: number; limit?: number | null } | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [cacheMsg, setCacheMsg] = useState<string | null>(null);
  const [delPw, setDelPw] = useState("");
  const [delBusy, setDelBusy] = useState(false);
  const [delErr, setDelErr] = useState<string | null>(null);

  useEffect(() => {
    filesApi.storage().then(setStorage).catch(() => setStorage(null));
  }, []);

  const doExport = async () => {
    setExportBusy(true);
    try {
      // The export endpoint returns a JSON attachment; fetch as blob and download.
      const token = getToken();
      const res = await fetch(apiUrl("/api/auth/export"), {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `athena-export-${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setCacheMsg(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExportBusy(false);
    }
  };

  const clearCache = () => {
    if (!confirm("Clear all local cached data (window layouts, settings cache, etc.)? Your account data on the server is not affected.")) return;
    // Preserve the auth token so the user stays logged in.
    const token = localStorage.getItem("athena.token");
    localStorage.clear();
    if (token) localStorage.setItem("athena.token", token);
    setCacheMsg("Local cache cleared. Reload to see the effect.");
  };

  const doDelete = async () => {
    if (!delPw) return;
    if (!confirm("Permanently delete your account and ALL your data? This cannot be undone.")) return;
    if (!confirm("Really delete everything? This is your final confirmation.")) return;
    setDelBusy(true);
    setDelErr(null);
    try {
      await deleteAccount(delPw);
      // Auth store clears token + sets unauthenticated; the app will redirect to login.
      window.location.reload();
    } catch (e) {
      setDelErr(e instanceof Error ? e.message : "Failed to delete account");
    } finally {
      setDelBusy(false);
    }
  };

  return (
    <section id="data" className="mb-8">
      <SectionHeader
        icon={<Database size={18} />}
        title="Data & Storage"
        description="Inspect usage, export your data, clear local cache, or delete your account."
      />

      <Card className="mb-3">
        <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink">
          <HardDrive size={15} /> Storage usage
        </h4>
        {storage ? (
          <>
            <div className="mb-1 flex items-center justify-between text-xs text-ink-muted">
              <span>{storage.count} file(s)</span>
              <span>
                {fmtSize(storage.total)}
                {storage.limit ? ` / ${fmtSize(storage.limit)}` : ""}
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-surface-3">
              <div
                className="h-full rounded-full bg-accent"
                style={{
                  width: `${
                    storage.limit
                      ? Math.min(100, (storage.total / storage.limit) * 100)
                      : Math.min(100, (storage.total / (500 * 1024 * 1024)) * 100)
                  }%`,
                }}
              />
            </div>
            <p className="mt-1 text-[11px] text-ink-muted">
              {storage.limit
                ? `Quota: ${fmtSize(storage.limit)}`
                : "No quota configured — bar shown relative to 500 MB."}
            </p>
          </>
        ) : (
          <p className="text-sm text-ink-muted">Unable to load storage info.</p>
        )}
      </Card>

      <Card className="mb-3">
        <h4 className="mb-1 flex items-center gap-2 text-sm font-semibold text-ink">
          <Download size={15} /> Export your data
        </h4>
        <p className="mb-3 text-xs text-ink-muted">
          Download a JSON backup of your notes, tasks, courses, flashcards, habits, calendar, files
          metadata, and study history.
        </p>
        <button
          onClick={doExport}
          disabled={exportBusy}
          className="flex items-center gap-1.5 rounded-lg border border-edge px-3 py-2 text-sm text-ink hover:bg-surface-3 disabled:opacity-40"
        >
          {exportBusy ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Export JSON
        </button>
      </Card>

      <Card className="mb-3">
        <h4 className="mb-1 flex items-center gap-2 text-sm font-semibold text-ink">
          <Trash2 size={15} /> Clear local cache
        </h4>
        <p className="mb-3 text-xs text-ink-muted">
          Removes window layouts and cached UI state from this browser. Server data is untouched.
        </p>
        <button
          onClick={clearCache}
          className="flex items-center gap-1.5 rounded-lg border border-edge px-3 py-2 text-sm text-ink-muted hover:bg-surface-3"
        >
          <Trash2 size={14} /> Clear cache
        </button>
        <MsgBox msg={cacheMsg} />
      </Card>

      <Card className="border-red-500/40">
        <h4 className="mb-1 flex items-center gap-2 text-sm font-semibold text-red-500">
          <AlertTriangle size={15} /> Danger zone
        </h4>
        <p className="mb-3 text-xs text-ink-muted">
          Permanently delete your account and all associated data. This is irreversible. Enter your
          password to confirm.
        </p>
        <div className="flex items-center gap-2">
          <input
            type="password"
            value={delPw}
            onChange={(e) => setDelPw(e.target.value)}
            placeholder="Your password"
            className={`flex-1 ${inputClass}`}
          />
          <button
            onClick={doDelete}
            disabled={delBusy || !delPw}
            className="flex items-center gap-1.5 rounded-lg bg-red-500 px-3 py-2 text-sm text-white hover:opacity-90 disabled:opacity-40"
          >
            {delBusy ? <Loader2 size={14} className="animate-spin" /> : <AlertTriangle size={14} />} Delete account
          </button>
        </div>
        <MsgBox msg={delErr} error />
      </Card>
    </section>
  );
}
