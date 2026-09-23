"use client";

import { useQuery } from "@apollo/client/react";
import { FamilyRestroomOutlined as ChildrenIcon } from "@mui/icons-material";
import { Box, ButtonBase, Stack, Typography } from "@mui/material";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import type { MyChildrenUpcomingSessionsQuery_myChildrenUpcomingSessions } from "@/frontend/graphql/generated/gql/graphql";
import { myChildrenUpcomingSessionsQueryDocument } from "@/frontend/graphql/sharedDocuments";
import { formatApplicantDate as formatSessionDate } from "@/frontend/lib/i18n/format-date";
import { PARENT_PORTAL_ROOT_ROUTE } from "@/frontend/lib/notification-route-resolution";
import { UpNextErrorCard, UpNextSkeletonCard } from "@/frontend/views/dashboard/home/UpNextCardStates";
import {
  ScheduledTailRow,
  UpNextCardHeading,
  UpNextChevron,
  UpNextEmptyArm,
  UpNextMiniRow,
  UpNextRowIcon,
} from "@/frontend/views/dashboard/home/UpNextRowChrome";
import { upNextRowShellSx } from "@/frontend/views/dashboard/home/upNextRowShell";
import { CardShell } from "@/frontend/views/students/dashboard/CardShell";
import { SESSION_FEE_CURRENCY } from "@/shared/constants";
import { Common, UpNext, useAppLocale, useAppTranslation } from "@/shared/locale";
import type { UpNextLabels } from "@/shared/locale/types/upNext";

/** Parent link-my-child route — the zero-children empty arm's hop target (nav literal parity). */
const PARENT_HANDSHAKE_ROUTE = "/parent/handshake";

/**
 * ParentUpNextCard — the parent dashboard's "What's next" card, mounted
 * in the `RoleDashboardPage` parent status slot (the last role to join
 * the glance-card family — student, teacher, then parent).
 *
 * Self-contained client component: NO props, NO client-side role logic —
 * the page-level server guards remain the ONLY authorization boundary and
 * the identity-scoped `myChildrenUpcomingSessions` read answers identity
 * server-side (zero caller-supplied identity arguments; the SAME
 * confirmed-children scope the monitoring portal reads). The card renders
 * ONE group per linked child, so a multi-child family sees every child's
 * next sessions in one glance.
 *
 * Content (a DISCOVERABILITY window, never a lifecycle surface):
 *  - Per child — a heading row (initial chip + full name) that hops to
 *    that child's monitoring surface, followed by the child's scheduled
 *    glance window (rows render the verbatim booking date + fee — no
 *    invented schedule-time semantics, no money arithmetic) and the
 *    honest scheduled-tail row when the child's true scheduled count
 *    exceeds the window. The child's monitoring page owns every
 *    lifecycle detail; this card only points there.
 *  - Zero linked children → the honest whole-card empty arm with the
 *    link-my-child CTA (the handshake surface owns linking).
 *  - A child with zero scheduled sessions → their group still renders
 *    with the honest "no upcoming" line (a dropped child would read as
 *    a broken family view).
 *
 * Render branches:
 *
 * | # | Condition | Surface |
 * |---|-----------|---------|
 * | 1 | query in flight | Skeleton card (`aria-busy` + `role="status"` labelled `loadingLabel`) mirroring the settled geometry (zero layout-shift target) |
 * | 2 | query error | localized inline `Alert` + retry via `refetch` |
 * | 3 | settled | title + per-child groups (or the link-child empty arm) |
 *
 * MUI v9 discipline: `sx`-only styling, colors exclusively through
 * `theme.palette.*` tokens, `*Outlined` icons only, RTL-safe logical
 * composition (the directional chevron flips with `theme.direction`), and
 * every user-facing string resolved through compile-time i18n handles
 * (`useAppTranslation(UpNext)` property access — NEVER `t('key')`).
 */
export function ParentUpNextCard(): ReactNode {
  const t = useAppTranslation(UpNext);
  const tc = useAppTranslation(Common);

  const childrenUpcoming = useQuery(myChildrenUpcomingSessionsQueryDocument, {
    fetchPolicy: "cache-and-network",
  });

  // Branch 1 — in flight: skeleton placeholder announces busy semantics.
  if (childrenUpcoming.loading) {
    return <UpNextSkeletonCard loadingLabel={t.loadingLabel} testId="parent-up-next-card-loading" />;
  }

  // Branch 2 — the read settled into a failure: ONE localized inline Alert
  // + retry refetch. The query's `error` field is tested directly — network
  // and uncoded GraphQL errors carry no `extensions.code`, so a code gate
  // would swallow them into a silent empty render.
  if (childrenUpcoming.error !== undefined) {
    return (
      <UpNextErrorCard
        errorBody={t.errorBody}
        retryLabel={tc.retry}
        testId="parent-up-next-card-error"
        onRetry={() => {
          void childrenUpcoming.refetch().catch(() => undefined);
        }}
      />
    );
  }

  const blocks: readonly MyChildrenUpcomingSessionsQuery_myChildrenUpcomingSessions[] =
    childrenUpcoming.data?.myChildrenUpcomingSessions ?? [];

  // Branch 3 — settled: the glance window, one group per linked child.
  return (
    <CardShell testId="parent-up-next-card">
      <UpNextCardHeading
        icon={<ChildrenIcon fontSize="small" sx={theme => ({ color: theme.palette.primary.main })} />}
        title={t.upNextTitle}
      />

      {blocks.length === 0 ? (
        <UpNextEmptyArm
          emptyLine={t.upcomingEmptyParentNoChildren}
          ctaLabel={t.linkChildCta}
          ctaHref={PARENT_HANDSHAKE_ROUTE}
        />
      ) : (
        blocks.map(block => <ParentChildUpcomingGroup key={block.child.id} block={block} labels={t} />)
      )}
    </CardShell>
  );
}

/**
 * One per-child group — the child's heading row (initial chip + full
 * name, hopping to the child's monitoring surface) over that child's
 * scheduled glance window, with the honest tail row when the child's
 * scheduled total exceeds the window and the honest empty line when it
 * is zero. Every hop lands on the same child detail route — the surface
 * that owns the child's session lifecycle.
 */
function ParentChildUpcomingGroup({
  block,
  labels: t,
}: Readonly<{
  block: MyChildrenUpcomingSessionsQuery_myChildrenUpcomingSessions;
  labels: UpNextLabels;
}>): ReactNode {
  const router = useRouter();
  const locale = useAppLocale();
  const childRoute = `${PARENT_PORTAL_ROOT_ROUTE}/${block.child.id}`;
  const openChild = () => {
    router.push(childRoute);
  };

  const hiddenCount = Math.max(0, block.scheduledTotalCount - block.upcomingSessions.length);

  return (
    <Box sx={{ minWidth: 0 }}>
      <ButtonBase component="button" type="button" onClick={openChild} sx={upNextRowShellSx("primary")}>
        <UpNextRowIcon
          tone="primary"
          icon={
            <Typography
              variant="caption"
              component="span"
              sx={theme => ({ color: theme.palette.onPrimaryContainer, fontWeight: 700, lineHeight: 1 })}
            >
              {block.child.fullName.charAt(0)}
            </Typography>
          }
        />
        <Box sx={{ minWidth: 0, flex: 1, textAlign: "start" }}>
          <Typography
            variant="body2"
            component="p"
            sx={theme => ({ fontWeight: 700, color: theme.palette.text.primary })}
          >
            {block.child.fullName}
          </Typography>
        </Box>
        <UpNextChevron />
      </ButtonBase>

      {block.upcomingSessions.length === 0 ? (
        <Typography
          variant="body2"
          component="p"
          sx={theme => ({ color: theme.palette.text.secondary, paddingX: 1.5, paddingTop: 1 })}
        >
          {t.upcomingEmptyChild}
        </Typography>
      ) : (
        <Stack spacing={1} sx={{ paddingTop: 1 }}>
          {block.upcomingSessions.map(session => (
            <UpNextMiniRow
              key={session.sessionId}
              sessionRef={t.sessionLine(session.sessionId)}
              bookedLabel={`${t.bookedPrefix} ${formatSessionDate(session.createdAt, locale)}`}
              feeText={session.fee === null ? "—" : `${session.fee} ${SESSION_FEE_CURRENCY}`}
              ariaLabel={`${t.sessionLine(session.sessionId)} — ${t.bookedPrefix} ${formatSessionDate(session.createdAt, locale)}`}
              onOpen={openChild}
            />
          ))}
          {hiddenCount > 0 ? <ScheduledTailRow count={hiddenCount} labels={t} onOpen={openChild} /> : null}
        </Stack>
      )}
    </Box>
  );
}
