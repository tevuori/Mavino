import { useState } from "react";
import * as Lucide from "lucide-react";
import { Lock } from "lucide-react";
import { useAccessibleApps } from "../store/features";
import { useWindows } from "../store/windows";
import { useSettings, type WallpaperId, type AnimatedBgId } from "../store/settings";
import ContextMenu, { type MenuItem } from "./ContextMenu";
import { RefreshCw, FolderPlus, Image, Trash2, Film } from "lucide-react";

const WALLPAPERS: { id: WallpaperId; name: string }[] = [
  { id: "aurora", name: "Aurora" },
  { id: "sunset", name: "Sunset" },
  { id: "ocean", name: "Ocean" },
  { id: "forest", name: "Forest" },
  { id: "mesh", name: "Mesh" },
  { id: "mono", name: "Mono" },
];

const QUICK_ANIM_BGS: { id: AnimatedBgId; name: string }[] = [
  { id: "none", name: "None (static)" },
  { id: "starfield", name: "Starfield" },
  { id: "particles", name: "Particle Network" },
  { id: "matrix", name: "Matrix Rain" },
  { id: "neon-grid", name: "Neon Grid" },
  { id: "fireflies", name: "Fireflies" },
  { id: "aurora-waves", name: "Aurora Waves" },
  { id: "constellation", name: "Constellation" },
];

export default function Desktop() {
  const { open } = useWindows();
  const apps = useAccessibleApps();
  const { setWallpaper, setAnimatedBg } = useSettings();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [wallpaperSubmenu, setWallpaperSubmenu] = useState(false);
  const [animBgSubmenu, setAnimBgSubmenu] = useState(false);

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY });
    setWallpaperSubmenu(false);
    setAnimBgSubmenu(false);
  };

  const items: MenuItem[] = wallpaperSubmenu
    ? [
        { label: "← Back", keepOpen: true, onClick: () => setWallpaperSubmenu(false) },
        { separator: true },
        ...WALLPAPERS.map((w) => ({
          label: w.name,
          onClick: () => setWallpaper(w.id),
        })),
      ]
    : animBgSubmenu
    ? [
        { label: "← Back", keepOpen: true, onClick: () => setAnimBgSubmenu(false) },
        { separator: true },
        ...QUICK_ANIM_BGS.map((b) => ({
          label: b.name,
          onClick: () => setAnimatedBg(b.id),
        })),
        { separator: true },
        {
          label: "More in Settings...",
          icon: <Lucide.Settings size={15} />,
          onClick: () => open({ appId: "settings", title: "Settings", icon: "Settings" }),
        },
      ]
    : [
        {
          label: "New Folder",
          icon: <FolderPlus size={15} />,
          onClick: () => {
            open({ appId: "files", title: "Files", icon: "Folder" });
          },
        },
        {
          label: "Change Wallpaper",
          icon: <Image size={15} />,
          keepOpen: true,
          onClick: () => setWallpaperSubmenu(true),
        },
        {
          label: "Animated Background",
          icon: <Film size={15} />,
          keepOpen: true,
          onClick: () => setAnimBgSubmenu(true),
        },
        {
          label: "Open Settings",
          icon: <Lucide.Settings size={15} />,
          onClick: () => open({ appId: "settings", title: "Settings", icon: "Settings" }),
        },
        { separator: true },
        {
          label: "Refresh",
          icon: <RefreshCw size={15} />,
          onClick: () => window.location.reload(),
        },
      ];

  return (
    <div
      className="absolute inset-0 bottom-12"
      onContextMenu={onContextMenu}
      onClick={() => menu && setMenu(null)}
    >
      {/* Desktop icons */}
      <div className="absolute left-3 top-3 flex flex-col flex-wrap gap-1" style={{ maxHeight: "calc(100% - 24px)" }}>
        {apps.filter((a) => a.pinnedToDesktop).map((app) => {
          const Icon = (Lucide as unknown as Record<string, React.ComponentType<{ size?: number }>>)[app.icon] ?? Lucide.AppWindow;
          return (
            <button
              key={app.id}
              onDoubleClick={() => open({ appId: app.id, title: app.name, icon: app.icon })}
              onClick={(e) => e.stopPropagation()}
              className="group flex w-20 flex-col items-center gap-1 rounded-lg p-2 text-center transition hover:bg-white/10 focus:bg-accent/20"
            >
              <div className="relative flex h-11 w-11 items-center justify-center rounded-xl bg-white/10 text-white shadow-lg backdrop-blur-sm transition group-hover:scale-105">
                <Icon size={22} />
                {app.access === "preview" && (
                  <span className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-surface text-amber-500 shadow-sm ring-1 ring-white/20">
                    <Lock size={9} />
                  </span>
                )}
              </div>
              <span className="text-xs font-medium text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
                {app.name}
              </span>
            </button>
          );
        })}
      </div>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={items}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}
