"use client";

/**
 * Admin academic-tracking loading surface — the `aria-busy` initial-load
 * skeletons mirroring the populated geometry of the surface they stand in
 * for: the dashboard variant approximates the advancement-statistics card
 * plus the all-students table (header row + rows), the drill-down variant
 * approximates the student header plus the two history sections. A fixed
 * row-count approximation: populated rows vary with the data, skeletons
 * stay constant so nothing jumps on settle.
 *
 * The loading label rides the output region's `aria-label` (announced as
 * busy by assistive tech) — no fabricated copy on screen. MUI v9
 * discipline: `sx`-only styling, theme-palette tokens only.
 */

import { Box, Card, Skeleton, Stack } from "@mui/material";
import type { SxProps, Theme } from "@mui/material/styles";
import type { ReactNode } from "react";

/** Skeleton stat rows inside the dashboard statistics card. */
const SKELETON_STAT_ROWS = 5;

/** Skeleton table rows in the dashboard listing card. */
const SKELETON_LIST_ROWS = 6;

/** Skeleton table rows per drill-down history section. */
const SKELETON_SECTION_ROWS = 4;

/** Shared card shell — mirrors the populated Card geometry. */
const SKELETON_CARD_SX: SxProps<Theme> = theme => ({
  border: `1px solid ${theme.palette.border.light}`,
  borderRadius: "12px",
  boxShadow: theme.palette.shadow.card,
});

/** Shared skeleton-grid tokens — 2 columns on small screens, 4 from `sm` up. */
const STAT_GRID_SX = {
  display: "grid",
  gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)", lg: "repeat(4, 1fr)" },
  gap: 2,
} as const;

function StatCardSkeleton(): ReactNode {
  return (
    <Card sx={SKELETON_CARD_SX}>
      <Stack spacing={2} sx={{ padding: 2.5 }}>
        <Skeleton variant="rounded" height={24} width="60%" />
        {Array.from({ length: SKELETON_STAT_ROWS }, (_unused, rowIndex) => rowIndex + 1).map(rowIndex => (
          <Skeleton key={`stat-skeleton-row-${rowIndex}`} variant="rounded" height={18} />
        ))}
      </Stack>
    </Card>
  );
}

function SectionCardSkeleton({ sectionIndex, rows }: Readonly<{ sectionIndex: number; rows: number }>): ReactNode {
  return (
    <Card sx={SKELETON_CARD_SX}>
      <Stack spacing={2} sx={{ padding: 2.5 }}>
        <Skeleton variant="rounded" height={28} width="40%" />
        {Array.from({ length: rows }, (_unused, rowIndex) => rowIndex + 1).map(rowIndex => (
          <Skeleton key={`section-${sectionIndex}-skeleton-row-${rowIndex}`} variant="rounded" height={20} />
        ))}
      </Stack>
    </Card>
  );
}

type AcademicTrackingLoadingVariant = "dashboard" | "detail";

interface AcademicTrackingLoadingStateProps {
  /** Which populated geometry the skeleton approximates. */
  readonly variant: AcademicTrackingLoadingVariant;
  /** Localized loading copy for the output region's accessible name. */
  readonly loadingLabel: string;
}

/**
 * Initial-load skeleton for either academic-tracking surface, wrapped in
 * the `component="output" aria-busy` region (`frontend/AGENTS.md` — never
 * `role="status"`).
 */
export function AcademicTrackingLoadingState({
  variant,
  loadingLabel,
}: Readonly<AcademicTrackingLoadingStateProps>): ReactNode {
  return (
    <Box component="output" aria-busy aria-label={loadingLabel} sx={{ display: "block", width: "100%" }}>
      {variant === "dashboard" ? (
        <Stack spacing={3}>
          <Box sx={STAT_GRID_SX}>
            <StatCardSkeleton />
            <SectionCardSkeleton sectionIndex={1} rows={SKELETON_SECTION_ROWS} />
          </Box>
          <SectionCardSkeleton sectionIndex={0} rows={SKELETON_LIST_ROWS} />
        </Stack>
      ) : (
        <Stack spacing={3}>
          <Stack spacing={1.5}>
            <Skeleton variant="rounded" height={32} width="55%" />
            <Skeleton variant="rounded" height={20} width="40%" />
          </Stack>
          <SectionCardSkeleton sectionIndex={0} rows={SKELETON_SECTION_ROWS} />
          <SectionCardSkeleton sectionIndex={1} rows={SKELETON_SECTION_ROWS} />
        </Stack>
      )}
    </Box>
  );
}
