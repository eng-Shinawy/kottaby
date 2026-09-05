"use client";

import { Box, Stack, Typography } from "@mui/material";

/**
 * Small uppercase section label with a copper accent rule. Used to group
 * the form fields into "Account Information" / "Preferences" sections.
 */
export function SectionLabel({ children }: { readonly children: React.ReactNode }) {
  return (
    <Stack
      direction="row"
      spacing={1.5}
      sx={{
        alignItems: "center",
        mb: 2,
      }}
    >
      <Box
        sx={{
          width: 4,
          height: 18,
          borderRadius: 1,
          bgcolor: "var(--mui-palette-secondary-main)",
          flexShrink: 0,
        }}
        aria-hidden
      />
      {/* Latin-tracked overline spacing reads broken on Arabic
          script — collapse tracking to 0 whenever the document lang is ar. */}
      <Typography
        variant="overline"
        sx={{
          fontWeight: 700,
          letterSpacing: "0.12em",
          color: "var(--mui-palette-text-secondary)",
          lineHeight: 1,
          'html[lang="ar"] &': {
            letterSpacing: 0,
          },
        }}
      >
        {children}
      </Typography>
    </Stack>
  );
}
