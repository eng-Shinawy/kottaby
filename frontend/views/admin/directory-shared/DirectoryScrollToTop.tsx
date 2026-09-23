"use client";

/**
 * DirectoryScrollToTop — floating "back to top" affordance for the tall
 * admin directory surfaces (students / teachers, whose results stacks grow
 * past one viewport on phones and small laptops).
 *
 * A small fixed FAB at the inline-end bottom corner, revealed through a
 * `Zoom` transition once the page scrolls past ~one viewport (480px) and
 * hidden again near the top (so it never competes with the header band or
 * the toolbar). Tapping smooth-scrolls back to the top — an instant jump
 * when the user prefers reduced motion.
 *
 * The `/admin/users` surface deliberately does NOT mount this component:
 * its own create `Fab` already owns the same corner, and stacking two
 * floating actions would clutter the reveal.
 *
 * Accessibility: the accessible label is a localized string passed by the
 * mounting surface (`labels.scrollBackToTop`), the FAB keeps the standard
 * 44px minimum touch target, and the scroll listener is registered as
 * `passive` so it never blocks the scroll thread.
 */

import { KeyboardArrowUpOutlined as ArrowUpIcon } from "@mui/icons-material";
import { Fab, Zoom } from "@mui/material";
import { type ReactNode, useEffect, useState } from "react";

interface DirectoryScrollToTopProps {
  /** Localized accessible label (the surface's `scrollBackToTop` label). */
  readonly ariaLabel: string;
  /** Scroll depth (px) at which the button reveals itself. */
  readonly revealAt?: number;
}

/**
 * Smooth-scrolls the window back to the top - an instant jump when the user
 * prefers reduced motion. Module scope: it captures nothing from the
 * component render scope (oxlint consistent-function-scoping).
 */
function smoothScrollToTop(): void {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  window.scrollTo({ top: 0, behavior: reducedMotion ? "auto" : "smooth" });
}

export function DirectoryScrollToTop({ ariaLabel, revealAt = 480 }: DirectoryScrollToTopProps): ReactNode {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      setVisible(window.scrollY > revealAt);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [revealAt]);

  return (
    <Zoom in={visible} unmountOnExit>
      <Fab
        size="small"
        color="primary"
        aria-label={ariaLabel}
        title={ariaLabel}
        onClick={smoothScrollToTop}
        sx={theme => ({
          position: "fixed",
          insetInlineEnd: 24,
          bottom: 24,
          zIndex: 900,
          boxShadow: theme.palette.shadow.card,
        })}
      >
        <ArrowUpIcon />
      </Fab>
    </Zoom>
  );
}
