import { Box, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { AnimatedCounter } from "@/frontend/views/landing/layout";

/** One stat cell: pulsing icon, animated counter, label. */
export function StatBlock({
  icon,
  value,
  label,
  inView,
}: Readonly<{ icon: ReactNode; value: string; label: string; inView: boolean }>): ReactNode {
  return (
    <Stack spacing={0.5} sx={{ alignItems: "center", textAlign: "center", flex: 1 }}>
      <Box
        sx={{
          width: 32,
          height: 32,
          borderRadius: "50%",
          bgcolor: "color-mix(in srgb, var(--mui-palette-secondary-main) 15%, transparent)",
          color: "var(--mui-palette-secondary-main)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          mb: 0.5,
          // Icon stays visible even before the in-view trigger fires (the
          // pulse animation is a progressive enhancement only).
          opacity: 1,
          animation: inView ? "statIconPulse 0.6s ease-out" : "none",
          "@keyframes statIconPulse": {
            "0%": { transform: "scale(0.5)", opacity: 0 },
            "60%": { transform: "scale(1.15)", opacity: 1 },
            "100%": { transform: "scale(1)", opacity: 1 },
          },
          "& svg": { fontSize: 18 },
        }}
      >
        {icon}
      </Box>
      <Typography
        sx={{
          fontSize: { xs: 28, md: 36 },
          fontWeight: 800,
          color: "var(--mui-palette-secondary-light)",
          lineHeight: 1,
          textShadow: "0 0 24px rgba(184,115,51,0.3)",
        }}
      >
        <AnimatedCounter raw={value} />
      </Typography>
      <Typography variant="caption" sx={{ opacity: 0.7, textTransform: "none", letterSpacing: "0.02em" }}>
        {label}
      </Typography>
    </Stack>
  );
}
