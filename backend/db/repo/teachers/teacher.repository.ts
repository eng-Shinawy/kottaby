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
 *  - No prepared statements on writes; no `inArray`; raw driver errors
 *    (e.g. a duplicate-PK `23505`) surface untranslated — the service layer
 *    owns error mapping.
 *  - No business logic, no permission checks, no i18n or logging imports —
 *    the caller decides what `isApproved = false` or a `null` row means.
 */
import { and, eq, sql } from "drizzle-orm";
import { queryDb } from "@/backend/db";
import { teacher } from "@/backend/db/schema/teachers/teacher";
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
}
