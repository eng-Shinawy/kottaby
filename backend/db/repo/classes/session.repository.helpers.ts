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
 *  - NO prepared statements, NO SQL line-comment sequences in any
 *    statement, and the lifecycle vocabulary is carried by the
 *    `SessionStatus` enum members, never string literals. Array membership
 *    is reserved for the sanctioned PK batch reads (participant names over
 *    `users.id`, session rows by PK over `session.id`) — dynamic queries,
 *    never prepared statements;
 *  - no business logic, no permission checks, no i18n or logging — the
 *    caller decides what `null` means.
 */

import { and, count, desc, eq, gte, lt, or, type SQL, sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { db, queryDb } from "@/backend/db";
import { session } from "@/backend/db/schema/classes/session";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import type {
  AdminSessionListFilterInput,
  AdminSessionRowReturnType,
  DBTransaction,
  SessionListFilterInput,
  SessionSelectType,
  SessionTransitionProbeRowType,
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
export const SESSION_SELECT_COLUMNS = `
  id, teacher_id AS "teacherId", student_id AS "studentId", status,
  session_type AS "sessionType", intent, fee, fee_held AS "feeHeld", held_balance_lane AS "heldBalanceLane",
  started_at AS "startedAt", ended_at AS "endedAt", confirmed_by_student_at AS "confirmedByStudentAt",
  confirmed_by_teacher_at AS "confirmedByTeacherAt", confirmation_deadline AS "confirmationDeadline",
  cancel_reason AS "cancelReason", dispute_reason AS "disputeReason", disputed_at AS "disputedAt",
  resolution_note AS "resolutionNote", resolution_outcome AS "resolutionOutcome", resolved_at AS "resolvedAt",
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
     ORDER BY created_at DESC, id DESC LIMIT $${rendered.params.length + 1} OFFSET $${rendered.params.length + 2}`,
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
 * Upper bound of the admin directory page size and its fallback — the
 * participant lists' clamp window (1..50, default 25), applied before any
 * database work so the read never fabricates a window.
 */
const MAX_PAGE_SIZE = 50;
const DEFAULT_PAGE_SIZE = 25;

/**
 * Deep-pagination ceiling for the admin directory read: the window a
 * resolved page opens can never start past this many rows into the sorted
 * scan. A page whose resolved offset would reach past the ceiling answers
 * the EMPTY window next to the honest total — the same "an offset past the
 * end yields zero rows" contract the window already honors, without ever
 * handing a hostile page number a multi-billion-row OFFSET over the sorted
 * scan. An operator who needs to reach deeper narrows the filter instead
 * of paging past the ceiling.
 */
const MAX_DIRECTORY_SCAN_ROWS = 10_000;

/**
 * The two lifecycle states the admin badge projection distinguishes below,
 * declared against the schema column's own union type: the vocabulary flows
 * from the `SessionStatus` members while both comparison operands share one
 * type (the pgEnum column type is a string union, not the TS enum object).
 */
const DISPUTED_STATUS: SessionSelectType["status"] = SessionStatus.Disputed;
const SCHEDULED_STATUS: SessionSelectType["status"] = SessionStatus.Scheduled;

/**
 * The admin directory's derived badge flag, computed as a pure projection
 * over the selected row: `true` for a disputed row, or for a `scheduled`
 * row whose confirmation deadline has lapsed at `now` (a scheduled row
 * without a deadline never lapses). The flag is presentation-only — it
 * never grants, denies, or narrows authorization. Post-query projection
 * (not a SQL `CASE`) is the deliberate choice: both executor branches
 * return the identical canonical row shape, so one pure function covers
 * the transactional and standalone reads alike and the predicate builders
 * remain the SQL vocabulary's single home.
 */
function isNeedsAttention(row: SessionSelectType, now: Date): boolean {
  const deadlineLapsed = row.confirmationDeadline !== null && row.confirmationDeadline.getTime() < now.getTime();
  return row.status === DISPUTED_STATUS || (row.status === SCHEDULED_STATUS && deadlineLapsed);
}

/**
 * ONE module-scope predicate builder for the admin sessions directory: the
 * caller-supplied filters conjoined, every member optional. Absent members
 * drop out (they never error); a present member narrows the set. The
 * teacher/student filters compare the session's participant columns
 * directly (both are shared-PK user ids on this schema, so the user-facing
 * filter ids need no join); the type and status filters carry their closed
 * enum vocabularies as bound parameters; the creation window is half-open
 * (`created_at >= dateFrom`, `created_at < dateTo`, UTC instants). A filter
 * object with no members at all yields `undefined` — the caller renders
 * the read without a WHERE clause. The list and its count companion share
 * exactly this one builder, so the paged window and the reported total can
 * never describe different sets.
 */
function buildAdminDirectoryPredicate(filter: AdminSessionListFilterInput): SQL | undefined {
  const conditions: SQL[] = [];
  if (filter.teacherUserId !== undefined) {
    conditions.push(eq(session.teacherId, filter.teacherUserId));
  }
  if (filter.studentUserId !== undefined) {
    conditions.push(eq(session.studentId, filter.studentUserId));
  }
  if (filter.type !== undefined) {
    conditions.push(eq(session.sessionType, filter.type));
  }
  if (filter.status !== undefined) {
    conditions.push(eq(session.status, filter.status));
  }
  if (filter.dateFrom !== undefined) {
    conditions.push(gte(session.createdAt, filter.dateFrom));
  }
  if (filter.dateTo !== undefined) {
    conditions.push(lt(session.createdAt, filter.dateTo));
  }
  if (conditions.length === 0) {
    return undefined;
  }
  return sql.join(conditions, sql` and `);
}

/**
 * Admin directory list read: newest first (`created_at DESC`) with `id DESC`
 * as the deterministic same-instant tiebreak, paged with a bound
 * LIMIT/OFFSET window (an offset past the end yields zero rows — the count
 * companion stays honest). No owner equality exists on this read — the
 * admin surface is role-gated upstream, and ownership scoping is the
 * participant lists' job.
 */
async function listAdminDirectory(
  filter: AdminSessionListFilterInput,
  limit: number,
  offset: number,
  tx?: DBTransaction
): Promise<SessionSelectType[]> {
  const predicate = buildAdminDirectoryPredicate(filter);
  if (tx) {
    return tx
      .select()
      .from(session)
      .where(predicate)
      .orderBy(desc(session.createdAt), desc(session.id))
      .limit(limit)
      .offset(offset);
  }
  // Standalone read — the shared predicate is rendered to parameterized
  // SQL (placeholders $1…) and executed via the queryDb pool path. An
  // all-absent filter renders without a WHERE clause.
  if (predicate === undefined) {
    const unfiltered = await queryDb<SessionSelectType>(
      `SELECT ${SESSION_SELECT_COLUMNS}
       FROM session
       ORDER BY created_at DESC, id DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    return unfiltered.rows;
  }
  const rendered = participantDialect.sqlToQuery(predicate);
  const result = await queryDb<SessionSelectType>(
    `SELECT ${SESSION_SELECT_COLUMNS}
     FROM session
     WHERE ${rendered.sql}
     ORDER BY created_at DESC, id DESC LIMIT $${rendered.params.length + 1} OFFSET $${rendered.params.length + 2}`,
    [...rendered.params, limit, offset]
  );
  return result.rows;
}

/**
 * Admin directory count read — consumes the SAME predicate builder as the
 * list, so the total always describes the exact filtered set the page
 * windows over.
 */
async function countAdminDirectory(filter: AdminSessionListFilterInput, tx?: DBTransaction): Promise<number> {
  const predicate = buildAdminDirectoryPredicate(filter);
  if (tx) {
    const rows = await tx.select({ value: count() }).from(session).where(predicate);
    return rows[0]?.value ?? 0;
  }
  if (predicate === undefined) {
    const unfiltered = await queryDb<{ value: string }>(`SELECT count(*) AS "value" FROM session`, []);
    return Number(unfiltered.rows[0]?.value ?? 0);
  }
  const rendered = participantDialect.sqlToQuery(predicate);
  const result = await queryDb<{ value: string }>(`SELECT count(*) AS "value" FROM session WHERE ${rendered.sql}`, [
    ...rendered.params,
  ]);
  return Number(result.rows[0]?.value ?? 0);
}

/**
 * The admin directory page read as the caller consumes it: the window
 * normalizes before any database work exactly like the participant lists
 * (a page below 1 falls back to the first page, a page size outside 1..50
 * falls back to the default), the resolved offset is additionally capped
 * by the deep-pagination ceiling (a page past the ceiling answers the
 * empty window next to the honest total — the hostile offset never
 * reaches the sorted scan), the page rows and the honest total come from
 * the SAME shared predicate builder, and the derived badge flag is
 * projected per row from one captured clock reading.
 */
async function listAdminDirectoryPage(
  filter: AdminSessionListFilterInput,
  page: number,
  pageSize: number,
  tx?: DBTransaction
): Promise<{ rows: AdminSessionRowReturnType[]; total: number }> {
  const safePage = Number.isSafeInteger(page) && page >= 1 ? page : 1;
  const safePageSize =
    Number.isSafeInteger(pageSize) && pageSize >= 1 && pageSize <= MAX_PAGE_SIZE ? pageSize : DEFAULT_PAGE_SIZE;
  const resolvedOffset = (safePage - 1) * safePageSize;
  if (resolvedOffset > MAX_DIRECTORY_SCAN_ROWS) {
    // Deep-pagination ceiling: the empty window next to the honest total —
    // the hostile offset never reaches the sorted scan.
    return { rows: [], total: await countAdminDirectory(filter, tx) };
  }
  const rows = await listAdminDirectory(filter, safePageSize, resolvedOffset, tx);
  const total = await countAdminDirectory(filter, tx);
  const now = new Date();
  return { rows: rows.map(row => Object.assign({}, row, { needsAttention: isNeedsAttention(row, now) })), total };
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
    `SELECT ${SESSION_SELECT_COLUMNS} FROM session WHERE id = $1 LIMIT 1`,
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
    `SELECT id, status, student_id AS "studentId", teacher_id AS "teacherId", started_at AS "startedAt" FROM session WHERE id = $1 LIMIT 1`,
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
     ORDER BY created_at DESC, id DESC LIMIT $${rendered.params.length + 1} OFFSET $${rendered.params.length + 2}`,
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

/**
 * ONE module-scope predicate builder shared by the admin reschedule and
 * cancel guards: row identity plus the row still being in one of the two
 * states whose timing and hold surface the governance mutations may reshape
 * (pre-start or in-progress).
 */
function buildAdminLiveStatePredicate(id: number): SQL | undefined {
  return and(
    eq(session.id, id),
    or(eq(session.status, SessionStatus.Scheduled), eq(session.status, SessionStatus.Started))
  );
}

async function guardReschedule(
  sessionId: number,
  startedAt: Date,
  endedAt: Date,
  tx?: DBTransaction
): Promise<SessionSelectType | null> {
  const now = new Date();
  const executor = tx ?? db;
  const rows = await executor
    .update(session)
    .set({ startedAt, endedAt, updatedAt: now })
    .where(buildAdminLiveStatePredicate(sessionId))
    .returning();
  return rows[0] ?? null;
}

async function guardCancelPreTerminal(sessionId: number, tx?: DBTransaction): Promise<SessionSelectType | null> {
  const now = new Date();
  const executor = tx ?? db;
  const rows = await executor
    .update(session)
    .set({ status: SessionStatus.Cancelled, feeHeld: false, updatedAt: now })
    .where(buildAdminLiveStatePredicate(sessionId))
    .returning();
  return rows[0] ?? null;
}

export {
  countAdminDisputed,
  countParticipantSessions,
  findById,
  findTransitionProbe,
  guardCancelPreTerminal,
  guardReschedule,
  listAdminDirectoryPage,
  listAdminDisputed,
  listParticipantSessions,
};
