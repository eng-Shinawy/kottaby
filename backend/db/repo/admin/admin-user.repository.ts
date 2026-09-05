/**
 * AdminUserRepository — data-access layer for the admin user directory.
 *
 * Conventions per `backend/db/repo/AGENTS.md`:
 *  - All methods take `tx?: DBTransaction` as the OPTIONAL-LAST parameter.
 *    Reads branch on the supplied executor (`tx` when supplied, the global
 *    `db` handle when not); writes branch identically. The Drizzle builder
 *    API is shared by both `db` and `tx` so the same chain runs on either.
 *  - No prepared statements: directory filters are dynamic AND chains of
 *    scalar predicates (no `inArray`); writes are excluded from
 *    prepared-statement candidacy by repo policy.
 *  - No business logic, no permission checks, no localized strings — the
 *    service layer translates raw outcomes into typed `DomainError`s.
 *  - No `passwordHash` in any projection: read paths use an explicit
 *    `.select({...})` shape that omits the column; write paths use an
 *    explicit `.returning({...})` shape that omits it. The structural
 *    absence is enforced at the Drizzle column-pick layer (never at the
 *    type-system-only layer).
 *
 * Search sanitization boundary:
 *  - The directory search filter is the ONLY injection-sensitive surface.
 *    The service layer MUST escape LIKE wildcards (`escapeLikeWildcards`
 *    from `@/backend/lib/db`) AND wrap the escaped substring as `%…%`
 *    BEFORE composing the `AdminUserFiltersSubmitInput` →
 *    `NormalizedAdminUserFilters` map. The repo receives the final
 *    escaped AND `%…%`-wrapped pattern string in
 *    `NormalizedAdminUserFilters.searchPattern` and binds it directly
 *    to the `ilike(column, pattern)` predicate — never re-escaping or
 *    re-wrapping. A second sanitizer in the repo would diverge over time
 *    and re-open the wildcard-injection surface; the contract is one
 *    canonical escape point (the service) + one canonical binding point
 *    (the repo's `ilike`).
 *
 * File layout (size-budget split, zero behavior change):
 *  - `./admin-user-row-types` — raw DB row shapes + normalized filter type.
 *  - `./admin-user-query-helpers` — safe-column projection shape, WHERE-chain
 *    builder, and the two scalar subselects.
 */
import { and, asc, desc, eq, isNull, or, sql } from "drizzle-orm";
import { db, queryDb } from "@/backend/db";
import {
  buildFilterChain,
  parentLinkedChildrenCountSubquery,
  SAFE_USER_SELECT,
  studentHasActiveSubscriptionSubquery,
} from "@/backend/db/repo/admin/admin-user-query-helpers";
import type {
  AdminUserActivityRow,
  AdminUserDetailRow,
  AdminUserDirectoryRow,
  AdminUserStatsRow,
  NormalizedAdminUserFilters,
} from "@/backend/db/repo/admin/admin-user-row-types";
import { auditLogs } from "@/backend/db/schema/audit/audit-logs";
import { parents } from "@/backend/db/schema/parents/parents";
import { students } from "@/backend/db/schema/students/students";
import { applicants } from "@/backend/db/schema/teachers/applicants";
import { teacher } from "@/backend/db/schema/teachers/teacher";
import { users } from "@/backend/db/schema/users/users";
import type {
  AdminUserSafeSelect,
  AdminUserUpdateDbPatch,
  DBQueryExecutor,
  DBTransaction,
  GovernanceProbeRowType,
} from "@/backend/types";

/**
 * Type guard — narrows `DBQueryExecutor` to a Drizzle-backed executor that
 * exposes the `.select()` builder API. `DBTransaction` (Drizzle's
 * `PgAsyncTransaction`) and the global `db` instance both expose `.select()`;
 * raw `Pool` / `PoolClient` from `pg` do not. The probe read uses this guard
 * to branch between the transactional Drizzle path and the cold-path
 * `queryDb` raw-parameterized-SQL path (Neon HTTP fast path when eligible).
 * Mirrors the canonical pattern in `user.repository.ts` and
 * `plan.repository.ts`.
 */
function isDBTransaction(tx: DBQueryExecutor): tx is DBTransaction {
  return typeof tx === "object" && "select" in tx;
}

/**
 * Row-type re-exports keep the deep import path
 * `@/backend/db/repo/admin/admin-user.repository` stable for existing
 * consumers (the service layer) after the row shapes moved to
 * `./admin-user-row-types`. Type-only forwarding — no runtime surface.
 */
export type {
  AdminUserActivityRow,
  AdminUserDetailRow,
  AdminUserDirectoryRow,
  AdminUserStatsRow,
  NormalizedAdminUserFilters,
} from "@/backend/db/repo/admin/admin-user-row-types";

export namespace AdminUserRepository {
  /**
   * Lists directory rows by filter + page bounds.
   *
   * Single query: `users LEFT JOIN applicants/teacher/students` (shared-PK)
   * plus scalar subselects for the parent headline (children count) and
   * the student subscription headline (EXISTS). The LEFT JOINs preserve
   * all users rows (only the matching role-child columns surface per
   * row); the scalar subselects prevent 1:M fan-out so each user row
   * appears exactly once.
   *
   * Ordering: `created_at ASC, id ASC` — deterministic so consecutive
   * pages never duplicate or drop a row inserted mid-pagination (a
   * keyset refinement is a documented future improvement, not shipped
   * here).
   *
   * @returns The raw directory rows (NOT the directory return type —
   *          the service layer maps rows → `AdminUserListItemReturnType`
   *          by null-coalescing governance booleans and guard-validating
   *          stored applicant status). An out-of-range page yields an
   *          empty array (the service layer surfaces the honest
   *          `totalCount` alongside).
   */
  export async function listDirectory(
    filters: NormalizedAdminUserFilters,
    limit: number,
    offset: number,
    tx?: DBTransaction
  ): Promise<AdminUserDirectoryRow[]> {
    const where = buildFilterChain(filters);
    const select = {
      id: users.id,
      fullName: users.fullName,
      email: users.email,
      phone: users.phone,
      role: users.role,
      gender: users.gender,
      dateOfBirth: users.dateOfBirth,
      country: users.country,
      isDeleted: users.isDeleted,
      suspended: users.suspended,
      isBlocked: users.isBlocked,
      lastActiveAt: users.lastActiveAt,
      createdAt: users.createdAt,
      applicantStatus: applicants.status,
      teacherIsApproved: teacher.isApproved,
      teacherIsEvaluator: teacher.isEvaluator,
      studentHasParentLink: sql<boolean>`${students.parentId} IS NOT NULL`.as("student_has_parent_link"),
      studentHasActiveSubscription: studentHasActiveSubscriptionSubquery(),
      parentLinkedChildrenCount: parentLinkedChildrenCountSubquery(),
    } as const;
    const rows = await (tx ?? db)
      .select(select)
      .from(users)
      .leftJoin(applicants, eq(applicants.id, users.id))
      .leftJoin(teacher, eq(teacher.id, users.id))
      .leftJoin(students, eq(students.id, users.id))
      .where(where)
      .orderBy(asc(users.createdAt), asc(users.id))
      .limit(limit)
      .offset(offset);
    return rows;
  }

  /**
   * Counts directory rows by the same filter chain (no joins, no scalar
   * subselects). The service layer pairs this with `listDirectory` to
   * surface an honest `totalCount` — out-of-range pages return an empty
   * `items` array with the unchanged count (never an error, never
   * clamped results).
   */
  export async function countDirectory(filters: NormalizedAdminUserFilters, tx?: DBTransaction): Promise<number> {
    const where = buildFilterChain(filters);
    const rows = await (tx ?? db)
      .select({ count: sql<number>`count(*)::int`.as("count") })
      .from(users)
      .where(where);
    return rows[0]?.count ?? 0;
  }

  /**
   * Resolves the directory-wide aggregate counters for the admin overview
   * strip in a SINGLE round-trip — one `SELECT count(*) + FILTERED count(*)`
   * aggregate over `users` (no JOINs, no GROUP BY, no pagination).
   *
   * Governance resolution mirrors `buildFilterChain` exactly (null-safe
   * under three-valued SQL logic — a legacy NULL-state column reads as
   * "active"): `activeCount` requires NOT deleted AND NOT suspended AND
   * NOT blocked with NULL-coalescing; the three negative counters are
   * plain `= true` filtered counts. The governance counters are FILTERED
   * counts and MAY overlap (a suspended-and-deleted user increments both
   * buckets); the role counters partition `totalCount` exactly.
   *
   * `newThisWeekCount` filters on `created_at > cutoff` where the cutoff
   * (now minus 7 days) is computed in JS and bound as a Drizzle parameter —
   * never SQL `now() - interval` so the statement stays engine-portable
   * (PostgreSQL + SQLite both bind the parameterized timestamp natively).
   *
   * @returns The aggregate row (members are `::int`-cast counts; the
   *          empty-table edge case still yields one row of zeros because
   *          bare aggregates always return exactly one row).
   */
  export async function getStats(tx?: DBTransaction): Promise<AdminUserStatsRow> {
    const newThisWeekCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const rows = await (tx ?? db)
      .select({
        totalCount: sql<number>`count(*)::int`.as("total_count"),
        activeCount: sql<number>`count(*) filter (
          where coalesce(${users.isDeleted}, false) = false
            and coalesce(${users.suspended}, false) = false
            and coalesce(${users.isBlocked}, false) = false
        )::int`.as("active_count"),
        suspendedCount: sql<number>`count(*) filter (where ${users.suspended} = true)::int`.as("suspended_count"),
        blockedCount: sql<number>`count(*) filter (where ${users.isBlocked} = true)::int`.as("blocked_count"),
        deletedCount: sql<number>`count(*) filter (where ${users.isDeleted} = true)::int`.as("deleted_count"),
        adminsCount: sql<number>`count(*) filter (where ${users.role} = 'admin')::int`.as("admins_count"),
        teachersCount: sql<number>`count(*) filter (where ${users.role} = 'teacher')::int`.as("teachers_count"),
        studentsCount: sql<number>`count(*) filter (where ${users.role} = 'student')::int`.as("students_count"),
        parentsCount: sql<number>`count(*) filter (where ${users.role} = 'parent')::int`.as("parents_count"),
        newThisWeekCount: sql<number>`count(*) filter (where ${users.createdAt} > ${newThisWeekCutoff})::int`.as(
          "new_this_week_count"
        ),
      })
      .from(users);
    const row = rows[0];
    return {
      totalCount: row?.totalCount ?? 0,
      activeCount: row?.activeCount ?? 0,
      suspendedCount: row?.suspendedCount ?? 0,
      blockedCount: row?.blockedCount ?? 0,
      deletedCount: row?.deletedCount ?? 0,
      adminsCount: row?.adminsCount ?? 0,
      teachersCount: row?.teachersCount ?? 0,
      studentsCount: row?.studentsCount ?? 0,
      parentsCount: row?.parentsCount ?? 0,
      newThisWeekCount: row?.newThisWeekCount ?? 0,
    };
  }

  /**
   * Resolves the per-user "recent activity" timeline: `audit_logs` rows
   * WHERE `entity_type = 'user' AND entity_id = :userId` (actions
   * performed ON the account), newest-first, capped at `limit`.
   *
   * Single-round-trip INNER JOIN over `users` resolves the acting admin's
   * display name (the `actor_id` FK is NOT NULL RESTRICT, so the join
   * never drops rows and never orphans an entry). The deterministic
   * tiebreak on `id DESC` keeps same-timestamp entries (batch mutations
   * share a transaction timestamp) in a stable insertion-latest order.
   *
   * The `entity_type = 'user'` literal is the canonical audit entity label
   * written by this feature's mutations (`AUDIT_ENTITY_TYPE` in the
   * service layer); the read-back binds the same literal so the timeline
   * and the writer can never drift apart.
   *
   * @param userId  The target user's id (activity ABOUT this account).
   * @param limit   Maximum entries to return (1..50; the resolver clamps).
   * @param tx      Optional transaction executor.
   * @returns Rows newest-first; empty array when the user has no recorded
   *          activity (including when the user id itself does not exist —
   *          existence is the service layer's concern, not the repo's).
   */
  export async function getActivity(
    userId: number,
    limit: number,
    tx?: DBTransaction
  ): Promise<AdminUserActivityRow[]> {
    return (tx ?? db)
      .select({
        id: auditLogs.id,
        actionType: auditLogs.actionType,
        actorName: users.fullName,
        details: auditLogs.details,
        createdAt: auditLogs.createdAt,
      })
      .from(auditLogs)
      .innerJoin(users, eq(users.id, auditLogs.actorId))
      .where(and(eq(auditLogs.entityType, "user"), eq(auditLogs.entityId, userId)))
      .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
      .limit(limit);
  }

  /**
   * Resolves the full detail projection for one user by id.
   *
   * Single-row LEFT JOIN across all four role-child tables (shared-PK)
   * plus scalar subselects for the parent headline and the student
   * subscription headline. The role-child columns are nullable per
   * absent row so the same shape serves all four roles.
   *
   * @returns The raw detail row, or `null` when no user matches the
   *          supplied id (the service layer raises `USER_NOT_FOUND`
   *          from this null).
   */
  export async function findDetailById(id: number, tx?: DBTransaction): Promise<AdminUserDetailRow | null> {
    const select = {
      ...SAFE_USER_SELECT,
      applicantStatus: applicants.status,
      applicantVerificationAttempts: applicants.verificationAttempts,
      applicantLastAttemptAt: applicants.lastAttemptAt,
      applicantCooldownUntil: applicants.cooldownUntil,
      teacherIsApproved: teacher.isApproved,
      teacherIsEvaluator: teacher.isEvaluator,
      teacherIsOnline: teacher.isOnline,
      teacherAverageRating: teacher.averageRating,
      studentHandshakeCode: students.handshakeCode,
      studentParentId: students.parentId,
      studentPrimaryLanguage: students.primaryLanguage,
      studentAnotherLanguage: students.anotherLanguage,
      studentBalanceHifz: students.balanceHifz,
      studentBalanceTajweed: students.balanceTajweed,
      studentBalanceReviews: students.balanceReviews,
      parentRowExists: sql<boolean>`${parents.id} IS NOT NULL`.as("parent_row_exists"),
      parentLinkedChildrenCount: parentLinkedChildrenCountSubquery(),
      studentHasActiveSubscription: studentHasActiveSubscriptionSubquery(),
    } as const;
    const executor = tx ?? db;
    const rows = await executor
      .select(select)
      .from(users)
      .leftJoin(applicants, eq(applicants.id, users.id))
      .leftJoin(teacher, eq(teacher.id, users.id))
      .leftJoin(students, eq(students.id, users.id))
      .leftJoin(parents, eq(parents.id, users.id))
      .where(eq(users.id, id))
      .limit(1);
    const row = rows[0];
    return row ?? null;
  }

  /**
   * Applies a whitelisted profile patch to one user by id.
   *
   * Single guarded `UPDATE` with an explicit `RETURNING` shape that
   * structurally omits `passwordHash`. The patch is the repo-internal
   * `AdminUserUpdateDbPatch` (the service layer built it field-by-field
   * — never via spread — so only touched columns land in the SET
   * clause). The server stamps `updatedAt` to `now()` so the column
   * never relies on the caller's clock.
   *
   * @returns The post-write safe row, or `null` when zero rows matched
   *          (the service layer raises `USER_NOT_FOUND` from this
   *          null).
   */
  export async function updateProfileFields(
    id: number,
    patch: AdminUserUpdateDbPatch,
    tx?: DBTransaction
  ): Promise<AdminUserSafeSelect | null> {
    const [row] = await (tx ?? db)
      .update(users)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning(SAFE_USER_SELECT);
    return row ?? null;
  }

  /**
   * Single guarded `UPDATE` that flips `is_deleted` (and the matching
   * `deleted_at` / `updated_at` columns) for one user — a one-statement
   * atomic transition that holds a row lock for the duration of the
   * predicate evaluation.
   *
   * The WHERE predicate uses NULL-safe inverse-state guards so a legacy
   * NULL row reads correctly under three-valued SQL logic:
   *  - delete (target = true):  `is_deleted = false OR is_deleted IS NULL`
   *  - reactivate (target = false): `is_deleted = true`
   *
   * Two concurrent deletes of the same row therefore serialize: the
   * first flips the state; the second's predicate no longer matches
   * (because `is_deleted` is now `true`, not `false`/NULL) and the
   * statement returns zero rows — the service layer translates that
   * into the typed conflict (`USER_ALREADY_DELETED`) via a follow-up
   * `existsById` probe.
   *
   * @returns The post-write safe row, or `null` when zero rows matched
   *          (the service layer disambiguates USER_NOT_FOUND vs the
   *          typed CONFLICT via `existsById`).
   */
  export async function setDeletedOnce(
    id: number,
    target: boolean,
    tx?: DBTransaction
  ): Promise<AdminUserSafeSelect | null> {
    const [row] = await (tx ?? db)
      .update(users)
      .set({
        isDeleted: target,
        deletedAt: target ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(users.id, id),
          target ? (or(eq(users.isDeleted, false), isNull(users.isDeleted)) ?? sql`false`) : eq(users.isDeleted, true)
        ) ?? sql`false`
      )
      .returning(SAFE_USER_SELECT);
    return row ?? null;
  }

  /**
   * Cold-path existence probe. Called by the service layer ONLY when a
   * guarded mutation returned zero rows — to disambiguate
   * `USER_NOT_FOUND` (the id never existed) from the typed conflict
   * (the id exists but is in the wrong state for the requested
   * transition). The probe is intentionally lightweight (columnless
   * EXISTS) and never re-reads sensitive columns.
   *
   * @returns `true` if a row with the given id exists; `false` otherwise.
   *          Soft-deleted rows still report `true` (existence is
   *          distinct from active state).
   */
  export async function existsById(id: number, tx?: DBTransaction): Promise<boolean> {
    const q = tx ?? db;
    const rows = await q
      .select({ one: sql<number>`1`.as("one") })
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    return rows.length > 0;
  }

  /**
   * Single guarded `UPDATE` that flips `suspended` (and the matching
   * `suspended_at` / `suspended_period_days` / `updated_at` columns)
   * for one user — a one-statement atomic transition that holds a row
   * lock for the duration of the predicate evaluation.
   *
   * The WHERE predicate uses NULL-safe inverse-state guards so a legacy
   * NULL row reads correctly under three-valued SQL logic:
   *  - suspend (target = true):    `(suspended = false OR suspended IS NULL)
   *                                 AND (is_deleted = false OR is_deleted IS NULL)`
   *  - unsuspend (target = false): `suspended = true
   *                                 AND (is_deleted = false OR is_deleted IS NULL)`
   *
   * `periodDays` is persisted ONLY in the suspend direction; the unsuspend
   * direction clears `suspended_period_days` to NULL regardless of the
   * caller-supplied value (clearing all three columns atomically). The
   * service layer validates `periodDays ∈ 1..3650` BEFORE invoking this
   * repo method; the repo persists what it is given without re-validation.
   *
   * Two concurrent suspends of the same row therefore serialize: the
   * first flips the state; the second's predicate no longer matches
   * (because `suspended` is now `true`, not `false`/NULL) and the
   * statement returns zero rows — the service layer translates that
   * into the typed conflict (`USER_ALREADY_SUSPENDED` /
   * `USER_NOT_SUSPENDED` / `USER_ALREADY_DELETED` / `USER_NOT_FOUND`)
   * via a follow-up `findGovernanceState` probe.
   *
   * The `tx` parameter is REQUIRED (not optional) on this write: every
   * governance transition MUST run inside a caller-supplied transaction
   * so the audit-log row lands in the SAME tx (no out-of-band writes).
   * The service layer's `withTransaction(outerTx, async tx => …)`
   * wrapper always supplies one.
   *
   * @returns The post-write safe row, or `null` when zero rows matched
   *          (the service layer disambiguates USER_NOT_FOUND vs the
   *          typed CONFLICT via `findGovernanceState`).
   */
  export async function setSuspendedOnce(
    id: number,
    target: boolean,
    periodDays: number | null,
    tx: DBTransaction
  ): Promise<AdminUserSafeSelect | null> {
    const [row] = await (tx ?? db)
      .update(users)
      .set({
        suspended: target,
        suspendedAt: target ? new Date() : null,
        suspendedPeriodDays: target ? periodDays : null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(users.id, id),
          or(eq(users.isDeleted, false), isNull(users.isDeleted)) ?? sql`false`,
          target ? (or(eq(users.suspended, false), isNull(users.suspended)) ?? sql`false`) : eq(users.suspended, true)
        ) ?? sql`false`
      )
      .returning(SAFE_USER_SELECT);
    return row ?? null;
  }

  /**
   * Single guarded `UPDATE` that flips `is_blocked` (and the matching
   * `blocked_at` / `updated_at` columns) for one user — a one-statement
   * atomic transition that holds a row lock for the duration of the
   * predicate evaluation.
   *
   * The WHERE predicate uses NULL-safe inverse-state guards so a legacy
   * NULL row reads correctly under three-valued SQL logic:
   *  - block (target = true):    `(is_blocked = false OR is_blocked IS NULL)
   *                               AND (is_deleted = false OR is_deleted IS NULL)`
   *  - unblock (target = false): `is_blocked = true
   *                               AND (is_deleted = false OR is_deleted IS NULL)`
   *
   * Two concurrent blocks of the same row therefore serialize: the first
   * flips the state; the second's predicate no longer matches (because
   * `is_blocked` is now `true`, not `false`/NULL) and the statement
   * returns zero rows — the service layer translates that into the
   * typed conflict (`USER_ALREADY_BLOCKED` / `USER_NOT_BLOCKED` /
   * `USER_ALREADY_DELETED` / `USER_NOT_FOUND`) via a follow-up
   * `findGovernanceState` probe.
   *
   * The `tx` parameter is REQUIRED (not optional) on this write: every
   * governance transition MUST run inside a caller-supplied transaction
   * so the audit-log row lands in the SAME tx (no out-of-band writes).
   * The service layer's `withTransaction(outerTx, async tx => …)`
   * wrapper always supplies one.
   *
   * @returns The post-write safe row, or `null` when zero rows matched
   *          (the service layer disambiguates USER_NOT_FOUND vs the
   *          typed CONFLICT via `findGovernanceState`).
   */
  export async function setBlockedOnce(
    id: number,
    target: boolean,
    tx: DBTransaction
  ): Promise<AdminUserSafeSelect | null> {
    const [row] = await (tx ?? db)
      .update(users)
      .set({
        isBlocked: target,
        blockedAt: target ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(users.id, id),
          or(eq(users.isDeleted, false), isNull(users.isDeleted)) ?? sql`false`,
          target ? (or(eq(users.isBlocked, false), isNull(users.isBlocked)) ?? sql`false`) : eq(users.isBlocked, true)
        ) ?? sql`false`
      )
      .returning(SAFE_USER_SELECT);
    return row ?? null;
  }

  /**
   * Five-column governance-state probe. Selects ONLY the probe columns
   * (`isDeleted`, `suspended`, `suspendedAt`, `suspendedPeriodDays`,
   * `isBlocked`) — NEVER `passwordHash`, NEVER `*`, NEVER any PII column.
   * The structural absence of `passwordHash` is enforced by the explicit
   * column pick (Drizzle path) and the explicit column list (raw-SQL
   * path); the probe never reads the full row.
   *
   * Used by the service-layer classifier to disambiguate zero-row
   * outcomes from `setSuspendedOnce` and `setBlockedOnce`:
   *  - probe `null`                         → `USER_NOT_FOUND` (the id never existed)
   *  - probe `isDeleted === true`           → `USER_ALREADY_DELETED` (governance
   *                                           holds apply only to live accounts)
   *  - probe axis already in requested state → `USER_ALREADY_SUSPENDED` /
   *                                           `USER_NOT_SUSPENDED` /
   *                                           `USER_ALREADY_BLOCKED` /
   *                                           `USER_NOT_BLOCKED` per direction
   *
   * The probe is read-only and never writes. Accepts a broader
   * `DBQueryExecutor` (transaction OR pool OR pool-client) so it can run
   * inside the classifier's transaction (preferred — same snapshot as
   * the guarded write) OR as a cold-path read (no `tx` supplied — falls
   * back to the global pool via `queryDb`, Neon HTTP fast path when
   * eligible).
   *
   * @returns The five-column probe row, or `null` when no user matches
   *          the supplied id.
   */
  export async function findGovernanceState(id: number, tx?: DBQueryExecutor): Promise<GovernanceProbeRowType | null> {
    if (tx && isDBTransaction(tx)) {
      const [row] = await tx
        .select({
          isDeleted: users.isDeleted,
          suspended: users.suspended,
          suspendedAt: users.suspendedAt,
          suspendedPeriodDays: users.suspendedPeriodDays,
          isBlocked: users.isBlocked,
        })
        .from(users)
        .where(eq(users.id, id))
        .limit(1);
      return row ?? null;
    }
    const result = await queryDb<GovernanceProbeRowType>(
      `SELECT is_deleted AS "isDeleted",
              suspended,
              suspended_at AS "suspendedAt",
              suspended_period_days AS "suspendedPeriodDays",
              is_blocked AS "isBlocked"
       FROM users WHERE id = $1 LIMIT 1`,
      [id]
    );
    return result.rows[0] ?? null;
  }
}
