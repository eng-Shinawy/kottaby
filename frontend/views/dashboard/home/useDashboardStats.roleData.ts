"use client";

import {
  countActiveSubscriptions,
  type DashboardStatsData,
  studentSessionCreditLanes,
  sumStudentSessionBalance,
} from "@/frontend/views/dashboard/home/useDashboardStats.helpers";
import { type ParentAggregateState, resolveOptional } from "@/frontend/views/dashboard/home/useDashboardStats.parts";
import type { RoleStatQueries } from "@/frontend/views/dashboard/home/useDashboardStats.queries";

/**
 * Student branch — two status-filtered session count envelopes, the
 * subscriptions rows (active rows counted client-side), the prepaid
 * session-credit lanes (the four `mySessionBalance` counts summed
 * client-side — PREPAID lanes only, never subscription coverage), the
 * SAME balance read broken down per lane (`sessionCreditLanes` — the
 * balance card's popover payload; its tri-state rides the shared
 * resolver, so loading → `undefined`, failed → `null`, resolved → the
 * four display counts), and the unread count. A failed subscriptions
 * query degrades the active-count stat to `null`; the session counts, the
 * credits total AND the lane payload degrade independently (loading →
 * skeleton, failed → unavailable).
 */
function buildStudentStats(
  queries: RoleStatQueries,
  unreadNotificationsCount: DashboardStatsData["unreadNotificationsCount"]
): DashboardStatsData {
  const subscriptionRows = queries.studentSubscriptions.loading
    ? undefined
    : (queries.studentSubscriptions.data?.mySubscriptions ?? null);
  const balanceWire = queries.studentSessionBalance.data?.mySessionBalance;
  return {
    unreadNotificationsCount,
    completedSessionsCount: resolveOptional(
      queries.studentCompleted.loading,
      queries.studentCompleted.error,
      queries.studentCompleted.data?.myStudentSessions?.totalCount
    ),
    upcomingSessionsCount: resolveOptional(
      queries.studentUpcoming.loading,
      queries.studentUpcoming.error,
      queries.studentUpcoming.data?.myStudentSessions?.totalCount
    ),
    activeSubscriptionsCount: queries.studentSubscriptions.error ? null : countActiveSubscriptions(subscriptionRows),
    sessionCreditsTotal: resolveOptional(
      queries.studentSessionBalance.loading,
      queries.studentSessionBalance.error,
      balanceWire === undefined ? undefined : sumStudentSessionBalance(balanceWire)
    ),
    sessionCreditLanes: resolveOptional(
      queries.studentSessionBalance.loading,
      queries.studentSessionBalance.error,
      balanceWire === undefined ? undefined : studentSessionCreditLanes(balanceWire)
    ),
  };
}

/**
 * Builds the stats payload fully-formed per role — the payload's fields
 * are readonly by contract, so each branch composes its own object.
 * Pure over the wired observers: no hook state, no fetching — the caller
 * passes the role's query bundle and the parent aggregate it resolved.
 */
export function buildStatsData(
  role: string | null,
  queries: RoleStatQueries,
  aggregate: ParentAggregateState
): DashboardStatsData {
  const unreadNotificationsCount = resolveOptional(
    queries.unread.loading,
    queries.unread.error,
    queries.unread.data?.myUnreadNotificationCount
  );

  if (role === "Student") return buildStudentStats(queries, unreadNotificationsCount);
  if (role === "Teacher") {
    return {
      unreadNotificationsCount,
      completedSessionsCount: resolveOptional(
        queries.teacherCompleted.loading,
        queries.teacherCompleted.error,
        queries.teacherCompleted.data?.myTeacherSessions?.totalCount
      ),
      upcomingSessionsCount: resolveOptional(
        queries.teacherUpcoming.loading,
        queries.teacherUpcoming.error,
        queries.teacherUpcoming.data?.myTeacherSessions?.totalCount
      ),
      walletBalance: resolveOptional(
        queries.teacherWallet.loading,
        queries.teacherWallet.error,
        queries.teacherWallet.data?.myWallet.balance
      ),
    };
  }
  if (role === "Parent") {
    return {
      unreadNotificationsCount,
      linkedChildrenCount: resolveOptional(
        queries.parentChildren.loading,
        queries.parentChildren.error,
        queries.parentChildren.data?.myLinkedChildren?.length
      ),
      // A failed linked-children query strands the aggregate runner — the
      // per-child loop never receives ids, so both sums would stay in
      // their running state (permanent skeletons). Degrade both cards to
      // the unavailable state alongside the children count.
      reportsReceivedCount: queries.parentChildren.error ? null : aggregate.reportsTotal,
      totalSessionsCount: queries.parentChildren.error ? null : aggregate.sessionsTotal,
    };
  }
  if (role === "Admin") {
    return {
      unreadNotificationsCount,
      totalUsersCount: resolveOptional(
        queries.adminUserStats.loading,
        queries.adminUserStats.error,
        queries.adminUserStats.data?.adminUserStats.totalCount
      ),
      teachersCount: resolveOptional(
        queries.adminUserStats.loading,
        queries.adminUserStats.error,
        queries.adminUserStats.data?.adminUserStats.teachersCount
      ),
      studentsCount: resolveOptional(
        queries.adminUserStats.loading,
        queries.adminUserStats.error,
        queries.adminUserStats.data?.adminUserStats.studentsCount
      ),
    };
  }
  return { unreadNotificationsCount };
}
