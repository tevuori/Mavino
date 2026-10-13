import { Sun, Moon, Palette, Maximize } from "lucide-react";
import { useSettings, type ThemeMode } from "../../../store/settings";
import { SectionHeader } from "../ui";

const ACCENT_PRESETS = [
  "#6366f1", "#8b5cf6", "#ec4899", "#ef4444",
  "#f97316", "#eab308", "#22c55e", "#14b8a6",
  "#06b6d4", "#3b82f6",
];

export default function AppearanceSection() {
  const { theme, setTheme, accent, setAccent, preferFullscreen, setPreferFullscreen } = useSettings();
  return (
    <section id="appearance" className="mb-8">
      <SectionHeader icon={<Palette size={18} />} title="Appearance" description="Customize how Mavino looks." />
      <div className="mb-5">
        <label className="mb-2 block text-sm font-medium text-ink">Theme</label>
        <div className="flex gap-2">
          {(["light", "dark"] as ThemeMode[]).map((t) => (
            <button
              key={t}
              onClick={() => setTheme(t)}
              className={`flex items-center gap-2 rounded-lg border px-4 py-2 text-sm capitalize transition ${
                theme === t
                  ? "border-accent bg-accent/10 text-ink"
                  : "border-edge text-ink-muted hover:bg-surface-2"
              }`}
            >
              {t === "dark" ? <Moon size={15} /> : <Sun size={15} />}
              {t}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="mb-2 block text-sm font-medium text-ink">Accent color</label>
        <div className="flex flex-wrap items-center gap-2">
          {ACCENT_PRESETS.map((c) => (
            <button
              key={c}
              onClick={() => setAccent(c)}
              className={`h-8 w-8 rounded-full border-2 transition ${
                accent === c ? "border-ink ring-2 ring-accent" : "border-transparent"
              }`}
              style={{ background: c }}
              title={c}
            />
          ))}
          <input
            type="color"
            value={accent}
            onChange={(e) => setAccent(e.target.value)}
            className="h-8 w-8 cursor-pointer rounded-full border border-edge bg-transparent"
            title="Custom color"
          />
        </div>
      </div>
      <div className="mt-5">
        <label className="mb-2 flex items-center gap-2 text-sm font-medium text-ink">
          <Maximize size={15} /> Fullscreen
        </label>
        <label className="flex cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={preferFullscreen}
            onChange={(e) => setPreferFullscreen(e.target.checked)}
            className="h-4 w-4 accent-accent"
          />
          <span className="text-sm text-ink-muted">
            Enter fullscreen automatically on the next click or keypress after login
          </span>
        </label>
      </div>
    </section>
  );
}
