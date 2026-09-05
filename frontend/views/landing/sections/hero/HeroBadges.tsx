import { Box, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { Landing, useAppTranslation } from "@/shared/locale";

/** Live indicator badge + static hero badge rows. */
export function HeroBadges(): ReactNode {
  const t = useAppTranslation(Landing);
  return (
    <>
      {/* Live indicator badge */}
      <Stack
        direction="row"
        spacing={1}
        sx={{
          alignItems: "center",
          px: 2,
          py: 0.75,
          borderRadius: 99,
          border: "1px solid var(--mui-palette-secondary-main)",
          bgcolor: "color-mix(in srgb, var(--mui-palette-secondary-main) 12%, transparent)",
        }}
      >
        <Box
          aria-hidden
          sx={theme => ({
            width: 8,
            height: 8,
            borderRadius: "50%",
            bgcolor: theme.palette.success.main,
            position: "relative",
            "&::after": {
              content: '""',
              position: "absolute",
              inset: -3,
              borderRadius: "50%",
              border: "2px solid",
              borderColor: theme.palette.success.main,
              animation: "livePulse 1.5s ease-in-out infinite",
            },
            "@keyframes livePulse": {
              "0%": { opacity: 0.6, transform: "scale(0.8)" },
              "50%": { opacity: 0, transform: "scale(1.4)" },
              "100%": { opacity: 0, transform: "scale(1.4)" },
            },
          })}
        />
        <Typography variant="caption" sx={{ fontWeight: 600, letterSpacing: "0.04em", textTransform: "none" }}>
          {t.heroLiveLabel}
        </Typography>
      </Stack>

      {/* Badge */}
      <Stack
        direction="row"
        spacing={1}
        sx={{
          alignItems: "center",
          px: 2,
          py: 0.75,
          borderRadius: 99,
          border: "1px solid var(--mui-palette-secondary-main)",
          bgcolor: "color-mix(in srgb, var(--mui-palette-secondary-main) 12%, transparent)",
        }}
      >
        <Box
          aria-hidden
          sx={{ width: 6, height: 6, borderRadius: "50%", bgcolor: "var(--mui-palette-secondary-light)" }}
        />
        <Typography variant="caption" sx={{ fontWeight: 600, letterSpacing: "0.04em", textTransform: "none" }}>
          {t.heroBadge}
        </Typography>
      </Stack>
    </>
  );
}
