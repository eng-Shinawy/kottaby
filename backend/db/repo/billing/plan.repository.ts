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
import { and, asc, eq, inArray } from "drizzle-orm";
import { db, queryDb } from "@/backend/db";
import { plans } from "@/backend/db/schema/billing/plans";
import { ConflictError } from "@/backend/lib/errors";
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
  interval_days AS "intervalDays", balance_lane AS "balanceLane",
  is_active AS "isActive", deactivated_at AS "deactivatedAt",
  created_at AS "createdAt", updated_at AS "updatedAt"
`;

/**
 * Upper bound on ids per single batch statement — the explicit cap that
 * keeps every `inArray` expansion (and the raw `= ANY($1::int[])` array)
 * bounded. Longer id lists are transparently split into chunks whose
 * results are concatenated, so a caller never manages chunking and a
 * page-sized batch (well under the cap) still costs exactly one round
 * trip.
 */
export const PLAN_ID_BATCH_LIMIT = 1000;

export namespace PlanRepository {
  /**
   * Inserts a new subscription plan record.
   *
   * @throws ConflictError when the INSERT somehow returns no row — the
   * defensive invariant shared by the billing repositories (an INSERT…
   * RETURNING that inserts never yields an empty row list).
   *
   * @returns The inserted plan row.
   */
  export async function insertPlan(insert: PlanInsertType, tx?: DBTransaction): Promise<PlanSelectType> {
    const executor = tx ?? db;
    const [row] = await executor.insert(plans).values(insert).returning();
    if (!row) {
      throw new ConflictError("PlanRepository.insertPlan: insert returned no rows");
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
   * Finds an ACTIVE plan by ID — the purchase-time re-validation read.
   *
   * The single predicate `WHERE id = ? AND is_active = true` collapses an
   * unknown plan and a deactivated plan into the same `null` result, so a
   * purchase can never bind to a plan that was withdrawn between catalog
   * browsing and checkout. Takes an optional transaction because the
   * purchase flow re-validates the plan INSIDE its transaction: the active
   * state is then judged against the same snapshot the purchase writes
   * against, and a concurrent deactivation serializes behind the row lock
   * instead of slipping through a stale read.
   *
   * @returns The active plan row, or null when the plan is unknown or inactive.
   */
  export async function findActiveById(id: number, tx?: DBQueryExecutor): Promise<PlanSelectType | null> {
    if (tx && isDBTransaction(tx)) {
      // Transactional read — Drizzle select on the supplied executor.
      const rows = await tx
        .select()
        .from(plans)
        .where(and(eq(plans.id, id), eq(plans.isActive, true)))
        .limit(1);
      return rows[0] ?? null;
    }
    // Non-transactional read — raw SQL via queryDb (Neon HTTP fast path).
    const result = await queryDb<PlanSelectType>(
      `SELECT ${PLAN_READ_COLUMNS} FROM plans WHERE id = $1 AND is_active = true LIMIT 1`,
      [id]
    );
    return result.rows[0] ?? null;
  }

  /**
   * Resolves the credited balance lane for a batch of plan IDs — the expiry
   * sweep's ONE batched plan read.
   *
   * Transactional reads run as a Drizzle `inArray` select on the supplied
   * executor, so the sweep judges the lane vocabulary on the same snapshot
   * its flip wrote against; non-transactional reads run as raw parameterized
   * SQL through `queryDb` (Neon HTTP fast path). An empty ID list
   * short-circuits to an empty result without touching the database (the pg
   * protocol cannot expand an empty array into `IN`).
   *
   * @returns One `{ id, balanceLane }` row per matched plan. `balanceLane`
   * is the raw stored value, `null` included — an unconfigured lane is the
   * caller's fail-safe skip case, not this read's concern.
   */
  export async function findBalanceLanesByIds(
    ids: readonly number[],
    tx?: DBQueryExecutor
  ): Promise<Array<Pick<PlanSelectType, "id" | "balanceLane">>> {
    if (ids.length === 0) {
      return [];
    }
    if (tx && isDBTransaction(tx)) {
      // Transactional read — Drizzle select on the supplied executor.
      return tx
        .select({ id: plans.id, balanceLane: plans.balanceLane })
        .from(plans)
        .where(inArray(plans.id, [...ids]));
    }
    // Non-transactional read — raw SQL via queryDb (Neon HTTP fast path).
    const result = await queryDb<{ id: number; balanceLane: PlanSelectType["balanceLane"] }>(
      `SELECT id, balance_lane AS "balanceLane" FROM plans WHERE id = ANY($1::int[])`,
      [[...ids]]
    );
    return result.rows;
  }

  /**
   * Batch plan lookup by IDs — the page-enrichment read that resolves a
   * page's distinct plan ids in one bounded round trip instead of one
   * read per row.
   *
   * Same tx/no-tx split as the other bare reads: a supplied transaction
   * runs a Drizzle `inArray` select on that executor (the caller judges
   * enrichment against its own snapshot), while the default executor
   * runs raw parameterized SQL through `queryDb` (Neon HTTP fast path)
   * with the id array bound as a single `= ANY($1::int[])` parameter.
   * ID lists longer than `PLAN_ID_BATCH_LIMIT` are split into chunked
   * statements and the chunk results concatenated.
   *
   * No active-status predicate — this is the enrichment read, the
   * single-row `findById` twin: a deactivated plan enriches its
   * historical subscription rows exactly like an active one. An empty
   * ID list short-circuits to an empty result without touching the
   * database (the pg protocol cannot expand an empty array into `IN`).
   *
   * @returns One row per MATCHED plan id — unmatched ids contribute no
   *          row (the caller's map assembly distinguishes present from
   *          absent), duplicate ids collapse to the single stored row,
   *          and row order is unspecified (key results by `id`).
   */
  export async function findByIds(ids: readonly number[], tx?: DBQueryExecutor): Promise<PlanSelectType[]> {
    if (ids.length === 0) {
      return [];
    }
    const chunks = Array.from({ length: Math.ceil(ids.length / PLAN_ID_BATCH_LIMIT) }, (_, index) =>
      ids.slice(index * PLAN_ID_BATCH_LIMIT, (index + 1) * PLAN_ID_BATCH_LIMIT)
    );
    if (tx && isDBTransaction(tx)) {
      // Transactional read — Drizzle select on the supplied executor.
      // `inArray` with a PLAIN array (never `sql.placeholder`) per the
      // repo prepared-statement rule. Chunks are read SEQUENTIALLY: a
      // transaction's single client must not pipeline concurrent
      // statements.
      return chunks.reduce<Promise<PlanSelectType[]>>(
        async (accumulated, chunk) => [
          ...(await accumulated),
          ...(await tx
            .select()
            .from(plans)
            .where(inArray(plans.id, [...chunk]))),
        ],
        Promise.resolve([])
      );
    }
    // Non-transactional read — raw SQL via queryDb (Neon HTTP fast path);
    // `= ANY($1::int[])` binds the id array as one parameterized value.
    // Chunks are read sequentially for executor-shape parity.
    return chunks.reduce<Promise<PlanSelectType[]>>(async (accumulated, chunk) => {
      const result = await queryDb<PlanSelectType>(`SELECT ${PLAN_READ_COLUMNS} FROM plans WHERE id = ANY($1::int[])`, [
        [...chunk],
      ]);
      return [...(await accumulated), ...result.rows];
    }, Promise.resolve([]));
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
