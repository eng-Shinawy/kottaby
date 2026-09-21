"use client";

import { Box, Card, Skeleton, Stack } from "@mui/material";
import type { ReactNode } from "react";

/**
 * The schedule page's loading skeleton — a toolbar row plus the SEVEN day
 * columns at their real layout shape, so the fetch→paint transition never
 * reflows the grid. Marked `aria-busy` with the localized loading label;
 * pure layout (no copy, no interaction).
 */
export function ScheduleLoadingSkeleton({ loadingLabel }: Readonly<{ loadingLabel: string }>): ReactNode {
  return (
    <Box
      component="output"
      aria-busy
      aria-label={loadingLabel}
      sx={{ display: "flex", flexDirection: "column", gap: 2 }}
    >
      <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
        <Skeleton width={180} height={40} />
        <Box sx={{ flex: 1 }} />
        <Skeleton width={96} height={34} />
        <Skeleton width={34} height={34} sx={{ borderRadius: 999 }} />
        <Skeleton width={34} height={34} sx={{ borderRadius: 999 }} />
      </Stack>
      <Box
        sx={{
          display: "grid",
          gap: 1.5,
          gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)", md: "repeat(4, 1fr)", lg: "repeat(7, 1fr)" },
        }}
      >
        {SEVEN.map(index => (
          <Card
            key={index}
            elevation={0}
            sx={theme => ({
              p: 1.5,
              borderRadius: 3,
              border: "1px solid",
              borderColor: theme.palette.outlineVariant,
              display: "flex",
              flexDirection: "column",
              gap: 1,
            })}
          >
            <Skeleton width="60%" height={22} />
            <Skeleton width="40%" height={16} />
            <Skeleton variant="rounded" height={44} />
            <Skeleton variant="rounded" height={44} />
          </Card>
        ))}
      </Box>
    </Box>
  );
}

const SEVEN = [0, 1, 2, 3, 4, 5, 6] as const;
