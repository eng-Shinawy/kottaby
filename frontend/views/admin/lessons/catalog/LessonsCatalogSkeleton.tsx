/**
 * LessonsCatalogSkeleton — Skeleton loading state for the admin lessons
 * catalog.
 *
 * Clone of the plans-admin `PlanCatalogSkeleton` lineage, translated to
 * lessons. Theme-callback token styling only (zero hardcoded hex/strings).
 */

"use client";

import { Paper, Skeleton, Stack } from "@mui/material";

export function LessonsCatalogSkeleton(): React.ReactElement {
  return (
    <Paper
      elevation={0}
      sx={theme => ({
        border: 1,
        borderColor: theme.palette.divider,
        borderRadius: 2,
        p: 3,
      })}
    >
      <Stack sx={{ gap: 2.5 }}>
        {Array.from({ length: 4 }).map((_, idx) => (
          <Skeleton key={`lessons-skeleton-row-${String(idx)}`} variant="rounded" height={44} />
        ))}
      </Stack>
    </Paper>
  );
}
