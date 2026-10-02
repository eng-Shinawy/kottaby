/**
 * StudentProgressService — curriculum-position read + settlement-side
 * increment for the `progress` pointer row.
 *
 * The `progress` table is a pointer model: at most one row per (student,
 * governing plan) whose `lesson_id` IS the student's current lesson in
 * that plan's `id ASC` sequence — the lesson the student is on, one slot
 * ahead of the last completed lesson. This service owns the two behaviors
 * around that pointer:
 *
 *  - `getStudentProgress` — the permission-gated read. Students read only
 *    themselves, teachers only students they share at least one session
 *    row with (the pair count runs on the SAME transaction as the data
 *    reads, so a severed relationship mid-flight cannot extend a payload),
 *    admins read anyone; every other role is denied with the constant
 *    `ForbiddenError` shape before any existence probe. The payload is
 *    computed field-by-field from real rows only — `hasProgress: false`
 *    instead of a fabricated pointer when the student holds no row, no
 *    active tajweed-lane subscription, or a zero-lesson plan.
 *
 *  - `incrementForConfirmedSession` — the write, driven by the settlement
 *    path after a session's successful end state. It takes the caller's
 *    transaction (never opens or manages one), NEVER throws for a missing
 *    curriculum context, and is gated on the session's INTENT: only
 *    tajweed sessions move the pointer (evaluation settles through the
 *    same financial lane but is not a tajweed lesson; hifz tracking does
 *    not exist yet). A missing active tajweed-lane subscription or an
 *    empty curriculum no-ops with exactly one structured log — settlement
 *    is never rolled back over an absent curriculum. The always-existing
 *    student row is locked FOR UPDATE BEFORE the pointer read: that lock
 *    is the per-student serializer (a lock on the not-yet-inserted pointer
 *    row would guard nothing, including the first-insert race). A pointer
 *    row left lesson-less by an admin curriculum edit (the FK's set-null)
 *    is re-anchored IN PLACE and treated as positioned on the first
 *    lesson pre-completion (the documented recovery), and a row already
 *    pinned at the final lesson is left untouched — extra completions of
 *    a finished curriculum cannot corrupt the record.
 *
 * Pure helpers (the honest zero payload, pointer-position recovery, the
 * floor percentage, and the skip-log shape) live in the sibling
 * `student-progress.helpers.ts`.
 */

import {
  LessonRepository,
  PlanRepository,
  ProgressRepository,
  SessionRepository,
  StudentRepository,
  SubscriptionRepository,
} from "@/backend/db/repo";
import { SubscriptionCreditLane } from "@/backend/enum/billing/subscription-credit-lane.enum";
import { SessionIntent } from "@/backend/enum/scheduling/session-intent.enum";
import { UserRole } from "@/backend/enum/users/user-role.enum";
import { withTransaction } from "@/backend/lib/db/with-transaction";
import { ForbiddenError, NotFoundError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import {
  computePercent,
  computePosition,
  emptyProgress,
  logSkip,
} from "@/backend/services/classes/student-progress.helpers";
import type { DBTransaction, SessionReturnType, StudentProgressReturnType } from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import type { ErrorsLabels } from "@/shared/locale/types/errors";

/**
 * Bounded log for the theoretically-unreachable `updateRowLesson` zero-row
 * miss — the logSkip shape (ids only, machine reason): the miss cannot fire
 * under the student-row lock (single writer; lesson deletes NULL the pointer
 * rather than deleting the row), so the `| null` repo contract is honored
 * with observability alone and never rolls the settlement back.
 */
function logPointerRowMissingOnUpdate(studentId: number, lessonId: number): void {
  logger.logDomainError("Student progress advance skipped: pointer-row-missing-on-update", {
    code: "PROGRESS_SKIPPED",
    entity: "progress",
    studentId,
    lessonId,
  });
}

/**
 * Moves an existing pointer row to the target lesson and classifies the
 * theoretically-unreachable zero-row miss with one bounded domain log —
 * never a throw, so the settlement cannot roll back over the miss.
 */
async function updatePointerLessonOrLogMiss(
  rowId: number,
  targetLessonId: number,
  studentId: number,
  tx: DBTransaction
): Promise<void> {
  const updated = await ProgressRepository.updateRowLesson(rowId, targetLessonId, tx);
  if (updated === null) {
    logPointerRowMissingOnUpdate(studentId, targetLessonId);
  }
}

/** Bounded denial log for the gated read — ids only, constant shape. */
function logReadDenied(reason: string, code: string, studentId: number): void {
  logger.logDomainError(`Student progress read denied: ${reason}`, {
    code,
    entity: "progress",
    entityId: studentId,
  });
}

/**
 * Role gate for the progress read — runs BEFORE any existence probe so a
 * foreign caller cannot distinguish a missing student from one they may
 * not see. Admin passes; a student is locked to their own id regardless
 * of the requested one; a teacher must share at least one session row
 * with the target student (the pair count rides the caller's transaction,
 * the same snapshot as the data reads); any other role is denied.
 * Denials are the constant-shape `ForbiddenError` with ONE bounded log.
 */
async function assertProgressReadAllowed(
  callerId: number,
  callerRole: UserRole,
  studentId: number,
  tErrors: ErrorsLabels,
  tx: DBTransaction
): Promise<void> {
  switch (callerRole) {
    case UserRole.Admin:
      return;
    case UserRole.Student:
      if (studentId === callerId) {
        return;
      }
      logReadDenied("caller is not the target student", "FORBIDDEN", studentId);
      throw new ForbiddenError(tErrors.forbidden);
    case UserRole.Teacher: {
      const sharedSessions = await SessionRepository.countTeacherStudentSessions(callerId, studentId, tx);
      if (sharedSessions >= 1) {
        return;
      }
      logReadDenied("teacher shares no session with the student", "FORBIDDEN", studentId);
      throw new ForbiddenError(tErrors.forbidden);
    }
    default:
      logReadDenied("role has no progress read surface", "FORBIDDEN", studentId);
      throw new ForbiddenError(tErrors.forbidden);
  }
}

export namespace StudentProgressService {
  /**
   * Composes one student's curriculum-position payload: hasProgress, the
   * governing plan echo, the current lesson (id/title/1-based position),
   * the completed count, the floor percentage, and the final-lesson flag.
   *
   * Opens ONE transaction (or joins the caller's) for the whole read: the
   * role gate runs FIRST — admin passes, a student is locked to their own
   * id regardless of the requested one, a teacher must share at least one
   * session row with the target student (the pair count rides the same
   * snapshot as the reads), and any other role is denied before any
   * existence probe (a foreign caller cannot distinguish a missing student
   * from one they may not see). A malformed or non-positive id and a
   * missing student row both reject with the same localized
   * `STUDENT_NOT_FOUND` error. The governing plan is the student's most
   * recent active tajweed-lane subscription's plan; without one, the read
   * answers the honest zero payload with null plan fields.
   *
   * @returns The computed payload — never a row spread; every field is
   *     picked or derived from rows read inside the transaction.
   * @throws NotFoundError  Malformed id or unknown student.
   * @throws ForbiddenError  Caller is not the student, holds no session
   *     relationship with them, or has no progress read surface at all.
   */
  export async function getStudentProgress(
    callerId: number,
    callerRole: UserRole,
    studentId: number,
    locale: string,
    outerTx?: DBTransaction
  ): Promise<StudentProgressReturnType> {
    const tErrors = getServerTranslations(locale).errorsTranslations;

    return withTransaction(
      outerTx,
      async tx => {
        if (!Number.isInteger(studentId) || studentId < 1) {
          logReadDenied("malformed student id", "STUDENT_NOT_FOUND", studentId);
          throw new NotFoundError("STUDENT", tErrors.studentProgress.studentNotFound);
        }

        await assertProgressReadAllowed(callerId, callerRole, studentId, tErrors, tx);

        const student = await StudentRepository.findById(studentId, tx);
        if (student === null) {
          logReadDenied("student not found", "STUDENT_NOT_FOUND", studentId);
          throw new NotFoundError("STUDENT", tErrors.studentProgress.studentNotFound);
        }

        const planId = await SubscriptionRepository.findLatestActivePlanIdForLane(
          studentId,
          SubscriptionCreditLane.Tajweed,
          tx
        );
        if (planId === null) {
          return emptyProgress(studentId);
        }

        const [plan, lessons] = await Promise.all([
          PlanRepository.findById(planId, tx),
          LessonRepository.listByPlanId(planId, tx),
        ]);
        const planFields = { id: planId, title: plan?.title ?? null };
        const totalLessons = lessons.length;
        if (totalLessons === 0) {
          return emptyProgress(studentId, planFields, 0);
        }

        // Plain read — the read path takes no lock; honesty rules, not
        // serialization, govern it. A lesson-less row (the admin-delete
        // leftover) is invisible to the plan-scoped join: the recovery
        // probe finds it and the payload shows the documented display
        // recovery — the student re-positioned on the first lesson,
        // pre-completion — instead of the fabricated no-progress shape.
        const row = await ProgressRepository.findRowForStudentPlan(studentId, planId, tx);
        let pointerRow = row;
        // The lesson-less probe fires only when the join read missed.
        pointerRow ??= await ProgressRepository.findNullLessonRowForStudent(studentId, tx);
        if (pointerRow === null) {
          return emptyProgress(studentId, planFields, totalLessons);
        }

        // The lesson-less probe row recovers to idx 0 (position 1,
        // zero completed, zero percent) through the same composition as a
        // live pointer.
        const { idx } = computePosition(lessons, pointerRow);
        const currentLesson = lessons[idx];
        return {
          hasProgress: true,
          studentId,
          planId,
          planTitle: planFields.title,
          totalLessons,
          currentLessonId: currentLesson.id,
          currentLessonTitle: currentLesson.title,
          currentLessonPosition: idx + 1,
          lessonsCompleted: idx,
          completionPercent: computePercent(idx, totalLessons),
          isOnFinalLesson: idx === totalLessons - 1,
        };
      },
      { isolationLevel: "repeatable read" } // one snapshot for the role gate + every data read
    );
  }

  /**
   * Advances one student's curriculum pointer after a successfully
   * settled session — lazily inserting the row on the first completion,
   * moving it one slot forward mid-curriculum, and pinning it at the final
   * lesson. Designed to be called from the settlement slice with THAT
   * slice's transaction: a genuine database failure propagates (the whole
   * settlement rolls back), while a missing curriculum context never does.
   *
   * Zero-throw contract for context misses: a session without the tajweed
   * intent returns silently; a missing active tajweed-lane subscription or
   * an empty curriculum logs exactly one structured skip and returns; a
   * lesson-less pointer row (an admin lesson delete set its `lesson_id`
   * NULL, so the plan-scoped join cannot see it) is re-anchored IN PLACE —
   * positioned on the first lesson pre-completion and advanced from there
   * by the same update — with one structured log, never duplicated beside
   * an abandoned row. The student row lock is taken BEFORE the pointer read
   * so two settlements of the same student serialize (the second observes
   * the first's pointer) and duplicate pointer rows are impossible.
   *
   * An `updateRowLesson` zero-row miss is unreachable under the student-row
   * lock; the repo's `| null` contract is honored with one bounded
   * `pointer-row-missing-on-update` domain log rather than a throw, so the
   * settlement never rolls back over it.
   *
   * Takes no user-shaped input at all — only the settled session row and
   * the caller's transaction.
   */
  export async function incrementForConfirmedSession(session: SessionReturnType, tx: DBTransaction): Promise<void> {
    if (session.intent !== SessionIntent.Tajweed) {
      return;
    }

    // The student-row lock is the per-student serializer: taken BEFORE the
    // plan-resolution and lessons context reads and the pointer read, it
    // closes the first-insert race a pointer-row lock could not (a row that
    // does not exist yet locks nothing) and keeps every context read on the
    // locked snapshot.
    await StudentRepository.findByIdForUpdate(session.studentId, tx);

    const planId = await SubscriptionRepository.findLatestActivePlanIdForLane(
      session.studentId,
      SubscriptionCreditLane.Tajweed,
      tx
    );
    if (planId === null) {
      logSkip("no-active-tajweed-subscription", { sessionId: session.id, studentId: session.studentId });
      return;
    }

    const lessons = await LessonRepository.listByPlanId(planId, tx);
    if (lessons.length === 0) {
      logSkip("no-lessons", { sessionId: session.id, studentId: session.studentId });
      return;
    }

    const row = await ProgressRepository.findRowForStudentPlan(session.studentId, planId, tx);
    // A row whose lesson was admin-deleted reads as no-row through the
    // plan-scoped join; probe the student's lesson-less pointer so the
    // recovery re-anchors that row in place instead of inserting a
    // duplicate pointer beside it. The probe fires only when the join
    // read missed.
    let pointerRow = row;
    pointerRow ??= await ProgressRepository.findNullLessonRowForStudent(session.studentId, tx);
    if (row === null && pointerRow !== null) {
      logSkip("pointer-reanchored", { sessionId: session.id, studentId: session.studentId });
    }
    const { idx } = computePosition(lessons, pointerRow);

    const total = lessons.length;
    if (total === 1) {
      const target = lessons[0];
      if (pointerRow === null) {
        await ProgressRepository.insertRow({ studentId: session.studentId, lessonId: target.id }, tx);
        return;
      }
      if (pointerRow.lessonId !== target.id) {
        await updatePointerLessonOrLogMiss(pointerRow.id, target.id, session.studentId, tx);
      }
      return;
    }

    if (pointerRow !== null && idx === total - 1) {
      return;
    }

    const target = lessons[idx + 1];
    if (pointerRow === null) {
      await ProgressRepository.insertRow({ studentId: session.studentId, lessonId: target.id }, tx);
    } else {
      await updatePointerLessonOrLogMiss(pointerRow.id, target.id, session.studentId, tx);
    }
  }
}
