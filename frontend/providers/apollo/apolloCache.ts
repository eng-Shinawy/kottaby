import { InMemoryCache, type InMemoryCacheConfig } from "@apollo/client";

/**
 * Apollo cache with type policies for paginated / filtered list results.
 *
 * `AdminDashboardScheduleResult.rows` must replace (not merge) on write:
 * filter/pagination changes legitimately return different arrays, including empty ones.
 * Without `merge: false`, Apollo warns that cache data may be lost.
 *
 * `OnlineMeetingInfo`, `AdminNoteInfo`, `HealthCheck`, `NotificationListPage`,
 * `HandshakeCodeLookup`, `AdminAuditLogPage`, the eleven `PlatformAnalytics`
 * dashboard aggregate types and the four `AdminFinance` wrapper types
 * (`AdminStudentPaymentPage`, `AdminTeacherWallet`, `AdminWithdrawalQueueRow`,
 * `AdminWithdrawalQueuePage`) are embedded value types with
 * no `id` field (see `frontend/graphql/generated/schema.graphql`).
 * Marking them `keyFields: false` opts them out of normalization so Apollo
 * does not emit "Cache data may be lost" warnings when these types are written
 * to the cache via different parent objects. They are always read back through
 * their enclosing parent (e.g. a `Session`, an `AdminNote` owner or a future
 * `_health` document), so identifying them by their own fields is unnecessary
 * (`HealthCheck` is the scalar-only probe object exposed by the `_health`
 * gateway query; `NotificationListPage` is the notifications inbox pagination
 * wrapper whose normalizable entities are the `Notification` rows inside
 * `items`; `HandshakeCodeLookup` is the masked parent-discovery payload —
 * `maskedName` + `linkable` only — and must NEVER be keyed by
 * identity-derived values).
 *
 * `AdminAuditLogPage` is the admin audit-trail pagination wrapper (same
 * shape discipline as `NotificationListPage`): the normalizable entities are
 * the `AdminAuditLogEntry` rows inside `items` (each carries `id`), so the
 * wrapper itself never needs an identity.
 *
 * `PurchaseSubscriptionPayload` and `PaymentCheckout` are the purchase
 * funnel's embedded value objects (no `id` by design — the normalizable
 * entities are the nested `StudentSubscription` / `StudentPayment` rows each
 * carrying `id`): the mutation wrapper and the gateway checkout descriptor
 * are read back inline under the mutation field, so identifying them by
 * their own fields is unnecessary and a standalone cache key would be
 * meaningless.
 *
 * The `PlatformAnalytics*` family is the admin analytics-dashboard read
 * model: one root `adminPlatformAnalytics` query field whose section and
 * trend-row objects are scalar-only snapshots (no `id` anywhere in the
 * aggregate), read back embedded under the root field and replaced
 * wholesale on every refetch.
 *
 * `StudentProgress` is the per-student curriculum-progress read model
 * (computed per request, no `id`): it is cached inline under the
 * `studentProgress` root field and replaced wholesale on every refetch.
 */
const adminFinanceTypePolicies = {
  // Admin financial-auditing envelope family — the id-less wrapper types
  // of the payments audit / wallet inspector / withdrawal queue surfaces.
  // The normalizable entities are the row objects carrying an `id`
  // inside any wrapper (`AdminStudentPayment` rows inside
  // `AdminStudentPaymentPage.items`, `TeacherTransaction` rows inside
  // `AdminTeacherWallet.transactions` and inside
  // `AdminWithdrawalQueueRow.transaction`), so the wrappers themselves
  // never need an identity.
  AdminStudentPaymentPage: {
    keyFields: false,
  },
  AdminTeacherWallet: {
    keyFields: false,
  },
  AdminWithdrawalQueueRow: {
    keyFields: false,
  },
  AdminWithdrawalQueuePage: {
    keyFields: false,
  },
} as const;

/**
 * Type policies for the cache — declared at module scope (not inline in the
 * factory) so the factory stays a one-liner and the policy table reads as a
 * flat, greppable registry. Same content and order as when it was inline;
 * new embedded families append after the last documented entry.
 */
const apolloCacheTypePolicies: NonNullable<InMemoryCacheConfig["typePolicies"]> = {
  AdminDashboardScheduleResult: {
    fields: {
      rows: {
        merge: false,
      },
    },
  },
  AdminNoteInfo: {
    keyFields: false,
  },
  // Embedded scalar-only value object (no `id`) — normalize-safe from day
  // one so any future consumer of `_health` cannot trigger cache-data-loss
  // warnings (frontend/graphql/AGENTS.md embedded-type policy).
  HealthCheck: {
    keyFields: false,
  },
  // Embedded pagination-wrapper value object (no `id`) for the
  // notifications inbox — the normalizable entities are the `Notification`
  // rows inside `items`, so the wrapper itself never needs an identity.
  NotificationListPage: {
    keyFields: false,
  },
  // Embedded masked parent-discovery value object (no `id` by design) —
  // cached inline under its parent query field, never normalized into a
  // standalone (identity-derived) cache key.
  HandshakeCodeLookup: {
    keyFields: false,
  },
  // Embedded pagination-wrapper value object (no `id`) for the admin
  // audit trail — the normalizable entities are the `AdminAuditLogEntry`
  // rows inside `items`, so the wrapper itself never needs an identity.
  AdminAuditLogPage: {
    keyFields: false,
  },
  // See `adminFinanceTypePolicies` above.
  ...adminFinanceTypePolicies,
  ParentAttendancePage: { keyFields: false },
  ParentReportPage: { keyFields: false },
  ParentHomeworkPage: { keyFields: false },
  ParentHomeworkTrack: { keyFields: false },
  ParentHomeworkPosition: { keyFields: false },
  ParentChildProgress: { keyFields: false },
  ParentSessionTarget: { keyFields: false },
  // Parent "What's next" glance-card value family (no `id` by design — the
  // normalizable entity is the embedded `ParentLinkedChild` echo inside
  // each block): the per-child block and its slim session rows are cached
  // inline under the root field and replaced wholesale on refetch.
  ParentChildUpcomingBlock: { keyFields: false },
  ParentChildUpcomingSession: { keyFields: false },
  // Teacher-scoped homework history pagination envelope — id-less wrapper
  // over the canonical `SessionHomeWork` rows inside `items`; the rows
  // themselves normalize via their `id` (no policy needed). Mirrors the
  // `ParentHomeworkPage` precedent immediately above; without it every
  // history read trips "Cache data may be lost" normalization warnings.
  StudentHomeworkPage: { keyFields: false },
  OnlineMeetingInfo: {
    keyFields: false,
  },
  // Purchase-funnel embedded value objects (no `id` by design): the
  // mutation wrapper's normalizable entities are the nested
  // `StudentSubscription` / `StudentPayment` rows, and the checkout
  // descriptor is a scalar-only triple — both cached inline under the
  // mutation field, never normalized into standalone cache ids.
  PurchaseSubscriptionPayload: {
    keyFields: false,
  },
  PaymentCheckout: {
    keyFields: false,
  },
  // Admin-ordered re-evaluation receipt — the sanctioned id-less mutation
  // payload (no `id` by design: `teacherId` is the subject anchor). Read
  // back inline under the `adminOrderTeacherReEvaluation` mutation field
  // and replaced wholesale on every refetch; a standalone cache key would
  // be meaningless (same discipline as `PurchaseSubscriptionPayload`
  // above).
  TeacherReEvaluationOrder: {
    keyFields: false,
  },
  // Admin analytics-dashboard snapshot family — scalar-only sections of
  // the single `adminPlatformAnalytics` read model with no `id` anywhere
  // in the aggregate (see `frontend/graphql/generated/schema.graphql`),
  // cached inline under the root query field and replaced wholesale on
  // every refetch. Entries are listed in the read model's own shape
  // order (root, then sections, then trend points) — a fixed, repeatable
  // order; new embedded families append after the last documented entry.
  PlatformAnalytics: {
    keyFields: false,
  },
  PlatformAnalyticsUsers: {
    keyFields: false,
  },
  PlatformAnalyticsSessions: {
    keyFields: false,
  },
  PlatformAnalyticsRevenue: {
    keyFields: false,
  },
  PlatformAnalyticsCurrencyRevenue: {
    keyFields: false,
  },
  PlatformAnalyticsSubscriptions: {
    keyFields: false,
  },
  PlatformAnalyticsTeachers: {
    keyFields: false,
  },
  PlatformAnalyticsRatings: {
    keyFields: false,
  },
  PlatformAnalyticsHealth: {
    keyFields: false,
  },
  PlatformAnalyticsSessionTrendPoint: {
    keyFields: false,
  },
  PlatformAnalyticsRevenueTrendPoint: {
    keyFields: false,
  },
  // Admin academic-tracking embedded value family (no `id` by design — see
  // `frontend/graphql/generated/schema.graphql`): the two pagination
  // envelopes, the aggregate stats block, the per-track position/summary
  // value objects, the attention flag, the detail wrapper, and the
  // per-entry homework track block are cached inline under their root
  // query fields and replaced wholesale on every refetch. The
  // normalizable entities are the row objects carrying an `id` inside any
  // wrapper (`AdminAcademicStudentRow` rows in
  // `AdminAcademicDashboardPage.items`, `AdminAcademicHomeworkEntry` /
  // `AdminAcademicReportEntry` rows inside the drill-down pages, and the
  // `AdminAcademicStudentDetailEcho`), so the wrappers themselves never
  // need an identity. Entries follow the read model's own shape order.
  AdminAcademicDashboardPage: {
    keyFields: false,
  },
  AdminAcademicStats: {
    keyFields: false,
  },
  AdminAcademicPosition: {
    keyFields: false,
  },
  AdminAcademicGradeSummary: {
    keyFields: false,
  },
  AdminAcademicAttentionFlag: {
    keyFields: false,
  },
  AdminStudentAcademicDetail: {
    keyFields: false,
  },
  AdminAcademicHomeworkPage: {
    keyFields: false,
  },
  AdminAcademicHomeworkTrack: {
    keyFields: false,
  },
  AdminAcademicReportPage: {
    keyFields: false,
  },
  // Per-student curriculum-progress read model — computed per request, so
  // it carries no `id` to normalize by (the honesty signal is the
  // `hasProgress` flag, not an identity); cached inline under the
  // `studentProgress` root field and replaced wholesale on refetch.
  StudentProgress: { keyFields: false },
};

/** Apollo cache with the module-scope {@link apolloCacheTypePolicies} applied. */
export function createApolloCache(): InMemoryCache {
  return new InMemoryCache({
    typePolicies: apolloCacheTypePolicies,
  });
}
