/**
 * SubscriptionRepository — data-access layer for the `subscriptions` table
 * (DEV1-006 Phase A: the subscription-request groundwork).
 *
 * A subscription row is created PENDING by construction: `status` rides the
 * schema default (`subscription_status` = 'pending'), `start_date` /
 * `end_date` / `payment_*` columns stay NULL until the payment-confirmation
 * stage activates the subscription (later DEV1-006 phases own that
 * transition). No UPDATE/DELETE surface exists at this phase — activation,
 * expiry, and cancellation land with the payment flow.
 *
 * Conventions per `backend/db/repo/AGENTS.md`:
 *  - Writes are single statements (INSERT … RETURNING) — no read-then-write.
 *  - `tx` is the LAST parameter of every method; passing it joins the
 *    caller's transaction, omitting it executes standalone.
 *  - No business rules, no translations, no log strings — callers translate
 *    empty results and driver errors into domain outcomes.
 *  - The ACTIVE-visibility predicate for purchase authorization is NOT
 *    re-implemented here: `lockActivePlanById` SELECTs the `plans` row
 *    through a guarded predicate under `FOR UPDATE` — the read-side twin of
 *    `PlanRepository.setActiveStatusOnce`'s guarded write (decision D2:
 *    purchase-time re-validation closes INV-PC1 against a deactivate racing
 *    a checkout; the row lock serializes the two).
 */
import { and, desc, eq } from "drizzle-orm";
import { db, queryDb } from "@/backend/db";
import { plans } from "@/backend/db/schema/billing/plans";
import { subscriptions } from "@/backend/db/schema/billing/subscriptions";
import type { DBTransaction, PlanSelectType, SubscriptionInsertType, SubscriptionSelectType } from "@/backend/types";

/**
 * Shared read projection for the raw non-transactional branch. Column aliases
 * mirror Drizzle's camelCase mapping so both read paths return
 * `SubscriptionSelectType`-shaped rows. Built once from static fragments —
 * caller input never reaches these strings; parameters travel via `$1`.
 */
const SUBSCRIPTION_READ_COLUMNS_SQL = `SELECT id,
       user_id AS "userId",
       plan_id AS "planId",
       status,
       start_date AS "startDate",
       end_date AS "endDate",
       payment_method AS "paymentMethod",
       payment_reference AS "paymentReference",
       payment_verified_at AS "paymentVerifiedAt",
       created_at AS "createdAt",
       updated_at AS "updatedAt"
FROM subscriptions`;

const EXISTS_PENDING_BY_USER_AND_PLAN_SQL = `${SUBSCRIPTION_READ_COLUMNS_SQL}
WHERE user_id = $1 AND plan_id = $2 AND status = 'pending'
LIMIT 1`;

const LIST_BY_USER_SQL = `${SUBSCRIPTION_READ_COLUMNS_SQL}
WHERE user_id = $1
ORDER BY created_at DESC, id DESC`;

export namespace SubscriptionRepository {
  /**
   * Purchase-time re-validation primitive (decision D2, DEV1-005 deferred
   * obligation): SELECTs the plan row ONLY when it is active, taking the
   * row's write lock (`FOR UPDATE`) inside the caller's transaction. A
   * concurrent `setActiveStatusOnce` deactivate blocks behind this lock —
   * if the deactivate commits first, this predicate matches zero rows and
   * the purchase is refused; if this lock is held first, the deactivate
   * waits until the purchase transaction commits, so a plan can never be
   * deactivated-out-from-under an in-flight checkout.
   *
   * MUST be called inside a transaction (the lock is meaningless on the
   * standalone pool path — the guard would not survive to the INSERT).
   *
   * @returns The locked active plan row, or `null` when the plan is missing
   *          or inactive (callers map `null` to the PLAN_INACTIVE conflict —
   *          the probe is not expected to disambiguate: a missing plan id is
   *          indistinguishable from an inactive one at the purchase
   *          boundary, and both reject with the same localized copy).
   */
  export async function lockActivePlanById(planId: number, tx: DBTransaction): Promise<PlanSelectType | null> {
    const rows = await tx
      .select()
      .from(plans)
      .where(and(eq(plans.id, planId), eq(plans.isActive, true)))
      .limit(1)
      .for("update");
    return rows[0] ?? null;
  }

  /**
   * Inserts one PENDING subscription row. Only `userId` + `planId` are
   * accepted — lifecycle, payment, and timestamp columns are server-owned
   * (schema defaults / NULL) and structurally unrepresentable through this
   * narrow insert shape.
   *
   * @returns The inserted subscription row (status `pending`).
   */
  export async function insertPending(
    insert: Pick<SubscriptionInsertType, "userId" | "planId">,
    tx?: DBTransaction
  ): Promise<SubscriptionSelectType> {
    const rows = tx
      ? await tx.insert(subscriptions).values(insert).returning()
      : await db.insert(subscriptions).values(insert).returning();
    const [row] = rows;
    if (!row) {
      throw new Error("SubscriptionRepository.insertPending: insert returned no rows");
    }
    return row;
  }

  /**
   * Pending-duplicate probe: `true` when the caller already has a PENDING
   * subscription request for the same plan. Active/expired/cancelled
   * histories do NOT block a fresh request — only an unresolved pending
   * request does (the admin payment-confirmation stage resolves it).
   *
   * @returns `true` when a pending request already exists for (user, plan).
   */
  export async function existsPendingByUserAndPlan(
    userId: number,
    planId: number,
    tx?: DBTransaction
  ): Promise<boolean> {
    if (tx) {
      const rows = await tx
        .select({ id: subscriptions.id })
        .from(subscriptions)
        .where(
          and(eq(subscriptions.userId, userId), eq(subscriptions.planId, planId), eq(subscriptions.status, "pending"))
        )
        .limit(1);
      return rows.length > 0;
    }
    const result = await queryDb<{ id: number }>(EXISTS_PENDING_BY_USER_AND_PLAN_SQL, [userId, planId]);
    return result.rows.length > 0;
  }

  /**
   * Every subscription owned by `userId`, newest first (`created_at DESC`,
   * `id DESC` as the deterministic same-millisecond tiebreak — identity
   * monotonicity), the `mySubscriptions` read behind the storefront's
   * pending-request state.
   *
   * @returns The user's subscription rows (any status), newest first.
   */
  export async function listByUserId(userId: number, tx?: DBTransaction): Promise<SubscriptionSelectType[]> {
    if (tx) {
      return tx
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.userId, userId))
        .orderBy(desc(subscriptions.createdAt), desc(subscriptions.id));
    }
    const result = await queryDb<SubscriptionSelectType>(LIST_BY_USER_SQL, [userId]);
    return result.rows;
  }
}
