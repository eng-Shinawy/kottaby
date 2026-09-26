/**
 * Journey — tajweed curriculum progress pointer (cross-actor session
 * workflow).
 *
 * One tajweed plan (three lessons, `id ASC` contract), one active
 * tajweed-lane subscription per student, and the REAL dual-confirmation arc
 * (book → start → complete → student confirm, production transaction path —
 * no outer tx) drive a student's per-plan `progress` pointer through its
 * whole lifecycle, observed by every cast member through the gated read:
 *
 *   1. System — the cast commits (plan + 3 lessons id-ASC, active
 *      subscriptions, certified teachers, funded students, admin, parent)
 *      and the student books the first tajweed session.
 *   2. Teacher A starts and completes that session: the fee is still held
 *      and NO pointer row exists yet (the honest zero read for the teacher
 *      AND the student themselves — the pointer is frozen until the
 *      student's own confirmation).
 *   3. Foreign teacher B (zero shared sessions) reads the student's
 *      progress: the constant-shape `FORBIDDEN` denial, no existence oracle.
 *   4. The student confirms: the teacher wallet is credited exactly the fee
 *      AND the pointer row commits in the SAME transaction pointing at
 *      lesson 2 (lazy initialization on the first settled completion).
 *   5. Teacher A's read observes the advanced payload (position 2, 33%).
 *   6. A second full cycle advances the pointer to lesson 3 (66%).
 *   7. A third full cycle at the final lesson pins the pointer (the
 *      curriculum-complete cap: same row, same lesson, 66%).
 *   8. The student's own read is byte-identical to the teacher's read.
 *   9. The admin's read is byte-identical to the teacher's read.
 *  10. A parent caller and the foreign teacher are both denied with the
 *      constant `FORBIDDEN` shape. The parent denial is proven here at the
 *      service layer (the role gate's default arm — the parent's honest
 *      surface is the monitoring portal); the scope-layer 403 for a parent
 *      hitting the GraphQL query is wire-level evidence owned by the
 *      GraphQL surface suite, which owns the `studentProgress` field.
 *
 * Concurrency legs (the pointer's serialization guarantees, exercised on
 * the real database through `Promise.allSettled`):
 *  - leg A — one session confirmed twice CONCURRENTLY: exactly ONE pointer
 *    advance (the loser lands in the idempotent settled arm, zero writes,
 *    no throw) and exactly one earning ledger row.
 *  - leg B — two DIFFERENT sessions (different teachers) of one student
 *    settling CONCURRENTLY: the pointer advances exactly TWO slots total
 *    and exactly ONE pointer row exists (no duplicate first insert).
 *
 * The tajweed progress-increment hook is composed into the settled
 * confirmation arm, so every leg below — pointer advances and pins,
 * denials, read shapes, and both concurrency races — asserts live
 * behavior against the shipped service surface.
 *
 * Layer contract (`test/workflows/AGENTS.md`):
 *  - NO `runInRollback` — fixtures commit in `beforeAll` inside ONE
 *    committing transaction (commit-or-nothing); every row — fixtures AND
 *    service-created sessions/claims/pointer rows — is registered in a
 *    `TrackedFixtures` registry and hard-deleted FK-safely in `afterAll`
 *    with zero-residue re-probes.
 *  - Per-run `jrn_prog_<8hex>` prefix on every named fixture (rule 3).
 *  - Honest authorization only: real `users.role` rows + real role-child
 *    rows; every service call carries the actor's real id and their
 *    production role conversion — never monkey-patched.
 *  - The notification publication boundary is SPIED: the session-lifecycle
 *    path publishes through the static notification engine (it takes no
 *    injected transport), so the hermetic seam is a recording no-op over
 *    `NotificationEngine.publishReceipts`, installed once in `beforeAll`
 *    and restored in `afterAll` — mirroring the sibling session journeys.
 *    Per this suite's scope, nothing about notification content or
 *    recipients is asserted.
 *  - Denials are captured with `catchJourneyError` and asserted on the
 *    typed error (instance + `code` + translated copy) — never
 *    `expect(...).rejects.toThrow()`.
 *
 * Run:
 *   bun run test/scripts/run-test.ts test/workflows/classes/tajweed-progress-increment.test.ts
 *   bun run test/scripts/run-test.ts test/workflows
 */

import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/backend/db";
import { plans } from "@/backend/db/schema/billing/plans";
import { subscriptions } from "@/backend/db/schema/billing/subscriptions";
import { teacherTransaction } from "@/backend/db/schema/billing/teacher-transaction";
import { wallet } from "@/backend/db/schema/billing/wallet";
import { lessons } from "@/backend/db/schema/classes/lessons";
import { progress } from "@/backend/db/schema/classes/progress";
import { session } from "@/backend/db/schema/classes/session";
import { sessionRequestIdempotency } from "@/backend/db/schema/classes/session-request-idempotency";
import { notifications } from "@/backend/db/schema/notifications/notifications";
import { parents } from "@/backend/db/schema/parents/parents";
import { students } from "@/backend/db/schema/students/students";
import { teacher } from "@/backend/db/schema/teachers/teacher";
import { admin } from "@/backend/db/schema/users/admin";
import { users } from "@/backend/db/schema/users/users";
import {
  createTestAdmin,
  createTestLesson,
  createTestParent,
  createTestPlan,
  createTestStudent,
  createTestSubscription,
  createTestTeacherRow,
  createTestUser,
} from "@/backend/db/test/entity-setup";
import { SubscriptionCreditLane } from "@/backend/enum/billing/subscription-credit-lane.enum";
import { SubscriptionStatus } from "@/backend/enum/billing/subscription-status.enum";
import { HeldBalanceLane } from "@/backend/enum/scheduling/held-balance-lane.enum";
import { SessionIntent } from "@/backend/enum/scheduling/session-intent.enum";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import { toUserRole, UserRole } from "@/backend/enum/users/user-role.enum";
import { ForbiddenError } from "@/backend/lib/errors";
import { SessionLifecycleService } from "@/backend/services/classes/session-lifecycle.service";
import { StudentProgressService } from "@/backend/services/classes/student-progress.service";
import { NotificationEngine } from "@/backend/services/notifications";
import type {
  DBTransaction,
  LessonSelectType,
  PlanSelectType,
  ProgressSelectType,
  SessionReturnType,
  StudentProgressReturnType,
  StudentSelectType,
  SubscriptionSelectType,
  TeacherSelectType,
  UserSelectType,
  WalletSelectType,
} from "@/backend/types";
import { SESSION_FEE_TAJWEED } from "@/shared/constants/session-fees.constants";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import { withImmutabilityTriggersSuspended } from "@/test/helpers/db-cleanup";
import { catchJourneyError, journeyPrefix, TrackedFixtures } from "@/test/workflows/helpers";

/** The journey runs on the default test locale throughout. */
const LOCALE = "en";

/** Per-run unique prefix embedded in every fixture identity field (rule 3). */
const RUN_PREFIX = journeyPrefix("prog");

/** English translated copy — the constant-shape denial message source. */
const ERRORS_EN = getServerTranslations("en").errorsTranslations;

/** The curriculum is a three-lesson tajweed plan (two advances then the cap). */
const TOTAL_LESSONS = 3;

/** Per-run idempotency keys — one per booked session (rule 3 prefixes). */
const KEY_S1 = `${RUN_PREFIX}-k-s1`;
const KEY_S2 = `${RUN_PREFIX}-k-s2`;
const KEY_S3 = `${RUN_PREFIX}-k-s3`;
const KEY_S4 = `${RUN_PREFIX}-k-s4`;
const KEY_S5 = `${RUN_PREFIX}-k-s5`;
const KEY_S6 = `${RUN_PREFIX}-k-s6`;

/** A student cast member: real user + role-child row + its own subscription. */
interface ProgressStudentMember {
  readonly user: UserSelectType;
  readonly student: StudentSelectType;
  readonly subscription: SubscriptionSelectType;
}

/** A teacher cast member: real user + approved `teacher` role-child row. */
interface ProgressTeacherMember {
  readonly user: UserSelectType;
  readonly teacher: TeacherSelectType;
}

/**
 * Provisions a funded progress student: real user + student row whose
 * tajweed lane carries exactly `tajweedUnits` bookable units (the trial
 * lane stays empty so every booking holds its fee from the tajweed lane —
 * the intent lane, not the trial fallback), plus an ACTIVE subscription on
 * the governing plan. Every row is registered for tracked teardown.
 */
async function provisionProgressStudent(
  tx: DBTransaction,
  label: string,
  tajweedUnits: number,
  tracked: TrackedFixtures,
  planId: number
): Promise<ProgressStudentMember> {
  const user = await createTestUser(tx, { role: "student", fullName: `${RUN_PREFIX} ${label}` });
  const student = await createTestStudent(tx, user.id, {
    balanceTrial: 0,
    balanceHifz: 0,
    balanceTajweed: tajweedUnits,
  });
  tracked.register(users, user.id);
  tracked.register(students, student.id);
  const subscription = await createTestSubscription(tx, user.id, planId);
  tracked.register(subscriptions, subscription.id);
  return { user, student, subscription };
}

/**
 * Provisions a certified teacher: real teacher-role user + an approved
 * `teacher` row — the only teacher shape the booking certification lock
 * accepts. Every row is registered for tracked teardown.
 */
async function provisionCertifiedTeacher(
  tx: DBTransaction,
  label: string,
  tracked: TrackedFixtures
): Promise<ProgressTeacherMember> {
  const user = await createTestUser(tx, { role: "teacher", fullName: `${RUN_PREFIX} ${label}` });
  const teacherRow = await createTestTeacherRow(tx, user.id, { isApproved: true });
  tracked.register(users, user.id);
  tracked.register(teacher, teacherRow.id);
  return { user, teacher: teacherRow };
}

/**
 * Installs a recording no-op over the engine's publish boundary: no
 * realtime channel is ever touched for the whole suite. The spy exists for
 * hermeticity only — this journey's scope ends at the pointer, so nothing
 * about dispatch counts, recipients, or payload content is asserted.
 */
function spyPublication(): { stop: () => void } {
  const spy = spyOn(NotificationEngine, "publishReceipts").mockImplementation(async () => {});
  return { stop: () => spy.mockRestore() };
}

/** Numeric wallet total (a missing wallet counts as zero). */
function walletTotal(value: WalletSelectType | null): number {
  return Number(value?.totalEarning ?? "0");
}

/** Numeric wallet balance (a missing wallet counts as zero). */
function walletBalance(value: WalletSelectType | null): number {
  return Number(value?.balance ?? "0");
}

/** Reads the teacher's wallet row, or `null` before the first credit. */
async function readTeacherWalletRow(teacherUserId: number): Promise<WalletSelectType | null> {
  const rows = await db.select().from(wallet).where(eq(wallet.teacherId, teacherUserId)).limit(1);
  return rows.at(0) ?? null;
}

/** Narrows a nullable wallet read to a row, failing loudly when null. */
function requiredWalletRow(value: WalletSelectType | null, label: string): WalletSelectType {
  if (value === null) {
    throw new Error(`journey: expected a wallet row for ${label}`);
  }
  return value;
}

/** Scoped pointer-row count for one fixture student (shared-DB-safe). */
function countProgressRowsFor(studentId: number): Promise<number> {
  return db.$count(progress, eq(progress.studentId, studentId));
}

/** Direct read-back oracle: the student's single pointer row, or null. */
async function readProgressRowFor(studentId: number): Promise<ProgressSelectType | null> {
  const rows = await db.select().from(progress).where(eq(progress.studentId, studentId));
  return rows.at(0) ?? null;
}

/** Earning-ledger rows tied to one session (the exactly-once credit oracle). */
function countLedgerRowsForSession(sessionId: number): Promise<number> {
  return db.$count(teacherTransaction, eq(teacherTransaction.sessionId, sessionId));
}

/**
 * Registers the idempotency claim a committed booking spent — the claim row
 * is a service-created side effect and must join the teardown worklist.
 */
async function trackIdempotencyClaim(key: string, label: string, tracked: TrackedFixtures): Promise<void> {
  const rows = await db
    .select({ id: sessionRequestIdempotency.id })
    .from(sessionRequestIdempotency)
    .where(eq(sessionRequestIdempotency.idempotencyKey, key));
  const claim = rows.at(0);
  if (!claim) {
    throw new Error(`journey: idempotency claim for ${label} not found (fixture tracking failure)`);
  }
  tracked.register(sessionRequestIdempotency, claim.id);
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
  await trackIdempotencyClaim(key, key, tracked);
  return booked;
}

/** Drives one booked session through the teacher's half of the arc. */
async function driveToCompleted(sessionId: number, teacherUserId: number): Promise<void> {
  const started = await SessionLifecycleService.startSession(teacherUserId, sessionId, LOCALE);
  expect(started.status).toBe(SessionStatus.Started);
  expect(started.feeHeld).toBe(true);
  const completed = await SessionLifecycleService.completeSession(teacherUserId, sessionId, LOCALE);
  expect(completed.status).toBe(SessionStatus.Completed);
  expect(completed.confirmedByStudentAt).toBeNull();
}

/** The gated read exactly as an authorized caller issues it (no outer tx). */
function readProgressAs(
  callerUserId: number,
  callerRole: UserRole,
  studentId: number
): Promise<StudentProgressReturnType> {
  return StudentProgressService.getStudentProgress(callerUserId, callerRole, studentId, LOCALE);
}

/**
 * The denial oracle: runs the gated read through `catchJourneyError` and
 * asserts the constant-shape contract — a `ForbiddenError` carrying exactly
 * `FORBIDDEN` and exactly the translated generic copy (no existence oracle
 * leaks through message or code).
 */
async function expectForbiddenRead(callerUserId: number, callerRole: UserRole, studentId: number): Promise<void> {
  const caught = await catchJourneyError(() => readProgressAs(callerUserId, callerRole, studentId));
  expect(caught).toBeInstanceOf(ForbiddenError);
  if (!(caught instanceof ForbiddenError)) {
    throw new Error("journey: expected the progress read denial to be a ForbiddenError");
  }
  expect(caught.code).toBe("FORBIDDEN");
  expect(caught.message).toBe(ERRORS_EN.forbidden);
}

/** Reads one session row straight off the table (read-back oracle). */
async function readSessionRow(id: number): Promise<SessionReturnType> {
  const rows = await db.select().from(session).where(eq(session.id, id)).limit(1);
  const row = rows.at(0);
  if (!row) {
    throw new Error(`journey: session row ${String(id)} vanished (fixture integrity failure)`);
  }
  return row;
}

/**
 * Converts an actor's real `users.role` value through the production role
 * converter — the same identity resolution the GraphQL context factory
 * performs. Never a cast, never a monkey-patch: an unmapped role fails the
 * journey loudly instead of masquerading as a role the row does not carry.
 */
function roleOf(user: UserSelectType): UserRole {
  const role = toUserRole(user.role);
  if (role === null) {
    throw new Error(`journey: users row ${String(user.id)} carries an unmapped role "${user.role}"`);
  }
  return role;
}

describe("Journey — tajweed curriculum progress pointer (cross-actor, real services)", () => {
  /** The hard-delete worklist drained by `afterAll` (zero-residue verified). */
  const tracked = new TrackedFixtures();

  let publication: ReturnType<typeof spyPublication> | undefined;

  let planRow: PlanSelectType;
  let lessonRows: LessonSelectType[];

  let mainStudent: ProgressStudentMember;
  let doubleConfirmStudent: ProgressStudentMember;
  let raceStudent: ProgressStudentMember;

  let teacherA: ProgressTeacherMember;
  let teacherB: ProgressTeacherMember;
  let teacherC: ProgressTeacherMember;

  let adminUser: UserSelectType;
  let parentUser: UserSelectType;

  let sessionS1: SessionReturnType;
  let sessionS2: SessionReturnType;
  let sessionS3: SessionReturnType;
  let sessionS4: SessionReturnType;
  let sessionS5: SessionReturnType;
  let sessionS6: SessionReturnType;

  /**
   * ONE committing transaction — commit-or-nothing fixture provisioning.
   * The curriculum (plan + lessons in creation order ⇒ `id ASC`), the three
   * funded students each holding an active tajweed-lane subscription, the
   * three certified teachers (T-A owns the journey's sessions, T-C hosts
   * the second race leg, T-B never gains a session relationship), and the
   * admin + parent observers land together.
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

      mainStudent = await provisionProgressStudent(tx, "student-main", 3, tracked, planRow.id);
      doubleConfirmStudent = await provisionProgressStudent(tx, "student-double-confirm", 1, tracked, planRow.id);
      raceStudent = await provisionProgressStudent(tx, "student-race", 2, tracked, planRow.id);

      teacherA = await provisionCertifiedTeacher(tx, "teacher-A", tracked);
      teacherB = await provisionCertifiedTeacher(tx, "teacher-B-foreign", tracked);
      teacherC = await provisionCertifiedTeacher(tx, "teacher-C", tracked);

      adminUser = await createTestUser(tx, { role: "admin", fullName: `${RUN_PREFIX} admin` });
      const adminRow = await createTestAdmin(tx, adminUser.id);
      tracked.register(users, adminUser.id);
      tracked.register(admin, adminRow.id);

      parentUser = await createTestUser(tx, { role: "parent", fullName: `${RUN_PREFIX} parent` });
      const parentRow = await createTestParent(tx, parentUser.id);
      tracked.register(users, parentUser.id);
      tracked.register(parents, parentRow.id);
    });

    // No realtime delivery for the whole suite: every publish is swallowed.
    publication = spyPublication();
  });

  afterAll(async () => {
    publication?.stop();

    // The earning-ledger rows the confirmations created are append-only
    // (DELETE-blocked) and restrict-delete into the wallets, which the cast
    // teardown would otherwise cascade away with the teacher rows. They are
    // removed FIRST under the sanctioned trigger suspension, for both
    // settlement teachers (T-A and T-C; T-B never settles anything).
    const settlementTeacherIds = [teacherA.user.id, teacherC.user.id];
    const settlementWallets = await Promise.all(settlementTeacherIds.map(id => readTeacherWalletRow(id)));
    const settlementWalletIds = settlementWallets
      .filter((row): row is WalletSelectType => row !== null)
      .map(row => row.id);
    if (settlementWalletIds.length > 0) {
      await withImmutabilityTriggersSuspended(["teacher_transaction"], async () => {
        await db.delete(teacherTransaction).where(inArray(teacherTransaction.walletId, settlementWalletIds));
      });
    }

    // Pointer rows created by the settlement path are registered here so
    // the reverse-order sweep removes them explicitly, before their
    // students.
    const pointerRowsPerStudent = await Promise.all(
      [mainStudent.user.id, doubleConfirmStudent.user.id, raceStudent.user.id].map(studentId =>
        db.select({ id: progress.id }).from(progress).where(eq(progress.studentId, studentId))
      )
    );
    for (const rows of pointerRowsPerStudent) {
      for (const row of rows) {
        tracked.register(progress, row.id);
      }
    }

    // Reverse-registration-order hard delete + zero-residue existence probes
    // for EVERY tracked row (a leaking teardown fails the suite loudly).
    await tracked.cleanup();

    // Re-probes beyond the registry's own checks: the service-created rows
    // that ride cascade paths are asserted gone, not assumed gone.
    const studentUserIds = [mainStudent.user.id, doubleConfirmStudent.user.id, raceStudent.user.id];
    const journeySessionIds = [sessionS1, sessionS2, sessionS3, sessionS4, sessionS5, sessionS6].map(
      booked => booked.id
    );
    expect(await db.$count(progress, inArray(progress.studentId, studentUserIds))).toBe(0);
    expect(await db.$count(session, inArray(session.id, journeySessionIds))).toBe(0);
    expect(await db.$count(wallet, inArray(wallet.teacherId, settlementTeacherIds))).toBe(0);
    expect(await db.$count(notifications, inArray(notifications.userId, studentUserIds))).toBe(0);
    const survivingLedgerRows = await db
      .select({ id: teacherTransaction.id })
      .from(teacherTransaction)
      .innerJoin(wallet, eq(teacherTransaction.walletId, wallet.id))
      .where(inArray(wallet.teacherId, settlementTeacherIds));
    expect(survivingLedgerRows).toHaveLength(0);
  });

  /** Narrows a lesson fixture by index, failing loudly when absent. */
  function lessonAt(index: number): LessonSelectType {
    const lesson = lessonRows[index];
    if (!lesson) {
      throw new Error(`journey: lesson fixture at index ${String(index)} missing (fixture integrity failure)`);
    }
    return lesson;
  }

  test("step 1 — System: the cast commits (tajweed plan + 3 lessons id-ASC, active subscriptions, honest actors) and the student books the first tajweed session", async () => {
    expect(planRow.balanceLane).toBe(SubscriptionCreditLane.Tajweed);
    expect(lessonRows).toHaveLength(TOTAL_LESSONS);
    expect(lessonRows.map(lesson => lesson.id)).toEqual(lessonRows.map(lesson => lesson.id).toSorted((a, b) => a - b));
    expect(mainStudent.subscription.status).toBe(SubscriptionStatus.Active);
    expect(doubleConfirmStudent.subscription.status).toBe(SubscriptionStatus.Active);
    expect(raceStudent.subscription.status).toBe(SubscriptionStatus.Active);
    for (const castTeacher of [teacherA, teacherB, teacherC]) {
      expect(castTeacher.teacher.isApproved).toBe(true);
    }
    expect(adminUser.role).toBe(UserRole.Admin);
    expect(parentUser.role).toBe(UserRole.Parent);

    sessionS1 = await bookTajweedSession(mainStudent.user.id, teacherA.user.id, KEY_S1, tracked);
    expect(sessionS1.intent).toBe(SessionIntent.Tajweed);
    expect(sessionS1.status).toBe(SessionStatus.Scheduled);
    expect(sessionS1.teacherId).toBe(teacherA.user.id);
    expect(sessionS1.studentId).toBe(mainStudent.user.id);
    expect(sessionS1.fee).toBe(SESSION_FEE_TAJWEED);
    expect(sessionS1.feeHeld).toBe(true);
    expect(sessionS1.heldBalanceLane).toBe(HeldBalanceLane.Tajweed);
  });

  test("step 2 — Teacher A starts and completes session S1: the fee is still held and NO pointer row exists yet (honest zero read for teacher and student)", async () => {
    await driveToCompleted(sessionS1.id, teacherA.user.id);
    const completedRow = await readSessionRow(sessionS1.id);
    expect(completedRow.status).toBe(SessionStatus.Completed);
    expect(completedRow.feeHeld).toBe(true);
    expect(completedRow.confirmedByStudentAt).toBeNull();

    // The teacher shares the session with the student, so the relationship
    // gate passes — and the payload is the honest zero shape: no pointer
    // row exists, nothing is fabricated, the governing plan still echoes.
    const teacherView = await readProgressAs(teacherA.user.id, roleOf(teacherA.user), mainStudent.user.id);
    expect(teacherView.hasProgress).toBe(false);
    expect(teacherView.studentId).toBe(mainStudent.user.id);
    expect(teacherView.planId).toBe(planRow.id);
    expect(teacherView.planTitle).toBe(planRow.title);
    expect(teacherView.totalLessons).toBe(TOTAL_LESSONS);
    expect(teacherView.currentLessonId).toBeNull();
    expect(teacherView.currentLessonTitle).toBeNull();
    expect(teacherView.currentLessonPosition).toBeNull();
    expect(teacherView.lessonsCompleted).toBe(0);
    expect(teacherView.completionPercent).toBe(0);

    // The student's own view agrees byte-for-byte: the pointer is frozen
    // until THEIR confirmation — the teacher's completion moves nothing.
    const studentView = await readProgressAs(mainStudent.user.id, roleOf(mainStudent.user), mainStudent.user.id);
    expect(studentView).toEqual(teacherView);

    expect(await countProgressRowsFor(mainStudent.user.id)).toBe(0);
  });

  test("step 3 — Foreign teacher B (zero shared sessions) reads the student's progress: constant-shape FORBIDDEN denial", async () => {
    await expectForbiddenRead(teacherB.user.id, roleOf(teacherB.user), mainStudent.user.id);
    // The denial precedes any existence probe: a foreign teacher cannot
    // distinguish a missing student from one they may not see — the denial
    // shape is the same constant for any target id.
    await expectForbiddenRead(teacherB.user.id, roleOf(teacherB.user), 999_999_999);
  });

  test("step 4 — Student confirms S1: teacher wallet credited exactly the fee AND the pointer row commits in the SAME transaction pointing at lesson 2", async () => {
    const walletBefore = await readTeacherWalletRow(teacherA.user.id);

    const confirmed = await SessionLifecycleService.confirmSessionCompletion(mainStudent.user.id, sessionS1.id, LOCALE);
    expect(confirmed.status).toBe(SessionStatus.Completed);
    expect(confirmed.feeHeld).toBe(false);
    expect(confirmed.confirmedByStudentAt).not.toBeNull();
    expect(confirmed.confirmedByTeacherAt).not.toBeNull();
    sessionS1 = confirmed;

    // The escrow release and the credit are one committed unit.
    const walletAfter = requiredWalletRow(
      await readTeacherWalletRow(teacherA.user.id),
      "teacher A after the first confirmation"
    );
    expect(walletTotal(walletAfter) - walletTotal(walletBefore)).toBe(Number(SESSION_FEE_TAJWEED));
    expect(walletBalance(walletAfter) - walletBalance(walletBefore)).toBe(Number(SESSION_FEE_TAJWEED));
    expect(await countLedgerRowsForSession(sessionS1.id)).toBe(1);

    // The pointer row rides the SAME commit: lazily inserted on the first
    // settled completion, pointing at the SECOND lesson (the student is on
    // it, one slot ahead of the one just completed).
    expect(await countProgressRowsFor(mainStudent.user.id)).toBe(1);
    const pointerRow = await readProgressRowFor(mainStudent.user.id);
    expect(pointerRow).not.toBeNull();
    if (pointerRow === null) {
      throw new Error("journey: pointer row vanished between the count and the read-back");
    }
    expect(pointerRow.studentId).toBe(mainStudent.user.id);
    expect(pointerRow.lessonId).toBe(lessonAt(1).id);
  });

  test("step 5 — Teacher A reads the student's progress: the advanced payload (position 2, one lesson completed, 33%)", async () => {
    const view = await readProgressAs(teacherA.user.id, roleOf(teacherA.user), mainStudent.user.id);
    expect(view.hasProgress).toBe(true);
    expect(view.studentId).toBe(mainStudent.user.id);
    expect(view.planId).toBe(planRow.id);
    expect(view.planTitle).toBe(planRow.title);
    expect(view.totalLessons).toBe(TOTAL_LESSONS);
    expect(view.currentLessonId).toBe(lessonAt(1).id);
    expect(view.currentLessonTitle).toBe(lessonAt(1).title);
    expect(view.currentLessonPosition).toBe(2);
    expect(view.lessonsCompleted).toBe(1);
    expect(view.completionPercent).toBe(33);
    expect(view.isOnFinalLesson).toBe(false);
  });

  test("step 6 — Second full cycle (book → start → complete → confirm): the pointer advances to lesson 3 (66%)", async () => {
    sessionS2 = await bookTajweedSession(mainStudent.user.id, teacherA.user.id, KEY_S2, tracked);
    expect(sessionS2.intent).toBe(SessionIntent.Tajweed);
    await driveToCompleted(sessionS2.id, teacherA.user.id);

    const confirmed = await SessionLifecycleService.confirmSessionCompletion(mainStudent.user.id, sessionS2.id, LOCALE);
    expect(confirmed.feeHeld).toBe(false);
    sessionS2 = confirmed;

    const view = await readProgressAs(teacherA.user.id, roleOf(teacherA.user), mainStudent.user.id);
    expect(view.hasProgress).toBe(true);
    expect(view.currentLessonId).toBe(lessonAt(2).id);
    expect(view.currentLessonPosition).toBe(3);
    expect(view.lessonsCompleted).toBe(2);
    expect(view.completionPercent).toBe(66);
    expect(view.isOnFinalLesson).toBe(true);
    expect(await countProgressRowsFor(mainStudent.user.id)).toBe(1);
  });

  test("step 7 — Third full cycle at the final lesson: the pointer STAYS pinned at lesson 3 (curriculum-complete cap)", async () => {
    sessionS3 = await bookTajweedSession(mainStudent.user.id, teacherA.user.id, KEY_S3, tracked);
    // Captured before the third confirmation — booking itself writes no
    // pointer rows, so this is the pre-cycle pin state either way.
    const pointerBefore = await readProgressRowFor(mainStudent.user.id);
    expect(pointerBefore).not.toBeNull();

    await driveToCompleted(sessionS3.id, teacherA.user.id);

    const confirmed = await SessionLifecycleService.confirmSessionCompletion(mainStudent.user.id, sessionS3.id, LOCALE);
    expect(confirmed.feeHeld).toBe(false);
    sessionS3 = confirmed;

    // The settled completion of a finished curriculum moves nothing: the
    // read stays pinned at the final lesson, the completion count and the
    // percentage stop at (N-1)/N, and no new pointer row appeared.
    const view = await readProgressAs(teacherA.user.id, roleOf(teacherA.user), mainStudent.user.id);
    expect(view.hasProgress).toBe(true);
    expect(view.currentLessonId).toBe(lessonAt(2).id);
    expect(view.currentLessonPosition).toBe(3);
    expect(view.lessonsCompleted).toBe(2);
    expect(view.completionPercent).toBe(66);
    expect(view.isOnFinalLesson).toBe(true);
    expect(await countProgressRowsFor(mainStudent.user.id)).toBe(1);

    const pointerAfter = await readProgressRowFor(mainStudent.user.id);
    expect(pointerAfter).not.toBeNull();
    if (pointerBefore !== null && pointerAfter !== null) {
      expect(pointerAfter.id).toBe(pointerBefore.id);
      expect(pointerAfter.lessonId).toBe(pointerBefore.lessonId);
      // The cap writes nothing, not even a timestamp touch — the same row
      // proof the service-suite cap assertion makes.
      expect(pointerAfter.updatedAt).toEqual(pointerBefore.updatedAt);
    }
  });

  test("step 8 — The student reads their own progress: byte-identical payload to the teacher's read", async () => {
    const teacherView = await readProgressAs(teacherA.user.id, roleOf(teacherA.user), mainStudent.user.id);
    const studentView = await readProgressAs(mainStudent.user.id, roleOf(mainStudent.user), mainStudent.user.id);
    expect(studentView).toEqual(teacherView);
  });

  test("step 9 — The admin reads the student's progress: byte-identical payload to the teacher's read", async () => {
    const teacherView = await readProgressAs(teacherA.user.id, roleOf(teacherA.user), mainStudent.user.id);
    const adminView = await readProgressAs(adminUser.id, roleOf(adminUser), mainStudent.user.id);
    expect(adminView).toEqual(teacherView);
  });

  test("step 10 — Parent caller (service-level role probe) and the foreign teacher re-probe: constant FORBIDDEN denials", async () => {
    // The parent holds a real parent role, so the denial flows through the
    // role gate's default arm — the same authorization path production
    // uses. The GraphQL scope-layer 403 for a parent calling the query is
    // wire-level evidence owned by the GraphQL surface suite.
    await expectForbiddenRead(parentUser.id, roleOf(parentUser), mainStudent.user.id);

    // The foreign teacher NEVER gained a session relationship (the race leg
    // is hosted by T-C, not T-B), so the denial is still the honest one.
    await expectForbiddenRead(teacherB.user.id, roleOf(teacherB.user), mainStudent.user.id);
  });

  test("concurrency leg A — one session confirmed twice CONCURRENTLY: exactly ONE pointer advance, the loser lands in the settled arm", async () => {
    sessionS4 = await bookTajweedSession(doubleConfirmStudent.user.id, teacherA.user.id, KEY_S4, tracked);
    await driveToCompleted(sessionS4.id, teacherA.user.id);

    // Both calls ride the production path on their own transactions: the
    // winner takes the exactly-once arm, the loser's guarded statement
    // matches zero rows and resolves through the idempotent settled arm —
    // neither throws.
    const outcomes = await Promise.allSettled([
      SessionLifecycleService.confirmSessionCompletion(doubleConfirmStudent.user.id, sessionS4.id, LOCALE),
      SessionLifecycleService.confirmSessionCompletion(doubleConfirmStudent.user.id, sessionS4.id, LOCALE),
    ]);
    expect(outcomes.map(outcome => outcome.status)).toEqual(["fulfilled", "fulfilled"]);

    // Financial exactly-once holds under the race: one ledger row.
    expect(await countLedgerRowsForSession(sessionS4.id)).toBe(1);

    // Exactly ONE pointer advance: the row exists, points at lesson 2, and
    // is the ONLY pointer row for this student.
    expect(await countProgressRowsFor(doubleConfirmStudent.user.id)).toBe(1);
    const pointerRow = await readProgressRowFor(doubleConfirmStudent.user.id);
    expect(pointerRow).not.toBeNull();
    if (pointerRow === null) {
      throw new Error("journey: pointer row vanished between the count and the read-back");
    }
    expect(pointerRow.lessonId).toBe(lessonAt(1).id);

    const view = await readProgressAs(teacherA.user.id, roleOf(teacherA.user), doubleConfirmStudent.user.id);
    expect(view.hasProgress).toBe(true);
    expect(view.currentLessonId).toBe(lessonAt(1).id);
    expect(view.currentLessonPosition).toBe(2);
    expect(view.lessonsCompleted).toBe(1);
    expect(view.completionPercent).toBe(33);
  });

  test("concurrency leg B — two sessions by two teachers settle CONCURRENTLY for one student: exactly TWO advances, exactly ONE pointer row", async () => {
    sessionS5 = await bookTajweedSession(raceStudent.user.id, teacherA.user.id, KEY_S5, tracked);
    sessionS6 = await bookTajweedSession(raceStudent.user.id, teacherC.user.id, KEY_S6, tracked);
    await driveToCompleted(sessionS5.id, teacherA.user.id);
    await driveToCompleted(sessionS6.id, teacherC.user.id);

    // Both settlements dispatch concurrently for the same student: the
    // per-student serializer makes the second increment observe the
    // first's committed pointer, so the pointer moves exactly two slots
    // (lesson 2, then lesson 3) and no duplicate row can be inserted.
    const outcomes = await Promise.allSettled([
      SessionLifecycleService.confirmSessionCompletion(raceStudent.user.id, sessionS5.id, LOCALE),
      SessionLifecycleService.confirmSessionCompletion(raceStudent.user.id, sessionS6.id, LOCALE),
    ]);
    expect(outcomes.map(outcome => outcome.status)).toEqual(["fulfilled", "fulfilled"]);

    // Each settlement credited its own teacher exactly once.
    expect(await countLedgerRowsForSession(sessionS5.id)).toBe(1);
    expect(await countLedgerRowsForSession(sessionS6.id)).toBe(1);

    // Two advances, one row: the pointer sits at the FINAL lesson.
    expect(await countProgressRowsFor(raceStudent.user.id)).toBe(1);
    const pointerRow = await readProgressRowFor(raceStudent.user.id);
    expect(pointerRow).not.toBeNull();
    if (pointerRow === null) {
      throw new Error("journey: pointer row vanished between the count and the read-back");
    }
    expect(pointerRow.lessonId).toBe(lessonAt(2).id);

    const view = await readProgressAs(teacherA.user.id, roleOf(teacherA.user), raceStudent.user.id);
    expect(view.hasProgress).toBe(true);
    expect(view.currentLessonId).toBe(lessonAt(2).id);
    expect(view.currentLessonPosition).toBe(3);
    expect(view.lessonsCompleted).toBe(2);
    expect(view.completionPercent).toBe(66);
    expect(view.isOnFinalLesson).toBe(true);
  });

  test("bookkeeping — every service-created row is tracked for the afterAll hard-delete", () => {
    const trackedSessionIds = tracked.records
      .filter(record => record.key === "session")
      .map(record => record.id)
      .toSorted((a, b) => a - b);
    const journeySessionIds = [sessionS1, sessionS2, sessionS3, sessionS4, sessionS5, sessionS6]
      .map(booked => booked.id)
      .toSorted((a, b) => a - b);
    expect(trackedSessionIds).toEqual(journeySessionIds);
    expect(tracked.records.filter(record => record.key === "session_request_idempotency")).toHaveLength(6);
    expect(tracked.size).toBeGreaterThan(0);
  });
});
