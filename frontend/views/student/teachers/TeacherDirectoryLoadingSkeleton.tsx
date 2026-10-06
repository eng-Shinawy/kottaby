"use client";

/**
 * TeacherDirectoryLoadingSkeleton — the loading branch of the student
 * teacher directory: six card-shaped skeleton placeholders laid out in
 * the SAME responsive grid as {@link TeacherDirectoryGrid} (1 / 2 / 3
 * columns), each mirroring the loaded card anatomy block for block
 * (avatar circle + name lines, the rating row, and two chip-row bands).
 * The region announces itself politely through `Paper component="output"`
 * + `aria-busy` (the MUI v9 aria-live pattern; oxlint
 * `prefer-tag-over-role` — never `role="status"`).
 *
 * The cards fade-rise in with a subtle per-index stagger (embedded
 * `@keyframes` + `animationDelay`, the MUI v9 sx pattern) — and the
 * animation collapses entirely under `prefers-reduced-motion` (the repo's
 * reduced-motion discipline).
 */

import { Box, Paper, Skeleton, Stack, useMediaQuery } from "@mui/material";
import type { ReactElement } from "react";

/** Stable keys for the six placeholder cards (never keyed off render order). */
const SKELETON_KEYS: readonly string[] = [
  "teacher-card-a",
  "teacher-card-b",
  "teacher-card-c",
  "teacher-card-d",
  "teacher-card-e",
  "teacher-card-f",
];

/** The per-card stagger step (ms) — perceptible, never showy. */
const STAGGER_STEP_MS = 60;

/** One card-shaped skeleton mirroring the loaded TeacherDirectoryCard anatomy. */
function TeacherCardSkeleton(): ReactElement {
  return (
    <Box
      sx={theme => ({
        display: "flex",
        flexDirection: "column",
        gap: 1.5,
        p: 2.5,
        border: "1px solid",
        borderColor: theme.palette.border.light,
        borderRadius: 3,
        bgcolor: theme.palette.background.paper,
      })}
    >
      <Stack sx={{ flexDirection: "row", alignItems: "center", gap: 1.5 }}>
        <Skeleton variant="circular" width={48} height={48} />
        <Stack sx={{ gap: 1, flexGrow: 1 }}>
          <Skeleton variant="text" height={24} width="55%" />
          <Skeleton variant="text" height={16} width="35%" />
        </Stack>
      </Stack>
      <Skeleton variant="text" height={16} width="20%" />
      <Skeleton variant="rounded" height={24} width="70%" />
      <Skeleton variant="rounded" height={24} width="45%" />
      <Skeleton variant="rounded" height={40} width="100%" />
    </Box>
  );
}

/** The six-card skeleton grid shown while the browse query is in flight. */
export function TeacherDirectoryLoadingSkeleton(): ReactElement {
  const prefersReducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)", { noSsr: true });
  return (
    <Paper
      component="output"
      data-testid="student-teachers-skeleton"
      aria-busy="true"
      elevation={0}
      sx={{
        display: "grid",
        gap: 2.5,
        gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)", lg: "repeat(3, 1fr)" },
        alignItems: "stretch",
        alignContent: "start",
        "@keyframes studentTeachersSkeletonIn": {
          from: { opacity: 0, transform: "translateY(8px)" },
          to: { opacity: 1, transform: "translateY(0)" },
        },
      }}
    >
      {SKELETON_KEYS.map((key, index) => (
        <Box
          key={key}
          sx={
            prefersReducedMotion
              ? undefined
              : {
                  animation: "studentTeachersSkeletonIn 500ms ease both",
                  animationDelay: `${index * STAGGER_STEP_MS}ms`,
                }
          }
        >
          <TeacherCardSkeleton />
        </Box>
      ))}
    </Paper>
  );
}
