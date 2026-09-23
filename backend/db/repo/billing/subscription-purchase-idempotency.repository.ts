/**
 * SubscriptionPurchaseIdempotencyRepository — data-access layer for the
 * `subscription_purchase_idempotency` claim table.
 *
 * A claim is the durable record that an idempotency key has already been
 * spent on a subscription purchase: the producing service inserts it
 * IN-PHASE with the subscription insert (transactional fate-sharing), so a
 * replayed request either joins the same transaction (duplicate claim
 * insert → PostgreSQL unique-violation, code `23505`) or — after the
 * original committed — finds the claim by key and replays the
 * already-created subscription via `subscription_id`.
 *
 * The `23505` raised by a duplicate `insertClaim` is deliberately NOT
 * caught or translated here: it bubbles to the service's cause-chain
 * handler, which traverses the Drizzle error wrapper (`cause` chain, never
 * the top-level message) and decides between the duplicate-conflict and
 * replay outcomes. This repository stays a pure data-access surface.
 *
 * Conventions per `backend/db/repo/AGENTS.md`:
 *  - One `namespace` per repository file; the namespace name is the
 *    canonical export.
 *  - Every method takes `tx?` as its LAST parameter. Reads run on the
 *    caller's transaction when supplied and fall back to raw parameterized
 *    SQL via `queryDb` (the Neon-HTTP-eligible pattern) otherwise; writes
 *    execute on `tx ?? db`.
 *  - NO prepared statements and NO array-membership operators — the key is
 *    an opaque bound parameter in every statement. The key is never logged,
 *    never coerced, and carried verbatim (≤128 chars, DB-enforced).
 *  - No business logic, no permission checks, no i18n or logging imports —
 *    the caller decides what a miss means.
 */

import { eq } from "drizzle-orm";
import { db, queryDb } from "@/backend/db";
import { subscriptionPurchaseIdempotency } from "@/backend/db/schema/billing/subscription-purchase-idempotency";
import { ConflictError } from "@/backend/lib/errors";
import type {
  DBQueryExecutor,
  DBTransaction,
  SubscriptionPurchaseIdempotencyInsertType,
  SubscriptionPurchaseIdempotencySelectType,
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

/** Column alias list for standalone reads — mirrors `$inferSelect` typing 1:1. */
const CLAIM_SELECT_COLUMNS = `
  id, idempotency_key AS "idempotencyKey", user_id AS "userId",
  subscription_id AS "subscriptionId", created_at AS "createdAt"`;

export namespace SubscriptionPurchaseIdempotencyRepository {
  /**
   * Inserts one idempotency claim row and returns it
   * (`INSERT … RETURNING`).
   *
   * The caller supplies the raw opaque key (the `x-idempotency-key` header
   * value, carried verbatim) and the purchasing user; `subscriptionId` is
   * left null at claim time and backfilled by `updateClaimSubscriptionId`
   * once the subscription row exists, and the schema default stamps
   * `createdAt`. A duplicate key violates
   * `subscription_purchase_idempotency_key_unique` and raises PostgreSQL
   * `23505`, which this method does NOT catch — the error bubbles to the
   * service cause-chain handler exactly as the driver produced it
   * (constraint name, schema, and diagnostic intact).
   *
   * @returns The inserted claim row with all server-generated columns
   *          populated.
   * @throws ConflictError when the INSERT somehow returns no row — the
   *         claim insert invariant makes that unreachable, so it can only
   *         mean a broken driver contract.
   */
  export async function insertClaim(
    insert: SubscriptionPurchaseIdempotencyInsertType,
    tx?: DBTransaction
  ): Promise<SubscriptionPurchaseIdempotencySelectType> {
    const executor = tx ?? db;
    const [row] = await executor.insert(subscriptionPurchaseIdempotency).values(insert).returning();
    if (!row) {
      throw new ConflictError("SubscriptionPurchaseIdempotencyRepository.insertClaim: insert returned no rows");
    }
    return row;
  }

  /**
   * Backfills the subscription id onto an existing claim (the purchase
   * flow's final write: claim insert → subscription/payment inserts → this
   * backfill, all in ONE transaction). The key itself is never re-written —
   * only the nullable `subscription_id` pointer, so the claim's
   * duplicate-blocking identity is untouched.
   *
   * @throws The defensive invariant — a `ConflictError` — when zero rows
   *         matched: inside the purchase flow this is unreachable (the
   *         claim was inserted in the same transaction) and can only mean a
   *         broken contract.
   */
  export async function updateClaimSubscriptionId(
    claimId: number,
    subscriptionId: number,
    tx?: DBTransaction
  ): Promise<void> {
    const executor = tx ?? db;
    const rows = await executor
      .update(subscriptionPurchaseIdempotency)
      .set({ subscriptionId })
      .where(eq(subscriptionPurchaseIdempotency.id, claimId))
      .returning({ id: subscriptionPurchaseIdempotency.id });
    if (!rows[0]) {
      throw new ConflictError(
        "SubscriptionPurchaseIdempotencyRepository.updateClaimSubscriptionId: update matched no rows"
      );
    }
  }

  /**
   * Finds a claim row by its opaque idempotency key — the replay-branch
   * lookup. The key is an equality-bound parameter in both executor
   * branches: never interpolated, never logged, never coerced or
   * truncated.
   *
   * @returns The matching claim row (with the replayed `subscriptionId`
   *          when the backfill landed), or `null` when the key is
   *          unclaimed. Whether the claiming user matches the replaying
   *          caller is the service's decision — this method is the raw key
   *          read.
   */
  export async function findByKey(
    key: string,
    tx?: DBQueryExecutor
  ): Promise<SubscriptionPurchaseIdempotencySelectType | null> {
    if (tx && isDBTransaction(tx)) {
      // Transactional read — Drizzle select on the supplied executor.
      const rows = await tx
        .select()
        .from(subscriptionPurchaseIdempotency)
        .where(eq(subscriptionPurchaseIdempotency.idempotencyKey, key))
        .limit(1);
      return rows[0] ?? null;
    }
    // Non-transactional read — raw SQL via queryDb (Neon HTTP fast path).
    const result = await queryDb<SubscriptionPurchaseIdempotencySelectType>(
      `SELECT ${CLAIM_SELECT_COLUMNS}
       FROM subscription_purchase_idempotency WHERE idempotency_key = $1 LIMIT 1`,
      [key]
    );
    return result.rows[0] ?? null;
  }
}
