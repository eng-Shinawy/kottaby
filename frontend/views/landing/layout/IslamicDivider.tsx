import { Box } from "@mui/material";
import type { ReactNode } from "react";

/** Spinning diamond ornament used on both sides of the Islamic divider. */
function DividerDiamond(): ReactNode {
  return (
    <Box
      sx={{
        width: 12,
        height: 12,
        transform: "rotate(45deg)",
        bgcolor: "var(--mui-palette-secondary-main)",
        opacity: 0.85,
        mx: 2,
        flexShrink: 0,
        animation: "dividerSpin 12s linear infinite",
        boxShadow: "0 0 10px rgba(184,115,51,0.55)",
        "@keyframes dividerSpin": {
          "0%": { transform: "rotate(45deg)" },
          "100%": { transform: "rotate(405deg)" },
        },
      }}
    />
  );
}

// ─── Islamic decorative divider ───────────────────────────────────

export function IslamicDivider(): ReactNode {
  return (
    <Box
      aria-hidden
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        py: 1,
        px: 4,
      }}
    >
      <Box
        sx={{
          flex: 1,
          height: 1,
          background:
            "linear-gradient(90deg, transparent, color-mix(in srgb, var(--mui-palette-secondary-main) 45%, transparent) 30%, color-mix(in srgb, var(--mui-palette-secondary-main) 45%, transparent) 70%, transparent)",
        }}
      />
      {/* Center diamond ornament */}
      <DividerDiamond />
      <Box
        sx={{
          width: 4,
          height: 4,
          borderRadius: "50%",
          bgcolor: "var(--mui-palette-secondary-main)",
          opacity: 0.45,
          mx: 1,
          flexShrink: 0,
        }}
      />
      <Box
        sx={{
          width: 4,
          height: 4,
          borderRadius: "50%",
          bgcolor: "var(--mui-palette-secondary-main)",
          opacity: 0.45,
          mx: 1,
          flexShrink: 0,
        }}
      />
      <DividerDiamond />
      <Box
        sx={{
          flex: 1,
          height: 1,
          background:
            "linear-gradient(90deg, transparent, color-mix(in srgb, var(--mui-palette-secondary-main) 45%, transparent) 30%, color-mix(in srgb, var(--mui-palette-secondary-main) 45%, transparent) 70%, transparent)",
        }}
      />
    </Box>
  );
}
