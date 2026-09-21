"use client";

import { Card, Skeleton, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import type { ParentChildReportsQuery_parentChildReports_items } from "@/frontend/graphql/generated/gql/graphql";
import { formatApplicantDate } from "@/frontend/lib/i18n/format-date";
import { DeepLinkTargetChip } from "@/frontend/views/parent/monitoring/DeepLinkTargetChip";
import {
  deepLinkRowSx,
  useDeepLinkRowHighlight,
} from "@/frontend/views/parent/monitoring/ParentChildDetailContainer.helpers";
import type { ParentMonitoringLabels } from "@/shared/locale/types/parentMonitoring";

/**
 * Presentational parts of the EvaluationsTab — the skeleton placeholder
 * and the per-row card. Extracted from the stateful tab so the
 * hook-bearing component stays inside the file-size budget
 * (frontend/views/* is capped at 150 lines per `oxlint.config.mts`).
 */

/** Stable skeleton keys (avoids `noArrayIndexKey`). */
const EVALUATIONS_SKELETON_KEYS: readonly string[] = [
  "evaluations-skeleton-1",
  "evaluations-skeleton-2",
  "evaluations-skeleton-3",
];

/** Skeleton placeholder for the initial-load state. */
export function EvaluationsSkeleton(): ReactNode {
  return (
    <Stack aria-busy="true" data-testid="parent-evaluations-loading" sx={{ gap: 2 }}>
      {EVALUATIONS_SKELETON_KEYS.map(key => (
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
          })}
        >
          <Skeleton variant="text" sx={{ fontSize: "1rem", maxWidth: 180 }} />
          <Skeleton variant="text" sx={{ fontSize: "0.875rem", maxWidth: 100 }} />
          <Skeleton variant="rectangular" sx={{ height: 40, borderRadius: 2 }} />
        </Card>
      ))}
    </Stack>
  );
}

/** One evaluation row — date + score + notes (an evaluations-lens view of the report record). */
export function EvaluationRow({
  row,
  labels,
  locale,
  deepLinkSessionId,
}: Readonly<{
  row: ParentChildReportsQuery_parentChildReports_items;
  labels: ParentMonitoringLabels;
  locale: string;
  deepLinkSessionId: number | null;
}>): ReactNode {
  const { rowRef, isDeepLinkTarget } = useDeepLinkRowHighlight(deepLinkSessionId, row.sessionId);
  const dateIso = row.sessionStartedAt ?? row.createdAt;
  const score = row.studentRatingByTeacher;
  const scoreLabel = score === null ? labels.ratingNotRated : `${score}`;
  const notes = row.teacherNotes ?? "";

  return (
    <Card
      ref={rowRef}
      variant="outlined"
      data-testid="parent-evaluations-row"
      aria-current={isDeepLinkTarget ? "true" : undefined}
      sx={deepLinkRowSx(isDeepLinkTarget)}
    >
      {isDeepLinkTarget ? <DeepLinkTargetChip labels={labels} /> : null}
      <Typography variant="body2" dir="auto" sx={theme => ({ color: theme.palette.text.secondary })}>
        {formatApplicantDate(dateIso, locale)}
      </Typography>
      <Typography variant="body2" dir="auto">
        {labels.evaluationsColumnScore}: {scoreLabel}
      </Typography>
      {notes === "" ? null : (
        <Typography variant="body2" dir="auto">
          {labels.evaluationsColumnNotes}: {notes}
        </Typography>
      )}
    </Card>
  );
}
