"use client";

import { Box } from "@mui/material";
import { type ReactNode, useMemo } from "react";

// ─── Hero particles ──────────────────────────────────────────────

export function HeroParticles(): ReactNode {
  const particles = useMemo(
    () =>
      Array.from({ length: 25 }, (_, i) => ({
        id: i,
        left: `${(i * 37 + 13) % 100}%`,
        top: `${(i * 53 + 7) % 100}%`,
        // 2px base — a size of 1 would serialize as "100%" in MUI sx
        // (number 1 is treated as a fraction), which rendered full-hero
        // copper circles. Explicit px strings keep the intent unambiguous.
        size: 2 + (i % 3),
        delay: `${(i * 0.7) % 4}s`,
        duration: `${2 + (i % 3)}s`,
      })),
    []
  );

  return (
    <Box
      aria-hidden
      sx={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        zIndex: 0,
      }}
    >
      {particles.map(p => (
        <Box
          key={p.id}
          sx={{
            position: "absolute",
            left: p.left,
            top: p.top,
            width: `${p.size}px`,
            height: `${p.size}px`,
            borderRadius: "50%",
            bgcolor: "var(--mui-palette-secondary-light)",
            animation: `twinkle ${p.duration} ease-in-out ${p.delay} infinite`,
            "@keyframes twinkle": {
              "0%": { opacity: 0 },
              "50%": { opacity: 0.8 },
              "100%": { opacity: 0 },
            },
          }}
        />
      ))}
    </Box>
  );
}
