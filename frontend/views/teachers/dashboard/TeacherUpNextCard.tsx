"use client";

import { useQuery } from "@apollo/client/react";
import { CalendarMonthOutlined as CalendarIcon } from "@mui/icons-material";
import type { ReactNode } from "react";
import {
  type MyTeacherSessionsQuery_myTeacherSessions_items,
  SessionStatus,
} from "@/frontend/graphql/generated/gql/graphql";
import { myTeacherSessionsQueryDocument } from "@/frontend/graphql/sharedDocuments";
import { TEACHER_SESSIONS_ROUTE } from "@/frontend/lib/notification-route-resolution";
import { UpNextErrorCard, UpNextSkeletonCard } from "@/frontend/views/dashboard/home/UpNextCardStates";
import { UpNextCardHeading, UpNextSessionsBlock } from "@/frontend/views/dashboard/home/UpNextRowChrome";
import { UP_NEXT_WINDOW_SIZE } from "@/frontend/views/dashboard/home/upNextRowShell";
import { CardShell } from "@/frontend/views/students/dashboard/CardShell";
import { Common, UpNext, useAppLocale, useAppTranslation } from "@/shared/locale";

/**
 * TeacherUpNextCard — the teacher dashboard's "What's next" card, mounted
 * in the `RoleDashboardPage` teacher status slot under the applicant
 * status card.
 *
 * Self-contained client component: NO props, NO client-side role logic —
 * the page-level server guards remain the ONLY authorization boundary and
 * the identity-scoped `myTeacherSessions` read answers identity
 * server-side (zero caller-supplied identity arguments, the SAME document
 * the teacher sessions surface reads — the Apollo normalized cache is the
 * single truth, so lifecycle moves on the sessions surface re-render this
 * card from cache without any bespoke invalidation bus).
 *
 * Content (a DISCOVERABILITY window, never a lifecycle surface):
 *  - Upcoming sessions — the `Scheduled` envelope's first rows (the API
 *    orders by booking recency; the card renders them verbatim with their
 *    booking date and the session fee — no invented schedule-time
 *    semantics, no earnings arithmetic). Every row routes to
 *    `/teacher/sessions`, the surface that owns the start/complete/cancel
 *    CTAs. Teacher applicants get the honest empty arm (the API answers
 *    an empty page, never an error).
 *  - Scheduled tail — when the envelope's `totalCount` exceeds the glance
 *    window, one quiet summary row renders the honest remainder
 *    (localized plural) and hops to `/teacher/sessions`. Hidden when the
 *    window already shows everything.
 *
 * Render branches:
 *
 * | # | Condition | Surface |
 * |---|-----------|---------|
 * | 1 | query in flight | Skeleton card (`aria-busy` + `role="status"` labelled `loadingLabel`) mirroring the settled geometry (zero layout-shift target) |
 * | 2 | query error | localized inline `Alert` + retry via `refetch` |
 * | 3 | settled | title + upcoming block (rows, or honest empty line + sessions CTA) + optional scheduled-tail row |
 *
 * MUI v9 discipline: `sx`-only styling, colors exclusively through
 * `theme.palette.*` tokens, `*Outlined` icons only, RTL-safe logical
 * composition (the directional chevron flips with `theme.direction`), and
 * every user-facing string resolved through compile-time i18n handles
 * (`useAppTranslation(UpNext)` property access — NEVER `t('key')`).
 */
export function TeacherUpNextCard(): ReactNode {
  const t = useAppTranslation(UpNext);
  const tc = useAppTranslation(Common);
  const locale = useAppLocale();

  const sessions = useQuery(myTeacherSessionsQueryDocument, {
    variables: { filter: { status: SessionStatus.Scheduled }, page: 1, pageSize: UP_NEXT_WINDOW_SIZE },
    fetchPolicy: "cache-and-network",
  });

  // Branch 1 — in flight: skeleton placeholder announces busy semantics.
  if (sessions.loading) {
    return <UpNextSkeletonCard loadingLabel={t.loadingLabel} testId="teacher-up-next-card-loading" />;
  }

  // Branch 2 — the read settled into a failure: ONE localized inline Alert
  // + retry refetch. The query's `error` field is tested directly — network
  // and uncoded GraphQL errors carry no `extensions.code`, so a code gate
  // would swallow them into a silent empty render.
  if (sessions.error !== undefined) {
    return (
      <UpNextErrorCard
        errorBody={t.errorBody}
        retryLabel={tc.retry}
        testId="teacher-up-next-card-error"
        onRetry={() => {
          void sessions
            .refetch({ filter: { status: SessionStatus.Scheduled }, page: 1, pageSize: UP_NEXT_WINDOW_SIZE })
            .catch(() => undefined);
        }}
      />
    );
  }

  const scheduledSessions: readonly MyTeacherSessionsQuery_myTeacherSessions_items[] =
    sessions.data?.myTeacherSessions?.items ?? [];
  const totalCount = sessions.data?.myTeacherSessions?.totalCount ?? 0;
  const hiddenCount = Math.max(0, totalCount - scheduledSessions.length);

  // Branch 3 — settled: the glance window.
  return (
    <CardShell testId="teacher-up-next-card">
      <UpNextCardHeading
        icon={<CalendarIcon fontSize="small" sx={theme => ({ color: theme.palette.primary.main })} />}
        title={t.upNextTitle}
      />

      <UpNextSessionsBlock
        labels={t}
        locale={locale}
        sessions={scheduledSessions}
        hiddenCount={hiddenCount}
        emptyLine={t.upcomingEmptyTeacher}
        route={TEACHER_SESSIONS_ROUTE}
      />
    </CardShell>
  );
}
