/**
 * Cross-actor journey — the admin-ordered paid re-evaluation loop, from the
 * admin's fee-charging order through the five-session re-evaluation cycle to
 * the verdict that either re-certifies the teacher or stamps the cooldown.
 * Sequential actor-attributed steps execute against the REAL services on the
 * REAL test database; later steps observe the shared state earlier steps
 * committed.
 *
 * Journey steps:
 *   1. System provisions the cast: a governance-active Admin, a certified
 *      FUNDED Subject Teacher (wallet 500.00), a certified FUNDED fail-cast
 *      teacher (wallet 200.00), a certified LOW-BALANCE teacher (wallet
 *      40.00 < the 100.00 fee), and five distinct certified evaluators
 *      (is_evaluator=true); every subject teacher's applicants row is
 *      `passed` (the exact orderable pre-state).
 *   2. (a) Admin orders the re-evaluation → the receipt carries the verbatim
 *      "100.00" fee string + "EGP" + the post-debit "400.00" balance; exactly
 *      ONE withdrawal/completed ledger row (session_id NULL, the composed
 *      description), the teacher de-certified, the applicant re-opened
 *      `passed → in_evaluation` with a fresh anchor, exactly ONE
 *      override/teacher audit row with the composed details document, and
 *      `total_earning` UNCHANGED (a deduction spends the balance only).
 *   3. (b) The teacher books five evaluation sessions against the five
 *      distinct evaluators through the REAL booking service; the ceiling (5)
 *      is enforced — a sixth booking answers EVALUATION_LOOP_COMPLETE with
 *      zero new rows — and each booking publishes exactly one session_request
 *      receipt to ITS evaluator (foreign inboxes stay empty).
 *   4. (b) Four evaluators complete their sessions and submit passing
 *      rubrics: quorum 4/5 stays pending — no verdict writes, no fan-out.
 *   5. (b) The fifth submission finalizes PASS: the teacher's EXISTING row is
 *      re-certified (is_approved=true, no evaluator promotion), the applicant
 *      flips `passed` with a NULL cooldown, and exactly one evaluation_result
 *      notification is published to the teacher ONLY.
 *   6. (b′) The admin orders the fail-cast teacher (a second real charge).
 *   7. (b′) The fail cast books its own five-session cycle and completes it.
 *   8. (b′) Aggregation FAIL: one tajweed-79 poisons the cycle; the fifth
 *      submission finalizes `failed` with a cooldown ≈ now+30d while the
 *      teacher STAYS de-certified — no re-certification, no students row.
 *   9. (c) The low-balance teacher's order answers WALLET_INSUFFICIENT_FUNDS
 *      with the localized copy and ZERO committed rows (byte-identical state).
 *  10. (d) A REAL parent actor calling the service answers the governance
 *      FORBIDDEN denial with zero rows (the denial flows through the real
 *      admin gate — nothing monkey-patched).
 *  11. Tier 3 — after the loop re-certified the subject, two PARALLEL orders
 *      (`Promise.allSettled`) charge EXACTLY once (the guarded state flips
 *      arbitrate; the loser's executed debit rolls back); a follow-up order
 *      against the now-`in_evaluation` applicant answers
 *      APPLICANT_NOT_AWAITING_RE_EVALUATION with zero rows.
 *
 * Journey rules honored (`test/workflows/AGENTS.md`):
 * - fixtures COMMITTED in `beforeAll` (sanctioned cast provisioner + ONE
 *   committing transaction for the teachers, wallets, and evaluators); never
 *   `runInRollback` (the services own their transactions);
 * - honest actors: real `users` rows + real role-child rows; the denial probes
 *   run through the real service-level gates — nothing monkey-patched;
 * - external effects intercepted at the notification dispatch boundary: the
 *   engine's publish seam is SPIED and the steps assert which userIds each
 *   dispatch targeted — nothing reaches a real channel;
 * - error assertions through `catchJourneyError` + translated substrings —
 *   never `.rejects.toThrow()`, no hardcoded English strings;
 * - per-run `jrn_reeval_<8hex>` prefix on every reason/key/notes field;
 * - full cleanup per the Phase-4 teardown order: notifications sweep →
 *   immutable ledger+audit leg under `withImmutabilityTriggersSuspended(
 *   ["teacher_transaction","audit_logs"])` → tracked fixtures (wallet →
 *   applicants → teacher → users) → cast cleanup → zero-residue probes for
 *   every generated user id.
 *
 * Mandated runner: bun run test/scripts/run-test.ts test/workflows/teachers/admin-ordered-re-evaluation.journey.test.ts
 */

import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { and, eq, inArray, or } from "drizzle-orm";
import { db } from "@/backend/db";
import { auditLogs } from "@/backend/db/schema/audit/audit-logs";
import { teacherTransaction } from "@/backend/db/schema/billing/teacher-transaction";
import { wallet } from "@/backend/db/schema/billing/wallet";
import { session } from "@/backend/db/schema/classes/session";
import { sessionRequestIdempotency } from "@/backend/db/schema/classes/session-request-idempotency";
import { notifications } from "@/backend/db/schema/notifications/notifications";
import { parents } from "@/backend/db/schema/parents/parents";
import { students } from "@/backend/db/schema/students/students";
import { applicants } from "@/backend/db/schema/teachers/applicants";
import { evaluations } from "@/backend/db/schema/teachers/evaluations";
import { teacher } from "@/backend/db/schema/teachers/teacher";
import { admin } from "@/backend/db/schema/users/admin";
import { users } from "@/backend/db/schema/users/users";
import {
  createTestApplicant,
  createTestTeacherRow,
  createTestUser,
  createTestWallet,
} from "@/backend/db/test/entity-setup";
import { AuditActionType } from "@/backend/enum/audit/audit-action-type.enum";
import { TransactionStatus } from "@/backend/enum/billing/transaction-status.enum";
import { TransactionType } from "@/backend/enum/billing/transaction-type.enum";
import { NotificationType } from "@/backend/enum/notifications/notification-type.enum";
import { SessionIntent } from "@/backend/enum/scheduling/session-intent.enum";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import { SessionType } from "@/backend/enum/scheduling/session-type.enum";
import { ApplicantStatus } from "@/backend/enum/teachers/applicant-status.enum";
import { RubricWeaknessArea } from "@/backend/enum/teachers/rubric-weakness-area.enum";
import { ConflictError, ForbiddenError, type ValidationError } from "@/backend/lib/errors";
import { SessionLifecycleService } from "@/backend/services/classes/session-lifecycle.service";
import { NotificationEngine } from "@/backend/services/notifications";
import { TeacherReEvaluationService } from "@/backend/services/teachers";
import { EvaluationBookingService } from "@/backend/services/teachers/evaluation-booking.service";
import { EvaluationRubricService } from "@/backend/services/teachers/evaluation-rubric.service";
import type {
  DBTransaction,
  RubricEvaluationSubmitInput,
  SessionReturnType,
  TeacherReEvaluationOrderReturnType,
  UserSelectType,
} from "@/backend/types";
import { RE_EVALUATION_FEE, RE_EVALUATION_FEE_CURRENCY } from "@/shared/constants/re-evaluation.constants";
import { VERIFICATION_PLAN_SESSION_COUNT } from "@/shared/constants/verification-plan.constants";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import { withImmutabilityTriggersSuspended } from "@/test/helpers/db-cleanup";
import {
  catchJourneyError,
  createJourneyFixtures,
  type JourneyFixtureBundle,
  journeyCleanup,
  journeyPrefix,
  TrackedFixtures,
} from "@/test/workflows/helpers";

// ─── Harness state ───────────────────────────────────────────────────────────

/** Error-copy locale for every service call and denial assertion. */
const LOCALE = "en";

/** Translated error copy source — never hardcoded English expectation strings. */
const ERRORS_EN = getServerTranslations(LOCALE).errorsTranslations;

/** Per-run unique prefix — every reason/key/notes field derives from it. */
const PREFIX = journeyPrefix("reeval");

/** Milliseconds per day — the cooldown arithmetic mirror. */
const MS_PER_DAY = 86_400_000;
/** Journey-local mirror of the tajweed cooldown (the fail cast's verdict arm). */
const TAJWEED_COOLDOWN_MS = 30 * MS_PER_DAY;
/** Tolerance between the service's captured-now and the observation window. */
const CLOCK_SKEW_MS = 5_000;

/** Tracked fixture rows (teachers, wallets, sessions, claims, rubric rows). */
const tracked = new TrackedFixtures();

/**
 * The fan-out publish spy — installed over the engine's publish boundary (the
 * booking + rubric services publish post-commit through this exact
 * namespace-bound seam). Restored in `afterAll`.
 */
const publishSpy = spyOn(NotificationEngine, "publishReceipts").mockImplementation(async () => {});

/** Journey cast: the sanctioned provisioner bundle (admin/student/parent/…). */
let bundle: JourneyFixtureBundle | null = null;

/** The funded Subject Teacher (the (a)+(b)+Tier-3 protagonist) and its wallet. */
let subjectUserId = 0;
let subjectWalletId = 0;
/** The fail-cast teacher ((b′) protagonist) and its wallet. */
let failCastUserId = 0;
let failCastWalletId = 0;
/** The low-balance teacher ((c) protagonist) and its wallet. */
let lowBalanceUserId = 0;
let lowBalanceWalletId = 0;
/** A CERTIFIED teacher whose applicant row is `in_evaluation` — the deterministic re-order-wall probe. */
let inEvaluationUserId = 0;
let inEvaluationWalletId = 0;

/** Certified evaluators E1-E5 (real users + teacher rows, is_evaluator=true). */
const evaluatorIds: number[] = [];

/** Every wallet this journey created (the immutable-ledger teardown worklist). */
function allWalletIds(): number[] {
  return [subjectWalletId, failCastWalletId, lowBalanceWalletId, inEvaluationWalletId].filter(id => id > 0);
}

/** Every user id this journey generates (cast + teachers + evaluators). */
function allJourneyUserIds(): number[] {
  const castIds = bundle?.registry.userIds ?? [];
  return [...castIds, subjectUserId, failCastUserId, lowBalanceUserId, inEvaluationUserId, ...evaluatorIds].filter(
    id => id > 0
  );
}

/** Every teacher-entity id audit rows may name (the audit entity sweep worklist). */
function allTeacherEntityIds(): number[] {
  return [subjectUserId, failCastUserId, lowBalanceUserId, inEvaluationUserId, ...evaluatorIds].filter(id => id > 0);
}

/** The governance-active Admin actor (cast member). */
function adminId(): number {
  const id = bundle?.cast.admin.user.id ?? 0;
  if (id === 0) {
    throw new Error("journey state missing: the cast was not provisioned");
  }
  return id;
}

/** Narrows the cast bundle after `beforeAll` (null when provisioning aborted). */
function requireBundle(): JourneyFixtureBundle {
  if (bundle === null) {
    throw new Error("journey state missing: the cast was not provisioned");
  }
  return bundle;
}

/** The subject teacher's first-order cycle anchor (captured in step 2). */
let firstOrderAnchor: Date | null = null;
/** The subject teacher's first-order reason (the step-2 ledger description marker). */
let firstOrderReason = "";

/** The booked pass-cycle sessions, in booking order. */
const passCycleSessions: SessionReturnType[] = [];
/** The booked fail-cycle sessions, in booking order. */
const failCycleSessions: SessionReturnType[] = [];

// ─── Read-back oracles ───────────────────────────────────────────────────────

/** The applicant's row by user id, failing when absent. */
async function readApplicantRow(userId: number) {
  const rows = await db.select().from(applicants).where(eq(applicants.id, userId)).limit(1);
  const row = rows[0];
  if (!row) {
    throw new Error(`applicants row ${userId} vanished`);
  }
  return row;
}

/** The teacher's row by user id, failing when absent. */
async function readTeacherRow(userId: number) {
  const rows = await db.select().from(teacher).where(eq(teacher.id, userId)).limit(1);
  const row = rows[0];
  if (!row) {
    throw new Error(`teacher row ${userId} vanished`);
  }
  return row;
}

/** The user's wallet row by teacher user id (null when absent). */
async function readWalletRow(teacherUserId: number) {
  const rows = await db.select().from(wallet).where(eq(wallet.teacherId, teacherUserId)).limit(1);
  return rows[0] ?? null;
}

/** Fresh read of one users row by id (null when absent). */
async function readUserRow(userId: number): Promise<UserSelectType | null> {
  const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return rows[0] ?? null;
}

/** Ledger rows behind one teacher's wallet (joined through the wallet). */
async function ledgerRowsOfTeacher(teacherUserId: number) {
  const walletRow = await readWalletRow(teacherUserId);
  if (!walletRow) {
    throw new Error(`wallet row for teacher ${teacherUserId} vanished`);
  }
  return db.select().from(teacherTransaction).where(eq(teacherTransaction.walletId, walletRow.id));
}

/** Audit rows about one teacher ENTITY (entity_type='teacher'). */
async function auditRowsAboutTeacherTarget(targetId: number) {
  return db
    .select({
      id: auditLogs.id,
      actorId: auditLogs.actorId,
      actionType: auditLogs.actionType,
      entityType: auditLogs.entityType,
      entityId: auditLogs.entityId,
      details: auditLogs.details,
    })
    .from(auditLogs)
    .where(and(eq(auditLogs.entityType, "teacher"), eq(auditLogs.entityId, targetId)));
}

/** Audit rows attributed to the given ACTOR ids (the admin's audit counter). */
async function auditCountByActors(actorIds: readonly number[]): Promise<number> {
  if (actorIds.length === 0) {
    return 0;
  }
  return db.$count(auditLogs, inArray(auditLogs.actorId, [...actorIds]));
}

/** Inbox count for one user (independent read-back oracle). */
async function inboxCount(userId: number): Promise<number> {
  return db.$count(notifications, eq(notifications.userId, userId));
}

/**
 * The notification types widened to their primitive values — the DB column
 * infers a string union, so inbox-filter comparisons go through constants.
 */
const NOTIF_TYPE_EVALUATION_RESULT: string = NotificationType.EvaluationResult;
const NOTIF_TYPE_SESSION_REQUEST: string = NotificationType.SessionRequest;

/** The user's persisted inbox rows filtered to the evaluation-result type. */
async function evaluationResultRowsFor(userId: number) {
  const rows = await db.select().from(notifications).where(eq(notifications.userId, userId));
  return rows.filter(row => row.type === NOTIF_TYPE_EVALUATION_RESULT);
}

/** The user's persisted inbox rows filtered to the session-request type. */
async function sessionRequestRowsFor(userId: number) {
  const rows = await db.select().from(notifications).where(eq(notifications.userId, userId));
  return rows.filter(row => row.type === NOTIF_TYPE_SESSION_REQUEST);
}

/** Committed evaluation-session rows owned by one applicant (booking delta). */
async function evaluationSessionCount(applicantUserId: number): Promise<number> {
  return db.$count(
    session,
    and(eq(session.studentId, applicantUserId), eq(session.sessionType, SessionType.TeacherEvaluation))
  );
}

/** Number of `students` rows behind a user id — the conversion-absence probe. */
async function studentsRowCount(userId: number): Promise<number> {
  return db.$count(students, eq(students.id, userId));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Recipient user ids of one recorded publish call (the receipt fan-out
 * oracle) — the booking/rubric services publish their delivery receipts
 * through the spied seam strictly post-commit.
 */
function publishedRecipientIdsAt(callIndex: number): number[] {
  const call = publishSpy.mock.calls[callIndex];
  const receipts = call?.[0];
  if (!Array.isArray(receipts)) {
    throw new Error(`expected publish call ${callIndex} to carry an array of delivery receipts`);
  }
  const ids: number[] = [];
  for (const receipt of receipts) {
    const recipientUserIds = isRecord(receipt) ? receipt.recipientUserIds : undefined;
    if (Array.isArray(recipientUserIds) && recipientUserIds.every(value => typeof value === "number")) {
      ids.push(...recipientUserIds);
    }
  }
  return ids;
}

/** Prefix-stamped rubric notes — unique per run, well under the length ceiling. */
function rubricNotes(tag: string): string {
  return `${PREFIX} rubric notes ${tag}`;
}

/** A valid passing-score rubric payload (notes prefix-stamped, no weakness). */
function passingRubric(tag: string): RubricEvaluationSubmitInput {
  return { score: 90, notes: rubricNotes(tag), weaknessArea: null };
}

/**
 * Denial oracle — catches through the journey helper (never `rejects.toThrow`),
 * pins the DomainError class, the exact error code, and (when the copy already
 * exists in the errors namespace) the translated message substring.
 */
async function expectTypedDenial(
  fn: () => Promise<unknown>,
  errorClass: typeof ConflictError | typeof ForbiddenError | typeof ValidationError,
  code: string,
  translatedFragment?: string
): Promise<void> {
  const error = await catchJourneyError(fn);
  expect(error).toBeInstanceOf(errorClass);
  if (!(error instanceof errorClass)) {
    throw new Error(`expected a ${code} ${errorClass.name} denial`);
  }
  expect(error.code).toBe(code);
  if (translatedFragment !== undefined) {
    expect(error.message).toContain(translatedFragment);
  }
}

// ─── Zero-committed-rows oracle ──────────────────────────────────────────────

/** Byte-captured pre-state of one subject teacher (denial oracles). */
interface TeacherPreState {
  readonly balance: string;
  readonly totalEarning: string;
  readonly certified: boolean;
  readonly status: string;
  readonly anchorNull: boolean;
  readonly ledgerCount: number;
  readonly auditCount: number;
  readonly adminAuditCount: number;
}

/** Captures the byte-state a denial must leave unchanged. */
async function captureTeacherPreState(teacherUserId: number): Promise<TeacherPreState> {
  const [teacherRow, applicantRow, walletRow, ledgerRows, auditRows] = await Promise.all([
    readTeacherRow(teacherUserId),
    readApplicantRow(teacherUserId),
    readWalletRow(teacherUserId),
    ledgerRowsOfTeacher(teacherUserId),
    auditRowsAboutTeacherTarget(teacherUserId),
  ]);
  if (!walletRow) {
    throw new Error(`expected the wallet row of teacher ${teacherUserId}`);
  }
  return {
    balance: walletRow.balance,
    totalEarning: walletRow.totalEarning,
    certified: teacherRow.isApproved === true,
    status: applicantRow.status ?? "",
    anchorNull: applicantRow.reEvaluationStartedAt === null,
    ledgerCount: ledgerRows.length,
    auditCount: auditRows.length,
    adminAuditCount: await auditCountByActors([adminId()]),
  };
}

/** Asserts the captured pre-state survived a denial byte-identically. */
async function expectPreStateUnchanged(pre: TeacherPreState, teacherUserId: number): Promise<void> {
  const [teacherRow, applicantRow, walletRow, ledgerRows, auditRows] = await Promise.all([
    readTeacherRow(teacherUserId),
    readApplicantRow(teacherUserId),
    readWalletRow(teacherUserId),
    ledgerRowsOfTeacher(teacherUserId),
    auditRowsAboutTeacherTarget(teacherUserId),
  ]);
  expect(teacherRow.isApproved).toBe(pre.certified);
  expect(applicantRow.status).toBe(pre.status);
  expect(applicantRow.reEvaluationStartedAt === null).toBe(pre.anchorNull);
  expect(walletRow?.balance).toBe(pre.balance);
  expect(walletRow?.totalEarning).toBe(pre.totalEarning);
  expect(ledgerRows).toHaveLength(pre.ledgerCount);
  expect(auditRows).toHaveLength(pre.auditCount);
  expect(await auditCountByActors([adminId()])).toBe(pre.adminAuditCount);
}

// ─── Journey-step helpers ────────────────────────────────────────────────────

/**
 * Books one evaluator for the applicant through the REAL booking service,
 * asserts the scheduled evaluation-session shape, and registers the session
 * row + its verbatim-keyed claim for teardown.
 */
async function bookEvaluationTracked(
  applicantUserId: number,
  keyTag: string,
  evaluatorId: number
): Promise<SessionReturnType> {
  const key = `${PREFIX}-key-book-${keyTag}`;
  const booked = await EvaluationBookingService.bookEvaluation(applicantUserId, { evaluatorId }, key, LOCALE);
  expect(booked.teacherId).toBe(evaluatorId);
  expect(booked.studentId).toBe(applicantUserId);
  expect(booked.status).toBe(SessionStatus.Scheduled);
  expect(booked.sessionType).toBe(SessionType.TeacherEvaluation);
  expect(booked.intent).toBe(SessionIntent.Evaluation);
  tracked.register(session, booked.id);
  const claimRows = await db
    .select()
    .from(sessionRequestIdempotency)
    .where(eq(sessionRequestIdempotency.idempotencyKey, key));
  expect(claimRows).toHaveLength(1);
  expect(claimRows[0]?.sessionId).toBe(booked.id);
  for (const claimRow of claimRows) {
    tracked.register(sessionRequestIdempotency, claimRow.id);
  }
  return booked;
}

/**
 * Recursion body of `bookCycleTracked` — books the evaluator at `index`, then
 * recurses (a sequential booking order with no awaited loop, per the lint
 * rules).
 */
async function bookCycleFrom(
  applicantUserId: number,
  castTag: string,
  index: number,
  booked: readonly SessionReturnType[]
): Promise<SessionReturnType[]> {
  if (index >= evaluatorIds.length) {
    return [...booked];
  }
  const evaluatorId = evaluatorIds[index];
  const row = await bookEvaluationTracked(applicantUserId, `${castTag}-e${index + 1}`, evaluatorId);
  return bookCycleFrom(applicantUserId, castTag, index + 1, [...booked, row]);
}

/**
 * Books the five distinct certified evaluators for one applicant's cycle in
 * deterministic booking order, asserting evaluator distinctness.
 */
async function bookCycleTracked(applicantUserId: number, castTag: string): Promise<SessionReturnType[]> {
  const booked = await bookCycleFrom(applicantUserId, castTag, 0, []);
  expect(booked).toHaveLength(VERIFICATION_PLAN_SESSION_COUNT);
  expect(new Set(booked.map(row => row.teacherId)).size).toBe(VERIFICATION_PLAN_SESSION_COUNT);
  return booked;
}

/** Drives one evaluation session through the evaluator's start → complete pair. */
async function completeEvaluationSession(sessionRow: SessionReturnType): Promise<void> {
  const started = await SessionLifecycleService.startSession(sessionRow.teacherId, sessionRow.id, LOCALE);
  expect(started.status).toBe(SessionStatus.Started);
  expect(started.startedAt).not.toBeNull();

  const completed = await SessionLifecycleService.completeSession(sessionRow.teacherId, sessionRow.id, LOCALE);
  expect(completed.status).toBe(SessionStatus.Completed);
  expect(completed.confirmedByTeacherAt).not.toBeNull();
  expect(completed.feeHeld).toBe(false);
  expect(completed.endedAt).not.toBeNull();
}

/** Submits one rubric through the real service and tracks the committed row for teardown. */
async function submitRubricTracked(
  evaluatorUserId: number,
  sessionRow: SessionReturnType,
  input: RubricEvaluationSubmitInput
) {
  const result = await EvaluationRubricService.submitRubricEvaluation(evaluatorUserId, sessionRow.id, input, LOCALE);
  tracked.register(evaluations, result.id);
  return result;
}

// ─── Fixture provisioning ────────────────────────────────────────────────────

beforeAll(async () => {
  // Stage 1 — the sanctioned cast provisioner: real users + role-children in
  // ONE committing transaction (the governance-active Admin, the bystander
  // student/parent/applicant cast members).
  bundle = await createJourneyFixtures(PREFIX);

  // Stage 2 — ONE committing transaction for everything else the journey
  // needs: the four subject teachers (each certified + its own wallet and
  // applicant pre-state) and the five certified evaluators.
  await db.transaction(async (tx: DBTransaction) => {
    const buildSubjectTeacher = async (
      balance: string,
      totalEarning: string,
      applicantStatus: ApplicantStatus = ApplicantStatus.Passed
    ): Promise<{ userId: number; walletId: number }> => {
      const user = await createTestUser(tx, { role: "teacher" });
      const teacherRow = await createTestTeacherRow(tx, user.id, { isApproved: true, isEvaluator: false });
      const applicantRow = await createTestApplicant(tx, user.id, { status: applicantStatus });
      const walletRow = await createTestWallet(tx, user.id, { balance, totalEarning });
      tracked.register(users, user.id);
      tracked.register(teacher, teacherRow.id);
      tracked.register(applicants, applicantRow.id);
      tracked.register(wallet, walletRow.id);
      return { userId: user.id, walletId: walletRow.id };
    };

    const subject = await buildSubjectTeacher("500.00", "500.00");
    subjectUserId = subject.userId;
    subjectWalletId = subject.walletId;

    const failCast = await buildSubjectTeacher("200.00", "200.00");
    failCastUserId = failCast.userId;
    failCastWalletId = failCast.walletId;

    const lowBalance = await buildSubjectTeacher("40.00", "40.00");
    lowBalanceUserId = lowBalance.userId;
    lowBalanceWalletId = lowBalance.walletId;

    // Certified but already inside the loop — the deterministic
    // APPLICANT_NOT_AWAITING_RE_EVALUATION probe subject.
    const inEvaluation = await buildSubjectTeacher("0.00", "0.00", ApplicantStatus.InEvaluation);
    inEvaluationUserId = inEvaluation.userId;
    inEvaluationWalletId = inEvaluation.walletId;

    const provisionedEvaluators = await Promise.all(
      Array.from({ length: VERIFICATION_PLAN_SESSION_COUNT }, async (_, index) => {
        const user = await createTestUser(tx, { role: "teacher" });
        const evaluatorRow = await createTestTeacherRow(tx, user.id, { isApproved: true, isEvaluator: true });
        return { index, userId: user.id, teacherId: evaluatorRow.id };
      })
    );
    for (const evaluator of provisionedEvaluators) {
      evaluatorIds.push(evaluator.userId);
      tracked.register(users, evaluator.userId);
      tracked.register(teacher, evaluator.teacherId);
    }

    await tx.update(users).set({ locale: LOCALE }).where(inArray(users.id, allJourneyUserIds()));
  });

  // Fixture sanity: the wallet ids were committed and captured.
  expect(allWalletIds()).toHaveLength(4);
});

afterAll(async () => {
  publishSpy.mockRestore();
  const journeyIds = allJourneyUserIds();

  // Inbox sweep FIRST: every journey-created notification row disappears by
  // owner id, then the sweep is re-probed to zero (they would also cascade at
  // user delete — the explicit leg keeps the residue oracle unconditional).
  if (journeyIds.length > 0) {
    await db.delete(notifications).where(inArray(notifications.userId, journeyIds));
    const inboxResidue = await db.$count(notifications, inArray(notifications.userId, journeyIds));
    if (inboxResidue !== 0) {
      throw new Error(`journey teardown: ${inboxResidue} notification row(s) survived deletion`);
    }
  }

  // Immutable-ledger teardown leg (the Phase-4 teardown order): the
  // append-only `teacher_transaction` (wallet FK restrict) and `audit_logs`
  // (actor FK restrict) rows die FIRST, under the sanctioned trigger
  // suspension — then both sweeps are re-probed to zero.
  const walletIds = allWalletIds();
  await withImmutabilityTriggersSuspended(["teacher_transaction", "audit_logs"], async () => {
    if (walletIds.length > 0) {
      await db.delete(teacherTransaction).where(inArray(teacherTransaction.walletId, walletIds));
    }
    if (journeyIds.length > 0) {
      await db.delete(auditLogs).where(inArray(auditLogs.actorId, journeyIds));
      await db
        .delete(auditLogs)
        .where(and(eq(auditLogs.entityType, "teacher"), inArray(auditLogs.entityId, allTeacherEntityIds())));
    }
  });
  if (walletIds.length > 0) {
    const ledgerResidue = await db.$count(teacherTransaction, inArray(teacherTransaction.walletId, walletIds));
    if (ledgerResidue !== 0) {
      throw new Error(`journey teardown: ${ledgerResidue} teacher_transaction row(s) survived deletion`);
    }
  }
  if (journeyIds.length > 0) {
    const auditResidue = await db.$count(
      auditLogs,
      or(
        inArray(auditLogs.actorId, journeyIds),
        and(eq(auditLogs.entityType, "teacher"), inArray(auditLogs.entityId, allTeacherEntityIds()))
      )
    );
    if (auditResidue !== 0) {
      throw new Error(`journey teardown: ${auditResidue} audit_logs row(s) survived deletion`);
    }
  }

  // Reverse-registration-order hard delete + zero-residue re-probes for every
  // tracked row (claims → sessions → rubric rows → wallets → applicants →
  // teacher rows → teacher users).
  await tracked.cleanup();

  // Cast rows via the provisioner registry: audit-log sweep under suspended
  // triggers, role-children, then users. Skipped when the cast was never
  // provisioned (an aborted beforeAll leaves nothing behind).
  if (bundle !== null) {
    await journeyCleanup(bundle.registry);
  }

  // Post-teardown existence probes for EVERY generated user id — the residue
  // check is load-bearing, not advisory.
  if (journeyIds.length === 0) {
    return;
  }
  const [
    userResidue,
    applicantResidue,
    teacherResidue,
    studentResidue,
    parentResidue,
    adminResidue,
    walletResidue,
    sessionResidue,
    evaluationResidue,
    inboxResidue,
    ledgerResidue,
    auditResidue,
  ] = await Promise.all([
    db.$count(users, inArray(users.id, journeyIds)),
    db.$count(applicants, inArray(applicants.id, journeyIds)),
    db.$count(teacher, inArray(teacher.id, journeyIds)),
    db.$count(students, inArray(students.id, journeyIds)),
    db.$count(parents, inArray(parents.id, journeyIds)),
    db.$count(admin, inArray(admin.id, journeyIds)),
    db.$count(wallet, inArray(wallet.teacherId, journeyIds)),
    db.$count(session, or(inArray(session.studentId, journeyIds), inArray(session.teacherId, journeyIds))),
    db.$count(
      evaluations,
      or(inArray(evaluations.evaluatedId, journeyIds), inArray(evaluations.evaluatorId, journeyIds))
    ),
    db.$count(notifications, inArray(notifications.userId, journeyIds)),
    // Ledger residue joins through the wallet; the wallets are already gone,
    // so the subquery returns no ids and the probe short-circuits to zero.
    (async () => {
      const remainingWalletIds = (
        await db.select({ id: wallet.id }).from(wallet).where(inArray(wallet.teacherId, journeyIds))
      ).map(row => row.id);
      if (remainingWalletIds.length === 0) {
        return 0;
      }
      return db.$count(teacherTransaction, inArray(teacherTransaction.walletId, remainingWalletIds));
    })(),
    db.$count(
      auditLogs,
      or(
        inArray(auditLogs.actorId, journeyIds),
        and(eq(auditLogs.entityType, "teacher"), inArray(auditLogs.entityId, journeyIds))
      )
    ),
  ]);
  expect(userResidue).toBe(0);
  expect(applicantResidue).toBe(0);
  expect(teacherResidue).toBe(0);
  expect(studentResidue).toBe(0);
  expect(parentResidue).toBe(0);
  expect(adminResidue).toBe(0);
  expect(walletResidue).toBe(0);
  expect(sessionResidue).toBe(0);
  expect(evaluationResidue).toBe(0);
  expect(inboxResidue).toBe(0);
  expect(ledgerResidue).toBe(0);
  expect(auditResidue).toBe(0);
});

// ─── The journey ─────────────────────────────────────────────────────────────

describe("admin-ordered paid re-evaluation — cross-actor journey", () => {
  test("step 1 — System: committed cast with honest roles and wallets; every surface starts clean", async () => {
    // The governance-active Admin: a real admin-role user, governance-clean.
    const adminUser = await readUserRow(adminId());
    if (!adminUser) {
      throw new Error("expected the admin cast member's users row");
    }
    expect(adminUser.role).toBe("admin");
    expect(adminUser.isDeleted).toBe(false);
    expect(adminUser.isBlocked).toBe(false);
    expect(adminUser.suspended).toBe(false);

    // The funded Subject Teacher: certified, passed, wallet 500.00/500.00.
    const subjectTeacherRow = await readTeacherRow(subjectUserId);
    expect(subjectTeacherRow.isApproved).toBe(true);
    expect(subjectTeacherRow.isEvaluator).toBe(false);
    const subjectApplicantRow = await readApplicantRow(subjectUserId);
    expect(subjectApplicantRow.status).toBe(ApplicantStatus.Passed);
    expect(subjectApplicantRow.reEvaluationStartedAt).toBeNull();
    expect(subjectApplicantRow.cooldownUntil).toBeNull();
    const subjectWalletRow = await readWalletRow(subjectUserId);
    expect(subjectWalletRow?.balance).toBe("500.00");
    expect(subjectWalletRow?.totalEarning).toBe("500.00");

    // The fail-cast teacher: certified + passed + funded 200.00.
    expect((await readTeacherRow(failCastUserId)).isApproved).toBe(true);
    expect((await readApplicantRow(failCastUserId)).status).toBe(ApplicantStatus.Passed);
    expect((await readWalletRow(failCastUserId))?.balance).toBe("200.00");

    // The low-balance teacher: certified + passed + 40.00 (< the 100.00 fee).
    expect((await readTeacherRow(lowBalanceUserId)).isApproved).toBe(true);
    expect((await readApplicantRow(lowBalanceUserId)).status).toBe(ApplicantStatus.Passed);
    expect((await readWalletRow(lowBalanceUserId))?.balance).toBe("40.00");

    // The re-order-wall probe: certified row + an applicant already inside
    // the loop.
    expect((await readTeacherRow(inEvaluationUserId)).isApproved).toBe(true);
    expect((await readApplicantRow(inEvaluationUserId)).status).toBe(ApplicantStatus.InEvaluation);
    expect((await readWalletRow(inEvaluationUserId))?.balance).toBe("0.00");

    // The five evaluators hold REAL certified-evaluator teacher rows.
    const evaluatorRows = await db.select().from(teacher).where(inArray(teacher.id, evaluatorIds));
    expect(evaluatorRows).toHaveLength(VERIFICATION_PLAN_SESSION_COUNT);
    for (const evaluatorRow of evaluatorRows) {
      expect(evaluatorRow.isApproved).toBe(true);
      expect(evaluatorRow.isEvaluator).toBe(true);
    }

    // Clean slate everywhere the journey asserts deltas.
    expect(await ledgerRowsOfTeacher(subjectUserId)).toHaveLength(0);
    expect(await auditRowsAboutTeacherTarget(subjectUserId)).toHaveLength(0);
    expect(await auditCountByActors([adminId()])).toBe(0);
    expect(await evaluationSessionCount(subjectUserId)).toBe(0);
    expect(await inboxCount(subjectUserId)).toBe(0);
    const foreignProbeIds = [
      requireBundle().cast.student.user.id,
      requireBundle().cast.parent.user.id,
      ...evaluatorIds,
    ];
    const foreignInboxes = await Promise.all(foreignProbeIds.map(id => inboxCount(id)));
    expect(foreignInboxes).toEqual(foreignProbeIds.map(() => 0));
    expect(publishSpy.mock.calls).toHaveLength(0);
  });

  test("step 2 — (a) Admin orders: ONE charge, de-certification, re-open with a fresh anchor, ONE audit row, total_earning untouched", async () => {
    const reason = `${PREFIX} certification lapse`;
    const windowStart = Date.now();

    const receipt: TeacherReEvaluationOrderReturnType = await TeacherReEvaluationService.orderReEvaluation(
      adminId(),
      { teacherId: subjectUserId, reason },
      LOCALE
    );
    const windowEnd = Date.now();

    // The receipt: verbatim money strings, the post-debit balance, the anchor.
    expect(receipt.teacherId).toBe(subjectUserId);
    expect(receipt.amountCharged).toBe(RE_EVALUATION_FEE);
    expect(typeof receipt.amountCharged).toBe("string");
    expect(receipt.currency).toBe(RE_EVALUATION_FEE_CURRENCY);
    expect(receipt.walletBalance).toBe("400.00");
    expect(receipt.reEvaluationStartedAt.getTime()).toBeGreaterThanOrEqual(windowStart - CLOCK_SKEW_MS);
    expect(receipt.reEvaluationStartedAt.getTime()).toBeLessThanOrEqual(windowEnd + CLOCK_SKEW_MS);
    firstOrderAnchor = receipt.reEvaluationStartedAt;
    firstOrderReason = reason;

    // The wallet: balance 500 → 400, total_earning UNCHANGED.
    const walletRow = await readWalletRow(subjectUserId);
    expect(walletRow?.balance).toBe("400.00");
    expect(walletRow?.totalEarning).toBe("500.00");

    // Exactly ONE withdrawal/completed ledger row, session-less, with the
    // composed description marker.
    const ledgerRows = await ledgerRowsOfTeacher(subjectUserId);
    expect(ledgerRows).toHaveLength(1);
    const ledgerRow = ledgerRows.at(0);
    if (!ledgerRow) {
      throw new Error("expected the fee ledger row");
    }
    expect(ledgerRow.type).toBe(TransactionType.Withdrawal);
    expect(ledgerRow.status).toBe(TransactionStatus.Completed);
    expect(ledgerRow.amount).toBe(RE_EVALUATION_FEE);
    expect(ledgerRow.sessionId).toBeNull();
    expect(ledgerRow.description).toBe(`Re-evaluation fee: ${reason}`);

    // The teacher was de-certified; the applicant was re-opened with the
    // receipt's anchor and no cooldown.
    expect((await readTeacherRow(subjectUserId)).isApproved).toBe(false);
    const applicantRow = await readApplicantRow(subjectUserId);
    expect(applicantRow.status).toBe(ApplicantStatus.InEvaluation);
    expect(applicantRow.reEvaluationStartedAt).not.toBeNull();
    expect(applicantRow.cooldownUntil).toBeNull();
    const anchorFromDb = applicantRow.reEvaluationStartedAt;
    if (!anchorFromDb) {
      throw new Error("expected the committed cycle anchor");
    }
    expect(Math.abs(anchorFromDb.getTime() - receipt.reEvaluationStartedAt.getTime())).toBeLessThanOrEqual(
      CLOCK_SKEW_MS
    );

    // Exactly ONE audit row: override/teacher, attributed to the acting
    // admin, carrying the composed details document (never the reason text).
    const auditRows = await auditRowsAboutTeacherTarget(subjectUserId);
    expect(auditRows).toHaveLength(1);
    const auditRow = auditRows.at(0);
    if (!auditRow) {
      throw new Error("expected the order audit row");
    }
    expect(auditRow.actorId).toBe(adminId());
    expect(auditRow.actionType).toBe(AuditActionType.Override);
    expect(auditRow.entityType).toBe("teacher");
    expect(auditRow.entityId).toBe(subjectUserId);
    if (typeof auditRow.details !== "string") {
      throw new Error("expected the audit details payload");
    }
    const details: unknown = JSON.parse(auditRow.details);
    if (!isRecord(details)) {
      throw new Error("expected a record-shaped details document");
    }
    expect(details.action).toBe("re_evaluation_ordered");
    expect(details.amount).toBe(RE_EVALUATION_FEE);
    expect(details.walletId).toBe(subjectWalletId);
    expect(details.balanceAfter).toBe("400.00");
    expect(details.reEvaluationStartedAt).toBe(receipt.reEvaluationStartedAt.toISOString());

    // No fan-out — the order writes no notification rows and publishes
    // nothing.
    expect(await inboxCount(subjectUserId)).toBe(0);
    expect(publishSpy.mock.calls).toHaveLength(0);
  });

  test("step 3 — (b) Teacher books E1-E5 (distinct evaluators, ceiling 5 enforced); each booking waves ITS evaluator only", async () => {
    const publishesBefore = publishSpy.mock.calls.length;
    const anchor = firstOrderAnchor;
    if (!anchor) {
      throw new Error("journey state: the step-2 anchor is missing");
    }

    const booked = await bookCycleTracked(subjectUserId, "a");
    passCycleSessions.push(...booked);

    // The re-evaluation anchor opened the cycle: 5 booked, 0 remaining, the
    // cycle start IS the anchor.
    const loopStatus = await EvaluationBookingService.myEvaluationLoopStatus(subjectUserId, LOCALE);
    expect(loopStatus.bookedCount).toBe(VERIFICATION_PLAN_SESSION_COUNT);
    expect(loopStatus.remainingCredits).toBe(0);
    expect(loopStatus.cycleStartDate).not.toBeNull();
    expect(Math.abs((loopStatus.cycleStartDate?.getTime() ?? 0) - anchor.getTime())).toBeLessThanOrEqual(CLOCK_SKEW_MS);

    // The ceiling: a SIXTH booking while the five live sessions are uncompleted
    // answers the credits-exhausted conflict with zero new rows (capacity
    // fires before evaluator distinctness, so any evaluator id probes it).
    const sessionsBefore = await evaluationSessionCount(subjectUserId);
    await expectTypedDenial(
      () =>
        EvaluationBookingService.bookEvaluation(
          subjectUserId,
          { evaluatorId: evaluatorIds[0] ?? 0 },
          `${PREFIX}-key-book-a-e6`,
          LOCALE
        ),
      ConflictError,
      "NO_EVALUATION_CREDITS_REMAINING",
      ERRORS_EN.noEvaluationCreditsRemaining
    );
    expect(await evaluationSessionCount(subjectUserId)).toBe(sessionsBefore);

    // Each booking published exactly ONE session_request receipt to ITS
    // evaluator, strictly post-commit (sequential bookings — call order
    // matches booking order).
    expect(publishSpy.mock.calls).toHaveLength(publishesBefore + VERIFICATION_PLAN_SESSION_COUNT);
    for (let index = 0; index < VERIFICATION_PLAN_SESSION_COUNT; index += 1) {
      expect(publishedRecipientIdsAt(publishesBefore + index)).toEqual([evaluatorIds[index]]);
    }

    // The evaluator inboxes each hold exactly one session_request row; the
    // foreign cast inboxes stay empty.
    const evaluatorInboxes = await Promise.all(evaluatorIds.map(id => sessionRequestRowsFor(id)));
    for (const rows of evaluatorInboxes) {
      expect(rows).toHaveLength(1);
    }
    const foreignProbeIds = [requireBundle().cast.student.user.id, requireBundle().cast.parent.user.id];
    const foreignInboxes = await Promise.all(foreignProbeIds.map(id => inboxCount(id)));
    expect(foreignInboxes).toEqual(foreignProbeIds.map(() => 0));
  });

  test("step 4 — (b) Four evaluators complete + submit: quorum 4/5 stays pending with zero verdict writes", async () => {
    const applicantRowBefore = await readApplicantRow(subjectUserId);

    // E1-E4 drive start → complete on their sessions (E5's stays scheduled).
    const completedSessions = passCycleSessions.slice(0, VERIFICATION_PLAN_SESSION_COUNT - 1);
    await Promise.all(completedSessions.map(sessionRow => completeEvaluationSession(sessionRow)));

    // Four passing rubrics — the 80 boundary included. No verdict yet.
    const scores = [92, 85, 80, 100];
    const results = await Promise.all(
      completedSessions.map((sessionRow, index) =>
        submitRubricTracked(sessionRow.teacherId, sessionRow, {
          score: scores[index] ?? 0,
          notes: rubricNotes(`pass-e${index + 1}`),
          weaknessArea: null,
        })
      )
    );
    for (const result of results) {
      expect(result.applicantStatus).toBe(ApplicantStatus.InEvaluation);
      expect(result.evaluatedId).toBe(subjectUserId);
    }

    // Quorum pending: no verdict writes of any kind, no result fan-out.
    const applicantRow = await readApplicantRow(subjectUserId);
    expect(applicantRow.status).toBe(ApplicantStatus.InEvaluation);
    expect(applicantRow.cooldownUntil).toBeNull();
    expect((await readTeacherRow(subjectUserId)).isApproved).toBe(false);
    expect(await studentsRowCount(subjectUserId)).toBe(0);
    expect(await evaluationResultRowsFor(subjectUserId)).toHaveLength(0);
    expect(applicantRow.reEvaluationStartedAt?.getTime()).toBe(applicantRowBefore.reEvaluationStartedAt?.getTime());
  });

  test("step 5 — (b) The fifth submission finalizes PASS: the EXISTING row is re-certified, status passed, one result notification", async () => {
    const fifthSession = passCycleSessions.at(-1);
    if (!fifthSession) {
      throw new Error("journey state: the fifth pass-cycle session is missing");
    }

    // E5 completes her session last; with ALL five sessions completed and the
    // applicant still in_evaluation, a further booking answers the
    // congratulatory loop-complete conflict (the second ceiling arm) with
    // zero new rows.
    await completeEvaluationSession(fifthSession);
    const sessionsBefore = await evaluationSessionCount(subjectUserId);
    await expectTypedDenial(
      () =>
        EvaluationBookingService.bookEvaluation(
          subjectUserId,
          { evaluatorId: evaluatorIds[0] ?? 0 },
          `${PREFIX}-key-book-a-e6-complete`,
          LOCALE
        ),
      ConflictError,
      "EVALUATION_LOOP_COMPLETE",
      ERRORS_EN.evaluationLoopComplete
    );
    expect(await evaluationSessionCount(subjectUserId)).toBe(sessionsBefore);

    const publishesBefore = publishSpy.mock.calls.length;

    const result = await submitRubricTracked(fifthSession.teacherId, fifthSession, {
      score: 85,
      notes: rubricNotes("pass-e5-verdict"),
      weaknessArea: null,
    });
    expect(result.applicantStatus).toBe(ApplicantStatus.Passed);
    expect(result.sessionId).toBe(fifthSession.id);

    // The verdict writes: passed + NULL cooldown + the re-certified EXISTING
    // teacher row (no evaluator promotion, no students row, no suspension).
    const applicantRow = await readApplicantRow(subjectUserId);
    expect(applicantRow.status).toBe(ApplicantStatus.Passed);
    expect(applicantRow.cooldownUntil).toBeNull();
    const teacherRow = await readTeacherRow(subjectUserId);
    expect(teacherRow.isApproved).toBe(true);
    expect(teacherRow.isEvaluator).toBe(false);
    expect(await studentsRowCount(subjectUserId)).toBe(0);
    const userRow = await readUserRow(subjectUserId);
    if (!userRow) {
      throw new Error("expected the subject's users row to survive finalization");
    }
    expect(userRow.suspended).toBe(false);

    // Exactly ONE evaluation_result notification in the teacher's inbox,
    // published strictly post-commit to the teacher ONLY.
    const resultRows = await evaluationResultRowsFor(subjectUserId);
    expect(resultRows).toHaveLength(1);
    expect(resultRows[0]?.relatedEntityType).toBe("session");
    expect(resultRows[0]?.relatedEntityId).toBe(fifthSession.id);
    expect(publishSpy.mock.calls).toHaveLength(publishesBefore + 1);
    expect(publishedRecipientIdsAt(publishesBefore)).toEqual([subjectUserId]);
  });

  test("step 6 — (b′) Admin orders the fail-cast teacher: a second real charge with the same single-charge state machine", async () => {
    const reason = `${PREFIX} fail-cast recertification`;
    const adminAuditBefore = await auditCountByActors([adminId()]);

    const receipt = await TeacherReEvaluationService.orderReEvaluation(
      adminId(),
      { teacherId: failCastUserId, reason },
      LOCALE
    );
    expect(receipt.teacherId).toBe(failCastUserId);
    expect(receipt.amountCharged).toBe(RE_EVALUATION_FEE);
    expect(receipt.walletBalance).toBe("100.00");

    const walletRow = await readWalletRow(failCastUserId);
    expect(walletRow?.balance).toBe("100.00");
    expect(walletRow?.totalEarning).toBe("200.00");

    const ledgerRows = await ledgerRowsOfTeacher(failCastUserId);
    expect(ledgerRows).toHaveLength(1);
    expect(ledgerRows.at(0)?.type).toBe(TransactionType.Withdrawal);
    expect(ledgerRows.at(0)?.status).toBe(TransactionStatus.Completed);
    expect(ledgerRows.at(0)?.sessionId).toBeNull();
    expect(ledgerRows.at(0)?.description).toBe(`Re-evaluation fee: ${reason}`);

    expect((await readTeacherRow(failCastUserId)).isApproved).toBe(false);
    const applicantRow = await readApplicantRow(failCastUserId);
    expect(applicantRow.status).toBe(ApplicantStatus.InEvaluation);
    expect(applicantRow.reEvaluationStartedAt).not.toBeNull();

    const auditRows = await auditRowsAboutTeacherTarget(failCastUserId);
    expect(auditRows).toHaveLength(1);
    expect(auditRows.at(0)?.actorId).toBe(adminId());
    expect(await auditCountByActors([adminId()])).toBe(adminAuditBefore + 1);
    expect(await inboxCount(failCastUserId)).toBe(0);
  });

  test("step 7 — (b′) The fail cast books its own five-session cycle against the same evaluators and completes it", async () => {
    const booked = await bookCycleTracked(failCastUserId, "b");
    failCycleSessions.push(...booked);

    // Distinctness is per (applicant, cycle): reusing E1-E5 for the fail
    // cast's OWN cycle is legal.
    const loopStatus = await EvaluationBookingService.myEvaluationLoopStatus(failCastUserId, LOCALE);
    expect(loopStatus.bookedCount).toBe(VERIFICATION_PLAN_SESSION_COUNT);
    expect(loopStatus.remainingCredits).toBe(0);

    await Promise.all(failCycleSessions.map(sessionRow => completeEvaluationSession(sessionRow)));
    for (const sessionRow of failCycleSessions) {
      expect(sessionRow.studentId).toBe(failCastUserId);
    }
  });

  test("step 8 — (b′) Aggregation FAIL: the tajweed-79 poisons the cycle — cooldown ≈ now+30d and the teacher STAYS de-certified", async () => {
    const publishesBefore = publishSpy.mock.calls.length;

    // E1 records the failing tajweed-79; the cycle is still pending.
    const firstSession = failCycleSessions[0];
    if (!firstSession) {
      throw new Error("journey state: the fail-cast first session is missing");
    }
    const firstResult = await submitRubricTracked(firstSession.teacherId, firstSession, {
      score: 79,
      notes: rubricNotes("fail-e1"),
      weaknessArea: RubricWeaknessArea.Tajweed,
    });
    expect(firstResult.applicantStatus).toBe(ApplicantStatus.InEvaluation);
    expect((await readApplicantRow(failCastUserId)).cooldownUntil).toBeNull();

    // E2-E4 record passing scores — quorum 4/5, still pending.
    const passingResults = await Promise.all(
      failCycleSessions
        .slice(1, 4)
        .map(sessionRow => submitRubricTracked(sessionRow.teacherId, sessionRow, passingRubric("fail-pass")))
    );
    for (const result of passingResults) {
      expect(result.applicantStatus).toBe(ApplicantStatus.InEvaluation);
    }

    // The fifth submission finalizes the aggregation verdict: FAIL.
    const fifthSession = failCycleSessions.at(-1);
    if (!fifthSession) {
      throw new Error("journey state: the fail-cast fifth session is missing");
    }
    const windowStart = Date.now();
    const verdict = await submitRubricTracked(fifthSession.teacherId, fifthSession, {
      score: 88,
      notes: rubricNotes("fail-e5-verdict"),
      weaknessArea: null,
    });
    const windowEnd = Date.now();
    expect(verdict.applicantStatus).toBe(ApplicantStatus.Failed);

    // The verdict writes: failed + the 30-day tajweed cooldown captured from
    // the fifth submission's transaction window.
    const applicantRow = await readApplicantRow(failCastUserId);
    expect(applicantRow.status).toBe(ApplicantStatus.Failed);
    const cooldownUntil = applicantRow.cooldownUntil;
    if (!cooldownUntil) {
      throw new Error("expected the failed cycle to carry a cooldown stamp");
    }
    expect(cooldownUntil.getTime()).toBeGreaterThanOrEqual(windowStart + TAJWEED_COOLDOWN_MS - CLOCK_SKEW_MS);
    expect(cooldownUntil.getTime()).toBeLessThanOrEqual(windowEnd + TAJWEED_COOLDOWN_MS + CLOCK_SKEW_MS);

    // The teacher STAYS de-certified — the FAIL verdict re-certifies nothing.
    expect((await readTeacherRow(failCastUserId)).isApproved).toBe(false);
    expect(await studentsRowCount(failCastUserId)).toBe(0);
    const userRow = await readUserRow(failCastUserId);
    if (!userRow) {
      throw new Error("expected the fail-cast user row to survive finalization");
    }
    expect(userRow.suspended).toBe(false);

    // Exactly ONE fail-flavored evaluation_result notification, published
    // post-commit to the failed teacher ONLY.
    const resultRows = await evaluationResultRowsFor(failCastUserId);
    expect(resultRows).toHaveLength(1);
    expect(publishSpy.mock.calls).toHaveLength(publishesBefore + 1);
    expect(publishedRecipientIdsAt(publishesBefore)).toEqual([failCastUserId]);
  });

  test("step 9 — (c) Low-balance teacher: WALLET_INSUFFICIENT_FUNDS with the localized copy and ZERO committed rows", async () => {
    const pre = await captureTeacherPreState(lowBalanceUserId);
    expect(pre.balance).toBe("40.00");
    expect(pre.certified).toBe(true);
    expect(pre.status).toBe(ApplicantStatus.Passed);

    await expectTypedDenial(
      () =>
        TeacherReEvaluationService.orderReEvaluation(
          adminId(),
          { teacherId: lowBalanceUserId, reason: `${PREFIX} low-balance probe` },
          LOCALE
        ),
      ConflictError,
      "WALLET_INSUFFICIENT_FUNDS",
      ERRORS_EN.insufficientBalance
    );

    // Zero committed rows: byte-identical state (no ledger, no
    // de-certification, no status/anchor move, no audit row).
    await expectPreStateUnchanged(pre, lowBalanceUserId);
  });

  test("step 10 — (d) A REAL parent actor is denied by the governance gate with zero rows", async () => {
    const parentUserId = requireBundle().cast.parent.user.id;
    const parentAuditBefore = await auditCountByActors([parentUserId]);
    const pre = await captureTeacherPreState(lowBalanceUserId);

    await expectTypedDenial(
      () =>
        TeacherReEvaluationService.orderReEvaluation(
          parentUserId,
          { teacherId: lowBalanceUserId, reason: `${PREFIX} non-admin probe` },
          LOCALE
        ),
      ForbiddenError,
      "FORBIDDEN",
      ERRORS_EN.forbidden
    );

    // The denial flowed through the real admin gate: the subject's state is
    // byte-identical and the probe actor wrote no audit rows.
    await expectPreStateUnchanged(pre, lowBalanceUserId);
    expect(await auditCountByActors([parentUserId])).toBe(parentAuditBefore);
  });

  test("step 11 — Tier 3: two PARALLEL orders charge exactly once; an in_evaluation applicant answers APPLICANT_NOT_AWAITING_RE_EVALUATION", async () => {
    // The subject was re-certified by the step-5 verdict: orderable again,
    // with exactly the post-first-order balance.
    expect((await readTeacherRow(subjectUserId)).isApproved).toBe(true);
    expect((await readApplicantRow(subjectUserId)).status).toBe(ApplicantStatus.Passed);
    expect((await readWalletRow(subjectUserId))?.balance).toBe("400.00");
    const anchorBefore = firstOrderAnchor;
    if (!anchorBefore) {
      throw new Error("journey state: the step-2 anchor is missing");
    }

    // Two concurrent orders (independent top-level transactions): the guarded
    // state flips arbitrate — exactly one charge, the loser's executed debit
    // rolls back with its typed conflict.
    const reasonA = `${PREFIX} parallel order A`;
    const reasonB = `${PREFIX} parallel order B`;
    const settled = await Promise.allSettled([
      TeacherReEvaluationService.orderReEvaluation(adminId(), { teacherId: subjectUserId, reason: reasonA }, LOCALE),
      TeacherReEvaluationService.orderReEvaluation(adminId(), { teacherId: subjectUserId, reason: reasonB }, LOCALE),
    ]);
    const fulfilled = settled.filter(
      (entry): entry is PromiseFulfilledResult<TeacherReEvaluationOrderReturnType> => entry.status === "fulfilled"
    );
    const rejected = settled.filter((entry): entry is PromiseRejectedResult => entry.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const winningReceipt = fulfilled[0]?.value;
    if (!winningReceipt) {
      throw new Error("expected the race winner's receipt");
    }
    expect(winningReceipt.amountCharged).toBe(RE_EVALUATION_FEE);
    expect(winningReceipt.currency).toBe(RE_EVALUATION_FEE_CURRENCY);
    expect(winningReceipt.walletBalance).toBe("300.00");

    const loserReason: unknown = rejected[0]?.reason;
    expect(loserReason).toBeInstanceOf(ConflictError);
    if (loserReason instanceof ConflictError) {
      expect(["TEACHER_NOT_CERTIFIED", "APPLICANT_NOT_AWAITING_RE_EVALUATION"]).toContain(loserReason.code);
    }

    // Final committed state: balance 300.00, total_earning untouched, exactly
    // TWO ledger rows (the step-2 order + the race winner) and exactly TWO
    // audit rows, de-certified teacher, re-opened applicant with a FRESH
    // anchor.
    const walletRow = await readWalletRow(subjectUserId);
    expect(walletRow?.balance).toBe("300.00");
    expect(walletRow?.totalEarning).toBe("500.00");
    const ledgerRows = await ledgerRowsOfTeacher(subjectUserId);
    expect(ledgerRows).toHaveLength(2);
    const descriptions = ledgerRows
      .map(row => row.description ?? "")
      .toSorted((left, right) => left.localeCompare(right));
    const winnerDescription = descriptions.find(
      description => description !== `Re-evaluation fee: ${firstOrderReason}`
    );
    if (winnerDescription === undefined) {
      throw new Error("expected the race winner's ledger description");
    }
    expect([`Re-evaluation fee: ${reasonA}`, `Re-evaluation fee: ${reasonB}`]).toContain(winnerDescription);
    for (const ledgerRow of ledgerRows) {
      expect(ledgerRow.type).toBe(TransactionType.Withdrawal);
      expect(ledgerRow.status).toBe(TransactionStatus.Completed);
      expect(ledgerRow.sessionId).toBeNull();
      expect(ledgerRow.amount).toBe(RE_EVALUATION_FEE);
    }
    const auditRows = await auditRowsAboutTeacherTarget(subjectUserId);
    expect(auditRows).toHaveLength(2);
    expect((await readTeacherRow(subjectUserId)).isApproved).toBe(false);
    const applicantRow = await readApplicantRow(subjectUserId);
    expect(applicantRow.status).toBe(ApplicantStatus.InEvaluation);
    expect(applicantRow.reEvaluationStartedAt?.getTime()).toBeGreaterThan(anchorBefore.getTime());

    // The re-order walls: the race subject is now de-certified AND
    // in_evaluation — the teacher leg is checked first, so its follow-up
    // order deterministically answers TEACHER_NOT_CERTIFIED with zero rows —
    // and a CERTIFIED teacher whose applicant is already `in_evaluation`
    // answers APPLICANT_NOT_AWAITING_RE_EVALUATION with zero rows.
    const postRacePre = await captureTeacherPreState(subjectUserId);
    expect(postRacePre.balance).toBe("300.00");
    expect(postRacePre.status).toBe(ApplicantStatus.InEvaluation);
    expect(postRacePre.certified).toBe(false);
    await expectTypedDenial(
      () =>
        TeacherReEvaluationService.orderReEvaluation(
          adminId(),
          { teacherId: subjectUserId, reason: `${PREFIX} de-certified probe` },
          LOCALE
        ),
      ConflictError,
      "TEACHER_NOT_CERTIFIED",
      ERRORS_EN.teacherNotCertified
    );
    await expectPreStateUnchanged(postRacePre, subjectUserId);

    const inEvaluationPre = await captureTeacherPreState(inEvaluationUserId);
    expect(inEvaluationPre.certified).toBe(true);
    expect(inEvaluationPre.status).toBe(ApplicantStatus.InEvaluation);
    await expectTypedDenial(
      () =>
        TeacherReEvaluationService.orderReEvaluation(
          adminId(),
          { teacherId: inEvaluationUserId, reason: `${PREFIX} in-evaluation probe` },
          LOCALE
        ),
      ConflictError,
      "APPLICANT_NOT_AWAITING_RE_EVALUATION",
      ERRORS_EN.applicantNotAwaitingReEvaluation
    );
    await expectPreStateUnchanged(inEvaluationPre, inEvaluationUserId);
  });
});
