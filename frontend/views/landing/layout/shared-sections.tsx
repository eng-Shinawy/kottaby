// ─── Shared landing markup helpers (single source for repeated blocks) ───────

import { Box, Container, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { sectionBadgeLineSx } from "@/frontend/views/landing/utils";

/** Overline badge with a leading rule (optionally a trailing rule) for section headers. */
export function SectionBadge({
  label,
  showTrailingLine = false,
}: Readonly<{ label: ReactNode; showTrailingLine?: boolean }>): ReactNode {
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
      <Box aria-hidden sx={sectionBadgeLineSx} />
      <Typography
        variant="overline"
        sx={{
          fontWeight: 700,
          letterSpacing: "0.12em",
          color: "var(--mui-palette-secondary-main)",
          lineHeight: 1,
        }}
      >
        {label}
      </Typography>
      {showTrailingLine ? <Box aria-hidden sx={sectionBadgeLineSx} /> : null}
    </Stack>
  );
}

// ─── Shared section wrapper ──────────────────────────────────────────

export function SectionWrapper({
  badge,
  title,
  subtitle,
  bg,
  children,
}: Readonly<{
  badge: string;
  title: string;
  subtitle: string;
  bg: "default" | "paper";
  children: ReactNode;
}>): ReactNode {
  return (
    <Box
      component="section"
      sx={{
        position: "relative",
        overflow: "hidden",
        bgcolor: `var(--mui-palette-background-${bg})`,
        py: { xs: 6, md: 10 },
      }}
    >
      <Container maxWidth="lg">
        <Stack spacing={1.5} sx={{ mb: 5, maxWidth: 640 }}>
          <SectionBadge label={badge} />
          {/* Decorative diamond */}
          <Box
            aria-hidden
            sx={{
              width: 6,
              height: 6,
              bgcolor: "var(--mui-palette-secondary-main)",
              transform: "rotate(45deg)",
              mx: "auto",
              my: 0.5,
            }}
          />
          <Typography
            variant="h3"
            sx={{
              fontWeight: 800,
              fontSize: { xs: 26, md: 34 },
              letterSpacing: "-0.02em",
              lineHeight: 1.2,
              m: 0,
              background:
                "linear-gradient(135deg, var(--mui-palette-text-primary) 40%, var(--mui-palette-secondary-main) 100%)",
              backgroundClip: "text",
              WebkitBackgroundClip: "text",
              color: "transparent",
            }}
          >
            {title}
          </Typography>
          <Typography
            variant="body1"
            sx={{ color: "var(--mui-palette-text-secondary)", lineHeight: 1.6, fontSize: 16 }}
          >
            {subtitle}
          </Typography>
        </Stack>
        {children}
      </Container>
    </Box>
  );
}
