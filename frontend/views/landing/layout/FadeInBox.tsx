"use client";

import { Box } from "@mui/material";
import { type ReactNode, useEffect, useRef, useState } from "react";

// ─── Scroll-triggered fade-in hook ───────────────────────────────────

function useFadeInOnScroll() {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    let observer: IntersectionObserver | undefined;
    if (el) {
      observer = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) {
            setVisible(true);
            observer?.unobserve(el);
          }
        },
        { threshold: 0.08 }
      );
      observer.observe(el);
    }
    return () => observer?.disconnect();
  }, []);

  return { ref, visible };
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
  const { ref, visible } = useFadeInOnScroll();
  return (
    <Box
      ref={ref}
      id={id}
      sx={{
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(20px)",
        transition: `all 0.6s cubic-bezier(0.16, 1, 0.3, 1) ${delay}ms`,
        // Anchor targets must clear the sticky navbar (65px) plus the 20px
        // fade-in translateY offset that the anchor-scroll geometry can
        // capture mid-transition (otherwise headings land under the bar).
        scrollMarginTop: 96,
      }}
    >
      {children}
    </Box>
  );
}
