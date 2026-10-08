import { useState, useMemo } from "react";
import { Film, Search, Check } from "lucide-react";
import { useSettings, type AnimatedBgId } from "../../../store/settings";
import { ANIMATED_BG_CATALOG, type AnimatedBgMeta } from "../../../shell/AnimatedBackground";
import { SectionHeader } from "../ui";

export default function AnimatedBgSection() {
  const { animatedBg, setAnimatedBg } = useSettings();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>("All");

  const categories = useMemo(() => {
    const cats = new Set(ANIMATED_BG_CATALOG.map((b) => b.category));
    return ["All", ...Array.from(cats).sort()];
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return ANIMATED_BG_CATALOG.filter((b) => {
      if (category !== "All" && b.category !== category) return false;
      if (!q) return true;
      return (
        b.name.toLowerCase().includes(q) ||
        b.description.toLowerCase().includes(q) ||
        b.tags.some((t) => t.includes(q)) ||
        b.category.toLowerCase().includes(q)
      );
    });
  }, [search, category]);

  return (
    <section id="animated-bg" className="mb-8">
      <SectionHeader
        icon={<Film size={18} />}
        title="Animated Background"
        description="Canvas-based animated backgrounds. Runs on top of the static wallpaper."
      />

      <div className="relative mb-3">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search backgrounds by name, tag, or category..."
          className="w-full rounded-lg border border-edge bg-surface-2 py-2 pl-9 pr-3 text-sm text-ink outline-none focus:border-focus"
        />
      </div>

      <div className="mb-4 flex flex-wrap gap-1.5">
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => setCategory(cat)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition ${
              category === cat
                ? "bg-accent text-accent-fg"
                : "bg-surface-2 text-ink-muted hover:bg-surface-3"
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
        {filtered.map((bg) => (
          <AnimatedBgCard
            key={bg.id}
            bg={bg}
            active={animatedBg === bg.id}
            onClick={() => setAnimatedBg(bg.id)}
          />
        ))}
      </div>
      {filtered.length === 0 && (
        <p className="py-6 text-center text-sm text-ink-muted">No backgrounds match "{search}"</p>
      )}
    </section>
  );
}

function AnimatedBgCard({
  bg,
  active,
  onClick,
}: {
  bg: AnimatedBgMeta;
  active: boolean;
  onClick: () => void;
}) {
  const gradient = `linear-gradient(135deg, ${bg.previewColors.join(", ")})`;
  return (
    <button
      onClick={onClick}
      className={`group overflow-hidden rounded-lg border-2 text-left transition ${
        active ? "border-accent" : "border-edge hover:border-ink-muted"
      }`}
    >
      <div className="relative h-16 w-full" style={{ background: gradient }}>
        {active && (
          <div className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-accent text-accent-fg">
            <Check size={12} />
          </div>
        )}
        {bg.id !== "none" && (
          <div className="absolute bottom-1.5 left-1.5 flex items-center gap-1 rounded bg-black/40 px-1.5 py-0.5 text-[9px] text-white">
            <Film size={8} /> animated
          </div>
        )}
      </div>
      <div className="bg-surface-2 px-2 py-1.5">
        <div className="truncate text-xs font-medium text-ink">{bg.name}</div>
        <div className="truncate text-[10px] text-ink-muted">{bg.category}</div>
      </div>
    </button>
  );
}
