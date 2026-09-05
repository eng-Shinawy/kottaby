/**
 * Admin user query helpers — shared query-building primitives for the
 * admin user directory repository (`./admin-user.repository.ts`).
 *
 * Contains the safe-column projection shape, the filter WHERE-chain
 * builder, and the two scalar subselects used by both the directory
 * list and the detail projections. Extracted for file-size budget;
 * behavior is byte-identical to the pre-extraction definitions.
 */
import { and, eq, ilike, isNull, or, type SQL, sql } from "drizzle-orm";
import type { NormalizedAdminUserFilters } from "@/backend/db/repo/admin/admin-user-row-types";
import { subscriptions } from "@/backend/db/schema/billing/subscriptions";
import { students } from "@/backend/db/schema/students/students";
import { users } from "@/backend/db/schema/users/users";
import { AdminUserGovernanceFilter } from "@/backend/enum/users/admin-user-governance-filter.enum";

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
 */
export function buildFilterChain(filters: NormalizedAdminUserFilters): SQL | undefined {
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
