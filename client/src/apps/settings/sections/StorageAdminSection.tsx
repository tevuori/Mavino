import { useState, useEffect, useCallback } from "react";
import { HardDrive, Loader2, Check } from "lucide-react";
import { adminStorageApi, type StorageQuota } from "../../../services/admin-storage";
import { SectionHeader, Card, Field, StatusPill, SaveButton, MsgBox, inputClass } from "../ui";

const ROLE_LABELS: Record<string, string> = {
  FREE: "Free",
  PAID: "Paid",
  MANAGER: "Manager",
  ADMIN: "Admin",
  DEMO: "Demo",
};

const ROLE_ORDER = ["FREE", "PAID", "MANAGER", "ADMIN", "DEMO"];

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes < 1024 * 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  return `${(bytes / 1024 / 1024 / 1024 / 1024).toFixed(2)} TB`;
}

/** Parse a human-friendly size string ("500 MB", "2 GB", "1024") into bytes. */
function parseSize(input: string): number | null {
  const s = input.trim().toLowerCase();
  if (!s) return 0;
  const m = s.match(/^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb|tb)?$/);
  if (!m) return null;
  const n = Number(m[1]);
  if (isNaN(n)) return null;
  const unit = m[2] ?? "b";
  const mult = unit === "b" ? 1
    : unit === "kb" ? 1024
    : unit === "mb" ? 1024 * 1024
    : unit === "gb" ? 1024 * 1024 * 1024
    : 1024 * 1024 * 1024 * 1024;
  return Math.round(n * mult);
}

interface RoleRowState {
  enabled: boolean;
  /** Human-readable size string for the input field. */
  sizeInput: string;
}

export default function StorageAdminSection() {
  const [quotas, setQuotas] = useState<StorageQuota[] | null>(null);
  const [rows, setRows] = useState<Record<string, RoleRowState>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const { quotas: list } = await adminStorageApi.listQuotas();
      // Sort by canonical role order, then any extras.
      list.sort((a, b) => {
        const ai = ROLE_ORDER.indexOf(a.role);
        const bi = ROLE_ORDER.indexOf(b.role);
        return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
      });
      setQuotas(list);
      const next: Record<string, RoleRowState> = {};
      for (const q of list) {
        next[q.role] = {
          enabled: q.enabled,
          sizeInput: q.maxBytes > 0 ? fmtSize(q.maxBytes) : "0",
        };
      }
      setRows(next);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const save = async (role: string) => {
    const row = rows[role];
    if (!row) return;
    const bytes = parseSize(row.sizeInput);
    if (bytes === null) {
      setErr(true);
      setMsg(`Invalid size for ${ROLE_LABELS[role] ?? role}. Use formats like "500 MB", "2 GB", or "0".`);
      return;
    }
    setBusy(true);
    setErr(false);
    setMsg(null);
    try {
      await adminStorageApi.setQuota(role, { enabled: row.enabled, maxBytes: bytes });
      await refresh();
      setMsg(`${ROLE_LABELS[role] ?? role} quota saved.`);
    } catch (e) {
      setErr(true);
      setMsg(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  };

  const saveAll = async () => {
    setBusy(true);
    setErr(false);
    setMsg(null);
    try {
      for (const role of Object.keys(rows)) {
        const row = rows[role];
        const bytes = parseSize(row.sizeInput);
        if (bytes === null) {
          setErr(true);
          setMsg(`Invalid size for ${ROLE_LABELS[role] ?? role}.`);
          setBusy(false);
          return;
        }
        await adminStorageApi.setQuota(role, { enabled: row.enabled, maxBytes: bytes });
      }
      await refresh();
      setMsg("All quotas saved.");
    } catch (e) {
      setErr(true);
      setMsg(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  };

  const updateRow = (role: string, patch: Partial<RoleRowState>) => {
    setRows((prev) => ({ ...prev, [role]: { ...prev[role], ...patch } }));
  };

  return (
    <section id="storage-admin" className="mb-8">
      <SectionHeader
        icon={<HardDrive size={18} />}
        title="Storage Quotas"
        description="Set per-role storage caps on user-uploaded files. Disabled quotas mean unlimited storage. Changes apply immediately to new uploads."
      />

      <Card className="mb-3">
        <p className="mb-3 text-xs text-ink-muted">
          Quotas count on-disk file sizes (uploads, text files, voice recordings, lecture videos and extracted slides).
          Moodle-managed virtual files don't count — they're streamed from the integration.
        </p>

        {!quotas ? (
          <div className="flex items-center gap-2 text-sm text-ink-muted">
            <Loader2 size={14} className="animate-spin" /> Loading…
          </div>
        ) : (
          <div className="space-y-3">
            {quotas.map((q) => {
              const row = rows[q.role];
              if (!row) return null;
              const dirty =
                row.enabled !== q.enabled ||
                parseSize(row.sizeInput) !== q.maxBytes;
              return (
                <div
                  key={q.role}
                  className="rounded-lg border border-edge bg-surface-2 p-3"
                >
                  <div className="mb-2 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-ink">
                        {ROLE_LABELS[q.role] ?? q.role}
                      </span>
                      <StatusPill
                        on={q.enabled && q.maxBytes > 0}
                        onLabel={q.enabled && q.maxBytes > 0 ? fmtSize(q.maxBytes) : "Unlimited"}
                        offLabel="Unlimited"
                      />
                    </div>
                    <label className="flex cursor-pointer items-center gap-1.5 text-xs text-ink-muted">
                      <input
                        type="checkbox"
                        checked={row.enabled}
                        onChange={(e) => updateRow(q.role, { enabled: e.target.checked })}
                        className="h-4 w-4 rounded border-edge accent-[var(--accent)]"
                      />
                      Enabled
                    </label>
                  </div>
                  <div className="flex items-end gap-2">
                    <Field label="Max storage" hint='e.g. "500 MB", "2 GB", "1 TB", or "0" for unlimited'>
                      <input
                        value={row.sizeInput}
                        onChange={(e) => updateRow(q.role, { sizeInput: e.target.value })}
                        placeholder="500 MB"
                        className={inputClass}
                        disabled={!row.enabled}
                      />
                    </Field>
                    <SaveButton
                      busy={busy}
                      onClick={() => save(q.role)}
                      disabled={!dirty}
                    >
                      Save
                    </SaveButton>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-4 flex items-center gap-2">
          <SaveButton busy={busy} onClick={saveAll}>Save all</SaveButton>
        </div>
        <MsgBox msg={msg} error={err} />
      </Card>
    </section>
  );
}
