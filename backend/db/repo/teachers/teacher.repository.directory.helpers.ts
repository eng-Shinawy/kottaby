/**
 * TeacherRepository admin-directory read implementation — the paginated
 * `teacher` ⨝ `users` admin directory listing (`listDirectory`) with its
 * filter-chain builder and its two directory contracts
 * (`NormalizedAdminTeacherFilters`, `AdminTeacherDirectoryRow`), extracted
 * from `teacher.repository.ts` following the sibling
 * `student.repository.directory.helpers.ts` extraction convention: the
 * public surface stays the `TeacherRepository` namespace (this module backs
 * the namespace's `listDirectory` method as a one-to-one delegation
 * target), and the two contracts are re-exported from `teacher.repository.ts`
 * verbatim, so their public import path is unchanged.
 *
 * Conventions carried over unchanged (per `backend/db/repo/AGENTS.md`):
 *  - the read takes `tx?: DBTransaction` as its LAST parameter and runs
 *    inside the caller's transaction when supplied, or against the global
 *    handle otherwise;
 *  - dynamic AND chains of scalar predicates; the search pattern arrives
 *    finished (escaped + `%…%`-wrapped) from the service's single escape
 *    point and is bound verbatim;
 *  - no business logic, no permission checks, no i18n or logging — the
 *    service layer owns filter governance and maps rows to
 *    `AdminTeacherItemReturnType`.
 */

import { and, desc, eq, ilike, or, type SQL, sql } from "drizzle-orm";
import { db } from "@/backend/db";
import { teacher } from "@/backend/db/schema/teachers/teacher";
import { users } from "@/backend/db/schema/users/users";
import type { DBTransaction } from "@/backend/types";

/**
 * `NormalizedAdminTeacherFilters` — repo-internal filter shape for the
 * admin teacher directory listing.
 *
 * The service layer normalizes a transport-shape
 * `AdminTeacherFiltersSubmitInput` into this structure before calling the
 * repo:
 *  - `searchPattern` is the search substring AFTER `escapeLikeWildcards`
 *    has been applied AND after the result has been wrapped as `%…%`.
 *    The repo binds this directly to its `ilike(column, pattern)`
 *    predicates — never re-escaping or re-wrapping (one canonical escape
 *    point at the service, one binding point at the repo).
 *  - `isApproved` / `isOnline` / `isEvaluator` pass through unchanged
 *    (`null` = no constraint — the member drops out of the WHERE chain).
 */
export interface NormalizedAdminTeacherFilters {
  readonly searchPattern?: string | null;
  readonly isApproved?: boolean | null;
  readonly isOnline?: boolean | null;
  readonly isEvaluator?: boolean | null;
}

/**
 * `AdminTeacherDirectoryRow` — raw DB row shape returned by
 * `listDirectory` (users INNER JOIN teacher on the shared PK). The
 * nullable-with-default schema columns preserve their `| null` select
 * types; the service layer null-coalesces the booleans and parses the
 * decimal rating + subjects JSON at projection time.
 */
export interface AdminTeacherDirectoryRow {
  readonly id: number;
  readonly name: string;
  readonly email: string;
  readonly phone: string | null;
  readonly country: string | null;
  readonly isDeleted: boolean | null;
  readonly suspended: boolean | null;
  readonly isBlocked: boolean | null;
  readonly isApproved: boolean | null;
  readonly isEvaluator: boolean | null;
  readonly averageRating: string | null;
  readonly isOnline: boolean | null;
  readonly subjects: string | null;
  readonly createdAt: Date;
}

/**
 * Builds the ANDed WHERE chain from the normalized teacher-directory
 * filters. Absent or null members are skipped (the directory falls back to
 * the unfiltered listing rather than erroring). The `searchPattern` is
 * bound directly to two `ilike` predicates — one over the user's full
 * name, one over the email — joined by `OR` so a single search term
 * matches either column. No string interpolation; the pattern is
 * Drizzle-parameterized.
 */
function buildTeacherDirectoryFilterChain(filters: NormalizedAdminTeacherFilters): SQL | undefined {
  const conditions: SQL[] = [];
  if (filters.searchPattern) {
    conditions.push(
      or(ilike(users.fullName, filters.searchPattern), ilike(users.email, filters.searchPattern)) ?? sql`false`
    );
  }
  if (filters.isApproved !== null && filters.isApproved !== undefined) {
    conditions.push(eq(teacher.isApproved, filters.isApproved));
  }
  if (filters.isOnline !== null && filters.isOnline !== undefined) {
    conditions.push(eq(teacher.isOnline, filters.isOnline));
  }
  if (filters.isEvaluator !== null && filters.isEvaluator !== undefined) {
    conditions.push(eq(teacher.isEvaluator, filters.isEvaluator));
  }
  if (conditions.length === 0) {
    return undefined;
  }
  if (conditions.length === 1) {
    return conditions[0];
  }
  return and(...conditions) ?? sql`true`;
}

/** The module-level implementation behind `TeacherRepository.listDirectory`. */
/**
 * Lists the admin teacher directory: `teacher` rows INNER JOINed to their
 * `users` accounts on the shared PK, filtered by the normalized filter
 * chain, ordered newest-account-first (deterministic `created_at DESC,
 * id DESC` so consecutive pages never duplicate or drop a row inserted
 * mid-pagination).
 *
 * Directory filters are dynamic AND chains of scalar predicates — no
 * prepared statements (no reuse win, per repo policy), no `inArray`. The
 * search pattern arrives already escaped + `%…%`-wrapped from the service
 * layer and is bound as a Drizzle parameter.
 *
 * Runs the page query and the same-filter `count(*)` in one round-trip
 * pair so the caller can surface an honest `total` — an out-of-range
 * page yields an empty `rows` array with the unchanged count (never an
 * error, never clamped results).
 *
 * @returns The raw directory rows plus the unfiltered-by-page total (NOT
 *          the return type — the service layer maps rows →
 *          `AdminTeacherItemReturnType`).
 */
export async function listDirectory(
  filters: NormalizedAdminTeacherFilters,
  limit: number,
  offset: number,
  tx?: DBTransaction
): Promise<{ rows: AdminTeacherDirectoryRow[]; total: number }> {
  const where = buildTeacherDirectoryFilterChain(filters);
  const select = {
    id: users.id,
    name: users.fullName,
    email: users.email,
    phone: users.phone,
    country: users.country,
    isDeleted: users.isDeleted,
    suspended: users.suspended,
    isBlocked: users.isBlocked,
    isApproved: teacher.isApproved,
    isEvaluator: teacher.isEvaluator,
    averageRating: teacher.averageRating,
    isOnline: teacher.isOnline,
    subjects: teacher.subjects,
    createdAt: users.createdAt,
  } as const;
  const [rows, countRows] = await Promise.all([
    (tx ?? db)
      .select(select)
      .from(teacher)
      .innerJoin(users, eq(users.id, teacher.id))
      .where(where)
      .orderBy(desc(users.createdAt), desc(users.id))
      .limit(limit)
      .offset(offset),
    (tx ?? db)
      .select({ count: sql<number>`count(*)::int`.as("count") })
      .from(teacher)
      .innerJoin(users, eq(users.id, teacher.id))
      .where(where),
  ]);
  return { rows, total: countRows[0]?.count ?? 0 };
}
