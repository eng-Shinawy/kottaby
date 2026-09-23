/**
 * Cross-actor journey — DEV2-007: the evaluation rubric scoring loop, from the
 * five completed evaluation sessions to the deterministic verdict that closes
 * the cycle. Sequential actor-attributed steps execute against the REAL
 * services on the REAL test database; later steps observe the shared state
 * earlier steps committed.
 *
 * Trajectories:
 *   1. PASS — five distinct certified evaluators submit rubrics (all scores
 *      >= 80, the 80 boundary included) against one applicant's completed
 *      sessions; the FIFTH submission finalizes in its own transaction: a
 *      `teacher` row is minted (is_approved=true, is_evaluator=false), the
 *      applicant flips to `passed` with a NULL cooldown, and exactly one
 *      `evaluation_result` notification is published to the applicant.
 *   2. FAIL (tajweed) — a cycle whose lowest score is a tajweed-79 finalizes
 *      `failed` with cooldown ≈ now+30d; re-purchase is denied while the
 *      cooldown instant is strictly in the future; NO teacher row, NO
 *      students row, NO users suspension writes.
 *   3. FAIL (hifz) — the same shape with a hifz-79 → cooldown ≈ now+90d.
 *   4. Denial battery — non-assigned certified teacher (SESSION_NOT_FOUND),
 *      uninvolved student caller (constant-shape no-oracle denial at the
 *      service boundary; the transport-level FORBIDDEN role-scope rejection
 *      is pinned by the GraphQL tier), duplicate submission
 *      (EVALUATION_ALREADY_SUBMITTED), non-completed session
 *      (RUBRIC_SESSION_NOT_COMPLETED), failing score without a weakness
 *      (RUBRIC_WEAKNESS_REQUIRED), passing score with a weakness
 *      (RUBRIC_WEAKNESS_NOT_ALLOWED), out-of-range score, and blank notes —
 *      every denial writes ZERO rows and stays silent.
 *   5. Cross-actor visibility — a submitted row leaves the evaluator's
 *      pending read while the other evaluators keep theirs; the 5th
 *      submission's return already carries the final applicant status; a
 *      post-finalization submission is rejected with the typed conflict and
 *      zero rows.
 *
 * Cast: applicant A (cast member, pending), fail-cast applicants B and C,
 * five certified evaluators E1-E5 (real users + real teacher rows with
 * isApproved + isEvaluator), one certified NON-evaluator teacher, plus the
 * sanctioned cast bystanders. Fixture identity fields carry the per-run
 * `jrn_rubric_<8hex>` prefix so repeated or parallel runs never collide.
 *
 * Journey rules honored (`test/workflows/AGENTS.md`):
 * - fixtures COMMITTED in `beforeAll` (sanctioned cast provisioner + ONE
 *   committing transaction for the evaluators, the fail casts, and the plan);
 *   never `runInRollback` (the services own their transactions);
 * - honest actors: real `users` rows + real role-child rows; denials flow
 *   through the real service-level gates — nothing monkey-patched;
 * - external effects intercepted at the notification dispatch boundary: the
 *   engine's publish seam is SPIED and every step asserts receipts and inbox
 *   deltas — nothing reaches a real channel;
 * - error assertions through `catchJourneyError` + translated substrings —
 *   never `.rejects.toThrow()`, no hardcoded English strings;
 * - full cleanup: notifications sweep → immutable ledger leg → tracked
 *   fixtures → cast cleanup → post-teardown residue probes for every
 *   generated user id.
 *
 * TEST-FIRST (expected RED state): the rubric service surface does not exist
 * yet. The service module is loaded through a NON-ANALYZABLE dynamic import
 * as the FIRST `beforeAll` statement — so the RED failure mode is exactly
 * `Cannot find module …/evaluation-rubric.service` thrown BEFORE any fixture
 * write (zero DB residue on the RED run), while `tsgo` stays at 0 errors (a
 * static import of the missing module would break the type-check). The
 * import turns green when the service lands, without edits to this file.
 *
 * Service surface this journey binds to:
 *   backend/services/teachers/evaluation-rubric.service.ts
 *   export namespace EvaluationRubricService {
 *     submitRubricEvaluation(evaluatorUserId, sessionId, input, locale, outerTx?):
 *       Promise<RubricEvaluationReturnType>
 *     myRubricPendingSessions(callerUserId, page, pageSize, locale, outerTx?):
 *       Promise<SessionPageReturnType>
 *     myRubricEvaluation(callerUserId, sessionId, locale, outerTx?):
 *       Promise<RubricEvaluationReturnType>
 *   }
 */

import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { eq, inArray, or } from "drizzle-orm";
import { db } from "@/backend/db";
import { PlanRepository } from "@/backend/db/repo";
import { plans } from "@/backend/db/schema/billing/plans";
import { studentPayments } from "@/backend/db/schema/billing/student-payments";
import { studentSubscriptions } from "@/backend/db/schema/billing/student-subscriptions";
import { subscriptionPurchaseIdempotency } from "@/backend/db/schema/billing/subscription-purchase-idempotency";
import { subscriptions } from "@/backend/db/schema/billing/subscriptions";
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
import { createTestApplicant, createTestPlan, createTestUser } from "@/backend/db/test/entity-setup";
import { SubscriptionCreditLane } from "@/backend/enum/billing/subscription-credit-lane.enum";
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
import type {
  DBTransaction,
  PaymentWebhookEvent,
  PlanSelectType,
  SessionPageReturnType,
  SessionReturnType,
  UserSelectType,
} from "@/backend/types";
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

/** Error-copy locale for every service call and denial assertion. */
const LOCALE = "en";

/** Translated error copy source — never hardcoded English expectation strings. */
const ERRORS_EN = getServerTranslations(LOCALE).errorsTranslations;

/** Per-run unique prefix — every key/name derives from it (no cross-run collisions). */
const PREFIX = journeyPrefix("rubric");

/**
 * The notification type widened to its primitive string value — the DB column
 * infers a string union, so comparisons go through this constant.
 */
const NOTIF_TYPE_EVALUATION_RESULT: string = NotificationType.EvaluationResult;

/** Journey-local mirrors of the canonical rubric thresholds and cooldown durations. */
const PASS_THRESHOLD = 80;
const MS_PER_DAY = 86_400_000;
const TAJWEED_COOLDOWN_MS = 30 * MS_PER_DAY;
const HIFZ_COOLDOWN_MS = 90 * MS_PER_DAY;
/** Tolerance between the service's captured-now and the journey's observation window. */
const CLOCK_SKEW_MS = 5_000;

/**
 * RED-posture service specifier: a variable-specifier dynamic import keeps
 * `tsgo` at 0 errors while the module is absent. The path is relative to
 * THIS file → `<repo>/backend/services/teachers/…`.
 */
const SERVICE_PATH = "@/backend/services/teachers/evaluation-rubric.service";

/** Journey-local mirror of the rubric weakness vocabulary (the service owns the enum). */
type RubricWeaknessValue = "tajweed" | "hifz";

/** Journey-local mirror of the rubric submission input (the service's sealed input shape). */
interface RubricSubmitInputShape {
  readonly score: number;
  readonly notes: string;
  readonly weaknessArea: RubricWeaknessValue | null;
}

/**
 * Journey-local mirror of the rubric read-model — evaluator notes stay
 * server-side, so the shape carries NO notes field (closed key-set pinned).
 */
interface RubricEvaluationShape {
  readonly id: number;
  readonly sessionId: number | null;
  readonly evaluatedId: number;
  readonly evaluatorId: number;
  readonly score: number | null;
  readonly weaknessArea: RubricWeaknessValue | null;
  readonly createdAt: Date;
  readonly applicantStatus: ApplicantStatus;
}

/** Locally-declared mirror of the service-surface contract the journey binds to. */
interface EvaluationRubricServiceShape {
  submitRubricEvaluation(
    evaluatorUserId: number,
    sessionId: number,
    input: RubricSubmitInputShape,
    locale: string,
    outerTx?: DBTransaction
  ): Promise<RubricEvaluationShape>;
  myRubricPendingSessions(
    callerUserId: number,
    page: number,
    pageSize: number,
    locale: string
  ): Promise<SessionPageReturnType>;
  myRubricEvaluation(callerUserId: number, sessionId: number, locale: string): Promise<RubricEvaluationShape>;
}

/** The three surface ops a genuine rubric service must expose as functions. */
const REQUIRED_SERVICE_OPS = ["submitRubricEvaluation", "myRubricPendingSessions", "myRubricEvaluation"] as const;

/**
 * Assertion-free runtime narrowing of the dynamically imported service
 * surface (type guards, never `as`) — every op must be a function on the
 * exported namespace object.
 */
function isEvaluationRubricService(value: unknown): value is EvaluationRubricServiceShape {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  return REQUIRED_SERVICE_OPS.every(op => typeof Reflect.get(value, op) === "function");
}

/** Closed read-model key-set — notes deliberately absent (server-side posture). */
const RUBRIC_READ_MODEL_KEYS = [
  "applicantStatus",
  "createdAt",
  "evaluatedId",
  "evaluatorId",
  "id",
  "score",
  "sessionId",
  "weaknessArea",
];

/** Tracked fixture rows (evaluators, fail casts, plan, service-created rows). */
const tracked = new TrackedFixtures();

/** The fan-out publish spy — installed over the engine's publish boundary and restored in `afterAll`. */
const publishSpy = spyOn(NotificationEngine, "publishReceipts").mockImplementation(async () => {});

/** Journey cast: the sanctioned provisioner bundle (null when beforeAll aborted early). */
let bundle: JourneyFixtureBundle | null = null;
/** The rubric service surface (null on the RED run — every step reports it). */
let service: EvaluationRubricServiceShape | null = null;
/** The purchase target as the SERVICE resolves it (active catalog + exact-title match). */
let planRow: PlanSelectType;
/** The plan row id THIS journey created (0 = the seeded catalog member served). */
let journeyCreatedPlanId = 0;
/** Certified evaluators E1-E5 (real users + teacher rows with isApproved + isEvaluator). */
const evaluatorIds: number[] = [];
/** Fail-cast applicant user ids (tajweed cycle, hifz cycle). */
let applicantTajweedId = 0;
let applicantHifzId = 0;
/** Ledger rows created by the purchase services during the journey (teardown worklist). */
const ledgerPaymentIds: number[] = [];
const ledgerSubscriptionIds: number[] = [];
/** The booked sessions per cast (A = pass cycle, then the two fail cycles). */
const passCycleSessions: SessionReturnType[] = [];
const tajweedCycleSessions: SessionReturnType[] = [];
const hifzCycleSessions: SessionReturnType[] = [];

/** The pass-cycle applicant under test (cast member A). */
function applicantAId(): number {
  return requireBundle().cast.applicant.user.id;
}

function requireBundle(): JourneyFixtureBundle {
  if (bundle === null) {
    throw new Error("journey state missing: the cast was not provisioned");
  }
  return bundle;
}

/** Every user id this journey generates (cast + evaluators + fail casts). */
function allJourneyUserIds(): number[] {
  const castIds = bundle?.registry.userIds ?? [];
  return [...castIds, ...evaluatorIds, applicantTajweedId, applicantHifzId];
}

function requireService(): EvaluationRubricServiceShape {
  if (service === null) {
    throw new Error("journey state missing: the rubric service surface was not loaded");
  }
  return service;
}

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

/** Fresh read of one users row by id (null when absent). */
async function readUserRow(userId: number): Promise<UserSelectType | null> {
  const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return rows[0] ?? null;
}

/** Number of `students` rows behind a user id — the conversion-absence probe. */
async function studentsRowCount(userId: number): Promise<number> {
  return db.$count(students, eq(students.id, userId));
}

/** Number of `teacher` rows behind a user id — the teacher-row-mint probe. */
async function teacherRowCount(userId: number): Promise<number> {
  return db.$count(teacher, eq(teacher.id, userId));
}

/** Committed rubric submissions whose evaluated subject is the given user. */
async function rubricRowCountFor(evaluatedUserId: number): Promise<number> {
  return db.$count(evaluations, eq(evaluations.evaluatedId, evaluatedUserId));
}

/** Inbox count for one user (independent read-back oracle). */
async function inboxCount(userId: number): Promise<number> {
  return db.$count(notifications, eq(notifications.userId, userId));
}

/** The user's persisted inbox rows filtered to the evaluation-result type. */
async function evaluationResultRowsFor(userId: number) {
  const rows = await db.select().from(notifications).where(eq(notifications.userId, userId));
  return rows.filter(row => row.type === NOTIF_TYPE_EVALUATION_RESULT);
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

/** Prefix-stamped rubric notes — unique per run, well under the length ceiling. */
function rubricNotes(tag: string): string {
  return `${PREFIX} rubric notes ${tag}`;
}

/** A valid passing-score rubric payload (notes prefix-stamped, no weakness). */
function passingRubric(tag: string): RubricSubmitInputShape {
  return { score: 90, notes: rubricNotes(tag), weaknessArea: null };
}

/** The copy fragment of a translated template BEFORE its first placeholder. */
function templatePrefix(template: string): string {
  return template.split("{")[0] ?? template;
}

/**
 * Denial oracle — catches through the journey helper (never `rejects.toThrow`),
 * pins the DomainError class, the exact error code, and (when the copy already
 * exists in the errors namespace) the translated message substring.
 */
async function expectTypedDenial(
  fn: () => Promise<unknown>,
  errorClass: typeof ConflictError | typeof NotFoundError | typeof ValidationError,
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

/** Locale-stable comparator for sorted key-set assertions. */
function compareStrings(a: string, b: string): number {
  return a.localeCompare(b);
}

/** Closed-shape assertion for the rubric read-model (no notes field, ever). */
function expectRubricReadModel(row: RubricEvaluationShape): void {
  expect(Object.keys(row).toSorted(compareStrings)).toEqual(RUBRIC_READ_MODEL_KEYS);
}

// ─── Journey-step helpers ────────────────────────────────────────────────────

/**
 * Purchases the verification plan for one applicant and drives the confirmed
 * gateway webhook that activates the subscription. Registers every committed
 * row (subscription, payment, purchase claim) and asserts the ONE
 * payment-confirmation receipt published to the purchaser only.
 */
async function purchaseAndActivateTracked(applicantUserId: number, castTag: string): Promise<void> {
  const key = `${PREFIX}-key-purchase-${castTag}`;
  const publishesBefore = publishSpy.mock.calls.length;

  const result = await VerificationPurchaseService.purchase(applicantUserId, key, LOCALE);
  const claimRows = await db
    .select()
    .from(subscriptionPurchaseIdempotency)
    .where(eq(subscriptionPurchaseIdempotency.idempotencyKey, key));
  expect(claimRows).toHaveLength(1);

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
  const outcome = await SubscriptionActivationService.processWebhookEvent(event, LOCALE);
  expect(outcome).toEqual({ processed: true });

  tracked.register(subscriptions, result.subscription.id);
  tracked.register(studentPayments, result.payment.id);
  for (const claimRow of claimRows) {
    tracked.register(subscriptionPurchaseIdempotency, claimRow.id);
  }
  ledgerSubscriptionIds.push(result.subscription.id);
  ledgerPaymentIds.push(result.payment.id);

  expect(publishSpy.mock.calls).toHaveLength(publishesBefore + 1);
  expect(lastPublishedRecipientIds()).toEqual([applicantUserId]);
}

/**
 * Recursion body of `bookCycleTracked` — books the evaluator at `index`, then
 * recurses (a sequential booking order with no awaited loop, per the lint
 * rules). Registers every session row + verbatim-keyed booking claim.
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
  const key = `${PREFIX}-key-book-${castTag}-e${index + 1}`;
  const row = await EvaluationBookingService.bookEvaluation(applicantUserId, { evaluatorId }, key, LOCALE);
  expect(row.teacherId).toBe(evaluatorId);
  expect(row.studentId).toBe(applicantUserId);
  expect(row.status).toBe(SessionStatus.Scheduled);
  expect(row.sessionType).toBe(SessionType.TeacherEvaluation);
  expect(row.intent).toBe(SessionIntent.Evaluation);
  tracked.register(session, row.id);
  const claimRows = await db
    .select()
    .from(sessionRequestIdempotency)
    .where(eq(sessionRequestIdempotency.idempotencyKey, key));
  expect(claimRows).toHaveLength(1);
  for (const claimRow of claimRows) {
    tracked.register(sessionRequestIdempotency, claimRow.id);
  }
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
  input: RubricSubmitInputShape
): Promise<RubricEvaluationShape> {
  const result = await requireService().submitRubricEvaluation(evaluatorUserId, sessionRow.id, input, LOCALE);
  tracked.register(evaluations, result.id);
  return result;
}

// ─── Fixture provisioning ────────────────────────────────────────────────────

beforeAll(async () => {
  // RED-posture FIRST statement: load the not-yet-existing service module
  // through a non-analyzable specifier. When the surface is absent this
  // throws `Cannot find module …` BEFORE any fixture write — zero DB
  // residue on the RED run. The import resolves without edits once the
  // service module lands.
  const mod = await import(SERVICE_PATH);
  const candidate: unknown = mod.EvaluationRubricService;
  if (!isEvaluationRubricService(candidate)) {
    throw new Error(`${SERVICE_PATH} did not export the EvaluationRubricService surface`);
  }
  service = candidate;

  // Phase 1 — the sanctioned cast provisioner: real users + role-children in
  // ONE committing transaction (applicant A pending, the certified
  // NON-evaluator teacher, plus the bystander members).
  const provisionedBundle = await createJourneyFixtures(PREFIX);
  bundle = provisionedBundle;

  // Phase 2 — ONE committing transaction for everything else the journey
  // needs: the five certified evaluators, the two fail-cast applicants, the
  // persisted EN locale for the whole cast, and the verification plan fixture.
  await db.transaction(async tx => {
    const provisionedEvaluators = await Promise.all(
      Array.from({ length: VERIFICATION_PLAN_SESSION_COUNT }, async (_, index) => {
        const user = await createTestUser(tx, { role: "teacher", locale: LOCALE });
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

    const failCasts = await Promise.all(
      (["fail-tajweed", "fail-hifz"] as const).map(async castTag => {
        const user = await createTestUser(tx, { role: "teacher", locale: LOCALE });
        await createTestApplicant(tx, user.id, { status: ApplicantStatus.Pending });
        return { castTag, userId: user.id };
      })
    );
    for (const { castTag, userId } of failCasts) {
      tracked.register(users, userId);
      tracked.register(applicants, userId);
      if (castTag === "fail-tajweed") {
        applicantTajweedId = userId;
      } else {
        applicantHifzId = userId;
      }
    }

    const castUserIds = [
      provisionedBundle.cast.admin.user.id,
      provisionedBundle.cast.student.user.id,
      provisionedBundle.cast.parent.user.id,
      provisionedBundle.cast.applicant.user.id,
      provisionedBundle.cast.certifiedTeacher.user.id,
    ];
    await tx
      .update(users)
      .set({ locale: LOCALE })
      .where(inArray(users.id, [...castUserIds, ...evaluatorIds]));

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
  if (journeyIds.length > 0) {
    await db.delete(notifications).where(inArray(notifications.userId, journeyIds));
    const inboxResidue = await db.$count(notifications, inArray(notifications.userId, journeyIds));
    if (inboxResidue !== 0) {
      throw new Error(`journey teardown: ${inboxResidue} notification row(s) survived deletion`);
    }
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
  // tracked row (claims → sessions → rubric rows → subscriptions → casts' rows → plan).
  await tracked.cleanup();

  // Cast rows via the provisioner registry: audit-log sweep under suspended
  // triggers, role-children, then users. Skipped when the cast was never
  // provisioned (an aborted beforeAll leaves nothing behind).
  if (bundle !== null) {
    await journeyCleanup(bundle.registry);
  }

  // Post-teardown existence probes for EVERY generated user id — the residue
  // check is load-bearing, not advisory. Skipped when nothing was ever
  // provisioned (an aborted beforeAll commits nothing, so nothing can remain).
  if (journeyIds.length === 0) {
    return;
  }
  const [
    userResidue,
    applicantResidue,
    studentResidue,
    teacherResidue,
    parentResidue,
    adminResidue,
    sessionResidue,
    evaluationResidue,
  ] = await Promise.all([
    db.$count(users, inArray(users.id, journeyIds)),
    db.$count(applicants, inArray(applicants.id, journeyIds)),
    db.$count(students, inArray(students.id, journeyIds)),
    db.$count(teacher, inArray(teacher.id, journeyIds)),
    db.$count(parents, inArray(parents.id, journeyIds)),
    db.$count(admin, inArray(admin.id, journeyIds)),
    db.$count(session, or(inArray(session.studentId, journeyIds), inArray(session.teacherId, journeyIds))),
    db.$count(
      evaluations,
      or(inArray(evaluations.evaluatedId, journeyIds), inArray(evaluations.evaluatorId, journeyIds))
    ),
  ]);
  expect(userResidue).toBe(0);
  expect(applicantResidue).toBe(0);
  expect(studentResidue).toBe(0);
  expect(teacherResidue).toBe(0);
  expect(parentResidue).toBe(0);
  expect(adminResidue).toBe(0);
  expect(sessionResidue).toBe(0);
  expect(evaluationResidue).toBe(0);
});

// ─── The journey ─────────────────────────────────────────────────────────────

describe("DEV2-007 — evaluation rubric scoring journey (five-evaluator verdict loop)", () => {
  test("step 1 — System: committed cast + five certified evaluators + fail casts + plan; the rubric slate starts empty", async () => {
    const applicantId = applicantAId();

    // Applicant A is a PENDING applicant with a NULL cooldown — the exact
    // precondition the verification purchase flips.
    const row = await readApplicantRow(applicantId);
    expect(row.status).toBe(ApplicantStatus.Pending);
    expect(row.cooldownUntil).toBeNull();

    // The five evaluators hold REAL certified-evaluator teacher rows; the
    // cast's certified teacher is deliberately NOT an evaluator (the
    // non-assigned denial caller); the fail casts are pending applicants.
    const evaluatorRows = await db.select().from(teacher).where(inArray(teacher.id, evaluatorIds));
    expect(evaluatorRows).toHaveLength(VERIFICATION_PLAN_SESSION_COUNT);
    for (const evaluatorRow of evaluatorRows) {
      expect(evaluatorRow.isApproved).toBe(true);
      expect(evaluatorRow.isEvaluator).toBe(true);
    }
    expect(requireBundle().cast.certifiedTeacher.child.isEvaluator).toBe(false);
    expect((await readApplicantRow(applicantTajweedId)).status).toBe(ApplicantStatus.Pending);
    expect((await readApplicantRow(applicantHifzId)).status).toBe(ApplicantStatus.Pending);

    // Clean slate everywhere the journey asserts deltas.
    expect(await rubricRowCountFor(applicantId)).toBe(0);
    expect(await rubricRowCountFor(applicantTajweedId)).toBe(0);
    expect(await rubricRowCountFor(applicantHifzId)).toBe(0);
    expect(await studentsRowCount(applicantId)).toBe(0);
    expect(await teacherRowCount(applicantId)).toBe(0);
    expect(await inboxCount(applicantId)).toBe(0);
    expect(publishSpy.mock.calls).toHaveLength(0);

    // The resolved purchase target carries the product contract verbatim.
    expect(planRow.sessionCount).toBe(VERIFICATION_PLAN_SESSION_COUNT);
    expect(planRow.price).toBe(VERIFICATION_PLAN_PRICE);
    expect(planRow.currency).toBe(VERIFICATION_PLAN_CURRENCY);
    expect(planRow.intervalDays).toBe(VERIFICATION_PLAN_INTERVAL_DAYS);
  });

  test("step 2 — Applicant A: verification purchase + confirmed webhook open the cycle (in_evaluation, zero rubric rows)", async () => {
    const applicantId = applicantAId();

    await purchaseAndActivateTracked(applicantId, "a");

    // The cycle is open: the applicant flipped at purchase and the webhook
    // verified + activated the subscription window.
    const row = await readApplicantRow(applicantId);
    expect(row.status).toBe(ApplicantStatus.InEvaluation);
    expect(row.cooldownUntil).toBeNull();
    const profile = await ApplicantLifecycleService.getMyApplicantProfile(applicantId, LOCALE);
    if (!profile) {
      throw new Error("expected the purchaser's self profile to resolve after activation");
    }
    expect(profile.status).toBe(ApplicantStatus.InEvaluation);

    // The lane-credit surface stays ABSENT for the applicant, and no rubric
    // row can exist before any submission.
    expect(await studentsRowCount(applicantId)).toBe(0);
    expect(await rubricRowCountFor(applicantId)).toBe(0);
  });

  test("step 3 — Applicant A books E1-E5: five distinct scheduled evaluation sessions, remaining credits 0", async () => {
    const applicantId = applicantAId();

    const booked = await bookCycleTracked(applicantId, "a");
    passCycleSessions.push(...booked);

    const status = await EvaluationBookingService.myEvaluationLoopStatus(applicantId, LOCALE);
    expect(status.bookedCount).toBe(VERIFICATION_PLAN_SESSION_COUNT);
    expect(status.remainingCredits).toBe(0);
  });

  test("step 4 — E1-E4 drive start → complete; completed rows populate the pending reads while E5's scheduled row stays off them", async () => {
    const completedSessions = passCycleSessions.slice(0, VERIFICATION_PLAN_SESSION_COUNT - 1);
    await Promise.all(completedSessions.map(sessionRow => completeEvaluationSession(sessionRow)));

    // Cross-actor visibility BEFORE any submission: each completed session
    // shows up on its OWN evaluator's pending read; E5's session is still
    // scheduled, so E5's pending read is empty.
    const completedIds = new Set(completedSessions.map(sessionRow => sessionRow.id));
    const pendingReads = await Promise.all(
      passCycleSessions.map(async sessionRow => ({
        sessionRow,
        page: await requireService().myRubricPendingSessions(sessionRow.teacherId, 1, 25, LOCALE),
      }))
    );
    for (const { sessionRow, page } of pendingReads) {
      if (completedIds.has(sessionRow.id)) {
        expect(page.totalCount).toBe(1);
        expect(page.items[0]?.id).toBe(sessionRow.id);
      } else {
        expect(page.totalCount).toBe(0);
      }
    }
  });

  test("step 5 — E1 submits the first rubric (92): quorum 1/5; the row leaves E1's pending read and stays on E2's; the applicant is unchanged", async () => {
    const applicantId = applicantAId();
    const firstSession = passCycleSessions[0];
    if (!firstSession) {
      throw new Error("journey state: the first pass-cycle session is missing");
    }

    const result = await submitRubricTracked(firstSession.teacherId, firstSession, {
      score: 92,
      notes: rubricNotes("e1"),
      weaknessArea: null,
    });
    expectRubricReadModel(result);
    expect(result.score).toBe(92);
    expect(result.weaknessArea).toBeNull();
    expect(result.applicantStatus).toBe(ApplicantStatus.InEvaluation);
    expect(result.evaluatedId).toBe(applicantId);
    expect(result.evaluatorId).toBe(firstSession.teacherId);
    expect(result.sessionId).toBe(firstSession.id);

    // Write-once visible both ways: the row left E1's pending read and the
    // own-submission read answers without the notes; E2 keeps her row.
    const e1Pending = await requireService().myRubricPendingSessions(firstSession.teacherId, 1, 25, LOCALE);
    expect(e1Pending.totalCount).toBe(0);
    const own = await requireService().myRubricEvaluation(firstSession.teacherId, firstSession.id, LOCALE);
    expectRubricReadModel(own);
    expect(own.score).toBe(92);
    expect(own.applicantStatus).toBe(ApplicantStatus.InEvaluation);
    const secondSession = passCycleSessions[1];
    if (!secondSession) {
      throw new Error("journey state: the second pass-cycle session is missing");
    }
    const e2Pending = await requireService().myRubricPendingSessions(secondSession.teacherId, 1, 25, LOCALE);
    expect(e2Pending.totalCount).toBe(1);
    expect(e2Pending.items[0]?.id).toBe(secondSession.id);

    // Quorum 1/5: the applicant stays in_evaluation, exactly one rubric row.
    const row = await readApplicantRow(applicantId);
    expect(row.status).toBe(ApplicantStatus.InEvaluation);
    expect(row.cooldownUntil).toBeNull();
    expect(await rubricRowCountFor(applicantId)).toBe(1);
  });

  test("step 6 — E2-E4 submit (85 / 80 / 100): quorum 4/5 with the 80 boundary recorded; the applicant stays in_evaluation with zero verdict writes", async () => {
    const applicantId = applicantAId();
    const publishesBefore = publishSpy.mock.calls.length;

    const scores = [85, PASS_THRESHOLD, 100];
    const scoredSessions = passCycleSessions.slice(1, 4);
    const results = await Promise.all(
      scoredSessions.map((sessionRow, index) =>
        submitRubricTracked(sessionRow.teacherId, sessionRow, {
          score: scores[index] ?? 0,
          notes: rubricNotes(`pass-e${index + 2}`),
          weaknessArea: null,
        })
      )
    );
    for (const result of results) {
      expectRubricReadModel(result);
      expect(result.applicantStatus).toBe(ApplicantStatus.InEvaluation);
    }

    // Quorum pending: no verdict writes of any kind, no publish.
    const row = await readApplicantRow(applicantId);
    expect(row.status).toBe(ApplicantStatus.InEvaluation);
    expect(row.cooldownUntil).toBeNull();
    expect(await teacherRowCount(applicantId)).toBe(0);
    expect(await rubricRowCountFor(applicantId)).toBe(4);
    expect(publishSpy.mock.calls).toHaveLength(publishesBefore);
  });

  test("step 7 — denial battery: eight typed denials write ZERO rows and stay silent", async () => {
    const applicantId = applicantAId();
    const cast = requireBundle().cast;
    const nonEvaluatorId = cast.certifiedTeacher.user.id;
    const studentId = cast.student.user.id;
    const firstSession = passCycleSessions[0];
    const secondSession = passCycleSessions[1];
    const fifthSession = passCycleSessions[4];
    if (!firstSession || !secondSession || !fifthSession) {
      throw new Error("journey state: pass-cycle sessions are missing");
    }

    const rubricCountBefore = await rubricRowCountFor(applicantId);
    const publishesBefore = publishSpy.mock.calls.length;
    const nonEvaluatorInboxBefore = await inboxCount(nonEvaluatorId);

    // A certified NON-assigned teacher gets the constant-shape not-found —
    // unknown, foreign, and untyped sessions are indistinguishable, and the
    // assigned evaluator never learns of the attempt.
    await expectTypedDenial(
      () =>
        requireService().submitRubricEvaluation(nonEvaluatorId, secondSession.id, passingRubric("intruder"), LOCALE),
      NotFoundError,
      "SESSION_NOT_FOUND",
      ERRORS_EN.sessionNotFound
    );

    // An uninvolved STUDENT caller: the transport-level FORBIDDEN role-scope
    // rejection is pinned by the GraphQL tier; at the service boundary the
    // same no-oracle constant-shape denial holds (a student can never own an
    // evaluation session), with zero rows and zero fan-out.
    await expectTypedDenial(
      () => requireService().submitRubricEvaluation(studentId, firstSession.id, passingRubric("student"), LOCALE),
      NotFoundError,
      "SESSION_NOT_FOUND",
      ERRORS_EN.sessionNotFound
    );

    // A duplicate submission on the SAME (session, evaluator) pair is the
    // write-once conflict.
    await expectTypedDenial(
      () =>
        requireService().submitRubricEvaluation(
          firstSession.teacherId,
          firstSession.id,
          passingRubric("duplicate"),
          LOCALE
        ),
      ConflictError,
      "EVALUATION_ALREADY_SUBMITTED",
      ERRORS_EN.evaluationAlreadySubmitted
    );

    // The fifth evaluator's session is still SCHEDULED — owned and typed, but
    // not completed, so the submission is the completion-state conflict.
    await expectTypedDenial(
      () =>
        requireService().submitRubricEvaluation(
          fifthSession.teacherId,
          fifthSession.id,
          passingRubric("uncompleted"),
          LOCALE
        ),
      ConflictError,
      "RUBRIC_SESSION_NOT_COMPLETED"
    );

    // Pre-DB validation arms: a failing score without a weakness, a passing
    // score with one, an out-of-range score, and blank notes.
    await expectTypedDenial(
      () =>
        requireService().submitRubricEvaluation(
          firstSession.teacherId,
          firstSession.id,
          {
            score: PASS_THRESHOLD - 1,
            notes: rubricNotes("no-weakness"),
            weaknessArea: null,
          },
          LOCALE
        ),
      ValidationError,
      "RUBRIC_WEAKNESS_REQUIRED"
    );
    await expectTypedDenial(
      () =>
        requireService().submitRubricEvaluation(
          firstSession.teacherId,
          firstSession.id,
          {
            score: PASS_THRESHOLD + 5,
            notes: rubricNotes("with-weakness"),
            weaknessArea: "tajweed",
          },
          LOCALE
        ),
      ValidationError,
      "RUBRIC_WEAKNESS_NOT_ALLOWED"
    );
    await expectTypedDenial(
      () =>
        requireService().submitRubricEvaluation(
          firstSession.teacherId,
          firstSession.id,
          {
            score: 101,
            notes: rubricNotes("out-of-range"),
            weaknessArea: null,
          },
          LOCALE
        ),
      ValidationError,
      "RUBRIC_SCORE_INVALID"
    );
    await expectTypedDenial(
      () =>
        requireService().submitRubricEvaluation(
          firstSession.teacherId,
          firstSession.id,
          {
            score: 90,
            notes: "   ",
            weaknessArea: null,
          },
          LOCALE
        ),
      ValidationError,
      "RUBRIC_NOTES_REQUIRED"
    );

    // Every denial wrote nothing and stayed silent.
    expect(await rubricRowCountFor(applicantId)).toBe(rubricCountBefore);
    expect(publishSpy.mock.calls).toHaveLength(publishesBefore);
    expect(await inboxCount(nonEvaluatorId)).toBe(nonEvaluatorInboxBefore);
    const row = await readApplicantRow(applicantId);
    expect(row.status).toBe(ApplicantStatus.InEvaluation);
    expect(row.cooldownUntil).toBeNull();
    expect(await teacherRowCount(applicantId)).toBe(0);
  });

  test("step 8 — E5 completes and submits the fifth (80): ONE submission finalizes PASS — teacher row minted, status passed, cooldown NULL, one result notification", async () => {
    const applicantId = applicantAId();
    const fifthSession = passCycleSessions[4];
    if (!fifthSession) {
      throw new Error("journey state: the fifth pass-cycle session is missing");
    }
    await completeEvaluationSession(fifthSession);
    const pendingBefore = await requireService().myRubricPendingSessions(fifthSession.teacherId, 1, 25, LOCALE);
    expect(pendingBefore.totalCount).toBe(1);
    expect(pendingBefore.items[0]?.id).toBe(fifthSession.id);

    // The publish window opens AFTER the completion's own receipt has
    // flushed, so the window contains exactly the rubric submission's
    // post-commit receipt publish.
    const publishesBefore = publishSpy.mock.calls.length;

    // The BOUNDARY score: exactly 80 passes (the threshold is >=, not >).
    const result = await submitRubricTracked(fifthSession.teacherId, fifthSession, {
      score: PASS_THRESHOLD,
      notes: rubricNotes("pass-e5-boundary"),
      weaknessArea: null,
    });
    expectRubricReadModel(result);
    expect(result.score).toBe(PASS_THRESHOLD);
    expect(result.weaknessArea).toBeNull();
    expect(result.applicantStatus).toBe(ApplicantStatus.Passed);
    expect(result.sessionId).toBe(fifthSession.id);

    // The verdict writes: passed + NULL cooldown + a minted certified
    // NON-evaluator teacher row; NO students row, NO suspension writes.
    const row = await readApplicantRow(applicantId);
    expect(row.status).toBe(ApplicantStatus.Passed);
    expect(row.cooldownUntil).toBeNull();
    const teacherRows = await db.select().from(teacher).where(eq(teacher.id, applicantId));
    expect(teacherRows).toHaveLength(1);
    expect(teacherRows[0]?.isApproved).toBe(true);
    expect(teacherRows[0]?.isEvaluator).toBe(false);
    expect(await studentsRowCount(applicantId)).toBe(0);
    const userRow = await readUserRow(applicantId);
    if (!userRow) {
      throw new Error("expected the applicant's users row to survive finalization");
    }
    expect(userRow.suspended).toBe(false);
    expect(userRow.suspendedAt).toBeNull();
    expect(userRow.suspendedPeriodDays).toBeNull();

    // Exactly ONE evaluation_result notification in the applicant's inbox,
    // published strictly post-commit to the applicant ONLY.
    const resultRows = await evaluationResultRowsFor(applicantId);
    expect(resultRows).toHaveLength(1);
    expect(resultRows[0]?.relatedEntityType).toBe("session");
    expect(resultRows[0]?.relatedEntityId).toBe(fifthSession.id);
    expect(publishSpy.mock.calls).toHaveLength(publishesBefore + 1);
    expect(lastPublishedRecipientIds()).toEqual([applicantId]);

    // Cross-actor visibility: the pending read lost the row, the
    // own-submission read already reports the final status, and the
    // applicant's real self-profile read agrees.
    const pendingAfter = await requireService().myRubricPendingSessions(fifthSession.teacherId, 1, 25, LOCALE);
    expect(pendingAfter.totalCount).toBe(0);
    const own = await requireService().myRubricEvaluation(fifthSession.teacherId, fifthSession.id, LOCALE);
    expect(own.applicantStatus).toBe(ApplicantStatus.Passed);
    const profile = await ApplicantLifecycleService.getMyApplicantProfile(applicantId, LOCALE);
    if (!profile) {
      throw new Error("expected the certified applicant's self profile to resolve");
    }
    expect(profile.status).toBe(ApplicantStatus.Passed);
  });

  test("step 9 — fail-cast applicants purchase + activate: two more cycles open (in_evaluation)", async () => {
    await purchaseAndActivateTracked(applicantTajweedId, "b");
    await purchaseAndActivateTracked(applicantHifzId, "c");

    const castRows = await Promise.all(
      [applicantTajweedId, applicantHifzId].map(castApplicantId => readApplicantRow(castApplicantId))
    );
    for (const row of castRows) {
      expect(row.status).toBe(ApplicantStatus.InEvaluation);
      expect(row.cooldownUntil).toBeNull();
    }
    expect(await studentsRowCount(applicantTajweedId)).toBe(0);
    expect(await studentsRowCount(applicantHifzId)).toBe(0);
  });

  test("step 10 — the tajweed cast books E1-E5 and the evaluators complete all five", async () => {
    const booked = await bookCycleTracked(applicantTajweedId, "b");
    tajweedCycleSessions.push(...booked);
    await Promise.all(tajweedCycleSessions.map(sessionRow => completeEvaluationSession(sessionRow)));
  });

  test("step 11 — tajweed cast rubric: E1 records tajweed-79, E2-E4 record passing scores; still in_evaluation, no verdict writes", async () => {
    const firstSession = tajweedCycleSessions[0];
    if (!firstSession) {
      throw new Error("journey state: the tajweed cast's first session is missing");
    }

    const firstResult = await submitRubricTracked(firstSession.teacherId, firstSession, {
      score: PASS_THRESHOLD - 1,
      notes: rubricNotes("b-e1"),
      weaknessArea: "tajweed",
    });
    expectRubricReadModel(firstResult);
    expect(firstResult.score).toBe(PASS_THRESHOLD - 1);
    expect(firstResult.weaknessArea).toBe("tajweed");
    expect(firstResult.applicantStatus).toBe(ApplicantStatus.InEvaluation);

    const passingResults = await Promise.all(
      tajweedCycleSessions
        .slice(1, 4)
        .map(sessionRow => submitRubricTracked(sessionRow.teacherId, sessionRow, passingRubric("b-pass")))
    );
    for (const result of passingResults) {
      expect(result.applicantStatus).toBe(ApplicantStatus.InEvaluation);
    }

    const row = await readApplicantRow(applicantTajweedId);
    expect(row.status).toBe(ApplicantStatus.InEvaluation);
    expect(row.cooldownUntil).toBeNull();
    expect(await teacherRowCount(applicantTajweedId)).toBe(0);
    expect(await rubricRowCountFor(applicantTajweedId)).toBe(4);
  });

  test("step 12 — tajweed cast's fifth submission finalizes FAIL: cooldown ≈ now+30d, re-purchase denied, no teacher/students rows, no suspension writes, one fail notification", async () => {
    const fifthSession = tajweedCycleSessions[4];
    if (!fifthSession) {
      throw new Error("journey state: the tajweed cast's fifth session is missing");
    }
    const publishesBefore = publishSpy.mock.calls.length;
    const windowStart = Date.now();

    const result = await submitRubricTracked(fifthSession.teacherId, fifthSession, {
      score: 88,
      notes: rubricNotes("b-e5"),
      weaknessArea: null,
    });
    const windowEnd = Date.now();
    expectRubricReadModel(result);
    expect(result.applicantStatus).toBe(ApplicantStatus.Failed);

    // The verdict writes: failed + the 30-day tajweed cooldown captured from
    // the fifth submission's transaction window.
    const row = await readApplicantRow(applicantTajweedId);
    expect(row.status).toBe(ApplicantStatus.Failed);
    const cooldownUntil = row.cooldownUntil;
    if (!cooldownUntil) {
      throw new Error("expected the failed cycle to carry a cooldown stamp");
    }
    expect(cooldownUntil.getTime()).toBeGreaterThanOrEqual(windowStart + TAJWEED_COOLDOWN_MS - CLOCK_SKEW_MS);
    expect(cooldownUntil.getTime()).toBeLessThanOrEqual(windowEnd + TAJWEED_COOLDOWN_MS + CLOCK_SKEW_MS);

    // Strict-boundary alignment: the stamped instant is honored VERBATIM by
    // the re-purchase guard's strict read — while the instant is strictly in
    // the future, re-purchase is denied with the localized cooldown conflict.
    expect(cooldownUntil.getTime()).toBeGreaterThan(Date.now());
    await expectTypedDenial(
      () => ApplicantLifecycleService.assertCanPurchaseVerification(applicantTajweedId, LOCALE),
      ValidationError,
      "APPLICANT_COOLDOWN_ACTIVE",
      templatePrefix(ERRORS_EN.applicantCooldownActive)
    );

    // NO teacher row, NO students row, NO users suspension writes.
    expect(await teacherRowCount(applicantTajweedId)).toBe(0);
    expect(await studentsRowCount(applicantTajweedId)).toBe(0);
    const userRow = await readUserRow(applicantTajweedId);
    if (!userRow) {
      throw new Error("expected the fail-cast user row to survive finalization");
    }
    expect(userRow.suspended).toBe(false);
    expect(userRow.suspendedAt).toBeNull();
    expect(userRow.suspendedPeriodDays).toBeNull();

    // Exactly ONE fail-flavored evaluation_result notification, published
    // post-commit to the failed applicant ONLY.
    const resultRows = await evaluationResultRowsFor(applicantTajweedId);
    expect(resultRows).toHaveLength(1);
    expect(publishSpy.mock.calls).toHaveLength(publishesBefore + 1);
    expect(lastPublishedRecipientIds()).toEqual([applicantTajweedId]);
  });

  test("step 13 — the hifz cast books E1-E5 and the evaluators complete all five", async () => {
    const booked = await bookCycleTracked(applicantHifzId, "c");
    hifzCycleSessions.push(...booked);
    await Promise.all(hifzCycleSessions.map(sessionRow => completeEvaluationSession(sessionRow)));
  });

  test("step 14 — hifz cast rubric: E1 records hifz-79, E2-E4 record passing scores; still in_evaluation", async () => {
    const firstSession = hifzCycleSessions[0];
    if (!firstSession) {
      throw new Error("journey state: the hifz cast's first session is missing");
    }

    const firstResult = await submitRubricTracked(firstSession.teacherId, firstSession, {
      score: PASS_THRESHOLD - 1,
      notes: rubricNotes("c-e1"),
      weaknessArea: "hifz",
    });
    expectRubricReadModel(firstResult);
    expect(firstResult.weaknessArea).toBe("hifz");
    expect(firstResult.applicantStatus).toBe(ApplicantStatus.InEvaluation);

    const passingResults = await Promise.all(
      hifzCycleSessions
        .slice(1, 4)
        .map(sessionRow => submitRubricTracked(sessionRow.teacherId, sessionRow, passingRubric("c-pass")))
    );
    for (const result of passingResults) {
      expect(result.applicantStatus).toBe(ApplicantStatus.InEvaluation);
    }

    const row = await readApplicantRow(applicantHifzId);
    expect(row.status).toBe(ApplicantStatus.InEvaluation);
    expect(row.cooldownUntil).toBeNull();
    expect(await rubricRowCountFor(applicantHifzId)).toBe(4);
  });

  test("step 15 — hifz cast's fifth submission finalizes FAIL: cooldown ≈ now+90d (hifz variant), re-purchase denied, one fail notification", async () => {
    const fifthSession = hifzCycleSessions[4];
    if (!fifthSession) {
      throw new Error("journey state: the hifz cast's fifth session is missing");
    }
    const publishesBefore = publishSpy.mock.calls.length;
    const windowStart = Date.now();

    const result = await submitRubricTracked(fifthSession.teacherId, fifthSession, {
      score: 88,
      notes: rubricNotes("c-e5"),
      weaknessArea: null,
    });
    const windowEnd = Date.now();
    expect(result.applicantStatus).toBe(ApplicantStatus.Failed);

    // The 90-day hifz cooldown, captured from the fifth submission's window.
    const row = await readApplicantRow(applicantHifzId);
    expect(row.status).toBe(ApplicantStatus.Failed);
    const cooldownUntil = row.cooldownUntil;
    if (!cooldownUntil) {
      throw new Error("expected the failed cycle to carry a cooldown stamp");
    }
    expect(cooldownUntil.getTime()).toBeGreaterThanOrEqual(windowStart + HIFZ_COOLDOWN_MS - CLOCK_SKEW_MS);
    expect(cooldownUntil.getTime()).toBeLessThanOrEqual(windowEnd + HIFZ_COOLDOWN_MS + CLOCK_SKEW_MS);
    expect(cooldownUntil.getTime()).toBeGreaterThan(Date.now());
    await expectTypedDenial(
      () => ApplicantLifecycleService.assertCanPurchaseVerification(applicantHifzId, LOCALE),
      ValidationError,
      "APPLICANT_COOLDOWN_ACTIVE",
      templatePrefix(ERRORS_EN.applicantCooldownActive)
    );

    expect(await teacherRowCount(applicantHifzId)).toBe(0);
    expect(await studentsRowCount(applicantHifzId)).toBe(0);
    const userRow = await readUserRow(applicantHifzId);
    if (!userRow) {
      throw new Error("expected the fail-cast user row to survive finalization");
    }
    expect(userRow.suspended).toBe(false);
    expect(userRow.suspendedAt).toBeNull();
    expect(userRow.suspendedPeriodDays).toBeNull();

    const resultRows = await evaluationResultRowsFor(applicantHifzId);
    expect(resultRows).toHaveLength(1);
    expect(publishSpy.mock.calls).toHaveLength(publishesBefore + 1);
    expect(lastPublishedRecipientIds()).toEqual([applicantHifzId]);
  });

  test("step 16 — the verdict is terminal: a post-finalization submission is rejected with zero rows", async () => {
    const firstSession = tajweedCycleSessions[0];
    if (!firstSession) {
      throw new Error("journey state: the tajweed cast's first session is missing");
    }
    const rubricCountBefore = await rubricRowCountFor(applicantTajweedId);
    const publishesBefore = publishSpy.mock.calls.length;

    // The evaluator's own completed session, resubmitted after the cycle
    // finalized: the applicant status gate rejects the late submission —
    // exactly one finalization per cycle, ever.
    await expectTypedDenial(
      () =>
        requireService().submitRubricEvaluation(firstSession.teacherId, firstSession.id, passingRubric("late"), LOCALE),
      ConflictError,
      "APPLICANT_NOT_IN_EVALUATION",
      ERRORS_EN.applicantNotInEvaluation
    );

    expect(await rubricRowCountFor(applicantTajweedId)).toBe(rubricCountBefore);
    expect(publishSpy.mock.calls).toHaveLength(publishesBefore);
  });
});
