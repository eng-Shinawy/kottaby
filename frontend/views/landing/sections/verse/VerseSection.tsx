import { Box, Container, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { SectionBadge } from "@/frontend/views/landing/layout";
import { VerseActions } from "@/frontend/views/landing/sections/verse/VerseActions";
import { VerseDecor } from "@/frontend/views/landing/sections/verse/VerseDecor";
import { VerseTexts } from "@/frontend/views/landing/sections/verse/VerseTexts";
import { Landing, useAppTranslation } from "@/shared/locale";

// ─── Verse of the Day ───────────────────────────────────────────

export function VerseSection(): ReactNode {
  const t = useAppTranslation(Landing);

  return (
    <Box
      id="verse"
      component="section"
      sx={{
        position: "relative",
        overflow: "hidden",
        // Anchor jump must clear the sticky navbar + fade-in offset race.
        scrollMarginTop: 96,
        background:
          "linear-gradient(200deg, var(--mui-palette-primary-dark) 0%, var(--mui-palette-primary-main) 60%, var(--mui-palette-primary-dark) 100%)",
        color: "var(--mui-palette-onPrimary)",
        py: { xs: 8, md: 12 },
      }}
    >
      <VerseDecor />

      <Container maxWidth="lg" sx={{ position: "relative", zIndex: 1 }}>
        <Stack spacing={4} sx={{ alignItems: "center", textAlign: "center" }}>
          {/* Badge */}
          <SectionBadge label={t.verseBadge} showTrailingLine />

          {/* Title */}
          <Typography
            component="h3"
            sx={{
              fontWeight: 800,
              fontSize: { xs: 26, md: 34 },
              letterSpacing: "-0.02em",
              lineHeight: 1.2,
              m: 0,
              color: "var(--mui-palette-onPrimary)",
            }}
          >
            {t.verseTitle}
          </Typography>

          {/* Decorative horizontal line */}
          <Box
            aria-hidden
            sx={{
              width: 60,
              height: 2,
              bgcolor: "var(--mui-palette-secondary-main)",
              borderRadius: 1,
            }}
          />

          <VerseTexts />
          <VerseActions />
        </Stack>
      </Container>
    </Box>
  );
}
