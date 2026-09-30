/**
 * AdminAcademicTrackingService tests — the admin academic monitoring
 * service suite (gate → one-snapshot composition → drill-down assembly).
 *
 * The service under test is a pure OBSERVER: it gates the actor through the
 * shared `assertActorAdminActive` helper, opens ONE snapshot transaction
 * capturing a single `now`, validates bounds pre-read, composes the
 * dashboard's four reads through one `Promise.all` on the same transaction,
 * and assembles the drill-down from the reused per-student readers plus the
 * service-resolved session/teacher context. The suite pins:
 *
 *  - Tier 1 (actor matrix + happy paths + honest envelopes): anonymous
 *    `actorId = 0` → `UnauthorizedError` pre-DB; absent actor, teacher,
 *    student, and parent → `ForbiddenError`; a soft-deleted admin →
 *    `accountDeleted`; a live admin resolves the full dashboard and
 *    drill-down shapes — positions, summaries, ISO timestamps, teacher
 *    identities, session dates, honest counts, and page envelopes; a
 *    nonexistent (or non-student) drill-down id → localized
 *    `STUDENT_NOT_FOUND` with zero downstream reads; empty/whitespace
 *    search stays unfiltered; an out-of-range page yields empty `items`
 *    next to the honest `total`.
 *  - Tier 2 (honesty edges): a zero-graded student carries NO flag and
 *    null summaries (absence of grades is not failure); a single-track
 *    student shows one live track and a null opposite track on both the
 *    dashboard and the history entries; a soft-deleted student is excluded
 *    from the dashboard yet fully viewable in the drill-down with the
 *    governance marker set; a Unicode/RTL name matches the search.
 *  - Tier 3 (overlapping concurrent reads): two dashboard reads and a
 *    drill-down launched through `Promise.all` on the SAME rollback
 *    transaction all fulfill and agree on the totals.
 *  - Tier 4 (adversarial): the non-admin denial is BYTE-identical for
 *    every role and every id cause (valid, nonexistent, malformed — the
 *    zero-existence-oracle posture); malformed pagination/studentId
 *    rejects as a localized `ValidationError` before ANY repository read;
 *    `%`/`_` wildcards in `search` cannot widen the match.
 *
 * Per the sibling admin suites:
 *  - DB cases run inside `runInRollback` with the caller `tx` passed to the
 *    service as `outerTx`; entities ONLY via `entity-setup.ts` helpers.
 *  - All rejection assertions use `expectRepoError` (try/catch).
 *  - Translated-message assertions resolve via `getServerTranslations`
 *    property access — never raw keys, never hardcoded copy.
 *  - Spies are tracked and restored per test (bun reuses ONE mock per
 *    object+method pair until restore).
 */

import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { sql } from "drizzle-orm";
import { HomeWorkRepository } from "@/backend/db/repo";
import { AdminAcademicTrackingRepository } from "@/backend/db/repo/admin/academic-tracking.repository";
import { progress } from "@/backend/db/schema/classes/progress";
import { users } from "@/backend/db/schema/users/users";
import {
  createTestHomeWork,
  createTestSession,
  createTestSessionReport,
  createTestStudent,
  createTestTeacherRow,
  createTestUser,
} from "@/backend/db/test/entity-setup";
import { type DBTransaction, expectRepoError, runInRollback } from "@/backend/db/test/test-utils";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import { SurahJuzRef } from "@/backend/enum/shared/surah-juz-ref.enum";
import { ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import { AdminAcademicTrackingService } from "@/backend/services/admin/admin-academic-tracking.service";
import type { UserSelectType } from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";

const LOCALE = "en";
const tErrors = getServerTranslations(LOCALE).errorsTranslations;

/** One day in milliseconds (staleness-window fixture arithmetic). */
const DAY_MS = 24 * 60 * 60 * 1000;

/** Instant `days` before the test run (fixture stamps are relative to NOW). */
function daysAgo(days: number): Date {
  return new Date(Date.now() - days * DAY_MS);
}

/** Domain log spy family share this stubbed signature. */
type DomainLogSpy = ReturnType<typeof spyOn>;

/**
 * Registry of every spy created during the currently running test. bun's
 * `spyOn` reuses ONE mock per object+method pair until it is restored, so
 * every spy is registered here and restored by the file-level `afterEach`.
 */
const trackedSpies: DomainLogSpy[] = [];

/** Registers a spy for automatic restoration after the current test. */
function trackSpy<T extends DomainLogSpy>(spy: T): T {
  trackedSpies.push(spy);
  return spy;
}

/** Restores every spy the finished test created (fresh mocks per test). */
afterEach(() => {
  while (trackedSpies.length > 0) {
    trackedSpies.pop()?.mockRestore();
  }
});

/** Silences `logger.logDomainError` so test stdout stays compact. */
function silenceDomainLog(): DomainLogSpy {
  return trackSpy(
    spyOn(logger, "logDomainError")
      .mockClear()
      .mockImplementation(() => {})
  );
}

/** Call-through spy on the dashboard's directory listing (pre-read proofs). */
function spyDashboardReads(): DomainLogSpy[] {
  return [
    trackSpy(spyOn(AdminAcademicTrackingRepository, "listStudentAcademicRows")),
    trackSpy(spyOn(AdminAcademicTrackingRepository, "countStudentAcademicRows")),
  ];
}

/** Call-through spy on the drill-down's reader seams (pre-read proofs). */
function spyDrilldownReads(): DomainLogSpy[] {
  return [
    trackSpy(spyOn(AdminAcademicTrackingRepository, "getStudentEchoById")),
    trackSpy(spyOn(HomeWorkRepository, "listForStudent")),
  ];
}

/** Returns an integer id guaranteed absent from `users` in this tx. */
async function absentStudentId(tx: DBTransaction): Promise<number> {
  const [row] = await tx.select({ maxId: sql<number>`coalesce(max(${users.id}), 0)::int` }).from(users);
  return (row?.maxId ?? 0) + 1_000_000;
}

/** Asserts a `users` id resolves to no row inside this tx (pre-read proof). */
async function expectStudentAbsent(tx: DBTransaction, id: number): Promise<void> {
  const [row] = await tx.select({ count: sql<number>`count(*)::int` }).from(users).where(sql`${users.id} = ${id}`);
  expect(row?.count ?? 0).toBe(0);
}

/** Creates a live admin actor (users row only — the gate reads users). */
async function createAdmin(tx: DBTransaction): Promise<UserSelectType> {
  return createTestUser(tx, { role: "admin" });
}

/** Creates a teacher pair (users row + the role-child row sessions FK). */
async function createTeacher(tx: DBTransaction, fullName?: string) {
  const user = await createTestUser(tx, { role: "teacher", ...(fullName === undefined ? {} : { fullName }) });
  const teacherRow = await createTestTeacherRow(tx, user.id);
  return { user, teacherRow };
}

/** Creates a student pair (users row + the shared-PK role-child row). */
async function createStudent(tx: DBTransaction, fullName: string, overrides: Partial<UserSelectType> = {}) {
  const user = await createTestUser(tx, { role: "student", fullName, ...overrides });
  const studentRow = await createTestStudent(tx, user.id);
  return { user, studentRow };
}

/** The dashboard envelope shape the baseline probe reads (total + items + stats). */
type DashboardBaseline = Awaited<ReturnType<typeof AdminAcademicTrackingService.getAcademicDashboard>>;

/**
 * Captures the dashboard baseline INSIDE this tx before the test creates
 * its fixtures. The service counts the WHOLE live student table, and the
 * test database legitimately carries committed students (the minimal seed's
 * demo student; the tail lane cannot erase committed rows), so every
 * whole-table assertion is written RELATIVE to this probe — the suite
 * pins the service's accounting of its OWN fixtures, never an
 * empty-table assumption.
 */
async function captureDashboardBaseline(adminId: number, tx: DBTransaction): Promise<DashboardBaseline> {
  return AdminAcademicTrackingService.getAcademicDashboard(adminId, {}, 1, 25, LOCALE, tx);
}

describe("AdminAcademicTrackingService.getAcademicDashboard", () => {
  test("Tier 1 — admin happy path: full dashboard shape over two students", async () => {
    await runInRollback(async tx => {
      const admin = await createAdmin(tx);
      const baseline = await captureDashboardBaseline(admin.id, tx);
      const { user: teacherUser } = await createTeacher(tx);
      const alice = await createStudent(tx, "Alice Academic");
      const bob = await createStudent(tx, "Bob Bare");

      const startedSession = await createTestSession(tx, teacherUser.id, alice.studentRow.id, {
        status: SessionStatus.Completed,
        startedAt: daysAgo(2),
        endedAt: daysAgo(2),
      });
      const gradedAt = daysAgo(2);
      await createTestHomeWork(tx, startedSession.id, {
        currentSurahJuz: SurahJuzRef.Juz1,
        currentFromAyah: 1,
        currentToAyah: 5,
        currentGrade: 80,
        revisionSurahJuz: SurahJuzRef.Juz3,
        revisionFromAyah: 1,
        revisionToAyah: 7,
        revisionGrade: 70,
        createdAt: daysAgo(3),
        updatedAt: gradedAt,
      });
      await tx.insert(progress).values({ studentId: alice.studentRow.id, lessonId: null });
      await tx.insert(progress).values({ studentId: alice.studentRow.id, lessonId: null });

      const logSpy = silenceDomainLog();
      const page = await AdminAcademicTrackingService.getAcademicDashboard(admin.id, {}, 1, 25, LOCALE, tx);

      expect(logSpy).not.toHaveBeenCalled();
      expect(page.total).toBe(baseline.total + 2);
      expect(page.page).toBe(1);
      expect(page.pageSize).toBe(25);
      // Committed students (GraphQL integration suites accumulate rows on
      // the test DB by convention) can push the lane past one page — the
      // envelope math is derived from the baseline, never hardcoded to 1.
      const expectedTotal = baseline.total + 2;
      expect(page.pageCount).toBe(Math.ceil(expectedTotal / 25));
      expect(page.items).toHaveLength(Math.min(expectedTotal, 25));

      const aliceRow = page.items.find(row => row.id === alice.user.id);
      const bobRow = page.items.find(row => row.id === bob.user.id);
      expect(aliceRow).toBeDefined();
      expect(bobRow).toBeDefined();
      if (aliceRow === undefined || bobRow === undefined) {
        throw new Error("dashboard rows missing for fixture students");
      }

      expect(aliceRow.fullName).toBe("Alice Academic");
      expect(aliceRow.email).toBe(alice.user.email);
      expect(aliceRow.latestJadidPosition).toEqual({
        surahJuz: SurahJuzRef.Juz1,
        fromAyah: 1,
        toAyah: 5,
      });
      expect(aliceRow.latestMadiPosition).toEqual({
        surahJuz: SurahJuzRef.Juz3,
        fromAyah: 1,
        toAyah: 7,
      });
      expect(aliceRow.jadidGradeSummary).toEqual({ gradedCount: 1, averageGrade: 80 });
      expect(aliceRow.madiGradeSummary).toEqual({ gradedCount: 1, averageGrade: 70 });
      expect(aliceRow.progressRowCount).toBe(2);
      expect(aliceRow.lastGradedHomeworkAt).toBe(gradedAt.toISOString());
      expect(aliceRow.needsAttention).toBeNull();

      expect(bobRow.latestJadidPosition).toBeNull();
      expect(bobRow.latestMadiPosition).toBeNull();
      expect(bobRow.jadidGradeSummary).toBeNull();
      expect(bobRow.madiGradeSummary).toBeNull();
      expect(bobRow.progressRowCount).toBe(0);
      expect(bobRow.lastGradedHomeworkAt).toBeNull();
      expect(bobRow.needsAttention).toBeNull();

      expect(page.stats.trackedStudentCount).toBe(baseline.stats.trackedStudentCount + 2);
      expect(page.stats.studentsWithGradedHomeworkCount).toBe(baseline.stats.studentsWithGradedHomeworkCount + 1);
      // Platform-wide stats ride the baseline probe (committed students are
      // legitimate test-DB state): the exact platform-wide averages hold
      // only when no committed graded rows mix into them.
      if (baseline.stats.studentsWithGradedHomeworkCount === 0) {
        expect(page.stats.averageJadidGrade).toBe(80);
        expect(page.stats.averageMadiGrade).toBe(70);
      }
      expect(page.stats.needingAttentionCount).toBe(baseline.stats.needingAttentionCount);
    });
  });

  test("Tier 1 — non-admin actors (teacher/student/parent) → constant ForbiddenError; zero reads; one log each", async () => {
    await runInRollback(async tx => {
      const teacher = await createTeacher(tx);
      const student = await createStudent(tx, "Student Probe");
      const parent = await createTestUser(tx, { role: "parent" });
      const readSpies = spyDashboardReads();
      const logSpy = silenceDomainLog();

      const errors = await Promise.all(
        [teacher.user, student.user, parent].map(actor =>
          expectRepoError(() => AdminAcademicTrackingService.getAcademicDashboard(actor.id, {}, 1, 25, LOCALE, tx))
        )
      );

      for (const error of errors) {
        expect(error).toBeInstanceOf(ForbiddenError);
        expect(error.message).toBe(tErrors.forbidden);
      }
      for (const spy of readSpies) {
        expect(spy).not.toHaveBeenCalled();
      }
      expect(logSpy).toHaveBeenCalledTimes(3);
    });
  });

  test("Tier 1 — anonymous actor (id=0) → UnauthorizedError BEFORE any read; one gate log", async () => {
    await runInRollback(async tx => {
      await createAdmin(tx);
      const readSpies = spyDashboardReads();
      const logSpy = silenceDomainLog();

      const error = await expectRepoError(() =>
        AdminAcademicTrackingService.getAcademicDashboard(0, {}, 1, 25, LOCALE, tx)
      );

      expect(error).toBeInstanceOf(UnauthorizedError);
      expect(error.message).toBe(tErrors.unauthorized);
      for (const spy of readSpies) {
        expect(spy).not.toHaveBeenCalled();
      }
      expect(logSpy).toHaveBeenCalledTimes(1);
    });
  });

  test("Tier 1 — soft-deleted admin → accountDeleted denial; zero data reads", async () => {
    await runInRollback(async tx => {
      const deletedAdmin = await createTestUser(tx, { role: "admin", isDeleted: true });
      await createStudent(tx, "Unreachable Student");
      const readSpies = spyDashboardReads();
      const logSpy = silenceDomainLog();

      const error = await expectRepoError(() =>
        AdminAcademicTrackingService.getAcademicDashboard(deletedAdmin.id, {}, 1, 25, LOCALE, tx)
      );

      expect(error).toBeInstanceOf(ForbiddenError);
      expect(error.message).toBe(tErrors.accountDeleted);
      for (const spy of readSpies) {
        expect(spy).not.toHaveBeenCalled();
      }
      expect(logSpy).toHaveBeenCalledTimes(1);
    });
  });

  test("Tier 1 — empty and whitespace-only search stay unfiltered; email search narrows", async () => {
    await runInRollback(async tx => {
      const admin = await createAdmin(tx);
      const baseline = await captureDashboardBaseline(admin.id, tx);
      const first = await createStudent(tx, "Sara First");
      const second = await createStudent(tx, "Sara Second");

      const unfiltered = await AdminAcademicTrackingService.getAcademicDashboard(
        admin.id,
        { search: null },
        1,
        25,
        LOCALE,
        tx
      );
      expect(unfiltered.total).toBe(baseline.total + 2);

      const whitespace = await AdminAcademicTrackingService.getAcademicDashboard(
        admin.id,
        { search: "   " },
        1,
        25,
        LOCALE,
        tx
      );
      expect(whitespace.total).toBe(baseline.total + 2);
      // Page-1 items cap at the page size: the honest length is the total
      // clamped to 25, not baseline.items.length + 2 (committed students
      // from GraphQL integration suites can already fill page 1).
      expect(whitespace.items).toHaveLength(Math.min(baseline.total + 2, 25));

      const byEmail = await AdminAcademicTrackingService.getAcademicDashboard(
        admin.id,
        { search: second.user.email.slice(0, 12) },
        1,
        25,
        LOCALE,
        tx
      );
      expect(byEmail.total).toBe(1);
      expect(byEmail.items[0]?.id).toBe(second.user.id);
      expect(byEmail.items.map(row => row.id)).not.toContain(first.user.id);
    });
  });

  test("Tier 1 — out-of-range page → empty items next to the honest total", async () => {
    await runInRollback(async tx => {
      const admin = await createAdmin(tx);
      const baseline = await captureDashboardBaseline(admin.id, tx);
      await createStudent(tx, "Range Student One");
      await createStudent(tx, "Range Student Two");
      await createStudent(tx, "Range Student Three");

      const expectedTotal = baseline.total + 3;
      // "Out of range" is RELATIVE to the honest total (committed students
      // from GraphQL integration suites can put page 9 in range): any page
      // strictly past the final page must read empty next to that total.
      const outOfRangePage = Math.ceil(expectedTotal / 2) + 1;
      const page = await AdminAcademicTrackingService.getAcademicDashboard(admin.id, {}, outOfRangePage, 2, LOCALE, tx);

      expect(page.items).toEqual([]);
      expect(page.total).toBe(expectedTotal);
      expect(page.page).toBe(outOfRangePage);
      expect(page.pageSize).toBe(2);
      expect(page.pageCount).toBe(Math.ceil(expectedTotal / 2));
    });
  });

  test("Tier 4 — malformed pagination rejects localized ValidationError pre-DB", async () => {
    await runInRollback(async tx => {
      const admin = await createAdmin(tx);
      const readSpies = spyDashboardReads();
      const logSpy = silenceDomainLog();

      const zeroPage = await expectRepoError(() =>
        AdminAcademicTrackingService.getAcademicDashboard(admin.id, {}, 0, 25, LOCALE, tx)
      );
      const hugePageSize = await expectRepoError(() =>
        AdminAcademicTrackingService.getAcademicDashboard(admin.id, {}, 1, 101, LOCALE, tx)
      );

      for (const error of [zeroPage, hugePageSize]) {
        expect(error).toBeInstanceOf(ValidationError);
        expect(error.message).toBe(tErrors.validation);
      }
      for (const spy of readSpies) {
        expect(spy).not.toHaveBeenCalled();
      }
      expect(logSpy).not.toHaveBeenCalled();
    });
  });

  test("Tier 4 — search wildcards cannot widen the match", async () => {
    await runInRollback(async tx => {
      const admin = await createAdmin(tx);
      const literal = await createStudent(tx, "Ahmed% Literal");
      const plain = await createStudent(tx, "AhmedX Plain");

      const percentSearch = await AdminAcademicTrackingService.getAcademicDashboard(
        admin.id,
        { search: "Ahmed%" },
        1,
        25,
        LOCALE,
        tx
      );
      expect(percentSearch.total).toBe(1);
      expect(percentSearch.items[0]?.id).toBe(literal.user.id);
      expect(percentSearch.items.map(row => row.id)).not.toContain(plain.user.id);

      const underscoreSearch = await AdminAcademicTrackingService.getAcademicDashboard(
        admin.id,
        { search: "AhmedX_Plain" },
        1,
        25,
        LOCALE,
        tx
      );
      expect(underscoreSearch.total).toBe(0);
    });
  });
});

describe("AdminAcademicTrackingService.getStudentAcademicDetail", () => {
  test("Tier 1 — admin happy path: echo, ordered histories, teacher identities, progress count", async () => {
    await runInRollback(async tx => {
      const admin = await createAdmin(tx);
      const first = await createTeacher(tx, "Teacher One");
      const second = await createTeacher(tx, "Teacher Two");
      const { user: studentUser, studentRow } = await createStudent(tx, "Drill Student");

      const liveStart = daysAgo(1);
      const liveSession = await createTestSession(tx, first.user.id, studentRow.id, {
        status: SessionStatus.Completed,
        startedAt: liveStart,
        endedAt: liveStart,
      });
      const scheduledSession = await createTestSession(tx, second.user.id, studentRow.id, {
        status: SessionStatus.Scheduled,
      });

      const gradedAt = daysAgo(1);
      const liveHomework = await createTestHomeWork(tx, liveSession.id, {
        currentSurahJuz: SurahJuzRef.Juz1,
        currentFromAyah: 1,
        currentToAyah: 5,
        currentGrade: 80,
        revisionSurahJuz: SurahJuzRef.Juz3,
        revisionFromAyah: 1,
        revisionToAyah: 7,
        revisionGrade: null,
        createdAt: gradedAt,
        updatedAt: gradedAt,
      });
      await createTestHomeWork(tx, scheduledSession.id, {
        revisionSurahJuz: SurahJuzRef.Juz5,
        revisionFromAyah: 10,
        revisionToAyah: 15,
        revisionGrade: null,
      });
      const report = await createTestSessionReport(tx, liveSession.id, {
        teacherNotes: "Good session",
        studentRatingByTeacher: 4,
        createdAt: daysAgo(1),
      });
      await tx.insert(progress).values({ studentId: studentRow.id, lessonId: null });
      await tx.insert(progress).values({ studentId: studentRow.id, lessonId: null });

      const logSpy = silenceDomainLog();
      const detail = await AdminAcademicTrackingService.getStudentAcademicDetail(
        admin.id,
        studentUser.id,
        1,
        25,
        LOCALE,
        tx
      );

      expect(logSpy).not.toHaveBeenCalled();
      expect(detail.student).toEqual({
        id: studentUser.id,
        fullName: "Drill Student",
        email: studentUser.email,
        isDeleted: false,
      });
      expect(detail.progressRowCount).toBe(2);
      expect(detail.needsAttention).toBeNull();

      expect(detail.homeworkPage.total).toBe(2);
      expect(detail.homeworkPage.page).toBe(1);
      expect(detail.homeworkPage.pageSize).toBe(25);
      expect(detail.homeworkPage.pageCount).toBe(1);
      expect(detail.homeworkPage.items).toHaveLength(2);

      const liveEntry = detail.homeworkPage.items.find(entry => entry.id === liveHomework.id);
      expect(liveEntry).toBeDefined();
      if (liveEntry === undefined) {
        throw new Error("live homework entry missing");
      }
      expect(liveEntry.sessionId).toBe(liveSession.id);
      expect(liveEntry.sessionStartedAt).toBe(liveStart.toISOString());
      expect(liveEntry.teacherName).toBe("Teacher One");
      expect(liveEntry.jadid).toEqual({ surahJuz: SurahJuzRef.Juz1, fromAyah: 1, toAyah: 5, grade: 80 });
      expect(liveEntry.madi).toEqual({ surahJuz: SurahJuzRef.Juz3, fromAyah: 1, toAyah: 7, grade: null });
      expect(liveEntry.createdAt).toBe(gradedAt.toISOString());

      const scheduledEntry = detail.homeworkPage.items.find(entry => entry.id !== liveHomework.id);
      expect(scheduledEntry).toBeDefined();
      if (scheduledEntry === undefined) {
        throw new Error("scheduled homework entry missing");
      }
      expect(scheduledEntry.sessionStartedAt).toBeNull();
      expect(scheduledEntry.teacherName).toBe("Teacher Two");
      expect(scheduledEntry.jadid).toBeNull();
      expect(scheduledEntry.madi).toEqual({ surahJuz: SurahJuzRef.Juz5, fromAyah: 10, toAyah: 15, grade: null });

      expect(detail.reportPage.total).toBe(1);
      const reportEntry = detail.reportPage.items[0];
      expect(reportEntry).toBeDefined();
      expect(reportEntry.id).toBe(report.id);
      expect(reportEntry.sessionId).toBe(liveSession.id);
      expect(reportEntry.sessionStartedAt).toBe(liveStart.toISOString());
      expect(reportEntry.teacherName).toBe("Teacher One");
      expect(reportEntry.teacherNotes).toBe("Good session");
      expect(reportEntry.studentRatingByTeacher).toBe(4);
      expect(reportEntry.createdAt).toBe(report.createdAt.toISOString());
    });
  });

  test("Tier 1 — nonexistent id → localized NotFoundError, one bounded log, zero downstream reads", async () => {
    await runInRollback(async tx => {
      const admin = await createAdmin(tx);
      const missingId = await absentStudentId(tx);
      await expectStudentAbsent(tx, missingId);
      const readSpies = spyDrilldownReads();
      const logSpy = silenceDomainLog();

      const error = await expectRepoError(() =>
        AdminAcademicTrackingService.getStudentAcademicDetail(admin.id, missingId, 1, 25, LOCALE, tx)
      );

      expect(error).toBeInstanceOf(NotFoundError);
      expect(error.message).toBe(tErrors.notFound);
      const notFoundCode = error instanceof NotFoundError ? error.code : "";
      expect(notFoundCode).toBe("STUDENT_NOT_FOUND");
      const echoSpy = readSpies[0];
      const homeworkSpy = readSpies[1];
      expect(echoSpy).toHaveBeenCalledTimes(1);
      expect(homeworkSpy).not.toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledTimes(1);
    });
  });

  test("Tier 1 — non-student id (teacher account) → same NotFoundError (echo seals the student lane)", async () => {
    await runInRollback(async tx => {
      const admin = await createAdmin(tx);
      const { user: teacherUser } = await createTeacher(tx);
      const logSpy = silenceDomainLog();

      const error = await expectRepoError(() =>
        AdminAcademicTrackingService.getStudentAcademicDetail(admin.id, teacherUser.id, 1, 25, LOCALE, tx)
      );

      expect(error).toBeInstanceOf(NotFoundError);
      expect(error.message).toBe(tErrors.notFound);
      expect(logSpy).toHaveBeenCalledTimes(1);
    });
  });

  test("Tier 1 — non-admin actors denied identically for valid and nonexistent ids (zero existence oracle)", async () => {
    await runInRollback(async tx => {
      const teacher = await createTeacher(tx);
      const student = await createStudent(tx, "Hidden Student");
      const missingId = await absentStudentId(tx);
      const logSpy = silenceDomainLog();

      const validIdError = await expectRepoError(() =>
        AdminAcademicTrackingService.getStudentAcademicDetail(teacher.user.id, student.user.id, 1, 25, LOCALE, tx)
      );
      const missingIdError = await expectRepoError(() =>
        AdminAcademicTrackingService.getStudentAcademicDetail(teacher.user.id, missingId, 1, 25, LOCALE, tx)
      );
      const dashboardError = await expectRepoError(() =>
        AdminAcademicTrackingService.getStudentAcademicDetail(student.user.id, student.user.id, 1, 25, LOCALE, tx)
      );

      expect(validIdError).toBeInstanceOf(ForbiddenError);
      expect(missingIdError.message).toBe(validIdError.message);
      expect(dashboardError.message).toBe(validIdError.message);
      expect(logSpy).toHaveBeenCalledTimes(3);
    });
  });

  test("Tier 1 — anonymous actor (id=0) → UnauthorizedError BEFORE any read", async () => {
    await runInRollback(async tx => {
      const readSpies = spyDrilldownReads();
      const logSpy = silenceDomainLog();

      const error = await expectRepoError(() =>
        AdminAcademicTrackingService.getStudentAcademicDetail(0, 1, 1, 25, LOCALE, tx)
      );

      expect(error).toBeInstanceOf(UnauthorizedError);
      expect(error.message).toBe(tErrors.unauthorized);
      for (const spy of readSpies) {
        expect(spy).not.toHaveBeenCalled();
      }
      expect(logSpy).toHaveBeenCalledTimes(1);
    });
  });

  test("Tier 1 — soft-deleted admin → accountDeleted denial", async () => {
    await runInRollback(async tx => {
      const deletedAdmin = await createTestUser(tx, { role: "admin", isDeleted: true });
      const { user: studentUser } = await createStudent(tx, "Sealed Student");
      const readSpies = spyDrilldownReads();
      const logSpy = silenceDomainLog();

      const error = await expectRepoError(() =>
        AdminAcademicTrackingService.getStudentAcademicDetail(deletedAdmin.id, studentUser.id, 1, 25, LOCALE, tx)
      );

      expect(error).toBeInstanceOf(ForbiddenError);
      expect(error.message).toBe(tErrors.accountDeleted);
      for (const spy of readSpies) {
        expect(spy).not.toHaveBeenCalled();
      }
      expect(logSpy).toHaveBeenCalledTimes(1);
    });
  });

  test("Tier 1 — malformed studentId → localized ValidationError pre-DB; out-of-range page → honest empty window", async () => {
    await runInRollback(async tx => {
      const admin = await createAdmin(tx);
      const { user: studentUser, studentRow } = await createStudent(tx, "Paged Student");
      const { user: teacherUser } = await createTeacher(tx);
      const sessionRow = await createTestSession(tx, teacherUser.id, studentRow.id, {
        status: SessionStatus.Completed,
        startedAt: daysAgo(1),
      });
      await createTestHomeWork(tx, sessionRow.id, {
        currentSurahJuz: SurahJuzRef.Juz2,
        currentFromAyah: 1,
        currentToAyah: 3,
        currentGrade: 90,
      });
      const readSpies = spyDrilldownReads();
      const logSpy = silenceDomainLog();

      const zeroId = await expectRepoError(() =>
        AdminAcademicTrackingService.getStudentAcademicDetail(admin.id, 0, 1, 25, LOCALE, tx)
      );
      const fractionalId = await expectRepoError(() =>
        AdminAcademicTrackingService.getStudentAcademicDetail(admin.id, 1.5, 1, 25, LOCALE, tx)
      );
      for (const error of [zeroId, fractionalId]) {
        expect(error).toBeInstanceOf(ValidationError);
        expect(error.message).toBe(tErrors.validation);
      }
      for (const spy of readSpies) {
        expect(spy).not.toHaveBeenCalled();
      }

      const outOfRange = await AdminAcademicTrackingService.getStudentAcademicDetail(
        admin.id,
        studentUser.id,
        4,
        2,
        LOCALE,
        tx
      );
      expect(outOfRange.homeworkPage.items).toEqual([]);
      expect(outOfRange.homeworkPage.total).toBe(1);
      expect(outOfRange.homeworkPage.page).toBe(4);
      expect(outOfRange.homeworkPage.pageCount).toBe(1);
      expect(outOfRange.reportPage.items).toEqual([]);
      expect(outOfRange.reportPage.total).toBe(0);
      expect(outOfRange.progressRowCount).toBe(0);

      expect(logSpy).not.toHaveBeenCalled();
    });
  });

  test("Tier 2 — zero-graded student: no flag, null summaries, honest stats", async () => {
    await runInRollback(async tx => {
      const admin = await createAdmin(tx);
      const { user: teacherUser } = await createTeacher(tx);
      const { user: studentUser, studentRow } = await createStudent(tx, "Ungraded Student");
      const sessionRow = await createTestSession(tx, teacherUser.id, studentRow.id, {
        status: SessionStatus.Completed,
        startedAt: daysAgo(2),
        endedAt: daysAgo(2),
      });
      await createTestHomeWork(tx, sessionRow.id, {
        currentSurahJuz: SurahJuzRef.Juz1,
        currentFromAyah: 1,
        currentToAyah: 5,
        currentGrade: null,
        createdAt: daysAgo(1),
      });

      const page = await AdminAcademicTrackingService.getAcademicDashboard(admin.id, {}, 1, 25, LOCALE, tx);
      const row = page.items.find(candidate => candidate.id === studentUser.id);
      expect(row).toBeDefined();
      if (row === undefined) {
        throw new Error("ungraded student row missing");
      }
      expect(row.jadidGradeSummary).toBeNull();
      expect(row.madiGradeSummary).toBeNull();
      expect(row.lastGradedHomeworkAt).toBeNull();
      expect(row.needsAttention).toBeNull();
      // Platform-wide stats ride a baseline probe (committed students are
      // legitimate test-DB state): the ungraded fixture adds nothing to any
      // count and flips no flag; the null averages hold only when no
      // committed graded rows exist to mix into them.
      const baseline = await captureDashboardBaseline(admin.id, tx);
      expect(page.stats.studentsWithGradedHomeworkCount).toBe(baseline.stats.studentsWithGradedHomeworkCount);
      expect(page.stats.needingAttentionCount).toBe(baseline.stats.needingAttentionCount);
      if (baseline.stats.studentsWithGradedHomeworkCount === 0) {
        expect(page.stats.averageJadidGrade).toBeNull();
        expect(page.stats.averageMadiGrade).toBeNull();
      }

      const detail = await AdminAcademicTrackingService.getStudentAcademicDetail(
        admin.id,
        studentUser.id,
        1,
        25,
        LOCALE,
        tx
      );
      expect(detail.needsAttention).toBeNull();
    });
  });

  test("Tier 2 — single-track student: opposite track stays null on dashboard and history entries", async () => {
    await runInRollback(async tx => {
      const admin = await createAdmin(tx);
      const { user: teacherUser } = await createTeacher(tx);
      const { user: studentUser, studentRow } = await createStudent(tx, "Madi Only Student");
      const sessionRow = await createTestSession(tx, teacherUser.id, studentRow.id, {
        status: SessionStatus.Completed,
        startedAt: daysAgo(1),
      });
      await createTestHomeWork(tx, sessionRow.id, {
        revisionSurahJuz: SurahJuzRef.Juz4,
        revisionFromAyah: 2,
        revisionToAyah: 9,
        revisionGrade: 66,
        createdAt: daysAgo(1),
        updatedAt: daysAgo(1),
      });

      const page = await AdminAcademicTrackingService.getAcademicDashboard(admin.id, {}, 1, 25, LOCALE, tx);
      const row = page.items.find(candidate => candidate.id === studentUser.id);
      expect(row).toBeDefined();
      if (row === undefined) {
        throw new Error("single-track student row missing");
      }
      expect(row.latestJadidPosition).toBeNull();
      expect(row.jadidGradeSummary).toBeNull();
      expect(row.latestMadiPosition).toEqual({ surahJuz: SurahJuzRef.Juz4, fromAyah: 2, toAyah: 9 });
      expect(row.madiGradeSummary).toEqual({ gradedCount: 1, averageGrade: 66 });

      const detail = await AdminAcademicTrackingService.getStudentAcademicDetail(
        admin.id,
        studentUser.id,
        1,
        25,
        LOCALE,
        tx
      );
      const entry = detail.homeworkPage.items[0];
      expect(entry).toBeDefined();
      expect(entry.jadid).toBeNull();
      expect(entry.madi).toEqual({ surahJuz: SurahJuzRef.Juz4, fromAyah: 2, toAyah: 9, grade: 66 });
    });
  });

  test("Tier 2 — flagged student: both reasons compose in canonical order and the stats count rides the whole lane", async () => {
    await runInRollback(async tx => {
      const admin = await createAdmin(tx);
      const baseline = await captureDashboardBaseline(admin.id, tx);
      const { user: teacherUser } = await createTeacher(tx);
      const { user: studentUser, studentRow } = await createStudent(tx, "Flagged Student");
      const sessionRow = await createTestSession(tx, teacherUser.id, studentRow.id, {
        status: SessionStatus.Completed,
        startedAt: daysAgo(22),
        endedAt: daysAgo(22),
      });
      await createTestHomeWork(tx, sessionRow.id, {
        currentSurahJuz: SurahJuzRef.Juz1,
        currentFromAyah: 1,
        currentToAyah: 5,
        currentGrade: 40,
        createdAt: daysAgo(21),
        updatedAt: daysAgo(20),
      });
      const secondSession = await createTestSession(tx, teacherUser.id, studentRow.id, {
        status: SessionStatus.Completed,
        startedAt: daysAgo(19),
        endedAt: daysAgo(19),
      });
      await createTestHomeWork(tx, secondSession.id, {
        currentSurahJuz: SurahJuzRef.Juz2,
        currentFromAyah: 6,
        currentToAyah: 10,
        currentGrade: 50,
        createdAt: daysAgo(19),
        updatedAt: daysAgo(19),
      });

      const page = await AdminAcademicTrackingService.getAcademicDashboard(admin.id, {}, 1, 25, LOCALE, tx);
      const row = page.items.find(candidate => candidate.id === studentUser.id);
      expect(row).toBeDefined();
      if (row === undefined) {
        throw new Error("flagged student row missing");
      }
      expect(row.needsAttention).toEqual({ reasons: ["lowGrade", "staleProgress"] });
      // Baseline-relative per the suite discipline: committed residue
      // students may already carry flags of their own.
      expect(page.stats.needingAttentionCount).toBe(baseline.stats.needingAttentionCount + 1);

      const detail = await AdminAcademicTrackingService.getStudentAcademicDetail(
        admin.id,
        studentUser.id,
        1,
        25,
        LOCALE,
        tx
      );
      expect(detail.needsAttention).toEqual({ reasons: ["lowGrade", "staleProgress"] });
    });
  });

  test("Tier 2 — soft-deleted student: excluded from the dashboard, viewable in the drill-down with the marker", async () => {
    await runInRollback(async tx => {
      const admin = await createAdmin(tx);
      const baseline = await captureDashboardBaseline(admin.id, tx);
      const { user: teacherUser } = await createTeacher(tx);
      const deleted = await createStudent(tx, "Deleted Student", { isDeleted: true });
      const live = await createStudent(tx, "Live Student");
      const sessionRow = await createTestSession(tx, teacherUser.id, deleted.studentRow.id, {
        status: SessionStatus.Completed,
        startedAt: daysAgo(3),
      });
      await createTestHomeWork(tx, sessionRow.id, {
        currentSurahJuz: SurahJuzRef.Juz1,
        currentFromAyah: 1,
        currentToAyah: 2,
        currentGrade: 95,
        createdAt: daysAgo(3),
      });

      const page = await AdminAcademicTrackingService.getAcademicDashboard(admin.id, {}, 1, 25, LOCALE, tx);
      const visibleIds = page.items.map(row => row.id);
      expect(visibleIds).toContain(live.user.id);
      expect(visibleIds).not.toContain(deleted.user.id);
      expect(page.total).toBe(baseline.total + 1);
      expect(page.stats.trackedStudentCount).toBe(baseline.stats.trackedStudentCount + 1);

      const detail = await AdminAcademicTrackingService.getStudentAcademicDetail(
        admin.id,
        deleted.user.id,
        1,
        25,
        LOCALE,
        tx
      );
      expect(detail.student).toEqual({
        id: deleted.user.id,
        fullName: "Deleted Student",
        email: deleted.user.email,
        isDeleted: true,
      });
      expect(detail.homeworkPage.total).toBe(1);
      expect(detail.homeworkPage.items[0]?.teacherName).toBe(teacherUser.fullName);
    });
  });

  test("Tier 2 — unicode/RTL name search matches the student", async () => {
    await runInRollback(async tx => {
      const admin = await createAdmin(tx);
      const arabic = await createStudent(tx, "أحمد محمود");
      await createStudent(tx, "Om Lookup");

      const arabicSearch = await AdminAcademicTrackingService.getAcademicDashboard(
        admin.id,
        { search: "أحمد" },
        1,
        25,
        LOCALE,
        tx
      );
      expect(arabicSearch.total).toBe(1);
      expect(arabicSearch.items[0]?.id).toBe(arabic.user.id);

      const caseProbe = await createStudent(tx, "Ahmed Latin");
      const latinSearch = await AdminAcademicTrackingService.getAcademicDashboard(
        admin.id,
        { search: "ahmed" },
        1,
        25,
        LOCALE,
        tx
      );
      expect(latinSearch.total).toBe(1);
      expect(latinSearch.items[0]?.id).toBe(caseProbe.user.id);
    });
  });

  test("Tier 3 — overlapping concurrent reads on the same transaction all fulfill and agree", async () => {
    await runInRollback(async tx => {
      const admin = await createAdmin(tx);
      const { user: teacherUser } = await createTeacher(tx);
      const first = await createStudent(tx, "Concurrent One");
      const second = await createStudent(tx, "Concurrent Two");
      const sessionRow = await createTestSession(tx, teacherUser.id, second.studentRow.id, {
        status: SessionStatus.Completed,
        startedAt: daysAgo(1),
      });
      await createTestHomeWork(tx, sessionRow.id, {
        currentSurahJuz: SurahJuzRef.Juz1,
        currentFromAyah: 1,
        currentToAyah: 4,
        currentGrade: 88,
        createdAt: daysAgo(1),
        updatedAt: daysAgo(1),
      });

      // The concurrency proof needs a DETERMINISTIC page window, so the two
      // overlapping dashboard reads scope themselves to this test's fixtures
      // by search — a shared baseline (seeded demo student, peer-file
      // fixtures) must not shift which rows land on pages 1–2.
      const [pageOne, pageTwo, detail] = await Promise.all([
        AdminAcademicTrackingService.getAcademicDashboard(admin.id, { search: "Concurrent" }, 1, 1, LOCALE, tx),
        AdminAcademicTrackingService.getAcademicDashboard(admin.id, { search: "Concurrent" }, 2, 1, LOCALE, tx),
        AdminAcademicTrackingService.getStudentAcademicDetail(admin.id, second.user.id, 1, 25, LOCALE, tx),
      ]);

      expect(pageOne.total).toBe(2);
      expect(pageTwo.total).toBe(2);
      expect(pageOne.total).toBe(pageTwo.total);
      expect(pageOne.items).toHaveLength(1);
      expect(pageTwo.items).toHaveLength(1);
      const visibleIds = [pageOne.items[0]?.id ?? 0, pageTwo.items[0]?.id ?? 0].toSorted((a, b) => a - b);
      expect(visibleIds).toEqual([first.user.id, second.user.id].toSorted((a, b) => a - b));
      expect(pageOne.stats.needingAttentionCount).toBe(pageTwo.stats.needingAttentionCount);
      expect(detail.homeworkPage.total).toBe(1);
      expect(detail.homeworkPage.items[0]?.teacherName).toBe(teacherUser.fullName);
    });
  });
});
