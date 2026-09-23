/**
 * StudentEvaluationService tests — the write-once student→teacher session
 * rating and the rater's own rating history, against the live `kottaby_test`
 * PostgreSQL instance on REAL repositories.
 *
 * Per `backend/db/test/AGENTS.md` (the DB-backed service-test rules the
 * sibling suites apply):
 *  - Every transactional case runs inside `runInRollback`; `tx` is handed
 *    to the service as its outer transaction (the service's documented test
 *    path — the flow executes on a SAVEPOINT of the caller's transaction).
 *  - The production-path block (own top-level transaction per call, the
 *    undefined-outerTx arm) uses COMMITTED fixtures with hard deletes and
 *    residue probes, mirroring the sibling chaos-block conventions.
 *  - Entities are created ONLY via `entity-setup.ts` helpers — never seed
 *    data.
 *  - NO `expect(...).rejects.toThrow()` — every denial goes through
 *    `expectRepoError`; typed denials are asserted through the
 *    `DomainError.code` contract plus the exact translated message.
 *
 * Coverage map:
 *  - Tier 1 (branch/statement): the happy write + read-back on a
 *    dual-confirmed session; the full denial matrix with byte-exact classes
 *    + codes (`VALIDATION` twice — malformed id and invalid rating,
 *    `SESSION_NOT_FOUND`, `EVALUATION_SESSION_NOT_COMPLETED`,
 *    `EVALUATION_ALREADY_SUBMITTED`) and exact translated messages; the
 *    read surface's transactional and cold branches.
 *  - Tier 2 (boundary): the whole-star score matrix (1..5 → 20..100 on the
 *    table's 0-100 scale); the rating rejections at 0, 6, a fractional
 *    star, NaN, and a string-coerced payload — each projecting exactly the
 *    `rating` field; the session-id fuzz (0, negative, fractional, NaN,
 *    beyond the safe-integer ceiling) denied `VALIDATION` BEFORE any
 *    database read (repository spies prove no read fires).
 *  - Tier 3 (chaos): the completion-gate matrix over every constructible
 *    pre-handshake state (scheduled/started/cancelled, teacher-stamp-only,
 *    student-stamp-only — the latter impossible through the real lifecycle
 *    but constructible at the row level — and both stamps missing); the
 *    sequential duplicate re-submit; the committed-fixture block exercises
 *    the production transaction path including the concurrent duplicate
 *    storm (`Promise.allSettled` — exactly one winner, one typed-conflict
 *    loser, one stored row).
 *  - Tier 4 (security): foreign-student ≡ nonexistent-id byte-identical
 *    denials (oracle collapse); the server-derived rater and rated subject
 *    (no caller-owned identity channel exists to smuggle); outer-transaction
 *    SAVEPOINT propagation (a denial rolls back only the savepoint and
 *    leaves the caller's transaction usable); write-purity row-count/
 *    row-snapshot oracles over every sibling surface (no lifecycle writes,
 *    no notifications, no audit rows); the denial log contract (exactly one
 *    bounded `logDomainError` entry per denial, zero on happy paths, never
 *    the submitted payload content).
 *
 * Cached-average coverage: the submission maintains the rated teacher's
 * cached `average_rating` in the SAME transaction — a single rating stores
 * its own star value ("4.00"); the stored value is recomputed from the
 * live rating family, never incremented (seeded family ⇒ exact "3.50");
 * applicant (session-less) and soft-deleted rows never fold into the mean;
 * boundary families store exactly "1.00" and "5.00"; a duplicate and every
 * denial leg leave the teacher row byte-identical (full-row snapshots);
 * concurrent same-teacher submissions both commit and land within family
 * bounds (committed-fixture block, real-PostgreSQL gated).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/backend/db";
import { EvaluationRepository, SessionRepository, TeacherRepository } from "@/backend/db/repo";
import { auditLogs } from "@/backend/db/schema/audit/audit-logs";
import { session } from "@/backend/db/schema/classes/session";
import { notifications } from "@/backend/db/schema/notifications/notifications";
import { evaluations } from "@/backend/db/schema/teachers/evaluations";
import { users } from "@/backend/db/schema/users/users";
import {
  createTestEvaluation,
  createTestSession,
  createTestStudent,
  createTestTeacherRow,
  createTestUser,
} from "@/backend/db/test/entity-setup";
import { expectRepoError, runInRollback } from "@/backend/db/test/test-utils";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import { ConflictError, DomainError, NotFoundError, ValidationError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import { StudentEvaluationService } from "@/backend/services/teachers/student-evaluation.service";
import type {
  ApiFieldErrorType,
  DBTransaction,
  EvaluationReturnType,
  EvaluationSelectType,
  EvaluationSubmitInput,
  SessionInsertType,
  SessionSelectType,
} from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import { isPgliteProvider } from "@/test/helpers/skip-when-pglite";

const testOnRealPostgres = isPgliteProvider() ? test.skip : test;

/** The tests run on the default locale throughout. */
const LOCALE = "en";

/**
 * A session id far outside every sequence's range yet inside the positive
 * safe-integer guard — the "unknown session" probe of the oracle leg.
 */
const UNKNOWN_SESSION_ID = 2_000_000_000;

// ─── Assertion helpers (sibling-suite conventions) ───────────────────────

/** The errors-namespace translations for the default test locale. */
function t() {
  return getServerTranslations(LOCALE).errorsTranslations;
}

/** Type-guard read of a caught rejection's `extensions.code` contract. */
function rejectionCode(error: unknown): string {
  return error instanceof DomainError ? error.code : "";
}

/** Type-guard read of a validation denial's field projection (empty when absent). */
function validationFields(error: Error): readonly ApiFieldErrorType[] {
  return error instanceof ValidationError ? (error.fields ?? []) : [];
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

/** The ONLY context keys a bounded denial log may carry. */
const BOUNDED_LOG_CONTEXT_KEYS: ReadonlySet<string> = new Set(["code", "entity", "entityId", "locale"]);

/** One recorded `logDomainError` call (message + context). */
interface RecordedLogCall {
  readonly message: string;
  readonly ctx: unknown;
}

/**
 * Log-spy box: the denial-log contract is asserted through ONE passthrough
 * spy installed per describe block (cleared per test, restored at the end),
 * so every test's call counts are exact.
 */
const logSpyBox: { spy?: ReturnType<typeof installLogSpy> } = {};

function installLogSpy() {
  return spyOn(logger, "logDomainError");
}

/** The repository spies (installed per describe block, cleared per test). */
function installRepositorySpies() {
  return [
    spyOn(SessionRepository, "findRatingEligibilityProbe"),
    spyOn(EvaluationRepository, "insertOnce"),
    spyOn(EvaluationRepository, "listByEvaluator"),
  ];
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

/**
 * Asserts EXACTLY `count` denial logs fired in the current window, each
 * carrying the expected code + entity inside a BOUNDED context (the batched
 * form of the one-log-per-denial contract).
 */
function expectBoundedDenialLogs(code: string, entity: string, count: number): void {
  const calls = logCalls();
  expect(calls).toHaveLength(count);
  for (const call of calls) {
    expect(isRecord(call.ctx)).toBe(true);
    if (isRecord(call.ctx)) {
      expect(call.ctx.code).toBe(code);
      expect(call.ctx.entity).toBe(entity);
      expectBoundedContextKeys(call.ctx);
    }
  }
}

/** Asserts the current window recorded ZERO log calls. */
function expectZeroLogCalls(): void {
  expect(logCalls()).toHaveLength(0);
}

// ─── File-local fixtures (mirror the repo-suite helpers) ────────────────

/**
 * The actors of one rating flow: the session's teacher and the student who
 * rates them (shared PKs — the ids stored in the session row's participant
 * columns are the users-table ids).
 */
interface RatingActors {
  teacherUserId: number;
  studentUserId: number;
}

/** Creates one certified teacher + one student pair with shared-PK rows. */
async function createRatingActors(tx: DBTransaction): Promise<RatingActors> {
  const teacherUser = await createTestUser(tx, { role: "teacher" });
  await createTestTeacherRow(tx, teacherUser.id);
  const studentUser = await createTestUser(tx, { role: "student" });
  await createTestStudent(tx, studentUser.id);
  return { teacherUserId: teacherUser.id, studentUserId: studentUser.id };
}

/** An independent second student (the oracle leg's non-participant). */
async function createSecondStudent(tx: DBTransaction): Promise<number> {
  const secondStudentUser = await createTestUser(tx, { role: "student" });
  await createTestStudent(tx, secondStudentUser.id);
  return secondStudentUser.id;
}

/**
 * A payload that skipped the boundary parse: the star arrives as a numeric
 * string. The JSON channel is the honest way to hand the service a runtime
 * value its static description does not admit (no type assertion).
 */
function boundarySkippingInput(rawJson: string): EvaluationSubmitInput {
  const parsed: EvaluationSubmitInput = JSON.parse(rawJson);
  return parsed;
}

/**
 * Sequential driver for shared-transaction iterations (the recursive
 * helper the linting rules mandate when the steps share one DB transaction
 * connection and must not run concurrently).
 */
async function runSequentially(steps: readonly (() => Promise<void>)[]): Promise<void> {
  if (steps.length === 0) {
    return undefined;
  }
  await steps[0]?.();
  return runSequentially(steps.slice(1));
}

/**
 * Direct session-row insert for test preconditions (full column control —
 * lifecycle states a booking cannot start from, e.g. completed).
 */
async function insertSessionRow(
  tx: DBTransaction,
  actors: RatingActors,
  overrides: Partial<SessionInsertType> = {}
): Promise<SessionSelectType> {
  return createTestSession(tx, actors.teacherUserId, actors.studentUserId, overrides);
}

/** The completion handshake's end state: completed with BOTH stamps set. */
function dualConfirmedOverrides(): Partial<SessionInsertType> {
  const stampedAt = new Date();
  return {
    status: SessionStatus.Completed,
    confirmedByTeacherAt: stampedAt,
    confirmedByStudentAt: stampedAt,
  };
}

/** Independent read-back oracle: the full session row (NOT via the service). */
async function readSessionRow(executor: DBTransaction, sessionId: number): Promise<SessionSelectType | null> {
  const [row] = await executor.select().from(session).where(eq(session.id, sessionId));
  return row ?? null;
}

/** Independent read-back oracle: the rating row straight from the table. */
async function readEvaluationRow(executor: DBTransaction, id: number): Promise<EvaluationSelectType | null> {
  const [row] = await executor.select().from(evaluations).where(eq(evaluations.id, id));
  return row ?? null;
}

/** Counts the rating rows of one (session, rater) pair (the row-count oracle). */
async function countEvaluationsFor(executor: DBTransaction, sessionId: number, evaluatorId: number): Promise<number> {
  return executor.$count(
    evaluations,
    and(eq(evaluations.sessionId, sessionId), eq(evaluations.evaluatorId, evaluatorId))
  );
}

/** The service's write call, pinned to the test transaction + locale. */
function submitRating(
  tx: DBTransaction,
  studentUserId: number,
  sessionId: number,
  rating: number
): Promise<EvaluationReturnType> {
  return StudentEvaluationService.submitTeacherEvaluation(studentUserId, sessionId, { rating }, LOCALE, tx);
}

// ─── Transactional write pipeline (runInRollback) ────────────────────────

describe("StudentEvaluationService — transactional write pipeline (runInRollback)", () => {
  let repositorySpies: ReturnType<typeof installRepositorySpies> = [];

  beforeAll(() => {
    logSpyBox.spy = installLogSpy();
    repositorySpies = installRepositorySpies();
  });

  beforeEach(() => {
    logSpyBox.spy?.mockClear();
    for (const spy of repositorySpies) {
      spy.mockClear();
    }
  });

  afterAll(() => {
    logSpyBox.spy?.mockRestore();
    for (const spy of repositorySpies) {
      spy.mockRestore();
    }
  });

  /** Asserts the probe and insert spies recorded EXACTLY the given counts. */
  function expectDatabaseCalls(probe: number, insert: number): void {
    expect(repositorySpies[0]?.mock.calls).toHaveLength(probe);
    expect(repositorySpies[1]?.mock.calls).toHaveLength(insert);
  }

  test("happy write: the session's student rates a dual-confirmed session and reads the row back (zero logs)", async () => {
    await runInRollback(async tx => {
      const actors = await createRatingActors(tx);
      const rated = await insertSessionRow(tx, actors, dualConfirmedOverrides());

      const submitted = await submitRating(tx, actors.studentUserId, rated.id, 4);

      // The submitted row's contents: rated subject = the session teacher's
      // user id, rater = the caller's user id, session link, score 4 × 20.
      expect(submitted.id).toBeGreaterThan(0);
      expect(submitted.evaluatedId).toBe(actors.teacherUserId);
      expect(submitted.evaluatorId).toBe(actors.studentUserId);
      expect(submitted.sessionId).toBe(rated.id);
      expect(submitted.score).toBe(80);
      expect(submitted.createdAt).toBeInstanceOf(Date);

      // The GraphQL-facing shape carries ONLY the rated subject, the
      // rater, the session link, the score, and the creation instant.
      const keys = Object.keys(submitted).toSorted((a, b) => a.localeCompare(b));
      expect(keys).toEqual(["createdAt", "evaluatedId", "evaluatorId", "id", "score", "sessionId"]);

      expect(await countEvaluationsFor(tx, rated.id, actors.studentUserId)).toBe(1);

      // The rater reads the stored rating back on the same transaction.
      const ownList = await StudentEvaluationService.listMyTeacherEvaluations(actors.studentUserId, tx);
      expect(ownList).toHaveLength(1);
      expect(ownList[0]).toEqual(submitted);

      expectZeroLogCalls();
    });
  });

  test("score matrix — whole stars 1..5 map to 20..100 on the table's 0-100 scale", async () => {
    await runInRollback(async tx => {
      const actors = await createRatingActors(tx);
      const ratings = [1, 2, 3, 4, 5];

      // The submissions share the test's rollback transaction, so they run
      // through the sequential driver — one rate per dual-confirmed
      // session, each stored score the exact star-to-points product.
      await runSequentially(
        ratings.map(rating => async () => {
          const rated = await insertSessionRow(tx, actors, dualConfirmedOverrides());
          const submitted = await submitRating(tx, actors.studentUserId, rated.id, rating);
          expect(submitted.score).toBe(rating * 20);
          expect(await countEvaluationsFor(tx, rated.id, actors.studentUserId)).toBe(1);
        })
      );

      expectZeroLogCalls();
    });
  });

  test("denial matrix — VALIDATION: a malformed session id is denied BEFORE any database read", async () => {
    await runInRollback(async tx => {
      const actors = await createRatingActors(tx);
      const rated = await insertSessionRow(tx, actors, dualConfirmedOverrides());
      const teacherBefore = await TeacherRepository.findById(actors.teacherUserId, tx);

      // The pre-DB denial is a pure guard (no database access at all), so
      // the five malformed shapes run as one parallel batch.
      const malformedIds = [0, -5, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1];
      await Promise.all(
        malformedIds.map(malformed =>
          expectRepoError(() => submitRating(tx, actors.studentUserId, malformed, 4)).then(error => {
            expect(error).toBeInstanceOf(ValidationError);
            expectDomainDenial(error, "VALIDATION", t().validation);
            expect(validationFields(error)).toEqual([]);
            return undefined;
          })
        )
      );

      // Pre-DB proof: no eligibility probe, no insert — and zero residual
      // rows. Exactly ONE bounded denial log per attempt.
      expectDatabaseCalls(0, 0);
      expect(await countEvaluationsFor(tx, rated.id, actors.studentUserId)).toBe(0);
      expectBoundedDenialLogs("VALIDATION", "session", malformedIds.length);
      expect(await TeacherRepository.findById(actors.teacherUserId, tx)).toEqual(teacherBefore);
    });
  });

  test("denial matrix — VALIDATION: every non-whole-star rating projects exactly the rating field", async () => {
    await runInRollback(async tx => {
      const actors = await createRatingActors(tx);
      const rated = await insertSessionRow(tx, actors, dualConfirmedOverrides());
      const teacherBefore = await TeacherRepository.findById(actors.teacherUserId, tx);

      // The rejections: below the floor, above the ceiling, a fractional
      // star, the NaN shape, and a string-coerced payload that skipped the
      // boundary parse (its runtime value is NOT a number — exactly the
      // failure the guard must catch).
      const rejectedInputs: readonly EvaluationSubmitInput[] = [
        { rating: 0 },
        { rating: 6 },
        { rating: 2.5 },
        { rating: Number.NaN },
        boundarySkippingInput('{"rating":"3"}'),
      ];
      await Promise.all(
        rejectedInputs.map(rejected =>
          expectRepoError(() =>
            StudentEvaluationService.submitTeacherEvaluation(actors.studentUserId, rated.id, rejected, LOCALE, tx)
          ).then(error => {
            expect(error).toBeInstanceOf(ValidationError);
            expectDomainDenial(error, "VALIDATION", t().teacherRatingInvalid);
            expect(validationFields(error)).toEqual([
              { field: "rating", code: "TEACHER_RATING_INVALID", message: t().teacherRatingInvalid },
            ]);
            return undefined;
          })
        )
      );

      // Pre-DB proof: no eligibility probe, no insert, zero residual rows;
      // one bounded denial log per attempt, none carrying the payload.
      expectDatabaseCalls(0, 0);
      expect(await countEvaluationsFor(tx, rated.id, actors.studentUserId)).toBe(0);
      expectBoundedDenialLogs("VALIDATION", "session", rejectedInputs.length);
      for (const call of logCalls()) {
        expect(JSON.stringify(call.ctx)).not.toContain("TEACHER");
      }
      expect(await TeacherRepository.findById(actors.teacherUserId, tx)).toEqual(teacherBefore);
    });
  });

  test("denial matrix — SESSION_NOT_FOUND: a foreign student and a nonexistent id are byte-identical denials", async () => {
    await runInRollback(async tx => {
      const actors = await createRatingActors(tx);
      const foreignStudentUserId = await createSecondStudent(tx);
      const rated = await insertSessionRow(tx, actors, dualConfirmedOverrides());
      const teacherBefore = await TeacherRepository.findById(actors.teacherUserId, tx);

      const foreignError = await expectRepoError(() => submitRating(tx, foreignStudentUserId, rated.id, 4));
      expect(foreignError).toBeInstanceOf(NotFoundError);
      expectDomainDenial(foreignError, "SESSION_NOT_FOUND", t().sessionNotFound);

      const ghostError = await expectRepoError(() => submitRating(tx, foreignStudentUserId, UNKNOWN_SESSION_ID, 4));
      expect(ghostError).toBeInstanceOf(NotFoundError);
      expect(denialShape(ghostError)).toEqual(denialShape(foreignError));

      // The non-participant gained no row, and the owner's eligibility is
      // untouched (the denials never write).
      expect(await countEvaluationsFor(tx, rated.id, foreignStudentUserId)).toBe(0);
      expect(await countEvaluationsFor(tx, rated.id, actors.studentUserId)).toBe(0);
      expectBoundedDenialLogs("SESSION_NOT_FOUND", "session", 2);
      expect(await TeacherRepository.findById(actors.teacherUserId, tx)).toEqual(teacherBefore);
    });
  });

  test("denial matrix — EVALUATION_SESSION_NOT_COMPLETED: every pre-handshake state is the same typed conflict", async () => {
    await runInRollback(async tx => {
      const actors = await createRatingActors(tx);
      const stampedAt = new Date();
      const teacherBefore = await TeacherRepository.findById(actors.teacherUserId, tx);

      // The constructible states: the two pre-start states, a cancelled
      // session, a completed row with only the teacher's stamp (the real
      // handshake's waiting-for-student state), a completed row with ONLY
      // the student's stamp (impossible through the real lifecycle — the
      // student stamps last — but constructible at the row level, and the
      // gate must reject it), and a completed row with neither stamp.
      const unratableStates: readonly Partial<SessionInsertType>[] = [
        { status: SessionStatus.Scheduled },
        { status: SessionStatus.Started },
        { status: SessionStatus.Cancelled },
        { status: SessionStatus.Completed, confirmedByTeacherAt: stampedAt, confirmedByStudentAt: null },
        { status: SessionStatus.Completed, confirmedByTeacherAt: null, confirmedByStudentAt: stampedAt },
        { status: SessionStatus.Completed, confirmedByTeacherAt: null, confirmedByStudentAt: null },
      ];

      // The denials share the test's rollback transaction, so they run
      // through the sequential driver — each state is its own session row,
      // denied, and proven row-less.
      await runSequentially(
        unratableStates.map(overrides => async () => {
          const unratable = await insertSessionRow(tx, actors, overrides);
          const error = await expectRepoError(() => submitRating(tx, actors.studentUserId, unratable.id, 4));
          expect(error).toBeInstanceOf(ConflictError);
          expectDomainDenial(error, "EVALUATION_SESSION_NOT_COMPLETED", t().evaluationSessionNotCompleted);
          expect(await countEvaluationsFor(tx, unratable.id, actors.studentUserId)).toBe(0);
        })
      );

      expectBoundedDenialLogs("EVALUATION_SESSION_NOT_COMPLETED", "session", unratableStates.length);
      expect(await TeacherRepository.findById(actors.teacherUserId, tx)).toEqual(teacherBefore);
    });
  });

  test("denial matrix — EVALUATION_ALREADY_SUBMITTED: a re-submit is the typed conflict; the stored rating stays byte-identical", async () => {
    await runInRollback(async tx => {
      const actors = await createRatingActors(tx);
      const rated = await insertSessionRow(tx, actors, dualConfirmedOverrides());
      const original = await submitRating(tx, actors.studentUserId, rated.id, 4);
      // The happy write legitimately moved the cached average; the DENIAL
      // that follows must leave that post-write state byte-identical.
      const teacherBeforeDenial = await TeacherRepository.findById(actors.teacherUserId, tx);
      logSpyBox.spy?.mockClear();

      const error = await expectRepoError(() => submitRating(tx, actors.studentUserId, rated.id, 5));

      expect(error).toBeInstanceOf(ConflictError);
      expectDomainDenial(error, "EVALUATION_ALREADY_SUBMITTED", t().evaluationAlreadySubmitted);

      // Write-once, never upsert: a different rating was offered and the
      // rejected attempt left exactly one untouched row.
      expect(await countEvaluationsFor(tx, rated.id, actors.studentUserId)).toBe(1);
      const stored = await readEvaluationRow(tx, original.id);
      expect(stored).not.toBeNull();
      if (stored) {
        expect(stored.score).toBe(80);
        expect(stored.createdAt.getTime()).toBe(original.createdAt.getTime());
      }
      expectSingleBoundedDenialLog("EVALUATION_ALREADY_SUBMITTED", rated.id);
      const ctx = logCalls()[0]?.ctx;
      if (isRecord(ctx)) {
        expect(ctx.entity).toBe("session");
      }
      expect(await TeacherRepository.findById(actors.teacherUserId, tx)).toEqual(teacherBeforeDenial);
    });
  });

  test("outer-transaction propagation: a denial rolls back only its SAVEPOINT and the caller's transaction stays usable", async () => {
    await runInRollback(async tx => {
      const actors = await createRatingActors(tx);
      const first = await insertSessionRow(tx, actors, dualConfirmedOverrides());
      const second = await insertSessionRow(tx, actors, dualConfirmedOverrides());

      // The winning insert commits INTO the caller's transaction (visible
      // on it immediately, durable only when the caller commits).
      const submitted = await submitRating(tx, actors.studentUserId, first.id, 3);
      expect(await countEvaluationsFor(tx, first.id, actors.studentUserId)).toBe(1);
      const teacherBeforeDenial = await TeacherRepository.findById(actors.teacherUserId, tx);

      // The duplicate denial fails INSIDE its savepoint: the savepoint
      // rolls back, the typed conflict propagates, and the caller's
      // transaction is left fully usable.
      const duplicateError = await expectRepoError(() => submitRating(tx, actors.studentUserId, first.id, 5));
      expectDomainDenial(duplicateError, "EVALUATION_ALREADY_SUBMITTED", t().evaluationAlreadySubmitted);
      expect(await countEvaluationsFor(tx, first.id, actors.studentUserId)).toBe(1);
      expect(await TeacherRepository.findById(actors.teacherUserId, tx)).toEqual(teacherBeforeDenial);

      // The same outer transaction still accepts further work.
      const followUp = await submitRating(tx, actors.studentUserId, second.id, 2);
      expect(followUp.score).toBe(40);
      expect(await countEvaluationsFor(tx, second.id, actors.studentUserId)).toBe(1);
      expect(await readEvaluationRow(tx, submitted.id)).not.toBeNull();

      // Exactly one bounded denial log (the duplicate's) in this window.
      expectBoundedDenialLogs("EVALUATION_ALREADY_SUBMITTED", "session", 1);
    });
  });

  test("read scoping — two students each see exactly their own ratings, newest first; a third sees none", async () => {
    await runInRollback(async tx => {
      const actors = await createRatingActors(tx);
      const otherActors = await createRatingActors(tx);
      const outsiderUserId = await createSecondStudent(tx);

      // Each student rates their own session pair.
      const ownFirst = await submitRating(
        tx,
        actors.studentUserId,
        (await insertSessionRow(tx, actors, dualConfirmedOverrides())).id,
        4
      );
      const ownSecond = await submitRating(
        tx,
        actors.studentUserId,
        (await insertSessionRow(tx, actors, dualConfirmedOverrides())).id,
        2
      );
      const otherRow = await submitRating(
        tx,
        otherActors.studentUserId,
        (await insertSessionRow(tx, otherActors, dualConfirmedOverrides())).id,
        5
      );

      const ownList = await StudentEvaluationService.listMyTeacherEvaluations(actors.studentUserId, tx);
      expect(ownList).toHaveLength(2);
      for (const row of ownList) {
        expect(row.evaluatorId).toBe(actors.studentUserId);
        expect(row.evaluatedId).toBe(actors.teacherUserId);
      }
      // Newest first: every stored row in this transaction shares one
      // creation instant, so the id breaks the tie in descending order.
      expect(ownList[0]?.id).toBe(ownSecond.id);
      expect(ownList[1]?.id).toBe(ownFirst.id);
      expect(ownList.some(row => row.id === otherRow.id)).toBe(false);

      const otherList = await StudentEvaluationService.listMyTeacherEvaluations(otherActors.studentUserId, tx);
      expect(otherList).toHaveLength(1);
      expect(otherList[0]?.id).toBe(otherRow.id);
      expect(otherList[0]?.evaluatorId).toBe(otherActors.studentUserId);

      expect(await StudentEvaluationService.listMyTeacherEvaluations(outsiderUserId, tx)).toEqual([]);
      expectZeroLogCalls();
    });
  });

  test("security — write purity: zero deltas on every sibling surface", async () => {
    await runInRollback(async tx => {
      const actors = await createRatingActors(tx);
      const rated = await insertSessionRow(tx, actors, dualConfirmedOverrides());
      const actorIds = [actors.teacherUserId, actors.studentUserId];

      // Row-count snapshot of every surface the rating flow must never
      // touch, scoped to fixture ids; plus full-row snapshots of the
      // lifecycle-owned session row and both actor users.
      const [notificationsBefore, auditBefore, usersBefore, sessionBefore] = await Promise.all([
        tx.$count(notifications, inArray(notifications.userId, actorIds)),
        tx.$count(auditLogs, inArray(auditLogs.actorId, actorIds)),
        tx.select().from(users).where(inArray(users.id, actorIds)),
        readSessionRow(tx, rated.id),
      ]);

      const submitted = await submitRating(tx, actors.studentUserId, rated.id, 4);
      expect(await countEvaluationsFor(tx, rated.id, actors.studentUserId)).toBe(1);

      const [notificationsAfter, auditAfter, usersAfter, sessionAfter] = await Promise.all([
        tx.$count(notifications, inArray(notifications.userId, actorIds)),
        tx.$count(auditLogs, inArray(auditLogs.actorId, actorIds)),
        tx.select().from(users).where(inArray(users.id, actorIds)),
        readSessionRow(tx, rated.id),
      ]);

      expect(notificationsAfter).toBe(notificationsBefore);
      expect(auditAfter).toBe(auditBefore);
      expect(usersAfter).toEqual(usersBefore);
      expect(sessionAfter).toEqual(sessionBefore);

      // The read side is pure by construction: one write occurred and the
      // read-back did not move any counter either.
      expect(await StudentEvaluationService.listMyTeacherEvaluations(actors.studentUserId, tx)).toEqual([submitted]);
      expect(notificationsAfter).toBe(notificationsBefore);
      expectZeroLogCalls();
    });
  });

  test('cached average — a single 4★ rating stores exactly "4.00" on the rated teacher\'s row', async () => {
    await runInRollback(async tx => {
      const actors = await createRatingActors(tx);
      const rated = await insertSessionRow(tx, actors, dualConfirmedOverrides());
      expect((await TeacherRepository.findById(actors.teacherUserId, tx))?.averageRating).toBeNull();

      await submitRating(tx, actors.studentUserId, rated.id, 4);

      // One live rating (score 80) ⇒ the star-scale mean is exactly 4.00,
      // stored as the column's decimal string.
      expect((await TeacherRepository.findById(actors.teacherUserId, tx))?.averageRating).toBe("4.00");
      expectZeroLogCalls();
    });
  });

  test('cached average — recomputed from the live family, never incremented (seeded 60+50 ⇒ "3.50" after a 5★)', async () => {
    await runInRollback(async tx => {
      const actors = await createRatingActors(tx);
      const seedRater = await createSecondStudent(tx);

      // Two live (session-linked) ratings for the SAME teacher, scores 60
      // and 50 — the family the fresh 5★ (100) submission joins.
      const seedSessionOne = await insertSessionRow(tx, actors, dualConfirmedOverrides());
      const seedSessionTwo = await insertSessionRow(tx, actors, dualConfirmedOverrides());
      await createTestEvaluation(tx, actors.teacherUserId, seedRater, seedSessionOne.id, { score: 60 });
      await createTestEvaluation(tx, actors.teacherUserId, seedRater, seedSessionTwo.id, { score: 50 });

      const submissionSession = await insertSessionRow(tx, actors, dualConfirmedOverrides());
      await submitRating(tx, actors.studentUserId, submissionSession.id, 5);

      // (60 + 50 + 100) / 3 = 70 on the 0-100 scale ⇒ 70 / 20 = "3.50" —
      // an incremental merge onto the pre-submission state could never
      // produce this exact value.
      expect((await TeacherRepository.findById(actors.teacherUserId, tx))?.averageRating).toBe("3.50");
      expectZeroLogCalls();
    });
  });

  test("cached average — applicant evaluations (no session link) never fold into the mean", async () => {
    await runInRollback(async tx => {
      const actors = await createRatingActors(tx);
      const applicantRater = await createSecondStudent(tx);

      // An applicant-evaluation row for the same teacher: session-less,
      // score 90 — a different flow's score on the shared table.
      await createTestEvaluation(tx, actors.teacherUserId, applicantRater, null, { score: 90 });
      // One live rating (60) so the family the submission joins is exactly
      // {60}, with the applicant row present on the same teacher.
      const seedRater = await createSecondStudent(tx);
      const seedSession = await insertSessionRow(tx, actors, dualConfirmedOverrides());
      await createTestEvaluation(tx, actors.teacherUserId, seedRater, seedSession.id, { score: 60 });

      const submissionSession = await insertSessionRow(tx, actors, dualConfirmedOverrides());
      await submitRating(tx, actors.studentUserId, submissionSession.id, 4);

      // (60 + 80) / 2 / 20 = "3.50" — the applicant row's 90 never entered
      // the mean (its inclusion would read "3.83").
      expect((await TeacherRepository.findById(actors.teacherUserId, tx))?.averageRating).toBe("3.50");
      expectZeroLogCalls();
    });
  });

  test("cached average — a soft-deleted rating never folds into the mean", async () => {
    await runInRollback(async tx => {
      const actors = await createRatingActors(tx);
      const seedRater = await createSecondStudent(tx);
      const seedSession = await insertSessionRow(tx, actors, dualConfirmedOverrides());
      await createTestEvaluation(tx, actors.teacherUserId, seedRater, seedSession.id, {
        score: 100,
        isDeleted: true,
        deletedAt: new Date(),
      });

      const submissionSession = await insertSessionRow(tx, actors, dualConfirmedOverrides());
      await submitRating(tx, actors.studentUserId, submissionSession.id, 4);

      // The deleted 100 is excluded: the family is exactly the new 80 ⇒
      // "4.00" (its inclusion would read "4.50").
      expect((await TeacherRepository.findById(actors.teacherUserId, tx))?.averageRating).toBe("4.00");
      expectZeroLogCalls();
    });
  });

  test('cached average — boundary families: an all-20 family stores "1.00" and an all-100 family stores "5.00"', async () => {
    await runInRollback(async tx => {
      // All-floor family: two seeded 20s + a 1★ (20) submission ⇒ 20 / 20.
      const floorActors = await createRatingActors(tx);
      const floorRater = await createSecondStudent(tx);
      const floorSeedOne = await insertSessionRow(tx, floorActors, dualConfirmedOverrides());
      const floorSeedTwo = await insertSessionRow(tx, floorActors, dualConfirmedOverrides());
      await createTestEvaluation(tx, floorActors.teacherUserId, floorRater, floorSeedOne.id, { score: 20 });
      await createTestEvaluation(tx, floorActors.teacherUserId, floorRater, floorSeedTwo.id, { score: 20 });
      const floorSubmission = await insertSessionRow(tx, floorActors, dualConfirmedOverrides());
      await submitRating(tx, floorActors.studentUserId, floorSubmission.id, 1);
      expect((await TeacherRepository.findById(floorActors.teacherUserId, tx))?.averageRating).toBe("1.00");

      // All-ceiling family: two seeded 100s + a 5★ (100) submission ⇒ 100 / 20.
      const ceilingActors = await createRatingActors(tx);
      const ceilingRater = await createSecondStudent(tx);
      const ceilingSeedOne = await insertSessionRow(tx, ceilingActors, dualConfirmedOverrides());
      const ceilingSeedTwo = await insertSessionRow(tx, ceilingActors, dualConfirmedOverrides());
      await createTestEvaluation(tx, ceilingActors.teacherUserId, ceilingRater, ceilingSeedOne.id, { score: 100 });
      await createTestEvaluation(tx, ceilingActors.teacherUserId, ceilingRater, ceilingSeedTwo.id, { score: 100 });
      const ceilingSubmission = await insertSessionRow(tx, ceilingActors, dualConfirmedOverrides());
      await submitRating(tx, ceilingActors.studentUserId, ceilingSubmission.id, 5);
      expect((await TeacherRepository.findById(ceilingActors.teacherUserId, tx))?.averageRating).toBe("5.00");

      expectZeroLogCalls();
    });
  });
});

// ─── Production tx path (committed fixtures, undefined outerTx) ──────────

describe("StudentEvaluationService — production tx path (committed fixtures)", () => {
  let fixtureTeacherUserId = 0;
  let fixtureStudentUserId = 0;
  let secondStudentUserId = 0;
  let committedSessionId = 0;

  beforeAll(async () => {
    await db.transaction(async tx => {
      const actors = await createRatingActors(tx);
      fixtureTeacherUserId = actors.teacherUserId;
      fixtureStudentUserId = actors.studentUserId;
      secondStudentUserId = await createSecondStudent(tx);
      const committed = await insertSessionRow(tx, actors, dualConfirmedOverrides());
      committedSessionId = committed.id;
    });
    logSpyBox.spy = installLogSpy();
  });

  beforeEach(() => {
    logSpyBox.spy?.mockClear();
  });

  afterAll(async () => {
    logSpyBox.spy?.mockRestore();

    // FK-safe hard delete: rating rows → the session → the shared-PK users
    // (the users delete cascades the role-child rows). The explicit rating
    // sweep keeps the intent visible and the residue probe below honest —
    // the rater FK is RESTRICT, so the rating rows must go first.
    const fixtureUserIds = [fixtureTeacherUserId, fixtureStudentUserId, secondStudentUserId].filter(id => id > 0);
    if (fixtureUserIds.length > 0) {
      await db.delete(evaluations).where(inArray(evaluations.evaluatorId, fixtureUserIds));
    }
    if (committedSessionId > 0) {
      await db.delete(session).where(eq(session.id, committedSessionId));
    }
    if (fixtureUserIds.length > 0) {
      await db.delete(users).where(inArray(users.id, fixtureUserIds));
    }
    if (committedSessionId > 0) {
      expect(await db.$count(evaluations, eq(evaluations.sessionId, committedSessionId))).toBe(0);
    }
  });

  test("production write with NO outerTx commits one row through its own top-level transaction", async () => {
    const submitted = await StudentEvaluationService.submitTeacherEvaluation(
      fixtureStudentUserId,
      committedSessionId,
      { rating: 4 },
      LOCALE
    );

    expect(submitted.evaluatedId).toBe(fixtureTeacherUserId);
    expect(submitted.evaluatorId).toBe(fixtureStudentUserId);
    expect(submitted.sessionId).toBe(committedSessionId);
    expect(submitted.score).toBe(80);
    expect(await db.$count(evaluations, eq(evaluations.sessionId, committedSessionId))).toBe(1);
    expectZeroLogCalls();

    // The row is committed (read on the global executor), then removed so
    // the remaining cases arbitrate an ABSENT state.
    const [stored] = await db.select().from(evaluations).where(eq(evaluations.sessionId, committedSessionId));
    expect(stored?.id).toBe(submitted.id);
    await db.delete(evaluations).where(eq(evaluations.sessionId, committedSessionId));
    expect(await db.$count(evaluations, eq(evaluations.sessionId, committedSessionId))).toBe(0);
  });

  testOnRealPostgres(
    "concurrent duplicate storm: exactly one winner, one typed-conflict loser, one stored row",
    async () => {
      const outcomes = await Promise.allSettled([
        StudentEvaluationService.submitTeacherEvaluation(
          fixtureStudentUserId,
          committedSessionId,
          { rating: 5 },
          LOCALE
        ),
        StudentEvaluationService.submitTeacherEvaluation(
          fixtureStudentUserId,
          committedSessionId,
          { rating: 5 },
          LOCALE
        ),
      ]);

      const fulfilled = outcomes.flatMap(outcome => (outcome.status === "fulfilled" ? [outcome.value] : []));
      const rejected = outcomes.flatMap(outcome => (outcome.status === "rejected" ? [outcome.reason] : []));
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      const winner = fulfilled[0];
      expect(winner?.evaluatedId).toBe(fixtureTeacherUserId);
      expect(winner?.evaluatorId).toBe(fixtureStudentUserId);
      expect(winner?.sessionId).toBe(committedSessionId);
      expect(winner?.score).toBe(100);

      const loser = rejected[0];
      expect(loser).toBeInstanceOf(ConflictError);
      if (loser instanceof Error) {
        expectDomainDenial(loser, "EVALUATION_ALREADY_SUBMITTED", t().evaluationAlreadySubmitted);
      }

      expect(await db.$count(evaluations, eq(evaluations.sessionId, committedSessionId))).toBe(1);
      // Exactly ONE bounded denial log — the loser's; the winner logs nothing.
      expectSingleBoundedDenialLog("EVALUATION_ALREADY_SUBMITTED", committedSessionId);

      await db.delete(evaluations).where(eq(evaluations.sessionId, committedSessionId));
    }
  );

  test("cold read path: the rater lists their committed rating without an executor; another student's list is empty", async () => {
    const submitted = await StudentEvaluationService.submitTeacherEvaluation(
      fixtureStudentUserId,
      committedSessionId,
      { rating: 3 },
      LOCALE
    );
    logSpyBox.spy?.mockClear();

    const ownList = await StudentEvaluationService.listMyTeacherEvaluations(fixtureStudentUserId);
    expect(ownList).toHaveLength(1);
    expect(ownList[0]).toEqual(submitted);

    expect(await StudentEvaluationService.listMyTeacherEvaluations(secondStudentUserId)).toEqual([]);
    expectZeroLogCalls();

    await db.delete(evaluations).where(eq(evaluations.sessionId, committedSessionId));
  });
});

// ─── Concurrent same-teacher submissions (committed fixtures) ────────────

describe("StudentEvaluationService — concurrent same-teacher submissions (committed fixtures)", () => {
  let raceTeacherUserId = 0;
  let raceStudentOneId = 0;
  let raceStudentTwoId = 0;
  let raceStudentThreeId = 0;
  let raceSessionOneId = 0;
  let raceSessionTwoId = 0;
  let raceSessionThreeId = 0;

  beforeAll(async () => {
    await db.transaction(async tx => {
      const actors = await createRatingActors(tx);
      const rivalStudentId = await createSecondStudent(tx);
      const healingStudentId = await createSecondStudent(tx);
      raceTeacherUserId = actors.teacherUserId;
      raceStudentOneId = actors.studentUserId;
      raceStudentTwoId = rivalStudentId;
      raceStudentThreeId = healingStudentId;
      // Three dual-confirmed sessions of the SAME teacher — two for the
      // concurrent pair, one for the sequential convergence read-back.
      const first = await insertSessionRow(tx, actors, dualConfirmedOverrides());
      const second = await insertSessionRow(
        tx,
        { teacherUserId: actors.teacherUserId, studentUserId: rivalStudentId },
        dualConfirmedOverrides()
      );
      const third = await insertSessionRow(
        tx,
        { teacherUserId: actors.teacherUserId, studentUserId: healingStudentId },
        dualConfirmedOverrides()
      );
      raceSessionOneId = first.id;
      raceSessionTwoId = second.id;
      raceSessionThreeId = third.id;
    });
    logSpyBox.spy = installLogSpy();
  });

  beforeEach(() => {
    logSpyBox.spy?.mockClear();
  });

  afterAll(async () => {
    logSpyBox.spy?.mockRestore();

    // FK-safe hard delete: rating rows → the sessions → the shared-PK users
    // (the rater FK is RESTRICT, so the evaluation rows go first; the
    // residue probe makes a leaking teardown fail loudly).
    const raceSessionIds = [raceSessionOneId, raceSessionTwoId, raceSessionThreeId].filter(id => id > 0);
    const raceUserIds = [raceTeacherUserId, raceStudentOneId, raceStudentTwoId, raceStudentThreeId].filter(
      id => id > 0
    );
    if (raceSessionIds.length > 0) {
      await db.delete(evaluations).where(inArray(evaluations.sessionId, raceSessionIds));
      await db.delete(session).where(inArray(session.id, raceSessionIds));
    }
    if (raceUserIds.length > 0) {
      await db.delete(users).where(inArray(users.id, raceUserIds));
    }
    if (raceTeacherUserId > 0) {
      expect(await db.$count(evaluations, eq(evaluations.evaluatedId, raceTeacherUserId))).toBe(0);
    }
  });

  testOnRealPostgres(
    "two concurrent same-teacher submissions both commit within family bounds; the next sequential submission converges exactly",
    async () => {
      expect((await TeacherRepository.findById(raceTeacherUserId))?.averageRating).toBeNull();

      // 2★ (40) and 4★ (80) race on two sessions of the SAME teacher —
      // no unique conflict is possible (different sessions), so both
      // transactions insert, recompute, and write the cached average.
      const outcomes = await Promise.allSettled([
        StudentEvaluationService.submitTeacherEvaluation(raceStudentOneId, raceSessionOneId, { rating: 2 }, LOCALE),
        StudentEvaluationService.submitTeacherEvaluation(raceStudentTwoId, raceSessionTwoId, { rating: 4 }, LOCALE),
      ]);

      const fulfilled = outcomes.flatMap(outcome => (outcome.status === "fulfilled" ? [outcome.value] : []));
      const rejected = outcomes.flatMap(outcome => (outcome.status === "rejected" ? [outcome.reason] : []));
      expect(fulfilled).toHaveLength(2);
      expect(rejected).toHaveLength(0);
      expect(fulfilled.map(row => row.evaluatedId)).toEqual([raceTeacherUserId, raceTeacherUserId]);
      // `allSettled` preserves submission order, so the scores are read in
      // that same deterministic order.
      expect(fulfilled.map(row => row.score)).toEqual([40, 80]);

      // Both rating rows committed — and the CHECK was never violated (a
      // clamped-exceeding write would have rejected its submission).
      expect(await db.$count(evaluations, inArray(evaluations.sessionId, [raceSessionOneId, raceSessionTwoId]))).toBe(
        2
      );

      // Under READ COMMITTED each recompute sees some valid subset of the
      // two-row family, so the stored value is one of the exact subset
      // means — 40/20, (40+80)/2/20, 80/20 — never double-counted, never
      // outside the family's bounds.
      const stored = await TeacherRepository.findById(raceTeacherUserId);
      const storedRating = stored?.averageRating;
      if (typeof storedRating !== "string") {
        throw new Error("cached average not stored as a decimal string (read-back integrity failure)");
      }
      expect(storedRating).toMatch(/^\d\.\d{2}$/);
      expect(Number(storedRating)).toBeGreaterThanOrEqual(2);
      expect(Number(storedRating)).toBeLessThanOrEqual(4);
      expect(["2.00", "3.00", "4.00"]).toContain(storedRating);
      expectZeroLogCalls();

      // The next sequential submission recomputes from the full committed
      // family: (40 + 80 + 100) / 3 / 20 = "3.67" — the self-healing
      // property of the recompute-from-source contract.
      const healing = await StudentEvaluationService.submitTeacherEvaluation(
        raceStudentThreeId,
        raceSessionThreeId,
        { rating: 5 },
        LOCALE
      );
      expect(healing.score).toBe(100);
      expect((await TeacherRepository.findById(raceTeacherUserId))?.averageRating).toBe("3.67");
    }
  );
});

// ─── Source pins (the import/log hygiene contract, text-level) ───────────

describe("StudentEvaluationService — source pins", () => {
  const serviceSource = readFileSync(join(import.meta.dir, "student-evaluation.service.ts"), "utf8");
  const specifiers = (serviceSource.match(/from "[^"]+"/g) ?? []).map(clause =>
    clause.replace(/^from "/, "").replace(/"$/, "")
  );

  test("source: the rating surface NEVER imports the notification or audit engines", () => {
    expect(/NotificationEngine/.test(serviceSource)).toBe(false);
    expect(/AuditService/.test(serviceSource)).toBe(false);
    // No transitive escape hatch either: no import specifier may even point
    // at the notification or audit surfaces.
    for (const specifier of specifiers) {
      expect(/notifications|audit/i.test(specifier)).toBe(false);
    }
  });

  test("source: imports are a pinned allowlist — one transaction helper, shared guards, no other surface", () => {
    const allowedSpecifiers: ReadonlySet<string> = new Set([
      "@/backend/db/repo",
      "@/backend/enum/scheduling/session-status.enum",
      "@/backend/lib/db/with-transaction",
      "@/backend/lib/errors",
      "@/backend/lib/logger",
      "@/backend/services/classes/session-lifecycle.guards",
      "@/backend/services/shared",
      "@/backend/types",
      "@/shared/locale/server-graphql",
    ]);
    for (const specifier of specifiers) {
      expect(allowedSpecifiers.has(specifier)).toBe(true);
    }

    // The ONLY cross-surface-shaped import is the shared tx helper; the
    // repository barrel is reachable ONLY by the rating-surface repos: the
    // evaluation surface plus the teacher row its aggregation maintains.
    const txHelperImports = specifiers.filter(specifier => specifier.includes("@/backend/lib/db/"));
    expect(new Set(txHelperImports)).toEqual(new Set(["@/backend/lib/db/with-transaction"]));
    const barrelImport = /import \{([^}]+)\} from "@\/backend\/db\/repo";/.exec(serviceSource);
    const barrelMembers = barrelImport?.[1] ?? "";
    expect(
      new Set(
        barrelMembers
          .split(",")
          .map(member => member.trim())
          .filter(member => member.length > 0)
      )
    ).toEqual(new Set(["EvaluationRepository", "SessionRepository", "TeacherRepository"]));
  });

  test("source: zero dynamic imports, zero console.*, zero raw process.env reads, zero type assertions", () => {
    expect(serviceSource.match(/\bimport\s*\(/g) ?? []).toEqual([]);
    expect(serviceSource.match(/\brequire\s*\(/g) ?? []).toEqual([]);
    expect(/console\./.test(serviceSource)).toBe(false);
    expect(/process\.env/.test(serviceSource)).toBe(false);
    expect(/\b as (?:[A-Z]|unknown\b)/.test(serviceSource)).toBe(false);
  });

  test("source: no module-level mutable state and no object spread (member-by-member mapping only)", () => {
    expect(/\blet\b/.test(serviceSource)).toBe(false);
    expect(/\bvar\b/.test(serviceSource)).toBe(false);
    expect(/\.\.\./.test(serviceSource)).toBe(false);
  });

  test("source: no service-layer types file and no locally-declared exported types", () => {
    expect(existsSync(join(import.meta.dir, "student-evaluation.service.types.ts"))).toBe(false);
    expect(/^[ \t]*export (?:interface|type)\b/m.exec(serviceSource) ?? []).toEqual([]);
  });

  test("source: comments carry zero plan artifacts (no requirement ids, no plan/task references)", () => {
    expect(/REQ-\d/.test(serviceSource)).toBe(false);
    expect(/Task \d/.test(serviceSource)).toBe(false);
    expect(/tasks\.md|plan\.md|milestone_3_parent_portal_admin_governance|plan-review/.test(serviceSource)).toBe(false);
  });
});
