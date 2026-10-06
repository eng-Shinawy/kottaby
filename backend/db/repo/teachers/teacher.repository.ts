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
 * The admin directory read (`listDirectory` with its filter-chain builder
 * and its two directory contracts) follows the same extraction convention
 * and lives in `teacher.repository.directory.helpers.ts`.
 *
 * The student-facing matching read (`listMatchingCandidates` with its
 * filter-chain / country-tier / ordering builders and its two contracts)
 * follows the sibling extraction convention and lives in
 * `teacher.repository.matching.helpers.ts`; the namespace method below is
 * a one-to-one delegation and the contracts are re-exported verbatim.
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
 *  - Writes take a REQUIRED `tx: DBTransaction` (last param) — they always
 *    join the caller's atomic unit of work and never fall back to the
 *    global handle. Single-row writes are one statement; the batch
 *    inactivity sweep is the one deliberate lock-then-recheck pair (see
 *    `sweepInactiveOnlineOnce`). Insert payloads are built
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
 *  - No prepared statements on writes; `inArray` appears only in the
 *    sweep's dynamic pinned-id re-check (plain runtime array, per-element
 *    parameters — the repo's batch-lookup form); raw driver errors
 *    (e.g. a duplicate-PK `23505`) surface untranslated — the service layer
 *    owns error mapping.
 *  - No business logic, no permission checks, no i18n or logging imports —
 *    the caller decides what `isApproved = false` or a `null` row means.
 */
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { queryDb } from "@/backend/db";
import type {
  AdminTeacherDirectoryRow,
  NormalizedAdminTeacherFilters,
} from "@/backend/db/repo/teachers/teacher.repository.directory.helpers";
import * as teacherRepositoryDirectoryImpl from "@/backend/db/repo/teachers/teacher.repository.directory.helpers";
import type {
  NormalizedTeacherMatchingFilters,
  TeacherMatchingRowType,
} from "@/backend/db/repo/teachers/teacher.repository.matching.helpers";
import * as teacherRepositoryMatchingImpl from "@/backend/db/repo/teachers/teacher.repository.matching.helpers";
import { session } from "@/backend/db/schema/classes/session";
import { teacher } from "@/backend/db/schema/teachers/teacher";
import { users } from "@/backend/db/schema/users/users";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import type {
  DBQueryExecutor,
  DBTransaction,
  TeacherInSessionLockReleaseOutcomeType,
  TeacherInSessionLockReleaseResultType,
  TeacherSelectType,
} from "@/backend/types";

export type {
  AdminTeacherDirectoryRow,
  NormalizedAdminTeacherFilters,
} from "@/backend/db/repo/teachers/teacher.repository.directory.helpers";
export type {
  NormalizedTeacherMatchingFilters,
  TeacherMatchingRowType,
} from "@/backend/db/repo/teachers/teacher.repository.matching.helpers";

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
              updated_at AS "updatedAt",
              was_online_before_lock AS "wasOnlineBeforeLock"
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
   * De-certifies a currently-certified teacher for the duration of a paid
   * re-evaluation: the `is_approved = true` precondition is folded into the
   * WHERE clause of ONE guarded UPDATE, so the predicate and the mutation
   * are one statement and a concurrent re-certification of the same row
   * cannot be overwritten blindly.
   *
   * This is the re-evaluation order's named entry point for the
   * certification flip. It rides the SAME single `is_approved = true →
   * false` guarded statement as `demoteToUncertified` — one write shape per
   * flag direction, never a second statement minted for a second caller.
   * What differs is the contract reading of the miss signal: for the
   * re-evaluation order the row lock serializes concurrent orders, so
   * exactly one writer flips the row and a zero-row result is the arbiter's
   * MISS SIGNAL, never an error — the teacher row is absent, or the teacher
   * is already de-certified (a concurrent order won) — and the caller maps
   * the miss to its domain conflict. The evaluator flag is deliberately NOT
   * rewritten: de-certification withdraws the teaching approval only; a
   * pre-existing evaluator keeps their evaluator status.
   *
   * `tx` is REQUIRED (no standalone branch): the write exists solely inside
   * the caller's order transaction — the flip commits with that transaction
   * or not at all.
   *
   * Parameterized always; the id is bound, never concatenated; no prepared
   * statement (writes are excluded — `docs/drizzle/prepared-statements.md`).
   *
   * @returns The updated teacher row, or `null` when zero rows matched (row
   *          absent or already de-certified — the caller owns the semantics).
   */
  export async function decertifyOnce(id: number, tx: DBTransaction): Promise<TeacherSelectType | null> {
    return demoteToUncertified(id, tx);
  }

  /**
   * Lists the admin teacher directory — a one-to-one delegation to the
   * extracted implementation in `teacher.repository.directory.helpers.ts`
   * (the sibling-extraction convention; the two directory contracts are
   * re-exported verbatim from this file).
   *
   * @returns The raw directory rows plus the unfiltered-by-page total (the
   *          service layer maps rows → the return type).
   */
  export async function listDirectory(
    filters: NormalizedAdminTeacherFilters,
    limit: number,
    offset: number,
    tx?: DBTransaction
  ): Promise<{ rows: AdminTeacherDirectoryRow[]; total: number }> {
    return teacherRepositoryDirectoryImpl.listDirectory(filters, limit, offset, tx);
  }

  /**
   * Lists the student-facing matching candidates — a one-to-one delegation
   * to the extracted implementation in
   * `teacher.repository.matching.helpers.ts` (the sibling-extraction
   * convention: the public surface stays this namespace and the two
   * matching contracts are re-exported verbatim from this file, so every
   * public import path is unchanged).
   *
   * @returns The raw matching rows plus the unfiltered-by-page honest
   *          total (the service layer maps rows → the return type).
   */
  export async function listMatchingCandidates(
    filters: NormalizedTeacherMatchingFilters,
    limit: number,
    offset: number,
    tx?: DBQueryExecutor
  ): Promise<{ rows: TeacherMatchingRowType[]; total: number }> {
    return teacherRepositoryMatchingImpl.listMatchingCandidates(filters, limit, offset, tx);
  }

  /**
   * Writes the teacher's `is_online` flag in one guarded UPDATE — the
   * INV-S6 in-session lock primitive (see
   * `docs/specs/state-machine-invariants.md` §1).
  /**
   * Captures the teacher's pre-lock availability intent and applies the
   * in-session lock in ONE atomic guarded UPDATE — the capture and the lock
   * are the same statement, so there is no read-then-write window for a
   * concurrent writer to slip through: concurrent acquires serialize on the
   * row lock the UPDATE takes, and the row's intent is captured exactly
   * once.
   *
   * The statement writes:
   *  - `was_online_before_lock = COALESCE(was_online_before_lock,
   *    is_online)` — FIRST-LOCK-WINS capture: a marker already on the row
   *    (a concurrent session locked this teacher first) is preserved
   *    verbatim; only a marker-less row records the availability value in
   *    force right now. Both operands are the row's own pre-update column
   *    values — no caller-supplied byte participates, and a `NULL`
   *    `is_online` column captures `NULL` (no availability intent is
   *    invented for unknown state).
   *  - `is_online = false` — the lock itself: while it holds, the teacher
   *    is excluded from availability-driven surfaces.
   *  - `updated_at = now()`.
   *
   * A `null` return is the fail-closed miss signal: no `teacher` row exists
   * for the id and nothing was written — the caller (the session-lifecycle
   * start transition) must abort its own state change rather than proceed
   * unlocked. Certification plays no part: an uncertified teacher's row
   * locks identically.
   *
   * `tx` is REQUIRED (not optional): the capture exists solely inside the
   * caller's session-lifecycle transaction — it commits or rolls back with
   * that transaction, never on the global handle.
   *
   * Parameterized always; the id is bound, never concatenated; no prepared
   * statement (writes are excluded — `docs/drizzle/prepared-statements.md`);
   * the COALESCE `sql` template references the row's own columns only (no
   * caller interpolation, no inline comments inside the template).
   *
   * @param id  The teacher row's id (shared PK with `users.id`) — derived
   *            server-side from the session being started, never a client
   *            payload.
   * @param tx  REQUIRED transaction — the write always joins the caller's
   *            atomic unit of work.
   * @returns The updated teacher row (post-capture, post-lock), or `null`
   *          when zero rows matched (unknown id — the caller owns the
   *          fail-closed semantics).
   */
  export async function acquireInSessionLock(id: number, tx: DBTransaction): Promise<TeacherSelectType | null> {
    const [row] = await tx
      .update(teacher)
      .set({
        wasOnlineBeforeLock: sql`COALESCE(${teacher.wasOnlineBeforeLock}, ${teacher.isOnline})`,
        isOnline: false,
        updatedAt: sql`now()`,
      })
      .where(eq(teacher.id, id))
      .returning();
    return row ?? null;
  }

  /**
   * Restores the teacher's pre-lock availability intent and closes the
   * in-session lock in ONE atomic guarded UPDATE — the restore-once
   * counterpart of `acquireInSessionLock`. The guard and the mutation are
   * the same statement, and the captured intent is restored exactly once:
   * concurrent releases serialize on the teacher-row `FOR UPDATE` preamble
   * taken before the probe, whose lock-wait re-evaluates the last-exit
   * predicate against fresh committed state.
   *
   * The release OPENS by acquiring the teacher-row write lock (a `SELECT
   * ... FOR UPDATE` on the row — the lock the closing UPDATE would take
   * anyway). The ordering matters: a release whose last-exit probe matches
   * zero rows writes nothing and therefore takes no row lock of its own, so
   * without that first lock two terminal exits of the same teacher's two
   * started sessions could each evaluate the probe against their own
   * pre-lock snapshot (the other exit's session completion still
   * un-committed, invisible), BOTH defer, and commit — stranding the lock
   * (marker set, zero started sessions). Holding the row lock first
   * serializes the racing releases: the later attempt waits out the earlier
   * one's transaction and evaluates its probe against the committed state.
   * The preamble writes NOTHING — a classified no-op still leaves
   * `is_online`, the marker and `updated_at` untouched.
   *
   * The statement writes:
   *  - `is_online = was_online_before_lock` — the availability value
   *    captured at lock acquisition is written back verbatim. A `true`
   *    marker returns the teacher to online; a `false` marker is the
   *    never-resurrect seed (a teacher who was offline before the session
   *    stays offline after it). The expression reads the row's own
   *    pre-update column value — no caller-supplied byte participates.
   *  - `was_online_before_lock = NULL` — the marker is consumed: the lock
   *    is closed and any later release attempt degrades to the classified
   *    no-op outcome.
   *  - `updated_at = now()`.
   *
   * The LAST-EXIT GUARD rides the WHERE clause as a `NOT EXISTS` probe over
   * the teacher's own `started` sessions: the restore applies only when no
   * `started` session remains for THIS teacher id. A teacher running
   * concurrent sessions releases on the final exit only; the probe reads
   * the caller's transaction snapshot, so the exiting transition's own
   * session write (already applied inside the same transaction) never
   * counts against its release. A concurrent exit's session write is
   * un-committed and therefore invisible to the probe — which is exactly
   * why the release takes the teacher-row write lock BEFORE the probe
   * runs: under that lock racing releases serialize, and whichever runs
   * later re-reads the committed state in which the earlier exit's session
   * write has landed.
   *
   * The preamble's locking read doubles as the existence gate: no
   * `teacher` row resolves to `null` before the guarded statement runs —
   * the same fail-closed miss signal (the caller aborts its own state
   * change rather than proceed). Zero rows from the guarded UPDATE itself
   * (row present, guard refused) → the miss is classified by ONE adjacent
   * read on the same executor (the classification is part of this
   * primitive's contract, so callers never re-implement it):
   *  - the marker is `NULL` → `no_lock_held` — never started, already
   *    restored, or a row predating lock tracking; a benign no-op, nothing
   *    was written;
   *  - the marker is set → `active_sessions_remain` — a `started` session
   *    blocked the guard; the lock stays open for the remaining session and
   *    the restore is deferred to that session's own exit.
   * The `teacher` carried by a deferred outcome is the row's current state
   * (unchanged by this call).
   *
   * `tx` is REQUIRED (not optional): the release exists solely inside the
   * caller's session-lifecycle transaction — it commits or rolls back with
   * that transaction, never on the global handle.
   *
   * Parameterized always; the id is bound, never concatenated; no prepared
   * statement (writes are excluded — `docs/drizzle/prepared-statements.md`);
   * the `NOT EXISTS` probe names the `session` table and the `SessionStatus`
   * enum member (never a string literal) and references only the rows' own
   * columns (no caller interpolation, no inline comments inside templates).
   *
   * @param teacherId  The teacher row's id (shared PK with `users.id`) —
   *                   derived server-side from the exiting session, never a
   *                   client payload.
   * @param tx  REQUIRED transaction — the write always joins the caller's
   *            atomic unit of work.
   * @returns The classified outcome with the teacher row: `{ outcome:
   *          "released", teacher }` carrying the post-restore row, the
   *          deferred `no_lock_held` / `active_sessions_remain` outcomes
   *          carrying the unchanged row, or `null` when no `teacher` row
   *          exists for the id (the caller owns the fail-closed semantics).
   */
  export async function releaseInSessionLock(
    teacherId: number,
    tx: DBTransaction
  ): Promise<TeacherInSessionLockReleaseResultType | null> {
    // Serialization preamble: take the teacher-row write lock BEFORE the
    // last-exit probe. A release whose probe matches zero rows writes
    // nothing and would otherwise take no row lock of its own, so two
    // racing terminal exits could each classify a deferred outcome from
    // their own pre-lock snapshots and strand the lock (marker set, zero
    // started sessions). Holding the row lock first serializes them: the
    // later release re-reads the committed state, sees the earlier exit's
    // session write, and classifies correctly. The read writes nothing, so
    // classified no-ops still leave the row untouched.
    const [locked] = await tx.select({ id: teacher.id }).from(teacher).where(eq(teacher.id, teacherId)).for("update");
    if (!locked) {
      return null;
    }
    const [row] = await tx
      .update(teacher)
      .set({
        isOnline: sql`${teacher.wasOnlineBeforeLock}`,
        wasOnlineBeforeLock: null,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(teacher.id, teacherId),
          isNotNull(teacher.wasOnlineBeforeLock),
          sql`NOT EXISTS (SELECT 1 FROM ${session} WHERE ${eq(session.teacherId, teacherId)} AND ${eq(session.status, SessionStatus.Started)})`
        )
      )
      .returning();
    if (row) {
      return { outcome: "released", teacher: row };
    }
    // Cold path only — the guarded statement matched zero rows: ONE read
    // classifies the miss (no lock held, or a started session deferring
    // the restore). The hot path never reads before writing.
    const current = await findById(teacherId, tx);
    if (!current) {
      return null;
    }
    const outcome: TeacherInSessionLockReleaseOutcomeType =
      current.wasOnlineBeforeLock === null ? "no_lock_held" : "active_sessions_remain";
    return { outcome, teacher: current };
  }

  /**
   * Writes the teacher's availability intent in ONE guarded UPDATE — the
   * third writer of the availability trio: `acquireInSessionLock` captures
   * the pre-lock intent into the marker, `releaseInSessionLock` restores
   * it, and this writer records the teacher's DELIBERATE availability
   * decision on top of whatever state the row currently carries (a manual
   * toggle from the availability surface).
   *
   * The statement writes, in BOTH directions:
   *  - `is_online = $intent` — the toggle itself (false = go offline,
   *    true = become available).
   *  - `was_online_before_lock = CASE WHEN was_online_before_lock IS NULL
   *    THEN NULL ELSE $intent::boolean END` — the marker is respected:
   *    never minted and never consumed. A marker-less row stays marker-less
   *    (there is no lock to re-arm, and minting one would corrupt the
   *    release's no_lock_held classification), while a HELD marker is
   *    overwritten with the intent value — the in-session toggle IS the
   *    pre-lock intent now, so the eventual release restores the DELIBERATE
   *    decision, not a stale capture. The intent param carries an explicit
   *    boolean cast because a CASE over otherwise-untyped branches resolves
   *    to text, which does not implicitly assign into the boolean column.
   *  - `updated_at = now()`.
   *
   * The direction guard rides the WHERE clause as ONE predicate bound with
   * the statement — `($intent = false OR NOT EXISTS (SELECT 1 FROM session
   * WHERE session.teacher_id = $id AND session.status = 'started'))` — so
   * the statement text never varies and the predicate is evaluated with
   * the statement itself. The guard is DEFENSE-IN-DEPTH, not the
   * serialization: a WHERE predicate cannot by itself serialize a
   * concurrent session start against this write — the statement only sees
   * committed session rows as of its own evaluation. Atomic gate-vs-start
   * serialization is the CALLER's obligation — hold the teacher row lock
   * (`lockForCertificationCheck`'s `SELECT … FOR UPDATE`) across the
   * WHOLE toggle transaction, so every other teacher-row writer (a
   * session start's lock capture included) queues behind it and the
   * caller's pre-check gates and this statement observe one consistent
   * ordering:
   *  - Unavailable (`isOnline = false`): the bound direction short-circuits
   *    the probe — going offline is always permitted, even mid-session (the
   *    held marker is re-stamped to `false` so the release cannot resurrect
   *    availability the teacher explicitly withdrew).
   *  - Available (`isOnline = true`): the NOT EXISTS leg over the teacher's
   *    own `started` sessions decides — zero rows on this direction signal
   *    the guard fired at write time (a `started` session exists) or the
   *    row vanished; the caller maps that miss to the in-session conflict
   *    denial.
   *
   * A `null` return is the zero-row miss signal; the SERVICE layer owns
   * the disambiguation and the error mapping (a missing row on the
   * Unavailable direction, or the race-blocked Available direction — the
   * caller's preceding in-transaction existence read decides which). The
   * repo trusts the typed `isOnline` param: boolean type-guarding and
   * normalization of untrusted input stay in the service layer — this
   * writer contains no runtime type coercion by design.
   *
   * `tx` is REQUIRED (not optional): the write exists solely inside the
   * caller's transaction — it commits or rolls back with it, never on the
   * global handle.
   *
   * Parameterized always; the id and the intent are bound values, never
   * concatenated; no prepared statement (writes are excluded —
   * `docs/drizzle/prepared-statements.md`); the CASE template references
   * the row's own column and the bound intent, and the Available-direction
   * probe names the `session` table and the `SessionStatus` enum member
   * (never a string literal) — no caller interpolation, no inline comments
   * inside templates.
   *
   * @param id  The teacher row's id (shared PK with `users.id`) — resolved
   *            and authorization-checked by the service layer, never a raw
   *            client payload.
   * @param isOnline  The target availability intent (`false` = Unavailable,
   *                  `true` = Available).
   * @param tx  REQUIRED transaction — the write always joins the caller's
   *            atomic unit of work.
   * @returns The updated teacher row, or `null` when zero rows matched
   *          (row absent, or the Available-direction guard fired at write
   *          time — the caller owns the semantics). A redundant
   *          same-value write still returns the row (idempotent under
   *          retry by construction).
   */
  export async function setAvailabilityIntent(
    id: number,
    isOnline: boolean,
    tx: DBTransaction
  ): Promise<TeacherSelectType | null> {
    const [row] = await tx
      .update(teacher)
      .set({
        isOnline,
        wasOnlineBeforeLock: sql`CASE WHEN ${teacher.wasOnlineBeforeLock} IS NULL THEN NULL ELSE ${isOnline}::boolean END`,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(teacher.id, id),
          sql`(${isOnline} = false OR NOT EXISTS (SELECT 1 FROM ${session} WHERE ${eq(session.teacherId, id)} AND ${eq(session.status, SessionStatus.Started)}))`
        )
      )
      .returning();
    return row ?? null;
  }

  /**
   * Inactivity sweep primitive — ONE guarded batch transition of the
   * availability flag driven by recorded user activity.
   *
   * Flips online → offline for teachers whose last recorded activity is
   * strictly older than `cutoff` and who hold no started session, via a
   * LOCK-THEN-RECHECK pair of statements inside the caller's transaction:
   *
   *  1. Statement 1 pins the candidate victims — the predicate-matching
   *     `is_online = true` rows — under `FOR UPDATE` row locks held until
   *     the caller's transaction resolves.
   *  2. Statement 2 is the guarded batch `UPDATE … RETURNING`: it re-runs
   *     the SAME predicates scoped to the pinned ids, under the fresh
   *     snapshot its own start captures (READ COMMITTED).
   *
   * The re-check closes the lock-wait staleness hole a single-statement
   * form cannot close: an UPDATE that waits on a row held by a concurrent
   * availability confirmation re-evaluates its cross-table EXISTS probes
   * against its ORIGINAL statement snapshot under PostgreSQL's
   * EvalPlanQual — the confirmation's freshly committed
   * `users.last_active_at` stays invisible, and a just-confirmed teacher
   * could be overridden offline. With the two-statement form the
   * confirmation's stamp is always either (a) already committed — visible
   * to statement 2's fresh snapshot, the row is skipped — or (b) still
   * blocked behind the sweep's lock — the flip lands first and the
   * confirmation then re-asserts Available on top of it: the explicit
   * human toggle owns the final state in both interleavings. Rows that
   * become eligible only AFTER statement 1's snapshot are never
   * transitioned mid-pass (the pinned-id scoping) — they wait for the
   * next scheduled pass.
   *
   *  - `is_online = true` remains the victim gate: already-offline rows
   *    never match, so a replay is a zero-row no-op and the count stays
   *    honest.
   *  - The staleness probe EXISTS-joins the owning `users` row: activity
   *    strictly older than `cutoff` counts as expired, and a NULL
   *    `last_active_at` counts as expired too (an online teacher with no
   *    recorded activity cannot be verified as recently active).
   *  - The `NOT EXISTS (started session)` exemption makes the sweep
   *    structurally unable to touch an in-session teacher — the session
   *    lock takes priority, unconditionally — and is re-verified in
   *    statement 2 against the fresh snapshot.
   *
   * `RETURNING` yields an honest count of the rows actually transitioned.
   * Only `is_online` and `updated_at` are written; `updated_at` receives
   * the caller-captured `now` — the primitive never reads the clock
   * itself, so every row in a pass shares one instant.
   *
   * Victim selection is predicate-only: the WHERE clauses reference
   * nothing but the availability flag, the recorded activity, and the
   * session status. The pinned-id scoping binds a plain runtime array
   * through the dynamic `inArray` (per-element parameters — the repo's
   * batch-lookup form), never a client-supplied value.
   *
   * Parameterized always; no prepared statement (writes are excluded);
   * no business logic, no permission checks, no i18n or logging imports.
   *
   * @param now  The caller-captured sweep instant — written to `updated_at`
   *             of every transitioned row.
   * @param cutoff  The inactivity threshold instant: activity strictly
   *                older than this (or NULL) counts as expired.
   * @param tx  REQUIRED transaction — both statements run on it, so the
   *            row locks and the flips commit or roll back together and
   *            the batch never falls back to the global handle.
   * @returns The number of teachers actually transitioned online → offline
   *          (zero when nothing matched — an idempotent no-op).
   */
  export async function sweepInactiveOnlineOnce(now: Date, cutoff: Date, tx: DBTransaction): Promise<number> {
    // Statement 1 — pin the candidate victims under row locks. The locks
    // are held to the caller's commit, so statement 2 evaluates only rows
    // no concurrent writer can mutate in between.
    const candidates = await tx
      .select({ id: teacher.id })
      .from(teacher)
      .where(
        and(
          eq(teacher.isOnline, true),
          sql`EXISTS (SELECT 1 FROM ${users} WHERE ${users.id} = ${teacher.id} AND (${users.lastActiveAt} IS NULL OR ${users.lastActiveAt} < ${cutoff}))`,
          sql`NOT EXISTS (SELECT 1 FROM ${session} WHERE ${session.teacherId} = ${teacher.id} AND ${session.status} = ${SessionStatus.Started})`
        )
      )
      .for("update");
    if (candidates.length === 0) {
      return 0;
    }

    // Statement 2 — the guarded batch write, re-checked under the FRESH
    // snapshot this statement's start captures: a stamp that committed
    // while the locks were being acquired is now visible and spares the
    // row. Scoped to the pinned ids so rows that became eligible only
    // after statement 1 wait for the next pass.
    const rows = await tx
      .update(teacher)
      .set({ isOnline: false, updatedAt: now })
      .where(
        and(
          inArray(
            teacher.id,
            candidates.map(candidate => candidate.id)
          ),
          eq(teacher.isOnline, true),
          sql`EXISTS (SELECT 1 FROM ${users} WHERE ${users.id} = ${teacher.id} AND (${users.lastActiveAt} IS NULL OR ${users.lastActiveAt} < ${cutoff}))`,
          sql`NOT EXISTS (SELECT 1 FROM ${session} WHERE ${session.teacherId} = ${teacher.id} AND ${session.status} = ${SessionStatus.Started})`
        )
      )
      .returning({ id: teacher.id });
    return rows.length;
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
