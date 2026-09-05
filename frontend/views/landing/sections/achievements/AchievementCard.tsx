import { Box, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { AnimatedCounter } from "@/frontend/views/landing/layout";

/** One achievement tile: icon, animated value, label. */
export function AchievementCard({
  icon,
  value,
  label,
}: Readonly<{ icon: ReactNode; value: string; label: string }>): ReactNode {
  return (
    <Stack
      spacing={2}
      sx={{
        p: 3,
        borderRadius: 3,
        border: "1px solid color-mix(in srgb, var(--mui-palette-secondary-main) 30%, transparent)",
        bgcolor: "color-mix(in srgb, var(--mui-palette-background-paper) 10%, transparent)",
        backdropFilter: "blur(8px)",
        textAlign: "center",
        alignItems: "center",
        transition: "border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease",
        "&:hover": {
          borderColor: "var(--mui-palette-secondary-main)",
          boxShadow: "0 8px 24px rgba(184,115,51,0.15)",
          transform: "translateY(-4px)",
        },
      }}
    >
      <Box
        sx={{
          width: 52,
          height: 52,
          borderRadius: "50%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          bgcolor: "color-mix(in srgb, var(--mui-palette-secondary-main) 15%, transparent)",
          color: "var(--mui-palette-secondary-light)",
          "& svg": { fontSize: 26 },
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
          textShadow: "0 0 20px rgba(184,115,51,0.3)",
        }}
      >
        <AnimatedCounter raw={value} />
      </Typography>
      <Typography variant="caption" sx={{ opacity: 0.75, textTransform: "none", letterSpacing: "0.02em" }}>
        {label}
      </Typography>
    </Stack>
  );
}
