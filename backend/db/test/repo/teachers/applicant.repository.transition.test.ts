/**
 * ApplicantRepository tests — the guarded `pending|failed → in_evaluation`
 * lifecycle write, the guarded `in_evaluation → failed` verdict write, and
 * the `findForBookingGate` lock read against the live PostgreSQL test
 * instance.
 *
 * Per `backend/db/test/AGENTS.md`:
 *  - Rollback-isolated tests run inside `runInRollback`; `tx` is passed to
 *    EVERY repo call, entity-setup helper, and direct Drizzle query.
 *  - Entities are created ONLY via `entity-setup.ts` helpers — never seed
 *    data. The repo signals a miss by returning `null`, so this suite has
 *    no throwing paths to probe (no `expect(...).rejects.toThrow()`).
 *  - The concurrency tier must commit its fixtures (a row lock held across
 *    two independent transactions cannot live inside one rolled-back tx);
 *    those fixtures are registered and hard-deleted in `afterAll`.
 *
 * Coverage map:
 *  - Tier 1 (branch/stmt): pending flips to in_evaluation and returns the
 *    FULL updated row; failed flips too; in_evaluation / passed match zero
 *    rows (null, status unchanged); a nonexistent id returns null.
 *  - Tier 2 (boundary): the flip stamps `updated_at` forward; unicode-name
 *    applicants (RTL + CJK + emoji) transition cleanly and their users-side
 *    identity is untouched; the attempt audit trail (`verification_attempts`,
 *    `last_attempt_at`) survives the flip unclobbered.
 *  - Tier 3 (concurrency/transaction): a repeat call inside ONE tx is a
 *    zero-row no-op (row already flipped); two concurrent transitions from
 *    pending on INDEPENDENT transactions race on the guarded UPDATE's row
 *    lock — exactly one writer flips the row, the loser matches zero rows,
 *    and the final committed state is consistent (real-Postgres gated).
 *  - Tier 4 (static): the transition is a single guarded UPDATE (state
 *    folded into WHERE, no SELECT-then-UPDATE), enum members only (no
 *    hardcoded status literals), no prepared statements, no i18n/logger
 *    surface, and no plan-artifact references in comments.
 *  - transitionToFailed tier (runInRollback): an `in_evaluation` applicant
 *    flips to `failed` with the caller's cooldown instant stored VERBATIM
 *    (no duration arithmetic in the repo) and the full row returned; a
 *    pre-existing cooldown value is overwritten; the guarded pre-state
 *    rejects `passed` / `failed` / `pending` rows and absent ids with a
 *    zero-row null (non-positive ids included); the write is tx-REQUIRED
 *    (no global-handle branch) and a repeat call inside ONE tx is a
 *    zero-row no-op.
 *  - findForBookingGate: the lock-acquiring read returns the FULL row inside
 *    the same statement and a missing id resolves null; the read observes
 *    the caller transaction's own uncommitted writes; re-locking inside one
 *    transaction is idempotent. The cross-transaction lock serialization is
 *    the identical `.for("update")` primitive proven by the teacher suites'
 *    lock tests, and the booking-level race matrix belongs to the service
 *    suite.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { db } from "@/backend/db";
import { ApplicantRepository } from "@/backend/db/repo";
import { applicants } from "@/backend/db/schema/teachers/applicants";
import { users } from "@/backend/db/schema/users/users";
import { createTestApplicant, createTestUser } from "@/backend/db/test/entity-setup";
import { runInRollback } from "@/backend/db/test/test-utils";
import { ApplicantStatus } from "@/backend/enum/teachers/applicant-status.enum";
import type { DBTransaction } from "@/backend/types";
import { isPgliteProvider } from "@/test/helpers/skip-when-pglite";

/** Returns an integer id that cannot exist as an applicants row this tx. */
async function absentApplicantId(tx: DBTransaction): Promise<number> {
  const [row] = await tx.select({ maxId: sql<number>`coalesce(max(${applicants.id}), 0)::int` }).from(applicants);
  return (row?.maxId ?? 0) + 1_000_000;
}

/** Independent read-back oracle — direct Drizzle select, not via the repo. */
async function readApplicantRow(tx: DBTransaction, userId: number) {
  const rows = await tx.select().from(applicants).where(eq(applicants.id, userId));
  return rows[0] ?? null;
}

/** Applicant rows committed OUTSIDE `runInRollback` (concurrency tier) — hard-deleted in `afterAll`. */
const committedApplicantUserIds: number[] = [];

/** Commits an applicant fixture outside the rollback tx and registers it for cleanup. */
async function createCommittedApplicant(status: ApplicantStatus): Promise<number> {
  const applicantUserId = await db.transaction(async tx => {
    const user = await createTestUser(tx, { role: "teacher" });
    await createTestApplicant(tx, user.id, { status });
    return user.id;
  });
  committedApplicantUserIds.push(applicantUserId);
  return applicantUserId;
}

afterAll(async () => {
  // Hard-delete every committed fixture (applicant row first, then its
  // owning user — same direction as the cascade) so nothing leaks.
  await Promise.all(
    committedApplicantUserIds.map(async applicantUserId => {
      await db.delete(applicants).where(eq(applicants.id, applicantUserId));
      await db.delete(users).where(eq(users.id, applicantUserId));
    })
  );
  committedApplicantUserIds.length = 0;
});

describe("ApplicantRepository.transitionToInEvaluation", () => {
  // ─── Tier 1: branch/statement ───────────────────────────────────────

  test("flips a pending applicant to in_evaluation and returns the FULL updated row", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      const seeded = await createTestApplicant(tx, user.id, { status: ApplicantStatus.Pending });

      const row = await ApplicantRepository.transitionToInEvaluation(user.id, tx);

      expect(row).not.toBeNull();
      if (!row) throw new Error("expected the updated applicant row");
      // RETURNING * — exactly the canonical eight select columns.
      expect(Object.keys(row).toSorted((a, b) => a.localeCompare(b))).toEqual([
        "cooldownUntil",
        "createdAt",
        "id",
        "lastAttemptAt",
        "reEvaluationStartedAt",
        "status",
        "updatedAt",
        "verificationAttempts",
      ]);
      expect(row.id).toBe(user.id);
      expect(seeded.status).toBe(ApplicantStatus.Pending);
      expect(row.status).toBe(ApplicantStatus.InEvaluation);
      // Independent persisted-state oracle (same tx — read-your-writes).
      const persisted = await readApplicantRow(tx, user.id);
      expect(persisted?.status).toBe(ApplicantStatus.InEvaluation);
    });
  });

  test("flips a failed applicant (re-application) to in_evaluation", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      await createTestApplicant(tx, user.id, { status: ApplicantStatus.Failed });

      const row = await ApplicantRepository.transitionToInEvaluation(user.id, tx);

      expect(row?.id).toBe(user.id);
      expect(row?.status).toBe(ApplicantStatus.InEvaluation);
      expect((await readApplicantRow(tx, user.id))?.status).toBe(ApplicantStatus.InEvaluation);
    });
  });

  test("matches ZERO rows for an in_evaluation applicant (no-op, status unchanged)", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      await createTestApplicant(tx, user.id, { status: ApplicantStatus.InEvaluation });

      const row = await ApplicantRepository.transitionToInEvaluation(user.id, tx);

      expect(row).toBeNull();
      expect((await readApplicantRow(tx, user.id))?.status).toBe(ApplicantStatus.InEvaluation);
    });
  });

  test("matches ZERO rows for a passed applicant (status unchanged)", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      await createTestApplicant(tx, user.id, { status: ApplicantStatus.Passed });

      const row = await ApplicantRepository.transitionToInEvaluation(user.id, tx);

      expect(row).toBeNull();
      expect((await readApplicantRow(tx, user.id))?.status).toBe(ApplicantStatus.Passed);
    });
  });

  test("returns null for a nonexistent applicant id", async () => {
    await runInRollback(async tx => {
      const missingId = await absentApplicantId(tx);

      const row = await ApplicantRepository.transitionToInEvaluation(missingId, tx);

      expect(row).toBeNull();
    });
  });

  // ─── Tier 2: boundary / data-shape edges ────────────────────────────

  test("stamps updated_at forward (strictly later than the seeded instant)", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      const seededUpdatedAt = new Date(Date.now() - 60_000);
      await createTestApplicant(tx, user.id, {
        status: ApplicantStatus.Pending,
        updatedAt: seededUpdatedAt,
      });

      const row = await ApplicantRepository.transitionToInEvaluation(user.id, tx);

      expect(row).not.toBeNull();
      expect(row?.updatedAt?.getTime()).toBeGreaterThan(seededUpdatedAt.getTime());
    });
  });

  test("unicode-name applicants transition cleanly and keep their users-side identity (RTL + CJK + emoji)", async () => {
    await runInRollback(async tx => {
      const arabicName = "أحمد بن عبد الله العالمي";
      const cjkName = "世界 🌙 Teachers";
      const arabicUser = await createTestUser(tx, { role: "teacher", fullName: arabicName });
      const cjkUser = await createTestUser(tx, { role: "teacher", fullName: cjkName });
      await createTestApplicant(tx, arabicUser.id, { status: ApplicantStatus.Failed });
      await createTestApplicant(tx, cjkUser.id, { status: ApplicantStatus.Pending });

      const arabicRow = await ApplicantRepository.transitionToInEvaluation(arabicUser.id, tx);
      const cjkRow = await ApplicantRepository.transitionToInEvaluation(cjkUser.id, tx);

      expect(arabicRow?.status).toBe(ApplicantStatus.InEvaluation);
      expect(cjkRow?.status).toBe(ApplicantStatus.InEvaluation);
      // The guarded UPDATE never rewrites the users-side identity columns.
      const [arabicPersisted] = await tx
        .select({ fullName: users.fullName })
        .from(users)
        .where(eq(users.id, arabicUser.id));
      const [cjkPersisted] = await tx.select({ fullName: users.fullName }).from(users).where(eq(users.id, cjkUser.id));
      expect(arabicPersisted?.fullName).toBe(arabicName);
      expect(cjkPersisted?.fullName).toBe(cjkName);
    });
  });

  test("the flip preserves the attempt audit trail (verification_attempts + last_attempt_at untouched)", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      const lastAttemptAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      await createTestApplicant(tx, user.id, {
        status: ApplicantStatus.Failed,
        verificationAttempts: 2,
        lastAttemptAt,
      });

      const row = await ApplicantRepository.transitionToInEvaluation(user.id, tx);

      expect(row?.status).toBe(ApplicantStatus.InEvaluation);
      expect(row?.verificationAttempts).toBe(2);
      expect(row?.lastAttemptAt?.getTime()).toBe(lastAttemptAt.getTime());
    });
  });

  test("clears a stale re-evaluation anchor left by an earlier paid re-evaluation (a normal re-entry never inherits the paid cycle)", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      const staleAnchor = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);
      await createTestApplicant(tx, user.id, { status: ApplicantStatus.Failed, reEvaluationStartedAt: staleAnchor });

      const row = await ApplicantRepository.transitionToInEvaluation(user.id, tx);

      // The normal (non-paid) loop entry resets the anchor to NULL so the
      // cycle resolver opens the FRESH purchased-verification cycle, never
      // the stale paid one. The paid re-entry (reopenForReEvaluation) is the
      // only writer that sets the anchor.
      expect(row?.status).toBe(ApplicantStatus.InEvaluation);
      expect(row?.reEvaluationStartedAt).toBeNull();
      expect((await readApplicantRow(tx, user.id))?.reEvaluationStartedAt).toBeNull();
    });
  });

  // ─── Tier 3: repeat + concurrent transitions ────────────────────────

  test("a repeat transition inside ONE transaction is a zero-row no-op (row already flipped)", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      await createTestApplicant(tx, user.id, { status: ApplicantStatus.Pending });

      const first = await ApplicantRepository.transitionToInEvaluation(user.id, tx);
      const second = await ApplicantRepository.transitionToInEvaluation(user.id, tx);

      expect(first?.status).toBe(ApplicantStatus.InEvaluation);
      expect(second).toBeNull();
      expect((await readApplicantRow(tx, user.id))?.status).toBe(ApplicantStatus.InEvaluation);
    });
  });

  // Real-Postgres gated: the guarded UPDATE's row lock is only observable
  // across independent connections (PGlite is single-connection WASM).
  const testOnRealPostgres = isPgliteProvider() ? test.skip : test;

  testOnRealPostgres(
    "two concurrent transitions from pending: exactly one writer flips the row, the loser matches zero rows",
    async () => {
      const applicantUserId = await createCommittedApplicant(ApplicantStatus.Pending);

      // Two INDEPENDENT transactions race the same guarded UPDATE. The row
      // lock serializes them: the loser re-evaluates the WHERE predicate on
      // the committed post-flip row, matches zero rows, and resolves null.
      const settled = await Promise.allSettled([
        db.transaction(tx => ApplicantRepository.transitionToInEvaluation(applicantUserId, tx)),
        db.transaction(tx => ApplicantRepository.transitionToInEvaluation(applicantUserId, tx)),
      ]);

      expect(settled).toHaveLength(2);
      const rows = settled.map(outcome => {
        if (outcome.status !== "fulfilled") {
          throw new Error("expected both racing transactions to resolve without error");
        }
        return outcome.value;
      });
      // Order-independent: exactly one winner, exactly one zero-row loser.
      expect(rows.filter(row => row !== null)).toHaveLength(1);
      expect(rows.filter(row => row === null)).toHaveLength(1);
      const winner = rows.find(row => row !== null);
      expect(winner?.id).toBe(applicantUserId);
      expect(winner?.status).toBe(ApplicantStatus.InEvaluation);

      // Final committed state is consistent — flipped exactly once.
      const [final] = await db.select().from(applicants).where(eq(applicants.id, applicantUserId));
      expect(final?.status).toBe(ApplicantStatus.InEvaluation);
    }
  );

  // ─── Tier 4: static surface pins ────────────────────────────────────

  const REPO_FILE = join(import.meta.dir, "../../../repo/teachers/applicant.repository.ts");
  const repoSource = readFileSync(REPO_FILE, "utf8");

  /** The transitionToInEvaluation slice of the repository source (the static pin target). */
  function transitionSource(): string {
    const start = repoSource.indexOf("export async function transitionToInEvaluation(");
    return repoSource.slice(start, repoSource.indexOf("\n  }\n", start));
  }

  test("source: a single guarded UPDATE with the prior state folded into WHERE (no SELECT-then-UPDATE)", () => {
    expect(transitionSource()).toContain(".update(applicants)");
    expect(transitionSource()).toContain(
      "inArray(applicants.status, [ApplicantStatus.Pending, ApplicantStatus.Failed])"
    );
    expect(transitionSource().includes(".select(")).toBe(false);
    expect(transitionSource()).toContain(".returning()");
  });

  test("source: enum members only — no hardcoded status string literals, no prepared statements", () => {
    expect(transitionSource()).toContain("ApplicantStatus.InEvaluation");
    expect(/'(pending|failed|in_evaluation|passed)'/.test(transitionSource())).toBe(false);
    expect(repoSource.includes(".prepare(")).toBe(false);
  });

  test("source: no i18n, no logger, no console (repo stays data-access only)", () => {
    expect(transitionSource().includes("getServerTranslations")).toBe(false);
    expect(transitionSource().includes("logger")).toBe(false);
    expect(transitionSource().includes("console.")).toBe(false);
  });

  test("source: comments describe domain behavior only (no plan-artifact references)", () => {
    expect(/REQ-\d|DEV3|Phase \d|Task \d|plan\.md|tasks\.md|specs\.md/.test(repoSource)).toBe(false);
  });
});

describe("ApplicantRepository.transitionToFailed", () => {
  // ─── Tier 1: branch/statement ───────────────────────────────────────

  test("flips an in_evaluation applicant to failed with the cooldown instant stored VERBATIM", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      await createTestApplicant(tx, user.id, { status: ApplicantStatus.InEvaluation });
      const cooldownUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      const row = await ApplicantRepository.transitionToFailed(user.id, cooldownUntil, tx);

      expect(row).not.toBeNull();
      if (!row) throw new Error("expected the updated applicant row");
      // RETURNING * — exactly the canonical eight select columns.
      expect(Object.keys(row).toSorted((a, b) => a.localeCompare(b))).toEqual([
        "cooldownUntil",
        "createdAt",
        "id",
        "lastAttemptAt",
        "reEvaluationStartedAt",
        "status",
        "updatedAt",
        "verificationAttempts",
      ]);
      expect(row.id).toBe(user.id);
      expect(row.status).toBe(ApplicantStatus.Failed);
      // The verdict instant is the caller's value, stored verbatim — the
      // repo performs no duration arithmetic.
      expect(row.cooldownUntil?.getTime()).toBe(cooldownUntil.getTime());
      const persisted = await readApplicantRow(tx, user.id);
      expect(persisted?.status).toBe(ApplicantStatus.Failed);
      expect(persisted?.cooldownUntil?.getTime()).toBe(cooldownUntil.getTime());
    });
  });

  // ─── Tier 2: boundary / data-shape edges ────────────────────────────

  test("overwrites a pre-existing cooldown value and stamps updated_at forward", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      const staleCooldown = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const seededUpdatedAt = new Date(Date.now() - 60_000);
      await createTestApplicant(tx, user.id, {
        status: ApplicantStatus.InEvaluation,
        cooldownUntil: staleCooldown,
        updatedAt: seededUpdatedAt,
      });
      const cooldownUntil = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);

      const row = await ApplicantRepository.transitionToFailed(user.id, cooldownUntil, tx);

      expect(row?.status).toBe(ApplicantStatus.Failed);
      expect(row?.cooldownUntil?.getTime()).toBe(cooldownUntil.getTime());
      expect(row?.cooldownUntil?.getTime()).not.toBe(staleCooldown.getTime());
      expect(row?.updatedAt?.getTime()).toBeGreaterThan(seededUpdatedAt.getTime());
    });
  });

  test("preserves the attempt audit trail (verification_attempts + last_attempt_at untouched)", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      const lastAttemptAt = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
      await createTestApplicant(tx, user.id, {
        status: ApplicantStatus.InEvaluation,
        verificationAttempts: 3,
        lastAttemptAt,
      });

      const row = await ApplicantRepository.transitionToFailed(user.id, new Date(), tx);

      expect(row?.status).toBe(ApplicantStatus.Failed);
      expect(row?.verificationAttempts).toBe(3);
      expect(row?.lastAttemptAt?.getTime()).toBe(lastAttemptAt.getTime());
    });
  });

  // ─── Tier 2: the guarded pre-state rejects non-matching rows ────────

  test("matches ZERO rows for a passed applicant (status and cooldown unchanged)", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      await createTestApplicant(tx, user.id, { status: ApplicantStatus.Passed });

      const row = await ApplicantRepository.transitionToFailed(user.id, new Date(), tx);

      expect(row).toBeNull();
      const persisted = await readApplicantRow(tx, user.id);
      expect(persisted?.status).toBe(ApplicantStatus.Passed);
      expect(persisted?.cooldownUntil).toBeNull();
    });
  });

  test("matches ZERO rows for an already-failed applicant (a second finalization never replays)", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      const firstCooldown = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      await createTestApplicant(tx, user.id, { status: ApplicantStatus.Failed, cooldownUntil: firstCooldown });

      const row = await ApplicantRepository.transitionToFailed(user.id, new Date(), tx);

      expect(row).toBeNull();
      const persisted = await readApplicantRow(tx, user.id);
      expect(persisted?.status).toBe(ApplicantStatus.Failed);
      expect(persisted?.cooldownUntil?.getTime()).toBe(firstCooldown.getTime());
    });
  });

  test("matches ZERO rows for a pending applicant (never entered evaluation)", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      await createTestApplicant(tx, user.id, { status: ApplicantStatus.Pending });

      const row = await ApplicantRepository.transitionToFailed(user.id, new Date(), tx);

      expect(row).toBeNull();
      const persisted = await readApplicantRow(tx, user.id);
      expect(persisted?.status).toBe(ApplicantStatus.Pending);
      expect(persisted?.cooldownUntil).toBeNull();
    });
  });

  test("returns null for a nonexistent and for a non-positive applicant id", async () => {
    await runInRollback(async tx => {
      const missingId = await absentApplicantId(tx);
      expect(await ApplicantRepository.transitionToFailed(missingId, new Date(), tx)).toBeNull();
      expect(await ApplicantRepository.transitionToFailed(0, new Date(), tx)).toBeNull();
      expect(await ApplicantRepository.transitionToFailed(-1, new Date(), tx)).toBeNull();
    });
  });

  // ─── Tier 3: repeat call inside ONE transaction ─────────────────────

  test("a repeat call inside ONE transaction is a zero-row no-op (row already flipped)", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      await createTestApplicant(tx, user.id, { status: ApplicantStatus.InEvaluation });
      const cooldownUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      const first = await ApplicantRepository.transitionToFailed(user.id, cooldownUntil, tx);
      const second = await ApplicantRepository.transitionToFailed(user.id, new Date(), tx);

      expect(first?.status).toBe(ApplicantStatus.Failed);
      expect(second).toBeNull();
      expect((await readApplicantRow(tx, user.id))?.cooldownUntil?.getTime()).toBe(cooldownUntil.getTime());
    });
  });

  // ─── Tier 4: static surface pins ────────────────────────────────────

  const FAILED_REPO_FILE = join(import.meta.dir, "../../../repo/teachers/applicant.repository.ts");
  const failedRepoSource = readFileSync(FAILED_REPO_FILE, "utf8");

  /** The transitionToFailed slice of the repository source (the static pin target). */
  function failedTransitionSource(): string {
    const start = failedRepoSource.indexOf("export async function transitionToFailed(");
    return failedRepoSource.slice(start, failedRepoSource.indexOf("\n  }\n", start));
  }

  test("source: a single guarded UPDATE with the in_evaluation pre-state folded into WHERE", () => {
    expect(failedTransitionSource()).toContain(".update(applicants)");
    expect(failedTransitionSource()).toContain("eq(applicants.status, ApplicantStatus.InEvaluation)");
    expect(failedTransitionSource().includes(".select(")).toBe(false);
    expect(failedTransitionSource()).toContain(".returning()");
  });

  test("source: REQUIRED tx — no standalone global-handle branch, no prepared statements", () => {
    expect(failedTransitionSource()).toContain("tx: DBTransaction");
    expect(failedTransitionSource().includes("tx?")).toBe(false);
    expect(failedTransitionSource().includes("tx ?? db")).toBe(false);
    expect(failedTransitionSource().includes("db.update")).toBe(false);
    expect(failedRepoSource.includes(".prepare(")).toBe(false);
  });

  test("source: the cooldown instant is the caller's verbatim value (no duration arithmetic)", () => {
    expect(failedTransitionSource()).toContain("cooldownUntil,");
    expect(failedTransitionSource().includes("getDate(")).toBe(false);
    expect(failedTransitionSource().includes("COOLDOWN_DAYS")).toBe(false);
    expect(/'(pending|failed|in_evaluation|passed)'/.test(failedTransitionSource())).toBe(false);
    expect(failedTransitionSource().includes("getServerTranslations")).toBe(false);
    expect(failedTransitionSource().includes("logger")).toBe(false);
    expect(failedTransitionSource().includes("console.")).toBe(false);
  });

  test("source: comments describe domain behavior only (no plan-artifact references)", () => {
    expect(/REQ-\d|DEV2|DEV3|Phase \d|Task \d|plan\.md|tasks\.md|specs\.md/.test(failedRepoSource)).toBe(false);
  });
});

describe("ApplicantRepository.findForBookingGate", () => {
  // ─── Tier 1: branch/statement ───────────────────────────────────────

  test("returns the FULL locked applicant row for an existing applicant", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      const seeded = await createTestApplicant(tx, user.id, { status: ApplicantStatus.InEvaluation });

      const locked = await ApplicantRepository.findForBookingGate(user.id, tx);

      expect(locked).not.toBeNull();
      if (!locked) throw new Error("expected the locked applicant row");
      // Full-row read — exactly the canonical eight select columns.
      expect(Object.keys(locked).toSorted((a, b) => a.localeCompare(b))).toEqual([
        "cooldownUntil",
        "createdAt",
        "id",
        "lastAttemptAt",
        "reEvaluationStartedAt",
        "status",
        "updatedAt",
        "verificationAttempts",
      ]);
      expect(locked.id).toBe(user.id);
      expect(locked.status).toBe(ApplicantStatus.InEvaluation);
      expect(seeded.status).toBe(ApplicantStatus.InEvaluation);
    });
  });

  test("returns null for a nonexistent applicant id", async () => {
    await runInRollback(async tx => {
      const missingId = await absentApplicantId(tx);

      const locked = await ApplicantRepository.findForBookingGate(missingId, tx);

      expect(locked).toBeNull();
    });
  });

  // ─── Tier 2: read-your-writes under the caller transaction ──────────

  test("observes the caller transaction's own uncommitted writes (the gate decides on locked values)", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      await createTestApplicant(tx, user.id, { status: ApplicantStatus.Pending });

      // The gate-locked read must see same-tx writes: flip the lifecycle
      // status first, then take the lock — the locked row carries the flipped
      // status, which is what the caller's subsequent booking writes commit
      // their gates against.
      await ApplicantRepository.transitionToInEvaluation(user.id, tx);
      const locked = await ApplicantRepository.findForBookingGate(user.id, tx);

      expect(locked?.status).toBe(ApplicantStatus.InEvaluation);
    });
  });

  test("re-taking the lock inside ONE transaction is idempotent (tx-scoped lock)", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      await createTestApplicant(tx, user.id, { status: ApplicantStatus.InEvaluation });

      const first = await ApplicantRepository.findForBookingGate(user.id, tx);
      const second = await ApplicantRepository.findForBookingGate(user.id, tx);

      expect(first).toEqual(second);
    });
  });

  // ─── Tier 4: static surface pins ────────────────────────────────────

  const BOOKING_GATE_REPO_FILE = join(import.meta.dir, "../../../repo/teachers/applicant.repository.ts");
  const bookingGateRepoSource = readFileSync(BOOKING_GATE_REPO_FILE, "utf8");

  /** The findForBookingGate slice of the repository source (the static pin target). */
  function bookingGateSlice(): string {
    const start = bookingGateRepoSource.indexOf("export async function findForBookingGate(");
    return bookingGateRepoSource.slice(start, bookingGateRepoSource.indexOf("\n  }\n", start));
  }

  test("source: REQUIRED-tx lock read with a full-row select under .for('update')", () => {
    expect(bookingGateSlice()).toContain("userId: number");
    expect(bookingGateSlice()).toContain("tx: DBTransaction");
    expect(bookingGateSlice()).toContain(".select()");
    expect(bookingGateSlice()).toContain('.for("update")');
  });

  test("source: no template interpolation, no prepared statements in the lock read", () => {
    expect(bookingGateSlice().includes("${")).toBe(false);
    expect(bookingGateSlice().includes(".prepare(")).toBe(false);
  });
});
