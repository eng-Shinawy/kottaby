import { Box, Container, Stack } from "@mui/material";
import type { ReactNode } from "react";
import { HeroBadges } from "@/frontend/views/landing/sections/hero/HeroBadges";
import { HeroCopy } from "@/frontend/views/landing/sections/hero/HeroCopy";
import { HeroCtas } from "@/frontend/views/landing/sections/hero/HeroCtas";
import { HeroDecor } from "@/frontend/views/landing/sections/hero/HeroDecor";

// ─── Hero ────────────────────────────────────────────────────────────

export function HeroSection(): ReactNode {
  return (
    <Box
      component="section"
      sx={{
        position: "relative",
        overflow: "hidden",
        // In a constrained column-flex ancestor, overflow:hidden makes the
        // flex min-height resolve to 0 and this section can shrink-collapse
        // (observed as a 0px hero under a stale dev graph). Pin it open.
        flexShrink: 0,
        background:
          "linear-gradient(160deg, var(--mui-palette-primary-dark) 0%, var(--mui-palette-primary-main) 50%, var(--mui-palette-primary-dark) 100%)",
        color: "var(--mui-palette-onPrimary)",
      }}
    >
      <HeroDecor />
      <Container maxWidth="lg" sx={{ position: "relative", zIndex: 1, py: { xs: 8, md: 12 } }}>
        <Stack spacing={4} sx={{ alignItems: "flex-start", maxWidth: 760 }}>
          <HeroBadges />
          <HeroCopy />
          <HeroCtas />
        </Stack>
      </Container>
    </Box>
  );
}
