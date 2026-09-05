"use client";

import { Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";

/** A single footer link column with a copper-underscored heading. */
export function FooterColumn({ title, children }: Readonly<{ title: string; children: ReactNode }>): ReactNode {
  return (
    <Stack spacing={1.5}>
      <Typography
        variant="overline"
        sx={{
          fontWeight: 700,
          letterSpacing: "0.1em",
          // On the midnight footer, dimmed theme text can fall below WCAG AA
          // (MUI Link defaults to primary.main — near-invisible on primary.dark).
          // Pin the tint to onPrimary so contrast holds in both color schemes.
          opacity: 0.8,
          lineHeight: 1,
          pb: 0.5,
          borderBottom: "2px solid var(--mui-palette-secondary-main)",
          display: "inline-block",
          width: "fit-content",
        }}
      >
        {title}
      </Typography>
      {children}
    </Stack>
  );
}
