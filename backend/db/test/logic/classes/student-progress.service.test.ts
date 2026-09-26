/**
 * StudentProgressService logic-tree test suite.
 *
 * Real service + real repositories inside `runInRollback` — the increment
 * permutations and the gated read matrix are asserted against actual
 * rolled-back rows, and every skip/no-op is counted on the silenced
 * domain-log spy (exactly-one-log discipline).
 *
 * The one cross-connection chaos case (two concurrent settlements of one
 * student) cannot run inside a single rollback transaction — the
 * student-row serializer only blocks ACROSS transactions — so it runs on
 * committed fixtures over two pool clients and hard-deletes them in
 * `afterAll` (FK order, with a zero-residue re-probe), following the
 * committed-fixture convention of the subscription repository suite.
 */

import { afterAll, afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/backend/db";
import { PlanRepository, ProgressRepository } from "@/backend/db/repo";
import { plans as plansTable } from "@/backend/db/schema/billing/plans";
import { lessons as lessonsTable } from "@/backend/db/schema/classes/lessons";
import { progress } from "@/backend/db/schema/classes/progress";
import {
  createTestPlan,
  createTestSession,
  createTestStudent,
  createTestSubscription,
  createTestTeacherRow,
  createTestUser,
} from "@/backend/db/test/entity-setup";
import { expectRepoError, runInRollback } from "@/backend/db/test/test-utils";
import { SubscriptionCreditLane } from "@/backend/enum/billing/subscription-credit-lane.enum";
import { SessionIntent } from "@/backend/enum/scheduling/session-intent.enum";
import { UserRole } from "@/backend/enum/users/user-role.enum";
import { ForbiddenError, NotFoundError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import { StudentProgressService } from "@/backend/services/classes/student-progress.service";
import type {
  DBTransaction,
  LessonSelectType,
  PlanSelectType,
  SessionSelectType,
  StudentProgressReturnType,
  StudentSelectType,
  UserSelectType,
} from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import { countUsersByIds, deleteSessionsByParticipantUserIds, deleteUsersByIds } from "@/test/helpers/db-cleanup";
import { isPgliteProvider } from "@/test/helpers/skip-when-pglite";

const LOCALE = "en";
const tErrors = getServerTranslations(LOCALE).errorsTranslations;

/** Committed-fixture chaos case runs ONLY on a real multi-connection PostgreSQL. */
const testOnRealPostgres = isPgliteProvider() ? test.skip : test;

/** Domain log spy family share this stubbed signature. */
type DomainLogSpy = ReturnType<typeof spyOn>;

/** Silences `logger.logDomainError` so test stdout stays compact. */
function silenceDomainLog(): DomainLogSpy {
  return spyOn(logger, "logDomainError").mockImplementation(() => {});
}

/**
 * Provisions a student actor: the `users` row (role student) plus its
 * shared-PK `students` row. The students row is what every progress read
 * and write addresses, and it is the row the increment's serializer lock
 * is taken on.
 */
async function provisionStudent(tx: DBTransaction): Promise<{ user: UserSelectType; student: StudentSelectType }> {
  const user = await createTestUser(tx, { role: "student" });
  const student = await createTestStudent(tx, user.id);
  return { user, student };
}

/**
 * Provisions a teacher actor: the `users` row plus its shared-PK `teachers`
 * row (session rows FK the teachers table, not the user row).
 */
async function provisionTeacher(tx: DBTransaction): Promise<{ user: UserSelectType; teacherId: number }> {
  const user = await createTestUser(tx, { role: "teacher" });
  await createTestTeacherRow(tx, user.id);
  return { user, teacherId: user.id };
}

/**
 * Provisions the bare curriculum shape: one tajweed-lane plan with the
 * requested number of lessons and NO subscription — the caller decides
 * which plan (if any) governs the student. Lessons insert in ONE
 * multi-row statement — identity values are allocated in VALUES order,
 * so the returned rows (re-sorted by id) ARE the `id ASC` curriculum
 * sequence the service consumes.
 */
async function provisionTajweedPlanLessons(
  tx: DBTransaction,
  lessonCount: number
): Promise<{ plan: PlanSelectType; lessons: LessonSelectType[] }> {
  const plan = await createTestPlan(tx, { balanceLane: SubscriptionCreditLane.Tajweed });
  const rows = await tx
    .insert(lessonsTable)
    .values(
      Array.from({ length: lessonCount }, () => ({
        planId: plan.id,
        title: `Test Lesson ${randomUUID().slice(0, 8)}`,
      }))
    )
    .returning();
  const lessons = rows.toSorted((first, second) => first.id - second.id);
  return { plan, lessons };
}

/**
 * Provisions the curriculum fixture: one tajweed-lane plan with the
 * requested number of lessons plus one active subscription for the
 * student — the bare plan+lessons shape with the governing lane attached.
 */
async function provisionTajweedCurriculum(
  tx: DBTransaction,
  studentId: number,
  lessonCount: number
): Promise<{ plan: PlanSelectType; lessons: LessonSelectType[] }> {
  const { plan, lessons } = await provisionTajweedPlanLessons(tx, lessonCount);
  await createTestSubscription(tx, studentId, plan.id);
  return { plan, lessons };
}

/** Creates one tajweed-intent session row between the two participants. */
async function provisionTajweedSession(
  tx: DBTransaction,
  teacherId: number,
  studentId: number,
  overrides: Partial<SessionSelectType> = {}
): Promise<SessionSelectType> {
  return createTestSession(tx, teacherId, studentId, { intent: SessionIntent.Tajweed, ...overrides });
}

/**
 * Seeds one pointer row and reads the payload as an admin — the read-probe
 * primitive behind the percent/position matrix (each call's row is the
 * NEWEST pointer, which the plan-scoped read resolves).
 */
async function seedPointerAndRead(
  tx: DBTransaction,
  callerId: number,
  studentId: number,
  lessonId: number
): Promise<StudentProgressReturnType> {
  await ProgressRepository.insertRow({ studentId, lessonId }, tx);
  return StudentProgressService.getStudentProgress(callerId, UserRole.Admin, studentId, LOCALE, tx);
}

/** Counts the student's raw `progress` rows — the no-duplicate-row oracle. */
async function countProgressRows(tx: DBTransaction, studentId: number): Promise<number> {
  const rows = await tx.select({ id: progress.id }).from(progress).where(eq(progress.studentId, studentId));
  return rows.length;
}

/** Asserts a call was denied with the constant-shape `FORBIDDEN` error. */
async function expectForbiddenError(run: () => Promise<unknown>): Promise<void> {
  const error = await expectRepoError(run);
  expect(error).toBeInstanceOf(ForbiddenError);
  if (error instanceof ForbiddenError) {
    expect(error.code).toBe("FORBIDDEN");
  }
}

/** Asserts a call was denied with the localized `STUDENT_NOT_FOUND` error. */
async function expectStudentNotFoundError(run: () => Promise<unknown>): Promise<void> {
  const error = await expectRepoError(run);
  expect(error).toBeInstanceOf(NotFoundError);
  if (error instanceof NotFoundError) {
    expect(error.code).toBe("STUDENT_NOT_FOUND");
    expect(error.message).toContain(tErrors.studentProgress.studentNotFound);
  }
}

/**
 * Asserts the spy recorded EXACTLY one structured skip carrying the
 * machine reason and the session/student identity.
 */
function expectOneSkipLog(domainSpy: DomainLogSpy, reason: string, sessionId: number, studentId: number): void {
  expect(domainSpy.mock.calls).toHaveLength(1);
  const [message, ctx] = domainSpy.mock.calls[0] ?? [];
  expect(message).toContain(reason);
  expect(ctx?.sessionId).toBe(sessionId);
  expect(ctx?.studentId).toBe(studentId);
}

/** Committed-fixture ids for the chaos case, hard-deleted in `afterAll`. */
const raceCleanup: { sessionParticipantIds: number[]; userIds: number[]; planIds: number[] } = {
  sessionParticipantIds: [],
  userIds: [],
  planIds: [],
};

afterEach(() => {
  mock.restore();
});

afterAll(async () => {
  // FK-ordered hard cleanup of the committed chaos-case fixtures:
  // sessions first (RESTRICT-delete their participants), then users
  // (subscriptions delete with them; students + progress cascade), then
  // the plan's lessons, then the plan.
  if (raceCleanup.sessionParticipantIds.length > 0) {
    await deleteSessionsByParticipantUserIds(raceCleanup.sessionParticipantIds);
  }
  if (raceCleanup.userIds.length > 0) {
    await deleteUsersByIds(raceCleanup.userIds);
  }
  if (raceCleanup.planIds.length > 0) {
    await db.delete(lessonsTable).where(inArray(lessonsTable.planId, raceCleanup.planIds));
    await db.delete(plansTable).where(inArray(plansTable.id, raceCleanup.planIds));
  }
  expect(await countUsersByIds(raceCleanup.userIds)).toBe(0);
});

describe("StudentProgressService.incrementForConfirmedSession", () => {
  test("first completed tajweed session inserts the pointer at the second lesson", async () => {
    await runInRollback(async tx => {
      const domainSpy = silenceDomainLog();
      const { student } = await provisionStudent(tx);
      const { plan, lessons } = await provisionTajweedCurriculum(tx, student.id, 3);
      const { teacherId } = await provisionTeacher(tx);
      const sessionRow = await provisionTajweedSession(tx, teacherId, student.id);

      await StudentProgressService.incrementForConfirmedSession(sessionRow, tx);

      const row = await ProgressRepository.findRowForStudentPlan(student.id, plan.id, tx);
      expect(row).not.toBeNull();
      expect(row?.lessonId).toBe(lessons[1].id);
      expect(await countProgressRows(tx, student.id)).toBe(1);
      expect(domainSpy.mock.calls).toHaveLength(0);
    });
  });

  test("a single-lesson plan pins the pointer at the only lesson and further completions are no-ops", async () => {
    await runInRollback(async tx => {
      const domainSpy = silenceDomainLog();
      const { student } = await provisionStudent(tx);
      const { plan, lessons } = await provisionTajweedCurriculum(tx, student.id, 1);
      const { teacherId } = await provisionTeacher(tx);
      const firstSession = await provisionTajweedSession(tx, teacherId, student.id);
      const secondSession = await provisionTajweedSession(tx, teacherId, student.id);

      await StudentProgressService.incrementForConfirmedSession(firstSession, tx);
      const pinned = await ProgressRepository.findRowForStudentPlan(student.id, plan.id, tx);
      expect(pinned?.lessonId).toBe(lessons[0].id);

      await StudentProgressService.incrementForConfirmedSession(secondSession, tx);
      const after = await ProgressRepository.findRowForStudentPlan(student.id, plan.id, tx);
      expect(after?.lessonId).toBe(lessons[0].id);
      expect(after?.id).toBe(pinned?.id);
      expect(after?.updatedAt).toEqual(pinned?.updatedAt);
      expect(await countProgressRows(tx, student.id)).toBe(1);
      expect(domainSpy.mock.calls).toHaveLength(0);
    });
  });

  test("a single-lesson plan re-anchors a lesson-less row by updating it, then further completions stay pinned", async () => {
    await runInRollback(async tx => {
      const domainSpy = silenceDomainLog();
      const { student } = await provisionStudent(tx);
      const { lessons } = await provisionTajweedCurriculum(tx, student.id, 1);
      const { teacherId } = await provisionTeacher(tx);
      const sessionRow = await provisionTajweedSession(tx, teacherId, student.id);
      // Real lesson-less fixture — the shape an admin lesson delete leaves
      // behind (the FK's ON DELETE SET NULL contract) — no read mock.
      const seeded = await ProgressRepository.insertRow({ studentId: student.id, lessonId: null }, tx);

      await StudentProgressService.incrementForConfirmedSession(sessionRow, tx);

      const [fresh] = await tx.select().from(progress).where(eq(progress.id, seeded.id));
      expect(fresh.id).toBe(seeded.id);
      expect(fresh.lessonId).toBe(lessons[0].id);
      // The re-anchor must be a REAL UPDATE, not an indistinguishable
      // no-op: updateRowLesson stamps a fresh `new Date()` into
      // `updated_at` on every write (and the schema `$onUpdate` mirror
      // would too), so the re-anchored row's stamp must sit strictly past
      // the seeded one — the fired-write proof for this same-lessonId arm.
      expect(fresh.updatedAt.getTime()).toBeGreaterThan(seeded.updatedAt.getTime());
      expect(await countProgressRows(tx, student.id)).toBe(1);
      expectOneSkipLog(domainSpy, "pointer-reanchored", sessionRow.id, student.id);

      // Once re-anchored, the row behaves as the pinned single-lesson
      // pointer: the next completion is a byte-identical no-op with no
      // additional skip log.
      const followUp = await provisionTajweedSession(tx, teacherId, student.id);
      await StudentProgressService.incrementForConfirmedSession(followUp, tx);
      const [pinned] = await tx.select().from(progress).where(eq(progress.id, seeded.id));
      expect(pinned.lessonId).toBe(lessons[0].id);
      expect(pinned.updatedAt).toEqual(fresh.updatedAt);
      expect(await countProgressRows(tx, student.id)).toBe(1);
      expect(domainSpy.mock.calls).toHaveLength(1);
    });
  });

  test("a mid-curriculum completion advances the pointer exactly one slot", async () => {
    await runInRollback(async tx => {
      silenceDomainLog();
      const { student } = await provisionStudent(tx);
      const { plan, lessons } = await provisionTajweedCurriculum(tx, student.id, 3);
      const { teacherId } = await provisionTeacher(tx);
      const sessionRow = await provisionTajweedSession(tx, teacherId, student.id);
      await ProgressRepository.insertRow({ studentId: student.id, lessonId: lessons[0].id }, tx);

      await StudentProgressService.incrementForConfirmedSession(sessionRow, tx);

      const row = await ProgressRepository.findRowForStudentPlan(student.id, plan.id, tx);
      expect(row?.lessonId).toBe(lessons[1].id);
      expect(await countProgressRows(tx, student.id)).toBe(1);
    });
  });

  test("a completion at the final lesson leaves the pointer byte-identical (curriculum-complete cap)", async () => {
    await runInRollback(async tx => {
      const domainSpy = silenceDomainLog();
      const { student } = await provisionStudent(tx);
      const { plan, lessons } = await provisionTajweedCurriculum(tx, student.id, 3);
      const { teacherId } = await provisionTeacher(tx);
      const sessionRow = await provisionTajweedSession(tx, teacherId, student.id);
      const seeded = await ProgressRepository.insertRow({ studentId: student.id, lessonId: lessons[2].id }, tx);

      await StudentProgressService.incrementForConfirmedSession(sessionRow, tx);

      const row = await ProgressRepository.findRowForStudentPlan(student.id, plan.id, tx);
      expect(row?.id).toBe(seeded.id);
      expect(row?.lessonId).toBe(lessons[2].id);
      expect(row?.updatedAt).toEqual(seeded.updatedAt);
      expect(await countProgressRows(tx, student.id)).toBe(1);
      expect(domainSpy.mock.calls).toHaveLength(0);
    });
  });

  test("evaluation and hifz intents never touch progress and never log", async () => {
    await runInRollback(async tx => {
      const domainSpy = silenceDomainLog();
      const { student } = await provisionStudent(tx);
      const { teacherId } = await provisionTeacher(tx);
      const evaluationSession = await createTestSession(tx, teacherId, student.id, {
        intent: SessionIntent.Evaluation,
      });
      const hifzSession = await createTestSession(tx, teacherId, student.id, { intent: SessionIntent.Hifz });

      await StudentProgressService.incrementForConfirmedSession(evaluationSession, tx);
      await StudentProgressService.incrementForConfirmedSession(hifzSession, tx);

      expect(await countProgressRows(tx, student.id)).toBe(0);
      expect(domainSpy.mock.calls).toHaveLength(0);
    });
  });

  test("no active tajweed-lane subscription skips with exactly one structured log and zero writes", async () => {
    await runInRollback(async tx => {
      const domainSpy = silenceDomainLog();
      const { student } = await provisionStudent(tx);
      const { teacherId } = await provisionTeacher(tx);
      const sessionRow = await provisionTajweedSession(tx, teacherId, student.id);

      await StudentProgressService.incrementForConfirmedSession(sessionRow, tx);

      expect(await countProgressRows(tx, student.id)).toBe(0);
      expectOneSkipLog(domainSpy, "no-active-tajweed-subscription", sessionRow.id, student.id);
    });
  });

  test("a zero-lesson plan skips with exactly one structured log and zero writes", async () => {
    await runInRollback(async tx => {
      const domainSpy = silenceDomainLog();
      const { student } = await provisionStudent(tx);
      const plan = await createTestPlan(tx, { balanceLane: SubscriptionCreditLane.Tajweed });
      await createTestSubscription(tx, student.id, plan.id);
      const { teacherId } = await provisionTeacher(tx);
      const sessionRow = await provisionTajweedSession(tx, teacherId, student.id);

      await StudentProgressService.incrementForConfirmedSession(sessionRow, tx);

      expect(await countProgressRows(tx, student.id)).toBe(0);
      expectOneSkipLog(domainSpy, "no-lessons", sessionRow.id, student.id);
    });
  });

  test("a null-pointer row is re-anchored IN PLACE: the next completion advances the same row without a duplicate", async () => {
    await runInRollback(async tx => {
      const domainSpy = silenceDomainLog();
      const { student } = await provisionStudent(tx);
      const { plan, lessons } = await provisionTajweedCurriculum(tx, student.id, 3);
      const { teacherId } = await provisionTeacher(tx);
      const sessionRow = await provisionTajweedSession(tx, teacherId, student.id);
      const dangling = await ProgressRepository.insertRow({ studentId: student.id, lessonId: null }, tx);

      await StudentProgressService.incrementForConfirmedSession(sessionRow, tx);

      // The EXISTING lesson-less row is re-anchored in place and advanced —
      // the increment never inserts a duplicate pointer beside it.
      const row = await ProgressRepository.findRowForStudentPlan(student.id, plan.id, tx);
      expect(row).not.toBeNull();
      expect(row?.id).toBe(dangling.id);
      expect(row?.lessonId).toBe(lessons[1].id);
      const [danglingAfter] = await tx.select().from(progress).where(eq(progress.id, dangling.id));
      expect(danglingAfter.id).toBe(dangling.id);
      expect(danglingAfter.lessonId).toBe(lessons[1].id);
      expect(await countProgressRows(tx, student.id)).toBe(1);
      expectOneSkipLog(domainSpy, "pointer-reanchored", sessionRow.id, student.id);
    });
  });

  test("a live row whose pointer vanished is re-anchored by update with exactly one structured log", async () => {
    await runInRollback(async tx => {
      const domainSpy = silenceDomainLog();
      const { student } = await provisionStudent(tx);
      const { lessons } = await provisionTajweedCurriculum(tx, student.id, 1);
      const { teacherId } = await provisionTeacher(tx);
      const sessionRow = await provisionTajweedSession(tx, teacherId, student.id);
      // Real lesson-less fixture — the row the plan-scoped join cannot see
      // — replaces the retired synthetic read mock.
      const seeded = await ProgressRepository.insertRow({ studentId: student.id, lessonId: null }, tx);

      await StudentProgressService.incrementForConfirmedSession(sessionRow, tx);

      const [fresh] = await tx.select().from(progress).where(eq(progress.id, seeded.id));
      expect(fresh.id).toBe(seeded.id);
      expect(fresh.lessonId).toBe(lessons[0].id);
      // The re-anchor must be a REAL UPDATE, not an indistinguishable
      // no-op: updateRowLesson stamps a fresh `new Date()` into
      // `updated_at` on every write (and the schema `$onUpdate` mirror
      // would too), so the re-anchored row's stamp must sit strictly past
      // the seeded one — the fired-write proof for this same-lessonId arm.
      expect(fresh.updatedAt.getTime()).toBeGreaterThan(seeded.updatedAt.getTime());
      expect(await countProgressRows(tx, student.id)).toBe(1);
      expectOneSkipLog(domainSpy, "pointer-reanchored", sessionRow.id, student.id);
    });
  });

  test("a pointer row left on another plan's lesson stays dormant: the governing plan's increment inserts a fresh pointer", async () => {
    await runInRollback(async tx => {
      const domainSpy = silenceDomainLog();
      const { student } = await provisionStudent(tx);
      // Two sibling tajweed curricula: the student's pointer row points
      // into the abandoned plan's lessons, while the active tajweed-lane
      // subscription — the governing lane — sits on the other plan. The
      // switch left no lesson-less row behind, so the recovery probe has
      // nothing to re-anchor.
      const { lessons: abandonedLessons } = await provisionTajweedPlanLessons(tx, 2);
      const { plan: governingPlan, lessons: governingLessons } = await provisionTajweedPlanLessons(tx, 2);
      await createTestSubscription(tx, student.id, governingPlan.id);
      const stale = await ProgressRepository.insertRow({ studentId: student.id, lessonId: abandonedLessons[0].id }, tx);
      const { teacherId } = await provisionTeacher(tx);
      const sessionRow = await provisionTajweedSession(tx, teacherId, student.id);

      await StudentProgressService.incrementForConfirmedSession(sessionRow, tx);

      // The governing plan's pointer read cannot see the stale row (its
      // lesson belongs to the abandoned plan) and the lesson-less probe
      // misses too, so the increment lazily inserts a FRESH pointer at the
      // governing plan's second lesson — no re-anchor, no skip log.
      const fresh = await ProgressRepository.findRowForStudentPlan(student.id, governingPlan.id, tx);
      expect(fresh).not.toBeNull();
      expect(fresh?.id).not.toBe(stale.id);
      expect(fresh?.lessonId).toBe(governingLessons[1].id);
      // The stale row is untouched dormancy: same id, still pointing at the
      // abandoned plan's lesson, byte-identical timestamps.
      const [staleAfter] = await tx.select().from(progress).where(eq(progress.id, stale.id));
      expect(staleAfter.id).toBe(stale.id);
      expect(staleAfter.lessonId).toBe(abandonedLessons[0].id);
      expect(staleAfter.updatedAt).toEqual(stale.updatedAt);
      expect(await countProgressRows(tx, student.id)).toBe(2);
      expect(domainSpy.mock.calls).toHaveLength(0);
    });
  });
});

describe("StudentProgressService.getStudentProgress", () => {
  test("composes the full payload for a student positioned mid-curriculum", async () => {
    await runInRollback(async tx => {
      silenceDomainLog();
      const { user, student } = await provisionStudent(tx);
      const { plan, lessons } = await provisionTajweedCurriculum(tx, student.id, 3);
      await ProgressRepository.insertRow({ studentId: student.id, lessonId: lessons[1].id }, tx);

      const payload = await StudentProgressService.getStudentProgress(user.id, UserRole.Admin, student.id, LOCALE, tx);

      expect(payload.hasProgress).toBe(true);
      expect(payload.studentId).toBe(student.id);
      expect(payload.planId).toBe(plan.id);
      expect(payload.planTitle).toBe(plan.title);
      expect(payload.totalLessons).toBe(3);
      expect(payload.currentLessonId).toBe(lessons[1].id);
      expect(payload.currentLessonTitle).toBe(lessons[1].title);
      expect(payload.currentLessonPosition).toBe(2);
      expect(payload.lessonsCompleted).toBe(1);
      expect(payload.completionPercent).toBe(33);
      expect(payload.isOnFinalLesson).toBe(false);
    });
  });

  test("completion percent is the floor of the exact ratio at every position", async () => {
    await runInRollback(async tx => {
      silenceDomainLog();
      const { user, student } = await provisionStudent(tx);
      const { lessons } = await provisionTajweedCurriculum(tx, student.id, 3);

      // Each probe seeds a NEWEST pointer row, so the plan-scoped read
      // (newest first) resolves to the probed position.
      const atFirst = await seedPointerAndRead(tx, user.id, student.id, lessons[0].id);
      expect(atFirst.currentLessonPosition).toBe(1);
      expect(atFirst.completionPercent).toBe(0);
      expect(atFirst.isOnFinalLesson).toBe(false);

      const atSecond = await seedPointerAndRead(tx, user.id, student.id, lessons[1].id);
      expect(atSecond.currentLessonPosition).toBe(2);
      expect(atSecond.lessonsCompleted).toBe(1);
      expect(atSecond.completionPercent).toBe(33);
      expect(atSecond.isOnFinalLesson).toBe(false);

      const atThird = await seedPointerAndRead(tx, user.id, student.id, lessons[2].id);
      expect(atThird.currentLessonPosition).toBe(3);
      expect(atThird.lessonsCompleted).toBe(2);
      expect(atThird.completionPercent).toBe(66);
      expect(atThird.isOnFinalLesson).toBe(true);
    });
  });

  test("a single-lesson plan reads position 1 with zero percent and the final-lesson flag", async () => {
    await runInRollback(async tx => {
      silenceDomainLog();
      const { user, student } = await provisionStudent(tx);
      const { lessons } = await provisionTajweedCurriculum(tx, student.id, 1);
      await ProgressRepository.insertRow({ studentId: student.id, lessonId: lessons[0].id }, tx);

      const payload = await StudentProgressService.getStudentProgress(user.id, UserRole.Admin, student.id, LOCALE, tx);

      expect(payload.hasProgress).toBe(true);
      expect(payload.totalLessons).toBe(1);
      expect(payload.currentLessonId).toBe(lessons[0].id);
      expect(payload.currentLessonPosition).toBe(1);
      expect(payload.lessonsCompleted).toBe(0);
      expect(payload.completionPercent).toBe(0);
      expect(payload.isOnFinalLesson).toBe(true);
    });
  });

  test("no progress row reads the honest zero shape with the plan fields populated", async () => {
    await runInRollback(async tx => {
      silenceDomainLog();
      const { user, student } = await provisionStudent(tx);
      const { plan } = await provisionTajweedCurriculum(tx, student.id, 3);

      const payload = await StudentProgressService.getStudentProgress(user.id, UserRole.Admin, student.id, LOCALE, tx);

      expect(payload.hasProgress).toBe(false);
      expect(payload.studentId).toBe(student.id);
      expect(payload.planId).toBe(plan.id);
      expect(payload.planTitle).toBe(plan.title);
      expect(payload.totalLessons).toBe(3);
      expect(payload.currentLessonId).toBeNull();
      expect(payload.currentLessonTitle).toBeNull();
      expect(payload.currentLessonPosition).toBeNull();
      expect(payload.lessonsCompleted).toBe(0);
      expect(payload.completionPercent).toBe(0);
      expect(payload.isOnFinalLesson).toBe(false);
    });
  });

  test("a lesson-less pointer row reads the recovery display: re-anchored to the first lesson, pre-completion", async () => {
    await runInRollback(async tx => {
      silenceDomainLog();
      const { user, student } = await provisionStudent(tx);
      const { plan, lessons } = await provisionTajweedCurriculum(tx, student.id, 3);
      // Real lesson-less fixture — the row exists (the student completed
      // sessions before its lesson was admin-deleted), so the read shows
      // the documented recovery honestly instead of the no-progress shape.
      await ProgressRepository.insertRow({ studentId: student.id, lessonId: null }, tx);

      const payload = await StudentProgressService.getStudentProgress(user.id, UserRole.Admin, student.id, LOCALE, tx);

      expect(payload.hasProgress).toBe(true);
      expect(payload.studentId).toBe(student.id);
      expect(payload.planId).toBe(plan.id);
      expect(payload.planTitle).toBe(plan.title);
      expect(payload.totalLessons).toBe(3);
      expect(payload.currentLessonId).toBe(lessons[0].id);
      expect(payload.currentLessonTitle).toBe(lessons[0].title);
      expect(payload.currentLessonPosition).toBe(1);
      expect(payload.lessonsCompleted).toBe(0);
      expect(payload.completionPercent).toBe(0);
      expect(payload.isOnFinalLesson).toBe(false);
    });
  });

  test("no active tajweed-lane subscription reads the zero shape with null plan fields", async () => {
    await runInRollback(async tx => {
      silenceDomainLog();
      const { user, student } = await provisionStudent(tx);

      const payload = await StudentProgressService.getStudentProgress(user.id, UserRole.Admin, student.id, LOCALE, tx);

      expect(payload.hasProgress).toBe(false);
      expect(payload.planId).toBeNull();
      expect(payload.planTitle).toBeNull();
      expect(payload.totalLessons).toBe(0);
      expect(payload.currentLessonId).toBeNull();
      expect(payload.completionPercent).toBe(0);
    });
  });

  test("a zero-lesson plan reads the zero shape with the plan fields populated", async () => {
    await runInRollback(async tx => {
      silenceDomainLog();
      const { user, student } = await provisionStudent(tx);
      const plan = await createTestPlan(tx, { balanceLane: SubscriptionCreditLane.Tajweed });
      await createTestSubscription(tx, student.id, plan.id);

      const payload = await StudentProgressService.getStudentProgress(user.id, UserRole.Admin, student.id, LOCALE, tx);

      expect(payload.hasProgress).toBe(false);
      expect(payload.planId).toBe(plan.id);
      expect(payload.planTitle).toBe(plan.title);
      expect(payload.totalLessons).toBe(0);
      expect(payload.currentLessonId).toBeNull();
      expect(payload.completionPercent).toBe(0);
    });
  });

  test("a resolved plan whose plans row is missing reads the zero shape with a null title", async () => {
    await runInRollback(async tx => {
      silenceDomainLog();
      const { user, student } = await provisionStudent(tx);
      const plan = await createTestPlan(tx, { balanceLane: SubscriptionCreditLane.Tajweed });
      await createTestSubscription(tx, student.id, plan.id);

      // Synthetic probe: the lane-scoped subscription read INNER JOINs plans,
      // so a resolved planId always has a live plans row on this snapshot and
      // the `plan?.title ?? null` repo-shape guard arm cannot fire through
      // real rows — it is driven through a findById that reports the plan
      // row as gone (the same probe idiom the re-anchor cases use for the
      // joined-pointer guard arms).
      const planReadSpy = spyOn(PlanRepository, "findById").mockResolvedValueOnce(null);

      const payload = await StudentProgressService.getStudentProgress(user.id, UserRole.Admin, student.id, LOCALE, tx);

      expect(planReadSpy).toHaveBeenCalledTimes(1);
      expect(payload.hasProgress).toBe(false);
      expect(payload.planId).toBe(plan.id);
      expect(payload.planTitle).toBeNull();
      expect(payload.totalLessons).toBe(0);
      expect(payload.lessonsCompleted).toBe(0);
      expect(payload.completionPercent).toBe(0);
    });
  });

  test("role matrix: admin any, linked teacher, student self, and the three denial shapes", async () => {
    await runInRollback(async tx => {
      const domainSpy = silenceDomainLog();
      const { user: studentUser, student } = await provisionStudent(tx);
      await provisionTajweedCurriculum(tx, student.id, 2);
      const { user: linkedTeacherUser, teacherId } = await provisionTeacher(tx);
      await createTestSession(tx, teacherId, student.id, {});
      const { user: foreignTeacherUser } = await provisionTeacher(tx);
      const { user: otherStudentUser } = await provisionStudent(tx);
      const parentUser = await createTestUser(tx, { role: "parent" });
      const admin = await createTestUser(tx, { role: "admin" });

      // Admin reads any student with no relationship.
      const adminPayload = await StudentProgressService.getStudentProgress(
        admin.id,
        UserRole.Admin,
        student.id,
        LOCALE,
        tx
      );
      expect(adminPayload.hasProgress).toBe(false);
      expect(adminPayload.totalLessons).toBe(2);

      // A teacher sharing at least one session row with the student reads.
      const teacherPayload = await StudentProgressService.getStudentProgress(
        linkedTeacherUser.id,
        UserRole.Teacher,
        student.id,
        LOCALE,
        tx
      );
      expect(teacherPayload.hasProgress).toBe(false);

      // A teacher with no shared session is denied with the constant shape.
      domainSpy.mockClear();
      await expectForbiddenError(() =>
        StudentProgressService.getStudentProgress(foreignTeacherUser.id, UserRole.Teacher, student.id, LOCALE, tx)
      );
      expect(domainSpy.mock.calls).toHaveLength(1);

      // The student reads their own progress.
      const selfPayload = await StudentProgressService.getStudentProgress(
        studentUser.id,
        UserRole.Student,
        student.id,
        LOCALE,
        tx
      );
      expect(selfPayload.hasProgress).toBe(false);

      // A foreign student id is denied — the caller id is the only identity.
      await expectForbiddenError(() =>
        StudentProgressService.getStudentProgress(otherStudentUser.id, UserRole.Student, student.id, LOCALE, tx)
      );

      // A parent has no progress read surface at all.
      await expectForbiddenError(() =>
        StudentProgressService.getStudentProgress(parentUser.id, UserRole.Parent, student.id, LOCALE, tx)
      );
    });
  });

  test("malformed student ids reject with the localized not-found copy before any role bypass", async () => {
    await runInRollback(async tx => {
      silenceDomainLog();
      const admin = await createTestUser(tx, { role: "admin" });

      await expectStudentNotFoundError(() =>
        StudentProgressService.getStudentProgress(admin.id, UserRole.Admin, 0, LOCALE, tx)
      );
      await expectStudentNotFoundError(() =>
        StudentProgressService.getStudentProgress(admin.id, UserRole.Admin, -1, LOCALE, tx)
      );
    });
  });

  test("an admin probing an unknown student id rejects with the localized not-found copy", async () => {
    await runInRollback(async tx => {
      silenceDomainLog();
      const admin = await createTestUser(tx, { role: "admin" });

      await expectStudentNotFoundError(() =>
        StudentProgressService.getStudentProgress(admin.id, UserRole.Admin, 999_999_999, LOCALE, tx)
      );
    });
  });
});

describe("StudentProgressService concurrent settlements (student-row lock)", () => {
  testOnRealPostgres(
    "two concurrent settlements of one student advance the pointer exactly two slots with no duplicate row",
    async () => {
      const { sessionA, sessionB, planId, lessonIds, studentId } = await db.transaction(async tx => {
        const { student } = await provisionStudent(tx);
        const { teacherId } = await provisionTeacher(tx);
        const { plan, lessons } = await provisionTajweedCurriculum(tx, student.id, 3);
        const settledA = await provisionTajweedSession(tx, teacherId, student.id);
        const settledB = await provisionTajweedSession(tx, teacherId, student.id);
        raceCleanup.sessionParticipantIds.push(teacherId, student.id);
        raceCleanup.userIds.push(student.id, teacherId);
        raceCleanup.planIds.push(plan.id);
        return {
          sessionA: settledA,
          sessionB: settledB,
          planId: plan.id,
          lessonIds: lessons.map(lesson => lesson.id),
          studentId: student.id,
        };
      });

      // Two separate transactions over two pool clients — the student-row
      // lock serializes them, so the second settlement observes the
      // first's committed pointer instead of duplicating the first insert.
      const [first, second] = await Promise.allSettled([
        db.transaction(async tx => {
          await StudentProgressService.incrementForConfirmedSession(sessionA, tx);
        }),
        db.transaction(async tx => {
          await StudentProgressService.incrementForConfirmedSession(sessionB, tx);
        }),
      ]);
      for (const outcome of [first, second]) {
        if (outcome.status === "rejected") {
          throw outcome.reason;
        }
      }

      const pointer = await ProgressRepository.findRowForStudentPlan(studentId, planId);
      expect(pointer).not.toBeNull();
      expect(pointer?.lessonId).toBe(lessonIds[2]);
      const committedRows = await db
        .select({ id: progress.id })
        .from(progress)
        .where(eq(progress.studentId, studentId));
      expect(committedRows).toHaveLength(1);
    }
  );
});
