"use client";

/**
 * Presentational parts for the teacher preparation dialog, rendered by
 * `TeacherPrepDialog` (the orchestrator wires the query bundle → the pure
 * helpers → these blocks). The homework-list section lives in the focused
 * sibling `TeacherPrepHomeworkList.tsx` (the sessions folder's max-lines
 * split discipline, like the report cluster's homework-review module).
 *
 * `PrepProgressCard` — the curriculum-position card, or the honest
 * first-session banner when the progress payload carries no pointer.
 * `PrepSectionFrame` — the failure contract every prep section folds
 * through, shared with the homework sibling: the skeleton while the
 * section's read is in flight, the permission-denied fallback for the
 * FORBIDDEN family, the shared retryable notice for the rate-limited /
 * service-unavailable rows, or a retryable alert for everything else —
 * network and uncoded GraphQL errors carry no `extensions.code`, so the
 * query's `error` field is tested directly and the code extraction runs
 * only to recognize the denial and inline-notice families. The frame
 * owns the failure chrome copy
 * (loading label, error body, retry) and pulls its own namespace handles;
 * the generic failure body rides the homework namespace's neutral sentence
 * (this view adds no bespoke error copy). Content labels flow down through
 * the caller's handles like the sibling dialog parts. A settled frame with
 * no section is the skipped state (closed dialog — the chrome is unmounted
 * with it).
 *
 * MUI v9 discipline: `sx`-only styling, theme-palette colors via callbacks,
 * `*Outlined` icons only.
 */

import type { ErrorLike } from "@apollo/client";
import { SchoolOutlined } from "@mui/icons-material";
import { Box, Chip, LinearProgress, Skeleton, Stack, Typography } from "@mui/material";
import type { Theme } from "@mui/material/styles";
import type { ReactNode } from "react";
import { ErrorRetryAlert } from "@/frontend/components/ui/ErrorRetryAlert";
import { IconCircleEmptyState } from "@/frontend/components/ui/IconCircleEmptyState";
import { PermissionDeniedFallback } from "@/frontend/components/ui/PermissionDeniedFallback";
import { RetryableNotice, type RetryableNoticeKind } from "@/frontend/components/ui/RetryableNotice";
import { extractErrorCode } from "@/frontend/lib/graphql-error-utils";
import { type GraphQLErrorAction, mapGraphQLErrorByCode } from "@/frontend/providers/apollo/error-link.map";
import { type PrepProgressSection, secondaryTextSx } from "@/frontend/views/teacher/sessions/teacherPrepDialog.helpers";
import { Common, Errors, Homework, Sessions, useAppTranslation } from "@/shared/locale";
import type { SessionsLabels } from "@/shared/locale/types/sessions";

/** The position line — secondary tone over tabular numerals. */
const positionLineSx = (theme: Theme) => ({ color: theme.palette.text.secondary, fontVariantNumeric: "tabular-nums" });

/** The completion bar — thin, rounded, and quiet so the values stay the focus. */
const completionBarSx = (theme: Theme) => ({
  height: 6,
  borderRadius: 3,
  bgcolor: theme.palette.action.hover,
  flex: 1,
});

/** The final-lesson chip — a primary-container emphasis on the position line. */
const finalLessonChipSx = (theme: Theme) => ({
  alignSelf: "flex-start",
  fontWeight: 600,
  bgcolor: theme.palette.primaryContainer,
  color: theme.palette.onPrimaryContainer,
});

/** True when the query error is the shared-session permission denial — the
 *  FORBIDDEN family mapped to the section fallback in query context. */
function isPermissionDenied(error: ErrorLike): boolean {
  const code = extractErrorCode(error);
  return (
    code !== null &&
    mapGraphQLErrorByCode(code, { contextKind: "query", hasForm: false })?.kind === "permission-fallback"
  );
}

/** The map's retryable inline-notice rows keyed to the shared notice
 *  component's failure categories — rate-limited and service-unavailable
 *  are the only notice kinds that own a manual-retry affordance; the
 *  conflict, not-found, and duplicate-replay notices carry no retry and
 *  stay on the generic alert fold. */
const RETRYABLE_NOTICE_KINDS: Partial<Record<NonNullable<GraphQLErrorAction["noticeKind"]>, RetryableNoticeKind>> = {
  "retry-later": "RATE_LIMITED",
  "retryable-service-unavailable": "SERVICE_UNAVAILABLE",
};

/** The shared retryable-notice category for a coded inline-notice failure,
 *  or `null` when the failure is uncoded or not a retryable notice row. */
function retryableNoticeKind(error: ErrorLike): RetryableNoticeKind | null {
  const code = extractErrorCode(error);
  if (code === null) {
    return null;
  }
  const action = mapGraphQLErrorByCode(code, { contextKind: "query", hasForm: false });
  if (action?.kind !== "notice" || action.noticeKind === undefined) {
    return null;
  }
  return RETRYABLE_NOTICE_KINDS[action.noticeKind] ?? null;
}

/**
 * The failure contract every prep section folds through: denial → the
 * permission fallback (never a bare null), rate-limited or
 * service-unavailable → the shared retryable notice, any other settled
 * failure → a retryable alert (the retry stays disabled while the refetch
 * is pending), in-flight → the skeleton, otherwise the caller's content.
 */
export function PrepSectionFrame({
  loading,
  error,
  onRetry,
  children,
}: Readonly<{
  readonly loading: boolean;
  readonly error: ErrorLike | undefined;
  readonly onRetry: () => void;
  readonly children: ReactNode;
}>): ReactNode {
  const t = useAppTranslation(Sessions);
  const th = useAppTranslation(Homework);
  const te = useAppTranslation(Errors);
  const tc = useAppTranslation(Common);
  if (error !== undefined) {
    if (isPermissionDenied(error)) {
      return <PermissionDeniedFallback />;
    }
    const noticeKind = retryableNoticeKind(error);
    if (noticeKind !== null) {
      return <RetryableNotice kind={noticeKind} onRetry={onRetry} retryInFlight={loading} />;
    }
    return (
      <ErrorRetryAlert title={te.internalServerError} retryLabel={tc.retry} retryPending={loading} onRetry={onRetry}>
        <Typography variant="body2">{th.errorBody}</Typography>
      </ErrorRetryAlert>
    );
  }
  if (loading) {
    return (
      <Box component="output" aria-label={t.prepLoadingLabel} aria-busy="true" sx={{ display: "grid", gap: 1 }}>
        <Skeleton variant="text" sx={{ maxWidth: 200 }} />
        <Skeleton variant="rectangular" sx={{ height: 96, borderRadius: 2 }} />
      </Box>
    );
  }
  return <>{children}</>;
}

/** Props for {@link PrepProgressCard} — content labels ride the caller's
 *  `sessions` handle; failure chrome belongs to the frame. */
interface PrepProgressCardProps {
  /** The resolved progress view model; `null` while the read is skipped. */
  readonly section: PrepProgressSection | null;
  readonly loading: boolean;
  readonly error: ErrorLike | undefined;
  readonly onRetry: () => void;
  readonly t: SessionsLabels;
}

/** The progress section: the honest two-state read — the first-session
 *  banner when the payload carries no pointer, otherwise the positioned
 *  card (current lesson, position of total, completion bar, plan line).
 *  The final lesson upgrades the position line into a completion chip. */
export function PrepProgressCard({ section, loading, error, onRetry, t }: Readonly<PrepProgressCardProps>): ReactNode {
  let content: ReactNode;
  if (section === null) {
    content = null;
  } else if (section.kind === "firstSession") {
    content = (
      <IconCircleEmptyState
        testId="prep-first-session"
        icon={<SchoolOutlined sx={{ fontSize: 36 }} />}
        title={t.prepFirstSessionTitle}
        body={t.prepFirstSessionBody}
      />
    );
  } else {
    const positionLine = t.prepLessonPositionLabel(section.position, section.totalLessons);
    content = (
      <Stack sx={{ gap: 1.5 }} data-testid="prep-progress-card">
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
          {t.prepCurrentLessonLabel}: {section.lessonTitle}
        </Typography>
        {section.isOnFinalLesson ? (
          <Chip size="small" label={positionLine} sx={finalLessonChipSx} />
        ) : (
          <Typography variant="body2" sx={positionLineSx}>
            {positionLine}
          </Typography>
        )}
        <Stack sx={{ flexDirection: "row", alignItems: "center", gap: 1.5 }}>
          <Typography variant="caption" sx={secondaryTextSx}>
            {t.prepCompletionLabel}: {section.completionPercent}%
          </Typography>
          <LinearProgress
            variant="determinate"
            value={section.completionPercent}
            aria-label={t.prepCompletionLabel}
            sx={completionBarSx}
          />
        </Stack>
        {section.planTitle !== null ? (
          <Typography variant="body2" sx={secondaryTextSx}>
            {t.prepPlanLabel}: {section.planTitle}
          </Typography>
        ) : null}
      </Stack>
    );
  }
  return (
    <PrepSectionFrame loading={loading} error={error} onRetry={onRetry}>
      {content}
    </PrepSectionFrame>
  );
}
