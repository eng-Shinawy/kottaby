/**
 * RecitationRecordService tests — the write-once record + participant read
 * of a session, against the live `kottaby_test` PostgreSQL instance on REAL
 * repositories.
 *
 * Per `backend/db/test/AGENTS.md` (the DB-backed service-test rules the
 * sibling suites apply):
 *  - Every transactional case runs inside `runInRollback`; `tx` is handed
 *    to the service as its outer transaction (the service's documented test
 *    path — the flow executes on a SAVEPOINT of the caller's transaction).
 *  - The production-path block (own top-level transaction per call, the
 *    undefined-outerTx arm) uses COMMITTED fixtures with tracked hard
 *    deletes, mirroring the sibling chaos-block conventions.
 *  - Entities are created ONLY via `entity-setup.ts` helpers plus the
 *    file-local shared-PK helpers — never seed data.
 *  - NO `expect(...).rejects.toThrow()` — every denial goes through
 *    `expectRepoError`; typed denials are asserted through the
 *    `DomainError.code` contract plus the exact translated message.
 *
 * Coverage map:
 *  - Tier 1 (branch/statement): the happy write + owner/participant
 *    read-back on a started session; the full denial matrix with byte-exact
 *    classes + codes (`VALIDATION`, `FORBIDDEN`, `SESSION_NOT_FOUND`,
 *    `RECITATION_SESSION_NOT_WRITEABLE`, `RECITATION_ALREADY_EXISTS`) and
 *    exact translated messages.
 *  - Tier 2 (boundary): name at 0/1/255/256 chars, whitespace-only,
 *    unicode/RTL content; description null vs empty vs whitespace vs
 *    2000/2001; the field projection names every offending field; session-id
 *    fuzz (0, negative, fractional, NaN, beyond the safe-integer ceiling)
 *    denied `VALIDATION` BEFORE any database read on the write path and
 *    collapsed to `null` pre-DB on the read path — the int4-overflow ids
 *    beyond the session column's ceiling included (repository spies prove
 *    no read fires).
 *  - Tier 3 (chaos): governance fuzz (deleted/blocked/suspended/absent
 *    callers denied pre-transaction — the session lookup is never reached);
 *    status fuzz (scheduled/cancelled denied; started/completed/disputed
 *    admitted); rollback purity via a file-local trigger that raises on the
 *    record insert (the raw failure surfaces untouched, zero residual rows,
 *    a retry succeeds); the committed-fixture block exercises the
 *    production transaction path including the concurrent double-write race
 *    (exactly one winner, one typed-conflict loser, one stored row).
 *  - Tier 4 (security): foreign-teacher ≡ nonexistent-id byte-identical
 *    denials; the participant predicate reads the DB row only; write-purity
 *    row-count/row-snapshot oracles over every sibling surface; the denial
 *    log contract (exactly one bounded `logDomainError` entry per denial,
 *    zero on happy/collapse paths, never the submitted payload content).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/backend/db";
import { RecitationRepository, SessionRepository, UserRepository } from "@/backend/db/repo";
import { auditLogs } from "@/backend/db/schema/audit/audit-logs";
import { teacherTransaction } from "@/backend/db/schema/billing/teacher-transaction";
import { wallet } from "@/backend/db/schema/billing/wallet";
import { recitation } from "@/backend/db/schema/classes/recitation";
import { session } from "@/backend/db/schema/classes/session";
import { notifications } from "@/backend/db/schema/notifications/notifications";
import { students } from "@/backend/db/schema/students/students";
import { teacher } from "@/backend/db/schema/teachers/teacher";
import { users } from "@/backend/db/schema/users/users";
import { createTestStudent, createTestUser } from "@/backend/db/test/entity-setup";
import { hasPostgresErrorCode } from "@/backend/db/test/pg-error";
import { expectRepoError, runInRollback } from "@/backend/db/test/test-utils";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import { ConflictError, DomainError, ForbiddenError, NotFoundError, ValidationError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import { RecitationRecordService } from "@/backend/services/classes/recitation.service";
import type {
  ApiFieldErrorType,
  DBTransaction,
  RecitationSelectType,
  SessionInsertType,
  SessionRecitationSubmitInput,
  SessionSelectType,
} from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import { isPgliteProvider } from "@/test/helpers/skip-when-pglite";

const testOnRealPostgres = isPgliteProvider() ? test.skip : test;

/** The tests run on the default locale throughout. */
const LOCALE = "en";

/** PostgreSQL error code for `raise_exception` (the atomicity trigger probe). */
const PG_RAISE_EXCEPTION = "P0001";

/**
 * A name at the exact column ceiling (`varchar(255)`) — Arabic script, so
 * the boundary probe doubles as the unicode/RTL acceptance content.
 */
const NAME_AT_CEILING = "أ".repeat(255);

/** The over-ceiling name — one Arabic character past the column limit. */
const NAME_OVER_CEILING = "أ".repeat(256);

/** Free-form notes at the exact text ceiling (accepted verbatim). */
const DESCRIPTION_AT_CEILING = "م".repeat(2000);

/** Free-form notes one character past the ceiling (rejected). */
const DESCRIPTION_OVER_CEILING = "م".repeat(2001);

/**
 * Unicode/RTL submission content with inner spacing — stored verbatim, so
 * the acceptance probes prove no normalization beyond edge-trimming.
 */
const UNICODE_NAME = "سورة البقرة — مراجعة 2 🌙";
const UNICODE_DESCRIPTION = "Recited with tajweed review\ttwo corrections on madd rules.";

/**
 * The started lifecycle state, widened to the session row's raw status union
 * so helper-level comparisons stay primitive-to-primitive (the guards-module
 * widening idiom).
 */
const STARTED_STATUS: string = SessionStatus.Started;

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
    spyOn(SessionRepository, "findById"),
    spyOn(RecitationRepository, "insertOnce"),
    spyOn(RecitationRepository, "findBySessionId"),
    spyOn(UserRepository, "findById"),
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

/** Shared-PK ids for one session pair (session.teacher_id / session.student_id). */
interface SessionActors {
  teacherUserId: number;
  studentUserId: number;
  studentId: number;
}

/** Shared-PK `teacher` row insert for a previously-created user. */
async function createTestTeacherRow(tx: DBTransaction, userId: number): Promise<void> {
  await tx.insert(teacher).values({ id: userId, isApproved: true });
}

/** Creates one certified teacher + one student pair with shared-PK rows. */
async function createRecitationActors(tx: DBTransaction): Promise<SessionActors> {
  const teacherUser = await createTestUser(tx, { role: "teacher" });
  await createTestTeacherRow(tx, teacherUser.id);
  const studentUser = await createTestUser(tx, { role: "student" });
  const student = await createTestStudent(tx, studentUser.id);
  return { teacherUserId: teacherUser.id, studentUserId: studentUser.id, studentId: student.id };
}

/**
 * Direct session-row insert for test preconditions (full column control —
 * lifecycle states a booking cannot start from, e.g. completed/disputed).
 */
async function insertSessionRow(
  tx: DBTransaction,
  actors: SessionActors,
  overrides: Partial<SessionInsertType> = {}
): Promise<SessionSelectType> {
  const [row] = await tx
    .insert(session)
    .values({
      teacherId: actors.teacherUserId,
      studentId: actors.studentId,
      status: SessionStatus.Scheduled,
      fee: "10.00",
      feeHeld: true,
      startedAt: overrides.status === undefined || overrides.status === STARTED_STATUS ? new Date() : null,
      ...overrides,
    })
    .returning();
  if (!row) {
    throw new Error("insertSessionRow: insert returned no rows");
  }
  return row;
}

/** Independent read-back oracle: the full session row (NOT via the service). */
async function readSessionRow(executor: DBTransaction, sessionId: number): Promise<SessionSelectType | null> {
  const [row] = await executor.select().from(session).where(eq(session.id, sessionId));
  return row ?? null;
}

/** Independent read-back oracle: the recitation row straight from the table. */
async function readRecitationRow(executor: DBTransaction, sessionId: number): Promise<RecitationSelectType | null> {
  const [row] = await executor.select().from(recitation).where(eq(recitation.sessionId, sessionId));
  return row ?? null;
}

/** Counts the recitation rows of one session (the 1:1 row-count oracle). */
async function countRecitationRows(executor: DBTransaction, sessionId: number): Promise<number> {
  return executor.$count(recitation, eq(recitation.sessionId, sessionId));
}

/** An integer id that cannot exist as a `session` row for the given executor. */
async function absentSessionId(executor: Pick<DBTransaction, "select">): Promise<number> {
  const [row] = await executor.select({ maxId: sql<number>`coalesce(max(${session.id}), 0)::int` }).from(session);
  return (row?.maxId ?? 0) + 1_000_000;
}

/** An integer id that cannot exist as a `users` row during this transaction. */
async function absentUserId(tx: DBTransaction): Promise<number> {
  const [row] = await tx.select({ maxId: sql<number>`coalesce(max(${users.id}), 0)::int` }).from(users);
  return (row?.maxId ?? 0) + 1_000_000;
}

/** Walks the Drizzle cause chain for a PostgreSQL SQLSTATE code. */

/** The service's write call, pinned to the test transaction + locale. */
function writeRecord(
  tx: DBTransaction,
  teacherUserId: number,
  sessionId: number,
  input: SessionRecitationSubmitInput
): Promise<RecitationSelectType> {
  return RecitationRecordService.setSessionRecitation(teacherUserId, sessionId, input, LOCALE, tx);
}

/** The service's read call, pinned to the test transaction + locale. */
function readRecord(tx: DBTransaction, callerUserId: number, sessionId: number) {
  return RecitationRecordService.getSessionRecitation(callerUserId, sessionId, tx);
}

// ─── Transactional write pipeline (runInRollback) ────────────────────────

describe("RecitationRecordService — transactional write pipeline (runInRollback)", () => {
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

  /** Asserts the repository spies recorded EXACTLY the given call counts. */
  function expectRepositoryCalls(findById: number, insertOnce: number, findBySessionId: number): void {
    expect(repositorySpies[0]?.mock.calls).toHaveLength(findById);
    expect(repositorySpies[1]?.mock.calls).toHaveLength(insertOnce);
    expect(repositorySpies[2]?.mock.calls).toHaveLength(findBySessionId);
  }

  test("happy write: the owning teacher records a started session and reads the row back (zero logs)", async () => {
    await runInRollback(async tx => {
      const actors = await createRecitationActors(tx);
      const started = await insertSessionRow(tx, actors, { status: SessionStatus.Started });
      const input: SessionRecitationSubmitInput = {
        name: UNICODE_NAME,
        description: UNICODE_DESCRIPTION,
      };

      const written = await writeRecord(tx, actors.teacherUserId, started.id, input);

      expect(written.id).toBeGreaterThan(0);
      expect(written.sessionId).toBe(started.id);
      expect(written.name).toBe(input.name);
      expect(written.description).toBe(input.description);
      expect(written.createdAt).toBeInstanceOf(Date);
      expect(written.updatedAt).toBeInstanceOf(Date);
      expect(await countRecitationRows(tx, started.id)).toBe(1);

      // Both participants read the stored record; the row shape is the
      // table's select shape verbatim.
      const teacherView = await readRecord(tx, actors.teacherUserId, started.id);
      const studentView = await readRecord(tx, actors.studentUserId, started.id);
      expect(teacherView).toEqual(written);
      expect(studentView).toEqual(written);

      expectZeroLogCalls();
    });
  });

  test("denial matrix — VALIDATION: a malformed session id is denied BEFORE any database read", async () => {
    await runInRollback(async tx => {
      const actors = await createRecitationActors(tx);
      const started = await insertSessionRow(tx, actors, { status: SessionStatus.Started });

      // The pre-DB denial is a pure guard (no database access at all), so
      // the five malformed shapes run as one parallel batch.
      const malformedIds = [0, -5, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1];
      await Promise.all(
        malformedIds.map(malformed =>
          expectRepoError(() =>
            RecitationRecordService.setSessionRecitation(
              actors.teacherUserId,
              malformed,
              { name: "valid name", description: null },
              LOCALE,
              tx
            )
          ).then(error => {
            expect(error).toBeInstanceOf(ValidationError);
            expectDomainDenial(error, "VALIDATION", t().validation);
            return undefined;
          })
        )
      );

      // Pre-DB proof: no session lookup, no governance probe, no insert —
      // and zero residual rows. Exactly ONE bounded denial log per attempt.
      expectRepositoryCalls(0, 0, 0);
      expect(await countRecitationRows(tx, started.id)).toBe(0);
      expectBoundedDenialLogs("VALIDATION", "session", malformedIds.length);
    });
  });

  test("denial matrix — VALIDATION: payload violations project the offending fields by name", async () => {
    await runInRollback(async tx => {
      const actors = await createRecitationActors(tx);

      // Both offenders at once: the projection carries BOTH fields, in
      // whitelist order, with the localized message — never the content.
      const bothOffending: SessionRecitationSubmitInput = {
        name: "   ",
        description: DESCRIPTION_OVER_CEILING,
      };
      const bothError = await expectRepoError(() =>
        RecitationRecordService.setSessionRecitation(actors.teacherUserId, 1, bothOffending, LOCALE, tx)
      );
      expect(bothError).toBeInstanceOf(ValidationError);
      expectDomainDenial(bothError, "VALIDATION", t().validation);
      expect(validationFields(bothError)).toEqual([
        { field: "name", code: "NAME_REQUIRED", message: t().validation },
        { field: "description", code: "DESCRIPTION_TOO_LONG", message: t().validation },
      ]);

      // A whitespace-only name alone projects exactly the name field.
      const nameError = await expectRepoError(() =>
        RecitationRecordService.setSessionRecitation(
          actors.teacherUserId,
          1,
          { name: "\n\t ", description: null },
          LOCALE,
          tx
        )
      );
      expectDomainDenial(nameError, "VALIDATION", t().validation);
      expect(validationFields(nameError)).toEqual([{ field: "name", code: "NAME_REQUIRED", message: t().validation }]);

      // Pre-DB proof + one bounded denial log per attempt (two here) — the
      // payload content is never logged.
      expectRepositoryCalls(0, 0, 0);
      expectBoundedDenialLogs("VALIDATION", "recitation", 2);
      expect(JSON.stringify(logCalls())).not.toContain(DESCRIPTION_OVER_CEILING.slice(0, 40));
    });
  });

  test("denial matrix — FORBIDDEN: a governed caller is denied before the transaction opens", async () => {
    await runInRollback(async tx => {
      const actors = await createRecitationActors(tx);
      const started = await insertSessionRow(tx, actors, { status: SessionStatus.Started });
      await tx.update(users).set({ suspended: true }).where(eq(users.id, actors.teacherUserId));

      const error = await expectRepoError(() =>
        writeRecord(tx, actors.teacherUserId, started.id, { name: "governed write", description: null })
      );

      expect(error).toBeInstanceOf(ForbiddenError);
      expectDomainDenial(error, "FORBIDDEN", t().forbidden);

      // Pre-transaction proof: the governance probe was the ONLY database
      // read — the session lookup and the insert were never reached.
      expect(repositorySpies[0]?.mock.calls).toHaveLength(0);
      expect(repositorySpies[1]?.mock.calls).toHaveLength(0);
      expect(await countRecitationRows(tx, started.id)).toBe(0);
      expectSingleBoundedDenialLog("FORBIDDEN", actors.teacherUserId);
    });
  });

  test("denial matrix — SESSION_NOT_FOUND: a foreign teacher and a nonexistent id are byte-identical denials", async () => {
    await runInRollback(async tx => {
      const actors = await createRecitationActors(tx);
      const foreignActors = await createRecitationActors(tx);
      const started = await insertSessionRow(tx, actors, { status: SessionStatus.Started });
      const ghostId = await absentSessionId(tx);

      const foreignError = await expectRepoError(() =>
        writeRecord(tx, foreignActors.teacherUserId, started.id, { name: "foreign write", description: null })
      );
      expect(foreignError).toBeInstanceOf(NotFoundError);
      expectDomainDenial(foreignError, "SESSION_NOT_FOUND", t().sessionNotFound);

      const ghostError = await expectRepoError(() =>
        writeRecord(tx, foreignActors.teacherUserId, ghostId, { name: "foreign write", description: null })
      );
      expect(denialShape(ghostError)).toEqual(denialShape(foreignError));

      expect(await countRecitationRows(tx, started.id)).toBe(0);
      expectBoundedDenialLogs("SESSION_NOT_FOUND", "session", 2);
    });
  });

  test("denial matrix — SESSION_NOT_FOUND: an id beyond the int4 ceiling collapses before any database read", async () => {
    await runInRollback(async tx => {
      const actors = await createRecitationActors(tx);
      const started = await insertSessionRow(tx, actors, { status: SessionStatus.Started });

      // 2^31 is a positive safe integer the session table's int4 primary
      // key can never store — SQL would answer it with a driver-level
      // out-of-range failure, so the write path collapses it to the
      // byte-identical session-not-found denial BEFORE the database read.
      const ceilingError = await expectRepoError(() =>
        writeRecord(tx, actors.teacherUserId, 2_147_483_648, { name: "beyond int4", description: null })
      );
      expect(ceilingError).toBeInstanceOf(NotFoundError);
      expectDomainDenial(ceilingError, "SESSION_NOT_FOUND", t().sessionNotFound);

      // Pre-DB proof: no session lookup, no insert — and zero residual rows.
      expectRepositoryCalls(0, 0, 0);
      expect(await countRecitationRows(tx, started.id)).toBe(0);
      expectSingleBoundedDenialLog("SESSION_NOT_FOUND", 2_147_483_648);
    });
  });

  test("denial matrix — RECITATION_SESSION_NOT_WRITEABLE: a scheduled session cannot receive a record", async () => {
    await runInRollback(async tx => {
      const actors = await createRecitationActors(tx);
      const scheduled = await insertSessionRow(tx, actors, { status: SessionStatus.Scheduled });

      const error = await expectRepoError(() =>
        writeRecord(tx, actors.teacherUserId, scheduled.id, { name: "too early", description: null })
      );

      expect(error).toBeInstanceOf(ConflictError);
      expectDomainDenial(error, "RECITATION_SESSION_NOT_WRITEABLE", t().recitationSessionNotWriteable);

      expect(await countRecitationRows(tx, scheduled.id)).toBe(0);
      expectSingleBoundedDenialLog("RECITATION_SESSION_NOT_WRITEABLE", scheduled.id);
    });
  });

  test("denial matrix — RECITATION_ALREADY_EXISTS: a repeat write is the typed conflict; the stored record stays byte-identical", async () => {
    await runInRollback(async tx => {
      const actors = await createRecitationActors(tx);
      const started = await insertSessionRow(tx, actors, { status: SessionStatus.Started });
      const original = await writeRecord(tx, actors.teacherUserId, started.id, {
        name: "original record",
        description: "the first submission",
      });
      logSpyBox.spy?.mockClear();

      const error = await expectRepoError(() =>
        writeRecord(tx, actors.teacherUserId, started.id, {
          name: "hostile overwrite",
          description: null,
        })
      );

      expect(error).toBeInstanceOf(ConflictError);
      expectDomainDenial(error, "RECITATION_ALREADY_EXISTS", t().recitationAlreadyExists);

      // Write-once, never upsert: a different payload was offered and the
      // rejected attempt left exactly one untouched record.
      expect(await countRecitationRows(tx, started.id)).toBe(1);
      expect(await readRecitationRow(tx, started.id)).toEqual(original);
      expectSingleBoundedDenialLog("RECITATION_ALREADY_EXISTS", started.id);
      const ctx = logCalls()[0]?.ctx;
      if (isRecord(ctx)) {
        expect(ctx.entity).toBe("recitation");
      }
    });
  });

  test("boundary — name at 0/1/255/256 chars, whitespace-only, unicode/RTL content", async () => {
    await runInRollback(async tx => {
      const actors = await createRecitationActors(tx);

      // Rejections (pre-DB, no session needed): empty and over-ceiling —
      // a pure-guard batch, no database access at all.
      const rejectedNames = ["", NAME_OVER_CEILING];
      await Promise.all(
        rejectedNames.map(rejectedName =>
          expectRepoError(() =>
            RecitationRecordService.setSessionRecitation(
              actors.teacherUserId,
              1,
              { name: rejectedName, description: null },
              LOCALE,
              tx
            )
          ).then(error => {
            expectDomainDenial(error, "VALIDATION", t().validation);
            return undefined;
          })
        )
      );
      // One bounded denial log per rejected payload; the window then clears
      // so the acceptance probes below prove the happy path logs nothing.
      expectBoundedDenialLogs("VALIDATION", "recitation", rejectedNames.length);
      logSpyBox.spy?.mockClear();

      // Acceptances: 1 char, exactly 255 chars (unicode/RTL), stored
      // verbatim — one recorded session per accepted payload.
      const oneCharSession = await insertSessionRow(tx, actors, { status: SessionStatus.Started });
      const oneChar = await writeRecord(tx, actors.teacherUserId, oneCharSession.id, {
        name: "م",
        description: null,
      });
      expect(oneChar.name).toBe("م");

      const ceilingSession = await insertSessionRow(tx, actors, { status: SessionStatus.Started });
      const atCeiling = await writeRecord(tx, actors.teacherUserId, ceilingSession.id, {
        name: NAME_AT_CEILING,
        description: null,
      });
      expect(atCeiling.name).toBe(NAME_AT_CEILING);
      expect(atCeiling.name).toHaveLength(255);
      expectZeroLogCalls();
    });
  });

  test("boundary — description null vs empty vs whitespace vs 2000/2001 chars", async () => {
    await runInRollback(async tx => {
      const actors = await createRecitationActors(tx);

      // NULL and empty-after-trim normalize to the stored NULL; exactly
      // 2000 chars is accepted verbatim.
      const nullSession = await insertSessionRow(tx, actors, { status: SessionStatus.Started });
      const nullCase = await writeRecord(tx, actors.teacherUserId, nullSession.id, {
        name: "null notes",
        description: null,
      });
      expect(nullCase.description).toBeNull();

      const emptySession = await insertSessionRow(tx, actors, { status: SessionStatus.Started });
      const emptyCase = await writeRecord(tx, actors.teacherUserId, emptySession.id, {
        name: "empty notes",
        description: "   ",
      });
      expect(emptyCase.description).toBeNull();

      const ceilingSession = await insertSessionRow(tx, actors, { status: SessionStatus.Started });
      const ceilingCase = await writeRecord(tx, actors.teacherUserId, ceilingSession.id, {
        name: "ceiling notes",
        description: DESCRIPTION_AT_CEILING,
      });
      expect(ceilingCase.description).toBe(DESCRIPTION_AT_CEILING);

      // One char past the ceiling is rejected with the description field
      // named — and nothing written.
      const overSession = await insertSessionRow(tx, actors, { status: SessionStatus.Started });
      const overError = await expectRepoError(() =>
        RecitationRecordService.setSessionRecitation(
          actors.teacherUserId,
          overSession.id,
          { name: "over notes", description: DESCRIPTION_OVER_CEILING },
          LOCALE,
          tx
        )
      );
      expectDomainDenial(overError, "VALIDATION", t().validation);
      expect(validationFields(overError)).toEqual([
        { field: "description", code: "DESCRIPTION_TOO_LONG", message: t().validation },
      ]);
      expect(await countRecitationRows(tx, overSession.id)).toBe(0);
      // The three accepted writes logged nothing; the window's single
      // bounded entry is the over-ceiling denial's.
      expectBoundedDenialLogs("VALIDATION", "recitation", 1);
    });
  });

  test("boundary — sessionId fuzz collapses the READ to null before any database read", async () => {
    await runInRollback(async tx => {
      await Promise.all(
        [0, -1, 2.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1].map(malformed =>
          readRecord(tx, 1, malformed).then(row => expect(row).toBeNull())
        )
      );
      // Pre-DB proof: no session lookup and no recitation lookup fired.
      expectRepositoryCalls(0, 0, 0);
      expectZeroLogCalls();
    });
  });

  test("boundary — an int4-overflow session id collapses the READ to null before any database read", async () => {
    await runInRollback(async tx => {
      // A positive safe integer beyond the session column's int4 ceiling
      // can never match a row; handed to SQL it would die as a
      // driver-level out-of-range failure — so it collapses to the same
      // `null` as every other malformed id.
      await Promise.all(
        [2_147_483_648, 4_294_967_296].map(overflow => readRecord(tx, 1, overflow).then(row => expect(row).toBeNull()))
      );
      // Pre-DB proof: no session lookup and no recitation lookup fired.
      expectRepositoryCalls(0, 0, 0);
      expectZeroLogCalls();
    });
  });

  test("chaos — governance fuzz (deleted/blocked/suspended/absent) denies pre-tx with zero writes", async () => {
    await runInRollback(async tx => {
      const actors = await createRecitationActors(tx);
      const started = await insertSessionRow(tx, actors, { status: SessionStatus.Started });
      const deleted = await createTestUser(tx, { role: "teacher" });
      const blocked = await createTestUser(tx, { role: "teacher" });
      const suspended = await createTestUser(tx, { role: "teacher" });
      await tx.update(users).set({ isDeleted: true }).where(eq(users.id, deleted.id));
      await tx.update(users).set({ isBlocked: true }).where(eq(users.id, blocked.id));
      await tx.update(users).set({ suspended: true }).where(eq(users.id, suspended.id));
      const absentId = await absentUserId(tx);

      // The governance denial is a read-only probe (one SELECT, then the
      // typed FORBIDDEN), so the four cases run as one parallel batch with
      // their zero-writes oracles folded into each case's own chain.
      const governedIds = [deleted.id, blocked.id, suspended.id, absentId];
      await Promise.all(
        governedIds.map(governedId =>
          expectRepoError(() =>
            RecitationRecordService.setSessionRecitation(
              governedId,
              started.id,
              { name: "governed write", description: null },
              LOCALE,
              tx
            )
          ).then(async error => {
            expect(error).toBeInstanceOf(ForbiddenError);
            expectDomainDenial(error, "FORBIDDEN", t().forbidden);
            return undefined;
          })
        )
      );

      // Pre-transaction proof: the clean session was never looked up and
      // nothing was written; each denial logged exactly one bounded entry.
      expect(repositorySpies[0]?.mock.calls).toHaveLength(0);
      expect(repositorySpies[1]?.mock.calls).toHaveLength(0);
      expect(await countRecitationRows(tx, started.id)).toBe(0);
      expect(logCalls()).toHaveLength(governedIds.length);
      for (const call of logCalls()) {
        if (isRecord(call.ctx)) {
          expect(call.ctx.code).toBe("FORBIDDEN");
        }
      }
    });
  });

  test("chaos — status fuzz: cancelled denied; started/completed/disputed admitted", async () => {
    await runInRollback(async tx => {
      const actors = await createRecitationActors(tx);

      const cancelled = await insertSessionRow(tx, actors, { status: SessionStatus.Cancelled });
      const cancelledError = await expectRepoError(() =>
        writeRecord(tx, actors.teacherUserId, cancelled.id, { name: "never happened", description: null })
      );
      expectDomainDenial(cancelledError, "RECITATION_SESSION_NOT_WRITEABLE", t().recitationSessionNotWriteable);
      expect(await countRecitationRows(tx, cancelled.id)).toBe(0);

      // A record records what HAPPENED: every state that left the booking
      // window admits exactly one record. The admissible rows are inserted
      // as one batch, then recorded and counted per session.
      const admittedRows = await Promise.all(
        [SessionStatus.Started, SessionStatus.Completed, SessionStatus.Disputed].map(status =>
          insertSessionRow(tx, actors, { status })
        )
      );
      await Promise.all(
        admittedRows.map(async admitted => {
          const written = await writeRecord(tx, actors.teacherUserId, admitted.id, {
            name: `record for ${admitted.status}`,
            description: null,
          });
          expect(written.sessionId).toBe(admitted.id);
          expect(await countRecitationRows(tx, admitted.id)).toBe(1);
        })
      );
    });
  });

  test("chaos — rollback purity: a forced insert failure leaves ZERO residual rows and a retry succeeds", async () => {
    await runInRollback(async tx => {
      const actors = await createRecitationActors(tx);
      const started = await insertSessionRow(tx, actors, { status: SessionStatus.Started });

      // Chaos injection: a transactional trigger raises on record inserts
      // for THIS session only. The DDL lives inside the rolled-back test
      // transaction — nothing leaks into the shared database.
      const failFn = `raise_recitation_insert_fail_${randomUUID().slice(0, 8).replaceAll("-", "_")}`;
      const failTrigger = `fail_recitation_insert_${randomUUID().slice(0, 8).replaceAll("-", "_")}`;
      await tx.execute(
        sql.raw(
          `CREATE FUNCTION ${failFn}() RETURNS trigger LANGUAGE plpgsql AS $fn$ ` +
            `BEGIN RAISE EXCEPTION 'forced recitation-insert failure (atomicity probe)'; END; $fn$;`
        )
      );
      await tx.execute(
        sql.raw(
          `CREATE TRIGGER ${failTrigger} BEFORE INSERT ON recitation FOR EACH ROW ` +
            `WHEN (NEW.session_id = ${started.id}) EXECUTE FUNCTION ${failFn}()`
        )
      );

      const error = await expectRepoError(() =>
        writeRecord(tx, actors.teacherUserId, started.id, { name: "doomed record", description: null })
      );

      // The raw database failure surfaced untouched (no DomainError
      // masking, no swallowed catch).
      expect(error).not.toBeInstanceOf(DomainError);
      expect(hasPostgresErrorCode(error, PG_RAISE_EXCEPTION)).toBe(true);

      // Atomicity proof: zero residual rows, and the pre-DB denials' logs
      // are the only entries (no denial log for a raw failure).
      expect(await countRecitationRows(tx, started.id)).toBe(0);
      expectZeroLogCalls();

      // Drop the trigger (same transaction): the pipeline retries green.
      await tx.execute(sql.raw(`DROP TRIGGER ${failTrigger} ON recitation`));
      const retried = await writeRecord(tx, actors.teacherUserId, started.id, {
        name: "recovered record",
        description: null,
      });
      expect(retried.sessionId).toBe(started.id);
      expect(await countRecitationRows(tx, started.id)).toBe(1);
      expectZeroLogCalls();
    });
  });

  test("security — the participant predicate reads the DB row only", async () => {
    await runInRollback(async tx => {
      const actors = await createRecitationActors(tx);
      const outsider = await createTestUser(tx, { role: "parent" });
      const started = await insertSessionRow(tx, actors, { status: SessionStatus.Started });
      const stored = await writeRecord(tx, actors.teacherUserId, started.id, {
        name: "participant predicate",
        description: null,
      });

      // Both participants read; a non-participant caller collapses to the
      // SAME null as a nonexistent id — the row's participant ids are the
      // predicate's only truth (no identity argument exists to smuggle).
      expect(await readRecord(tx, actors.teacherUserId, started.id)).toEqual(stored);
      expect(await readRecord(tx, actors.studentUserId, started.id)).toEqual(stored);
      expect(await readRecord(tx, outsider.id, started.id)).toBeNull();
      const ghostId = await absentSessionId(tx);
      expect(await readRecord(tx, actors.teacherUserId, ghostId)).toBeNull();

      // The write side mirrors the row-only predicate: a non-owner is the
      // not-found denial, never a participant-specific error.
      const writeError = await expectRepoError(() =>
        writeRecord(tx, outsider.id, started.id, { name: "outsider", description: null })
      );
      expectDomainDenial(writeError, "SESSION_NOT_FOUND", t().sessionNotFound);
      // The window's only bounded log is the non-owner denial's — the
      // participant reads above logged nothing.
      expectBoundedDenialLogs("SESSION_NOT_FOUND", "session", 1);
    });
  });

  test("security — write purity: zero deltas on every sibling surface", async () => {
    await runInRollback(async tx => {
      const actors = await createRecitationActors(tx);
      const started = await insertSessionRow(tx, actors, { status: SessionStatus.Started });
      const actorIds = [actors.teacherUserId, actors.studentUserId];

      // Row-count snapshot of every surface the record surface must never
      // touch, scoped to fixture ids; plus full-row snapshots of the
      // lifecycle-owned session row and the funding student's lanes.
      const [
        notificationsBefore,
        auditBefore,
        teacherRowsBefore,
        walletsBefore,
        ledgerBefore,
        usersBefore,
        lanesBefore,
        sessionBefore,
      ] = await Promise.all([
        tx.$count(notifications, inArray(notifications.userId, actorIds)),
        tx.$count(auditLogs, inArray(auditLogs.actorId, actorIds)),
        tx.$count(teacher, eq(teacher.id, actors.teacherUserId)),
        tx.$count(wallet, eq(wallet.teacherId, actors.teacherUserId)),
        tx.$count(teacherTransaction, eq(teacherTransaction.sessionId, started.id)),
        tx.select().from(users).where(inArray(users.id, actorIds)),
        tx
          .select({ trial: students.balanceTrial, hifz: students.balanceHifz, tajweed: students.balanceTajweed })
          .from(students)
          .where(eq(students.id, actors.studentId)),
        readSessionRow(tx, started.id),
      ]);

      const written = await writeRecord(tx, actors.teacherUserId, started.id, {
        name: "pure write",
        description: "nothing else moves",
      });
      expect(await countRecitationRows(tx, started.id)).toBe(1);

      const [
        notificationsAfter,
        auditAfter,
        teacherRowsAfter,
        walletsAfter,
        ledgerAfter,
        usersAfter,
        lanesAfter,
        sessionAfter,
      ] = await Promise.all([
        tx.$count(notifications, inArray(notifications.userId, actorIds)),
        tx.$count(auditLogs, inArray(auditLogs.actorId, actorIds)),
        tx.$count(teacher, eq(teacher.id, actors.teacherUserId)),
        tx.$count(wallet, eq(wallet.teacherId, actors.teacherUserId)),
        tx.$count(teacherTransaction, eq(teacherTransaction.sessionId, started.id)),
        tx.select().from(users).where(inArray(users.id, actorIds)),
        tx
          .select({ trial: students.balanceTrial, hifz: students.balanceHifz, tajweed: students.balanceTajweed })
          .from(students)
          .where(eq(students.id, actors.studentId)),
        readSessionRow(tx, started.id),
      ]);

      expect(notificationsAfter).toBe(notificationsBefore);
      expect(auditAfter).toBe(auditBefore);
      expect(teacherRowsAfter).toBe(teacherRowsBefore);
      expect(walletsAfter).toBe(walletsBefore);
      expect(ledgerAfter).toBe(ledgerBefore);
      expect(usersAfter).toEqual(usersBefore);
      expect(lanesAfter).toEqual(lanesBefore);
      expect(sessionAfter).toEqual(sessionBefore);

      // The read side is pure by construction: one write occurred and the
      // participant read did not move any counter either.
      expect(await readRecord(tx, actors.studentUserId, started.id)).toEqual(written);
      expect(notificationsAfter).toBe(notificationsBefore);
      expectZeroLogCalls();
    });
  });
});

// ─── Production tx path (committed fixtures, undefined outerTx) ──────────

describe("RecitationRecordService — production tx path (committed fixtures)", () => {
  let fixtureTeacherUserId = 0;
  let fixtureStudentUserId = 0;
  let committedSessionId = 0;

  const RACE_INPUT: SessionRecitationSubmitInput = {
    name: "concurrent double-submit",
    description: "The unique constraint is the arbiter.",
  };

  beforeAll(async () => {
    await db.transaction(async tx => {
      const actors = await createRecitationActors(tx);
      fixtureTeacherUserId = actors.teacherUserId;
      fixtureStudentUserId = actors.studentUserId;
      const committed = await insertSessionRow(tx, actors, { status: SessionStatus.Started });
      committedSessionId = committed.id;
    });
    logSpyBox.spy = installLogSpy();
  });

  beforeEach(() => {
    logSpyBox.spy?.mockClear();
  });

  afterAll(async () => {
    logSpyBox.spy?.mockRestore();

    // FK-safe hard delete: records → the session → the shared-PK users
    // (the users delete cascades the role-child rows). The record rows
    // cascade with their session; the explicit sweep keeps the intent
    // visible and the residue probe below honest.
    if (committedSessionId > 0) {
      await db.delete(recitation).where(eq(recitation.sessionId, committedSessionId));
      await db.delete(session).where(eq(session.id, committedSessionId));
    }
    const fixtureUserIds = [fixtureTeacherUserId, fixtureStudentUserId].filter(id => id > 0);
    if (fixtureUserIds.length > 0) {
      await db.delete(users).where(inArray(users.id, fixtureUserIds));
    }
    if (committedSessionId > 0) {
      expect(await db.$count(recitation, eq(recitation.sessionId, committedSessionId))).toBe(0);
    }
  });

  test("production write with NO outerTx commits one row through its own top-level transaction", async () => {
    const written = await RecitationRecordService.setSessionRecitation(
      fixtureTeacherUserId,
      committedSessionId,
      { name: "production-path record", description: "no executor handed over — the service owns the transaction" },
      LOCALE
    );

    expect(written.sessionId).toBe(committedSessionId);
    expect(await db.$count(recitation, eq(recitation.sessionId, committedSessionId))).toBe(1);
    expectZeroLogCalls();

    // The row is committed (read on the global executor), then removed so
    // the remaining cases arbitrate an ABSENT state.
    const [stored] = await db.select().from(recitation).where(eq(recitation.sessionId, committedSessionId));
    expect(stored?.id).toBe(written.id);
    await db.delete(recitation).where(eq(recitation.sessionId, committedSessionId));
    expect(await db.$count(recitation, eq(recitation.sessionId, committedSessionId))).toBe(0);
  });

  testOnRealPostgres(
    "concurrent double write: exactly one winner, one typed-conflict loser, one stored row",
    async () => {
      const attempts = await Promise.allSettled([
        RecitationRecordService.setSessionRecitation(fixtureTeacherUserId, committedSessionId, RACE_INPUT, LOCALE),
        RecitationRecordService.setSessionRecitation(fixtureTeacherUserId, committedSessionId, RACE_INPUT, LOCALE),
      ]);

      const fulfilled = attempts.flatMap(outcome => (outcome.status === "fulfilled" ? [outcome.value] : []));
      const rejected = attempts.flatMap(outcome => (outcome.status === "rejected" ? [outcome.reason] : []));
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      const winner = fulfilled[0];
      expect(winner?.sessionId).toBe(committedSessionId);
      expect(winner?.name).toBe(RACE_INPUT.name);
      expect(winner?.description).toBe(RACE_INPUT.description);

      const loser = rejected[0];
      expect(loser).toBeInstanceOf(ConflictError);
      if (loser instanceof Error) {
        expectDomainDenial(loser, "RECITATION_ALREADY_EXISTS", t().recitationAlreadyExists);
      }

      expect(await db.$count(recitation, eq(recitation.sessionId, committedSessionId))).toBe(1);
      // Exactly ONE bounded denial log — the loser's; the winner logs nothing.
      expectSingleBoundedDenialLog("RECITATION_ALREADY_EXISTS", committedSessionId);

      await db.delete(recitation).where(eq(recitation.sessionId, committedSessionId));
    }
  );

  test("cold read path: participant reads the committed record without an executor; a foreign caller reads null", async () => {
    const written = await RecitationRecordService.setSessionRecitation(
      fixtureTeacherUserId,
      committedSessionId,
      { name: "cold-read record", description: null },
      LOCALE
    );
    logSpyBox.spy?.mockClear();

    expect(await RecitationRecordService.getSessionRecitation(fixtureTeacherUserId, committedSessionId)).toEqual(
      written
    );
    expect(await RecitationRecordService.getSessionRecitation(fixtureStudentUserId, committedSessionId)).toEqual(
      written
    );
    const ghostId = await absentSessionId(db);
    expect(await RecitationRecordService.getSessionRecitation(fixtureTeacherUserId, ghostId)).toBeNull();
    expectZeroLogCalls();

    await db.delete(recitation).where(eq(recitation.sessionId, committedSessionId));
  });
});

// ─── Source pins (the import/log hygiene contract, text-level) ───────────

describe("RecitationRecordService — source pins", () => {
  const serviceSource = readFileSync(join(import.meta.dir, "recitation.service.ts"), "utf8");
  const specifiers = (serviceSource.match(/from "[^"]+"/g) ?? []).map(clause =>
    clause.replace(/^from "/, "").replace(/"$/, "")
  );

  test("source: the record surface NEVER imports the notification or audit engines", () => {
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
      "@/backend/services/classes/session-lifecycle.governance",
      "@/backend/services/classes/session-lifecycle.guards",
      "@/backend/services/shared",
      "@/backend/types",
      "@/shared/locale/server-graphql",
    ]);
    for (const specifier of specifiers) {
      expect(allowedSpecifiers.has(specifier)).toBe(true);
    }

    // The ONLY cross-surface-shaped import is the shared tx helper; the
    // repository barrel is reachable ONLY by the two record-surface repos.
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
    ).toEqual(new Set(["RecitationRepository", "SessionRepository"]));
  });

  test("source: zero dynamic imports, zero console.*, zero raw process.env reads", () => {
    expect(serviceSource.match(/\bimport\s*\(/g) ?? []).toEqual([]);
    expect(serviceSource.match(/\brequire\s*\(/g) ?? []).toEqual([]);
    expect(/console\./.test(serviceSource)).toBe(false);
    expect(/process\.env/.test(serviceSource)).toBe(false);
  });

  test("source: no service-layer types file and no locally-declared exported types", () => {
    expect(existsSync(join(import.meta.dir, "recitation.service.types.ts"))).toBe(false);
    expect(/^[ \t]*export (?:interface|type)\b/m.exec(serviceSource) ?? []).toEqual([]);
  });
});
