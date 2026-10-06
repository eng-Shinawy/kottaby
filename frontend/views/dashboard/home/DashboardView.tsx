"use client";

import {
  CalendarMonthOutlined as CalendarIcon,
  FamilyRestroomOutlined as ChildrenIcon,
  NotificationsOutlined as NotificationsIcon,
  DescriptionOutlined as ReportsIcon,
  SchoolOutlined as SchoolIcon,
  MenuBookOutlined as SubscriptionsIcon,
  GroupsOutlined as UsersIcon,
  PaymentsOutlined as WalletIcon,
} from "@mui/icons-material";
import { Box, Stack, Typography } from "@mui/material";
import { type ReactNode, useState } from "react";
import { UserRole } from "@/frontend/graphql/generated/gql/graphql";
import { useAuth } from "@/frontend/hooks/auth";
import { DashboardBalanceBreakdownPopover } from "@/frontend/views/dashboard/home/DashboardBalanceBreakdownPopover";
import { DashboardGettingStartedCard } from "@/frontend/views/dashboard/home/DashboardGettingStartedCard";
import { type DashboardStat, DashboardStatCard } from "@/frontend/views/dashboard/home/DashboardStatCard";
import { useDashboardStats } from "@/frontend/views/dashboard/home/useDashboardStats";
import {
  type DashboardStatDraft,
  type DashboardStatKey,
  statGridTemplate,
} from "@/frontend/views/dashboard/home/useDashboardStats.helpers";
import { Dashboard, useAppTranslation } from "@/shared/locale";

interface DashboardViewProps {
  /**
   * Role-specific content slot mounted between the welcome header and the
   * stat grid (the teacher dashboard passes
   * `<ApplicantStatusCard />` so the lifecycle status card sits above the
   * fold, under the page header). The SERVER composition decides what — if
   * anything — goes here per role; this view adds no client-side gating of
   * its own and other roles pass nothing (slot stays empty).
   */
  readonly statusSlot?: ReactNode;
}

/**
 * Per-stat-key icon mapping — the icon is presentational only, so the
 * slot-to-icon assignment stays here while the VALUE resolution lives in
 * the stats hook and the LABEL resolution in the locale namespace.
 */
const STAT_ICONS: Record<DashboardStatKey, typeof SchoolIcon> = {
  sessionsCompleted: SchoolIcon,
  upcoming: CalendarIcon,
  balance: WalletIcon,
  notifications: NotificationsIcon,
  activeSubscriptions: SubscriptionsIcon,
  linkedChildren: ChildrenIcon,
  totalSessions: CalendarIcon,
  reportsReceived: ReportsIcon,
  totalUsers: UsersIcon,
  totalTeachers: SchoolIcon,
  totalStudents: UsersIcon,
};

/**
 * Resolves one stat card's rendered value: a failed stat renders the
 * localized muted marker, anything else renders as-is (loading cards
 * ignore `value` — the skeleton slot replaces it — and announce through
 * `loadingLabel` instead).
 */
function statValue(draft: DashboardStatDraft, unavailableLabel: string): string {
  return draft.unavailable ? unavailableLabel : draft.value;
}

/**
 * DashboardView — landing view shown at `/dashboard`.
 *
 * Renders a welcome header + a role-aware stat-card grid wired to the
 * viewer's OWN live aggregates (`useDashboardStats`): students see their
 * session/subscription counts + prepaid credit total, teachers see
 * sessions + wallet balance, parents see their linked-children family
 * aggregates, admins see the platform account mix — every role sees its
 * real unread-notification count. Values render through skeleton (loading)
 * and muted-dash (error-degraded) states; there are no placeholder zeros.
 *
 * STUDENT balance card: the only interactive stat card — clicking it opens
 * `DashboardBalanceBreakdownPopover`, which breaks the prepaid total into
 * the four `mySessionBalance` lanes (the popover's lane payload rides the
 * same hook, tri-state honest; teacher/parent/admin cards stay static).
 *
 * MUI v9 patterns: `sx` callback only, `*Outlined` icons, theme palette
 * colors. The grid uses `display: grid` with a `gridTemplateColumns`
 * adapted to the strip's card count (`statGridTemplate`): four-card roles
 * keep the original 4-up md row, while the student strip's five cards
 * balance 3+2 at md/lg and go 5-up at xl — the fixed 4-up template used
 * to wrap the Balance card alone as an orphan row on md/lg.
 */
export function DashboardView({ statusSlot }: Readonly<DashboardViewProps>): ReactNode {
  const t = useAppTranslation(Dashboard);
  const { user } = useAuth();
  const { drafts, sessionCreditLanes } = useDashboardStats();
  // The breakdown popover is a STUDENT-only affordance — the role gate
  // lives here so the other roles' strips render byte-identical (no
  // interactive seam on any card, no popover mounted).
  const isStudent = user?.role === UserRole.Student;
  // The popover anchor is the activated card element itself, captured from
  // the click (never a render-time ref dereference) and held in state so
  // the popover re-anchors if the element remounts while open.
  const [balanceAnchorEl, setBalanceAnchorEl] = useState<HTMLElement | null>(null);

  const welcomeText = user ? t.welcome(user.fullName) : t.title;

  const labels: Record<DashboardStatKey, string> = {
    sessionsCompleted: t.sessionsCompleted,
    upcoming: t.upcoming,
    balance: t.balance,
    notifications: t.notifications,
    activeSubscriptions: t.activeSubscriptions,
    linkedChildren: t.linkedChildren,
    totalSessions: t.totalSessions,
    reportsReceived: t.reportsReceived,
    totalUsers: t.totalUsers,
    totalTeachers: t.totalTeachers,
    totalStudents: t.totalStudents,
  };

  const stats: readonly (DashboardStat & { readonly key: DashboardStatKey })[] = drafts.map(draft => ({
    key: draft.key,
    label: labels[draft.key],
    value: statValue(draft, t.statUnavailable),
    loadingLabel: t.statLoading,
    Icon: STAT_ICONS[draft.key],
    loading: draft.value === "",
    unavailable: draft.unavailable,
  }));

  return (
    <Box>
      <Stack spacing={1} sx={{ mb: 4 }}>
        <Typography variant="h4" component="h1" sx={{ fontWeight: 700, letterSpacing: "-0.02em" }}>
          {welcomeText}
        </Typography>
        <Typography variant="body1" sx={theme => ({ color: theme.palette.text.secondary })}>
          {t.title}
        </Typography>
      </Stack>

      {statusSlot ? <Box sx={{ mb: 4 }}>{statusSlot}</Box> : null}

      {stats.length > 0 ? (
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: statGridTemplate(stats.length),
            gap: 2,
          }}
        >
          {stats.map(stat =>
            stat.key === "balance" && isStudent ? (
              <DashboardStatCard
                key={stat.label}
                stat={stat}
                onActivate={setBalanceAnchorEl}
                popoverAriaLabel={t.balanceBreakdownTitle}
              />
            ) : (
              <DashboardStatCard key={stat.label} stat={stat} />
            )
          )}
        </Box>
      ) : null}

      {isStudent ? (
        <DashboardBalanceBreakdownPopover
          open={balanceAnchorEl !== null}
          anchorEl={balanceAnchorEl}
          lanes={sessionCreditLanes}
          onClose={() => setBalanceAnchorEl(null)}
          labels={t}
        />
      ) : null}

      <DashboardGettingStartedCard />
    </Box>
  );
}
