/**
 * Journey — dual-confirmation completion handshake (cross-actor session
 * workflow).
 *
 * The confirm-and-pay arc and the timeout-and-refund arc, executed
 * SEQUENTIALLY through the real `SessionLifecycleService` (production
 * transaction path — no outer tx) on the real test database, with every
 * step attributed to a different real actor from one committed fixture
 * cast (real `users.role` values + real role-child rows; authorization and
 * ownership resolve through the same row-side predicates production uses —
 * never monkey-patched):
 *
 *   1. confirm-and-pay — teacher completes a started session (the student
 *      receives exactly one confirm prompt), the student confirms (both
 *      stamps, escrow released, the teacher's wallet credited exactly the
 *      session fee once), and every repeat/foreign attempt is a zero-write
 *      no-op or an oracle-safe denial.
 *   2. timeout-and-refund — a completed session whose teacher stamp is
 *      older than the confirmation window (fabricated as a committed
 *      fixture write: the system leg's precondition is unreachable through
 *      participant flows without waiting out the window, and no product
 *      guard is bypassed — the sweep itself runs unmodified) is cancelled
 *      by the real service sweeper, the held unit returns to the provenance
 *      lane exactly once, the student receives exactly one auto-cancel
 *      notice, and a re-sweep matches zero rows.
 *   3. confirm-vs-sweep race — both flows dispatched concurrently through
 *      `Promise.allSettled` over one expired completion: the escrow unit is
 *      either consumed by the confirmation (credit once, no refund) or
 *      released by the sweep (refund once, no credit) — never both, never
 *      neither.
 *
 * Layer contract (`test/workflows/AGENTS.md` + `docs/testing/workflow-journey-tests.md`):
 *  - NO `runInRollback` — fixtures commit in `beforeAll`; every row
 *    (fixtures AND service-created sessions/claims) is registered in a
 *    `SessionFixtureRegistry` and hard-deleted FK-safely in `afterAll`.
 *  - Per-run `jrn_sessions_<8hex>` prefix on user labels and idempotency
 *    keys — repeated or parallel runs never collide.
 *  - The notification publication boundary is SPIED (recording no-op over
 *    the engine's publish contract) — no realtime channel is ever touched;
 *    each dispatch is asserted together with the recipient ids it targeted.
 *  - The teacher's earning ledger row (`teacher_transaction`) is a REAL
 *    financial side effect of the confirm journey: it is asserted (exactly
 *    once, fee verbatim) and removed in `afterAll` under the sanctioned
 *    append-only trigger suspension — teardown must still leave zero
 *    residue.
 *  - Negative steps fail through the REAL service denials, asserted by
 *    `DomainError.code` + the exact translated message (try/catch helper —
 *    never `expect(...).rejects.toThrow()`).
 *
 * Run:
 *   bun run test/scripts/run-test.ts test/workflows/sessions/session-dual-confirmation.journey.test.ts
 *   bun run test/scripts/run-test.ts test/workflows
 */

import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import { db } from "@/backend/db";
import { teacherTransaction } from "@/backend/db/schema/billing/teacher-transaction";
import { wallet } from "@/backend/db/schema/billing/wallet";
import { session } from "@/backend/db/schema/classes/session";
import { sessionRequestIdempotency } from "@/backend/db/schema/classes/session-request-idempotency";
import { notifications } from "@/backend/db/schema/notifications/notifications";
import { students } from "@/backend/db/schema/students/students";
import { TransactionType } from "@/backend/enum/billing/transaction-type.enum";
import { NotificationType } from "@/backend/enum/notifications/notification-type.enum";
import { HeldBalanceLane } from "@/backend/enum/scheduling/held-balance-lane.enum";
import { SessionIntent } from "@/backend/enum/scheduling/session-intent.enum";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import { ConflictError, DomainError } from "@/backend/lib/errors";
import { SessionLifecycleService } from "@/backend/services/classes/session-lifecycle.service";
import { NotificationEngine } from "@/backend/services/notifications";
import type {
  NotificationDeliveryReceipt,
  SessionReturnType,
  SessionSubmitInput,
  TeacherTransactionSelectType,
  WalletSelectType,
} from "@/backend/types";
import { SESSION_CONFIRMATION_WINDOW_MS, SESSION_FEE_HIFZ } from "@/shared/constants/session-fees.constants";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import { withImmutabilityTriggersSuspended } from "@/test/helpers/db-cleanup";
import {
  buildSessionJourneyCast,
  countNotificationsForUser,
  createSessionFixtureRegistry,
  journeyPrefix,
  type SessionJourneyCast,
  secondPrecisionMs,
} from "@/test/workflows/helpers";

/**
 * The journey runs on the default test locale throughout.
 */
const LOCALE = "en";

/**
 * Idempotency keys for the three bookings (confirm-and-pay, timeout-and-
 * refund, race) — per-run unique via the journey prefix, carried verbatim
 * into the service (never trimmed, never coerced).
 */
const JOURNEY_PREFIX = journeyPrefix("sessions");
const KEY_A = `${JOURNEY_PREFIX}-studentA-confirm-pay`;
const KEY_B = `${JOURNEY_PREFIX}-studentB-timeout`;
const KEY_R = `${JOURNEY_PREFIX}-studentB-race`;

/** The fixture registry — the hard-delete worklist drained by `afterAll`. */
const registry = createSessionFixtureRegistry();

/** The committed actor cast (assigned once by `beforeAll`). */
let cast: SessionJourneyCast;

/** Session A — booked by Student A (the confirm-and-pay leg). */
let sessionA: SessionReturnType;

/** Session B — booked by Student B, then fabricated expired (the timeout leg). */
let sessionB: SessionReturnType;

/** Session R — booked by Student B, then fabricated expired (the race leg). */
let sessionRace: SessionReturnType;

/** The exact translated denial messages for the default test locale. */
function errorTexts() {
  return getServerTranslations(LOCALE).errorsTranslations;
}

/** Type-guard read of a caught rejection's `extensions.code`. */
function denialCode(error: unknown): string {
  return error instanceof DomainError ? error.code : "";
}

/**
 * Runs a denial through the real service and asserts the typed-denial
 * contract: a `DomainError` carrying EXACTLY `code` and EXACTLY the
 * translated message (never the raw key). Returns the caught error so a
 * call site can assert the concrete subclass (e.g. `ConflictError`).
 * Fails the test when the action resolves instead of rejecting.
 */
async function expectServiceDenial(code: string, message: string, action: () => Promise<unknown>): Promise<unknown> {
  let caught: unknown;
  try {
    await action();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(DomainError);
  expect(denialCode(caught)).toBe(code);
  if (caught instanceof Error) {
    expect(caught.message).toBe(message);
  }
  return caught;
}

/** Narrows a nullable timestamp, failing loudly when null. */
function requiredDate(value: Date | null, label: string): Date {
  if (value === null) {
    throw new Error(`journey: expected non-null ${label}`);
  }
  return value;
}

/** Narrows a nullable wallet read to a row, failing loudly when null. */
function requiredWalletRow(value: WalletSelectType | null, label: string): WalletSelectType {
  if (value === null) {
    throw new Error(`journey: expected a wallet row for ${label}`);
  }
  return value;
}

/**
 * A teacher stamp one hour past the confirmation window — unambiguously
 * expired at the stored resolution, at any capture instant. Built through
 * the shared `secondPrecisionMs` floor so the written value and every
 * later read-back of it agree exactly.
 */
function expiredTeacherStamp(): Date {
  return new Date(secondPrecisionMs(Date.now() - SESSION_CONFIRMATION_WINDOW_MS - 60 * 60_000));
}

/** Reads the session row straight off the table (read-back oracle). */
async function readSessionRow(id: number): Promise<SessionReturnType> {
  const rows = await db.select().from(session).where(eq(session.id, id)).limit(1);
  const row = rows[0];
  if (!row) {
    throw new Error(`journey: session row ${String(id)} vanished (fixture integrity failure)`);
  }
  return row;
}

/** Reads the student's escrow-lane balances straight from the row. */
async function readStudentLanes(studentId: number): Promise<{
  trial: number;
  hifz: number | null;
  tajweed: number | null;
}> {
  const rows = await db
    .select({
      trial: students.balanceTrial,
      hifz: students.balanceHifz,
      tajweed: students.balanceTajweed,
    })
    .from(students)
    .where(eq(students.id, studentId));
  const row = rows[0];
  if (!row) {
    throw new Error(`journey: students row ${String(studentId)} vanished (fixture integrity failure)`);
  }
  return row;
}

/** Reads the teacher's wallet row, or `null` before the first credit. */
async function readTeacherWalletRow(teacherUserId: number): Promise<WalletSelectType | null> {
  const rows = await db.select().from(wallet).where(eq(wallet.teacherId, teacherUserId)).limit(1);
  return rows[0] ?? null;
}

/** Numeric wallet total (a missing wallet counts as zero). */
function walletTotal(value: WalletSelectType | null): number {
  return Number(value?.totalEarning ?? "0");
}

/** Numeric wallet balance (a missing wallet counts as zero). */
function walletBalance(value: WalletSelectType | null): number {
  return Number(value?.balance ?? "0");
}

/** The earning-ledger rows tied to one session (exactly-once oracle). */
async function readLedgerRowsForSession(sessionId: number): Promise<TeacherTransactionSelectType[]> {
  return db.select().from(teacherTransaction).where(eq(teacherTransaction.sessionId, sessionId));
}

/** Completion-wave notification rows pinned to one session id (row oracle). */
async function countCompletionNotificationsForSession(sessionId: number): Promise<number> {
  return db.$count(
    notifications,
    and(
      eq(notifications.relatedEntityType, "session"),
      eq(notifications.relatedEntityId, sessionId),
      eq(notifications.type, NotificationType.SessionCompletion)
    )
  );
}

/**
 * Installs a recording no-op over the engine's publish contract: no
 * realtime channel is ever touched, and each dispatch is logged together
 * with the receipts (and their recipient ids) so a step can assert both
 * THAT a publish happened and WHICH users it targeted. The spy is
 * installed once in `beforeAll` and restored in `afterAll`.
 */
function spyPublication(): { calls: NotificationDeliveryReceipt[][]; stop: () => void } {
  const calls: NotificationDeliveryReceipt[][] = [];
  const spy = spyOn(NotificationEngine, "publishReceipts").mockImplementation(async receipts => {
    calls.push([...receipts]);
  });
  return { calls, stop: () => spy.mockRestore() };
}

let publication: ReturnType<typeof spyPublication> | undefined;

/** Every recipient id the spy has recorded so far, in publish order. */
function publishedUserIds(): number[] {
  return (publication?.calls ?? []).flatMap(receipts => receipts.flatMap(receipt => receipt.recipientUserIds));
}

/** How many publish dispatches the spy has recorded so far. */
function publicationCallCount(): number {
  return publication?.calls.length ?? 0;
}

/** Registers one service-created idempotency claim (by key) for cleanup. */
async function trackIdempotencyClaim(key: string, label: string): Promise<void> {
  const rows = await db
    .select({ id: sessionRequestIdempotency.id })
    .from(sessionRequestIdempotency)
    .where(eq(sessionRequestIdempotency.idempotencyKey, key));
  const claim = rows[0];
  if (!claim) {
    throw new Error(`journey: idempotency claim for ${label} not found (fixture tracking failure)`);
  }
  registry.track("session_request_idempotency", claim.id);
}

/**
 * Fabricates the system leg's precondition on a booked row: the row is
 * moved to `completed` with a teacher stamp one hour past the confirmation
 * window. This is a committed fixture write on the session row — the sweep
 * (and only the sweep) is exercised unmodified; no product guard, probe,
 * or transition is bypassed or disabled.
 */
async function fabricateExpiredCompletion(id: number, teacherStamp: Date): Promise<void> {
  await db
    .update(session)
    .set({
      status: SessionStatus.Completed,
      startedAt: new Date(teacherStamp.getTime() - 45 * 60_000),
      endedAt: teacherStamp,
      confirmedByTeacherAt: teacherStamp,
    })
    .where(eq(session.id, id));
}

beforeAll(async () => {
  await db.transaction(async tx => {
    cast = await buildSessionJourneyCast(tx, registry, {
      prefix: JOURNEY_PREFIX,
      // Student A: one trial + one hifz unit (the confirm-and-pay booker;
      // his booking binds the trial lane). Student B: one trial + two hifz
      // units (the timeout booking binds the trial lane; the race booking
      // binds a hifz unit).
      primaryStudent: { trial: 1, hifz: 1 },
      secondStudent: { trial: 1, hifz: 2 },
    });
  });
  // No realtime delivery for the whole suite: every publish is recorded.
  publication = spyPublication();
});

afterAll(async () => {
  publication?.stop();

  // The earning-ledger rows the confirm journey created are append-only
  // (DELETE-blocked) and restrict-delete their way into the wallet, which
  // the cast teardown would otherwise cascade away with the teacher row.
  // They are removed under the sanctioned append-only trigger suspension,
  // then the registry hard-deletes the rest in FK-safe order.
  const teacherWallet = await readTeacherWalletRow(cast.teacher.userId);
  if (teacherWallet !== null) {
    await withImmutabilityTriggersSuspended(["teacher_transaction"], async () => {
      await db.delete(teacherTransaction).where(eq(teacherTransaction.walletId, teacherWallet.id));
    });
  }

  await registry.cleanup();

  // Zero-residue self-check: the suite's session rows, the teacher's
  // wallet, and both students' inboxes are gone with the tracked rows.
  await Promise.all(
    registry.ids("session").map(async id => {
      expect(await db.$count(session, eq(session.id, id))).toBe(0);
    })
  );
  expect(await db.$count(wallet, eq(wallet.teacherId, cast.teacher.userId))).toBe(0);
  expect(await countNotificationsForUser(cast.primaryStudent.userId)).toBe(0);
  expect(await countNotificationsForUser(cast.secondStudent.userId)).toBe(0);
});

describe("Journey — dual-confirmation completion handshake (cross-actor, real services)", () => {
  test("step 1 — fixture cast commits as tracked ids with real role rows; the teacher starts with NO wallet", async () => {
    expect(cast).toBeDefined();
    expect(registry.trackedCount()).toBe(14);
    expect(registry.ids("users")).toHaveLength(7);
    expect(registry.ids("students")).toHaveLength(2);
    expect(registry.ids("teacher")).toHaveLength(2);

    // Real role-child rows, honest certification only.
    expect(cast.teacher.teacher.isApproved).toBe(true);
    expect(cast.secondTeacher.teacher.isApproved).toBe(true);

    // The credit slice will ensure the wallet itself — nothing exists yet.
    expect(await readTeacherWalletRow(cast.teacher.userId)).toBeNull();
  });

  test("step 2 — Student A books T: scheduled, trial-lane hold, platform fee, one teacher intake wave", async () => {
    const notificationsA = await countNotificationsForUser(cast.primaryStudent.userId);
    const notificationsT = await countNotificationsForUser(cast.teacher.userId);

    const booking: SessionSubmitInput = { teacherId: cast.teacher.userId, intent: SessionIntent.Hifz };
    sessionA = await SessionLifecycleService.createSession(cast.primaryStudent.userId, booking, KEY_A, LOCALE);

    expect(sessionA.teacherId).toBe(cast.teacher.userId);
    expect(sessionA.studentId).toBe(cast.primaryStudent.student.id);
    expect(sessionA.status).toBe(SessionStatus.Scheduled);
    expect(sessionA.fee).toBe(SESSION_FEE_HIFZ);
    expect(sessionA.feeHeld).toBe(true);
    expect(sessionA.heldBalanceLane).toBe(HeldBalanceLane.Trial);
    expect(sessionA.confirmedByStudentAt).toBeNull();
    expect(sessionA.confirmedByTeacherAt).toBeNull();

    // Booking consumes the trial unit into escrow; the hifz lane is untouched.
    expect(await readStudentLanes(cast.primaryStudent.student.id)).toEqual({ trial: 0, hifz: 1, tajweed: 0 });

    registry.track("session", sessionA.id);
    await trackIdempotencyClaim(KEY_A, "key A (Student A)");

    // A booking's only fan-out is the teacher's intake wave — the
    // student's inbox stays empty; the teacher gains exactly one row.
    expect(await countNotificationsForUser(cast.primaryStudent.userId)).toBe(notificationsA);
    expect(await countNotificationsForUser(cast.teacher.userId)).toBe(notificationsT + 1);
  });

  test("step 3 — Teacher T starts session A; Student A's own complete attempt is denied oracle-safely", async () => {
    const started = await SessionLifecycleService.startSession(cast.teacher.userId, sessionA.id, LOCALE);
    expect(started.status).toBe(SessionStatus.Started);
    expect(started.startedAt).not.toBeNull();
    expect(started.feeHeld).toBe(true);
    sessionA = started;

    // The student cannot complete his own session: the completion
    // predicate is teacher-owned, so a participant mismatch is answered by
    // the oracle-safe not-found error (foreign ≡ nonexistent), and the row
    // is untouched.
    const rowBefore = await readSessionRow(sessionA.id);
    const caught = await expectServiceDenial("SESSION_NOT_FOUND", errorTexts().sessionNotFound, () =>
      SessionLifecycleService.completeSession(cast.primaryStudent.userId, sessionA.id, LOCALE)
    );
    expect(caught).toBeInstanceOf(DomainError);
    const rowAfter = await readSessionRow(sessionA.id);
    expect(rowAfter.status).toBe(rowBefore.status);
    expect(rowAfter.confirmedByTeacherAt).toBeNull();
  });

  test("step 4 — Teacher T completes session A: exactly ONE confirm prompt reaches the student (row + spied publish)", async () => {
    const notificationsTBefore = await countNotificationsForUser(cast.teacher.userId);
    const notificationsBBefore = await countNotificationsForUser(cast.secondStudent.userId);
    const publishesBefore = publicationCallCount();

    const completed = await SessionLifecycleService.completeSession(cast.teacher.userId, sessionA.id, LOCALE);

    expect(completed.id).toBe(sessionA.id);
    expect(completed.status).toBe(SessionStatus.Completed);
    expect(completed.endedAt).not.toBeNull();
    expect(completed.confirmedByTeacherAt).not.toBeNull();
    // The completion is payable-but-unpaid: the student stamp is still
    // absent and the hold is still marked.
    expect(completed.confirmedByStudentAt).toBeNull();
    expect(completed.feeHeld).toBe(true);
    sessionA = completed;

    // Exactly ONE completion notification row, addressed to the student,
    // pointing back at this session (narrowed to the completion type — the
    // booking's own teacher intake wave shares the session id).
    expect(await countCompletionNotificationsForSession(sessionA.id)).toBe(1);
    const promptRows = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.relatedEntityType, "session"),
          eq(notifications.relatedEntityId, sessionA.id),
          eq(notifications.type, NotificationType.SessionCompletion)
        )
      );
    expect(promptRows).toHaveLength(1);
    expect(promptRows[0]?.userId).toBe(cast.primaryStudent.userId);
    expect(promptRows[0]?.type).toBe(NotificationType.SessionCompletion);
    expect(promptRows[0]?.isRead).toBe(false);

    // The prompt's delivery receipt was published exactly once AFTER the
    // flow's commit, targeting exactly the student — nobody else.
    expect(publicationCallCount()).toBe(publishesBefore + 1);
    expect(publishedUserIds().slice(publishesBefore)).toEqual([cast.primaryStudent.userId]);

    // No accidental fan-out: teacher and second student gained nothing.
    expect(await countNotificationsForUser(cast.teacher.userId)).toBe(notificationsTBefore);
    expect(await countNotificationsForUser(cast.secondStudent.userId)).toBe(notificationsBBefore);
  });

  test("step 5 — Student A confirms: both stamps, hold released, the wallet is credited EXACTLY the fee once", async () => {
    const walletBefore = await readTeacherWalletRow(cast.teacher.userId);
    const publishesBefore = publicationCallCount();
    const notificationsBBefore = await countNotificationsForUser(cast.secondStudent.userId);

    const confirmed = await SessionLifecycleService.confirmSessionCompletion(
      cast.primaryStudent.userId,
      sessionA.id,
      LOCALE
    );

    // Both confirmation stamps are present; the escrow hold is consumed.
    expect(confirmed.id).toBe(sessionA.id);
    expect(confirmed.status).toBe(SessionStatus.Completed);
    expect(confirmed.confirmedByTeacherAt).not.toBeNull();
    expect(confirmed.confirmedByStudentAt).not.toBeNull();
    expect(confirmed.feeHeld).toBe(false);
    sessionA = confirmed;

    // The teacher's wallet was ensured and credited by EXACTLY the session
    // fee — once (one earning-ledger row, amount verbatim).
    const walletAfter = requiredWalletRow(
      await readTeacherWalletRow(cast.teacher.userId),
      "teacher wallet after the confirm credit"
    );
    expect(walletTotal(walletAfter) - walletTotal(walletBefore)).toBe(Number(SESSION_FEE_HIFZ));
    expect(walletBalance(walletAfter) - walletBalance(walletBefore)).toBe(Number(SESSION_FEE_HIFZ));
    const ledgerRows = await readLedgerRowsForSession(sessionA.id);
    expect(ledgerRows).toHaveLength(1);
    expect(ledgerRows[0]?.amount).toBe(SESSION_FEE_HIFZ);
    expect(ledgerRows[0]?.type).toBe(TransactionType.Earning);
    expect(ledgerRows[0]?.walletId).toBe(walletAfter.id);

    // Confirmation is notification-free and refund-free: the trial lane
    // stays consumed (escrow became earnings, not a refund).
    expect(publicationCallCount()).toBe(publishesBefore);
    expect(await countNotificationsForUser(cast.primaryStudent.userId)).toBe(1);
    expect(await countNotificationsForUser(cast.secondStudent.userId)).toBe(notificationsBBefore);
    expect(await readStudentLanes(cast.primaryStudent.student.id)).toEqual({ trial: 0, hifz: 1, tajweed: 0 });
  });

  test("step 6 — repeats and foreign attempts write NOTHING: student re-confirm, teacher confirm, foreign-student denial", async () => {
    const rowBefore = await readSessionRow(sessionA.id);
    const walletBefore = await readTeacherWalletRow(cast.teacher.userId);
    const publishesBefore = publicationCallCount();

    // Student re-confirm: the honest idempotent answer — the current row,
    // zero financial writes.
    const reconfirmed = await SessionLifecycleService.confirmSessionCompletion(
      cast.primaryStudent.userId,
      sessionA.id,
      LOCALE
    );
    expect(reconfirmed.confirmedByStudentAt?.getTime()).toBe(
      requiredDate(rowBefore.confirmedByStudentAt, "student stamp").getTime()
    );
    expect(reconfirmed.feeHeld).toBe(false);

    // Teacher confirm: their stamp was written by the completion — the
    // same idempotent no-op.
    const teacherConfirm = await SessionLifecycleService.confirmSessionCompletion(
      cast.teacher.userId,
      sessionA.id,
      LOCALE
    );
    expect(teacherConfirm.confirmedByStudentAt?.getTime()).toBe(
      requiredDate(rowBefore.confirmedByStudentAt, "student stamp").getTime()
    );

    // Foreign student: oracle-safe not-found, row byte-identical.
    await expectServiceDenial("SESSION_NOT_FOUND", errorTexts().sessionNotFound, () =>
      SessionLifecycleService.confirmSessionCompletion(cast.secondStudent.userId, sessionA.id, LOCALE)
    );

    // ZERO deltas anywhere: one ledger row, wallet static, no publishes.
    const walletAfter = await readTeacherWalletRow(cast.teacher.userId);
    expect(walletTotal(walletAfter)).toBe(walletTotal(walletBefore));
    expect(walletBalance(walletAfter)).toBe(walletBalance(walletBefore));
    expect(await readLedgerRowsForSession(sessionA.id)).toHaveLength(1);
    expect(publicationCallCount()).toBe(publishesBefore);
    const rowAfter = await readSessionRow(sessionA.id);
    expect(rowAfter.feeHeld).toBe(false);
    expect(rowAfter.updatedAt.getTime()).toBe(rowBefore.updatedAt.getTime());
  });

  test("step 7 — Student B books T; the fixture fabricates the expired completion for the system leg", async () => {
    const booking: SessionSubmitInput = { teacherId: cast.teacher.userId, intent: SessionIntent.Hifz };
    sessionB = await SessionLifecycleService.createSession(cast.secondStudent.userId, booking, KEY_B, LOCALE);
    expect(sessionB.status).toBe(SessionStatus.Scheduled);
    expect(sessionB.feeHeld).toBe(true);
    expect(sessionB.heldBalanceLane).toBe(HeldBalanceLane.Trial);
    expect(sessionB.fee).toBe(SESSION_FEE_HIFZ);
    registry.track("session", sessionB.id);
    await trackIdempotencyClaim(KEY_B, "key B (Student B)");

    expect(await readStudentLanes(cast.secondStudent.student.id)).toEqual({ trial: 0, hifz: 2, tajweed: 0 });

    // Fixture write: completed, end span closed, teacher stamp one hour
    // past the confirmation window, student stamp still absent.
    const stamp = expiredTeacherStamp();
    await fabricateExpiredCompletion(sessionB.id, stamp);

    const fabricated = await readSessionRow(sessionB.id);
    expect(fabricated.status).toBe(SessionStatus.Completed);
    expect(fabricated.confirmedByTeacherAt?.getTime()).toBe(stamp.getTime());
    expect(fabricated.confirmedByStudentAt).toBeNull();
    expect(fabricated.feeHeld).toBe(true);
    expect(fabricated.heldBalanceLane).toBe(HeldBalanceLane.Trial);
  });

  test("step 8 — System sweep cancels the expired completion: same-lane refund +1, exactly ONE auto-cancel notice", async () => {
    const rowBefore = await readSessionRow(sessionB.id);
    const publishesBefore = publicationCallCount();
    const notificationsBBefore = await countNotificationsForUser(cast.secondStudent.userId);
    const notificationsABefore = await countNotificationsForUser(cast.primaryStudent.userId);

    const sweep = await SessionLifecycleService.sweepExpiredSessions();

    // Honest counts: the sweep is a global batch — at least this journey's
    // expired row was cancelled and at least one hold was refunded.
    expect(sweep.cancelled).toBeGreaterThanOrEqual(1);
    expect(sweep.refunded).toBeGreaterThanOrEqual(1);

    // The expired row is cancelled with the hold released; the recorded
    // provenance lane is never rewritten, the deadline column is never
    // re-armed, and both stamps stay exactly as they were.
    const swept = await readSessionRow(sessionB.id);
    expect(swept.status).toBe(SessionStatus.Cancelled);
    expect(swept.feeHeld).toBe(false);
    expect(swept.heldBalanceLane).toBe(HeldBalanceLane.Trial);
    expect(swept.confirmedByTeacherAt?.getTime()).toBe(rowBefore.confirmedByTeacherAt?.getTime());
    expect(swept.confirmedByStudentAt).toBeNull();
    expect(swept.confirmationDeadline?.getTime()).toBe(rowBefore.confirmationDeadline?.getTime());

    // The held unit returned to the SAME lane that funded the hold —
    // exactly once (0 → 1), no other lane moved.
    expect(await readStudentLanes(cast.secondStudent.student.id)).toEqual({ trial: 1, hifz: 2, tajweed: 0 });

    // Exactly ONE auto-cancel notification for this session, addressed to
    // its student — and the receipt was published once, targeting him.
    expect(await countCompletionNotificationsForSession(sessionB.id)).toBe(1);
    expect(publicationCallCount()).toBe(publishesBefore + 1);
    const publishedHere = publishedUserIds().slice(publishesBefore);
    expect(publishedHere.filter(userId => userId === cast.secondStudent.userId)).toHaveLength(1);

    // No accidental fan-out: Student A's inbox is untouched by B's timeout.
    expect(await countNotificationsForUser(cast.secondStudent.userId)).toBe(notificationsBBefore + 1);
    expect(await countNotificationsForUser(cast.primaryStudent.userId)).toBe(notificationsABefore);
  });

  test("step 9 — the sweep re-run matches ZERO rows: zero cancels, zero refunds, zero new notices", async () => {
    const publishesBefore = publicationCallCount();
    const notificationsBBefore = await countNotificationsForUser(cast.secondStudent.userId);

    const secondSweep = await SessionLifecycleService.sweepExpiredSessions();

    // Cancelled is terminal — the second sweep's predicates match nothing
    // anywhere, so the counts are exactly zero (the first sweep already
    // consumed every eligible row) and no second notice exists.
    expect(secondSweep.cancelled).toBe(0);
    expect(secondSweep.refunded).toBe(0);
    expect(publicationCallCount()).toBe(publishesBefore);
    expect(await countNotificationsForUser(cast.secondStudent.userId)).toBe(notificationsBBefore);
    expect(await countCompletionNotificationsForSession(sessionB.id)).toBe(1);

    // The refunded lane keeps its restored balance (no double refund).
    expect(await readStudentLanes(cast.secondStudent.student.id)).toEqual({ trial: 1, hifz: 2, tajweed: 0 });
  });

  test("step 10 — confirm-vs-sweep race on one expired completion: exactly ONE financial outcome", async () => {
    // A second expired completion over the student's hifz lane.
    const booking: SessionSubmitInput = { teacherId: cast.teacher.userId, intent: SessionIntent.Hifz };
    sessionRace = await SessionLifecycleService.createSession(cast.secondStudent.userId, booking, KEY_R, LOCALE);
    registry.track("session", sessionRace.id);
    await trackIdempotencyClaim(KEY_R, "key R (Student B race)");
    await fabricateExpiredCompletion(sessionRace.id, expiredTeacherStamp());

    const rowBefore = await readSessionRow(sessionRace.id);
    expect(rowBefore.status).toBe(SessionStatus.Completed);
    expect(rowBefore.feeHeld).toBe(true);
    expect(rowBefore.confirmedByStudentAt).toBeNull();
    const walletBefore = await readTeacherWalletRow(cast.teacher.userId);
    const publishesBefore = publicationCallCount();
    const notificationsBBefore = await countNotificationsForUser(cast.secondStudent.userId);
    const hifzBefore = (await readStudentLanes(cast.secondStudent.student.id)).hifz ?? 0;

    // Both flows are dispatched concurrently on the production path —
    // each opens its own top-level transaction, and each outcome is a
    // predicate-fused guarded UPDATE over the same row.
    const outcomes = await Promise.allSettled([
      SessionLifecycleService.confirmSessionCompletion(cast.secondStudent.userId, sessionRace.id, LOCALE),
      SessionLifecycleService.sweepExpiredSessions(),
    ]);

    // The confirmation either fulfills (it won the row) or is honestly
    // classified as a conflict (the sweep got there first) — never a
    // crash, never a silent partial.
    const confirmOutcome = outcomes[0];
    if (confirmOutcome?.status === "rejected") {
      const reason = confirmOutcome.reason;
      expect(reason).toBeInstanceOf(DomainError);
      expect(denialCode(reason)).toBe("SESSION_INVALID_TRANSITION");
      expect(reason).toBeInstanceOf(ConflictError);
    }
    const sweepOutcome = outcomes[1];
    expect(sweepOutcome?.status).toBe("fulfilled");

    // The row oracle decides the winner — the student stamp partitions the
    // two terminal shapes exactly once: stamped ⇒ the confirmation consumed
    // the escrow (completed), unstamped ⇒ the sweep released it (cancelled).
    // Each branch pins the row's status on the enum vocabulary.
    const row = await readSessionRow(sessionRace.id);
    expect(row.feeHeld).toBe(false);
    const creditWon = row.confirmedByStudentAt !== null;
    if (creditWon) {
      expect(row.status).toBe(SessionStatus.Completed);
    } else {
      expect(row.status).toBe(SessionStatus.Cancelled);
    }

    const ledgerRows = await readLedgerRowsForSession(sessionRace.id);
    const walletAfter = await readTeacherWalletRow(cast.teacher.userId);
    if (creditWon) {
      // Escrow consumed by earning: credited EXACTLY the fee once, the
      // lane untouched, no auto-cancel notice.
      expect(ledgerRows).toHaveLength(1);
      expect(ledgerRows[0]?.amount).toBe(SESSION_FEE_HIFZ);
      expect(walletTotal(walletAfter) - walletTotal(walletBefore)).toBe(Number(SESSION_FEE_HIFZ));
      expect((await readStudentLanes(cast.secondStudent.student.id)).hifz ?? 0).toBe(hifzBefore);
      expect(await countCompletionNotificationsForSession(sessionRace.id)).toBe(0);
      expect(publicationCallCount()).toBe(publishesBefore);
      expect(await countNotificationsForUser(cast.secondStudent.userId)).toBe(notificationsBBefore);
    } else {
      // Escrow released by the sweep: refunded to the provenance lane once,
      // zero credits, exactly one auto-cancel notice targeting the student.
      expect(ledgerRows).toHaveLength(0);
      expect(walletTotal(walletAfter)).toBe(walletTotal(walletBefore));
      expect((await readStudentLanes(cast.secondStudent.student.id)).hifz ?? 0).toBe(hifzBefore + 1);
      expect(await countCompletionNotificationsForSession(sessionRace.id)).toBe(1);
      expect(publicationCallCount()).toBe(publishesBefore + 1);
      const publishedHere = publishedUserIds().slice(publishesBefore);
      expect(publishedHere.filter(userId => userId === cast.secondStudent.userId)).toHaveLength(1);
      expect(await countNotificationsForUser(cast.secondStudent.userId)).toBe(notificationsBBefore + 1);
    }
  });

  test("step 11 — teardown worklist is complete: every service-created row is tracked for the afterAll hard-delete", () => {
    expect(registry.ids("session").toSorted((a, b) => a - b)).toEqual(
      [sessionA.id, sessionB.id, sessionRace.id].toSorted((a, b) => a - b)
    );
    expect(registry.ids("session_request_idempotency")).toHaveLength(3);
    // 14 fixture rows (7 users + 2 students + 2 teachers + 1 applicant +
    // 1 parent + 1 admin) + 3 sessions + 3 idempotency claims.
    expect(registry.trackedCount()).toBe(20);
  });
});
