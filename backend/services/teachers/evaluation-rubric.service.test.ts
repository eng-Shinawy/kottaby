/**
 * EvaluationRubricService tests — the evaluator-facing surfaces of the
 * five-session loop (the rubric submission write plus its two reads)
 * against the live PostgreSQL test instance on REAL repositories.
 *
 * Per `backend/db/test/AGENTS.md` (the DB-backed service-test rules the
 * sibling suites apply):
 *  - Every transactional case runs inside `runInRollback`; `tx` is handed
 *    to the service as its outer transaction (the flow executes on a
 *    SAVEPOINT of the caller's transaction).
 *  - The chaos block uses COMMITTED fixtures (own top-level transaction per
 *    call, the undefined-outerTx production path) with hard deletes and
 *    residue probes — genuine row-lock serialization on separate
 *    connections, exactly like the sibling chaos blocks.
 *  - Entities are created ONLY via `entity-setup.ts` helpers — never seed
 *    data.
 *  - NO `expect(...).rejects.toThrow()` — every denial goes through
 *    `expectRepoError`; typed denials are asserted through the
 *    `DomainError.code` contract plus the exact translated message.
 *  - Notifications are spied at the engine boundary where a committed row
 *    would leak; inside the rollback pipeline the real in-transaction emit
 *    runs and the persisted row itself is asserted (it rolls back with the
 *    caller's transaction anyway).
 *
 * Coverage map (the four-tier contract):
 *  - Tier 1 (branch/statement): the below-quorum submission (commits alone,
 *    sealed read-model, trimmed observations, evaluated subject always the
 *    session's student), both finalization branches (PASS mints the
 *    certified teacher row + notification; FAIL stamps the guarded cooldown
 *    with no teacher row), every gate (pre-DB input contract, malformed
 *    ids, governance, session ownership/type, completion, in-tx
 *    certification, applicant lock + status, cycle membership, duplicate
 *    pre-check, both demotion-guard arms of the PASS teacher write), and
 *    both read arms (`myRubricPendingSessions` certified/uncertified +
 *    drain + bounds, `myRubricEvaluation` hit/unknown/foreign/corrupt).
 *  - Tier 2 (boundary): five 80s PASS; one 79 among 100s FAILS at mean
 *    95.8 (the per-evaluation minimum, never a mean); the weakness iff-rule
 *    in both directions; the tied-lowest tie-break (first-submitted wins →
 *    the tajweed duration); the tajweed 30-day and hifz 90-day cooldown
 *    exactness windows; recipient-locale composition (an Arabic applicant
 *    receives the Arabic fail copy with the interpolated instant).
 *  - Tier 3 (chaos, committed fixtures): concurrent 4th/5th submissions
 *    serialize on the applicant lock so EXACTLY one finalizes; a concurrent
 *    duplicate collapses to one row + one typed conflict; an induced
 *    mid-transaction abort (the in-tx emit rejects) leaves zero rows — no
 *    evaluation row, no teacher row, no status flip, no publish.
 *  - Tier 4 (security/abuse): the oracle collapse (unknown/foreign/
 *    mistyped/prior-cycle targets share the byte-identical
 *    session-not-found denial), the non-certified teacher, the
 *    non-in_evaluation applicant, the fail-closed weakness vocabulary, the
 *    non-positive id guards, and the bounded denial-log contract (exactly
 *    one `logDomainError` per denial, zero on happy paths, never the
 *    observations).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/backend/db";
import { ApplicantRepository, EvaluationRepository, SessionRepository } from "@/backend/db/repo";
import { plans } from "@/backend/db/schema/billing/plans";
import { subscriptions } from "@/backend/db/schema/billing/subscriptions";
import { session } from "@/backend/db/schema/classes/session";
import { notifications } from "@/backend/db/schema/notifications/notifications";
import { applicants } from "@/backend/db/schema/teachers/applicants";
import { evaluations } from "@/backend/db/schema/teachers/evaluations";
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
import { NotificationType } from "@/backend/enum/notifications/notification-type.enum";
import { SessionIntent } from "@/backend/enum/scheduling/session-intent.enum";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import { SessionType } from "@/backend/enum/scheduling/session-type.enum";
import { ApplicantStatus } from "@/backend/enum/teachers/applicant-status.enum";
import { RubricWeaknessArea } from "@/backend/enum/teachers/rubric-weakness-area.enum";
import { ConflictError, DomainError, ForbiddenError, NotFoundError, ValidationError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import { NotificationEngine } from "@/backend/services/notifications/notification-engine.service";
import { expandCooldownTemplate } from "@/backend/services/teachers/applicant-lifecycle.service";
import { EvaluationRubricService } from "@/backend/services/teachers/evaluation-rubric.service";
import type {
  ApplicantSelectType,
  DBTransaction,
  RubricEvaluationReturnType,
  RubricEvaluationSubmitInput,
  SessionSelectType,
  TeacherSelectType,
  UserSelectType,
} from "@/backend/types";
import {
  HIFZ_COOLDOWN_DAYS,
  RUBRIC_NOTES_MAX_LENGTH,
  TAJWEED_COOLDOWN_DAYS,
} from "@/shared/constants/evaluation-rubric.constants";
import {
  VERIFICATION_PLAN_SESSION_COUNT,
  VERIFICATION_PLAN_TITLE,
} from "@/shared/constants/verification-plan.constants";
import { defaultLocale } from "@/shared/locale/AppLocale";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import { isPgliteProvider } from "@/test/helpers/skip-when-pglite";

const testOnRealPostgres = isPgliteProvider() ? test.skip : test;

/** The tests run on the default locale throughout (the ar leg overrides per applicant). */
const LOCALE = "en";

/** Milliseconds in one day — the cooldown expectations are day-count constants. */
const MS_PER_DAY = 86_400_000;

/**
 * An evaluation-session id far outside every sequence's range yet inside
 * the positive safe-integer guard — the "unknown session" probe.
 */
const UNKNOWN_SESSION_ID = 2_000_000_000;

/** Padded observations — the stored value must be the TRIMMED form. */
const PADDED_NOTES = "   Strong recitation with steady tajweed.   ";

// ─── Assertion helpers (sibling-suite conventions) ───────────────────────

/** The errors-namespace translations for the default test locale. */
function t() {
  return getServerTranslations(LOCALE).errorsTranslations;
}

/** The applicant-namespace translations for one locale. */
function applicantCopy(locale: string) {
  return getServerTranslations(locale).applicantTranslations;
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

/** Log-spy box: ONE recording stub installed per describe block. */
const logSpyBox: { spy?: ReturnType<typeof installLogSpy> } = {};

function installLogSpy() {
  return spyOn(logger, "logDomainError").mockImplementation(() => {});
}

function installEmitSpy() {
  return spyOn(NotificationEngine, "emitForUser").mockImplementation(async input => ({
    notifications: [],
    recipientUserIds: [input.userId],
  }));
}

function installPublishSpy() {
  return spyOn(NotificationEngine, "publishReceipts").mockResolvedValue(undefined);
}

/** Committed read-back oracles (global handle, after-commit view). */
async function readCommittedApplicantRow(applicantUserId: number): Promise<ApplicantSelectType | null> {
  const [row] = await db.select().from(applicants).where(eq(applicants.id, applicantUserId));
  return row ?? null;
}

async function readCommittedTeacherRow(applicantUserId: number) {
  const [row] = await db.select().from(teacher).where(eq(teacher.id, applicantUserId));
  return row ?? null;
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

/**
 * A full evaluation-loop applicant: a governance-clean user with an
 * `applicants` row in the evaluation stage plus an ACTIVE subscription on
 * the pinned verification plan, backdated one minute so every fixture
 * session created "now" falls inside the cycle window (the half-open
 * `created_at >= cycleStart` boundary). User-column overrides ride the
 * third parameter so the applicants insert never sees foreign keys.
 */
async function createVerificationApplicant(
  tx: DBTransaction,
  overrides: Partial<ApplicantSelectType> = {},
  userOverrides: Partial<UserSelectType> = {}
): Promise<{ applicantUserId: number; cycleStart: Date }> {
  const user = await createTestUser(tx, { role: "teacher", ...userOverrides });
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

/**
 * Direct evaluation-session insert for test preconditions (full column
 * control). Defaults pin the evaluation type + intent + completed state so
 * every gate before the cycle probe passes.
 */
async function insertEvaluationSession(
  tx: DBTransaction,
  evaluatorUserId: number,
  applicantUserId: number,
  overrides: Partial<SessionSelectType> = {}
): Promise<SessionSelectType> {
  const now = new Date();
  return createTestSession(tx, evaluatorUserId, applicantUserId, {
    sessionType: SessionType.TeacherEvaluation,
    intent: SessionIntent.Evaluation,
    status: SessionStatus.Completed,
    startedAt: now,
    endedAt: now,
    ...overrides,
  });
}

/** One scored submission entry: the score plus the iff-rule's weakness. */
interface ScoredEntry {
  readonly score: number;
  readonly weaknessArea: RubricWeaknessArea | null;
}

/** The service's write call, pinned to the test transaction + locale. */
function submitRubric(
  tx: DBTransaction,
  evaluatorUserId: number,
  sessionId: number,
  entry: ScoredEntry
): Promise<RubricEvaluationReturnType> {
  const input: RubricEvaluationSubmitInput = {
    score: entry.score,
    notes: PADDED_NOTES,
    weaknessArea: entry.weaknessArea,
  };
  return EvaluationRubricService.submitRubricEvaluation(evaluatorUserId, sessionId, input, LOCALE, tx);
}

/** One created evaluator + owned completed session + submitted score. */
interface ScoredSubmission {
  readonly evaluatorUserId: number;
  readonly sessionId: number;
  readonly submission: RubricEvaluationReturnType;
}

/**
 * Fills one applicant's cycle with scored submissions, one distinct
 * certified evaluator + owned completed session per entry, in feed order.
 * The recursive driver is the sanctioned sequential pattern for steps
 * sharing one DB-transaction connection.
 */
async function fillScoredCycle(
  tx: DBTransaction,
  applicantUserId: number,
  entries: readonly ScoredEntry[]
): Promise<ScoredSubmission[]> {
  const runNext = async (index: number, acc: ScoredSubmission[]): Promise<ScoredSubmission[]> => {
    if (index >= entries.length) {
      return acc;
    }
    const entry = entries[index];
    if (!entry) {
      throw new Error("fillScoredCycle: missing entry");
    }
    const evaluatorUserId = await createCertifiedEvaluator(tx);
    const sessionRow = await insertEvaluationSession(tx, evaluatorUserId, applicantUserId);
    const submission = await submitRubric(tx, evaluatorUserId, sessionRow.id, entry);
    return runNext(index + 1, [...acc, { evaluatorUserId, sessionId: sessionRow.id, submission }]);
  };
  return runNext(0, []);
}

// ─── Read-back oracles (independent selects, NOT via the service) ────────

async function readApplicantRow(executor: DBTransaction, userId: number): Promise<ApplicantSelectType | null> {
  const [row] = await executor.select().from(applicants).where(eq(applicants.id, userId));
  return row ?? null;
}

async function readTeacherRow(executor: DBTransaction, userId: number) {
  const [row] = await executor.select().from(teacher).where(eq(teacher.id, userId));
  return row ?? null;
}

async function readStoredEvaluation(tx: DBTransaction, evaluationId: number) {
  const [row] = await tx.select().from(evaluations).where(eq(evaluations.id, evaluationId));
  return row ?? null;
}

async function readNotificationRowsFor(tx: DBTransaction, userId: number) {
  return tx.select().from(notifications).where(eq(notifications.userId, userId));
}

/** Counts the applicant's evaluation rows (the row-count oracle). */
async function countEvaluationsFor(executor: DBTransaction, applicantUserId: number): Promise<number> {
  return executor.$count(evaluations, eq(evaluations.evaluatedId, applicantUserId));
}

/**
 * Asserts the applicant's stored cooldown instant is EXACTLY the captured
 * flow window plus the day-count duration — the stored value is verbatim,
 * so the service's captured `now` must land inside the test's [before,
 * after] bracket. A longer duration (e.g. the hifz 90 days when the
 * tajweed 30 is expected) falls outside the bracket and fails.
 */
function expectCooldownExactly(cooldownUntil: Date | null, days: number, before: number, after: number): void {
  if (!cooldownUntil) {
    throw new Error("expected a stamped cooldown instant");
  }
  expect(cooldownUntil.getTime()).toBeGreaterThanOrEqual(before + days * MS_PER_DAY);
  expect(cooldownUntil.getTime()).toBeLessThanOrEqual(after + days * MS_PER_DAY);
}

// ─── Transactional write pipeline (runInRollback) ────────────────────────

describe("EvaluationRubricService — submission pipeline (runInRollback)", () => {
  beforeAll(() => {
    logSpyBox.spy = installLogSpy();
  });

  beforeEach(() => {
    logSpyBox.spy?.mockClear();
  });

  afterAll(() => {
    logSpyBox.spy?.mockRestore();
  });

  test("below-quorum submission: commits alone, the read-model is sealed (no observations), and the evaluated subject is the session's student", async () => {
    await runInRollback(async tx => {
      const { applicantUserId } = await createVerificationApplicant(tx);
      await fillScoredCycle(tx, applicantUserId, [
        { score: 85, weaknessArea: null },
        { score: 90, weaknessArea: null },
        { score: 95, weaknessArea: null },
      ]);
      const fourthEvaluator = await createCertifiedEvaluator(tx);
      const fourthSession = await insertEvaluationSession(tx, fourthEvaluator, applicantUserId);

      const submission = await submitRubric(tx, fourthEvaluator, fourthSession.id, {
        score: 88,
        weaknessArea: null,
      });

      // The sealed read-model: exact key set (the observations never travel)
      // with the live in-evaluation status.
      expect(Object.keys(submission).toSorted((a, b) => a.localeCompare(b))).toEqual([
        "applicantStatus",
        "createdAt",
        "evaluatedId",
        "evaluatorId",
        "id",
        "score",
        "sessionId",
        "weaknessArea",
      ]);
      expect(submission.id).toBeGreaterThan(0);
      expect(submission.sessionId).toBe(fourthSession.id);
      expect(submission.evaluatorId).toBe(fourthEvaluator);
      expect(submission.evaluatedId).toBe(applicantUserId);
      expect(submission.score).toBe(88);
      expect(submission.weaknessArea).toBeNull();
      expect(submission.applicantStatus).toBe(ApplicantStatus.InEvaluation);
      expect(submission.createdAt).toBeInstanceOf(Date);

      // The stored row: the observations are the TRIMMED form.
      const stored = await readStoredEvaluation(tx, submission.id);
      expect(stored?.notes).toBe(PADDED_NOTES.trim());
      expect(await countEvaluationsFor(tx, applicantUserId)).toBe(4);
      expect((await readApplicantRow(tx, applicantUserId))?.status).toBe(ApplicantStatus.InEvaluation);
      expect(await readTeacherRow(tx, applicantUserId)).toBeNull();
      expectZeroLogCalls();
    });
  });

  test("five 80s PASS: the teacher row is minted certified (never an evaluator), the applicant passes, and the in-tx notification carries the passed copy", async () => {
    await runInRollback(async tx => {
      const { applicantUserId } = await createVerificationApplicant(tx, {}, { locale: "en" });
      const filled = await fillScoredCycle(tx, applicantUserId, [
        { score: 80, weaknessArea: null },
        { score: 80, weaknessArea: null },
        { score: 80, weaknessArea: null },
        { score: 80, weaknessArea: null },
      ]);
      const fifthEvaluator = await createCertifiedEvaluator(tx);
      const fifthSession = await insertEvaluationSession(tx, fifthEvaluator, applicantUserId);

      const fifth = await submitRubric(tx, fifthEvaluator, fifthSession.id, { score: 80, weaknessArea: null });

      expect(fifth.applicantStatus).toBe(ApplicantStatus.Passed);
      expect(filled.every(entry => entry.submission.applicantStatus === ApplicantStatus.InEvaluation)).toBe(true);

      const applicantRow = await readApplicantRow(tx, applicantUserId);
      expect(applicantRow?.status).toBe(ApplicantStatus.Passed);
      expect(applicantRow?.cooldownUntil).toBeNull();

      // The minted teacher row: certified, NOT an evaluator (full teaching
      // permissions realized as is_approved, never an evaluator flag).
      const teacherRow = await readTeacherRow(tx, applicantUserId);
      expect(teacherRow?.isApproved).toBe(true);
      expect(teacherRow?.isEvaluator).toBe(false);

      // The in-transaction notification: one evaluation_result row for the
      // applicant, composed in the applicant's persisted locale, pointing
      // at the finalizing session.
      const notificationRows = await readNotificationRowsFor(tx, applicantUserId);
      expect(notificationRows).toHaveLength(1);
      const notificationRow = notificationRows[0];
      if (!notificationRow) {
        throw new Error("expected the persisted evaluation-result notification");
      }
      expect(notificationRow.type).toBe(NotificationType.EvaluationResult);
      expect(notificationRow.relatedEntityType).toBe("session");
      expect(notificationRow.relatedEntityId).toBe(fifthSession.id);
      expect(notificationRow.title).toBe(applicantCopy(LOCALE).evaluationPassedTitle);
      expect(notificationRow.body).toBe(applicantCopy(LOCALE).evaluationPassedBody);
      expectZeroLogCalls();
    });
  });

  test("FAIL finalization: the guarded transition stamps the tajweed cooldown exactly, no teacher row appears, and the fail copy carries the instant", async () => {
    await runInRollback(async tx => {
      const { applicantUserId } = await createVerificationApplicant(tx, {}, { locale: "en" });
      await fillScoredCycle(tx, applicantUserId, [
        { score: 100, weaknessArea: null },
        { score: 100, weaknessArea: null },
        { score: 100, weaknessArea: null },
        { score: 100, weaknessArea: null },
      ]);
      const fifthEvaluator = await createCertifiedEvaluator(tx);
      const fifthSession = await insertEvaluationSession(tx, fifthEvaluator, applicantUserId);

      const before = Date.now();
      const fifth = await submitRubric(tx, fifthEvaluator, fifthSession.id, {
        score: 79,
        weaknessArea: RubricWeaknessArea.Tajweed,
      });
      const after = Date.now();

      expect(fifth.applicantStatus).toBe(ApplicantStatus.Failed);
      const applicantRow = await readApplicantRow(tx, applicantUserId);
      expect(applicantRow?.status).toBe(ApplicantStatus.Failed);
      expectCooldownExactly(applicantRow?.cooldownUntil ?? null, TAJWEED_COOLDOWN_DAYS, before, after);
      expect(await readTeacherRow(tx, applicantUserId)).toBeNull();

      const notificationRows = await readNotificationRowsFor(tx, applicantUserId);
      expect(notificationRows).toHaveLength(1);
      const notificationRow = notificationRows[0];
      if (!notificationRow) {
        throw new Error("expected the persisted evaluation-result notification");
      }
      expect(notificationRow.title).toBe(applicantCopy(LOCALE).evaluationFailedTitle);
      const cooldownUntil = applicantRow?.cooldownUntil;
      if (!cooldownUntil) {
        throw new Error("expected the stamped cooldown for the body expectation");
      }
      expect(notificationRow.body).toBe(
        expandCooldownTemplate(applicantCopy(LOCALE).evaluationFailedBody, cooldownUntil, LOCALE)
      );
      expectZeroLogCalls();
    });
  });

  test("input contract — the five pre-DB denials fire before any database work (zero reads, one bounded log each)", async () => {
    await runInRollback(async tx => {
      const { applicantUserId } = await createVerificationApplicant(tx);
      const evaluatorUserId = await createCertifiedEvaluator(tx);
      const sessionRow = await insertEvaluationSession(tx, evaluatorUserId, applicantUserId);

      const probes: readonly {
        score: number;
        notes: string;
        weaknessArea: RubricWeaknessArea | null;
        code: string;
        message: string;
      }[] = [
        {
          score: 1.5,
          notes: PADDED_NOTES,
          weaknessArea: null,
          code: "RUBRIC_SCORE_INVALID",
          message: t().rubricScoreInvalid,
        },
        {
          score: -1,
          notes: PADDED_NOTES,
          weaknessArea: null,
          code: "RUBRIC_SCORE_INVALID",
          message: t().rubricScoreInvalid,
        },
        {
          score: 101,
          notes: PADDED_NOTES,
          weaknessArea: null,
          code: "RUBRIC_SCORE_INVALID",
          message: t().rubricScoreInvalid,
        },
        { score: 80, notes: "", weaknessArea: null, code: "RUBRIC_NOTES_REQUIRED", message: t().rubricNotesRequired },
        {
          score: 80,
          notes: "   ",
          weaknessArea: null,
          code: "RUBRIC_NOTES_REQUIRED",
          message: t().rubricNotesRequired,
        },
        {
          score: 80,
          notes: "x".repeat(RUBRIC_NOTES_MAX_LENGTH + 1),
          weaknessArea: null,
          code: "RUBRIC_NOTES_REQUIRED",
          message: t().rubricNotesRequired,
        },
        {
          score: 79,
          notes: PADDED_NOTES,
          weaknessArea: null,
          code: "RUBRIC_WEAKNESS_REQUIRED",
          message: t().rubricWeaknessRequired,
        },
        {
          score: 80,
          notes: PADDED_NOTES,
          weaknessArea: RubricWeaknessArea.Tajweed,
          code: "RUBRIC_WEAKNESS_NOT_ALLOWED",
          message: t().rubricWeaknessNotAllowed,
        },
        {
          score: 79,
          notes: PADDED_NOTES,
          weaknessArea: null,
          code: "RUBRIC_WEAKNESS_INVALID",
          message: t().rubricWeaknessInvalid,
        },
      ];

      // The foreign-vocabulary probe: the typed base above carries the
      // honest `null`, then Object.assign injects the hostile runtime
      // string — no cast (the registration-suite pattern). The service's
      // fail-closed guard must reject it as RUBRIC_WEAKNESS_INVALID.
      const foreignProbe = probes.at(-1);
      if (foreignProbe) {
        Object.assign(foreignProbe, { weaknessArea: "shariah" });
      }

      // Pre-DB proof: the session and applicant gates never fire.
      const sessionGateSpy = spyOn(SessionRepository, "findById");
      const applicantGateSpy = spyOn(ApplicantRepository, "findForBookingGate");

      const assertProbe = async (remaining: readonly (typeof probes)[number][]): Promise<void> => {
        const probe = remaining[0];
        if (!probe) {
          return undefined;
        }
        const error = await expectRepoError(() =>
          EvaluationRubricService.submitRubricEvaluation(
            evaluatorUserId,
            sessionRow.id,
            { score: probe.score, notes: probe.notes, weaknessArea: probe.weaknessArea },
            LOCALE,
            tx
          )
        );
        expect(error).toBeInstanceOf(ValidationError);
        expectDomainDenial(error, probe.code, probe.message);
        return assertProbe(remaining.slice(1));
      };
      await assertProbe(probes);

      sessionGateSpy.mockRestore();
      applicantGateSpy.mockRestore();

      expect(sessionGateSpy).toHaveBeenCalledTimes(0);
      expect(applicantGateSpy).toHaveBeenCalledTimes(0);
      expect(await countEvaluationsFor(tx, applicantUserId)).toBe(0);
      expect(logCalls()).toHaveLength(probes.length);
      for (const call of logCalls()) {
        if (isRecord(call.ctx)) {
          expect(call.ctx.entity).toBe("evaluations");
          expect(call.ctx.entityId).toBe(evaluatorUserId);
          expectBoundedContextKeys(call.ctx);
        }
      }
    });
  });

  test("malformed ids deny VALIDATION before any database work", async () => {
    await runInRollback(async tx => {
      const { applicantUserId } = await createVerificationApplicant(tx);
      const evaluatorUserId = await createCertifiedEvaluator(tx);
      const sessionRow = await insertEvaluationSession(tx, evaluatorUserId, applicantUserId);

      const sessionGateSpy = spyOn(SessionRepository, "findById");
      const malformedCallerIds = [0, -3, 1.5];
      const assertCallerShape = async (remaining: readonly number[]): Promise<void> => {
        if (remaining.length === 0) {
          return undefined;
        }
        const callerId = remaining[0];
        const error = await expectRepoError(() =>
          submitRubric(tx, callerId, sessionRow.id, { score: 85, weaknessArea: null })
        );
        expect(error).toBeInstanceOf(ValidationError);
        expectDomainDenial(error, "VALIDATION", t().validation);
        return assertCallerShape(remaining.slice(1));
      };
      await assertCallerShape(malformedCallerIds);

      const malformedSessionError = await expectRepoError(() =>
        submitRubric(tx, evaluatorUserId, 0, { score: 85, weaknessArea: null })
      );
      expect(malformedSessionError).toBeInstanceOf(ValidationError);
      expectDomainDenial(malformedSessionError, "VALIDATION", t().validation);

      sessionGateSpy.mockRestore();
      expect(sessionGateSpy).toHaveBeenCalledTimes(0);
      expect(await countEvaluationsFor(tx, applicantUserId)).toBe(0);
      expect(logCalls()).toHaveLength(malformedCallerIds.length + 1);
    });
  });

  test("governance — a deleted, blocked, or suspended evaluator cannot score", async () => {
    await runInRollback(async tx => {
      const { applicantUserId } = await createVerificationApplicant(tx);
      const evaluatorUserId = await createCertifiedEvaluator(tx);
      const sessionRow = await insertEvaluationSession(tx, evaluatorUserId, applicantUserId);
      const governedOverrides: readonly { isDeleted?: boolean; isBlocked?: boolean; suspended?: boolean }[] = [
        { isDeleted: true },
        { isBlocked: true },
        { suspended: true },
      ];

      const assertGovernedShape = async (remaining: readonly (typeof governedOverrides)[number][]): Promise<void> => {
        const overrides = remaining[0];
        if (!overrides) {
          return undefined;
        }
        await tx.update(users).set(overrides).where(eq(users.id, evaluatorUserId));
        const error = await expectRepoError(() =>
          submitRubric(tx, evaluatorUserId, sessionRow.id, { score: 85, weaknessArea: null })
        );
        expect(error).toBeInstanceOf(ForbiddenError);
        expectDomainDenial(error, "FORBIDDEN", t().forbidden);
        await tx
          .update(users)
          .set({ isDeleted: false, isBlocked: false, suspended: false })
          .where(eq(users.id, evaluatorUserId));
        return assertGovernedShape(remaining.slice(1));
      };
      await assertGovernedShape(governedOverrides);

      expect(await countEvaluationsFor(tx, applicantUserId)).toBe(0);
      expect(logCalls()).toHaveLength(governedOverrides.length);
      for (const call of logCalls()) {
        if (isRecord(call.ctx)) {
          expect(call.ctx.code).toBe("FORBIDDEN");
        }
      }
    });
  });

  test("oracle collapse — unknown, foreign, mistyped, and prior-cycle targets share the ONE byte-identical session-not-found denial", async () => {
    await runInRollback(async tx => {
      const { applicantUserId, cycleStart } = await createVerificationApplicant(tx);
      const evaluatorUserId = await createCertifiedEvaluator(tx);
      const otherEvaluatorUserId = await createCertifiedEvaluator(tx);

      // The foreign target: another evaluator's completed evaluation session.
      const foreignSession = await insertEvaluationSession(tx, otherEvaluatorUserId, applicantUserId);
      // The mistyped target: the caller's OWN completed STUDENT session.
      const now = new Date();
      const mistypedSession = await createTestSession(tx, evaluatorUserId, applicantUserId, {
        status: SessionStatus.Completed,
        startedAt: now,
        endedAt: now,
      });
      // The prior-cycle target: typed + owned + completed, but created one
      // minute BEFORE the cycle opened (history is not scorable).
      const priorCycleSession = await insertEvaluationSession(tx, evaluatorUserId, applicantUserId, {
        createdAt: new Date(cycleStart.getTime() - 60_000),
      });

      const unknownError = await expectRepoError(() =>
        submitRubric(tx, evaluatorUserId, UNKNOWN_SESSION_ID, { score: 85, weaknessArea: null })
      );
      const foreignError = await expectRepoError(() =>
        submitRubric(tx, evaluatorUserId, foreignSession.id, { score: 85, weaknessArea: null })
      );
      const mistypedError = await expectRepoError(() =>
        submitRubric(tx, evaluatorUserId, mistypedSession.id, { score: 85, weaknessArea: null })
      );
      const priorCycleError = await expectRepoError(() =>
        submitRubric(tx, evaluatorUserId, priorCycleSession.id, { score: 85, weaknessArea: null })
      );

      expect(unknownError).toBeInstanceOf(NotFoundError);
      expect(foreignError).toBeInstanceOf(NotFoundError);
      expect(mistypedError).toBeInstanceOf(NotFoundError);
      expect(priorCycleError).toBeInstanceOf(NotFoundError);
      const unknownShape = denialShape(unknownError);
      expect(denialShape(foreignError)).toEqual(unknownShape);
      expect(denialShape(mistypedError)).toEqual(unknownShape);
      expect(denialShape(priorCycleError)).toEqual(unknownShape);
      expectDomainDenial(unknownError, "SESSION_NOT_FOUND", t().sessionNotFound);

      expect(await countEvaluationsFor(tx, applicantUserId)).toBe(0);
      expect(logCalls()).toHaveLength(4);
      for (const call of logCalls()) {
        if (isRecord(call.ctx)) {
          expect(call.ctx.code).toBe("SESSION_NOT_FOUND");
          expectBoundedContextKeys(call.ctx);
        }
      }
    });
  });

  test("completion gate — an owned, correctly-typed, scheduled session denies RUBRIC_SESSION_NOT_COMPLETED", async () => {
    await runInRollback(async tx => {
      const { applicantUserId } = await createVerificationApplicant(tx);
      const evaluatorUserId = await createCertifiedEvaluator(tx);
      const scheduled = await insertEvaluationSession(tx, evaluatorUserId, applicantUserId, {
        status: SessionStatus.Scheduled,
        startedAt: null,
        endedAt: null,
      });

      const error = await expectRepoError(() =>
        submitRubric(tx, evaluatorUserId, scheduled.id, { score: 85, weaknessArea: null })
      );

      expect(error).toBeInstanceOf(ConflictError);
      expectDomainDenial(error, "RUBRIC_SESSION_NOT_COMPLETED", t().rubricSessionNotCompleted);
      expectSingleBoundedDenialLog("RUBRIC_SESSION_NOT_COMPLETED", scheduled.id);
      expect(await countEvaluationsFor(tx, applicantUserId)).toBe(0);
    });
  });

  test("certification gate — a not-approved flag and a non-evaluator flag are the same typed conflict", async () => {
    await runInRollback(async tx => {
      const { applicantUserId } = await createVerificationApplicant(tx);
      const notApproved = await createCertifiedEvaluator(tx, { isApproved: false });
      const notEvaluator = await createCertifiedEvaluator(tx, { isEvaluator: false });
      const notApprovedSession = await insertEvaluationSession(tx, notApproved, applicantUserId);
      const notEvaluatorSession = await insertEvaluationSession(tx, notEvaluator, applicantUserId);

      const approvedError = await expectRepoError(() =>
        submitRubric(tx, notApproved, notApprovedSession.id, { score: 85, weaknessArea: null })
      );
      const evaluatorError = await expectRepoError(() =>
        submitRubric(tx, notEvaluator, notEvaluatorSession.id, { score: 85, weaknessArea: null })
      );

      expect(approvedError).toBeInstanceOf(ConflictError);
      expect(evaluatorError).toBeInstanceOf(ConflictError);
      expect(denialShape(approvedError)).toEqual(denialShape(evaluatorError));
      expectDomainDenial(approvedError, "TEACHER_NOT_CERTIFIED", t().teacherNotCertified);
      expect(await countEvaluationsFor(tx, applicantUserId)).toBe(0);
      expect(logCalls()).toHaveLength(2);
    });
  });

  test("applicant gate — a pending, failed, or passed applicant cannot be scored (the locked row is the gate)", async () => {
    await runInRollback(async tx => {
      const preStates: readonly ApplicantStatus[] = [
        ApplicantStatus.Pending,
        ApplicantStatus.Failed,
        ApplicantStatus.Passed,
      ];
      const assertPreState = async (remaining: readonly ApplicantStatus[]): Promise<void> => {
        const status = remaining[0];
        if (!status) {
          return undefined;
        }
        const { applicantUserId } = await createVerificationApplicant(tx, { status });
        const evaluatorUserId = await createCertifiedEvaluator(tx);
        const sessionRow = await insertEvaluationSession(tx, evaluatorUserId, applicantUserId);
        const error = await expectRepoError(() =>
          submitRubric(tx, evaluatorUserId, sessionRow.id, { score: 85, weaknessArea: null })
        );
        expect(error).toBeInstanceOf(ConflictError);
        expectDomainDenial(error, "APPLICANT_NOT_IN_EVALUATION", t().applicantNotInEvaluation);
        expect(await countEvaluationsFor(tx, applicantUserId)).toBe(0);
        return assertPreState(remaining.slice(1));
      };
      await assertPreState(preStates);
      expect(logCalls()).toHaveLength(preStates.length);
    });
  });

  test("duplicate pre-check — the second submission of a pair is the typed conflict and the write-once count holds", async () => {
    await runInRollback(async tx => {
      const { applicantUserId } = await createVerificationApplicant(tx);
      const evaluatorUserId = await createCertifiedEvaluator(tx);
      const sessionRow = await insertEvaluationSession(tx, evaluatorUserId, applicantUserId);

      const first = await submitRubric(tx, evaluatorUserId, sessionRow.id, { score: 85, weaknessArea: null });
      expect(first.applicantStatus).toBe(ApplicantStatus.InEvaluation);
      expectZeroLogCalls();

      const duplicateError = await expectRepoError(() =>
        submitRubric(tx, evaluatorUserId, sessionRow.id, { score: 90, weaknessArea: null })
      );
      expect(duplicateError).toBeInstanceOf(ConflictError);
      expectDomainDenial(duplicateError, "EVALUATION_ALREADY_SUBMITTED", t().evaluationAlreadySubmitted);
      expect(await countEvaluationsFor(tx, applicantUserId)).toBe(1);
      expectSingleBoundedDenialLog("EVALUATION_ALREADY_SUBMITTED", sessionRow.id);
    });
  });

  test("PASS demotion-guard arms — the elevate arm preserves the locked row's own evaluator flag; the already-approved arm no-ops", async () => {
    await runInRollback(async tx => {
      // Arm A: a pre-existing UNAPPROVED teacher row that IS an evaluator —
      // the elevation must flip approval WITHOUT demoting the evaluator flag.
      const elevatedApplicant = await createVerificationApplicant(tx);
      await createTestTeacherRow(tx, elevatedApplicant.applicantUserId, { isApproved: false, isEvaluator: true });
      await fillScoredCycle(tx, elevatedApplicant.applicantUserId, [
        { score: 85, weaknessArea: null },
        { score: 85, weaknessArea: null },
        { score: 85, weaknessArea: null },
        { score: 85, weaknessArea: null },
        { score: 85, weaknessArea: null },
      ]);
      const elevatedRow = await readTeacherRow(tx, elevatedApplicant.applicantUserId);
      expect(elevatedRow?.isApproved).toBe(true);
      expect(elevatedRow?.isEvaluator).toBe(true);
      expect((await readApplicantRow(tx, elevatedApplicant.applicantUserId))?.status).toBe(ApplicantStatus.Passed);

      // Arm B: a pre-existing ALREADY-APPROVED row — the insert's unique
      // arbiter fires, the locked row is approved, and the flow no-ops.
      const noopApplicant = await createVerificationApplicant(tx);
      await createTestTeacherRow(tx, noopApplicant.applicantUserId, { isApproved: true, isEvaluator: false });
      await fillScoredCycle(tx, noopApplicant.applicantUserId, [
        { score: 82, weaknessArea: null },
        { score: 82, weaknessArea: null },
        { score: 82, weaknessArea: null },
        { score: 82, weaknessArea: null },
        { score: 82, weaknessArea: null },
      ]);
      const noopRow = await readTeacherRow(tx, noopApplicant.applicantUserId);
      expect(noopRow?.isApproved).toBe(true);
      expect(noopRow?.isEvaluator).toBe(false);
      expect((await readApplicantRow(tx, noopApplicant.applicantUserId))?.status).toBe(ApplicantStatus.Passed);
      expectZeroLogCalls();
    });
  });

  test("per-evaluation minimum — one 79 among 100s FAILS the cycle at mean 95.8 and stamps the hifz cooldown", async () => {
    await runInRollback(async tx => {
      const { applicantUserId } = await createVerificationApplicant(tx);
      await fillScoredCycle(tx, applicantUserId, [
        { score: 100, weaknessArea: null },
        { score: 100, weaknessArea: null },
        { score: 79, weaknessArea: RubricWeaknessArea.Hifz },
        { score: 100, weaknessArea: null },
      ]);
      const fifthEvaluator = await createCertifiedEvaluator(tx);
      const fifthSession = await insertEvaluationSession(tx, fifthEvaluator, applicantUserId);

      const before = Date.now();
      const fifth = await submitRubric(tx, fifthEvaluator, fifthSession.id, { score: 100, weaknessArea: null });
      const after = Date.now();

      expect(fifth.applicantStatus).toBe(ApplicantStatus.Failed);
      const applicantRow = await readApplicantRow(tx, applicantUserId);
      expect(applicantRow?.status).toBe(ApplicantStatus.Failed);
      expectCooldownExactly(applicantRow?.cooldownUntil ?? null, HIFZ_COOLDOWN_DAYS, before, after);
      expect(await readTeacherRow(tx, applicantUserId)).toBeNull();
      expectZeroLogCalls();
    });
  });

  test("tie-break — two submissions tied at the lowest failing score resolve to the FIRST-SUBMITTED area (tajweed → 30 days, never hifz)", async () => {
    await runInRollback(async tx => {
      const { applicantUserId } = await createVerificationApplicant(tx);
      // The tajweed 65 is submitted FIRST, the hifz 65 second — the feed is
      // earliest-first, so the tied minimum resolves to the first-submitted
      // area and the hifz duration must never win.
      await fillScoredCycle(tx, applicantUserId, [
        { score: 65, weaknessArea: RubricWeaknessArea.Tajweed },
        { score: 65, weaknessArea: RubricWeaknessArea.Hifz },
        { score: 90, weaknessArea: null },
        { score: 90, weaknessArea: null },
      ]);
      const fifthEvaluator = await createCertifiedEvaluator(tx);
      const fifthSession = await insertEvaluationSession(tx, fifthEvaluator, applicantUserId);

      const before = Date.now();
      const fifth = await submitRubric(tx, fifthEvaluator, fifthSession.id, { score: 90, weaknessArea: null });
      const after = Date.now();

      expect(fifth.applicantStatus).toBe(ApplicantStatus.Failed);
      const applicantRow = await readApplicantRow(tx, applicantUserId);
      expectCooldownExactly(applicantRow?.cooldownUntil ?? null, TAJWEED_COOLDOWN_DAYS, before, after);
      expectZeroLogCalls();
    });
  });

  test("hifz cooldown — the single failing area stamps exactly now+90d", async () => {
    await runInRollback(async tx => {
      const { applicantUserId } = await createVerificationApplicant(tx);
      await fillScoredCycle(tx, applicantUserId, [
        { score: 70, weaknessArea: RubricWeaknessArea.Hifz },
        { score: 85, weaknessArea: null },
        { score: 85, weaknessArea: null },
        { score: 85, weaknessArea: null },
      ]);
      const fifthEvaluator = await createCertifiedEvaluator(tx);
      const fifthSession = await insertEvaluationSession(tx, fifthEvaluator, applicantUserId);

      const before = Date.now();
      const fifth = await submitRubric(tx, fifthEvaluator, fifthSession.id, { score: 88, weaknessArea: null });
      const after = Date.now();

      expect(fifth.applicantStatus).toBe(ApplicantStatus.Failed);
      const applicantRow = await readApplicantRow(tx, applicantUserId);
      expectCooldownExactly(applicantRow?.cooldownUntil ?? null, HIFZ_COOLDOWN_DAYS, before, after);
      expectZeroLogCalls();
    });
  });

  test("recipient locale — a persisted-locale applicant receives THEIR locale's fail copy; a locale-less applicant falls back to the platform default", async () => {
    await runInRollback(async tx => {
      // Arm A: the persisted "ar" locale wins verbatim.
      const arabicApplicant = await createVerificationApplicant(tx, {}, { locale: "ar" });
      await fillScoredCycle(tx, arabicApplicant.applicantUserId, [
        { score: 100, weaknessArea: null },
        { score: 100, weaknessArea: null },
        { score: 100, weaknessArea: null },
        { score: 100, weaknessArea: null },
      ]);
      const arabicFifthEvaluator = await createCertifiedEvaluator(tx);
      const arabicFifthSession = await insertEvaluationSession(
        tx,
        arabicFifthEvaluator,
        arabicApplicant.applicantUserId
      );

      const arabicFifth = await submitRubric(tx, arabicFifthEvaluator, arabicFifthSession.id, {
        score: 60,
        weaknessArea: RubricWeaknessArea.Tajweed,
      });

      expect(arabicFifth.applicantStatus).toBe(ApplicantStatus.Failed);
      const arabicApplicantRow = await readApplicantRow(tx, arabicApplicant.applicantUserId);
      const arabicCooldown = arabicApplicantRow?.cooldownUntil;
      if (!arabicCooldown) {
        throw new Error("expected the stamped cooldown");
      }
      const arabicNotificationRows = await readNotificationRowsFor(tx, arabicApplicant.applicantUserId);
      expect(arabicNotificationRows).toHaveLength(1);
      const arabicNotificationRow = arabicNotificationRows[0];
      if (!arabicNotificationRow) {
        throw new Error("expected the persisted notification");
      }
      expect(arabicNotificationRow.title).toBe(applicantCopy("ar").evaluationFailedTitle);
      expect(arabicNotificationRow.body).toBe(
        expandCooldownTemplate(applicantCopy("ar").evaluationFailedBody, arabicCooldown, "ar")
      );

      // Arm B: a NULL persisted locale falls back to the platform default.
      const fallbackApplicant = await createVerificationApplicant(tx);
      await fillScoredCycle(tx, fallbackApplicant.applicantUserId, [
        { score: 100, weaknessArea: null },
        { score: 100, weaknessArea: null },
        { score: 100, weaknessArea: null },
        { score: 100, weaknessArea: null },
      ]);
      const fallbackFifthEvaluator = await createCertifiedEvaluator(tx);
      const fallbackFifthSession = await insertEvaluationSession(
        tx,
        fallbackFifthEvaluator,
        fallbackApplicant.applicantUserId
      );

      const fallbackFifth = await submitRubric(tx, fallbackFifthEvaluator, fallbackFifthSession.id, {
        score: 60,
        weaknessArea: RubricWeaknessArea.Tajweed,
      });

      expect(fallbackFifth.applicantStatus).toBe(ApplicantStatus.Failed);
      const fallbackApplicantRow = await readApplicantRow(tx, fallbackApplicant.applicantUserId);
      const fallbackCooldown = fallbackApplicantRow?.cooldownUntil;
      if (!fallbackCooldown) {
        throw new Error("expected the stamped cooldown");
      }
      const fallbackNotificationRows = await readNotificationRowsFor(tx, fallbackApplicant.applicantUserId);
      expect(fallbackNotificationRows).toHaveLength(1);
      const fallbackNotificationRow = fallbackNotificationRows[0];
      if (!fallbackNotificationRow) {
        throw new Error("expected the persisted notification");
      }
      expect(fallbackNotificationRow.title).toBe(applicantCopy(defaultLocale).evaluationFailedTitle);
      expect(fallbackNotificationRow.body).toBe(
        expandCooldownTemplate(applicantCopy(defaultLocale).evaluationFailedBody, fallbackCooldown, defaultLocale)
      );
      expectZeroLogCalls();
    });
  });

  // ── Read arm: myRubricPendingSessions ──────────────────────────────────

  test("pending sessions — the certified caller's own completed un-submitted rows, newest first, drained by submissions", async () => {
    await runInRollback(async tx => {
      const { applicantUserId } = await createVerificationApplicant(tx);
      const evaluatorUserId = await createCertifiedEvaluator(tx);
      // All three sessions sit INSIDE the cycle (after the backdated
      // subscription start) with distinct instants so the newest-first page
      // order is fully pinned.
      const older = await insertEvaluationSession(tx, evaluatorUserId, applicantUserId, {
        createdAt: new Date(Date.now() - 30_000),
      });
      const middle = await insertEvaluationSession(tx, evaluatorUserId, applicantUserId, {
        createdAt: new Date(Date.now() - 15_000),
      });
      const newest = await insertEvaluationSession(tx, evaluatorUserId, applicantUserId);

      const before = await EvaluationRubricService.myRubricPendingSessions(evaluatorUserId, 1, 25, LOCALE, tx);
      expect(before.totalCount).toBe(3);
      expect(before.items.map(item => item.id)).toEqual([newest.id, middle.id, older.id]);
      expectZeroLogCalls();

      // Scoring a session drains exactly that row; the honest total follows.
      await submitRubric(tx, evaluatorUserId, older.id, { score: 85, weaknessArea: null });
      const afterFirst = await EvaluationRubricService.myRubricPendingSessions(evaluatorUserId, 1, 25, LOCALE, tx);
      expect(afterFirst.totalCount).toBe(2);
      expect(afterFirst.items.map(item => item.id)).toEqual([newest.id, middle.id]);

      await submitRubric(tx, evaluatorUserId, middle.id, { score: 90, weaknessArea: null });
      const afterSecond = await EvaluationRubricService.myRubricPendingSessions(evaluatorUserId, 1, 25, LOCALE, tx);
      expect(afterSecond.totalCount).toBe(1);
      expect(afterSecond.items.map(item => item.id)).toEqual([newest.id]);
      expectZeroLogCalls();
    });
  });

  test("pending sessions — out-of-range windows echo the normalized bounds with the honest total", async () => {
    await runInRollback(async tx => {
      const { applicantUserId } = await createVerificationApplicant(tx);
      const evaluatorUserId = await createCertifiedEvaluator(tx);
      await insertEvaluationSession(tx, evaluatorUserId, applicantUserId);

      const normalized = await EvaluationRubricService.myRubricPendingSessions(evaluatorUserId, 0, 5_000, LOCALE, tx);
      expect(normalized.page).toBe(1);
      expect(normalized.pageSize).toBe(25);

      const farPage = await EvaluationRubricService.myRubricPendingSessions(evaluatorUserId, 99, 25, LOCALE, tx);
      expect(farPage.items).toEqual([]);
      expect(farPage.totalCount).toBe(1);
      expect(farPage.page).toBe(99);
      expect(farPage.pageSize).toBe(25);
      expectZeroLogCalls();
    });
  });

  test("pending sessions — a non-certified caller gets the oracle-safe EMPTY page (never an error, one bounded log each)", async () => {
    await runInRollback(async tx => {
      const approvedTeacher = await createTestUser(tx, { role: "teacher" });
      await createTestTeacherRow(tx, approvedTeacher.id, { isApproved: true, isEvaluator: false });
      const teacherlessCaller = await createTestUser(tx, { role: "teacher" });

      const flaggedPage = await EvaluationRubricService.myRubricPendingSessions(approvedTeacher.id, 1, 25, LOCALE, tx);
      expect(flaggedPage.items).toEqual([]);
      expect(flaggedPage.totalCount).toBe(0);
      expect(flaggedPage.page).toBe(1);
      expect(flaggedPage.pageSize).toBe(25);

      const teacherlessPage = await EvaluationRubricService.myRubricPendingSessions(
        teacherlessCaller.id,
        1,
        25,
        LOCALE,
        tx
      );
      expect(teacherlessPage).toEqual(flaggedPage);

      expect(logCalls()).toHaveLength(2);
      for (const call of logCalls()) {
        if (isRecord(call.ctx)) {
          expect(call.ctx.code).toBe("TEACHER_NOT_CERTIFIED");
          expectBoundedContextKeys(call.ctx);
        }
      }
    });
  });

  test("pending sessions — a malformed caller id denies VALIDATION before any database read", async () => {
    await runInRollback(async tx => {
      const error = await expectRepoError(() => EvaluationRubricService.myRubricPendingSessions(0, 1, 25, LOCALE, tx));
      expect(error).toBeInstanceOf(ValidationError);
      expectDomainDenial(error, "VALIDATION", t().validation);
      expectSingleBoundedDenialLog("VALIDATION", 0);
    });
  });

  // ── Read arm: myRubricEvaluation ───────────────────────────────────────

  test("own-submission read — a hit returns the sealed read-model with the LIVE applicant status and no observations", async () => {
    await runInRollback(async tx => {
      const { applicantUserId } = await createVerificationApplicant(tx);
      const evaluatorUserId = await createCertifiedEvaluator(tx);
      const sessionRow = await insertEvaluationSession(tx, evaluatorUserId, applicantUserId);
      const submission = await submitRubric(tx, evaluatorUserId, sessionRow.id, {
        score: 79,
        weaknessArea: RubricWeaknessArea.Tajweed,
      });

      const read = await EvaluationRubricService.myRubricEvaluation(evaluatorUserId, sessionRow.id, LOCALE, tx);

      expect(Object.keys(read).toSorted((a, b) => a.localeCompare(b))).toEqual([
        "applicantStatus",
        "createdAt",
        "evaluatedId",
        "evaluatorId",
        "id",
        "score",
        "sessionId",
        "weaknessArea",
      ]);
      expect(read.id).toBe(submission.id);
      expect(read.sessionId).toBe(sessionRow.id);
      expect(read.evaluatedId).toBe(applicantUserId);
      expect(read.evaluatorId).toBe(evaluatorUserId);
      expect(read.score).toBe(79);
      expect(read.weaknessArea).toBe(RubricWeaknessArea.Tajweed);
      expect(read.applicantStatus).toBe(ApplicantStatus.InEvaluation);
      expectZeroLogCalls();
    });
  });

  test("own-submission read — unknown and foreign pairs share the byte-identical session-not-found denial", async () => {
    await runInRollback(async tx => {
      const { applicantUserId } = await createVerificationApplicant(tx);
      const evaluatorUserId = await createCertifiedEvaluator(tx);
      const otherEvaluatorUserId = await createCertifiedEvaluator(tx);
      const foreignSession = await insertEvaluationSession(tx, otherEvaluatorUserId, applicantUserId);

      const unknownError = await expectRepoError(() =>
        EvaluationRubricService.myRubricEvaluation(evaluatorUserId, UNKNOWN_SESSION_ID, LOCALE, tx)
      );
      const foreignError = await expectRepoError(() =>
        EvaluationRubricService.myRubricEvaluation(evaluatorUserId, foreignSession.id, LOCALE, tx)
      );

      expect(unknownError).toBeInstanceOf(NotFoundError);
      expect(foreignError).toBeInstanceOf(NotFoundError);
      expect(denialShape(unknownError)).toEqual(denialShape(foreignError));
      expectDomainDenial(unknownError, "SESSION_NOT_FOUND", t().sessionNotFound);
      expect(logCalls()).toHaveLength(2);
    });
  });

  test("own-submission read — a malformed pair denies VALIDATION, and a corrupt stored status fails closed", async () => {
    await runInRollback(async tx => {
      const malformedError = await expectRepoError(() =>
        EvaluationRubricService.myRubricEvaluation(1.5, UNKNOWN_SESSION_ID, LOCALE, tx)
      );
      expect(malformedError).toBeInstanceOf(ValidationError);
      expectDomainDenial(malformedError, "VALIDATION", t().validation);
      expectSingleBoundedDenialLog("VALIDATION", 1.5);

      // The integrity tripwire: a stored applicant status outside the
      // vocabulary fails closed (never a lenient interpretation).
      const corruptUser = await createTestUser(tx, { role: "teacher" });
      await createTestApplicant(tx, corruptUser.id, { status: "hacked" });
      const evaluatorUserId = await createCertifiedEvaluator(tx);
      const sessionRow = await insertEvaluationSession(tx, evaluatorUserId, corruptUser.id);
      await EvaluationRepository.insertOnce(
        {
          evaluatedId: corruptUser.id,
          evaluatorId: evaluatorUserId,
          sessionId: sessionRow.id,
          score: 85,
          notes: "seeded",
          weaknessArea: null,
        },
        tx
      );
      const corruptError = await expectRepoError(() =>
        EvaluationRubricService.myRubricEvaluation(evaluatorUserId, sessionRow.id, LOCALE, tx)
      );
      expect(corruptError).toBeInstanceOf(ValidationError);
      expectDomainDenial(corruptError, "APPLICANT_STATUS_CORRUPT", t().applicantStatusCorrupt);
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

describe("EvaluationRubricService — production-path races (committed fixtures)", () => {
  /** Every committed fixture user id, swept in afterAll (FK-safe order). */
  const committedUserIds: number[] = [];

  /** The canonical verification plan row (resolved once; teardown only when self-created). */
  let committedPlanId = 0;
  let suiteOwnsCommittedPlan = false;

  let emitSpy: ReturnType<typeof installEmitSpy> | undefined;
  let publishSpy: ReturnType<typeof installPublishSpy> | undefined;

  function requireEmitSpy(): NonNullable<typeof emitSpy> {
    if (!emitSpy) {
      throw new Error("emit spy not installed (fixture integrity failure)");
    }
    return emitSpy;
  }

  function requirePublishSpy(): NonNullable<typeof publishSpy> {
    if (!publishSpy) {
      throw new Error("publish spy not installed (fixture integrity failure)");
    }
    return publishSpy;
  }

  beforeAll(() => {
    logSpyBox.spy = installLogSpy();
    emitSpy = installEmitSpy();
    publishSpy = installPublishSpy();
  });

  beforeEach(() => {
    logSpyBox.spy?.mockClear();
    emitSpy?.mockClear();
    publishSpy?.mockClear();
  });

  afterAll(async () => {
    logSpyBox.spy?.mockRestore();
    emitSpy?.mockRestore();
    publishSpy?.mockRestore();

    // FK-safe hard delete: notifications → evaluations → sessions → the
    // role-child rows → the shared-PK users (empty ids list is a no-op).
    if (committedUserIds.length > 0) {
      await db.delete(notifications).where(inArray(notifications.userId, committedUserIds));
      await db.delete(evaluations).where(inArray(evaluations.evaluatedId, committedUserIds));
      await db.delete(session).where(inArray(session.studentId, committedUserIds));
      await db.delete(applicants).where(inArray(applicants.id, committedUserIds));
      await db.delete(subscriptions).where(inArray(subscriptions.userId, committedUserIds));
      await db.delete(teacher).where(inArray(teacher.id, committedUserIds));
      await db.delete(users).where(inArray(users.id, committedUserIds));
      expect(await db.$count(evaluations, inArray(evaluations.evaluatedId, committedUserIds))).toBe(0);
      expect(await db.$count(session, inArray(session.studentId, committedUserIds))).toBe(0);
      expect(await db.$count(applicants, inArray(applicants.id, committedUserIds))).toBe(0);
    }

    // Only a canonical plan row THIS suite created is deleted — the seeded
    // catalog member is never touched (the verification purchase flow
    // rejects an ambiguous catalog).
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
   * teardown.
   */
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

  /** Committed certified evaluator + owned completed evaluation session. */
  async function createCommittedRacer(
    applicantUserId: number
  ): Promise<{ evaluatorUserId: number; sessionId: number }> {
    return db.transaction(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      await createTestTeacherRow(tx, user.id, { isApproved: true, isEvaluator: true });
      committedUserIds.push(user.id);
      const now = new Date();
      const sessionRow = await createTestSession(tx, user.id, applicantUserId, {
        sessionType: SessionType.TeacherEvaluation,
        intent: SessionIntent.Evaluation,
        status: SessionStatus.Completed,
        startedAt: now,
        endedAt: now,
      });
      return { evaluatorUserId: user.id, sessionId: sessionRow.id };
    });
  }

  /** One committed scored submission: evaluator + owned session + evaluation row. */
  async function seedCommittedScoredSubmission(applicantUserId: number, entry: ScoredEntry): Promise<void> {
    await db.transaction(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      await createTestTeacherRow(tx, user.id, { isApproved: true, isEvaluator: true });
      committedUserIds.push(user.id);
      const now = new Date();
      const sessionRow = await createTestSession(tx, user.id, applicantUserId, {
        sessionType: SessionType.TeacherEvaluation,
        intent: SessionIntent.Evaluation,
        status: SessionStatus.Completed,
        startedAt: now,
        endedAt: now,
      });
      await EvaluationRepository.insertOnce(
        {
          evaluatedId: applicantUserId,
          evaluatorId: user.id,
          sessionId: sessionRow.id,
          score: entry.score,
          notes: PADDED_NOTES.trim(),
          weaknessArea: entry.weaknessArea,
        },
        tx
      );
    });
  }

  /** The production-path write call (own top-level transaction, NO outerTx). */
  function submitProduction(evaluatorUserId: number, sessionId: number, entry: ScoredEntry) {
    const input: RubricEvaluationSubmitInput = {
      score: entry.score,
      notes: PADDED_NOTES,
      weaknessArea: entry.weaknessArea,
    };
    return EvaluationRubricService.submitRubricEvaluation(evaluatorUserId, sessionId, input, LOCALE);
  }

  testOnRealPostgres(
    "concurrent 4th/5th submissions — the applicant lock serializes the rivals so EXACTLY one finalizes",
    async () => {
      const applicantUserId = await createCommittedApplicant();
      // Three committed scored submissions — independent connections in
      // parallel, exactly like production traffic.
      await Promise.all([
        seedCommittedScoredSubmission(applicantUserId, { score: 90, weaknessArea: null }),
        seedCommittedScoredSubmission(applicantUserId, { score: 92, weaknessArea: null }),
        seedCommittedScoredSubmission(applicantUserId, { score: 94, weaknessArea: null }),
      ]);
      const racerA = await createCommittedRacer(applicantUserId);
      const racerB = await createCommittedRacer(applicantUserId);

      const settled = await Promise.allSettled([
        submitProduction(racerA.evaluatorUserId, racerA.sessionId, { score: 96, weaknessArea: null }),
        submitProduction(racerB.evaluatorUserId, racerB.sessionId, { score: 98, weaknessArea: null }),
      ]);

      // BOTH commits succeed (a 4th and a 5th), but exactly one observed the
      // quorum and finalized.
      expect(settled.filter(entry => entry.status === "fulfilled")).toHaveLength(2);
      const fulfilled = settled.flatMap(entry => (entry.status === "fulfilled" ? [entry.value] : []));
      const finalizers = fulfilled.filter(value => value.applicantStatus === ApplicantStatus.Passed);
      const drainers = fulfilled.filter(value => value.applicantStatus === ApplicantStatus.InEvaluation);
      expect(finalizers).toHaveLength(1);
      expect(drainers).toHaveLength(1);

      expect(await db.$count(evaluations, eq(evaluations.evaluatedId, applicantUserId))).toBe(
        VERIFICATION_PLAN_SESSION_COUNT
      );
      expect((await readCommittedApplicantRow(applicantUserId))?.status).toBe(ApplicantStatus.Passed);
      const teacherRow = await readCommittedTeacherRow(applicantUserId);
      expect(teacherRow?.isApproved).toBe(true);
      expect(teacherRow?.isEvaluator).toBe(false);

      // Only the finalizer emitted and only its receipt published post-commit.
      expect(requireEmitSpy().mock.calls).toHaveLength(1);
      expect(requirePublishSpy().mock.calls).toHaveLength(1);
    }
  );

  testOnRealPostgres(
    "concurrent duplicate — the write-once arbiter collapses the race to ONE row + one typed conflict",
    async () => {
      const applicantUserId = await createCommittedApplicant();
      const shared = await createCommittedRacer(applicantUserId);

      const settled = await Promise.allSettled([
        submitProduction(shared.evaluatorUserId, shared.sessionId, { score: 88, weaknessArea: null }),
        submitProduction(shared.evaluatorUserId, shared.sessionId, { score: 88, weaknessArea: null }),
      ]);

      expect(settled.filter(entry => entry.status === "fulfilled")).toHaveLength(1);
      const losers = settled.filter(entry => entry.status === "rejected");
      expect(losers).toHaveLength(1);
      expectSettledDenial(losers[0], "EVALUATION_ALREADY_SUBMITTED", t().evaluationAlreadySubmitted);

      expect(await db.$count(evaluations, eq(evaluations.evaluatedId, applicantUserId))).toBe(1);
      expect((await readCommittedApplicantRow(applicantUserId))?.status).toBe(ApplicantStatus.InEvaluation);
      expect(await readCommittedTeacherRow(applicantUserId)).toBeNull();
      expect(requirePublishSpy().mock.calls).toHaveLength(0);
    }
  );

  testOnRealPostgres(
    "induced mid-transaction abort — a rejected in-tx emit rolls the WHOLE verdict back: zero rows, no flip, no publish",
    async () => {
      const applicantUserId = await createCommittedApplicant();
      // Four committed perfect scores; the 5th would finalize the cycle.
      await Promise.all([
        seedCommittedScoredSubmission(applicantUserId, { score: 100, weaknessArea: null }),
        seedCommittedScoredSubmission(applicantUserId, { score: 100, weaknessArea: null }),
        seedCommittedScoredSubmission(applicantUserId, { score: 100, weaknessArea: null }),
        seedCommittedScoredSubmission(applicantUserId, { score: 100, weaknessArea: null }),
      ]);
      const fifth = await createCommittedRacer(applicantUserId);

      requireEmitSpy().mockRejectedValueOnce(new Error("notification channel down"));
      const error = await expectRepoError(() =>
        submitProduction(fifth.evaluatorUserId, fifth.sessionId, { score: 100, weaknessArea: null })
      );
      expect(error.message).toBe("notification channel down");

      // The verdict commits with its submission or not at all: no evaluation
      // row, no teacher row, no status flip, no post-commit publish.
      expect(await db.$count(evaluations, eq(evaluations.evaluatedId, applicantUserId))).toBe(4);
      expect((await readCommittedApplicantRow(applicantUserId))?.status).toBe(ApplicantStatus.InEvaluation);
      expect(await readCommittedTeacherRow(applicantUserId)).toBeNull();
      expect(requirePublishSpy().mock.calls).toHaveLength(0);
      expect(requireEmitSpy().mock.calls).toHaveLength(1);
    }
  );
});
