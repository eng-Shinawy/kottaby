/**
 * EvaluationBookingService tests — the applicant-facing surfaces of the
 * five-session evaluation loop (the booking write plus its three reads),
 * against the live `kottaby_test` PostgreSQL instance on REAL repositories.
 *
 * Per `backend/db/test/AGENTS.md` (the DB-backed service-test rules the
 * sibling suites apply):
 *  - Every transactional case runs inside `runInRollback`; `tx` is handed
 *    to the service as its outer transaction (the flow executes on a
 *    SAVEPOINT of the caller's transaction).
 *  - The chaos block uses COMMITTED fixtures (own top-level transaction
 *    per call, the undefined-outerTx production path) with hard deletes
 *    and residue probes — genuine row-lock serialization on separate
 *    connections, exactly like the sibling chaos blocks.
 *  - Entities are created ONLY via `entity-setup.ts` helpers — never seed
 *    data.
 *  - NO `expect(...).rejects.toThrow()` — every denial goes through
 *    `expectRepoError`; typed denials are asserted through the
 *    `DomainError.code` contract plus the exact translated message.
 *
 * Coverage map (the four-tier contract):
 *  - Tier 1 (branch/statement): the happy booking with the FULL
 *    server-owned column set asserted (fee/hold/lane NULL-or-false, the
 *    confirmation deadline window, every lifecycle stamp null) plus the
 *    claim backfill and the post-commit notification dispatch; the full
 *    denial matrix with exact classes + codes (`VALIDATION` for malformed
 *    ids and keys, `FORBIDDEN`, `APPLICANT_NOT_FOUND`,
 *    `APPLICANT_NOT_IN_EVALUATION`, `VERIFICATION_NOT_ACTIVE`,
 *    `NO_EVALUATION_CREDITS_REMAINING`, `EVALUATION_LOOP_COMPLETE`,
 *    `EVALUATOR_ALREADY_USED`, `TEACHER_NOT_FOUND`,
 *    `TEACHER_NOT_CERTIFIED`, `DUPLICATE_REQUEST`, `SESSION_NOT_FOUND`);
 *    the read surfaces' happy + zero-shape branches.
 *  - Tier 2 (boundary): booked=4/5 (the last free slot), the 6th-booking
 *    zero-trap (credits-exhausted vs loop-complete decided by the
 *    completed count), the cycleStart boundary (prior-cycle rows create
 *    history, not entitlements), cancelled-row exclusion (a cancellation
 *    re-opens BOTH the credit and the evaluator), page-bound
 *    normalization on every read, the evaluator picker's used-evaluator
 *    subtraction and PII-free option shape.
 *  - Tier 3 (chaos): the capacity-vs-distinctness gate ORDER (a full
 *    cycle denies before distinctness ever fires), the same-key replay
 *    (free of charge — exactly one stored row), the vanished-claim
 *    fail-closed replay, the foreign-claim denial, and the committed
 *    production-path races — the final-credit race, the same-evaluator
 *    race, and the same-key 23505 race (exactly one winner, one typed
 *    loser, one stored row each).
 *  - Tier 4 (security/abuse): the self-booking ≡ unknown-evaluator oracle
 *    collapse; the foreign idempotency-key denial (another user's claim is
 *    never surfaced as a duplicate); the caller-keyed reads (a
 *    non-participant's session list is empty, the loop status is the
 *    fixed zero-shape, the picker denies oracle-safely without an active
 *    cycle); the notification-dispatch failure contract (logged, never
 *    rethrown — the booking is already durable); the bounded denial-log
 *    contract (exactly one `logDomainError` per denial, zero on happy
 *    paths, never the submitted payload).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/backend/db";
import { ApplicantRepository, SessionRequestIdempotencyRepository, TeacherRepository } from "@/backend/db/repo";
import { plans } from "@/backend/db/schema/billing/plans";
import { subscriptions } from "@/backend/db/schema/billing/subscriptions";
import { session } from "@/backend/db/schema/classes/session";
import { sessionRequestIdempotency } from "@/backend/db/schema/classes/session-request-idempotency";
import { applicants } from "@/backend/db/schema/teachers/applicants";
import { teacher } from "@/backend/db/schema/teachers/teacher";
import { users } from "@/backend/db/schema/users/users";
import {
  createTestApplicant,
  createTestPlan,
  createTestSession,
  createTestSubscription,
  createTestTeacherRow,
  createTestUser,
} from "@/backend/db/test/entity-setup";
import { expectRepoError, runInRollback } from "@/backend/db/test/test-utils";
import { SessionIntent } from "@/backend/enum/scheduling/session-intent.enum";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import { SessionType } from "@/backend/enum/scheduling/session-type.enum";
import { ApplicantStatus } from "@/backend/enum/teachers/applicant-status.enum";
import { ConflictError, DomainError, ForbiddenError, NotFoundError, ValidationError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import { SessionRequestNotificationService } from "@/backend/services/classes/session-request-notification.service";
import { EvaluationBookingService } from "@/backend/services/teachers/evaluation-booking.service";
import type {
  ApplicantSelectType,
  DBTransaction,
  NotificationDeliveryReceipt,
  SessionSelectType,
  TeacherSelectType,
} from "@/backend/types";
import { SESSION_CONFIRMATION_WINDOW_MS } from "@/shared/constants/session-fees.constants";
import {
  VERIFICATION_PLAN_SESSION_COUNT,
  VERIFICATION_PLAN_TITLE,
} from "@/shared/constants/verification-plan.constants";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import { isPgliteProvider } from "@/test/helpers/skip-when-pglite";

const testOnRealPostgres = isPgliteProvider() ? test.skip : test;

/** The tests run on the default locale throughout. */
const LOCALE = "en";

/**
 * An evaluator id far outside every sequence's range yet inside the
 * positive safe-integer guard — the "unknown evaluator" probe of the
 * oracle leg.
 */
const UNKNOWN_EVALUATOR_ID = 2_000_000_000;

/** The maximal carryable idempotency-key length (one char longer is malformed). */
const MAX_KEY_LENGTH = 128;

// ─── Assertion helpers (sibling-suite conventions) ───────────────────────

/** The errors-namespace translations for the default test locale. */
function t() {
  return getServerTranslations(LOCALE).errorsTranslations;
}

/** Type-guard read of a caught rejection's `extensions.code` contract. */
function rejectionCode(error: unknown): string {
  return error instanceof DomainError ? error.code : "";
}

/**
 * Asserts a caught error is a `DomainError` carrying EXACTLY the expected
 * `extensions.code` and the exact translated message (never the raw
 * translation key, never the code echoed into the copy).
 */
function expectDomainDenial(error: Error, code: string, message: string): void {
  expect(error).toBeInstanceOf(DomainError);
  expect(rejectionCode(error)).toBe(code);
  expect(error.message).toBe(message);
  expect(error.message).not.toContain(code);
}

/** The denial fingerprint used for the byte-identical oracle pairings. */
interface DenialShape {
  readonly name: string;
  readonly code: string;
  readonly message: string;
}

/** Captures the denial fingerprint (class name, code, exact message). */
function denialShape(error: Error): DenialShape {
  return { name: error.name, code: rejectionCode(error), message: error.message };
}

/** Runtime guard for a recorded log-context object (no narrowing casts). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// ─── Log-spy machinery (the bounded denial-log contract) ─────────────────

/** The ONLY context keys a bounded denial log may carry. */
const BOUNDED_LOG_CONTEXT_KEYS: ReadonlySet<string> = new Set(["code", "entity", "entityId"]);

/** One recorded `logDomainError` call (message + context). */
interface RecordedLogCall {
  readonly message: string;
  readonly ctx: unknown;
}

/** Log-spy box: ONE passthrough spy installed per describe block. */
const logSpyBox: { spy?: ReturnType<typeof installLogSpy> } = {};

function installLogSpy() {
  return spyOn(logger, "logDomainError");
}

/** The `logger.error` spy for the post-commit dispatch-failure contract. */
function installErrorSpy() {
  return spyOn(logger, "error");
}

/** The installed log spy (setup-integrity failure if absent). */
function requireLogSpy() {
  if (!logSpyBox.spy) {
    throw new Error("log spy not installed (fixture integrity failure)");
  }
  return logSpyBox.spy;
}

/** The log calls recorded in the current test's window. */
function logCalls(): readonly RecordedLogCall[] {
  return requireLogSpy().mock.calls.map(args => ({ message: args[0], ctx: args[1] }));
}

/** Asserts every recorded call context carries ONLY bounded keys. */
function expectBoundedContextKeys(ctx: Record<string, unknown>): void {
  for (const key of Object.keys(ctx)) {
    expect(BOUNDED_LOG_CONTEXT_KEYS.has(key)).toBe(true);
  }
}

/**
 * Asserts EXACTLY ONE denial log fired in the current window, carrying the
 * expected code inside a BOUNDED context (no payload, no PII, no extra
 * keys) and the given entity id when supplied.
 */
function expectSingleBoundedDenialLog(code: string, entityId?: number): void {
  const calls = logCalls();
  expect(calls).toHaveLength(1);
  const ctx = calls[0]?.ctx;
  expect(isRecord(ctx)).toBe(true);
  if (isRecord(ctx)) {
    expect(ctx.code).toBe(code);
    if (entityId !== undefined) {
      expect(ctx.entityId).toBe(entityId);
    }
    expectBoundedContextKeys(ctx);
  }
}

/** Asserts the current window recorded ZERO log calls. */
function expectZeroLogCalls(): void {
  expect(logCalls()).toHaveLength(0);
}

// ─── File-local fixtures (mirror the sibling-suite helpers) ──────────────

/** The actors of one booking flow: the acting applicant and one evaluator. */
interface BookingActors {
  readonly applicantUserId: number;
  readonly evaluatorUserId: number;
}

/** One users-table governance flag flip (the FORBIDDEN denial matrix shapes). */
interface GovernanceOverride {
  readonly isDeleted?: boolean;
  readonly isBlocked?: boolean;
  readonly suspended?: boolean;
}

/**
 * A full evaluation-loop applicant: a governance-clean user with an
 * `applicants` row in the evaluation stage plus an ACTIVE subscription on
 * the pinned verification plan, backdated one minute so every fixture
 * session created "now" falls inside the cycle window (the half-open
 * `created_at >= cycleStart` boundary).
 */
async function createVerificationApplicant(
  tx: DBTransaction,
  overrides: Partial<ApplicantSelectType> = {}
): Promise<{ applicantUserId: number; cycleStart: Date }> {
  const user = await createTestUser(tx, { role: "teacher" });
  await createTestApplicant(tx, user.id, { status: ApplicantStatus.InEvaluation, ...overrides });
  const plan = await createTestPlan(tx, { title: VERIFICATION_PLAN_TITLE });
  const subscription = await createTestSubscription(tx, user.id, plan.id, {
    startDate: new Date(Date.now() - 60_000),
  });
  const cycleStart = subscription.startDate;
  if (!cycleStart) {
    throw new Error("createVerificationApplicant: subscription has no start date");
  }
  return { applicantUserId: user.id, cycleStart };
}

/** One certified evaluator: a governance-clean user with an approved, evaluator-flagged teacher row. */
async function createCertifiedEvaluator(
  tx: DBTransaction,
  overrides: Partial<TeacherSelectType> = {}
): Promise<number> {
  const user = await createTestUser(tx, { role: "teacher" });
  await createTestTeacherRow(tx, user.id, { isApproved: true, isEvaluator: true, ...overrides });
  return user.id;
}

/** The actor pair of one booking: a verification applicant plus one certified evaluator. */
async function createBookingActors(tx: DBTransaction): Promise<BookingActors> {
  const { applicantUserId } = await createVerificationApplicant(tx);
  const evaluatorUserId = await createCertifiedEvaluator(tx);
  return { applicantUserId, evaluatorUserId };
}

/** A fresh carryable idempotency key (unique per call). */
function freshKey(): string {
  return `evb-${randomUUID()}`;
}

/**
 * Direct evaluation-session insert for test preconditions (full column
 * control — booked states a service booking cannot start from, e.g.
 * completed or cancelled rows). Defaults pin the session type + intent to
 * the evaluation members so the cycle aggregate counts the row.
 */
async function insertCycleSession(
  tx: DBTransaction,
  applicantUserId: number,
  evaluatorUserId: number,
  overrides: Partial<SessionSelectType> = {}
): Promise<SessionSelectType> {
  return createTestSession(tx, evaluatorUserId, applicantUserId, {
    sessionType: SessionType.TeacherEvaluation,
    intent: SessionIntent.Evaluation,
    ...overrides,
  });
}

/** The service's write call, pinned to the test transaction + locale. */
function book(
  tx: DBTransaction,
  applicantUserId: number,
  evaluatorId: number,
  idempotencyKey: string
): Promise<SessionSelectType> {
  return EvaluationBookingService.bookEvaluation(applicantUserId, { evaluatorId }, idempotencyKey, LOCALE, tx);
}

/** Fills a cycle to `count` live bookings with distinct certified evaluators. */
async function fillCycle(
  tx: DBTransaction,
  applicantUserId: number,
  count: number,
  overrides: Partial<SessionSelectType> = {}
): Promise<number[]> {
  // Recursive driver (the sanctioned sequential pattern for steps sharing
  // one DB-transaction connection).
  const fillRest = async (remaining: number): Promise<number[]> => {
    if (remaining <= 0) {
      return [];
    }
    const evaluatorUserId = await createCertifiedEvaluator(tx);
    await insertCycleSession(tx, applicantUserId, evaluatorUserId, overrides);
    return [evaluatorUserId, ...(await fillRest(remaining - 1))];
  };
  return fillRest(count);
}

/** Independent read-back oracle: the full session row (NOT via the service). */
async function readSessionRow(executor: DBTransaction, sessionId: number): Promise<SessionSelectType | null> {
  const [row] = await executor.select().from(session).where(eq(session.id, sessionId));
  return row ?? null;
}

/** Counts the applicant's evaluation-session rows (the row-count oracle). */
async function countEvaluationSessions(executor: DBTransaction, applicantUserId: number): Promise<number> {
  return executor.$count(
    session,
    and(eq(session.studentId, applicantUserId), eq(session.sessionType, SessionType.TeacherEvaluation))
  );
}

/** The notification-engine stub receipt (the dispatch is always mocked in tests). */
const DELIVERY_RECEIPT_STUB: NotificationDeliveryReceipt = { notifications: [], recipientUserIds: [] };

/**
 * Notification-spy box: the post-commit teacher wave is ALWAYS mocked —
 * a real dispatch would escape the rollback transaction (uncommitted
 * session rows) and, on the committed chaos fixtures, would publish real
 * notification rows. The spy still records every call, so the dispatch
 * contract (exactly one call, the created session's id + locale) stays
 * asserted.
 */
const notificationSpyBox: { spy?: ReturnType<typeof installNotificationSpy> } = {};

function installNotificationSpy() {
  return spyOn(SessionRequestNotificationService, "notifyTeacherOfSessionRequest").mockResolvedValue(
    DELIVERY_RECEIPT_STUB
  );
}

function requireNotificationSpy() {
  if (!notificationSpyBox.spy) {
    throw new Error("notification spy not installed (fixture integrity failure)");
  }
  return notificationSpyBox.spy;
}

/** Asserts EXACTLY ONE dispatch fired, for the given session, in the current window. */
function expectSingleDispatch(sessionId: number): void {
  const calls = requireNotificationSpy().mock.calls;
  expect(calls).toHaveLength(1);
  expect(calls[0]?.[0]).toBe(sessionId);
  expect(calls[0]?.[1]).toBe(LOCALE);
}

// ─── Transactional write pipeline (runInRollback) ────────────────────────

describe("EvaluationBookingService — transactional write pipeline (runInRollback)", () => {
  let errorSpy: ReturnType<typeof installErrorSpy> | undefined;

  beforeAll(() => {
    logSpyBox.spy = installLogSpy();
    notificationSpyBox.spy = installNotificationSpy();
    errorSpy = installErrorSpy();
  });

  beforeEach(() => {
    logSpyBox.spy?.mockClear();
    notificationSpyBox.spy?.mockClear();
    errorSpy?.mockClear();
  });

  afterAll(() => {
    logSpyBox.spy?.mockRestore();
    notificationSpyBox.spy?.mockRestore();
    errorSpy?.mockRestore();
  });

  test("happy booking: the stored session is the full server-owned column set, the claim backfills, and the notification dispatches post-commit", async () => {
    await runInRollback(async tx => {
      const actors = await createBookingActors(tx);
      const key = freshKey();
      const before = Date.now();

      const booked = await book(tx, actors.applicantUserId, actors.evaluatorUserId, key);

      // Every client-independent column is server-owned and asserted: the
      // participants, the lifecycle vocabulary, the no-escrow triple
      // (fee/hold/lane), every lifecycle stamp, and the confirmation
      // deadline inside the flow's single captured-instant window.
      const after = Date.now();
      expect(booked.teacherId).toBe(actors.evaluatorUserId);
      expect(booked.studentId).toBe(actors.applicantUserId);
      expect(booked.status).toBe(SessionStatus.Scheduled);
      expect(booked.sessionType).toBe(SessionType.TeacherEvaluation);
      expect(booked.intent).toBe(SessionIntent.Evaluation);
      expect(booked.fee).toBeNull();
      expect(booked.feeHeld).toBe(false);
      expect(booked.heldBalanceLane).toBeNull();
      expect(booked.startedAt).toBeNull();
      expect(booked.endedAt).toBeNull();
      expect(booked.confirmedByStudentAt).toBeNull();
      expect(booked.confirmedByTeacherAt).toBeNull();
      expect(booked.cancelReason).toBeNull();
      expect(booked.disputeReason).toBeNull();
      expect(booked.disputedAt).toBeNull();
      expect(booked.resolutionNote).toBeNull();
      expect(booked.resolutionOutcome).toBeNull();
      expect(booked.resolvedAt).toBeNull();
      const deadline = booked.confirmationDeadline;
      if (!deadline) {
        throw new Error("expected a confirmation deadline");
      }
      expect(deadline.getTime()).toBeGreaterThan(before);
      expect(deadline.getTime()).toBeLessThanOrEqual(after + SESSION_CONFIRMATION_WINDOW_MS);

      // The row is durable inside the caller's transaction and identical on
      // the independent read-back; the claim backfilled to the session.
      const stored = await readSessionRow(tx, booked.id);
      expect(stored).toEqual(booked);
      const claim = await SessionRequestIdempotencyRepository.findByKey(key, tx);
      expect(claim).not.toBeNull();
      if (claim) {
        expect(claim.userId).toBe(actors.applicantUserId);
        expect(claim.sessionId).toBe(booked.id);
      }

      // The post-commit wave dispatched EXACTLY once, for this session; the
      // happy path logs nothing.
      expectSingleDispatch(booked.id);
      expectZeroLogCalls();
    });
  });

  test("denial matrix — VALIDATION: malformed caller ids, malformed evaluator ids, and jumbled idempotency keys are denied BEFORE any database work", async () => {
    await runInRollback(async tx => {
      const actors = await createBookingActors(tx);
      const gateSpy = spyOn(ApplicantRepository, "findForBookingGate");

      // The malformed shapes: a zero and fractional caller id, a zero
      // evaluator id (the ONLY client-owned value), an empty key, and an
      // oversize key. All are pure pre-DB guards.
      const malformedCaller = [
        { caller: 0, evaluator: actors.evaluatorUserId, key: freshKey() },
        { caller: 1.5, evaluator: actors.evaluatorUserId, key: freshKey() },
      ];
      const malformedEvaluator = [{ caller: actors.applicantUserId, evaluator: 0, key: freshKey() }];
      const malformedKey = [
        { caller: actors.applicantUserId, evaluator: actors.evaluatorUserId, key: "" },
        { caller: actors.applicantUserId, evaluator: actors.evaluatorUserId, key: "k".repeat(MAX_KEY_LENGTH + 1) },
      ];

      const expectValidation = async (shape: { caller: number; evaluator: number; key: string }, message: string) => {
        const error = await expectRepoError(() =>
          EvaluationBookingService.bookEvaluation(shape.caller, { evaluatorId: shape.evaluator }, shape.key, LOCALE, tx)
        );
        expect(error).toBeInstanceOf(ValidationError);
        expectDomainDenial(error, "VALIDATION", message);
      };

      await Promise.all(malformedCaller.map(shape => expectValidation(shape, t().validation)));
      await expectValidation(malformedEvaluator[0] ?? { caller: 0, evaluator: 0, key: "" }, t().validation);
      await Promise.all(malformedKey.map(shape => expectValidation(shape, t().idempotencyKeyRequired)));

      // Pre-DB proof: the booking gate never fired and no session row was
      // created; one bounded denial log per attempt.
      expect(gateSpy).toHaveBeenCalledTimes(0);
      gateSpy.mockRestore();
      expect(await countEvaluationSessions(tx, actors.applicantUserId)).toBe(0);
      expect(logCalls()).toHaveLength(malformedCaller.length + malformedKey.length + malformedEvaluator.length);
    });
  });

  test("denial matrix — FORBIDDEN: a governed caller (deleted, blocked, or suspended) cannot book", async () => {
    await runInRollback(async tx => {
      const { applicantUserId } = await createVerificationApplicant(tx);
      const evaluatorUserId = await createCertifiedEvaluator(tx);
      const governedOverrides = [{ isDeleted: true }, { isBlocked: true }, { suspended: true }];

      // The governance re-check reads the users row, so the three governed
      // shapes share the test's transaction and run sequentially (the
      // recursive driver the linting rules mandate for tx-sharing steps).
      const assertGovernedShape = async (remaining: readonly GovernanceOverride[]): Promise<void> => {
        if (remaining.length === 0) {
          return undefined;
        }
        const overrides = remaining[0];
        if (!overrides) {
          return undefined;
        }
        await tx.update(users).set(overrides).where(eq(users.id, applicantUserId));
        const error = await expectRepoError(() => book(tx, applicantUserId, evaluatorUserId, freshKey()));
        expect(error).toBeInstanceOf(ForbiddenError);
        expectDomainDenial(error, "FORBIDDEN", t().forbidden);
        await tx
          .update(users)
          .set({ isDeleted: false, isBlocked: false, suspended: false })
          .where(eq(users.id, applicantUserId));
        return assertGovernedShape(remaining.slice(1));
      };
      await assertGovernedShape(governedOverrides);

      expect(await countEvaluationSessions(tx, applicantUserId)).toBe(0);
      expect(logCalls()).toHaveLength(governedOverrides.length);
      for (const call of logCalls()) {
        if (isRecord(call.ctx)) {
          expect(call.ctx.code).toBe("FORBIDDEN");
        }
      }
    });
  });

  test("denial matrix — APPLICANT_NOT_FOUND: a governance-clean user without an applicants row", async () => {
    await runInRollback(async tx => {
      const plainUser = await createTestUser(tx, { role: "teacher" });
      const evaluatorUserId = await createCertifiedEvaluator(tx);

      const error = await expectRepoError(() => book(tx, plainUser.id, evaluatorUserId, freshKey()));

      expect(error).toBeInstanceOf(NotFoundError);
      expectDomainDenial(error, "APPLICANT_NOT_FOUND", t().applicantNotFound);
      expect(await countEvaluationSessions(tx, plainUser.id)).toBe(0);
      expectSingleBoundedDenialLog("APPLICANT_NOT_FOUND", plainUser.id);
    });
  });

  test("denial matrix — APPLICANT_NOT_IN_EVALUATION: a non-evaluation applicant stage is the typed conflict", async () => {
    await runInRollback(async tx => {
      const { applicantUserId } = await createVerificationApplicant(tx, { status: ApplicantStatus.Pending });
      const evaluatorUserId = await createCertifiedEvaluator(tx);

      const error = await expectRepoError(() => book(tx, applicantUserId, evaluatorUserId, freshKey()));

      expect(error).toBeInstanceOf(ConflictError);
      expectDomainDenial(error, "APPLICANT_NOT_IN_EVALUATION", t().applicantNotInEvaluation);
      expect(await countEvaluationSessions(tx, applicantUserId)).toBe(0);
      expectSingleBoundedDenialLog("APPLICANT_NOT_IN_EVALUATION", applicantUserId);
    });
  });

  test("denial matrix — VERIFICATION_NOT_ACTIVE: an InEvaluation applicant without an active verification subscription", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      await createTestApplicant(tx, user.id, { status: ApplicantStatus.InEvaluation });
      const evaluatorUserId = await createCertifiedEvaluator(tx);

      // Even a live subscription on a REGULAR plan does not open the cycle —
      // the pinned verification title is the cycle's identity.
      const regularPlan = await createTestPlan(tx);
      await createTestSubscription(tx, user.id, regularPlan.id);

      const error = await expectRepoError(() => book(tx, user.id, evaluatorUserId, freshKey()));

      expect(error).toBeInstanceOf(ConflictError);
      expectDomainDenial(error, "VERIFICATION_NOT_ACTIVE", t().verificationSubscriptionNotActive);
      expect(await countEvaluationSessions(tx, user.id)).toBe(0);
      expectSingleBoundedDenialLog("VERIFICATION_NOT_ACTIVE", user.id);
    });
  });

  test("capacity boundary — booked 4/5: the last free slot books; the 6th attempt is the zero-trap denial", async () => {
    await runInRollback(async tx => {
      const { applicantUserId } = await createVerificationApplicant(tx);
      const used = await fillCycle(tx, applicantUserId, VERIFICATION_PLAN_SESSION_COUNT - 1);
      const lastEvaluator = await createCertifiedEvaluator(tx);

      // The 5th booking consumes the final credit...
      const fifth = await book(tx, applicantUserId, lastEvaluator, freshKey());
      expect(fifth.teacherId).toBe(lastEvaluator);
      const status = await EvaluationBookingService.myEvaluationLoopStatus(applicantUserId, LOCALE, tx);
      expect(status.bookedCount).toBe(VERIFICATION_PLAN_SESSION_COUNT);
      expect(status.remainingCredits).toBe(0);

      // ...and the 6th is denied with the credits-exhausted code (all five
      // live, none completed — the zero-trap selection).
      const sixthEvaluator = await createCertifiedEvaluator(tx);
      const error = await expectRepoError(() => book(tx, applicantUserId, sixthEvaluator, freshKey()));
      expect(error).toBeInstanceOf(ConflictError);
      expectDomainDenial(error, "NO_EVALUATION_CREDITS_REMAINING", t().noEvaluationCreditsRemaining);
      expect(await countEvaluationSessions(tx, applicantUserId)).toBe(VERIFICATION_PLAN_SESSION_COUNT);
      expectSingleBoundedDenialLog("NO_EVALUATION_CREDITS_REMAINING", applicantUserId);
      expect(used).toHaveLength(VERIFICATION_PLAN_SESSION_COUNT - 1);
    });
  });

  test("capacity — a full COMPLETED cycle is the congratulatory loop-complete denial", async () => {
    await runInRollback(async tx => {
      const { applicantUserId } = await createVerificationApplicant(tx);
      const now = new Date();
      await fillCycle(tx, applicantUserId, VERIFICATION_PLAN_SESSION_COUNT, {
        status: SessionStatus.Completed,
        startedAt: now,
        endedAt: now,
      });
      const freshEvaluator = await createCertifiedEvaluator(tx);

      const error = await expectRepoError(() => book(tx, applicantUserId, freshEvaluator, freshKey()));

      expect(error).toBeInstanceOf(ConflictError);
      expectDomainDenial(error, "EVALUATION_LOOP_COMPLETE", t().evaluationLoopComplete);
      expect(await countEvaluationSessions(tx, applicantUserId)).toBe(VERIFICATION_PLAN_SESSION_COUNT);
      expectSingleBoundedDenialLog("EVALUATION_LOOP_COMPLETE", applicantUserId);
    });
  });

  test("gate order — a FULL cycle denies before distinctness ever fires (capacity precedes the used-evaluator set)", async () => {
    await runInRollback(async tx => {
      const { applicantUserId } = await createVerificationApplicant(tx);
      const used = await fillCycle(tx, applicantUserId, VERIFICATION_PLAN_SESSION_COUNT);

      // The target evaluator is ALREADY used AND the cycle is full: the
      // fixed order must surface the capacity denial, not distinctness.
      const alreadyUsed = used.at(0);
      if (alreadyUsed === undefined) {
        throw new Error("fillCycle: no evaluators were created");
      }
      const error = await expectRepoError(() => book(tx, applicantUserId, alreadyUsed, freshKey()));
      expect(error).toBeInstanceOf(ConflictError);
      expectDomainDenial(error, "NO_EVALUATION_CREDITS_REMAINING", t().noEvaluationCreditsRemaining);
    });
  });

  test("distinctness — the same evaluator cannot be booked twice in one cycle", async () => {
    await runInRollback(async tx => {
      const { applicantUserId } = await createVerificationApplicant(tx);
      const evaluatorUserId = await createCertifiedEvaluator(tx);
      const first = await book(tx, applicantUserId, evaluatorUserId, freshKey());

      const error = await expectRepoError(() => book(tx, applicantUserId, evaluatorUserId, freshKey()));

      expect(error).toBeInstanceOf(ConflictError);
      expectDomainDenial(error, "EVALUATOR_ALREADY_USED", t().evaluatorAlreadyUsed);
      expect(await countEvaluationSessions(tx, applicantUserId)).toBe(1);
      expectSingleBoundedDenialLog("EVALUATOR_ALREADY_USED", evaluatorUserId);

      // A DIFFERENT evaluator still books — the denial is per-evaluator.
      const otherEvaluator = await createCertifiedEvaluator(tx);
      const second = await book(tx, applicantUserId, otherEvaluator, freshKey());
      expect(second.teacherId).toBe(otherEvaluator);
      expect(first.id).not.toBe(second.id);
    });
  });

  test("cancellation re-opens the evaluator — a cancelled row occupies NEITHER a credit NOR a used-evaluator slot", async () => {
    await runInRollback(async tx => {
      const { applicantUserId } = await createVerificationApplicant(tx);
      const evaluatorUserId = await createCertifiedEvaluator(tx);
      await insertCycleSession(tx, applicantUserId, evaluatorUserId, {
        status: SessionStatus.Cancelled,
        cancelReason: "rescheduled elsewhere",
      });

      // The cancelled evaluator is bookable again...
      const rebooked = await book(tx, applicantUserId, evaluatorUserId, freshKey());
      expect(rebooked.teacherId).toBe(evaluatorUserId);
      expect(rebooked.status).toBe(SessionStatus.Scheduled);

      // ...and the cancelled row did NOT consume a credit: the loop status
      // counts exactly the live booking.
      const status = await EvaluationBookingService.myEvaluationLoopStatus(applicantUserId, LOCALE, tx);
      expect(status.bookedCount).toBe(1);
      expect(status.remainingCredits).toBe(VERIFICATION_PLAN_SESSION_COUNT - 1);
      expectZeroLogCalls();
    });
  });

  test("denial matrix — TEACHER_NOT_FOUND: a teacherless evaluator id, and the self-booking oracle collapse", async () => {
    await runInRollback(async tx => {
      const { applicantUserId } = await createVerificationApplicant(tx);

      // The self-booking attempt (own id as the evaluator) and a far-unknown
      // id are the SAME denial — byte-identical fingerprints (the teacherless
      // own-id never mints certification, and no oracle reveals whether the
      // id is the caller's).
      const selfError = await expectRepoError(() => book(tx, applicantUserId, applicantUserId, freshKey()));
      const unknownError = await expectRepoError(() => book(tx, applicantUserId, UNKNOWN_EVALUATOR_ID, freshKey()));
      expect(selfError).toBeInstanceOf(NotFoundError);
      expect(unknownError).toBeInstanceOf(NotFoundError);
      expect(denialShape(selfError)).toEqual(denialShape(unknownError));
      expectDomainDenial(selfError, "TEACHER_NOT_FOUND", t().teacherNotFound);
      expect(await countEvaluationSessions(tx, applicantUserId)).toBe(0);
    });
  });

  test("denial matrix — TEACHER_NOT_FOUND (governance): a certified evaluator whose account is deleted, blocked, or suspended is the same not-found denial as an unknown id", async () => {
    await runInRollback(async tx => {
      const { applicantUserId } = await createVerificationApplicant(tx);
      const governedOverrides: readonly GovernanceOverride[] = [
        { isDeleted: true },
        { isBlocked: true },
        { suspended: true },
      ];

      // The governance leg rides the SAME locked read as the certification
      // flags, so the three governed shapes share the test's transaction
      // and run sequentially (the recursive driver).
      const governedIds: number[] = [];
      const governedShapes: DenialShape[] = [];
      const claimKeys: string[] = [];
      const assertGovernedEvaluator = async (remaining: readonly GovernanceOverride[]): Promise<void> => {
        if (remaining.length === 0) {
          return undefined;
        }
        const overrides = remaining[0];
        if (!overrides) {
          return undefined;
        }
        const governedEvaluator = await createCertifiedEvaluator(tx);
        governedIds.push(governedEvaluator);
        await tx.update(users).set(overrides).where(eq(users.id, governedEvaluator));
        const key = freshKey();
        claimKeys.push(key);
        const error = await expectRepoError(() => book(tx, applicantUserId, governedEvaluator, key));
        expect(error).toBeInstanceOf(NotFoundError);
        expectDomainDenial(error, "TEACHER_NOT_FOUND", t().teacherNotFound);
        governedShapes.push(denialShape(error));
        return assertGovernedEvaluator(remaining.slice(1));
      };
      await assertGovernedEvaluator(governedOverrides);

      // Oracle collapse: every governed-but-certified evaluator is
      // byte-identical to a far-unknown evaluator id (the picker already
      // hides governed accounts, so "not found" is the honest answer).
      const unknownError = await expectRepoError(() => book(tx, applicantUserId, UNKNOWN_EVALUATOR_ID, freshKey()));
      const unknownShape = denialShape(unknownError);
      expect(governedShapes).toHaveLength(governedOverrides.length);
      for (const shape of governedShapes) {
        expect(shape).toEqual(unknownShape);
      }
      expect(await countEvaluationSessions(tx, applicantUserId)).toBe(0);

      // No credit consumed, no notification dispatched, no spent claim —
      // each denial rolled the whole booking back before the claim.
      const status = await EvaluationBookingService.myEvaluationLoopStatus(applicantUserId, LOCALE, tx);
      expect(status.bookedCount).toBe(0);
      expect(status.remainingCredits).toBe(VERIFICATION_PLAN_SESSION_COUNT);
      expect(requireNotificationSpy().mock.calls).toHaveLength(0);
      const spentClaims = await Promise.all(
        claimKeys.map(key => SessionRequestIdempotencyRepository.findByKey(key, tx))
      );
      for (const spentClaim of spentClaims) {
        expect(spentClaim).toBeNull();
      }

      // Exactly one bounded denial log per governed shape plus the
      // unknown-id probe, each keyed to the client-submitted evaluator id.
      const calls = logCalls();
      expect(calls).toHaveLength(governedOverrides.length + 1);
      for (const call of calls) {
        if (isRecord(call.ctx)) {
          const deniedEntityIds = [UNKNOWN_EVALUATOR_ID, ...governedIds].map(String);
          expect(call.ctx.code).toBe("TEACHER_NOT_FOUND");
          expect(deniedEntityIds.includes(String(call.ctx.entityId))).toBe(true);
          expectBoundedContextKeys(call.ctx);
        }
      }
    });
  });

  test("denial matrix — TEACHER_NOT_CERTIFIED: an unapproved flag and an unflagged evaluator are the same typed conflict", async () => {
    await runInRollback(async tx => {
      const { applicantUserId } = await createVerificationApplicant(tx);
      const notApproved = await createCertifiedEvaluator(tx, { isApproved: false });
      const notEvaluator = await createCertifiedEvaluator(tx, { isEvaluator: false });

      const approvedError = await expectRepoError(() => book(tx, applicantUserId, notApproved, freshKey()));
      const evaluatorError = await expectRepoError(() => book(tx, applicantUserId, notEvaluator, freshKey()));

      expect(approvedError).toBeInstanceOf(ConflictError);
      expect(evaluatorError).toBeInstanceOf(ConflictError);
      expect(denialShape(approvedError)).toEqual(denialShape(evaluatorError));
      expectDomainDenial(approvedError, "TEACHER_NOT_CERTIFIED", t().teacherNotCertified);
      expect(await countEvaluationSessions(tx, applicantUserId)).toBe(0);
    });
  });

  test("replay — the same caller, same key, retries FREE OF CHARGE: the typed duplicate-request conflict, exactly one stored row", async () => {
    await runInRollback(async tx => {
      const { applicantUserId } = await createVerificationApplicant(tx);
      const evaluatorUserId = await createCertifiedEvaluator(tx);
      const key = freshKey();
      const first = await book(tx, applicantUserId, evaluatorUserId, key);

      // The retry replays the SPENT KEY against a different evaluator — it
      // passes every entitlement gate, reaches the claim, and the 23505
      // resolves to the same-caller duplicate-request conflict.
      const secondEvaluator = await createCertifiedEvaluator(tx);
      const replayError = await expectRepoError(() => book(tx, applicantUserId, secondEvaluator, key));

      expect(replayError).toBeInstanceOf(ConflictError);
      expectDomainDenial(replayError, "DUPLICATE_REQUEST", t().duplicateRequest);
      expect(await countEvaluationSessions(tx, applicantUserId)).toBe(1);
      expectSingleBoundedDenialLog("DUPLICATE_REQUEST", applicantUserId);
      expect(first.id).toBeGreaterThan(0);
    });
  });

  test("replay — a vanished claim (inserted, never backfilled) is fail-closed: the duplicate-request conflict, no session created", async () => {
    await runInRollback(async tx => {
      const { applicantUserId } = await createVerificationApplicant(tx);
      const evaluatorUserId = await createCertifiedEvaluator(tx);
      const key = freshKey();
      await SessionRequestIdempotencyRepository.insertClaim({ idempotencyKey: key, userId: applicantUserId }, tx);

      const replayError = await expectRepoError(() => book(tx, applicantUserId, evaluatorUserId, key));

      expect(replayError).toBeInstanceOf(ConflictError);
      expectDomainDenial(replayError, "DUPLICATE_REQUEST", t().duplicateRequest);
      expect(await countEvaluationSessions(tx, applicantUserId)).toBe(0);
      expectSingleBoundedDenialLog("DUPLICATE_REQUEST", applicantUserId);
    });
  });

  test("replay — a FOREIGN key owner is denied oracle-safely (SESSION_NOT_FOUND, never a duplicate surface), and the caller is unharmed", async () => {
    await runInRollback(async tx => {
      const { applicantUserId } = await createVerificationApplicant(tx);
      const evaluatorUserId = await createCertifiedEvaluator(tx);
      const key = freshKey();
      await book(tx, applicantUserId, evaluatorUserId, key);

      // A second applicant reuses the spent key: another user's claim is
      // never surfaced as a duplicate of THEIR request.
      const second = await createVerificationApplicant(tx);
      const foreignError = await expectRepoError(() => book(tx, second.applicantUserId, evaluatorUserId, key));
      expect(foreignError).toBeInstanceOf(NotFoundError);
      expectDomainDenial(foreignError, "SESSION_NOT_FOUND", t().sessionNotFound);
      expectSingleBoundedDenialLog("SESSION_NOT_FOUND", second.applicantUserId);

      // The denial left no residue: the second applicant books fine with
      // their own key, and the first applicant's row is untouched.
      const own = await book(tx, second.applicantUserId, evaluatorUserId, freshKey());
      expect(own.studentId).toBe(second.applicantUserId);
      expect(await countEvaluationSessions(tx, applicantUserId)).toBe(1);
    });
  });

  test("post-commit notification — a dispatch failure is logged and NEVER rethrown (the booking is already durable)", async () => {
    await runInRollback(async tx => {
      const actors = await createBookingActors(tx);
      const key = freshKey();
      requireNotificationSpy().mockRejectedValueOnce(new Error("notification channel down"));

      const booked = await book(tx, actors.applicantUserId, actors.evaluatorUserId, key);

      expectSingleDispatch(booked.id);
      expect((await readSessionRow(tx, booked.id))?.status).toBe(SessionStatus.Scheduled);
      expect(errorSpy?.mock.calls).toHaveLength(1);
      expectZeroLogCalls();
    });
  });

  test("outer-transaction propagation: a denial rolls back only its SAVEPOINT and the caller's transaction stays usable", async () => {
    await runInRollback(async tx => {
      const { applicantUserId } = await createVerificationApplicant(tx);
      const evaluatorUserId = await createCertifiedEvaluator(tx);
      const key = freshKey();
      const first = await book(tx, applicantUserId, evaluatorUserId, key);

      // The duplicate-key denial fails INSIDE its savepoint: the retry
      // replays the spent key against a different evaluator, the savepoint
      // rolls back, the typed conflict propagates, and the caller's
      // transaction is left fully usable.
      const retryEvaluator = await createCertifiedEvaluator(tx);
      const duplicateError = await expectRepoError(() => book(tx, applicantUserId, retryEvaluator, key));
      expectDomainDenial(duplicateError, "DUPLICATE_REQUEST", t().duplicateRequest);
      expect(await countEvaluationSessions(tx, applicantUserId)).toBe(1);

      // The same outer transaction still accepts further work.
      const followUp = await book(tx, applicantUserId, retryEvaluator, freshKey());
      expect(followUp.teacherId).toBe(retryEvaluator);
      expect(await countEvaluationSessions(tx, applicantUserId)).toBe(2);
      expect((await readSessionRow(tx, first.id))?.status).toBe(SessionStatus.Scheduled);
    });
  });
});

// ─── Reads (runInRollback) ───────────────────────────────────────────────

describe("EvaluationBookingService — reads (runInRollback)", () => {
  beforeAll(() => {
    logSpyBox.spy = installLogSpy();
    notificationSpyBox.spy = installNotificationSpy();
  });

  beforeEach(() => {
    logSpyBox.spy?.mockClear();
    notificationSpyBox.spy?.mockClear();
  });

  afterAll(() => {
    logSpyBox.spy?.mockRestore();
    notificationSpyBox.spy?.mockRestore();
  });

  test("loop status — the CURRENT cycle's booked/completed/remaining blob, keyed on the cycle start date", async () => {
    await runInRollback(async tx => {
      const { applicantUserId, cycleStart } = await createVerificationApplicant(tx);
      const now = new Date();
      const evaluatorA = await createCertifiedEvaluator(tx);
      await insertCycleSession(tx, applicantUserId, evaluatorA, {
        status: SessionStatus.Completed,
        startedAt: now,
        endedAt: now,
      });
      const evaluatorB = await createCertifiedEvaluator(tx);
      await insertCycleSession(tx, applicantUserId, evaluatorB);
      await insertCycleSession(tx, applicantUserId, evaluatorB, {
        status: SessionStatus.Cancelled,
      });

      const status = await EvaluationBookingService.myEvaluationLoopStatus(applicantUserId, LOCALE, tx);

      expect(status.bookedCount).toBe(2);
      expect(status.completedCount).toBe(1);
      expect(status.remainingCredits).toBe(VERIFICATION_PLAN_SESSION_COUNT - 2);
      const cycleStartDate = status.cycleStartDate;
      if (!cycleStartDate) {
        throw new Error("expected a resolved cycle start date");
      }
      expect(cycleStartDate.getTime()).toBe(cycleStart.getTime());
      expectZeroLogCalls();
    });
  });

  test("loop status — an over-ceiling cycle CLAMPS the credit remainder at zero (never a negative wire answer)", async () => {
    await runInRollback(async tx => {
      const { applicantUserId } = await createVerificationApplicant(tx);
      const now = new Date();
      // Six in-cycle COMPLETED sessions — one past the plan's five-session
      // ceiling (the shape a QA cast / admin seed / migration can produce
      // outside the booking flow's capacity gate).
      await fillCycle(tx, applicantUserId, 6, {
        status: SessionStatus.Completed,
        startedAt: now,
        endedAt: now,
      });

      const status = await EvaluationBookingService.myEvaluationLoopStatus(applicantUserId, LOCALE, tx);

      // The over-ceiling bookings stay honestly reported, but the credit
      // remainder floors at zero — the client's derived progress
      // denominator (booked + remaining) then yields a 0..100 bar.
      expect(status.bookedCount).toBe(6);
      expect(status.completedCount).toBe(6);
      expect(status.remainingCredits).toBe(0);
      expectZeroLogCalls();
    });
  });

  test("loop status — the fixed zero-shape (never an error) for a caller with NO applicants row and for a caller with NO active cycle", async () => {
    await runInRollback(async tx => {
      const zeroShape = { bookedCount: 0, completedCount: 0, remainingCredits: 0, cycleStartDate: null };

      // No applicants row at all.
      const plainUser = await createTestUser(tx, { role: "teacher" });
      expect(await EvaluationBookingService.myEvaluationLoopStatus(plainUser.id, LOCALE, tx)).toEqual(zeroShape);

      // An applicants row without an active verification subscription.
      const applicantUser = await createTestUser(tx, { role: "teacher" });
      await createTestApplicant(tx, applicantUser.id, { status: ApplicantStatus.InEvaluation });
      expect(await EvaluationBookingService.myEvaluationLoopStatus(applicantUser.id, LOCALE, tx)).toEqual(zeroShape);

      // No read leaks whether an account is an applicant at all: the two
      // zero-shapes are identical and zero domain logs fired.
      expectZeroLogCalls();
    });
  });

  test("loop status — prior-cycle rows create history, not entitlements (the cycleStart boundary)", async () => {
    await runInRollback(async tx => {
      const { applicantUserId, cycleStart } = await createVerificationApplicant(tx);
      const priorEvaluator = await createCertifiedEvaluator(tx);
      await insertCycleSession(tx, applicantUserId, priorEvaluator, {
        createdAt: new Date(cycleStart.getTime() - 60_000),
      });

      // The prior-cycle row is invisible to the CURRENT cycle's blob...
      const before = await EvaluationBookingService.myEvaluationLoopStatus(applicantUserId, LOCALE, tx);
      expect(before.bookedCount).toBe(0);
      expect(before.remainingCredits).toBe(VERIFICATION_PLAN_SESSION_COUNT);

      // ...and does not gate a fresh booking inside the new cycle.
      const currentEvaluator = await createCertifiedEvaluator(tx);
      const booked = await book(tx, applicantUserId, currentEvaluator, freshKey());
      const after = await EvaluationBookingService.myEvaluationLoopStatus(applicantUserId, LOCALE, tx);
      expect(after.bookedCount).toBe(1);
      expect(after.completedCount).toBe(0);
      expect(booked.teacherId).toBe(currentEvaluator);
      expectZeroLogCalls();
    });
  });

  test("loop status — a malformed caller id is denied VALIDATION before any database read", async () => {
    await runInRollback(async tx => {
      const error = await expectRepoError(() => EvaluationBookingService.myEvaluationLoopStatus(0, LOCALE, tx));
      expect(error).toBeInstanceOf(ValidationError);
      expectDomainDenial(error, "VALIDATION", t().validation);
      expectSingleBoundedDenialLog("VALIDATION", 0);
    });
  });

  test("evaluator picker — the PII-free options exclude used evaluators and the total subtracts the still-certified used set", async () => {
    await runInRollback(async tx => {
      // The seed catalog may already carry certified evaluators, so the
      // total is asserted RELATIVE to the probe's own baseline.
      const baseline = await TeacherRepository.listDirectory({ isApproved: true, isEvaluator: true }, 1, 0, tx);
      const { applicantUserId } = await createVerificationApplicant(tx);
      const usedEvaluator = await createCertifiedEvaluator(tx);
      await insertCycleSession(tx, applicantUserId, usedEvaluator);
      const freshEvaluator = await createCertifiedEvaluator(tx, { isOnline: true });

      const page = await EvaluationBookingService.availableEvaluators(applicantUserId, 1, 100, LOCALE, tx);

      // The fresh certified evaluator is offered, PII-free; the used one
      // is gone from the options AND from the total.
      const ids = page.items.map(item => item.id);
      expect(ids).toContain(freshEvaluator);
      expect(ids).not.toContain(usedEvaluator);
      for (const item of page.items) {
        expect(Object.keys(item).toSorted((a, b) => a.localeCompare(b))).toEqual([
          "averageRating",
          "fullName",
          "id",
          "isOnline",
          "subjects",
        ]);
      }
      expect(page.totalCount).toBe(baseline.total + 1);
      expect(page.page).toBe(1);
      expect(page.pageSize).toBe(100);
      expectZeroLogCalls();
    });
  });

  test("evaluator picker — governance-unclean evaluators drop out of the options (the documented total keeps them)", async () => {
    await runInRollback(async tx => {
      const baseline = await TeacherRepository.listDirectory({ isApproved: true, isEvaluator: true }, 1, 0, tx);
      const { applicantUserId } = await createVerificationApplicant(tx);
      const blockedEvaluator = await createCertifiedEvaluator(tx);
      await tx.update(users).set({ isBlocked: true }).where(eq(users.id, blockedEvaluator));

      const page = await EvaluationBookingService.availableEvaluators(applicantUserId, 1, 100, LOCALE, tx);

      // The blocked account never surfaces as an option; the probe total
      // still counts it (the documented repo-probe limitation).
      expect(page.items.map(item => item.id)).not.toContain(blockedEvaluator);
      expect(page.totalCount).toBe(baseline.total + 1);
    });
  });

  test("evaluator picker — malformed page bounds normalize honestly (page < 1 → 1, size outside 1..100 → 25)", async () => {
    await runInRollback(async tx => {
      const { applicantUserId } = await createVerificationApplicant(tx);
      await createCertifiedEvaluator(tx);

      const normalized = await EvaluationBookingService.availableEvaluators(applicantUserId, 0, 5_000, LOCALE, tx);
      expect(normalized.page).toBe(1);
      expect(normalized.pageSize).toBe(25);

      const fractioned = await EvaluationBookingService.availableEvaluators(applicantUserId, 1.5, 0, LOCALE, tx);
      expect(fractioned.page).toBe(1);
      expect(fractioned.pageSize).toBe(25);
    });
  });

  test("evaluator picker — a booking surface without an active cycle denies oracle-safely (never an evaluator identity)", async () => {
    await runInRollback(async tx => {
      // No applicants row at all...
      const plainUser = await createTestUser(tx, { role: "teacher" });
      const noApplicantError = await expectRepoError(() =>
        EvaluationBookingService.availableEvaluators(plainUser.id, 1, 25, LOCALE, tx)
      );
      expect(noApplicantError).toBeInstanceOf(ConflictError);
      expectDomainDenial(noApplicantError, "VERIFICATION_NOT_ACTIVE", t().verificationSubscriptionNotActive);

      // ...and an InEvaluation applicant with no active cycle: the SAME
      // denial (no read reveals whether an account is an applicant).
      const applicantUser = await createTestUser(tx, { role: "teacher" });
      await createTestApplicant(tx, applicantUser.id, { status: ApplicantStatus.InEvaluation });
      const noCycleError = await expectRepoError(() =>
        EvaluationBookingService.availableEvaluators(applicantUser.id, 1, 25, LOCALE, tx)
      );
      expect(noCycleError).toBeInstanceOf(ConflictError);
      expect(denialShape(noCycleError)).toEqual(denialShape(noApplicantError));
      expect(logCalls()).toHaveLength(2);
    });
  });

  test("evaluator picker — a malformed caller id is denied VALIDATION before any database read", async () => {
    await runInRollback(async tx => {
      const error = await expectRepoError(() => EvaluationBookingService.availableEvaluators(-7, 1, 25, LOCALE, tx));
      expect(error).toBeInstanceOf(ValidationError);
      expectDomainDenial(error, "VALIDATION", t().validation);
      expectSingleBoundedDenialLog("VALIDATION", -7);
    });
  });

  test("session list — caller-keyed, evaluation-member-pinned, newest first, with honest pagination", async () => {
    await runInRollback(async tx => {
      const { applicantUserId } = await createVerificationApplicant(tx);
      const evaluatorA = await createCertifiedEvaluator(tx);
      const evaluatorB = await createCertifiedEvaluator(tx);
      const older = await insertCycleSession(tx, applicantUserId, evaluatorA, {
        createdAt: new Date(Date.now() - 120_000),
      });
      const newer = await insertCycleSession(tx, applicantUserId, evaluatorB, {
        status: SessionStatus.Completed,
        startedAt: new Date(),
        endedAt: new Date(),
      });

      // A regular student session with the same student is invisible — the
      // read is pinned to the teacher-evaluation member.
      await createTestSession(tx, evaluatorA, applicantUserId);

      const page = await EvaluationBookingService.myEvaluationSessions(
        applicantUserId,
        { status: null },
        1,
        25,
        LOCALE,
        tx
      );
      expect(page.totalCount).toBe(2);
      expect(page.items.map(item => item.id)).toEqual([newer.id, older.id]);

      // The lifecycle filter narrows honestly; malformed bounds normalize.
      const completedOnly = await EvaluationBookingService.myEvaluationSessions(
        applicantUserId,
        { status: SessionStatus.Completed },
        0,
        5_000,
        LOCALE,
        tx
      );
      expect(completedOnly.totalCount).toBe(1);
      expect(completedOnly.items.map(item => item.id)).toEqual([newer.id]);
      expect(completedOnly.page).toBe(1);
      expect(completedOnly.pageSize).toBe(25);
      expectZeroLogCalls();
    });
  });

  test("session list — a NON-PARTICIPANT caller gets the empty page by construction (never an error, never another user's rows)", async () => {
    await runInRollback(async tx => {
      const { applicantUserId } = await createVerificationApplicant(tx);
      const evaluatorUserId = await createCertifiedEvaluator(tx);
      await insertCycleSession(tx, applicantUserId, evaluatorUserId);

      // A caller with NO evaluation sessions at all — the caller-keyed
      // predicate matches nothing (empty page, no error).
      const outsider = await createTestUser(tx, { role: "student" });
      const empty = await EvaluationBookingService.myEvaluationSessions(
        outsider.id,
        { status: null },
        1,
        25,
        LOCALE,
        tx
      );
      expect(empty.items).toEqual([]);
      expect(empty.totalCount).toBe(0);
      expectZeroLogCalls();
    });
  });

  test("session list — a malformed caller id is denied VALIDATION before any database read", async () => {
    await runInRollback(async tx => {
      const error = await expectRepoError(() =>
        EvaluationBookingService.myEvaluationSessions(0.5, { status: null }, 1, 25, LOCALE, tx)
      );
      expect(error).toBeInstanceOf(ValidationError);
      expectDomainDenial(error, "VALIDATION", t().validation);
      expectSingleBoundedDenialLog("VALIDATION", 0.5);
    });
  });
});

// ─── Production-path races (committed fixtures, real row-lock serialization) ──

/**
 * Asserts one `Promise.allSettled` loser REJECTED with the exact typed
 * domain denial (a type-guard read of the `reason` — no unsafe assertion).
 */
function expectSettledDenial(entry: PromiseSettledResult<unknown> | undefined, code: string, message: string): void {
  expect(entry?.status).toBe("rejected");
  if (entry?.status !== "rejected" || !(entry.reason instanceof DomainError)) {
    throw new Error("expected a rejected PromiseSettledResult carrying a DomainError");
  }
  expectDomainDenial(entry.reason, code, message);
}

/** Committed live evaluation bookings (fixture preconditions for the races). */
async function insertCommittedCycleSession(applicantUserId: number, evaluatorUserId: number): Promise<void> {
  await db.transaction(async tx => {
    await createTestSession(tx, evaluatorUserId, applicantUserId, {
      sessionType: SessionType.TeacherEvaluation,
      intent: SessionIntent.Evaluation,
    });
  });
}

/** The production-path write call (own top-level transaction, NO outerTx). */
function bookProduction(applicantUserId: number, evaluatorId: number, key: string) {
  return EvaluationBookingService.bookEvaluation(applicantUserId, { evaluatorId }, key, LOCALE);
}

describe("EvaluationBookingService — production-path races (committed fixtures)", () => {
  /** Every committed fixture user id, swept in afterAll (FK-safe order). */
  const committedUserIds: number[] = [];

  beforeAll(() => {
    logSpyBox.spy = installLogSpy();
    notificationSpyBox.spy = installNotificationSpy();
  });

  beforeEach(() => {
    logSpyBox.spy?.mockClear();
    notificationSpyBox.spy?.mockClear();
  });

  afterAll(async () => {
    logSpyBox.spy?.mockRestore();
    notificationSpyBox.spy?.mockRestore();

    // FK-safe hard delete: claims → sessions → the role-child rows → the
    // shared-PK users (the ids list drives every sweep; empty is a no-op).
    if (committedUserIds.length > 0) {
      await db.delete(sessionRequestIdempotency).where(inArray(sessionRequestIdempotency.userId, committedUserIds));
      await db.delete(session).where(inArray(session.studentId, committedUserIds));
      await db.delete(applicants).where(inArray(applicants.id, committedUserIds));
      await db.delete(subscriptions).where(inArray(subscriptions.userId, committedUserIds));
      await db.delete(teacher).where(inArray(teacher.id, committedUserIds));
      await db.delete(users).where(inArray(users.id, committedUserIds));
      expect(await db.$count(session, inArray(session.studentId, committedUserIds))).toBe(0);
      expect(
        await db.$count(sessionRequestIdempotency, inArray(sessionRequestIdempotency.userId, committedUserIds))
      ).toBe(0);
    }
    // Only a canonical plan row THIS suite created is deleted — the
    // seeded catalog member is never touched. Plan titles carry no
    // uniqueness constraint and the purchase flow rejects an ambiguous
    // catalog (two active rows sharing the title), so a leaked fixture
    // plan would flip every verification purchase into a conflict.
    if (suiteOwnsCommittedPlan) {
      await db.delete(plans).where(eq(plans.id, committedPlanId));
      expect(await db.$count(plans, eq(plans.id, committedPlanId))).toBe(0);
    }
  });

  /**
   * The canonical verification plan row for committed fixtures — resolved
   * ONCE from the catalog (any active row with the canonical title) and
   * shared by every committed applicant; a row is created only when the
   * catalog lacks one, and only that self-created row is registered for
   * teardown (the seeded member is reused, never deleted).
   */
  let committedPlanId = 0;
  let suiteOwnsCommittedPlan = false;

  async function resolveCommittedPlanId(): Promise<number> {
    if (committedPlanId > 0) {
      return committedPlanId;
    }
    const [existing] = await db
      .select({ id: plans.id })
      .from(plans)
      .where(and(eq(plans.title, VERIFICATION_PLAN_TITLE), eq(plans.isActive, true)));
    if (existing) {
      committedPlanId = existing.id;
      return committedPlanId;
    }
    const created = await db.transaction(async tx => {
      const plan = await createTestPlan(tx, { title: VERIFICATION_PLAN_TITLE });
      return plan.id;
    });
    committedPlanId = created;
    suiteOwnsCommittedPlan = true;
    return created;
  }

  /** Committed verification applicant on a SEPARATE connection (production path). */
  async function createCommittedApplicant(): Promise<number> {
    const planId = await resolveCommittedPlanId();
    const applicantUserId = await db.transaction(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      await createTestApplicant(tx, user.id, { status: ApplicantStatus.InEvaluation });
      await createTestSubscription(tx, user.id, planId, { startDate: new Date(Date.now() - 60_000) });
      committedUserIds.push(user.id);
      return user.id;
    });
    return applicantUserId;
  }

  /** Committed certified evaluator on the production connection. */
  async function createCommittedEvaluator(): Promise<number> {
    const evaluatorUserId = await db.transaction(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      await createTestTeacherRow(tx, user.id, { isApproved: true, isEvaluator: true });
      committedUserIds.push(user.id);
      return user.id;
    });
    return evaluatorUserId;
  }

  testOnRealPostgres(
    "final-credit race — two concurrent production bookings for the last free slot: exactly one wins",
    async () => {
      const applicantUserId = await createCommittedApplicant();
      // Independent committed fixtures on separate connections — parallel.
      await Promise.all(
        Array.from({ length: VERIFICATION_PLAN_SESSION_COUNT - 1 }, async () => {
          const evaluatorUserId = await createCommittedEvaluator();
          await insertCommittedCycleSession(applicantUserId, evaluatorUserId);
        })
      );
      const racerA = await createCommittedEvaluator();
      const racerB = await createCommittedEvaluator();

      const settled = await Promise.allSettled([
        bookProduction(applicantUserId, racerA, freshKey()),
        bookProduction(applicantUserId, racerB, freshKey()),
      ]);

      const winners = settled.filter(entry => entry.status === "fulfilled");
      const losers = settled.filter(entry => entry.status === "rejected");
      expect(winners).toHaveLength(1);
      expect(losers).toHaveLength(1);
      expectSettledDenial(losers[0], "NO_EVALUATION_CREDITS_REMAINING", t().noEvaluationCreditsRemaining);
      expect(
        await db.$count(
          session,
          and(eq(session.studentId, applicantUserId), eq(session.sessionType, SessionType.TeacherEvaluation))
        )
      ).toBe(VERIFICATION_PLAN_SESSION_COUNT);
    }
  );

  testOnRealPostgres(
    "same-evaluator race — the FOR UPDATE applicant lock serializes the rivals: one booking, one distinctness denial",
    async () => {
      const applicantUserId = await createCommittedApplicant();
      const sharedEvaluator = await createCommittedEvaluator();

      const settled = await Promise.allSettled([
        bookProduction(applicantUserId, sharedEvaluator, freshKey()),
        bookProduction(applicantUserId, sharedEvaluator, freshKey()),
      ]);

      const winners = settled.filter(entry => entry.status === "fulfilled");
      const losers = settled.filter(entry => entry.status === "rejected");
      expect(winners).toHaveLength(1);
      expect(losers).toHaveLength(1);
      expectSettledDenial(losers[0], "EVALUATOR_ALREADY_USED", t().evaluatorAlreadyUsed);
      expect(
        await db.$count(
          session,
          and(eq(session.studentId, applicantUserId), eq(session.sessionType, SessionType.TeacherEvaluation))
        )
      ).toBe(1);
    }
  );

  testOnRealPostgres(
    "same-key 23505 race — the unique claim makes exactly ONE booking; the loser replays as the typed duplicate",
    async () => {
      const applicantUserId = await createCommittedApplicant();
      const evaluatorA = await createCommittedEvaluator();
      const evaluatorB = await createCommittedEvaluator();
      const key = freshKey();

      // Same key, DIFFERENT evaluators: both rivals pass the entitlement
      // gates, so the loser genuinely reaches the claim insert and replays
      // through the 23505 branch.
      const settled = await Promise.allSettled([
        bookProduction(applicantUserId, evaluatorA, key),
        bookProduction(applicantUserId, evaluatorB, key),
      ]);

      const winners = settled.filter(entry => entry.status === "fulfilled");
      const losers = settled.filter(entry => entry.status === "rejected");
      expect(winners).toHaveLength(1);
      expect(losers).toHaveLength(1);
      expectSettledDenial(losers[0], "DUPLICATE_REQUEST", t().duplicateRequest);

      // Exactly one stored row, and the single claim points at it.
      const storedRows = await db.select().from(session).where(eq(session.studentId, applicantUserId));
      expect(storedRows).toHaveLength(1);
      const claim = await SessionRequestIdempotencyRepository.findByKey(key);
      const claimSessionId = claim?.sessionId ?? null;
      expect(claimSessionId).toBe(storedRows[0]?.id ?? null);
    }
  );
});
