/**
 * Journey — post-confirmation dispute arbitration (cross-actor session
 * workflow).
 *
 * The consumed-escrow dispute generation, executed SEQUENTIALLY through the
 * REAL services (production transaction path — no outer tx) on the real test
 * database, every step attributed to a real actor from one committed fixture
 * cast (real `users.role` values + real role-child rows; authorization and
 * ownership resolve through the same row-side predicates production uses —
 * never monkey-patched):
 *
 *  J1 — refund arbitration: the student disputes a dual-confirmed session
 *       (the teacher's post-confirmation open attempt collapses to the
 *       oracle-safe not-found), the row surfaces in the admin arbitration
 *       queue with the consumed escrow marker, the admin reviews the case
 *       artifacts, and the Refund resolution debits the teacher wallet
 *       exactly the fee, restores the student's provenance lane once,
 *       appends exactly ONE override audit row, and notifies both
 *       participants while the open wave reached every admin.
 *  J2 — partial refund: the PartialRefund resolution carries the exact
 *       "15.00" amount string on the "25.00" fee — the wallet debits exactly
 *       the partial, the student's lane is restored once, and the audit
 *       details carry the amount string verbatim.
 *  J3 — uphold: the Uphold resolution completes the row with ZERO financial
 *       writes and exactly one audit row; both participants are notified.
 *  DENIALS — the cross-actor matrix: every non-admin role's arbitration
 *       attempt is byte-identical to the shared admin-gate 403; a refund-
 *       family resolution on a held row and a complete-family resolution on
 *       a consumed row both fail the classification mismatch (typed
 *       VALIDATION, byte-identical across directions, zero writes); an
 *       emptied teacher wallet leaves the row disputed with the funds
 *       conflict and zero financial movement.
 *  RACE — two admins arbitrating one disputed row concurrently: exactly one
 *       commit wins, the loser receives the state-conflict classification,
 *       and every financial artifact lands exactly once (real-PG posture —
 *       skipped on the single-connection PGlite sandbox exactly like the
 *       sibling chaos tiers).
 *
 * Layer contract (`test/workflows/AGENTS.md` + `docs/testing/workflow-journey-tests.md`):
 *  - NO `runInRollback` — fixtures commit in `beforeAll`; every row the
 *    suite or the services create is tracked and hard-deleted FK-safely in
 *    `afterAll`, with the append-only ledgers (`audit_logs`,
 *    `teacher_transaction`) swept under the sanctioned trigger suspension
 *    and a zero-residue re-probe of every surface the suite touched.
 *  - Per-run `jrn_sessions_<8hex>` prefix on labels and idempotency keys —
 *    repeated or parallel runs never collide.
 *  - Notification dispatch is SPIED at the engine boundary: publish
 *    receipts are recorded (never delivered), and each wave is asserted by
 *    recipient ids at the boundary AND by the persisted inbox rows.
 *  - Negative steps fail through the REAL service denials, asserted by
 *    `DomainError.code` + the exact translated message (try/catch helper —
 *    never `expect(...).rejects.toThrow()`).
 *
 * Run:
 *   bun run test/scripts/run-test.ts test/workflows/sessions/post-confirmation-dispute.journey.test.ts
 */

import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/backend/db";
import { auditLogs } from "@/backend/db/schema/audit/audit-logs";
import { teacherTransaction } from "@/backend/db/schema/billing/teacher-transaction";
import { wallet } from "@/backend/db/schema/billing/wallet";
import { homeWork } from "@/backend/db/schema/classes/home-work";
import { reports } from "@/backend/db/schema/classes/reports";
import { session } from "@/backend/db/schema/classes/session";
import { sessionRequestIdempotency } from "@/backend/db/schema/classes/session-request-idempotency";
import { notifications } from "@/backend/db/schema/notifications/notifications";
import { students } from "@/backend/db/schema/students/students";
import { AuditActionType } from "@/backend/enum/audit/audit-action-type.enum";
import { TransactionStatus } from "@/backend/enum/billing/transaction-status.enum";
import { TransactionType } from "@/backend/enum/billing/transaction-type.enum";
import { NotificationType } from "@/backend/enum/notifications/notification-type.enum";
import { DisputeResolution } from "@/backend/enum/scheduling/dispute-resolution.enum";
import { HeldBalanceLane } from "@/backend/enum/scheduling/held-balance-lane.enum";
import { SessionIntent } from "@/backend/enum/scheduling/session-intent.enum";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import { SurahJuzRef } from "@/backend/enum/shared/surah-juz-ref.enum";
import { ConflictError, DomainError, ForbiddenError, NotFoundError, ValidationError } from "@/backend/lib/errors";
import { WalletService } from "@/backend/services/billing/wallet.service";
import { SessionArbitrationService } from "@/backend/services/classes/session-arbitration.service";
import { SessionLifecycleService } from "@/backend/services/classes/session-lifecycle.service";
import * as SessionReportService from "@/backend/services/classes/session-report.service";
import { NotificationEngine } from "@/backend/services/notifications";
import type {
  HomeWorkBlockInput,
  NotificationDeliveryReceipt,
  SessionReportSubmitInput,
  SessionReturnType,
  SessionSelectType,
  SessionSubmitInput,
  WalletSelectType,
} from "@/backend/types";
import { SESSION_FEE_HIFZ } from "@/shared/constants/session-fees.constants";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import { withAuditDeleteTriggersSuspended, withImmutabilityTriggersSuspended } from "@/test/helpers/db-cleanup";
import { isPgliteProvider } from "@/test/helpers/skip-when-pglite";
import {
  buildSessionJourneyCast,
  countAuditLogsForActor,
  countNotificationsForUser,
  createSessionFixtureRegistry,
  journeyPrefix,
  provisionAdminActor,
  type SessionJourneyCast,
  TrackedFixtures,
} from "@/test/workflows/helpers";

/** The journey runs on the default test locale throughout. */
const LOCALE = "en";

/** Per-run unique prefix — repeated/parallel runs never collide. */
const JOURNEY_PREFIX = journeyPrefix("sessions");

/** Idempotency keys for the six bookings — per-run unique via the prefix. */
const KEY_REFUND = `${JOURNEY_PREFIX}-refund`;
const KEY_PARTIAL = `${JOURNEY_PREFIX}-partial`;
const KEY_UPHOLD = `${JOURNEY_PREFIX}-uphold`;
const KEY_HELD = `${JOURNEY_PREFIX}-held`;
const KEY_FUNDS = `${JOURNEY_PREFIX}-funds`;
const KEY_RACE = `${JOURNEY_PREFIX}-race`;

/** The partial-amount strings of the J2 boundary (exact decimal strings). */
const PARTIAL_AMOUNT = "15.00";
const FEE_AMOUNT = SESSION_FEE_HIFZ;

/** Free-text reason each disputing student supplies (persisted verbatim). */
const REFUND_DISPUTE_REASON = "the recorded lesson does not match what was taught";
const PARTIAL_DISPUTE_REASON = "half the lesson time was lost to connection failures";
const FUNDS_DISPUTE_REASON = "the session never happened as scheduled";
const HELD_DISPUTE_REASON = "held-generation dispute fixture for the denial matrix";

/** Resolution notes the admin supplies per outcome (persisted verbatim). */
const REFUND_NOTE = "fee returned to the student after case review";
const PARTIAL_NOTE = "half the fee returned after case review";
const UPHOLD_NOTE = "the recorded session stands after review";

/** The case artifacts the teacher submits before the dispute opens. */
const CASE_REPORT_NOTES = "Student recited steadily; next session continues the revision block.";
const JADID_BLOCK: HomeWorkBlockInput = { fromAyah: 1, toAyah: 7, surahJuz: SurahJuzRef.SurahAlFatihah };
const MADI_BLOCK: HomeWorkBlockInput = { fromAyah: 1, toAyah: 5, surahJuz: SurahJuzRef.Juz1 };

/** The fixture registry — the hard-delete worklist drained by `afterAll`. */
const registry = createSessionFixtureRegistry();

/** The second admin's own tracked registry (actor-context provisioning). */
const secondAdminFixtures = new TrackedFixtures();

/** The committed actor cast (assigned once by `beforeAll`). */
let cast: SessionJourneyCast;

/** The second admin — the race's second arbiter (real admin rows). */
let secondAdminUserId = 0;

/** J1's session — booked, dual-confirmed, disputed, refunded. */
let refundSession: SessionReturnType;

/** J2's session — booked, dual-confirmed, disputed, partially refunded. */
let partialSession: SessionReturnType;

/** J3's session — booked, dual-confirmed, disputed, upheld. */
let upholdSession: SessionReturnType;

/** The held-generation disputed row of the denial matrix (stays disputed). */
let heldRow: SessionReturnType;

/** The consumed disputed row whose teacher wallet was emptied (stays disputed). */
let fundsSession: SessionReturnType;

/** The exact translated denial messages for the default test locale. */
function errorTexts() {
  return getServerTranslations(LOCALE).errorsTranslations;
}

/** Type-guard read of a caught rejection's `extensions.code`. */
function denialCode(error: unknown): string {
  return error instanceof DomainError ? error.code : "";
}

/**
 * Try/catch rejection helper (journey-layer pattern —
 * `expect(...).rejects.toThrow()` is prohibited). Fails the test when the
 * call resolves; returns the caught value otherwise.
 */
async function caughtRejectionOf(action: () => Promise<unknown>): Promise<unknown> {
  try {
    await action();
  } catch (error) {
    return error;
  }
  throw new Error("expected the call to reject, but it resolved successfully");
}

/**
 * Runs a denial through the real service and asserts the typed-denial
 * contract: a `DomainError` carrying EXACTLY `code` and EXACTLY the
 * translated message (never the raw key). Returns the narrowed error so a
 * call site can pin the concrete subclass.
 */
async function expectServiceDenial(
  code: string,
  message: string,
  action: () => Promise<unknown>
): Promise<DomainError> {
  const caught = await caughtRejectionOf(action);
  if (!(caught instanceof DomainError)) {
    throw new Error(`expected a DomainError denial (${code}), received: ${String(caught)}`);
  }
  expect(caught.code).toBe(code);
  expect(caught.message).toBe(message);
  return caught;
}

/**
 * Byte-identity oracle for the denial matrix: the denial must carry the
 * SAME error class, the SAME `extensions.code`, and the SAME localized
 * message as the reference denial captured from the shared admin gate.
 */
function expectDenialByteIdentical(denial: DomainError, reference: DomainError): void {
  expect(denial.constructor).toBe(reference.constructor);
  expect(denial.code).toBe(reference.code);
  expect(denial.message).toBe(reference.message);
}

/** Reads the FULL session row straight from the database (row-equality oracle). */
async function readSessionRow(sessionId: number): Promise<SessionSelectType> {
  const rows = await db.select().from(session).where(eq(session.id, sessionId));
  const row = rows[0];
  if (!row) {
    throw new Error(`journey: session row ${String(sessionId)} vanished (fixture integrity failure)`);
  }
  return row;
}

/** Reads the student's escrow-lane balances straight from the row. */
async function readStudentLanes(
  studentId: number
): Promise<{ trial: number; hifz: number | null; tajweed: number | null }> {
  const rows = await db
    .select({ trial: students.balanceTrial, hifz: students.balanceHifz, tajweed: students.balanceTajweed })
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

/** Narrows a nullable wallet read to a row, failing loudly when null. */
function requiredWalletRow(value: WalletSelectType | null, label: string): WalletSelectType {
  if (value === null) {
    throw new Error(`journey: expected a wallet row for ${label}`);
  }
  return value;
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
async function readLedgerRowsForSession(sessionId: number) {
  return db.select().from(teacherTransaction).where(eq(teacherTransaction.sessionId, sessionId));
}

/** Audit rows ABOUT one session entity (the exactly-one arbitration oracle). */
async function readAuditsForSession(sessionId: number) {
  return db
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.entityType, "session"), eq(auditLogs.entityId, sessionId)));
}

/** Dispute-wave notification rows for ONE recipient, session, and wave kind. */
async function countDisputeNotifications(userId: number, type: NotificationType, sessionId: number): Promise<number> {
  return db.$count(
    notifications,
    and(
      eq(notifications.userId, userId),
      eq(notifications.type, type),
      eq(notifications.relatedEntityType, "session"),
      eq(notifications.relatedEntityId, sessionId)
    )
  );
}

/** Structural guard for the parsed audit details payload (never a cast). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parses the single arbitration audit row's details for one session: the
 * caller has already asserted exactly-one row; the parsed payload must be a
 * JSON object carrying the resolution member.
 */
function arbitrationAuditDetails(row: { readonly details: string | null } | undefined): Record<string, unknown> {
  if (!row) {
    throw new Error("journey: expected the arbitration audit row to exist");
  }
  const parsed: unknown = JSON.parse(row.details ?? "{}");
  if (!isRecord(parsed)) {
    throw new Error("journey: unexpected arbitration audit details payload");
  }
  return parsed;
}

/**
 * Installs a recording no-op over the engine's publish contract: no
 * realtime channel is ever touched, and each wave dispatch is logged
 * together with its receipts so a step can assert both THAT a publish
 * happened, WHICH users it targeted, and that it rode ONE post-commit
 * dispatch per wave. Installed once in `beforeAll`, restored in `afterAll`.
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

/**
 * Marks the flat recipient-id list's current length for a later
 * `publishedUserIds().slice(marker)` — the publish DISPATCH count is a
 * different series (one dispatch may carry several receipts, e.g. the
 * shipped report-ready wave's student + parent pair), so slicing the id
 * list by the dispatch count misaligns whenever an earlier wave published
 * more than one receipt.
 */
function publishedIdCount(): number {
  return publishedUserIds().length;
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
 * Drives one booking through the REAL dual-confirmation handshake to the
 * consumed posture this dispute generation requires: scheduled → started →
 * teacher-complete → student-confirm (escrow consumed, teacher wallet
 * credited exactly the fee). The session row and its claim are tracked.
 */
async function bookDualConfirmedConsumedSession(
  bookerUserId: number,
  teacherUserId: number,
  key: string
): Promise<SessionReturnType> {
  const booking: SessionSubmitInput = { teacherId: teacherUserId, intent: SessionIntent.Hifz };
  const booked = await SessionLifecycleService.createSession(bookerUserId, booking, key, LOCALE);
  registry.track("session", booked.id);
  await trackIdempotencyClaim(key, key);
  await SessionLifecycleService.startSession(teacherUserId, booked.id, LOCALE);
  await SessionLifecycleService.completeSession(teacherUserId, booked.id, LOCALE);
  return SessionLifecycleService.confirmSessionCompletion(bookerUserId, booked.id, LOCALE);
}

beforeAll(async () => {
  await db.transaction(async tx => {
    cast = await buildSessionJourneyCast(tx, registry, {
      prefix: JOURNEY_PREFIX,
      // Five bookings fund every arc on the trial lane (the ladder consumes
      // trial first): refund, partial, uphold, race, and the held denial
      // fixture. The second student books the emptied-wallet fixture.
      primaryStudent: { trial: 5 },
      secondStudent: { trial: 1 },
    });
    // The race's second arbiter: a REAL admin (users row + admin role-child
    // row) provisioned through the shared actor-context factory.
    const secondAdmin = await provisionAdminActor(tx, { locale: LOCALE, tracked: secondAdminFixtures });
    secondAdminUserId = secondAdmin.userId;
  });
  // No realtime delivery for the whole suite: every publish is recorded.
  publication = spyPublication();
});

afterAll(async () => {
  publication?.stop();
  const sessionIds = [...registry.ids("session")];

  // The case artifacts (report + homework) restrict-delete into nothing but
  // are deleted explicitly for determinism before the session rows.
  if (sessionIds.length > 0) {
    await db.delete(homeWork).where(inArray(homeWork.sessionId, sessionIds));
    await db.delete(reports).where(inArray(reports.sessionId, sessionIds));
    expect(await db.$count(reports, inArray(reports.sessionId, sessionIds))).toBe(0);
    expect(await db.$count(homeWork, inArray(homeWork.sessionId, sessionIds))).toBe(0);
  }

  // The arbitration audit rows are append-only (DELETE-blocked) and
  // restrict-delete into `users` — swept FIRST under the sanctioned trigger
  // suspension, by both arbiter actors and by session entity.
  if (cast) {
    await withAuditDeleteTriggersSuspended(async () => {
      await db.delete(auditLogs).where(inArray(auditLogs.actorId, [cast.admin.userId, secondAdminUserId]));
      if (sessionIds.length > 0) {
        await db
          .delete(auditLogs)
          .where(and(eq(auditLogs.entityType, "session"), inArray(auditLogs.entityId, sessionIds)));
      }
    });
    expect(await countAuditLogsForActor(cast.admin.userId)).toBe(0);
    expect(await countAuditLogsForActor(secondAdminUserId)).toBe(0);
  }

  // The earning/arbitration-reversal ledger rows are append-only and restrict-delete
  // into the wallet (which the cast teardown would cascade away) — swept
  // under the trigger suspension, then re-probed to zero while the wallets
  // still exist.
  if (cast) {
    const teacherWallet = await readTeacherWalletRow(cast.teacher.userId);
    const secondTeacherWallet = await readTeacherWalletRow(cast.secondTeacher.userId);
    const walletIds = [teacherWallet?.id, secondTeacherWallet?.id].filter((id): id is number => typeof id === "number");
    if (walletIds.length > 0) {
      await withImmutabilityTriggersSuspended(["teacher_transaction"], async () => {
        await db.delete(teacherTransaction).where(inArray(teacherTransaction.walletId, walletIds));
      });
      await Promise.all(
        walletIds.map(async walletId =>
          expect(await db.$count(teacherTransaction, eq(teacherTransaction.walletId, walletId))).toBe(0)
        )
      );
    }
  }

  // Hard-deletes every tracked fixture AND service-created row (sessions,
  // claims) inside one committed transaction, FK-safe order.
  await registry.cleanup();
  await secondAdminFixtures.cleanup();

  // Zero-residue self-check: the suite's session rows, both wallets, and the
  // participants' inboxes are gone with the tracked rows.
  await Promise.all(sessionIds.map(async id => expect(await db.$count(session, eq(session.id, id))).toBe(0)));
  if (cast) {
    expect(await db.$count(wallet, eq(wallet.teacherId, cast.teacher.userId))).toBe(0);
    expect(await db.$count(wallet, eq(wallet.teacherId, cast.secondTeacher.userId))).toBe(0);
    await Promise.all(
      [cast.primaryStudent, cast.secondStudent, cast.teacher, cast.secondTeacher].map(async member =>
        expect(await countNotificationsForUser(member.userId)).toBe(0)
      )
    );
  }
});

// ─── Journey J1 — refund arbitration (the full happy path) ───────────────

describe("Journey J1 — dispute → queue → case review → Refund arbitration", () => {
  test("step 1 — the committed cast holds real role rows; the teacher starts with NO wallet", async () => {
    expect(cast).toBeDefined();
    expect(registry.ids("users")).toHaveLength(7);
    expect(registry.ids("students")).toHaveLength(2);
    expect(registry.ids("teacher")).toHaveLength(2);
    expect(registry.ids("admin")).toHaveLength(1);
    // The second arbiter is tracked in his own registry: user row + admin row.
    expect(secondAdminFixtures.size).toBe(2);

    // Honest certification only, and the second arbiter is a real admin.
    expect(cast.teacher.teacher.isApproved).toBe(true);
    expect(secondAdminUserId).toBeGreaterThan(0);
    expect(await readTeacherWalletRow(cast.teacher.userId)).toBeNull();
  });

  test("step 2 — the student books and dual-confirms: escrow consumed, wallet credited exactly the fee", async () => {
    const lanesBefore = await readStudentLanes(cast.primaryStudent.student.id);
    expect(lanesBefore.trial).toBe(5);

    refundSession = await bookDualConfirmedConsumedSession(cast.primaryStudent.userId, cast.teacher.userId, KEY_REFUND);

    expect(refundSession.status).toBe(SessionStatus.Completed);
    expect(refundSession.confirmedByStudentAt).not.toBeNull();
    expect(refundSession.confirmedByTeacherAt).not.toBeNull();
    // The hold is consumed; the recorded provenance lane is never rewritten.
    expect(refundSession.feeHeld).toBe(false);
    expect(refundSession.heldBalanceLane).toBe(HeldBalanceLane.Trial);
    expect(refundSession.fee).toBe(FEE_AMOUNT);

    const lanesAfter = await readStudentLanes(cast.primaryStudent.student.id);
    expect(lanesAfter.trial).toBe(4);
    const walletRow = requiredWalletRow(await readTeacherWalletRow(cast.teacher.userId), "the confirmed teacher");
    expect(walletBalance(walletRow)).toBe(Number(FEE_AMOUNT));
    expect(walletTotal(walletRow)).toBe(Number(FEE_AMOUNT));
  });

  test("step 3 — the teacher submits the case artifacts: report + homework assignment", async () => {
    const submit: SessionReportSubmitInput = {
      teacherNotes: CASE_REPORT_NOTES,
      studentRatingByTeacher: 4,
      homework: { jadid: JADID_BLOCK, madi: MADI_BLOCK },
    };
    const submitted = await SessionReportService.submitSessionReport(
      cast.teacher.userId,
      refundSession.id,
      submit,
      LOCALE
    );
    expect(submitted.teacherNotes).toBe(CASE_REPORT_NOTES);
    expect(submitted.sessionId).toBe(refundSession.id);
  });

  test("step 4 — the teacher's post-confirmation open attempt collapses to the oracle-safe not-found", async () => {
    const rowBefore = await readSessionRow(refundSession.id);
    const caught = await expectServiceDenial("SESSION_NOT_FOUND", errorTexts().sessionNotFound, () =>
      SessionArbitrationService.openPostConfirmationDispute(
        cast.teacher.userId,
        refundSession.id,
        "teacher dispute",
        LOCALE
      )
    );
    // A participant teacher is indistinguishable from a nonexistent caller —
    // the same typed not-found, and the row is untouched.
    expect(caught).toBeInstanceOf(NotFoundError);
    expect(await readSessionRow(refundSession.id)).toEqual(rowBefore);
  });

  test("step 5 — the student disputes: the row enters arbitration and every admin is notified", async () => {
    const queueBefore = await SessionLifecycleService.listAdminDisputedSessions({}, 50, 0);
    const adminOpenedBefore = await countDisputeNotifications(
      cast.admin.userId,
      NotificationType.SessionDisputeOpened,
      refundSession.id
    );
    const publishBefore = publicationCallCount();
    const publishedIdsBefore = publishedIdCount();

    const disputed = await SessionArbitrationService.openPostConfirmationDispute(
      cast.primaryStudent.userId,
      refundSession.id,
      REFUND_DISPUTE_REASON,
      LOCALE
    );

    expect(disputed.status).toBe(SessionStatus.Disputed);
    expect(disputed.disputeReason).toBe(REFUND_DISPUTE_REASON);
    expect(disputed.disputedAt).not.toBeNull();
    // The consumed escrow stays consumed — the dispute records intent only.
    expect(disputed.feeHeld).toBe(false);

    // The admin arbitration queue surfaces the row with its escrow class.
    const queueAfter = await SessionLifecycleService.listAdminDisputedSessions({}, 50, 0);
    expect(queueAfter.totalCount).toBe(queueBefore.totalCount + 1);
    const queued = queueAfter.items.find(item => item.id === refundSession.id);
    if (!queued) {
      throw new Error("journey: the disputed row is missing from the arbitration queue");
    }
    expect(queued.feeHeld).toBe(false);
    expect(queued.disputeReason).toBe(REFUND_DISPUTE_REASON);
    expect(queued.disputedAt).not.toBeNull();

    // The opened wave reaches BOTH admins — as inbox rows and as ONE
    // post-commit dispatch at the engine boundary.
    expect(
      await countDisputeNotifications(cast.admin.userId, NotificationType.SessionDisputeOpened, refundSession.id)
    ).toBe(adminOpenedBefore + 1);
    expect(
      await countDisputeNotifications(secondAdminUserId, NotificationType.SessionDisputeOpened, refundSession.id)
    ).toBe(1);
    // No accidental fan-out: the participants and the parent gain nothing.
    expect(
      await countDisputeNotifications(cast.teacher.userId, NotificationType.SessionDisputeOpened, refundSession.id)
    ).toBe(0);
    expect(
      await countDisputeNotifications(cast.parent.userId, NotificationType.SessionDisputeOpened, refundSession.id)
    ).toBe(0);
    expect(publicationCallCount()).toBe(publishBefore + 1);
    const published = publishedUserIds().slice(publishedIdsBefore);
    expect(published).toContain(cast.admin.userId);
    expect(published).toContain(secondAdminUserId);
    expect(published).not.toContain(cast.teacher.userId);
  });

  test("step 6 — the admin reviews the case: report + homework + honest-null recitation + audit lane", async () => {
    // The admin case read composes the session detail, the submitted
    // artifacts (honest nulls wherever none exists), and the session-scoped
    // audit lane — still empty before the resolution.
    const caseBundle = await SessionArbitrationService.getAdminDisputeCase(cast.admin.userId, refundSession.id, LOCALE);

    expect(caseBundle.session.id).toBe(refundSession.id);
    expect(caseBundle.session.status).toBe(SessionStatus.Disputed);

    if (!caseBundle.report) {
      throw new Error("journey: expected the case review to carry the submitted report");
    }
    expect(caseBundle.report.teacherNotes).toBe(CASE_REPORT_NOTES);

    if (!caseBundle.homework) {
      throw new Error("journey: expected the case review to carry the assigned homework");
    }
    expect(caseBundle.homework.currentSurahJuz).toBe(SurahJuzRef.SurahAlFatihah);
    expect(caseBundle.homework.currentGrade).toBeNull();

    expect(caseBundle.recitation).toBeNull();
    expect(caseBundle.auditTrail).toHaveLength(0);
  });

  test("step 7 — the admin resolves Refund: wallet debits the fee, lane restored once, ONE audit row", async () => {
    const walletBefore = await readTeacherWalletRow(cast.teacher.userId);
    const lanesBefore = await readStudentLanes(cast.primaryStudent.student.id);
    const publishBefore = publicationCallCount();
    const publishedIdsBefore = publishedIdCount();

    const resolved = await SessionArbitrationService.arbitrateDispute(
      cast.admin.userId,
      refundSession.id,
      DisputeResolution.Refund,
      REFUND_NOTE,
      null,
      LOCALE
    );

    expect(resolved.status).toBe(SessionStatus.Completed);
    expect(resolved.feeHeld).toBe(false);
    expect(resolved.resolutionNote).toBe(REFUND_NOTE);
    expect(resolved.resolvedAt).not.toBeNull();

    // The teacher wallet debited EXACTLY the fee; the lifetime counter and
    // the balance move exactly as the compensating ledger row prescribes.
    const walletAfter = requiredWalletRow(await readTeacherWalletRow(cast.teacher.userId), "the refunded teacher");
    expect(walletBalance(walletAfter) - walletBalance(walletBefore)).toBe(-Number(FEE_AMOUNT));
    expect(walletTotal(walletAfter)).toBe(walletTotal(walletBefore));

    // The student's provenance lane is restored exactly once.
    const lanesAfter = await readStudentLanes(cast.primaryStudent.student.id);
    expect(lanesAfter.trial).toBe(lanesBefore.trial + 1);
    expect(lanesAfter.hifz).toBe(lanesBefore.hifz);

    // Exactly ONE override audit row, carrying the resolution, the refunded
    // amount under its outcome's own key, and the note's presence only.
    const audits = await readAuditsForSession(refundSession.id);
    expect(audits.map(row => row.actionType)).toEqual([AuditActionType.Override]);
    const auditDetails = arbitrationAuditDetails(audits[0]);
    expect(auditDetails.resolution).toBe(DisputeResolution.Refund);
    expect(auditDetails.refundAmount).toBe(FEE_AMOUNT);
    expect(auditDetails.notePresent).toBe(true);

    // The ledger: the original earning plus exactly ONE compensating
    // arbitration-reversal row (CR-4's dedicated clawback type),
    // session-keyed, completed, amount verbatim, traceable by its
    // reversal description.
    const ledgerRows = await readLedgerRowsForSession(refundSession.id);
    expect(ledgerRows.map(row => row.type).toSorted((a, b) => a.localeCompare(b))).toEqual(
      [TransactionType.Earning, TransactionType.ArbitrationReversal].toSorted((a, b) => a.localeCompare(b))
    );
    const ordered = ledgerRows.toSorted((a, b) => a.id - b.id);
    const compensating = ordered.at(-1);
    if (!compensating) {
      throw new Error("journey: expected the compensating ledger row to exist");
    }
    expect(compensating.amount).toBe(FEE_AMOUNT);
    expect(compensating.status).toBe(TransactionStatus.Completed);
    expect(compensating.sessionId).toBe(refundSession.id);
    expect(compensating.walletId).toBe(walletAfter.id);
    expect(compensating.description).toBe(`Dispute refund reversal — Session #${String(refundSession.id)}`);

    // The resolved wave reaches exactly the two participants — as inbox rows
    // and as ONE post-commit dispatch; the admins gain nothing.
    expect(
      await countDisputeNotifications(
        cast.primaryStudent.userId,
        NotificationType.SessionDisputeResolved,
        refundSession.id
      )
    ).toBe(1);
    expect(
      await countDisputeNotifications(cast.teacher.userId, NotificationType.SessionDisputeResolved, refundSession.id)
    ).toBe(1);
    expect(
      await countDisputeNotifications(cast.admin.userId, NotificationType.SessionDisputeResolved, refundSession.id)
    ).toBe(0);
    expect(
      await countDisputeNotifications(cast.parent.userId, NotificationType.SessionDisputeResolved, refundSession.id)
    ).toBe(0);
    expect(publicationCallCount()).toBe(publishBefore + 1);
    const published = publishedUserIds().slice(publishedIdsBefore);
    expect(published).toContain(cast.primaryStudent.userId);
    expect(published).toContain(cast.teacher.userId);
    expect(published).not.toContain(cast.admin.userId);
  });
});

// ─── Journey J2 — partial refund (the exact-amount boundary) ─────────────

describe("Journey J2 — PartialRefund on the 25.00 fee debits exactly 15.00", () => {
  test("the admin's PartialRefund resolution carries the exact amount string end-to-end", async () => {
    partialSession = await bookDualConfirmedConsumedSession(
      cast.primaryStudent.userId,
      cast.teacher.userId,
      KEY_PARTIAL
    );
    const walletBefore = await readTeacherWalletRow(cast.teacher.userId);
    const lanesBefore = await readStudentLanes(cast.primaryStudent.student.id);

    const disputed = await SessionArbitrationService.openPostConfirmationDispute(
      cast.primaryStudent.userId,
      partialSession.id,
      PARTIAL_DISPUTE_REASON,
      LOCALE
    );
    expect(disputed.status).toBe(SessionStatus.Disputed);

    const resolved = await SessionArbitrationService.arbitrateDispute(
      cast.admin.userId,
      partialSession.id,
      DisputeResolution.PartialRefund,
      PARTIAL_NOTE,
      PARTIAL_AMOUNT,
      LOCALE
    );

    expect(resolved.status).toBe(SessionStatus.Completed);
    expect(resolved.resolutionNote).toBe(PARTIAL_NOTE);
    expect(resolved.resolvedAt).not.toBeNull();

    // The wallet debited EXACTLY the partial amount — not the fee.
    const walletAfter = requiredWalletRow(
      await readTeacherWalletRow(cast.teacher.userId),
      "the partially refunded teacher"
    );
    expect(walletBalance(walletAfter) - walletBalance(walletBefore)).toBe(-Number(PARTIAL_AMOUNT));
    expect(walletTotal(walletAfter)).toBe(walletTotal(walletBefore));

    // The student's provenance lane is restored exactly once.
    const lanesAfter = await readStudentLanes(cast.primaryStudent.student.id);
    expect(lanesAfter.trial).toBe(lanesBefore.trial + 1);

    // The ledger: earning + exactly one compensating row of EXACTLY the
    // partial amount.
    const ledgerRows = await readLedgerRowsForSession(partialSession.id);
    expect(ledgerRows.map(row => row.type).toSorted((a, b) => a.localeCompare(b))).toEqual(
      [TransactionType.Earning, TransactionType.ArbitrationReversal].toSorted((a, b) => a.localeCompare(b))
    );
    const ordered = ledgerRows.toSorted((a, b) => a.id - b.id);
    const compensating = ordered.at(-1);
    if (!compensating) {
      throw new Error("journey: expected the compensating ledger row to exist");
    }
    expect(compensating.amount).toBe(PARTIAL_AMOUNT);

    // Exactly ONE override audit row whose details carry the resolution AND
    // the exact amount STRING under the partial outcome's own key (the
    // quoted match proves the decimal-string discipline survived persistence
    // — never a re-rounded number).
    const audits = await readAuditsForSession(partialSession.id);
    expect(audits.map(row => row.actionType)).toEqual([AuditActionType.Override]);
    const details = arbitrationAuditDetails(audits[0]);
    expect(details.resolution).toBe(DisputeResolution.PartialRefund);
    expect(details.partialAmount).toBe(PARTIAL_AMOUNT);
    expect(details.notePresent).toBe(true);
    expect(JSON.stringify(details)).toContain(`"${PARTIAL_AMOUNT}"`);

    // The resolved wave reaches exactly the two participants.
    expect(
      await countDisputeNotifications(
        cast.primaryStudent.userId,
        NotificationType.SessionDisputeResolved,
        partialSession.id
      )
    ).toBe(1);
    expect(
      await countDisputeNotifications(cast.teacher.userId, NotificationType.SessionDisputeResolved, partialSession.id)
    ).toBe(1);
  });
});

// ─── Journey J3 — uphold (zero financial writes) ──────────────────────────

describe("Journey J3 — Uphold completes the row with ZERO financial writes", () => {
  test("the admin's Uphold resolution moves status only; the audit row notes the uphold", async () => {
    upholdSession = await bookDualConfirmedConsumedSession(cast.primaryStudent.userId, cast.teacher.userId, KEY_UPHOLD);
    const walletBefore = await readTeacherWalletRow(cast.teacher.userId);
    const lanesBefore = await readStudentLanes(cast.primaryStudent.student.id);

    const disputed = await SessionArbitrationService.openPostConfirmationDispute(
      cast.primaryStudent.userId,
      upholdSession.id,
      "recorded as delivered",
      LOCALE
    );
    expect(disputed.status).toBe(SessionStatus.Disputed);

    const resolved = await SessionArbitrationService.arbitrateDispute(
      cast.admin.userId,
      upholdSession.id,
      DisputeResolution.Uphold,
      UPHOLD_NOTE,
      null,
      LOCALE
    );

    expect(resolved.status).toBe(SessionStatus.Completed);
    expect(resolved.resolutionNote).toBe(UPHOLD_NOTE);
    expect(resolved.resolvedAt).not.toBeNull();

    // ZERO financial writes: the wallet, the lifetime counter, the ledger,
    // and the student's lane are all byte-stable.
    const walletAfter = requiredWalletRow(await readTeacherWalletRow(cast.teacher.userId), "the upheld teacher");
    expect(walletBalance(walletAfter)).toBe(walletBalance(walletBefore));
    expect(walletTotal(walletAfter)).toBe(walletTotal(walletBefore));
    expect(await readLedgerRowsForSession(upholdSession.id)).toHaveLength(1);
    const lanesAfter = await readStudentLanes(cast.primaryStudent.student.id);
    expect(lanesAfter.trial).toBe(lanesBefore.trial);

    // Exactly ONE override audit row noting the uphold.
    const audits = await readAuditsForSession(upholdSession.id);
    expect(audits.map(row => row.actionType)).toEqual([AuditActionType.Override]);
    expect(arbitrationAuditDetails(audits[0]).resolution).toBe(DisputeResolution.Uphold);

    // Both participants are notified of the uphold.
    expect(
      await countDisputeNotifications(
        cast.primaryStudent.userId,
        NotificationType.SessionDisputeResolved,
        upholdSession.id
      )
    ).toBe(1);
    expect(
      await countDisputeNotifications(cast.teacher.userId, NotificationType.SessionDisputeResolved, upholdSession.id)
    ).toBe(1);
  });
});

// ─── Denials — the cross-actor matrix (observer perspective) ─────────────

describe("Denials — role, classification, and funds all fail closed with zero writes", () => {
  beforeAll(async () => {
    // The held-generation disputed row: booked → started → disputed through
    // the SHIPPED held-generation dispute path (fee still held, never
    // resolved) — the target for the role matrix and the held-side mismatch.
    const booked = await SessionLifecycleService.createSession(
      cast.primaryStudent.userId,
      { teacherId: cast.teacher.userId, intent: SessionIntent.Hifz },
      KEY_HELD,
      LOCALE
    );
    registry.track("session", booked.id);
    await trackIdempotencyClaim(KEY_HELD, KEY_HELD);
    await SessionLifecycleService.startSession(cast.teacher.userId, booked.id, LOCALE);
    heldRow = await SessionLifecycleService.openSessionDispute(
      cast.primaryStudent.userId,
      booked.id,
      HELD_DISPUTE_REASON,
      LOCALE
    );
    expect(heldRow.status).toBe(SessionStatus.Disputed);
    expect(heldRow.feeHeld).toBe(true);

    // The consumed row whose teacher wallet is emptied AFTER the credit:
    // dual-confirmed → the teacher withdraws the whole balance → the student
    // disputes. Stays disputed through both denial legs below.
    fundsSession = await bookDualConfirmedConsumedSession(
      cast.secondStudent.userId,
      cast.secondTeacher.userId,
      KEY_FUNDS
    );
    await WalletService.requestWithdrawal(cast.secondTeacher.userId, FEE_AMOUNT, LOCALE);
    const emptied = requiredWalletRow(await readTeacherWalletRow(cast.secondTeacher.userId), "the emptied teacher");
    expect(walletBalance(emptied)).toBe(0);
    const fundsDisputed = await SessionArbitrationService.openPostConfirmationDispute(
      cast.secondStudent.userId,
      fundsSession.id,
      FUNDS_DISPUTE_REASON,
      LOCALE
    );
    expect(fundsDisputed.status).toBe(SessionStatus.Disputed);
  });

  test("every non-admin resolve is byte-identical to the shared admin-gate 403, with zero writes", async () => {
    const heldBefore = await readSessionRow(heldRow.id);
    const auditBaselines = await Promise.all(
      [cast.teacher, cast.primaryStudent, cast.parent].map(member => countAuditLogsForActor(member.userId))
    );

    const matrix = await Promise.all(
      [cast.teacher, cast.primaryStudent, cast.parent].map(async member => ({
        role: member.user.role,
        reference: await expectServiceDenial("FORBIDDEN", errorTexts().forbidden, () =>
          SessionLifecycleService.resolveSessionDispute(
            member.userId,
            heldRow.id,
            DisputeResolution.Cancel,
            null,
            LOCALE
          )
        ),
        arbitration: await expectServiceDenial("FORBIDDEN", errorTexts().forbidden, () =>
          SessionArbitrationService.arbitrateDispute(
            member.userId,
            heldRow.id,
            DisputeResolution.Refund,
            null,
            null,
            LOCALE
          )
        ),
      }))
    );

    expect(matrix.map(entry => entry.role)).toEqual(["teacher", "student", "parent"]);
    for (const entry of matrix) {
      // The reference IS the canonical 403; the arbitration surface must
      // deny byte-identically (same class, same code, same localized copy).
      expect(entry.reference).toBeInstanceOf(ForbiddenError);
      expectDenialByteIdentical(entry.arbitration, entry.reference);
    }

    // Zero writes anywhere: the disputed row byte-identical, no audit rows
    // by any denied actor.
    expect(await readSessionRow(heldRow.id)).toEqual(heldBefore);
    const auditsAfter = await Promise.all(
      [cast.teacher, cast.primaryStudent, cast.parent].map(member => countAuditLogsForActor(member.userId))
    );
    expect(auditsAfter).toEqual(auditBaselines);
  });

  test("the classification mismatch denies both directions byte-identically (typed VALIDATION, zero writes)", async () => {
    // Refund family on a held row: the escrow class and the resolution
    // family disagree — the row is untouched.
    const heldBefore = await readSessionRow(heldRow.id);
    const refundOnHeld = await expectServiceDenial("VALIDATION", errorTexts().disputeResolutionMismatch, () =>
      SessionArbitrationService.arbitrateDispute(
        cast.admin.userId,
        heldRow.id,
        DisputeResolution.Refund,
        null,
        null,
        LOCALE
      )
    );
    expect(refundOnHeld).toBeInstanceOf(ValidationError);
    expect(await readSessionRow(heldRow.id)).toEqual(heldBefore);

    // Complete family on a consumed row: the same disagreement, the other
    // direction — the consumed row is untouched and stays disputed.
    const consumedBefore = await readSessionRow(fundsSession.id);
    const completeOnConsumed = await expectServiceDenial("VALIDATION", errorTexts().disputeResolutionMismatch, () =>
      SessionArbitrationService.arbitrateDispute(
        cast.admin.userId,
        fundsSession.id,
        DisputeResolution.Complete,
        null,
        null,
        LOCALE
      )
    );
    expect(completeOnConsumed).toBeInstanceOf(ValidationError);
    expectDenialByteIdentical(completeOnConsumed, refundOnHeld);
    expect(await readSessionRow(fundsSession.id)).toEqual(consumedBefore);
  });

  test("an emptied teacher wallet leaves the session disputed with the funds conflict", async () => {
    const emptied = requiredWalletRow(await readTeacherWalletRow(cast.secondTeacher.userId), "the emptied teacher");
    expect(walletBalance(emptied)).toBe(0);
    const rowBefore = await readSessionRow(fundsSession.id);
    const publishBefore = publicationCallCount();

    const denial = await expectServiceDenial("WALLET_INSUFFICIENT_FUNDS", errorTexts().insufficientBalance, () =>
      SessionArbitrationService.arbitrateDispute(
        cast.admin.userId,
        fundsSession.id,
        DisputeResolution.Refund,
        REFUND_NOTE,
        null,
        LOCALE
      )
    );
    expect(denial).toBeInstanceOf(ConflictError);

    // The session REMAINS disputed — the failed financial leg rolled the
    // whole arbitration back (status, note, stamps, and the row's stamp).
    const rowAfter = await readSessionRow(fundsSession.id);
    expect(rowAfter.status).toBe(SessionStatus.Disputed);
    expect(rowAfter.resolutionNote).toBeNull();
    expect(rowAfter.resolvedAt).toBeNull();
    expect(rowAfter).toEqual(rowBefore);

    // Zero financial movement, zero audit rows, zero notifications, zero
    // publishes — the denial committed nothing.
    const after = await readTeacherWalletRow(cast.secondTeacher.userId);
    expect(walletBalance(after)).toBe(walletBalance(emptied));
    expect(await readLedgerRowsForSession(fundsSession.id)).toHaveLength(1);
    expect(await readAuditsForSession(fundsSession.id)).toHaveLength(0);
    expect(
      await countDisputeNotifications(
        cast.secondStudent.userId,
        NotificationType.SessionDisputeResolved,
        fundsSession.id
      )
    ).toBe(0);
    expect(
      await countDisputeNotifications(
        cast.secondTeacher.userId,
        NotificationType.SessionDisputeResolved,
        fundsSession.id
      )
    ).toBe(0);
    expect(publicationCallCount()).toBe(publishBefore);
  });
});

// ─── Race — two concurrent arbitrations (real-PG posture) ────────────────

const testOnRealPostgres = isPgliteProvider() ? test.skip : test;

testOnRealPostgres(
  "Race — two admins arbitrate one disputed row: exactly one commit wins, the loser gets the state conflict",
  async () => {
    const raceSession = await bookDualConfirmedConsumedSession(
      cast.primaryStudent.userId,
      cast.teacher.userId,
      KEY_RACE
    );
    const disputed = await SessionArbitrationService.openPostConfirmationDispute(
      cast.primaryStudent.userId,
      raceSession.id,
      "the tutor ended the session twenty minutes early",
      LOCALE
    );
    expect(disputed.status).toBe(SessionStatus.Disputed);

    const walletBefore = await readTeacherWalletRow(cast.teacher.userId);
    const lanesBefore = await readStudentLanes(cast.primaryStudent.student.id);
    const publishBefore = publicationCallCount();

    const outcomes = await Promise.allSettled([
      SessionArbitrationService.arbitrateDispute(
        cast.admin.userId,
        raceSession.id,
        DisputeResolution.Refund,
        null,
        null,
        LOCALE
      ),
      SessionArbitrationService.arbitrateDispute(
        secondAdminUserId,
        raceSession.id,
        DisputeResolution.Refund,
        null,
        null,
        LOCALE
      ),
    ]);

    const fulfillments = outcomes.flatMap(outcome => (outcome.status === "fulfilled" ? [outcome.value] : []));
    const rejections = outcomes.flatMap(outcome => (outcome.status === "rejected" ? [outcome.reason] : []));
    expect(fulfillments).toHaveLength(1);
    expect(rejections).toHaveLength(1);
    expect(fulfillments[0]?.status).toBe(SessionStatus.Completed);
    expect(rejections[0]).toBeInstanceOf(DomainError);
    expect(rejections[0]).toBeInstanceOf(ConflictError);
    expect(denialCode(rejections[0])).toBe("SESSION_INVALID_TRANSITION");

    // Every financial artifact landed EXACTLY once: one fee debit, one
    // provenance-lane credit, one compensating ledger row, one audit row.
    const walletAfter = requiredWalletRow(await readTeacherWalletRow(cast.teacher.userId), "the race teacher");
    expect(walletBalance(walletAfter) - walletBalance(walletBefore)).toBe(-Number(FEE_AMOUNT));
    const lanesAfter = await readStudentLanes(cast.primaryStudent.student.id);
    expect(lanesAfter.trial - lanesBefore.trial).toBe(1);
    const ledgerRows = await readLedgerRowsForSession(raceSession.id);
    expect(ledgerRows.map(row => row.type).toSorted((a, b) => a.localeCompare(b))).toEqual(
      [TransactionType.Earning, TransactionType.ArbitrationReversal].toSorted((a, b) => a.localeCompare(b))
    );
    const audits = await readAuditsForSession(raceSession.id);
    expect(audits.map(row => row.actionType)).toEqual([AuditActionType.Override]);

    // Exactly one resolved wave reached the two participants.
    expect(
      await countDisputeNotifications(
        cast.primaryStudent.userId,
        NotificationType.SessionDisputeResolved,
        raceSession.id
      )
    ).toBe(1);
    expect(
      await countDisputeNotifications(cast.teacher.userId, NotificationType.SessionDisputeResolved, raceSession.id)
    ).toBe(1);
    expect(publicationCallCount()).toBe(publishBefore + 1);
  }
);
