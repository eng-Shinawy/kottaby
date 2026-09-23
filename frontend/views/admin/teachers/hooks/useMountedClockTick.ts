"use client";

/**
 * useMountedClockTick — a hydration-safe "now" tick for clock-dependent UI
 * (the applicant queue's cooling-down chip).
 *
 * Returns `Number.POSITIVE_INFINITY` for the server render AND the first
 * (hydration) client render — deterministic markup, so clock-gated UI never
 * flickers a hydration mismatch — then the real `Date.now()` tick once
 * mounted. The tick is read once and cached for the component's lifetime
 * (it never updates afterwards), matching the mount-once semantics of the
 * effect-based version this replaces.
 *
 * Implemented with `useSyncExternalStore`, the React primitive for
 * client-only values: the store never notifies (the tick is not live), the
 * client snapshot is lazily cached through a ref so repeated getSnapshot
 * calls stay stable (the contract that keeps React from looping), and the
 * server snapshot feeds SSR + hydration.
 */

import { useCallback, useRef, useSyncExternalStore } from "react";

/** The store never notifies — the tick is read once, never updated. */
function subscribe(): () => void {
  return () => {};
}

/** Server + hydration snapshot — "never" (clock-gated UI stays off). */
function getServerSnapshot(): number {
  return Number.POSITIVE_INFINITY;
}

export function useMountedClockTick(): number {
  const tickRef = useRef<number | null>(null);
  const getSnapshot = useCallback(() => {
    // Lazy one-shot cache — getSnapshot may be called several times per
    // render and must return the same value within a pass.
    tickRef.current ??= Date.now();
    return tickRef.current;
  }, []);
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
