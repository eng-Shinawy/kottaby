/**
 * SessionDisputeNotificationService tests — the consumed-generation dispute
 * waves (`notifyAdminsOfDisputeOpened`, `notifyParticipantsOfDisputeResolved`)
 * against the live PostgreSQL instance, following the DB-backed service-test
 * rules the sibling session suites apply:
 *  - every case runs inside `runInRollback` and the wave's REQUIRED `tx` is
 *    the rollback transaction itself, so the persisted receipts share the
 *    test transaction's fate exactly as they share the arbitration flow's;
 *  - the realtime boundary is SPIED, never touched: `publishReceipts` is a
 *    recording no-op (the wave service must NEVER publish) and
 *    `emitForUsers` is a recording call-through (it captures the engine
 *    envelope — the claim key, the recipient cohort, the handed locale, and
 *    the caller transaction — while the real engine writes the rows);
 *  - entities are created ONLY via `entity-setup.ts` helpers plus the
 *    file-local session fixtures — never seed data;
 *  - NO `expect(...).rejects.toThrow()` — every denial goes through
 *    `expectRepoError` (try/catch); denials are asserted through the
 *    `DomainError.code` contract plus the exact translated message;
 *  - recipient assertions are RELATIVE (per-recipient deltas and
 *    containment) because the admin cohort resolves from the whole governed
 *    user base, which pre-existing committed rows may populate.
 *
 * Coverage map:
 *  - Tier 1 (branch/statement): the opened wave resolves the whole
 *    governance-clean admin cohort server-side and persists one row per
 *    admin on the caller's transaction (engine envelope captured: claim
 *    key, related-entity pointer, tx identity); the resolved wave emits
 *    exactly one row to each of the two participants and carries the
 *    arbitration outcome in the stored copy for all three outcomes; the
 *    empty-cohort branch returns empty receipts with zero engine calls.
 *  - Tier 2 (boundary): the deterministic claim keys (session id + wave
 *    kind ONLY, identical across a retried wave, distinct per wave kind);
 *    locale variance (two persisted locales → two cohorts, two receipts,
 *    per-recipient copy, per-cohort engine locale); the platform-default
 *    fallback for rows without a persisted locale; shared-locale batching
 *    (one receipt for a same-locale cohort — one post-commit dispatch when
 *    the caller publishes); malformed target ids denied pre-DB with zero
 *    engine calls; a duplicated participant cohort fails closed at the
 *    engine's batch contract.
 *  - Tier 3 (transaction-fate, through the owning arbitration flow): the
 *    held-generation denials never reach the seam (a held `completed` row
 *    denied at the open classification, a held `disputed` row denied at
 *    the arbitration classification — zero notification rows, zero
 *    publishes); the consumed generation emits in-tx through the REAL
 *    open/arbitrate flows while the publish stays with the transaction
 *    owner (the outer-tx path never publishes).
 *  - Tier 4 (recipient scoping): the admin cohort never leaks across roles
 *    (teacher/student/parent users gain nothing) and never includes
 *    governed admins (blocked or deleted rows are excluded by the audience
 *    resolution); the resolved wave's explicit participant pair never
 *    widens beyond the two persisted participants.
 */

import { describe, expect, spyOn, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import { BroadcastAudienceRepository } from "@/backend/db/repo";
import { session } from "@/backend/db/schema/classes/session";
import { notifications } from "@/backend/db/schema/notifications";
import { createTestStudent, createTestTeacherRow, createTestUser } from "@/backend/db/test/entity-setup";
import { expectRepoError, runInRollback } from "@/backend/db/test/test-utils";
import { NotificationType } from "@/backend/enum/notifications/notification-type.enum";
import { DisputeResolution } from "@/backend/enum/scheduling/dispute-resolution.enum";
import { HeldBalanceLane } from "@/backend/enum/scheduling/held-balance-lane.enum";
import { SessionIntent } from "@/backend/enum/scheduling/session-intent.enum";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import { DomainError, ValidationError } from "@/backend/lib/errors";
import { SessionArbitrationService } from "@/backend/services/classes/session-arbitration.service";
import { SessionDisputeNotificationService } from "@/backend/services/classes/session-dispute-notification.service";
import { NotificationEngine } from "@/backend/services/notifications";
import type {
  DBTransaction,
  NotificationDeliveryReceipt,
  NotificationEmitBatchInput,
  NotificationReturnType,
  SessionInsertType,
  SessionSelectType,
} from "@/backend/types";
import { defaultLocale } from "@/shared/locale/AppLocale";
import { getServerTranslations } from "@/shared/locale/server-graphql";

/** The errors-namespace translations for the default test locale. */
function t() {
  return getServerTranslations("en").errorsTranslations;
}

/** English notifications copy — the expected stored copy for en-locale recipients. */
const NOTIFS_EN = getServerTranslations("en").notificationsTranslations;
/** Arabic notifications copy — the expected stored copy for ar-locale recipients. */
const NOTIFS_AR = getServerTranslations("ar").notificationsTranslations;

// ─── Spies (the realtime boundary — never real channels) ─────────────────

/** One recorded `emitForUsers` call: the engine envelope plus the handed transaction. */
interface RecordedEmit {
  readonly input: NotificationEmitBatchInput;
  readonly locale: string;
  readonly tx: DBTransaction | undefined;
}

/**
 * Records every `emitForUsers` call (envelope + locale + tx) and delegates
 * to the REAL engine, so the assertions observe the exact engine contract
 * the wave service hands over while the rows still persist on the caller's
 * transaction.
 */
function recordEmitForUsers(): { calls: RecordedEmit[]; stop: () => void } {
  const calls: RecordedEmit[] = [];
  const realEmit = NotificationEngine.emitForUsers;
  const spy = spyOn(NotificationEngine, "emitForUsers").mockImplementation(async (input, locale, tx) => {
    calls.push({ input, locale, tx });
    return realEmit(input, locale, tx);
  });
  return { calls, stop: () => spy.mockRestore() };
}

/**
 * Installs a recording no-op over the engine's publish contract: the wave
 * service (and, on the outer-tx path, the arbitration flow) must NEVER
 * publish — every recorded call here is a contract breach. Callers MUST
 * `stop()` (use try/finally).
 */
function recordPublishes(): { calls: NotificationDeliveryReceipt[][]; stop: () => void } {
  const calls: NotificationDeliveryReceipt[][] = [];
  const spy = spyOn(NotificationEngine, "publishReceipts").mockImplementation(async receipts => {
    calls.push([...receipts]);
  });
  return { calls, stop: () => spy.mockRestore() };
}

// ─── Read-back oracles + shared expectations ─────────────────────────────

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

/** Every notification row keyed to one session (the wave's related-entity scope). */
async function readSessionNotifications(tx: DBTransaction, sessionId: number) {
  return tx.select().from(notifications).where(eq(notifications.relatedEntityId, sessionId));
}

/** One recipient's wave rows for one session and wave kind. */
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

/** First row of a receipt — throws when the receipt is unexpectedly empty. */
function firstReceiptRow(receipt: NotificationDeliveryReceipt): NotificationReturnType {
  const row = receipt.notifications.at(0);
  if (!row) {
    throw new Error("expected the receipt to carry at least one notification row");
  }
  return row;
}

/**
 * Sequential await-walker over data-driven fixtures — the recursive-helper
 * shape the shipped sweepers use for the no-await-in-loop discipline (each
 * await yields and unwinds the stack; the cases stay strictly ordered).
 */
async function assertSequentially<T>(items: readonly T[], run: (item: T) => Promise<void>, index = 0): Promise<void> {
  const item = items.at(index);
  if (item === undefined) {
    return;
  }
  await run(item);
  await assertSequentially(items, run, index + 1);
}

// ─── File-local fixtures ─────────────────────────────────────────────────

/** Shared-PK ids for one session pair (session.teacher_id / session.student_id). */
interface DisputeCast {
  teacherUserId: number;
  studentUserId: number;
}

/** Creates one teacher + one student pair with the shared-PK role-child rows. */
async function createDisputeCast(tx: DBTransaction): Promise<DisputeCast> {
  const teacherUser = await createTestUser(tx, { role: "teacher" });
  await createTestTeacherRow(tx, teacherUser.id);
  const studentUser = await createTestUser(tx, { role: "student" });
  await createTestStudent(tx, studentUser.id);
  return { teacherUserId: teacherUser.id, studentUserId: studentUser.id };
}

/**
 * Direct session-row insert for test preconditions (full column control).
 * The default shape is a DUAL-CONFIRMED, ESCROW-CONSUMED row — the exact
 * precondition the post-confirmation dispute path requires; every test
 * narrows from there.
 */
async function insertDisputeSessionRow(
  tx: DBTransaction,
  cast: DisputeCast,
  overrides: Partial<SessionInsertType> = {}
): Promise<SessionSelectType> {
  const now = new Date();
  const [row] = await tx
    .insert(session)
    .values({
      teacherId: cast.teacherUserId,
      studentId: cast.studentUserId,
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
    throw new Error("insertDisputeSessionRow: insert returned no rows");
  }
  return row;
}

/**
 * Moves a consumed completed row into `disputed` through the REAL open
 * flow (which now emits the admin opened wave on the same transaction).
 */
async function disputeConsumedRow(tx: DBTransaction, cast: DisputeCast, sessionId: number): Promise<void> {
  await SessionArbitrationService.openPostConfirmationDispute(
    cast.studentUserId,
    sessionId,
    "the lesson never happened as described",
    "en",
    tx
  );
}

// ─── Tier 1/2/4: the opened wave (admin cohort) ──────────────────────────

describe("SessionDisputeNotificationService — notifyAdminsOfDisputeOpened", () => {
  test("resolves the whole governance-clean admin cohort server-side and persists one row per admin on the caller's transaction", async () => {
    await runInRollback(async tx => {
      const publish = recordPublishes();
      const emit = recordEmitForUsers();
      try {
        const cast = await createDisputeCast(tx);
        const row = await insertDisputeSessionRow(tx, cast);
        const admins = [
          await createTestUser(tx, { role: "admin" }),
          await createTestUser(tx, { role: "admin" }),
          await createTestUser(tx, { role: "admin" }),
        ];

        const receipts = await SessionDisputeNotificationService.notifyAdminsOfDisputeOpened(
          row.id,
          cast.studentUserId,
          "en",
          tx
        );

        // ONE engine batch for the single default-locale cohort, riding the
        // wave's required transaction.
        expect(receipts).toHaveLength(1);
        expect(emit.calls).toHaveLength(1);
        const emitted = emit.calls[0];
        expect(emitted?.tx).toBe(tx);
        expect(emitted?.input.type).toBe(NotificationType.SessionDisputeOpened);
        expect(emitted?.input.relatedEntityType).toBe("session");
        expect(emitted?.input.relatedEntityId).toBe(row.id);

        // The receipt carries the resolved admin cohort verbatim...
        const receipt = receipts[0];
        if (!receipt) {
          throw new Error("expected the opened wave to return one receipt");
        }
        for (const admin of admins) {
          expect(receipt.recipientUserIds).toContain(admin.id);
        }

        // ...and every admin's row PERSISTED on the caller's transaction
        // (per-fixture deltas — the cohort resolves from the whole governed
        // user base, so the absolute size is never pinned).
        await assertSequentially(admins, async admin => {
          expect(await countWaveRows(tx, admin.id, row.id, NotificationType.SessionDisputeOpened)).toBe(1);
        });
        const persisted = await readSessionNotifications(tx, row.id);
        expect(persisted.length).toBeGreaterThanOrEqual(admins.length);
        for (const persistedRow of persisted) {
          expect(persistedRow.title).toBe(NOTIFS_AR.eventSessionDisputeOpenedTitle);
        }

        // The publish contract stays untouched — the wave service NEVER publishes.
        expect(publish.calls).toHaveLength(0);
      } finally {
        emit.stop();
        publish.stop();
      }
    });
  });

  test("keeps the claim keys deterministic — session id and wave kind only, identical across a retried wave", async () => {
    await runInRollback(async tx => {
      const emit = recordEmitForUsers();
      try {
        const cast = await createDisputeCast(tx);
        const row = await insertDisputeSessionRow(tx, cast);
        const admin = await createTestUser(tx, { role: "admin" });

        await SessionDisputeNotificationService.notifyAdminsOfDisputeOpened(row.id, cast.studentUserId, "en", tx);
        // The retry (double-submit loser re-firing its wave) derives the SAME key.
        await SessionDisputeNotificationService.notifyAdminsOfDisputeOpened(row.id, cast.studentUserId, "en", tx);
        await SessionDisputeNotificationService.notifyParticipantsOfDisputeResolved(
          row.id,
          cast.studentUserId,
          cast.teacherUserId,
          DisputeResolution.Uphold,
          "en",
          tx
        );

        expect(emit.calls).toHaveLength(3);
        const openedKeys = emit.calls.slice(0, 2).map(call => call.input.idempotencyKey);
        expect(openedKeys[0]).toBe(`session:${row.id}:dispute-opened`);
        expect(openedKeys[1]).toBe(openedKeys[0]);
        expect(emit.calls[2]?.input.idempotencyKey).toBe(`session:${row.id}:dispute-resolved`);
        // The key shape never folds the cohort, locale, or opener — the
        // engine's claim recipe does that; the raw key stays reproducible.
        expect(openedKeys[0]).toMatch(/^session:\d+:dispute-opened$/);
        // Both opened emissions claimed the SAME cohort (the fixture admin
        // rides it), so a cache-backed replay resolves the prior receipt
        // instead of minting a second wave.
        expect(emit.calls[0]?.input.userIds).toContain(admin.id);
        expect(emit.calls[1]?.input.userIds).toEqual(emit.calls[0]?.input.userIds);
      } finally {
        emit.stop();
      }
    });
  });

  test("an empty admin audience is an honest empty receipt list — zero engine calls, no crash", async () => {
    await runInRollback(async tx => {
      const publish = recordPublishes();
      const emit = recordEmitForUsers();
      const audience = spyOn(BroadcastAudienceRepository, "resolveAudienceIds").mockImplementation(async () => []);
      try {
        const cast = await createDisputeCast(tx);
        const row = await insertDisputeSessionRow(tx, cast);

        const receipts = await SessionDisputeNotificationService.notifyAdminsOfDisputeOpened(
          row.id,
          cast.studentUserId,
          "en",
          tx
        );

        expect(receipts).toHaveLength(0);
        expect(emit.calls).toHaveLength(0);
        expect(await readSessionNotifications(tx, row.id)).toHaveLength(0);
        expect(publish.calls).toHaveLength(0);
      } finally {
        audience.mockRestore();
        emit.stop();
        publish.stop();
      }
    });
  });

  test("excludes governed admins — blocked and deleted admin rows never join the cohort", async () => {
    await runInRollback(async tx => {
      const cast = await createDisputeCast(tx);
      const row = await insertDisputeSessionRow(tx, cast);
      const clean = await createTestUser(tx, { role: "admin" });
      await createTestUser(tx, { role: "admin", isBlocked: true });
      await createTestUser(tx, { role: "admin", isDeleted: true });

      const receipts = await SessionDisputeNotificationService.notifyAdminsOfDisputeOpened(
        row.id,
        cast.studentUserId,
        "en",
        tx
      );

      const receipt = receipts.at(0);
      if (!receipt) {
        throw new Error("expected the opened wave to reach the governance-clean admin");
      }
      expect(receipt.recipientUserIds).toContain(clean.id);
      expect(await countWaveRows(tx, clean.id, row.id, NotificationType.SessionDisputeOpened)).toBe(1);
    });
  });

  test("denies malformed target ids pre-DB with zero engine calls", async () => {
    await runInRollback(async tx => {
      const emit = recordEmitForUsers();
      try {
        const cast = await createDisputeCast(tx);
        const row = await insertDisputeSessionRow(tx, cast);

        const badSession = await expectRepoError(() =>
          SessionDisputeNotificationService.notifyAdminsOfDisputeOpened(0, cast.studentUserId, "en", tx)
        );
        expectDomainDenial(badSession, "VALIDATION", t().validation);

        const badOpener = await expectRepoError(() =>
          SessionDisputeNotificationService.notifyAdminsOfDisputeOpened(row.id, -5, "en", tx)
        );
        expectDomainDenial(badOpener, "VALIDATION", t().validation);

        expect(emit.calls).toHaveLength(0);
        expect(await readSessionNotifications(tx, row.id)).toHaveLength(0);
      } finally {
        emit.stop();
      }
    });
  });
});

// ─── Tier 1/2/4: the resolved wave (both participants) ───────────────────

describe("SessionDisputeNotificationService — notifyParticipantsOfDisputeResolved", () => {
  test("emits exactly one row to each of the two participants and never to anyone else", async () => {
    await runInRollback(async tx => {
      const publish = recordPublishes();
      try {
        const cast = await createDisputeCast(tx);
        const row = await insertDisputeSessionRow(tx, cast);
        const outsider = await createTestUser(tx, { role: "student" });
        const admin = await createTestUser(tx, { role: "admin" });

        const receipts = await SessionDisputeNotificationService.notifyParticipantsOfDisputeResolved(
          row.id,
          cast.studentUserId,
          cast.teacherUserId,
          DisputeResolution.Refund,
          "en",
          tx
        );

        // Both participants share the (missing) persisted locale → one
        // default-locale cohort → ONE receipt covering exactly the pair.
        expect(receipts).toHaveLength(1);
        const receipt = receipts[0];
        if (!receipt) {
          throw new Error("expected the resolved wave to return one receipt");
        }
        expect(receipt.recipientUserIds).toEqual([cast.studentUserId, cast.teacherUserId]);
        expect(receipt.notifications).toHaveLength(2);
        expect(await countWaveRows(tx, cast.studentUserId, row.id, NotificationType.SessionDisputeResolved)).toBe(1);
        expect(await countWaveRows(tx, cast.teacherUserId, row.id, NotificationType.SessionDisputeResolved)).toBe(1);
        expect(await countWaveRows(tx, outsider.id, row.id, NotificationType.SessionDisputeResolved)).toBe(0);
        expect(await countWaveRows(tx, admin.id, row.id, NotificationType.SessionDisputeResolved)).toBe(0);
        expect(publish.calls).toHaveLength(0);
      } finally {
        publish.stop();
      }
    });
  });

  test("carries the arbitration outcome in the stored copy for all three outcomes", async () => {
    await runInRollback(async tx => {
      const cast = await createDisputeCast(tx);
      const student = await createTestUser(tx, { role: "student", locale: "en" });
      const teacherUser = await createTestUser(tx, { role: "teacher", locale: "en" });

      const outcomeBodies = [
        [DisputeResolution.Refund, NOTIFS_EN.eventSessionDisputeResolvedRefundBody],
        [DisputeResolution.PartialRefund, NOTIFS_EN.eventSessionDisputeResolvedPartialRefundBody],
        [DisputeResolution.Uphold, NOTIFS_EN.eventSessionDisputeResolvedUpholdBody],
      ] as const;

      await assertSequentially(outcomeBodies, async ([resolution, expectedBody]) => {
        const row = await insertDisputeSessionRow(tx, cast);
        const receipts = await SessionDisputeNotificationService.notifyParticipantsOfDisputeResolved(
          row.id,
          student.id,
          teacherUser.id,
          resolution,
          "en",
          tx
        );
        const receipt = receipts.at(0);
        if (!receipt) {
          throw new Error(`expected the resolved wave to return one receipt for ${resolution}`);
        }
        expect(receipt.notifications).toHaveLength(2);
        for (const persistedRow of receipt.notifications) {
          expect(persistedRow.title).toBe(NOTIFS_EN.eventSessionDisputeResolvedTitle);
          expect(persistedRow.body).toBe(expectedBody);
        }
        const stored = await readSessionNotifications(tx, row.id);
        expect(stored).toHaveLength(2);
        expect(stored.every(persistedRow => persistedRow.body === expectedBody)).toBe(true);
      });
    });
  });

  test("composes per-recipient copy: two persisted locales produce two cohorts in recipient order", async () => {
    await runInRollback(async tx => {
      const emit = recordEmitForUsers();
      try {
        const cast = await createDisputeCast(tx);
        const row = await insertDisputeSessionRow(tx, cast);
        const arabicStudent = await createTestUser(tx, { role: "student", locale: "ar" });
        const englishTeacher = await createTestUser(tx, { role: "teacher", locale: "en" });

        const receipts = await SessionDisputeNotificationService.notifyParticipantsOfDisputeResolved(
          row.id,
          arabicStudent.id,
          englishTeacher.id,
          DisputeResolution.PartialRefund,
          "en",
          tx
        );

        expect(receipts).toHaveLength(2);
        expect(emit.calls).toHaveLength(2);

        const studentReceipt = receipts.at(0);
        const teacherReceipt = receipts.at(1);
        if (!studentReceipt || !teacherReceipt) {
          throw new Error("expected one receipt per locale cohort, student cohort first");
        }
        expect(emit.calls[0]?.locale).toBe("ar");
        expect(emit.calls[1]?.locale).toBe("en");
        expect(studentReceipt.recipientUserIds).toEqual([arabicStudent.id]);
        expect(teacherReceipt.recipientUserIds).toEqual([englishTeacher.id]);
        expect(firstReceiptRow(studentReceipt).title).toBe(NOTIFS_AR.eventSessionDisputeResolvedTitle);
        expect(firstReceiptRow(studentReceipt).body).toBe(NOTIFS_AR.eventSessionDisputeResolvedPartialRefundBody);
        expect(firstReceiptRow(teacherReceipt).title).toBe(NOTIFS_EN.eventSessionDisputeResolvedTitle);
        expect(firstReceiptRow(teacherReceipt).body).toBe(NOTIFS_EN.eventSessionDisputeResolvedPartialRefundBody);
      } finally {
        emit.stop();
      }
    });
  });

  test("falls back to the platform default locale when the recipient rows carry none", async () => {
    await runInRollback(async tx => {
      const emit = recordEmitForUsers();
      try {
        const cast = await createDisputeCast(tx);
        const row = await insertDisputeSessionRow(tx, cast);

        const receipts = await SessionDisputeNotificationService.notifyParticipantsOfDisputeResolved(
          row.id,
          cast.studentUserId,
          cast.teacherUserId,
          DisputeResolution.Uphold,
          "en",
          tx
        );

        expect(receipts).toHaveLength(1);
        expect(emit.calls[0]?.locale).toBe(defaultLocale);
        const receipt = receipts[0];
        if (!receipt) {
          throw new Error("expected the resolved wave to return one receipt");
        }
        for (const persistedRow of receipt.notifications) {
          expect(persistedRow.title).toBe(NOTIFS_AR.eventSessionDisputeResolvedTitle);
          expect(persistedRow.body).toBe(NOTIFS_AR.eventSessionDisputeResolvedUpholdBody);
        }
      } finally {
        emit.stop();
      }
    });
  });

  test("a duplicated participant cohort fails closed at the engine's batch contract", async () => {
    await runInRollback(async tx => {
      const emit = recordEmitForUsers();
      try {
        const cast = await createDisputeCast(tx);
        const row = await insertDisputeSessionRow(tx, cast);

        // A corrupted row that names the same user as both participants —
        // the batch contract denies the duplicate cohort member.
        const denied = await expectRepoError(() =>
          SessionDisputeNotificationService.notifyParticipantsOfDisputeResolved(
            row.id,
            cast.studentUserId,
            cast.studentUserId,
            DisputeResolution.Refund,
            "en",
            tx
          )
        );
        expect(denied).toBeInstanceOf(ValidationError);
        // The corrupted-cohort emission never persisted a half-wave.
        expect(await readSessionNotifications(tx, row.id)).toHaveLength(0);
      } finally {
        emit.stop();
      }
    });
  });
});

// ─── Tier 3/4: the wired arbitration flows (held generation stays silent) ──

describe("SessionArbitrationService — the wired dispute waves", () => {
  test("a held completed row is denied at the open classification BEFORE the seam: zero emissions, zero publishes", async () => {
    await runInRollback(async tx => {
      const publish = recordPublishes();
      try {
        const cast = await createDisputeCast(tx);
        const held = await insertDisputeSessionRow(tx, cast, { feeHeld: true });

        const denied = await expectRepoError(() =>
          SessionArbitrationService.openPostConfirmationDispute(cast.studentUserId, held.id, "held row", "en", tx)
        );
        expectDomainDenial(denied, "SESSION_INVALID_TRANSITION", t().sessionInvalidTransition);

        expect(await readSessionNotifications(tx, held.id)).toHaveLength(0);
        expect(publish.calls).toHaveLength(0);
      } finally {
        publish.stop();
      }
    });
  });

  test("a held disputed row is denied at the arbitration classification: zero emissions, zero publishes", async () => {
    await runInRollback(async tx => {
      const publish = recordPublishes();
      try {
        const cast = await createDisputeCast(tx);
        const now = new Date();
        const held = await insertDisputeSessionRow(tx, cast, {
          status: SessionStatus.Disputed,
          disputeReason: "held dispute",
          disputedAt: now,
          feeHeld: true,
        });
        const admin = await createTestUser(tx, { role: "admin" });

        const denied = await expectRepoError(() =>
          SessionArbitrationService.arbitrateDispute(admin.id, held.id, DisputeResolution.Refund, null, null, "en", tx)
        );
        expectDomainDenial(denied, "VALIDATION", t().disputeResolutionMismatch);

        expect(await readSessionNotifications(tx, held.id)).toHaveLength(0);
        expect(publish.calls).toHaveLength(0);
      } finally {
        publish.stop();
      }
    });
  });

  test("the consumed generation emits through the real flows while the publish stays the transaction owner's", async () => {
    await runInRollback(async tx => {
      const publish = recordPublishes();
      try {
        const cast = await createDisputeCast(tx);
        const admin = await createTestUser(tx, { role: "admin" });
        const row = await insertDisputeSessionRow(tx, cast);

        await disputeConsumedRow(tx, cast, row.id);
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

        // The opened wave reached the admin exactly once; the resolved wave
        // reached exactly the two participants; nobody else gained rows.
        expect(await countWaveRows(tx, admin.id, row.id, NotificationType.SessionDisputeOpened)).toBe(1);
        expect(await countWaveRows(tx, admin.id, row.id, NotificationType.SessionDisputeResolved)).toBe(0);
        expect(await countWaveRows(tx, cast.studentUserId, row.id, NotificationType.SessionDisputeResolved)).toBe(1);
        expect(await countWaveRows(tx, cast.teacherUserId, row.id, NotificationType.SessionDisputeResolved)).toBe(1);

        // The caller-transaction path defers the publish to its caller —
        // zero dispatches through the whole wired flow.
        expect(publish.calls).toHaveLength(0);
      } finally {
        publish.stop();
      }
    });
  });
});
