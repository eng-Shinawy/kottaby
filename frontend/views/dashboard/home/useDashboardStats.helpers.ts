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
 *    the session-credit total (the four prepaid `mySessionBalance` lane
 *    counts summed client-side — PREPAID lanes only; the sum NEVER
 *    includes subscription coverage) plus the same read broken down per
 *    lane (`sessionCreditLanes` — the balance card's popover payload,
 *    tri-state honest like every other field), unread notifications.
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
 *
 * The module also owns the strip's RESPONSIVE GRID decision
 * (`statGridTemplate`): the template adapts to the card count so the
 * five-card student strip never wraps a lone orphan card.
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
 * One prepaid session-credit lane set, display-ready (wire nulls already
 * coalesced to 0 by `studentSessionCreditLanes`) — the four
 * `mySessionBalance` lanes. Purely a presentation shape: the SUM card keeps
 * its own semantics (`sessionCreditsTotal`); this payload exists so the
 * STUDENT balance card can break its total down per lane in the popover.
 * The lanes are the caller's own PREPAID credit records — NEVER
 * subscription coverage.
 */
export interface SessionCreditLanes {
  /** The NOT NULL trial lane, verbatim. */
  readonly trial: number;
  /** The nullable purchased Hifz lane, wire-null coalesced to 0. */
  readonly hifz: number;
  /** The nullable purchased Tajweed lane, wire-null coalesced to 0. */
  readonly tajweed: number;
  /** The nullable purchased Reviews lane, wire-null coalesced to 0. */
  readonly reviews: number;
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
  /**
   * The student's total prepaid session credits — the four
   * `mySessionBalance` lanes summed client-side (`sumStudentSessionBalance`).
   * The lanes are the caller's own PREPAID credit records; the sum NEVER
   * includes subscription coverage. `undefined` = the balance query is
   * still resolving (skeleton), `null` = it failed (unavailable marker).
   */
  readonly sessionCreditsTotal?: number | null;
  /**
   * The student balance card's four prepaid lanes, resolved from the SAME
   * `mySessionBalance` wire object the `sessionCreditsTotal` sum reads —
   * trial / hifz / tajweed / reviews, wire-null purchased lanes coalesced
   * to 0 (`studentSessionCreditLanes`). ONLY the Student branch ever
   * populates it (the other roles never gain the breakdown). The tri-state
   * mirrors the balance query exactly: `undefined` = still resolving (the
   * popover renders skeletons), `null` = the query failed (the popover
   * renders the unavailable marker — the SUM card keeps its own "—"
   * semantics independently), resolved = the four display counts. The
   * lanes are the caller's own PREPAID credit records — subscription
   * coverage is not part of this payload, so the popover's honest-scope
   * note always applies.
   */
  readonly sessionCreditLanes?: SessionCreditLanes | null;
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

/**
 * One `mySessionBalance` wire row — only `balanceTrial` is a NOT NULL
 * column; the three purchased lanes surface their nullable columns
 * verbatim. Shared structurally by the lane sum and the lane resolver so
 * the two decisions can never drift apart.
 */
type StudentSessionBalanceWire = {
  readonly balanceTrial: number;
  readonly balanceHifz: number | null;
  readonly balanceTajweed: number | null;
  readonly balanceReviews: number | null;
};

/**
 * Resolves the balance popover's four-lane payload from one
 * `mySessionBalance` wire object — the SAME already-fetched read that
 * feeds `sumStudentSessionBalance`, never a second request. Wire-null
 * purchased lanes coalesce to 0 for display (a null lane record carries
 * no credits — the same presentation rationale as the sum); the NOT NULL
 * trial lane passes through verbatim. The lanes NEVER include
 * subscription coverage.
 */
export function studentSessionCreditLanes(balance: StudentSessionBalanceWire): SessionCreditLanes {
  return {
    trial: balance.balanceTrial,
    hifz: balance.balanceHifz ?? 0,
    tajweed: balance.balanceTajweed ?? 0,
    reviews: balance.balanceReviews ?? 0,
  };
}

/**
 * Sums the four prepaid session-credit lanes of one `mySessionBalance`
 * payload. Only `balanceTrial` is a NOT NULL column; the three purchased
 * lanes (`balanceHifz`/`balanceTajweed`/`balanceReviews`) are nullable
 * columns surfaced honestly on the wire — a null lane record carries no
 * credits, so it coalesces to 0 here (a presentation decision, never a
 * schema lie). The sum NEVER includes subscription coverage: it is the
 * caller's own prepaid balance, the exact surface the booking pipeline's
 * trial-first debit ladder (`debitBookingLadder`) spends first.
 */
export function sumStudentSessionBalance(balance: StudentSessionBalanceWire): number {
  return (
    balance.balanceTrial + (balance.balanceHifz ?? 0) + (balance.balanceTajweed ?? 0) + (balance.balanceReviews ?? 0)
  );
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

/**
 * Student stat strip — completed, upcoming, active subscriptions,
 * prepaid credit total (the shared `balance`/WalletIcon card), unread
 * notifications.
 */
function buildStudentStats(data: DashboardStatsData): readonly DashboardStatDraft[] {
  return [
    draft("sessionsCompleted", data.completedSessionsCount),
    draft("upcoming", data.upcomingSessionsCount),
    draft("activeSubscriptions", data.activeSubscriptionsCount),
    draft("balance", data.sessionCreditsTotal),
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

/**
 * Responsive `gridTemplateColumns` for the stat strip, adapted to the
 * strip's card count.
 *
 * The STUDENT role emits FIVE cards (completed / upcoming / active
 * subscriptions / prepaid credits / unread), and the original fixed
 * `md: repeat(4, 1fr)` template wrapped the fifth (Balance) card alone as
 * an orphan row on md/lg viewports. The buckets:
 *
 *  - `count <= 4` → the original template UNCHANGED: single column on
 *    phones, 2-up from `sm`, 4-up from `md` (no `xl` lane — the md count
 *    carries through, exactly the pre-existing behavior; teacher / parent
 *    / admin strips, and the empty strip the view already guards).
 *  - `count === 5` → 3-up at `md`/`lg` (a balanced 3+2 wrap) and a
 *    deliberate 5-up row at `xl` where the viewport fits every card.
 *  - `count > 5` → defensive (no current role emits more than five):
 *    3-up at `md`/`lg`, 4-up at `xl`, so an oversized strip still wraps
 *    without a lone trailing card.
 */
export function statGridTemplate(count: number): {
  readonly xs: string;
  readonly sm: string;
  readonly md: string;
  /** Explicit wide-viewport lane count (absent in the ≤4 bucket — md carries through). */
  readonly xl?: string;
} {
  if (count > 5) {
    return { xs: "1fr", sm: "1fr 1fr", md: "repeat(3, 1fr)", xl: "repeat(4, 1fr)" };
  }
  if (count === 5) {
    return { xs: "1fr", sm: "1fr 1fr", md: "repeat(3, 1fr)", xl: "repeat(5, 1fr)" };
  }
  return { xs: "1fr", sm: "1fr 1fr", md: "repeat(4, 1fr)" };
}
