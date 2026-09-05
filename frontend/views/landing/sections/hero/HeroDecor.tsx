import { Box } from "@mui/material";
import type { ReactNode } from "react";
import { HeroParticles } from "@/frontend/views/landing/sections/hero/HeroParticles";

/** Decorative hero backdrop: particles, tessellation overlay, radial glow, floating circles. */
export function HeroDecor(): ReactNode {
  return (
    <>
      <HeroParticles />
      {/* Islamic geometric tessellation overlay */}
      <Box
        aria-hidden
        sx={{
          position: "absolute",
          inset: 0,
          opacity: 0.06,
          pointerEvents: "none",
          backgroundImage:
            "repeating-linear-gradient(45deg, transparent, transparent 32px, var(--mui-palette-secondary-light) 32px, var(--mui-palette-secondary-light) 34px), repeating-linear-gradient(-45deg, transparent, transparent 32px, var(--mui-palette-secondary-light) 32px, var(--mui-palette-secondary-light) 34px)",
        }}
      />
      {/* Copper radial glow top-right */}
      <Box
        aria-hidden
        sx={{
          position: "absolute",
          top: "-15%",
          insetInlineEnd: "-10%",
          width: "55%",
          height: "70%",
          background: "radial-gradient(circle, var(--mui-palette-secondary-main) 0%, transparent 65%)",
          opacity: 0.18,
          pointerEvents: "none",
        }}
      />

      {/* Floating decorative circles */}
      <Box
        aria-hidden
        sx={{
          position: "absolute",
          top: "12%",
          insetInlineEnd: "8%",
          width: 180,
          height: 180,
          borderRadius: "50%",
          border: "2px solid var(--mui-palette-secondary-main)",
          opacity: 0.12,
          pointerEvents: "none",
        }}
      />
      <Box
        aria-hidden
        sx={{
          position: "absolute",
          bottom: "18%",
          insetInlineStart: "5%",
          width: 100,
          height: 100,
          borderRadius: "50%",
          bgcolor: "var(--mui-palette-secondary-main)",
          opacity: 0.07,
          pointerEvents: "none",
        }}
      />
      <Box
        aria-hidden
        sx={{
          position: "absolute",
          top: "55%",
          insetInlineEnd: "22%",
          width: 60,
          height: 60,
          borderRadius: "50%",
          border: "1.5px solid var(--mui-palette-secondary-light)",
          opacity: 0.1,
          pointerEvents: "none",
        }}
      />
      <Box
        aria-hidden
        sx={{
          position: "absolute",
          bottom: "10%",
          insetInlineEnd: "40%",
          width: 40,
          height: 40,
          borderRadius: "50%",
          bgcolor: "var(--mui-palette-secondary-light)",
          opacity: 0.08,
          pointerEvents: "none",
        }}
      />
    </>
  );
}
