import { useCallback, useRef, useState } from "react";

/**
 * Reusable pull-to-refresh hook for mobile list screens.
 *
 * Usage:
 *   const { pullDist, refreshing, containerRef, touchHandlers, pullIndicatorStyle } = usePullToRefresh(refresh);
 *   <div ref={containerRef} {...touchHandlers}>
 *     <div style={pullIndicatorStyle} /> // spinner area
 *     ...content
 *   </div>
 */
export function usePullToRefresh(onRefresh: () => Promise<void>) {
  const startYRef = useRef<number | null>(null);
  const [pullDist, setPullDist] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const doRefresh = useCallback(async () => {
    setRefreshing(true);
    await onRefresh();
    setRefreshing(false);
  }, [onRefresh]);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if ((containerRef.current?.scrollTop ?? 0) <= 0) {
      startYRef.current = e.touches[0].clientY;
    } else {
      startYRef.current = null;
    }
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (startYRef.current === null) return;
    const dist = e.touches[0].clientY - startYRef.current;
    if (dist > 0) setPullDist(Math.min(dist * 0.5, 64));
  }, []);

  const onTouchEnd = useCallback(() => {
    if (pullDist > 48) void doRefresh();
    setPullDist(0);
    startYRef.current = null;
  }, [pullDist, doRefresh]);

  return {
    pullDist,
    refreshing,
    containerRef,
    touchHandlers: { onTouchStart, onTouchMove, onTouchEnd },
    pullIndicatorStyle: { height: pullDist } as React.CSSProperties,
  };
}
