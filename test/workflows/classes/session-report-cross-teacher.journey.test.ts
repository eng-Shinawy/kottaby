/**
 * Cross-actor journey — cross-teacher homework continuity (the visibility
 * oracle over a student whose session history spans two teachers).
 *
 * Layer contract (`test/workflows/AGENTS.md` + `docs/testing/workflow-journey-tests.md`):
 *  - NO `runInRollback` — fixtures COMMIT in `beforeAll` inside ONE committing
 *    transaction and are hard-deleted in `afterAll` via `TrackedFixtures` with
 *    post-teardown existence checks (zero residue), including every
 *    service-created side-effect row (reports, home_work, notifications,
 *    idempotency claims, sessions);
 *  - honest authorization only — the cast is real `users` rows + real
 *    role-child rows; per-actor persisted locales are pinned because the
 *    recipient-locale composition is a journey assertion (the entity-setup
 *    builders are used directly so `locale` lands on the user row);
 *  - sessions σ1 and σ2 reach `completed` through the REAL session-lifecycle
 *    service path (book → start → complete, the `outerTx` seam — the journey
 *    provisions both sessions inside ONE committing transaction);
 *  - external effects are intercepted at the injection seam:
 *    `SpiedFanoutTransport` + a suite-local Map-backed claim cache passed via
 *    the engine call options — no Redis, no WebSocket, ever;
 *  - denial assertions use `catchJourneyError` + translated substrings from
 *    `getServerTranslations("en").errorsTranslations` — never
 *    `expect(...).rejects.toThrow()`;
 *  - cross-actor visibility is asserted BOTH directions after every step,
 *    with side-effect counts scoped to fixture ids so shared-DB rows can never
 *    satisfy a delta.
 *
 * Assertion set (the ordered workflow):
 *  1. System: cast committed (S, T1, T2, Ft, linked parent P); σ1 + σ2
 *     completed through the real lifecycle path; baseline recorded.
 *  2. T1 submits σ1 report + homework H1 (both tracks, ungraded). The report
 *     row + the home_work row commit atomically; H1 born ungraded; the
 *     report-ready wave fires for the student (and the linked parent — in
 *     each recipient's persisted locale); the spied transport records the
 *     two publishes.
 *  3. T2 reads the student's history through the new service and SEES H1 —
 *     cross-teacher visibility from the observer perspective. The envelope
 *     echoes honestly; the read is silent (zero domain-log lines).
 *  4. T2 submits σ2 report with `previousGrades` (grading H1 once) and a new
 *     homework H2 (both tracks, ungraded). H1 carries both grades exactly
 *     once; H2 born ungraded; the report-ready wave fires again.
 *  5. T1 reads the student's history and sees BOTH rows — visibility is
 *     symmetric, not author-scoped. H2 is newest (items[0]); H1 carries the
 *     submitted grades.
 *  6. Foreign teacher Ft (zero sessions with S) probes the history → the
 *     constant `FORBIDDEN` denial (byte-identical copy, exactly ONE bounded
 *     `logDomainError`).
 *  7. Student S calls the history service as if it were the teacher → the
 *     constant `FORBIDDEN` denial (the teacher↔student relationship gate
 *     fails because no session lists S as its teacher).
 *  8. Replay safety: T2 re-submits σ2 → `SESSION_REPORT_ALREADY_EXISTS`.
 *
 * Run:
 *   bun run test/scripts/run-test.ts test/workflows/classes/session-report-cross-teacher.journey.test.ts
 */
import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/backend/db";
import { homeWork } from "@/backend/db/schema/classes/home-work";
import { reports } from "@/backend/db/schema/classes/reports";
import { session } from "@/backend/db/schema/classes/session";
import { sessionRequestIdempotency } from "@/backend/db/schema/classes/session-request-idempotency";
import { notifications } from "@/backend/db/schema/notifications/notifications";
import { parents } from "@/backend/db/schema/parents/parents";
import { students } from "@/backend/db/schema/students/students";
import { teacher } from "@/backend/db/schema/teachers/teacher";
import { users } from "@/backend/db/schema/users/users";
import {
  createTestParent,
  createTestStudent,
  createTestTeacherRow,
  createTestUser,
} from "@/backend/db/test/entity-setup";
import { NotificationType } from "@/backend/enum/notifications/notification-type.enum";
import { SessionIntent } from "@/backend/enum/scheduling/session-intent.enum";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import { SurahJuzRef } from "@/backend/enum/shared/surah-juz-ref.enum";
import { ConflictError, DomainError, ForbiddenError } from "@/backend/lib/errors";
import { type DomainErrorContext, logger } from "@/backend/lib/logger";
import { SessionLifecycleService } from "@/backend/services/classes/session-lifecycle.service";
import * as SessionReportService from "@/backend/services/classes/session-report.service";
import { listStudentHomeworkHistory } from "@/backend/services/classes/student-homework.service";
import type { NotificationEngineCallOptions } from "@/backend/services/notifications";
import {
  buildEmitClaimKey,
  type NotificationIdempotencyClaimCache,
} from "@/backend/services/notifications/emit-idempotency";
import type {
  DBTransaction,
  HomeWorkBlockInput,
  HomeWorkReturnType,
  NotificationReturnType,
  ReportReturnType,
  SessionReportSubmitInput,
  SessionReturnType,
  UserSelectType,
} from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import { catchJourneyError, journeyPrefix, SpiedFanoutTransport, TrackedFixtures } from "@/test/workflows/helpers";

/** Per-run unique prefix embedded in every fixture identity field (rule 3). */
const RUN_PREFIX = journeyPrefix("classes-cross");

/** The journey runs on the default test locale throughout. */
const LOCALE = "en";

/** Polymorphic entity pointer every report-wave row must carry. */
const RELATED_ENTITY_TYPE = "session";

/** Valid free-text notes reused by every accepted submission attempt. */
const VALID_NOTES = "Steady progress this session; next lesson continues the revision plan.";

/** σ1's homework assignment: Jadid on Surah Al-Fātihah + Madi on Juz 1 (both ungraded at birth). */
const H1_JADID: HomeWorkBlockInput = { fromAyah: 1, toAyah: 7, surahJuz: SurahJuzRef.SurahAlFatihah };
const H1_MADI: HomeWorkBlockInput = { fromAyah: 1, toAyah: 5, surahJuz: SurahJuzRef.Juz1 };

/** σ2's homework assignment: a different pair (so the visibility oracle can distinguish rows). */
const H2_JADID: HomeWorkBlockInput = { fromAyah: 8, toAyah: 12, surahJuz: SurahJuzRef.Juz2 };
const H2_MADI: HomeWorkBlockInput = { fromAyah: 3, toAyah: 9, surahJuz: SurahJuzRef.Juz4 };

/** Grades T2 records against H1 during the σ2 submission (the one-shot grade). */
const H1_CURRENT_GRADE = 88;
const H1_REVISION_GRADE = 74;

/** English translated denial copy — every assertion pins translated substrings. */
const ERRORS_EN = getServerTranslations("en").errorsTranslations;
/** English notification copy — the student wave composes in the student's locale. */
const NOTIFS_EN = getServerTranslations("en").notificationsTranslations;
/** Arabic notification copy — the parent wave composes in the parent's locale. */
const NOTIFS_AR = getServerTranslations("ar").notificationsTranslations;

/** One recorded domain-log call (code only — copy is never asserted from logs). */
interface DomainLogRecord {
  readonly code: string;
}

/**
 * Installs a recording stub over `logger.logDomainError` so domain rejections
 * stay silent in test output AND become assertable (exactly one bounded log
 * per denial; none on success). Callers MUST `stop()` (use try/finally).
 */
function recordDomainLogs(): { records: DomainLogRecord[]; stop: () => void } {
  const records: DomainLogRecord[] = [];
  const spy = spyOn(logger, "logDomainError").mockImplementation((_message: string, ctx?: DomainErrorContext) => {
    records.push({ code: ctx?.code ?? "<missing>" });
  });
  return { records, stop: () => spy.mockRestore() };
}

/**
 * Map-backed claim-cache double with SET-NX-EX semantics in memory, plus the
 * raw list of every attempted claim key so the journey can pin the engine's
 * key determinism (per-recipient digest over the same logical wave key).
 */
function createMemoryClaimCache(): NotificationIdempotencyClaimCache & { claimedKeys: readonly string[] } {
  const stored = new Map<string, string>();
  const attempted: string[] = [];
  return {
    claimedKeys: attempted,
    async claim(key: string, _ttlSeconds: number): Promise<boolean> {
      attempted.push(key);
      const fresh = !stored.has(key);
      if (fresh) {
        stored.set(key, "");
      }
      return fresh;
    },
    async get(key: string): Promise<string | null> {
      return stored.get(key) ?? null;
    },
    async store(key: string, value: string, _ttlSeconds: number): Promise<void> {
      stored.set(key, value);
    },
  };
}

/** BOPLA-tamper base input: a fully typed submission whose fields callers override per step. */
function baseSubmitInput(overrides: Partial<SessionReportSubmitInput> = {}): SessionReportSubmitInput {
  return { teacherNotes: VALID_NOTES, studentRatingByTeacher: 4, ...overrides };
}

/**
 * Report-wave notification rows one user holds for one session.
 *
 * The dual-confirmation handshake's completion-prompt row shares the SAME
 * `SessionCompletion` type and session `relatedEntityId` with the report-ready
 * wave, so the count is scoped to the wave's distinct `title` copy slot in
 * EITHER recipient locale (the student wave composes the English copy, the
 * parent wave the Arabic one — a user only ever receives waves in their own
 * persisted locale; the prompt composes a different title, which matches
 * neither). Exact counts stay exact.
 */
async function completionRowsFor(userId: number, sessionId: number): Promise<NotificationReturnType[]> {
  return db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, userId),
        eq(notifications.type, NotificationType.SessionCompletion),
        eq(notifications.relatedEntityId, sessionId),
        inArray(notifications.title, [NOTIFS_EN.eventSessionReportReadyTitle, NOTIFS_AR.eventSessionReportReadyTitle])
      )
    );
}

/**
 * Inbox size scoped to the report-wave rows one user holds — the
 * side-effect snapshot / cumulative-count oracle. Rows are matched on the
 * wave's `SessionCompletion` type and the report-ready `title` copy slot in
 * EITHER recipient locale, so the handshake completion-prompt rows (same type,
 * same relatedEntityId, different copy) never inflate the count.
 */
function reportWaveCountFor(userId: number): Promise<number> {
  return db.$count(
    notifications,
    and(
      eq(notifications.userId, userId),
      eq(notifications.type, NotificationType.SessionCompletion),
      inArray(notifications.title, [NOTIFS_EN.eventSessionReportReadyTitle, NOTIFS_AR.eventSessionReportReadyTitle])
    )
  );
}

/** Scoped `reports` row count — only rows belonging to the journey's sessions. */
async function countReportRows(sessionIds: readonly number[]): Promise<number> {
  return db.$count(reports, inArray(reports.sessionId, [...sessionIds]));
}

/** Scoped `home_work` row count — only rows belonging to the journey's sessions. */
async function countHomeWorkRows(sessionIds: readonly number[]): Promise<number> {
  return db.$count(homeWork, inArray(homeWork.sessionId, [...sessionIds]));
}

/** Direct read of one session's report row (independent read-back oracle). */
async function reportRowBySessionId(sessionId: number): Promise<ReportReturnType | null> {
  const rows = await db.select().from(reports).where(eq(reports.sessionId, sessionId));
  return rows.at(0) ?? null;
}

/** Direct read of one session's homework row (independent read-back oracle). */
async function homeworkRowBySessionId(sessionId: number): Promise<HomeWorkReturnType | null> {
  const rows = await db.select().from(homeWork).where(eq(homeWork.sessionId, sessionId));
  return rows.at(0) ?? null;
}

/** Asserts the caught denial carries EXACTLY `code` and the translated message. */
function assertDenialCodeAndCopy(caught: Error, code: string, translated: string): void {
  expect(caught).toBeInstanceOf(DomainError);
  if (!(caught instanceof DomainError)) {
    throw new Error(`expected a DomainError (got ${caught.name})`);
  }
  expect(caught.code).toBe(code);
  expect(caught.message).toContain(translated);
}

/**
 * Registers the idempotency claim a committed booking spent INSIDE the
 * provisioning transaction (a standalone helper would open its own short
 * connection — useless when the booking row is still uncommitted inside
 * `beforeAll`'s outer transaction).
 */
async function registerClaimRowInTx(
  tx: DBTransaction,
  key: string,
  label: string,
  tracked: TrackedFixtures
): Promise<void> {
  const rows = await tx
    .select({ id: sessionRequestIdempotency.id })
    .from(sessionRequestIdempotency)
    .where(eq(sessionRequestIdempotency.idempotencyKey, key));
  const claim = rows.at(0);
  if (!claim) {
    throw new Error(`journey: idempotency claim for ${label} not found (fixture tracking failure)`);
  }
  tracked.register(sessionRequestIdempotency, claim.id);
}

/** Books, starts, and completes one session through the REAL lifecycle path on an outer transaction. */
async function provisionCompletedSessionInTx(
  tx: DBTransaction,
  studentUserId: number,
  teacherUserId: number,
  key: string
): Promise<SessionReturnType> {
  const booked = await SessionLifecycleService.createSession(
    studentUserId,
    { teacherId: teacherUserId, intent: SessionIntent.Hifz },
    key,
    LOCALE,
    tx
  );
  await SessionLifecycleService.startSession(teacherUserId, booked.id, LOCALE, tx);
  return SessionLifecycleService.completeSession(teacherUserId, booked.id, LOCALE, tx);
}

describe("cross-actor journey: cross-teacher homework continuity", () => {
  const tracked = new TrackedFixtures();
  const transportSpy = new SpiedFanoutTransport();
  const claimCache = createMemoryClaimCache();
  const engineOptions: NotificationEngineCallOptions = { transport: transportSpy, cache: claimCache };

  // Per-run idempotency keys — one per booked session (rule 3 prefixes).
  const KEY_SIGMA1 = `${RUN_PREFIX}-k-sigma1`;
  const KEY_SIGMA2 = `${RUN_PREFIX}-k-sigma2`;

  let studentS: UserSelectType;
  let parentP: UserSelectType;
  let teacherT1: UserSelectType;
  let teacherT2: UserSelectType;
  let teacherFt: UserSelectType;

  let sigma1: SessionReturnType;
  let sigma2: SessionReturnType;

  /**
   * ONE committing transaction: commit-or-nothing fixture provisioning.
   * The cast (S, T1, T2, Ft, P) and BOTH completed sessions (σ1 with T1,
   * σ2 with T2) land together so the journey's first assertion observes
   * the post-completion baseline before any submit runs.
   */
  beforeAll(async () => {
    await db.transaction(async tx => {
      // Session student S — English locale, funded for exactly two bookings
      // (Hifz lane carries two units; the two σ bookings consume one each).
      studentS = await createTestUser(tx, {
        role: "student",
        locale: "en",
        fullName: `${RUN_PREFIX} student S`,
      });
      const studentSRow = await createTestStudent(tx, studentS.id, { balanceHifz: 2, balanceTrial: 0 });
      tracked.register(users, studentS.id);
      tracked.register(students, studentSRow.id);

      // Linked parent P — Arabic locale (recipient-locale composition proof:
      // the parent wave composes Arabic copy while the student wave composes
      // English copy).
      parentP = await createTestUser(tx, {
        role: "parent",
        locale: "ar",
        fullName: `${RUN_PREFIX} parent P`,
      });
      const parentRow = await createTestParent(tx, parentP.id);
      tracked.register(users, parentP.id);
      tracked.register(parents, parentRow.id);

      // Certified owning teacher T1 + T2 + foreign teacher Ft.
      teacherT1 = await createTestUser(tx, {
        role: "teacher",
        locale: "en",
        fullName: `${RUN_PREFIX} teacher T1`,
      });
      const teacherT1Row = await createTestTeacherRow(tx, teacherT1.id, { isApproved: true });
      tracked.register(users, teacherT1.id);
      tracked.register(teacher, teacherT1Row.id);

      teacherT2 = await createTestUser(tx, {
        role: "teacher",
        locale: "en",
        fullName: `${RUN_PREFIX} teacher T2`,
      });
      const teacherT2Row = await createTestTeacherRow(tx, teacherT2.id, { isApproved: true });
      tracked.register(users, teacherT2.id);
      tracked.register(teacher, teacherT2Row.id);

      teacherFt = await createTestUser(tx, {
        role: "teacher",
        locale: "en",
        fullName: `${RUN_PREFIX} teacher Ft`,
      });
      const teacherFtRow = await createTestTeacherRow(tx, teacherFt.id, { isApproved: true });
      tracked.register(users, teacherFt.id);
      tracked.register(teacher, teacherFtRow.id);

      // Parent link S → P (emulates the link-request mutation; the report
      // wave's parent leg composes against this row).
      await tx.update(students).set({ parentId: parentP.id }).where(eq(students.id, studentSRow.id));

      // σ1 — completed through the REAL lifecycle path (book → start →
      // complete), composed inside this provisioning transaction via the
      // outerTx seam. T1 owns σ1.
      sigma1 = await provisionCompletedSessionInTx(tx, studentS.id, teacherT1.id, KEY_SIGMA1);
      tracked.register(session, sigma1.id);
      await registerClaimRowInTx(tx, KEY_SIGMA1, "σ1 booking", tracked);

      // σ2 — same path, owned by T2 (the second certified teacher). This is
      // the cross-teacher continuity seed: T2 will later grade T1's homework.
      sigma2 = await provisionCompletedSessionInTx(tx, studentS.id, teacherT2.id, KEY_SIGMA2);
      tracked.register(session, sigma2.id);
      await registerClaimRowInTx(tx, KEY_SIGMA2, "σ2 booking", tracked);
    });
  });

  afterAll(async () => {
    // Reverse-registration-order hard delete + zero-residue re-probes for
    // EVERY tracked row (a leaking teardown fails the suite loudly).
    await tracked.cleanup();
  });

  test("step 1 — System: cast committed; σ1 + σ2 completed via the real lifecycle path; baseline recorded", async () => {
    expect(sigma1.status).toBe(SessionStatus.Completed);
    expect(sigma1.feeHeld).toBe(true);
    expect(sigma1.teacherId).toBe(teacherT1.id);
    expect(sigma1.studentId).toBe(studentS.id);

    expect(sigma2.status).toBe(SessionStatus.Completed);
    expect(sigma2.feeHeld).toBe(true);
    expect(sigma2.teacherId).toBe(teacherT2.id);
    expect(sigma2.studentId).toBe(studentS.id);

    // Baseline: zero report/homework/report-wave side effects anywhere.
    expect(await countReportRows([sigma1.id, sigma2.id])).toBe(0);
    expect(await countHomeWorkRows([sigma1.id, sigma2.id])).toBe(0);
    expect(await reportWaveCountFor(studentS.id)).toBe(0);
    expect(await reportWaveCountFor(parentP.id)).toBe(0);
    expect(await reportWaveCountFor(teacherT1.id)).toBe(0);
    expect(await reportWaveCountFor(teacherT2.id)).toBe(0);
    expect(await reportWaveCountFor(teacherFt.id)).toBe(0);
    expect(transportSpy.publishCount).toBe(0);
    // 5 users + 1 student + 1 parent + 3 teachers + 2 sessions + 2 idempotency claims.
    expect(tracked.size).toBe(14);
  });

  test("step 2 — T1 submits σ1 report + homework H1: report+home_work committed atomically; H1 born ungraded; report-ready wave fires for S and P", async () => {
    const logs = recordDomainLogs();
    const beforePublishes = transportSpy.publishCount;
    try {
      const submits = await SessionReportService.submitSessionReport(
        teacherT1.id,
        sigma1.id,
        baseSubmitInput({ homework: { jadid: H1_JADID, madi: H1_MADI } }),
        LOCALE,
        undefined,
        engineOptions
      );
      expect(logs.records).toEqual([]);

      const reportRow = await reportRowBySessionId(sigma1.id);
      if (!reportRow) {
        throw new Error("journey: expected the σ1 report row to exist after the valid submit");
      }
      expect(reportRow.sessionId).toBe(sigma1.id);
      expect(reportRow.teacherNotes).toBe(VALID_NOTES);
      expect(reportRow.studentRatingByTeacher).toBe(4);
      expect(reportRow).toEqual(submits);
      tracked.register(reports, reportRow.id);

      const homeworkRow = await homeworkRowBySessionId(sigma1.id);
      if (!homeworkRow) {
        throw new Error("journey: expected the σ1 home_work row to exist after the valid submit");
      }
      expect(homeworkRow.currentFromAyah).toBe(H1_JADID.fromAyah);
      expect(homeworkRow.currentToAyah).toBe(H1_JADID.toAyah);
      expect(homeworkRow.currentSurahJuz).toBe(SurahJuzRef.SurahAlFatihah);
      expect(homeworkRow.revisionFromAyah).toBe(H1_MADI.fromAyah);
      expect(homeworkRow.revisionToAyah).toBe(H1_MADI.toAyah);
      expect(homeworkRow.revisionSurahJuz).toBe(SurahJuzRef.Juz1);
      expect(homeworkRow.currentGrade).toBeNull();
      expect(homeworkRow.revisionGrade).toBeNull();
      tracked.register(homeWork, homeworkRow.id);

      // Exactly ONE report-wave row per recipient, composed in the RECIPIENT's
      // persisted locale, bodies carrying counterparty names only.
      const studentWaves = await completionRowsFor(studentS.id, sigma1.id);
      const parentWaves = await completionRowsFor(parentP.id, sigma1.id);
      expect(studentWaves).toHaveLength(1);
      expect(parentWaves).toHaveLength(1);
      const studentWave = studentWaves[0];
      const parentWave = parentWaves[0];
      if (!studentWave || !parentWave) {
        throw new Error("journey: expected one student wave and one parent wave for σ1");
      }
      expect(studentWave.type).toBe(NotificationType.SessionCompletion);
      expect(studentWave.relatedEntityType).toBe(RELATED_ENTITY_TYPE);
      expect(studentWave.relatedEntityId).toBe(sigma1.id);
      expect(studentWave.title).toBe(NOTIFS_EN.eventSessionReportReadyTitle);
      expect(studentWave.body).toBe(NOTIFS_EN.eventSessionReportReadyBody(teacherT1.fullName));
      expect(parentWave.title).toBe(NOTIFS_AR.eventSessionReportReadyTitle);
      expect(parentWave.body).toBe(NOTIFS_AR.eventSessionReportReadyParentBody(studentS.fullName, teacherT1.fullName));
      for (const wave of [studentWave, parentWave]) {
        if (wave.body === null) {
          throw new Error("journey: expected the report-wave body to be non-null");
        }
        expect(wave.body).not.toContain(VALID_NOTES);
      }
      tracked.register(notifications, studentWave.id);
      tracked.register(notifications, parentWave.id);

      // EXACTLY 2 publishes: one envelope per recipient, nobody else addressed.
      expect(transportSpy.publishCount).toBe(beforePublishes + 2);
      const newPublishes = transportSpy.calls.slice(beforePublishes);
      expect(
        newPublishes.map(publish => JSON.stringify(publish.userIds)).toSorted((a, b) => a.localeCompare(b))
      ).toEqual([parentP.id, studentS.id].map(id => JSON.stringify([id])).toSorted((a, b) => a.localeCompare(b)));

      // The engine claim keys are the deterministic per-recipient report keys.
      const expectedKeys = new Set([
        buildEmitClaimKey([studentS.id], NotificationType.SessionCompletion, `session:${String(sigma1.id)}:report`),
        buildEmitClaimKey([parentP.id], NotificationType.SessionCompletion, `session:${String(sigma1.id)}:report`),
      ]);
      expect(new Set(claimCache.claimedKeys)).toEqual(expectedKeys);

      // Isolation: foreign teacher + the second teacher hold nothing.
      expect(await reportWaveCountFor(teacherT1.id)).toBe(0);
      expect(await reportWaveCountFor(teacherT2.id)).toBe(0);
      expect(await reportWaveCountFor(teacherFt.id)).toBe(0);
    } finally {
      logs.stop();
    }
  });

  test("step 3 — T2 reads the student's history: sees H1 (authored by T1 during σ1); envelope echoes honestly; read is silent", async () => {
    const logs = recordDomainLogs();
    try {
      const page = await listStudentHomeworkHistory(teacherT2.id, studentS.id, undefined, LOCALE);
      expect(logs.records).toEqual([]);

      // Envelope shape: the closed {items,totalCount,page,pageSize} form.
      expect(Object.keys(page).toSorted((a, b) => a.localeCompare(b))).toEqual([
        "items",
        "page",
        "pageSize",
        "totalCount",
      ]);
      expect(page.totalCount).toBe(1);
      expect(page.page).toBe(1);
      expect(page.pageSize).toBe(25);
      expect(page.items).toHaveLength(1);

      const item = page.items[0];
      if (!item) {
        throw new Error("journey: expected the σ1 home_work row to be visible from T2's history read");
      }
      // H1 is the only row so far, and it is newest-first.
      const homeworkRow = await homeworkRowBySessionId(sigma1.id);
      if (!homeworkRow) {
        throw new Error("journey: expected the σ1 home_work row to exist before the history read");
      }
      expect(item.id).toBe(homeworkRow.id);
      expect(item.sessionId).toBe(sigma1.id);
      expect(item.currentFromAyah).toBe(H1_JADID.fromAyah);
      expect(item.currentToAyah).toBe(H1_JADID.toAyah);
      expect(item.currentSurahJuz).toBe(SurahJuzRef.SurahAlFatihah);
      expect(item.revisionFromAyah).toBe(H1_MADI.fromAyah);
      expect(item.revisionToAyah).toBe(H1_MADI.toAyah);
      expect(item.revisionSurahJuz).toBe(SurahJuzRef.Juz1);
      // H1 born ungraded — INV-HW3 shape.
      expect(item.currentGrade).toBeNull();
      expect(item.revisionGrade).toBeNull();
    } finally {
      logs.stop();
    }
  });

  test("step 4 — T2 submits σ2 report with previousGrades (grading H1) + homework H2: H1 graded once; H2 born ungraded; wave fires again", async () => {
    const logs = recordDomainLogs();
    const beforePublishes = transportSpy.publishCount;
    try {
      const submits = await SessionReportService.submitSessionReport(
        teacherT2.id,
        sigma2.id,
        baseSubmitInput({
          homework: { jadid: H2_JADID, madi: H2_MADI },
          previousGrades: { currentGrade: H1_CURRENT_GRADE, revisionGrade: H1_REVISION_GRADE },
        }),
        LOCALE,
        undefined,
        engineOptions
      );
      expect(logs.records).toEqual([]);

      const sigma2ReportRow = await reportRowBySessionId(sigma2.id);
      if (!sigma2ReportRow) {
        throw new Error("journey: expected the σ2 report row to exist after the valid submit");
      }
      expect(sigma2ReportRow).toEqual(submits);
      tracked.register(reports, sigma2ReportRow.id);

      // H1 graded EXACTLY once with the submitted values (the one-shot guarded
      // UPDATE matched T1's prior row — write-once is PER ROW, never author-
      // scoped; T2 grades T1's homework through the same one-shot predicate).
      const h1After = await homeworkRowBySessionId(sigma1.id);
      if (!h1After) {
        throw new Error("journey: expected the σ1 home_work row to survive the graded submission");
      }
      expect(h1After.currentGrade).toBe(H1_CURRENT_GRADE);
      expect(h1After.revisionGrade).toBe(H1_REVISION_GRADE);
      tracked.register(homeWork, h1After.id);

      // H2 born ungraded: σ2's assignment row carries the submitted blocks and
      // both grade columns NULL.
      const h2Row = await homeworkRowBySessionId(sigma2.id);
      if (!h2Row) {
        throw new Error("journey: expected the σ2 home_work row to exist after the valid submit");
      }
      expect(h2Row.currentFromAyah).toBe(H2_JADID.fromAyah);
      expect(h2Row.currentToAyah).toBe(H2_JADID.toAyah);
      expect(h2Row.currentSurahJuz).toBe(SurahJuzRef.Juz2);
      expect(h2Row.revisionFromAyah).toBe(H2_MADI.fromAyah);
      expect(h2Row.revisionToAyah).toBe(H2_MADI.toAyah);
      expect(h2Row.revisionSurahJuz).toBe(SurahJuzRef.Juz4);
      expect(h2Row.currentGrade).toBeNull();
      expect(h2Row.revisionGrade).toBeNull();
      tracked.register(homeWork, h2Row.id);

      // Cumulative waves: student + parent each +1 for σ2 (2 each in total).
      expect(await reportWaveCountFor(studentS.id)).toBe(2);
      expect(await reportWaveCountFor(parentP.id)).toBe(2);
      const sigma2StudentWaves = await completionRowsFor(studentS.id, sigma2.id);
      const sigma2ParentWaves = await completionRowsFor(parentP.id, sigma2.id);
      expect(sigma2StudentWaves).toHaveLength(1);
      expect(sigma2ParentWaves).toHaveLength(1);
      const sigma2StudentWave = sigma2StudentWaves[0];
      const sigma2ParentWave = sigma2ParentWaves[0];
      if (!sigma2StudentWave || !sigma2ParentWave) {
        throw new Error("journey: expected one student wave and one parent wave for σ2");
      }
      // The wave body composes the counterparty teacher's name — T2 authored
      // σ2's submission, so the body references T2 (not T1).
      expect(sigma2StudentWave.body).toBe(NOTIFS_EN.eventSessionReportReadyBody(teacherT2.fullName));
      expect(sigma2ParentWave.body).toBe(
        NOTIFS_AR.eventSessionReportReadyParentBody(studentS.fullName, teacherT2.fullName)
      );
      tracked.register(notifications, sigma2StudentWave.id);
      tracked.register(notifications, sigma2ParentWave.id);

      // EXACTLY 2 publishes (one envelope per recipient).
      expect(transportSpy.publishCount).toBe(beforePublishes + 2);
      const newPublishes = transportSpy.calls.slice(beforePublishes);
      expect(
        newPublishes.map(publish => JSON.stringify(publish.userIds)).toSorted((a, b) => a.localeCompare(b))
      ).toEqual([parentP.id, studentS.id].map(id => JSON.stringify([id])).toSorted((a, b) => a.localeCompare(b)));

      // Isolation: teachers hold nothing (no teacher-wave leg exists).
      expect(await reportWaveCountFor(teacherT1.id)).toBe(0);
      expect(await reportWaveCountFor(teacherT2.id)).toBe(0);
      expect(await reportWaveCountFor(teacherFt.id)).toBe(0);
    } finally {
      logs.stop();
    }
  });

  test("step 5 — T1 reads the student's history: sees BOTH rows (symmetric visibility); H2 newest; H1 carries the grades", async () => {
    const logs = recordDomainLogs();
    try {
      const page = await listStudentHomeworkHistory(teacherT1.id, studentS.id, undefined, LOCALE);
      expect(logs.records).toEqual([]);

      expect(page.totalCount).toBe(2);
      expect(page.items).toHaveLength(2);

      // Newest-first ordering: σ2's home_work (H2) is items[0]; σ1's (H1) is
      // items[1]. The repo orders by session.started_at DESC NULLS LAST and
      // breaks same-instant ties by home_work.id DESC.
      const h2Row = await homeworkRowBySessionId(sigma2.id);
      const h1Row = await homeworkRowBySessionId(sigma1.id);
      if (!h2Row || !h1Row) {
        throw new Error("journey: expected both home_work rows to exist before the symmetry read");
      }
      expect(page.items[0]?.id).toBe(h2Row.id);
      expect(page.items[1]?.id).toBe(h1Row.id);

      // H1 carries both grades (T2 graded it during σ2's submission).
      expect(page.items[1]?.currentGrade).toBe(H1_CURRENT_GRADE);
      expect(page.items[1]?.revisionGrade).toBe(H1_REVISION_GRADE);

      // H2 is still ungraded (INV-HW4: born ungraded during the submit; the
      // next submission in the sequence would grade it).
      expect(page.items[0]?.currentGrade).toBeNull();
      expect(page.items[0]?.revisionGrade).toBeNull();
    } finally {
      logs.stop();
    }
  });

  test("step 6 — foreign teacher Ft probes the history: constant FORBIDDEN; one bounded log; zero publishes", async () => {
    const logs = recordDomainLogs();
    const beforePublishes = transportSpy.publishCount;
    try {
      const foreignError = await catchJourneyError(() =>
        listStudentHomeworkHistory(teacherFt.id, studentS.id, undefined, LOCALE)
      );
      if (!(foreignError instanceof ForbiddenError)) {
        throw new Error(`expected ForbiddenError (got ${foreignError.name}: ${foreignError.message})`);
      }
      assertDenialCodeAndCopy(foreignError, "FORBIDDEN", ERRORS_EN.forbidden);
      // Exactly one bounded domain log per denial — context carries code
      // only, entity, entityId, locale (never child/teacher fields).
      expect(logs.records).toHaveLength(1);
      expect(logs.records[0]?.code).toBe("FORBIDDEN");
      // Read purity: the denial touched zero publish fan-out.
      expect(transportSpy.publishCount).toBe(beforePublishes);
    } finally {
      logs.stop();
    }
  });

  test("step 7 — student S calls the history as if it were the teacher: constant FORBIDDEN (the relationship gate fails symmetrically)", async () => {
    const logs = recordDomainLogs();
    const beforePublishes = transportSpy.publishCount;
    try {
      const studentError = await catchJourneyError(() =>
        listStudentHomeworkHistory(studentS.id, studentS.id, undefined, LOCALE)
      );
      if (!(studentError instanceof ForbiddenError)) {
        throw new Error(`expected ForbiddenError (got ${studentError.name}: ${studentError.message})`);
      }
      assertDenialCodeAndCopy(studentError, "FORBIDDEN", ERRORS_EN.forbidden);
      expect(logs.records).toHaveLength(1);
      expect(logs.records[0]?.code).toBe("FORBIDDEN");
      expect(transportSpy.publishCount).toBe(beforePublishes);

      // Oracle identity: foreign-teacher denial and student-caller denial
      // are byte-identical (constant-denial oracle — no existence
      // disclosure). The assertDenialCodeAndCopy helper already verified
      // each is a ForbiddenError carrying the same code + translated
      // message; this extra comparison pins the message and code at the
      // SAME bytes for both denial shapes.
      const foreignError = await catchJourneyError(() =>
        listStudentHomeworkHistory(teacherFt.id, studentS.id, undefined, LOCALE)
      );
      assertDenialCodeAndCopy(foreignError, "FORBIDDEN", ERRORS_EN.forbidden);
      expect(foreignError.message).toBe(studentError.message);
      if (!(foreignError instanceof ForbiddenError)) {
        throw new Error(`expected ForbiddenError (got ${foreignError.name}: ${foreignError.message})`);
      }
      expect(foreignError.code).toBe(studentError.code);
    } finally {
      logs.stop();
    }
  });

  test("step 8 — replay safety: T2 re-submits σ2 → SESSION_REPORT_ALREADY_EXISTS; zero new rows; zero new publishes", async () => {
    const logs = recordDomainLogs();
    const beforePublishes = transportSpy.publishCount;
    const beforeReportRows = await countReportRows([sigma1.id, sigma2.id]);
    const beforeHomeWorkRows = await countHomeWorkRows([sigma1.id, sigma2.id]);
    try {
      const conflictError = await catchJourneyError(() =>
        SessionReportService.submitSessionReport(
          teacherT2.id,
          sigma2.id,
          baseSubmitInput(),
          LOCALE,
          undefined,
          engineOptions
        )
      );
      if (!(conflictError instanceof ConflictError)) {
        throw new Error(`expected ConflictError (got ${conflictError.name}: ${conflictError.message})`);
      }
      assertDenialCodeAndCopy(conflictError, "SESSION_REPORT_ALREADY_EXISTS", ERRORS_EN.sessionReportAlreadyExists);
      expect(logs.records.map(record => record.code)).toEqual(["SESSION_REPORT_ALREADY_EXISTS"]);

      // Zero new rows and zero new publishes — the replayed attempt rolls back.
      expect(await countReportRows([sigma1.id, sigma2.id])).toBe(beforeReportRows);
      expect(await countHomeWorkRows([sigma1.id, sigma2.id])).toBe(beforeHomeWorkRows);
      expect(transportSpy.publishCount).toBe(beforePublishes);
    } finally {
      logs.stop();
    }
  });

  test("final purity oracle — counts byte-identical to baseline after the full journey", async () => {
    // Two reports (σ1 + σ2), two home_work rows (H1 + H2), four publishes
    // (two submits × two recipients each), and the report-wave inbox rows
    // match the publish fan-out exactly.
    expect(await countReportRows([sigma1.id, sigma2.id])).toBe(2);
    expect(await countHomeWorkRows([sigma1.id, sigma2.id])).toBe(2);
    expect(await reportWaveCountFor(studentS.id)).toBe(2);
    expect(await reportWaveCountFor(parentP.id)).toBe(2);
    expect(await reportWaveCountFor(teacherT1.id)).toBe(0);
    expect(await reportWaveCountFor(teacherT2.id)).toBe(0);
    expect(await reportWaveCountFor(teacherFt.id)).toBe(0);
    expect(transportSpy.publishCount).toBe(4);
    // Every envelope ever published was addressed to a wave recipient only.
    const addressees = new Set(transportSpy.publishedUserIds);
    expect(addressees.has(studentS.id)).toBe(true);
    expect(addressees.has(parentP.id)).toBe(true);
    expect(addressees.has(teacherT1.id)).toBe(false);
    expect(addressees.has(teacherT2.id)).toBe(false);
    expect(addressees.has(teacherFt.id)).toBe(false);
  });
});
