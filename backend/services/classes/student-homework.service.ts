/**
 * StudentHomeworkService — the teacher-scoped cross-teacher homework
 * history read.
 *
 * Pipeline (in fixed order, never reordered):
 *  0. Pre-DB boundary id-shape guard — the student id is validated as a
 *     positive safe integer BEFORE any database work (the shared
 *     session-lifecycle id guard, localized once via
 *     `getServerTranslations(locale).errorsTranslations`); a garbage id
 *     surfaces as the typed `VALIDATION` denial before any SQL round-trip
 *     and never spends a probe read.
 *  1. Pagination clamp — `clampHomeworkHistoryPage` normalizes the caller-
 *     supplied `page`/`pageSize` to the effective `{page, pageSize,
 *     offset}` triple BEFORE the transaction opens; effective values are
 *     echoed in the envelope.
 *  2. ONE `withTransaction(outerTx, { isolationLevel: "repeatable read" })`
 *     body — the gate (`requireTeacherOfStudent`) and the data reads
 *     (`listForStudent` + `countForStudent`) share ONE REPEATABLE READ
 *     snapshot, so a session that is created/cancelled/disputed mid-flight
 *     cannot extend or shrink a returned payload (the TOCTOU seal). The
 *     `outerTx` seam (production path: omitted, the service opens its own
 *     top-level transaction; composed/test path: supplied, the service
 *     joins as a SAVEPOINT — both paths honor the isolation).
 *     a. `requireTeacherOfStudent` —
 *        `SessionRepository.existsSessionForTeacherStudent`: ANY miss
 *        (unknown id, non-teacher caller, zero sessions) yields the
 *        constant `ForbiddenError(errorsTranslations.forbidden)` + exactly
 *        ONE bounded `logger.logDomainError({ code: "FORBIDDEN", entity:
 *        "students", entityId, locale })` — the caller cannot
 *        distinguish the cause (no existence disclosure);
 *     b. `HomeWorkRepository.listForStudent(studentId, pageSize, offset, tx)`
 *        and `HomeWorkRepository.countForStudent(studentId, tx)` — both
 *        are teacher-agnostic by construction (the homework row's tenancy
 *        is `session.student_id`, fused into the repository's INNER JOIN
 *        condition — no post-filter).
 *  3. The envelope `{ items, totalCount, page, pageSize }` — zero writes,
 *     zero locks, zero logs on success.
 *
 * Export style: module-level bare function (`import * as
 * StudentHomeworkService` consumers call members directly — the same shape
 * the sibling `session-report.service.ts` uses; the classes-domain services
 * keep their bare-export style).
 *
 * Denial logging: exactly ONE `logger.logDomainError` per denial path with
 * the `{code, entity, entityId, locale}` context only — never payloads,
 * notes, or the other participant's data; success logs NOTHING. Every
 * denial REPLAY-THROWS the typed error (never swallowed).
 *
 * Read posture: the read path is silent on success (matching the M1 read
 * posture) and performs NO governance re-check — the teacher-relation
 * EXISTS gate is the authority for this read.
 *
 * Localization: the user-facing message resolves through
 * `getServerTranslations(locale).errorsTranslations` — resolved ONCE and
 * threaded unchanged through the guard and the throw site.
 */
import { HomeWorkRepository, SessionRepository } from "@/backend/db/repo";
import { withTransaction } from "@/backend/lib/db/with-transaction";
import { ForbiddenError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import { assertPositiveSafeSessionId } from "@/backend/services/classes/session-lifecycle.guards";
import { clampHomeworkHistoryPage } from "@/backend/services/classes/student-homework.helpers";
import type { DBTransaction, StudentHomeworkPageInput, StudentHomeworkPageReturnType } from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";

/** The localized `errors` namespace slice — the exact handle shape the flow threads through every throw site. */
type ErrorsTranslations = ReturnType<typeof getServerTranslations>["errorsTranslations"];

/**
 * The teacher↔student relationship gate: requires the caller (a teacher
 * user id shared-PK'd with `teacher.id`) to hold at least one session (any
 * status) with the student. Denials are constant-shaped — a missing id,
 * an unknown student, an unrelated teacher, and a non-teacher caller all
 * produce the SAME constant `ForbiddenError` (one localized copy from
 * `errorsTranslations.forbidden`) and exactly ONE bounded
 * `logger.logDomainError` whose context bag is exactly
 * `{ code: "FORBIDDEN", entity: "students", entityId, locale }` — never
 * the row's stored fields, never the teacher's identity beyond the bound
 * parameter.
 *
 * Module-private (the parent portal keeps its gate module-private too); a
 * single probe + single throw, no separate helpers file is needed.
 */
async function requireTeacherOfStudent(
  teacherUserId: number,
  studentId: number,
  locale: string,
  t: ErrorsTranslations,
  tx: DBTransaction
): Promise<void> {
  const linked = await SessionRepository.existsSessionForTeacherStudent(teacherUserId, studentId, tx);
  if (!linked) {
    logger.logDomainError("Student homework history denied: teacher↔student relationship not in force", {
      code: "FORBIDDEN",
      entity: "students",
      entityId: studentId,
      locale,
    });
    throw new ForbiddenError(t.forbidden);
  }
}

/**
 * Reads the student's homework history for a teacher who has at least one
 * session (any status) with that student — cross-teacher by construction.
 *
 * Domain behavior (in order):
 *  - Pre-DB id-shape guard denies a malformed student id with the
 *    canonical `VALIDATION` error BEFORE any database work (the shared
 *    session-lifecycle id guard — `assertPositiveSafeSessionId`).
 *  - Pagination clamp normalizes caller-supplied `page`/`pageSize` to
 *    effective `{page, pageSize, offset}` BEFORE the transaction opens;
 *    effective values are echoed in the envelope.
 *  - ONE `withTransaction(outerTx, { isolationLevel: "repeatable read" })`
 *    body runs the relationship gate FIRST, then the list+count pair
 *    inside the SAME snapshot — a session that is created/cancelled
 *    mid-flight cannot extend or shrink the returned payload.
 *  - The list+count pair is teacher-agnostic: the repository fuses the
 *    tenancy equality (`session.student_id`) into its INNER JOIN, so the
 *    page window and the honest total describe the same filtered set.
 *
 * @param teacherUserId The acting teacher's id (context-resolved
 *     server-side by the caller; shared PK with the users table).
 * @param studentId The target student's id (validated before any database
 *     work).
 * @param page Optional pagination request (clamped by the helpers).
 * @param locale Active request locale (for the localized error message).
 * @param outerTx Optional outer transaction. When provided (test/composed
 *     path), the flow runs inside a SAVEPOINT on it; production callers
 *     omit it and the service opens its own REPEATABLE READ transaction.
 * @returns The paginated homework window. An out-of-range page yields
 *     empty `items` next to the true `totalCount`.
 */
export async function listStudentHomeworkHistory(
  teacherUserId: number,
  studentId: number,
  page: StudentHomeworkPageInput | undefined,
  locale: string,
  outerTx?: DBTransaction
): Promise<StudentHomeworkPageReturnType> {
  const t = getServerTranslations(locale).errorsTranslations;
  assertPositiveSafeSessionId(studentId, t);
  const { page: effectivePage, pageSize, offset } = clampHomeworkHistoryPage(page);

  return withTransaction(
    outerTx,
    async tx => {
      await requireTeacherOfStudent(teacherUserId, studentId, locale, t, tx);
      const [items, totalCount] = await Promise.all([
        HomeWorkRepository.listForStudent(studentId, pageSize, offset, tx),
        HomeWorkRepository.countForStudent(studentId, tx),
      ]);
      return { items, totalCount, page: effectivePage, pageSize };
    },
    { isolationLevel: "repeatable read" }
  );
}
