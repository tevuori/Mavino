import { useState, useEffect, useCallback } from "react";
import { User, Loader2, KeyRound, ShieldCheck, MonitorSmartphone, Trash2 } from "lucide-react";
import { useAuth } from "../../../store/auth";
import { authApi, type AuthDevice } from "../../../services/auth";
import { SectionHeader, Card, Field, SaveButton, MsgBox, inputClass } from "../ui";
import TwoFactorSection from "./TwoFactorSection";

const AVATAR_PRESETS = [
  "#6366f1", "#8b5cf6", "#ec4899", "#ef4444",
  "#f97316", "#eab308", "#22c55e", "#14b8a6",
  "#06b6d4", "#3b82f6",
];

export default function AccountSection() {
  const { user, updateProfile, changePassword } = useAuth();

  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [avatarColor, setAvatarColor] = useState(user?.avatarColor ?? "#6366f1");
  const [email, setEmail] = useState(user?.email ?? "");
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileMsg, setProfileMsg] = useState<string | null>(null);
  const [profileErr, setProfileErr] = useState(false);

  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg, setPwMsg] = useState<string | null>(null);
  const [pwErr, setPwErr] = useState(false);

  // Active sessions / remembered devices
  const [devices, setDevices] = useState<AuthDevice[]>([]);
  const [devicesLoading, setDevicesLoading] = useState(true);
  const [deviceErr, setDeviceErr] = useState<string | null>(null);

  const refreshDevices = useCallback(async () => {
    setDevicesLoading(true);
    setDeviceErr(null);
    try {
      setDevices(await authApi.listDevices());
    } catch (e) {
      setDeviceErr(e instanceof Error ? e.message : "Failed to load devices");
    } finally {
      setDevicesLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshDevices();
  }, [refreshDevices]);

  const revokeDevice = async (id: string) => {
    if (!confirm("Revoke this device? It will be signed out immediately.")) return;
    try {
      await authApi.revokeDevice(id);
      await refreshDevices();
    } catch (e) {
      setDeviceErr(e instanceof Error ? e.message : "Failed to revoke device");
    }
  };

  const revokeAll = async () => {
    if (!confirm("Revoke ALL remembered devices? You'll need to sign in again on every device.")) return;
    try {
      await authApi.revokeAllDevices();
      await refreshDevices();
    } catch (e) {
      setDeviceErr(e instanceof Error ? e.message : "Failed to revoke devices");
    }
  };

  const saveProfile = async () => {
    setProfileBusy(true);
    setProfileErr(false);
    setProfileMsg(null);
    try {
      await updateProfile({ displayName: displayName.trim(), avatarColor, email: email.trim() });
      setProfileMsg("Profile updated.");
    } catch (e) {
      setProfileErr(true);
      setProfileMsg(e instanceof Error ? e.message : "Failed to update profile");
    } finally {
      setProfileBusy(false);
    }
  };

  const savePassword = async () => {
    if (newPw.length < 4) {
      setPwErr(true);
      setPwMsg("New password must be at least 4 characters.");
      return;
    }
    if (newPw !== confirmPw) {
      setPwErr(true);
      setPwMsg("New passwords do not match.");
      return;
    }
    setPwBusy(true);
    setPwErr(false);
    setPwMsg(null);
    try {
      await changePassword(curPw, newPw);
      setCurPw("");
      setNewPw("");
      setConfirmPw("");
      setPwMsg("Password changed.");
    } catch (e) {
      setPwErr(true);
      setPwMsg(e instanceof Error ? e.message : "Failed to change password");
    } finally {
      setPwBusy(false);
    }
  };

  return (
    <section id="account" className="mb-8">
      <SectionHeader icon={<User size={18} />} title="Account" description="Your profile and sign-in credentials." />

      <Card className="mb-4">
        <div className="mb-4 flex items-center gap-4">
          <div
            className="flex h-14 w-14 items-center justify-center rounded-full text-xl font-semibold text-white"
            style={{ background: avatarColor }}
          >
            {(displayName || user?.username || "U").charAt(0).toUpperCase()}
          </div>
          <div>
            <p className="font-medium text-ink">{displayName || "—"}</p>
            <p className="text-sm text-ink-muted">@{user?.username}</p>
            <p className="mt-1 flex items-center gap-1 text-[11px] uppercase tracking-wide text-ink-muted">
              <ShieldCheck size={11} /> {user?.role === "ADMIN" ? "Administrator" : user?.role === "DEMO" ? "Demo" : "User"}
            </p>
          </div>
        </div>

        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          <Field label="Display name">
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className={inputClass}
              placeholder="Your name"
            />
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
              <input
                type="color"
                value={avatarColor}
                onChange={(e) => setAvatarColor(e.target.value)}
                className="h-7 w-7 cursor-pointer rounded-full border border-edge bg-transparent"
              />
            </div>
          </Field>
        </div>

        <Field label="Email (for password reset)">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
            placeholder="you@example.com"
            autoComplete="email"
          />
          <p className="mt-1 text-[11px] text-ink-muted">
            Used only to send password reset links. Leave empty if you don't need self-service reset.
          </p>
        </Field>

        <div className="mt-3 flex items-center gap-2">
          <SaveButton busy={profileBusy} onClick={saveProfile} disabled={!displayName.trim()}>
            Save profile
          </SaveButton>
        </div>
        <MsgBox msg={profileMsg} error={profileErr} />
      </Card>

      <Card>
        <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink">
          <KeyRound size={15} /> Change password
        </h4>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Current password">
            <input
              type="password"
              value={curPw}
              onChange={(e) => setCurPw(e.target.value)}
              className={inputClass}
              autoComplete="current-password"
            />
          </Field>
          <Field label="New password">
            <input
              type="password"
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              className={inputClass}
              autoComplete="new-password"
            />
          </Field>
          <Field label="Confirm new password">
            <input
              type="password"
              value={confirmPw}
              onChange={(e) => setConfirmPw(e.target.value)}
              className={inputClass}
              autoComplete="new-password"
            />
          </Field>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <SaveButton
            busy={pwBusy}
            onClick={savePassword}
            disabled={!curPw || !newPw || !confirmPw}
          >
            Update password
          </SaveButton>
        </div>
        <MsgBox msg={pwMsg} error={pwErr} />
      </Card>

      <TwoFactorSection />

      <Card>
        <div className="mb-3 flex items-center justify-between">
          <h4 className="flex items-center gap-2 text-sm font-semibold text-ink">
            <MonitorSmartphone size={15} /> Active sessions
          </h4>
          {devices.length > 0 && (
            <button
              onClick={revokeAll}
              className="rounded-lg border border-edge px-2.5 py-1 text-xs text-ink-muted hover:bg-red-500 hover:text-white"
            >
              Revoke all
            </button>
          )}
        </div>
        <p className="mb-3 text-xs text-ink-muted">
          Devices where you checked "Remember this device". Revoke to sign them out.
        </p>
        {devicesLoading ? (
          <div className="flex items-center justify-center py-4 text-ink-muted">
            <Loader2 size={16} className="animate-spin" />
          </div>
        ) : devices.length === 0 ? (
          <p className="py-3 text-center text-sm text-ink-muted">No remembered devices.</p>
        ) : (
          <div className="divide-y divide-edge">
            {devices.map((d) => (
              <div key={d.id} className="flex items-center gap-3 py-2.5">
                <MonitorSmartphone size={16} className="shrink-0 text-ink-muted" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-ink">{d.deviceLabel || "Unknown device"}</p>
                  <p className="text-[11px] text-ink-muted">
                    Last used {new Date(d.lastUsedAt).toLocaleString()} · expires{" "}
                    {new Date(d.expiresAt).toLocaleDateString()}
                  </p>
                </div>
                <button
                  onClick={() => revokeDevice(d.id)}
                  className="rounded-md p-1.5 text-ink-muted hover:bg-red-500 hover:text-white"
                  title="Revoke"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
        {deviceErr && <p className="mt-2 text-xs text-red-500">{deviceErr}</p>}
      </Card>
    </section>
  );
}
