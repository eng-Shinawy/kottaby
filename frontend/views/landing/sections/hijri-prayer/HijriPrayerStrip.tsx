import { NightsStayOutlined as CrescentIcon } from "@mui/icons-material";
import { Box, CircularProgress, Container, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { PrayerTimesRow } from "@/frontend/views/landing/sections/hijri-prayer/PrayerTimesRow";
import { useHijriPrayerModel } from "@/frontend/views/landing/sections/hijri-prayer/useHijriPrayerModel";
import { Landing, useAppTranslation } from "@/shared/locale";

// ─── Hijri date & prayer times strip (Cairo) ─────────────────────────

export function HijriPrayerStrip(): ReactNode {
  const t = useAppTranslation(Landing);
  const model = useHijriPrayerModel();

  return (
    <Box
      component="section"
      aria-label={t.hijriStripAriaLabel}
      sx={{
        borderBottom: "1px solid var(--mui-palette-divider)",
        bgcolor: "color-mix(in srgb, var(--mui-palette-primary-main) 14%, transparent)",
        minHeight: { xs: 56, md: 52 },
        display: "flex",
        alignItems: "center",
      }}
    >
      <Container maxWidth="lg">
        {model === null ? (
          <Stack direction="row" sx={{ alignItems: "center", justifyContent: "center", py: 1, opacity: 0.4 }}>
            <CircularProgress size={16} thickness={5} aria-hidden />
          </Stack>
        ) : (
          <Stack
            direction={{ xs: "column", md: "row" }}
            spacing={{ xs: 0.75, md: 2 }}
            sx={{ alignItems: { md: "center" }, justifyContent: { md: "space-between" }, py: 0.75 }}
          >
            {/* Hijri date chip */}
            <Stack direction="row" spacing={1} sx={{ alignItems: "center", justifyContent: "center" }}>
              <Box
                aria-hidden
                sx={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 26,
                  height: 26,
                  borderRadius: "50%",
                  bgcolor: "color-mix(in srgb, var(--mui-palette-secondary-main) 18%, transparent)",
                  color: "var(--mui-palette-secondary-light)",
                }}
              >
                <CrescentIcon sx={{ fontSize: 15 }} />
              </Box>
              <Typography sx={{ fontSize: 12.5, opacity: 0.85, fontWeight: 600 }}>{t.hijriToday}</Typography>
              <Typography sx={{ fontSize: 13, fontWeight: 700, color: "var(--mui-palette-onPrimary)" }}>
                {model.hijri}
              </Typography>
            </Stack>

            <PrayerTimesRow model={model} />
          </Stack>
        )}
      </Container>
    </Box>
  );
}
