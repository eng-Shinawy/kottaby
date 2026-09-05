/**
 * PlanCatalogSkeleton — Skeleton loading state for the admin plan catalog table.
 *
 * Extracted from PlanCatalogTable (Task 4.3).
 *  - Theme-callback token styling (zero hardcoded hex/strings)
 */

"use client";

import { Paper, Skeleton, Stack } from "@mui/material";

export function PlanCatalogSkeleton(): React.ReactElement {
  return (
    <Paper
      elevation={0}
      sx={theme => ({
        border: 1,
        borderColor: theme.palette.divider,
        borderRadius: 2,
        p: 2,
      })}
    >
      <Stack sx={{ gap: 2 }}>
        {Array.from({ length: 4 }).map((_, idx) => (
          <Skeleton key={`skeleton-row-${String(idx)}`} variant="rectangular" height={52} sx={{ borderRadius: 1 }} />
        ))}
      </Stack>
    </Paper>
  );
}
