/**
 * SessionRepository wave-context read — the ONE joined read of the
 * session-request notification wave context, extracted VERBATIM from
 * `session.repository.helpers.ts` (behavior-identical max-lines extraction;
 * zero logic change). The public surface stays the `SessionRepository`
 * namespace in `session.repository.ts`: this module backs the namespace's
 * `findWaveContextById` method as a one-to-one delegation target. Nothing
 * in this module is part of the public API.
 *
 * Conventions carried over unchanged (per `backend/db/repo/AGENTS.md`):
 *  - every function takes `tx?: DBTransaction` as its LAST parameter. Reads
 *    run on the caller's transaction when supplied and fall back to raw
 *    parameterized SQL via `queryDb` (the Neon-HTTP-eligible pattern)
 *    otherwise;
 *  - NO prepared statements, NO array-membership operators, NO SQL
 *    line-comment sequences in any statement;
 *  - no business logic, no permission checks, no i18n or logging — the
 *    caller decides what `null` means.
 */

import { and, eq, or, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { queryDb } from "@/backend/db";
import { session } from "@/backend/db/schema/classes/session";
import { students } from "@/backend/db/schema/students/students";
import { users } from "@/backend/db/schema/users/users";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import type { DBTransaction, SessionReportWaveContextRow, SessionWaveContextRow } from "@/backend/types";

/** Aliased `users` handles for the two-participant joined wave-context read. */
const waveStudentUser = alias(users, "wave_student_user");
const waveTeacherUser = alias(users, "wave_teacher_user");

/** Aliased `users` handle for the report wave's optional parent participant. */
const reportParentUser = alias(users, "report_parent_user");

/**
 * ONE module-scope predicate builder shared by the participant-initiated
 * live-state guarded transitions (`cancelSessionOnce` and
 * `openDisputeOnce`): row identity, the caller being the session's student
 * OR its teacher, and the lifecycle state still live (pre-start or
 * in-progress — terminal rows are structurally unreachable). The predicate
 * rides inside each method's single guarded UPDATE, so predicate evaluation
 * happens under PostgreSQL's row lock with zero check-then-write window.
 */
export function buildLiveParticipantTransitionPredicate(id: number, participantId: number): SQL | undefined {
  return and(
    eq(session.id, id),
    or(eq(session.studentId, participantId), eq(session.teacherId, participantId)),
    or(eq(session.status, SessionStatus.Scheduled), eq(session.status, SessionStatus.Started))
  );
}

/**
 * ONE joined read of the session-request wave context: the session's `id`
 * + raw `intent` (STILL untrusted storage — validating it is the service
 * layer's job), the row's `updated_at` audit stamp (the occurrence
 * discriminator the recurring governance waves fold into their emit-claim
 * keys), together with BOTH participants' `userId`/`fullName`/
 * `locale` — exactly the fields the session-request notification emitters
 * need, and nothing else. Both participants resolve through INNER JOINs:
 * `student_id`/`teacher_id` are NOT NULL FKs sharing the `users.id` PK, so
 * a session row always joins exactly one student user and one teacher
 * user; a miss on the `session` side yields no row and maps to `null`.
 */
export async function findWaveContextById(id: number, tx?: DBTransaction): Promise<SessionWaveContextRow | null> {
  if (tx) {
    const rows = await tx
      .select({
        sessionId: session.id,
        intent: session.intent,
        studentUserId: waveStudentUser.id,
        studentFullName: waveStudentUser.fullName,
        studentLocale: waveStudentUser.locale,
        teacherUserId: waveTeacherUser.id,
        teacherFullName: waveTeacherUser.fullName,
        teacherLocale: waveTeacherUser.locale,
        sessionUpdatedAt: session.updatedAt,
      })
      .from(session)
      .innerJoin(waveStudentUser, eq(waveStudentUser.id, session.studentId))
      .innerJoin(waveTeacherUser, eq(waveTeacherUser.id, session.teacherId))
      .where(eq(session.id, id))
      .limit(1);
    return rows[0] ?? null;
  }
  const result = await queryDb<SessionWaveContextRow>(
    `SELECT s.id AS "sessionId", s.intent AS "intent",
            su.id AS "studentUserId", su.full_name AS "studentFullName", su.locale AS "studentLocale",
            tu.id AS "teacherUserId", tu.full_name AS "teacherFullName", tu.locale AS "teacherLocale",
            s.updated_at AS "sessionUpdatedAt"
     FROM session s
     JOIN users su ON su.id = s.student_id
     JOIN users tu ON tu.id = s.teacher_id
     WHERE s.id = $1 LIMIT 1`,
    [id]
  );
  return result.rows[0] ?? null;
}

/**
 * ONE joined read of the report wave context: BOTH participants'
 * `userId`/`fullName`/`locale` together with the student's LINKED PARENT
 * (via `students.parent_id`, LEFT JOINed — `parent_id` is a nullable FK
 * onto `users.id` with ON DELETE SET NULL, so an unlinked student yields a
 * `null` parent leg: the parent participant can never be fabricated by a
 * caller). This is
 * exactly the recipient set the report notification emitters need, and
 * nothing else. Both participant legs resolve through INNER JOINs
 * (`student_id`/`teacher_id` are NOT NULL FKs sharing the `users.id` PK),
 * so a miss on the `session` side yields no row and maps to `null`; the
 * `students` bridge itself is LEFT JOINed, so the data edge of a student
 * user without a `students` row still returns the wave context (the caller
 * fail-closes on the absent parent leg) instead of nulling the whole row
 * mid-transaction.
 */
async function findReportWaveContextById(id: number, tx?: DBTransaction): Promise<SessionReportWaveContextRow | null> {
  if (tx) {
    const rows = await tx
      .select({
        sessionId: session.id,
        studentUserId: waveStudentUser.id,
        studentFullName: waveStudentUser.fullName,
        studentLocale: waveStudentUser.locale,
        teacherUserId: waveTeacherUser.id,
        teacherFullName: waveTeacherUser.fullName,
        teacherLocale: waveTeacherUser.locale,
        parentUserId: reportParentUser.id,
        parentFullName: reportParentUser.fullName,
        parentLocale: reportParentUser.locale,
      })
      .from(session)
      .innerJoin(waveStudentUser, eq(waveStudentUser.id, session.studentId))
      .innerJoin(waveTeacherUser, eq(waveTeacherUser.id, session.teacherId))
      .leftJoin(students, eq(students.id, session.studentId))
      .leftJoin(reportParentUser, eq(reportParentUser.id, students.parentId))
      .where(eq(session.id, id))
      .limit(1);
    return rows[0] ?? null;
  }
  const result = await queryDb<SessionReportWaveContextRow>(
    `SELECT s.id AS "sessionId", su.id AS "studentUserId", su.full_name AS "studentFullName", su.locale AS "studentLocale",
            tu.id AS "teacherUserId", tu.full_name AS "teacherFullName", tu.locale AS "teacherLocale",
            pu.id AS "parentUserId", pu.full_name AS "parentFullName", pu.locale AS "parentLocale"
     FROM session s
     LEFT JOIN students st ON st.id = s.student_id JOIN users su ON su.id = s.student_id
     JOIN users tu ON tu.id = s.teacher_id LEFT JOIN users pu ON pu.id = st.parent_id
     WHERE s.id = $1 LIMIT 1`,
    [id]
  );
  return result.rows[0] ?? null;
}

export { findReportWaveContextById };
