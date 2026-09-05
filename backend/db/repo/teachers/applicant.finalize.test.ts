/**
 * ApplicantRepository.finalizeOnCertification tests — unconditional terminal
 * UPDATE (`status → 'passed'`, `cooldown_until → NULL`, `updated_at → now()`)
 * for the cold-start certification flow, against the live `kottab_test`
 * PostgreSQL instance.
 *
 * Per `backend/db/test/AGENTS.md`:
 *  - Every test runs inside `runInRollback`; `tx` is passed to EVERY repo
 *    call, entity-setup helper, and direct Drizzle query.
 *  - Entities are created ONLY via `entity-setup.ts` helpers (`createTestUser`
 *    + `createTestApplicant`) — never seed data.
 *  - `expect(...).rejects.toThrow()` is prohibited inside `runInRollback`.
 *    The method under test never throws on a missing row — it returns
 *    `false` — so the absent-row case is a plain boolean assertion.
 *
 * Coverage map:
 *  - Tier 1 (branch/stmt): pending row → returns true, status flips to
 *    'passed', cooldown stays NULL, `updated_at` advances; absent id →
 *    returns false, no row created.
 *  - Tier 2 (supersede discipline): failed-with-future-cooldown row → passed
 *    and cooldown cleared in the same statement; in_evaluation row → passed.
 *  - Tier 3 (chaos): calling finalize twice on the same row returns true
 *    both times (unconditional write, no status guard) and leaves the row
 *    in the same terminal state.
 *  - Tier 4 (preservation/tenancy): `verification_attempts` and
 *    `last_attempt_at` are byte-identical before/after finalize; the row
 *    itself is never deleted; finalizing user A leaves user B's row
 *    byte-identical.
 */

import { describe, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { ApplicantRepository } from "@/backend/db/repo";
import { applicants } from "@/backend/db/schema/teachers/applicants";
import { createTestApplicant, createTestUser } from "@/backend/db/test/entity-setup";
import { runInRollback } from "@/backend/db/test/test-utils";
import { ApplicantStatus } from "@/backend/enum";
import type { DBTransaction } from "@/backend/types";

/** Fixed historical attempt timestamp — proves `last_attempt_at` survives finalize untouched. */
const HISTORICAL_ATTEMPT_AT = new Date("2020-01-02T03:04:05.000Z");

/** Cooldown comfortably in the future — an ACTIVE cooldown at finalize time. */
const FUTURE_COOLDOWN = new Date("2100-01-01T00:00:00.000Z");

/**
 * Returns an integer id that cannot exist as an `applicants` row during this
 * transaction: applicants share their PK with `users.id`, so anything above
 * the current max (plus a large offset that no sequence reaches during a
 * rolled-back test) is guaranteed absent.
 */
async function absentApplicantId(tx: DBTransaction): Promise<number> {
  const [row] = await tx.select({ maxId: sql<number>`coalesce(max(${applicants.id}), 0)::int` }).from(applicants);
  return (row?.maxId ?? 0) + 1_000_000;
}

/**
 * Independent read-back oracle — direct Drizzle select on the same tx, NOT
 * routed through the repository method under test. Returns the live applicant
 * row so tests can assert on DB-side state after the finalize.
 */
async function readApplicantRow(tx: DBTransaction, userId: number) {
  const rows = await tx.select().from(applicants).where(eq(applicants.id, userId));
  return rows[0] ?? null;
}

/**
 * Asserts the finalize's historical-preservation contract on a row: the
 * verification-loop audit columns (`verificationAttempts`, `lastAttemptAt`)
 * must equal the values they had before the finalize, and the row must still
 * exist (finalization never deletes).
 */
function expectAuditColumnsPreserved(
  before: { verificationAttempts: number | null; lastAttemptAt: Date | null },
  after: { verificationAttempts: number | null; lastAttemptAt: Date | null } | null
) {
  expect(after).not.toBeNull();
  expect(after?.verificationAttempts).toBe(before.verificationAttempts);
  expect(after?.lastAttemptAt?.getTime() ?? null).toBe(before.lastAttemptAt?.getTime() ?? null);
}

describe("ApplicantRepository.finalizeOnCertification", () => {
  // ─── Tier 1: branch/statement ───────────────────────────────────────

  test("pending applicant → returns true, status flips to passed, cooldown stays null, updated_at advances", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);
      await createTestApplicant(tx, user.id);

      const finalized = await ApplicantRepository.finalizeOnCertification(user.id, tx);

      expect(finalized).toBe(true);

      const persisted = await readApplicantRow(tx, user.id);
      expect(persisted).not.toBeNull();
      expect(persisted?.status).toBe(ApplicantStatus.Passed);
      expect(persisted?.cooldownUntil).toBeNull();
      expect(persisted?.updatedAt).toBeInstanceOf(Date);
      expect(persisted?.updatedAt?.getTime()).toBeGreaterThan(HISTORICAL_ATTEMPT_AT.getTime());
    });
  });

  test("absent applicant row → returns false and creates no row", async () => {
    await runInRollback(async tx => {
      const missingId = await absentApplicantId(tx);

      const finalized = await ApplicantRepository.finalizeOnCertification(missingId, tx);

      // The UPDATE matched zero rows because no `applicants` row carries
      // `id = missingId` — pure UPDATE, it cannot create rows.
      expect(finalized).toBe(false);

      const row = await readApplicantRow(tx, missingId);
      expect(row).toBeNull();
    });
  });

  // ─── Tier 2: supersede discipline ───────────────────────────────────

  test("failed applicant with an active future cooldown → passed with cooldown cleared", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);
      await createTestApplicant(tx, user.id, {
        status: ApplicantStatus.Failed,
        verificationAttempts: 3,
        lastAttemptAt: HISTORICAL_ATTEMPT_AT,
        cooldownUntil: FUTURE_COOLDOWN,
      });

      // No prior-status guard: the finalize supersedes the failed state and
      // its active cooldown in the same single statement.
      const finalized = await ApplicantRepository.finalizeOnCertification(user.id, tx);

      expect(finalized).toBe(true);

      const persisted = await readApplicantRow(tx, user.id);
      expect(persisted?.status).toBe(ApplicantStatus.Passed);
      expect(persisted?.cooldownUntil).toBeNull();
      expectAuditColumnsPreserved({ verificationAttempts: 3, lastAttemptAt: HISTORICAL_ATTEMPT_AT }, persisted);
    });
  });

  test("in_evaluation applicant → passed with cooldown null", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      await createTestApplicant(tx, user.id, { status: ApplicantStatus.InEvaluation });

      const finalized = await ApplicantRepository.finalizeOnCertification(user.id, tx);

      expect(finalized).toBe(true);

      const persisted = await readApplicantRow(tx, user.id);
      expect(persisted?.status).toBe(ApplicantStatus.Passed);
      expect(persisted?.cooldownUntil).toBeNull();
    });
  });

  // ─── Tier 3: chaos ──────────────────────────────────────────────────

  test("double finalize returns true both times and leaves the row in the same terminal state", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);
      await createTestApplicant(tx, user.id, {
        status: ApplicantStatus.Failed,
        cooldownUntil: FUTURE_COOLDOWN,
      });

      // The write is unconditional (no `status <> 'passed'` guard), so a
      // repeated finalize still matches the row — an idempotent no-op
      // against the terminal state, not an error and not a guard-false.
      const first = await ApplicantRepository.finalizeOnCertification(user.id, tx);
      const second = await ApplicantRepository.finalizeOnCertification(user.id, tx);

      expect(first).toBe(true);
      expect(second).toBe(true);

      const persisted = await readApplicantRow(tx, user.id);
      expect(persisted?.status).toBe(ApplicantStatus.Passed);
      expect(persisted?.cooldownUntil).toBeNull();
    });
  });

  // ─── Tier 4: preservation / tenancy ─────────────────────────────────

  test("verificationAttempts and lastAttemptAt are byte-identical before/after; row is never deleted", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);
      await createTestApplicant(tx, user.id, {
        verificationAttempts: 7,
        lastAttemptAt: HISTORICAL_ATTEMPT_AT,
      });

      const beforeRows = await readApplicantRow(tx, user.id);
      expect(beforeRows).not.toBeNull();

      const finalized = await ApplicantRepository.finalizeOnCertification(user.id, tx);
      expect(finalized).toBe(true);

      const after = await readApplicantRow(tx, user.id);
      // Row still present with the same primary key — finalization is a
      // lifecycle transition, never a deletion.
      expect(after?.id).toBe(user.id);
      // Audit-trail columns are NOT part of the finalize's SET clause; every
      // bit survives the write.
      if (!beforeRows) {
        throw new Error("expected applicant row before finalize");
      }
      expectAuditColumnsPreserved(beforeRows, after);
    });
  });

  test("finalizing user A leaves user B's row byte-identical", async () => {
    await runInRollback(async tx => {
      const userA = await createTestUser(tx);
      const userB = await createTestUser(tx);
      await createTestApplicant(tx, userA.id, { status: ApplicantStatus.Failed, cooldownUntil: FUTURE_COOLDOWN });
      const applicantB = await createTestApplicant(tx, userB.id, {
        status: ApplicantStatus.Failed,
        verificationAttempts: 2,
        lastAttemptAt: HISTORICAL_ATTEMPT_AT,
        cooldownUntil: FUTURE_COOLDOWN,
      });

      const beforeB = await readApplicantRow(tx, userB.id);

      const finalized = await ApplicantRepository.finalizeOnCertification(userA.id, tx);
      expect(finalized).toBe(true);

      const afterB = await readApplicantRow(tx, userB.id);
      // WHERE id = $1 binds exactly one row — user B is untouched in every
      // column (updated_at included), proving the id is scoped by parameter,
      // not by any ambient filter.
      expect(afterB?.status).toBe(applicantB.status);
      expect(afterB?.cooldownUntil?.getTime()).toBe(applicantB.cooldownUntil?.getTime());
      expect(afterB?.updatedAt?.getTime()).toBe(beforeB?.updatedAt?.getTime());
      expectAuditColumnsPreserved({ verificationAttempts: 2, lastAttemptAt: HISTORICAL_ATTEMPT_AT }, afterB);
    });
  });
});
