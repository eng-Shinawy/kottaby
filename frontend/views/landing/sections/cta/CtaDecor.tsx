import { Box } from "@mui/material";
import type { ReactNode } from "react";

/** Final-CTA backdrop: pattern overlay, copper radial glow, floating shapes. */
export function CtaDecor(): ReactNode {
  return (
    <>
      <Box
        aria-hidden
        sx={{
          position: "absolute",
          inset: 0,
          opacity: 0.06,
          pointerEvents: "none",
          backgroundImage:
            "repeating-linear-gradient(45deg, transparent, transparent 36px, var(--mui-palette-secondary-light) 36px, var(--mui-palette-secondary-light) 38px)",
        }}
      />
      {/* Copper radial glow */}
      <Box
        aria-hidden
        sx={{
          position: "absolute",
          bottom: "-20%",
          insetInlineEnd: "-10%",
          width: "60%",
          height: "80%",
          background: "radial-gradient(circle, var(--mui-palette-secondary-main) 0%, transparent 60%)",
          opacity: 0.12,
          pointerEvents: "none",
        }}
      />
      {/* Floating geometric shapes */}
      <Box
        aria-hidden
        sx={{
          position: "absolute",
          top: "15%",
          insetInlineStart: "8%",
          width: 0,
          height: 0,
          borderLeft: "18px solid transparent",
          borderRight: "18px solid transparent",
          borderBottom: "30px solid var(--mui-palette-secondary-main)",
          opacity: 0.12,
          animation: "ctaFloat1 8s ease-in-out infinite",
          pointerEvents: "none",
          "@keyframes ctaFloat1": {
            "0%, 100%": { transform: "translateY(0) rotate(0deg)" },
            "50%": { transform: "translateY(-16px) rotate(15deg)" },
          },
        }}
      />
      <Box
        aria-hidden
        sx={{
          position: "absolute",
          bottom: "20%",
          insetInlineEnd: "10%",
          width: 40,
          height: 40,
          bgcolor: "transparent",
          border: "2px solid var(--mui-palette-secondary-main)",
          opacity: 0.1,
          clipPath: "polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)",
          animation: "ctaFloat2 10s ease-in-out infinite",
          pointerEvents: "none",
          "@keyframes ctaFloat2": {
            "0%, 100%": { transform: "translateY(0) rotate(0deg)" },
            "50%": { transform: "translateY(-12px) rotate(-20deg)" },
          },
        }}
      />
      <Box
        aria-hidden
        sx={{
          position: "absolute",
          top: "60%",
          insetInlineStart: "15%",
          width: 0,
          height: 0,
          borderLeft: "12px solid transparent",
          borderRight: "12px solid transparent",
          borderBottom: "20px solid var(--mui-palette-secondary-light)",
          opacity: 0.08,
          animation: "ctaFloat3 12s ease-in-out infinite",
          pointerEvents: "none",
          "@keyframes ctaFloat3": {
            "0%, 100%": { transform: "translateY(0) rotate(0deg)" },
            "50%": { transform: "translateY(-10px) rotate(-10deg)" },
          },
        }}
      />
    </>
  );
}
