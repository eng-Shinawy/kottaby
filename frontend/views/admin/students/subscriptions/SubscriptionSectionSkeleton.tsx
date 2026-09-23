"use client";

/**
 * SubscriptionSectionSkeleton — the drawer subscription section's loading
 * state: a skeleton mirroring the settled anatomy (the summary strip's
 * three stat cards + the banner line, the chip row, and two row cards —
 * header glyph + title line, the plan-facts caption, the status/date
 * label-value rows, the action bar, and the audit footer link) so the
 * reveal doesn't relayout. Split from `SubscriptionRowsView` (the
 * 150-line view-file convention).
 */

import { Box, Skeleton, Stack } from "@mui/material";
import type { ReactNode } from "react";

export function SubscriptionSectionSkeleton(): ReactNode {
  return (
    <Stack sx={{ gap: 1.5 }}>
      <Stack sx={{ gap: 1 }}>
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 1 }}>
          {[0, 1, 2].map(index => (
            <Skeleton
              key={`subscription-skeleton-stat-${String(index)}`}
              variant="rounded"
              height={64}
              sx={theme => ({ borderRadius: "12px", border: `1px solid ${theme.palette.border.light}` })}
            />
          ))}
        </Box>
        <Skeleton variant="rounded" height={30} sx={{ borderRadius: "10px" }} />
      </Stack>
      <Skeleton variant="rounded" height={32} sx={{ borderRadius: "10px" }} />
      {[0, 1].map(index => (
        <Box
          key={`subscription-skeleton-${String(index)}`}
          sx={theme => ({
            borderRadius: "12px",
            border: `1px solid ${theme.palette.border.light}`,
            borderInlineStartWidth: 3,
            borderInlineStartStyle: "solid",
            borderInlineStartColor: theme.palette.border.light,
            p: 1.5,
          })}
        >
          <Stack direction="row" sx={{ alignItems: "center", gap: 1, mb: 1 }}>
            <Skeleton variant="rounded" width={34} height={34} sx={{ borderRadius: "10px" }} />
            <Box sx={{ flex: 1 }}>
              <Skeleton variant="text" height={24} width="62%" />
              <Skeleton variant="text" height={18} width="34%" />
            </Box>
          </Stack>
          <Skeleton variant="text" height={18} width="48%" sx={{ mb: 0.75 }} />
          <Skeleton variant="text" height={22} />
          <Skeleton variant="text" height={22} />
          <Skeleton variant="text" height={22} width="72%" />
          <Skeleton variant="rounded" height={32} sx={{ borderRadius: "8px", mt: 1 }} />
          <Skeleton variant="rounded" height={28} sx={{ borderRadius: "8px", mt: 1.5 }} />
        </Box>
      ))}
    </Stack>
  );
}
