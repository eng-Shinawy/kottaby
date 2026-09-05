import { Box } from "@mui/material";
import type { ReactNode } from "react";

/** Full-screen fade flashed for ~300ms when the dark/light mode flips. */
export function ModeFlashOverlay({
  mode,
  modeFlash,
}: Readonly<{ mode: string | undefined; modeFlash: boolean }>): ReactNode {
  return (
    <Box
      aria-hidden
      sx={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        pointerEvents: "none",
        bgcolor: mode === "dark" ? "var(--mui-palette-primary-dark)" : "var(--mui-palette-background-default)",
        opacity: modeFlash ? 1 : 0,
        transition: "opacity 0.3s ease",
      }}
    />
  );
}
