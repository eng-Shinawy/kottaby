/**
 * Dashboard stat-card resolution — the PURE half of the dashboard stats
 * wiring (`useDashboardStats` owns the queries; this module owns the
 * decisions).
 *
 * The dashboard landing renders a role-aware 2x2 stat strip. Every value
 * is an HONEST aggregate from the caller's own already-authorized read
 * surface — there is no placeholder zero anywhere:
 *
 *  - Student → sessions completed / upcoming (status-filtered
 *    `myStudentSessions` `totalCount` with a `pageSize: 1` window — the
 *    page envelope carries the honest total, the single row is throwaway),
 *    active subscriptions (client-side status count over `mySubscriptions`),
 *    unread notifications.
 *  - Teacher → sessions completed / upcoming (status-filtered
 *    `myTeacherSessions` `totalCount`), wallet balance (the `myWallet`
 *    decimal string — NEVER parsed or reformatted), unread notifications.
 *  - Parent → linked children (`myLinkedChildren`), reports received and
 *    total sessions (per-child `parentChildReports` / `parentChildSessions`
 *    `totalCount` summed across the linked-children list — each child page
 *    is fetched with `pageSize: 1` so the aggregate reads one envelope per
 *    child), unread notifications.
 *  - Admin → platform account mix (`adminUserStats`: total users, teachers,
 *    students), unread notifications.
 *
 * Error/loading posture: a stat whose underlying query is still loading is
 * `undefined` (the card renders a skeleton); a stat whose query FAILED is
 * the `statUnavailable` marker (the card renders "—" — silent degradation,
 * the errorLink surface owns messaging). Aggregates over per-child pages
 * stay `undefined` until EVERY child page resolves, so a half-loaded sum
 * is never rendered.
 */

/** Every stat slot the role builders can emit. */
export type DashboardStatKey =
  | "sessionsCompleted"
  | "upcoming"
  | "balance"
  | "notifications"
  | "activeSubscriptions"
  | "linkedChildren"
  | "totalSessions"
  | "reportsReceived"
  | "totalUsers"
  | "totalTeachers"
  | "totalStudents";

/**
 * One resolved stat card value. `value` is render-ready: a number's
 * base-10 string, the wallet balance verbatim, or the unavailable marker.
 * `unavailable` distinguishes the marker from a real value so the card can
 * style it muted (the em dash alone would be ambiguous to tests).
 */
export interface DashboardStatDraft {
  readonly key: DashboardStatKey;
  readonly value: string;
  readonly unavailable: boolean;
}

/**
 * Role-agnostic stats payload — every field optional (`undefined` = still
 * loading, `null` = failed query). The hook populates only the fields the
 * viewer's role reads; the builders read exactly their role's fields.
 */
export interface DashboardStatsData {
  readonly completedSessionsCount?: number | null;
  readonly upcomingSessionsCount?: number | null;
  readonly unreadNotificationsCount?: number | null;
  readonly walletBalance?: string | null;
  readonly activeSubscriptionsCount?: number | null;
  readonly linkedChildrenCount?: number | null;
  readonly totalSessionsCount?: number | null;
  readonly reportsReceivedCount?: number | null;
  readonly totalUsersCount?: number | null;
  readonly teachersCount?: number | null;
  readonly studentsCount?: number | null;
}

/** Wire value of the GraphQL `SubscriptionStatus` enum for a live subscription. */
const ACTIVE_SUBSCRIPTION_STATUS = "Active" as const;

/**
 * Marker returned for a stat whose query failed — the card renders it
 * verbatim (a bare em dash reads as "nothing to show" in both locales).
 */
export const STAT_UNAVAILABLE = "\u2014";

/**
 * Client-side count of active subscriptions over the `mySubscriptions`
 * rows. Subscriptions in other lifecycle states (pending purchases,
 * expired periods) are intentionally excluded — the card announces LIVE
 * access, not lifetime purchases.
 */
export function countActiveSubscriptions(
  subscriptions: readonly { readonly status: string }[] | undefined | null
): number | undefined {
  if (subscriptions === undefined || subscriptions === null) return undefined;
  return subscriptions.filter(sub => sub.status === ACTIVE_SUBSCRIPTION_STATUS).length;
}

/** Formats one stat value — numbers become base-10 strings, strings pass through verbatim. */
function formatStatValue(value: number | string): string {
  return typeof value === "number" ? value.toString(10) : value;
}

/** Builds one resolved draft from an optional count/balance. */
function draft(key: DashboardStatKey, value: number | string | undefined | null): DashboardStatDraft {
  if (value === undefined) return { key, value: "", unavailable: false };
  if (value === null) return { key, value: STAT_UNAVAILABLE, unavailable: true };
  return { key, value: formatStatValue(value), unavailable: false };
}

/** Student stat strip — completed, upcoming, active subscriptions, unread notifications. */
function buildStudentStats(data: DashboardStatsData): readonly DashboardStatDraft[] {
  return [
    draft("sessionsCompleted", data.completedSessionsCount),
    draft("upcoming", data.upcomingSessionsCount),
    draft("activeSubscriptions", data.activeSubscriptionsCount),
    draft("notifications", data.unreadNotificationsCount),
  ];
}

/** Teacher stat strip — completed, wallet balance, upcoming, unread notifications. */
function buildTeacherStats(data: DashboardStatsData): readonly DashboardStatDraft[] {
  return [
    draft("sessionsCompleted", data.completedSessionsCount),
    draft("balance", data.walletBalance),
    draft("upcoming", data.upcomingSessionsCount),
    draft("notifications", data.unreadNotificationsCount),
  ];
}

/** Parent stat strip — linked children, reports received, total sessions, unread notifications. */
function buildParentStats(data: DashboardStatsData): readonly DashboardStatDraft[] {
  return [
    draft("linkedChildren", data.linkedChildrenCount),
    draft("reportsReceived", data.reportsReceivedCount),
    draft("totalSessions", data.totalSessionsCount),
    draft("notifications", data.unreadNotificationsCount),
  ];
}

/** Admin stat strip — total users, teachers, students, unread notifications. */
function buildAdminStats(data: DashboardStatsData): readonly DashboardStatDraft[] {
  return [
    draft("totalUsers", data.totalUsersCount),
    draft("totalTeachers", data.teachersCount),
    draft("totalStudents", data.studentsCount),
    draft("notifications", data.unreadNotificationsCount),
  ];
}

/**
 * Role dispatch for the stat builders. An unrecognized role (null from a
 * tampered/anonymous context — unreachable behind the page guard, kept for
 * exhaustiveness) yields an EMPTY strip: the view renders no cards rather
 * than inventing data.
 */
export function resolveStatDrafts(
  role: string | null | undefined,
  data: DashboardStatsData
): readonly DashboardStatDraft[] {
  switch (role) {
    case "Student":
      return buildStudentStats(data);
    case "Teacher":
      return buildTeacherStats(data);
    case "Parent":
      return buildParentStats(data);
    case "Admin":
      return buildAdminStats(data);
    default:
      return [];
  }
}
