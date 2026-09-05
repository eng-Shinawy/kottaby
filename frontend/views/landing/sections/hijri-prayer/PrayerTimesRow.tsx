import { Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import type { HijriPrayerModel } from "@/frontend/views/landing/sections/hijri-prayer/useHijriPrayerModel";
import { Landing, useAppTranslation } from "@/shared/locale";

/** Prayer times row with the "next prayer" highlight + countdown. */
export function PrayerTimesRow({ model }: Readonly<{ model: HijriPrayerModel }>): ReactNode {
  const t = useAppTranslation(Landing);
  return (
    <Stack
      direction="row"
      spacing={0.75}
      sx={{ alignItems: "center", justifyContent: "center", flexWrap: "wrap", rowGap: 0.5 }}
    >
      {model.times.map(p => {
        const isNext = p.key === model.nextKey;
        return (
          <Stack
            key={p.key}
            direction="row"
            spacing={0.75}
            sx={{
              alignItems: "center",
              px: 1.25,
              py: 0.4,
              borderRadius: 99,
              ...(isNext
                ? {
                    bgcolor: "color-mix(in srgb, var(--mui-palette-secondary-main) 22%, transparent)",
                    border: "1px solid var(--mui-palette-secondary-main)",
                  }
                : {}),
            }}
          >
            <Typography
              sx={{
                // ≥12px + raised opacity: the 11.5px @ 0.6 variant failed
                // contrast/readability checks on the dim-label tier.
                fontSize: 12,
                fontWeight: isNext ? 800 : 600,
                color: isNext ? "var(--mui-palette-secondary-light)" : "var(--mui-palette-onPrimary)",
                opacity: isNext ? 1 : 0.85,
              }}
            >
              {p.label}
            </Typography>
            <Typography sx={{ fontSize: 12.5, fontWeight: 700, opacity: isNext ? 1 : 0.9 }}>{p.value}</Typography>
            {isNext && (
              <Typography
                sx={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: "var(--mui-palette-secondary-light)",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 0.25,
                }}
              >
                · {t.prayerIn} {model.countdown}
              </Typography>
            )}
          </Stack>
        );
      })}
    </Stack>
  );
}
