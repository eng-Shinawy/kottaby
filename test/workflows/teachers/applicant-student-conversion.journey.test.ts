/**
 * Cross-actor journey — the failed-applicant → student-record conversion arc,
 * driven end-to-end through the REAL services on the REAL test database;
 * later steps observe the shared state earlier steps committed.
 *
 * Trajectories:
 *   1. FAIL — five distinct certified evaluators submit rubrics against one
 *      applicant's completed sessions (the lowest score carries a tajweed
 *      weakness); the FIFTH submission finalizes in its own transaction: the
 *      applicant flips to `failed` with cooldown ≈ now+30d and the SAME
 *      transaction converts them — a ZEROED `students` row (fresh unique
 *      `KSB-XXXXXXXX` handshake code, no parent linkage) plus the guarded
 *      `teacher` → `student` role flip; exactly one `evaluation_result`
 *      notification is published to the applicant.
 *   2. Converted-actor surfaces — the converted account logs in and rotates
 *      its refresh token (the minted access token carries `role: student`),
 *      purchases a STUDENT plan through the student billing flow (the
 *      activation credit lands on the converted `students` row) and books a
 *      real class session against that lane — all while the verification
 *      re-purchase stays cooldown-denied.
 *   3. PASS — the admin clears the cooldown, the applicant re-purchases
 *      verification and a SECOND five-evaluator cycle finalizes `passed`:
 *      a certified `teacher` row is minted, the guarded `student` →
 *      `teacher` flip restores the role, and the historical `students` row
 *      is byte-identical (the code is never regenerated).
 *   4. Second applicant + idempotency — the tajweed fail cast converts on
 *      its own verdict with a DISTINCT handshake code (the handshake
 *      self-read is caller-bound; a non-student caller typed-denies), and a
 *      second fail cycle re-converts idempotently: still exactly ONE
 *      `students` row, the code never regenerated, the role stays `student`.
 *
 * Cast: applicant A (cast member, pending), fail-cast applicants B and C,
 * five certified evaluators E1-E5 (real users + real teacher rows with
 * isApproved + isEvaluator), one certified NON-evaluator teacher, plus the
 * sanctioned cast bystanders. Fixture identity fields carry the per-run
 * `jrn_conversion_<8hex>` prefix so repeated or parallel runs never collide.
 *
 * Journey rules honored (`test/workflows/AGENTS.md`):
 * - fixtures COMMITTED in `beforeAll` (sanctioned cast provisioner + ONE
 *   committing transaction for the evaluators, the fail casts, and the plans);
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
 * SURFACE GUARD: the rubric service module is loaded through a
 * NON-ANALYZABLE dynamic import as the FIRST `beforeAll` statement — a
 * vanished surface fails exactly `Cannot find module …` BEFORE any fixture
 * write (zero DB residue), while `tsgo` stays at 0 errors (a static import
 * of a missing module would break the type-check).
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
import { AdminApplicantOverrideAction } from "@/backend/enum/teachers/applicant-override-action.enum";
import { ApplicantStatus } from "@/backend/enum/teachers/applicant-status.enum";
import { UserRole } from "@/backend/enum/users/user-role.enum";
import { verifyAccessToken } from "@/backend/lib/auth/jwt";
import { hashPassword } from "@/backend/lib/auth/password";
import { ConflictError, NotFoundError, ValidationError } from "@/backend/lib/errors";
import { ApplicantLifecycleService, SubscriptionActivationService } from "@/backend/services";
import { AuthService } from "@/backend/services/auth/auth.service";
import { SubscriptionPurchaseService } from "@/backend/services/billing/subscription-purchase.service";
import { SessionLifecycleService } from "@/backend/services/classes/session-lifecycle.service";
import { NotificationEngine } from "@/backend/services/notifications";
import { StudentHandshakeService } from "@/backend/services/students/student-handshake.service";
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
import { HANDSHAKE_CODE_PATTERN } from "@/shared/constants/handshake-code.constants";
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
const PREFIX = journeyPrefix("conversion");

/** The real bcrypt credential installed on the converted actor for the auth leg. */
const CONVERSION_CREDENTIAL = "conversion-journey-Cred12345";

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

/** Row shapes inferred from the schema — the byte-identity oracle's vocabulary. */
type ApplicantsRowShape = typeof applicants.$inferSelect;
type StudentsRowShape = typeof students.$inferSelect;

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
/** The STUDENT plan the converted actor buys (journey 2) — provisioned in beforeAll. */
let studentPlanRow: PlanSelectType;
/** The handshake code minted by applicant A's FIRST conversion (never regenerated later). */
let conversionHandshakeCode = "";
/** The tajweed cast's own handshake code (the cross-tenant distinctness probe). */
let tajweedHandshakeCode = "";
/** Applicant A's row captured BEFORE the arc — id + createdAt must survive it. */
let applicantAStartRow: ApplicantsRowShape | null = null;
/** The full students row captured right BEFORE the pass finalization (byte-identity probe). */
let studentsRowBeforePass: StudentsRowShape | null = null;
/** Ledger rows created by the purchase services during the journey (teardown worklist). */
const ledgerPaymentIds: number[] = [];
const ledgerSubscriptionIds: number[] = [];
/** The booked evaluation sessions per applicant cycle (A's fail cycle, A's pass cycle, the tajweed cycles). */
const firstCycleSessions: SessionReturnType[] = [];
const secondCycleSessions: SessionReturnType[] = [];
const tajweedCycleSessions: SessionReturnType[] = [];

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
        const user = await createTestUser(tx, { role: UserRole.Teacher, locale: LOCALE });
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
        const user = await createTestUser(tx, { role: UserRole.Teacher, locale: LOCALE });
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

    // The STUDENT plan the converted actor buys in the conversion arc: a
    // distinct active catalog member (never the verification title) whose
    // lane credit lands on the converted `students` row at activation.
    const studentPlan = await createTestPlan(tx, {
      title: `${PREFIX}-student-plan`,
      sessionCount: 2,
      price: "25.00",
      currency: VERIFICATION_PLAN_CURRENCY,
      intervalDays: VERIFICATION_PLAN_INTERVAL_DAYS,
      balanceLane: SubscriptionCreditLane.Hifz,
      isActive: true,
    });
    tracked.register(plans, studentPlan.id);
    studentPlanRow = studentPlan;
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

describe("failed applicant → student record conversion journey (fail converts, pass restores, cooldown re-entry)", () => {
  test("step 1 — System: committed cast + five certified evaluators + fail casts + plan; the rubric slate starts empty", async () => {
    const applicantId = applicantAId();

    // Applicant A is a PENDING applicant with a NULL cooldown — the exact
    // precondition the verification purchase flips.
    const row = await readApplicantRow(applicantId);
    expect(row.status).toBe(ApplicantStatus.Pending);
    expect(row.cooldownUntil).toBeNull();

    // Full-arc identity anchor: the row identity captured BEFORE the arc —
    // the id and the creation instant must survive the whole fail →
    // convert → pass → re-fail journey untouched.
    applicantAStartRow = row;

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
    firstCycleSessions.push(...booked);

    const status = await EvaluationBookingService.myEvaluationLoopStatus(applicantId, LOCALE);
    expect(status.bookedCount).toBe(VERIFICATION_PLAN_SESSION_COUNT);
    expect(status.remainingCredits).toBe(0);
  });

  test("step 4 — E1-E4 drive start → complete; completed rows populate the pending reads while E5's scheduled row stays off them", async () => {
    const completedSessions = firstCycleSessions.slice(0, VERIFICATION_PLAN_SESSION_COUNT - 1);
    await Promise.all(completedSessions.map(sessionRow => completeEvaluationSession(sessionRow)));

    // Cross-actor visibility BEFORE any submission: each completed session
    // shows up on its OWN evaluator's pending read; E5's session is still
    // scheduled, so E5's pending read is empty.
    const completedIds = new Set(completedSessions.map(sessionRow => sessionRow.id));
    const pendingReads = await Promise.all(
      firstCycleSessions.map(async sessionRow => ({
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

  test("step 5 — E1 submits the first rubric (60, tajweed weakness): quorum 1/5; the row leaves E1's pending read and stays on E2's; the applicant is unchanged", async () => {
    const applicantId = applicantAId();
    const firstSession = firstCycleSessions[0];
    if (!firstSession) {
      throw new Error("journey state: the first pass-cycle session is missing");
    }

    const result = await submitRubricTracked(firstSession.teacherId, firstSession, {
      score: 60,
      notes: rubricNotes("e1"),
      weaknessArea: "tajweed",
    });
    expectRubricReadModel(result);
    expect(result.score).toBe(60);
    expect(result.weaknessArea).toBe("tajweed");
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
    expect(own.score).toBe(60);
    expect(own.applicantStatus).toBe(ApplicantStatus.InEvaluation);
    const secondSession = firstCycleSessions[1];
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

  test("step 6 — E2-E4 submit (70 / 65 / 75): quorum 4/5; the applicant stays in_evaluation with zero verdict writes", async () => {
    const applicantId = applicantAId();
    const publishesBefore = publishSpy.mock.calls.length;

    const scores = [70, 65, 75];
    const scoredSessions = firstCycleSessions.slice(1, 4);
    const results = await Promise.all(
      scoredSessions.map((sessionRow, index) =>
        submitRubricTracked(sessionRow.teacherId, sessionRow, {
          score: scores[index] ?? 0,
          notes: rubricNotes(`fail-e${index + 2}`),
          weaknessArea: "tajweed",
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

  test("step 7 — E5 completes and submits the fifth (88): ONE submission finalizes FAIL — the verdict converts the applicant in the SAME transaction (zeroed students row + role flip)", async () => {
    const applicantId = applicantAId();
    const fifthSession = firstCycleSessions[4];
    if (!fifthSession) {
      throw new Error("journey state: the first cycle's fifth session is missing");
    }
    const windowStart = Date.now();

    await completeEvaluationSession(fifthSession);
    // The completion fan-out belongs to session-lifecycle's own surface; the
    // verdict delta below isolates the ONE post-commit evaluation_result
    // receipt for this finalization.
    const publishesBeforeVerdict = publishSpy.mock.calls.length;
    const result = await submitRubricTracked(fifthSession.teacherId, fifthSession, {
      score: 88,
      notes: rubricNotes("a-e5"),
      weaknessArea: null,
    });
    const windowEnd = Date.now();
    expectRubricReadModel(result);
    expect(result.applicantStatus).toBe(ApplicantStatus.Failed);

    // The verdict writes: failed + the 30-day tajweed cooldown captured from
    // the fifth submission's transaction window (the tajweed weakness on the
    // lowest score sets the lane).
    const row = await readApplicantRow(applicantId);
    expect(row.status).toBe(ApplicantStatus.Failed);
    const cooldownUntil = row.cooldownUntil;
    if (!cooldownUntil) {
      throw new Error("expected the failed cycle to carry a cooldown stamp");
    }
    expect(cooldownUntil.getTime()).toBeGreaterThanOrEqual(windowStart + TAJWEED_COOLDOWN_MS - CLOCK_SKEW_MS);
    expect(cooldownUntil.getTime()).toBeLessThanOrEqual(windowEnd + TAJWEED_COOLDOWN_MS + CLOCK_SKEW_MS);

    // Strict-boundary alignment: while the cooldown instant is strictly in
    // the future, the verification re-purchase is cooldown-denied — even for
    // the already-converted account.
    expect(cooldownUntil.getTime()).toBeGreaterThan(Date.now());
    await expectTypedDenial(
      () => ApplicantLifecycleService.assertCanPurchaseVerification(applicantId, LOCALE),
      ValidationError,
      "APPLICANT_COOLDOWN_ACTIVE",
      templatePrefix(ERRORS_EN.applicantCooldownActive)
    );

    // Journey 1 — the conversion, atomic with the verdict: the users row
    // flipped `teacher` → `student` (guarded single-statement flip)...
    const userRow = await readUserRow(applicantId);
    if (!userRow) {
      throw new Error("expected the applicant user row to survive finalization");
    }
    expect(userRow.role).toBe(UserRole.Student);
    expect(userRow.suspended).toBe(false);
    expect(userRow.suspendedAt).toBeNull();
    expect(userRow.suspendedPeriodDays).toBeNull();

    // ...the ZEROED `students` role-child row: shared PK, all four balances
    // EXACTLY zero, no parent linkage, and a fresh `KSB-XXXXXXXX` handshake
    // code.
    expect(await studentsRowCount(applicantId)).toBe(1);
    const studentRows = await db.select().from(students).where(eq(students.id, applicantId)).limit(1);
    const studentRow = studentRows[0];
    if (!studentRow) {
      throw new Error("expected the conversion to commit a students row for the failed applicant");
    }
    expect(studentRow.id).toBe(applicantId);
    expect(studentRow.balanceHifz).toBe(0);
    expect(studentRow.balanceTajweed).toBe(0);
    expect(studentRow.balanceReviews).toBe(0);
    expect(studentRow.balanceTrial).toBe(0);
    expect(studentRow.parentId).toBeNull();
    expect(studentRow.handshakeCode).toMatch(HANDSHAKE_CODE_PATTERN);
    conversionHandshakeCode = studentRow.handshakeCode;

    // ...and NO teacher row (the conversion never mints one).
    expect(await teacherRowCount(applicantId)).toBe(0);

    // Full-arc identity anchor: the applicants row identity is UNCHANGED
    // by the conversion — same id, same creation instant.
    if (!applicantAStartRow) {
      throw new Error("journey state: the pre-arc applicant snapshot is missing");
    }
    expect(row.id).toBe(applicantAStartRow.id);
    expect(row.createdAt.getTime()).toBe(applicantAStartRow.createdAt.getTime());

    // Exactly ONE fail-flavored evaluation_result notification, published
    // post-commit to the converted applicant ONLY.
    const resultRows = await evaluationResultRowsFor(applicantId);
    expect(resultRows).toHaveLength(1);
    expect(publishSpy.mock.calls).toHaveLength(publishesBeforeVerdict + 1);
    expect(lastPublishedRecipientIds()).toEqual([applicantId]);
  });

  test("step 8 — journey 2: the converted actor logs in and rotates a refresh token; the minted tokens carry role student", async () => {
    const applicantId = applicantAId();
    const email = requireBundle().cast.applicant.user.email;

    // Install a REAL bcrypt credential on the converted account (the cast
    // provisioner seeds a stub hash) — the login flows through the real
    // AuthService, never a mocked one.
    await db
      .update(users)
      .set({ passwordHash: await hashPassword(CONVERSION_CREDENTIAL) })
      .where(eq(users.id, applicantId));

    const loginSession = await AuthService.login(email, CONVERSION_CREDENTIAL, LOCALE);
    expect(loginSession.user.id).toBe(applicantId);
    expect(loginSession.user.role).toBe(UserRole.Student);
    expect(loginSession.accessToken).toBeTruthy();
    expect(loginSession.refreshToken).toBeTruthy();

    // The freshly minted access token ALREADY carries the converted role.
    const loginPayload = await verifyAccessToken(loginSession.accessToken);
    if (!loginPayload) {
      throw new Error("expected the login access token to verify");
    }
    expect(loginPayload.userId).toBe(applicantId);
    expect(loginPayload.role).toBe(UserRole.Student);

    // Refresh-token rotation: a NEW pair + session id; the rotated access
    // token re-reads the CURRENT role, so the converted actor's OWN token
    // authenticates as `student` — every student-gated surface is reachable
    // with it (the BFLA precondition for steps 9 and 15).
    const refreshed = await AuthService.refreshToken(loginSession.refreshToken, LOCALE);
    expect(refreshed.accessToken).toBeTruthy();
    expect(refreshed.refreshToken).toBeTruthy();
    expect(refreshed.sessionId).toBeTruthy();
    expect(refreshed.refreshToken).not.toBe(loginSession.refreshToken);
    const refreshedPayload = await verifyAccessToken(refreshed.accessToken);
    if (!refreshedPayload) {
      throw new Error("expected the refreshed access token to verify");
    }
    expect(refreshedPayload.userId).toBe(applicantId);
    expect(refreshedPayload.role).toBe(UserRole.Student);
  });

  test("step 9 — journey 2: the converted actor purchases a STUDENT plan during the cooldown and books a real session against the credited lane", async () => {
    const applicantId = applicantAId();

    // The verification re-purchase stays cooldown-denied (step 7), while the
    // STUDENT billing surface is open: the purchaser identity is server-bound
    // and the plan selector is the only wire input.
    const purchase = await SubscriptionPurchaseService.purchase(
      applicantId,
      { planId: studentPlanRow.id },
      `${PREFIX}-key-student-sub`,
      LOCALE
    );
    const reference = purchase.subscription.paymentReference;
    if (!reference) {
      throw new Error("expected the pending student subscription to carry the gateway payment reference");
    }
    const event: PaymentWebhookEvent = {
      reference,
      outcome: "confirmed",
      amount: purchase.payment.amount,
      currency: purchase.payment.currency,
    };
    const outcome = await SubscriptionActivationService.processWebhookEvent(event, LOCALE);
    expect(outcome).toEqual({ processed: true });

    tracked.register(subscriptions, purchase.subscription.id);
    tracked.register(studentPayments, purchase.payment.id);
    ledgerSubscriptionIds.push(purchase.subscription.id);
    ledgerPaymentIds.push(purchase.payment.id);

    // The junction owner IS the converted students row...
    const junctionRows = await db
      .select()
      .from(studentSubscriptions)
      .where(eq(studentSubscriptions.subscriptionId, purchase.subscription.id));
    expect(junctionRows).toHaveLength(1);
    expect(junctionRows[0]?.studentId).toBe(applicantId);

    // ...and the activation credited the plan's lane onto it: the hifz
    // balance rises from the conversion's zero to the plan's session count.
    const credited = await db.select().from(students).where(eq(students.id, applicantId)).limit(1);
    expect(credited[0]?.balanceHifz).toBe(studentPlanRow.sessionCount);

    // ATTEND: the converted student books a real hifz session with a
    // certified teacher — the trial-first ladder debits the credited lane.
    const evaluatorId = evaluatorIds[0];
    if (!evaluatorId) {
      throw new Error("journey state: no evaluator teacher available for the session booking");
    }
    const booked = await SessionLifecycleService.createSession(
      applicantId,
      { teacherId: evaluatorId, intent: SessionIntent.Hifz },
      `${PREFIX}-key-converted-session`,
      LOCALE
    );
    tracked.register(session, booked.id);
    expect(booked.studentId).toBe(applicantId);
    expect(booked.teacherId).toBe(evaluatorId);
    expect(booked.status).toBe(SessionStatus.Scheduled);

    const debited = await db.select().from(students).where(eq(students.id, applicantId)).limit(1);
    expect(debited[0]?.balanceHifz).toBe(studentPlanRow.sessionCount - 1);

    // Journey 3 baseline: capture the students row EXACTLY as the pass
    // finalization must leave it (the pass touches neither code nor lane).
    const beforePass = await db.select().from(students).where(eq(students.id, applicantId)).limit(1);
    if (!beforePass[0]) {
      throw new Error("journey state: the converted students row vanished before the pass cycle");
    }
    studentsRowBeforePass = beforePass[0];
  });

  test("step 10 — the admin clears the cooldown; the converted actor re-purchases verification and the cycle re-opens", async () => {
    const applicantId = applicantAId();

    await ApplicantLifecycleService.overrideApplicantEvaluation(
      applicantId,
      AdminApplicantOverrideAction.GrantReEvaluation,
      null,
      requireBundle().cast.admin.user.id,
      LOCALE
    );

    // The cooldown is cleared; the failed STATUS is untouched by the grant.
    const row = await readApplicantRow(applicantId);
    expect(row.status).toBe(ApplicantStatus.Failed);
    expect(row.cooldownUntil).toBeNull();

    // The verification re-purchase now passes the lifecycle guard: a
    // re-application from `failed` re-opens the cycle (in_evaluation).
    await purchaseAndActivateTracked(applicantId, "reapply");
    const reopened = await readApplicantRow(applicantId);
    expect(reopened.status).toBe(ApplicantStatus.InEvaluation);
    expect(reopened.cooldownUntil).toBeNull();
  });

  test("step 11 — the re-opened cycle books E1-E5 again and the evaluators complete E1-E4 (E5 stays scheduled)", async () => {
    const booked = await bookCycleTracked(applicantAId(), "pass");
    secondCycleSessions.push(...booked);
    // Mirroring the first cycle's split, E5's completion happens in step 13 —
    // immediately before its finalizing submission.
    await Promise.all(secondCycleSessions.slice(0, 4).map(sessionRow => completeEvaluationSession(sessionRow)));
  });

  test("step 12 — E1-E4 submit passing rubrics (90 / 85 / 95 / 90): quorum 4/5; no verdict writes yet", async () => {
    const applicantId = applicantAId();
    const publishesBefore = publishSpy.mock.calls.length;

    const scores = [90, 85, 95, 90];
    const scoredSessions = secondCycleSessions.slice(0, 4);
    const results = await Promise.all(
      scoredSessions.map((sessionRow, index) =>
        submitRubricTracked(sessionRow.teacherId, sessionRow, {
          score: scores[index] ?? 0,
          notes: rubricNotes(`restore-e${index + 1}`),
          weaknessArea: null,
        })
      )
    );
    for (const result of results) {
      expectRubricReadModel(result);
      expect(result.applicantStatus).toBe(ApplicantStatus.InEvaluation);
    }

    // The fail verdict's rubric rows persist across cycles: 5 + 4 = 9. The
    // conversion artifacts are untouched by the re-opened cycle so far.
    const row = await readApplicantRow(applicantId);
    expect(row.status).toBe(ApplicantStatus.InEvaluation);
    expect(row.cooldownUntil).toBeNull();
    expect(await rubricRowCountFor(applicantId)).toBe(9);
    expect(await studentsRowCount(applicantId)).toBe(1);
    expect(await teacherRowCount(applicantId)).toBe(0);
    expect(publishSpy.mock.calls).toHaveLength(publishesBefore);
  });

  test("step 13 — E5 completes and submits the fifth (90): ONE submission finalizes PASS — teacher row minted, role restored, students row byte-identical", async () => {
    const applicantId = applicantAId();
    const fifthSession = secondCycleSessions[4];
    if (!fifthSession) {
      throw new Error("journey state: the second cycle's fifth session is missing");
    }
    if (!studentsRowBeforePass) {
      throw new Error("journey state: the pre-pass students snapshot is missing");
    }
    await completeEvaluationSession(fifthSession);
    // The completion fan-out belongs to session-lifecycle's own surface; the
    // verdict delta below isolates the ONE post-commit evaluation_result
    // receipt for this finalization.
    const publishesBeforeVerdict = publishSpy.mock.calls.length;
    const result = await submitRubricTracked(fifthSession.teacherId, fifthSession, {
      score: 90,
      notes: rubricNotes("restore-e5"),
      weaknessArea: null,
    });
    expectRubricReadModel(result);
    expect(result.applicantStatus).toBe(ApplicantStatus.Passed);

    // The verdict writes: passed + the cooldown CLEARED.
    const row = await readApplicantRow(applicantId);
    expect(row.status).toBe(ApplicantStatus.Passed);
    expect(row.cooldownUntil).toBeNull();

    // Journey 3 — the restoration: a certified teacher row minted...
    expect(await teacherRowCount(applicantId)).toBe(1);
    const teacherRows = await db.select().from(teacher).where(eq(teacher.id, applicantId)).limit(1);
    expect(teacherRows[0]?.isApproved).toBe(true);
    expect(teacherRows[0]?.isEvaluator).toBe(false);

    // ...the guarded `student` → `teacher` flip on the users row...
    const userRow = await readUserRow(applicantId);
    if (!userRow) {
      throw new Error("expected the re-certified user row to survive");
    }
    expect(userRow.role).toBe(UserRole.Teacher);

    // ...and the historical students row BYTE-IDENTICAL: the pass touches
    // neither the handshake code nor any balance column.
    expect(await studentsRowCount(applicantId)).toBe(1);
    const afterPass = await db.select().from(students).where(eq(students.id, applicantId)).limit(1);
    expect(afterPass[0]).toEqual(studentsRowBeforePass);
    expect(afterPass[0]?.handshakeCode).toBe(conversionHandshakeCode);

    // Exactly ONE pass-flavored evaluation_result notification for THIS
    // verdict (the fail verdict's row was step 7's) — published to the
    // re-certified applicant ONLY.
    const resultRows = await evaluationResultRowsFor(applicantId);
    expect(resultRows).toHaveLength(2);
    expect(publishSpy.mock.calls).toHaveLength(publishesBeforeVerdict + 1);
    expect(lastPublishedRecipientIds()).toEqual([applicantId]);
  });

  test("step 14 — the tajweed fail cast runs its own cycle: purchase, book, complete, and a tajweed-79 floor finalizes FAIL with its OWN conversion", async () => {
    const windowStart = Date.now();

    await purchaseAndActivateTracked(applicantTajweedId, "b");
    const booked = await bookCycleTracked(applicantTajweedId, "b");
    tajweedCycleSessions.push(...booked);
    await Promise.all(tajweedCycleSessions.map(sessionRow => completeEvaluationSession(sessionRow)));

    // E1 records the tajweed-79 floor (the weakness that sets the lane);
    // E2-E4 submit passing scores above the threshold.
    const firstSession = tajweedCycleSessions[0];
    if (!firstSession) {
      throw new Error("journey state: the tajweed cast's first session is missing");
    }
    const floor = await submitRubricTracked(firstSession.teacherId, firstSession, {
      score: 79,
      notes: rubricNotes("b-e1"),
      weaknessArea: "tajweed",
    });
    expectRubricReadModel(floor);
    expect(floor.applicantStatus).toBe(ApplicantStatus.InEvaluation);
    const middleScores = [85, 90, 80];
    const middles = await Promise.all(
      tajweedCycleSessions.slice(1, 4).map((sessionRow, index) =>
        submitRubricTracked(sessionRow.teacherId, sessionRow, {
          score: middleScores[index] ?? 0,
          notes: rubricNotes(`b-e${index + 2}`),
          weaknessArea: null,
        })
      )
    );
    for (const middle of middles) {
      expectRubricReadModel(middle);
      expect(middle.score).toBeGreaterThanOrEqual(PASS_THRESHOLD);
      expect(middle.applicantStatus).toBe(ApplicantStatus.InEvaluation);
    }

    // The fifth submission completes the quorum and finalizes the verdict.
    const fifthSession = tajweedCycleSessions[4];
    if (!fifthSession) {
      throw new Error("journey state: the tajweed cast's fifth session is missing");
    }
    // The booking/completion fan-out belongs to session-lifecycle's own
    // surface; the verdict delta below isolates the ONE post-commit
    // evaluation_result receipt for this finalization.
    const publishesBeforeVerdict = publishSpy.mock.calls.length;
    const result = await submitRubricTracked(fifthSession.teacherId, fifthSession, {
      score: 88,
      notes: rubricNotes("b-e5"),
      weaknessArea: null,
    });
    const windowEnd = Date.now();
    expectRubricReadModel(result);
    expect(result.applicantStatus).toBe(ApplicantStatus.Failed);

    const row = await readApplicantRow(applicantTajweedId);
    expect(row.status).toBe(ApplicantStatus.Failed);
    const cooldownUntil = row.cooldownUntil;
    if (!cooldownUntil) {
      throw new Error("expected the failed cycle to carry a cooldown stamp");
    }
    expect(cooldownUntil.getTime()).toBeGreaterThanOrEqual(windowStart + TAJWEED_COOLDOWN_MS - CLOCK_SKEW_MS);
    expect(cooldownUntil.getTime()).toBeLessThanOrEqual(windowEnd + TAJWEED_COOLDOWN_MS + CLOCK_SKEW_MS);

    // ONE fail-flavored evaluation_result receipt (the verdict), to the
    // failed applicant ONLY.
    expect(publishSpy.mock.calls).toHaveLength(publishesBeforeVerdict + 1);
    expect(lastPublishedRecipientIds()).toEqual([applicantTajweedId]);
  });

  test("step 15 — the tajweed cast converts with its OWN handshake code; the caller-bound handshake surface never crosses tenants", async () => {
    // The tajweed conversion mirrors applicant A's: a zeroed students row
    // with a DISTINCT fresh handshake code and the same guarded role flip.
    expect(await studentsRowCount(applicantTajweedId)).toBe(1);
    const studentRows = await db.select().from(students).where(eq(students.id, applicantTajweedId)).limit(1);
    const studentRow = studentRows[0];
    if (!studentRow) {
      throw new Error("expected the tajweed conversion to commit a students row");
    }
    expect(studentRow.id).toBe(applicantTajweedId);
    expect(studentRow.balanceHifz).toBe(0);
    expect(studentRow.balanceTajweed).toBe(0);
    expect(studentRow.balanceReviews).toBe(0);
    expect(studentRow.balanceTrial).toBe(0);
    expect(studentRow.parentId).toBeNull();
    expect(studentRow.handshakeCode).toMatch(HANDSHAKE_CODE_PATTERN);
    expect(studentRow.handshakeCode).not.toBe(conversionHandshakeCode);
    tajweedHandshakeCode = studentRow.handshakeCode;

    const userRow = await readUserRow(applicantTajweedId);
    if (!userRow) {
      throw new Error("expected the tajweed user row to survive finalization");
    }
    expect(userRow.role).toBe(UserRole.Student);

    // Cross-tenant: the handshake self-read is CALLER-BOUND — the GraphQL
    // query accepts no input and the resolver passes `ctx.user.id` — so the
    // second applicant's token resolves ONLY its own code, never applicant
    // A's, and A's own read still resolves A's minted code.
    const ownCode = await StudentHandshakeService.getMyHandshakeCode(applicantTajweedId, LOCALE);
    expect(ownCode).toBe(tajweedHandshakeCode);
    expect(ownCode).not.toBe(conversionHandshakeCode);
    const applicantACode = await StudentHandshakeService.getMyHandshakeCode(applicantAId(), LOCALE);
    expect(applicantACode).toBe(conversionHandshakeCode);

    // The same surface typed-denies a caller with NO students row (the
    // certified non-evaluator teacher) — a non-converted account observes
    // nothing at all.
    await expectTypedDenial(
      () => StudentHandshakeService.getMyHandshakeCode(requireBundle().cast.certifiedTeacher.user.id, LOCALE),
      NotFoundError,
      "STUDENT_NOT_FOUND",
      templatePrefix(ERRORS_EN.studentHandshakeNotFound)
    );
  });

  test("step 16 — idempotent re-conversion: a second fail cycle on the converted tajweed applicant keeps ONE students row and never regenerates the code", async () => {
    const windowStart = Date.now();

    // The admin clears the stamped cooldown; the re-application re-opens the
    // cycle through the guarded purchase path.
    await ApplicantLifecycleService.overrideApplicantEvaluation(
      applicantTajweedId,
      AdminApplicantOverrideAction.GrantReEvaluation,
      null,
      requireBundle().cast.admin.user.id,
      LOCALE
    );
    await purchaseAndActivateTracked(applicantTajweedId, "b2");
    const booked = await bookCycleTracked(applicantTajweedId, "b2");
    await Promise.all(booked.map(sessionRow => completeEvaluationSession(sessionRow)));

    // Every failing score carries the hifz weakness (a failing score without
    // a weakness is a typed denial); the lowest score's weakness sets the
    // 90-day hifz lane for the re-failure verdict.
    const failingScores = [55, 60, 65, 70];
    const earlyResults = await Promise.all(
      booked.slice(0, 4).map((sessionRow, index) =>
        submitRubricTracked(sessionRow.teacherId, sessionRow, {
          score: failingScores[index] ?? 0,
          notes: rubricNotes(`b2-e${index + 1}`),
          weaknessArea: "hifz",
        })
      )
    );
    for (const early of earlyResults) {
      expect(early.applicantStatus).toBe(ApplicantStatus.InEvaluation);
    }
    const fifthSession = booked[4];
    if (!fifthSession) {
      throw new Error("journey state: the re-application's fifth session is missing");
    }
    // The override/booking/completion fan-out belongs to other surfaces; the
    // verdict delta below isolates the ONE post-commit evaluation_result
    // receipt for this re-failure finalization.
    const publishesBeforeVerdict = publishSpy.mock.calls.length;
    const result = await submitRubricTracked(fifthSession.teacherId, fifthSession, {
      score: 72,
      notes: rubricNotes("b2-e5"),
      weaknessArea: "hifz",
    });
    const windowEnd = Date.now();
    expectRubricReadModel(result);
    expect(result.applicantStatus).toBe(ApplicantStatus.Failed);

    // The re-failure stamps a fresh hifz-lane cooldown from the fifth
    // submission's transaction window.
    const row = await readApplicantRow(applicantTajweedId);
    expect(row.status).toBe(ApplicantStatus.Failed);
    const cooldownUntil = row.cooldownUntil;
    if (!cooldownUntil) {
      throw new Error("expected the re-failed cycle to carry a cooldown stamp");
    }
    expect(cooldownUntil.getTime()).toBeGreaterThanOrEqual(windowStart + HIFZ_COOLDOWN_MS - CLOCK_SKEW_MS);
    expect(cooldownUntil.getTime()).toBeLessThanOrEqual(windowEnd + HIFZ_COOLDOWN_MS + CLOCK_SKEW_MS);

    // The re-conversion is a SAFE NO-OP on the row: still exactly ONE
    // students row for the id, the SAME handshake code (never regenerated),
    // the balances untouched (this cast never bought a student plan), and
    // no parent linkage.
    expect(await studentsRowCount(applicantTajweedId)).toBe(1);
    const afterRows = await db.select().from(students).where(eq(students.id, applicantTajweedId)).limit(1);
    expect(afterRows[0]?.handshakeCode).toBe(tajweedHandshakeCode);
    expect(afterRows[0]?.balanceHifz).toBe(0);
    expect(afterRows[0]?.balanceTajweed).toBe(0);
    expect(afterRows[0]?.balanceReviews).toBe(0);
    expect(afterRows[0]?.balanceTrial).toBe(0);
    expect(afterRows[0]?.parentId).toBeNull();

    // The guarded flip re-ensures role coherence: the role STAYS `student`
    // (the zero-row update is the documented harmless replay).
    const userRow = await readUserRow(applicantTajweedId);
    if (!userRow) {
      throw new Error("expected the re-converted user row to survive");
    }
    expect(userRow.role).toBe(UserRole.Student);

    // ONE verdict receipt for the re-failure finalization, to the converted
    // applicant ONLY.
    expect(publishSpy.mock.calls).toHaveLength(publishesBeforeVerdict + 1);
    expect(lastPublishedRecipientIds()).toEqual([applicantTajweedId]);
  });

  test("step 17 — the re-failure verdict is terminal: a post-finalization submission is rejected with zero rows", async () => {
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
