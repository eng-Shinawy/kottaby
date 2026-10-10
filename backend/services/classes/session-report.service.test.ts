/**
 * SessionReportService — 4-tier suite (branch / boundary / chaos / security)
 * for the session-report WRITE surface (`submitSessionReport`) and the READ
 * surface (`getSessionReport` / `getSessionHomework`).
 *
 * Per `backend/db/test/AGENTS.md` + `backend/services/AGENTS.md` (mirrors the
 * `session-report-notification.test.ts` sibling):
 *  - Tiers 1/2/4 + the read surface run inside `runInRollback`; `tx` is handed
 *    to the service as its `outerTx` (the composed/test path) and to every
 *    direct Drizzle query.
 *  - Tier 3 needs REAL commit boundaries (concurrent submissions on separate
 *    connections, publish-after-commit, total-rollback proofs), so it
 *    provisions its cast in ONE committing `beforeAll` transaction through the
 *    REAL session-lifecycle path (book → start → complete, the σ setup) and
 *    hard-deletes it in `afterAll` via `TrackedFixtures` (Rule 9).
 *  - Error assertions use the `expectRepoError` try/catch helper — NEVER
 *    `expect(...).rejects.toThrow()`.
 *  - Fan-out is spied (`SpiedFanoutTransport`) and the idempotency claim cache
 *    is an in-memory map injected through the `options` seam — no Redis, no
 *    WebSocket.
 *  - Entity rows come from `entity-setup.ts` helpers.
 *  - Count-delta oracles (REQ-044): the report surface is wallet-pure — the
 *    students escrow lanes, `session.fee_held`, the teacher's `wallet` row
 *    count, and the `teacher_transaction` ledger count NEVER move because of
 *    a report submission (asserted per tier, scoped to fixture ids).
 *
 * Coverage map:
 *  - Tier 1 (branch): every gate denial in isolation (governed teacher ⇒
 *    FORBIDDEN; unknown session; foreign owner; wrong status for each of
 *    scheduled/started/cancelled/disputed ⇒ SESSION_INVALID_TRANSITION;
 *    duplicate submit ⇒ SESSION_REPORT_ALREADY_EXISTS with zero new
 *    notification rows and a silent transport; pre-existing assignment
 *    without a report ⇒ the home_work arbiter's settle-together mapping) —
 *    each denial leaving ZERO rows in `reports`/`home_work`/`notifications`
 *    and exactly ONE bounded domain log; happy paths with and without the
 *    homework block; the first-session grade no-op (previousGrades absent
 *    and present-with-null-target) and the prior-but-graded history's
 *    newest-row write-once CONFLICT; the inserted row returned with exact
 *    fields.
 *  - Tier 2 (boundary): the full payload at ALL validator bounds passing once
 *    (rating 0 and 5, grades 0 and 100, 2000-char notes, fromAyah = toAyah);
 *    jadid-only / madi-only / both assignment blocks.
 *  - Tier 3 (chaos, committed): double-submit STORM — N concurrent
 *    submissions for the same completed session on separate connections ⇒
 *    EXACTLY one success, N−1 SESSION_REPORT_ALREADY_EXISTS conflicts, ONE
 *    reports row, ONE home_work row, ONE student + ONE parent notification
 *    row; repeated ×3 with recorded identical summaries (determinism
 *    evidence); a mid-storm participant read never throws (full row or
 *    null); forced mid-tx failure after the report insert ⇒ total rollback
 *    including notification rows, zero publishes; already-graded re-grade ⇒
 *    typed CONFLICT with the localized homeworkAlreadyGraded copy.
 *  - Tier 4 (security): smuggle-shaped inputs (extra id/sessionId/teacherId/
 *    createdAt keys at input AND assignment level + grade keys on the
 *    assignment) are dropped — the inserted rows carry ONLY the intended
 *    columns; the governed-teacher denial precedes ANY DB write (proved
 *    against a gate that would deny differently); foreign-teacher vs
 *    unknown-session denials compared field-by-field (constructor, code,
 *    message, extensions) in BOTH locales.
 *  - Read surface (2.8): participant pair reads hit (teacher AND student,
 *    report AND homework); non-participant teacher/student/parent/admin
 *    collapse to EXACTLY null on both readers; unknown id ⇒ null with the
 *    foreign-null and unknown-null observably identical (byte identity);
 *    enumeration probe over foreign vs nonexistent ids; hostile-id matrix ⇒
 *    pre-DB VALIDATION; read purity (zero writes, zero log lines); default
 *    pool-path reads over committed rows; read under concurrent submission
 *    (mid-storm).
 *  - Homework write surface: the newest-row routing pin — a student
 *    holding TWO ungraded rows receives the previousGrades on the NEWEST
 *    prior row only (the grading probe has no grade predicate); source
 *    pin — HomeWorkRepository.insertHomeWork has exactly ONE production
 *    call site, inside the report transaction's homework composite, so no
 *    report-less homework creation path exists.
 *
 * Run:
 *   bun run test/scripts/run-test.ts backend/services/classes/session-report.service.test.ts
 */

import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { count, eq, inArray } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { db } from "@/backend/db";
import { HomeWorkRepository } from "@/backend/db/repo";
import { homeWork } from "@/backend/db/schema/classes/home-work";
import { reports } from "@/backend/db/schema/classes/reports";
import { session } from "@/backend/db/schema/classes/session";
import { sessionRequestIdempotency } from "@/backend/db/schema/classes/session-request-idempotency";
import { notifications } from "@/backend/db/schema/notifications";
import { parents } from "@/backend/db/schema/parents/parents";
import { students } from "@/backend/db/schema/students/students";
import { teacher } from "@/backend/db/schema/teachers/teacher";
import { users } from "@/backend/db/schema/users/users";
import {
  createTestAdmin,
  createTestHomeWork,
  createTestParent,
  createTestSession,
  createTestSessionReport,
  createTestStudent,
  createTestTeacherRow,
  createTestUser,
} from "@/backend/db/test/entity-setup";
import { expectRepoError, runInRollback } from "@/backend/db/test/test-utils";
import { SessionIntent } from "@/backend/enum/scheduling/session-intent.enum";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import { SurahJuzRef } from "@/backend/enum/shared/surah-juz-ref.enum";
import { ConflictError, DomainError, ForbiddenError, NotFoundError, ValidationError } from "@/backend/lib/errors";
import { type DomainErrorContext, logger } from "@/backend/lib/logger";
import { SessionLifecycleService } from "@/backend/services/classes/session-lifecycle.service";
import * as SessionReportService from "@/backend/services/classes/session-report.service";
import type { NotificationEngineCallOptions } from "@/backend/services/notifications";
import type { NotificationIdempotencyClaimCache } from "@/backend/services/notifications/emit-idempotency";
import type {
  DBTransaction,
  HomeWorkAssignInput,
  HomeWorkBlockInput,
  HomeWorkReturnType,
  ReportReturnType,
  SessionReportSubmitInput,
  SessionSelectType,
} from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import {
  countTeacherTransactionsForTeacher,
  countWalletsForTeacher,
  SpiedFanoutTransport,
  TrackedFixtures,
} from "@/test/workflows/helpers";

/** English translated error copy — denial assertions pin translated substrings. */
const ERRORS_EN = getServerTranslations("en").errorsTranslations;
/** Arabic translated error copy — the locale-threading probe pins the ar copy. */
const ERRORS_AR = getServerTranslations("ar").errorsTranslations;

/** The request locale every submission rides unless a test pins another. */
const LOCALE = "en";

/** Valid free-text notes reused by accepted submissions. */
const VALID_NOTES = "Steady recitation; the revision plan continues next lesson.";

/** The cohesive homework blocks of the standard submission (Jadid + Madi). */
const JADID_BLOCK: HomeWorkBlockInput = { fromAyah: 1, toAyah: 7, surahJuz: SurahJuzRef.SurahAlFatihah };
const MADI_BLOCK: HomeWorkBlockInput = { fromAyah: 1, toAyah: 5, surahJuz: SurahJuzRef.Juz1 };

/** Session id far beyond any identity sequence — guaranteed absent. */
const ABSENT_SESSION_ID = 2_000_000_000;

/** Highest storable int4 value — a valid-shape session id guaranteed absent. */
const INT4_MAX_SESSION_ID = 2_147_483_647;

/** Storm width for the Tier-3 double-submit race (N ≥ 4 per tasks.md). */
const STORM_N = 4;

/** The `reports` select-shape keys (TS property names), locale-sorted. */
const REPORT_ROW_KEYS = [
  "createdAt",
  "id",
  "sessionId",
  "studentRatingByTeacher",
  "teacherNotes",
  "updatedAt",
] as const;

/** Sorted key set of any row object — the exact-columns pin for read-backs. */
function sortedKeysOf(row: object): string[] {
  return Object.keys(row).toSorted((a, b) => a.localeCompare(b));
}

/** BOPLA-tamper base input: a typed submission whose fields tests override. */
function baseSubmitInput(overrides: Partial<SessionReportSubmitInput> = {}): SessionReportSubmitInput {
  return { teacherNotes: VALID_NOTES, studentRatingByTeacher: 4, ...overrides };
}

/** One recorded domain-log call (code/entity/entityId — copy never asserted from logs). */
interface DomainLogRecord {
  readonly code: string;
  readonly entity: string;
  readonly entityId: string | number | undefined;
}

/**
 * Installs a recording stub over `logger.logDomainError` so domain logs stay
 * silent in test output AND become countable. Callers MUST `stop()`
 * (use try/finally).
 */
function recordDomainLogs(): { records: DomainLogRecord[]; stop: () => void } {
  const records: DomainLogRecord[] = [];
  const spy = spyOn(logger, "logDomainError").mockImplementation((_message: string, ctx?: DomainErrorContext) => {
    records.push({
      code: ctx?.code ?? "<missing>",
      entity: ctx?.entity ?? "<missing>",
      entityId: ctx?.entityId,
    });
  });
  return { records, stop: () => spy.mockRestore() };
}

/**
 * Map-backed claim cache with SET-NX-EX semantics — the same in-memory double
 * the sibling suites inject through the engine `options` seam.
 */
class MapBackedClaimCache implements NotificationIdempotencyClaimCache {
  private readonly entries = new Map<string, string>();
  readonly claimedKeys: string[] = [];

  async claim(key: string, _ttlSeconds: number): Promise<boolean> {
    this.claimedKeys.push(key);
    if (this.entries.has(key)) {
      return false;
    }
    this.entries.set(key, "");
    return true;
  }

  async store(key: string, value: string, _ttlSeconds: number): Promise<void> {
    this.entries.set(key, value);
  }

  async get(key: string): Promise<string | null> {
    return this.entries.get(key) ?? null;
  }
}

/** Fresh engine options (spy transport + fresh cache) for one submission call. */
function freshEngineOptions(): {
  options: NotificationEngineCallOptions;
  transport: SpiedFanoutTransport;
  cache: MapBackedClaimCache;
} {
  const transport = new SpiedFanoutTransport();
  const cache = new MapBackedClaimCache();
  return { options: { transport, cache }, transport, cache };
}

/** Type-honest unboxing of the suite's own cache from injected options. */
function cacheOf(options: NotificationEngineCallOptions): MapBackedClaimCache {
  const cache = options.cache;
  if (!(cache instanceof MapBackedClaimCache)) {
    throw new Error("expected the injected cache to be the suite's MapBackedClaimCache");
  }
  return cache;
}

/** Narrows a caught denial to the typed `DomainError` family or fails loudly. */
function requireDomainError(error: Error, expectedClass: new (...args: never[]) => DomainError): DomainError {
  expect(error).toBeInstanceOf(expectedClass);
  if (!(error instanceof DomainError)) {
    throw new Error(`expected a ${expectedClass.name} (got ${error.name}: ${error.message})`);
  }
  return error;
}

/** Asserts a caught denial carries EXACTLY `code` and the translated copy. */
function assertDenial(error: DomainError, code: string, translated: string): void {
  expect(error.code).toBe(code);
  expect(error.message).toContain(translated);
}

/**
 * Field-by-field identity of two thrown denials — the oracle-collapse pin:
 * constructor, error name, extensions code, translated message, and the
 * serialized extensions bag are ALL equal.
 */
function assertIdenticalDenialShape(first: Error, second: Error): void {
  expect(second.constructor).toBe(first.constructor);
  expect(second.name).toBe(first.name);
  const firstDomain = requireDomainError(first, DomainError);
  const secondDomain = requireDomainError(second, DomainError);
  expect(secondDomain.code).toBe(firstDomain.code);
  expect(secondDomain.message).toBe(firstDomain.message);
  expect(JSON.stringify(secondDomain.extensions)).toBe(JSON.stringify(firstDomain.extensions));
}

/** One report fixture: the parent, the student (optionally linked), the teacher, and a session. */
interface ReportCast {
  readonly sessionRow: SessionSelectType;
  readonly studentUserId: number;
  readonly parentUserId: number;
  readonly teacherUserId: number;
}

interface ReportCastInput {
  readonly linkedParent?: boolean;
  /** Session status override (default `completed` — the reportable state). */
  readonly status?: SessionStatus;
  /** Pre-seeds the teacher user's governance state (the governed-teacher arm). */
  readonly blockedTeacher?: boolean;
}

/**
 * Provisions the parent, the student (linked only when asked), the teacher
 * (+ role row), and a session between them inside the caller's tx. The
 * session defaults to the reportable `completed` state with its stamps set.
 */
async function provisionReportCast(tx: DBTransaction, input: ReportCastInput = {}): Promise<ReportCast> {
  const parentUser = await createTestUser(tx, { role: "parent", locale: "ar" });
  await createTestParent(tx, parentUser.id);

  const studentUser = await createTestUser(tx, { locale: "en" });
  await createTestStudent(tx, studentUser.id, input.linkedParent === true ? { parentId: parentUser.id } : {});

  const teacherUser = await createTestUser(tx, {
    role: "teacher",
    locale: "en",
    ...(input.blockedTeacher === true ? { isBlocked: true } : {}),
  });
  // The `teacher` role row MUST exist in BOTH arms: `session.teacher_id` FKs
  // the teacher table (the governed cast's own session row needs that FK
  // satisfied), while the governance denial keys on the USER row's
  // `isBlocked` flag (`assertActorGovernanceClean` reads `users`, never
  // `teacher`).
  await createTestTeacherRow(tx, teacherUser.id);

  const completedStamps =
    input.status === undefined || input.status === SessionStatus.Completed
      ? { startedAt: new Date(), endedAt: new Date(), confirmedByTeacherAt: new Date() }
      : {};
  const sessionRow = await createTestSession(tx, teacherUser.id, studentUser.id, {
    ...(input.status === undefined ? { status: SessionStatus.Completed } : { status: input.status }),
    ...completedStamps,
  });
  return {
    sessionRow,
    studentUserId: studentUser.id,
    parentUserId: parentUser.id,
    teacherUserId: teacherUser.id,
  };
}

/** Scoped notification row-count oracle (tx or db executor), never a whole table. */
async function countNotificationsFor(executor: DBTransaction | typeof db, userIds: readonly number[]): Promise<number> {
  const [row] = await executor
    .select({ value: count() })
    .from(notifications)
    .where(inArray(notifications.userId, [...userIds]));
  return row?.value ?? 0;
}

/** Scoped `reports` row count for the given sessions (tx or db executor). */
async function countReportRowsFor(executor: DBTransaction | typeof db, sessionIds: readonly number[]): Promise<number> {
  const [row] = await executor
    .select({ value: count() })
    .from(reports)
    .where(inArray(reports.sessionId, [...sessionIds]));
  return row?.value ?? 0;
}

/** Scoped `home_work` row count for the given sessions (tx or db executor). */
async function countHomeWorkRowsFor(
  executor: DBTransaction | typeof db,
  sessionIds: readonly number[]
): Promise<number> {
  const [row] = await executor
    .select({ value: count() })
    .from(homeWork)
    .where(inArray(homeWork.sessionId, [...sessionIds]));
  return row?.value ?? 0;
}

/** Reads the student's escrow lanes straight from the row (tx or db executor). */
async function readStudentLanes(
  executor: DBTransaction | typeof db,
  studentId: number
): Promise<{ trial: number | null; hifz: number | null }> {
  const [row] = await executor
    .select({ trial: students.balanceTrial, hifz: students.balanceHifz })
    .from(students)
    .where(eq(students.id, studentId));
  if (!row) {
    throw new Error(`fixture integrity failure: students row ${String(studentId)} vanished`);
  }
  return row;
}

/** Session id guaranteed absent inside the caller's transactional view. */
async function absentSessionId(tx: DBTransaction): Promise<number> {
  const [row] = await tx.select({ maxId: count() }).from(session);
  return (row?.maxId ?? 0) + 1_000_000;
}

/** Direct read of one session's report row (independent read-back oracle). */
async function reportRowBySessionId(
  executor: DBTransaction | typeof db,
  sessionId: number
): Promise<ReportReturnType | null> {
  const rows = await executor.select().from(reports).where(eq(reports.sessionId, sessionId));
  return rows.at(0) ?? null;
}

/** Direct read of one session's homework row (independent read-back oracle). */
async function homeworkRowBySessionId(
  executor: DBTransaction | typeof db,
  sessionId: number
): Promise<HomeWorkReturnType | null> {
  const rows = await executor.select().from(homeWork).where(eq(homeWork.sessionId, sessionId));
  return rows.at(0) ?? null;
}

/** Asserts a denial attempt left ZERO rows in the three touched tables. */
async function expectZeroReportSideEffects(
  tx: DBTransaction,
  sessionIds: readonly number[],
  recipientIds: readonly number[]
): Promise<void> {
  expect(await countReportRowsFor(tx, sessionIds)).toBe(0);
  expect(await countHomeWorkRowsFor(tx, sessionIds)).toBe(0);
  expect(await countNotificationsFor(tx, recipientIds)).toBe(0);
}

/**
 * Raw-tx fault probe (the journey step-11 mechanism): a recording Proxy around
 * a REAL transaction handle. Every member forwards verbatim, except (a)
 * `transaction` re-wraps its savepoint handle so the probe stays in the path
 * for the service's whole transactional window, and (b) the `home_work` INSERT
 * is replaced by a thrown raw failure — AFTER the `reports` INSERT executed —
 * emulating a constraint/IO failure mid-unit. No production flag, no service
 * seam: the injection lives entirely in this wrapper.
 */
function faultProbeTx(
  tx: DBTransaction,
  counters: { reportInserts: number; homeworkInsertAttempts: number }
): DBTransaction {
  return new Proxy(tx, {
    get(target, property): unknown {
      if (property === "insert") {
        return (table: PgTable): unknown => {
          if (table === reports) {
            counters.reportInserts += 1;
          }
          if (table === homeWork) {
            counters.homeworkInsertAttempts += 1;
            throw new Error("forced home_work insert failure after the report insert");
          }
          return target.insert(table);
        };
      }
      if (property === "transaction") {
        return (scoped: (inner: DBTransaction) => Promise<unknown>): Promise<unknown> =>
          target.transaction(inner => scoped(faultProbeTx(inner, counters)));
      }
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

// ─── Tier 1: write denials in isolation + happy paths (runInRollback) ───────

describe("Tier 1 — submitSessionReport denials in isolation + happy paths", () => {
  test("governed teacher ⇒ FORBIDDEN before any DB work; zero rows; exactly one bounded log", async () => {
    await runInRollback(async tx => {
      const cast = await provisionReportCast(tx, { linkedParent: true, blockedTeacher: true });
      const { options, transport } = freshEngineOptions();
      const logs = recordDomainLogs();
      try {
        const error = await expectRepoError(() =>
          SessionReportService.submitSessionReport(
            cast.teacherUserId,
            cast.sessionRow.id,
            baseSubmitInput(),
            LOCALE,
            tx,
            options
          )
        );
        const denial = requireDomainError(error, ForbiddenError);
        assertDenial(denial, "FORBIDDEN", ERRORS_EN.forbidden);

        // ZERO rows anywhere + the single governance log (code/entity/entityId).
        await expectZeroReportSideEffects(tx, [cast.sessionRow.id], [cast.studentUserId, cast.parentUserId]);
        expect(logs.records).toEqual([{ code: "FORBIDDEN", entity: "session", entityId: cast.teacherUserId }]);
        expect(transport.publishCount).toBe(0);
      } finally {
        logs.stop();
      }
    });
  });

  test("unknown session ⇒ typed SESSION_NOT_FOUND; zero rows; exactly one bounded log", async () => {
    await runInRollback(async tx => {
      const cast = await provisionReportCast(tx, { linkedParent: true });
      const missingId = await absentSessionId(tx);
      const { options, transport } = freshEngineOptions();
      const logs = recordDomainLogs();
      try {
        const error = await expectRepoError(() =>
          SessionReportService.submitSessionReport(
            cast.teacherUserId,
            missingId,
            baseSubmitInput(),
            LOCALE,
            tx,
            options
          )
        );
        const denial = requireDomainError(error, NotFoundError);
        assertDenial(denial, "SESSION_NOT_FOUND", ERRORS_EN.sessionNotFound);

        await expectZeroReportSideEffects(tx, [cast.sessionRow.id], [cast.studentUserId, cast.parentUserId]);
        expect(logs.records).toEqual([{ code: "SESSION_NOT_FOUND", entity: "session", entityId: missingId }]);
        expect(transport.publishCount).toBe(0);
      } finally {
        logs.stop();
      }
    });
  });

  test("foreign owner ⇒ the SAME NotFound denial as an unknown session; zero rows", async () => {
    await runInRollback(async tx => {
      const cast = await provisionReportCast(tx, { linkedParent: true });
      const foreignTeacher = await createTestUser(tx, { role: "teacher", locale: "en" });
      await createTestTeacherRow(tx, foreignTeacher.id);
      const { options, transport } = freshEngineOptions();
      const logs = recordDomainLogs();
      try {
        const error = await expectRepoError(() =>
          SessionReportService.submitSessionReport(
            foreignTeacher.id,
            cast.sessionRow.id,
            baseSubmitInput(),
            LOCALE,
            tx,
            options
          )
        );
        const denial = requireDomainError(error, NotFoundError);
        assertDenial(denial, "SESSION_NOT_FOUND", ERRORS_EN.sessionNotFound);

        await expectZeroReportSideEffects(tx, [cast.sessionRow.id], [cast.studentUserId, cast.parentUserId]);
        expect(logs.records).toEqual([{ code: "SESSION_NOT_FOUND", entity: "session", entityId: cast.sessionRow.id }]);
        expect(transport.publishCount).toBe(0);
      } finally {
        logs.stop();
      }
    });
  });

  test("wrong status for each of scheduled/started/cancelled/disputed ⇒ SESSION_INVALID_TRANSITION; zero rows", async () => {
    await runInRollback(async tx => {
      const cast = await provisionReportCast(tx, { linkedParent: true });
      const wrongStatuses = [
        SessionStatus.Scheduled,
        SessionStatus.Started,
        SessionStatus.Cancelled,
        SessionStatus.Disputed,
      ];
      const wrongSessions = await Promise.all(
        wrongStatuses.map(status => createTestSession(tx, cast.teacherUserId, cast.studentUserId, { status }))
      );

      const logs = recordDomainLogs();
      try {
        // One independent denial per status (fan-out — each targets its own session).
        const errors = await Promise.all(
          wrongSessions.map(wrongSession =>
            expectRepoError(() =>
              SessionReportService.submitSessionReport(
                cast.teacherUserId,
                wrongSession.id,
                baseSubmitInput(),
                LOCALE,
                tx,
                freshEngineOptions().options
              )
            )
          )
        );
        for (const error of errors) {
          const denial = requireDomainError(error, ConflictError);
          assertDenial(denial, "SESSION_INVALID_TRANSITION", ERRORS_EN.sessionInvalidTransition);
        }

        // ZERO rows in reports/home_work/notifications for ALL five sessions.
        const allSessionIds = [cast.sessionRow.id, ...wrongSessions.map(row => row.id)];
        await expectZeroReportSideEffects(tx, allSessionIds, [cast.studentUserId, cast.parentUserId]);
        // Exactly one bounded log per denial — the gate classified each status.
        expect(logs.records.map(record => record.code).toSorted((a, b) => a.localeCompare(b))).toEqual(
          wrongStatuses.map(() => "SESSION_INVALID_TRANSITION")
        );
        expect(new Set(logs.records.map(record => record.entityId))).toEqual(new Set(wrongSessions.map(row => row.id)));
      } finally {
        logs.stop();
      }
    });
  });

  test("duplicate submit ⇒ SESSION_REPORT_ALREADY_EXISTS; zero NEW notification rows; transport replays nothing", async () => {
    await runInRollback(async tx => {
      const cast = await provisionReportCast(tx, { linkedParent: true });
      const first = freshEngineOptions();

      // Seed submission — accepted, 2 receipt rows, 2 publishes, 2 claims.
      await SessionReportService.submitSessionReport(
        cast.teacherUserId,
        cast.sessionRow.id,
        baseSubmitInput(),
        LOCALE,
        tx,
        first.options
      );
      const notificationsBefore = await countNotificationsFor(tx, [cast.studentUserId, cast.parentUserId]);
      expect(notificationsBefore).toBe(2);
      const publishesBefore = first.transport.publishCount;
      const claimsBefore = first.cache.claimedKeys.length;

      const logs = recordDomainLogs();
      try {
        const error = await expectRepoError(() =>
          SessionReportService.submitSessionReport(
            cast.teacherUserId,
            cast.sessionRow.id,
            baseSubmitInput({ teacherNotes: "a racing duplicate" }),
            LOCALE,
            tx,
            first.options
          )
        );
        const denial = requireDomainError(error, ConflictError);
        assertDenial(denial, "SESSION_REPORT_ALREADY_EXISTS", ERRORS_EN.sessionReportAlreadyExists);

        // The replay produced NOTHING new: no receipt row, no publish, no claim.
        expect(await countNotificationsFor(tx, [cast.studentUserId, cast.parentUserId])).toBe(notificationsBefore);
        expect(first.transport.publishCount).toBe(publishesBefore);
        expect(first.cache.claimedKeys).toHaveLength(claimsBefore);
        expect(logs.records).toEqual([
          { code: "SESSION_REPORT_ALREADY_EXISTS", entity: "reports", entityId: cast.sessionRow.id },
        ]);
      } finally {
        logs.stop();
      }
    });
  });

  test("pre-existing assignment WITHOUT a report ⇒ the home_work arbiter maps to SESSION_REPORT_ALREADY_EXISTS and the report insert rolls back with it", async () => {
    await runInRollback(async tx => {
      const cast = await provisionReportCast(tx, { linkedParent: true });
      await createTestHomeWork(tx, cast.sessionRow.id, {
        currentFromAyah: JADID_BLOCK.fromAyah,
        currentToAyah: JADID_BLOCK.toAyah,
        currentSurahJuz: JADID_BLOCK.surahJuz,
      });
      const { options, transport } = freshEngineOptions();
      const logs = recordDomainLogs();
      try {
        const error = await expectRepoError(() =>
          SessionReportService.submitSessionReport(
            cast.teacherUserId,
            cast.sessionRow.id,
            baseSubmitInput({ homework: { jadid: JADID_BLOCK, madi: MADI_BLOCK } }),
            LOCALE,
            tx,
            options
          )
        );
        const denial = requireDomainError(error, ConflictError);
        assertDenial(denial, "SESSION_REPORT_ALREADY_EXISTS", ERRORS_EN.sessionReportAlreadyExists);

        // One report + one assignment settle together: the report INSERT of
        // this very attempt rolled back with the failed assignment insert.
        expect(await countReportRowsFor(tx, [cast.sessionRow.id])).toBe(0);
        expect(await countHomeWorkRowsFor(tx, [cast.sessionRow.id])).toBe(1);
        expect(await countNotificationsFor(tx, [cast.studentUserId, cast.parentUserId])).toBe(0);
        expect(logs.records).toEqual([
          { code: "SESSION_REPORT_ALREADY_EXISTS", entity: "home_work", entityId: cast.sessionRow.id },
        ]);
        expect(transport.publishCount).toBe(0);
      } finally {
        logs.stop();
      }
    });
  });

  test("happy path WITHOUT homework ⇒ report row + student and parent waves; zero home_work rows; zero logs", async () => {
    await runInRollback(async tx => {
      const cast = await provisionReportCast(tx, { linkedParent: true });
      const lanesBefore = await readStudentLanes(tx, cast.studentUserId);
      const { options, transport } = freshEngineOptions();
      const logs = recordDomainLogs();
      try {
        const submitted = await SessionReportService.submitSessionReport(
          cast.teacherUserId,
          cast.sessionRow.id,
          baseSubmitInput(),
          LOCALE,
          tx,
          options
        );

        expect(submitted.sessionId).toBe(cast.sessionRow.id);
        expect(submitted.teacherNotes).toBe(VALID_NOTES);
        expect(submitted.studentRatingByTeacher).toBe(4);
        expect(await countReportRowsFor(tx, [cast.sessionRow.id])).toBe(1);
        expect(await countHomeWorkRowsFor(tx, [cast.sessionRow.id])).toBe(0);

        // Student + parent receipt rows and post-commit publishes (2 receipts).
        expect(await countNotificationsFor(tx, [cast.studentUserId, cast.parentUserId])).toBe(2);
        expect(transport.publishCount).toBe(2);
        expect(new Set(transport.publishedUserIds)).toEqual(new Set([cast.studentUserId, cast.parentUserId]));
        expect(cacheOf(options).claimedKeys).toHaveLength(2);

        // REQ-044: the report surface moved no escrow lane and no fee flag.
        expect(await readStudentLanes(tx, cast.studentUserId)).toEqual(lanesBefore);
        const [sessionAfter] = await tx
          .select({ feeHeld: session.feeHeld })
          .from(session)
          .where(eq(session.id, cast.sessionRow.id));
        expect(sessionAfter?.feeHeld).toBe(cast.sessionRow.feeHeld);

        expect(logs.records).toEqual([]);
      } finally {
        logs.stop();
      }
    });
  });

  test("happy path WITH homework (jadid + madi) ⇒ assignment row mapped field-by-field; grades structurally NULL", async () => {
    await runInRollback(async tx => {
      const cast = await provisionReportCast(tx, { linkedParent: true });
      const { options, transport } = freshEngineOptions();
      const logs = recordDomainLogs();
      try {
        await SessionReportService.submitSessionReport(
          cast.teacherUserId,
          cast.sessionRow.id,
          baseSubmitInput({ homework: { jadid: JADID_BLOCK, madi: MADI_BLOCK } }),
          LOCALE,
          tx,
          options
        );

        const homeworkRow = await homeworkRowBySessionId(tx, cast.sessionRow.id);
        if (!homeworkRow) {
          throw new Error("expected the home_work row to exist after the submission with homework");
        }
        expect(homeworkRow.sessionId).toBe(cast.sessionRow.id);
        expect(homeworkRow.currentFromAyah).toBe(JADID_BLOCK.fromAyah);
        expect(homeworkRow.currentToAyah).toBe(JADID_BLOCK.toAyah);
        expect(homeworkRow.currentSurahJuz).toBe(JADID_BLOCK.surahJuz);
        expect(homeworkRow.revisionFromAyah).toBe(MADI_BLOCK.fromAyah);
        expect(homeworkRow.revisionToAyah).toBe(MADI_BLOCK.toAyah);
        expect(homeworkRow.revisionSurahJuz).toBe(MADI_BLOCK.surahJuz);
        // Grades structurally absent: the row is graded later through this
        // same flow, never at assignment time (INV-HW3).
        expect(homeworkRow.currentGrade).toBeNull();
        expect(homeworkRow.revisionGrade).toBeNull();

        expect(await countReportRowsFor(tx, [cast.sessionRow.id])).toBe(1);
        expect(await countNotificationsFor(tx, [cast.studentUserId, cast.parentUserId])).toBe(2);
        expect(transport.publishCount).toBe(2);
        expect(logs.records).toEqual([]);
      } finally {
        logs.stop();
      }
    });
  });

  test("first session, previousGrades ABSENT ⇒ no grade write, no error, zero homework rows", async () => {
    await runInRollback(async tx => {
      const cast = await provisionReportCast(tx, { linkedParent: true });
      const { options, transport } = freshEngineOptions();
      const logs = recordDomainLogs();
      try {
        await SessionReportService.submitSessionReport(
          cast.teacherUserId,
          cast.sessionRow.id,
          // No previousGrades, no homework — the pure report-only submission.
          baseSubmitInput({ homework: undefined, previousGrades: undefined }),
          LOCALE,
          tx,
          options
        );

        expect(await countReportRowsFor(tx, [cast.sessionRow.id])).toBe(1);
        expect(await countHomeWorkRowsFor(tx, [cast.sessionRow.id])).toBe(0);
        expect(await countNotificationsFor(tx, [cast.studentUserId, cast.parentUserId])).toBe(2);
        expect(transport.publishCount).toBe(2);
        expect(logs.records).toEqual([]);
      } finally {
        logs.stop();
      }
    });
  });

  test("first session, previousGrades PRESENT with no ungraded target ⇒ silent no-op success (genuine first session)", async () => {
    await runInRollback(async tx => {
      const cast = await provisionReportCast(tx, { linkedParent: true });
      const { options, transport } = freshEngineOptions();
      const logs = recordDomainLogs();
      try {
        await SessionReportService.submitSessionReport(
          cast.teacherUserId,
          cast.sessionRow.id,
          baseSubmitInput({ previousGrades: { currentGrade: 50, revisionGrade: 60 } }),
          LOCALE,
          tx,
          options
        );

        // The null target is NOT an error: nothing to grade, nothing logged.
        expect(await countReportRowsFor(tx, [cast.sessionRow.id])).toBe(1);
        expect(await countHomeWorkRowsFor(tx, [cast.sessionRow.id])).toBe(0);
        expect(await countNotificationsFor(tx, [cast.studentUserId, cast.parentUserId])).toBe(2);
        expect(transport.publishCount).toBe(2);
        expect(logs.records).toEqual([]);
      } finally {
        logs.stop();
      }
    });
  });

  test("prior-but-graded history ⇒ the newest row is ALREADY graded ⇒ typed CONFLICT; nothing persists", async () => {
    await runInRollback(async tx => {
      const cast = await provisionReportCast(tx, { linkedParent: true });
      // An OLDER ungraded row exists (a prior session's assignment) — the
      // newest-any-grade probe does NOT fall back past the newest row.
      const priorSession = await createTestSession(tx, cast.teacherUserId, cast.studentUserId, {
        status: SessionStatus.Completed,
        startedAt: new Date(),
        endedAt: new Date(),
        confirmedByTeacherAt: new Date(),
      });
      const olderUngraded = await createTestHomeWork(tx, priorSession.id, { currentFromAyah: 1, currentToAyah: 3 });
      // The NEWEST row's write-once is already spent (both grades set).
      const gradedRow = await createTestHomeWork(tx, cast.sessionRow.id, { currentGrade: 90, revisionGrade: 80 });
      expect(gradedRow.id).toBeGreaterThan(olderUngraded.id);

      const { options, transport } = freshEngineOptions();
      const logs = recordDomainLogs();
      let conflict: DomainError;
      try {
        // The probe surfaces the graded newest row; the guarded UPDATE misses
        // (zero rows) and the service classifies the null as the typed
        // write-once conflict — never a silent no-op, never a fallback.
        const error = await expectRepoError(() =>
          SessionReportService.submitSessionReport(
            cast.teacherUserId,
            cast.sessionRow.id,
            baseSubmitInput({ previousGrades: { currentGrade: 70, revisionGrade: 60 } }),
            LOCALE,
            tx,
            options
          )
        );
        conflict = requireDomainError(error, ConflictError);
      } finally {
        logs.stop();
      }
      assertDenial(conflict, "CONFLICT", ERRORS_EN.homeworkAlreadyGraded);
      expect(logs.records).toEqual([{ code: "CONFLICT", entity: "home_work", entityId: gradedRow.id }]);

      // The denied submission rolled back its own unit: zero report rows,
      // the graded row untouched, the older ungraded row still ungraded,
      // zero notification rows, zero publishes.
      expect(await countReportRowsFor(tx, [cast.sessionRow.id])).toBe(0);
      const gradedAfter = await homeworkRowBySessionId(tx, cast.sessionRow.id);
      expect(gradedAfter?.currentGrade).toBe(90);
      expect(gradedAfter?.revisionGrade).toBe(80);
      const olderAfter = await homeworkRowBySessionId(tx, priorSession.id);
      expect(olderAfter?.currentGrade).toBeNull();
      expect(olderAfter?.revisionGrade).toBeNull();
      expect(await countNotificationsFor(tx, [cast.studentUserId, cast.parentUserId])).toBe(0);
      expect(transport.publishCount).toBe(0);
    });
  });

  test("happy path returns the inserted row — exact RETURNING fields, byte-equal to an independent read-back", async () => {
    await runInRollback(async tx => {
      const cast = await provisionReportCast(tx, { linkedParent: true });
      const { options } = freshEngineOptions();
      const notesWithWhitespace = `  ${VALID_NOTES}  `;

      const submitted = await SessionReportService.submitSessionReport(
        cast.teacherUserId,
        cast.sessionRow.id,
        baseSubmitInput({ teacherNotes: notesWithWhitespace, studentRatingByTeacher: 2 }),
        LOCALE,
        tx,
        options
      );

      // The trimmed notes are what the INSERT persisted (the guard's return
      // value flows through field-by-field — never the raw wire value).
      expect(submitted.teacherNotes).toBe(VALID_NOTES);
      expect(submitted.studentRatingByTeacher).toBe(2);
      expect(submitted.id).toBeGreaterThan(0);
      expect(submitted.createdAt).not.toBeNull();
      expect(submitted.updatedAt).not.toBeNull();
      expect(sortedKeysOf(submitted)).toEqual([...REPORT_ROW_KEYS]);

      const readBack = await reportRowBySessionId(tx, cast.sessionRow.id);
      expect(readBack).not.toBeNull();
      expect(readBack).toEqual(submitted);
    });
  });
});

// ─── Tier 2: payload boundaries pass through to storage ─────────────────────

describe("Tier 2 — validator bounds and assignment-block boundaries", () => {
  test("full payload at ALL validator bounds passes once (rating 0 and 5, grades 0 and 100, notes 2000, fromAyah = toAyah)", async () => {
    await runInRollback(async tx => {
      const cast = await provisionReportCast(tx, { linkedParent: true });
      const { options } = freshEngineOptions();
      const maximalNotes = "n".repeat(2000);

      // Lower/edge bounds in ONE payload: rating floor, both grade bounds
      // (current 0, revision 100), maximal notes, and a degenerate ayah span.
      const lowerSession = await createTestSession(tx, cast.teacherUserId, cast.studentUserId, {
        status: SessionStatus.Completed,
        startedAt: new Date(),
        endedAt: new Date(),
        confirmedByTeacherAt: new Date(),
      });
      const lowerSubmitted = await SessionReportService.submitSessionReport(
        cast.teacherUserId,
        lowerSession.id,
        baseSubmitInput({
          teacherNotes: maximalNotes,
          studentRatingByTeacher: 0,
          homework: { jadid: { fromAyah: 3, toAyah: 3, surahJuz: SurahJuzRef.Juz2 } },
          previousGrades: { currentGrade: 0, revisionGrade: 100 },
        }),
        LOCALE,
        tx,
        options
      );
      expect(lowerSubmitted.studentRatingByTeacher).toBe(0);
      expect(lowerSubmitted.teacherNotes).toHaveLength(2000);

      // The assignment block landed on this session's own row (the grade leg
      // no-op'd — no prior homework row exists in this cast at all).
      const lowerHomework = await homeworkRowBySessionId(tx, lowerSession.id);
      expect(lowerHomework?.currentFromAyah).toBe(3);
      expect(lowerHomework?.currentToAyah).toBe(3);
      expect(lowerHomework?.currentGrade).toBeNull();

      // Upper rating bound on a second session of the same cast.
      const upperSession = await createTestSession(tx, cast.teacherUserId, cast.studentUserId, {
        status: SessionStatus.Completed,
        startedAt: new Date(),
        endedAt: new Date(),
        confirmedByTeacherAt: new Date(),
      });
      const upperSubmitted = await SessionReportService.submitSessionReport(
        cast.teacherUserId,
        upperSession.id,
        baseSubmitInput({ teacherNotes: "u", studentRatingByTeacher: 5 }),
        LOCALE,
        tx,
        options
      );
      expect(upperSubmitted.studentRatingByTeacher).toBe(5);

      expect(await countReportRowsFor(tx, [cast.sessionRow.id, lowerSession.id, upperSession.id])).toBe(2);
    });
  });

  test("grades 0 and 100 land verbatim on the student's newest ungraded row (the grade-write bound)", async () => {
    await runInRollback(async tx => {
      const cast = await provisionReportCast(tx, { linkedParent: true });
      // A prior completed session carrying the ungraded assignment to grade.
      const priorSession = await createTestSession(tx, cast.teacherUserId, cast.studentUserId, {
        status: SessionStatus.Completed,
        startedAt: new Date(),
        endedAt: new Date(),
        confirmedByTeacherAt: new Date(),
      });
      await createTestHomeWork(tx, priorSession.id, {
        currentFromAyah: 1,
        currentToAyah: 5,
        currentSurahJuz: SurahJuzRef.SurahAlFatihah,
      });

      const { options } = freshEngineOptions();
      await SessionReportService.submitSessionReport(
        cast.teacherUserId,
        cast.sessionRow.id,
        baseSubmitInput({ previousGrades: { currentGrade: 0, revisionGrade: 100 } }),
        LOCALE,
        tx,
        options
      );

      const gradedRow = await homeworkRowBySessionId(tx, priorSession.id);
      expect(gradedRow?.currentGrade).toBe(0);
      expect(gradedRow?.revisionGrade).toBe(100);
    });
  });

  test("INV-HW4: with two ungraded rows, previousGrades land on the NEWEST prior row only (the grading probe has no grade predicate)", async () => {
    await runInRollback(async tx => {
      const cast = await provisionReportCast(tx, { linkedParent: true });
      const completedStamps = { startedAt: new Date(), endedAt: new Date(), confirmedByTeacherAt: new Date() };
      const olderSession = await createTestSession(tx, cast.teacherUserId, cast.studentUserId, {
        status: SessionStatus.Completed,
        ...completedStamps,
      });
      const newerSession = await createTestSession(tx, cast.teacherUserId, cast.studentUserId, {
        status: SessionStatus.Completed,
        ...completedStamps,
      });
      // Two ungraded prior assignments with DISTINCT creation stamps so the
      // newest-first ordering is deterministic, never a same-instant tie.
      const dayMs = 86_400_000;
      const olderRow = await createTestHomeWork(tx, olderSession.id, { createdAt: new Date(Date.now() - 2 * dayMs) });
      const newerRow = await createTestHomeWork(tx, newerSession.id, { createdAt: new Date(Date.now() - dayMs) });
      expect(newerRow.id).toBeGreaterThan(olderRow.id);

      const { options } = freshEngineOptions();
      await SessionReportService.submitSessionReport(
        cast.teacherUserId,
        cast.sessionRow.id,
        baseSubmitInput({ previousGrades: { currentGrade: 72, revisionGrade: 64 } }),
        LOCALE,
        tx,
        options
      );

      // The grades landed on the NEWEST prior row (the newer session's
      // assignment) — the grading probe picks the newest row whatever its
      // grade state, so "the previous session" is emergent from newest-first
      // ordering plus one-row-per-session uniqueness, never a session-
      // predecessor check.
      const newerAfter = await homeworkRowBySessionId(tx, newerSession.id);
      expect(newerAfter?.currentGrade).toBe(72);
      expect(newerAfter?.revisionGrade).toBe(64);
      // The OLDER ungraded row was passed over entirely — still ungraded.
      const olderAfter = await homeworkRowBySessionId(tx, olderSession.id);
      expect(olderAfter?.currentGrade).toBeNull();
      expect(olderAfter?.revisionGrade).toBeNull();
      // The submission itself persisted exactly its own report row.
      expect(await countReportRowsFor(tx, [cast.sessionRow.id])).toBe(1);
      expect(await countHomeWorkRowsFor(tx, [cast.sessionRow.id])).toBe(0);
    });
  });

  test("jadid-only assignment maps onto the current_* track only", async () => {
    await runInRollback(async tx => {
      const cast = await provisionReportCast(tx, { linkedParent: true });
      const { options } = freshEngineOptions();
      await SessionReportService.submitSessionReport(
        cast.teacherUserId,
        cast.sessionRow.id,
        baseSubmitInput({ homework: { jadid: JADID_BLOCK } }),
        LOCALE,
        tx,
        options
      );

      const homeworkRow = await homeworkRowBySessionId(tx, cast.sessionRow.id);
      expect(homeworkRow?.currentFromAyah).toBe(JADID_BLOCK.fromAyah);
      expect(homeworkRow?.currentToAyah).toBe(JADID_BLOCK.toAyah);
      expect(homeworkRow?.currentSurahJuz).toBe(JADID_BLOCK.surahJuz);
      expect(homeworkRow?.revisionFromAyah).toBeNull();
      expect(homeworkRow?.revisionToAyah).toBeNull();
      expect(homeworkRow?.revisionSurahJuz).toBeNull();
      expect(homeworkRow?.currentGrade).toBeNull();
      expect(homeworkRow?.revisionGrade).toBeNull();
    });
  });

  test("madi-only assignment maps onto the revision_* track only", async () => {
    await runInRollback(async tx => {
      const cast = await provisionReportCast(tx, { linkedParent: true });
      const { options } = freshEngineOptions();
      await SessionReportService.submitSessionReport(
        cast.teacherUserId,
        cast.sessionRow.id,
        baseSubmitInput({ homework: { madi: MADI_BLOCK } }),
        LOCALE,
        tx,
        options
      );

      const homeworkRow = await homeworkRowBySessionId(tx, cast.sessionRow.id);
      expect(homeworkRow?.revisionFromAyah).toBe(MADI_BLOCK.fromAyah);
      expect(homeworkRow?.revisionToAyah).toBe(MADI_BLOCK.toAyah);
      expect(homeworkRow?.revisionSurahJuz).toBe(MADI_BLOCK.surahJuz);
      expect(homeworkRow?.currentFromAyah).toBeNull();
      expect(homeworkRow?.currentToAyah).toBeNull();
      expect(homeworkRow?.currentSurahJuz).toBeNull();
      expect(homeworkRow?.currentGrade).toBeNull();
      expect(homeworkRow?.revisionGrade).toBeNull();
    });
  });

  test("both blocks map onto their tracks with distinct surah/juz refs", async () => {
    await runInRollback(async tx => {
      const cast = await provisionReportCast(tx, { linkedParent: true });
      const { options } = freshEngineOptions();
      const jadid: HomeWorkBlockInput = { fromAyah: 10, toAyah: 20, surahJuz: SurahJuzRef.Juz3 };
      const madi: HomeWorkBlockInput = { fromAyah: 30, toAyah: 40, surahJuz: SurahJuzRef.Juz4 };
      await SessionReportService.submitSessionReport(
        cast.teacherUserId,
        cast.sessionRow.id,
        baseSubmitInput({ homework: { jadid, madi } }),
        LOCALE,
        tx,
        options
      );

      const homeworkRow = await homeworkRowBySessionId(tx, cast.sessionRow.id);
      expect(homeworkRow?.currentFromAyah).toBe(10);
      expect(homeworkRow?.currentSurahJuz).toBe(SurahJuzRef.Juz3);
      expect(homeworkRow?.revisionFromAyah).toBe(30);
      expect(homeworkRow?.revisionSurahJuz).toBe(SurahJuzRef.Juz4);
    });
  });
});

// ─── Tier 3: committed chaos — storm ×3, mid-tx rollback, grade-once ────────
// runInRollback can never prove committed-scope semantics (concurrent
// submissions on separate connections, publish-after-commit, durable rows),
// so this tier provisions its cast in ONE committing `beforeAll` transaction
// through the REAL session-lifecycle path (book → start → complete — the σ
// setup) and hard-deletes it in FK-safe order in `afterAll` (Rule 9).
//
// TRANSPORT NOTE (PGlite, mirrors `user-management.chaos.test.ts`): PGlite is
// a SINGLE-connection WASM Postgres — two concurrent top-level
// `db.transaction(...)` calls share one session and interleave their
// BEGIN/INSERT/COMMIT statements, breaking row-lock serialization AND
// poisoning the shared session with `25P02 current transaction is aborted`
// (a loser's failed statement would abort a mid-storm read riding the same
// session). Under `DB_PROVIDER=pglite` the storm attempts (and the 2.8
// mid-storm read loop) are therefore chained through ONE FIFO async queue —
// each attempt still opens its OWN top-level transaction (the production
// `outerTx=undefined` path), the losers still lose to the COMMITTED
// `reports_session_id_unique` arbiter, and the read observations still
// interleave BETWEEN attempts (null → full-row transition). Against a real
// multi-connection pool the queue is bypassed and the storm fires truly
// concurrently (separate connections, lock-wait race, WAL snapshot reads).

/** True when the test DB is the single-connection PGlite WASM transport. */
const IS_PGLITE = (process.env.DB_PROVIDER ?? "").toLowerCase() === "pglite";

/** Tail of the PGlite FIFO work queue (never rejected — rejections live on the returned promise). */
let pgliteDbQueue: Promise<unknown> = Promise.resolve();

/**
 * Chains one unit of DB work onto the PGlite serialization queue. The chain
 * itself never breaks (the tail swallows outcomes); the caller's promise
 * still settles with the unit's own result/rejection.
 */
function enqueueDbWork<T>(work: () => Promise<T>): Promise<T> {
  const run = pgliteDbQueue.then(work, work);
  pgliteDbQueue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

/** Serializes a unit of DB work ONLY on the single-connection PGlite transport. */
function serializeOnPglite<T>(work: () => Promise<T>): Promise<T> {
  return IS_PGLITE ? enqueueDbWork(work) : work();
}

interface CommittedCast {
  readonly studentUserId: number;
  readonly parentUserId: number;
  readonly teacherUserId: number;
  /** Three storm targets + the rollback/graded probe, all `completed`. */
  readonly stormSessionIds: readonly [number, number, number];
  readonly probeSessionId: number;
  readonly sessionIds: readonly number[];
}

let committedCast: CommittedCast | null = null;
const tracked = new TrackedFixtures();
const stormTransport = new SpiedFanoutTransport();
const stormCache = new MapBackedClaimCache();
const stormOptions: NotificationEngineCallOptions = { transport: stormTransport, cache: stormCache };

/** Recorded outcome summary of one storm run — the determinism-evidence shape. */
interface StormRunSummary {
  readonly successes: number;
  readonly conflicts: number;
  readonly reportRows: number;
  readonly homeworkRows: number;
  readonly studentWaves: number;
  readonly parentWaves: number;
  readonly publishDelta: number;
  readonly claimDelta: number;
}

/** Unwraps the committed cast, failing loudly if beforeAll did not run. */
function requireCast(cast: CommittedCast | null): CommittedCast {
  if (!cast) {
    throw new Error("expected the committed beforeAll cast to exist");
  }
  return cast;
}

/**
 * Books, starts, and completes ONE session through the REAL lifecycle path
 * inside the caller's committing transaction (the journey's σ setup), then
 * registers the session and its booking idempotency claim for teardown.
 * Recursion (not an awaited loop) keeps the no-await-in-loop lint rule.
 */
async function provisionLifecycleSession(
  tx: DBTransaction,
  studentId: number,
  teacherId: number,
  key: string,
  sessionIds: number[]
): Promise<void> {
  const booked = await SessionLifecycleService.createSession(
    studentId,
    { teacherId, intent: SessionIntent.Hifz },
    key,
    LOCALE,
    tx
  );
  await SessionLifecycleService.startSession(teacherId, booked.id, LOCALE, tx);
  const completed = await SessionLifecycleService.completeSession(teacherId, booked.id, LOCALE, tx);
  tracked.register(session, completed.id);
  sessionIds.push(completed.id);

  const claimRows = await tx
    .select({ id: sessionRequestIdempotency.id })
    .from(sessionRequestIdempotency)
    .where(eq(sessionRequestIdempotency.idempotencyKey, key));
  const claim = claimRows.at(0);
  if (!claim) {
    throw new Error(`booking claim ${key} not found (fixture tracking failure)`);
  }
  tracked.register(sessionRequestIdempotency, claim.id);
}

beforeAll(async () => {
  committedCast = await db.transaction(async tx => {
    const runPrefix = `svc-rpt-${randomUUID().slice(0, 8)}`;

    const parentUser = await createTestUser(tx, { role: "parent", locale: "ar", fullName: `${runPrefix} parent` });
    await createTestParent(tx, parentUser.id);
    tracked.register(users, parentUser.id);
    tracked.register(parents, parentUser.id);

    const studentUser = await createTestUser(tx, { locale: "en", fullName: `${runPrefix} student` });
    const studentRow = await createTestStudent(tx, studentUser.id, {
      parentId: parentUser.id,
      balanceTrial: 1,
      balanceHifz: 3,
    });
    tracked.register(users, studentUser.id);
    tracked.register(students, studentRow.id);

    const teacherUser = await createTestUser(tx, { role: "teacher", locale: "en", fullName: `${runPrefix} teacher` });
    const teacherRow = await createTestTeacherRow(tx, teacherUser.id);
    tracked.register(users, teacherUser.id);
    tracked.register(teacher, teacherRow.id);

    // Four completed sessions through the real lifecycle: three storm targets
    // + one probe. The booking ladder consumes the trial lane first, then one
    // Hifz unit per session (the cast is funded for exactly these four).
    const sessionIds: number[] = [];
    await provisionLifecycleSession(tx, studentUser.id, teacherUser.id, `${runPrefix}-k-s0`, sessionIds);
    await provisionLifecycleSession(tx, studentUser.id, teacherUser.id, `${runPrefix}-k-s1`, sessionIds);
    await provisionLifecycleSession(tx, studentUser.id, teacherUser.id, `${runPrefix}-k-s2`, sessionIds);
    await provisionLifecycleSession(tx, studentUser.id, teacherUser.id, `${runPrefix}-k-s3`, sessionIds);

    const stormIds = sessionIds.map(id => id);
    const probeId = stormIds.pop();
    if (probeId === undefined || stormIds.length !== 3) {
      throw new Error("expected four provisioned sessions for the committed cast");
    }
    return {
      studentUserId: studentUser.id,
      parentUserId: parentUser.id,
      teacherUserId: teacherUser.id,
      stormSessionIds: [stormIds[0] ?? 0, stormIds[1] ?? 0, stormIds[2] ?? 0] as [number, number, number],
      probeSessionId: probeId,
      sessionIds,
    };
  });
});

afterAll(async () => {
  // Reverse-registration-order hard delete + zero-residue re-probes; reports
  // and home_work cascade with their sessions, notifications with their users.
  await tracked.cleanup();
});

/** Wallet/fee purity snapshot of the committed cast (REQ-044 scoped oracle). */
async function committedWalletSnapshot(): Promise<{
  lanesTrial: number | null;
  lanesHifz: number | null;
  walletRows: number;
  teacherTransactionRows: number;
  feeHeldCount: number;
}> {
  const cast = requireCast(committedCast);
  const lanes = await readStudentLanes(db, cast.studentUserId);
  const sessionRows = await db
    .select({ feeHeld: session.feeHeld })
    .from(session)
    .where(inArray(session.id, [...cast.sessionIds]));
  return {
    lanesTrial: lanes.trial,
    lanesHifz: lanes.hifz,
    walletRows: await countWalletsForTeacher(cast.teacherUserId),
    teacherTransactionRows: await countTeacherTransactionsForTeacher(cast.teacherUserId),
    feeHeldCount: sessionRows.filter(row => row.feeHeld).length,
  };
}

/** Asserts the wallet/fee lanes are bit-identical across a step. */
function expectWalletSnapshotUnchanged(
  before: Awaited<ReturnType<typeof committedWalletSnapshot>>,
  after: Awaited<ReturnType<typeof committedWalletSnapshot>>
): void {
  expect(after).toEqual(before);
}

/** JSON replacer that renders unknown thrown values readably. */
function replacerForThrown(_key: string, value: unknown): unknown {
  if (value instanceof Error) {
    return `${value.name}: ${value.message}`;
  }
  return value;
}

/**
 * Fires `STORM_N` concurrent submissions for one completed session — each
 * call opens its OWN top-level transaction (separate pool connections) — and
 * returns the classified outcome summary: exactly one accepted submission,
 * N−1 typed duplicate conflicts, one report row, one assignment row, one
 * student + one parent notification row, and the transport/claim deltas.
 */
async function runStorm(sessionId: number, notesPrefix: string): Promise<StormRunSummary> {
  const cast = requireCast(committedCast);
  const attempts = Array.from({ length: STORM_N }, (_, index) => index);

  const reportRowsBefore = await countReportRowsFor(db, [sessionId]);
  const homeworkRowsBefore = await countHomeWorkRowsFor(db, [sessionId]);
  const studentWavesBefore = await countNotificationsFor(db, [cast.studentUserId]);
  const parentWavesBefore = await countNotificationsFor(db, [cast.parentUserId]);
  const publishesBefore = stormTransport.publishCount;
  const claimsBefore = stormCache.claimedKeys.length;

  const logs = recordDomainLogs();
  const settled = await Promise.allSettled(
    attempts.map(index =>
      // Each attempt opens its OWN top-level transaction (the production
      // `outerTx=undefined` path); on the single-connection PGlite transport
      // the transactional unit is chained onto the FIFO queue (header note).
      serializeOnPglite(() =>
        SessionReportService.submitSessionReport(
          cast.teacherUserId,
          sessionId,
          baseSubmitInput({
            teacherNotes: `${notesPrefix} attempt ${String(index)}`,
            homework: { jadid: JADID_BLOCK, madi: MADI_BLOCK },
          }),
          LOCALE,
          undefined,
          stormOptions
        )
      )
    )
  );
  const codes = logs.records.map(record => record.code);
  logs.stop();

  let successes = 0;
  const conflicts: ConflictError[] = [];
  const otherFailures: unknown[] = [];
  for (const result of settled) {
    if (result.status === "fulfilled") {
      successes += 1;
      continue;
    }
    if (result.reason instanceof ConflictError) {
      conflicts.push(result.reason);
    } else {
      otherFailures.push(result.reason);
    }
  }
  if (otherFailures.length > 0) {
    throw new Error(`storm produced unexpected failures: ${JSON.stringify(otherFailures, replacerForThrown)}`);
  }

  for (const conflict of conflicts) {
    assertDenial(conflict, "SESSION_REPORT_ALREADY_EXISTS", ERRORS_EN.sessionReportAlreadyExists);
  }
  // Every loser logged its own bounded denial; the winner logged nothing.
  expect(codes.filter(code => code === "SESSION_REPORT_ALREADY_EXISTS")).toHaveLength(conflicts.length);
  expect(codes.filter(code => code !== "SESSION_REPORT_ALREADY_EXISTS")).toHaveLength(0);

  const reportRows = (await countReportRowsFor(db, [sessionId])) - reportRowsBefore;
  const homeworkRows = (await countHomeWorkRowsFor(db, [sessionId])) - homeworkRowsBefore;
  const studentWaves = (await countNotificationsFor(db, [cast.studentUserId])) - studentWavesBefore;
  const parentWaves = (await countNotificationsFor(db, [cast.parentUserId])) - parentWavesBefore;

  return {
    successes,
    conflicts: conflicts.length,
    reportRows,
    homeworkRows,
    studentWaves,
    parentWaves,
    publishDelta: stormTransport.publishCount - publishesBefore,
    claimDelta: stormCache.claimedKeys.length - claimsBefore,
  };
}

/** Asserts one storm summary is EXACTLY the one-winner outcome. */
function expectSingleWinnerSummary(summary: StormRunSummary): void {
  expect(summary).toEqual({
    successes: 1,
    conflicts: STORM_N - 1,
    reportRows: 1,
    homeworkRows: 1,
    studentWaves: 1,
    parentWaves: 1,
    publishDelta: 2,
    claimDelta: 2,
  });
}

/** The persisted report row's notes must be one of the storm attempts'. */
async function expectStormReportNotesOneOf(sessionId: number, notesPrefix: string): Promise<void> {
  const row = await reportRowBySessionId(db, sessionId);
  if (!row) {
    throw new Error("expected the storm's winning report row to exist");
  }
  const attemptNotes = Array.from({ length: STORM_N }, (_, index) => `${notesPrefix} attempt ${String(index)}`);
  const winnerNotes = row.teacherNotes;
  if (typeof winnerNotes !== "string") {
    throw new Error("expected the storm's winning report row to carry its notes");
  }
  expect(attemptNotes).toContain(winnerNotes);
}

/**
 * Mid-storm read loop (recursion instead of an awaited loop — the lint rule):
 * repeatedly reads the storm target as the STUDENT until the storm settles.
 * Every observation must be either `null` (WAL isolation — the winner has not
 * committed yet) or a FULL report row; a throw of any kind fails the test.
 */
async function readStormObservations(
  sessionId: number,
  readerId: number,
  isSettled: () => boolean,
  observations: Array<ReportReturnType | null>
): Promise<void> {
  if (observations.length > 1_000) {
    throw new Error("mid-storm read loop exceeded its observation cap");
  }
  let observation: ReportReturnType | null;
  try {
    // PGlite transport: the read rides the same FIFO queue as the storm
    // attempts so it can never execute inside an aborted (25P02) shared
    // session — it still interleaves BETWEEN attempts (null → full row).
    observation = await serializeOnPglite(() => SessionReportService.getSessionReport(readerId, sessionId, LOCALE));
  } catch (error) {
    throw new Error(`mid-storm read THREW (reads must never throw): ${String(error)}`, { cause: error });
  }
  observations.push(observation);
  if (!isSettled()) {
    return readStormObservations(sessionId, readerId, isSettled, observations);
  }
}

describe("Tier 3 — committed chaos: double-submit storm ×3, forced rollback, grade-once conflict, wallet purity", () => {
  test("storm run 1 — N concurrent submissions on separate connections ⇒ EXACTLY one success, one report, one assignment, one wave per recipient", async () => {
    const cast = requireCast(committedCast);
    const walletBefore = await committedWalletSnapshot();

    const summary = await runStorm(cast.stormSessionIds[0], "storm-1");
    expectSingleWinnerSummary(summary);
    await expectStormReportNotesOneOf(cast.stormSessionIds[0], "storm-1");

    // REQ-044: the storm moved no wallet/fee lane of the cast.
    expectWalletSnapshotUnchanged(walletBefore, await committedWalletSnapshot());
  });

  test("storm run 2 — the identical one-winner outcome on a fresh session (determinism evidence, run 2 of 3)", async () => {
    const cast = requireCast(committedCast);
    const walletBefore = await committedWalletSnapshot();

    const summary = await runStorm(cast.stormSessionIds[1], "storm-2");
    expectSingleWinnerSummary(summary);
    await expectStormReportNotesOneOf(cast.stormSessionIds[1], "storm-2");

    expectWalletSnapshotUnchanged(walletBefore, await committedWalletSnapshot());
  });

  test("storm run 3 — identical outcome again + a MID-STORM participant read never throws (full row or null)", async () => {
    const cast = requireCast(committedCast);
    const walletBefore = await committedWalletSnapshot();
    const sessionId = cast.stormSessionIds[2];

    // Launch the storm, then race a participant read loop against it: WAL
    // isolation means each observation is the pre-commit `null` or the full
    // committed row — never a partial/fabricated shape, never a throw.
    let settledFlag = false;
    const observations: Array<ReportReturnType | null> = [];
    const readerPromise = readStormObservations(sessionId, cast.studentUserId, () => settledFlag, observations);
    const summary = await runStorm(sessionId, "storm-3");
    settledFlag = true;
    await readerPromise;

    expectSingleWinnerSummary(summary);
    await expectStormReportNotesOneOf(sessionId, "storm-3");
    expect(observations.length).toBeGreaterThanOrEqual(1);
    for (const observation of observations) {
      if (observation === null) {
        continue;
      }
      expect(sortedKeysOf(observation)).toEqual([...REPORT_ROW_KEYS]);
    }

    // After the storm: the default (pool-path) read returns the winner's FULL
    // row for BOTH participants, byte-equal to an independent read-back.
    const finalRead = await SessionReportService.getSessionReport(cast.studentUserId, sessionId, LOCALE);
    expect(finalRead).not.toBeNull();
    expect(finalRead?.sessionId).toBe(sessionId);
    expect(finalRead?.studentRatingByTeacher).toBe(4);
    expect((await reportRowBySessionId(db, sessionId))?.teacherNotes).toBe(finalRead?.teacherNotes);
    const teacherFinalRead = await SessionReportService.getSessionReport(cast.teacherUserId, sessionId, LOCALE);
    expect(teacherFinalRead).toEqual(finalRead);
    const homeworkFinalRead = await SessionReportService.getSessionHomework(cast.studentUserId, sessionId, LOCALE);
    expect(homeworkFinalRead).not.toBeNull();
    expect(homeworkFinalRead?.sessionId).toBe(sessionId);
    expect(homeworkFinalRead?.currentGrade).toBeNull();

    expectWalletSnapshotUnchanged(walletBefore, await committedWalletSnapshot());
  });

  test("forced mid-tx failure AFTER the report insert ⇒ total rollback including notification rows; zero publishes", async () => {
    const cast = requireCast(committedCast);
    const walletBefore = await committedWalletSnapshot();
    const reportRowsBefore = await countReportRowsFor(db, [cast.probeSessionId]);
    const homeworkRowsBefore = await countHomeWorkRowsFor(db, [cast.probeSessionId]);
    const studentWavesBefore = await countNotificationsFor(db, [cast.studentUserId]);
    const parentWavesBefore = await countNotificationsFor(db, [cast.parentUserId]);
    const publishesBefore = stormTransport.publishCount;
    const counters = { reportInserts: 0, homeworkInsertAttempts: 0 };

    const fault = await expectRepoError(() =>
      db.transaction(async tx =>
        SessionReportService.submitSessionReport(
          cast.teacherUserId,
          cast.probeSessionId,
          baseSubmitInput({ homework: { jadid: JADID_BLOCK, madi: MADI_BLOCK } }),
          LOCALE,
          faultProbeTx(tx, counters),
          stormOptions
        )
      )
    );

    // The raw failure surfaced through the proxy (the report INSERT had
    // already executed — the probe counted it), masked nowhere on this path.
    expect(fault.message).toContain("forced home_work insert failure");
    expect(fault).not.toBeInstanceOf(DomainError);
    expect(counters.reportInserts).toBe(1);
    expect(counters.homeworkInsertAttempts).toBe(1);

    // Total unit rollback: zero reports, zero home_work, zero notification
    // rows, zero publishes — and the probe session stays report-less.
    expect(await countReportRowsFor(db, [cast.probeSessionId])).toBe(reportRowsBefore);
    expect(await countHomeWorkRowsFor(db, [cast.probeSessionId])).toBe(homeworkRowsBefore);
    expect(await countNotificationsFor(db, [cast.studentUserId])).toBe(studentWavesBefore);
    expect(await countNotificationsFor(db, [cast.parentUserId])).toBe(parentWavesBefore);
    expect(stormTransport.publishCount).toBe(publishesBefore);
    expectWalletSnapshotUnchanged(walletBefore, await committedWalletSnapshot());
  });

  test("already-graded re-grade ⇒ typed CONFLICT with the localized homeworkAlreadyGraded copy; nothing persists", async () => {
    const cast = requireCast(committedCast);
    const walletBefore = await committedWalletSnapshot();
    // The student's NEWEST row (any grade state) is the grade target: the
    // storm-3 winner's assignment (created last — latest createdAt, largest
    // id, which is exactly the repo's findLatestByStudentId ordering).
    const target = await homeworkRowBySessionId(db, cast.stormSessionIds[2]);
    if (!target) {
      throw new Error("expected the storm-3 assignment row to exist as the grade target");
    }
    const reportRowsBefore = await countReportRowsFor(db, [cast.probeSessionId]);
    const publishesBefore = stormTransport.publishCount;

    // Simulates the lost row-lock race deterministically: the guarded UPDATE
    // matched zero rows because a concurrent grader committed first. The
    // service contract under test is the classification of that `null` return.
    const gradeSpy = spyOn(HomeWorkRepository, "gradeHomeWorkOnce").mockResolvedValue(null);
    const logs = recordDomainLogs();
    let conflict: DomainError;
    try {
      const error = await expectRepoError(() =>
        SessionReportService.submitSessionReport(
          cast.teacherUserId,
          cast.probeSessionId,
          baseSubmitInput({ previousGrades: { currentGrade: 91, revisionGrade: 80 } }),
          LOCALE,
          undefined,
          stormOptions
        )
      );
      conflict = requireDomainError(error, ConflictError);
      expect(gradeSpy).toHaveBeenCalledTimes(1);
    } finally {
      gradeSpy.mockRestore();
      logs.stop();
    }
    assertDenial(conflict, "CONFLICT", ERRORS_EN.homeworkAlreadyGraded);
    expect(logs.records).toEqual([{ code: "CONFLICT", entity: "home_work", entityId: target.id }]);

    // The denied attempt rolled back its own unit: the probe session stays
    // report-less, the target row is untouched (still ungraded), and nothing
    // was published.
    expect(await countReportRowsFor(db, [cast.probeSessionId])).toBe(reportRowsBefore);
    const targetAfter = await homeworkRowBySessionId(db, cast.stormSessionIds[2]);
    expect(targetAfter?.currentGrade).toBeNull();
    expect(targetAfter?.revisionGrade).toBeNull();
    expect(stormTransport.publishCount).toBe(publishesBefore);
    expectWalletSnapshotUnchanged(walletBefore, await committedWalletSnapshot());
  });
});

// ─── Tier 4: smuggling + ordering security ──────────────────────────────────

describe("Tier 4 — smuggled payload keys are dropped; denial ordering", () => {
  test("smuggled extra keys (id/sessionId/teacherId/createdAt at input AND assignment level + grade keys) are dropped — rows carry ONLY intended columns", async () => {
    await runInRollback(async tx => {
      const cast = await provisionReportCast(tx, { linkedParent: true });

      // Runtime smuggling at BOTH levels via Object.assign — no type casts.
      const smuggledAssignment: HomeWorkAssignInput = { jadid: JADID_BLOCK, madi: MADI_BLOCK };
      Object.assign(smuggledAssignment, {
        id: 4242,
        sessionId: ABSENT_SESSION_ID,
        currentGrade: 55,
        revisionGrade: 66,
        createdAt: new Date(0),
        updatedAt: new Date(0),
      });
      const smuggledInput = baseSubmitInput({ homework: smuggledAssignment });
      Object.assign(smuggledInput, {
        id: 987654,
        sessionId: ABSENT_SESSION_ID,
        teacherId: 31337,
        studentId: 2718,
        createdAt: new Date(0),
        updatedAt: new Date(0),
      });

      const { options } = freshEngineOptions();
      const submitted = await SessionReportService.submitSessionReport(
        cast.teacherUserId,
        cast.sessionRow.id,
        smuggledInput,
        LOCALE,
        tx,
        options
      );

      // The report row carries ONLY the six table columns; the smuggled
      // identity keys never steered the insert.
      expect(sortedKeysOf(submitted)).toEqual([...REPORT_ROW_KEYS]);
      expect(submitted.id).not.toBe(987654);
      expect(submitted.sessionId).toBe(cast.sessionRow.id);
      expect(submitted.createdAt?.getTime()).toBeGreaterThan(0);

      const homeworkRow = await homeworkRowBySessionId(tx, cast.sessionRow.id);
      expect(homeworkRow?.id).not.toBe(4242);
      expect(homeworkRow?.sessionId).toBe(cast.sessionRow.id);
      // The smuggled assignment-level grade keys were dropped: the row is
      // inserted ungraded (INV-HW3).
      expect(homeworkRow?.currentGrade).toBeNull();
      expect(homeworkRow?.revisionGrade).toBeNull();
      expect(homeworkRow?.currentFromAyah).toBe(JADID_BLOCK.fromAyah);
      expect(homeworkRow?.revisionFromAyah).toBe(MADI_BLOCK.fromAyah);
    });
  });

  test("governed-teacher denial precedes ANY DB work — FORBIDDEN wins even where the gate would deny differently", async () => {
    await runInRollback(async tx => {
      // A blocked teacher targeting a session owned by ANOTHER teacher: the
      // gate would answer SESSION_NOT_FOUND — governance must deny FIRST.
      const cast = await provisionReportCast(tx, { linkedParent: true });
      const governedTeacher = await createTestUser(tx, { role: "teacher", locale: "en", isBlocked: true });
      const { options } = freshEngineOptions();
      const logs = recordDomainLogs();
      try {
        const error = await expectRepoError(() =>
          SessionReportService.submitSessionReport(
            governedTeacher.id,
            cast.sessionRow.id,
            baseSubmitInput(),
            LOCALE,
            tx,
            options
          )
        );
        const denial = requireDomainError(error, ForbiddenError);
        assertDenial(denial, "FORBIDDEN", ERRORS_EN.forbidden);

        // Zero DB writes and exactly ONE log (the governance denial) — the
        // gate's SESSION_NOT_FOUND log never fired.
        await expectZeroReportSideEffects(tx, [cast.sessionRow.id], [cast.studentUserId, cast.parentUserId]);
        expect(logs.records).toEqual([{ code: "FORBIDDEN", entity: "session", entityId: governedTeacher.id }]);
      } finally {
        logs.stop();
      }
    });
  });

  test("foreign-teacher vs unknown-session denials are IDENTICAL field-by-field, per locale", async () => {
    await runInRollback(async tx => {
      const cast = await provisionReportCast(tx, { linkedParent: true });
      const foreignTeacher = await createTestUser(tx, { role: "teacher", locale: "en" });
      await createTestTeacherRow(tx, foreignTeacher.id);
      const missingId = await absentSessionId(tx);

      const foreignError = await expectRepoError(() =>
        SessionReportService.submitSessionReport(
          foreignTeacher.id,
          cast.sessionRow.id,
          baseSubmitInput(),
          LOCALE,
          tx,
          freshEngineOptions().options
        )
      );
      const unknownError = await expectRepoError(() =>
        SessionReportService.submitSessionReport(
          cast.teacherUserId,
          missingId,
          baseSubmitInput(),
          LOCALE,
          tx,
          freshEngineOptions().options
        )
      );
      assertIdenticalDenialShape(foreignError, unknownError);
      expect(foreignError.message).toContain(ERRORS_EN.sessionNotFound);

      // The locale thread: the same oracle denial under `ar` carries the ar copy.
      const foreignErrorAr = await expectRepoError(() =>
        SessionReportService.submitSessionReport(
          foreignTeacher.id,
          cast.sessionRow.id,
          baseSubmitInput(),
          "ar",
          tx,
          freshEngineOptions().options
        )
      );
      const unknownErrorAr = await expectRepoError(() =>
        SessionReportService.submitSessionReport(
          cast.teacherUserId,
          missingId,
          baseSubmitInput(),
          "ar",
          tx,
          freshEngineOptions().options
        )
      );
      assertIdenticalDenialShape(foreignErrorAr, unknownErrorAr);
      expect(foreignErrorAr.message).toContain(ERRORS_AR.sessionNotFound);
      expect(foreignErrorAr.message).not.toBe(foreignError.message);
    });
  });
});

// ─── Read surface (2.8): participant gate + null collapse ───────────────────

describe("Read surface (2.8) — getSessionReport / getSessionHomework", () => {
  test("participant pair (teacher AND student) read the report AND homework rows in full", async () => {
    await runInRollback(async tx => {
      const cast = await provisionReportCast(tx, { linkedParent: true });
      const insertedReport = await createTestSessionReport(tx, cast.sessionRow.id, {
        teacherNotes: VALID_NOTES,
        studentRatingByTeacher: 3,
      });
      const insertedHomework = await createTestHomeWork(tx, cast.sessionRow.id, {
        currentFromAyah: JADID_BLOCK.fromAyah,
        currentToAyah: JADID_BLOCK.toAyah,
        currentSurahJuz: JADID_BLOCK.surahJuz,
      });

      const teacherReport = await SessionReportService.getSessionReport(
        cast.teacherUserId,
        cast.sessionRow.id,
        LOCALE,
        tx
      );
      const studentReport = await SessionReportService.getSessionReport(
        cast.studentUserId,
        cast.sessionRow.id,
        LOCALE,
        tx
      );
      expect(teacherReport).toEqual(studentReport);
      if (!teacherReport) {
        throw new Error("expected the teacher's report read to return the row");
      }
      expect(sortedKeysOf(teacherReport)).toEqual([...REPORT_ROW_KEYS]);
      expect(teacherReport?.id).toBe(insertedReport.id);
      expect(teacherReport?.teacherNotes).toBe(VALID_NOTES);

      const teacherHomework = await SessionReportService.getSessionHomework(
        cast.teacherUserId,
        cast.sessionRow.id,
        LOCALE,
        tx
      );
      const studentHomework = await SessionReportService.getSessionHomework(
        cast.studentUserId,
        cast.sessionRow.id,
        LOCALE,
        tx
      );
      expect(teacherHomework).toEqual(studentHomework);
      expect(teacherHomework?.id).toBe(insertedHomework.id);
      expect(teacherHomework?.currentSurahJuz).toBe(JADID_BLOCK.surahJuz);
    });
  });

  test("non-participant teacher/student/parent/admin collapse to EXACTLY null on BOTH readers", async () => {
    await runInRollback(async tx => {
      const cast = await provisionReportCast(tx, { linkedParent: true });
      await createTestSessionReport(tx, cast.sessionRow.id, { teacherNotes: VALID_NOTES });
      await createTestHomeWork(tx, cast.sessionRow.id, { currentFromAyah: 1, currentToAyah: 2 });

      const foreignTeacher = await createTestUser(tx, { role: "teacher", locale: "en" });
      await createTestTeacherRow(tx, foreignTeacher.id);
      const foreignStudentUser = await createTestUser(tx, { locale: "en" });
      await createTestStudent(tx, foreignStudentUser.id);
      const foreignAdminUser = await createTestUser(tx, { role: "admin", locale: "en" });
      const foreignAdmin = await createTestAdmin(tx, foreignAdminUser.id);
      expect(foreignAdmin.id).toBe(foreignAdminUser.id);

      const nonParticipants = [foreignTeacher.id, foreignStudentUser.id, cast.parentUserId, foreignAdmin.id];
      const reportReads = await Promise.all(
        nonParticipants.map(callerId => SessionReportService.getSessionReport(callerId, cast.sessionRow.id, LOCALE, tx))
      );
      const homeworkReads = await Promise.all(
        nonParticipants.map(callerId =>
          SessionReportService.getSessionHomework(callerId, cast.sessionRow.id, LOCALE, tx)
        )
      );
      for (const read of [...reportReads, ...homeworkReads]) {
        expect(read).toBeNull();
      }

      // Control: the participants still hit while the outsiders collapse.
      const studentStillHits = await SessionReportService.getSessionReport(
        cast.studentUserId,
        cast.sessionRow.id,
        LOCALE,
        tx
      );
      expect(studentStillHits).not.toBeNull();
    });
  });

  test("unknown session id ⇒ null; the foreign-null and unknown-null are observably IDENTICAL (byte identity)", async () => {
    await runInRollback(async tx => {
      const cast = await provisionReportCast(tx, { linkedParent: true });
      await createTestSessionReport(tx, cast.sessionRow.id, { teacherNotes: VALID_NOTES });
      const foreignTeacher = await createTestUser(tx, { role: "teacher", locale: "en" });
      await createTestTeacherRow(tx, foreignTeacher.id);

      const foreignReport = await SessionReportService.getSessionReport(
        foreignTeacher.id,
        cast.sessionRow.id,
        LOCALE,
        tx
      );
      const unknownReport = await SessionReportService.getSessionReport(
        cast.teacherUserId,
        ABSENT_SESSION_ID,
        LOCALE,
        tx
      );
      // `toBe` — the SAME bare null, no shape discrimination between the two.
      expect(unknownReport).toBeNull();
      expect(foreignReport).toBeNull();
      expect(foreignReport).toBe(unknownReport);
      expect(JSON.stringify(foreignReport)).toBe(JSON.stringify(unknownReport));

      const foreignHomework = await SessionReportService.getSessionHomework(
        foreignTeacher.id,
        cast.sessionRow.id,
        LOCALE,
        tx
      );
      const unknownHomework = await SessionReportService.getSessionHomework(
        cast.teacherUserId,
        ABSENT_SESSION_ID,
        LOCALE,
        tx
      );
      expect(foreignHomework).toBe(unknownHomework);
    });
  });

  test("enumeration probe — foreign ids and nonexistent ids yield INDISTINGUISHABLE results on both readers", async () => {
    await runInRollback(async tx => {
      const cast = await provisionReportCast(tx, { linkedParent: true });
      await createTestSessionReport(tx, cast.sessionRow.id, { teacherNotes: VALID_NOTES });
      const foreignIds = [await absentSessionId(tx), ABSENT_SESSION_ID, INT4_MAX_SESSION_ID];
      // A second foreign caller id (a parent is never a session participant).
      const foreignCaller = await createTestUser(tx, { role: "parent", locale: "en" });
      await createTestParent(tx, foreignCaller.id);

      const nonexistentReads = await Promise.all(
        foreignIds.map(targetId => SessionReportService.getSessionReport(cast.teacherUserId, targetId, LOCALE, tx))
      );
      const foreignCallerReads = await Promise.all(
        foreignIds.map(targetId => SessionReportService.getSessionReport(foreignCaller.id, targetId, LOCALE, tx))
      );
      const homeworkNonexistent = await Promise.all(
        foreignIds.map(targetId => SessionReportService.getSessionHomework(cast.teacherUserId, targetId, LOCALE, tx))
      );
      const homeworkForeign = await Promise.all(
        foreignIds.map(targetId => SessionReportService.getSessionHomework(foreignCaller.id, targetId, LOCALE, tx))
      );

      const normalized = [...nonexistentReads, ...foreignCallerReads, ...homeworkNonexistent, ...homeworkForeign].map(
        value => JSON.stringify(value)
      );
      expect(new Set(normalized).size).toBe(1);
      expect(normalized[0]).toBe("null");
    });
  });

  test("hostile id matrix (0 / -1 / 1.5 / NaN / 2**53) ⇒ pre-DB VALIDATION on BOTH readers; the read path stays silent", async () => {
    await runInRollback(async tx => {
      const cast = await provisionReportCast(tx, { linkedParent: true });
      const hostileIds = [0, -1, 1.5, Number.NaN, 2 ** 53] as const;
      const logs = recordDomainLogs();
      try {
        const reportErrors = await Promise.all(
          hostileIds.map(hostileId =>
            expectRepoError(() => SessionReportService.getSessionReport(cast.teacherUserId, hostileId, LOCALE, tx))
          )
        );
        const homeworkErrors = await Promise.all(
          hostileIds.map(hostileId =>
            expectRepoError(() => SessionReportService.getSessionHomework(cast.teacherUserId, hostileId, LOCALE, tx))
          )
        );
        for (const error of [...reportErrors, ...homeworkErrors]) {
          const denial = requireDomainError(error, ValidationError);
          assertDenial(denial, "VALIDATION", ERRORS_EN.validation);
        }
        // The read path logs NOTHING — not even on its own fail-closed denial.
        expect(logs.records).toEqual([]);
      } finally {
        logs.stop();
      }
    });
  });

  test("read purity — ZERO writes and ZERO log lines across hit and null paths", async () => {
    await runInRollback(async tx => {
      const cast = await provisionReportCast(tx, { linkedParent: true });
      await createTestSessionReport(tx, cast.sessionRow.id, { teacherNotes: VALID_NOTES });
      await createTestHomeWork(tx, cast.sessionRow.id, { currentFromAyah: 1, currentToAyah: 2 });

      const foreignTeacher = await createTestUser(tx, { role: "teacher", locale: "en" });
      await createTestTeacherRow(tx, foreignTeacher.id);

      const logs = recordDomainLogs();
      try {
        await SessionReportService.getSessionReport(cast.teacherUserId, cast.sessionRow.id, LOCALE, tx);
        await SessionReportService.getSessionHomework(cast.studentUserId, cast.sessionRow.id, LOCALE, tx);
        await SessionReportService.getSessionReport(foreignTeacher.id, cast.sessionRow.id, LOCALE, tx);
        await SessionReportService.getSessionHomework(foreignTeacher.id, cast.sessionRow.id, LOCALE, tx);
        await SessionReportService.getSessionReport(cast.teacherUserId, ABSENT_SESSION_ID, LOCALE, tx);

        // Zero logs — the read path is silent across hits and nulls alike.
        expect(logs.records).toEqual([]);
      } finally {
        logs.stop();
      }

      // Zero writes on ANY touched table (and no fee-flag flip).
      expect(await countReportRowsFor(tx, [cast.sessionRow.id])).toBe(1);
      expect(await countHomeWorkRowsFor(tx, [cast.sessionRow.id])).toBe(1);
      expect(await countNotificationsFor(tx, [cast.studentUserId, cast.parentUserId])).toBe(0);
      const [sessionAfter] = await tx
        .select({ feeHeld: session.feeHeld })
        .from(session)
        .where(eq(session.id, cast.sessionRow.id));
      expect(sessionAfter?.feeHeld).toBe(cast.sessionRow.feeHeld);
    });
  });

  test("a participant's report-less session reads as null — and the two readers null-collapse identically there too", async () => {
    await runInRollback(async tx => {
      const cast = await provisionReportCast(tx, { linkedParent: true });
      // Completed, report-less, homework-less: the participant gate PASSES but
      // the plain repository read misses — the honest participant null.
      const logs = recordDomainLogs();
      let teacherReport: ReportReturnType | null;
      let teacherHomework: HomeWorkReturnType | null;
      try {
        teacherReport = await SessionReportService.getSessionReport(cast.teacherUserId, cast.sessionRow.id, LOCALE, tx);
        teacherHomework = await SessionReportService.getSessionHomework(
          cast.teacherUserId,
          cast.sessionRow.id,
          LOCALE,
          tx
        );
      } finally {
        logs.stop();
      }
      expect(teacherReport).toBeNull();
      expect(teacherHomework).toBeNull();
      // Byte identity of the two null collapses (both asserted null above).
      expect(JSON.stringify(teacherReport)).toBe(JSON.stringify(teacherHomework));
      expect(logs.records).toEqual([]);
    });
  });
});

// ─── Source pin: the homework write surface (production composition) ────────

/**
 * Production roots whose TypeScript files could host a homework-insert call
 * site — the services tree, the GraphQL layer, the repository layer, the
 * backend lib, and the App Router API routes. Test files, spec files, and
 * `__tests__` directories never enter the scan, so sibling test-authoring
 * activity cannot perturb the pin; only a NEW production caller can.
 */
const HOMEWORK_WRITE_SCAN_ROOTS = [
  join(import.meta.dir, ".."),
  join(import.meta.dir, "..", "..", "graphql"),
  join(import.meta.dir, "..", "..", "db", "repo"),
  join(import.meta.dir, "..", "..", "lib"),
  join(import.meta.dir, "..", "..", "..", "app"),
];

/** Lists the production TypeScript files under one root (test-free scan). */
function listProductionTypeScriptFiles(root: string): string[] {
  const files: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) {
        continue;
      }
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "__tests__" || entry.name === "node_modules") {
          continue;
        }
        walk(path);
        continue;
      }
      if (
        entry.isFile() &&
        entry.name.endsWith(".ts") &&
        !entry.name.includes(".test") &&
        !entry.name.includes(".spec")
      ) {
        files.push(path);
      }
    }
  };
  walk(root);
  return files;
}

describe("Source pin — the homework write surface (report-transaction composition)", () => {
  test("INV-S8: HomeWorkRepository.insertHomeWork has exactly ONE production call site (inside the report transaction)", () => {
    // Homework is created only when the session report is submitted: the
    // enforcement is compositional (the insert rides the report submission's
    // own transaction), so the pin is the call-site census itself — any new
    // production caller (a report-less creation path) fails here until it is
    // consciously admitted or routed through the report transaction.
    const callShape = /HomeWorkRepository\.insertHomeWork\(/g;
    const callSites: Array<{ file: string; occurrences: number }> = [];
    for (const root of HOMEWORK_WRITE_SCAN_ROOTS) {
      for (const file of listProductionTypeScriptFiles(root)) {
        const occurrences = readFileSync(file, "utf8").match(callShape)?.length ?? 0;
        if (occurrences > 0) {
          callSites.push({ file, occurrences });
        }
      }
    }
    expect(callSites).toHaveLength(1);
    const soleCallSite = callSites.at(0);
    if (soleCallSite === undefined) {
      throw new Error("fixture integrity failure: the sole homework-insert call site vanished");
    }
    expect(soleCallSite.occurrences).toBe(1);
    expect(soleCallSite.file.endsWith(join("classes", "session-report.service.ts"))).toBe(true);

    // The call site sits INSIDE the report transaction: it is the assignment
    // leg of the homework composite, and the composite is invoked exactly
    // once — by the submission transaction body, strictly AFTER the report
    // insert, on the same transaction handle. A second invocation, or one
    // that precedes the report insert, would break the settle-together
    // composition the invariant rests on.
    const source = readFileSync(soleCallSite.file, "utf8");
    const compositeDefinitionIndex = source.indexOf("async function settleHomeWorkComposite(");
    const submissionBodyIndex = source.indexOf("async function submitReportAndHomeworkInTx(");
    const insertCallIndex = source.search(/HomeWorkRepository\.insertHomeWork\(/u);
    const compositeInvocationIndices = [...source.matchAll(/settleHomeWorkComposite\(/gu)].map(match => match.index);
    const compositeInvocationIndex = compositeInvocationIndices.at(-1) ?? -1;
    const reportInsertIndex = source.indexOf("ReportRepository.insertReport(", submissionBodyIndex);

    expect(compositeDefinitionIndex).toBeGreaterThan(-1);
    expect(submissionBodyIndex).toBeGreaterThan(compositeDefinitionIndex);
    // The insert is inside the composite's own body, ahead of the submission
    // transaction body that calls it.
    expect(insertCallIndex).toBeGreaterThan(compositeDefinitionIndex);
    expect(insertCallIndex).toBeLessThan(submissionBodyIndex);
    // The composite has exactly one invocation — from the submission
    // transaction body, after the report insert.
    expect(compositeInvocationIndices).toHaveLength(2);
    expect(compositeInvocationIndex).toBeGreaterThan(submissionBodyIndex);
    expect(compositeInvocationIndex).toBeGreaterThan(reportInsertIndex);
    expect(reportInsertIndex).toBeGreaterThan(-1);
  });
});
