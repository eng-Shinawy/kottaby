/**
 * LessonRepository — data-access layer for the `lessons` table.
 *
 * Implements atomic CRUD operations for curriculum lessons.
 * Concurrency:
 *  - All writes are single guarded statements (one INSERT…RETURNING, one
 *    UPDATE … WHERE id … RETURNING, one DELETE … WHERE id … RETURNING) —
 *    a zero-row result is the not-found signal, never a SELECT-then-write
 *    window.
 *
 * Reads run non-transactionally as raw parameterized SQL through `queryDb`
 * (the shared fast path for bare reads across the repositories); when a
 * transaction is supplied, the read executes as a Drizzle select on that
 * executor.
 *
 * Write methods take an optional `tx: DBTransaction` as their last parameter;
 * read methods accept an optional `tx: DBQueryExecutor`.
 */
import { asc, eq } from "drizzle-orm";
import { db, queryDb } from "@/backend/db";
import { lessons } from "@/backend/db/schema/classes/lessons";
import { ConflictError } from "@/backend/lib/errors";
import type {
  DBQueryExecutor,
  DBTransaction,
  LessonInsertType,
  LessonSelectType,
  LessonUpdateInput,
} from "@/backend/types";

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

/** Shared column projection with camelCase aliasing for raw `queryDb` reads. */
const LESSON_READ_COLUMNS = `
  id, plan_id AS "planId", title,
  created_at AS "createdAt", updated_at AS "updatedAt"
`;

export namespace LessonRepository {
  /**
   * Inserts a new lesson record.
   *
   * @throws ConflictError when the INSERT somehow returns no row — the
   * defensive invariant shared by the repositories (an INSERT… RETURNING
   * that inserts never yields an empty row list).
   *
   * @returns The inserted lesson row.
   */
  export async function insertLesson(insert: LessonInsertType, tx?: DBTransaction): Promise<LessonSelectType> {
    const executor = tx ?? db;
    const [row] = await executor.insert(lessons).values(insert).returning();
    if (!row) {
      throw new ConflictError("LessonRepository.insertLesson: insert returned no rows");
    }
    return row;
  }

  /**
   * Updates mutable fields on a lesson record by ID. `updatedAt` is set
   * server-side on every call — the caller never supplies it.
   *
   * @returns The updated lesson row, or null if no row with `id` exists.
   */
  export async function updateLessonFields(
    id: number,
    patch: LessonUpdateInput,
    tx?: DBTransaction
  ): Promise<LessonSelectType | null> {
    const executor = tx ?? db;
    const [row] = await executor
      .update(lessons)
      .set({
        ...patch,
        updatedAt: new Date(),
      })
      .where(eq(lessons.id, id))
      .returning();
    return row ?? null;
  }

  /**
   * Deletes a lesson record by ID.
   *
   * Referencing `progress` rows survive with `lesson_id = NULL` (the FK's
   * ON DELETE SET NULL contract) — this delete never cascades.
   *
   * @returns The removed lesson row, or null if no row with `id` exists.
   */
  export async function deleteById(id: number, tx?: DBTransaction): Promise<LessonSelectType | null> {
    const executor = tx ?? db;
    const [row] = await executor.delete(lessons).where(eq(lessons.id, id)).returning();
    return row ?? null;
  }

  /**
   * Finds a lesson by ID.
   *
   * @returns The lesson row, or null if not found.
   */
  export async function findById(id: number, tx?: DBQueryExecutor): Promise<LessonSelectType | null> {
    if (tx && isDBTransaction(tx)) {
      // Transactional read — Drizzle select on the supplied executor.
      const rows = await tx.select().from(lessons).where(eq(lessons.id, id)).limit(1);
      return rows[0] ?? null;
    }
    // Non-transactional read — raw SQL via queryDb (Neon HTTP fast path).
    const result = await queryDb<LessonSelectType>(`SELECT ${LESSON_READ_COLUMNS} FROM lessons WHERE id = $1 LIMIT 1`, [
      id,
    ]);
    return result.rows[0] ?? null;
  }

  /**
   * Lists all lessons for one plan in curriculum-sequence order.
   *
   * Query: `WHERE plan_id = <planId> ORDER BY id ASC` — the single
   * canonical ordering predicate for the curriculum (insertion order IS the
   * sequence). Lessons whose plan was deleted (`plan_id = NULL`) are
   * intentionally excluded — they are standalone units, not part of any
   * plan's curriculum.
   *
   * @returns The lesson rows ordered `id ASC`; empty when the plan has none.
   */
  export async function listByPlanId(planId: number, tx?: DBQueryExecutor): Promise<LessonSelectType[]> {
    if (tx && isDBTransaction(tx)) {
      // Transactional read — Drizzle select on the supplied executor.
      return tx.select().from(lessons).where(eq(lessons.planId, planId)).orderBy(asc(lessons.id));
    }
    // Non-transactional read — raw SQL via queryDb (Neon HTTP fast path).
    const result = await queryDb<LessonSelectType>(
      `SELECT ${LESSON_READ_COLUMNS} FROM lessons WHERE plan_id = $1 ORDER BY id ASC`,
      [planId]
    );
    return result.rows;
  }
}
