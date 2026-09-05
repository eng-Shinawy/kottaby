import { Chip, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { Landing, useAppTranslation } from "@/shared/locale";

/** Verse body copy: Arabic text, surah chip, translation, reference, subtitle. */
export function VerseTexts(): ReactNode {
  const t = useAppTranslation(Landing);
  return (
    <>
      {/* Arabic verse text */}
      <Typography
        sx={{
          fontFamily: '"Cairo", sans-serif',
          fontSize: { xs: 32, md: 48 },
          fontWeight: 700,
          direction: "rtl",
          lineHeight: 1.8,
          color: "var(--mui-palette-secondary-light)",
          maxWidth: 700,
        }}
      >
        {t.verseArabic}
      </Typography>

      {/* Surah chip */}
      <Chip
        label={t.verseSurah}
        variant="outlined"
        size="small"
        sx={{
          borderColor: "var(--mui-palette-secondary-main)",
          color: "var(--mui-palette-secondary-light)",
          fontWeight: 600,
          fontSize: 13,
        }}
      />

      {/* Translation */}
      <Typography
        variant="body1"
        sx={{
          fontStyle: "italic",
          maxWidth: 560,
          lineHeight: 1.7,
          opacity: 0.85,
          fontSize: { xs: 16, md: 18 },
        }}
      >
        {t.verseTranslation}
      </Typography>

      {/* Reference */}
      <Typography
        variant="caption"
        sx={{
          opacity: 0.6,
          letterSpacing: "0.02em",
        }}
      >
        {t.verseReference}
      </Typography>

      {/* Subtitle */}
      <Typography
        variant="body2"
        sx={{
          maxWidth: 480,
          lineHeight: 1.6,
          opacity: 0.75,
          mt: -0.5,
        }}
      >
        {t.verseSubtitle}
      </Typography>
    </>
  );
}
