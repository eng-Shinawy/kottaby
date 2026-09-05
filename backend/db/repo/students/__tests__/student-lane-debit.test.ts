/**
 * StudentRepository held-balance lane debit/refund tests —
 * `decrementLaneIfAvailable` (one guarded conditional UPDATE per lane) +
 * `incrementLane` (unguarded same-lane `+ 1` refund).
 *
 * Per `backend/db/test/AGENTS.md`:
 *  - Every test runs inside `runInRollback`; `tx` is passed to EVERY repo
 *    call, entity-setup helper, and direct Drizzle query (on both methods
 *    under test `tx` is the LAST parameter).
 *  - Entities are created ONLY via `entity-setup.ts` helpers
 *    (`createTestUser` + `createTestStudent`) — never seed data.
 *  - Error assertions use `expectRepoError` (try/catch) —
 *    `expect(...).rejects.toThrow()` is prohibited inside `runInRollback`.
 *
 * Coverage map:
 *  - Tier 1 (branch/stmt): every lane member (trial/hifz/tajweed) hits when
 *    funded → `true`, target lane −1, sibling lanes untouched, `updated_at`
 *    advanced; every lane member misses when empty → `false` with zero
 *    writes anywhere; refunds land `+1` per lane (including on a zero
 *    balance); missing studentId → `false` for the debit and a silent
 *    no-op for the refund (a pure UPDATE cannot create rows).
 *  - Tier 2 (boundary): balance exactly 1 → 0 succeeds and the drained lane
 *    then misses on a re-debit; balance 0 → miss; a large balance still
 *    decrements by exactly one.
 *  - Tier 3 (chaos/concurrency): concurrent debits on ONE row via
 *    `Promise.allSettled` — exactly one crosses a single-unit lane, a
 *    multi-unit lane drains to exactly zero, every outcome is fulfilled
 *    (the guarded `> 0` predicate makes the `balance_* >= 0` CHECK
 *    constraints unreachable from this method). Statements serialize on the
 *    `runInRollback` connection (pg queues queries per client) — the same
 *    per-row predicate re-evaluation a multi-connection race resolves
 *    through PostgreSQL's row lock, because the guard and the mutation
 *    share one statement (zero TOCTOU window by construction).
 *  - Tier 4 (security/tenancy/static): debiting student A leaves student B
 *    byte-identical; the lane → column resolution is unreachable by caller
 *    strings — source pins on `student.repository.ts` (map keys are
 *    computed `HeldBalanceLane` enum members only, both signatures type
 *    `lane` as `HeldBalanceLane`, no `sql.raw`, no `inArray`, no `--` in
 *    sql) with the compile-time counterpart in
 *    `student-lane-debit.test-d.ts` (a plain string argument is a type
 *    error); direct raw UPDATEs to negative paid-lane balances are rejected
 *    by the DB CHECK constraints (23514) — the backstop behind the guarded
 *    predicate.
 */

import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { StudentRepository } from "@/backend/db/repo";
import { students } from "@/backend/db/schema/students/students";
import { createTestStudent, createTestUser } from "@/backend/db/test/entity-setup";
import { expectRepoError, runInRollback } from "@/backend/db/test/test-utils";
import { HeldBalanceLane } from "@/backend/enum/scheduling/held-balance-lane.enum";
import type { DBTransaction, StudentSelectType } from "@/backend/types";

/** PostgreSQL error code for `check_violation`. */
const PG_CHECK_VIOLATION = "23514";

/** The three held-balance lane members, in canonical vocabulary order. */
const ALL_LANES = [HeldBalanceLane.Trial, HeldBalanceLane.Hifz, HeldBalanceLane.Tajweed] as const;

/** `students` balance column names (TS property keys), per lane member. */
function laneColumnKey(lane: HeldBalanceLane): "balanceTrial" | "balanceHifz" | "balanceTajweed" {
  if (lane === HeldBalanceLane.Trial) return "balanceTrial";
  if (lane === HeldBalanceLane.Hifz) return "balanceHifz";
  return "balanceTajweed";
}

/** Builds `createTestStudent` overrides that fund `lane` with `balance` (siblings stay 0). */
function laneSeed(lane: HeldBalanceLane, balance: number): Partial<StudentSelectType> {
  if (lane === HeldBalanceLane.Trial) return { balanceTrial: balance };
  if (lane === HeldBalanceLane.Hifz) return { balanceHifz: balance };
  return { balanceTajweed: balance };
}

/**
 * Walks the Drizzle `DrizzleQueryError.cause` chain to find whether the
 * original PostgreSQL error carries the given SQLSTATE code — Drizzle wraps
 * driver errors behind its own generic "failed query" message.
 */
function hasPostgresErrorCode(error: unknown, pgCode: string): boolean {
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    if ("code" in current && current.code === pgCode) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Walks the same cause chain searching for an `Error.message` containing the
 * given substring — used to confirm the underlying PostgreSQL diagnostic
 * (which names the rejecting CHECK constraint) is reachable through the
 * Drizzle wrapper.
 */
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

/**
 * Returns an integer id that cannot exist as a `students` row during this
 * transaction: students share their PK with `users.id`, so anything above
 * the current max (plus a large offset that no sequence reaches during a
 * rolled-back test) is guaranteed absent.
 */
async function absentStudentId(tx: DBTransaction): Promise<number> {
  const [row] = await tx.select({ maxId: sql<number>`coalesce(max(${students.id}), 0)::int` }).from(students);
  return (row?.maxId ?? 0) + 1_000_000;
}

/**
 * Independent read-back oracle — direct Drizzle select on the same tx, NOT
 * routed through the repository method under test.
 */
async function readStudentRow(tx: DBTransaction, studentId: number) {
  const rows = await tx.select().from(students).where(eq(students.id, studentId));
  return rows[0] ?? null;
}

/** Balance-lane snapshot of one student row (via the direct-select oracle). */
interface LaneSnapshot {
  balanceTrial: number;
  balanceHifz: number | null;
  balanceTajweed: number | null;
  updatedAt: Date;
}

async function readLaneSnapshot(tx: DBTransaction, studentId: number): Promise<LaneSnapshot> {
  const row = await readStudentRow(tx, studentId);
  if (!row) throw new Error("readLaneSnapshot: expected a students row");
  return {
    balanceTrial: row.balanceTrial,
    balanceHifz: row.balanceHifz,
    balanceTajweed: row.balanceTajweed,
    updatedAt: row.updatedAt,
  };
}

/** Creates a user + student pair with `balance` funded on `lane` (siblings 0). */
async function seedLaneStudent(tx: DBTransaction, lane: HeldBalanceLane, balance: number) {
  const user = await createTestUser(tx);
  await createTestStudent(tx, user.id, laneSeed(lane, balance));
  return user;
}

/**
 * One funded-lane debit round-trip: hit must return `true`, decrement the
 * target lane by exactly one, leave the sibling lanes at zero, and advance
 * `updated_at` (the statement stamps it explicitly — raw SQL bypasses the
 * query-builder's `$onUpdate` hook).
 */
async function expectDebitHit(tx: DBTransaction, lane: HeldBalanceLane, initial: number): Promise<void> {
  const user = await seedLaneStudent(tx, lane, initial);
  const before = await readLaneSnapshot(tx, user.id);

  const debited = await StudentRepository.decrementLaneIfAvailable(user.id, lane, tx);

  expect(debited).toBe(true);
  const after = await readLaneSnapshot(tx, user.id);
  expect(after[laneColumnKey(lane)]).toBe(initial - 1);
  for (const sibling of ALL_LANES) {
    if (sibling !== lane) expect(after[laneColumnKey(sibling)]).toBe(0);
  }
  expect(after.updatedAt.getTime()).toBeGreaterThanOrEqual(before.updatedAt.getTime());
}

/** One empty-lane debit round-trip: miss must return `false` with zero writes. */
async function expectDebitMiss(tx: DBTransaction, lane: HeldBalanceLane): Promise<void> {
  const user = await seedLaneStudent(tx, lane, 0);

  const debited = await StudentRepository.decrementLaneIfAvailable(user.id, lane, tx);

  expect(debited).toBe(false);
  const after = await readLaneSnapshot(tx, user.id);
  expect(after[laneColumnKey(lane)]).toBe(0);
}

/** One refund round-trip: the target lane must gain exactly one unit. */
async function expectRefundRoundTrip(tx: DBTransaction, lane: HeldBalanceLane, initial: number): Promise<void> {
  const user = await seedLaneStudent(tx, lane, initial);

  await StudentRepository.incrementLane(user.id, lane, tx);

  const after = await readLaneSnapshot(tx, user.id);
  expect(after[laneColumnKey(lane)]).toBe(initial + 1);
}

/** Boundary cycle: seed exactly ONE unit, debit it, then re-debit the drained lane. */
async function expectDrainCycle(tx: DBTransaction, lane: HeldBalanceLane): Promise<void> {
  const user = await seedLaneStudent(tx, lane, 1);

  const first = await StudentRepository.decrementLaneIfAvailable(user.id, lane, tx);
  expect(first).toBe(true);
  expect((await readLaneSnapshot(tx, user.id))[laneColumnKey(lane)]).toBe(0);

  const second = await StudentRepository.decrementLaneIfAvailable(user.id, lane, tx);
  expect(second).toBe(false);
  expect((await readLaneSnapshot(tx, user.id))[laneColumnKey(lane)]).toBe(0);
}

describe("StudentRepository.decrementLaneIfAvailable", () => {
  // ─── Tier 1: branch/statement ───────────────────────────────────────

  test("debits one unit from every funded lane (hit → true), siblings untouched", async () => {
    await runInRollback(async tx => {
      // Distinct initial balances catch copy-paste blindness across members.
      await expectDebitHit(tx, HeldBalanceLane.Trial, 3);
      await expectDebitHit(tx, HeldBalanceLane.Hifz, 2);
      await expectDebitHit(tx, HeldBalanceLane.Tajweed, 7);
    });
  });

  test("misses on every empty lane (miss → false), zero writes", async () => {
    await runInRollback(async tx => {
      await expectDebitMiss(tx, HeldBalanceLane.Trial);
      await expectDebitMiss(tx, HeldBalanceLane.Hifz);
      await expectDebitMiss(tx, HeldBalanceLane.Tajweed);
    });
  });

  test("an empty-lane miss writes nothing anywhere (funded sibling stays byte-identical)", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);
      await createTestStudent(tx, user.id, { balanceTrial: 0, balanceHifz: 2 });
      const before = await readLaneSnapshot(tx, user.id);

      const debited = await StudentRepository.decrementLaneIfAvailable(user.id, HeldBalanceLane.Trial, tx);

      expect(debited).toBe(false);
      const after = await readLaneSnapshot(tx, user.id);
      // Deep equality across all lanes + timestamps: the miss matched zero
      // rows, so not even `updated_at` moved.
      expect(after).toEqual(before);
    });
  });

  test("nonexistent studentId returns false and creates no row", async () => {
    await runInRollback(async tx => {
      const missingId = await absentStudentId(tx);

      const debited = await StudentRepository.decrementLaneIfAvailable(missingId, HeldBalanceLane.Trial, tx);

      expect(debited).toBe(false);
      const row = await readStudentRow(tx, missingId);
      expect(row).toBeNull();
    });
  });

  // ─── Tier 2: boundary ───────────────────────────────────────────────

  test("balance exactly 1 → 0 succeeds, then the drained lane misses on re-debit", async () => {
    await runInRollback(async tx => {
      await expectDrainCycle(tx, HeldBalanceLane.Trial);
      await expectDrainCycle(tx, HeldBalanceLane.Hifz);
      await expectDrainCycle(tx, HeldBalanceLane.Tajweed);
    });
  });

  test("a large balance still decrements by exactly one", async () => {
    await runInRollback(async tx => {
      const user = await seedLaneStudent(tx, HeldBalanceLane.Hifz, 1_000_000);

      const debited = await StudentRepository.decrementLaneIfAvailable(user.id, HeldBalanceLane.Hifz, tx);

      expect(debited).toBe(true);
      expect((await readLaneSnapshot(tx, user.id)).balanceHifz).toBe(999_999);
    });
  });

  // ─── Tier 3: chaos/concurrency ──────────────────────────────────────

  test("three concurrent debits on a single-unit lane: exactly one crosses", async () => {
    await runInRollback(async tx => {
      const user = await seedLaneStudent(tx, HeldBalanceLane.Trial, 1);

      const settled = await Promise.allSettled([
        StudentRepository.decrementLaneIfAvailable(user.id, HeldBalanceLane.Trial, tx),
        StudentRepository.decrementLaneIfAvailable(user.id, HeldBalanceLane.Trial, tx),
        StudentRepository.decrementLaneIfAvailable(user.id, HeldBalanceLane.Trial, tx),
      ]);

      expect(settled).toHaveLength(3);
      // Every outcome fulfilled — the guarded predicate rejects the losers
      // as a boolean miss; the CHECK constraints are never reachable.
      for (const outcome of settled) {
        expect(outcome.status).toBe("fulfilled");
      }
      const booleans = settled.map(outcome => (outcome.status === "fulfilled" ? outcome.value : null));
      expect(booleans.filter(Boolean)).toHaveLength(1);

      // The lane drained to exactly zero — never negative.
      const after = await readLaneSnapshot(tx, user.id);
      expect(after.balanceTrial).toBe(0);
      expect(after.balanceHifz).toBe(0);
      expect(after.balanceTajweed).toBe(0);
    });
  });

  test("five concurrent debits on a two-unit lane: exactly two cross, lane drains to zero", async () => {
    await runInRollback(async tx => {
      const user = await seedLaneStudent(tx, HeldBalanceLane.Hifz, 2);

      const settled = await Promise.allSettled([
        StudentRepository.decrementLaneIfAvailable(user.id, HeldBalanceLane.Hifz, tx),
        StudentRepository.decrementLaneIfAvailable(user.id, HeldBalanceLane.Hifz, tx),
        StudentRepository.decrementLaneIfAvailable(user.id, HeldBalanceLane.Hifz, tx),
        StudentRepository.decrementLaneIfAvailable(user.id, HeldBalanceLane.Hifz, tx),
        StudentRepository.decrementLaneIfAvailable(user.id, HeldBalanceLane.Hifz, tx),
      ]);

      expect(settled).toHaveLength(5);
      for (const outcome of settled) {
        expect(outcome.status).toBe("fulfilled");
      }
      const booleans = settled.map(outcome => (outcome.status === "fulfilled" ? outcome.value : null));
      expect(booleans.filter(Boolean)).toHaveLength(2);

      // The multi-unit lane drained to exactly zero under contention — the
      // guard re-evaluated `balance > 0` after every predecessor's effect.
      const after = await readLaneSnapshot(tx, user.id);
      expect(after.balanceHifz).toBe(0);
    });
  });

  // ─── Tier 4: security/tenancy/static ────────────────────────────────

  test("debiting student A leaves student B's row byte-identical", async () => {
    await runInRollback(async tx => {
      const userA = await createTestUser(tx);
      await createTestStudent(tx, userA.id, { balanceTrial: 1, balanceHifz: 2 });
      const userB = await createTestUser(tx);
      await createTestStudent(tx, userB.id, { balanceTrial: 5, balanceHifz: 6 });
      const bBefore = await readStudentRow(tx, userB.id);

      const debited = await StudentRepository.decrementLaneIfAvailable(userA.id, HeldBalanceLane.Trial, tx);
      expect(debited).toBe(true);

      const bAfter = await readStudentRow(tx, userB.id);
      expect(bAfter).toEqual(bBefore);
    });
  });

  test("lane → column resolution is pinned to enum-member map keys (no caller strings)", async () => {
    const source = await readFile(join(__dirname, "..", "student.repository.ts"), "utf-8");

    // The frozen resolution map exists and is Object.freeze'd.
    expect(source).toContain("LANE_BALANCE_COLUMNS");
    expect(source).toContain("Object.freeze(");

    // Isolate the map literal and assert its keys: every key is a computed
    // `HeldBalanceLane` member; no quoted string key can select a column.
    const mapStart = source.indexOf("LANE_BALANCE_COLUMNS");
    const mapBody = source.slice(mapStart, source.indexOf("});", mapStart));
    expect(mapBody).toContain("[HeldBalanceLane.Trial]:");
    expect(mapBody).toContain("[HeldBalanceLane.Hifz]:");
    expect(mapBody).toContain("[HeldBalanceLane.Tajweed]:");
    expect(mapBody).not.toMatch(/["'][A-Za-z_]+["']\s*:/);

    // Both method signatures type `lane` as the enum — never a string.
    const laneParamHits = source.match(/lane: HeldBalanceLane/g) ?? [];
    expect(laneParamHits.length).toBeGreaterThanOrEqual(2);
  });

  test("statement hygiene pins: no sql.raw, no inArray, no `--` sequences", async () => {
    const source = await readFile(join(__dirname, "..", "student.repository.ts"), "utf-8");

    // A lane value could only become a column name through string building —
    // none exists: identifiers come from `sql.identifier(<schema column>.name)`.
    expect(source).not.toContain("sql.raw(");
    expect(source).not.toContain("inArray");
    // Inline SQL comments are forbidden anywhere in the module.
    expect(source).not.toContain("--");
  });

  test("direct negative paid-lane balances are rejected by the DB CHECK constraints (backstop)", async () => {
    await runInRollback(async tx => {
      const user = await seedLaneStudent(tx, HeldBalanceLane.Hifz, 1);

      // Bracket each adversarial UPDATE in an explicit SAVEPOINT so the
      // CHECK-constraint rejection rolls back ONLY the savepoint, leaving the
      // outer transaction usable for the next probe and the read-back.
      await tx.execute(sql`savepoint lane_check_probe`);
      const hifzError = await expectRepoError(() =>
        tx.update(students).set({ balanceHifz: -1 }).where(eq(students.id, user.id)).returning({ id: students.id })
      );
      await tx.execute(sql`rollback to savepoint lane_check_probe`);
      expect(hasPostgresErrorCode(hifzError, PG_CHECK_VIOLATION)).toBe(true);
      expect(causeChainContainsMessage(hifzError, "students_balance_hifz_check")).toBe(true);

      const tajweedError = await expectRepoError(() =>
        tx.update(students).set({ balanceTajweed: -1 }).where(eq(students.id, user.id)).returning({ id: students.id })
      );
      await tx.execute(sql`rollback to savepoint lane_check_probe`);
      expect(hasPostgresErrorCode(tajweedError, PG_CHECK_VIOLATION)).toBe(true);
      expect(causeChainContainsMessage(tajweedError, "students_balance_tajweed_check")).toBe(true);

      // The rejected adversarial writes mutated nothing — the seeded state
      // is intact now that the savepoints restored a queryable transaction.
      const after = await readLaneSnapshot(tx, user.id);
      expect(after.balanceHifz).toBe(1);
      expect(after.balanceTajweed).toBe(0);
    });
  });
});

describe("StudentRepository.incrementLane", () => {
  // ─── Tier 1: branch/statement ───────────────────────────────────────

  test("refunds one unit to every lane (unguarded +1), including from zero", async () => {
    await runInRollback(async tx => {
      // `initial = 0` doubles as the CHECK-floor boundary: +1 on an empty
      // lane can never trip the `balance_* >= 0` constraints.
      await expectRefundRoundTrip(tx, HeldBalanceLane.Trial, 0);
      await expectRefundRoundTrip(tx, HeldBalanceLane.Hifz, 4);
      await expectRefundRoundTrip(tx, HeldBalanceLane.Tajweed, 0);
    });
  });

  test("nonexistent studentId is a silent no-op (UPDATE matches zero rows)", async () => {
    await runInRollback(async tx => {
      const missingId = await absentStudentId(tx);

      // Resolves without error — a refund targets the lane recorded on a
      // held session whose student FK guarantees the row upstream; the
      // repository itself neither throws nor creates anything.
      await StudentRepository.incrementLane(missingId, HeldBalanceLane.Hifz, tx);

      const row = await readStudentRow(tx, missingId);
      expect(row).toBeNull();
    });
  });

  // ─── Tier 2: boundary ───────────────────────────────────────────────

  test("refund then re-debit restores the exact prior balance (same-lane round trip)", async () => {
    await runInRollback(async tx => {
      const user = await seedLaneStudent(tx, HeldBalanceLane.Tajweed, 3);

      const debited = await StudentRepository.decrementLaneIfAvailable(user.id, HeldBalanceLane.Tajweed, tx);
      expect(debited).toBe(true);
      expect((await readLaneSnapshot(tx, user.id)).balanceTajweed).toBe(2);

      await StudentRepository.incrementLane(user.id, HeldBalanceLane.Tajweed, tx);
      expect((await readLaneSnapshot(tx, user.id)).balanceTajweed).toBe(3);
    });
  });

  // ─── Tier 4: security/tenancy ───────────────────────────────────────

  test("refunding student A never touches student B's lanes", async () => {
    await runInRollback(async tx => {
      const userA = await createTestUser(tx);
      await createTestStudent(tx, userA.id, { balanceTrial: 1 });
      const userB = await createTestUser(tx);
      await createTestStudent(tx, userB.id, { balanceTrial: 9, balanceTajweed: 8 });
      const bBefore = await readStudentRow(tx, userB.id);

      await StudentRepository.incrementLane(userA.id, HeldBalanceLane.Trial, tx);

      const aAfter = await readLaneSnapshot(tx, userA.id);
      expect(aAfter.balanceTrial).toBe(2);
      const bAfter = await readStudentRow(tx, userB.id);
      expect(bAfter).toEqual(bBefore);
    });
  });
});
