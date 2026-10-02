/**
 * Cross-actor journey — the applicant cooldown lifecycle: from the failing
 * rubric verdict that stamps the cooldown, through the admin extension and
 * the time-driven expiry, to the re-application that re-opens the cycle —
 * and the hifz replay that pins the longer minimum.
 *
 * Sequential actor-attributed steps execute against the REAL services (and
 * the admin mutation through the REAL GraphQL schema execution) on the REAL
 * test database; later steps observe the shared state earlier steps
 * committed.
 *
 * Trajectories:
 *   1. FAIL (tajweed) — a cycle whose lowest-scoring failing area is
 *      `tajweed` finalizes on the FIFTH submission: the cooldown is stamped
 *      ≈ now+30d, the applicant flips `failed`, and the account row's
 *      governance triple is untouched (the cooldown machinery never writes
 *      the account-suspension axis — the two-source split lock).
 *   2. Cooldown-active arc — the applicant's own profile reads
 *      `active` + not purchasable; the verification purchase is denied with
 *      the typed cooldown conflict (422 family) and writes nothing.
 *   3. Admin arc — the admin extends the cooldown by 60 days (the stored
 *      base is honored verbatim: ≈ stamped+90d), one `adjust` audit row is
 *      appended in the same transaction, and the applicant observes the
 *      extended instant on the next profile read.
 *   4. Expiry arc — a clock-advance fixture rewrites the stored expiry to a
 *      past instant; the profile flips to `expired`; the purchase now
 *      SUCCEEDS, the attempt counter increments, and the status re-opens to
 *      `in_evaluation`.
 *   5. Denial battery — a non-admin caller is denied `FORBIDDEN` at the
 *      mutation's authScopes; a certified applicant cannot be extended
 *      (`APPLICANT_ALREADY_CERTIFIED`); a zero-day extension length is
 *      rejected (`APPLICANT_COOLDOWN_EXTENSION_INVALID`) — every denial
 *      writes ZERO rows.
 *   6. FAIL (hifz) — the same arc replayed with a hifz-79 lowest failing
 *      score finalizes ≈ now+90d.
 *
 * Cast: an admin, the sanctioned cast bystanders (student / parent /
 * pending-applicant / certified-teacher), five certified evaluators
 * (real users + real teacher rows with isApproved + isEvaluator), the
 * tajweed-cycle applicant, the hifz-cycle applicant, and a dedicated
 * terminal (`passed`) applicant for the certified-denial leg. Fixture
 * identity fields carry the per-run `jrn_cooldown_<8hex>` prefix so repeated
 * or parallel runs never collide.
 *
 * Harness rules honored (`test/workflows/AGENTS.md`):
 * - fixtures COMMITTED in `beforeAll` (sanctioned cast provisioner + ONE
 *   committing transaction for the evaluators, the three cycle applicants,
 *   and the plan); never `runInRollback` (the services own their
 *   transactions);
 * - honest actors: real `users` rows + real role-child rows; every GraphQL
 *   execution builds the same verified-session context the context factory
 *   produces for that fixture user (identity + role read from the REAL
 *   `users` row) — denials flow through the real authScopes, nothing
 *   monkey-patched;
 * - external effects intercepted at the notification dispatch boundary: the
 *   engine's publish seam is SPIED and each step asserts receipts and inbox
 *   deltas — nothing reaches a real channel;
 * - error assertions through `catchJourneyError` + translated substrings on
 *   the service tier, and through the wire `extensions.code` on the
 *   GraphQL tier — never `.rejects.toThrow()`, no hardcoded English strings;
 * - full cleanup: notifications sweep → immutable-ledger leg → tracked
 *   fixtures → cast cleanup → post-teardown residue probes for every
 *   generated user id.
 *
 * TEST-FIRST provenance: the admin legs were authored BEFORE the GraphQL
 * field existed so the journey drove the wire contract (they failed document
 * validation with `Cannot query field "adminExtendApplicantCooldown" on type
 * "Mutation"` and the applicant-observation leg failed on the un-extended
 * instant). The field has since landed — the document, the context, and the
 * assertions needed NO edits, and the same legs now execute the real
 * authScopes → resolver → service chain. The FULL journey is green
 * end-to-end: no step is expected to fail, and a red step is a genuine
 * regression. Every leg (fixtures, the fail
 * finalization, the profile reads, the purchase denial, the clock advance,
 * the re-application, the hifz replay) runs against shipped surfaces.
 *
 * Surfaces this journey binds to:
 *   backend/services/teachers/evaluation-rubric.service.ts (the fail writer)
 *   backend/services/teachers/verification-purchase.service.ts (the gate)
 *   backend/services/teachers/applicant-lifecycle.service.ts (read-model)
 *   GraphQL mutation `adminExtendApplicantCooldown(applicantId, additionalDays)`
 *     → `ApplicantProfile` (the admin extension, authScopes-guarded)
 */

import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { and, eq, inArray, or } from "drizzle-orm";
import { graphql } from "graphql";
import { db } from "@/backend/db";
import { PlanRepository } from "@/backend/db/repo";
import { auditLogs } from "@/backend/db/schema/audit/audit-logs";
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
import { AuditActionType } from "@/backend/enum/audit/audit-action-type.enum";
import { SubscriptionCreditLane } from "@/backend/enum/billing/subscription-credit-lane.enum";
import { NotificationType } from "@/backend/enum/notifications/notification-type.enum";
import { SessionIntent } from "@/backend/enum/scheduling/session-intent.enum";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import { SessionType } from "@/backend/enum/scheduling/session-type.enum";
import { ApplicantCooldownState } from "@/backend/enum/teachers/applicant-cooldown-state.enum";
import { ApplicantStatus } from "@/backend/enum/teachers/applicant-status.enum";
import { RubricWeaknessArea } from "@/backend/enum/teachers/rubric-weakness-area.enum";
import { toUserRole, UserRole } from "@/backend/enum/users/user-role.enum";
import type { Context } from "@/backend/graphql/gqlContextFactory";
import { graphQLSchema } from "@/backend/graphql/gqlSchema";
import { createAuthCookieOut } from "@/backend/lib/auth/cookies";
import { type DomainError, ERROR_CODE_HTTP_STATUS, finalizeGraphqlErrors, ValidationError } from "@/backend/lib/errors";
import { ApplicantLifecycleService, SubscriptionActivationService } from "@/backend/services";
import { SessionLifecycleService } from "@/backend/services/classes/session-lifecycle.service";
import { NotificationEngine } from "@/backend/services/notifications";
import { EvaluationBookingService } from "@/backend/services/teachers/evaluation-booking.service";
import { EvaluationRubricService } from "@/backend/services/teachers/evaluation-rubric.service";
import { VerificationPurchaseService } from "@/backend/services/teachers/verification-purchase.service";
import type {
  PaymentWebhookEvent,
  PlanSelectType,
  RubricEvaluationSubmitInput,
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
import type { Translations } from "@/shared/locale/types/message";
import { withImmutabilityTriggersSuspended } from "@/test/helpers/db-cleanup";
import {
  catchJourneyError,
  countAuditLogsForActor,
  createJourneyFixtures,
  type JourneyFixtureBundle,
  journeyCleanup,
  journeyPrefix,
  TrackedFixtures,
} from "@/test/workflows/helpers";

// ─── Harness state ───────────────────────────────────────────────────────────

/** Error-copy locale for every service call, GraphQL context, and denial assertion. */
const LOCALE = "en";

/** Translated error copy source — never hardcoded English expectation strings. */
const ERRORS_EN = getServerTranslations(LOCALE).errorsTranslations;

/** Per-run unique prefix — every key/name derives from it (no cross-run collisions). */
const PREFIX = journeyPrefix("cooldown");

/** Journey-local mirrors of the canonical rubric threshold and cooldown durations. */
const PASS_THRESHOLD = 80;
const MS_PER_DAY = 86_400_000;
const TAJWEED_COOLDOWN_MS = 30 * MS_PER_DAY;
const HIFZ_COOLDOWN_MS = 90 * MS_PER_DAY;
/** Tolerance between a service's captured-now and the journey's observation window. */
const CLOCK_SKEW_MS = 5_000;

/** The admin extension length exercised by the main arc (days). */
const EXTENSION_DAYS = 60;

/** Correlation id shared by the journey's GraphQL executions (echoed onto wire errors). */
const JOURNEY_REQUEST_ID = `${PREFIX}-request`;

/**
 * The admin cooldown-extension contract under test — the wire operation the
 * admin legs bind to. Selects the full applicant profile shape the mutation
 * returns.
 */
const EXTEND_COOLDOWN_MUTATION = `
  mutation ExtendApplicantCooldown($applicantId: Int!, $additionalDays: Int!) {
    adminExtendApplicantCooldown(applicantId: $applicantId, additionalDays: $additionalDays) {
      id
      status
      cooldownUntil
      cooldownActive
      canPurchaseVerification
      cooldownState
    }
  }
`;

/** One wire error element after a GraphQL execution (message + extensions). */
interface WireErrorShape {
  readonly message: string;
  readonly extensions: Readonly<Record<string, unknown>> | undefined;
}

/** The outcome of one in-process GraphQL execution, reduced to the wire shape. */
interface WireOutcome {
  readonly data: Readonly<Record<string, unknown>> | null | undefined;
  readonly errors: readonly WireErrorShape[];
}

/** The mutation's returned profile payload, narrowed from the wire data. */
interface WireProfilePayload {
  readonly id: number;
  readonly status: string;
  /** Expiry instant normalized to epoch ms (accepts the DateTime scalar's `Date` and ISO-string serializations). */
  readonly cooldownUntilMs: number;
  readonly cooldownActive: boolean;
  readonly canPurchaseVerification: boolean;
  readonly cooldownState: string;
}

/** The notification type widened to its primitive string value (DB column union). */
const NOTIF_TYPE_EVALUATION_RESULT: string = NotificationType.EvaluationResult;

/** Tracked fixture rows (evaluators, cycle applicants, plan, service-created rows). */
const tracked = new TrackedFixtures();

/** The fan-out publish spy — installed over the engine's publish boundary and restored in `afterAll`. */
const publishSpy = spyOn(NotificationEngine, "publishReceipts").mockImplementation(async () => {});

/** Journey cast: the sanctioned provisioner bundle (null when beforeAll aborted early). */
let bundle: JourneyFixtureBundle | null = null;
/** The purchase target as the SERVICE resolves it (active catalog + exact-title match). */
let planRow: PlanSelectType;
/** The plan row id THIS journey created (0 = the seeded catalog member served). */
let journeyCreatedPlanId = 0;
/** Certified evaluators E1-E5 (real users + teacher rows with isApproved + isEvaluator). */
const evaluatorIds: number[] = [];
/** The tajweed-cycle applicant user id (the main arc). */
let applicantTajweedId = 0;
/** The hifz-cycle applicant user id (the replay arc). */
let applicantHifzId = 0;
/** The terminal (`passed`) applicant user id (the certified-denial leg). */
let certifiedApplicantId = 0;
/** The cooldown instant the fail finalization stamped on the tajweed cycle (captured at its step). */
let tajweedStamp: Date | null = null;
/** Ledger rows created by the purchase services during the journey (teardown worklist). */
const ledgerPaymentIds: number[] = [];
const ledgerSubscriptionIds: number[] = [];
/** The booked sessions per cycle (tajweed first, hifz in the replay). */
const tajweedCycleSessions: SessionReturnType[] = [];
const hifzCycleSessions: SessionReturnType[] = [];

function requireBundle(): JourneyFixtureBundle {
  if (bundle === null) {
    throw new Error("journey state missing: the cast was not provisioned");
  }
  return bundle;
}

/** The admin actor's real user id (fixture-created, from the sanctioned cast). */
function adminId(): number {
  return requireBundle().cast.admin.user.id;
}

/** Every user id this journey generates (cast + evaluators + the three cycle applicants). */
function allJourneyUserIds(): number[] {
  const castIds = bundle?.registry.userIds ?? [];
  return [...castIds, ...evaluatorIds, applicantTajweedId, applicantHifzId, certifiedApplicantId];
}

function requireStamp(): Date {
  if (tajweedStamp === null) {
    throw new Error("journey state missing: the tajweed cooldown stamp was not captured");
  }
  return tajweedStamp;
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

/** Number of `teacher` rows behind a user id — the certification-mint probe. */
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

/** The cooldown-extension audit rows pointed at one applicant. */
async function extensionAuditRowsFor(applicantUserId: number) {
  return db
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.entityType, "applicant"), eq(auditLogs.entityId, applicantUserId)));
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

// ─── Service-tier denial + shared-step helpers ───────────────────────────────

/** The copy fragment of a translated template BEFORE its first placeholder. */
function templatePrefix(template: string): string {
  return template.split("{")[0] ?? template;
}

/**
 * Denial oracle on the service tier — catches through the journey helper
 * (never `rejects.toThrow`), pins the DomainError class, the exact error
 * code, and the translated message substring.
 */
async function expectTypedDenial(
  fn: () => Promise<unknown>,
  errorClass: typeof ValidationError,
  code: string,
  translatedFragment?: string
): Promise<DomainError> {
  const error = await catchJourneyError(fn);
  expect(error).toBeInstanceOf(errorClass);
  if (!(error instanceof errorClass)) {
    throw new Error(`expected a ${code} ${errorClass.name} denial`);
  }
  expect(error.code).toBe(code);
  if (translatedFragment !== undefined) {
    expect(error.message).toContain(translatedFragment);
  }
  return error;
}

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
  input: RubricEvaluationSubmitInput
): Promise<void> {
  const result = await EvaluationRubricService.submitRubricEvaluation(evaluatorUserId, sessionRow.id, input, LOCALE);
  tracked.register(evaluations, result.id);
}

/** A valid passing-score rubric payload (notes prefix-stamped, no weakness). */
function passingRubric(tag: string): RubricEvaluationSubmitInput {
  return { score: 90, notes: `${PREFIX} rubric notes ${tag}`, weaknessArea: null };
}

/**
 * Clock-advance fixture — rewrites the stored cooldown expiry to a past
 * instant inside ONE committed transaction. A direct fixture write on the
 * cooldown column: the production clock is never mocked, and every later
 * read observes the same stored instant the way time would have left it.
 */
async function advanceCooldownIntoThePast(applicantUserId: number): Promise<void> {
  const pastInstant = new Date(Date.now() - 60_000);
  const rows = await db.transaction(async tx =>
    tx.update(applicants).set({ cooldownUntil: pastInstant }).where(eq(applicants.id, applicantUserId)).returning()
  );
  const row = rows.at(0);
  if (!row) {
    throw new Error(`clock-advance fixture: no applicants row ${applicantUserId} to advance past`);
  }
}

/**
 * The two-source-split lock — after ANY cooldown write, the account row's
 * governance triple must read exactly as the fixture provisioned it: the
 * cooldown machinery never touches the account-suspension axis.
 */
async function expectGovernanceTripleUntouched(userId: number): Promise<void> {
  const userRow = await readUserRow(userId);
  if (!userRow) {
    throw new Error(`expected the users row ${userId} to survive the cooldown write`);
  }
  expect(userRow.suspended).toBe(false);
  expect(userRow.suspendedAt).toBeNull();
  expect(userRow.suspendedPeriodDays).toBeNull();
}

/**
 * Shared fail-finalization oracle: the fifth submission's verdict writes —
 * `failed` status, the cooldown stamped within the submission's window at
 * the given duration, no teacher/students rows, the governance triple
 * untouched, and exactly ONE fail-flavored notification published to the
 * applicant only.
 */
async function expectFailedFinalization(
  applicantUserId: number,
  windowStartMs: number,
  windowEndMs: number,
  cooldownMs: number
): Promise<Date> {
  const row = await readApplicantRow(applicantUserId);
  expect(row.status).toBe(ApplicantStatus.Failed);
  const cooldownUntil = row.cooldownUntil;
  if (!cooldownUntil) {
    throw new Error("expected the failed cycle to carry a cooldown stamp");
  }
  expect(cooldownUntil.getTime()).toBeGreaterThanOrEqual(windowStartMs + cooldownMs - CLOCK_SKEW_MS);
  expect(cooldownUntil.getTime()).toBeLessThanOrEqual(windowEndMs + cooldownMs + CLOCK_SKEW_MS);
  expect(cooldownUntil.getTime()).toBeGreaterThan(Date.now());

  expect(await teacherRowCount(applicantUserId)).toBe(0);
  expect(await studentsRowCount(applicantUserId)).toBe(0);
  await expectGovernanceTripleUntouched(applicantUserId);

  const resultRows = await evaluationResultRowsFor(applicantUserId);
  expect(resultRows).toHaveLength(1);
  expect(lastPublishedRecipientIds()).toEqual([applicantUserId]);
  return cooldownUntil;
}

// ─── GraphQL-tier helpers (the admin surface) ────────────────────────────────

/**
 * Builds the same verified-session context the GraphQL context factory
 * produces for a REAL fixture user: identity and role are read from the
 * user's real row (no monkey-patching — a non-admin context is non-admin
 * because the row says so), with the password hash stripped exactly the way
 * the production context build strips it.
 */
async function verifiedSessionContext(userId: number, locale: string): Promise<Context> {
  const row = await readUserRow(userId);
  if (!row) {
    throw new Error(`journey state missing: users row ${userId} vanished before the GraphQL execution`);
  }
  const { passwordHash: _stripped, ...sessionUser } = row;
  const user = { ...sessionUser, preferredRecitation: null };
  const role = toUserRole(user.role);
  if (role === null) {
    throw new Error(`journey state missing: users row ${userId} carries a foreign role value`);
  }
  const translations = getServerTranslations(locale);
  return {
    locale,
    requestId: JOURNEY_REQUEST_ID,
    idempotencyKey: null,
    t: async <TNamespace extends keyof Translations>(namespace: TNamespace) => translations[namespace],
    user,
    safeUser: user,
    permissions: [],
    isSuperAdmin: role === UserRole.Admin,
    role,
    cookies: {},
    authCookieOut: createAuthCookieOut(),
  };
}

/** Executes the admin cooldown-extension operation as one real fixture user. */
async function executeExtendCooldownMutation(
  callerUserId: number,
  applicantId: number,
  additionalDays: number
): Promise<WireOutcome> {
  const contextValue = await verifiedSessionContext(callerUserId, LOCALE);
  const result = await graphql({
    schema: graphQLSchema,
    source: EXTEND_COOLDOWN_MUTATION,
    variableValues: { applicantId, additionalDays },
    contextValue,
  });
  return {
    data: result.data,
    errors: (result.errors ?? []).map(error => ({
      message: error.message,
      extensions: error.extensions,
    })),
  };
}

/** The wire `extensions.code` of one error element ("" when absent). */
function wireErrorCode(error: WireErrorShape): string {
  const code = error.extensions?.code;
  return typeof code === "string" ? code : "";
}

/**
 * Reads the mutation's profile payload out of the wire data, failing on any
 * wire error. The expiry instant materializes as a `Date` under in-process
 * schema execution and as an ISO-8601 string over the HTTP JSON boundary —
 * the DateTime scalar's two declared output shapes — so the payload guard
 * admits both and the value is normalized to one epoch-ms instant for the
 * downstream temporal assertions.
 */
function readProfilePayload(outcome: WireOutcome): WireProfilePayload {
  if (outcome.errors.length > 0) {
    throw new Error(`the wire rejected the admin extension: ${outcome.errors.map(error => error.message).join("; ")}`);
  }
  if (!isRecord(outcome.data)) {
    throw new Error("expected the mutation to return a data payload");
  }
  const payload = outcome.data.adminExtendApplicantCooldown;
  if (!isRecord(payload)) {
    throw new Error("expected the mutation to return the applicant profile");
  }
  const id = payload.id;
  const status = payload.status;
  const cooldownUntil = payload.cooldownUntil;
  const cooldownActive = payload.cooldownActive;
  const canPurchaseVerification = payload.canPurchaseVerification;
  const cooldownState = payload.cooldownState;
  if (
    typeof id !== "number" ||
    typeof status !== "string" ||
    (typeof cooldownUntil !== "string" && !(cooldownUntil instanceof Date)) ||
    typeof cooldownActive !== "boolean" ||
    typeof canPurchaseVerification !== "boolean" ||
    typeof cooldownState !== "string"
  ) {
    throw new Error("the mutation payload did not match the applicant profile wire shape");
  }
  return {
    id,
    status,
    cooldownUntilMs: new Date(cooldownUntil).getTime(),
    cooldownActive,
    canPurchaseVerification,
    cooldownState,
  };
}

/**
 * Denial oracle on the wire tier — the admin operation is denied through the
 * real authScopes/resolver chain with exactly one typed error element.
 */
async function expectWireDenial(
  callerUserId: number,
  applicantId: number,
  additionalDays: number,
  expectedCode: string,
  expectedMessageFragment: string
): Promise<void> {
  const outcome = await executeExtendCooldownMutation(callerUserId, applicantId, additionalDays);
  expect(outcome.errors).toHaveLength(1);
  const denial = outcome.errors[0];
  if (!denial) {
    throw new Error(`expected a single ${expectedCode} wire denial`);
  }
  expect(wireErrorCode(denial)).toBe(expectedCode);
  expect(denial.message).toContain(expectedMessageFragment);
}

// ─── Fixture provisioning ────────────────────────────────────────────────────

beforeAll(async () => {
  // Stage 1 — the sanctioned cast provisioner: real users + role-children in
  // ONE committing transaction (the admin, the bystanders, and the cast's
  // own pending applicant).
  bundle = await createJourneyFixtures(PREFIX);

  // Stage 2 — ONE committing transaction for everything else the journey
  // needs: the five certified evaluators, the three cycle applicants (two
  // fail arcs + one terminal `passed` cast), the persisted EN locale for the
  // whole cast, and the verification plan fixture.
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
    const terminalUser = await createTestUser(tx, { role: "teacher", locale: LOCALE });
    await createTestApplicant(tx, terminalUser.id, {
      status: ApplicantStatus.Passed,
      cooldownUntil: null,
    });

    for (const { userId } of failCasts) {
      tracked.register(users, userId);
      tracked.register(applicants, userId);
    }
    applicantTajweedId = failCasts[0]?.userId ?? 0;
    applicantHifzId = failCasts[1]?.userId ?? 0;
    certifiedApplicantId = terminalUser.id;
    tracked.register(users, certifiedApplicantId);
    tracked.register(applicants, certifiedApplicantId);
    if (applicantTajweedId === 0 || applicantHifzId === 0) {
      throw new Error("journey fixture: the fail-cycle applicants did not provision");
    }

    const castUserIds = [
      requireBundle().cast.admin.user.id,
      requireBundle().cast.student.user.id,
      requireBundle().cast.parent.user.id,
      requireBundle().cast.applicant.user.id,
      requireBundle().cast.certifiedTeacher.user.id,
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
  // tracked row (claims → sessions → rubric rows → subscriptions → cycle rows → plan).
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

describe("applicant cooldown lifecycle journey (fail → gate → extend → expire → re-apply)", () => {
  test("step 1 — System: the cast, the certified evaluators, and the open tajweed cycle with four rubrics recorded", async () => {
    // The cycle applicants start PENDING with a NULL cooldown; the terminal
    // cast is already certified; the evaluators hold REAL certified-evaluator
    // teacher rows.
    expect((await readApplicantRow(applicantTajweedId)).status).toBe(ApplicantStatus.Pending);
    expect((await readApplicantRow(applicantHifzId)).status).toBe(ApplicantStatus.Pending);
    const terminalRow = await readApplicantRow(certifiedApplicantId);
    expect(terminalRow.status).toBe(ApplicantStatus.Passed);
    expect(terminalRow.cooldownUntil).toBeNull();
    const evaluatorRows = await db.select().from(teacher).where(inArray(teacher.id, evaluatorIds));
    expect(evaluatorRows).toHaveLength(VERIFICATION_PLAN_SESSION_COUNT);
    for (const evaluatorRow of evaluatorRows) {
      expect(evaluatorRow.isApproved).toBe(true);
      expect(evaluatorRow.isEvaluator).toBe(true);
    }

    // The purchase target carries the product contract verbatim.
    expect(planRow.sessionCount).toBe(VERIFICATION_PLAN_SESSION_COUNT);
    expect(planRow.price).toBe(VERIFICATION_PLAN_PRICE);
    expect(planRow.currency).toBe(VERIFICATION_PLAN_CURRENCY);
    expect(planRow.intervalDays).toBe(VERIFICATION_PLAN_INTERVAL_DAYS);

    // Open the tajweed cycle through the real purchase → booking →
    // completion chain, then record the four quorum rubrics — the lowest
    // FAILING score is a tajweed 79, which is the data shape the verdict's
    // cooldown duration resolves from.
    await purchaseAndActivateTracked(applicantTajweedId, "tajweed");
    const opened = await readApplicantRow(applicantTajweedId);
    expect(opened.status).toBe(ApplicantStatus.InEvaluation);
    expect(opened.cooldownUntil).toBeNull();
    expect(opened.verificationAttempts ?? 0).toBe(0);

    const booked = await bookCycleTracked(applicantTajweedId, "tajweed");
    tajweedCycleSessions.push(...booked);
    await Promise.all(tajweedCycleSessions.map(sessionRow => completeEvaluationSession(sessionRow)));

    const firstSession = tajweedCycleSessions[0];
    if (!firstSession) {
      throw new Error("journey state: the tajweed cycle's first session is missing");
    }
    const failingResult = await EvaluationRubricService.submitRubricEvaluation(
      firstSession.teacherId,
      firstSession.id,
      {
        score: PASS_THRESHOLD - 1,
        notes: `${PREFIX} rubric notes tajweed-79`,
        weaknessArea: RubricWeaknessArea.Tajweed,
      },
      LOCALE
    );
    tracked.register(evaluations, failingResult.id);
    expect(failingResult.weaknessArea).toBe(RubricWeaknessArea.Tajweed);
    expect(failingResult.applicantStatus).toBe(ApplicantStatus.InEvaluation);

    const quorumPending = await Promise.all(
      tajweedCycleSessions.slice(1, VERIFICATION_PLAN_SESSION_COUNT - 1).map((sessionRow, index) => {
        const passingInput = passingRubric(`tajweed-e${index + 2}`);
        return submitRubricTracked(sessionRow.teacherId, sessionRow, passingInput);
      })
    );
    expect(quorumPending).toHaveLength(VERIFICATION_PLAN_SESSION_COUNT - 2);

    const row = await readApplicantRow(applicantTajweedId);
    expect(row.status).toBe(ApplicantStatus.InEvaluation);
    expect(row.cooldownUntil).toBeNull();
    expect(await rubricRowCountFor(applicantTajweedId)).toBe(VERIFICATION_PLAN_SESSION_COUNT - 1);
    expect(await teacherRowCount(applicantTajweedId)).toBe(0);
    expect(await studentsRowCount(applicantTajweedId)).toBe(0);
  });

  test("step 2 — System: the fifth submission finalizes FAIL — cooldown ≈ now+30d, failed, account untouched", async () => {
    const fifthSession = tajweedCycleSessions[VERIFICATION_PLAN_SESSION_COUNT - 1];
    if (!fifthSession) {
      throw new Error("journey state: the tajweed cycle's fifth session is missing");
    }
    const publishesBefore = publishSpy.mock.calls.length;
    const windowStartMs = Date.now();

    const result = await EvaluationRubricService.submitRubricEvaluation(
      fifthSession.teacherId,
      fifthSession.id,
      { score: 88, notes: `${PREFIX} rubric notes tajweed-e5`, weaknessArea: null },
      LOCALE
    );
    const windowEndMs = Date.now();
    expect(result.applicantStatus).toBe(ApplicantStatus.Failed);
    expect(publishSpy.mock.calls).toHaveLength(publishesBefore + 1);

    // The verdict writes: failed + the 30-day tajweed cooldown captured from
    // the fifth submission's transaction window; NO teacher/students rows;
    // the account row's governance triple untouched (the cooldown write
    // never spills onto the account-suspension axis).
    const stamped = await expectFailedFinalization(applicantTajweedId, windowStartMs, windowEndMs, TAJWEED_COOLDOWN_MS);
    tajweedStamp = stamped;
  });

  test("step 3 — Applicant: the self profile reads active and not purchasable during the cooldown", async () => {
    const profile = await ApplicantLifecycleService.getMyApplicantProfile(applicantTajweedId, LOCALE);
    if (!profile) {
      throw new Error("expected the failed applicant's self profile to resolve");
    }
    expect(profile.status).toBe(ApplicantStatus.Failed);
    expect(profile.cooldownState).toBe(ApplicantCooldownState.Active);
    expect(profile.cooldownActive).toBe(true);
    expect(profile.canPurchaseVerification).toBe(false);
    expect(profile.cooldownUntil?.getTime()).toBe(requireStamp().getTime());
  });

  test("step 4 — Applicant: the verification purchase is denied while the cooldown is active (422 family, zero writes)", async () => {
    const rowBefore = await readApplicantRow(applicantTajweedId);
    const subscriptionsBefore = await db.$count(subscriptions, eq(subscriptions.userId, applicantTajweedId));

    const denialKey = `${PREFIX}-key-denied`;
    const denial = await expectTypedDenial(
      () => VerificationPurchaseService.purchase(applicantTajweedId, denialKey, LOCALE),
      ValidationError,
      "APPLICANT_COOLDOWN_ACTIVE",
      templatePrefix(ERRORS_EN.applicantCooldownActive)
    );

    // The `extensions.code` contract: the typed conflict carries the exact
    // code the wire surfaces, and the boundary finalizer passes it through
    // VERBATIM (a domain rejection is never masked into a generic failure).
    expect(denial.extensions?.code).toBe("APPLICANT_COOLDOWN_ACTIVE");
    const finalized = finalizeGraphqlErrors({ errors: [denial] }, { locale: LOCALE, requestId: JOURNEY_REQUEST_ID });
    const finalizedItems = finalized.errors;
    if (!Array.isArray(finalizedItems) || finalizedItems.length !== 1 || !isRecord(finalizedItems[0])) {
      throw new Error("expected the finalizer to rebuild exactly one wire error");
    }
    const finalizedExtensions = finalizedItems[0].extensions;
    if (!isRecord(finalizedExtensions)) {
      throw new Error("expected the finalized wire error to carry extensions");
    }
    expect(finalizedExtensions.code).toBe("APPLICANT_COOLDOWN_ACTIVE");
    // The transport status family: a ValidationError-class denial maps onto
    // the canonical VALIDATION row — HTTP 422.
    expect(ERROR_CODE_HTTP_STATUS.VALIDATION).toBe(422);

    // The rejection wrote nothing: no claim, no new subscription pair, and
    // the applicant row is byte-identical.
    const claimsForDeniedKey = await db
      .select()
      .from(subscriptionPurchaseIdempotency)
      .where(eq(subscriptionPurchaseIdempotency.idempotencyKey, denialKey));
    expect(claimsForDeniedKey).toHaveLength(0);
    expect(await db.$count(subscriptions, eq(subscriptions.userId, applicantTajweedId))).toBe(subscriptionsBefore);
    const rowAfter = await readApplicantRow(applicantTajweedId);
    expect(rowAfter.status).toBe(rowBefore.status);
    expect(rowAfter.cooldownUntil?.getTime()).toBe(rowBefore.cooldownUntil?.getTime());
    expect(rowAfter.verificationAttempts ?? 0).toBe(rowBefore.verificationAttempts ?? 0);
  });

  test("step 5 — Admin: the cooldown extension lengthens the stored base by 60 days and appends ONE adjust audit row", async () => {
    const stamped = requireStamp();
    const auditCountBefore = await countAuditLogsForActor(adminId());
    const publishesBefore = publishSpy.mock.calls.length;
    const inboxBefore = await inboxCount(applicantTajweedId);

    const outcome = await executeExtendCooldownMutation(adminId(), applicantTajweedId, EXTENSION_DAYS);
    expect(outcome.errors).toEqual([]);
    const payload = readProfilePayload(outcome);
    expect(payload.id).toBe(applicantTajweedId);
    expect(payload.status).toBe("Failed");
    expect(payload.cooldownState).toBe("Active");
    expect(payload.cooldownActive).toBe(true);
    expect(payload.canPurchaseVerification).toBe(false);

    // Never-shorten math honored VERBATIM: the stored instant is the base, so
    // the extension lands at stamped + 60 days (≈ now + 90 days from the
    // stamp window), inside the admin action's observation window.
    const extendedLowerBound = stamped.getTime() + EXTENSION_DAYS * MS_PER_DAY - CLOCK_SKEW_MS;
    const extendedUpperBound = stamped.getTime() + EXTENSION_DAYS * MS_PER_DAY + CLOCK_SKEW_MS;
    expect(payload.cooldownUntilMs).toBeGreaterThanOrEqual(extendedLowerBound);
    expect(payload.cooldownUntilMs).toBeLessThanOrEqual(extendedUpperBound);

    const row = await readApplicantRow(applicantTajweedId);
    expect(row.status).toBe(ApplicantStatus.Failed);
    expect(row.cooldownUntil?.getTime()).toBe(payload.cooldownUntilMs);

    // Exactly ONE audit row: the adjust verb, the applicant entity, the admin
    // actor, and the names-only details payload (field name + old/new expiry
    // ISOs + the requested length — never contact PII).
    const auditRows = await extensionAuditRowsFor(applicantTajweedId);
    expect(auditRows).toHaveLength(1);
    const auditRow = auditRows[0];
    if (!auditRow) {
      throw new Error("expected the extension audit row to persist");
    }
    expect(auditRow.actionType).toBe(AuditActionType.Adjust);
    expect(auditRow.actorId).toBe(adminId());
    const details: unknown = JSON.parse(auditRow.details ?? "null");
    expect(details).toEqual({
      field: "cooldown_until",
      from: stamped.toISOString(),
      to: new Date(payload.cooldownUntilMs).toISOString(),
      additionalDays: EXTENSION_DAYS,
    });
    expect(await countAuditLogsForActor(adminId())).toBe(auditCountBefore + 1);

    // The write spilled nowhere else: the account row is untouched and no
    // notification fan-out rode the admin action.
    await expectGovernanceTripleUntouched(applicantTajweedId);
    expect(await inboxCount(applicantTajweedId)).toBe(inboxBefore);
    expect(publishSpy.mock.calls).toHaveLength(publishesBefore);
  });

  test("step 6 — Applicant: the self profile observes the extended instant, still active", async () => {
    const profile = await ApplicantLifecycleService.getMyApplicantProfile(applicantTajweedId, LOCALE);
    if (!profile) {
      throw new Error("expected the failed applicant's self profile to resolve after the extension");
    }
    expect(profile.cooldownState).toBe(ApplicantCooldownState.Active);
    expect(profile.cooldownActive).toBe(true);
    expect(profile.canPurchaseVerification).toBe(false);
    expect(profile.cooldownUntil?.getTime()).toBeGreaterThan(requireStamp().getTime());
    expect(profile.cooldownUntil?.getTime()).toBeGreaterThanOrEqual(
      requireStamp().getTime() + EXTENSION_DAYS * MS_PER_DAY - CLOCK_SKEW_MS
    );
  });

  test("step 7 — System: the expiry passes and the read-model flips to expired (still re-purchasable)", async () => {
    await advanceCooldownIntoThePast(applicantTajweedId);

    const profile = await ApplicantLifecycleService.getMyApplicantProfile(applicantTajweedId, LOCALE);
    if (!profile) {
      throw new Error("expected the failed applicant's self profile to resolve after the expiry");
    }
    expect(profile.status).toBe(ApplicantStatus.Failed);
    expect(profile.cooldownState).toBe(ApplicantCooldownState.Expired);
    expect(profile.cooldownActive).toBe(false);
    expect(profile.canPurchaseVerification).toBe(true);
    expect(profile.cooldownUntil).not.toBeNull();
    expect(profile.cooldownUntil?.getTime() ?? 0).toBeLessThan(Date.now());
  });

  test("step 8 — Applicant: the re-application purchase SUCCEEDS — attempt counter increments, failed → in_evaluation", async () => {
    const rowBefore = await readApplicantRow(applicantTajweedId);
    expect(rowBefore.status).toBe(ApplicantStatus.Failed);
    const publishesBefore = publishSpy.mock.calls.length;

    const reapplicationKey = `${PREFIX}-key-reapply`;
    const result = await VerificationPurchaseService.purchase(applicantTajweedId, reapplicationKey, LOCALE);
    tracked.register(subscriptions, result.subscription.id);
    tracked.register(studentPayments, result.payment.id);
    const claimRows = await db
      .select()
      .from(subscriptionPurchaseIdempotency)
      .where(eq(subscriptionPurchaseIdempotency.idempotencyKey, reapplicationKey));
    expect(claimRows).toHaveLength(1);
    for (const claimRow of claimRows) {
      tracked.register(subscriptionPurchaseIdempotency, claimRow.id);
    }
    ledgerSubscriptionIds.push(result.subscription.id);
    ledgerPaymentIds.push(result.payment.id);

    // The re-application accounting: the attempt counter incremented exactly
    // once, the attempt instant is stamped, and the cycle re-opened.
    const rowAfter = await readApplicantRow(applicantTajweedId);
    expect(rowAfter.status).toBe(ApplicantStatus.InEvaluation);
    expect(rowAfter.verificationAttempts ?? 0).toBe((rowBefore.verificationAttempts ?? 0) + 1);
    expect(rowAfter.lastAttemptAt).not.toBeNull();

    const profile = await ApplicantLifecycleService.getMyApplicantProfile(applicantTajweedId, LOCALE);
    if (!profile) {
      throw new Error("expected the re-applied applicant's self profile to resolve");
    }
    expect(profile.status).toBe(ApplicantStatus.InEvaluation);
    expect(profile.verificationAttempts).toBe(rowAfter.verificationAttempts ?? 0);

    // A plain purchase emits no receipt of its own (activation owns that) —
    // the publish count is unchanged.
    expect(publishSpy.mock.calls).toHaveLength(publishesBefore);
  });

  test("step 9 — Non-admin: the admin extension is denied FORBIDDEN at the mutation scope, zero writes", async () => {
    const nonAdminId = requireBundle().cast.certifiedTeacher.user.id;
    const rowBefore = await readApplicantRow(applicantTajweedId);
    const auditCountBefore = await countAuditLogsForActor(adminId());

    await expectWireDenial(nonAdminId, applicantTajweedId, 30, "FORBIDDEN", ERRORS_EN.forbidden);

    // The denial fired before the resolver body: no cooldown write, no audit
    // row, the applicant row byte-identical.
    const rowAfter = await readApplicantRow(applicantTajweedId);
    expect(rowAfter.cooldownUntil?.getTime()).toBe(rowBefore.cooldownUntil?.getTime());
    expect(rowAfter.status).toBe(rowBefore.status);
    expect(await countAuditLogsForActor(adminId())).toBe(auditCountBefore);
  });

  test("step 10 — Admin: a certified applicant's cooldown cannot be extended (terminal guard, zero writes)", async () => {
    const rowBefore = await readApplicantRow(certifiedApplicantId);
    const auditCountBefore = await countAuditLogsForActor(adminId());

    await expectWireDenial(
      adminId(),
      certifiedApplicantId,
      30,
      "APPLICANT_ALREADY_CERTIFIED",
      ERRORS_EN.applicantAlreadyCertified
    );

    const rowAfter = await readApplicantRow(certifiedApplicantId);
    expect(rowAfter.status).toBe(ApplicantStatus.Passed);
    expect(rowAfter.cooldownUntil?.getTime() ?? null).toBe(rowBefore.cooldownUntil?.getTime() ?? null);
    expect(await countAuditLogsForActor(adminId())).toBe(auditCountBefore);
  });

  test("step 11 — Admin: a zero-day extension length is rejected as out-of-bounds, zero writes", async () => {
    const rowBefore = await readApplicantRow(applicantTajweedId);
    const auditCountBefore = await countAuditLogsForActor(adminId());

    await expectWireDenial(
      adminId(),
      applicantTajweedId,
      0,
      "APPLICANT_COOLDOWN_EXTENSION_INVALID",
      ERRORS_EN.applicantCooldownExtensionInvalid
    );

    const rowAfter = await readApplicantRow(applicantTajweedId);
    expect(rowAfter.cooldownUntil?.getTime()).toBe(rowBefore.cooldownUntil?.getTime());
    expect(await countAuditLogsForActor(adminId())).toBe(auditCountBefore);
  });

  test("step 12 — System: the hifz arc replays — the lowest failing score drives the 90-day minimum", async () => {
    // Open the hifz cycle the same way: purchase → activation → five booked
    // and completed evaluation sessions.
    await purchaseAndActivateTracked(applicantHifzId, "hifz");
    const booked = await bookCycleTracked(applicantHifzId, "hifz");
    hifzCycleSessions.push(...booked);
    await Promise.all(hifzCycleSessions.map(sessionRow => completeEvaluationSession(sessionRow)));

    // The quorum rubrics: the FIRST score is a hifz 79 — the lowest-scoring
    // failing area the verdict's duration resolves from — then three passing
    // scores.
    const firstSession = hifzCycleSessions[0];
    if (!firstSession) {
      throw new Error("journey state: the hifz cycle's first session is missing");
    }
    const failingResult = await EvaluationRubricService.submitRubricEvaluation(
      firstSession.teacherId,
      firstSession.id,
      { score: PASS_THRESHOLD - 1, notes: `${PREFIX} rubric notes hifz-79`, weaknessArea: RubricWeaknessArea.Hifz },
      LOCALE
    );
    tracked.register(evaluations, failingResult.id);
    expect(failingResult.weaknessArea).toBe(RubricWeaknessArea.Hifz);
    expect(failingResult.applicantStatus).toBe(ApplicantStatus.InEvaluation);

    const quorumPending = await Promise.all(
      hifzCycleSessions.slice(1, VERIFICATION_PLAN_SESSION_COUNT - 1).map((sessionRow, index) => {
        const passingInput = passingRubric(`hifz-e${index + 2}`);
        return submitRubricTracked(sessionRow.teacherId, sessionRow, passingInput);
      })
    );
    expect(quorumPending).toHaveLength(VERIFICATION_PLAN_SESSION_COUNT - 2);

    // The fifth submission finalizes FAIL with the 90-day hifz minimum.
    const fifthSession = hifzCycleSessions[VERIFICATION_PLAN_SESSION_COUNT - 1];
    if (!fifthSession) {
      throw new Error("journey state: the hifz cycle's fifth session is missing");
    }
    const publishesBefore = publishSpy.mock.calls.length;
    const windowStartMs = Date.now();
    const result = await EvaluationRubricService.submitRubricEvaluation(
      fifthSession.teacherId,
      fifthSession.id,
      { score: 88, notes: `${PREFIX} rubric notes hifz-e5`, weaknessArea: null },
      LOCALE
    );
    const windowEndMs = Date.now();
    expect(result.applicantStatus).toBe(ApplicantStatus.Failed);
    expect(publishSpy.mock.calls).toHaveLength(publishesBefore + 1);

    await expectFailedFinalization(applicantHifzId, windowStartMs, windowEndMs, HIFZ_COOLDOWN_MS);

    // The two arcs' stamps differ exactly by the duration the failing area
    // dictates — the longer minimum is data-driven, not hard-coded.
    const hifzRow = await readApplicantRow(applicantHifzId);
    expect(hifzRow.cooldownUntil?.getTime()).toBeGreaterThan(requireStamp().getTime());
  });
});
