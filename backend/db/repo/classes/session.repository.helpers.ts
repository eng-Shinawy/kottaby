/**
 * SessionRepository read-side helpers — the module-scope query machinery
 * (shared predicate builders, the standalone-select column shape, the SQL
 * renderer) and the standalone-capable read implementations extracted
 * VERBATIM from `session.repository.ts` (behavior-identical extraction;
 * zero logic change). The public surface stays the `SessionRepository`
 * namespace in `session.repository.ts`: the list/count/probe methods below
 * back the namespace's read methods as one-to-one delegation targets, and
 * the guarded write transitions remain implemented inline in the namespace
 * file. Nothing in this module is part of the public API.
 *
 * Conventions carried over unchanged (per `backend/db/repo/AGENTS.md`):
 *  - every function takes `tx?: DBTransaction` as its LAST parameter. Reads
 *    run on the caller's transaction when supplied and fall back to raw
 *    parameterized SQL via `queryDb` (the Neon-HTTP-eligible pattern)
 *    otherwise;
 *  - NO prepared statements, NO array-membership operators, NO SQL
 *    line-comment sequences in any statement, and the lifecycle vocabulary
 *    is carried by the `SessionStatus` enum members, never string literals;
 *  - no business logic, no permission checks, no i18n or logging — the
 *    caller decides what `null` means.
 */

import { count, desc, eq, type SQL, sql } from "drizzle-orm";
import { alias, PgDialect } from "drizzle-orm/pg-core";
import { queryDb } from "@/backend/db";
import { session } from "@/backend/db/schema/classes/session";
import { users } from "@/backend/db/schema/users/users";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import type {
  DBTransaction,
  SessionListFilterInput,
  SessionSelectType,
  SessionTransitionProbeRowType,
  SessionWaveContextRow,
} from "@/backend/types";

/**
 * The participant columns of `session` — both reference the shared
 * `users.id` PK and carry the identical Drizzle column type (an integer FK
 * onto `users.id`), so one representative column type covers either side.
 * Method entry points pass the schema column object itself (`studentId` or
 * `teacherId`), so the owner side is a closed in-code decision, never
 * caller input.
 */
type SessionOwnerColumn = typeof session.studentId;

/** Column alias list for standalone reads — mirrors `$inferSelect` typing 1:1. */
const SESSION_SELECT_COLUMNS = `
  id, teacher_id AS "teacherId", student_id AS "studentId", status,
  session_type AS "sessionType", intent, fee, fee_held AS "feeHeld",
  held_balance_lane AS "heldBalanceLane", started_at AS "startedAt",
  ended_at AS "endedAt", confirmed_by_student_at AS "confirmedByStudentAt",
  confirmed_by_teacher_at AS "confirmedByTeacherAt",
  confirmation_deadline AS "confirmationDeadline",
  cancel_reason AS "cancelReason", dispute_reason AS "disputeReason",
  disputed_at AS "disputedAt", resolution_note AS "resolutionNote",
  resolved_at AS "resolvedAt",
  created_at AS "createdAt", updated_at AS "updatedAt"`;

/** Stateless renderer used to translate the shared predicate into standalone-read SQL. */
const participantDialect = new PgDialect();

/**
 * ONE module-scope predicate builder shared by every participant read
 * (list + count, transactional + standalone branches): the owner equality
 * plus, only when a status filter is provided, the lifecycle-state
 * equality. `null`/absent filters drop out (they never error). The status
 * vocabulary flows as a bound parameter from the `SessionStatus` enum, so
 * the filtered set the list pages over and the set the count totals are
 * decided by exactly this one function — the total can never diverge from
 * the list.
 */
function buildParticipantPredicate(
  ownerColumn: SessionOwnerColumn,
  ownerId: number,
  filter: SessionListFilterInput
): SQL {
  const conditions: SQL[] = [eq(ownerColumn, ownerId)];
  const statusFilter = filter.status ?? undefined;
  if (statusFilter !== undefined) {
    conditions.push(eq(session.status, statusFilter));
  }
  return sql.join(conditions, sql` and `);
}

/**
 * Participant list read shared by the student/teacher list methods. Newest
 * first (`created_at DESC`), with `id DESC` as the deterministic tiebreak
 * for rows created in the same instant; page window via bound LIMIT/OFFSET
 * (an offset past the end yields zero rows — the count stays honest).
 */
async function listParticipantSessions(
  ownerColumn: SessionOwnerColumn,
  ownerId: number,
  filter: SessionListFilterInput,
  limit: number,
  offset: number,
  tx?: DBTransaction
): Promise<SessionSelectType[]> {
  if (tx) {
    return tx
      .select()
      .from(session)
      .where(buildParticipantPredicate(ownerColumn, ownerId, filter))
      .orderBy(desc(session.createdAt), desc(session.id))
      .limit(limit)
      .offset(offset);
  }
  // Standalone read — the shared predicate is rendered to parameterized SQL
  // (placeholders $1…) and executed via the queryDb pool path.
  const rendered = participantDialect.sqlToQuery(buildParticipantPredicate(ownerColumn, ownerId, filter));
  const result = await queryDb<SessionSelectType>(
    `SELECT ${SESSION_SELECT_COLUMNS}
     FROM session
     WHERE ${rendered.sql}
     ORDER BY created_at DESC, id DESC
     LIMIT $${rendered.params.length + 1} OFFSET $${rendered.params.length + 2}`,
    [...rendered.params, limit, offset]
  );
  return result.rows;
}

/**
 * Participant count read shared by the student/teacher count methods —
 * consumes the SAME predicate builder as the list, so the total always
 * describes the exact filtered set.
 */
async function countParticipantSessions(
  ownerColumn: SessionOwnerColumn,
  ownerId: number,
  filter: SessionListFilterInput,
  tx?: DBTransaction
): Promise<number> {
  if (tx) {
    const rows = await tx
      .select({ value: count() })
      .from(session)
      .where(buildParticipantPredicate(ownerColumn, ownerId, filter));
    return rows[0]?.value ?? 0;
  }
  const rendered = participantDialect.sqlToQuery(buildParticipantPredicate(ownerColumn, ownerId, filter));
  const result = await queryDb<{ value: string }>(`SELECT count(*) AS "value" FROM session WHERE ${rendered.sql}`, [
    ...rendered.params,
  ]);
  return Number(result.rows[0]?.value ?? 0);
}

/**
 * ONE module-scope predicate builder for the admin arbitration read: the
 * status-first pinned membership on the disputed lifecycle state. The
 * disputed rows are the arbitration work queue — no owner equality exists
 * on this predicate (the admin surface is role-gated upstream, not
 * owner-scoped), and no filter input participates: the caller (service)
 * narrows contradictory filter requests out before this read is reached,
 * so the list and the count always describe one identical set.
 */
function buildAdminDisputedPredicate(): SQL {
  return eq(session.status, SessionStatus.Disputed);
}

/**
 * Finds a session row by primary key; `null` when the id is unknown. On the
 * caller's transaction it runs as a Drizzle select; standalone it runs as
 * raw parameterized SQL via the queryDb pool path.
 */
async function findById(id: number, tx?: DBTransaction): Promise<SessionSelectType | null> {
  if (tx) {
    const rows = await tx.select().from(session).where(eq(session.id, id)).limit(1);
    return rows[0] ?? null;
  }
  const result = await queryDb<SessionSelectType>(
    `SELECT ${SESSION_SELECT_COLUMNS}
       FROM session WHERE id = $1 LIMIT 1`,
    [id]
  );
  return result.rows[0] ?? null;
}

/**
 * Cold-path probe: reads the minimal classification projection (identity
 * + lifecycle state + both participants + the start stamp) for a session
 * id. Used ONLY AFTER a guarded transition matched zero rows (or, for
 * the arbitration COMPLETE outcome, BEFORE the guarded write) — the probe
 * is classification-only; it never gates or influences any write.
 */
async function findTransitionProbe(id: number, tx?: DBTransaction): Promise<SessionTransitionProbeRowType | null> {
  const projection = {
    id: session.id,
    status: session.status,
    studentId: session.studentId,
    teacherId: session.teacherId,
    startedAt: session.startedAt,
  };
  if (tx) {
    const rows = await tx.select(projection).from(session).where(eq(session.id, id)).limit(1);
    return rows[0] ?? null;
  }
  const result = await queryDb<SessionTransitionProbeRowType>(
    `SELECT id, status, student_id AS "studentId", teacher_id AS "teacherId",
            started_at AS "startedAt"
     FROM session WHERE id = $1 LIMIT 1`,
    [id]
  );
  return result.rows[0] ?? null;
}

/**
 * Lists the disputed sessions (the admin arbitration work queue), newest
 * first, paged, under the ONE status-first admin predicate. No owner
 * equality exists on this read — the admin surface is role-gated
 * upstream, and ownership scoping is the participant lists' job.
 */
async function listAdminDisputed(limit: number, offset: number, tx?: DBTransaction): Promise<SessionSelectType[]> {
  if (tx) {
    return tx
      .select()
      .from(session)
      .where(buildAdminDisputedPredicate())
      .orderBy(desc(session.createdAt), desc(session.id))
      .limit(limit)
      .offset(offset);
  }
  // Standalone read — the shared predicate is rendered to parameterized
  // SQL (placeholders $1…) and executed via the queryDb pool path.
  const rendered = participantDialect.sqlToQuery(buildAdminDisputedPredicate());
  const result = await queryDb<SessionSelectType>(
    `SELECT ${SESSION_SELECT_COLUMNS}
     FROM session
     WHERE ${rendered.sql}
     ORDER BY created_at DESC, id DESC
     LIMIT $${rendered.params.length + 1} OFFSET $${rendered.params.length + 2}`,
    [...rendered.params, limit, offset]
  );
  return result.rows;
}

/** Counts the disputed sessions under the SAME status-first admin predicate. */
async function countAdminDisputed(tx?: DBTransaction): Promise<number> {
  if (tx) {
    const rows = await tx.select({ value: count() }).from(session).where(buildAdminDisputedPredicate());
    return rows[0]?.value ?? 0;
  }
  const rendered = participantDialect.sqlToQuery(buildAdminDisputedPredicate());
  const result = await queryDb<{ value: string }>(`SELECT count(*) AS "value" FROM session WHERE ${rendered.sql}`, [
    ...rendered.params,
  ]);
  return Number(result.rows[0]?.value ?? 0);
}

/** Aliased `users` handles for the two-participant joined wave-context read. */
const waveStudentUser = alias(users, "wave_student_user");
const waveTeacherUser = alias(users, "wave_teacher_user");

/**
 * ONE joined read of the session-request wave context: the session's `id`
 * + raw `intent` (STILL untrusted storage — validating it is the service
 * layer's job) together with BOTH participants' `userId`/`fullName`/
 * `locale` — exactly the fields the session-request notification emitters
 * need, and nothing else. Both participants resolve through INNER JOINs:
 * `student_id`/`teacher_id` are NOT NULL FKs sharing the `users.id` PK, so
 * a session row always joins exactly one student user and one teacher
 * user; a miss on the `session` side yields no row and maps to `null`.
 */
async function findWaveContextById(id: number, tx?: DBTransaction): Promise<SessionWaveContextRow | null> {
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
            tu.id AS "teacherUserId", tu.full_name AS "teacherFullName", tu.locale AS "teacherLocale"
     FROM session s
     JOIN users su ON su.id = s.student_id
     JOIN users tu ON tu.id = s.teacher_id
     WHERE s.id = $1 LIMIT 1`,
    [id]
  );
  return result.rows[0] ?? null;
}

export {
  countAdminDisputed,
  countParticipantSessions,
  findById,
  findTransitionProbe,
  findWaveContextById,
  listAdminDisputed,
  listParticipantSessions,
};
