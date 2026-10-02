/**
 * Cross-actor journey — DEV2-006: the five-session evaluation loop, from the
 * verification purchase that opens the cycle to the sixth-booking denial that
 * closes it (specs §6, plan §5.5). Sequential actor-attributed steps execute
 * against the REAL services on the REAL test database; later steps observe the
 * shared state earlier steps committed.
 *
 *   1. System provisions the cast (applicant A, five certified evaluators E1-E5,
 *      a certified NON-evaluator teacher, and foreign applicant B) plus the
 *      verification plan fixture; the purchase target is resolved from the
 *      ACTIVE catalog exactly the way the purchase service resolves it.
 *   2. Applicant A purchases the verification plan (DEV2-005 service) → ONE
 *      pending pair; the confirmed gateway event (SubscriptionActivationService
 *      webhook) activates the subscription → the evaluation cycle is open.
 *   3. Applicant A books E1 → ONE scheduled teacher_evaluation session, ONE
 *      verbatim-keyed claim backfilled with the session, the evaluator
 *      receives exactly one session_request notification published strictly
 *      post-commit, and the loop status shows booked=1 / remaining=4.
 *   4. Ticket denials: re-booking E1 (EVALUATOR_ALREADY_USED), targeting the
 *      certified non-evaluator (TEACHER_NOT_CERTIFIED — the target never
 *      learns of the attempt), and a malformed evaluator id (ValidationError)
 *      each write ZERO rows and stay silent.
 *   5. Applicant A cancels the E1 session → the slot and the evaluator free
 *      up immediately (status-aware distinctness); re-booking E1 succeeds.
 *   6. Replay probes: the SAME applicant replaying a spent key is denied with
 *      DUPLICATE_REQUEST (zero new rows); a FOREIGN applicant replaying the
 *      same spent key gets the constant-time SESSION_NOT_FOUND denial.
 *   7. Booking E2-E5 exhausts the credits; a sixth booking is denied with
 *      NO_EVALUATION_CREDITS_REMAINING while the reads stay accurate.
 *   8. Each evaluator drives start → complete on their session; a sixth
 *      booking after five completions is denied with EVALUATION_LOOP_COMPLETE.
 *
 * Journey rules honored (`test/workflows/AGENTS.md`):
 * - fixtures COMMITTED in `beforeAll` (sanctioned cast provisioner + ONE
 *   committing transaction for the evaluators, the foreign applicant, and the
 *   plan); never `runInRollback` (the services own their transactions);
 * - honest actors: real `users` rows + real role-child rows; denials flow
 *   through the real service-level gates — nothing monkey-patched;
 * - external effects intercepted at the notification boundary: the engine's
 *   publish seam is SPIED and every step asserts receipts and inbox deltas;
 * - error assertions through `catchJourneyError` + translated substrings —
 *   never `.rejects.toThrow()`, no hardcoded English strings;
 * - per-run `jrn_evalloop_<8hex>` prefix on every name/key;
 * - full cleanup: notifications sweep → immutable ledger leg → tracked
 *   fixtures → cast cleanup → post-teardown residue probes for every
 *   generated user id.
 */
import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { and, eq, inArray, or } from "drizzle-orm";
import { db } from "@/backend/db";
import { PlanRepository } from "@/backend/db/repo";
import { plans } from "@/backend/db/schema/billing/plans";
import { studentPayments } from "@/backend/db/schema/billing/student-payments";
import { studentSubscriptions } from "@/backend/db/schema/billing/student-subscriptions";
import { subscriptionPurchaseIdempotency } from "@/backend/db/schema/billing/subscription-purchase-idempotency";
import { subscriptions } from "@/backend/db/schema/billing/subscriptions";
import { session } from "@/backend/db/schema/classes/session";
import { sessionRequestIdempotency } from "@/backend/db/schema/classes/session-request-idempotency";
import { notifications } from "@/backend/db/schema/notifications";
import { parents } from "@/backend/db/schema/parents/parents";
import { students } from "@/backend/db/schema/students/students";
import { applicants } from "@/backend/db/schema/teachers/applicants";
import { teacher } from "@/backend/db/schema/teachers/teacher";
import { admin } from "@/backend/db/schema/users/admin";
import { users } from "@/backend/db/schema/users/users";
import { createTestApplicant, createTestPlan, createTestUser } from "@/backend/db/test/entity-setup";
import { PaymentGateway } from "@/backend/enum/billing/payment-gateway.enum";
import { PaymentStatus } from "@/backend/enum/billing/payment-status.enum";
import { SubscriptionCreditLane } from "@/backend/enum/billing/subscription-credit-lane.enum";
import { SubscriptionStatus } from "@/backend/enum/billing/subscription-status.enum";
import { NotificationType } from "@/backend/enum/notifications/notification-type.enum";
import { SessionIntent } from "@/backend/enum/scheduling/session-intent.enum";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import { SessionType } from "@/backend/enum/scheduling/session-type.enum";
import { ApplicantStatus } from "@/backend/enum/teachers/applicant-status.enum";
import { ConflictError, NotFoundError, ValidationError } from "@/backend/lib/errors";
import { ApplicantLifecycleService, SubscriptionActivationService } from "@/backend/services";
import { SessionLifecycleService } from "@/backend/services/classes/session-lifecycle.service";
import { NotificationEngine } from "@/backend/services/notifications";
import { EvaluationBookingService } from "@/backend/services/teachers/evaluation-booking.service";
import { VerificationPurchaseService } from "@/backend/services/teachers/verification-purchase.service";
import type { PaymentWebhookEvent, PlanSelectType, SessionReturnType, UserSelectType } from "@/backend/types";
import {
  VERIFICATION_PLAN_CURRENCY,
  VERIFICATION_PLAN_INTERVAL_DAYS,
  VERIFICATION_PLAN_PRICE,
  VERIFICATION_PLAN_SESSION_COUNT,
  VERIFICATION_PLAN_TITLE,
} from "@/shared/constants/verification-plan.constants";
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

/** Per-run unique prefix — every key/name derives from it (no cross-run collisions). */
const PREFIX = journeyPrefix("evalloop");

/** Error-copy locale for every service call and denial assertion. */
const ERRORS_EN = getServerTranslations("en").errorsTranslations;
/** Notification copy — the request wave composes in the RECIPIENT's persisted locale. */
const NOTIFS_EN = getServerTranslations("en").notificationsTranslations;

/** Milliseconds per day — the activation window arithmetic. */
const MS_PER_DAY = 86_400_000;

/** Tracked fixture rows (evaluators, foreign applicant, plan, service-created rows). */
const tracked = new TrackedFixtures();

/**
 * The fan-out publish spy — installed over the engine's publish boundary (the
 * booking + activation services publish post-commit through this exact
 * namespace-bound seam). Restored in `afterAll`.
 */
const publishSpy = spyOn(NotificationEngine, "publishReceipts").mockImplementation(async () => {});

/** Idempotency keys for the purchases; booking keys derive from a per-leg tag. */
const KEY_PURCHASE_A = `${PREFIX}-key-purchase-a`;
const KEY_PURCHASE_B = `${PREFIX}-key-purchase-b`;
function bookKey(tag: string): string {
  return `${PREFIX}-key-book-${tag}`;
}

/** Ledger rows created by the purchase service during the journey (teardown worklist). */
const ledgerPaymentIds: number[] = [];
const ledgerSubscriptionIds: number[] = [];

/** Journey cast: the sanctioned provisioner bundle. */
let bundle: JourneyFixtureBundle;
/** The purchase target as the SERVICE resolves it (active catalog + exact-title match). */
let planRow: PlanSelectType;
/** The plan row id THIS journey created (0 = the seeded catalog member served). */
let journeyCreatedPlanId = 0;
/** Certified evaluators E1-E5 (real users + teacher rows with isApproved + isEvaluator). */
const evaluatorIds: number[] = [];
/** Foreign applicant B — the constant-time replay probe caller (own active cycle). */
let applicantB: UserSelectType;

/** The booked sessions, in booking order (the re-booked E1 replaces the cancelled one). */
const bookedSessions: SessionReturnType[] = [];

/** The applicant actor under test (cast member A). */
function applicantAId(): number {
  return bundle.cast.applicant.user.id;
}

/** Every user id this journey generates (cast + evaluators + foreign applicant). */
function allJourneyUserIds(): number[] {
  return [...bundle.registry.userIds, ...evaluatorIds, applicantB.id];
}

// ─── Read-back oracles ───────────────────────────────────────────────────────

/** Number of `students` rows behind a user id — the lane-credit surface probe. */
async function studentsRowCount(userId: number): Promise<number> {
  return db.$count(students, eq(students.id, userId));
}

/** Committed evaluation-session rows owned by the applicant (the booking delta oracle). */
async function evaluationSessionCount(applicantUserId: number): Promise<number> {
  return db.$count(
    session,
    and(eq(session.studentId, applicantUserId), eq(session.sessionType, SessionType.TeacherEvaluation))
  );
}

/** Session rows where the given user is the TEACHER (the evaluator-side oracle). */
async function teacherSessionCount(teacherUserId: number): Promise<number> {
  return db.$count(session, eq(session.teacherId, teacherUserId));
}

/** Independent read-back oracle — direct Drizzle count on the inbox. */
async function inboxCount(userId: number): Promise<number> {
  return db.$count(notifications, eq(notifications.userId, userId));
}

/** Purchase-set counters for one user (subscriptions + purchase claims). */
async function purchaseSetCounts(userId: number): Promise<{ subs: number; claims: number }> {
  const [subs, claims] = await Promise.all([
    db.$count(subscriptions, eq(subscriptions.userId, userId)),
    db.$count(subscriptionPurchaseIdempotency, eq(subscriptionPurchaseIdempotency.userId, userId)),
  ]);
  return { subs, claims };
}

/** The applicant's row by user id, failing when absent. */
async function readApplicantRow(userId: number) {
  const rows = await db.select().from(applicants).where(eq(applicants.id, userId)).limit(1);
  const row = rows[0];
  if (!row) {
    throw new Error(`applicants row ${userId} vanished`);
  }
  return row;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Recipient user ids of the most recent publish (the receipt fan-out oracle). */
function lastPublishedRecipientIds(): number[] {
  const lastCall = publishSpy.mock.calls.at(-1);
  const receipts = lastCall?.[0];
  if (!Array.isArray(receipts)) {
    throw new Error("expected the last publish to carry an array of delivery receipts");
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

/** Books one evaluator for the applicant, asserts the claim backfill, and registers the new rows. */
async function bookEvaluatorTracked(applicantId: number, evaluatorId: number, key: string): Promise<void> {
  const booked = await EvaluationBookingService.bookEvaluation(applicantId, { evaluatorId }, key, "en");
  bookedSessions.push(booked);
  expect(booked.teacherId).toBe(evaluatorId);
  expect(booked.status).toBe(SessionStatus.Scheduled);
  expect(booked.sessionType).toBe(SessionType.TeacherEvaluation);
  expect(booked.intent).toBe(SessionIntent.Evaluation);
  const claimRows = await db
    .select()
    .from(sessionRequestIdempotency)
    .where(eq(sessionRequestIdempotency.idempotencyKey, key));
  expect(claimRows).toHaveLength(1);
  expect(claimRows[0]?.sessionId).toBe(booked.id);
  tracked.register(session, booked.id);
  for (const claimRow of claimRows) {
    tracked.register(sessionRequestIdempotency, claimRow.id);
  }
}

/** Drives one evaluation session through the evaluator's start → complete pair. */
async function driveSessionToCompletion(sessionRow: SessionReturnType): Promise<void> {
  const started = await SessionLifecycleService.startSession(sessionRow.teacherId, sessionRow.id, "en");
  expect(started.status).toBe(SessionStatus.Started);
  expect(started.startedAt).not.toBeNull();

  const completed = await SessionLifecycleService.completeSession(sessionRow.teacherId, sessionRow.id, "en");
  expect(completed.status).toBe(SessionStatus.Completed);
  expect(completed.confirmedByTeacherAt).not.toBeNull();
  expect(completed.feeHeld).toBe(false);
  expect(completed.endedAt).not.toBeNull();
}

// ─── Fixture provisioning ────────────────────────────────────────────────────

beforeAll(async () => {
  // Phase 1 — the sanctioned cast provisioner: real users + role-children in
  // ONE committing transaction (applicant A pending, the certified
  // NON-evaluator teacher, plus the bystander members).
  bundle = await createJourneyFixtures(PREFIX);

  // Phase 2 — ONE committing transaction for everything else the journey
  // needs: the five certified evaluators, the foreign replay applicant, the
  // persisted EN locale for the whole cast, and the verification plan fixture.
  await db.transaction(async tx => {
    const castUserIds = [
      bundle.cast.admin.user.id,
      bundle.cast.student.user.id,
      bundle.cast.parent.user.id,
      bundle.cast.applicant.user.id,
      bundle.cast.certifiedTeacher.user.id,
    ];

    const provisionedEvaluators = await Promise.all(
      Array.from({ length: VERIFICATION_PLAN_SESSION_COUNT }, async (_, index) => {
        const user = await createTestUser(tx, { role: "teacher", locale: "en" });
        const [evaluatorRow] = await tx
          .insert(teacher)
          .values({
            id: user.id,
            isApproved: true,
            isEvaluator: true,
            averageRating: null,
            isOnline: true,
            subjects: null,
          })
          .returning();
        if (!evaluatorRow) {
          throw new Error(`journey fixture: evaluator E${index + 1} teacher child insert returned no rows`);
        }
        return user.id;
      })
    );
    for (const evaluatorId of provisionedEvaluators) {
      evaluatorIds.push(evaluatorId);
      tracked.register(users, evaluatorId);
      tracked.register(teacher, evaluatorId);
    }

    const userB = await createTestUser(tx, { role: "teacher", locale: "en" });
    await createTestApplicant(tx, userB.id, { status: ApplicantStatus.Pending });
    applicantB = userB;
    tracked.register(users, userB.id);
    tracked.register(applicants, userB.id);

    await tx
      .update(users)
      .set({ locale: "en" })
      .where(inArray(users.id, [...castUserIds, ...evaluatorIds, userB.id]));

    // CONDITIONAL catalog fixture: the purchase service resolves its target
    // server-side by the canonical title and REJECTS an ambiguous catalog, so
    // the committed fixture is created ONLY when the catalog lacks the
    // canonical member; on a seeded catalog the pre-existing row serves.
    const activeInTx = await PlanRepository.listActive(tx);
    if (activeInTx.find(entry => entry.title === VERIFICATION_PLAN_TITLE) === undefined) {
      const plan = await createTestPlan(tx, {
        title: VERIFICATION_PLAN_TITLE,
        sessionCount: VERIFICATION_PLAN_SESSION_COUNT,
        price: VERIFICATION_PLAN_PRICE,
        currency: VERIFICATION_PLAN_CURRENCY,
        intervalDays: VERIFICATION_PLAN_INTERVAL_DAYS,
        balanceLane: SubscriptionCreditLane.Reviews,
        isActive: true,
      });
      tracked.register(plans, plan.id);
      journeyCreatedPlanId = plan.id;
    }
  });

  // Resolve the purchase target EXACTLY the way the purchase service does.
  const activeCatalog = await PlanRepository.listActive();
  const resolved = activeCatalog.find(entry => entry.title === VERIFICATION_PLAN_TITLE);
  if (!resolved) {
    throw new Error(
      `journey fixture: no ACTIVE plan titled "${VERIFICATION_PLAN_TITLE}" in the catalog — the verification plan fixture failed to commit`
    );
  }
  if (journeyCreatedPlanId > 0) {
    expect(resolved.id).toBe(journeyCreatedPlanId);
  }
  planRow = resolved;
});

afterAll(async () => {
  publishSpy.mockRestore();
  const journeyIds = allJourneyUserIds();

  // Inbox sweep FIRST: every journey-created notification row disappears by
  // owner id, then the sweep is re-probed to zero (they would also cascade at
  // user delete — the explicit leg keeps the residue oracle unconditional).
  await db.delete(notifications).where(inArray(notifications.userId, journeyIds));
  const inboxResidue = await db.$count(notifications, inArray(notifications.userId, journeyIds));
  if (inboxResidue !== 0) {
    throw new Error(`journey teardown: ${inboxResidue} notification row(s) survived deletion`);
  }

  // Immutable-ledger teardown leg: the append-only trigger blocks a plain
  // DELETE, so the sanctioned suspension wraps exactly this leg — then the
  // sweep is re-probed to zero.
  if (ledgerPaymentIds.length > 0) {
    await withImmutabilityTriggersSuspended(["student_payments"], async () => {
      await db.delete(studentPayments).where(inArray(studentPayments.id, ledgerPaymentIds));
    });
    const paymentResidue = await db.$count(studentPayments, inArray(studentPayments.id, ledgerPaymentIds));
    if (paymentResidue !== 0) {
      throw new Error(`journey teardown: ${paymentResidue} student_payments row(s) survived deletion`);
    }
  }

  // Student junction rows: verification purchases must never create any; the
  // sweep is defensive and re-probed to zero ahead of the tracked sweep.
  if (ledgerSubscriptionIds.length > 0) {
    await db.delete(studentSubscriptions).where(inArray(studentSubscriptions.subscriptionId, ledgerSubscriptionIds));
    const junctionResidue = await db.$count(
      studentSubscriptions,
      inArray(studentSubscriptions.subscriptionId, ledgerSubscriptionIds)
    );
    if (junctionResidue !== 0) {
      throw new Error(`journey teardown: ${junctionResidue} student junction row(s) survived deletion`);
    }
  }

  // Reverse-registration-order hard delete + zero-residue re-probes for every
  // tracked row (claims → sessions → subscriptions → evaluators' rows → plan).
  await tracked.cleanup();

  // Cast rows via the provisioner registry: audit-log sweep under suspended
  // triggers, role-children, then users.
  await journeyCleanup(bundle.registry);

  // Post-teardown existence probes for EVERY generated user id — the residue
  // check is load-bearing, not advisory.
  const [userResidue, applicantResidue, studentResidue, teacherResidue, parentResidue, adminResidue, sessionResidue] =
    await Promise.all([
      db.$count(users, inArray(users.id, journeyIds)),
      db.$count(applicants, inArray(applicants.id, journeyIds)),
      db.$count(students, inArray(students.id, journeyIds)),
      db.$count(teacher, inArray(teacher.id, journeyIds)),
      db.$count(parents, inArray(parents.id, journeyIds)),
      db.$count(admin, inArray(admin.id, journeyIds)),
      db.$count(session, or(inArray(session.studentId, journeyIds), inArray(session.teacherId, journeyIds))),
    ]);
  expect(userResidue).toBe(0);
  expect(applicantResidue).toBe(0);
  expect(studentResidue).toBe(0);
  expect(teacherResidue).toBe(0);
  expect(parentResidue).toBe(0);
  expect(adminResidue).toBe(0);
  expect(sessionResidue).toBe(0);
});

// ─── The journey ─────────────────────────────────────────────────────────────

describe("DEV2-006 — five-session evaluation loop booking journey", () => {
  test("step 1 — System: committed cast + evaluators + catalog; applicant pending with zero purchase/session state", async () => {
    const applicantId = applicantAId();

    // Applicant A is a PENDING applicant with a zeroed attempt ledger — the
    // exact precondition the verification purchase flips.
    const row = await readApplicantRow(applicantId);
    expect(row.status).toBe(ApplicantStatus.Pending);
    expect(row.verificationAttempts).toBe(0);
    expect(row.cooldownUntil).toBeNull();

    // The five evaluators hold REAL certified-evaluator teacher rows; the cast's
    // certified teacher is deliberately NOT an evaluator (the TEACHER_NOT_CERTIFIED target).
    const evaluatorRows = await db.select().from(teacher).where(inArray(teacher.id, evaluatorIds));
    expect(evaluatorRows).toHaveLength(VERIFICATION_PLAN_SESSION_COUNT);
    for (const evaluatorRow of evaluatorRows) {
      expect(evaluatorRow.isApproved).toBe(true);
      expect(evaluatorRow.isEvaluator).toBe(true);
    }
    expect(bundle.cast.certifiedTeacher.child.isEvaluator).toBe(false);

    // The lane-credit surface stays ABSENT for every applicant (G17 lock).
    expect(await studentsRowCount(applicantId)).toBe(0);
    expect(await studentsRowCount(applicantB.id)).toBe(0);
    expect(await studentsRowCount(bundle.cast.student.user.id)).toBe(1);

    // Clean slate everywhere the journey asserts deltas.
    expect(await evaluationSessionCount(applicantId)).toBe(0);
    expect(await purchaseSetCounts(applicantId)).toEqual({ subs: 0, claims: 0 });
    const probeIds = [...evaluatorIds, applicantB.id, bundle.cast.certifiedTeacher.user.id];
    const [probeInboxes, probeTeacherSessions] = await Promise.all([
      Promise.all(probeIds.map(id => inboxCount(id))),
      Promise.all(probeIds.map(id => teacherSessionCount(id))),
    ]);
    expect(probeInboxes).toEqual(probeIds.map(() => 0));
    expect(probeTeacherSessions).toEqual(probeIds.map(() => 0));
    expect(publishSpy.mock.calls).toHaveLength(0);

    // The resolved purchase target carries the product contract verbatim.
    expect(planRow.sessionCount).toBe(VERIFICATION_PLAN_SESSION_COUNT);
    expect(planRow.price).toBe(VERIFICATION_PLAN_PRICE);
    expect(planRow.currency).toBe(VERIFICATION_PLAN_CURRENCY);
    expect(planRow.intervalDays).toBe(VERIFICATION_PLAN_INTERVAL_DAYS);
  });

  test("step 2 — Applicant A: verification purchase commits ONE pending pair + backfilled claim; status flips to in_evaluation", async () => {
    const applicantId = applicantAId();

    const result = await VerificationPurchaseService.purchase(applicantId, KEY_PURCHASE_A, "en");

    // The returned pending pair: subscription pending, gateway correlation,
    // verbatim plan money, payment owned by the generic user (never a student).
    expect(result.subscription.status).toBe(SubscriptionStatus.Pending);
    expect(result.subscription.userId).toBe(applicantId);
    expect(result.subscription.planId).toBe(planRow.id);
    expect(result.subscription.paymentReference).toBe(result.checkout.providerReference);
    expect(result.checkout.provider).toBe(PaymentGateway.Mock);
    expect(result.checkout.checkoutUrl).toBeNull();
    expect(result.payment.amount).toBe(planRow.price);
    expect(result.payment.currency).toBe(planRow.currency);
    expect(result.payment.status).toBe(PaymentStatus.Pending);
    expect(result.payment.subscriptionId).toBe(result.subscription.id);
    expect(result.payment.studentId).toBeNull();

    // Exactly ONE committed pending set + ONE verbatim-keyed claim for the purchaser.
    expect(await purchaseSetCounts(applicantId)).toEqual({ subs: 1, claims: 1 });
    const claimRows = await db
      .select()
      .from(subscriptionPurchaseIdempotency)
      .where(eq(subscriptionPurchaseIdempotency.idempotencyKey, KEY_PURCHASE_A));
    expect(claimRows).toHaveLength(1);
    expect(claimRows[0]?.userId).toBe(applicantId);
    expect(claimRows[0]?.subscriptionId).toBe(result.subscription.id);

    // No student junction — an applicant owns no students row.
    expect(await db.$count(studentSubscriptions, eq(studentSubscriptions.subscriptionId, result.subscription.id))).toBe(
      0
    );

    // The applicant flips to in_evaluation with the attempt counter untouched.
    const row = await readApplicantRow(applicantId);
    expect(row.status).toBe(ApplicantStatus.InEvaluation);
    expect(row.verificationAttempts).toBe(0);
    expect(await studentsRowCount(applicantId)).toBe(0);

    // Purchases emit nothing: no inbox row, no publish.
    expect(await inboxCount(applicantId)).toBe(0);
    expect(publishSpy.mock.calls).toHaveLength(0);

    // Teardown worklist: the committed pair + claim are hard-deleted in afterAll.
    tracked.register(subscriptions, result.subscription.id);
    tracked.register(studentPayments, result.payment.id);
    for (const claimRow of claimRows) {
      tracked.register(subscriptionPurchaseIdempotency, claimRow.id);
    }
    ledgerSubscriptionIds.push(result.subscription.id);
    ledgerPaymentIds.push(result.payment.id);
  });

  test("step 3 — System: confirmed webhook → paid + active window; ONE receipt published to Applicant A ONLY", async () => {
    const applicantId = applicantAId();
    const subscriptionId = ledgerSubscriptionIds[0] ?? 0;
    const paymentId = ledgerPaymentIds[0] ?? 0;
    const windowStart = Date.now() - 2_000;

    const ledger = await db.select().from(studentPayments).where(eq(studentPayments.id, paymentId)).limit(1);
    const paymentRow = ledger[0];
    if (!paymentRow) {
      throw new Error(`payment ledger row ${paymentId} vanished`);
    }
    const subRows = await db.select().from(subscriptions).where(eq(subscriptions.id, subscriptionId)).limit(1);
    const reference = subRows[0]?.paymentReference;
    if (!reference) {
      throw new Error("expected the pending subscription to carry the gateway payment reference");
    }
    const event: PaymentWebhookEvent = {
      reference,
      outcome: "confirmed",
      amount: paymentRow.amount,
      currency: paymentRow.currency,
    };

    const outcome = await SubscriptionActivationService.processWebhookEvent(event, "en");
    expect(outcome).toEqual({ processed: true });

    // The ledger decision: pending → paid; the window: verified, started,
    // endDate − startDate = intervalDays exactly.
    const paidRows = await db.select().from(studentPayments).where(eq(studentPayments.id, paymentId)).limit(1);
    expect(paidRows[0]?.status).toBe(PaymentStatus.Paid);
    const activeRows = await db.select().from(subscriptions).where(eq(subscriptions.id, subscriptionId)).limit(1);
    const active = activeRows[0];
    if (!active) {
      throw new Error(`subscription row ${subscriptionId} vanished`);
    }
    expect(active.status).toBe(SubscriptionStatus.Active);
    expect(active.paymentVerifiedAt).not.toBeNull();
    if (active.startDate === null || active.endDate === null) {
      throw new Error("expected the activated subscription to carry its window dates");
    }
    expect(active.startDate.getTime()).toBeGreaterThanOrEqual(windowStart);
    expect(active.endDate.getTime() - active.startDate.getTime()).toBe(planRow.intervalDays * MS_PER_DAY);

    // The credit-skip contract: the applicant still owns NO students row.
    expect(await studentsRowCount(applicantId)).toBe(0);

    // ONE payment-confirmation notification in the purchaser's locale, ONE
    // published receipt addressed to Applicant A ONLY.
    expect(await inboxCount(applicantId)).toBe(1);
    expect(publishSpy.mock.calls).toHaveLength(1);
    expect(lastPublishedRecipientIds()).toEqual([applicantId]);

    // The intended observer sees the flip through the REAL self-profile read.
    const profile = await ApplicantLifecycleService.getMyApplicantProfile(applicantId, "en");
    if (!profile) {
      throw new Error("expected the purchaser's self profile to resolve after activation");
    }
    expect(profile.status).toBe(ApplicantStatus.InEvaluation);
    expect(profile.verificationAttempts).toBe(0);
  });

  test("step 4 — Applicant A books E1: ONE scheduled evaluation session + claim backfill + ONE evaluator receipt; loop status booked=1/remaining=4", async () => {
    const applicantId = applicantAId();
    const evaluatorE1 = evaluatorIds[0];
    const key = bookKey("e1");
    const sessionsBefore = await evaluationSessionCount(applicantId);

    const booked = await EvaluationBookingService.bookEvaluation(applicantId, { evaluatorId: evaluatorE1 }, key, "en");
    bookedSessions.push(booked);
    expect(booked.id).toBeGreaterThan(0);
    expect(booked.teacherId).toBe(evaluatorE1);
    expect(booked.studentId).toBe(applicantId);
    expect(booked.status).toBe(SessionStatus.Scheduled);
    expect(booked.sessionType).toBe(SessionType.TeacherEvaluation);
    expect(booked.intent).toBe(SessionIntent.Evaluation);
    expect(booked.fee).toBeNull();
    expect(booked.feeHeld).toBe(false);
    expect(booked.heldBalanceLane).toBeNull();
    expect(booked.startedAt).toBeNull();
    expect(booked.endedAt).toBeNull();
    expect(booked.cancelReason).toBeNull();
    expect(booked.confirmationDeadline).not.toBeNull();

    // Exactly ONE new committed evaluation row + ONE verbatim-keyed claim
    // backfilled with the session id.
    expect(await evaluationSessionCount(applicantId)).toBe(sessionsBefore + 1);
    const claimRows = await db
      .select()
      .from(sessionRequestIdempotency)
      .where(eq(sessionRequestIdempotency.idempotencyKey, key));
    expect(claimRows).toHaveLength(1);
    expect(claimRows[0]?.userId).toBe(applicantId);
    expect(claimRows[0]?.sessionId).toBe(booked.id);

    // The applicant's loop progress: booked 1, completed 0, remaining 4, with a
    // resolved cycle anchored to the active subscription.
    const status = await EvaluationBookingService.myEvaluationLoopStatus(applicantId, "en");
    expect(status.bookedCount).toBe(1);
    expect(status.completedCount).toBe(0);
    expect(status.remainingCredits).toBe(VERIFICATION_PLAN_SESSION_COUNT - 1);
    expect(status.cycleStartDate).not.toBeNull();

    // The evaluator receives exactly ONE session_request notification composed
    // in THEIR locale with the Evaluation intent label, and the receipt is
    // published strictly post-commit to the evaluator ONLY.
    const evaluatorInbox = await db.select().from(notifications).where(eq(notifications.userId, evaluatorE1));
    expect(evaluatorInbox).toHaveLength(1);
    expect(evaluatorInbox[0]?.type).toBe(NotificationType.SessionRequest);
    expect(evaluatorInbox[0]?.title).toBe(NOTIFS_EN.eventSessionRequestTitle);
    expect(evaluatorInbox[0]?.body).toContain(NOTIFS_EN.intentEvaluation);
    expect(evaluatorInbox[0]?.body).toContain(bundle.cast.applicant.user.fullName);
    expect(publishSpy.mock.calls).toHaveLength(2);
    expect(lastPublishedRecipientIds()).toEqual([evaluatorE1]);

    // Cross-actor visibility: the evaluator sees the row in their teacher
    // sessions; the applicant sees it in their evaluation sessions.
    const teacherView = await SessionLifecycleService.listMyTeacherSessions(evaluatorE1, {}, 1, 10);
    expect(teacherView.totalCount).toBe(1);
    expect(teacherView.items[0]?.id).toBe(booked.id);
    const applicantView = await EvaluationBookingService.myEvaluationSessions(
      applicantId,
      { status: null },
      1,
      25,
      "en"
    );
    expect(applicantView.totalCount).toBe(1);
    expect(applicantView.items[0]?.id).toBe(booked.id);

    // The picker EXCLUDES the used evaluator and still offers the rest.
    const picker = await EvaluationBookingService.availableEvaluators(applicantId, 1, 100, "en");
    const pickerIds = picker.items.map(option => option.id);
    expect(pickerIds).not.toContain(evaluatorE1);
    for (const evaluatorId of evaluatorIds.slice(1)) {
      expect(pickerIds).toContain(evaluatorId);
    }

    tracked.register(session, booked.id);
    for (const claimRow of claimRows) {
      tracked.register(sessionRequestIdempotency, claimRow.id);
    }
  });

  test("step 5 — ticket denials: EVALUATOR_ALREADY_USED, TEACHER_NOT_CERTIFIED (target never learns), and malformed id — all silent, zero rows", async () => {
    const applicantId = applicantAId();
    const evaluatorE1 = evaluatorIds[0];
    const certifiedTeacherId = bundle.cast.certifiedTeacher.user.id;
    const sessionsBefore = await evaluationSessionCount(applicantId);
    const publishesBefore = publishSpy.mock.calls.length;
    const inboxE1Before = await inboxCount(evaluatorE1);

    // A used evaluator is rejected for the honest reason (the used-set is the
    // non-cancelled rows of the CURRENT cycle).
    const usedDenial = await catchJourneyError(() =>
      EvaluationBookingService.bookEvaluation(applicantId, { evaluatorId: evaluatorE1 }, bookKey("dup-e1"), "en")
    );
    if (!(usedDenial instanceof ConflictError)) {
      throw new Error(
        `expected ConflictError (got ${usedDenial instanceof Error ? usedDenial.name : String(usedDenial)})`
      );
    }
    expect(usedDenial.code).toBe("EVALUATOR_ALREADY_USED");
    expect(usedDenial.message).toContain(ERRORS_EN.evaluatorAlreadyUsed);

    // A certified NON-evaluator teacher is rejected with the certification
    // conflict; the target never learns of the attempt (no inbox row, no
    // session row, no publish).
    const certificationDenial = await catchJourneyError(() =>
      EvaluationBookingService.bookEvaluation(
        applicantId,
        { evaluatorId: certifiedTeacherId },
        bookKey("not-certified"),
        "en"
      )
    );
    if (!(certificationDenial instanceof ConflictError)) {
      throw new Error(
        `expected ConflictError (got ${certificationDenial instanceof Error ? certificationDenial.name : String(certificationDenial)})`
      );
    }
    expect(certificationDenial.code).toBe("TEACHER_NOT_CERTIFIED");
    expect(certificationDenial.message).toContain(ERRORS_EN.teacherNotCertified);
    expect(await inboxCount(certifiedTeacherId)).toBe(0);
    expect(await teacherSessionCount(certifiedTeacherId)).toBe(0);

    // A malformed evaluator id is the canonical pre-DB VALIDATION denial.
    const shapeDenial = await catchJourneyError(() =>
      EvaluationBookingService.bookEvaluation(applicantId, { evaluatorId: 0 }, bookKey("malformed"), "en")
    );
    if (!(shapeDenial instanceof ValidationError)) {
      throw new Error(
        `expected ValidationError (got ${shapeDenial instanceof Error ? shapeDenial.name : String(shapeDenial)})`
      );
    }

    // Every denial wrote nothing and stayed silent.
    expect(await evaluationSessionCount(applicantId)).toBe(sessionsBefore);
    expect(await inboxCount(evaluatorE1)).toBe(inboxE1Before);
    expect(publishSpy.mock.calls).toHaveLength(publishesBefore);
  });

  test("step 6 — Applicant A cancels the E1 session (slot frees, E1 re-bookable, row visible as cancelled) then re-books E1", async () => {
    const applicantId = applicantAId();
    const evaluatorE1 = evaluatorIds[0];
    const cancelledSession = bookedSessions[0];
    if (!cancelledSession) {
      throw new Error("journey state: the first E1 booking is missing");
    }
    const publishesBefore = publishSpy.mock.calls.length;

    const cancelReason = `${PREFIX} applicant cancelled before the session`;
    const cancelled = await SessionLifecycleService.cancelSession(applicantId, cancelledSession.id, cancelReason, "en");
    expect(cancelled.status).toBe(SessionStatus.Cancelled);
    expect(cancelled.cancelReason).toBe(cancelReason);

    // The cancelled row is visible AS CANCELLED in both participant views
    // (lifecycle-agnostic cancel; the row persists).
    const applicantCancelledView = await EvaluationBookingService.myEvaluationSessions(
      applicantId,
      { status: SessionStatus.Cancelled },
      1,
      25,
      "en"
    );
    expect(applicantCancelledView.totalCount).toBe(1);
    expect(applicantCancelledView.items[0]?.id).toBe(cancelled.id);
    const teacherCancelledView = await SessionLifecycleService.listMyTeacherSessions(
      evaluatorE1,
      { status: SessionStatus.Cancelled },
      1,
      10
    );
    expect(teacherCancelledView.totalCount).toBe(1);
    expect(teacherCancelledView.items[0]?.id).toBe(cancelled.id);

    // The freed slot: the loop counter DECREMENTS and E1 becomes re-bookable
    // immediately (the used-set is status-aware — cancelled rows don't count).
    const statusAfterCancel = await EvaluationBookingService.myEvaluationLoopStatus(applicantId, "en");
    expect(statusAfterCancel.bookedCount).toBe(0);
    expect(statusAfterCancel.remainingCredits).toBe(VERIFICATION_PLAN_SESSION_COUNT);
    const pickerAfterCancel = await EvaluationBookingService.availableEvaluators(applicantId, 1, 100, "en");
    expect(pickerAfterCancel.items.map(option => option.id)).toContain(evaluatorE1);

    // Re-booking E1 succeeds as a FRESH scheduled row (the cancelled row stays
    // cancelled), the remaining decrement persists, and the evaluator receives
    // a second session_request receipt.
    const rebookKey = bookKey("rebook-e1");
    const rebooked = await EvaluationBookingService.bookEvaluation(
      applicantId,
      { evaluatorId: evaluatorE1 },
      rebookKey,
      "en"
    );
    bookedSessions[0] = rebooked;
    expect(rebooked.id).not.toBe(cancelled.id);
    expect(rebooked.status).toBe(SessionStatus.Scheduled);
    const claimRows = await db
      .select()
      .from(sessionRequestIdempotency)
      .where(eq(sessionRequestIdempotency.idempotencyKey, rebookKey));
    expect(claimRows).toHaveLength(1);
    expect(claimRows[0]?.sessionId).toBe(rebooked.id);

    const statusAfterRebook = await EvaluationBookingService.myEvaluationLoopStatus(applicantId, "en");
    expect(statusAfterRebook.bookedCount).toBe(1);
    expect(statusAfterRebook.remainingCredits).toBe(VERIFICATION_PLAN_SESSION_COUNT - 1);
    expect(publishSpy.mock.calls).toHaveLength(publishesBefore + 1);
    expect(lastPublishedRecipientIds()).toEqual([evaluatorE1]);
    expect(await inboxCount(evaluatorE1)).toBe(2);

    tracked.register(session, rebooked.id);
    for (const claimRow of claimRows) {
      tracked.register(sessionRequestIdempotency, claimRow.id);
    }
  });

  test("step 7 — Applicant A books E2: second distinct evaluator; loop status booked=2/remaining=3", async () => {
    const applicantId = applicantAId();
    const evaluatorE2 = evaluatorIds[1];
    const sessionsBefore = await evaluationSessionCount(applicantId);
    const publishesBefore = publishSpy.mock.calls.length;
    const key = bookKey("e2");

    const booked = await EvaluationBookingService.bookEvaluation(applicantId, { evaluatorId: evaluatorE2 }, key, "en");
    bookedSessions.push(booked);
    expect(booked.teacherId).toBe(evaluatorE2);
    expect(booked.status).toBe(SessionStatus.Scheduled);
    expect(booked.sessionType).toBe(SessionType.TeacherEvaluation);
    expect(booked.intent).toBe(SessionIntent.Evaluation);
    expect(await evaluationSessionCount(applicantId)).toBe(sessionsBefore + 1);

    const claimRows = await db
      .select()
      .from(sessionRequestIdempotency)
      .where(eq(sessionRequestIdempotency.idempotencyKey, key));
    expect(claimRows).toHaveLength(1);
    expect(claimRows[0]?.sessionId).toBe(booked.id);

    const status = await EvaluationBookingService.myEvaluationLoopStatus(applicantId, "en");
    expect(status.bookedCount).toBe(2);
    expect(status.completedCount).toBe(0);
    expect(status.remainingCredits).toBe(VERIFICATION_PLAN_SESSION_COUNT - 2);

    expect(publishSpy.mock.calls).toHaveLength(publishesBefore + 1);
    expect(lastPublishedRecipientIds()).toEqual([evaluatorE2]);
    expect(await inboxCount(evaluatorE2)).toBe(1);

    tracked.register(session, booked.id);
    for (const claimRow of claimRows) {
      tracked.register(sessionRequestIdempotency, claimRow.id);
    }
  });

  test("step 8 — replay probe (SAME applicant): a spent key replays as DUPLICATE_REQUEST with zero new rows", async () => {
    const applicantId = applicantAId();
    const evaluatorE3 = evaluatorIds[2];
    const sessionsBefore = await evaluationSessionCount(applicantId);
    const publishesBefore = publishSpy.mock.calls.length;

    // The E2 booking's key is replayed by its OWNER with a DIFFERENT evaluator
    // target: the claim-table 23505 decides — the same-caller branch returns
    // the duplicate-request conflict, never a second booking.
    const denial = await catchJourneyError(() =>
      EvaluationBookingService.bookEvaluation(applicantId, { evaluatorId: evaluatorE3 }, bookKey("e2"), "en")
    );
    if (!(denial instanceof ConflictError)) {
      throw new Error(`expected ConflictError (got ${denial instanceof Error ? denial.name : String(denial)})`);
    }
    expect(denial.code).toBe("DUPLICATE_REQUEST");
    expect(denial.message).toContain(ERRORS_EN.duplicateRequest);

    // Zero new rows: no E3 session, no new claim, no publish, E3 stays silent.
    expect(await evaluationSessionCount(applicantId)).toBe(sessionsBefore);
    expect(await teacherSessionCount(evaluatorE3)).toBe(0);
    expect(await inboxCount(evaluatorE3)).toBe(0);
    expect(publishSpy.mock.calls).toHaveLength(publishesBefore);
  });

  test("step 9 — foreign applicant B purchases + activates their own cycle (the constant-time replay precondition)", async () => {
    const foreignId = applicantB.id;
    const sessionsBefore = await evaluationSessionCount(foreignId);
    expect(sessionsBefore).toBe(0);

    const result = await VerificationPurchaseService.purchase(foreignId, KEY_PURCHASE_B, "en");
    expect(result.subscription.status).toBe(SubscriptionStatus.Pending);
    expect(result.payment.studentId).toBeNull();
    const claimRows = await db
      .select()
      .from(subscriptionPurchaseIdempotency)
      .where(eq(subscriptionPurchaseIdempotency.idempotencyKey, KEY_PURCHASE_B));
    expect(claimRows).toHaveLength(1);
    expect(claimRows[0]?.userId).toBe(foreignId);
    const rowB = await readApplicantRow(foreignId);
    expect(rowB.status).toBe(ApplicantStatus.InEvaluation);

    const reference = result.subscription.paymentReference;
    if (!reference) {
      throw new Error("expected the pending subscription to carry the gateway payment reference");
    }
    const event: PaymentWebhookEvent = {
      reference,
      outcome: "confirmed",
      amount: result.payment.amount,
      currency: result.payment.currency,
    };
    const outcome = await SubscriptionActivationService.processWebhookEvent(event, "en");
    expect(outcome).toEqual({ processed: true });

    const activeRows = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.id, result.subscription.id))
      .limit(1);
    expect(activeRows[0]?.status).toBe(SubscriptionStatus.Active);
    expect(await studentsRowCount(foreignId)).toBe(0);

    // Teardown worklist for the foreign pair.
    tracked.register(subscriptions, result.subscription.id);
    tracked.register(studentPayments, result.payment.id);
    for (const claimRow of claimRows) {
      tracked.register(subscriptionPurchaseIdempotency, claimRow.id);
    }
    ledgerSubscriptionIds.push(result.subscription.id);
    ledgerPaymentIds.push(result.payment.id);
  });

  test("step 10 — replay probe (FOREIGN applicant): the spent key replays as the constant-time SESSION_NOT_FOUND denial", async () => {
    const applicantId = applicantAId();
    const foreignId = applicantB.id;
    const evaluatorE1 = evaluatorIds[0];
    const sessionsBefore = await evaluationSessionCount(foreignId);
    const publishesBefore = publishSpy.mock.calls.length;

    // A DIFFERENT applicant — holding their own ACTIVE cycle, clean capacity,
    // and a legal evaluator target — replays Applicant A's spent key. The
    // claim-table 23505 decides: the foreign branch NEVER reveals the claim's
    // owner; the denial is byte-identical to targeting a nonexistent session.
    const denial = await catchJourneyError(() =>
      EvaluationBookingService.bookEvaluation(foreignId, { evaluatorId: evaluatorE1 }, bookKey("e2"), "en")
    );
    if (!(denial instanceof NotFoundError)) {
      throw new Error(`expected NotFoundError (got ${denial instanceof Error ? denial.name : String(denial)})`);
    }
    expect(denial.code).toBe("SESSION_NOT_FOUND");
    expect(denial.message).toContain(ERRORS_EN.sessionNotFound);

    // Zero new rows for the foreign caller: no session, no claim, no publish;
    // Applicant A's decided session stays byte-identical.
    expect(await evaluationSessionCount(foreignId)).toBe(sessionsBefore);
    expect(await db.$count(sessionRequestIdempotency, eq(sessionRequestIdempotency.userId, foreignId))).toBe(0);
    expect(publishSpy.mock.calls).toHaveLength(publishesBefore);
    const statusA = await EvaluationBookingService.myEvaluationLoopStatus(applicantId, "en");
    expect(statusA.bookedCount).toBe(2);
    expect(statusA.remainingCredits).toBe(VERIFICATION_PLAN_SESSION_COUNT - 2);
  });

  test("step 11 — Applicant A books E3-E5: the loop reaches booked=5 with remaining=0; every evaluator got their receipt", async () => {
    const applicantId = applicantAId();
    const sessionsBefore = await evaluationSessionCount(applicantId);
    const publishesBefore = publishSpy.mock.calls.length;

    await Promise.all(
      evaluatorIds
        .slice(2)
        .map((evaluatorId, offset) => bookEvaluatorTracked(applicantId, evaluatorId, bookKey(`e${offset + 3}`)))
    );

    // Five distinct committed ACTIVE evaluation rows — E1 (re-booked) + E2-E5 —
    // plus the cancelled first E1 row still persisted for history.
    expect(await evaluationSessionCount(applicantId)).toBe(sessionsBefore + 3);
    expect(await evaluationSessionCount(applicantId)).toBe(bookedSessions.length + 1);
    const distinctEvaluators = new Set(bookedSessions.map(bookedRow => bookedRow.teacherId));
    expect(distinctEvaluators.size).toBe(VERIFICATION_PLAN_SESSION_COUNT);

    const status = await EvaluationBookingService.myEvaluationLoopStatus(applicantId, "en");
    expect(status.bookedCount).toBe(VERIFICATION_PLAN_SESSION_COUNT);
    expect(status.completedCount).toBe(0);
    expect(status.remainingCredits).toBe(0);

    // One receipt per newly booked evaluator (E3-E5), each targeted exactly.
    expect(publishSpy.mock.calls).toHaveLength(publishesBefore + 3);
    const inboxCounts = await Promise.all(evaluatorIds.slice(2).map(evaluatorId => inboxCount(evaluatorId)));
    expect(inboxCounts).toEqual([1, 1, 1]);
  });

  test("step 12 — sixth booking (not all completed): NO_EVALUATION_CREDITS_REMAINING; the reads stay accurate and read-only", async () => {
    const applicantId = applicantAId();
    const evaluatorE1 = evaluatorIds[0];
    const sessionsBefore = await evaluationSessionCount(applicantId);
    const publishesBefore = publishSpy.mock.calls.length;

    // The capacity branch fires while completions are outstanding: the
    // CEILING is the five booked rows, and the branch prefers the
    // credits-remaining conflict over the loop-complete one.
    const denial = await catchJourneyError(() =>
      EvaluationBookingService.bookEvaluation(applicantId, { evaluatorId: evaluatorE1 }, bookKey("sixth"), "en")
    );
    if (!(denial instanceof ConflictError)) {
      throw new Error(`expected ConflictError (got ${denial instanceof Error ? denial.name : String(denial)})`);
    }
    expect(denial.code).toBe("NO_EVALUATION_CREDITS_REMAINING");
    expect(denial.message).toContain(ERRORS_EN.noEvaluationCreditsRemaining);

    // Zero new rows; the denial is silent.
    expect(await evaluationSessionCount(applicantId)).toBe(sessionsBefore);
    expect(publishSpy.mock.calls).toHaveLength(publishesBefore);

    // Exhaustion NEVER breaks the reads: the status stays accurate and the
    // picker still answers (excluding every used evaluator of the cycle).
    const status = await EvaluationBookingService.myEvaluationLoopStatus(applicantId, "en");
    expect(status.bookedCount).toBe(VERIFICATION_PLAN_SESSION_COUNT);
    expect(status.completedCount).toBe(0);
    expect(status.remainingCredits).toBe(0);
    const picker = await EvaluationBookingService.availableEvaluators(applicantId, 1, 100, "en");
    const pickerIds = picker.items.map(option => option.id);
    for (const evaluatorId of evaluatorIds) {
      expect(pickerIds).not.toContain(evaluatorId);
    }
  });

  test("step 13 — evaluators drive start → complete on all five sessions; the applicant's completedCount reaches 5", async () => {
    const applicantId = applicantAId();
    const publishesBefore = publishSpy.mock.calls.length;
    const applicantInboxBefore = await inboxCount(applicantId);

    await Promise.all(bookedSessions.map(bookedRow => driveSessionToCompletion(bookedRow)));

    // Free-completing contract (REQ-6): the evaluation sessions complete with
    // NO escrow movement — the applicant holds no lane balance and owns no
    // students row throughout.
    expect(await studentsRowCount(applicantId)).toBe(0);

    // The loop progress counts every completion.
    const status = await EvaluationBookingService.myEvaluationLoopStatus(applicantId, "en");
    expect(status.bookedCount).toBe(VERIFICATION_PLAN_SESSION_COUNT);
    expect(status.completedCount).toBe(VERIFICATION_PLAN_SESSION_COUNT);
    expect(status.remainingCredits).toBe(0);

    // Each completion publishes the confirm-prompt to the session's student
    // (the applicant) — five receipts, all addressed to the applicant.
    expect(publishSpy.mock.calls).toHaveLength(publishesBefore + VERIFICATION_PLAN_SESSION_COUNT);
    expect(await inboxCount(applicantId)).toBe(applicantInboxBefore + VERIFICATION_PLAN_SESSION_COUNT);

    // The applicant's own read keeps the full history, cancelled row included.
    const applicantView = await EvaluationBookingService.myEvaluationSessions(
      applicantId,
      { status: null },
      1,
      25,
      "en"
    );
    expect(applicantView.totalCount).toBe(VERIFICATION_PLAN_SESSION_COUNT + 1);
  });

  test("step 14 — sixth booking (loop complete): EVALUATION_LOOP_COMPLETE closes the cycle", async () => {
    const applicantId = applicantAId();
    const evaluatorE1 = evaluatorIds[0];
    const sessionsBefore = await evaluationSessionCount(applicantId);
    const publishesBefore = publishSpy.mock.calls.length;

    // All five sessions completed: the capacity branch now reports the loop
    // COMPLETE — a terminal conflict, not a credits shortage.
    const denial = await catchJourneyError(() =>
      EvaluationBookingService.bookEvaluation(applicantId, { evaluatorId: evaluatorE1 }, bookKey("loop-complete"), "en")
    );
    if (!(denial instanceof ConflictError)) {
      throw new Error(`expected ConflictError (got ${denial instanceof Error ? denial.name : String(denial)})`);
    }
    expect(denial.code).toBe("EVALUATION_LOOP_COMPLETE");
    expect(denial.message).toContain(ERRORS_EN.evaluationLoopComplete);

    // Zero new rows; the denial is silent.
    expect(await evaluationSessionCount(applicantId)).toBe(sessionsBefore);
    expect(publishSpy.mock.calls).toHaveLength(publishesBefore);

    // The reads stay accurate after the terminal denial.
    const status = await EvaluationBookingService.myEvaluationLoopStatus(applicantId, "en");
    expect(status.completedCount).toBe(VERIFICATION_PLAN_SESSION_COUNT);
    expect(status.remainingCredits).toBe(0);
  });
});
