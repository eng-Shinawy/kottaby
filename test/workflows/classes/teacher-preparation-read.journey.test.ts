/**
 * Journey — the teacher preparation read before a session starts
 * (cross-actor, real services).
 *
 * The preparation dialog a teacher opens on a freshly booked session row
 * issues exactly two gated reads — the student's curriculum-position
 * payload and the student's homework-history page. This journey drives
 * those two service methods across the cross-actor surface they guard,
 * against the real database:
 *
 *   1. System — the cast commits: one tajweed plan with three lessons
 *      (`id ASC`), an active tajweed-lane subscription for each of the two
 *      students, and two certified teachers (T1 owns the journey's
 *      sessions; T2 shares none).
 *   2. Student A settles one prior session through the REAL lifecycle
 *      (book → start → complete → student confirm) — the curriculum
 *      pointer advances to the second lesson, and the settled session's
 *      graded assignment exists as committed state. The pointer-advance
 *      mechanics themselves are owned by the settlement journey
 *      (tajweed-progress-increment); this suite only consumes the state it
 *      produces.
 *   3. Student B books a tajweed session with T1 — a row born `scheduled`.
 *   4. T1's preparation read for B: the honest zero — `hasProgress: false`
 *      (the first-session signal), no fabricated lesson fields, and an
 *      empty first homework page. The freshly booked row alone qualifies
 *      the shared-session gate.
 *   5. Student A books with T1; T1's preparation read for A: the positioned
 *      payload (lesson 2 of 3, 33%) plus the graded homework row — shared
 *      state visible BEFORE the session starts.
 *   6. Foreign teacher T2 reads both students: every read denies with the
 *      constant `FORBIDDEN` shape (no existence oracle — a student id
 *      beyond any identity sequence denies identically), and T1's own read
 *      is byte-identical afterwards (the denials touched nothing).
 *
 * Notification boundary: the session lifecycle's shipped waves (the
 * completion confirm-prompt) are SPIED at the dispatch boundary —
 * `NotificationEngine.publishReceipts` is a no-op for the whole suite —
 * and the fan-out is asserted from the persisted rows: the foreign
 * teacher's inbox stays empty while the participant's wave exists, and
 * after teardown ZERO notification rows remain for any cast member.
 *
 * Layer contract (`test/workflows/AGENTS.md`):
 *  - NO `runInRollback` — fixtures commit in `beforeAll` inside ONE
 *    committing transaction (commit-or-nothing); every row — fixtures AND
 *    service-created sessions/claims/pointer rows — is registered in a
 *    `TrackedFixtures` registry and hard-deleted FK-safely in `afterAll`
 *    with zero-residue re-probes.
 *  - Per-run `jrn_prep_<8hex>` prefix on every named fixture identity.
 *  - Honest authorization only: real `users.role` rows + real role-child
 *    rows via the actor-context factory; every service call carries the
 *    actor's real id and their production role conversion — never
 *    monkey-patched.
 *  - Denials are captured with `catchJourneyError` and asserted on the
 *    typed error (instance + `code` + translated copy) — never
 *    `expect(...).rejects.toThrow()`.
 *
 * Run:
 *   bun run test/scripts/run-test.ts test/workflows/classes/teacher-preparation-read.journey.test.ts
 *   bun run test/scripts/run-test.ts test/workflows
 */

import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/backend/db";
import { plans } from "@/backend/db/schema/billing/plans";
import { subscriptions } from "@/backend/db/schema/billing/subscriptions";
import { teacherTransaction } from "@/backend/db/schema/billing/teacher-transaction";
import { wallet } from "@/backend/db/schema/billing/wallet";
import { homeWork } from "@/backend/db/schema/classes/home-work";
import { lessons } from "@/backend/db/schema/classes/lessons";
import { progress } from "@/backend/db/schema/classes/progress";
import { session } from "@/backend/db/schema/classes/session";
import { sessionRequestIdempotency } from "@/backend/db/schema/classes/session-request-idempotency";
import { notifications } from "@/backend/db/schema/notifications/notifications";
import { students } from "@/backend/db/schema/students/students";
import {
  createTestHomeWork,
  createTestLesson,
  createTestPlan,
  createTestSubscription,
} from "@/backend/db/test/entity-setup";
import { SubscriptionCreditLane } from "@/backend/enum/billing/subscription-credit-lane.enum";
import { SubscriptionStatus } from "@/backend/enum/billing/subscription-status.enum";
import { SessionIntent } from "@/backend/enum/scheduling/session-intent.enum";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import { SurahJuzRef } from "@/backend/enum/shared/surah-juz-ref.enum";
import { toUserRole, UserRole } from "@/backend/enum/users/user-role.enum";
import { ForbiddenError } from "@/backend/lib/errors";
import { SessionLifecycleService } from "@/backend/services/classes/session-lifecycle.service";
import * as StudentHomeworkService from "@/backend/services/classes/student-homework.service";
import { StudentProgressService } from "@/backend/services/classes/student-progress.service";
import { NotificationEngine } from "@/backend/services/notifications";
import type {
  DBTransaction,
  LessonSelectType,
  PlanSelectType,
  SessionReturnType,
  StudentHomeworkPageReturnType,
  StudentProgressReturnType,
  SubscriptionSelectType,
} from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import { withImmutabilityTriggersSuspended } from "@/test/helpers/db-cleanup";
import {
  catchJourneyError,
  type JourneyActor,
  journeyPrefix,
  provisionCertifiedTeacherActor,
  provisionStudentActor,
  TrackedFixtures,
} from "@/test/workflows/helpers";

/** The journey runs on the default test locale throughout. */
const LOCALE = "en";

/** Per-run unique prefix embedded in every fixture identity field (rule 3). */
const RUN_PREFIX = journeyPrefix("prep");

/** English translated copy — the constant-shape denial message source. */
const ERRORS_EN = getServerTranslations("en").errorsTranslations;

/** The curriculum is a three-lesson tajweed plan. */
const TOTAL_LESSONS = 3;

/** Student id far beyond any identity sequence — the no-existence-oracle probe target. */
const ABSENT_STUDENT_ID = 999_999_999;

/**
 * The preparation dialog's own read window: the first homework page at
 * five rows — every history read in this journey issues exactly these
 * variables, the same ones the dialog sends.
 */
const PREP_HOMEWORK_PAGE = { page: 1, pageSize: 5 } as const;

/** The graded assignment of the settled session (Jadid track). */
const JADID_GRADE = 90;
const JADID_FROM = 1;
const JADID_TO = 7;
const JADID_SURAH = SurahJuzRef.SurahAlFatihah;

/** The graded assignment of the settled session (Madi track). */
const MADI_GRADE = 80;
const MADI_FROM = 1;
const MADI_TO = 5;
const MADI_SURAH = SurahJuzRef.Juz1;

/** Per-run idempotency keys — one per booked session (rule 3 prefixes). */
const KEY_A_SETTLED = `${RUN_PREFIX}-k-a-settled`;
const KEY_A_BOOKED = `${RUN_PREFIX}-k-a-booked`;
const KEY_B_BOOKED = `${RUN_PREFIX}-k-b-booked`;

/** A student cast member: real actor plus its active tajweed-lane subscription. */
interface PrepStudentMember {
  readonly actor: JourneyActor;
  readonly subscription: SubscriptionSelectType;
}

/**
 * Provisions a prepared student: real user + student row via the
 * actor-context factory, with the tajweed lane seeded to exactly
 * `tajweedUnits` bookable units (the other lanes stay empty so every
 * booking holds its fee from the intent lane), plus an ACTIVE subscription
 * on the governing plan. Every row is registered for tracked teardown.
 */
async function provisionPrepStudent(
  tx: DBTransaction,
  tajweedUnits: number,
  tracked: TrackedFixtures,
  planId: number
): Promise<PrepStudentMember> {
  const actor = await provisionStudentActor(tx, { tracked });
  await tx.update(students).set({ balanceTajweed: tajweedUnits }).where(eq(students.id, actor.userId));
  const subscription = await createTestSubscription(tx, actor.userId, planId);
  tracked.register(subscriptions, subscription.id);
  return { actor, subscription };
}

/**
 * Converts an actor's real `users.role` value through the production role
 * converter — the same identity resolution the GraphQL context factory
 * performs. Never a cast, never a monkey-patch: an unmapped role fails the
 * journey loudly instead of masquerading as a role the row does not carry.
 */
function roleOf(actor: JourneyActor): UserRole {
  const role = toUserRole(actor.role);
  if (role === null) {
    throw new Error(`journey: users row ${String(actor.userId)} carries an unmapped role "${actor.role}"`);
  }
  return role;
}

/**
 * Installs a recording-free no-op over the engine's publish boundary: no
 * realtime channel is ever touched for the whole suite, while the waves
 * themselves still commit (the persisted rows remain the fan-out oracle).
 */
function spyPublication(): { stop: () => void } {
  const spy = spyOn(NotificationEngine, "publishReceipts").mockImplementation(async () => {});
  return { stop: () => spy.mockRestore() };
}

/**
 * Books one tajweed session through the REAL lifecycle path (production
 * transaction — no outer tx) and registers the session row plus its
 * idempotency claim for the afterAll hard-delete.
 */
async function bookTajweedSession(
  studentUserId: number,
  teacherUserId: number,
  key: string,
  tracked: TrackedFixtures
): Promise<SessionReturnType> {
  const booked = await SessionLifecycleService.createSession(
    studentUserId,
    { teacherId: teacherUserId, intent: SessionIntent.Tajweed },
    key,
    LOCALE
  );
  tracked.register(session, booked.id);
  await trackIdempotencyClaim(key, tracked);
  return booked;
}

/**
 * Registers the idempotency claim a committed booking spent — the claim row
 * is a service-created side effect and must join the teardown worklist.
 */
async function trackIdempotencyClaim(key: string, tracked: TrackedFixtures): Promise<void> {
  const rows = await db
    .select({ id: sessionRequestIdempotency.id })
    .from(sessionRequestIdempotency)
    .where(eq(sessionRequestIdempotency.idempotencyKey, key));
  const claim = rows.at(0);
  if (!claim) {
    throw new Error(`journey: idempotency claim for ${key} not found (fixture tracking failure)`);
  }
  tracked.register(sessionRequestIdempotency, claim.id);
}

/**
 * The preparation read exactly as the dialog's authorized caller issues it
 * (no outer tx): the student's curriculum-position payload.
 */
function readProgressAs(
  callerUserId: number,
  callerRole: UserRole,
  studentId: number
): Promise<StudentProgressReturnType> {
  return StudentProgressService.getStudentProgress(callerUserId, callerRole, studentId, LOCALE);
}

/**
 * The second preparation read exactly as the dialog issues it: the
 * student's first homework page (five rows) for a teacher gated by the
 * shared-session relationship.
 */
function readHomeworkPageAs(teacherUserId: number, studentId: number): Promise<StudentHomeworkPageReturnType> {
  return StudentHomeworkService.listStudentHomeworkHistory(teacherUserId, studentId, PREP_HOMEWORK_PAGE, LOCALE);
}

/**
 * The denial oracle for the progress read: runs the gated read through
 * `catchJourneyError` and asserts the constant-shape contract — a
 * `ForbiddenError` carrying exactly `FORBIDDEN` and exactly the translated
 * generic copy (no existence oracle leaks through message or code).
 */
async function expectForbiddenProgressRead(
  callerUserId: number,
  callerRole: UserRole,
  studentId: number
): Promise<void> {
  const caught = await catchJourneyError(() => readProgressAs(callerUserId, callerRole, studentId));
  expect(caught).toBeInstanceOf(ForbiddenError);
  if (!(caught instanceof ForbiddenError)) {
    throw new Error("journey: expected the progress read denial to be a ForbiddenError");
  }
  expect(caught.code).toBe("FORBIDDEN");
  expect(caught.message).toBe(ERRORS_EN.forbidden);
}

/** The denial oracle for the homework-history read — the same constant shape. */
async function expectForbiddenHomeworkRead(callerUserId: number, studentId: number): Promise<void> {
  const caught = await catchJourneyError(() => readHomeworkPageAs(callerUserId, studentId));
  expect(caught).toBeInstanceOf(ForbiddenError);
  if (!(caught instanceof ForbiddenError)) {
    throw new Error("journey: expected the homework read denial to be a ForbiddenError");
  }
  expect(caught.code).toBe("FORBIDDEN");
  expect(caught.message).toBe(ERRORS_EN.forbidden);
}

/** Read-back oracle: the teacher's wallet row, or `null` before the first credit. */
async function readTeacherWalletRow(teacherUserId: number) {
  const rows = await db.select().from(wallet).where(eq(wallet.teacherId, teacherUserId)).limit(1);
  return rows.at(0) ?? null;
}

let publication: { stop: () => void } | undefined;

describe("Journey — teacher preparation read before a session (cross-actor, real services)", () => {
  /** The hard-delete worklist drained by `afterAll` (zero-residue verified). */
  const tracked = new TrackedFixtures();

  let planRow: PlanSelectType;
  let lessonRows: LessonSelectType[];

  let studentA: PrepStudentMember;
  let studentB: PrepStudentMember;

  let teacherT1: JourneyActor;
  let teacherT2: JourneyActor;

  let sessionASettled: SessionReturnType;
  let sessionABooked: SessionReturnType;
  let sessionBBooked: SessionReturnType;

  /** T1's positioned read for A, captured for the byte-identical denial re-read. */
  let progressReadA: StudentProgressReturnType;

  /** Narrows a lesson fixture by index, failing loudly when absent. */
  function lessonAt(index: number): LessonSelectType {
    const lesson = lessonRows[index];
    if (!lesson) {
      throw new Error(`journey: lesson fixture at index ${String(index)} missing (fixture integrity failure)`);
    }
    return lesson;
  }

  /**
   * ONE committing transaction — commit-or-nothing fixture provisioning.
   * The curriculum (plan + lessons in creation order ⇒ `id ASC`), the two
   * funded students each holding an active tajweed-lane subscription, and
   * the two certified teachers (T1 owns every session the journey books;
   * T2 never gains a session relationship) land together.
   */
  beforeAll(async () => {
    await db.transaction(async tx => {
      planRow = await createTestPlan(tx, {
        title: `${RUN_PREFIX} tajweed plan`,
        balanceLane: SubscriptionCreditLane.Tajweed,
      });
      tracked.register(plans, planRow.id);

      // Sequential recursion (not a loop): identity values are assigned at
      // insert time, so creation order IS the plan's `id ASC` sequence.
      const insertLessonNext = async (index: number, created: LessonSelectType[]): Promise<LessonSelectType[]> => {
        if (index >= TOTAL_LESSONS) {
          return created;
        }
        const lesson = await createTestLesson(tx, planRow.id, { title: `${RUN_PREFIX} lesson ${index + 1}` });
        tracked.register(lessons, lesson.id);
        return insertLessonNext(index + 1, [...created, lesson]);
      };
      lessonRows = await insertLessonNext(0, []);

      // Two settled sessions' worth of units for A (the settled prior one
      // consumes its unit; the booked one stays held), one for B.
      studentA = await provisionPrepStudent(tx, 2, tracked, planRow.id);
      studentB = await provisionPrepStudent(tx, 1, tracked, planRow.id);

      teacherT1 = await provisionCertifiedTeacherActor(tx, { tracked });
      teacherT2 = await provisionCertifiedTeacherActor(tx, { tracked });
    });

    // No realtime delivery for the whole suite: every publish is swallowed
    // BEFORE the first lifecycle call can emit a wave.
    publication = spyPublication();
  });

  afterAll(async () => {
    publication?.stop();

    // The earning-ledger row the confirmation created is append-only
    // (DELETE-blocked) and restrict-deletes into the wallet, which the cast
    // teardown would otherwise cascade away with the teacher rows. It is
    // removed FIRST under the sanctioned trigger suspension — only T1 ever
    // settles anything (T2 holds no wallet).
    const settlementTeacherIds = [teacherT1.userId, teacherT2.userId];
    const settlementWallets = await Promise.all(settlementTeacherIds.map(id => readTeacherWalletRow(id)));
    const settlementWalletIds = settlementWallets.filter(row => row !== null).map(row => row.id);
    if (settlementWalletIds.length > 0) {
      await withImmutabilityTriggersSuspended(["teacher_transaction"], async () => {
        await db.delete(teacherTransaction).where(inArray(teacherTransaction.walletId, settlementWalletIds));
      });
    }

    // Pointer rows created by the settlement path are registered here so
    // the reverse-order sweep removes them explicitly, before their
    // students.
    const castStudentIds = [studentA.actor.userId, studentB.actor.userId];
    const pointerRows = await db
      .select({ id: progress.id })
      .from(progress)
      .where(inArray(progress.studentId, castStudentIds));
    for (const row of pointerRows) {
      tracked.register(progress, row.id);
    }

    // Reverse-registration-order hard delete + zero-residue existence probes
    // for EVERY tracked row (a leaking teardown fails the suite loudly).
    await tracked.cleanup();

    // Re-probes beyond the registry's own checks: the service-created rows
    // that ride cascade paths are asserted gone, not assumed gone. The
    // notification count is a residue probe only — notifications cascade
    // away with the cast user delete, so zero is expected regardless of the
    // spy; the waves' capture proof lives in the pre-teardown persisted-row
    // probe (step 6's fan-out check).
    // A mid-journey step failure can leave a booking fixture un-assigned:
    // the probes below then cover only the sessions the journey actually
    // created (all three on the happy path) instead of throwing a TypeError
    // on `undefined.id` after the cleanup already ran. Every other residue
    // probe stays unconditional.
    const journeySessionIds = [sessionASettled, sessionABooked, sessionBBooked].flatMap(booked =>
      booked == null ? [] : [booked.id]
    );
    expect(await db.$count(progress, inArray(progress.studentId, castStudentIds))).toBe(0);
    if (journeySessionIds.length > 0) {
      expect(await db.$count(session, inArray(session.id, journeySessionIds))).toBe(0);
      expect(await db.$count(homeWork, inArray(homeWork.sessionId, journeySessionIds))).toBe(0);
    }
    expect(
      await db.$count(notifications, inArray(notifications.userId, [...castStudentIds, ...settlementTeacherIds]))
    ).toBe(0);
    expect(await db.$count(wallet, inArray(wallet.teacherId, settlementTeacherIds))).toBe(0);
    const survivingLedgerRows = await db
      .select({ id: teacherTransaction.id })
      .from(teacherTransaction)
      .innerJoin(wallet, eq(teacherTransaction.walletId, wallet.id))
      .where(inArray(wallet.teacherId, settlementTeacherIds));
    expect(survivingLedgerRows).toHaveLength(0);
  });

  test("step 1 — System: the cast commits (tajweed plan + 3 lessons id-ASC, active subscriptions, honest actors)", async () => {
    expect(planRow.balanceLane).toBe(SubscriptionCreditLane.Tajweed);
    expect(lessonRows).toHaveLength(TOTAL_LESSONS);
    expect(lessonRows.map(lesson => lesson.id)).toEqual(lessonRows.map(lesson => lesson.id).toSorted((a, b) => a - b));
    expect(studentA.subscription.status).toBe(SubscriptionStatus.Active);
    expect(studentB.subscription.status).toBe(SubscriptionStatus.Active);
    // Both teachers hold their real role through the production converter —
    // the certified-teacher provisioning is what the booking gate accepts.
    expect(roleOf(teacherT1)).toBe(UserRole.Teacher);
    expect(roleOf(teacherT2)).toBe(UserRole.Teacher);
    expect(tracked.size).toBeGreaterThan(0);
  });

  test("step 2 — Student A settles one prior session through the real lifecycle (book → start → complete → confirm)", async () => {
    sessionASettled = await bookTajweedSession(studentA.actor.userId, teacherT1.userId, KEY_A_SETTLED, tracked);
    expect(sessionASettled.intent).toBe(SessionIntent.Tajweed);
    expect(sessionASettled.status).toBe(SessionStatus.Scheduled);
    expect(sessionASettled.teacherId).toBe(teacherT1.userId);
    expect(sessionASettled.studentId).toBe(studentA.actor.userId);

    const started = await SessionLifecycleService.startSession(teacherT1.userId, sessionASettled.id, LOCALE);
    expect(started.status).toBe(SessionStatus.Started);
    const completed = await SessionLifecycleService.completeSession(teacherT1.userId, sessionASettled.id, LOCALE);
    expect(completed.status).toBe(SessionStatus.Completed);
    const confirmed = await SessionLifecycleService.confirmSessionCompletion(
      studentA.actor.userId,
      sessionASettled.id,
      LOCALE
    );
    expect(confirmed.status).toBe(SessionStatus.Completed);
    expect(confirmed.confirmedByStudentAt).not.toBeNull();
    sessionASettled = confirmed;

    // The settled session's assignment, graded: committed prior state the
    // preparation read will surface. (The assignment/grading flow itself is
    // the session-report domain's contract — this suite consumes the state.)
    const gradedAssignment = await db.transaction(tx =>
      createTestHomeWork(tx, sessionASettled.id, {
        currentFromAyah: JADID_FROM,
        currentToAyah: JADID_TO,
        currentSurahJuz: JADID_SURAH,
        currentGrade: JADID_GRADE,
        revisionFromAyah: MADI_FROM,
        revisionToAyah: MADI_TO,
        revisionSurahJuz: MADI_SURAH,
        revisionGrade: MADI_GRADE,
      })
    );
    tracked.register(homeWork, gradedAssignment.id);
  });

  test("step 3 — Student B books a tajweed session with T1: a row born scheduled (the request analogue)", async () => {
    sessionBBooked = await bookTajweedSession(studentB.actor.userId, teacherT1.userId, KEY_B_BOOKED, tracked);
    expect(sessionBBooked.intent).toBe(SessionIntent.Tajweed);
    expect(sessionBBooked.status).toBe(SessionStatus.Scheduled);
    expect(sessionBBooked.teacherId).toBe(teacherT1.userId);
    expect(sessionBBooked.studentId).toBe(studentB.actor.userId);
  });

  test("step 4 — T1's preparation read for B: the honest zero (first session) plus an empty homework page", async () => {
    // The freshly booked scheduled row alone qualifies the shared-session
    // gate — and the payload is the honest zero shape: no pointer row
    // exists, nothing is fabricated, the governing plan still echoes.
    const view = await readProgressAs(teacherT1.userId, roleOf(teacherT1), studentB.actor.userId);
    expect(view.hasProgress).toBe(false);
    expect(view.studentId).toBe(studentB.actor.userId);
    expect(view.planId).toBe(planRow.id);
    expect(view.planTitle).toBe(planRow.title);
    expect(view.totalLessons).toBe(TOTAL_LESSONS);
    expect(view.currentLessonId).toBeNull();
    expect(view.currentLessonTitle).toBeNull();
    expect(view.currentLessonPosition).toBeNull();
    expect(view.lessonsCompleted).toBe(0);
    expect(view.completionPercent).toBe(0);
    expect(view.isOnFinalLesson).toBe(false);

    // The homework window is the dialog's own empty first page: zero rows,
    // zero total, the effective pagination echoed honestly.
    const homeworkPage = await readHomeworkPageAs(teacherT1.userId, studentB.actor.userId);
    expect(homeworkPage.items).toHaveLength(0);
    expect(homeworkPage.totalCount).toBe(0);
    expect(homeworkPage.page).toBe(PREP_HOMEWORK_PAGE.page);
    expect(homeworkPage.pageSize).toBe(PREP_HOMEWORK_PAGE.pageSize);
  });

  test("step 5 — Student A books with T1; T1's preparation read for A: lesson 2 of 3 (33%) plus the graded homework row", async () => {
    sessionABooked = await bookTajweedSession(studentA.actor.userId, teacherT1.userId, KEY_A_BOOKED, tracked);
    expect(sessionABooked.status).toBe(SessionStatus.Scheduled);

    // The positioned payload: one settled completion put A on the SECOND
    // lesson of three — exactly what the teacher must see before starting.
    progressReadA = await readProgressAs(teacherT1.userId, roleOf(teacherT1), studentA.actor.userId);
    expect(progressReadA.hasProgress).toBe(true);
    expect(progressReadA.studentId).toBe(studentA.actor.userId);
    expect(progressReadA.planId).toBe(planRow.id);
    expect(progressReadA.planTitle).toBe(planRow.title);
    expect(progressReadA.totalLessons).toBe(TOTAL_LESSONS);
    expect(progressReadA.currentLessonId).toBe(lessonAt(1).id);
    expect(progressReadA.currentLessonTitle).toBe(lessonAt(1).title);
    expect(progressReadA.currentLessonPosition).toBe(2);
    expect(progressReadA.lessonsCompleted).toBe(1);
    expect(progressReadA.completionPercent).toBe(33);
    expect(progressReadA.isOnFinalLesson).toBe(false);

    // The prior homework row is visible cross-session WITH its grades — the
    // newest-first window's single row is the settled session's assignment.
    const homeworkPage = await readHomeworkPageAs(teacherT1.userId, studentA.actor.userId);
    expect(homeworkPage.totalCount).toBe(1);
    expect(homeworkPage.items).toHaveLength(1);
    const priorRow = homeworkPage.items[0];
    if (!priorRow) {
      throw new Error("journey: expected the graded prior homework row in the first page");
    }
    expect(priorRow.sessionId).toBe(sessionASettled.id);
    expect(priorRow.currentGrade).toBe(JADID_GRADE);
    expect(priorRow.currentFromAyah).toBe(JADID_FROM);
    expect(priorRow.currentToAyah).toBe(JADID_TO);
    expect(priorRow.currentSurahJuz).toBe(JADID_SURAH);
    expect(priorRow.revisionGrade).toBe(MADI_GRADE);
    expect(priorRow.revisionFromAyah).toBe(MADI_FROM);
    expect(priorRow.revisionToAyah).toBe(MADI_TO);
    expect(priorRow.revisionSurahJuz).toBe(MADI_SURAH);
  });

  test("step 6 — Foreign teacher T2 is denied on both reads for both students (constant FORBIDDEN, no existence oracle); T1's read is untouched", async () => {
    // T2 shares no session with either student: every preparation read
    // denies through the real relationship gate with the SAME constant
    // shape — and a student id beyond any identity sequence denies
    // identically, so no existence oracle leaks.
    await expectForbiddenProgressRead(teacherT2.userId, roleOf(teacherT2), studentA.actor.userId);
    await expectForbiddenProgressRead(teacherT2.userId, roleOf(teacherT2), studentB.actor.userId);
    await expectForbiddenProgressRead(teacherT2.userId, roleOf(teacherT2), ABSENT_STUDENT_ID);
    await expectForbiddenHomeworkRead(teacherT2.userId, studentA.actor.userId);
    await expectForbiddenHomeworkRead(teacherT2.userId, studentB.actor.userId);
    await expectForbiddenHomeworkRead(teacherT2.userId, ABSENT_STUDENT_ID);

    // The denials touched nothing: T1's own read is byte-identical to the
    // payload captured before them (the owner's row remains intact).
    expect(await readProgressAs(teacherT1.userId, roleOf(teacherT1), studentA.actor.userId)).toEqual(progressReadA);

    // Fan-out check on the persisted rows: the lifecycle's shipped wave
    // reached its participant (the confirm prompt for A's settled
    // completion committed). Every non-participant cast member observes no
    // accidental fan-out — booking emits no waves
    // (session-lifecycle.service.ts), and the confirm-prompt wave addresses
    // the settled session's participant alone.
    expect(await db.$count(notifications, eq(notifications.userId, studentA.actor.userId))).toBeGreaterThan(0);
    expect(await db.$count(notifications, eq(notifications.userId, studentB.actor.userId))).toBe(0);
    expect(await db.$count(notifications, eq(notifications.userId, teacherT1.userId))).toBe(0);
    expect(await db.$count(notifications, eq(notifications.userId, teacherT2.userId))).toBe(0);

    // Bookkeeping — every service-created row is tracked for the afterAll
    // hard-delete: three bookings with their claims, plus the graded
    // assignment row.
    const trackedSessionIds = tracked.records
      .filter(record => record.key === "session")
      .map(record => record.id)
      .toSorted((a, b) => a - b);
    const journeySessionIds = [sessionASettled, sessionABooked, sessionBBooked]
      .map(booked => booked.id)
      .toSorted((a, b) => a - b);
    expect(trackedSessionIds).toEqual(journeySessionIds);
    expect(tracked.records.filter(record => record.key === "session_request_idempotency")).toHaveLength(3);
    expect(tracked.records.filter(record => record.key === "home_work")).toHaveLength(1);
  });
});
