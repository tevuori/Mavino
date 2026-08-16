import { useState, useEffect, useCallback } from "react";
import { Users as UsersIcon, Plus, Trash2, KeyRound, X, Loader2, ShieldCheck, User as UserIcon, UserPlus } from "lucide-react";
import { usersApi } from "../../../services/users";
import { useAuth } from "../../../store/auth";
import type { AdminUser, UserRole } from "../../../types";
import { SectionHeader, Card, Field, inputClass } from "../ui";

const AVATAR_PRESETS = [
  "#6366f1", "#8b5cf6", "#ec4899", "#ef4444",
  "#f97316", "#eab308", "#22c55e", "#14b8a6",
  "#06b6d4", "#3b82f6",
];

export default function UsersSection() {
  const { user: me } = useAuth();
  const isAdmin = me?.role === "ADMIN";
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [resetting, setResetting] = useState<AdminUser | null>(null);
  const [regEnabled, setRegEnabled] = useState(false);
  const [regLoading, setRegLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setUsers(await usersApi.list());
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshReg = useCallback(async () => {
    try {
      const data = await usersApi.getRegistration();
      setRegEnabled(data.enabled);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void refresh();
    void refreshReg();
  }, [refresh, refreshReg]);

  const toggleReg = async () => {
    setRegLoading(true);
    try {
      const data = await usersApi.setRegistration(!regEnabled);
      setRegEnabled(data.enabled);
    } catch {
      /* ignore */
    } finally {
      setRegLoading(false);
    }
  };

  return (
    <section id="users" className="mb-8">
      <SectionHeader
        icon={<UsersIcon size={18} />}
        title="User Management"
        description="Create, edit, and remove user accounts. Managers can manage non-admin accounts; only admins can manage admin accounts."
      />

      {isAdmin && (
        <>
          {/* Open registration toggle */}
          <Card className="mb-3 flex items-center justify-between p-4">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
                <UserPlus size={16} />
              </div>
              <div>
                <p className="text-sm font-medium text-ink">Allow new users to sign up</p>
                <p className="mt-0.5 text-xs text-ink-muted">
                  When enabled, the login screen shows a "Create account" form. New users
                  get the USER role (not admin). Disabled by default.
                </p>
              </div>
            </div>
            <button
              onClick={toggleReg}
              disabled={regLoading}
              className={`relative h-6 w-11 shrink-0 rounded-full transition ${
                regEnabled ? "bg-accent" : "bg-surface-3"
              } disabled:opacity-50`}
              role="switch"
              aria-checked={regEnabled}
            >
              <span
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
                  regEnabled ? "left-[22px]" : "left-0.5"
                }`}
              />
            </button>
          </Card>
        </>
      )}

      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs text-ink-muted">{users.length} user(s)</span>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm text-accent-fg hover:opacity-90"
        >
          <Plus size={14} /> New user
        </button>
      </div>

      <Card className="overflow-visible p-0">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-ink-muted">
            <Loader2 size={18} className="animate-spin" />
          </div>
        ) : users.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-muted">No users found.</p>
        ) : (
          <div className="divide-y divide-edge">
            {users.map((u) => (
              <UserRow
                key={u.id}
                u={u}
                isMe={u.id === me?.id}
                onEdit={() => setEditing(u)}
                onReset={() => setResetting(u)}
                onChanged={refresh}
              />
            ))}
          </div>
        )}
      </Card>

      {showCreate && (
        <CreateUserModal onClose={() => setShowCreate(false)} onCreated={refresh} />
      )}
      {editing && (
        <EditUserModal user={editing} onClose={() => setEditing(null)} onSaved={refresh} />
      )}
      {resetting && (
        <ResetPasswordModal
          user={resetting}
          onClose={() => setResetting(null)}
          onDone={refresh}
        />
      )}
    </section>
  );
}

function UserRow({
  u,
  isMe,
  onEdit,
  onReset,
  onChanged,
}: {
  u: AdminUser;
  isMe: boolean;
  onEdit: () => void;
  onReset: () => void;
  onChanged: () => void;
}) {
  const { user: me } = useAuth();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const isManager = me?.role === "MANAGER";
  const canManage = me?.role === "ADMIN" || (isManager && u.role !== "ADMIN");

  const del = async () => {
    if (!confirm(`Delete user "${u.username}"? This removes all their data.`)) return;
    setBusy(true);
    setErr(null);
    try {
      await usersApi.remove(u.id);
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to delete");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-3 p-3">
      <div
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white"
        style={{ background: u.avatarColor }}
      >
        {(u.displayName || u.username || "U").charAt(0).toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-sm font-medium text-ink">
          <span className="truncate">{u.displayName || u.username}</span>
          {u.role === "ADMIN" && (
            <ShieldCheck size={13} className="shrink-0 text-accent" />
          )}
          {u.role === "MANAGER" && (
            <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">MANAGER</span>
          )}
          {u.role === "PAID" && (
            <span className="rounded bg-indigo-500/15 px-1.5 py-0.5 text-[10px] font-medium text-indigo-400">PAID</span>
          )}
          {u.role === "PRO" && (
            <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-500">PRO</span>
          )}
          {u.role === "FREE" && (
            <span className="rounded bg-surface-3 px-1.5 py-0.5 text-[10px] font-medium text-ink-muted">FREE</span>
          )}
          {u.role === "DEMO" && (
            <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">DEMO</span>
          )}
          {isMe && <span className="text-[10px] uppercase text-ink-muted">(you)</span>}
        </p>
        <p className="truncate text-xs text-ink-muted">
          @{u.username} · {new Date(u.createdAt).toLocaleDateString()}
        </p>
        {err && <p className="text-xs text-red-500">{err}</p>}
      </div>
      {canManage && (
        <div className="flex shrink-0 items-center gap-1">
          <button
            onClick={onEdit}
            disabled={busy}
            className="rounded-md p-1.5 text-ink-muted hover:bg-surface-3 hover:text-ink"
            title="Edit"
          >
            <UserIcon size={15} />
          </button>
          <button
            onClick={onReset}
            disabled={busy}
            className="rounded-md p-1.5 text-ink-muted hover:bg-surface-3 hover:text-ink"
            title="Reset password"
          >
            <KeyRound size={15} />
          </button>
          {!isMe && (
            <button
              onClick={del}
              disabled={busy}
              className="rounded-md p-1.5 text-ink-muted hover:bg-red-500 hover:text-white"
              title="Delete"
            >
              <Trash2 size={15} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-xl border border-edge bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-edge px-4 py-3">
          <h4 className="text-sm font-semibold text-ink">{title}</h4>
          <button onClick={onClose} className="rounded-md p-1 text-ink-muted hover:bg-surface-3">
            <X size={16} />
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

function CreateUserModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { user: me } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [avatarColor, setAvatarColor] = useState(AVATAR_PRESETS[0]);
  const [role, setRole] = useState<UserRole>("FREE");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const isAdmin = me?.role === "ADMIN";
  const roleOptions: { value: UserRole; label: string }[] = isAdmin
    ? [
        { value: "FREE", label: "Free (limited AI)" },
        { value: "PAID", label: "Paid (higher AI limits)" },
        { value: "PRO", label: "Pro (highest AI limits)" },
        { value: "MANAGER", label: "Manager (user management)" },
        { value: "DEMO", label: "Demo (pre-seeded trial)" },
        { value: "ADMIN", label: "Administrator" },
      ]
    : [
        { value: "FREE", label: "Free (limited AI)" },
        { value: "PAID", label: "Paid (higher AI limits)" },
        { value: "PRO", label: "Pro (highest AI limits)" },
        { value: "MANAGER", label: "Manager (user management)" },
      ];

  const submit = async () => {
    if (!username.trim() || !password) return;
    setBusy(true);
    setErr(null);
    try {
      await usersApi.create({
        username: username.trim(),
        password,
        displayName: displayName.trim(),
        avatarColor,
        role,
      });
      onCreated();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to create user");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Create user" onClose={onClose}>
      <div className="space-y-3">
        <Field label="Username">
          <input value={username} onChange={(e) => setUsername(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Password">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Display name (optional)">
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Avatar color">
          <div className="flex flex-wrap items-center gap-2">
            {AVATAR_PRESETS.map((c) => (
              <button
                key={c}
                onClick={() => setAvatarColor(c)}
                className={`h-7 w-7 rounded-full border-2 transition ${
                  avatarColor === c ? "border-ink ring-2 ring-accent" : "border-transparent"
                }`}
                style={{ background: c }}
              />
            ))}
          </div>
        </Field>
        <Field label="Role">
          <select value={role} onChange={(e) => setRole(e.target.value as UserRole)} className={inputClass}>
            {roleOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </Field>
        {err && <p className="text-xs text-red-500">{err}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="rounded-lg border border-edge px-3 py-2 text-sm text-ink-muted hover:bg-surface-3">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={busy || !username.trim() || !password}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm text-accent-fg hover:opacity-90 disabled:opacity-40"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Create
          </button>
        </div>
      </div>
    </Modal>
  );
}

function EditUserModal({
  user,
  onClose,
  onSaved,
}: {
  user: AdminUser;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { user: me } = useAuth();
  const [displayName, setDisplayName] = useState(user.displayName);
  const [avatarColor, setAvatarColor] = useState(user.avatarColor);
  const [role, setRole] = useState<UserRole>(user.role);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const isSelf = user.id === me?.id;
  const isAdmin = me?.role === "ADMIN";
  const roleOptions: { value: UserRole; label: string }[] = isAdmin
    ? [
        { value: "FREE", label: "Free (limited AI)" },
        { value: "PAID", label: "Paid (higher AI limits)" },
        { value: "PRO", label: "Pro (highest AI limits)" },
        { value: "MANAGER", label: "Manager (user management)" },
        { value: "DEMO", label: "Demo (pre-seeded trial)" },
        { value: "ADMIN", label: "Administrator" },
      ]
    : [
        { value: "FREE", label: "Free (limited AI)" },
        { value: "PAID", label: "Paid (higher AI limits)" },
        { value: "PRO", label: "Pro (highest AI limits)" },
        { value: "MANAGER", label: "Manager (user management)" },
      ];

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      await usersApi.update(user.id, {
        displayName: displayName.trim(),
        avatarColor,
        role: isSelf ? undefined : role,
      });
      onSaved();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Edit @${user.username}`} onClose={onClose}>
      <div className="space-y-3">
        <Field label="Display name">
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Avatar color">
          <div className="flex flex-wrap items-center gap-2">
            {AVATAR_PRESETS.map((c) => (
              <button
                key={c}
                onClick={() => setAvatarColor(c)}
                className={`h-7 w-7 rounded-full border-2 transition ${
                  avatarColor === c ? "border-ink ring-2 ring-accent" : "border-transparent"
                }`}
                style={{ background: c }}
              />
            ))}
          </div>
        </Field>
        <Field label="Role" hint={isSelf ? "You cannot change your own role." : undefined}>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as UserRole)}
            disabled={isSelf}
            className={inputClass}
          >
            {roleOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </Field>
        {err && <p className="text-xs text-red-500">{err}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="rounded-lg border border-edge px-3 py-2 text-sm text-ink-muted hover:bg-surface-3">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm text-accent-fg hover:opacity-90 disabled:opacity-40"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />} Save
          </button>
        </div>
      </div>
    </Modal>
  );
}

function ResetPasswordModal({
  user,
  onClose,
  onDone,
}: {
  user: AdminUser;
  onClose: () => void;
  onDone: () => void;
}) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (password.length < 4) {
      setErr("Password must be at least 4 characters.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await usersApi.resetPassword(user.id, password);
      onDone();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Reset password for @${user.username}`} onClose={onClose}>
      <div className="space-y-3">
        <Field label="New password">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
          />
        </Field>
        {err && <p className="text-xs text-red-500">{err}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="rounded-lg border border-edge px-3 py-2 text-sm text-ink-muted hover:bg-surface-3">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={busy || !password}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm text-accent-fg hover:opacity-90 disabled:opacity-40"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />} Reset
          </button>
        </div>
      </div>
    </Modal>
  );
}
