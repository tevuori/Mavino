import { useEffect, useRef, useState } from "react";
import { useSettings, type WallpaperId } from "../store/settings";
import AnimatedBackground from "./AnimatedBackground";

const GRADIENTS: Record<WallpaperId, string> = {
  aurora: "radial-gradient(at 16% 12%, rgb(14 165 233 / 0.34) 0%, transparent 44%), radial-gradient(at 84% 82%, rgb(245 158 11 / 0.14) 0%, transparent 38%), linear-gradient(145deg, #172734, #203844)",
  sunset: "radial-gradient(at 20% 80%, #f97316 0%, transparent 50%), radial-gradient(at 80% 20%, #ec4899 0%, transparent 50%), linear-gradient(135deg, #1e1b4b, #831843)",
  ocean: "radial-gradient(at 30% 30%, #0ea5e9 0%, transparent 50%), radial-gradient(at 70% 70%, #14b8a6 0%, transparent 50%), linear-gradient(135deg, #0c4a6e, #164e63)",
  forest: "radial-gradient(at 25% 25%, #22c55e 0%, transparent 50%), radial-gradient(at 75% 75%, #15803d 0%, transparent 50%), linear-gradient(135deg, #14532d, #052e16)",
  mesh: "linear-gradient(135deg, #1e293b 0%, #334155 50%, #475569 100%)",
  mono: "linear-gradient(145deg, #182630, #253945)",
};

const NOISE_BG =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'%3E%3Cfilter id='n'%3E%3CfeTurbulence baseFrequency='0.9'/%3E%3C/filter%3E%3Crect width='100' height='100' filter='url(%23n)'/%3E%3C/svg%3E\")";

const FADE_MS = 500;

export default function Wallpaper() {
  const wallpaper = useSettings((s) => s.wallpaper);
  const animatedBg = useSettings((s) => s.animatedBg);
  return (
    <>
      <CrossfadeGradient wallpaper={wallpaper} />
      {/* Animated canvas overlay (renders on top of the gradient, behind everything else) */}
      <AnimatedBackground bgId={animatedBg} />
    </>
  );
}

/** Renders the static gradient with a crossfade when the wallpaper changes. */
function CrossfadeGradient({ wallpaper }: { wallpaper: WallpaperId }) {
  const [layers, setLayers] = useState<{ id: WallpaperId; key: number }[]>([
    { id: wallpaper, key: 0 },
  ]);
  const keyRef = useRef(1);
  const prevId = useRef(wallpaper);

  useEffect(() => {
    if (wallpaper === prevId.current) return;
    const newKey = keyRef.current++;
    prevId.current = wallpaper;
    setLayers((prev) => [...prev, { id: wallpaper, key: newKey }]);
    // Remove old layers after the fade completes
    const t = setTimeout(
      () => setLayers((prev) => prev.filter((l) => l.key === newKey)),
      FADE_MS + 50,
    );
    return () => clearTimeout(t);
  }, [wallpaper]);

  return (
    <>
      {layers.map((layer) => (
        <div
          key={layer.key}
          className="fixed inset-0 -z-10"
          style={{
            background: GRADIENTS[layer.id],
            // Topmost (newest) layer fades in; older layers stay at full opacity
            // until they're removed after the transition.
            animation:
              layer.key === layers[layers.length - 1].key && layers.length > 1
                ? `bgFadeIn ${FADE_MS}ms ease-out`
                : undefined,
          }}
        >
          {/* subtle noise overlay */}
          <div
            className="absolute inset-0 opacity-[0.03]"
            style={{ backgroundImage: NOISE_BG }}
          />
        </div>
      ))}
    </>
  );
}
