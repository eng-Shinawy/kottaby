"use client";

import { Box, Card, Skeleton, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import type { ParentChildProgressQuery_parentChildProgress_latestJadidPosition } from "@/frontend/graphql/generated/gql/graphql";
import { formatSurahJuzRef } from "@/frontend/views/parent/monitoring/parentMonitoringDisplay";

const PROGRESS_SKELETON_KEYS: readonly string[] = ["progress-skeleton-jadid", "progress-skeleton-madi"];

export function ProgressSkeleton(): ReactNode {
  return (
    <Stack aria-busy="true" data-testid="parent-progress-loading" sx={{ gap: 2 }}>
      {PROGRESS_SKELETON_KEYS.map(key => (
        <Card
          key={key}
          variant="outlined"
          sx={theme => ({
            display: "flex",
            flexDirection: "column",
            gap: 1,
            padding: 2,
            borderRadius: 2,
            borderColor: theme.palette.border.main,
            borderInlineStart: 4,
            borderInlineStartColor: theme.palette.divider,
          })}
        >
          <Skeleton variant="text" sx={{ fontSize: "1rem", maxWidth: 160 }} />
          <Skeleton variant="rectangular" sx={{ height: 56, borderRadius: 2 }} />
        </Card>
      ))}
    </Stack>
  );
}

export function ProgressPositionBlock({
  position,
  trackLabel,
  noneLabel,
  ayahRangeLabel,
  icon,
  accentColor,
}: Readonly<{
  position: ParentChildProgressQuery_parentChildProgress_latestJadidPosition | null;
  trackLabel: string;
  noneLabel: string;
  ayahRangeLabel: string;
  icon: ReactNode;
  accentColor: string;
}>): ReactNode {
  return (
    <Card
      variant="outlined"
      sx={theme => ({
        display: "flex",
        flexDirection: "column",
        gap: 1.5,
        padding: { xs: 2, sm: 2.5 },
        borderRadius: 2,
        borderColor: theme.palette.border.main,
        borderInlineStart: 4,
        borderInlineStartColor: accentColor,
        transition: theme.transitions.create(["box-shadow", "border-color"], {
          duration: theme.transitions.duration.shorter,
        }),
        "&:hover": { boxShadow: theme.shadows[3] },
      })}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        {icon}
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
          {trackLabel}
        </Typography>
      </Box>
      {position === null ? (
        <Typography variant="body2" sx={theme => ({ color: theme.palette.text.secondary })}>
          {noneLabel}
        </Typography>
      ) : (
        <ProgressPositionRun position={position} ayahRangeLabel={ayahRangeLabel} />
      )}
    </Card>
  );
}

function ProgressPositionRun({
  position,
  ayahRangeLabel,
}: Readonly<{
  position: ParentChildProgressQuery_parentChildProgress_latestJadidPosition;
  ayahRangeLabel: string;
}>): ReactNode {
  const surahJuz = formatSurahJuzRef(position.surahJuz);
  const fromAyah = position.fromAyah ?? "—";
  const toAyah = position.toAyah ?? "—";
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
      <Typography variant="body2" dir="auto" sx={{ fontWeight: 600 }}>
        {surahJuz}
      </Typography>
      <Typography variant="body2" dir="auto" sx={theme => ({ color: theme.palette.text.secondary })}>
        {ayahRangeLabel} {fromAyah} – {toAyah}
      </Typography>
    </Box>
  );
}
