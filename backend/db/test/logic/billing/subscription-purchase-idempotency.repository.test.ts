/**
 * SubscriptionPurchaseIdempotencyRepository tests — the purchase claim
 * table's data-access layer (`insertClaim`, `updateClaimSubscriptionId`,
 * `findByKey`).
 *
 * Per `backend/db/test/AGENTS.md`:
 *  - Rollback-isolated tests run inside `runInRollback`; `tx` is passed to
 *    EVERY repo call, entity-setup helper, and direct Drizzle query (on
 *    every method under test `tx` is the LAST parameter).
 *  - Entities are created ONLY via `entity-setup.ts` helpers — never seed
 *    data.
 *  - No `expect(...).rejects.toThrow()` — the duplicate-claim probe goes
 *    through `expectRepoError` inside an explicit SAVEPOINT bracket (a
 *    failed statement aborts the surrounding PostgreSQL transaction, so
 *    the bracket keeps the outer transaction queryable).
 *
 * Coverage map:
 *  - Tier 1 (branch/stmt): claim insert / key read / subscription-id
 *    backfill round-trip — the inserted claim echoes every column (key
 *    verbatim, nullable subscriptionId, Date createdAt); `findByKey`
 *    reproduces the row; the backfill writes ONLY `subscriptionId`; a miss
 *    returns `null` and writes nothing.
 *  - Tier 2 (boundary): a 128-char key (the varchar capacity) is accepted
 *    and read back verbatim.
 *  - Tier 3 (chaos/integrity): a duplicate claim insert surfaces the
 *    PostgreSQL unique-violation (`23505`, constraint
 *    `subscription_purchase_idempotency_key_unique`) with the cause chain
 *    intact — the repo does NOT translate or swallow it; after the probe
 *    rollback the original claim is still the sole row and the replay path
 *    (find + backfill) is fully operational.
 *  - Tier 4 (security): the key is opaque — case/prefix variants never
 *    match (exact byte semantics); the backfill refuses an unknown claim.
 */

import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { SubscriptionPurchaseIdempotencyRepository } from "@/backend/db/repo/billing/subscription-purchase-idempotency.repository";
import { subscriptionPurchaseIdempotency } from "@/backend/db/schema/billing/subscription-purchase-idempotency";
import { createTestPlan, createTestSubscription, createTestUser } from "@/backend/db/test/entity-setup";
import { hasPostgresErrorCode } from "@/backend/db/test/pg-error";
import { expectRepoError, runInRollback } from "@/backend/db/test/test-utils";
import { SubscriptionStatus } from "@/backend/enum/billing/subscription-status.enum";
import type { DBTransaction } from "@/backend/types";

/** PostgreSQL error code for `unique_violation`. */
const PG_UNIQUE_VIOLATION = "23505";

/** Length boundary of the `idempotency_key` varchar column. */
const KEY_MAX_LENGTH = 128;

/** Physical name of the rejecting unique constraint (cause-chain assertion). */
const KEY_UNIQUE_CONSTRAINT = "subscription_purchase_idempotency_key_unique";

/** Builds an opaque in-test key of the requested exact length. */
function makeKey(length: number, tag: string): string {
  const raw = `k-${tag}-${randomUUID()}`;
  if (raw.length > length) {
    return raw.slice(0, length);
  }
  return raw.padEnd(length, "x");
}

/**
 * Walks the Drizzle error cause chain (cycle-safe — a `seen` set guards
 * against self-referential `cause` loops) hunting for the given PostgreSQL
 * SQLSTATE code. Drizzle wraps driver errors behind its own generic
 * "failed query" message, so the code is reachable only through the chain —
 * exactly what the purchase service's duplicate-branch translation will
 * consume.
 */

/** Walks the same cycle-safe cause chain searching for a message substring. */
function causeChainContainsMessage(error: unknown, substring: string): boolean {
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    if (typeof current.message === "string" && current.message.includes(substring)) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/** Creates the minimal claim owner — one `users` row is the whole actor set. */
async function createClaimOwner(tx: DBTransaction): Promise<number> {
  const user = await createTestUser(tx, { role: "student" });
  return user.id;
}

/** Creates a real subscription row (pending) to backfill the claim with. */
async function createBackfillTarget(tx: DBTransaction, userId: number): Promise<number> {
  const plan = await createTestPlan(tx);
  const subscription = await createTestSubscription(tx, userId, plan.id, {
    status: SubscriptionStatus.Pending,
  });
  return subscription.id;
}

/** Counts the claims owned by one user (in-tx read-back oracle). */
async function countClaimsForUser(tx: DBTransaction, userId: number): Promise<number> {
  const [row] = await tx
    .select({ value: sql<number>`count(*)::int` })
    .from(subscriptionPurchaseIdempotency)
    .where(eq(subscriptionPurchaseIdempotency.userId, userId));
  return row?.value ?? 0;
}

describe("SubscriptionPurchaseIdempotencyRepository", () => {
  // ─── Tier 1: claim insert / key read / backfill round-trip ───────────

  test("insertClaim echoes the full row; findByKey reproduces it; backfill writes ONLY subscriptionId", async () => {
    await runInRollback(async tx => {
      const owner = await createClaimOwner(tx);
      const key = makeKey(40, "roundtrip");

      const claim = await SubscriptionPurchaseIdempotencyRepository.insertClaim(
        { idempotencyKey: key, userId: owner },
        tx
      );
      expect(claim.id).toBeGreaterThan(0);
      expect(claim.idempotencyKey).toBe(key);
      expect(claim.userId).toBe(owner);
      expect(claim.subscriptionId).toBeNull();
      expect(claim.createdAt).toBeInstanceOf(Date);

      const found = await SubscriptionPurchaseIdempotencyRepository.findByKey(key, tx);
      expect(found).not.toBeNull();
      expect(found?.id).toBe(claim.id);
      expect(found?.idempotencyKey).toBe(key);
      expect(found?.userId).toBe(owner);
      expect(found?.subscriptionId).toBeNull();
      expect(found?.createdAt).toEqual(claim.createdAt);

      const subscriptionId = await createBackfillTarget(tx, owner);
      await SubscriptionPurchaseIdempotencyRepository.updateClaimSubscriptionId(claim.id, subscriptionId, tx);

      const after = await SubscriptionPurchaseIdempotencyRepository.findByKey(key, tx);
      expect(after?.subscriptionId).toBe(subscriptionId);
      expect(after?.idempotencyKey).toBe(key);
      expect(after?.userId).toBe(owner);
      expect(after?.createdAt).toEqual(claim.createdAt);
    });
  });

  test("findByKey returns null for an unclaimed key (miss writes nothing)", async () => {
    await runInRollback(async tx => {
      const owner = await createClaimOwner(tx);
      const key = makeKey(40, "miss");

      expect(await SubscriptionPurchaseIdempotencyRepository.findByKey(key, tx)).toBeNull();
      expect(await countClaimsForUser(tx, owner)).toBe(0);

      await SubscriptionPurchaseIdempotencyRepository.insertClaim({ idempotencyKey: key, userId: owner }, tx);
      expect(await SubscriptionPurchaseIdempotencyRepository.findByKey(makeKey(40, "other-miss"), tx)).toBeNull();
      expect(await countClaimsForUser(tx, owner)).toBe(1);
    });
  });

  test("updateClaimSubscriptionId refuses to backfill an unknown claim (defensive invariant)", async () => {
    await runInRollback(async tx => {
      const owner = await createClaimOwner(tx);
      const subscriptionId = await createBackfillTarget(tx, owner);
      const [maxClaim] = await tx
        .select({ maxId: sql<number>`coalesce(max(${subscriptionPurchaseIdempotency.id}), 0)::int` })
        .from(subscriptionPurchaseIdempotency);
      const absentClaimId = (maxClaim?.maxId ?? 0) + 1_000_000;

      const error = await expectRepoError(() =>
        SubscriptionPurchaseIdempotencyRepository.updateClaimSubscriptionId(absentClaimId, subscriptionId, tx)
      );
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toContain("update matched no rows");
    });
  });

  // ─── Tier 2: 128-char boundary ───────────────────────────────────────

  test("a 128-char key (varchar capacity) is accepted and read back verbatim", async () => {
    await runInRollback(async tx => {
      const owner = await createClaimOwner(tx);
      const key = makeKey(KEY_MAX_LENGTH, "boundary");
      expect(key).toHaveLength(KEY_MAX_LENGTH);

      const claim = await SubscriptionPurchaseIdempotencyRepository.insertClaim(
        { idempotencyKey: key, userId: owner },
        tx
      );
      expect(claim.idempotencyKey).toHaveLength(KEY_MAX_LENGTH);

      const found = await SubscriptionPurchaseIdempotencyRepository.findByKey(key, tx);
      expect(found?.id).toBe(claim.id);
      expect(found?.idempotencyKey).toBe(key);
      expect(found?.idempotencyKey).toHaveLength(KEY_MAX_LENGTH);
    });
  });

  // ─── Tier 3: duplicate insert → 23505 with the cause chain intact ────

  test("a duplicate key insert surfaces PG 23505 untranslated; the original claim stays sole and backfillable", async () => {
    await runInRollback(async tx => {
      const owner = await createClaimOwner(tx);
      const key = makeKey(48, "duplicate");
      const claim = await SubscriptionPurchaseIdempotencyRepository.insertClaim(
        { idempotencyKey: key, userId: owner },
        tx
      );

      await tx.execute(sql`savepoint purchase_claim_dup_probe`);
      const dupError = await expectRepoError(() =>
        SubscriptionPurchaseIdempotencyRepository.insertClaim({ idempotencyKey: key, userId: owner }, tx)
      );
      await tx.execute(sql`rollback to savepoint purchase_claim_dup_probe`);

      // The 23505 bubbles RAW — the repo neither catches nor translates it.
      expect(hasPostgresErrorCode(dupError, PG_UNIQUE_VIOLATION)).toBe(true);
      expect(causeChainContainsMessage(dupError, KEY_UNIQUE_CONSTRAINT)).toBe(true);

      // Post-rollback: the original claim is still the sole row and the
      // replay path (find + backfill) is fully operational.
      expect(await countClaimsForUser(tx, owner)).toBe(1);
      const replayed = await SubscriptionPurchaseIdempotencyRepository.findByKey(key, tx);
      expect(replayed?.id).toBe(claim.id);
      const subscriptionId = await createBackfillTarget(tx, owner);
      await SubscriptionPurchaseIdempotencyRepository.updateClaimSubscriptionId(claim.id, subscriptionId, tx);
      expect((await SubscriptionPurchaseIdempotencyRepository.findByKey(key, tx))?.subscriptionId).toBe(subscriptionId);
    });
  });

  // ─── Tier 4: the key is opaque — exact byte semantics ────────────────

  test("the key matches by exact bytes only — case/prefix variants never collide", async () => {
    await runInRollback(async tx => {
      const owner = await createClaimOwner(tx);
      const key = `k-MiXeD-${randomUUID()}`;

      const claim = await SubscriptionPurchaseIdempotencyRepository.insertClaim(
        { idempotencyKey: key, userId: owner },
        tx
      );
      expect(claim.idempotencyKey).toBe(key);

      expect(await SubscriptionPurchaseIdempotencyRepository.findByKey(key.toUpperCase(), tx)).toBeNull();
      expect(await SubscriptionPurchaseIdempotencyRepository.findByKey(key.toLowerCase(), tx)).toBeNull();
      expect(await SubscriptionPurchaseIdempotencyRepository.findByKey(`${key}x`, tx)).toBeNull();
      expect(await SubscriptionPurchaseIdempotencyRepository.findByKey(`x${key}`, tx)).toBeNull();

      const found = await SubscriptionPurchaseIdempotencyRepository.findByKey(key, tx);
      expect(found?.id).toBe(claim.id);
    });
  });
});
