"use client";

import { Box } from "@mui/material";
import useMediaQuery from "@mui/material/useMediaQuery";
import { type ReactNode, useEffect, useRef, useState } from "react";

// ─── Scroll-triggered settle-in hook ─────────────────────────────────

/**
 * Reveals a section with a gentle settle motion when it scrolls into view.
 *
 * Resilience contract: the wrapper must NEVER hide content.
 * Full-page captures, crawlers, link-preview bots and no-JS visitors never
 * fire IntersectionObserver-based reveals, which previously left ~90% of the
 * landing page as an invisible void. Therefore:
 *  1. the animated properties are transform-only — no `opacity: 0` initial;
 *  2. a mount-time fallback timer forces the settled state even when the
 *     observer never fires (headless capture, reduced-motion, ancient browsers).
 */
function useSettleInOnScroll() {
  const ref = useRef<HTMLDivElement>(null);
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    const el = ref.current;
    // Fallback: force the final state shortly after mount regardless of
    // viewport intersection so content is always fully visible.
    const fallbackTimer = window.setTimeout(() => setSettled(true), 400);

    let observer: IntersectionObserver | undefined;
    if (el && typeof IntersectionObserver !== "undefined") {
      observer = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) {
            setSettled(true);
            observer?.unobserve(el);
          }
        },
        { threshold: 0.08 }
      );
      observer.observe(el);
    } else {
      setSettled(true);
    }
    return () => {
      window.clearTimeout(fallbackTimer);
      observer?.disconnect();
    };
  }, []);

  return { ref, settled };
}

// ─── FadeInBox wrapper ───────────────────────────────────────────────

export function FadeInBox({
  children,
  id,
  delay = 0,
}: {
  readonly children: ReactNode;
  readonly id?: string;
  readonly delay?: number;
}) {
  const { ref, settled } = useSettleInOnScroll();
  // Honor prefers-reduced-motion: render fully settled with no transition.
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)", { noSsr: true });
  return (
    <Box
      ref={ref}
      id={id}
      sx={{
        // Transform-only entrance: opacity stays 1 at all times so sections
        // are visible before/without any JS-driven reveal.
        transform: settled || reducedMotion ? "translateY(0)" : "translateY(14px)",
        transition: reducedMotion ? "none" : `transform 0.6s cubic-bezier(0.16, 1, 0.3, 1) ${delay}ms`,
        // Anchor targets must clear the sticky navbar (65px) plus the 14px
        // settle-in translateY offset that the anchor-scroll geometry can
        // capture mid-transition (otherwise headings land under the bar).
        scrollMarginTop: 96,
      }}
    >
      {children}
    </Box>
  );
}
