/**
 * ApplicantRepository tests — the guarded `passed → in_evaluation` paid
 * re-evaluation re-open write (`reopenForReEvaluation`) against the live
 * PostgreSQL test instance.
 *
 * Per `backend/db/test/AGENTS.md`:
 *  - Rollback-isolated tests run inside `runInRollback`; `tx` is passed to
 *    EVERY repo call, entity-setup helper, and direct Drizzle query.
 *  - Entities are created ONLY via `entity-setup.ts` helpers — never seed
 *    data. The write signals a miss by returning `null`, so this suite has
 *    no throwing paths to probe (no `expect(...).rejects.toThrow()` and no
 *    `expectRepoError` bracket — the guarded UPDATE is the miss arbiter).
 *  - The concurrency tier must commit its fixtures (a row lock held across
 *    two independent transactions cannot live inside one rolled-back tx);
 *    those fixtures are registered and hard-deleted in `afterAll`.
 *
 * Coverage map:
 *  - Tier 1 (branch/stmt): a passed applicant flips to in_evaluation and
 *    returns the FULL updated row; in_evaluation / failed / pending rows
 *    and absent ids match zero rows (null, nothing changes).
 *  - Tier 2 (boundary): the anchor rides the boundary from its NULL
 *    "never re-evaluated" pre-state to a real instant; a stale anchor from
 *    an earlier re-evaluation is overwritten (each re-open starts a NEW
 *    cycle); `updated_at` stamps forward; the attempt audit trail
 *    (`verification_attempts`, `last_attempt_at`) survives untouched.
 *  - Tier 3 (concurrency/transaction): a repeat call inside ONE tx is a
 *    zero-row no-op (row already flipped); two concurrent re-opens from
 *    passed on INDEPENDENT transactions race the guarded UPDATE's row lock
 *    — exactly one writer flips the row, the loser matches zero rows, and
 *    the final committed state is consistent (real-Postgres gated).
 *  - Tier 4 (static): the re-open is a single guarded UPDATE (the certified
 *    pre-state folded into WHERE, no SELECT-then-UPDATE), enum members only
 *    (no hardcoded status literals), no prepared statements, no i18n/logger
 *    surface, and no plan-artifact references in comments.
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

/** Commits a passed applicant fixture outside the rollback tx and registers it for cleanup. */
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

describe("ApplicantRepository.reopenForReEvaluation", () => {
  // ─── Tier 1: branch/statement ───────────────────────────────────────

  test("flips a passed applicant to in_evaluation, anchors the cycle, and returns the FULL updated row", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      await createTestApplicant(tx, user.id, { status: ApplicantStatus.Passed });

      const row = await ApplicantRepository.reopenForReEvaluation(user.id, tx);

      expect(row).not.toBeNull();
      if (!row) throw new Error("expected the updated applicant row");
      // RETURNING * — exactly the canonical select columns.
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
      expect(row.status).toBe(ApplicantStatus.InEvaluation);
      expect(row.reEvaluationStartedAt).not.toBeNull();
      // Independent persisted-state oracle (same tx — read-your-writes).
      const persisted = await readApplicantRow(tx, user.id);
      expect(persisted?.status).toBe(ApplicantStatus.InEvaluation);
      expect(persisted?.reEvaluationStartedAt).not.toBeNull();
    });
  });

  test("matches ZERO rows for an in_evaluation applicant (a concurrent order already re-opened the loop)", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      await createTestApplicant(tx, user.id, { status: ApplicantStatus.InEvaluation });

      const row = await ApplicantRepository.reopenForReEvaluation(user.id, tx);

      expect(row).toBeNull();
      const persisted = await readApplicantRow(tx, user.id);
      expect(persisted?.status).toBe(ApplicantStatus.InEvaluation);
      expect(persisted?.reEvaluationStartedAt).toBeNull();
    });
  });

  test("matches ZERO rows for a failed applicant (never certified — nothing to re-evaluate)", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      await createTestApplicant(tx, user.id, { status: ApplicantStatus.Failed });

      const row = await ApplicantRepository.reopenForReEvaluation(user.id, tx);

      expect(row).toBeNull();
      const persisted = await readApplicantRow(tx, user.id);
      expect(persisted?.status).toBe(ApplicantStatus.Failed);
      expect(persisted?.reEvaluationStartedAt).toBeNull();
    });
  });

  test("matches ZERO rows for a pending applicant (never entered the pipeline's certified state)", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      await createTestApplicant(tx, user.id, { status: ApplicantStatus.Pending });

      const row = await ApplicantRepository.reopenForReEvaluation(user.id, tx);

      expect(row).toBeNull();
      const persisted = await readApplicantRow(tx, user.id);
      expect(persisted?.status).toBe(ApplicantStatus.Pending);
      expect(persisted?.reEvaluationStartedAt).toBeNull();
    });
  });

  test("returns null for a nonexistent applicant id", async () => {
    await runInRollback(async tx => {
      const missingId = await absentApplicantId(tx);

      const row = await ApplicantRepository.reopenForReEvaluation(missingId, tx);

      expect(row).toBeNull();
    });
  });

  // ─── Tier 2: boundary / data-shape edges ────────────────────────────

  test("the anchor crosses its NULL 'never re-evaluated' pre-state boundary to a real instant", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      await createTestApplicant(tx, user.id, { status: ApplicantStatus.Passed });
      // Boundary pre-state: a certified applicant has never been ordered a
      // paid re-evaluation, so the anchor is NULL before the write.
      expect((await readApplicantRow(tx, user.id))?.reEvaluationStartedAt).toBeNull();

      const row = await ApplicantRepository.reopenForReEvaluation(user.id, tx);

      expect(row?.reEvaluationStartedAt).not.toBeNull();
      expect(row?.reEvaluationStartedAt?.getTime()).toBeGreaterThan(0);
      expect((await readApplicantRow(tx, user.id))?.reEvaluationStartedAt?.getTime()).toBe(
        row?.reEvaluationStartedAt?.getTime()
      );
    });
  });

  test("overwrites a stale anchor from an earlier re-evaluation (each re-open starts a NEW cycle)", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      const staleAnchor = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      await createTestApplicant(tx, user.id, { status: ApplicantStatus.Passed, reEvaluationStartedAt: staleAnchor });

      const row = await ApplicantRepository.reopenForReEvaluation(user.id, tx);

      expect(row?.reEvaluationStartedAt).not.toBeNull();
      expect(row?.reEvaluationStartedAt?.getTime()).toBeGreaterThan(staleAnchor.getTime());
    });
  });

  test("stamps updated_at forward (strictly later than the seeded instant)", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      const seededUpdatedAt = new Date(Date.now() - 60_000);
      await createTestApplicant(tx, user.id, {
        status: ApplicantStatus.Passed,
        updatedAt: seededUpdatedAt,
      });

      const row = await ApplicantRepository.reopenForReEvaluation(user.id, tx);

      expect(row).not.toBeNull();
      expect(row?.updatedAt?.getTime()).toBeGreaterThan(seededUpdatedAt.getTime());
    });
  });

  test("the flip preserves the attempt audit trail (verification_attempts + last_attempt_at untouched)", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      const lastAttemptAt = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000);
      await createTestApplicant(tx, user.id, {
        status: ApplicantStatus.Passed,
        verificationAttempts: 2,
        lastAttemptAt,
      });

      const row = await ApplicantRepository.reopenForReEvaluation(user.id, tx);

      expect(row?.status).toBe(ApplicantStatus.InEvaluation);
      expect(row?.verificationAttempts).toBe(2);
      expect(row?.lastAttemptAt?.getTime()).toBe(lastAttemptAt.getTime());
    });
  });

  // ─── Tier 3: repeat + concurrent re-opens ───────────────────────────

  test("a repeat re-open inside ONE transaction is a zero-row no-op (row already flipped)", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      await createTestApplicant(tx, user.id, { status: ApplicantStatus.Passed });

      const first = await ApplicantRepository.reopenForReEvaluation(user.id, tx);
      const second = await ApplicantRepository.reopenForReEvaluation(user.id, tx);

      expect(first?.status).toBe(ApplicantStatus.InEvaluation);
      expect(second).toBeNull();
      expect((await readApplicantRow(tx, user.id))?.status).toBe(ApplicantStatus.InEvaluation);
    });
  });

  // Real-Postgres gated: the guarded UPDATE's row lock is only observable
  // across independent connections (PGlite is single-connection WASM).
  const testOnRealPostgres = isPgliteProvider() ? test.skip : test;

  testOnRealPostgres(
    "two concurrent re-opens from passed: exactly one writer flips the row, the loser matches zero rows",
    async () => {
      const applicantUserId = await createCommittedApplicant(ApplicantStatus.Passed);

      // Two INDEPENDENT transactions race the same guarded UPDATE. The row
      // lock serializes them: the loser re-evaluates the WHERE predicate on
      // the committed post-flip row, matches zero rows, and resolves null.
      const settled = await Promise.allSettled([
        db.transaction(tx => ApplicantRepository.reopenForReEvaluation(applicantUserId, tx)),
        db.transaction(tx => ApplicantRepository.reopenForReEvaluation(applicantUserId, tx)),
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
      expect(winner?.reEvaluationStartedAt).not.toBeNull();

      // Final committed state is consistent — flipped exactly once.
      const [final] = await db.select().from(applicants).where(eq(applicants.id, applicantUserId));
      expect(final?.status).toBe(ApplicantStatus.InEvaluation);
      expect(final?.reEvaluationStartedAt).not.toBeNull();
    }
  );

  // ─── Tier 4: static surface pins ────────────────────────────────────

  const REPO_FILE = join(import.meta.dir, "../../../repo/teachers/applicant.repository.ts");
  const repoSource = readFileSync(REPO_FILE, "utf8");

  /** The reopenForReEvaluation slice of the repository source (the static pin target). */
  function reOpenSource(): string {
    const start = repoSource.indexOf("export async function reopenForReEvaluation(");
    return repoSource.slice(start, repoSource.indexOf("\n  }\n", start));
  }

  test("source: a single guarded UPDATE with the certified pre-state folded into WHERE (no SELECT-then-UPDATE)", () => {
    expect(reOpenSource()).toContain(".update(applicants)");
    expect(reOpenSource()).toContain("eq(applicants.status, ApplicantStatus.Passed)");
    expect(reOpenSource().includes(".select(")).toBe(false);
    expect(reOpenSource()).toContain(".returning()");
  });

  test("source: the write sets the in_evaluation status and the cycle anchor, enum members only", () => {
    expect(reOpenSource()).toContain("status: ApplicantStatus.InEvaluation");
    expect(reOpenSource()).toContain("reEvaluationStartedAt: sql`now()`");
    expect(/'(pending|failed|in_evaluation|passed)'/.test(reOpenSource())).toBe(false);
  });

  test("source: REQUIRED tx (governance writer) — no standalone global-handle branch, no prepared statements", () => {
    expect(reOpenSource()).toContain("tx: DBTransaction");
    expect(reOpenSource().includes("tx?")).toBe(false);
    expect(reOpenSource().includes("tx ?? db")).toBe(false);
    expect(reOpenSource().includes("db.update")).toBe(false);
    expect(repoSource.includes(".prepare(")).toBe(false);
  });

  test("source: no i18n, no logger, no console (repo stays data-access only)", () => {
    expect(reOpenSource().includes("getServerTranslations")).toBe(false);
    expect(reOpenSource().includes("logger")).toBe(false);
    expect(reOpenSource().includes("console.")).toBe(false);
  });

  test("source: comments describe domain behavior only (no plan-artifact references)", () => {
    expect(/REQ-\d|DEV2|DEV3|Phase \d|Task \d|plan\.md|tasks\.md|specs\.md/.test(repoSource)).toBe(false);
  });
});
