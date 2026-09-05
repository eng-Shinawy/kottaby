"use client";

/**
 * TeacherSessionsLoadingSkeleton — loading shells mirroring the
 * `ApplicantStatusCard` loading skeleton's line rhythm (title text +
 * rounded pill + body panel). Extracted verbatim from
 * `TeacherSessionsContainer` (the max-lines split).
 */

import { Box, Skeleton, Stack } from "@mui/material";
import type { ReactNode } from "react";

/** Skeleton row count — approximates list density without claiming data. */
const LOADING_ROW_COUNT = 3;

/**
 * Stable skeleton keys — module-scope so the loading rows never key off the
 * render-time array index (`noArrayIndexKey`) while keeping one-to-one
 * cardinality with {@link LOADING_ROW_COUNT}.
 */
const LOADING_ROW_KEYS: readonly string[] = Array.from(
  { length: LOADING_ROW_COUNT },
  (_, index) => `skeleton-${index}`
);

/** Loading skeleton — bordered row shells announcing `aria-busy` semantics. */
export function TeacherSessionsLoadingSkeleton(): ReactNode {
  return (
    <Stack aria-busy="true" data-testid="teacher-sessions-loading" sx={{ gap: 2 }}>
      {LOADING_ROW_KEYS.map(key => (
        <Box
          key={key}
          sx={theme => ({
            display: "grid",
            gap: 1.5,
            p: { xs: 2.5, sm: 3 },
            borderRadius: 3,
            border: "1px solid",
            borderColor: theme.palette.outlineVariant,
            bgcolor: theme.palette.surfaceContainerLow,
            boxShadow: theme.palette.shadow.card,
          })}
        >
          <Skeleton variant="text" sx={{ fontSize: "1.5rem", maxWidth: 260 }} />
          <Skeleton variant="rounded" sx={{ height: 24, width: 150, borderRadius: 999 }} />
          <Skeleton variant="rectangular" sx={{ height: 40, borderRadius: 2 }} />
        </Box>
      ))}
    </Stack>
  );
}
