/**
 * SessionArbitrationService tests — the post-confirmation (consumed-escrow)
 * dispute path (`openPostConfirmationDispute`, `arbitrateDispute`,
 * `getAdminDisputeCase`, the student filing party's mirror
 * `getStudentDisputeCase`) against the live PostgreSQL instance, on REAL
 * repositories, following the DB-backed service-test rules the sibling
 * session suites apply:
 *  - every transactional case runs inside `runInRollback` with `tx` (or
 *    `outerTx`) propagated to EVERY service call (the service's documented
 *    test path — a SAVEPOINT on it);
 *  - entities are created ONLY via `entity-setup.ts` helpers plus the
 *    file-local shared-PK fixtures — never seed data;
 *  - NO `expect(...).rejects.toThrow()` — every denial goes through
 *    `expectRepoError` (try/catch); typed denials are asserted through the
 *    `DomainError.code` contract plus the exact translated message.
 *
 * Coverage map:
 *  - Tier 1 (branch/statement): the open flow's full probe chain (unknown
 *    id, non-student caller — including the row's own teacher — wrong
 *    lifecycle state, missing student stamp, held escrow) and its
 *    double-submit conflict; the arbitration flow's probe chain (unknown
 *    id, non-disputed row, held-family row) with both classification
 *    directions; the three outcomes' exact financial legs (compensating
 *    `arbitration_reversal` ledger row + guarded debit, the single quantized lane
 *    credit, the uphold's zero-write branch, the never-held null-lane
 *    branch); the amount policy's every denial arm; the audit contract's
 *    per-outcome details shape; the case bundle's composition and its
 *    honest-null arms.
 *  - Tier 2 (boundary): the reason/note 500-char caps and trim
 *    normalization; the partial amount's strict decimal shape (two
 *    fractions), its open (0, fee) range (zero, the fee itself, above the
 *    fee, over-precision, sign, NaN text), and the exact-2dp acceptance;
 *    the wallet funds guard at the exact balance (funded wallet debited to
 *    "0.00") and one cent below the debit.
 *  - Tier 3 (rollback-path + committed chaos): the insufficient-funds
 *    rollback proof (zero financial writes, zero audit rows, row still
 *    disputed) and the committed-fixture double-arbitration race — two
 *    production-path arbitrations settle concurrently, exactly one commits,
 *    and the loser surfaces the state-conflict class with zero net effect
 *    on the row, the wallet, the lane, and the trail.
 *  - Tier 4 (typed denials + identity discipline): every denial carries
 *    the exact `DomainError.code` and the localized message; the student
 *    identity is only ever the caller's (a non-participant collapses to
 *    the not-found denial, never a state disclosure); arbitration accepts
 *    only the governance-clean ADMIN role (a student or teacher caller id,
 *    or a governed admin, fails closed); the wired dispute waves emit only
 *    on the consumed generation's own seams (the opened wave to the admin
 *    cohort, the resolved wave to the two participants).
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/backend/db";
import { WalletRepository } from "@/backend/db/repo";
import { auditLogs } from "@/backend/db/schema/audit/audit-logs";
import { teacherTransaction, wallet } from "@/backend/db/schema/billing";
import { homeWork } from "@/backend/db/schema/classes/home-work";
import { recitation } from "@/backend/db/schema/classes/recitation";
import { reports } from "@/backend/db/schema/classes/reports";
import { session } from "@/backend/db/schema/classes/session";
import { notifications } from "@/backend/db/schema/notifications";
import { students } from "@/backend/db/schema/students/students";
import { teacher } from "@/backend/db/schema/teachers/teacher";
import { users } from "@/backend/db/schema/users/users";
import { createTestStudent, createTestUser } from "@/backend/db/test/entity-setup";
import { expectRepoError, runInRollback } from "@/backend/db/test/test-utils";
import { TransactionStatus } from "@/backend/enum/billing/transaction-status.enum";
import { TransactionType } from "@/backend/enum/billing/transaction-type.enum";
import { NotificationType } from "@/backend/enum/notifications/notification-type.enum";
import { DisputeResolution } from "@/backend/enum/scheduling/dispute-resolution.enum";
import { HeldBalanceLane } from "@/backend/enum/scheduling/held-balance-lane.enum";
import { SessionIntent } from "@/backend/enum/scheduling/session-intent.enum";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import { ConflictError, DomainError, NotFoundError } from "@/backend/lib/errors";
import { SessionArbitrationService } from "@/backend/services/classes/session-arbitration.service";
import type { DBTransaction, SessionInsertType, SessionSelectType, UserSelectType } from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import { withImmutabilityTriggersSuspended } from "@/test/helpers/db-cleanup";
import { isPgliteProvider } from "@/test/helpers/skip-when-pglite";

const testOnRealPostgres = isPgliteProvider() ? test.skip : test;

/** The errors-namespace translations for the default test locale. */
function t() {
  return getServerTranslations("en").errorsTranslations;
}

/** Type-guard read of a caught rejection's `extensions.code`. */
function rejectionCode(error: unknown): string {
  return error instanceof DomainError ? error.code : "";
}

/**
 * Asserts a caught error is a `DomainError` carrying EXACTLY the expected
 * `extensions.code` and the exact translated message (never the raw
 * translation key).
 */
function expectDomainDenial(error: Error, code: string, message: string): void {
  expect(error).toBeInstanceOf(DomainError);
  expect(rejectionCode(error)).toBe(code);
  expect(error.message).toBe(message);
  expect(error.message).not.toContain(code);
}

// ─── File-local fixtures ─────────────────────────────────────────────────

/** Shared-PK ids for one session pair (session.teacher_id / session.student_id). */
interface ArbitrationActors {
  teacherUserId: number;
  studentUserId: number;
  teacherUser: UserSelectType;
  studentUser: UserSelectType;
}

/** Shared-PK `teacher` row insert (the wallet's FK parent). */
async function createTestTeacherRow(tx: DBTransaction, userId: number): Promise<void> {
  await tx.insert(teacher).values({ id: userId, isApproved: true });
}

/** Creates one certified teacher + one student pair with shared-PK rows. */
async function createArbitrationActors(tx: DBTransaction): Promise<ArbitrationActors> {
  const teacherUser = await createTestUser(tx, { role: "teacher" });
  await createTestTeacherRow(tx, teacherUser.id);
  const studentUser = await createTestUser(tx, { role: "student" });
  await createTestStudent(tx, studentUser.id);
  return { teacherUserId: teacherUser.id, studentUserId: studentUser.id, teacherUser, studentUser };
}

/**
 * Direct session-row insert for test preconditions (full column control).
 * The default shape is a DUAL-CONFIRMED, ESCROW-CONSUMED row — the exact
 * precondition the post-confirmation dispute path requires; every test
 * narrows from there.
 */
async function insertArbitrationSessionRow(
  tx: DBTransaction,
  actors: ArbitrationActors,
  overrides: Partial<SessionInsertType> = {}
): Promise<SessionSelectType> {
  const now = new Date();
  const [row] = await tx
    .insert(session)
    .values({
      teacherId: actors.teacherUserId,
      studentId: actors.studentUserId,
      status: SessionStatus.Completed,
      intent: SessionIntent.Hifz,
      fee: "10.00",
      feeHeld: false,
      heldBalanceLane: HeldBalanceLane.Hifz,
      confirmedByTeacherAt: now,
      confirmedByStudentAt: now,
      ...overrides,
    })
    .returning();
  if (!row) {
    throw new Error("insertArbitrationSessionRow: insert returned no rows");
  }
  return row;
}

/** Moves a consumed completed row into `disputed` through the REAL open flow. */
async function disputeConsumedRow(
  tx: DBTransaction,
  actors: ArbitrationActors,
  sessionId: number,
  reason = "the lesson never happened as described"
): Promise<void> {
  await SessionArbitrationService.openPostConfirmationDispute(actors.studentUserId, sessionId, reason, "en", tx);
}

/** Ensures the teacher's wallet row and sets its balance directly (test oracle). */
async function fundTeacherWallet(tx: DBTransaction, teacherId: number, balance: string) {
  const ensured = await WalletRepository.ensureWalletOnce(teacherId, tx);
  await tx.update(wallet).set({ balance, totalEarning: balance }).where(eq(wallet.id, ensured.id));
  return ensured;
}

/** Independent read-back oracle: the student row's lane balances. */
async function readLaneBalances(tx: DBTransaction, studentId: number) {
  const [row] = await tx
    .select({ trial: students.balanceTrial, hifz: students.balanceHifz, tajweed: students.balanceTajweed })
    .from(students)
    .where(eq(students.id, studentId));
  if (!row) {
    throw new Error("readLaneBalances: student row vanished");
  }
  return row;
}

/** Independent read-back oracle: the full session row (NOT via the service). */
async function readSessionRow(tx: DBTransaction, sessionId: number): Promise<SessionSelectType | null> {
  const [row] = await tx.select().from(session).where(eq(session.id, sessionId));
  return row ?? null;
}

/** Independent read-back oracle: the teacher's wallet row. */
function readTeacherWallet(tx: DBTransaction, teacherId: number) {
  return WalletRepository.findByTeacherId(teacherId, tx);
}

/** Independent read-back oracle: the wallet's ledger rows (newest first). */
function readLedger(tx: DBTransaction, walletId: number) {
  return WalletRepository.listTransactionsByWalletId(walletId, tx);
}

/** One recipient's wave rows for one session and wave kind (the seam oracle). */
async function countWaveRows(
  tx: DBTransaction,
  userId: number,
  sessionId: number,
  type: NotificationType
): Promise<number> {
  const rows = await tx
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, userId),
        eq(notifications.type, type),
        eq(notifications.relatedEntityType, "session"),
        eq(notifications.relatedEntityId, sessionId)
      )
    );
  return rows.length;
}

/**
 * Fetches every session-entity audit row one actor minted for one entity
 * id (entity+actor scoping keeps counts immune to concurrent test files
 * committing their own rows against the shared database).
 */
async function readAuditRows(tx: DBTransaction, actorId: number, entityId: number) {
  return tx
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.actorId, actorId), eq(auditLogs.entityType, "session"), eq(auditLogs.entityId, entityId)));
}

/** Every audit row one actor minted (the zero-write oracle for denials). */
async function countAuditRowsForActor(tx: DBTransaction, actorId: number): Promise<number> {
  const rows = await tx.select({ id: auditLogs.id }).from(auditLogs).where(eq(auditLogs.actorId, actorId));
  return rows.length;
}

/** An integer id that cannot exist as a `session` row during this transaction. */
async function absentSessionId(tx: DBTransaction): Promise<number> {
  const [row] = await tx.select({ maxId: sql<number>`coalesce(max(${session.id}), 0)::int` }).from(session);
  return (row?.maxId ?? 0) + 1_000_000;
}

/**
 * Sequential await-walker over the denial-matrix fixtures — the
 * recursive-helper shape the shipped sweepers use for the same
 * no-await-in-loop discipline (each await yields and unwinds the stack;
 * the denial cascades stay strictly ordered, which the zero-write proofs
 * that follow them rely on).
 */
async function assertSequentially<T>(items: readonly T[], run: (item: T) => Promise<void>, index = 0): Promise<void> {
  const item = items.at(index);
  if (item === undefined) {
    return;
  }
  await run(item);
  await assertSequentially(items, run, index + 1);
}

// ─── Tier 1/2/4: the post-confirmation dispute open flow ─────────────────

describe("SessionArbitrationService — post-confirmation dispute open (runInRollback)", () => {
  test("opens the student's dispute exactly once: row flips to disputed, the reason persists trimmed, escrow untouched, zero audit rows, the admin opened wave rides the same transaction", async () => {
    await runInRollback(async tx => {
      const actors = await createArbitrationActors(tx);
      const admin = await createTestUser(tx, { role: "admin" });
      const row = await insertArbitrationSessionRow(tx, actors);

      const disputed = await SessionArbitrationService.openPostConfirmationDispute(
        actors.studentUserId,
        row.id,
        "  the lesson never happened as described  ",
        "en",
        tx
      );

      expect(disputed.status).toBe(SessionStatus.Disputed);
      expect(disputed.disputeReason).toBe("the lesson never happened as described");
      expect(disputed.disputedAt).not.toBeNull();
      // The escrow and the completion stamps are deliberately untouched.
      expect(disputed.feeHeld).toBe(false);
      expect(disputed.heldBalanceLane).toBe(HeldBalanceLane.Hifz);
      expect(disputed.confirmedByStudentAt).not.toBeNull();

      // Zero audit rows (a participant action); the opened wave reached the
      // admin cohort on the SAME transaction (zero resolved rows).
      expect(await countAuditRowsForActor(tx, actors.studentUserId)).toBe(0);
      expect(await countWaveRows(tx, admin.id, row.id, NotificationType.SessionDisputeOpened)).toBe(1);
      expect(await countWaveRows(tx, admin.id, row.id, NotificationType.SessionDisputeResolved)).toBe(0);
      expect(await countWaveRows(tx, actors.studentUserId, row.id, NotificationType.SessionDisputeOpened)).toBe(0);
      expect(await countWaveRows(tx, actors.teacherUserId, row.id, NotificationType.SessionDisputeOpened)).toBe(0);
    });
  });

  test("probe chain: an unknown id, a foreign student, and the row's own teacher all collapse to the oracle-safe not-found denial", async () => {
    await runInRollback(async tx => {
      const actors = await createArbitrationActors(tx);
      const foreignStudent = await createTestUser(tx, { role: "student" });
      await createTestStudent(tx, foreignStudent.id);
      const row = await insertArbitrationSessionRow(tx, actors);
      const missingId = await absentSessionId(tx);

      const unknownError = await expectRepoError(() =>
        SessionArbitrationService.openPostConfirmationDispute(actors.studentUserId, missingId, "no such row", "en", tx)
      );
      expectDomainDenial(unknownError, "SESSION_NOT_FOUND", t().sessionNotFound);

      const foreignError = await expectRepoError(() =>
        SessionArbitrationService.openPostConfirmationDispute(foreignStudent.id, row.id, "not mine", "en", tx)
      );
      expectDomainDenial(foreignError, "SESSION_NOT_FOUND", t().sessionNotFound);

      // The row's own teacher is NOT the post-confirmation dispute caller:
      // the same oracle-safe not-found, never a state disclosure.
      const teacherError = await expectRepoError(() =>
        SessionArbitrationService.openPostConfirmationDispute(actors.teacherUserId, row.id, "not the student", "en", tx)
      );
      expectDomainDenial(teacherError, "SESSION_NOT_FOUND", t().sessionNotFound);

      // Zero writes anywhere: the row never left `completed`.
      expect((await readSessionRow(tx, row.id))?.status).toBe(SessionStatus.Completed);
      expect(await countAuditRowsForActor(tx, actors.studentUserId)).toBe(0);
    });
  });

  test("probe chain: rows outside the dual-confirmed consumed shape are the state conflict (scheduled, started, held, unstamped)", async () => {
    await runInRollback(async tx => {
      const actors = await createArbitrationActors(tx);
      const scheduled = await insertArbitrationSessionRow(tx, actors, {
        status: SessionStatus.Scheduled,
        confirmedByTeacherAt: null,
        confirmedByStudentAt: null,
        feeHeld: true,
      });
      const started = await insertArbitrationSessionRow(tx, actors, {
        status: SessionStatus.Started,
        startedAt: new Date(),
        confirmedByTeacherAt: null,
        confirmedByStudentAt: null,
        feeHeld: true,
      });
      const heldCompleted = await insertArbitrationSessionRow(tx, actors, {
        feeHeld: true,
      });
      const unstamped = await insertArbitrationSessionRow(tx, actors, {
        confirmedByStudentAt: null,
      });

      await assertSequentially([scheduled, started, heldCompleted, unstamped], async wrong => {
        const error = await expectRepoError(() =>
          SessionArbitrationService.openPostConfirmationDispute(
            actors.studentUserId,
            wrong.id,
            "not disputable",
            "en",
            tx
          )
        );
        expectDomainDenial(error, "SESSION_INVALID_TRANSITION", t().sessionInvalidTransition);
        expect((await readSessionRow(tx, wrong.id))?.status).not.toBe(SessionStatus.Disputed);
      });
    });
  });

  test("arbitration terminality: an already-arbitrated row (resolved_at stamped) is the state conflict — the decided case can never re-enter the disputed state, with zero writes", async () => {
    await runInRollback(async tx => {
      const actors = await createArbitrationActors(tx);
      // A row the admin already decided: completed, dual-confirmed, escrow
      // consumed, AND the resolution stamp set (the PostRefund outcome's
      // post-arbitration shape — resolution_note written by the admin,
      // resolved_at stamped by the completion leg).
      const decidedAt = new Date();
      const arbitrated = await insertArbitrationSessionRow(tx, actors, {
        resolutionNote: "half the slot was lost to connection failures",
        resolvedAt: decidedAt,
      });

      const error = await expectRepoError(() =>
        SessionArbitrationService.openPostConfirmationDispute(
          actors.studentUserId,
          arbitrated.id,
          "second dispute on a decided case",
          "en",
          tx
        )
      );
      expectDomainDenial(error, "SESSION_INVALID_TRANSITION", t().sessionInvalidTransition);

      // Zero writes anywhere: the decision stands untouched.
      const after = await readSessionRow(tx, arbitrated.id);
      expect(after?.status).toBe(SessionStatus.Completed);
      expect(after?.resolutionNote).toBe("half the slot was lost to connection failures");
      expect(after?.resolvedAt).not.toBeNull();
      expect(after?.disputedAt).toBeNull();
      expect(await countAuditRowsForActor(tx, actors.studentUserId)).toBe(0);
    });
  });

  test("double submission: the second open is the state-conflict loser and never rewrites the recorded reason", async () => {
    await runInRollback(async tx => {
      const actors = await createArbitrationActors(tx);
      const row = await insertArbitrationSessionRow(tx, actors);
      const firstReason = "first submission reason";
      await disputeConsumedRow(tx, actors, row.id, firstReason);

      const secondError = await expectRepoError(() =>
        SessionArbitrationService.openPostConfirmationDispute(
          actors.studentUserId,
          row.id,
          "second submission reason",
          "en",
          tx
        )
      );
      expectDomainDenial(secondError, "SESSION_INVALID_TRANSITION", t().sessionInvalidTransition);

      const afterSecond = await readSessionRow(tx, row.id);
      expect(afterSecond?.disputeReason).toBe(firstReason);
    });
  });

  test("boundary: the reason guard and the id-shape guard deny pre-DB (empty, whitespace, 501 chars, malformed id); 500 chars persist verbatim", async () => {
    await runInRollback(async tx => {
      const actors = await createArbitrationActors(tx);
      const row = await insertArbitrationSessionRow(tx, actors);

      await assertSequentially(["", "   ", "x".repeat(501)], async badReason => {
        const error = await expectRepoError(() =>
          SessionArbitrationService.openPostConfirmationDispute(actors.studentUserId, row.id, badReason, "en", tx)
        );
        expectDomainDenial(error, "VALIDATION", t().validation);
      });

      await assertSequentially([0, -3, Number.NaN, 1.5], async badId => {
        const error = await expectRepoError(() =>
          SessionArbitrationService.openPostConfirmationDispute(actors.studentUserId, badId, "bad id", "en", tx)
        );
        expectDomainDenial(error, "VALIDATION", t().validation);
      });

      // The 500-char boundary is accepted and persisted verbatim.
      const maxReason = "r".repeat(500);
      const disputed = await SessionArbitrationService.openPostConfirmationDispute(
        actors.studentUserId,
        row.id,
        maxReason,
        "en",
        tx
      );
      expect(disputed.disputeReason).toBe(maxReason);
      expect(disputed.disputeReason?.length).toBe(500);
    });
  });
});

// ─── Tier 1/2: the three arbitration outcomes ────────────────────────────

describe("SessionArbitrationService — arbitration outcomes (runInRollback)", () => {
  test("Refund: compensating arbitration-reversal ledger row + guarded full-fee debit + exactly one lane credit + exactly one audit row", async () => {
    await runInRollback(async tx => {
      const actors = await createArbitrationActors(tx);
      const admin = await createTestUser(tx, { role: "admin" });
      const row = await insertArbitrationSessionRow(tx, actors);
      await disputeConsumedRow(tx, actors, row.id);
      const funded = await fundTeacherWallet(tx, actors.teacherUserId, "10.00");
      await tx.update(students).set({ balanceHifz: 0 }).where(eq(students.id, actors.studentUserId));

      const resolved = await SessionArbitrationService.arbitrateDispute(
        admin.id,
        row.id,
        DisputeResolution.Refund,
        null,
        null,
        "en",
        tx
      );

      // The row: completed with the resolution stamps — and since CR-5 the
      // FORMAL outcome persists beside them (the note is optional; the
      // decision is not).
      expect(resolved.status).toBe(SessionStatus.Completed);
      expect(resolved.resolvedAt).not.toBeNull();
      expect(resolved.resolutionNote).toBeNull();
      expect(resolved.resolutionOutcome).toBe(DisputeResolution.Refund);

      // The teacher leg: the compensating arbitration-reversal row keyed to the
      // session, the balance debited to exactly zero, `total_earning`
      // untouched by the reversal.
      const walletRow = await readTeacherWallet(tx, actors.teacherUserId);
      expect(walletRow?.balance).toBe("0.00");
      expect(walletRow?.totalEarning).toBe("10.00");
      const ledger = await readLedger(tx, funded.id);
      expect(ledger).toHaveLength(1);
      expect(ledger[0]?.type).toBe(TransactionType.ArbitrationReversal);
      expect(ledger[0]?.status).toBe(TransactionStatus.Completed);
      expect(ledger[0]?.sessionId).toBe(row.id);
      expect(ledger[0]?.amount).toBe("10.00");

      // The student leg: exactly ONE session credit restored to the
      // recorded provenance lane (the quantized refund unit).
      const balances = await readLaneBalances(tx, actors.studentUserId);
      expect(balances.hifz).toBe(1);
      expect(balances.trial).toBe(0);
      expect(balances.tajweed).toBe(0);

      // Exactly ONE audit row with the arbitration details contract.
      const auditRows = await readAuditRows(tx, admin.id, row.id);
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0]?.actionType).toBe("override");
      expect(auditRows[0]?.entityType).toBe("session");
      expect(auditRows[0]?.entityId).toBe(row.id);
      expect(JSON.parse(auditRows[0]?.details ?? "{}")).toEqual({
        resolution: "Refund",
        refundAmount: "10.00",
        notePresent: false,
      });

      // The wired dispute waves: the opened wave (from the dispute
      // precondition) reached the admin; the resolved wave reached exactly
      // the two participants — nobody else, and no admin resolved-wave rows.
      expect(await countWaveRows(tx, admin.id, row.id, NotificationType.SessionDisputeOpened)).toBe(1);
      expect(await countWaveRows(tx, admin.id, row.id, NotificationType.SessionDisputeResolved)).toBe(0);
      expect(await countWaveRows(tx, actors.studentUserId, row.id, NotificationType.SessionDisputeResolved)).toBe(1);
      expect(await countWaveRows(tx, actors.teacherUserId, row.id, NotificationType.SessionDisputeResolved)).toBe(1);
    });
  });

  test("Refund with a note: the note's content never enters the audit details, and the trimmed note persists", async () => {
    await runInRollback(async tx => {
      const actors = await createArbitrationActors(tx);
      const admin = await createTestUser(tx, { role: "admin" });
      const row = await insertArbitrationSessionRow(tx, actors);
      await disputeConsumedRow(tx, actors, row.id);
      await fundTeacherWallet(tx, actors.teacherUserId, "10.00");

      const noteContent = "ledger reviewed; full restitution approved";
      const resolved = await SessionArbitrationService.arbitrateDispute(
        admin.id,
        row.id,
        DisputeResolution.Refund,
        `  ${noteContent}  `,
        null,
        "en",
        tx
      );

      expect(resolved.resolutionNote).toBe(noteContent);

      const auditRows = await readAuditRows(tx, admin.id, row.id);
      expect(auditRows).toHaveLength(1);
      const details = JSON.parse(auditRows[0]?.details ?? "{}");
      expect(details).toEqual({ resolution: "Refund", refundAmount: "10.00", notePresent: true });
      expect(auditRows[0]?.details).not.toContain(noteContent);
    });
  });

  test("PartialRefund: debits exactly the supplied decimal string, credits the lane once, and the audit carries partialAmount verbatim", async () => {
    await runInRollback(async tx => {
      const actors = await createArbitrationActors(tx);
      const admin = await createTestUser(tx, { role: "admin" });
      const row = await insertArbitrationSessionRow(tx, actors);
      await disputeConsumedRow(tx, actors, row.id);
      const funded = await fundTeacherWallet(tx, actors.teacherUserId, "10.00");

      const resolved = await SessionArbitrationService.arbitrateDispute(
        admin.id,
        row.id,
        DisputeResolution.PartialRefund,
        "partial win",
        "4.50",
        "en",
        tx
      );

      expect(resolved.status).toBe(SessionStatus.Completed);
      expect(resolved.resolutionNote).toBe("partial win");

      const walletRow = await readTeacherWallet(tx, actors.teacherUserId);
      expect(walletRow?.balance).toBe("5.50");
      const ledger = await readLedger(tx, funded.id);
      expect(ledger).toHaveLength(1);
      expect(ledger[0]?.amount).toBe("4.50");
      expect(ledger[0]?.sessionId).toBe(row.id);

      const balances = await readLaneBalances(tx, actors.studentUserId);
      expect(balances.hifz).toBe(1);

      const auditRows = await readAuditRows(tx, admin.id, row.id);
      expect(auditRows).toHaveLength(1);
      expect(JSON.parse(auditRows[0]?.details ?? "{}")).toEqual({
        resolution: "PartialRefund",
        partialAmount: "4.50",
        notePresent: true,
      });
    });
  });

  test("Uphold: zero financial writes — wallet, ledger, and lane untouched — with exactly one audit row", async () => {
    await runInRollback(async tx => {
      const actors = await createArbitrationActors(tx);
      const admin = await createTestUser(tx, { role: "admin" });
      const row = await insertArbitrationSessionRow(tx, actors);
      await disputeConsumedRow(tx, actors, row.id);
      const funded = await fundTeacherWallet(tx, actors.teacherUserId, "10.00");

      const resolved = await SessionArbitrationService.arbitrateDispute(
        admin.id,
        row.id,
        DisputeResolution.Uphold,
        null,
        null,
        "en",
        tx
      );

      expect(resolved.status).toBe(SessionStatus.Completed);
      expect(resolved.resolutionNote).toBeNull();
      expect(resolved.resolvedAt).not.toBeNull();

      const walletRow = await readTeacherWallet(tx, actors.teacherUserId);
      expect(walletRow?.balance).toBe("10.00");
      expect(await readLedger(tx, funded.id)).toHaveLength(0);
      const balances = await readLaneBalances(tx, actors.studentUserId);
      expect(balances.hifz).toBe(0);

      const auditRows = await readAuditRows(tx, admin.id, row.id);
      expect(auditRows).toHaveLength(1);
      expect(JSON.parse(auditRows[0]?.details ?? "{}")).toEqual({ resolution: "Uphold", notePresent: false });
    });
  });

  test("never-held defensive case: a null provenance lane skips the student credit as a no-op while the teacher debit still applies", async () => {
    await runInRollback(async tx => {
      const actors = await createArbitrationActors(tx);
      const admin = await createTestUser(tx, { role: "admin" });
      const row = await insertArbitrationSessionRow(tx, actors, { heldBalanceLane: null });
      await disputeConsumedRow(tx, actors, row.id);
      const funded = await fundTeacherWallet(tx, actors.teacherUserId, "10.00");

      const resolved = await SessionArbitrationService.arbitrateDispute(
        admin.id,
        row.id,
        DisputeResolution.Refund,
        null,
        null,
        "en",
        tx
      );

      expect(resolved.status).toBe(SessionStatus.Completed);
      const walletRow = await readTeacherWallet(tx, actors.teacherUserId);
      expect(walletRow?.balance).toBe("0.00");
      // The lane balances never moved (nothing was ever held there).
      const balances = await readLaneBalances(tx, actors.studentUserId);
      expect(balances.hifz).toBe(0);
      expect(balances.trial).toBe(0);
      expect(balances.tajweed).toBe(0);
      expect(await readLedger(tx, funded.id)).toHaveLength(1);
    });
  });

  test("classification mismatch both directions: Cancel/Complete on a consumed row and Refund on a held row deny with zero writes", async () => {
    await runInRollback(async tx => {
      const actors = await createArbitrationActors(tx);
      const admin = await createTestUser(tx, { role: "admin" });
      const row = await insertArbitrationSessionRow(tx, actors);
      await disputeConsumedRow(tx, actors, row.id);
      const funded = await fundTeacherWallet(tx, actors.teacherUserId, "10.00");

      await assertSequentially([DisputeResolution.Cancel, DisputeResolution.Complete], async heldFamily => {
        const error = await expectRepoError(() =>
          SessionArbitrationService.arbitrateDispute(admin.id, row.id, heldFamily, null, null, "en", tx)
        );
        expectDomainDenial(error, "VALIDATION", t().disputeResolutionMismatch);
      });

      // The held-family disputed row: same row shape, fee still frozen.
      const heldRow = await insertArbitrationSessionRow(tx, actors, {
        status: SessionStatus.Disputed,
        feeHeld: true,
        confirmedByStudentAt: null,
        disputeReason: "held-generation dispute",
        disputedAt: new Date(),
      });
      const heldError = await expectRepoError(() =>
        SessionArbitrationService.arbitrateDispute(admin.id, heldRow.id, DisputeResolution.Refund, null, null, "en", tx)
      );
      expectDomainDenial(heldError, "VALIDATION", t().disputeResolutionMismatch);

      // Zero writes anywhere: both rows still disputed, wallet untouched,
      // zero audit rows for the admin.
      expect((await readSessionRow(tx, row.id))?.status).toBe(SessionStatus.Disputed);
      expect((await readSessionRow(tx, heldRow.id))?.status).toBe(SessionStatus.Disputed);
      const walletRow = await readTeacherWallet(tx, actors.teacherUserId);
      expect(walletRow?.balance).toBe("10.00");
      expect(await readLedger(tx, funded.id)).toHaveLength(0);
      expect(await countAuditRowsForActor(tx, admin.id)).toBe(0);
    });
  });

  test("partial-amount validation matrix: every malformed amount denies before any write", async () => {
    await runInRollback(async tx => {
      const actors = await createArbitrationActors(tx);
      const admin = await createTestUser(tx, { role: "admin" });
      const row = await insertArbitrationSessionRow(tx, actors);
      await disputeConsumedRow(tx, actors, row.id);
      const funded = await fundTeacherWallet(tx, actors.teacherUserId, "10.00");

      // missing, empty, non-numeric, NaN text, zero, the fee itself, above
      // the fee, over-precision, signed, whitespace — every arm of the
      // matrix is the localized partialRefundAmountInvalid denial.
      await assertSequentially(
        [null, "", "abc", "NaN", "0", "0.00", "10.00", "12.00", "1.999", "-4.00", " 4.50"],
        async badAmount => {
          const error = await expectRepoError(() =>
            SessionArbitrationService.arbitrateDispute(
              admin.id,
              row.id,
              DisputeResolution.PartialRefund,
              null,
              badAmount,
              "en",
              tx
            )
          );
          expectDomainDenial(error, "VALIDATION", t().partialRefundAmountInvalid);
        }
      );

      // Zero writes: the row is still disputed and nothing moved anywhere.
      expect((await readSessionRow(tx, row.id))?.status).toBe(SessionStatus.Disputed);
      const walletRow = await readTeacherWallet(tx, actors.teacherUserId);
      expect(walletRow?.balance).toBe("10.00");
      expect(await readLedger(tx, funded.id)).toHaveLength(0);
      expect(await countAuditRowsForActor(tx, admin.id)).toBe(0);

      // The exact-2dp acceptance arm resolves the SAME row afterwards.
      const resolved = await SessionArbitrationService.arbitrateDispute(
        admin.id,
        row.id,
        DisputeResolution.PartialRefund,
        null,
        "4.50",
        "en",
        tx
      );
      expect(resolved.status).toBe(SessionStatus.Completed);
    });
  });

  test("stray money input alongside Refund or Uphold is the partialRefundAmountInvalid denial (never silently ignored)", async () => {
    await runInRollback(async tx => {
      const actors = await createArbitrationActors(tx);
      const admin = await createTestUser(tx, { role: "admin" });
      const row = await insertArbitrationSessionRow(tx, actors);
      await disputeConsumedRow(tx, actors, row.id);
      const funded = await fundTeacherWallet(tx, actors.teacherUserId, "10.00");

      await assertSequentially([DisputeResolution.Refund, DisputeResolution.Uphold], async outcome => {
        const error = await expectRepoError(() =>
          SessionArbitrationService.arbitrateDispute(admin.id, row.id, outcome, null, "1.00", "en", tx)
        );
        expectDomainDenial(error, "VALIDATION", t().partialRefundAmountInvalid);
      });

      expect((await readSessionRow(tx, row.id))?.status).toBe(SessionStatus.Disputed);
      const walletRow = await readTeacherWallet(tx, actors.teacherUserId);
      expect(walletRow?.balance).toBe("10.00");
      expect(await readLedger(tx, funded.id)).toHaveLength(0);
      expect(await countAuditRowsForActor(tx, admin.id)).toBe(0);
    });
  });

  test("insufficient wallet funds fail closed: the typed conflict rolls everything back — row still disputed, zero financial writes, zero audit rows", async () => {
    await runInRollback(async tx => {
      const actors = await createArbitrationActors(tx);
      const admin = await createTestUser(tx, { role: "admin" });
      const row = await insertArbitrationSessionRow(tx, actors);
      await disputeConsumedRow(tx, actors, row.id);
      // One cent short of the full fee — the funds-guard boundary.
      const funded = await fundTeacherWallet(tx, actors.teacherUserId, "9.99");

      const refundError = await expectRepoError(() =>
        SessionArbitrationService.arbitrateDispute(admin.id, row.id, DisputeResolution.Refund, null, null, "en", tx)
      );
      expectDomainDenial(refundError, "WALLET_INSUFFICIENT_FUNDS", t().insufficientBalance);
      expect(refundError).toBeInstanceOf(ConflictError);

      // A funded-but-thin balance fails the PARTIAL debit too: the amount
      // is valid (strictly below the fee) but above the funded balance.
      await tx.update(wallet).set({ balance: "4.00" }).where(eq(wallet.id, funded.id));
      const partialShortError = await expectRepoError(() =>
        SessionArbitrationService.arbitrateDispute(
          admin.id,
          row.id,
          DisputeResolution.PartialRefund,
          null,
          "9.99",
          "en",
          tx
        )
      );
      expectDomainDenial(partialShortError, "WALLET_INSUFFICIENT_FUNDS", t().insufficientBalance);

      // Zero net effect: the row is STILL disputed with no resolution
      // stamps, the balance is untouched, no ledger row, no lane delta,
      // and zero audit rows for the admin.
      const after = await readSessionRow(tx, row.id);
      expect(after?.status).toBe(SessionStatus.Disputed);
      expect(after?.resolutionNote).toBeNull();
      expect(after?.resolvedAt).toBeNull();
      const walletRow = await readTeacherWallet(tx, actors.teacherUserId);
      expect(walletRow?.balance).toBe("4.00");
      expect(await readLedger(tx, funded.id)).toHaveLength(0);
      const balances = await readLaneBalances(tx, actors.studentUserId);
      expect(balances.hifz).toBe(0);
      expect(await countAuditRowsForActor(tx, admin.id)).toBe(0);
    });
  });

  test("an absent wallet fails closed the same way: the ensured zero-balance wallet cannot cover the debit", async () => {
    await runInRollback(async tx => {
      const actors = await createArbitrationActors(tx);
      const admin = await createTestUser(tx, { role: "admin" });
      const row = await insertArbitrationSessionRow(tx, actors);
      await disputeConsumedRow(tx, actors, row.id);

      const error = await expectRepoError(() =>
        SessionArbitrationService.arbitrateDispute(admin.id, row.id, DisputeResolution.Refund, null, null, "en", tx)
      );
      expectDomainDenial(error, "WALLET_INSUFFICIENT_FUNDS", t().insufficientBalance);

      expect((await readSessionRow(tx, row.id))?.status).toBe(SessionStatus.Disputed);
      // The ensure step's wallet INSERT rode the same failed savepoint, so
      // the wallet itself rolled back with the flow — the strongest
      // zero-financial-write proof this path can give.
      expect(await readTeacherWallet(tx, actors.teacherUserId)).toBeNull();
      expect(await countAuditRowsForActor(tx, admin.id)).toBe(0);
    });
  });
});

// ─── Tier 1/4: arbitration probe denials, governance belt, case review ───

describe("SessionArbitrationService — arbitration denials + case review (runInRollback)", () => {
  test("arbitration probe chain: an unknown id is the not-found denial and a non-disputed consumed row is the state conflict", async () => {
    await runInRollback(async tx => {
      const actors = await createArbitrationActors(tx);
      const admin = await createTestUser(tx, { role: "admin" });
      const settled = await insertArbitrationSessionRow(tx, actors);
      const missingId = await absentSessionId(tx);

      const unknownError = await expectRepoError(() =>
        SessionArbitrationService.arbitrateDispute(admin.id, missingId, DisputeResolution.Refund, null, null, "en", tx)
      );
      expectDomainDenial(unknownError, "SESSION_NOT_FOUND", t().sessionNotFound);

      const settledError = await expectRepoError(() =>
        SessionArbitrationService.arbitrateDispute(admin.id, settled.id, DisputeResolution.Refund, null, null, "en", tx)
      );
      expectDomainDenial(settledError, "SESSION_INVALID_TRANSITION", t().sessionInvalidTransition);

      expect((await readSessionRow(tx, settled.id))?.status).toBe(SessionStatus.Completed);
      expect(await countAuditRowsForActor(tx, admin.id)).toBe(0);
    });
  });

  test("non-admin arbitration is denied by the governance re-assertion; a governed admin fails closed; student identity is never trusted from input", async () => {
    await runInRollback(async tx => {
      const actors = await createArbitrationActors(tx);
      const row = await insertArbitrationSessionRow(tx, actors);
      await disputeConsumedRow(tx, actors, row.id);
      const blockedAdmin = await createTestUser(tx, { role: "admin", isBlocked: true });

      // A student's id passed as the arbitration actor is FORBIDDEN — the
      // DB role row is the authority, never the caller's claim.
      const studentError = await expectRepoError(() =>
        SessionArbitrationService.arbitrateDispute(
          actors.studentUserId,
          row.id,
          DisputeResolution.Refund,
          null,
          null,
          "en",
          tx
        )
      );
      expectDomainDenial(studentError, "FORBIDDEN", t().forbidden);

      const teacherError = await expectRepoError(() =>
        SessionArbitrationService.arbitrateDispute(
          actors.teacherUserId,
          row.id,
          DisputeResolution.Refund,
          null,
          null,
          "en",
          tx
        )
      );
      expectDomainDenial(teacherError, "FORBIDDEN", t().forbidden);

      // An admin demoted/governed after login fails closed.
      const governedError = await expectRepoError(() =>
        SessionArbitrationService.arbitrateDispute(
          blockedAdmin.id,
          row.id,
          DisputeResolution.Refund,
          null,
          null,
          "en",
          tx
        )
      );
      expectDomainDenial(governedError, "FORBIDDEN", t().forbidden);

      expect((await readSessionRow(tx, row.id))?.status).toBe(SessionStatus.Disputed);
      expect(await countAuditRowsForActor(tx, actors.studentUserId)).toBe(0);
      expect(await countAuditRowsForActor(tx, blockedAdmin.id)).toBe(0);
    });
  });

  test("getAdminDisputeCase composes the full evidence bundle: session detail, report, homework, recitation, and the session-scoped trail", async () => {
    await runInRollback(async tx => {
      const actors = await createArbitrationActors(tx);
      const admin = await createTestUser(tx, { role: "admin" });
      const row = await insertArbitrationSessionRow(tx, actors);
      await disputeConsumedRow(tx, actors, row.id);
      await tx
        .insert(reports)
        .values({ sessionId: row.id, teacherNotes: "session ran short", studentRatingByTeacher: 3 });
      await tx.insert(homeWork).values({ sessionId: row.id, currentFromAyah: 1, currentToAyah: 7, currentGrade: 90 });
      await tx.insert(recitation).values({ sessionId: row.id, name: "Al-Fatiha", description: null });

      // The arbitration itself is the trail's first entry.
      await SessionArbitrationService.arbitrateDispute(
        admin.id,
        row.id,
        DisputeResolution.Uphold,
        null,
        null,
        "en",
        tx
      );

      const disputeCase = await SessionArbitrationService.getAdminDisputeCase(admin.id, row.id, "en", tx);

      expect(disputeCase.session.id).toBe(row.id);
      expect(disputeCase.session.status).toBe(SessionStatus.Completed);
      expect(disputeCase.session.disputeReason).not.toBeNull();
      expect(disputeCase.studentName).toBe(actors.studentUser.fullName);
      expect(disputeCase.teacherName).toBe(actors.teacherUser.fullName);
      expect(disputeCase.report?.teacherNotes).toBe("session ran short");
      expect(disputeCase.report?.studentRatingByTeacher).toBe(3);
      expect(disputeCase.homework?.currentGrade).toBe(90);
      expect(disputeCase.recitation?.name).toBe("Al-Fatiha");
      expect(disputeCase.auditTrail).toHaveLength(1);
      expect(disputeCase.auditTrail[0]?.entityId).toBe(row.id);
      expect(disputeCase.auditTrail[0]?.details).toContain("Uphold");
    });
  });

  test("getAdminDisputeCase surfaces honest nulls for absent artifacts and an empty trail", async () => {
    await runInRollback(async tx => {
      const actors = await createArbitrationActors(tx);
      const admin = await createTestUser(tx, { role: "admin" });
      const row = await insertArbitrationSessionRow(tx, actors);
      await disputeConsumedRow(tx, actors, row.id);

      const disputeCase = await SessionArbitrationService.getAdminDisputeCase(admin.id, row.id, "en", tx);

      expect(disputeCase.session.id).toBe(row.id);
      expect(disputeCase.session.feeHeld).toBe(false);
      expect(disputeCase.studentName).toBe(actors.studentUser.fullName);
      expect(disputeCase.teacherName).toBe(actors.teacherUser.fullName);
      expect(disputeCase.report).toBeNull();
      expect(disputeCase.homework).toBeNull();
      expect(disputeCase.recitation).toBeNull();
      expect(disputeCase.auditTrail).toEqual([]);
    });
  });

  test("getAdminDisputeCase denials: unknown or malformed id → localized not-found; a non-admin caller → FORBIDDEN", async () => {
    await runInRollback(async tx => {
      const actors = await createArbitrationActors(tx);
      const admin = await createTestUser(tx, { role: "admin" });
      const row = await insertArbitrationSessionRow(tx, actors);
      const missingId = await absentSessionId(tx);

      const unknownError = await expectRepoError(() =>
        SessionArbitrationService.getAdminDisputeCase(admin.id, missingId, "en", tx)
      );
      expect(unknownError).toBeInstanceOf(NotFoundError);
      expectDomainDenial(unknownError, "SESSION_NOT_FOUND", t().sessionNotFound);

      const malformedError = await expectRepoError(() =>
        SessionArbitrationService.getAdminDisputeCase(admin.id, 0, "en", tx)
      );
      expectDomainDenial(malformedError, "SESSION_NOT_FOUND", t().sessionNotFound);

      const studentError = await expectRepoError(() =>
        SessionArbitrationService.getAdminDisputeCase(actors.studentUserId, row.id, "en", tx)
      );
      expectDomainDenial(studentError, "FORBIDDEN", t().forbidden);
    });
  });
});

// ─── The participant case reads: the student filing party's mirror ───────

describe("SessionArbitrationService — the student case read (the filing party's mirror)", () => {
  test("getStudentDisputeCase composes the participant bundle: session detail, report, homework, recitation, and the teacher display name", async () => {
    await runInRollback(async tx => {
      const actors = await createArbitrationActors(tx);
      const row = await insertArbitrationSessionRow(tx, actors);
      await disputeConsumedRow(tx, actors, row.id);
      await tx
        .insert(reports)
        .values({ sessionId: row.id, teacherNotes: "session ran short", studentRatingByTeacher: 3 });
      await tx.insert(homeWork).values({ sessionId: row.id, currentFromAyah: 1, currentToAyah: 7, currentGrade: 90 });
      await tx.insert(recitation).values({ sessionId: row.id, name: "Al-Fatiha", description: null });

      const disputeCase = await SessionArbitrationService.getStudentDisputeCase(actors.studentUserId, row.id, "en", tx);

      expect(disputeCase.session.id).toBe(row.id);
      expect(disputeCase.session.status).toBe(SessionStatus.Disputed);
      expect(disputeCase.session.disputeReason).toBeTypeOf("string");
      // The TEACHER display name resolves (the counterparty the filing
      // party filed against); the caller's own name is equally absent.
      expect(disputeCase.teacherName).toBe(actors.teacherUser.fullName);
      expect(disputeCase.report).not.toBeNull();
      expect(disputeCase.report?.teacherNotes).toBe("session ran short");
      expect(disputeCase.homework).not.toBeNull();
      expect(disputeCase.homework?.currentFromAyah).toBe(1);
      expect(disputeCase.recitation).not.toBeNull();
      expect(disputeCase.recitation?.name).toBe("Al-Fatiha");
      // The student envelope has NO studentName member — the type is the
      // mirror, not a superset (compile-time pinned; re-asserted here for
      // runtime drift).
      expect("studentName" in disputeCase).toBe(false);
    });
  });

  test("getStudentDisputeCase surfaces honest nulls for absent artifacts", async () => {
    await runInRollback(async tx => {
      const actors = await createArbitrationActors(tx);
      const row = await insertArbitrationSessionRow(tx, actors);
      await disputeConsumedRow(tx, actors, row.id);

      const disputeCase = await SessionArbitrationService.getStudentDisputeCase(actors.studentUserId, row.id, "en", tx);

      expect(disputeCase.session.id).toBe(row.id);
      expect(disputeCase.teacherName).toBe(actors.teacherUser.fullName);
      expect(disputeCase.report).toBeNull();
      expect(disputeCase.homework).toBeNull();
      expect(disputeCase.recitation).toBeNull();
    });
  });

  test("getStudentDisputeCase denials: unknown, malformed, and non-participant callers collapse into the SAME oracle-safe not-found", async () => {
    await runInRollback(async tx => {
      const actors = await createArbitrationActors(tx);
      const row = await insertArbitrationSessionRow(tx, actors);
      const missingId = await absentSessionId(tx);

      const unknownError = await expectRepoError(() =>
        SessionArbitrationService.getStudentDisputeCase(actors.studentUserId, missingId, "en", tx)
      );
      expect(unknownError).toBeInstanceOf(NotFoundError);
      expectDomainDenial(unknownError, "SESSION_NOT_FOUND", t().sessionNotFound);

      const malformedError = await expectRepoError(() =>
        SessionArbitrationService.getStudentDisputeCase(actors.studentUserId, 0, "en", tx)
      );
      expectDomainDenial(malformedError, "SESSION_NOT_FOUND", t().sessionNotFound);

      // A second student (a non-participant) gets the SAME not-found
      // shape — no existence leak to a non-party.
      const foreign = await createTestUser(tx, { role: "student" });
      const foreignError = await expectRepoError(() =>
        SessionArbitrationService.getStudentDisputeCase(foreign.id, row.id, "en", tx)
      );
      expectDomainDenial(foreignError, "SESSION_NOT_FOUND", t().sessionNotFound);
    });
  });
});

// ─── Tier 3: the committed double-arbitration race ───────────────────────

describe("SessionArbitrationService — double-arbitration race (committed fixtures)", () => {
  let raceTeacherId = 0;
  let raceStudentId = 0;
  let raceAdminAId = 0;
  let raceAdminBId = 0;
  let raceSessionId = 0;
  let raceWalletId = 0;

  beforeAll(async () => {
    await db.transaction(async tx => {
      const actors = await createArbitrationActors(tx);
      raceTeacherId = actors.teacherUserId;
      raceStudentId = actors.studentUserId;
      const adminA = await createTestUser(tx, { role: "admin" });
      const adminB = await createTestUser(tx, { role: "admin" });
      raceAdminAId = adminA.id;
      raceAdminBId = adminB.id;
      const row = await insertArbitrationSessionRow(tx, actors);
      await disputeConsumedRow(tx, actors, row.id);
      raceSessionId = row.id;
      const funded = await fundTeacherWallet(tx, raceTeacherId, "10.00");
      raceWalletId = funded.id;
    });
  });

  afterAll(async () => {
    if (raceSessionId === 0) {
      return;
    }
    // FK-safe hard delete: the append-only ledger and trail rows go first
    // under the sanctioned trigger suspension, then the notification rows,
    // then the session, then the users (the users delete cascades the
    // students/teacher role-child rows and the wallet).
    await withImmutabilityTriggersSuspended(["teacher_transaction", "audit_logs"], async () => {
      await db.delete(teacherTransaction).where(eq(teacherTransaction.walletId, raceWalletId));
      await db.delete(auditLogs).where(eq(auditLogs.actorId, raceAdminAId));
      await db.delete(auditLogs).where(eq(auditLogs.actorId, raceAdminBId));
    });
    await db.delete(notifications).where(eq(notifications.relatedEntityId, raceSessionId));
    await db.delete(session).where(eq(session.id, raceSessionId));
    await db.delete(users).where(eq(users.id, raceStudentId));
    await db.delete(users).where(eq(users.id, raceTeacherId));
    await db.delete(users).where(eq(users.id, raceAdminAId));
    await db.delete(users).where(eq(users.id, raceAdminBId));
  });

  testOnRealPostgres(
    "two concurrent arbitrations: exactly one commits; the loser is the state-conflict class with zero net effect",
    async () => {
      // Both calls run on the PRODUCTION path (no outer transaction): each
      // opens its own real transaction on its own connection — genuine
      // row-lock serialization on the guarded completion leg.
      const outcomes = await Promise.allSettled([
        SessionArbitrationService.arbitrateDispute(
          raceAdminAId,
          raceSessionId,
          DisputeResolution.Refund,
          null,
          null,
          "en"
        ),
        SessionArbitrationService.arbitrateDispute(
          raceAdminBId,
          raceSessionId,
          DisputeResolution.Refund,
          null,
          null,
          "en"
        ),
      ]);

      const fulfillments = outcomes.flatMap(outcome => (outcome.status === "fulfilled" ? [outcome.value] : []));
      const rejections = outcomes.flatMap(outcome => (outcome.status === "rejected" ? [outcome.reason] : []));
      expect(fulfillments).toHaveLength(1);
      expect(rejections).toHaveLength(1);
      expect(rejections[0]).toBeInstanceOf(DomainError);
      // The guarded completion leg fires before any money moves, so the
      // loser is deterministically the state-conflict class — never a
      // wallet-funding artifact of the race.
      expect(rejectionCode(rejections[0])).toBe("SESSION_INVALID_TRANSITION");

      // Exactly one committed outcome: the row is completed once, the
      // wallet was debited exactly once, the lane credited exactly once,
      // and exactly one audit row exists for the session.
      const [row] = await db.select().from(session).where(eq(session.id, raceSessionId));
      expect(row?.status).toBe(SessionStatus.Completed);
      const walletRow = await WalletRepository.findByTeacherId(raceTeacherId);
      expect(walletRow?.balance).toBe("0.00");
      const ledger = await WalletRepository.listTransactionsByWalletId(raceWalletId);
      expect(ledger).toHaveLength(1);
      const [balance] = await db
        .select({ hifz: students.balanceHifz })
        .from(students)
        .where(eq(students.id, raceStudentId));
      expect(balance?.hifz).toBe(1);
      const trailRows = await db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.entityType, "session"), eq(auditLogs.entityId, raceSessionId)));
      expect(trailRows).toHaveLength(1);
      expect(JSON.parse(trailRows[0]?.details ?? "{}")).toEqual({
        resolution: "Refund",
        refundAmount: "10.00",
        notePresent: false,
      });
    }
  );
});

describe("SessionArbitrationService — the admin dispute queue rows", () => {
  testOnRealPostgres(
    "listDisputedSessionRows wraps the disputed page with the batched participant names and the honest tail",
    async () => {
      await runInRollback(async tx => {
        const first = await createArbitrationActors(tx);
        const second = await createArbitrationActors(tx);
        const firstRow = await insertArbitrationSessionRow(tx, first);
        const secondRow = await insertArbitrationSessionRow(tx, second);
        await disputeConsumedRow(tx, first, firstRow.id);
        await disputeConsumedRow(tx, second, secondRow.id);

        const page = await SessionArbitrationService.listDisputedSessionRows({}, 25, 0, tx);

        // The queue read is a live scope over the shared table — other
        // committed disputed rows may coexist; the assertions pin THIS
        // test's rows exactly and keep the tail honest-relative.
        expect(page.totalCount).toBeGreaterThanOrEqual(2);
        expect(page.page).toBe(1);
        expect(page.pageSize).toBe(25);
        const mine = page.items.filter(row => row.session.id === firstRow.id || row.session.id === secondRow.id);
        expect(mine).toHaveLength(2);
        const ids = mine.map(row => row.session.id).toSorted((a, b) => a - b);
        expect(ids).toEqual([firstRow.id, secondRow.id].toSorted((a, b) => a - b));
        for (const row of mine) {
          const isFirst = row.session.id === firstRow.id;
          expect(row.studentName).toBe((isFirst ? first : second).studentUser.fullName);
          expect(row.teacherName).toBe((isFirst ? first : second).teacherUser.fullName);
        }
      });
    }
  );
});

describe("SessionArbitrationService — the dispute analytics snapshot", () => {
  testOnRealPostgres(
    "getDisputeAnalytics aggregates the honest counts relative to the pre-read baseline (open, resolved, per-outcome)",
    async () => {
      await runInRollback(async tx => {
        const admin = await createTestUser(tx, { role: "admin" });
        const actors = await createArbitrationActors(tx);

        // The analytics read is a live scope over the shared table — other
        // committed rows may coexist; every assertion is RELATIVE to the
        // baseline taken before this test seeds its own rows.
        const baseline = await SessionArbitrationService.getDisputeAnalytics(admin.id, "en", tx);

        // Two consumed rows: one stays disputed (open), one is arbitrated
        // PartialRefund through the REAL flow (funded wallet for the debit).
        const openRow = await insertArbitrationSessionRow(tx, actors);
        const resolvedRow = await insertArbitrationSessionRow(tx, actors);
        await disputeConsumedRow(tx, actors, openRow.id);
        await disputeConsumedRow(tx, actors, resolvedRow.id);
        await fundTeacherWallet(tx, actors.teacherUserId, "50.00");
        await SessionArbitrationService.arbitrateDispute(
          admin.id,
          resolvedRow.id,
          DisputeResolution.PartialRefund,
          null,
          "5.00",
          "en",
          tx
        );

        const after = await SessionArbitrationService.getDisputeAnalytics(admin.id, "en", tx);

        expect(after.openDisputes).toBe(baseline.openDisputes + 1);
        expect(after.resolvedDisputes).toBe(baseline.resolvedDisputes + 1);
        expect(after.partialRefundCount).toBe(baseline.partialRefundCount + 1);
        // The other outcome buckets are untouched by this scenario.
        expect(after.cancelCount).toBe(baseline.cancelCount);
        expect(after.completeCount).toBe(baseline.completeCount);
        expect(after.refundCount).toBe(baseline.refundCount);
        expect(after.upholdCount).toBe(baseline.upholdCount);
      });
    }
  );

  testOnRealPostgres(
    "getDisputeAnalytics denies a student caller through the governance re-assertion (read-only, but still admin-gated)",
    async () => {
      await runInRollback(async tx => {
        const student = await createTestUser(tx, { role: "student" });

        const error = await expectRepoError(() => SessionArbitrationService.getDisputeAnalytics(student.id, "en", tx));
        expectDomainDenial(error, "FORBIDDEN", t().forbidden);
      });
    }
  );

  testOnRealPostgres(
    "getDisputeAnalytics denies a governance-blocked admin the same way (fail-closed identity)",
    async () => {
      await runInRollback(async tx => {
        const blockedAdmin = await createTestUser(tx, { role: "admin", isBlocked: true });

        const error = await expectRepoError(() =>
          SessionArbitrationService.getDisputeAnalytics(blockedAdmin.id, "en", tx)
        );
        expectDomainDenial(error, "FORBIDDEN", t().forbidden);
      });
    }
  );
});
