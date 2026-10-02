/**
 * ParentRepository tests — 100% branch coverage for the `findById` seam of
 * the `parents` role-child data-access layer.
 *
 * Per `backend/db/test/AGENTS.md`:
 *  - Transactional-path cases run inside `runInRollback` with `tx` passed to
 *    EVERY repo call; the default-executor (no-tx) arms run against a
 *    committed fixture created in `beforeAll` and hard-deleted in `afterAll`
 *    (rule 9) with a zero-residue probe.
 *  - Fixtures ONLY via `entity-setup.ts` helpers (no seed data).
 *  - No `console.*`; zero raw SQL in the tests (the repo owns the SQL).
 *
 * Tier map (the repo suite's 4-Tier DB test convention):
 *  - Tier 1 (Contract): the found/not-found arms of the transactional read —
 *    the row round-trips with its exact closed key set (shared PK + the two
 *    timestamps; a `parents` row carries no other columns).
 *  - Tier 2 (Boundary/executors): the default-executor (no-tx) arms — the
 *    committed fixture resolves through the raw `queryDb` read path and a
 *    nonexistent id returns `null` on BOTH executor paths.
 *  - Tier 4 (Rollback): a role-child row written inside the outer tx is
 *    visible to an in-tx read and invisible after the forced rollback.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { inArray } from "drizzle-orm";
import { db } from "@/backend/db";
import { ParentRepository } from "@/backend/db/repo";
import { users } from "@/backend/db/schema/users/users";
import { createTestParent, createTestUser } from "@/backend/db/test/entity-setup";
import { runInRollback } from "@/backend/db/test/test-utils";
import type { DBTransaction } from "@/backend/types";

/** The exact key set of a `parents` row — nothing more, nothing less. */
const PARENT_ROW_KEYS: readonly string[] = ["id", "createdAt", "updatedAt"];

/** Id far beyond the identity sequence's reach — guaranteed nonexistent. */
const NONEXISTENT_USER_ID = 2_000_000_000;

/** A committed parent fixture (default-executor read target). */
interface CommittedFixture {
  readonly parentUserId: number;
}

let committed: CommittedFixture | null = null;

/** Narrows the committed fixture, failing loudly if `beforeAll` never ran. */
function requireCommitted(): CommittedFixture {
  if (!committed) {
    throw new Error("Committed fixtures not initialized — beforeAll failed");
  }
  return committed;
}

/** Ascending comparator — deterministic across locales (sonarjs-compliant). */
function byKeyAscending(a: string, b: string): number {
  return a.localeCompare(b);
}

/** Asserts set-equality of a row's own keys against the expected closed shape. */
function expectExactKeys(row: object, keys: readonly string[]): void {
  expect(Object.keys(row).toSorted(byKeyAscending)).toEqual([...keys].toSorted(byKeyAscending));
}

/**
 * Creates one parent (user + `parents` role row) inside the supplied
 * transaction and returns the identity fields the assertions pin. The
 * role-child row carries only the shared PK + schema-default timestamps.
 */
async function setupParent(tx: DBTransaction): Promise<{ userId: number; createdAt: Date; updatedAt: Date }> {
  const user = await createTestUser(tx, { role: "parent" });
  const parent = await createTestParent(tx, user.id);
  return { userId: user.id, createdAt: parent.createdAt, updatedAt: parent.updatedAt };
}

beforeAll(async () => {
  committed = await db.transaction(async tx => {
    const parent = await setupParent(tx);
    return { parentUserId: parent.userId };
  });
});

afterAll(async () => {
  const fixtures = committed;
  committed = null;
  if (!fixtures) {
    return;
  }
  // The users delete cascades the `parents` role row (shared PK, ON DELETE
  // CASCADE) — no separate role-row delete is needed.
  await db.delete(users).where(inArray(users.id, [fixtures.parentUserId]));
  // Zero-residue probe: the committed fixture is fully gone.
  expect(await ParentRepository.findById(fixtures.parentUserId)).toBeNull();
});

describe("ParentRepository.findById", () => {
  test("Tier 1 — round-trips the role-child row inside the tx", async () => {
    await runInRollback(async tx => {
      const parent = await setupParent(tx);
      const found = await ParentRepository.findById(parent.userId, tx);
      if (!found) {
        throw new Error("findById should resolve the parent role-child row");
      }
      expectExactKeys(found, PARENT_ROW_KEYS);
      expect(found.id).toBe(parent.userId);
      expect(found.createdAt).toEqual(parent.createdAt);
      expect(found.updatedAt).toEqual(parent.updatedAt);
    });
  });

  test("Tier 1 — a user without a role-child row reads back null (tx path)", async () => {
    await runInRollback(async tx => {
      // The user exists but deliberately has NO `parents` role row — the
      // shared-PK miss is exactly what the service's parents-row probe sees.
      const user = await createTestUser(tx, { role: "parent" });
      expect(await ParentRepository.findById(user.id, tx)).toBeNull();
    });
  });

  test("Tier 2 — default-executor (no tx) path resolves the committed fixture", async () => {
    const fixtures = requireCommitted();
    const found = await ParentRepository.findById(fixtures.parentUserId);
    if (!found) {
      throw new Error("findById should resolve the committed parent fixture");
    }
    expectExactKeys(found, PARENT_ROW_KEYS);
    expect(found.id).toBe(fixtures.parentUserId);
  });

  test("Tier 2 — nonexistent id returns null on both executor paths", async () => {
    await runInRollback(async tx => {
      expect(await ParentRepository.findById(NONEXISTENT_USER_ID, tx)).toBeNull();
    });
    expect(await ParentRepository.findById(NONEXISTENT_USER_ID)).toBeNull();
  });

  test("Tier 4 — a role-child row written inside the outer tx rolls back with it", async () => {
    let writtenUserId = 0;
    await runInRollback(async tx => {
      const parent = await setupParent(tx);
      writtenUserId = parent.userId;
      // Visible INSIDE the transaction (the write joined the outer tx)…
      expect(await ParentRepository.findById(writtenUserId, tx)).not.toBeNull();
    });
    // …and invisible on a fresh session AFTER the forced rollback.
    expect(await ParentRepository.findById(writtenUserId)).toBeNull();
  });
});
