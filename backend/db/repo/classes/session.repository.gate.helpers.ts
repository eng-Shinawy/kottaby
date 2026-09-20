/**
 * SessionRepository gate reads — the gate-supporting row reads (the
 * report gate's `FOR UPDATE` lock read, the rating-eligibility probe, and
 * the teacher↔student tenancy probe), extracted VERBATIM from
 * `session.repository.ts` (behavior-identical max-lines extraction;
 * zero logic change). The public surface stays the `SessionRepository`
 * namespace in `session.repository.ts`: each function below backs the
 * namespace method of the same name as a one-to-one delegation target.
 * Nothing in this module is part of the public API.
 *
 * Conventions carried over unchanged (per `backend/db/repo/AGENTS.md`):
 *  - gate reads take `tx: DBTransaction` as a REQUIRED last parameter —
 *    a locking read without a transaction releases its lock as soon as
 *    the statement finishes, and a gate decision must observe the caller
 *    transaction's own writes;
 *  - NO prepared statements, NO array-membership operators, NO SQL
 *    line-comment sequences in any statement;
 *  - no business logic, no permission checks, no i18n or logging — the
 *    caller decides what `null` means.
 */

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/backend/db";
import { session } from "@/backend/db/schema/classes/session";
import type { DBTransaction, SessionRatingEligibilityProbeType, SessionTransitionProbeRowType } from "@/backend/types";

/**
 * Report-gate row lock: takes the `FOR UPDATE` lock on the session row
 * and reads the transition-probe projection inside the SAME statement,
 * so a report submission serializes against every other gate-locked
 * writer of that row and the returned lifecycle state is the state the
 * caller's subsequent writes commit against (no window for the row to
 * change between the read and the caller's writes). The projection
 * reuses the transition-probe row type (identity, lifecycle state, both
 * participants, start stamp — the stamp rides along unused by callers
 * that only need the gate quadruple).
 */
async function lockForReportGate(sessionId: number, tx: DBTransaction): Promise<SessionTransitionProbeRowType | null> {
  const rows = await tx
    .select({
      id: session.id,
      status: session.status,
      studentId: session.studentId,
      teacherId: session.teacherId,
      startedAt: session.startedAt,
    })
    .from(session)
    .where(eq(session.id, sessionId))
    .for("update");
  return rows[0] ?? null;
}

/**
 * Rating-eligibility probe: reads the minimal gate projection (row
 * identity, both participants, the lifecycle state, and the dual
 * completion stamps) for a session id. A plain (non-locking) read: the
 * dual-confirmation state is monotonic once written, so the read cannot
 * gate a stale write, and duplicate submissions are arbitrated
 * downstream by the evaluations table's unique (session, evaluator)
 * constraint. The probe is classification-only — it never feeds a
 * guarded update.
 */
async function findRatingEligibilityProbe(
  sessionId: number,
  tx: DBTransaction
): Promise<SessionRatingEligibilityProbeType | null> {
  const rows = await tx
    .select({
      id: session.id,
      studentId: session.studentId,
      teacherId: session.teacherId,
      status: session.status,
      confirmedByTeacherAt: session.confirmedByTeacherAt,
      confirmedByStudentAt: session.confirmedByStudentAt,
    })
    .from(session)
    .where(eq(session.id, sessionId))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Teacher↔student tenancy probe: does ANY session row (any status) link
 * this teacher to this student? EXISTS-select only — no row data is
 * projected, no lock is taken. Unlike the locking gate reads above, the
 * probe takes `tx` OPTIONAL: it is a lock-free eligibility read, so a
 * standalone caller may run it on the pool; when a caller's transaction
 * is supplied it rides that transaction to observe the caller's own
 * writes. The composite index `session_teacher_id_student_id_idx` makes
 * the scan O(1) on the relationship pair, and the fused teacher +
 * student equality predicate keeps the tenancy decision SQL-side — the
 * caller's identity is the probe's only authority, never client input.
 *
 * @returns `true` when at least one session links the caller (as
 *          teacher) to the student; `false` for an unknown caller, an
 *          unknown student, or a pair with zero shared sessions.
 */
async function existsSessionForTeacherStudent(
  teacherUserId: number,
  studentId: number,
  tx?: DBTransaction
): Promise<boolean> {
  const executor = tx ?? db;
  const rows = await executor
    .select({ exists: sql`1`.as("exists") })
    .from(session)
    .where(and(eq(session.teacherId, teacherUserId), eq(session.studentId, studentId)))
    .limit(1);
  return rows.length > 0;
}

export { existsSessionForTeacherStudent, findRatingEligibilityProbe, lockForReportGate };
