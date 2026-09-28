/**
 * Admin user query helpers — shared query-building primitives for the
 * admin user directory repository (`./admin-user.repository.ts`).
 *
 * Contains the safe-column projection shape, the filter WHERE-chain
 * builder, and the two scalar subselects used by both the directory
 * list and the detail projections. Extracted for file-size budget;
 * behavior is byte-identical to the pre-extraction definitions.
 */
import { and, eq, gt, ilike, isNotNull, isNull, lte, or, type SQL, sql } from "drizzle-orm";
import type { NormalizedAdminUserFilters } from "@/backend/db/repo/admin/admin-user-row-types";
import { subscriptions } from "@/backend/db/schema/billing/subscriptions";
import { students } from "@/backend/db/schema/students/students";
import { applicants } from "@/backend/db/schema/teachers/applicants";
import { users } from "@/backend/db/schema/users/users";
import { ApplicantCooldownState } from "@/backend/enum/teachers/applicant-cooldown-state.enum";
import { AdminUserGovernanceFilter } from "@/backend/enum/users/admin-user-governance-filter.enum";

/**
 * The canonical "expiring soon" window for the applicant-cooldown lifecycle,
 * in days. ONE definition feeds BOTH consumers that reason about the window:
 *  - `buildFilterChain`'s `cooldownExpiringSoon` arm (the directory narrow
 *    the dashboard KPI deep-links into), and
 *  - `AdminUserRepository.getCooldownLifecycleStats`'s `expiringSoonCount`
 *    (the dashboard KPI itself),
 *
 * so the panel count and the filtered listing can never disagree about what
 * "expiring soon" means. The number is deliberately NOT part of the wire
 * vocabulary (no enum/string leak) — UI copy localizes the window via the
 * shared day-count pluralizers with this same value.
 */
export const COOLDOWN_EXPIRING_SOON_DAYS = 7;

/**
 * Explicit safe-column selection over `users` — `passwordHash` is
 * structurally absent from every projection that uses this shape. The
 * shape mirrors `AdminUserSafeSelect` (`Omit<UserSelectType,
 * "passwordHash">`) at the Drizzle column-pick layer; the structural
 * absence is enforced by the projection itself, not by a runtime
 * post-filter. Drizzle's `.returning(SAFE_USER_SELECT)` infers a return
 * shape that is structurally identical to `AdminUserSafeSelect`, so the
 * service consumes it directly.
 */
export const SAFE_USER_SELECT = {
  id: users.id,
  fullName: users.fullName,
  email: users.email,
  phone: users.phone,
  role: users.role,
  dateOfBirth: users.dateOfBirth,
  gender: users.gender,
  country: users.country,
  isDeleted: users.isDeleted,
  deletedAt: users.deletedAt,
  suspended: users.suspended,
  suspendedAt: users.suspendedAt,
  suspendedPeriodDays: users.suspendedPeriodDays,
  isBlocked: users.isBlocked,
  blockedAt: users.blockedAt,
  lastActiveAt: users.lastActiveAt,
  locale: users.locale,
  createdAt: users.createdAt,
  updatedAt: users.updatedAt,
} as const;

/**
 * Builds the ANDed WHERE chain from normalized filters.
 *
 * Filters are independent ANDed predicates; absent or null members are
 * skipped (the directory falls back to the unfiltered listing rather
 * than erroring). The `searchPattern` is bound directly to two `ilike`
 * predicates — one over `fullName`, one over `email` — joined by `OR`
 * so a single search term matches either column. No string
 * interpolation; the pattern is Drizzle-parameterized.
 *
 * Governance filter resolution (null-safe under three-valued SQL logic):
 *  - `Active`    → user is not deleted, not suspended, not blocked
 *                  (NULL-state columns coalesce to "not set" — reads as
 *                  active for legacy rows that pre-date the notNull()
 *                  tightening).
 *  - `Suspended` → `suspended = true`.
 *  - `Blocked`   → `is_blocked = true`.
 *  - `Deleted`   → `is_deleted = true` (NULL-state rows are excluded —
 *                  a legacy NULL row reads as "active", not "deleted",
 *                  per the null-safe read discipline).
 *
 * Applicant-lifecycle filter resolution (the `applicants` row is the
 * shared-PK child of `users` — the LEFT JOIN must be present in every
 * query that runs this chain, which `listDirectory` and `countDirectory`
 * both guarantee):
 *  - `applicantStatus` → `applicants.status = value`; non-applicant rows
 *    carry a NULL status under the LEFT JOIN and drop out.
 *  - `cooldownState`   → the three arms mirror the wire derivation
 *    (`deriveCooldownState`, the shared strict-`>` boundary) predicate
 *    for predicate, each against ONE captured `now` per chain build —
 *    the same captured-now discipline the directory mapper applies per
 *    row, so a filtered result set can never disagree with the cooldown
 *    chip rendered beside it:
 *    - `Active`  → a stamped instant strictly in the future.
 *    - `Expired` → a stamped instant at or before `now` (the boundary
 *      instant itself is already expired — no longer gating).
 *    - `None`    → an applicants row (status NOT NULL) with NO cooldown
 *      stamped. Every arm — including `None` — excludes non-applicant
 *      rows, mirroring the wire field's null-for-non-applicants shape.
 *    Both instants bind as Drizzle parameters (never SQL `now()`), so
 *    the statement stays engine-portable per the repository header.
 */
export function buildFilterChain(filters: NormalizedAdminUserFilters): SQL | undefined {
  // ONE captured `now` for the ENTIRE chain — every cooldown predicate
  // (the three lifecycle-state arms and the expiring-soon window) reads the
  // same instant, so all cooldown predicates in a single query are mutually
  // consistent and the filtered result set can never disagree with the
  // cooldown chip rendered beside a row.
  const now = new Date();
  const conditions: SQL[] = [];
  if (filters.role) {
    conditions.push(eq(users.role, filters.role));
  }
  if (filters.governance) {
    switch (filters.governance) {
      case AdminUserGovernanceFilter.Active:
        conditions.push(or(eq(users.isDeleted, false), isNull(users.isDeleted)) ?? sql`false`);
        conditions.push(or(eq(users.suspended, false), isNull(users.suspended)) ?? sql`false`);
        conditions.push(or(eq(users.isBlocked, false), isNull(users.isBlocked)) ?? sql`false`);
        break;
      case AdminUserGovernanceFilter.Suspended:
        conditions.push(eq(users.suspended, true));
        break;
      case AdminUserGovernanceFilter.Blocked:
        conditions.push(eq(users.isBlocked, true));
        break;
      case AdminUserGovernanceFilter.Deleted:
        conditions.push(eq(users.isDeleted, true));
        break;
    }
  }
  if (filters.country) {
    conditions.push(eq(users.country, filters.country));
  }
  if (filters.searchPattern) {
    conditions.push(
      or(ilike(users.fullName, filters.searchPattern), ilike(users.email, filters.searchPattern)) ?? sql`false`
    );
  }
  if (filters.applicantStatus) {
    conditions.push(eq(applicants.status, filters.applicantStatus));
  }
  if (filters.cooldownState) {
    switch (filters.cooldownState) {
      case ApplicantCooldownState.Active:
        conditions.push(and(isNotNull(applicants.cooldownUntil), gt(applicants.cooldownUntil, now)) ?? sql`false`);
        break;
      case ApplicantCooldownState.Expired:
        conditions.push(and(isNotNull(applicants.cooldownUntil), lte(applicants.cooldownUntil, now)) ?? sql`false`);
        break;
      case ApplicantCooldownState.None:
        // Wire semantics: the state derives only for rows with an
        // applicants child — the status-NOT-NULL half reproduces that
        // gate so non-applicant rows never match the `none` arm.
        conditions.push(and(isNotNull(applicants.status), isNull(applicants.cooldownUntil)) ?? sql`false`);
        break;
    }
  }
  if (filters.cooldownExpiringSoon === true) {
    // The expiring-soon window arm — the time-window narrow the dashboard
    // lifecycle panel deep-links into. An applicant is "expiring soon"
    // when its stamped cooldown is strictly in the future (the SAME
    // active-boundary predicate the `Active` state arm applies) AND lands
    // within the canonical window (inclusive upper bound — a cooldown
    // expiring exactly at now + 7d is still "expiring soon"). Composable
    // with every other filter (typically `cooldownState = Active`, which
    // the panel's deep-link sets so the chips and the rows tell one
    // story); standalone it reads as the same slice without the state
    // narrow. Bounds bind as Drizzle parameters — never SQL `now() +
    // interval` — per the engine-portability discipline.
    const soonCutoff = new Date(now.getTime() + COOLDOWN_EXPIRING_SOON_DAYS * 24 * 60 * 60 * 1000);
    conditions.push(
      and(
        isNotNull(applicants.cooldownUntil),
        gt(applicants.cooldownUntil, now),
        lte(applicants.cooldownUntil, soonCutoff)
      ) ?? sql`false`
    );
  }
  if (conditions.length === 0) {
    return undefined;
  }
  if (conditions.length === 1) {
    return conditions[0];
  }
  return and(...conditions) ?? sql`true`;
}

/**
 * Scalar subselect — count of `students` rows whose `parent_id` points
 * at the current `users.id`. Used as the parent-role headline in the
 * directory list and detail projections (never a JOIN — a JOIN would
 * fan out the parent row into N student rows; the scalar subselect
 * keeps the row count at one per user).
 */
export function parentLinkedChildrenCountSubquery(): SQL.Aliased<number> {
  return sql<number>`(
    SELECT count(*)::int
    FROM ${students}
    WHERE ${students.parentId} = ${users.id}
  )`.as("parent_linked_children_count");
}

/**
 * Scalar subselect — true iff a row exists in `subscriptions` for the
 * current `users.id` whose `status` is `'active'` AND whose
 * `start_date`/`end_date` window covers `now()` (or is open-ended in
 * either direction). Used as the student-role subscription headline —
 * never a JOIN, never a balance touch (the student's balance columns
 * are read-only at this surface and surfaced separately in the detail
 * projection).
 */
export function studentHasActiveSubscriptionSubquery(): SQL.Aliased<boolean> {
  return sql<boolean>`EXISTS(
    SELECT 1
    FROM ${subscriptions}
    WHERE ${subscriptions.userId} = ${users.id}
      AND ${subscriptions.status} = 'active'
      AND now() >= coalesce(${subscriptions.startDate}, now())
      AND (${subscriptions.endDate} IS NULL OR now() < ${subscriptions.endDate})
  )`.as("student_has_active_subscription");
}
