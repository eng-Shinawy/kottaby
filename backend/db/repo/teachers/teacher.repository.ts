/**
 * TeacherRepository — data-access layer for the `teacher` role-child table.
 *
 * The `teacher` row shares its PK with `users.id` (FK ON DELETE CASCADE) and
 * exists only for users who passed the verification pipeline; a failed
 * applicant keeps an `applicants` row and never gets a `teacher` row.
 * The row carries the certification flags consumed by the teaching surfaces:
 *  - `is_approved` — the teacher is certified to teach.
 *  - `is_evaluator` — the teacher may evaluate teacher applicants.
 *
 * Booking flows must re-assert `is_approved` against the SAME transaction that
 * later writes the dependent rows, so the flag cannot flip between the check
 * and the write. `lockForCertificationCheck` takes that row lock
 * (`SELECT ... FOR UPDATE`) and holds it for the duration of the caller's
 * transaction.
 *
 * Conventions per `backend/db/repo/AGENTS.md`:
 *  - One `namespace` per repository file; the namespace name is the canonical
 *    export `{Entity}Repository`.
 *  - Plain reads use `queryDb` (raw parameterized SQL) on the non-transactional
 *    branch, mirroring `UserRepository.findById` — Neon HTTP fast path when
 *    eligible, Drizzle select inside a supplied transaction.
 *  - Locking reads belong to the write path: they always run inside a
 *    caller-supplied transaction (a row lock taken outside a transaction is
 *    released when the statement ends, which protects nothing) and therefore
 *    never use prepared statements (`docs/drizzle/prepared-statements.md`).
 *  - Writes are single statements that take a REQUIRED `tx: DBTransaction`
 *    (last param) — they always join the caller's atomic unit of work and
 *    never fall back to the global handle. Insert payloads are built
 *    field-by-field (no spread of caller objects), and the guarded UPDATE
 *    folds its precondition (`is_approved = false`) into the WHERE clause so
 *    the predicate and the mutation are one statement (no TOCTOU window).
 *  - `updateAverageRating` is the cached-average write in that same guarded
 *    single-statement form: row identity in the WHERE clause, a member-built
 *    payload (the already-converted 0-5 decimal-string rating plus
 *    `updated_at`), `RETURNING` the row. The value is an exact decimal
 *    string (Drizzle numeric mode is string-typed — a JS float would
 *    round-trip through float64), the database's
 *    `teacher_average_rating_check` is the final clamp, and a zero-row
 *    result means the id had no teacher row (the caller owns the
 *    semantics).
 *  - No prepared statements on writes; no `inArray`; raw driver errors
 *    (e.g. a duplicate-PK `23505`) surface untranslated — the service layer
 *    owns error mapping.
 *  - No business logic, no permission checks, no i18n or logging imports —
 *    the caller decides what `isApproved = false` or a `null` row means.
 */
import { and, desc, eq, ilike, or, type SQL, sql } from "drizzle-orm";
import { db, queryDb } from "@/backend/db";
import { teacher } from "@/backend/db/schema/teachers/teacher";
import { users } from "@/backend/db/schema/users/users";
import type { DBQueryExecutor, DBTransaction, TeacherSelectType } from "@/backend/types";

/**
 * Type guard — narrows `DBQueryExecutor` to `DBTransaction`.
 *
 * `DBTransaction` (Drizzle's `PgAsyncTransaction`) exposes the `.select()`
 * builder API; raw `Pool` / `PoolClient` from `pg` do not. The presence of
 * `.select` therefore distinguishes the two at runtime without an unsafe
 * cast.
 */
function isDBTransaction(tx: DBQueryExecutor): tx is DBTransaction {
  return typeof tx === "object" && "select" in tx;
}

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
 * `EvaluationGateRow` — the projection `findForEvaluationGateById` locks
 * and returns: the `teacher` row's certification flags plus the owning
 * `users` account's governance flags. Nullable-with-default schema columns
 * preserve their `| null` select types; the service layer owns the
 * null-semantics (null ≡ not certified / not governed).
 */
interface EvaluationGateRow {
  readonly id: number;
  readonly isApproved: boolean | null;
  readonly isEvaluator: boolean | null;
  readonly isDeleted: boolean | null;
  readonly isBlocked: boolean | null;
  readonly suspended: boolean | null;
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

export namespace TeacherRepository {
  /**
   * Finds a teacher row by primary key (shared with `users.id`).
   *
   * Read-only — mirrors the `UserRepository.findById` shape: Drizzle select on
   * the supplied transaction executor, or raw parameterized SQL via `queryDb`
   * (Neon HTTP fast path) when called outside a transaction.
   *
   * @returns The matching teacher row, or `null` if no teacher has that id.
   */
  export async function findById(id: number, tx?: DBQueryExecutor): Promise<TeacherSelectType | null> {
    if (tx && isDBTransaction(tx)) {
      // Transactional read — Drizzle select on the supplied executor.
      const rows = await tx.select().from(teacher).where(eq(teacher.id, id)).limit(1);
      return rows[0] ?? null;
    }
    // Non-transactional read — raw SQL via queryDb (Neon HTTP fast path).
    const result = await queryDb<TeacherSelectType>(
      `SELECT id,
              is_approved AS "isApproved",
              is_evaluator AS "isEvaluator",
              average_rating AS "averageRating",
              is_online AS "isOnline",
              subjects,
              request_preference AS "requestPreference",
              created_at AS "createdAt",
              updated_at AS "updatedAt"
       FROM teacher WHERE id = $1 LIMIT 1`,
      [id]
    );
    return result.rows[0] ?? null;
  }

  /**
   * Locks the `teacher` row for the supplied transaction and reads its
   * certification state (`SELECT id, is_approved FROM teacher WHERE id = $1
   * FOR UPDATE` via Drizzle `.for("update")`).
   *
   * The row lock is held until the caller's transaction commits or rolls
   * back: any concurrent transaction that locks the same row serializes
   * behind it, and the certification value read here is the value the
   * caller's subsequent writes commit against, with no window for the flag
   * to flip in between.
   *
   * `tx` is REQUIRED (not optional): a locking read without a transaction
   * releases its lock as soon as the statement finishes, which would make
   * the certification re-assertion meaningless.
   *
   * @returns The minimal `{ id, isApproved }` projection, or `null` when no
   *          `teacher` row exists for the id (e.g. a teacher-applicant's
   *          `users.id` — holding an applicant row never mints certification).
   *          `isApproved` mirrors the column's DB-level nullability
   *          (`boolean | null`); treating `null` as "not certified" is the
   *          caller's decision.
   */
  export async function lockForCertificationCheck(
    teacherId: number,
    tx: DBTransaction
  ): Promise<{ id: number; isApproved: boolean | null } | null> {
    const rows = await tx
      .select({ id: teacher.id, isApproved: teacher.isApproved })
      .from(teacher)
      .where(eq(teacher.id, teacherId))
      .for("update");
    return rows[0] ?? null;
  }

  /**
   * Evaluation-gate row lock: takes the `FOR UPDATE` lock on the `teacher`
   * row and reads the certification AND evaluator flags plus the owning
   * `users` account's governance flags inside the SAME statement (the
   * `lockForCertificationCheck` shape extended by the evaluator flag and
   * the governance projection), so an evaluation booking serializes
   * against every other gate-locked writer of that row and a concurrent
   * decertification or governance flip cannot slip between the read and
   * the booking's write — the decision commits against the LOCKED value.
   * The lock covers the joined `users` row too (the shared PK makes the
   * join a 1:1 — every `teacher` row has exactly one owning account).
   *
   * `tx` is REQUIRED (not optional): a locking read without a transaction
   * releases its lock as soon as the statement finishes, which would make
   * the gate meaningless.
   *
   * @returns The minimal `{ id, isApproved, isEvaluator, isDeleted,
   *          isBlocked, suspended }` projection (the certification flags
   *          from the `teacher` row, the governance flags from the joined
   *          `users` row), or `null` when no `teacher` row exists for the
   *          id (e.g. an applicant's `users.id` — holding an applicant row
   *          never mints certification). All flags mirror the columns'
   *          DB-level nullability (`boolean | null`); treating `null` as
   *          "not certified"/"not governed" is the caller's decision.
   */
  export async function findForEvaluationGateById(
    teacherId: number,
    tx: DBTransaction
  ): Promise<EvaluationGateRow | null> {
    const rows = await tx
      .select({
        id: teacher.id,
        isApproved: teacher.isApproved,
        isEvaluator: teacher.isEvaluator,
        isDeleted: users.isDeleted,
        isBlocked: users.isBlocked,
        suspended: users.suspended,
      })
      .from(teacher)
      .innerJoin(users, eq(users.id, teacher.id))
      .where(eq(teacher.id, teacherId))
      .for("update");
    return rows[0] ?? null;
  }

  /**
   * Inserts a certified `teacher` row directly, bypassing the applicant
   * evaluation pipeline (cold-start bootstrapping path).
   *
   * The payload is built field-by-field: only `id`, `isApproved` and
   * `isEvaluator` are written; every other column (`averageRating`,
   * `isOnline`, `subjects`, `requestPreference`) is carried by the schema
   * defaults. A duplicate PK surfaces the raw driver `23505` error
   * untranslated — the service layer owns translation.
   *
   * @returns The inserted teacher row (Drizzle `.returning()` yields all columns).
   */
  export async function insertColdStartCertified(
    id: number,
    makeEvaluator: boolean,
    tx: DBTransaction
  ): Promise<TeacherSelectType> {
    const [row] = await tx
      .insert(teacher)
      .values({
        id,
        isApproved: true,
        isEvaluator: makeEvaluator,
      })
      .returning();
    if (!row) {
      // Should be unreachable — `.returning()` always yields the inserted row.
      throw new Error("TeacherRepository.insertColdStartCertified: insert returned no rows");
    }
    return row;
  }

  /**
   * Elevates an EXISTING unapproved teacher row to certified in a single
   * guarded UPDATE: the `is_approved = false` precondition is folded into the
   * WHERE clause, so the predicate and the mutation are one statement and a
   * concurrent certification of the same row cannot over-apply.
   *
   * Parameterized always; no prepared statement (writes are excluded), no
   * `inArray`, no string concatenation of the id.
   *
   * @returns The updated teacher row, or `null` when zero rows matched (row
   *          absent or already approved — the service layer maps that to its
   *          domain error).
   */
  export async function elevateToCertified(
    id: number,
    makeEvaluator: boolean,
    tx: DBTransaction
  ): Promise<TeacherSelectType | null> {
    const [row] = await tx
      .update(teacher)
      .set({
        isApproved: true,
        isEvaluator: makeEvaluator,
        updatedAt: sql`now()`,
      })
      .where(and(eq(teacher.id, id), eq(teacher.isApproved, false)))
      .returning();
    return row ?? null;
  }

  /**
   * Demotes an EXISTING certified teacher row in a single guarded UPDATE:
   * the `is_approved = true` precondition is folded into the WHERE clause,
   * so the predicate and the mutation are one statement and a concurrent
   * elevation of the same row cannot be overwritten blindly. The evaluator
   * flag is deliberately NOT rewritten — demotion withdraws the
   * certification only; a pre-existing evaluator keeps their evaluator
   * status (the demotion itself performs no role flip; the override
   * flow's certify arm separately restores the `teacher` role via the
   * conversion service).
   *
   * The intended caller is the admin-override REJECTION direction (the
   * manual rejection of a certified applicant): best-effort by contract —
   * a `null` return (row absent or already unapproved) is a legitimate
   * no-op signal (the applicant may never have carried a `teacher` row),
   * never an error; the service tier treats it as such.
   *
   * `tx` is REQUIRED (no standalone branch): the write exists solely inside
   * the caller's admin-override transaction — the demotion commits with
   * that transaction or not at all.
   *
   * Parameterized always; the id and the flag member are bound values, never
   * concatenated; no prepared statement (writes are excluded —
   * `docs/drizzle/prepared-statements.md`).
   *
   * @returns The updated teacher row, or `null` when zero rows matched (no
   *          certified row exists for the id — the caller treats that as a
   *          no-op).
   */
  export async function demoteToUncertified(id: number, tx: DBTransaction): Promise<TeacherSelectType | null> {
    const [row] = await tx
      .update(teacher)
      .set({
        isApproved: false,
        updatedAt: sql`now()`,
      })
      .where(and(eq(teacher.id, id), eq(teacher.isApproved, true)))
      .returning();
    return row ?? null;
  }

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

  /**
   * Writes the teacher's `is_online` flag in one guarded UPDATE — the
   * INV-S6 in-session lock primitive (see
   * `docs/specs/state-machine-invariants.md` §1).
   *
   * The write is deliberately UNCONDITIONAL beyond row identity: this
   * method IS the guarded required-tx `UPDATE … RETURNING` primitive and
   * nothing more — the SERVICE layer composes WHEN the flag is driven to
   * `false` (a session start, the lock) or back to `true` (a `started`
   * exit, the release). Restoration on exit is currently UNCONDITIONAL:
   * a prior-online capture exists at the start flow (the teacher row read
   * inside the start transaction), but until the future availability-
   * toggle work owns the never-resurrect gating, a release restores
   * availability without consulting it — the known seam documented in
   * `docs/sessions/session-lifecycle.md` §Concurrency. Certification
   * plays no part: an uncertified teacher may still go offline.
   *
   * The service layer is the ONLY intended caller: this write composes
   * INSIDE the session lifecycle's own transaction (the same `withTransaction`
   * that flips the session status), so a rollback of the flow aborts the
   * lock/release with it — a stale lock without its session transition is
   * structurally impossible.
   *
   * Parameterized always; no prepared statement (writes are excluded);
   * no business logic, no permission checks, no i18n or logging imports.
   *
   * @param id  The teacher row's id (shared PK with `users.id`) — pinned by
   *            the session row inside the caller's transaction, never a
   *            client payload.
   * @param online  The target flag value (`false` = the INV-S6 lock,
   *                `true` = the release).
   * @param tx  REQUIRED transaction — the write always joins the caller's
   *            atomic unit of work (repo write convention; never the global
   *            handle).
   * @returns The updated teacher row, or `null` when zero rows matched (an
   *          unknown id — the service layer maps that to its domain error).
   *          A redundant same-value write still returns the row (idempotent
   *          under retry by construction).
   */
  export async function setOnline(id: number, online: boolean, tx: DBTransaction): Promise<TeacherSelectType | null> {
    const [row] = await tx
      .update(teacher)
      .set({
        isOnline: online,
        updatedAt: sql`now()`,
      })
      .where(eq(teacher.id, id))
      .returning();
    return row ?? null;
  }

  /**
   * Writes the teacher's cached `average_rating` in ONE guarded UPDATE:
   * row identity in the WHERE clause, `RETURNING` the updated row.
   *
   * The value arrives already converted to the column's 0-5 decimal(3,2)
   * scale as an exact decimal string (Drizzle numeric mode is
   * string-typed — a JS float would round-trip through float64 and break
   * the column's exact-decimal discipline) and is clamped by the
   * database's `teacher_average_rating_check`: an out-of-range value
   * surfaces as the raw `23514` violation, untranslated (a violated clamp
   * is a defect to surface loudly, never to mask). The payload is built
   * member-by-member — the rating string plus `updated_at` — never a
   * spread of a caller object, so no client-controlled byte reaches the
   * row. No prepared statement (writes are excluded), no `inArray`.
   *
   * `tx` is REQUIRED: the write joins the caller's atomic unit of work, so
   * the rating row that produced this value commits or rolls back with it.
   * The only intended caller is the evaluation submission flow (single-
   * writer discipline over the cached column).
   *
   * @param teacherId  The teacher row's id (shared PK with `users.id`).
   * @param averageRating  The cached average as an exact decimal string,
   *                       e.g. "4.25".
   * @param tx  REQUIRED transaction — never the global handle.
   * @returns The updated teacher row, or `null` when zero rows matched
   *          (no `teacher` row for the id — the caller owns the semantics).
   */
  export async function updateAverageRating(
    teacherId: number,
    averageRating: string,
    tx: DBTransaction
  ): Promise<TeacherSelectType | null> {
    const [row] = await tx
      .update(teacher)
      .set({ averageRating, updatedAt: sql`now()` })
      .where(eq(teacher.id, teacherId))
      .returning();
    return row ?? null;
  }
}
