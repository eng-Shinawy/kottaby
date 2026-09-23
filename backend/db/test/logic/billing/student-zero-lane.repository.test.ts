/**
 * StudentRepository.zeroLaneIfNoCoveringSubscription tests — the
 * expiry-sweep conditional lane zeroing (4-Tier verification suite).
 *
 * Tier 1: honest zeroing — an uncovered lane zeroes (`true`, column 0)
 *         through any of the three frozen-map members, leaving sibling
 *         lanes untouched.
 * Tier 2: boundary no-ops — already-zero lane, replay after a successful
 *         zeroing, unknown student id; plus the explicit `updated_at`
 *         raw-set stamp.
 * Tier 3: coverage-guard truth table — a second ACTIVE subscription on the
 *         SAME lane and a PENDING subscription on the lane both protect the
 *         balance; coverage is lane-scoped and owner-scoped (another
 *         student's subscription neither protects nor zeroes this
 *         student's lane).
 * Tier 4: security/structural — the trial lane is not subscription-bound
 *         and survives full subscription-lane zeroing; the frozen map has
 *         no trial key (source pin) and an out-of-vocabulary lane resolves
 *         no column and never issues an UPDATE.
 *
 * Per `backend/db/test/AGENTS.md`: every case runs inside `runInRollback`
 * with `tx` passed to EVERY repository call and direct Drizzle query; the
 * `expectRepoError` try/catch helper probes rejections (never
 * `expect(...).rejects` inside a rollback transaction).
 */

import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { StudentRepository } from "@/backend/db/repo";
import { students } from "@/backend/db/schema/students/students";
import {
  createTestPlan,
  createTestStudent,
  createTestSubscription,
  createTestUser,
} from "@/backend/db/test/entity-setup";
import { expectRepoError, runInRollback } from "@/backend/db/test/test-utils";
import { SubscriptionCreditLane } from "@/backend/enum/billing/subscription-credit-lane.enum";
import { SubscriptionStatus } from "@/backend/enum/billing/subscription-status.enum";
import type { DBTransaction, StudentSelectType, SubscriptionSelectType } from "@/backend/types";

/** Milliseconds per day — window math for the expired-subscription fixtures. */
const MS_PER_DAY = 86_400_000;

/** Physical location of the frozen lane-resolution map the zeroing targets. */
const ZERO_LANE_HELPERS_PATH = join(
  __dirname,
  "..",
  "..",
  "..",
  "repo",
  "students",
  "student.repository.zero-lane.helpers.ts"
);

/** Per-lane seeded balances for one test student (unset lanes default to 0). */
interface SeedBalances {
  readonly hifz?: number;
  readonly tajweed?: number;
  readonly reviews?: number;
  readonly trial?: number;
}

/** Creates the student party (user + students row) with explicit lane balances. */
async function createStudentWithBalances(tx: DBTransaction, balances: SeedBalances = {}): Promise<StudentSelectType> {
  const user = await createTestUser(tx, { role: "student" });
  return createTestStudent(tx, user.id, {
    balanceHifz: balances.hifz ?? 0,
    balanceTajweed: balances.tajweed ?? 0,
    balanceReviews: balances.reviews ?? 0,
    balanceTrial: balances.trial ?? 0,
  });
}

/**
 * Creates one plan crediting `lane` and an EXPIRED subscription on it for
 * `userId` — the past-window row shape whose credited lane a sweep retires.
 */
async function createExpiredLaneSubscription(
  tx: DBTransaction,
  userId: number,
  lane: SubscriptionCreditLane
): Promise<SubscriptionSelectType> {
  const plan = await createTestPlan(tx, { balanceLane: lane });
  return createTestSubscription(tx, userId, plan.id, {
    status: SubscriptionStatus.Expired,
    startDate: new Date(Date.now() - 60 * MS_PER_DAY),
    endDate: new Date(Date.now() - 30 * MS_PER_DAY),
  });
}

/** Creates one plan crediting `lane` and a LIVE (active or pending) subscription on it for `userId`. */
async function createLiveLaneSubscription(
  tx: DBTransaction,
  userId: number,
  lane: SubscriptionCreditLane,
  status: SubscriptionStatus.Active | SubscriptionStatus.Pending
): Promise<SubscriptionSelectType> {
  const plan = await createTestPlan(tx, { balanceLane: lane });
  return createTestSubscription(tx, userId, plan.id, { status });
}

/** Re-reads one student row — the in-transaction read-back oracle. */
async function readStudent(tx: DBTransaction, studentId: number): Promise<StudentSelectType> {
  const [row] = await tx.select().from(students).where(eq(students.id, studentId)).limit(1);
  if (!row) {
    throw new Error(`readStudent: student ${studentId} missing`);
  }
  return row;
}

describe("StudentRepository.zeroLaneIfNoCoveringSubscription", () => {
  // ─── Tier 1: honest zeroing of uncovered lanes ──────────────────────────

  test("zeroes an uncovered lane (true, column 0) and leaves sibling lanes untouched", async () => {
    await runInRollback(async tx => {
      const student = await createStudentWithBalances(tx, { hifz: 3, tajweed: 2, reviews: 1 });
      await createExpiredLaneSubscription(tx, student.id, SubscriptionCreditLane.Hifz);

      const zeroed = await StudentRepository.zeroLaneIfNoCoveringSubscription(
        student.id,
        SubscriptionCreditLane.Hifz,
        tx
      );

      expect(zeroed).toBe(true);
      const after = await readStudent(tx, student.id);
      expect(after.balanceHifz).toBe(0);
      expect(after.balanceTajweed).toBe(2);
      expect(after.balanceReviews).toBe(1);
    });
  });

  test("zeroes the reviews lane through the third frozen-map member", async () => {
    await runInRollback(async tx => {
      const student = await createStudentWithBalances(tx, { reviews: 2 });
      await createExpiredLaneSubscription(tx, student.id, SubscriptionCreditLane.Reviews);

      const zeroed = await StudentRepository.zeroLaneIfNoCoveringSubscription(
        student.id,
        SubscriptionCreditLane.Reviews,
        tx
      );

      expect(zeroed).toBe(true);
      expect((await readStudent(tx, student.id)).balanceReviews).toBe(0);
    });
  });

  // ─── Tier 2: boundary no-ops + audit stamp ──────────────────────────────

  test("already-zero lane is a zero-row no-op (false) even with an expired subscription", async () => {
    await runInRollback(async tx => {
      const student = await createStudentWithBalances(tx, {});
      await createExpiredLaneSubscription(tx, student.id, SubscriptionCreditLane.Hifz);

      const zeroed = await StudentRepository.zeroLaneIfNoCoveringSubscription(
        student.id,
        SubscriptionCreditLane.Hifz,
        tx
      );

      expect(zeroed).toBe(false);
      expect((await readStudent(tx, student.id)).balanceHifz).toBe(0);
    });
  });

  test("re-running a successful zeroing is a zero-row replay (false); balance stays zeroed", async () => {
    await runInRollback(async tx => {
      const student = await createStudentWithBalances(tx, { hifz: 3 });
      await createExpiredLaneSubscription(tx, student.id, SubscriptionCreditLane.Hifz);

      expect(
        await StudentRepository.zeroLaneIfNoCoveringSubscription(student.id, SubscriptionCreditLane.Hifz, tx)
      ).toBe(true);

      const replay = await StudentRepository.zeroLaneIfNoCoveringSubscription(
        student.id,
        SubscriptionCreditLane.Hifz,
        tx
      );

      expect(replay).toBe(false);
      expect((await readStudent(tx, student.id)).balanceHifz).toBe(0);
    });
  });

  test("unknown student id matches zero rows (false)", async () => {
    await runInRollback(async tx => {
      const zeroed = await StudentRepository.zeroLaneIfNoCoveringSubscription(
        999_999_999,
        SubscriptionCreditLane.Hifz,
        tx
      );

      expect(zeroed).toBe(false);
    });
  });

  test("zeroing stamps updated_at explicitly (raw set bypasses the query-builder update hook)", async () => {
    await runInRollback(async tx => {
      const student = await createStudentWithBalances(tx, { hifz: 3 });
      await createExpiredLaneSubscription(tx, student.id, SubscriptionCreditLane.Hifz);
      // Freeze the audit stamp 60s in the past — a raw UPDATE without its
      // own stamp would leave this value untouched.
      const staleStamp = new Date(Date.now() - 60_000);
      await tx.update(students).set({ updatedAt: staleStamp }).where(eq(students.id, student.id));

      expect(
        await StudentRepository.zeroLaneIfNoCoveringSubscription(student.id, SubscriptionCreditLane.Hifz, tx)
      ).toBe(true);

      const after = await readStudent(tx, student.id);
      expect(after.balanceHifz).toBe(0);
      expect(after.updatedAt.getTime()).toBeGreaterThan(staleStamp.getTime());
    });
  });

  // ─── Tier 3: coverage-guard truth table (lane-scoped, owner-scoped) ─────

  test("a second ACTIVE subscription on the SAME lane protects the balance (false)", async () => {
    await runInRollback(async tx => {
      const student = await createStudentWithBalances(tx, { hifz: 3 });
      await createExpiredLaneSubscription(tx, student.id, SubscriptionCreditLane.Hifz);
      await createLiveLaneSubscription(tx, student.id, SubscriptionCreditLane.Hifz, SubscriptionStatus.Active);

      const zeroed = await StudentRepository.zeroLaneIfNoCoveringSubscription(
        student.id,
        SubscriptionCreditLane.Hifz,
        tx
      );

      expect(zeroed).toBe(false);
      expect((await readStudent(tx, student.id)).balanceHifz).toBe(3);
    });
  });

  test("a PENDING subscription on the lane protects the balance (false)", async () => {
    await runInRollback(async tx => {
      const student = await createStudentWithBalances(tx, { hifz: 3 });
      await createExpiredLaneSubscription(tx, student.id, SubscriptionCreditLane.Hifz);
      await createLiveLaneSubscription(tx, student.id, SubscriptionCreditLane.Hifz, SubscriptionStatus.Pending);

      const zeroed = await StudentRepository.zeroLaneIfNoCoveringSubscription(
        student.id,
        SubscriptionCreditLane.Hifz,
        tx
      );

      expect(zeroed).toBe(false);
      expect((await readStudent(tx, student.id)).balanceHifz).toBe(3);
    });
  });

  test("coverage is lane-scoped: an active subscription on ANOTHER lane does not protect this lane", async () => {
    await runInRollback(async tx => {
      const student = await createStudentWithBalances(tx, { hifz: 3, tajweed: 4 });
      await createExpiredLaneSubscription(tx, student.id, SubscriptionCreditLane.Hifz);
      await createLiveLaneSubscription(tx, student.id, SubscriptionCreditLane.Tajweed, SubscriptionStatus.Active);

      const zeroed = await StudentRepository.zeroLaneIfNoCoveringSubscription(
        student.id,
        SubscriptionCreditLane.Hifz,
        tx
      );

      expect(zeroed).toBe(true);
      const after = await readStudent(tx, student.id);
      expect(after.balanceHifz).toBe(0);
      expect(after.balanceTajweed).toBe(4);
    });
  });

  test("another student's covering subscription neither protects nor zeroes this student's lane", async () => {
    await runInRollback(async tx => {
      const owner = await createStudentWithBalances(tx, { hifz: 3 });
      const other = await createStudentWithBalances(tx, { hifz: 4 });
      // The OTHER user holds the only live hifz-lane subscription.
      await createLiveLaneSubscription(tx, other.id, SubscriptionCreditLane.Hifz, SubscriptionStatus.Active);

      // The uncovered owner is zeroed — the other user's subscription is not
      // coverage across ownership.
      expect(await StudentRepository.zeroLaneIfNoCoveringSubscription(owner.id, SubscriptionCreditLane.Hifz, tx)).toBe(
        true
      );
      // The covered other is protected — and untouched by the owner's zeroing.
      expect(await StudentRepository.zeroLaneIfNoCoveringSubscription(other.id, SubscriptionCreditLane.Hifz, tx)).toBe(
        false
      );

      const ownerAfter = await readStudent(tx, owner.id);
      const otherAfter = await readStudent(tx, other.id);
      expect(ownerAfter.balanceHifz).toBe(0);
      expect(otherAfter.balanceHifz).toBe(4);
    });
  });

  // ─── Tier 4: trial exemption (structural) + abuse probes ────────────────

  test("zeroing every subscription lane leaves a seeded trial balance byte-identical", async () => {
    await runInRollback(async tx => {
      const student = await createStudentWithBalances(tx, { hifz: 3, tajweed: 2, reviews: 1, trial: 5 });
      await createExpiredLaneSubscription(tx, student.id, SubscriptionCreditLane.Hifz);
      await createExpiredLaneSubscription(tx, student.id, SubscriptionCreditLane.Tajweed);
      await createExpiredLaneSubscription(tx, student.id, SubscriptionCreditLane.Reviews);

      expect(
        await StudentRepository.zeroLaneIfNoCoveringSubscription(student.id, SubscriptionCreditLane.Hifz, tx)
      ).toBe(true);
      expect(
        await StudentRepository.zeroLaneIfNoCoveringSubscription(student.id, SubscriptionCreditLane.Tajweed, tx)
      ).toBe(true);
      expect(
        await StudentRepository.zeroLaneIfNoCoveringSubscription(student.id, SubscriptionCreditLane.Reviews, tx)
      ).toBe(true);

      const after = await readStudent(tx, student.id);
      expect(after.balanceHifz).toBe(0);
      expect(after.balanceTajweed).toBe(0);
      expect(after.balanceReviews).toBe(0);
      // The trial lane is not subscription-bound — untouched by all three
      // zeroing statements.
      expect(after.balanceTrial).toBe(5);
    });
  });

  test("the frozen zeroing map carries exactly the three credit lanes — no trial key", async () => {
    // The map is keyed by `SubscriptionCreditLane`, whose vocabulary has no
    // trial member — a trial key cannot even be authored without a compile
    // error. Pin the vocabulary and the frozen map shape in source.
    const laneVocabulary: string[] = Object.values(SubscriptionCreditLane);
    expect(laneVocabulary).toEqual(["hifz", "tajweed", "reviews"]);

    const source = await readFile(ZERO_LANE_HELPERS_PATH, "utf-8");
    const mapStart = source.indexOf("const ZERO_LANE_BALANCE_COLUMNS");
    const mapBody = source.slice(mapStart, source.indexOf("});", mapStart));
    expect(mapBody).toContain("[SubscriptionCreditLane.Hifz]:");
    expect(mapBody).toContain("[SubscriptionCreditLane.Tajweed]:");
    expect(mapBody).toContain("[SubscriptionCreditLane.Reviews]:");
    // Every key is a computed enum member — no quoted string can select a
    // column, and no trial key exists in the resolution table.
    expect(mapBody).not.toMatch(/["'][A-Za-z_]+["']\s*:/);
    expect(mapBody.toLowerCase()).not.toContain("trial");

    // The lane parameter is typed as the enum (never a caller string) and
    // the statement carries no string-built identifiers or inline comments.
    const laneParamHits = source.match(/lane: SubscriptionCreditLane/g) ?? [];
    expect(laneParamHits.length).toBeGreaterThanOrEqual(1);
    expect(source).not.toContain("sql.raw(");
    expect(source).not.toContain("--");
  });

  test("an out-of-vocabulary lane resolves no column and never issues an UPDATE", async () => {
    await runInRollback(async tx => {
      const student = await createStudentWithBalances(tx, { hifz: 3, trial: 5 });
      // Reach past the compile-time lane type with a forged property (the
      // plan-catalog abuse-probe idiom) to prove the runtime resolution
      // table refuses keys outside the enum vocabulary.
      const forgedArgs: { lane: SubscriptionCreditLane } = { lane: SubscriptionCreditLane.Hifz };
      Object.defineProperty(forgedArgs, "lane", { value: "trial", enumerable: true });

      const error = await expectRepoError(() =>
        StudentRepository.zeroLaneIfNoCoveringSubscription(student.id, forgedArgs.lane, tx)
      );
      expect(error).toBeInstanceOf(TypeError);

      // No statement reached the database — every balance is byte-identical
      // and the transaction is still usable (the miss is abort-free).
      const after = await readStudent(tx, student.id);
      expect(after.balanceHifz).toBe(3);
      expect(after.balanceTrial).toBe(5);
    });
  });
});
