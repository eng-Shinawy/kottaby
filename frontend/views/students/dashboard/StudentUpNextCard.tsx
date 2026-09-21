"use client";

import { useQuery } from "@apollo/client/react";
import {
  AssignmentOutlined as AssignmentIcon,
  EventNoteOutlined as EventNoteIcon,
  TaskAltOutlined as TaskAltIcon,
} from "@mui/icons-material";
import { Box, ButtonBase, Divider, Stack, Typography } from "@mui/material";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import {
  type MyStudentSessionsQuery_myStudentSessions_items,
  SessionStatus,
} from "@/frontend/graphql/generated/gql/graphql";
import { myStudentSessionsQueryDocument } from "@/frontend/graphql/sharedDocuments";
import { STUDENT_SESSIONS_ROUTE } from "@/frontend/lib/notification-route-resolution";
import { UpNextErrorCard, UpNextSkeletonCard } from "@/frontend/views/dashboard/home/UpNextCardStates";
import {
  UpNextCardHeading,
  UpNextChevron,
  UpNextRowIcon,
  UpNextSessionsBlock,
} from "@/frontend/views/dashboard/home/UpNextRowChrome";
import { UP_NEXT_WINDOW_SIZE, upNextRowShellSx } from "@/frontend/views/dashboard/home/upNextRowShell";
import { computeHomeworkSummary } from "@/frontend/views/student/homework/homework.helpers";
import { useAllMyHomeworkPages } from "@/frontend/views/student/homework/useAllMyHomeworkPages";
import { CardShell } from "@/frontend/views/students/dashboard/CardShell";
import { Common, UpNext, useAppLocale, useAppTranslation } from "@/shared/locale";
import type { UpNextLabels } from "@/shared/locale/types/upNext";

/** Student homework route — the homework row's link target (nav literal parity). */
const STUDENT_HOMEWORK_ROUTE = "/homework";

/**
 * StudentUpNextCard — the student dashboard's "What's next" card, mounted
 * in the `RoleDashboardPage` student status slot next to the handshake and
 * parent-link cards.
 *
 * Self-contained client component: NO props, NO client-side role logic —
 * the page-level server guards remain the ONLY authorization boundary and
 * the identity-scoped `myStudentSessions` + `myHomework` reads answer
 * identity server-side (zero caller-supplied identity arguments, the SAME
 * documents the sessions/homework surfaces read — the Apollo normalized
 * cache is the single truth, so booking or grading on those surfaces
 * re-renders this card from cache without any bespoke invalidation bus).
 *
 * Content (a DISCOVERABILITY window, never a lifecycle surface):
 *  - Upcoming sessions — the `Scheduled` envelope's first rows (the API
 *    orders by booking recency; the card renders them verbatim with their
 *    booking date and fee — no invented schedule-time semantics). Every
 *    row routes to `/student/sessions`, the surface that owns the
 *    lifecycle CTAs.
 *  - Homework — the honest pending count over the WHOLE fetch-all-pages
 *    history (the shared `computeHomeworkSummary` partition the homework
 *    page itself renders). The row routes to `/homework`; the zero-pending
 *    arm renders "all caught up" (honest zero, never a hidden block).
 *
 * Render branches:
 *
 * | # | Condition | Surface |
 * |---|-----------|---------|
 * | 1 | either query in flight | Skeleton card (`aria-busy` + `role="status"` labelled `loadingLabel`) mirroring the settled geometry (zero layout-shift target) |
 * | 2 | sessions query error | localized inline `Alert` + retry via `refetch` (a homework failure alone degrades SILENTLY — the homework row hides, the sessions block stays) |
 * | 3 | settled | title + upcoming block (rows or honest empty line + sessions CTA) + divider + homework row |
 *
 * MUI v9 discipline: `sx`-only styling, colors exclusively through
 * `theme.palette.*` tokens, `*Outlined` icons only, RTL-safe logical
 * composition (the directional chevron flips with `theme.direction`), and
 * every user-facing string resolved through compile-time i18n handles
 * (`useAppTranslation(UpNext)` property access — NEVER `t('key')`).
 */
export function StudentUpNextCard(): ReactNode {
  const t = useAppTranslation(UpNext);
  const tc = useAppTranslation(Common);
  const locale = useAppLocale();

  const sessions = useQuery(myStudentSessionsQueryDocument, {
    variables: { filter: { status: SessionStatus.Scheduled }, page: 1, pageSize: UP_NEXT_WINDOW_SIZE },
    fetchPolicy: "cache-and-network",
  });
  const homework = useAllMyHomeworkPages();

  // Branch 1 — in flight: skeleton placeholder announces busy semantics.
  if (sessions.loading || homework.loading) {
    return <UpNextSkeletonCard loadingLabel={t.loadingLabel} testId="student-up-next-card-loading" />;
  }

  // Branch 2 — the sessions read settled into a failure: ONE localized
  // inline Alert + retry refetch. The homework read carries no error UI of
  // its own (a homework failure only removes the homework row — silent
  // degradation, the sessions block stays authoritative). The query's
  // `error` field is tested directly — network and uncoded GraphQL errors
  // carry no `extensions.code`, so a code gate would swallow them into a
  // silent empty render.
  if (sessions.error !== undefined) {
    return (
      <UpNextErrorCard
        errorBody={t.errorBody}
        retryLabel={tc.retry}
        testId="student-up-next-card-error"
        onRetry={() => {
          void sessions
            .refetch({ filter: { status: SessionStatus.Scheduled }, page: 1, pageSize: UP_NEXT_WINDOW_SIZE })
            .catch(() => undefined);
        }}
      />
    );
  }

  const scheduledSessions: readonly MyStudentSessionsQuery_myStudentSessions_items[] =
    sessions.data?.myStudentSessions?.items ?? [];
  const totalCount = sessions.data?.myStudentSessions?.totalCount ?? 0;
  const hiddenCount = Math.max(0, totalCount - scheduledSessions.length);
  const homeworkRows = homework.data?.myHomework?.items;
  const pendingCount = homeworkRows === undefined ? undefined : computeHomeworkSummary(homeworkRows).pending;

  // Branch 3 — settled: the glance window.
  return (
    <CardShell testId="student-up-next-card">
      <UpNextCardHeading
        icon={<EventNoteIcon fontSize="small" sx={theme => ({ color: theme.palette.primary.main })} />}
        title={t.upNextTitle}
      />

      {/* Upcoming sessions block */}
      <UpNextSessionsBlock
        labels={t}
        locale={locale}
        sessions={scheduledSessions}
        hiddenCount={hiddenCount}
        emptyLine={t.upcomingEmpty}
        route={STUDENT_SESSIONS_ROUTE}
      />

      <Divider sx={theme => ({ borderColor: theme.palette.outlineVariant })} />

      {/* Homework block — rendered only when the history resolved (a
          homework failure degrades silently; see branch 2). */}
      {pendingCount !== undefined ? <StudentHomeworkRow labels={t} pendingCount={pendingCount} /> : null}
    </CardShell>
  );
}

/**
 * The homework glance row — the honest pending count (or the all-caught-up
 * zero) on a quiet hover-washed line that routes to `/homework`.
 */
function StudentHomeworkRow({
  labels: t,
  pendingCount,
}: Readonly<{ labels: UpNextLabels; pendingCount: number }>): ReactNode {
  const router = useRouter();
  return (
    <Stack spacing={1.5} sx={{ minWidth: 0 }}>
      <Typography
        variant="overline"
        component="h3"
        sx={theme => ({ color: theme.palette.text.secondary, letterSpacing: "0.08em", lineHeight: 1.2 })}
      >
        {t.homeworkHeading}
      </Typography>
      <ButtonBase
        component="button"
        type="button"
        aria-label={pendingCount > 0 ? t.homeworkPendingLine(pendingCount) : t.homeworkAllGraded}
        onClick={() => {
          router.push(STUDENT_HOMEWORK_ROUTE);
        }}
        sx={upNextRowShellSx("outline")}
      >
        <UpNextRowIcon
          tone={pendingCount > 0 ? "primary" : "success"}
          icon={pendingCount > 0 ? <AssignmentIcon fontSize="small" /> : <TaskAltIcon fontSize="small" />}
        />
        <Box sx={{ minWidth: 0, flex: 1, textAlign: "start" }}>
          <Typography
            variant="body2"
            component="p"
            sx={theme => ({ fontWeight: 600, color: theme.palette.text.primary })}
          >
            {pendingCount > 0 ? t.homeworkPendingLine(pendingCount) : t.homeworkAllGraded}
          </Typography>
        </Box>
        <UpNextChevron />
      </ButtonBase>
    </Stack>
  );
}
