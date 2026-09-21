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
import type { ReactNode } from "react";
import { useAuth } from "@/frontend/hooks/auth";
import { DashboardGettingStartedCard } from "@/frontend/views/dashboard/home/DashboardGettingStartedCard";
import { type DashboardStat, DashboardStatCard } from "@/frontend/views/dashboard/home/DashboardStatCard";
import { useDashboardStats } from "@/frontend/views/dashboard/home/useDashboardStats";
import type { DashboardStatDraft, DashboardStatKey } from "@/frontend/views/dashboard/home/useDashboardStats.helpers";
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
 * Renders a welcome header + a role-aware 2x2 stat-card grid wired to the
 * viewer's OWN live aggregates (`useDashboardStats`): students see their
 * session/subscription counts, teachers see sessions + wallet balance,
 * parents see their linked-children family aggregates, admins see the
 * platform account mix — every role sees its real unread-notification
 * count. Values render through skeleton (loading) and muted-dash
 * (error-degraded) states; there are no placeholder zeros.
 *
 * MUI v9 patterns: `sx` callback only, `*Outlined` icons, theme palette
 * colors. The grid uses `display: grid` with responsive `gridTemplateColumns`.
 */
export function DashboardView({ statusSlot }: Readonly<DashboardViewProps>): ReactNode {
  const t = useAppTranslation(Dashboard);
  const { user } = useAuth();
  const { drafts } = useDashboardStats();

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

  const stats: readonly DashboardStat[] = drafts.map(draft => ({
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
            gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr", md: "repeat(4, 1fr)" },
            gap: 2,
          }}
        >
          {stats.map(stat => (
            <DashboardStatCard key={stat.label} stat={stat} />
          ))}
        </Box>
      ) : null}

      <DashboardGettingStartedCard />
    </Box>
  );
}
