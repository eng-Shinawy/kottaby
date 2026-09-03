"use client";

import { KeyboardArrowUp } from "@mui/icons-material";
import { Fab, Tooltip } from "@mui/material";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { getMaxScrollTop } from "@/frontend/views/landing/utils";
import { Landing, useAppTranslation } from "@/shared/locale";

export function BackToTopButton(): ReactNode {
  const t = useAppTranslation(Landing);
  const [show, setShow] = useState(false);

  useEffect(() => {
    const onScroll = () => setShow(getMaxScrollTop() > 600);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    return () => window.removeEventListener("scroll", onScroll, { capture: true });
  }, []);

  const scrollToTop = useCallback(() => {
    document.body.scrollTop = 0;
    document.documentElement.scrollTop = 0;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  return (
    <Tooltip title={t.a11yBackToTop} placement="top" arrow>
      <span>
        <Fab
          size="small"
          onClick={scrollToTop}
          aria-label={t.a11yBackToTop}
          sx={{
            position: "fixed",
            bottom: 24,
            insetInlineEnd: 24,
            bgcolor: "var(--mui-palette-secondary-main)",
            color: "var(--mui-palette-onSecondary)",
            zIndex: 50,
            opacity: show ? 1 : 0,
            pointerEvents: show ? "auto" : "none",
            transition: "opacity 0.3s ease",
            boxShadow: "0 4px 14px rgba(184,115,51,0.35)",
            "&:hover": { bgcolor: "var(--mui-palette-secondary-dark)" },
          }}
        >
          <KeyboardArrowUp />
        </Fab>
      </span>
    </Tooltip>
  );
}
