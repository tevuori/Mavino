import { useState } from "react";
import { Lock, LogOut, Monitor, Moon, Palette, Sun, Trash2, User } from "lucide-react";
import { useAuth } from "../store/auth";
import { useSettings, type WallpaperId, type AnimatedBgId } from "../store/settings";
import { useFormFactor } from "../store/formfactor";
import { authApi } from "../services/auth";
import type { AuthDevice } from "../services/auth";
import { MobileContainer, MobileHeader, MobileInput, MobileSelect } from "./MobileUi";

const WALLPAPERS: WallpaperId[] = ["aurora", "sunset", "ocean", "forest", "mesh", "mono"];
const ANIMATED: AnimatedBgId[] = [
  "none", "starfield", "particles", "matrix", "aurora-waves", "bubbles", "geometric",
  "fireflies", "rain", "plasma", "constellation", "neon-grid", "bokeh", "snow", "waves",
];

export default function MobileSettings({ onClose }: { onClose?: () => void }) {
  const user = useAuth((s) => s.user);
  const updateProfile = useAuth((s) => s.updateProfile);
  const changePassword = useAuth((s) => s.changePassword);
  const logout = useAuth((s) => s.logout);
  const settings = useSettings();
  const formFactor = useFormFactor();

  const [displayName, setDisplayName] = useState(user?.displayName || "");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [devices, setDevices] = useState<AuthDevice[]>([]);

  const onDisplayName = async () => {
    if (displayName.trim()) await updateProfile({ displayName: displayName.trim() });
  };

  const onPassword = async () => {
    if (current && next) {
      await changePassword(current, next);
      setCurrent(""); setNext("");
    }
  };

  const onDevices = async () => {
    const res = await authApi.listDevices().catch(() => []);
    setDevices(res);
  };

  const revoke = async (id: string) => {
    await authApi.revokeDevice(id).catch(() => {});
    setDevices((d) => d.filter((x) => x.id !== id));
  };

  return (
    <MobileContainer>
      <MobileHeader title="Settings" subtitle="Account & preferences" onClose={onClose} />

      <section className="mb-5 rounded-2xl border border-edge bg-surface-2 p-4">
        <div className="mb-3 flex items-center gap-2">
          <User size={18} className="text-accent" />
          <p className="text-sm font-semibold text-ink">Account</p>
        </div>
        <p className="mb-2 text-xs text-ink-muted">{user?.username} · {user?.role}</p>
        <MobileInput
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          onBlur={() => void onDisplayName()}
          placeholder="Display name"
          className="mb-3"
        />
        <div className="grid grid-cols-2 gap-2">
          <MobileInput value={current} onChange={(e) => setCurrent(e.target.value)} type="password" placeholder="Current" />
          <MobileInput value={next} onChange={(e) => setNext(e.target.value)} type="password" placeholder="New" />
        </div>
        <button
          type="button"
          onClick={() => void onPassword()}
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-surface-2 py-2.5 text-sm text-ink-muted"
        >
          <Lock size={16} /> Change password
        </button>
      </section>

      <section className="mb-5 rounded-2xl border border-edge bg-surface-2 p-4">
        <div className="mb-3 flex items-center gap-2">
          <Palette size={18} className="text-accent" />
          <p className="text-sm font-semibold text-ink">Appearance</p>
        </div>
        <div className="mb-3 flex gap-2">
          <button
            type="button"
            onClick={() => settings.setTheme("light")}
            className={`flex flex-1 items-center justify-center gap-2 rounded-xl py-2 text-sm ${
              settings.theme === "light" ? "bg-accent text-ink" : "bg-surface-2 text-ink-muted"
            }`}
          >
            <Sun size={16} /> Light
          </button>
          <button
            type="button"
            onClick={() => settings.setTheme("dark")}
            className={`flex flex-1 items-center justify-center gap-2 rounded-xl py-2 text-sm ${
              settings.theme === "dark" ? "bg-accent text-ink" : "bg-surface-2 text-ink-muted"
            }`}
          >
            <Moon size={16} /> Dark
          </button>
        </div>
        <label className="mb-1 block text-xs font-medium text-ink-muted">Accent color</label>
        <input
          type="color"
          value={settings.accent}
          onChange={(e) => settings.setAccent(e.target.value)}
          className="mb-3 h-11 w-full rounded-2xl border border-edge bg-surface-2"
        />
        <label className="mb-1 block text-xs font-medium text-ink-muted">Wallpaper</label>
        <MobileSelect value={settings.wallpaper} onChange={(e) => settings.setWallpaper(e.target.value as WallpaperId)} className="mb-3">
          {WALLPAPERS.map((w) => <option key={w} value={w}>{w}</option>)}
        </MobileSelect>
        <label className="mb-1 block text-xs font-medium text-ink-muted">Animated background</label>
        <MobileSelect value={settings.animatedBg} onChange={(e) => settings.setAnimatedBg(e.target.value as AnimatedBgId)}>
          {ANIMATED.map((a) => <option key={a} value={a}>{a}</option>)}
        </MobileSelect>
      </section>

      <section className="mb-5 rounded-2xl border border-edge bg-surface-2 p-4">
        <div className="mb-3 flex items-center gap-2">
          <Monitor size={18} className="text-accent" />
          <p className="text-sm font-semibold text-ink">Mobile</p>
        </div>
        <p className="mb-2 text-xs text-ink-muted">Current mode: <span className="text-ink">{formFactor.mode}</span></p>
        <button
          type="button"
          onClick={() => formFactor.refresh()}
          className="w-full rounded-xl bg-surface-2 py-2.5 text-sm text-ink-muted"
        >
          Refresh form factor
        </button>
      </section>

      <section className="mb-5 rounded-2xl border border-edge bg-surface-2 p-4">
        <div className="mb-3 flex items-center gap-2">
          <Monitor size={18} className="text-accent" />
          <p className="text-sm font-semibold text-ink">Sessions</p>
        </div>
        <button
          type="button"
          onClick={() => void onDevices()}
          className="mb-2 w-full rounded-xl bg-surface-2 py-2.5 text-sm text-ink-muted"
        >
          Load devices
        </button>
        <div className="space-y-2">
          {devices.map((d) => (
            <div key={d.id} className="flex items-center justify-between rounded-xl bg-surface-2 px-3 py-2">
              <span className="text-xs text-ink-muted">{d.deviceLabel}</span>
              <button type="button" onClick={() => void revoke(d.id)} className="rounded-lg p-1 text-ink-muted active:text-rose-400">
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      </section>

      <button
        type="button"
        onClick={() => void logout()}
        className="flex w-full items-center justify-center gap-2 rounded-2xl bg-rose-500/15 py-3 text-sm font-semibold text-rose-300"
      >
        <LogOut size={18} /> Log out
      </button>
    </MobileContainer>
  );
}
