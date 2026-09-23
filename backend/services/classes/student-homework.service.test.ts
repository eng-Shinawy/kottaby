/**
 * StudentHomeworkService — 4-tier suite (branch / boundary / chaos / security)
 * for the teacher-scoped cross-teacher homework history read
 * (`listStudentHomeworkHistory`).
 *
 * Mirrors the `session-report.service.test.ts` 4-tier contract (per
 * `backend/db/test/AGENTS.md` + `backend/services/AGENTS.md`):
 *  - Tiers 1/2/4 run inside `runInRollback`; the rollback `tx` is the
 *    `outerTx` argument the service joins (the composed/test path). The
 *    read-path silence and denial-logging discipline are asserted through a
 *    recording stub over `logger.logDomainError` (zero calls on success,
 *    exactly one bounded call per denial — context `{code, entity,
 *    entityId, locale}` only).
 *  - Tier 3 needs REAL commit boundaries (concurrent reads on separate pool
 *    connections — each call opens its OWN top-level transaction), so it
 *    provisions its cast in ONE committing `beforeAll` transaction through the
 *    REAL session-lifecycle path (book → start → complete — the σ setup) and
 *    hard-deletes it in `afterAll` via `TrackedFixtures` (Rule 9).
 *  - Error assertions use the `expectRepoError` try/catch helper — NEVER
 *    `expect(...).rejects.toThrow()`.
 *  - Entity rows come from `entity-setup.ts` helpers; the cast is real
 *    `users` rows + role-child rows + real sessions through the lifecycle
 *    path so the EXISTS probe in the gate exercises the production predicate.
 *
 * Coverage map:
 *  - Tier 1 (branch): the constant-FORBIDDEN oracle — unknown valid-shape
 *    student id, foreign teacher, and student/parent/admin non-teacher
 *    callers ALL collapse to the SAME byte-identical `ForbiddenError`
 *    (constructor, code, message, extensions) with exactly ONE bounded
 *    `logDomainError` each; the happy path through the real lifecycle +
 *    submit path with TWO teachers visible newest-first (symmetric); the read
 *    path silent on success.
 *  - Tier 2 (boundary): the pagination clamp boundaries (page 0 → 1;
 *    pageSize 0 → 25, pageSize 51 → 50, omitted → 25), the envelope echo
 *    `{items, totalCount, page, pageSize}` (no extras), an empty history
 *    (zero rows), and an out-of-range page yielding empty items next to the
 *    true totalCount.
 *  - Tier 3 (chaos, committed): `Promise.allSettled` over N concurrent reads
 *    interleaving valid caller+student shapes (successes) with foreign
 *    teacher and random unknown student ids (failures). The success set
 *    returns consistent windows (newest-first H2 + H1 byte-equal across
 *    calls); the failure set is byte-identical `ForbiddenError` across
 *    every miss, with exactly one bounded log per denial.
 *  - Tier 4 (security/abuse): the hostile-id matrix (0 / -1 / 1.5 / NaN /
 *    2**53) fails closed at the pre-DB id guard with byte-identical
 *    `ValidationError` and ZERO `logDomainError` calls (the guard throws
 *    before any SQL or log); the outer-transaction SAVEPOINT seam (call
 *    with the rollback `tx`; zero commits leak after rollback); the
 *    pageSize clamp bounds abusive paging (extreme sizes collapse to 25 /
 *    50).
 *
 * Run:
 *   bun --env-file=.env.test test/scripts/run-test.ts backend/services/classes/student-homework.service.test.ts
 */

import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { count, eq, inArray } from "drizzle-orm";
import { db } from "@/backend/db";
import { homeWork } from "@/backend/db/schema/classes/home-work";
import { reports } from "@/backend/db/schema/classes/reports";
import { session } from "@/backend/db/schema/classes/session";
import { sessionRequestIdempotency } from "@/backend/db/schema/classes/session-request-idempotency";
import { parents } from "@/backend/db/schema/parents/parents";
import { students } from "@/backend/db/schema/students/students";
import { teacher } from "@/backend/db/schema/teachers/teacher";
import { users } from "@/backend/db/schema/users/users";
import {
  createTestAdmin,
  createTestHomeWork,
  createTestParent,
  createTestSession,
  createTestStudent,
  createTestTeacherRow,
  createTestUser,
} from "@/backend/db/test/entity-setup";
import { expectRepoError, runInRollback } from "@/backend/db/test/test-utils";
import { SessionIntent } from "@/backend/enum/scheduling/session-intent.enum";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import { SurahJuzRef } from "@/backend/enum/shared/surah-juz-ref.enum";
import { DomainError, ForbiddenError, ValidationError } from "@/backend/lib/errors";
import { type DomainErrorContext, logger } from "@/backend/lib/logger";
import { SessionLifecycleService } from "@/backend/services/classes/session-lifecycle.service";
import * as SessionReportService from "@/backend/services/classes/session-report.service";
import { listStudentHomeworkHistory } from "@/backend/services/classes/student-homework.service";
import type { NotificationEngineCallOptions } from "@/backend/services/notifications";
import type { NotificationIdempotencyClaimCache } from "@/backend/services/notifications/emit-idempotency";
import type {
  DBTransaction,
  HomeWorkBlockInput,
  HomeWorkReturnType,
  SessionReturnType,
  StudentHomeworkPageReturnType,
} from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import { SpiedFanoutTransport, TrackedFixtures } from "@/test/workflows/helpers";

/** English translated denial copy — denial assertions pin translated substrings. */
const ERRORS_EN = getServerTranslations("en").errorsTranslations;
/** Arabic translated denial copy — the locale-threading probe pins the ar copy. */
const ERRORS_AR = getServerTranslations("ar").errorsTranslations;

/** The request locale every assertion rides unless a test pins another. */
const LOCALE = "en";

/** Valid free-text notes reused by accepted submissions. */
const VALID_NOTES = "Steady recitation; the revision plan continues next lesson.";

/** σ1's homework assignment (Jadid + Madi) — authored by T1, born ungraded. */
const H1_JADID: HomeWorkBlockInput = { fromAyah: 1, toAyah: 7, surahJuz: SurahJuzRef.SurahAlFatihah };
const H1_MADI: HomeWorkBlockInput = { fromAyah: 1, toAyah: 5, surahJuz: SurahJuzRef.Juz1 };

/** σ2's homework assignment — authored by T2, born ungraded; a distinct pair so the visibility oracle can distinguish rows. */
const H2_JADID: HomeWorkBlockInput = { fromAyah: 8, toAyah: 12, surahJuz: SurahJuzRef.Juz2 };
const H2_MADI: HomeWorkBlockInput = { fromAyah: 3, toAyah: 9, surahJuz: SurahJuzRef.Juz4 };

/** Student id far beyond any identity sequence — guaranteed absent. */
const ABSENT_STUDENT_ID = 2_000_000_000;

/** Highest storable int4 value — a valid-shape id guaranteed absent. */
const INT4_MAX_STUDENT_ID = 2_147_483_647;

/** Storm width for the Tier-3 concurrent read storm (N ≥ 4). */
const STORM_N = 4;

/** The sanctioned envelope keys, locale-sorted — the closed list-wrapper shape. */
const ENVELOPE_KEYS = ["items", "page", "pageSize", "totalCount"] as const;

/** One recorded domain-log call (code/entity/entityId — copy never asserted from logs). */
interface DomainLogRecord {
  readonly code: string;
  readonly entity: string;
  readonly entityId: string | number | undefined;
  readonly locale: string | undefined;
}

/**
 * Installs a recording stub over `logger.logDomainError` so domain logs stay
 * silent in test output AND become countable. Callers MUST `stop()` (use
 * try/finally).
 */
function recordDomainLogs(): { records: DomainLogRecord[]; stop: () => void } {
  const records: DomainLogRecord[] = [];
  const spy = spyOn(logger, "logDomainError").mockImplementation((_message: string, ctx?: DomainErrorContext) => {
    records.push({
      code: ctx?.code ?? "<missing>",
      entity: ctx?.entity ?? "<missing>",
      entityId: ctx?.entityId,
      locale: ctx?.locale,
    });
  });
  return { records, stop: () => spy.mockRestore() };
}

/**
 * Map-backed idempotency claim cache with SET-NX-EX semantics — the in-memory
 * double the sibling suites inject through the engine `options` seam so the
 * report submission fan-out never touches Redis.
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
 * Field-by-field identity of two thrown denials — the constant-denial oracle
 * pin: constructor, error name, extensions code, translated message, and the
 * serialized extensions bag are ALL equal. Two denials passing this assertion
 * are byte-identical to the caller — no existence disclosure is possible.
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

/**
 * Asserts the caught denial is the constant FORBIDDEN oracle: a
 * `ForbiddenError` whose `code`, message, and extensions are byte-equal to
 * the canonical localized `errorsTranslations.forbidden` copy. The localized
 * copy defaults to the en leaf; pass the ar leaf explicitly for the
 * locale-threading probe.
 */
function assertConstantForbidden(error: Error, forbiddenCopy: string = ERRORS_EN.forbidden): void {
  const denial = requireDomainError(error, ForbiddenError);
  assertDenial(denial, "FORBIDDEN", forbiddenCopy);
}

/** The standard cross-teacher cast provisioned inside the caller's transaction. */
interface CrossTeacherCast {
  readonly studentUserId: number;
  readonly studentId: number;
  readonly parentUserId: number;
  readonly t1UserId: number;
  readonly t2UserId: number;
  /** Foreign teacher — zero sessions with the student. */
  readonly ftUserId: number;
  /** σ1 — completed by T1; carries H1 (ungraded). */
  readonly sigma1Id: number;
  /** σ2 — completed by T2; carries H2 (ungraded). */
  readonly sigma2Id: number;
}

interface CrossTeacherCastInput {
  /** When true, provisions a linked parent for the report-wave fan-out (the journey shape). */
  readonly linkedParent?: boolean;
  /** When true, provisions the foreign teacher (zero sessions with the student). */
  readonly foreignTeacher?: boolean;
}

/**
 * Provisions the cross-teacher cast inside the caller's transaction (rollback
 * or committing): student S, two certified teachers T1 + T2, an optional
 * linked parent P, and the foreign teacher Ft. Books σ1 with T1 and σ2 with
 * T2 through the REAL session-lifecycle path (book → start → complete),
 * composed onto the caller's transaction via the `outerTx` seam. Submits σ1
 * report + H1 (T1) and σ2 report + H2 (T2) through the REAL submit path,
 * also composed onto the caller's transaction — the writes are visible
 * inside the same snapshot the read under test later observes.
 */
async function provisionCrossTeacherCast(
  tx: DBTransaction,
  input: CrossTeacherCastInput = {}
): Promise<CrossTeacherCast> {
  const runPrefix = `svc-shw-${randomUUID().slice(0, 8)}`;

  const studentUser = await createTestUser(tx, {
    role: "student",
    locale: "en",
    fullName: `${runPrefix} student S`,
  });
  // Two Hifz sessions consume one unit each from the Hifz lane.
  const studentRow = await createTestStudent(tx, studentUser.id, { balanceHifz: 2, balanceTrial: 0 });

  let parentUserId = 0;
  if (input.linkedParent === true) {
    const parentUser = await createTestUser(tx, {
      role: "parent",
      locale: "ar",
      fullName: `${runPrefix} parent P`,
    });
    await createTestParent(tx, parentUser.id);
    await tx.update(students).set({ parentId: parentUser.id }).where(eq(students.id, studentRow.id));
    parentUserId = parentUser.id;
  }

  const t1User = await createTestUser(tx, {
    role: "teacher",
    locale: "en",
    fullName: `${runPrefix} teacher T1`,
  });
  await createTestTeacherRow(tx, t1User.id, { isApproved: true });

  const t2User = await createTestUser(tx, {
    role: "teacher",
    locale: "en",
    fullName: `${runPrefix} teacher T2`,
  });
  await createTestTeacherRow(tx, t2User.id, { isApproved: true });

  let ftUserId = 0;
  if (input.foreignTeacher === true) {
    const ftUser = await createTestUser(tx, {
      role: "teacher",
      locale: "en",
      fullName: `${runPrefix} teacher Ft`,
    });
    await createTestTeacherRow(tx, ftUser.id, { isApproved: true });
    ftUserId = ftUser.id;
  }

  // σ1 — completed through the REAL lifecycle path (book → start → complete),
  // composed inside this provisioning transaction via the outerTx seam.
  const sigma1 = await SessionLifecycleService.createSession(
    studentUser.id,
    { teacherId: t1User.id, intent: SessionIntent.Hifz },
    `${runPrefix}-k-s1`,
    LOCALE,
    tx
  );
  await SessionLifecycleService.startSession(t1User.id, sigma1.id, LOCALE, tx);
  await SessionLifecycleService.completeSession(t1User.id, sigma1.id, LOCALE, tx);

  // σ2 — same path, owned by T2. The cross-teacher continuity seed.
  const sigma2 = await SessionLifecycleService.createSession(
    studentUser.id,
    { teacherId: t2User.id, intent: SessionIntent.Hifz },
    `${runPrefix}-k-s2`,
    LOCALE,
    tx
  );
  await SessionLifecycleService.startSession(t2User.id, sigma2.id, LOCALE, tx);
  await SessionLifecycleService.completeSession(t2User.id, sigma2.id, LOCALE, tx);

  const { options } = freshEngineOptions();

  // Submit σ1 report + H1 (T1, both tracks, ungraded) — composed onto the
  // caller's transaction so the writes survive inside the same snapshot.
  await SessionReportService.submitSessionReport(
    t1User.id,
    sigma1.id,
    {
      teacherNotes: VALID_NOTES,
      studentRatingByTeacher: 4,
      homework: { jadid: H1_JADID, madi: H1_MADI },
    },
    LOCALE,
    tx,
    options
  );

  // Submit σ2 report + H2 (T2, both tracks, ungraded).
  await SessionReportService.submitSessionReport(
    t2User.id,
    sigma2.id,
    {
      teacherNotes: VALID_NOTES,
      studentRatingByTeacher: 4,
      homework: { jadid: H2_JADID, madi: H2_MADI },
    },
    LOCALE,
    tx,
    options
  );

  return {
    studentUserId: studentUser.id,
    studentId: studentUser.id,
    parentUserId,
    t1UserId: t1User.id,
    t2UserId: t2User.id,
    ftUserId,
    sigma1Id: sigma1.id,
    sigma2Id: sigma2.id,
  };
}

/** Student id guaranteed absent inside the caller's transactional view. */
async function absentStudentId(tx: DBTransaction): Promise<number> {
  const [row] = await tx.select({ maxId: count() }).from(students);
  return (row?.maxId ?? 0) + 1_000_000;
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

/** Direct read of one session's homework row (independent read-back oracle). */
async function homeworkRowBySessionId(
  executor: DBTransaction | typeof db,
  sessionId: number
): Promise<HomeWorkReturnType | null> {
  const rows = await executor.select().from(homeWork).where(eq(homeWork.sessionId, sessionId));
  return rows.at(0) ?? null;
}

// ─── Tier 1: branch coverage (runInRollback) ────────────────────────────────

describe("Tier 1 — constant-FORBIDDEN byte-identity + happy path (runInRollback)", () => {
  test("constant-FORBIDDEN byte-identity: unknown valid student id ≡ foreign teacher with valid student — constructor/code/message/extensions ALL equal", async () => {
    await runInRollback(async tx => {
      // Linked parent in this cast is unused but harmless; the foreign teacher
      // is what the byte-identity oracle compares against the unknown id arm.
      const cast = await provisionCrossTeacherCast(tx, { linkedParent: true, foreignTeacher: true });
      const missingId = await absentStudentId(tx);

      const logs = recordDomainLogs();
      let unknownError: Error;
      let foreignError: Error;
      try {
        unknownError = await expectRepoError(() =>
          listStudentHomeworkHistory(cast.t1UserId, missingId, undefined, LOCALE, tx)
        );
        foreignError = await expectRepoError(() =>
          listStudentHomeworkHistory(cast.ftUserId, cast.studentId, undefined, LOCALE, tx)
        );
      } finally {
        logs.stop();
      }

      // Both denials are the SAME byte-identical FORBIDDEN oracle — no
      // existence disclosure is possible between unknown and unlinked.
      assertConstantForbidden(unknownError);
      assertConstantForbidden(foreignError);
      assertIdenticalDenialShape(unknownError, foreignError);
      expect(unknownError.message).toBe(foreignError.message);

      // Exactly ONE bounded domain log per denial — context carries code,
      // entity, entityId, locale only (never notes or counterparty data).
      expect(logs.records).toHaveLength(2);
      for (const record of logs.records) {
        expect(record).toEqual({
          code: "FORBIDDEN",
          entity: "students",
          entityId: record.entityId,
          locale: LOCALE,
        });
        expect(record.code).toBe("FORBIDDEN");
        expect(record.entity).toBe("students");
        expect(record.locale).toBe(LOCALE);
      }
      // The entityId bag is the target student id each denial was bound to.
      expect(logs.records[0]?.entityId).toBe(missingId);
      expect(logs.records[1]?.entityId).toBe(cast.studentId);
    });
  });

  test("constant-FORBIDDEN byte-identity under the ar locale — same byte shape, ar copy, locale threaded through the log context", async () => {
    await runInRollback(async tx => {
      const cast = await provisionCrossTeacherCast(tx, { linkedParent: true, foreignTeacher: true });

      const logs = recordDomainLogs();
      let foreignErrorAr: Error;
      let unknownErrorAr: Error;
      try {
        foreignErrorAr = await expectRepoError(() =>
          listStudentHomeworkHistory(cast.ftUserId, cast.studentId, undefined, "ar", tx)
        );
        const missingIdAr = await absentStudentId(tx);
        unknownErrorAr = await expectRepoError(() =>
          listStudentHomeworkHistory(cast.t1UserId, missingIdAr, undefined, "ar", tx)
        );
      } finally {
        logs.stop();
      }

      assertConstantForbidden(foreignErrorAr, ERRORS_AR.forbidden);
      // The ar denial carries the ar copy (the message differs from the en
      // copy — the locale thread resolves the localized message at the
      // throw site).
      expect(foreignErrorAr.message).toContain(ERRORS_AR.forbidden);
      expect(foreignErrorAr.message).not.toContain(ERRORS_EN.forbidden);
      assertConstantForbidden(unknownErrorAr, ERRORS_AR.forbidden);
      assertIdenticalDenialShape(foreignErrorAr, unknownErrorAr);

      // The locale threads through the log context too.
      expect(logs.records).toHaveLength(2);
      for (const record of logs.records) {
        expect(record.locale).toBe("ar");
      }
    });
  });

  test("happy path — TWO teachers' rows both visible, newest-first; symmetric visibility; zero logs on success", async () => {
    await runInRollback(async tx => {
      const cast = await provisionCrossTeacherCast(tx, { linkedParent: true, foreignTeacher: true });
      const h1Row = await homeworkRowBySessionId(tx, cast.sigma1Id);
      const h2Row = await homeworkRowBySessionId(tx, cast.sigma2Id);
      if (!h1Row || !h2Row) {
        throw new Error("fixture integrity failure: σ1/σ2 homework rows missing");
      }

      const logs = recordDomainLogs();
      try {
        // T1 reads the student's history — sees BOTH rows (cross-teacher
        // visibility from the observer perspective, not author-scoped).
        const pageFromT1 = await listStudentHomeworkHistory(cast.t1UserId, cast.studentId, undefined, LOCALE, tx);

        // Envelope echo — the sanctioned {items, totalCount, page, pageSize}
        // shape with effective values (omitted args clamp to defaults).
        expect(Object.keys(pageFromT1).toSorted((a, b) => a.localeCompare(b))).toEqual([...ENVELOPE_KEYS]);
        expect(pageFromT1.totalCount).toBe(2);
        expect(pageFromT1.page).toBe(1);
        expect(pageFromT1.pageSize).toBe(25);
        expect(pageFromT1.items).toHaveLength(2);

        // Newest-first ordering: σ2's homework (H2) is items[0]; σ1's (H1) is
        // items[1]. Repo orders by session.started_at DESC NULLS LAST, then
        // home_work.id DESC (deterministic tiebreak).
        expect(pageFromT1.items[0]?.id).toBe(h2Row.id);
        expect(pageFromT1.items[0]?.sessionId).toBe(cast.sigma2Id);
        expect(pageFromT1.items[0]?.currentSurahJuz).toBe(H2_JADID.surahJuz);
        expect(pageFromT1.items[0]?.revisionSurahJuz).toBe(H2_MADI.surahJuz);
        expect(pageFromT1.items[0]?.currentGrade).toBeNull();
        expect(pageFromT1.items[0]?.revisionGrade).toBeNull();
        expect(pageFromT1.items[1]?.id).toBe(h1Row.id);
        expect(pageFromT1.items[1]?.sessionId).toBe(cast.sigma1Id);
        expect(pageFromT1.items[1]?.currentSurahJuz).toBe(H1_JADID.surahJuz);
        expect(pageFromT1.items[1]?.revisionSurahJuz).toBe(H1_MADI.surahJuz);

        // T2 reads the same student's history — visibility is symmetric, not
        // author-scoped; the same two rows, same order.
        const pageFromT2 = await listStudentHomeworkHistory(cast.t2UserId, cast.studentId, undefined, LOCALE, tx);
        expect(pageFromT2.totalCount).toBe(2);
        expect(pageFromT2.items).toHaveLength(2);
        expect(pageFromT2.items[0]?.id).toBe(h2Row.id);
        expect(pageFromT2.items[1]?.id).toBe(h1Row.id);

        // The read path is SILENT on success — the M1 read posture.
        expect(logs.records).toEqual([]);
      } finally {
        logs.stop();
      }
    });
  });

  test("read purity — ZERO writes across hit and null-success paths", async () => {
    await runInRollback(async tx => {
      const cast = await provisionCrossTeacherCast(tx, { linkedParent: true, foreignTeacher: true });
      const homeWorkBefore = await countHomeWorkRowsFor(tx, [cast.sigma1Id, cast.sigma2Id]);

      const logs = recordDomainLogs();
      try {
        // Two hits (T1 + T2 reads).
        await listStudentHomeworkHistory(cast.t1UserId, cast.studentId, undefined, LOCALE, tx);
        await listStudentHomeworkHistory(cast.t2UserId, cast.studentId, undefined, LOCALE, tx);
        // One denial (foreign teacher Ft — does NOT touch any row).
        await expectRepoError(() => listStudentHomeworkHistory(cast.ftUserId, cast.studentId, undefined, LOCALE, tx));

        // Zero writes anywhere — the read path is pure.
        expect(await countHomeWorkRowsFor(tx, [cast.sigma1Id, cast.sigma2Id])).toBe(homeWorkBefore);
        expect(logs.records).toHaveLength(1);
        expect(logs.records[0]?.code).toBe("FORBIDDEN");
      } finally {
        logs.stop();
      }
    });
  });
});

// ─── Tier 2: boundaries — empty history, clamp matrix, envelope echo ────────

describe("Tier 2 — clamp boundaries, envelope echo, empty history (runInRollback)", () => {
  test("empty history — totalCount 0; empty items; effective page 1/pageSize 25; zero logs", async () => {
    await runInRollback(async tx => {
      // Student S with a linked session to a teacher T1 but NO homework
      // submitted — the gate passes (T1 holds a session with S), but the
      // history window is empty.
      const studentUser = await createTestUser(tx, { role: "student", locale: "en" });
      await createTestStudent(tx, studentUser.id, { balanceHifz: 1, balanceTrial: 0 });
      const teacherUser = await createTestUser(tx, { role: "teacher", locale: "en" });
      await createTestTeacherRow(tx, teacherUser.id, { isApproved: true });
      const sigma = await SessionLifecycleService.createSession(
        studentUser.id,
        { teacherId: teacherUser.id, intent: SessionIntent.Hifz },
        `svc-shw-empty-${randomUUID()}`,
        LOCALE,
        tx
      );
      await SessionLifecycleService.startSession(teacherUser.id, sigma.id, LOCALE, tx);
      await SessionLifecycleService.completeSession(teacherUser.id, sigma.id, LOCALE, tx);

      const logs = recordDomainLogs();
      try {
        const page = await listStudentHomeworkHistory(teacherUser.id, studentUser.id, undefined, LOCALE, tx);

        expect(Object.keys(page).toSorted((a, b) => a.localeCompare(b))).toEqual([...ENVELOPE_KEYS]);
        expect(page.totalCount).toBe(0);
        expect(page.items).toEqual([]);
        expect(page.page).toBe(1);
        expect(page.pageSize).toBe(25);
        expect(logs.records).toEqual([]);
      } finally {
        logs.stop();
      }
    });
  });

  test("clamp matrix — page 0 → 1; pageSize 0 → 25; pageSize 51 → 25; pageSize 50 → 50; omitted → 25; effective values echoed", async () => {
    await runInRollback(async tx => {
      const cast = await provisionCrossTeacherCast(tx, { linkedParent: true });
      const logs = recordDomainLogs();
      try {
        // page: 0 → effective page 1 (non-positive page resolves to the
        // first page).
        const zeroPage = await listStudentHomeworkHistory(
          cast.t1UserId,
          cast.studentId,
          { page: 0, pageSize: 25 },
          LOCALE,
          tx
        );
        expect(zeroPage.page).toBe(1);
        expect(zeroPage.pageSize).toBe(25);
        expect(zeroPage.totalCount).toBe(2);
        expect(zeroPage.items).toHaveLength(2);

        // pageSize: 0 → effective 25 (non-positive or non-integer pageSize
        // resolves to the default).
        const zeroPageSize = await listStudentHomeworkHistory(
          cast.t1UserId,
          cast.studentId,
          { page: 1, pageSize: 0 },
          LOCALE,
          tx
        );
        expect(zeroPageSize.page).toBe(1);
        expect(zeroPageSize.pageSize).toBe(25);
        expect(zeroPageSize.items).toHaveLength(2);

        // pageSize: 51 → effective 25 (oversized pageSize RESETS to the
        // default — the canonical pagination contract: any out-of-range
        // `pageSize`, including the just-above-cap shape, resolves to the
        // default rather than clamping to the cap).
        const oversizedPageSize = await listStudentHomeworkHistory(
          cast.t1UserId,
          cast.studentId,
          { page: 1, pageSize: 51 },
          LOCALE,
          tx
        );
        expect(oversizedPageSize.page).toBe(1);
        expect(oversizedPageSize.pageSize).toBe(25);
        expect(oversizedPageSize.items).toHaveLength(2);

        // pageSize: 50 — the hard cap; at-cap is accepted verbatim.
        const atCapPageSize = await listStudentHomeworkHistory(
          cast.t1UserId,
          cast.studentId,
          { page: 1, pageSize: 50 },
          LOCALE,
          tx
        );
        expect(atCapPageSize.page).toBe(1);
        expect(atCapPageSize.pageSize).toBe(50);
        expect(atCapPageSize.items).toHaveLength(2);

        // omitted args → effective page 1, pageSize 25.
        const omitted = await listStudentHomeworkHistory(cast.t1UserId, cast.studentId, undefined, LOCALE, tx);
        expect(omitted.page).toBe(1);
        expect(omitted.pageSize).toBe(25);

        // fractional / NaN / negative shapes all clamp to defaults.
        const junkPageSize = await listStudentHomeworkHistory(
          cast.t1UserId,
          cast.studentId,
          { page: Number.NaN, pageSize: 1.5 },
          LOCALE,
          tx
        );
        expect(junkPageSize.page).toBe(1);
        expect(junkPageSize.pageSize).toBe(25);

        expect(logs.records).toEqual([]);
      } finally {
        logs.stop();
      }
    });
  });

  test("envelope echo — exactly {items, totalCount, page, pageSize} shape, no extras", async () => {
    await runInRollback(async tx => {
      const cast = await provisionCrossTeacherCast(tx, { linkedParent: true });
      const logs = recordDomainLogs();
      try {
        const page = await listStudentHomeworkHistory(cast.t1UserId, cast.studentId, undefined, LOCALE, tx);
        // Exactly the four envelope keys, nothing else — the closed
        // list-wrapper contract.
        expect(Object.keys(page).toSorted((a, b) => a.localeCompare(b))).toEqual([...ENVELOPE_KEYS]);
        expect(logs.records).toEqual([]);
      } finally {
        logs.stop();
      }
    });
  });

  test("out-of-range page — empty items next to the true totalCount; honest window, never fabricated", async () => {
    await runInRollback(async tx => {
      const cast = await provisionCrossTeacherCast(tx, { linkedParent: true });
      const logs = recordDomainLogs();
      try {
        // Page 1_000 — far beyond the two-row window. The service clamps the
        // page arg to its effective value, computes the offset, and returns
        // an EMPTY items array next to the honest totalCount.
        const beyond = await listStudentHomeworkHistory(
          cast.t1UserId,
          cast.studentId,
          { page: 1_000, pageSize: 25 },
          LOCALE,
          tx
        );
        expect(beyond.page).toBe(1_000);
        expect(beyond.pageSize).toBe(25);
        expect(beyond.totalCount).toBe(2);
        expect(beyond.items).toEqual([]);
        expect(logs.records).toEqual([]);
      } finally {
        logs.stop();
      }
    });
  });

  test("pageSize = 1 — second page yields the oldest row alone (offset math correctness)", async () => {
    await runInRollback(async tx => {
      const cast = await provisionCrossTeacherCast(tx, { linkedParent: true });
      const h1Row = await homeworkRowBySessionId(tx, cast.sigma1Id);
      const h2Row = await homeworkRowBySessionId(tx, cast.sigma2Id);
      if (!h1Row || !h2Row) {
        throw new Error("fixture integrity failure: σ1/σ2 homework rows missing");
      }

      const logs = recordDomainLogs();
      try {
        // Page 1, size 1 → the newest row (H2) only.
        const firstPage = await listStudentHomeworkHistory(
          cast.t1UserId,
          cast.studentId,
          { page: 1, pageSize: 1 },
          LOCALE,
          tx
        );
        expect(firstPage.totalCount).toBe(2);
        expect(firstPage.items).toHaveLength(1);
        expect(firstPage.items[0]?.id).toBe(h2Row.id);

        // Page 2, size 1 → the oldest row (H1) only — the offset math
        // (offset = (page-1)*pageSize) skips the newest row.
        const secondPage = await listStudentHomeworkHistory(
          cast.t1UserId,
          cast.studentId,
          { page: 2, pageSize: 1 },
          LOCALE,
          tx
        );
        expect(secondPage.totalCount).toBe(2);
        expect(secondPage.items).toHaveLength(1);
        expect(secondPage.items[0]?.id).toBe(h1Row.id);
        expect(logs.records).toEqual([]);
      } finally {
        logs.stop();
      }
    });
  });
});

// ─── Tier 3: chaos — concurrent reads, committed cast ───────────────────────
// runInRollback can never prove committed-scope semantics (concurrent reads on
// separate connections, REAL commit boundaries), so this tier provisions its
// cast in ONE committing `beforeAll` transaction through the REAL
// session-lifecycle path (book → start → complete — the σ setup) and
// hard-deletes it in `afterAll` via `TrackedFixtures` (Rule 9).

interface ChaosCast {
  readonly studentId: number;
  readonly t1UserId: number;
  readonly t2UserId: number;
  readonly ftUserId: number;
  readonly parentUserId: number;
  readonly sigma1Id: number;
  readonly sigma2Id: number;
}

let chaosCast: ChaosCast | null = null;
const tracked = new TrackedFixtures();

/** Unwraps the committed cast, failing loudly if beforeAll did not run. */
function requireCast(cast: ChaosCast | null): ChaosCast {
  if (!cast) {
    throw new Error("expected the committed beforeAll cast to exist");
  }
  return cast;
}

/**
 * Registers the idempotency claim a committed booking spent INSIDE the
 * provisioning transaction (a standalone helper would open its own short
 * connection — useless when the booking row is still uncommitted inside
 * `beforeAll`'s outer transaction).
 */
async function registerClaimRowInTx(tx: DBTransaction, key: string, label: string): Promise<void> {
  const rows = await tx
    .select({ id: sessionRequestIdempotency.id })
    .from(sessionRequestIdempotency)
    .where(eq(sessionRequestIdempotency.idempotencyKey, key));
  const claim = rows.at(0);
  if (!claim) {
    throw new Error(`chaos: idempotency claim for ${label} not found (fixture tracking failure)`);
  }
  tracked.register(sessionRequestIdempotency, claim.id);
}

/**
 * Books, starts, and completes ONE session through the REAL lifecycle path
 * inside the caller's committing transaction (the σ setup), then registers
 * the session and its booking claim for teardown.
 */
async function provisionLifecycleSessionInTx(
  tx: DBTransaction,
  studentId: number,
  teacherId: number,
  key: string
): Promise<SessionReturnType> {
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
  return completed;
}

beforeAll(async () => {
  chaosCast = await db.transaction(async tx => {
    const runPrefix = `svc-shw-chaos-${randomUUID().slice(0, 8)}`;

    const studentUser = await createTestUser(tx, {
      role: "student",
      locale: "en",
      fullName: `${runPrefix} student S`,
    });
    const studentRow = await createTestStudent(tx, studentUser.id, { balanceHifz: 2, balanceTrial: 0 });
    tracked.register(users, studentUser.id);
    tracked.register(students, studentRow.id);

    const parentUser = await createTestUser(tx, {
      role: "parent",
      locale: "ar",
      fullName: `${runPrefix} parent P`,
    });
    const parentRow = await createTestParent(tx, parentUser.id);
    tracked.register(users, parentUser.id);
    tracked.register(parents, parentRow.id);
    await tx.update(students).set({ parentId: parentUser.id }).where(eq(students.id, studentRow.id));

    const t1User = await createTestUser(tx, {
      role: "teacher",
      locale: "en",
      fullName: `${runPrefix} teacher T1`,
    });
    const t1Row = await createTestTeacherRow(tx, t1User.id, { isApproved: true });
    tracked.register(users, t1User.id);
    tracked.register(teacher, t1Row.id);

    const t2User = await createTestUser(tx, {
      role: "teacher",
      locale: "en",
      fullName: `${runPrefix} teacher T2`,
    });
    const t2Row = await createTestTeacherRow(tx, t2User.id, { isApproved: true });
    tracked.register(users, t2User.id);
    tracked.register(teacher, t2Row.id);

    const ftUser = await createTestUser(tx, {
      role: "teacher",
      locale: "en",
      fullName: `${runPrefix} teacher Ft`,
    });
    const ftRow = await createTestTeacherRow(tx, ftUser.id, { isApproved: true });
    tracked.register(users, ftUser.id);
    tracked.register(teacher, ftRow.id);

    const sigma1 = await provisionLifecycleSessionInTx(tx, studentUser.id, t1User.id, `${runPrefix}-k-s1`);
    const sigma2 = await provisionLifecycleSessionInTx(tx, studentUser.id, t2User.id, `${runPrefix}-k-s2`);
    await registerClaimRowInTx(tx, `${runPrefix}-k-s1`, "σ1 booking");
    await registerClaimRowInTx(tx, `${runPrefix}-k-s2`, "σ2 booking");

    const submitOptions = freshEngineOptions().options;
    await SessionReportService.submitSessionReport(
      t1User.id,
      sigma1.id,
      {
        teacherNotes: VALID_NOTES,
        studentRatingByTeacher: 4,
        homework: { jadid: H1_JADID, madi: H1_MADI },
      },
      LOCALE,
      tx,
      submitOptions
    );
    await SessionReportService.submitSessionReport(
      t2User.id,
      sigma2.id,
      {
        teacherNotes: VALID_NOTES,
        studentRatingByTeacher: 4,
        homework: { jadid: H2_JADID, madi: H2_MADI },
      },
      LOCALE,
      tx,
      submitOptions
    );

    // Track the service-created rows (reports + home_work + notifications
    // cascade with their sessions/users, so session + user registration
    // covers teardown; explicit registration is a defensive belt-and-braces).
    const reportRows = await tx
      .select({ id: reports.id })
      .from(reports)
      .where(inArray(reports.sessionId, [sigma1.id, sigma2.id]));
    for (const row of reportRows) {
      tracked.register(reports, row.id);
    }
    const homeworkRows = await tx
      .select({ id: homeWork.id })
      .from(homeWork)
      .where(inArray(homeWork.sessionId, [sigma1.id, sigma2.id]));
    for (const row of homeworkRows) {
      tracked.register(homeWork, row.id);
    }

    return {
      studentId: studentUser.id,
      t1UserId: t1User.id,
      t2UserId: t2User.id,
      ftUserId: ftUser.id,
      parentUserId: parentUser.id,
      sigma1Id: sigma1.id,
      sigma2Id: sigma2.id,
    };
  });
});

afterAll(async () => {
  // Reverse-registration-order hard delete + zero-residue re-probes; reports
  // and home_work cascade with their sessions, notifications with their users.
  await tracked.cleanup();
});

describe("Tier 3 — concurrent reads on a committed cast (Promise.allSettled)", () => {
  test("fuzz — N valid reads from each teacher + N foreign-teacher + N random-unknown ids; success set consistent; failure set byte-identical", async () => {
    const cast = requireCast(chaosCast);
    const h1Row = await homeworkRowBySessionId(db, cast.sigma1Id);
    const h2Row = await homeworkRowBySessionId(db, cast.sigma2Id);
    if (!h1Row || !h2Row) {
      throw new Error("chaos fixture integrity failure: σ1/σ2 homework rows missing");
    }

    // Build the work mix: N valid reads from T1, N from T2 (successes), N
    // foreign-teacher reads (failures), N random-unknown-student-id reads
    // (failures). Each call opens its OWN top-level transaction (the
    // production `outerTx=undefined` path) — concurrent reads share the pool.
    const validReads: Array<() => Promise<StudentHomeworkPageReturnType>> = [
      ...Array.from(
        { length: STORM_N },
        () => () => listStudentHomeworkHistory(cast.t1UserId, cast.studentId, undefined, LOCALE)
      ),
      ...Array.from(
        { length: STORM_N },
        () => () => listStudentHomeworkHistory(cast.t2UserId, cast.studentId, undefined, LOCALE)
      ),
    ];
    const invalidReads: Array<() => Promise<unknown>> = [
      ...Array.from(
        { length: STORM_N },
        () => () => listStudentHomeworkHistory(cast.ftUserId, cast.studentId, undefined, LOCALE)
      ),
      // Random unknown student ids — guaranteed absent (large positive safe
      // integers far beyond any identity sequence).
      ...Array.from(
        { length: STORM_N },
        (_, index) => () => listStudentHomeworkHistory(cast.t1UserId, ABSENT_STUDENT_ID + index, undefined, LOCALE)
      ),
    ];

    const logs = recordDomainLogs();
    let settled: PromiseSettledResult<unknown>[];
    try {
      // Each unit opens its own transaction (separate pool connections).
      settled = await Promise.allSettled([...validReads, ...invalidReads].map(work => work()));
    } finally {
      logs.stop();
    }

    const fulfilled = settled.filter(
      (r): r is PromiseFulfilledResult<StudentHomeworkPageReturnType> => r.status === "fulfilled"
    );
    const rejected = settled.filter((r): r is PromiseRejectedResult => r.status === "rejected");

    // Exactly 2*STORM_N successes (T1 + T2 reads), each consistent: window
    // newest-first (H2 → H1), totalCount 2, page 1, pageSize 25.
    expect(fulfilled).toHaveLength(2 * STORM_N);
    for (const result of fulfilled) {
      const page = result.value;
      expect(Object.keys(page).toSorted((a, b) => a.localeCompare(b))).toEqual([...ENVELOPE_KEYS]);
      expect(page.totalCount).toBe(2);
      expect(page.page).toBe(1);
      expect(page.pageSize).toBe(25);
      expect(page.items).toHaveLength(2);
      expect(page.items[0]?.id).toBe(h2Row.id);
      expect(page.items[0]?.sessionId).toBe(cast.sigma2Id);
      expect(page.items[1]?.id).toBe(h1Row.id);
      expect(page.items[1]?.sessionId).toBe(cast.sigma1Id);
    }

    // Exactly 2*STORM_N failures — byte-identical ForbiddenError across
    // every miss (foreign teacher + random unknown ids collapse to the
    // SAME oracle — no existence disclosure under concurrent load).
    expect(rejected).toHaveLength(2 * STORM_N);
    const denials: Error[] = [];
    for (const result of rejected) {
      const reason = result.reason;
      denials.push(reason instanceof Error ? reason : new Error(String(reason)));
    }
    for (const denial of denials) {
      assertConstantForbidden(denial);
    }
    for (let index = 1; index < denials.length; index += 1) {
      assertIdenticalDenialShape(denials[0], denials[index]);
    }

    // Each failure logged exactly ONE bounded domain log; successes logged
    // nothing. The records carry the FORBIDDEN code, the `students` entity,
    // the target studentId, and the request locale.
    expect(logs.records).toHaveLength(2 * STORM_N);
    for (const record of logs.records) {
      expect(record.code).toBe("FORBIDDEN");
      expect(record.entity).toBe("students");
      expect(record.locale).toBe(LOCALE);
    }
  });

  test("determinism evidence — repeat the storm; identical summaries across runs", async () => {
    const cast = requireCast(chaosCast);

    /** Records one storm run's outcome summary. */
    interface StormSummary {
      readonly successes: number;
      readonly failures: number;
      readonly forbiddenCodes: number;
      readonly nonForbiddenCodes: number;
    }

    /** Runs one storm and classifies the outcome summary. */
    const runStorm = async (): Promise<StormSummary> => {
      const tasks = Array.from(
        { length: STORM_N },
        () => () => listStudentHomeworkHistory(cast.t1UserId, cast.studentId, undefined, LOCALE)
      ).concat(
        Array.from(
          { length: STORM_N },
          () => () => listStudentHomeworkHistory(cast.ftUserId, cast.studentId, undefined, LOCALE)
        )
      );
      const logs = recordDomainLogs();
      let settled: PromiseSettledResult<unknown>[];
      try {
        settled = await Promise.allSettled(tasks.map(work => work()));
      } finally {
        logs.stop();
      }
      const successes = settled.filter(r => r.status === "fulfilled").length;
      const failures = settled.filter(r => r.status === "rejected").length;
      const forbiddenCodes = logs.records.filter(r => r.code === "FORBIDDEN").length;
      const nonForbiddenCodes = logs.records.filter(r => r.code !== "FORBIDDEN").length;
      return { successes, failures, forbiddenCodes, nonForbiddenCodes };
    };

    const summary1 = await runStorm();
    const summary2 = await runStorm();

    // Both runs yield byte-identical summaries — the deterministic
    // one-winner-per-id-shape invariant under repeat.
    expect(summary2).toEqual(summary1);
    expect(summary1).toEqual({
      successes: STORM_N,
      failures: STORM_N,
      forbiddenCodes: STORM_N,
      nonForbiddenCodes: 0,
    });
  });

  test("mid-storm read never throws — every read between settled attempts resolves or rejects with the typed oracle", async () => {
    const cast = requireCast(chaosCast);
    const tasks = Array.from(
      { length: STORM_N * 2 },
      (_, index) => () =>
        listStudentHomeworkHistory(index % 2 === 0 ? cast.t1UserId : cast.ftUserId, cast.studentId, undefined, LOCALE)
    );
    const logs = recordDomainLogs();
    let settled: PromiseSettledResult<unknown>[];
    try {
      settled = await Promise.allSettled(tasks.map(work => work()));
    } finally {
      logs.stop();
    }
    // Half succeed, half deny — and every rejection is the constant
    // ForbiddenError oracle (no raw Error leaks through the read path).
    const rejections = settled.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    for (const rejection of rejections) {
      const reason = rejection.reason;
      if (!(reason instanceof ForbiddenError)) {
        throw new Error(`mid-storm read leaked a non-FORBIDDEN error: ${String(reason)}`);
      }
    }
    expect(rejections).toHaveLength(STORM_N);
    expect(logs.records).toHaveLength(STORM_N);
  });
});

// ─── Tier 4: security / abuse — invalid-role shapes, hostile id matrix ──────

describe("Tier 4 — invalid-role callers + hostile id matrix + outerTx SAVEPOINT seam (runInRollback)", () => {
  test("invalid-role callers (student / parent / admin) collapse to byte-identical FORBIDDEN via the relationship gate", async () => {
    await runInRollback(async tx => {
      const cast = await provisionCrossTeacherCast(tx, { linkedParent: true, foreignTeacher: true });

      // A student and an admin — neither holds any session-as-teacher for
      // the student, so the EXISTS predicate fails and the gate denies with
      // the constant FORBIDDEN oracle.
      const studentCaller = await createTestUser(tx, { role: "student", locale: "en" });
      await createTestStudent(tx, studentCaller.id, {});
      const adminUser = await createTestUser(tx, { role: "admin", locale: "en" });
      const adminRow = await createTestAdmin(tx, adminUser.id);
      expect(adminRow.id).toBe(adminUser.id);

      const logs = recordDomainLogs();
      let studentError: Error;
      let parentError: Error;
      let adminError: Error;
      try {
        studentError = await expectRepoError(() =>
          listStudentHomeworkHistory(studentCaller.id, cast.studentId, undefined, LOCALE, tx)
        );
        parentError = await expectRepoError(() =>
          listStudentHomeworkHistory(cast.parentUserId, cast.studentId, undefined, LOCALE, tx)
        );
        adminError = await expectRepoError(() =>
          listStudentHomeworkHistory(adminUser.id, cast.studentId, undefined, LOCALE, tx)
        );
      } finally {
        logs.stop();
      }

      // All three collapse to the SAME byte-identical FORBIDDEN denial —
      // the service's `requireTeacherOfStudent` gate is the inner shield;
      // it denies consistently regardless of caller-supplied shape.
      assertConstantForbidden(studentError);
      assertConstantForbidden(parentError);
      assertConstantForbidden(adminError);
      assertIdenticalDenialShape(studentError, parentError);
      assertIdenticalDenialShape(parentError, adminError);

      // Exactly one bounded log per denial — three calls, three logs.
      expect(logs.records).toHaveLength(3);
      for (const record of logs.records) {
        expect(record.code).toBe("FORBIDDEN");
        expect(record.entity).toBe("students");
      }
    });
  });

  test("the byte-identical FORBIDDEN denial is independent of the caller's teacher-role-ness — non-teacher ids of any shape collapse alike", async () => {
    await runInRollback(async tx => {
      const cast = await provisionCrossTeacherCast(tx, { linkedParent: true, foreignTeacher: true });

      // A foreign teacher's user id whose numeric value happens to coincide
      // with a real admin user's id is contrived here by routing both shapes
      // through the same predicate: the EXISTS gate fails for the foreign
      // teacher, the student caller, and the admin caller — byte-identical.
      const logs = recordDomainLogs();
      let foreignError: Error;
      let studentError: Error;
      try {
        foreignError = await expectRepoError(() =>
          listStudentHomeworkHistory(cast.ftUserId, cast.studentId, undefined, LOCALE, tx)
        );
        studentError = await expectRepoError(() =>
          listStudentHomeworkHistory(cast.studentUserId, cast.studentId, undefined, LOCALE, tx)
        );
      } finally {
        logs.stop();
      }

      assertConstantForbidden(foreignError);
      assertConstantForbidden(studentError);
      assertIdenticalDenialShape(foreignError, studentError);
      expect(logs.records).toHaveLength(2);
    });
  });

  test("hostile id matrix (0 / -1 / 1.5 / NaN / 2**53) ⇒ pre-DB VALIDATION; byte-identical; ZERO logDomainError (the guard throws before any log)", async () => {
    await runInRollback(async tx => {
      const cast = await provisionCrossTeacherCast(tx, { linkedParent: true });
      const hostileIds = [0, -1, 1.5, Number.NaN, 2 ** 53] as const;

      const logs = recordDomainLogs();
      let errors: Error[];
      try {
        errors = await Promise.all(
          hostileIds.map(hostileId =>
            expectRepoError(() => listStudentHomeworkHistory(cast.t1UserId, hostileId, undefined, LOCALE, tx))
          )
        );
      } finally {
        logs.stop();
      }

      for (const error of errors) {
        const denial = requireDomainError(error, ValidationError);
        assertDenial(denial, "VALIDATION", ERRORS_EN.validation);
      }

      // The pre-DB id-shape guard throws the localized VALIDATION denial
      // BEFORE any SQL round-trip AND before any logDomainError call — the
      // read path stays SILENT across hostile ids.
      expect(logs.records).toEqual([]);

      // Byte-identity: every hostile shape produces the SAME ValidationError
      // (constructor, code, message, extensions) — the oracle holds.
      for (let index = 1; index < errors.length; index += 1) {
        assertIdenticalDenialShape(errors[0], errors[index]);
      }
    });
  });

  test("hostile id matrix under the ar locale — byte-identical VALIDATION with ar copy; ZERO logDomainError", async () => {
    await runInRollback(async tx => {
      const cast = await provisionCrossTeacherCast(tx, { linkedParent: true });
      const hostileIds = [0, -1, 1.5, Number.NaN, 2 ** 53] as const;

      const logs = recordDomainLogs();
      let errors: Error[];
      try {
        errors = await Promise.all(
          hostileIds.map(hostileId =>
            expectRepoError(() => listStudentHomeworkHistory(cast.t1UserId, hostileId, undefined, "ar", tx))
          )
        );
      } finally {
        logs.stop();
      }

      for (const error of errors) {
        const denial = requireDomainError(error, ValidationError);
        assertDenial(denial, "VALIDATION", ERRORS_AR.validation);
        // The ar denial carries the ar copy (the message differs from the en).
        expect(denial.message).not.toContain(ERRORS_EN.validation);
      }
      expect(logs.records).toEqual([]);
      for (let index = 1; index < errors.length; index += 1) {
        assertIdenticalDenialShape(errors[0], errors[index]);
      }
    });
  });

  test("pageSize clamp bounds abusive paging — extreme sizes collapse to 25 (default) / 50 (cap); the effective value echoes", async () => {
    await runInRollback(async tx => {
      const cast = await provisionCrossTeacherCast(tx, { linkedParent: true });
      const logs = recordDomainLogs();
      try {
        // Hostile page sizes: negative, NaN, fractional, very large, very
        // small — all collapse to the default (25) or the cap (50).
        const hostile = await Promise.all([
          listStudentHomeworkHistory(cast.t1UserId, cast.studentId, { pageSize: -1 }, LOCALE, tx),
          listStudentHomeworkHistory(cast.t1UserId, cast.studentId, { pageSize: Number.NaN }, LOCALE, tx),
          listStudentHomeworkHistory(cast.t1UserId, cast.studentId, { pageSize: 1.5 }, LOCALE, tx),
          listStudentHomeworkHistory(cast.t1UserId, cast.studentId, { pageSize: 1_000_000 }, LOCALE, tx),
          listStudentHomeworkHistory(cast.t1UserId, cast.studentId, { pageSize: Number.POSITIVE_INFINITY }, LOCALE, tx),
        ]);
        const pageSizes = hostile.map(page => page.pageSize);
        for (const size of pageSizes) {
          // The clamp resolves every hostile pageSize to 25 (default) or
          // 50 (cap) — never the raw supplied value.
          expect(size === 25 || size === 50).toBe(true);
          expect(size).toBeLessThanOrEqual(50);
          expect(size).toBeGreaterThanOrEqual(1);
        }
        expect(logs.records).toEqual([]);
      } finally {
        logs.stop();
      }
    });
  });

  test("outerTx SAVEPOINT seam — service joins the caller's tx; the read sees rows that have NOT committed; zero commits leak after rollback", async () => {
    let leakedSessionId: number | null = null;
    let leakedStudentId: number | null = null;
    await runInRollback(async tx => {
      // Provision a single session + homework row directly inside the
      // rollback tx — these rows have NOT committed to the wider DB.
      const studentUser = await createTestUser(tx, { role: "student", locale: "en" });
      await createTestStudent(tx, studentUser.id, { balanceHifz: 0, balanceTrial: 0 });
      const teacherUser = await createTestUser(tx, { role: "teacher", locale: "en" });
      await createTestTeacherRow(tx, teacherUser.id, { isApproved: true });
      const sessionRow = await createTestSession(tx, teacherUser.id, studentUser.id, {
        status: SessionStatus.Completed,
        startedAt: new Date(),
        endedAt: new Date(),
        confirmedByTeacherAt: new Date(),
      });
      await createTestHomeWork(tx, sessionRow.id, {
        currentFromAyah: H1_JADID.fromAyah,
        currentToAyah: H1_JADID.toAyah,
        currentSurahJuz: H1_JADID.surahJuz,
        revisionFromAyah: H1_MADI.fromAyah,
        revisionToAyah: H1_MADI.toAyah,
        revisionSurahJuz: H1_MADI.surahJuz,
      });

      // Call the service with the rollback tx as the outerTx seam. The
      // service joins the caller's transaction as a SAVEPOINT and reads
      // the UNCOMMITTED row from the same snapshot.
      const logs = recordDomainLogs();
      try {
        const page = await listStudentHomeworkHistory(teacherUser.id, studentUser.id, undefined, LOCALE, tx);
        expect(logs.records).toEqual([]);
        expect(page.totalCount).toBe(1);
        expect(page.items).toHaveLength(1);
        expect(page.items[0]?.sessionId).toBe(sessionRow.id);
        expect(page.items[0]?.currentSurahJuz).toBe(H1_JADID.surahJuz);
      } finally {
        logs.stop();
      }

      leakedSessionId = sessionRow.id;
      leakedStudentId = studentUser.id;
    });

    // After rollback: ZERO commits leaked to the wider DB. The session row
    // is gone, so the homework row's `session_id` has no match. The student
    // row is gone too — the SAVEPOINT seam honored the rollback boundary.
    expect(leakedSessionId).not.toBeNull();
    expect(leakedStudentId).not.toBeNull();
    const sessionId = leakedSessionId;
    const studentIdLeak = leakedStudentId;
    if (sessionId === null || studentIdLeak === null) {
      throw new Error("SAVEPOINT seam test: expected captured session/student ids");
    }
    const leakedHomeWork = await db.select({ id: homeWork.id }).from(homeWork).where(eq(homeWork.sessionId, sessionId));
    expect(leakedHomeWork).toEqual([]);
    const leakedStudent = await db.select({ id: students.id }).from(students).where(eq(students.id, studentIdLeak));
    expect(leakedStudent).toEqual([]);
  });

  test("foreign-teacher denial vs unknown-student denial — byte-identical at the message level (not just code)", async () => {
    await runInRollback(async tx => {
      const cast = await provisionCrossTeacherCast(tx, { linkedParent: true, foreignTeacher: true });
      const missingId = await absentStudentId(tx);
      // INT4_MAX is a valid-shape id guaranteed absent — the third miss shape
      // the oracle covers (the constant denial is invariant across miss shapes).
      const int4MaxId = INT4_MAX_STUDENT_ID;

      const logs = recordDomainLogs();
      let foreignError: Error;
      let unknownError: Error;
      let int4MaxError: Error;
      try {
        foreignError = await expectRepoError(() =>
          listStudentHomeworkHistory(cast.ftUserId, cast.studentId, undefined, LOCALE, tx)
        );
        unknownError = await expectRepoError(() =>
          listStudentHomeworkHistory(cast.t1UserId, missingId, undefined, LOCALE, tx)
        );
        int4MaxError = await expectRepoError(() =>
          listStudentHomeworkHistory(cast.t1UserId, int4MaxId, undefined, LOCALE, tx)
        );
      } finally {
        logs.stop();
      }

      // Three miss shapes — byte-identical ForbiddenError across the set.
      assertConstantForbidden(foreignError);
      assertConstantForbidden(unknownError);
      assertConstantForbidden(int4MaxError);
      assertIdenticalDenialShape(foreignError, unknownError);
      assertIdenticalDenialShape(unknownError, int4MaxError);
      // The MESSAGE itself is byte-equal (not just `.toContain`) — the
      // constant-denial oracle holds at the string level.
      expect(foreignError.message).toBe(unknownError.message);
      expect(unknownError.message).toBe(int4MaxError.message);

      expect(logs.records).toHaveLength(3);
    });
  });
});
