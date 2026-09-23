/**
 * StudentRepository admin student directory read — the paginated
 * `students` ⨝ `users` directory listing with its filter-chain builder,
 * extracted from `student.repository.ts` following the sibling
 * `student.repository.zero-lane.helpers.ts` extraction convention: the
 * public surface stays the `StudentRepository` namespace in
 * `student.repository.ts` (this module backs the namespace's
 * `listDirectory` method as a one-to-one delegation target). The two
 * directory contracts (`NormalizedAdminStudentFilters`,
 * `AdminStudentDirectoryRow`) live here and are re-exported from
 * `student.repository.ts` verbatim, so their public import path is
 * unchanged; the filter-chain builder and the aliased parent join handle
 * are private to this module.
 *
 * Conventions carried over unchanged (per `backend/db/repo/AGENTS.md`):
 *  - the read takes `tx?: DBTransaction` as its LAST parameter and runs
 *    inside the caller's transaction when supplied, or standalone against
 *    the global handle otherwise;
 *  - no business logic, no permission checks, no i18n or logging — rows
 *    are returned faithfully; the service layer owns filter governance
 *    and maps rows to `AdminStudentItemReturnType`.
 */

import { and, desc, eq, ilike, isNotNull, isNull, or, type SQL, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/backend/db";
import { students } from "@/backend/db/schema/students/students";
import { users } from "@/backend/db/schema/users/users";
import type { DBTransaction } from "@/backend/types";

/**
 * Aliased `users` handle for the admin student directory's parent join —
 * resolves the linked parent's display identity WITHOUT colliding with the
 * student's own `users` row in the same statement.
 */
const directoryParentUser = alias(users, "directory_parent_user");

/**
 * `NormalizedAdminStudentFilters` — repo-internal filter shape for the
 * admin student directory listing.
 *
 * The service layer normalizes a transport-shape
 * `AdminStudentFiltersSubmitInput` into this structure before calling the
 * repo:
 *  - `searchPattern` is the search substring AFTER `escapeLikeWildcards`
 *    has been applied AND after the result has been wrapped as `%…%`.
 *    The repo binds this directly to its `ilike(column, pattern)`
 *    predicates — never re-escaping or re-wrapping (one canonical escape
 *    point at the service, one binding point at the repo).
 *  - `hasParent` filters on the `parent_id` link state (`null` = no
 *    constraint — the member drops out of the WHERE chain).
 *  - `language` is the trimmed target language; the repo matches it
 *    case-insensitively (exact, parameterized) against the student's
 *    primary OR secondary language columns.
 */
export interface NormalizedAdminStudentFilters {
  readonly searchPattern?: string | null;
  readonly hasParent?: boolean | null;
  readonly language?: string | null;
}

/**
 * `AdminStudentDirectoryRow` — raw DB row shape returned by `listDirectory`
 * (users INNER JOIN students on the shared PK, LEFT JOIN users-as-parent on
 * `students.parent_id`). The nullable-with-default schema columns preserve
 * their `| null` select types; the service layer null-coalesces the
 * balances and derives the `hasParent` headline at projection time.
 */
export interface AdminStudentDirectoryRow {
  readonly id: number;
  readonly name: string;
  readonly email: string;
  readonly phone: string | null;
  readonly country: string | null;
  readonly balanceHifz: number | null;
  readonly balanceReviews: number | null;
  readonly balanceTajweed: number | null;
  readonly balanceTrial: number;
  readonly trialGrantedAt: Date | null;
  readonly primaryLanguage: string | null;
  readonly anotherLanguage: string | null;
  readonly parentId: number | null;
  readonly parentName: string | null;
  readonly parentEmail: string | null;
  readonly createdAt: Date;
}

/**
 * Builds the ANDed WHERE chain from the normalized student-directory
 * filters. Absent or null members are skipped (the directory falls back to
 * the unfiltered listing rather than erroring). The `searchPattern` is
 * bound directly to two `ilike` predicates — one over the user's full
 * name, one over the email — joined by `OR` so a single search term
 * matches either column. The `language` filter is a case-insensitive exact
 * match (parameterized `lower(...)` equality — never LIKE) over the
 * primary OR secondary language column. No string interpolation; every
 * value is Drizzle-parameterized.
 */
function buildStudentDirectoryFilterChain(filters: NormalizedAdminStudentFilters): SQL | undefined {
  const conditions: SQL[] = [];
  if (filters.searchPattern) {
    conditions.push(
      or(ilike(users.fullName, filters.searchPattern), ilike(users.email, filters.searchPattern)) ?? sql`false`
    );
  }
  if (filters.hasParent !== null && filters.hasParent !== undefined) {
    conditions.push(filters.hasParent ? isNotNull(students.parentId) : isNull(students.parentId));
  }
  if (filters.language) {
    conditions.push(
      or(
        sql`lower(${students.primaryLanguage}) = lower(${filters.language})`,
        sql`lower(${students.anotherLanguage}) = lower(${filters.language})`
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
 * Lists the admin student directory: `students` rows INNER JOINed to
 * their `users` accounts on the shared PK, with the linked parent's
 * display identity resolved via a LEFT JOIN on `users`-as-parent
 * (`students.parent_id`) — an unlinked student keeps its row with null
 * parent columns. Ordered newest-account-first (deterministic
 * `created_at DESC, id DESC` so consecutive pages never duplicate or
 * drop a row inserted mid-pagination).
 *
 * Directory filters are dynamic AND chains of scalar predicates — no
 * prepared statements (no reuse win, per repo policy), no `inArray`. The
 * search pattern arrives already escaped + `%…%`-wrapped from the service
 * layer and is bound as a Drizzle parameter.
 *
 * Runs the page query and the same-filter `count(*)` in one round-trip
 * pair so the caller can surface an honest `total` — an out-of-range
 * page yields an empty `rows` array with the unchanged count (never an
 * error, never clamped results). The parent join is page-query-only: no
 * directory filter references the parent alias, so the count runs over
 * the student⊕user join alone.
 *
 * @returns The raw directory rows plus the unfiltered-by-page total (NOT
 *          the return type — the service layer maps rows →
 *          `AdminStudentItemReturnType`).
 */
export async function listDirectory(
  filters: NormalizedAdminStudentFilters,
  limit: number,
  offset: number,
  tx?: DBTransaction
): Promise<{ rows: AdminStudentDirectoryRow[]; total: number }> {
  const where = buildStudentDirectoryFilterChain(filters);
  const select = {
    id: users.id,
    name: users.fullName,
    email: users.email,
    phone: users.phone,
    country: users.country,
    balanceHifz: students.balanceHifz,
    balanceReviews: students.balanceReviews,
    balanceTajweed: students.balanceTajweed,
    balanceTrial: students.balanceTrial,
    trialGrantedAt: students.trialGrantedAt,
    primaryLanguage: students.primaryLanguage,
    anotherLanguage: students.anotherLanguage,
    parentId: students.parentId,
    parentName: directoryParentUser.fullName,
    parentEmail: directoryParentUser.email,
    createdAt: users.createdAt,
  } as const;
  const [rows, countRows] = await Promise.all([
    (tx ?? db)
      .select(select)
      .from(students)
      .innerJoin(users, eq(users.id, students.id))
      .leftJoin(directoryParentUser, eq(directoryParentUser.id, students.parentId))
      .where(where)
      .orderBy(desc(users.createdAt), desc(users.id))
      .limit(limit)
      .offset(offset),
    (tx ?? db)
      .select({ count: sql<number>`count(*)::int`.as("count") })
      .from(students)
      .innerJoin(users, eq(users.id, students.id))
      .where(where),
  ]);
  return { rows, total: countRows[0]?.count ?? 0 };
}
