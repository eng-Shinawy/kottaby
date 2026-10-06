/**
 * Cross-actor journey — admin academic tracking (the read-only observer over
 * the teacher-produced academic record).
 *
 * Assertion oracle — the cross-actor side-effect matrix (living spec; every
 * row below is asserted by the correspondingly numbered step):
 *
 * | Step | Actor → action | `session` rows | `reports` rows | `home_work` rows | Publishes (spied transport) | Observable outcome |
 * |---|---|---|---|---|---|---|
 * | 0 System | cast + two bookings committed | 2 booked | 0 | 0 | 0 | baseline dashboard: S listed with null academic fields |
 * | 1 teacher T | starts + completes σ₁, σ₂ | 2 completed | 0 | 0 | 0 (completion prompt rows persisted, not realtime) | S holds two attendance-eligible sessions |
 * | 2 teacher T | submits σ₁ (Jadid+Madi), then σ₂ (Jadid+Madi + previousGrades 55/88) | 0 | +2 | +2; σ₁'s row graded in place | student×2 | write-once grades land on the PREVIOUS row; σ₂'s row stays ungraded |
 * | 3 admin A | reads the academic dashboard | 0 | 0 | 0 | 0 | S's row shows the new positions, 55/88 summaries, `["lowGrade"]` flag; stats deltas honest |
 * | 4 admin A | drills into S | 0 | 0 | 0 | 0 | homework + report histories newest-first with correct grades/tracks/teacher identity |
 * | D teacher/student/parent | probe BOTH admin academic queries | 0 | 0 | 0 | 0 | identical constant FORBIDDEN, zero data, en AND ar byte-uniform |
 *
 * Conventions (per test/workflows/AGENTS.md):
 * - NO `runInRollback` — fixtures COMMIT in `beforeAll` inside ONE committing
 *   transaction; the cast rides the session-domain cast helper
 *   (`buildSessionJourneyCast`) with a `SessionFixtureRegistry`, and the
 *   producer-created rows (reports, homework, notification inbox entries) are
 *   tracked in a `TrackedFixtures` registry that cleans up BEFORE the cast
 *   registry (children of the sessions go first, FK-safe by construction).
 * - σ reaches `completed` and the reports/homework rows come into being
 *   through the REAL services (`SessionLifecycleService`,
 *   `SessionReportService.submitSessionReport`) — never raw status surgery,
 *   never fixture inserts for the produced rows.
 * - Honest authorization only — admin reads and every denial run through the
 *   real `assertActorAdminActive` gate; nothing is monkey-patched.
 * - External effects are intercepted at the injection seam: the report-wave
 *   publishes ride `SpiedFanoutTransport` + `InMemoryClaimCache` passed via
 *   the engine call options; the admin academic surface itself dispatches
 *   nothing, and the journey pins that zero-dispatch posture across every
 *   admin read and every denial probe.
 * - Denial assertions use `catchJourneyError` + translated substrings from
 *   `getServerTranslations` — never `expect(...).rejects.toThrow()`.
 * - Read-only purity of the admin surface is asserted by row-count deltas
 *   scoped to fixture ids (reports, homework, inbox entries, audit logs) so
 *   shared-DB rows can never satisfy a delta.
 *
 * Run:
 *   bun run test/scripts/run-test.ts test/workflows/admin/academic-tracking.journey.test.ts
 *   bun run test/scripts/run-test.ts test/workflows
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/backend/db";
import { homeWork } from "@/backend/db/schema/classes/home-work";
import { reports } from "@/backend/db/schema/classes/reports";
import { session } from "@/backend/db/schema/classes/session";
import { sessionRequestIdempotency } from "@/backend/db/schema/classes/session-request-idempotency";
import { notifications } from "@/backend/db/schema/notifications/notifications";
import { SessionIntent } from "@/backend/enum/scheduling/session-intent.enum";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import { SurahJuzRef } from "@/backend/enum/shared/surah-juz-ref.enum";
import { DomainError, ForbiddenError } from "@/backend/lib/errors";
import { AdminAcademicTrackingService } from "@/backend/services/admin";
import { SessionLifecycleService } from "@/backend/services/classes/session-lifecycle.service";
import * as SessionReportService from "@/backend/services/classes/session-report.service";
import type { NotificationEngineCallOptions } from "@/backend/services/notifications";
import type {
  AdminAcademicStudentRowReturnType,
  HomeWorkReturnType,
  ReportReturnType,
  SessionReturnType,
} from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import {
  buildSessionJourneyCast,
  catchJourneyError,
  countAuditLogsForActor,
  countNotificationsForUser,
  createSessionFixtureRegistry,
  InMemoryClaimCache,
  journeyPrefix,
  type SessionJourneyCast,
  SpiedFanoutTransport,
  secondPrecisionMs,
  TrackedFixtures,
} from "@/test/workflows/helpers";

/** Per-run unique prefix embedded in every fixture identity field (rule 3). */
const RUN_PREFIX = journeyPrefix("admin");

/** The journey runs on the English locale; denial probes sweep both locales. */
const LOCALE = "en";

/** Valid free-text notes — distinct per submission so history rows never blur. */
const NOTES_ONE = "Strong start on the new passage; review pace steady.";
const NOTES_TWO = "New passage needs slower pacing; revision block was fluent.";

/** The σ₁ homework blocks: Jadid (new memorization) + Madi (revision). */
const SIGMA1_JADID = { fromAyah: 1, toAyah: 7, surahJuz: SurahJuzRef.SurahAlFatihah };
const SIGMA1_MADI = { fromAyah: 1, toAyah: 5, surahJuz: SurahJuzRef.Juz1 };

/** The σ₂ homework blocks — distinct references so the newest row is provable. */
const SIGMA2_JADID = { fromAyah: 8, toAyah: 12, surahJuz: SurahJuzRef.Juz2 };
const SIGMA2_MADI = { fromAyah: 2, toAyah: 6, surahJuz: SurahJuzRef.Juz3 };

/**
 * The write-once grades carried by the σ₂ submission's `previousGrades`: the
 * previous row's Jadid lane lands BELOW the low-grade threshold (55 < 60)
 * while the Madi lane stays healthy (88) — the two tracks must never mix in
 * the summaries or the flag.
 */
const PREVIOUS_GRADES = { currentGrade: 55, revisionGrade: 88 };

/** English + Arabic denial copy — every denial assertion pins these. */
const ERRORS_EN = getServerTranslations("en").errorsTranslations;
const ERRORS_AR = getServerTranslations("ar").errorsTranslations;

/** Direct read of one session's lifecycle status (independent read-back oracle). */
async function readSessionStatus(sessionId: number) {
  const rows = await db.select({ status: session.status }).from(session).where(eq(session.id, sessionId));
  const row = rows.at(0);
  if (!row) {
    throw new Error(`journey: session row ${String(sessionId)} vanished (fixture integrity failure)`);
  }
  return row.status;
}

/** Direct read of one session's homework row (independent read-back oracle). */
async function homeworkRowBySessionId(sessionId: number): Promise<HomeWorkReturnType | null> {
  const rows = await db.select().from(homeWork).where(eq(homeWork.sessionId, sessionId));
  return rows.at(0) ?? null;
}

/** Scoped `reports` row count — only rows belonging to the journey's sessions. */
async function countReportRows(sessionIds: readonly number[]): Promise<number> {
  return db.$count(reports, inArray(reports.sessionId, [...sessionIds]));
}

/** Scoped `home_work` row count — only rows belonging to the journey's sessions. */
async function countHomeWorkRows(sessionIds: readonly number[]): Promise<number> {
  return db.$count(homeWork, inArray(homeWork.sessionId, [...sessionIds]));
}

/**
 * Registers every inbox row one cast member holds (all of them were created
 * by this journey — fresh users start at zero) into the tracked producer-row
 * registry and returns the held count for delta assertions.
 */
async function trackInboxRows(producerRows: TrackedFixtures, userId: number): Promise<number> {
  const rows = await db.select({ id: notifications.id }).from(notifications).where(eq(notifications.userId, userId));
  for (const row of rows) {
    producerRows.register(notifications, row.id);
  }
  return rows.length;
}

/**
 * Asserts one caught denial is the typed constant FORBIDDEN carrying the
 * expected localized copy, and returns the message for byte-uniformity
 * comparison across roles and queries.
 */
function assertConstantForbidden(caught: Error, translatedCopy: string): string {
  expect(caught).toBeInstanceOf(DomainError);
  expect(caught).toBeInstanceOf(ForbiddenError);
  if (!(caught instanceof ForbiddenError)) {
    throw new Error(`journey: expected ForbiddenError (got ${caught.name}: ${caught.message})`);
  }
  expect(caught.code).toBe("FORBIDDEN");
  expect(caught.message).toContain(translatedCopy);
  return caught.message;
}

/** Locates one student's dashboard row by id (students share the users PK). */
function dashboardRowFor(
  page: { readonly items: readonly AdminAcademicStudentRowReturnType[] },
  studentId: number
): AdminAcademicStudentRowReturnType {
  const row = page.items.find(candidate => candidate.id === studentId);
  if (!row) {
    throw new Error(`journey: dashboard row for student ${String(studentId)} missing (fixture integrity failure)`);
  }
  return row;
}

describe("cross-actor journey: admin academic tracking (teacher produces → admin observes → non-admin denials)", () => {
  /** Cast fixtures + sessions + booking claims: FK-ordered cast registry. */
  const registry = createSessionFixtureRegistry();
  /** Producer-created rows (reports, homework, inbox entries): cleaned FIRST. */
  const producerRows = new TrackedFixtures();
  /** Realtime publish boundary — recorded, never delivered. */
  const transportSpy = new SpiedFanoutTransport();
  const claimCache = new InMemoryClaimCache();
  const engineOptions: NotificationEngineCallOptions = { transport: transportSpy, cache: claimCache };

  // Per-run idempotency keys — one per booked session (rule 3 prefixes).
  const KEY_ONE = `${RUN_PREFIX}-k-sigma-one`;
  const KEY_TWO = `${RUN_PREFIX}-k-sigma-two`;

  let cast: SessionJourneyCast;
  let sessionOne: SessionReturnType;
  let sessionTwo: SessionReturnType;

  let reportOne: ReportReturnType;
  let reportTwo: ReportReturnType;
  let homeworkOne: HomeWorkReturnType;
  let homeworkTwo: HomeWorkReturnType;

  /** Platform-wide dashboard baseline captured before the producer leg. */
  let baselineTrackedStudents = 0;
  let baselineGradedStudents = 0;
  let baselineAttentionCount = 0;
  let studentRowBefore: AdminAcademicStudentRowReturnType;

  /** Publish total after the producer leg — the zero-dispatch delta anchor. */
  let publishesAfterProducerLeg = 0;

  beforeAll(async () => {
    // ONE committing transaction: commit-or-nothing fixture provisioning.
    await db.transaction(async tx => {
      cast = await buildSessionJourneyCast(tx, registry, { prefix: RUN_PREFIX });

      // σ₁ and σ₂ — booked through the REAL lifecycle path inside this
      // provisioning transaction via the outerTx seam. The primary student's
      // default lane profile (1 trial + 1 hifz unit) funds exactly two Hifz
      // bookings (the trial lane burns first).
      sessionOne = await SessionLifecycleService.createSession(
        cast.primaryStudent.userId,
        { teacherId: cast.teacher.userId, intent: SessionIntent.Hifz },
        KEY_ONE,
        LOCALE,
        tx
      );
      sessionTwo = await SessionLifecycleService.createSession(
        cast.primaryStudent.userId,
        { teacherId: cast.teacher.userId, intent: SessionIntent.Hifz },
        KEY_TWO,
        LOCALE,
        tx
      );
      registry.track("session", sessionOne.id);
      registry.track("session", sessionTwo.id);

      const claimRows = await tx
        .select({ id: sessionRequestIdempotency.id, key: sessionRequestIdempotency.idempotencyKey })
        .from(sessionRequestIdempotency)
        .where(inArray(sessionRequestIdempotency.idempotencyKey, [KEY_ONE, KEY_TWO]));
      for (const key of [KEY_ONE, KEY_TWO]) {
        const claim = claimRows.find(row => row.key === key);
        if (!claim) {
          throw new Error(`journey: booking claim for ${key} not found (fixture tracking failure)`);
        }
        registry.track("session_request_idempotency", claim.id);
      }
    });
  });

  afterAll(async () => {
    // Producer-created rows (children of the sessions) go FIRST; the cast
    // registry then deletes claims → sessions → role-children → users in one
    // FK-safe committed transaction. Both registries re-probe residue.
    await producerRows.cleanup();
    await registry.cleanup();
  });

  test("step 0 — System: cast committed, both sessions booked, baseline dashboard recorded", async () => {
    expect(sessionOne.status).toBe(SessionStatus.Scheduled);
    expect(sessionTwo.status).toBe(SessionStatus.Scheduled);
    // 7 users + 7 role-children + 2 sessions + 2 booking claims.
    expect(registry.trackedCount()).toBe(18);

    // Baseline dashboard: the whole cast is visible BEFORE any academic row
    // exists — students with zero academic rows appear with null fields,
    // never an error and never omission. The search narrows to the cast's
    // per-run names so pre-existing shared-DB students cannot blur the rows.
    const baseline = await AdminAcademicTrackingService.getAcademicDashboard(
      cast.admin.userId,
      { search: RUN_PREFIX },
      1,
      25,
      LOCALE
    );
    expect(baseline.total).toBe(2);
    expect(baseline.page).toBe(1);
    expect(baseline.pageSize).toBe(25);
    expect(baseline.pageCount).toBe(1);

    const sBefore = dashboardRowFor(baseline, cast.primaryStudent.userId);
    expect(sBefore.fullName).toBe(`${RUN_PREFIX}-studentA`);
    expect(sBefore.email).toBe(cast.primaryStudent.user.email);
    expect(sBefore.latestJadidPosition).toBeNull();
    expect(sBefore.latestMadiPosition).toBeNull();
    expect(sBefore.jadidGradeSummary).toBeNull();
    expect(sBefore.madiGradeSummary).toBeNull();
    expect(sBefore.lastGradedHomeworkAt).toBeNull();
    expect(sBefore.needsAttention).toBeNull();
    expect(sBefore.progressRowCount).toBe(0);

    const secondBefore = dashboardRowFor(baseline, cast.secondStudent.userId);
    expect(secondBefore.latestJadidPosition).toBeNull();
    expect(secondBefore.jadidGradeSummary).toBeNull();
    expect(secondBefore.needsAttention).toBeNull();
    studentRowBefore = sBefore;

    // Platform-wide stats baseline (whatever the shared database holds) —
    // the producer leg's honest deltas are asserted against these.
    baselineTrackedStudents = baseline.stats.trackedStudentCount;
    baselineGradedStudents = baseline.stats.studentsWithGradedHomeworkCount;
    baselineAttentionCount = baseline.stats.needingAttentionCount;
  });

  test("step 1 — teacher T: starts + completes σ₁ and σ₂ through the real lifecycle path", async () => {
    // No outerTx — the service owns its top-level transactions exactly as in
    // production. Each completion persists the student's confirm-prompt inbox
    // row on the owning transaction (no realtime fan-out on this path).
    sessionOne = await SessionLifecycleService.startSession(cast.teacher.userId, sessionOne.id, LOCALE);
    sessionOne = await SessionLifecycleService.completeSession(cast.teacher.userId, sessionOne.id, LOCALE);
    sessionTwo = await SessionLifecycleService.startSession(cast.teacher.userId, sessionTwo.id, LOCALE);
    sessionTwo = await SessionLifecycleService.completeSession(cast.teacher.userId, sessionTwo.id, LOCALE);

    // Shared state: both sessions terminal-completed on the committed row.
    expect(sessionOne.status).toBe(SessionStatus.Completed);
    expect(sessionTwo.status).toBe(SessionStatus.Completed);
    expect(await readSessionStatus(sessionOne.id)).toBe(SessionStatus.Completed);
    expect(await readSessionStatus(sessionTwo.id)).toBe(SessionStatus.Completed);

    // Cross-actor visibility: the student holds exactly one confirm-prompt
    // inbox row per completed session; the teacher's only rows are the two
    // booking intake waves (one per booked session) — no other cast member
    // received anything.
    expect(await trackInboxRows(producerRows, cast.primaryStudent.userId)).toBe(2);
    expect(await countNotificationsForUser(cast.secondStudent.userId)).toBe(0);
    expect(await countNotificationsForUser(cast.teacher.userId)).toBe(2);
    expect(await countNotificationsForUser(cast.secondTeacher.userId)).toBe(0);
    expect(await countNotificationsForUser(cast.parent.userId)).toBe(0);
    expect(await countNotificationsForUser(cast.admin.userId)).toBe(0);
    expect(transportSpy.publishCount).toBe(0);
  });

  test("step 2 — teacher T: submits σ₁ (Jadid+Madi), then σ₂ (+ write-once previousGrades)", async () => {
    const publishesBefore = transportSpy.publishCount;

    // First submission — the assignment that creates the student's previous
    // homework row (both tracks, structurally NULL grades).
    reportOne = await SessionReportService.submitSessionReport(
      cast.teacher.userId,
      sessionOne.id,
      {
        teacherNotes: NOTES_ONE,
        studentRatingByTeacher: 4,
        homework: { jadid: SIGMA1_JADID, madi: SIGMA1_MADI },
      },
      LOCALE,
      undefined,
      engineOptions
    );
    const homeworkOneRow = await homeworkRowBySessionId(sessionOne.id);
    if (!homeworkOneRow) {
      throw new Error("journey: expected the σ₁ home_work row to exist after the valid submit");
    }
    homeworkOne = homeworkOneRow;
    producerRows.register(reports, reportOne.id);
    producerRows.register(homeWork, homeworkOne.id);
    expect(homeworkOne.currentGrade).toBeNull();
    expect(homeworkOne.revisionGrade).toBeNull();

    // Second submission — Jadid+Madi assignment PLUS the write-once grades of
    // the PREVIOUS row (σ₁'s assignment): Jadid 55 (below threshold), Madi 88.
    reportTwo = await SessionReportService.submitSessionReport(
      cast.teacher.userId,
      sessionTwo.id,
      {
        teacherNotes: NOTES_TWO,
        studentRatingByTeacher: 5,
        homework: { jadid: SIGMA2_JADID, madi: SIGMA2_MADI },
        previousGrades: PREVIOUS_GRADES,
      },
      LOCALE,
      undefined,
      engineOptions
    );
    const homeworkTwoRow = await homeworkRowBySessionId(sessionTwo.id);
    if (!homeworkTwoRow) {
      throw new Error("journey: expected the σ₂ home_work row to exist after the valid submit");
    }
    homeworkTwo = homeworkTwoRow;
    producerRows.register(reports, reportTwo.id);
    producerRows.register(homeWork, homeworkTwo.id);

    // Write-once semantics: the grades landed on the PREVIOUS row in place;
    // the new σ₂ row stays ungraded (grades never silently change or leak).
    const homeworkOneAfter = await homeworkRowBySessionId(sessionOne.id);
    if (!homeworkOneAfter) {
      throw new Error("journey: σ₁ home_work row vanished after the σ₂ submit");
    }
    expect(homeworkOneAfter.id).toBe(homeworkOne.id);
    expect(homeworkOneAfter.currentGrade).toBe(PREVIOUS_GRADES.currentGrade);
    expect(homeworkOneAfter.revisionGrade).toBe(PREVIOUS_GRADES.revisionGrade);
    expect(homeworkTwo.currentGrade).toBeNull();
    expect(homeworkTwo.revisionGrade).toBeNull();
    expect(homeworkTwo.currentSurahJuz).toBe(SurahJuzRef.Juz2);
    expect(homeworkTwo.revisionSurahJuz).toBe(SurahJuzRef.Juz3);

    // Committed producer state: exactly one report + one homework row per
    // session, both carrying the teacher's notes/rating.
    expect(await countReportRows([sessionOne.id, sessionTwo.id])).toBe(2);
    expect(await countHomeWorkRows([sessionOne.id, sessionTwo.id])).toBe(2);
    expect(reportOne.sessionId).toBe(sessionOne.id);
    expect(reportOne.teacherNotes).toBe(NOTES_ONE);
    expect(reportOne.studentRatingByTeacher).toBe(4);
    expect(reportTwo.sessionId).toBe(sessionTwo.id);
    expect(reportTwo.teacherNotes).toBe(NOTES_TWO);
    expect(reportTwo.studentRatingByTeacher).toBe(5);

    // Fan-out: exactly one report-wave publish per submission, each targeting
    // ONLY the student (no parent linked); inbox delta follows.
    expect(transportSpy.publishCount).toBe(publishesBefore + 2);
    const newPublishes = transportSpy.calls.slice(publishesBefore);
    for (const publish of newPublishes) {
      expect([...publish.userIds]).toEqual([cast.primaryStudent.userId]);
    }
    expect(await trackInboxRows(producerRows, cast.primaryStudent.userId)).toBe(4);
    expect(await countNotificationsForUser(cast.secondStudent.userId)).toBe(0);
    expect(await countNotificationsForUser(cast.teacher.userId)).toBe(2);
    expect(await countNotificationsForUser(cast.admin.userId)).toBe(0);

    publishesAfterProducerLeg = transportSpy.publishCount;
  });

  test("step 3 — admin A: dashboard reflects the new positions, summaries, flag, and honest stats", async () => {
    // Zero-dispatch + zero-audit posture of the admin read itself.
    const dashboard = await AdminAcademicTrackingService.getAcademicDashboard(
      cast.admin.userId,
      { search: RUN_PREFIX },
      1,
      25,
      LOCALE
    );
    expect(transportSpy.publishCount).toBe(publishesAfterProducerLeg);
    expect(await countAuditLogsForActor(cast.admin.userId)).toBe(0);

    expect(dashboard.total).toBe(2);
    expect(dashboard.pageCount).toBe(1);

    const sRow = dashboardRowFor(dashboard, cast.primaryStudent.userId);
    // The Jadid position derives from the student's newest GRADED Jadid row —
    // the σ₁ row (graded via σ₂'s previousGrades), NOT the newer ungraded σ₂
    // row; the Madi lane resolves through the same rule.
    expect(sRow.latestJadidPosition).toEqual({
      surahJuz: SurahJuzRef.SurahAlFatihah,
      fromAyah: SIGMA1_JADID.fromAyah,
      toAyah: SIGMA1_JADID.toAyah,
    });
    expect(sRow.latestMadiPosition).toEqual({
      surahJuz: SurahJuzRef.Juz1,
      fromAyah: SIGMA1_MADI.fromAyah,
      toAyah: SIGMA1_MADI.toAyah,
    });
    // Grade summaries: one graded row per track, averages verbatim.
    expect(sRow.jadidGradeSummary).toEqual({ gradedCount: 1, averageGrade: PREVIOUS_GRADES.currentGrade });
    expect(sRow.madiGradeSummary).toEqual({ gradedCount: 1, averageGrade: PREVIOUS_GRADES.revisionGrade });
    // The below-threshold Jadid average flips the attention flag to the
    // single lowGrade reason (fresh grading activity → no staleness reason).
    expect(sRow.needsAttention).toEqual({ reasons: ["lowGrade"] });
    // The grade-write timestamp anchors the staleness rule — now non-null and
    // second-precision-equal to the graded row's write stamp.
    expect(sRow.lastGradedHomeworkAt).not.toBeNull();
    const lastGradedAt = sRow.lastGradedHomeworkAt;
    if (typeof lastGradedAt !== "string") {
      throw new Error("journey: last-graded stamp missing (fixture integrity failure)");
    }
    const gradedRows = await db
      .select({ updatedAt: homeWork.updatedAt })
      .from(homeWork)
      .where(eq(homeWork.id, homeworkOne.id));
    const gradedStamp = gradedRows.at(0)?.updatedAt;
    if (!gradedStamp) {
      throw new Error("journey: graded homework row stamp missing (fixture integrity failure)");
    }
    expect(secondPrecisionMs(new Date(lastGradedAt))).toBe(secondPrecisionMs(gradedStamp));
    // Reads never fabricated progress rows for the fixture student.
    expect(sRow.progressRowCount).toBe(0);
    // The untouched fields carry over unchanged from the baseline snapshot.
    expect(sRow.fullName).toBe(studentRowBefore.fullName);
    expect(sRow.email).toBe(studentRowBefore.email);

    // The zero-rows cast student stays listed with null academic fields and
    // no flag — absence of academic rows is not failure.
    const secondRow = dashboardRowFor(dashboard, cast.secondStudent.userId);
    expect(secondRow.latestJadidPosition).toBeNull();
    expect(secondRow.latestMadiPosition).toBeNull();
    expect(secondRow.jadidGradeSummary).toBeNull();
    expect(secondRow.madiGradeSummary).toBeNull();
    expect(secondRow.needsAttention).toBeNull();

    // Platform-wide stats: honest deltas over the baseline (the shared
    // database's pre-existing students are part of the baseline, never of
    // the delta). S is the only newly-graded, newly-flagged student.
    expect(dashboard.stats.trackedStudentCount).toBe(baselineTrackedStudents);
    expect(dashboard.stats.studentsWithGradedHomeworkCount).toBe(baselineGradedStudents + 1);
    expect(dashboard.stats.needingAttentionCount).toBe(baselineAttentionCount + 1);
    if (baselineGradedStudents === 0) {
      // A previously-graded-empty platform averages over exactly this
      // journey's graded rows — the exact per-track values.
      expect(dashboard.stats.averageJadidGrade).toBe(PREVIOUS_GRADES.currentGrade);
      expect(dashboard.stats.averageMadiGrade).toBe(PREVIOUS_GRADES.revisionGrade);
    } else {
      expect(dashboard.stats.averageJadidGrade).not.toBeNull();
      expect(dashboard.stats.averageMadiGrade).not.toBeNull();
    }
  });

  test("step 4 — admin A: drill-down shows the new homework/report rows newest-first", async () => {
    const detail = await AdminAcademicTrackingService.getStudentAcademicDetail(
      cast.admin.userId,
      cast.primaryStudent.userId,
      1,
      25,
      LOCALE
    );
    // The admin academic surface stays a pure observer: no publishes, no
    // audit rows, no producer-row growth.
    expect(transportSpy.publishCount).toBe(publishesAfterProducerLeg);
    expect(await countAuditLogsForActor(cast.admin.userId)).toBe(0);
    expect(await countReportRows([sessionOne.id, sessionTwo.id])).toBe(2);
    expect(await countHomeWorkRows([sessionOne.id, sessionTwo.id])).toBe(2);
    expect(await countNotificationsForUser(cast.primaryStudent.userId)).toBe(4);

    // Student echo: the identity slice, soft-delete marker surfaced here.
    expect(detail.student).toEqual({
      id: cast.primaryStudent.userId,
      fullName: `${RUN_PREFIX}-studentA`,
      email: cast.primaryStudent.user.email,
      isDeleted: false,
    });
    expect(detail.needsAttention).toEqual({ reasons: ["lowGrade"] });
    expect(detail.progressRowCount).toBe(0);

    // Homework history, newest first: σ₂'s ungraded row, then σ₁'s graded row.
    expect(detail.homeworkPage.total).toBe(2);
    expect(detail.homeworkPage.page).toBe(1);
    expect(detail.homeworkPage.pageSize).toBe(25);
    expect(detail.homeworkPage.pageCount).toBe(1);
    const newestHomework = detail.homeworkPage.items.at(0);
    const oldestHomework = detail.homeworkPage.items.at(1);
    if (!newestHomework || !oldestHomework) {
      throw new Error("journey: expected two homework history entries on page 1");
    }
    expect(newestHomework.id).toBe(homeworkTwo.id);
    expect(oldestHomework.id).toBe(homeworkOne.id);
    expect(newestHomework.id > oldestHomework.id).toBe(true);
    for (const entry of [newestHomework, oldestHomework]) {
      expect(entry.sessionId === sessionOne.id || entry.sessionId === sessionTwo.id).toBe(true);
      expect(entry.teacherName).toBe(cast.teacher.user.fullName);
      expect(entry.sessionStartedAt).not.toBeNull();
    }
    expect(newestHomework.jadid).toEqual({
      surahJuz: SurahJuzRef.Juz2,
      fromAyah: SIGMA2_JADID.fromAyah,
      toAyah: SIGMA2_JADID.toAyah,
      grade: null,
    });
    expect(newestHomework.madi).toEqual({
      surahJuz: SurahJuzRef.Juz3,
      fromAyah: SIGMA2_MADI.fromAyah,
      toAyah: SIGMA2_MADI.toAyah,
      grade: null,
    });
    expect(oldestHomework.jadid).toEqual({
      surahJuz: SurahJuzRef.SurahAlFatihah,
      fromAyah: SIGMA1_JADID.fromAyah,
      toAyah: SIGMA1_JADID.toAyah,
      grade: PREVIOUS_GRADES.currentGrade,
    });
    expect(oldestHomework.madi).toEqual({
      surahJuz: SurahJuzRef.Juz1,
      fromAyah: SIGMA1_MADI.fromAyah,
      toAyah: SIGMA1_MADI.toAyah,
      grade: PREVIOUS_GRADES.revisionGrade,
    });

    // Report history, newest first: σ₂'s submission, then σ₁'s.
    expect(detail.reportPage.total).toBe(2);
    const newestReport = detail.reportPage.items.at(0);
    const oldestReport = detail.reportPage.items.at(1);
    if (!newestReport || !oldestReport) {
      throw new Error("journey: expected two report history entries on page 1");
    }
    expect(newestReport.id).toBe(reportTwo.id);
    expect(newestReport.sessionId).toBe(sessionTwo.id);
    expect(newestReport.teacherNotes).toBe(NOTES_TWO);
    expect(newestReport.studentRatingByTeacher).toBe(5);
    expect(oldestReport.id).toBe(reportOne.id);
    expect(oldestReport.sessionId).toBe(sessionOne.id);
    expect(oldestReport.teacherNotes).toBe(NOTES_ONE);
    expect(oldestReport.studentRatingByTeacher).toBe(4);
    for (const entry of [newestReport, oldestReport]) {
      expect(entry.teacherName).toBe(cast.teacher.user.fullName);
      expect(entry.sessionStartedAt).not.toBeNull();
    }
  });

  test("denial D — teacher/student/parent probe BOTH queries: identical constant FORBIDDEN, en AND ar", async () => {
    const queries = [
      {
        label: "dashboard",
        probe: (actorId: number, locale: string) =>
          AdminAcademicTrackingService.getAcademicDashboard(actorId, {}, 1, 10, locale),
      },
      {
        label: "drill-down",
        probe: (actorId: number, locale: string) =>
          AdminAcademicTrackingService.getStudentAcademicDetail(actorId, cast.primaryStudent.userId, 1, 10, locale),
      },
    ];
    const nonAdminActors = [
      { role: "teacher", id: cast.teacher.userId },
      { role: "student", id: cast.primaryStudent.userId },
      { role: "parent", id: cast.parent.userId },
    ];

    // Both locales probed in parallel; each locale's six denial messages are
    // compared as ONE set.
    const localeResults = await Promise.all(
      (
        [
          ["en", ERRORS_EN.forbidden],
          ["ar", ERRORS_AR.forbidden],
        ] as const
      ).map(async ([locale, translatedCopy]) => {
        const caughtList = await Promise.all(
          queries
            .flatMap(query => nonAdminActors.map(actor => (): Promise<unknown> => query.probe(actor.id, locale)))
            .map(run => catchJourneyError(run))
        );
        return { translatedCopy, caughtList };
      })
    );
    for (const { translatedCopy, caughtList } of localeResults) {
      // Every role × every query × this locale — the SAME constant denial.
      // Even the owning teacher (the data's producer) and the student's OWN
      // drill-down collapse into the identical forbidden shape: zero
      // existence or ownership oracle leaks through the admin gate.
      const messages = caughtList.map(caught => assertConstantForbidden(caught, translatedCopy));
      expect(new Set(messages).size).toBe(1);
    }

    // Denial probes leave the world untouched: zero publishes, zero audit
    // rows for any probed actor, producer rows byte-still.
    expect(transportSpy.publishCount).toBe(publishesAfterProducerLeg);
    const auditedActorIds = [...nonAdminActors.map(actor => actor.id), cast.admin.userId];
    const auditCounts = await Promise.all(auditedActorIds.map(id => countAuditLogsForActor(id)));
    for (const count of auditCounts) {
      expect(count).toBe(0);
    }
    expect(await countReportRows([sessionOne.id, sessionTwo.id])).toBe(2);
    expect(await countHomeWorkRows([sessionOne.id, sessionTwo.id])).toBe(2);
    expect(await countNotificationsForUser(cast.primaryStudent.userId)).toBe(4);
  });
});
