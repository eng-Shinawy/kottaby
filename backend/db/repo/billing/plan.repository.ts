/**
 * PlanRepository — data-access layer for the `plans` subscription-catalog
 * table.
 *
 * The `plans` row is pure catalog data: `title` (unique) plus the commercial
 * shape (`session_count`, `price`, `currency`, `interval_days`) and the
 * server-controlled lifecycle pair (`is_active`, `deactivated_at`).
 *
 * Conventions per `backend/db/repo/AGENTS.md`:
 *  - Reads use `queryDb` raw parameterized SQL on the non-transactional
 *    branch (Neon HTTP fast path when eligible) and a Drizzle select on the
 *    supplied transaction — mirroring `ApplicantRepository.findByUserId`.
 *  - Writes are single statements (INSERT/UPDATE … RETURNING) — no
 *    read-then-write anywhere. Writes never use prepared statements
 *    (`docs/drizzle/prepared-statements.md`).
 *  - `tx` is the LAST parameter of every method; passing it joins the
 *    caller's transaction, omitting it executes standalone.
 *  - No business rules, no translations, no log strings — callers translate
 *    empty RETURNING results and driver errors into domain outcomes.
 *  - The active-catalog filter (the sole `is_active` visibility predicate)
 *    lives ONLY in `listActive` — the single place that decides catalog
 *    visibility.
 *  - No hard-delete surface: catalog rows are retired via
 *    `setActiveStatusOnce`, never removed.
 */
import { and, asc, eq } from "drizzle-orm";
import { db, queryDb } from "@/backend/db";
import { plans } from "@/backend/db/schema/billing/plans";
import type { DBTransaction, PlanInsertType, PlanSelectType } from "@/backend/types";

/**
 * The mutable commercial fields of a plan — the ONLY columns a caller may
 * patch through `updatePlanFields`. Lifecycle columns (`isActive`,
 * `deactivatedAt`) and identity/timestamp columns are deliberately excluded
 * from the type, so a smuggled `isActive` key is a compile error and a
 * runtime no-op (the whitelist mapping below copies recognized keys only).
 */
export type PlanFieldPatch = Partial<
  Pick<PlanInsertType, "title" | "sessionCount" | "price" | "currency" | "intervalDays">
>;

/** Field set accepted by the UPDATE — whitelisted patch plus the server-side freshness stamp. */
type PlanFieldSet = PlanFieldPatch & { updatedAt: Date };

/**
 * Shared read projection for the raw non-transactional branch. Column aliases
 * mirror Drizzle's camelCase mapping so both read paths return
 * `PlanSelectType`-shaped rows. Built once from static fragments — caller
 * input never reaches these strings; parameters travel via `$1` placeholders.
 */
const PLAN_READ_COLUMNS_SQL = `SELECT id,
       title,
       session_count AS "sessionCount",
       price,
       currency,
       interval_days AS "intervalDays",
       is_active AS "isActive",
       deactivated_at AS "deactivatedAt",
       created_at AS "createdAt",
       updated_at AS "updatedAt"
FROM plans`;

const LIST_ACTIVE_SQL = `${PLAN_READ_COLUMNS_SQL} WHERE is_active = true ORDER BY created_at ASC`;
const LIST_ALL_SQL = `${PLAN_READ_COLUMNS_SQL} ORDER BY created_at ASC`;
const EXISTS_BY_ID_SQL = "SELECT id FROM plans WHERE id = $1 LIMIT 1";

export namespace PlanRepository {
  /**
   * Inserts one plan-catalog row. `id` is identity-generated (never supplied);
   * `isActive`/`deactivatedAt`/timestamps come from schema defaults unless the
   * caller explicitly provides them (test fixtures only).
   *
   * A duplicate `title` surfaces as the driver's unique-violation error — the
   * service layer owns its translation into a localized domain error.
   *
   * @returns The inserted plan row.
   */
  export async function insertPlan(insert: PlanInsertType, tx?: DBTransaction): Promise<PlanSelectType> {
    const rows = tx
      ? await tx.insert(plans).values(insert).returning()
      : await db.insert(plans).values(insert).returning();
    const [row] = rows;
    if (!row) {
      throw new Error("PlanRepository.insertPlan: insert returned no rows");
    }
    return row;
  }

  /**
   * Updates the whitelisted commercial fields of one plan and stamps
   * `updatedAt` server-side. The patch is copied key-by-key — never spread —
   * so lifecycle columns cannot be mutated through this surface, no matter
   * what keys the caller's object carries at runtime. Field edits are
   * forward-only: nothing here touches `subscriptions` rows (existing
   * purchases keep their original terms).
   *
   * @returns The updated plan row, or `null` when zero rows matched (the
   *          service layer converts that into a NotFound outcome).
   */
  export async function updatePlanFields(
    id: number,
    patch: PlanFieldPatch,
    tx?: DBTransaction
  ): Promise<PlanSelectType | null> {
    const set: PlanFieldSet = {
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.sessionCount !== undefined ? { sessionCount: patch.sessionCount } : {}),
      ...(patch.price !== undefined ? { price: patch.price } : {}),
      ...(patch.currency !== undefined ? { currency: patch.currency } : {}),
      ...(patch.intervalDays !== undefined ? { intervalDays: patch.intervalDays } : {}),
      updatedAt: new Date(),
    };
    const rows = tx
      ? await tx.update(plans).set(set).where(eq(plans.id, id)).returning()
      : await db.update(plans).set(set).where(eq(plans.id, id)).returning();
    return rows[0] ?? null;
  }

  /**
   * The ONLY state-transition primitive for plan lifecycle: one guarded
   * conditional UPDATE whose WHERE clause matches the row only when it is in
   * the OPPOSITE state of `target`. The predicate is evaluated under the
   * row's write lock inside the statement, so two concurrent identical
   * transitions serialize — the loser matches zero rows and gets `null`
   * (a read-then-update would have let both succeed). Lifecycle columns move
   * together: activating clears `deactivated_at`, deactivating stamps it.
   *
   * @returns The transitioned plan row, or `null` when the guard matched zero
   *          rows — callers probe `existsById` to distinguish a missing plan
   *          from an already-in-target-state plan.
   */
  export async function setActiveStatusOnce(
    id: number,
    target: boolean,
    tx?: DBTransaction
  ): Promise<PlanSelectType | null> {
    const updates = {
      isActive: target,
      deactivatedAt: target ? null : new Date(),
      updatedAt: new Date(),
    };
    const rows = tx
      ? await tx
          .update(plans)
          .set(updates)
          .where(and(eq(plans.id, id), eq(plans.isActive, !target)))
          .returning()
      : await db
          .update(plans)
          .set(updates)
          .where(and(eq(plans.id, id), eq(plans.isActive, !target)))
          .returning();
    return rows[0] ?? null;
  }

  /**
   * Read-only existence probe — the post-guard disambiguation primitive for
   * `setActiveStatusOnce`: after a `null` transition result, `false` means the
   * plan does not exist, `true` means it was already in the target state.
   *
   * @returns `true` when a plan with that id exists.
   */
  export async function existsById(id: number, tx?: DBTransaction): Promise<boolean> {
    if (tx) {
      const rows = await tx.select({ id: plans.id }).from(plans).where(eq(plans.id, id)).limit(1);
      return rows.length > 0;
    }
    const result = await queryDb<{ id: number }>(EXISTS_BY_ID_SQL, [id]);
    return result.rows.length > 0;
  }

  /**
   * The active catalog — the SINGLE place the active-state visibility filter
   * exists. Catalog consumers (browse, purchase-time re-validation) read
   * through here so the visibility rule can never fork.
   *
   * @returns Active plans ordered oldest-first by `created_at`.
   */
  export async function listActive(tx?: DBTransaction): Promise<PlanSelectType[]> {
    if (tx) {
      return tx.select().from(plans).where(eq(plans.isActive, true)).orderBy(asc(plans.createdAt));
    }
    const result = await queryDb<PlanSelectType>(LIST_ACTIVE_SQL);
    return result.rows;
  }

  /**
   * The full admin catalog — every row including deactivated plans.
   *
   * @returns All plans ordered oldest-first by `created_at`.
   */
  export async function listAll(tx?: DBTransaction): Promise<PlanSelectType[]> {
    if (tx) {
      return tx.select().from(plans).orderBy(asc(plans.createdAt));
    }
    const result = await queryDb<PlanSelectType>(LIST_ALL_SQL);
    return result.rows;
  }
}
