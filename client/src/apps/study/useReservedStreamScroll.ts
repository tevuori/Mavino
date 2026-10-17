import { useCallback, useEffect, useRef, useState, type UIEvent } from "react";

const BOTTOM_THRESHOLD = 48;
const STAGE_GUTTER = 96;
const MIN_STAGE_HEIGHT = 120;

export function reservedStreamHeight(viewportHeight: number): number {
  if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) return 0;
  return Math.max(MIN_STAGE_HEIGHT, viewportHeight - STAGE_GUTTER);
}

export function distanceFromBottom(scrollHeight: number, scrollTop: number, clientHeight: number): number {
  return Math.max(0, scrollHeight - scrollTop - clientHeight);
}

export function shouldFollowStream(scrollHeight: number, scrollTop: number, clientHeight: number): boolean {
  return distanceFromBottom(scrollHeight, scrollTop, clientHeight) < BOTTOM_THRESHOLD;
}

export function useReservedStreamScroll(streaming: boolean, sessionKey: string | null) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);
  const frameRef = useRef<number | null>(null);
  const targetRef = useRef(0);
  const animatingRef = useRef(false);
  // The scrollTop value our own animation last wrote — used to detect when
  // the position changed WITHOUT us (user dragged the scrollbar, pressed
  // PageUp, etc.), which cancels the follow animation.
  const expectedRef = useRef<number | null>(null);
  const [reserveHeight, setReserveHeight] = useState(0);
  const [reservationActive, setReservationActive] = useState(false);

  const cancelAnimation = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    animatingRef.current = false;
    expectedRef.current = null;
  }, []);

  const scrollToTarget = useCallback((top: number) => {
    const element = scrollRef.current;
    if (!element) return;
    targetRef.current = Math.max(0, top);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) {
      cancelAnimation();
      element.scrollTop = targetRef.current;
      return;
    }
    if (frameRef.current !== null) return;
    animatingRef.current = true;
    const tick = () => {
      const current = scrollRef.current;
      if (!current) {
        cancelAnimation();
        return;
      }
      // Someone other than our animation moved the scroll position (scrollbar
      // drag, keyboard, programmatic scroll) — wheel/touchstart already cover
      // the common cases, but scrollbar drags fire neither, which used to
      // leave the user locked in place while a turn kept streaming.
      if (expectedRef.current !== null && Math.abs(current.scrollTop - expectedRef.current) > 1) {
        cancelAnimation();
        followRef.current = false;
        return;
      }
      const delta = targetRef.current - current.scrollTop;
      if (Math.abs(delta) < 0.5) {
        current.scrollTop = targetRef.current;
        expectedRef.current = targetRef.current;
        frameRef.current = null;
        animatingRef.current = false;
        return;
      }
      current.scrollTop += delta * 0.2;
      expectedRef.current = current.scrollTop;
      frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
  }, [cancelAnimation]);

  const followBottom = useCallback(() => {
    const element = scrollRef.current;
    if (!element || !followRef.current) return;
    scrollToTarget(element.scrollHeight - element.clientHeight);
  }, [scrollToTarget]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const updateHeight = () => setReserveHeight(reservedStreamHeight(element.clientHeight));
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(element);
    return () => observer.disconnect();
  }, [sessionKey]);

  useEffect(() => {
    cancelAnimation();
    followRef.current = true;
    const frame = requestAnimationFrame(() => setReservationActive(false));
    return () => cancelAnimationFrame(frame);
  }, [sessionKey, cancelAnimation]);

  useEffect(() => {
    if (!streaming) return;
    followRef.current = true;
    const frame = requestAnimationFrame(() => {
      setReservationActive(true);
      followBottom();
    });
    return () => cancelAnimationFrame(frame);
  }, [streaming, followBottom]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !streaming) return;
    const observer = new ResizeObserver(followBottom);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [streaming, reservationActive, followBottom]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const interrupt = () => {
      if (!animatingRef.current) return;
      cancelAnimation();
      followRef.current = false;
    };
    element.addEventListener("wheel", interrupt, { passive: true });
    element.addEventListener("touchstart", interrupt, { passive: true });
    element.addEventListener("pointerdown", interrupt, { passive: true });
    return () => {
      element.removeEventListener("wheel", interrupt);
      element.removeEventListener("touchstart", interrupt);
      element.removeEventListener("pointerdown", interrupt);
    };
  }, [cancelAnimation]);

  useEffect(() => cancelAnimation, [cancelAnimation]);

  const onScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    if (animatingRef.current) return;
    const element = event.currentTarget;
    followRef.current = shouldFollowStream(element.scrollHeight, element.scrollTop, element.clientHeight);
  }, []);

  return {
    scrollRef,
    stageRef,
    onScroll,
    reserveHeight,
    reservationActive,
  };
}
