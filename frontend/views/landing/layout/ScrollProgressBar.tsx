"use client";

import { Box } from "@mui/material";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { getMaxScrollTop } from "@/frontend/views/landing/utils";

export function ScrollProgressBar(): ReactNode {
  const [progress, setProgress] = useState(0);

  const handleScroll = useCallback(() => {
    const scrollTop = getMaxScrollTop();
    const scrollHeight =
      document.body.scrollHeight > document.documentElement.scrollHeight
        ? document.body.scrollHeight
        : document.documentElement.scrollHeight;
    const clientHeight = document.documentElement.clientHeight;
    const total = scrollHeight - clientHeight;
    const pct = total > 0 ? (scrollTop / total) * 100 : 0;
    setProgress(pct);
  }, []);

  useEffect(() => {
    // Initial read is deferred to a frame: a synchronous setState in the
    // effect body trips react/set-state-in-effect (cascading render).
    const raf = requestAnimationFrame(handleScroll);
    window.addEventListener("scroll", handleScroll, { passive: true, capture: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", handleScroll, { capture: true });
    };
  }, [handleScroll]);

  return (
    <Box
      aria-hidden
      sx={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        height: 3,
        zIndex: 200,
        bgcolor: "var(--mui-palette-background-default)",
      }}
    >
      <Box
        sx={{
          height: "100%",
          width: `${progress}%`,
          bgcolor: "var(--mui-palette-secondary-main)",
          transition: "width 0.1s linear",
        }}
      />
    </Box>
  );
}
