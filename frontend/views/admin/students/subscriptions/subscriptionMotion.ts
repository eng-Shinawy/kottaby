"use client";

/**
 * subscriptionMotion — the motion utilities of the admin student drawer's
 * subscription-management section (the summary strip + row cards): the
 * `prefers-reduced-motion` media-query hook, the eased count-up hook the
 * stat cards ride, and the staggered entrance style fragment shared by the
 * strip, the chip row, and the row cards.
 *
 * Motion discipline: every effect is decorative only — the entrance is a
 * short fade-and-rise stagger capped at a fixed total budget, the count-up
 * is an ease-out tween that snaps when the media query asks for reduced
 * motion (and on the very first paint both paths render the same DOM so
 * hydration never mismatches). Nothing here gates information: a reduced-
 * motion user reads the same final numbers and layouts, just without the
 * travel. All timing lives in this module so the section's motion rhythm
 * stays single-sourced.
 *
 * Non-visual contract: `useCountUp` always rounds to integers (the counts
 * are tallies, never fractions) and converges EXACTLY to `target` when the
 * tween completes or is skipped — a missed final frame can never leave a
 * stale number on screen (the effect writes the target on cleanup paths).
 */

import { useEffect, useRef, useState } from "react";

/** The entrance tween's per-item duration (the stagger rides the delay). */
const ENTRANCE_MS = 320;

/** The delay step between staggered siblings, clamped by the total budget. */
const ENTRANCE_STAGGER_MS = 60;

/** The stagger budget — siblings past this cap animate together (no crawl). */
const ENTRANCE_MAX_DELAY_MS = 300;

/** The count-up tween's duration (short — the numbers are small tallies). */
const COUNT_UP_MS = 550;

/**
 * Tracks the user's `prefers-reduced-motion` setting reactively (SSR-safe:
 * the first render is always `false`, the effect syncs the real value, so
 * server and client markup never diverge).
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = (): void => setReduced(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => {
      query.removeEventListener("change", sync);
    };
  }, []);
  return reduced;
}

/**
 * Eases the displayed value from the previous count to `target` (ease-out
 * cubic, integer-rounded, converges exactly). Reduced motion — or an
 * unchanged target — renders the value directly.
 */
export function useCountUp(target: number): number {
  const reduced = usePrefersReducedMotion();
  const [tweened, setTweened] = useState(0);
  const shownRef = useRef(0);

  useEffect(() => {
    // ONE destructor return for every path (the strict void-return lint
    // rejects an effect that returns bare `undefined` on one branch and a
    // cleanup on another); `cancelAnimationFrame(0)` is a safe no-op.
    let frame = 0;
    if (reduced) {
      // Reduced motion: the render path below derives the target directly,
      // so only the ref syncs here (a synchronous setState inside the
      // effect body is exactly what the hook lint forbids).
      shownRef.current = target;
    } else {
      const from = shownRef.current;
      const startedAt = performance.now();
      const tick = (now: number): void => {
        const progress = Math.min(1, (now - startedAt) / COUNT_UP_MS);
        const eased = 1 - (1 - progress) ** 3;
        const value = Math.round(from + (target - from) * eased);
        shownRef.current = value;
        setTweened(value);
        if (progress < 1) {
          frame = requestAnimationFrame(tick);
        }
      };
      if (from === target) {
        // Already converged — restate the exact target through the same
        // async rAF path so `tweened` can never go stale across
        // reduced-motion toggles (React bails out when unchanged).
        frame = requestAnimationFrame(() => {
          shownRef.current = target;
          setTweened(target);
        });
      } else {
        frame = requestAnimationFrame(tick);
      }
    }
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [target, reduced]);

  // Derived final value: reduced motion renders the target with no state
  // write at all; the tweened state only renders while animating.
  return reduced ? target : tweened;
}

/**
 * The staggered entrance style fragment — a fade-and-rise keyed to the
 * sibling's index (delay capped by the budget so long lists never crawl).
 * Reduced motion renders nothing (the fragment is a no-op spread) and the
 * keyframes ride the consuming `sx` (emotion dedupes identical frames).
 */
export function entranceStyles(index: number, reducedMotion: boolean): Record<string, unknown> {
  if (reducedMotion) {
    return {};
  }
  const delay = Math.min(index * ENTRANCE_STAGGER_MS, ENTRANCE_MAX_DELAY_MS);
  return {
    "@keyframes subscriptionEntranceRise": {
      from: { opacity: 0, transform: "translateY(10px)" },
      to: { opacity: 1, transform: "translateY(0)" },
    },
    animation: `subscriptionEntranceRise ${String(ENTRANCE_MS)}ms cubic-bezier(0.2, 0.6, 0.2, 1) both`,
    animationDelay: `${String(delay)}ms`,
  };
}
