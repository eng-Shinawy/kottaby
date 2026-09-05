import { Box } from "@mui/material";
import type { ReactNode } from "react";

/** Verse section backdrop: geometric pattern + copper radial glow. */
export function VerseDecor(): ReactNode {
  return (
    <>
      {/* Islamic geometric pattern overlay */}
      <Box
        aria-hidden
        sx={{
          position: "absolute",
          inset: 0,
          opacity: 0.05,
          pointerEvents: "none",
          backgroundImage:
            "repeating-linear-gradient(45deg, transparent, transparent 32px, var(--mui-palette-secondary-light) 32px, var(--mui-palette-secondary-light) 34px), repeating-linear-gradient(-45deg, transparent, transparent 32px, var(--mui-palette-secondary-light) 32px, var(--mui-palette-secondary-light) 34px)",
        }}
      />
      {/* Decorative copper radial glow on the left */}
      <Box
        aria-hidden
        sx={{
          position: "absolute",
          top: "-10%",
          insetInlineStart: "-15%",
          width: "50%",
          height: "80%",
          background: "radial-gradient(circle, var(--mui-palette-secondary-main) 0%, transparent 60%)",
          opacity: 0.15,
          pointerEvents: "none",
        }}
      />
    </>
  );
}
