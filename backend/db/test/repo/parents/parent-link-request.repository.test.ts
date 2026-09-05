/**
 * ParentLinkRequestRepository tests — 100% method coverage for the
 * parent→student link-request data-access layer.
 *
 * Per `backend/db/test/AGENTS.md`:
 *  - Every test runs inside `runInRollback` with `tx` passed to EVERY repo
 *    call (last parameter); the default-executor (no-tx) arms run against a
 *    committed fixture created in `beforeAll` and hard-deleted in `afterAll`
 *    (rule 9) with zero-residue probes.
 *  - Fixtures ONLY via `entity-setup.ts` helpers + one file-local bulk
 *    insert helper (no seed data).
 *  - NEVER `expect(...).rejects.toThrow()` — error surfaces are asserted via
 *    the `expectRepoError` try/catch helper.
 *  - No `console.*`; zero raw SQL in the tests (the repo owns the SQL).
 *
 * Tier map (the repo suite's 4-Tier DB test convention):
 *  - Tier 1 (Contract): create/findById/findPendingByPair round-trips; ALL
 *    zero-row classifier arms of the guarded claims (nonexistent id, wrong
 *    owner, already-resolved, expired-at-write-instant); sibling expiry
 *    counts + winner exclusion; cancel scopes; list ordering / deterministic
 *    tie-break / LIMIT 50; joined payloads carry the counterpart name.
 *  - Tier 2 (Boundary/executors): claim exactly AT `expiresAt` returns NULL
 *    (strict `>` false) with ±1ms parity on both sides; default-executor
 *    (no-tx) read paths resolve the committed fixture.
 *  - Tier 3 (Hostile): partial-unique insert conflict surfaces the RAW
 *    23505 (`parent_link_requests_pending_pair_unique`) — the service owns
 *    the final mapping; re-application after withdrawal SUCCEEDS (partial
 *    index only guards pending rows); concurrent same-pair inserts produce
 *    exactly one winner + one 23505 (skip-gated under pglite via
 *    `isPgliteProvider` — this environment is real PostgreSQL, so it RUNS).
 *  - Tier 4 (Rollback): fixtures written inside `runInRollback` are
 *    invisible after the forced rollback; writes issued with the outer `tx`
 *    join it (in-tx visibility, post-rollback invisibility).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { and, eq, gt, inArray, lte } from "drizzle-orm";
import { db } from "@/backend/db";
import { ParentLinkRequestReminderRepository, ParentLinkRequestRepository } from "@/backend/db/repo";
import { parentLinkRequests } from "@/backend/db/schema/parents/parent-link-requests";
import { users } from "@/backend/db/schema/users/users";
import { createTestParent, createTestStudent, createTestUser } from "@/backend/db/test/entity-setup";
import { constraintNameOf, expectRepoError, runInRollback } from "@/backend/db/test/test-utils";
import { LinkStatus } from "@/backend/enum/shared/link-status.enum";
import type { DBTransaction, ParentLinkRequestSelectType } from "@/backend/types";
import { PARENT_LINK_REQUEST_MS } from "@/shared/constants";
import { isPgliteProvider } from "@/test/helpers/skip-when-pglite";

/** The exact key set of an outgoing joined row — nothing more, nothing less. */
const OUTGOING_ROW_KEYS: readonly string[] = [
  "id",
  "parentId",
  "studentId",
  "status",
  "createdAt",
  "expiresAt",
  "respondedAt",
  "studentFullName",
];

/** The exact key set of an incoming joined row. */
const INCOMING_ROW_KEYS: readonly string[] = [
  "id",
  "parentId",
  "studentId",
  "status",
  "createdAt",
  "expiresAt",
  "respondedAt",
  "parentFullName",
];

/** Ascending comparator — deterministic across locales (sonarjs-compliant). */
function byKeyAscending(a: string, b: string): number {
  return a.localeCompare(b);
}

/** Asserts set-equality of a row's own keys against the expected closed shape. */
function expectExactKeys(row: object, keys: readonly string[]): void {
  expect(Object.keys(row).toSorted(byKeyAscending)).toEqual([...keys].toSorted(byKeyAscending));
}

/** Id far beyond the identity sequence's reach — guaranteed nonexistent. */
const NONEXISTENT_REQUEST_ID = 2_000_000_000;

/** pg constraint name of the partial unique index guarding live pendings. */
const PENDING_PAIR_UNIQUE = "parent_link_requests_pending_pair_unique";

/** A committed link-request fixture (default-executor read target). */
interface CommittedPair {
  readonly parentUserId: number;
  readonly studentId: number;
  readonly requestId: number;
  readonly parentFullName: string;
  readonly studentFullName: string;
}

/** Second committed pair WITHOUT any request — host for the 23505 race. */
interface CommittedRacePair {
  readonly parentUserId: number;
  readonly studentId: number;
}

interface CommittedFixtures {
  readonly pending: CommittedPair;
  readonly race: CommittedRacePair;
}

let committed: CommittedFixtures | null = null;

/** Narrows the committed fixtures, failing loudly if `beforeAll` never ran. */
function requireCommitted(): CommittedFixtures {
  if (!committed) {
    throw new Error("Committed fixtures not initialized — beforeAll failed");
  }
  return committed;
}

/**
 * Creates one (parent, student) link pair inside the supplied transaction:
 * parent user + `parents` role row + student user + `students` role row.
 * Every identity field is unique per call (random suffixes in the helpers).
 */
async function setupLinkPair(tx: DBTransaction): Promise<{
  parentUserId: number;
  parentFullName: string;
  studentId: number;
  studentFullName: string;
}> {
  const parentUser = await createTestUser(tx, { role: "parent" });
  await createTestParent(tx, parentUser.id);
  const studentUser = await createTestUser(tx);
  const student = await createTestStudent(tx, studentUser.id);
  return {
    parentUserId: parentUser.id,
    parentFullName: parentUser.fullName,
    studentId: student.id,
    studentFullName: studentUser.fullName,
  };
}

/** Creates a fresh student (user + role row) and returns the students row. */
async function setupStudent(
  tx: DBTransaction
): Promise<{ userId: number; studentId: number; studentFullName: string }> {
  const user = await createTestUser(tx);
  const student = await createTestStudent(tx, user.id);
  return { userId: user.id, studentId: student.id, studentFullName: user.fullName };
}

/** Creates a fresh parent (user + role row) and returns the user row. */
async function setupParent(tx: DBTransaction): Promise<{ id: number; fullName: string }> {
  const user = await createTestUser(tx, { role: "parent" });
  await createTestParent(tx, user.id);
  return { id: user.id, fullName: user.fullName };
}

/**
 * Bulk-inserts link requests in ONE statement (identity ids are assigned in
 * array order; `created_at` defaults to the transaction-start timestamp, so
 * all rows created inside one tx share it — the list tie-break contract is
 * exercised deterministically). An optional explicit `status` lets the list
 * fixtures build RESOLVED history rows — the partial-unique index admits only
 * ONE live pending per (parent, student) pair, so multi-row same-pair
 * fixtures must mark all but one row resolved (append-and-transition
 * semantics: rows are never deleted, history grows past the read cap).
 */
async function insertRequests(
  tx: DBTransaction,
  specs: ReadonlyArray<{ parentId: number; studentId: number; expiresAt: Date; status?: LinkStatus }>
): Promise<ParentLinkRequestSelectType[]> {
  return tx
    .insert(parentLinkRequests)
    .values(
      specs.map(spec => ({
        parentId: spec.parentId,
        studentId: spec.studentId,
        expiresAt: spec.expiresAt,
        status: spec.status,
      }))
    )
    .returning();
}

/** Creates one live pending request for the pair inside the tx. */
async function createPending(
  tx: DBTransaction,
  parentId: number,
  studentId: number,
  expiresAt: Date
): Promise<ParentLinkRequestSelectType> {
  return ParentLinkRequestRepository.create({ parentId, studentId, expiresAt }, tx);
}

beforeAll(async () => {
  committed = await db.transaction(async tx => {
    // Pair 1 — parent A → student S, one live pending request.
    const parentA = await setupParent(tx);
    const studentS = await setupStudent(tx);
    const created = await createPending(
      tx,
      parentA.id,
      studentS.studentId,
      new Date(Math.floor((Date.now() + PARENT_LINK_REQUEST_MS) / 1000) * 1000)
    );
    // Pair 2 — parent B → student S2, deliberately request-free (race host).
    const parentB = await setupParent(tx);
    const studentS2 = await setupStudent(tx);
    return {
      pending: {
        parentUserId: parentA.id,
        studentId: studentS.studentId,
        requestId: created.id,
        parentFullName: parentA.fullName,
        studentFullName: studentS.studentFullName,
      },
      race: { parentUserId: parentB.id, studentId: studentS2.studentId },
    };
  });
});

afterAll(async () => {
  const fixtures = committed;
  committed = null;
  if (!fixtures) {
    return;
  }
  // Teardown order (requests BEFORE role children/users — both request
  // FKs are ON DELETE RESTRICT).
  await db
    .delete(parentLinkRequests)
    .where(inArray(parentLinkRequests.parentId, [fixtures.pending.parentUserId, fixtures.race.parentUserId]));
  await db
    .delete(users)
    .where(
      inArray(users.id, [
        fixtures.pending.parentUserId,
        fixtures.pending.studentId,
        fixtures.race.parentUserId,
        fixtures.race.studentId,
      ])
    );
  // Zero-residue probes (users delete cascades the role rows — shared PK).
  expect(await ParentLinkRequestRepository.findById(fixtures.pending.requestId)).toBeNull();
  expect(
    await ParentLinkRequestRepository.findPendingByPair(fixtures.pending.parentUserId, fixtures.pending.studentId)
  ).toBeNull();
  expect(
    await ParentLinkRequestRepository.findPendingByPair(fixtures.race.parentUserId, fixtures.race.studentId)
  ).toBeNull();
});

describe("ParentLinkRequestRepository.create", () => {
  test("Tier 1 — inserts with the schema-default pending status and verbatim payload", async () => {
    await runInRollback(async tx => {
      const pair = await setupLinkPair(tx);
      const expiresAt = new Date(Math.floor((Date.now() + PARENT_LINK_REQUEST_MS) / 1000) * 1000);
      const row = await createPending(tx, pair.parentUserId, pair.studentId, expiresAt);
      expect(row.parentId).toBe(pair.parentUserId);
      expect(row.studentId).toBe(pair.studentId);
      expect(row.status).toBe(LinkStatus.Pending);
      expect(row.expiresAt).toEqual(expiresAt);
      expect(row.respondedAt).toBeNull();
      expect(row.createdAt).toBeInstanceOf(Date);
    });
  });

  test("Tier 4 — a request created inside the outer tx rolls back with it", async () => {
    let createdId = 0;
    await runInRollback(async tx => {
      const pair = await setupLinkPair(tx);
      const row = await createPending(
        tx,
        pair.parentUserId,
        pair.studentId,
        new Date(Math.floor((Date.now() + PARENT_LINK_REQUEST_MS) / 1000) * 1000)
      );
      createdId = row.id;
      // Visible INSIDE the transaction (the write joined the outer tx)…
      expect(await ParentLinkRequestRepository.findById(createdId, tx)).not.toBeNull();
    });
    // …and invisible on a fresh session AFTER the forced rollback.
    expect(await ParentLinkRequestRepository.findById(createdId)).toBeNull();
  });
});

describe("ParentLinkRequestRepository.findById", () => {
  test("Tier 1 — round-trips the row inside the tx", async () => {
    await runInRollback(async tx => {
      const pair = await setupLinkPair(tx);
      const created = await createPending(
        tx,
        pair.parentUserId,
        pair.studentId,
        new Date(Math.floor((Date.now() + PARENT_LINK_REQUEST_MS) / 1000) * 1000)
      );
      const found = await ParentLinkRequestRepository.findById(created.id, tx);
      expect(found).not.toBeNull();
      expect(found?.id).toBe(created.id);
      expect(found?.parentId).toBe(pair.parentUserId);
      expect(found?.studentId).toBe(pair.studentId);
      expect(found?.status).toBe(LinkStatus.Pending);
      expect(found?.expiresAt).toEqual(created.expiresAt);
    });
  });

  test("Tier 2 — default-executor (no tx) path resolves the committed fixture", async () => {
    const fixtures = requireCommitted();
    const row = await ParentLinkRequestRepository.findById(fixtures.pending.requestId);
    expect(row).not.toBeNull();
    expect(row?.status).toBe(LinkStatus.Pending);
    expect(row?.studentId).toBe(fixtures.pending.studentId);
  });

  test("Tier 3 — nonexistent id returns null on both executor paths", async () => {
    await runInRollback(async tx => {
      expect(await ParentLinkRequestRepository.findById(NONEXISTENT_REQUEST_ID, tx)).toBeNull();
    });
    expect(await ParentLinkRequestRepository.findById(NONEXISTENT_REQUEST_ID)).toBeNull();
  });
});

describe("ParentLinkRequestRepository.findPendingByPair", () => {
  test("Tier 1 — resolves the live pending row for the (parent, student) pair", async () => {
    await runInRollback(async tx => {
      const pair = await setupLinkPair(tx);
      const created = await createPending(
        tx,
        pair.parentUserId,
        pair.studentId,
        new Date(Math.floor((Date.now() + PARENT_LINK_REQUEST_MS) / 1000) * 1000)
      );
      const found = await ParentLinkRequestRepository.findPendingByPair(pair.parentUserId, pair.studentId, tx);
      expect(found?.id).toBe(created.id);
    });
  });

  test("Tier 2 — default-executor path resolves the committed pair; a request-free pair misses", async () => {
    const fixtures = requireCommitted();
    const found = await ParentLinkRequestRepository.findPendingByPair(
      fixtures.pending.parentUserId,
      fixtures.pending.studentId
    );
    expect(found?.id).toBe(fixtures.pending.requestId);
    expect(
      await ParentLinkRequestRepository.findPendingByPair(fixtures.race.parentUserId, fixtures.race.studentId)
    ).toBeNull();
  });

  test("Tier 3 — wrong student / resolved / expired statuses all collapse to null", async () => {
    await runInRollback(async tx => {
      const parent = await setupParent(tx);
      const studentA = await setupStudent(tx);
      const studentB = await setupStudent(tx);
      const created = await createPending(
        tx,
        parent.id,
        studentA.studentId,
        new Date(Math.floor((Date.now() + PARENT_LINK_REQUEST_MS) / 1000) * 1000)
      );
      // Wrong student — same parent, different target.
      expect(await ParentLinkRequestRepository.findPendingByPair(parent.id, studentB.studentId, tx)).toBeNull();
      // Confirmed → status predicate fails.
      await ParentLinkRequestRepository.respondToPendingForStudent(
        created.id,
        studentA.studentId,
        LinkStatus.Confirmed,
        new Date(Math.floor(Date.now() / 1000) * 1000),
        tx
      );
      expect(await ParentLinkRequestRepository.findPendingByPair(parent.id, studentA.studentId, tx)).toBeNull();
      // Expired → status predicate fails. The confirmed row above can no
      // longer be touched by `markExpiredIfPending` (status = 'pending'
      // conjunct), so the expired arm gets its OWN pending row — a second
      // parent of the same student — which is then materialized and probed.
      const secondParent = await setupParent(tx);
      const expiring = await createPending(
        tx,
        secondParent.id,
        studentA.studentId,
        new Date(Math.floor((Date.now() + PARENT_LINK_REQUEST_MS) / 1000) * 1000)
      );
      await ParentLinkRequestRepository.markExpiredIfPending(expiring.id, tx);
      expect(await ParentLinkRequestRepository.findPendingByPair(secondParent.id, studentA.studentId, tx)).toBeNull();
    });
  });
});

describe("ParentLinkRequestRepository.respondToPendingForStudent", () => {
  test("Tier 1 — accept arm claims the row as confirmed with respondedAt stamped", async () => {
    await runInRollback(async tx => {
      const pair = await setupLinkPair(tx);
      const created = await createPending(
        tx,
        pair.parentUserId,
        pair.studentId,
        new Date(Math.floor((Date.now() + PARENT_LINK_REQUEST_MS) / 1000) * 1000)
      );
      const now = new Date(Math.floor(Date.now() / 1000) * 1000);
      const claimed = await ParentLinkRequestRepository.respondToPendingForStudent(
        created.id,
        pair.studentId,
        LinkStatus.Confirmed,
        now,
        tx
      );
      expect(claimed?.id).toBe(created.id);
      expect(claimed?.status).toBe(LinkStatus.Confirmed);
      expect(claimed?.respondedAt).toEqual(now);
      expect(await ParentLinkRequestRepository.findPendingByPair(pair.parentUserId, pair.studentId, tx)).toBeNull();
    });
  });

  test("Tier 1 — reject arm folds to rejected (the row itself is the decision record)", async () => {
    await runInRollback(async tx => {
      const pair = await setupLinkPair(tx);
      const created = await createPending(
        tx,
        pair.parentUserId,
        pair.studentId,
        new Date(Math.floor((Date.now() + PARENT_LINK_REQUEST_MS) / 1000) * 1000)
      );
      const now = new Date(Math.floor(Date.now() / 1000) * 1000);
      const claimed = await ParentLinkRequestRepository.respondToPendingForStudent(
        created.id,
        pair.studentId,
        LinkStatus.Rejected,
        now,
        tx
      );
      expect(claimed?.status).toBe(LinkStatus.Rejected);
      expect(claimed?.respondedAt).toEqual(now);
    });
  });

  test("Tier 3 — ALL zero-row classifier arms: nonexistent / foreign owner / resolved / expired", async () => {
    await runInRollback(async tx => {
      const pair = await setupLinkPair(tx);
      const foreign = await setupLinkPair(tx);
      const created = await createPending(
        tx,
        pair.parentUserId,
        pair.studentId,
        new Date(Math.floor((Date.now() + PARENT_LINK_REQUEST_MS) / 1000) * 1000)
      );
      // Nonexistent id.
      expect(
        await ParentLinkRequestRepository.respondToPendingForStudent(
          NONEXISTENT_REQUEST_ID,
          pair.studentId,
          LinkStatus.Confirmed,
          new Date(Math.floor(Date.now() / 1000) * 1000),
          tx
        )
      ).toBeNull();
      // Foreign owner — BOLA is denied at the statement level.
      expect(
        await ParentLinkRequestRepository.respondToPendingForStudent(
          created.id,
          foreign.studentId,
          LinkStatus.Confirmed,
          new Date(Math.floor(Date.now() / 1000) * 1000),
          tx
        )
      ).toBeNull();
      // The foreign claim attempt left the row untouched.
      expect((await ParentLinkRequestRepository.findById(created.id, tx))?.status).toBe(LinkStatus.Pending);
      // Already-resolved — the second claim matches zero rows.
      await ParentLinkRequestRepository.respondToPendingForStudent(
        created.id,
        pair.studentId,
        LinkStatus.Confirmed,
        new Date(Math.floor(Date.now() / 1000) * 1000),
        tx
      );
      expect(
        await ParentLinkRequestRepository.respondToPendingForStudent(
          created.id,
          pair.studentId,
          LinkStatus.Confirmed,
          new Date(Math.floor(Date.now() / 1000) * 1000),
          tx
        )
      ).toBeNull();
      // Expired-at-write-instant — a PAST request cannot be claimed by a
      // `now` after its expiry.
      const stale = await createPending(
        tx,
        pair.parentUserId,
        foreign.studentId,
        new Date(Date.now() - PARENT_LINK_REQUEST_MS)
      );
      expect(
        await ParentLinkRequestRepository.respondToPendingForStudent(
          stale.id,
          foreign.studentId,
          LinkStatus.Confirmed,
          new Date(Math.floor(Date.now() / 1000) * 1000),
          tx
        )
      ).toBeNull();
      expect((await ParentLinkRequestRepository.findById(stale.id, tx))?.status).toBe(LinkStatus.Pending);
    });
  });

  test("Tier 2 — boundary: claim exactly AT expiresAt returns NULL (strict >), ±1ms parity holds", async () => {
    await runInRollback(async tx => {
      const parent = await setupParent(tx);
      const base = new Date(Math.floor(Date.now() / 1000) * 1000);
      // (a) exactly at the expiry instant → strict `expires_at > now` is FALSE.
      const atExpiry = await createPending(tx, parent.id, (await setupStudent(tx)).studentId, base);
      expect(
        await ParentLinkRequestRepository.respondToPendingForStudent(
          atExpiry.id,
          atExpiry.studentId,
          LinkStatus.Confirmed,
          base,
          tx
        )
      ).toBeNull();
      // (b) one millisecond BEFORE the expiry instant → claim SUCCEEDS.
      const beforeExpiry = await createPending(
        tx,
        parent.id,
        (await setupStudent(tx)).studentId,
        new Date(base.getTime() + 1)
      );
      const claimed = await ParentLinkRequestRepository.respondToPendingForStudent(
        beforeExpiry.id,
        beforeExpiry.studentId,
        LinkStatus.Confirmed,
        base,
        tx
      );
      expect(claimed?.id).toBe(beforeExpiry.id);
      // (c) one millisecond AFTER the expiry instant → claim FAILS.
      const pastExpiry = await createPending(
        tx,
        parent.id,
        (await setupStudent(tx)).studentId,
        new Date(base.getTime() + 1)
      );
      expect(
        await ParentLinkRequestRepository.respondToPendingForStudent(
          pastExpiry.id,
          pastExpiry.studentId,
          LinkStatus.Confirmed,
          new Date(base.getTime() + 2),
          tx
        )
      ).toBeNull();
    });
  });
});

describe("ParentLinkRequestRepository.cancelPendingForParent", () => {
  test("Tier 1 — the requesting parent folds their own pending to rejected", async () => {
    await runInRollback(async tx => {
      const pair = await setupLinkPair(tx);
      const created = await createPending(
        tx,
        pair.parentUserId,
        pair.studentId,
        new Date(Math.floor((Date.now() + PARENT_LINK_REQUEST_MS) / 1000) * 1000)
      );
      const now = new Date(Math.floor(Date.now() / 1000) * 1000);
      const cancelled = await ParentLinkRequestRepository.cancelPendingForParent(
        created.id,
        pair.parentUserId,
        now,
        tx
      );
      expect(cancelled?.id).toBe(created.id);
      expect(cancelled?.status).toBe(LinkStatus.Rejected);
      expect(cancelled?.respondedAt).toEqual(now);
      // Withdrawal is silent history: the pair classifier sees no pending.
      expect(await ParentLinkRequestRepository.findPendingByPair(pair.parentUserId, pair.studentId, tx)).toBeNull();
    });
  });

  test("Tier 3 — cancel scopes: foreign parent / nonexistent / resolved / expired → null", async () => {
    await runInRollback(async tx => {
      const pair = await setupLinkPair(tx);
      const foreign = await setupLinkPair(tx);
      const created = await createPending(
        tx,
        pair.parentUserId,
        pair.studentId,
        new Date(Math.floor((Date.now() + PARENT_LINK_REQUEST_MS) / 1000) * 1000)
      );
      expect(
        await ParentLinkRequestRepository.cancelPendingForParent(
          NONEXISTENT_REQUEST_ID,
          pair.parentUserId,
          new Date(Math.floor(Date.now() / 1000) * 1000),
          tx
        )
      ).toBeNull();
      // Foreign parent cannot withdraw someone else's request.
      expect(
        await ParentLinkRequestRepository.cancelPendingForParent(
          created.id,
          foreign.parentUserId,
          new Date(Math.floor(Date.now() / 1000) * 1000),
          tx
        )
      ).toBeNull();
      expect((await ParentLinkRequestRepository.findById(created.id, tx))?.status).toBe(LinkStatus.Pending);
      // Already-resolved (withdrawn) — the second cancel matches zero rows.
      await ParentLinkRequestRepository.cancelPendingForParent(
        created.id,
        pair.parentUserId,
        new Date(Math.floor(Date.now() / 1000) * 1000),
        tx
      );
      expect(
        await ParentLinkRequestRepository.cancelPendingForParent(
          created.id,
          pair.parentUserId,
          new Date(Math.floor(Date.now() / 1000) * 1000),
          tx
        )
      ).toBeNull();
      // Expired-at-write-instant.
      const stale = await createPending(
        tx,
        pair.parentUserId,
        foreign.studentId,
        new Date(Date.now() - PARENT_LINK_REQUEST_MS)
      );
      expect(
        await ParentLinkRequestRepository.cancelPendingForParent(
          stale.id,
          pair.parentUserId,
          new Date(Math.floor(Date.now() / 1000) * 1000),
          tx
        )
      ).toBeNull();
    });
  });

  test("Tier 2 — boundary: withdrawal exactly AT expiresAt returns NULL, −1ms still folds", async () => {
    await runInRollback(async tx => {
      const parent = await setupParent(tx);
      const base = new Date(Math.floor(Date.now() / 1000) * 1000);
      const atExpiry = await createPending(tx, parent.id, (await setupStudent(tx)).studentId, base);
      expect(await ParentLinkRequestRepository.cancelPendingForParent(atExpiry.id, parent.id, base, tx)).toBeNull();
      // One millisecond before the instant still withdraws.
      const beforeExpiry = await createPending(
        tx,
        parent.id,
        (await setupStudent(tx)).studentId,
        new Date(base.getTime() + 1)
      );
      const cancelled = await ParentLinkRequestRepository.cancelPendingForParent(beforeExpiry.id, parent.id, base, tx);
      expect(cancelled?.status).toBe(LinkStatus.Rejected);
    });
  });
});

describe("ParentLinkRequestRepository.markExpiredIfPending", () => {
  test("Tier 1 — materializes expired, leaves respondedAt NULL, and is idempotent", async () => {
    await runInRollback(async tx => {
      const pair = await setupLinkPair(tx);
      const created = await createPending(
        tx,
        pair.parentUserId,
        pair.studentId,
        new Date(Date.now() - PARENT_LINK_REQUEST_MS)
      );
      const firstCall = await ParentLinkRequestRepository.markExpiredIfPending(created.id, tx);
      expect(firstCall).toBeUndefined();
      const row = await ParentLinkRequestRepository.findById(created.id, tx);
      expect(row?.status).toBe(LinkStatus.Expired);
      expect(row?.respondedAt).toBeNull();
      // Idempotent by predicate — the second materialization is a no-op.
      await ParentLinkRequestRepository.markExpiredIfPending(created.id, tx);
      expect((await ParentLinkRequestRepository.findById(created.id, tx))?.status).toBe(LinkStatus.Expired);
    });
  });

  test("Tier 1 — a resolved (confirmed) row is never re-materialized as expired", async () => {
    await runInRollback(async tx => {
      const pair = await setupLinkPair(tx);
      const created = await createPending(
        tx,
        pair.parentUserId,
        pair.studentId,
        new Date(Math.floor((Date.now() + PARENT_LINK_REQUEST_MS) / 1000) * 1000)
      );
      await ParentLinkRequestRepository.respondToPendingForStudent(
        created.id,
        pair.studentId,
        LinkStatus.Confirmed,
        new Date(Math.floor(Date.now() / 1000) * 1000),
        tx
      );
      await ParentLinkRequestRepository.markExpiredIfPending(created.id, tx);
      expect((await ParentLinkRequestRepository.findById(created.id, tx))?.status).toBe(LinkStatus.Confirmed);
    });
  });
});

describe("ParentLinkRequestRepository.markAllExpiredIfPending", () => {
  test("Tier 1 — bulk-materializes ONLY lapsed pendings; live and resolved rows untouched; respondedAt stays NULL", async () => {
    await runInRollback(async tx => {
      const studentA = await setupStudent(tx);
      const studentB = await setupStudent(tx);
      const parentA = await setupParent(tx);
      const parentB = await setupParent(tx);
      // Delta probe BEFORE fixtures (the sweep is TABLE-WIDE — pre-existing
      // lapsed residue committed by earlier runs is swept too; the probe must
      // not see our own rows).
      const residue = await tx
        .select({ id: parentLinkRequests.id })
        .from(parentLinkRequests)
        .where(
          and(
            eq(parentLinkRequests.status, LinkStatus.Pending),
            lte(parentLinkRequests.expiresAt, new Date(Math.floor(Date.now() / 1000) * 1000))
          )
        );
      const past = new Date(Date.now() - PARENT_LINK_REQUEST_MS);
      const future = new Date(Math.floor((Date.now() + PARENT_LINK_REQUEST_MS) / 1000) * 1000);
      const rows = await insertRequests(tx, [
        { parentId: parentA.id, studentId: studentA.studentId, expiresAt: past }, // lapsed pending → swept
        { parentId: parentB.id, studentId: studentA.studentId, expiresAt: past }, // lapsed pending → swept
        { parentId: parentA.id, studentId: studentB.studentId, expiresAt: future }, // live pending → untouched
        { parentId: parentB.id, studentId: studentB.studentId, expiresAt: past, status: LinkStatus.Confirmed }, // history → untouched
        { parentId: parentA.id, studentId: studentA.studentId, expiresAt: past, status: LinkStatus.Rejected }, // history → untouched
      ]);
      expect(rows).toHaveLength(5);

      const sweptCount = await ParentLinkRequestRepository.markAllExpiredIfPending(
        new Date(Math.floor(Date.now() / 1000) * 1000),
        tx
      );
      expect(sweptCount).toBe(residue.length + 2);

      const after = await tx
        .select()
        .from(parentLinkRequests)
        .where(
          inArray(
            parentLinkRequests.id,
            rows.map(row => row.id)
          )
        );
      const byId = new Map(after.map(row => [row.id, row]));
      expect(byId.get(rows[0]?.id)?.status).toBe(LinkStatus.Expired);
      expect(byId.get(rows[1]?.id)?.status).toBe(LinkStatus.Expired);
      // Both swept rows keep respondedAt NULL (expiry is not a participant response).
      expect(byId.get(rows[0]?.id)?.respondedAt).toBeNull();
      expect(byId.get(rows[1]?.id)?.respondedAt).toBeNull();
      // Live pending and resolved history are untouched.
      expect(byId.get(rows[2]?.id)?.status).toBe(LinkStatus.Pending);
      expect(byId.get(rows[3]?.id)?.status).toBe(LinkStatus.Confirmed);
      expect(byId.get(rows[4]?.id)?.status).toBe(LinkStatus.Rejected);
    });
  });

  test("Tier 1 — idempotent by predicate: the re-run matches zero rows and returns 0", async () => {
    await runInRollback(async tx => {
      const pair = await setupLinkPair(tx);
      await insertRequests(tx, [
        {
          parentId: pair.parentUserId,
          studentId: pair.studentId,
          expiresAt: new Date(Math.floor((Date.now() - 1000) / 1000) * 1000),
        },
      ]);
      // Delta-based: the first sweep takes the fixture plus any residue; the
      // re-runs MUST match zero rows — the idempotency contract.
      const first = await ParentLinkRequestRepository.markAllExpiredIfPending(
        new Date(Math.floor(Date.now() / 1000) * 1000),
        tx
      );
      expect(first).toBeGreaterThanOrEqual(1);
      expect(
        await ParentLinkRequestRepository.markAllExpiredIfPending(new Date(Math.floor(Date.now() / 1000) * 1000), tx)
      ).toBe(0);
      expect(
        await ParentLinkRequestRepository.markAllExpiredIfPending(new Date(Math.floor(Date.now() / 1000) * 1000), tx)
      ).toBe(0);
    });
  });

  test("Tier 2 — boundary: a row expiring EXACTLY at the sweep instant IS lapsed (strict-`>` expiry side), +1ms is not", async () => {
    await runInRollback(async tx => {
      const student = await setupStudent(tx);
      const parentA = await setupParent(tx);
      const parentB = await setupParent(tx);
      const atBoundary = new Date(Date.now() + 5_000);
      // Delta probe BEFORE fixtures (must not count our own boundary row).
      const residue = await tx
        .select({ id: parentLinkRequests.id })
        .from(parentLinkRequests)
        .where(and(eq(parentLinkRequests.status, LinkStatus.Pending), lte(parentLinkRequests.expiresAt, atBoundary)));
      const rows = await insertRequests(tx, [
        { parentId: parentA.id, studentId: student.studentId, expiresAt: atBoundary }, // expires_at == now → swept
        { parentId: parentB.id, studentId: student.studentId, expiresAt: new Date(atBoundary.getTime() + 1) }, // +1ms → live
      ]);
      const sweptCount = await ParentLinkRequestRepository.markAllExpiredIfPending(atBoundary, tx);
      expect(sweptCount).toBe(residue.length + 1);
      const after = await tx
        .select()
        .from(parentLinkRequests)
        .where(
          inArray(
            parentLinkRequests.id,
            rows.map(row => row.id)
          )
        );
      const byId = new Map(after.map(row => [row.id, row]));
      expect(byId.get(rows[0]?.id)?.status).toBe(LinkStatus.Expired);
      expect(byId.get(rows[1]?.id)?.status).toBe(LinkStatus.Pending);
    });
  });
});

describe("ParentLinkRequestRepository.claimPendingForExpiryReminder", () => {
  test("Tier 1 — claims ONLY in-window unmarked pendings; lapsed/out-of-window/resolved rows untouched; marker set", async () => {
    await runInRollback(async tx => {
      const studentA = await setupStudent(tx);
      const studentB = await setupStudent(tx);
      const parentA = await setupParent(tx);
      const parentB = await setupParent(tx);
      const now = new Date(Date.now() + 60_000); // injected clock — repo fn takes now/horizon
      const horizon = new Date(now.getTime() + 3_600_000);
      const inWindow = new Date(now.getTime() + 1_800_000); // expires mid-window → claimed
      const beyond = new Date(now.getTime() + 7_200_000); // expires past horizon → untouched
      // Delta probe BEFORE fixtures (the claim is window-wide — committed
      // in-window residue from earlier runs would be claimed too).
      const residue = await tx
        .select({ id: parentLinkRequests.id })
        .from(parentLinkRequests)
        .where(
          and(
            eq(parentLinkRequests.status, LinkStatus.Pending),
            gt(parentLinkRequests.expiresAt, now),
            lte(parentLinkRequests.expiresAt, horizon)
          )
        );
      const rows = await insertRequests(tx, [
        { parentId: parentA.id, studentId: studentA.studentId, expiresAt: inWindow }, // → claimed
        { parentId: parentB.id, studentId: studentA.studentId, expiresAt: beyond }, // out of window → untouched
        { parentId: parentA.id, studentId: studentB.studentId, expiresAt: new Date(now.getTime() - 1_000) }, // lapsed → the sweep's business
        { parentId: parentB.id, studentId: studentB.studentId, expiresAt: inWindow, status: LinkStatus.Confirmed }, // history → untouched
        { parentId: parentB.id, studentId: studentA.studentId, expiresAt: inWindow, status: LinkStatus.Rejected }, // history → untouched (partial unique admits it: only one PENDING per pair)
      ]);
      expect(rows).toHaveLength(5);
      // Named fixture rows — definedness pinned by the length assertion above.
      const [inWindowRow, beyondRow, lapsedRow, confirmedRow, rejectedRow] = rows;

      const claimed = await ParentLinkRequestReminderRepository.claimPendingForExpiryReminder(now, horizon, tx);

      // Exactly our one in-window fixture PLUS any committed in-window residue.
      expect(claimed).toHaveLength(residue.length + 1);
      const claimedIds = new Set(claimed.map(row => row.id));
      expect(claimedIds.has(inWindowRow.id)).toBe(true);
      for (const residueRow of residue) {
        expect(claimedIds.has(residueRow.id)).toBe(true);
      }
      // The claimed row carries the emission payload (parent/student/expiry).
      const claimedFixture = claimed.find(row => row.id === inWindowRow.id);
      expect(claimedFixture).toMatchObject({
        parentId: parentA.id,
        studentId: studentA.studentId,
        expiresAt: inWindow,
      });

      // The marker is materialized on the claimed row and ONLY on it.
      const after = await tx
        .select()
        .from(parentLinkRequests)
        .where(
          inArray(
            parentLinkRequests.id,
            rows.map(row => row.id)
          )
        );
      const byId = new Map(after.map(row => [row.id, row]));
      expect(byId.get(inWindowRow.id)?.reminderSentAt).not.toBeNull();
      expect(byId.get(beyondRow.id)?.reminderSentAt).toBeNull(); // out of window
      expect(byId.get(lapsedRow.id)?.reminderSentAt).toBeNull(); // lapsed
      expect(byId.get(confirmedRow.id)?.reminderSentAt).toBeNull(); // confirmed
      expect(byId.get(rejectedRow.id)?.reminderSentAt).toBeNull(); // rejected
      // Untouched rows keep their status (the claim is NOT a lifecycle write).
      expect(byId.get(beyondRow.id)?.status).toBe(LinkStatus.Pending);
      expect(byId.get(lapsedRow.id)?.status).toBe(LinkStatus.Pending);
      expect(byId.get(confirmedRow.id)?.status).toBe(LinkStatus.Confirmed);
      expect(byId.get(rejectedRow.id)?.status).toBe(LinkStatus.Rejected);
    });
  });

  test("Tier 1 — idempotent by predicate: the re-run claims zero rows", async () => {
    await runInRollback(async tx => {
      const student = await setupStudent(tx);
      const parent = await setupParent(tx);
      const now = new Date(Math.floor(Date.now() / 1000) * 1000);
      const horizon = new Date(now.getTime() + 3_600_000);
      await insertRequests(tx, [
        { parentId: parent.id, studentId: student.studentId, expiresAt: new Date(now.getTime() + 1_800_000) },
      ]);
      const first = await ParentLinkRequestReminderRepository.claimPendingForExpiryReminder(now, horizon, tx);
      expect(first.length).toBeGreaterThanOrEqual(1);
      expect(await ParentLinkRequestReminderRepository.claimPendingForExpiryReminder(now, horizon, tx)).toHaveLength(0);
      expect(await ParentLinkRequestReminderRepository.claimPendingForExpiryReminder(now, horizon, tx)).toHaveLength(0);
    });
  });

  test("Tier 2 — boundaries: a row expiring EXACTLY at the horizon IS claimed (inclusive upper edge); EXACTLY at now is NOT (strict-`>` liveness)", async () => {
    await runInRollback(async tx => {
      const student = await setupStudent(tx);
      const parentA = await setupParent(tx);
      const parentB = await setupParent(tx);
      const now = new Date(Date.now() + 60_000);
      const horizon = new Date(now.getTime() + 3_600_000);
      const rows = await insertRequests(tx, [
        { parentId: parentA.id, studentId: student.studentId, expiresAt: horizon }, // == horizon → claimed
        { parentId: parentB.id, studentId: student.studentId, expiresAt: now }, // == now → lapsed side
      ]);
      expect(rows).toHaveLength(2);
      // Named fixture rows — definedness pinned by the length assertion above.
      const [atHorizonRow, atNowRow] = rows;
      const claimed = await ParentLinkRequestReminderRepository.claimPendingForExpiryReminder(now, horizon, tx);
      const claimedIds = claimed.map(row => row.id);
      expect(claimedIds).toContain(atHorizonRow.id);
      expect(claimedIds).not.toContain(atNowRow.id);
    });
  });
});

describe("ParentLinkRequestRepository.listStudentFullNamesByIds", () => {
  test("Tier 1 — resolves the student-side display names; unknown ids and empty input resolve to nothing", async () => {
    await runInRollback(async tx => {
      const studentA = await setupStudent(tx);
      const studentB = await setupStudent(tx);
      const names = await ParentLinkRequestReminderRepository.listStudentFullNamesByIds(
        [studentA.studentId, studentB.studentId],
        tx
      );
      expect(names.get(studentA.studentId)).toBe(studentA.studentFullName);
      expect(names.get(studentB.studentId)).toBe(studentB.studentFullName);
      // A nonexistent student id never fabricates a name.
      expect(names.has(999_999_999)).toBe(false);
      // Empty input short-circuits to an empty map (no query).
      expect((await ParentLinkRequestReminderRepository.listStudentFullNamesByIds([], tx)).size).toBe(0);
    });
  });
});

describe("ParentLinkRequestRepository.expireSiblingPendingsForStudent", () => {
  test("Tier 1 — expires every OTHER pending, excludes the winner, returns the count", async () => {
    await runInRollback(async tx => {
      const student = await setupStudent(tx);
      const parentA = await setupParent(tx);
      const parentB = await setupParent(tx);
      const parentC = await setupParent(tx);
      const expiresAt = new Date(Math.floor((Date.now() + PARENT_LINK_REQUEST_MS) / 1000) * 1000);
      const rows = await insertRequests(tx, [
        { parentId: parentA.id, studentId: student.studentId, expiresAt },
        { parentId: parentB.id, studentId: student.studentId, expiresAt },
        { parentId: parentC.id, studentId: student.studentId, expiresAt },
      ]);
      const oldest = rows[0];
      const winner = rows[1];
      const newest = rows[2];
      expect(oldest).toBeDefined();
      expect(winner).toBeDefined();
      expect(newest).toBeDefined();
      if (!oldest || !winner || !newest) {
        return;
      }
      const expiredCount = await ParentLinkRequestRepository.expireSiblingPendingsForStudent(
        student.studentId,
        winner.id,
        tx
      );
      expect(expiredCount).toBe(2);
      expect((await ParentLinkRequestRepository.findById(winner.id, tx))?.status).toBe(LinkStatus.Pending);
      expect((await ParentLinkRequestRepository.findById(oldest.id, tx))?.status).toBe(LinkStatus.Expired);
      expect((await ParentLinkRequestRepository.findById(newest.id, tx))?.status).toBe(LinkStatus.Expired);
      // Idempotent sweep: siblings are no longer pending, count drops to 0.
      expect(await ParentLinkRequestRepository.expireSiblingPendingsForStudent(student.studentId, winner.id, tx)).toBe(
        0
      );
    });
  });

  test("Tier 3 — resolved siblings are never touched by the sweep", async () => {
    await runInRollback(async tx => {
      const student = await setupStudent(tx);
      const parentA = await setupParent(tx);
      const parentB = await setupParent(tx);
      const expiresAt = new Date(Math.floor((Date.now() + PARENT_LINK_REQUEST_MS) / 1000) * 1000);
      const rows = await insertRequests(tx, [
        { parentId: parentA.id, studentId: student.studentId, expiresAt },
        { parentId: parentB.id, studentId: student.studentId, expiresAt },
      ]);
      const rejected = rows[0];
      const winner = rows[1];
      expect(rejected).toBeDefined();
      expect(winner).toBeDefined();
      if (!rejected || !winner) {
        return;
      }
      await ParentLinkRequestRepository.respondToPendingForStudent(
        rejected.id,
        student.studentId,
        LinkStatus.Rejected,
        new Date(Math.floor(Date.now() / 1000) * 1000),
        tx
      );
      expect(await ParentLinkRequestRepository.expireSiblingPendingsForStudent(student.studentId, winner.id, tx)).toBe(
        0
      );
      expect((await ParentLinkRequestRepository.findById(rejected.id, tx))?.status).toBe(LinkStatus.Rejected);
      expect((await ParentLinkRequestRepository.findById(winner.id, tx))?.status).toBe(LinkStatus.Pending);
    });
  });
});

describe("ParentLinkRequestRepository.listOutgoingForParent", () => {
  test("Tier 1 — ordering created_at DESC with id DESC tie-break; counterpart name carried", async () => {
    await runInRollback(async tx => {
      const pair = await setupLinkPair(tx);
      const studentB = await setupStudent(tx);
      const studentC = await setupStudent(tx);
      const expiresAt = new Date(Math.floor((Date.now() + PARENT_LINK_REQUEST_MS) / 1000) * 1000);
      // Three rows sharing ONE transaction timestamp → order decided by id
      // DESC. One pending row PER PAIR (different students) — the
      // partial-unique index admits multiple students for one parent.
      const rows = await insertRequests(tx, [
        { parentId: pair.parentUserId, studentId: pair.studentId, expiresAt },
        { parentId: pair.parentUserId, studentId: studentB.studentId, expiresAt },
        { parentId: pair.parentUserId, studentId: studentC.studentId, expiresAt },
      ]);
      const oldest = rows[0];
      const middle = rows[1];
      const newest = rows[2];
      expect(oldest).toBeDefined();
      expect(middle).toBeDefined();
      expect(newest).toBeDefined();
      if (!oldest || !middle || !newest) {
        return;
      }
      await ParentLinkRequestRepository.cancelPendingForParent(
        oldest.id,
        pair.parentUserId,
        new Date(Math.floor(Date.now() / 1000) * 1000),
        tx
      );
      await ParentLinkRequestRepository.markExpiredIfPending(middle.id, tx);
      const list = await ParentLinkRequestRepository.listOutgoingForParent(pair.parentUserId, tx);
      expect(list.map(row => row.id)).toEqual([newest.id, middle.id, oldest.id]);
      for (const row of list) {
        expectExactKeys(row, OUTGOING_ROW_KEYS);
        expect(row.parentId).toBe(pair.parentUserId);
      }
      // The joined counterpart name follows each row's OWN student.
      expect(list.find(row => row.id === newest.id)?.studentFullName).toBe(studentC.studentFullName);
      expect(list.find(row => row.id === middle.id)?.studentFullName).toBe(studentB.studentFullName);
      expect(list.find(row => row.id === oldest.id)?.studentFullName).toBe(pair.studentFullName);
    });
  });

  test("Tier 1 — LIMIT 50 caps the history list (55 rows → newest 50, deterministic)", async () => {
    await runInRollback(async tx => {
      const pair = await setupLinkPair(tx);
      const expiresAt = new Date(Math.floor((Date.now() + PARENT_LINK_REQUEST_MS) / 1000) * 1000);
      // 55-row history for ONE pair: the partial-unique index admits only one
      // live pending per pair, so the older 54 rows are inserted as `expired`
      // history (append-and-transition semantics — rows are never deleted and
      // the pair's history grows past the read cap).
      const specs = Array.from({ length: 55 }, (_, index) => ({
        parentId: pair.parentUserId,
        studentId: pair.studentId,
        expiresAt,
        status: index < 54 ? LinkStatus.Expired : LinkStatus.Pending,
      }));
      const rows = await insertRequests(tx, specs);
      expect(rows).toHaveLength(55);
      const newest = rows.at(-1);
      expect(newest).toBeDefined();
      if (!newest) {
        return;
      }
      const list = await ParentLinkRequestRepository.listOutgoingForParent(pair.parentUserId, tx);
      expect(list).toHaveLength(50);
      expect(list[0]?.id).toBe(newest.id);
      expect(list.at(-1)?.id).toBe(newest.id - 49);
      // Strictly descending ids — the cap did not disturb determinism.
      const ids = list.map(row => row.id);
      expect(ids.toSorted((a, b) => b - a)).toEqual(ids);
    });
  });

  test("Tier 1 — another parent's outgoing list is empty (self-scoped read)", async () => {
    await runInRollback(async tx => {
      const pair = await setupLinkPair(tx);
      const outsider = await setupLinkPair(tx);
      await createPending(
        tx,
        pair.parentUserId,
        pair.studentId,
        new Date(Math.floor((Date.now() + PARENT_LINK_REQUEST_MS) / 1000) * 1000)
      );
      expect(await ParentLinkRequestRepository.listOutgoingForParent(outsider.parentUserId, tx)).toEqual([]);
    });
  });

  test("Tier 2 — default-executor path lists the committed fixture with the student name", async () => {
    const fixtures = requireCommitted();
    const list = await ParentLinkRequestRepository.listOutgoingForParent(fixtures.pending.parentUserId);
    const row = list.find(item => item.id === fixtures.pending.requestId);
    expect(row).not.toBeNull();
    expect(row?.studentFullName).toBe(fixtures.pending.studentFullName);
    expect(row?.status).toBe(LinkStatus.Pending);
  });

  test("Tier 4 — rows listed inside the rollback tx vanish from the default executor", async () => {
    let pairParentId = 0;
    await runInRollback(async tx => {
      const pair = await setupLinkPair(tx);
      pairParentId = pair.parentUserId;
      await createPending(
        tx,
        pair.parentUserId,
        pair.studentId,
        new Date(Math.floor((Date.now() + PARENT_LINK_REQUEST_MS) / 1000) * 1000)
      );
      expect(await ParentLinkRequestRepository.listOutgoingForParent(pair.parentUserId, tx)).toHaveLength(1);
    });
    expect(await ParentLinkRequestRepository.listOutgoingForParent(pairParentId)).toEqual([]);
  });
});

describe("ParentLinkRequestRepository.listIncomingForStudent", () => {
  test("Tier 1 — ordering/tie-break, status mix, and parent counterpart names", async () => {
    await runInRollback(async tx => {
      const student = await setupStudent(tx);
      const parentA = await setupParent(tx);
      const parentB = await setupParent(tx);
      const parentC = await setupParent(tx);
      const expiresAt = new Date(Math.floor((Date.now() + PARENT_LINK_REQUEST_MS) / 1000) * 1000);
      const rows = await insertRequests(tx, [
        { parentId: parentA.id, studentId: student.studentId, expiresAt },
        { parentId: parentB.id, studentId: student.studentId, expiresAt },
        { parentId: parentC.id, studentId: student.studentId, expiresAt },
      ]);
      const fromA = rows[0];
      const fromB = rows[1];
      const fromC = rows[2];
      expect(fromA).toBeDefined();
      expect(fromB).toBeDefined();
      expect(fromC).toBeDefined();
      if (!fromA || !fromB || !fromC) {
        return;
      }
      await ParentLinkRequestRepository.cancelPendingForParent(
        fromB.id,
        parentB.id,
        new Date(Math.floor(Date.now() / 1000) * 1000),
        tx
      );
      await ParentLinkRequestRepository.markExpiredIfPending(fromC.id, tx);
      const list = await ParentLinkRequestRepository.listIncomingForStudent(student.studentId, tx);
      expect(list.map(row => row.id)).toEqual([fromC.id, fromB.id, fromA.id]);
      expect(list.map(row => row.status)).toEqual([LinkStatus.Expired, LinkStatus.Rejected, LinkStatus.Pending]);
      for (const row of list) {
        expectExactKeys(row, INCOMING_ROW_KEYS);
      }
      expect(list.find(row => row.id === fromA.id)?.parentFullName).toBe(parentA.fullName);
      expect(list.find(row => row.id === fromB.id)?.parentFullName).toBe(parentB.fullName);
      expect(list.find(row => row.id === fromC.id)?.parentFullName).toBe(parentC.fullName);
    });
  });

  test("Tier 2 — default-executor path lists the committed incoming row with the parent name", async () => {
    const fixtures = requireCommitted();
    const list = await ParentLinkRequestRepository.listIncomingForStudent(fixtures.pending.studentId);
    const row = list.find(item => item.id === fixtures.pending.requestId);
    expect(row).not.toBeNull();
    expect(row?.parentFullName).toBe(fixtures.pending.parentFullName);
    expect(row?.status).toBe(LinkStatus.Pending);
  });
});

describe("ParentLinkRequestRepository.findOutgoingRowById / findIncomingRowById", () => {
  test("Tier 1 — single-row joins carry exactly the closed key sets + counterpart names", async () => {
    await runInRollback(async tx => {
      const pair = await setupLinkPair(tx);
      const created = await createPending(
        tx,
        pair.parentUserId,
        pair.studentId,
        new Date(Math.floor((Date.now() + PARENT_LINK_REQUEST_MS) / 1000) * 1000)
      );
      const outgoing = await ParentLinkRequestRepository.findOutgoingRowById(created.id, tx);
      expect(outgoing).not.toBeNull();
      if (outgoing) {
        expectExactKeys(outgoing, OUTGOING_ROW_KEYS);
        expect(outgoing.studentFullName).toBe(pair.studentFullName);
        expect(outgoing.parentId).toBe(pair.parentUserId);
      }
      const incoming = await ParentLinkRequestRepository.findIncomingRowById(created.id, tx);
      expect(incoming).not.toBeNull();
      if (incoming) {
        expectExactKeys(incoming, INCOMING_ROW_KEYS);
        expect(incoming.parentFullName).toBe(pair.parentFullName);
        expect(incoming.studentId).toBe(pair.studentId);
      }
    });
  });

  test("Tier 3 — nonexistent id returns null on both rows and both executor paths", async () => {
    await runInRollback(async tx => {
      expect(await ParentLinkRequestRepository.findOutgoingRowById(NONEXISTENT_REQUEST_ID, tx)).toBeNull();
      expect(await ParentLinkRequestRepository.findIncomingRowById(NONEXISTENT_REQUEST_ID, tx)).toBeNull();
    });
    expect(await ParentLinkRequestRepository.findOutgoingRowById(NONEXISTENT_REQUEST_ID)).toBeNull();
    expect(await ParentLinkRequestRepository.findIncomingRowById(NONEXISTENT_REQUEST_ID)).toBeNull();
  });

  test("Tier 2 — default-executor paths resolve the committed fixture rows", async () => {
    const fixtures = requireCommitted();
    const outgoing = await ParentLinkRequestRepository.findOutgoingRowById(fixtures.pending.requestId);
    expect(outgoing?.studentFullName).toBe(fixtures.pending.studentFullName);
    const incoming = await ParentLinkRequestRepository.findIncomingRowById(fixtures.pending.requestId);
    expect(incoming?.parentFullName).toBe(fixtures.pending.parentFullName);
  });
});

describe("ParentLinkRequestRepository — partial-unique conflict (Tier 3)", () => {
  test("second live pending for one pair surfaces the RAW 23505 constraint", async () => {
    await runInRollback(async tx => {
      const pair = await setupLinkPair(tx);
      const expiresAt = new Date(Math.floor((Date.now() + PARENT_LINK_REQUEST_MS) / 1000) * 1000);
      await createPending(tx, pair.parentUserId, pair.studentId, expiresAt);
      // The colliding insert runs inside a SAVEPOINT (Drizzle nested
      // transaction): the 23505 rolls back ONLY the savepoint, leaving the
      // outer rollback-tx usable for the post-conflict probes below. Without
      // the bracket the tx would be aborted (25P02) after the violation.
      // The repo propagates the raw unique violation — the SERVICE owns the
      // final PARENT_LINK_ALREADY_PENDING mapping.
      const error = await expectRepoError(() =>
        tx.transaction(async sp => createPending(sp, pair.parentUserId, pair.studentId, expiresAt))
      );
      expect(constraintNameOf(error)).toBe(PENDING_PAIR_UNIQUE);
      // The RAW pg unique-violation rides the cause chain under Drizzle's
      // "failed query" wrapper — the repo propagates it unchanged and the
      // service classifies it.
      expect(hasUniqueViolationCode(error)).toBe(true);
      // Partial index: after the pending row is withdrawn, a FRESH request
      // for the same pair is admitted again.
      const pending = await ParentLinkRequestRepository.findPendingByPair(pair.parentUserId, pair.studentId, tx);
      expect(pending).not.toBeNull();
      if (pending) {
        await ParentLinkRequestRepository.cancelPendingForParent(
          pending.id,
          pair.parentUserId,
          new Date(Math.floor(Date.now() / 1000) * 1000),
          tx
        );
      }
      const reapplied = await createPending(tx, pair.parentUserId, pair.studentId, expiresAt);
      expect(reapplied.status).toBe(LinkStatus.Pending);
    });
  });
});

/** Wholesale-skip wrapper for the true-concurrency arm — PGlite cannot host cross-connection races. */
const describeOnRealPostgres = isPgliteProvider() ? describe.skip : describe;

/**
 * Walks the Drizzle error cause chain hunting the PostgreSQL unique-violation
 * code (`23505`) — mirrors the traversal precedent of `hasUniqueViolationCode`
 * in `registration.service.test.ts` / `isUniqueViolation` in
 * `user-provisioning.helpers.ts` (Drizzle masks driver errors behind its
 * generic "failed query" message, so the top-level `message` is NOT the raw
 * database error; the code lives on the cause-chain pg error).
 */
function hasUniqueViolationCode(error: unknown): boolean {
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    if ("code" in current && current.code === "23505") {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

describeOnRealPostgres("ParentLinkRequestRepository — concurrent creation race (Tier 3, real PostgreSQL)", () => {
  test("same-pair concurrent pendings: exactly one winner, one raw 23505", async () => {
    const fixtures = requireCommitted();
    const expiresAt = new Date(Math.floor((Date.now() + PARENT_LINK_REQUEST_MS) / 1000) * 1000);
    const attempt = () =>
      db.transaction(async tx => createPending(tx, fixtures.race.parentUserId, fixtures.race.studentId, expiresAt));
    const outcomes = await Promise.allSettled([attempt(), attempt()]);
    const fulfilled = outcomes.filter(
      (outcome): outcome is PromiseFulfilledResult<ParentLinkRequestSelectType> => outcome.status === "fulfilled"
    );
    const rejected = outcomes.filter((outcome): outcome is PromiseRejectedResult => outcome.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const loserError = rejected[0]?.reason;
    expect(loserError).toBeInstanceOf(Error);
    expect(constraintNameOf(loserError)).toBe(PENDING_PAIR_UNIQUE);
    // Hard-delete the committed winner IMMEDIATELY (rule 9) — no residue.
    await db.delete(parentLinkRequests).where(eq(parentLinkRequests.parentId, fixtures.race.parentUserId));
    expect(
      await ParentLinkRequestRepository.findPendingByPair(fixtures.race.parentUserId, fixtures.race.studentId)
    ).toBeNull();
  });
});
