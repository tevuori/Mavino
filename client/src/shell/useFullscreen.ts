// ===== useFullscreen =====
// Reactive wrapper around the Fullscreen API with vendor-prefix fallback.
// Tracks the live fullscreen state and exposes enter/exit/toggle helpers.
// All helpers silently ignore rejection so callers don't need try/catch.

import { useCallback, useEffect, useState } from "react";

function getFullscreenElement(): Element | null {
  return (
    document.fullscreenElement ??
    (document as any).webkitFullscreenElement ??
    (document as any).mozFullScreenElement ??
    (document as any).msFullscreenElement ??
    null
  );
}

async function requestFullscreen(el: HTMLElement): Promise<void> {
  const fn =
    el.requestFullscreen ??
    (el as any).webkitRequestFullscreen ??
    (el as any).mozRequestFullScreen ??
    (el as any).msRequestFullscreen;
  if (fn) await fn.call(el);
}

async function exitFullscreen(): Promise<void> {
  const fn =
    document.exitFullscreen ??
    (document as any).webkitExitFullscreen ??
    (document as any).mozCancelFullScreen ??
    (document as any).msExitFullscreen;
  if (fn) await fn.call(document);
}

export function useFullscreen() {
  const [isFullscreen, setIsFullscreen] = useState(() => Boolean(getFullscreenElement()));

  useEffect(() => {
    const update = () => setIsFullscreen(Boolean(getFullscreenElement()));
    update();
    document.addEventListener("fullscreenchange", update);
    document.addEventListener("webkitfullscreenchange", update);
    document.addEventListener("mozfullscreenchange", update);
    document.addEventListener("MSFullscreenChange", update);
    return () => {
      document.removeEventListener("fullscreenchange", update);
      document.removeEventListener("webkitfullscreenchange", update);
      document.removeEventListener("mozfullscreenchange", update);
      document.removeEventListener("MSFullscreenChange", update);
    };
  }, []);

  const enterFullscreen = useCallback(async () => {
    if (getFullscreenElement()) return;
    try {
      await requestFullscreen(document.documentElement);
    } catch {
      // Ignore — iframe disallowed, user denied, etc.
    }
  }, []);

  const exitFullscreenFn = useCallback(async () => {
    if (!getFullscreenElement()) return;
    try {
      await exitFullscreen();
    } catch {
      // Ignore.
    }
  }, []);

  const toggleFullscreen = useCallback(async () => {
    if (getFullscreenElement()) {
      await exitFullscreenFn();
    } else {
      await enterFullscreen();
    }
  }, [enterFullscreen, exitFullscreenFn]);

  return {
    isFullscreen,
    enterFullscreen,
    exitFullscreen: exitFullscreenFn,
    toggleFullscreen,
  };
}
