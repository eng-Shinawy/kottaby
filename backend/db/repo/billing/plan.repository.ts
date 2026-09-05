/**
 * PlanRepository — data-access layer for the `plans` table.
 *
 * Implements atomic CRUD operations for subscription plans.
 * Concurrency:
 *  - Uses conditional guarded updates (`setActiveStatusOnce`) to prevent race conditions.
 *  - Uses `listActive` as the single canonical predicate for public active plans.
 *
 * Reads follow the `backend/db/repo/AGENTS.md` "Neon HTTP Client for Bare
 * Reads (CRITICAL)" rule: non-transactional reads run as raw parameterized SQL
 * through `queryDb` (Neon HTTP fast path when eligible); when a transaction is
 * supplied, the read executes as a Drizzle select on that executor.
 *
 * Write methods take an optional `tx: DBTransaction` as their last parameter.
 */
import { and, asc, eq } from "drizzle-orm";
import { db, queryDb } from "@/backend/db";
import { plans } from "@/backend/db/schema/billing/plans";
import type { DBQueryExecutor, DBTransaction, PlanInsertType, PlanSelectType, PlanUpdateInput } from "@/backend/types";

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
const PLAN_READ_COLUMNS = `
  id, title, session_count AS "sessionCount", price, currency,
  interval_days AS "intervalDays", is_active AS "isActive",
  deactivated_at AS "deactivatedAt", created_at AS "createdAt", updated_at AS "updatedAt"
`;

export namespace PlanRepository {
  /**
   * Inserts a new subscription plan record.
   *
   * @returns The inserted plan row.
   */
  export async function insertPlan(insert: PlanInsertType, tx?: DBTransaction): Promise<PlanSelectType> {
    const executor = tx ?? db;
    const [row] = await executor.insert(plans).values(insert).returning();
    if (!row) {
      throw new Error("PlanRepository.insertPlan: insert returned no rows");
    }
    return row;
  }

  /**
   * Updates mutable fields on a plan record by ID.
   *
   * @returns The updated plan row, or null if no row with `id` exists.
   */
  export async function updatePlanFields(
    id: number,
    patch: PlanUpdateInput,
    tx?: DBTransaction
  ): Promise<PlanSelectType | null> {
    const executor = tx ?? db;
    const [row] = await executor
      .update(plans)
      .set({
        ...patch,
        updatedAt: new Date(),
      })
      .where(eq(plans.id, id))
      .returning();
    return row ?? null;
  }

  /**
   * Performs an atomic guarded transition of a plan's active status.
   *
   * Transitions `isActive` from `!target` to `target`.
   * When deactivating (`target === false`), populates `deactivatedAt` with current timestamp.
   * When reactivating (`target === true`), resets `deactivatedAt` to null.
   *
   * @returns The transitioned row if state changed, or null if row not found or already in target state.
   */
  export async function setActiveStatusOnce(
    id: number,
    target: boolean,
    tx?: DBTransaction
  ): Promise<PlanSelectType | null> {
    const executor = tx ?? db;
    const [row] = await executor
      .update(plans)
      .set({
        isActive: target,
        deactivatedAt: target ? null : new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(plans.id, id), eq(plans.isActive, !target)))
      .returning();
    return row ?? null;
  }

  /**
   * Checks if a plan row exists by ID (for post-guard failure disambiguation).
   *
   * @returns True if a row with the given ID exists in the database.
   */
  export async function existsById(id: number, tx?: DBQueryExecutor): Promise<boolean> {
    if (tx && isDBTransaction(tx)) {
      // Transactional read — Drizzle select on the supplied executor.
      const rows = await tx.select({ id: plans.id }).from(plans).where(eq(plans.id, id)).limit(1);
      return rows.length > 0;
    }
    // Non-transactional read — raw SQL via queryDb (Neon HTTP fast path).
    const result = await queryDb<{ id: number }>(`SELECT id FROM plans WHERE id = $1 LIMIT 1`, [id]);
    return result.rows.length > 0;
  }

  /**
   * Finds a plan by ID.
   *
   * @returns The plan row, or null if not found.
   */
  export async function findById(id: number, tx?: DBQueryExecutor): Promise<PlanSelectType | null> {
    if (tx && isDBTransaction(tx)) {
      // Transactional read — Drizzle select on the supplied executor.
      const rows = await tx.select().from(plans).where(eq(plans.id, id)).limit(1);
      return rows[0] ?? null;
    }
    // Non-transactional read — raw SQL via queryDb (Neon HTTP fast path).
    const result = await queryDb<PlanSelectType>(`SELECT ${PLAN_READ_COLUMNS} FROM plans WHERE id = $1 LIMIT 1`, [id]);
    return result.rows[0] ?? null;
  }

  /**
   * Lists all active plans (for student/public catalog consumption).
   *
   * Single active predicate: `WHERE is_active = true ORDER BY created_at ASC`.
   */
  export async function listActive(tx?: DBQueryExecutor): Promise<PlanSelectType[]> {
    if (tx && isDBTransaction(tx)) {
      // Transactional read — Drizzle select on the supplied executor.
      return tx.select().from(plans).where(eq(plans.isActive, true)).orderBy(asc(plans.createdAt));
    }
    // Non-transactional read — raw SQL via queryDb (Neon HTTP fast path).
    const result = await queryDb<PlanSelectType>(
      `SELECT ${PLAN_READ_COLUMNS} FROM plans WHERE is_active = true ORDER BY created_at ASC`
    );
    return result.rows;
  }

  /**
   * Lists all plans regardless of active status (for admin management).
   *
   * Query: `ORDER BY created_at ASC`.
   */
  export async function listAll(tx?: DBQueryExecutor): Promise<PlanSelectType[]> {
    if (tx && isDBTransaction(tx)) {
      // Transactional read — Drizzle select on the supplied executor.
      return tx.select().from(plans).orderBy(asc(plans.createdAt));
    }
    // Non-transactional read — raw SQL via queryDb (Neon HTTP fast path).
    const result = await queryDb<PlanSelectType>(`SELECT ${PLAN_READ_COLUMNS} FROM plans ORDER BY created_at ASC`);
    return result.rows;
  }
}
