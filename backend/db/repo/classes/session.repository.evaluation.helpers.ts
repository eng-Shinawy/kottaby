/**
 * SessionRepository evaluation-booking helpers — the four cycle reads the
 * evaluation-booking write path, its read resolvers, and the evaluator's
 * rubric surface share (one implementation each): the active-cycle probe,
 * the per-cycle aggregate, the applicant evaluation-session list, and the
 * evaluator's completed-but-unscored rubric-session page. The public
 * surface stays the `SessionRepository` namespace in `session.repository.ts`:
 * each function below backs the namespace method of the same name as a
 * one-to-one delegation target. Nothing in this module is part of the
 * public API.
 *
 * Conventions (per `backend/db/repo/AGENTS.md`):
 *  - the cycle probe, the aggregate, and the pending-rubric list take
 *    `tx: DBTransaction` as a REQUIRED last parameter — the cycle, capacity,
 *    and quorum decisions must observe the caller transaction's own writes
 *    (the applicant row lock is held by the caller across both reads, and
 *    the pending page + its count must share the one executor/snapshot);
 *  - the applicant list read takes `tx?: DBQueryExecutor`: a Drizzle
 *    executor runs the typed page + count reads on the supplied
 *    transaction; a checked-out PoolClient runs the same parameterized SQL
 *    on the SUPPLIED client (session-faithful); a caller without an
 *    executor falls back to raw parameterized SQL via `queryDb` (the
 *    Neon-HTTP-eligible pool path). A bare `Pool` is not a supported
 *    executor arm — it carries no caller session to be faithful to and
 *    degrades to the same `queryDb` pool path;
 *  - NO prepared statements, NO array-membership operators, NO SQL
 *    line-comment sequences in any statement;
 *  - no business logic, no permission checks, no i18n or logging — each
 *    helper returns plain row shapes; the caller decides what the counts,
 *    the cycle window, and a `null` mean.
 */

import { and, count, desc, eq, gte, isNull, type SQL, sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { PoolClient, QueryResultRow } from "pg";
import { queryDb } from "@/backend/db";
import { plans } from "@/backend/db/schema/billing/plans";
import { subscriptions } from "@/backend/db/schema/billing/subscriptions";
import { session } from "@/backend/db/schema/classes/session";
import { evaluations } from "@/backend/db/schema/teachers/evaluations";
import { SubscriptionStatus } from "@/backend/enum/billing/subscription-status.enum";
import { SessionIntent } from "@/backend/enum/scheduling/session-intent.enum";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import { SessionType } from "@/backend/enum/scheduling/session-type.enum";
import type { DBQueryExecutor, DBTransaction, SessionSelectType } from "@/backend/types";
import { VERIFICATION_PLAN_TITLE } from "@/shared/constants/verification-plan.constants";

/**
 * `EvaluationCycleWindow` — the raw cycle-projection shape returned by
 * `resolveCurrentEvaluationCycle`: the `startDate` of the applicant's
 * newest ACTIVE verification subscription (`null` = no active cycle — the
 * loop is closed) plus that subscription's id. The service layer derives
 * the entitlement math from the window; this module only reads it.
 */
export interface EvaluationCycleWindow {
  readonly cycleStart: Date | null;
  readonly activeSubscriptionId: number | null;
}

/**
 * `EvaluationSessionListFilter` — repo-internal filter shape for the
 * applicant evaluation-session listing: the optional lifecycle-state
 * filter (`null`/absent = no constraint — the member drops out of the
 * WHERE chain) plus the caller's page window, which the helper normalizes
 * (sane-fallback, never thrown) before any database work.
 */
export interface EvaluationSessionListFilter {
  readonly status?: SessionStatus | null;
  readonly page: number;
  readonly pageSize: number;
}

/**
 * `RubricPendingSessionsFilter` — repo-internal filter shape for the
 * evaluator's pending-rubric listing: just the caller's page window, which
 * the helper normalizes (sane-fallback, never thrown) before any database
 * work.
 */
interface RubricPendingSessionsFilter {
  readonly page: number;
  readonly pageSize: number;
}

/** Upper bound of the evaluation list page size and its fallback — the participant lists' clamp window (1..50, default 25), applied before any database work so the read never fabricates a window. */
const MAX_PAGE_SIZE = 50;
const DEFAULT_PAGE_SIZE = 25;

/** Upper bound and fallback of the pending-rubric list page window (1..100, default 25), applied before any database work. */
const RUBRIC_PENDING_MAX_PAGE_SIZE = 100;

/** Column alias list for the list read's raw-SQL branches — mirrors `$inferSelect` typing 1:1. */
const EVALUATION_SESSION_SELECT_COLUMNS = `
  id, teacher_id AS "teacherId", student_id AS "studentId", status,
  session_type AS "sessionType", intent, fee, fee_held AS "feeHeld", held_balance_lane AS "heldBalanceLane",
  started_at AS "startedAt", ended_at AS "endedAt", confirmed_by_student_at AS "confirmedByStudentAt",
  confirmed_by_teacher_at AS "confirmedByTeacherAt", confirmation_deadline AS "confirmationDeadline",
  cancel_reason AS "cancelReason", dispute_reason AS "disputeReason", disputed_at AS "disputedAt",
  resolution_note AS "resolutionNote", resolution_outcome AS "resolutionOutcome", resolved_at AS "resolvedAt",
  created_at AS "createdAt", updated_at AS "updatedAt"`;

/** Stateless renderer used to translate the shared predicate into raw-read SQL. */
const evaluationDialect = new PgDialect();

/**
 * ONE module-scope predicate builder shared by the aggregate and the list
 * (and by every executor branch): the owner equality on the session's
 * student leg, the session type pinned to the teacher-evaluation member,
 * and, only when a status filter is provided, the lifecycle-state
 * equality. The vocabularies flow as bound parameters from the
 * `SessionStatus`/`SessionType` enums, so the set the aggregate counts and
 * the set the list pages over are decided by exactly this one function.
 */
function buildEvaluationSessionPredicate(applicantUserId: number, status: SessionStatus | null): SQL {
  const conditions: SQL[] = [
    eq(session.studentId, applicantUserId),
    eq(session.sessionType, SessionType.TeacherEvaluation),
  ];
  if (status !== null) {
    conditions.push(eq(session.status, status));
  }
  return sql.join(conditions, sql` and `);
}

/**
 * ONE raw-read runner for the list read's non-Drizzle executor paths: a
 * checked-out PoolClient runs the SAME parameterized SQL on the SUPPLIED
 * client (session-faithful — the read stays inside the caller's
 * session/transaction); a `Pool` argument or no executor runs via
 * `queryDb` (the Neon-HTTP-eligible pool path).
 */
async function runEvaluationRead<T extends QueryResultRow>(
  tx: PoolClient | null,
  text: string,
  params: ReadonlyArray<unknown>
): Promise<T[]> {
  if (tx) {
    const result = await tx.query<T>(text, [...params]);
    return result.rows;
  }
  const result = await queryDb<T>(text, params);
  return result.rows;
}

/**
 * Active-verification-cycle probe: resolves the applicant's CURRENT
 * evaluation cycle window — the newest ACTIVE `subscriptions` row owned by
 * the applicant whose plan is the verification plan (resolved by its
 * pinned title), read as `{ cycleStart, activeSubscriptionId }` with the
 * `start_date DESC, id DESC` deterministic tiebreak. Pure read: it never
 * gates or influences a write; a `null` cycleStart means no active cycle.
 * `tx` is REQUIRED: the cycle decision must observe the caller
 * transaction's own writes.
 *
 * @returns The cycle window; `{ cycleStart: null, activeSubscriptionId:
 *          null }` when no active verification subscription exists.
 */
export async function resolveCurrentEvaluationCycle(
  applicantUserId: number,
  tx: DBTransaction
): Promise<EvaluationCycleWindow> {
  const rows = await tx
    .select({
      activeSubscriptionId: subscriptions.id,
      cycleStart: subscriptions.startDate,
    })
    .from(subscriptions)
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .where(
      and(
        eq(subscriptions.userId, applicantUserId),
        eq(subscriptions.status, SubscriptionStatus.Active),
        eq(plans.title, VERIFICATION_PLAN_TITLE)
      )
    )
    .orderBy(desc(subscriptions.startDate), desc(subscriptions.id))
    .limit(1);
  return rows[0] ?? { activeSubscriptionId: null, cycleStart: null };
}

/**
 * Per-cycle aggregate: counts the applicant's evaluation bookings inside
 * one purchased cycle in ONE table pass — the non-cancelled count (credits
 * consumed by live or completed bookings), the completed count, and the
 * DISTINCT evaluator ids of the non-cancelled rows (the distinctness
 * memory). The cycle is the half-open creation window
 * (`created_at >= cycleStart`); prior-cycle rows are excluded (they
 * created history, not entitlements). The lifecycle and type vocabularies
 * ride the canonical enum members as bound parameters — never string
 * literals — and every comparison is `=`/`>=`/`<>` on bound values (no
 * array-membership operator anywhere).
 *
 * `tx` is REQUIRED: the aggregate runs under the caller's applicant row
 * lock, so a rival booking's committed insert is visible before the
 * capacity decision.
 *
 * @returns `{ booked, completed, evaluators }` — zero counts and an empty
 *          evaluator list when the cycle holds no non-cancelled rows.
 */
export async function countEvaluationBookingsInCycle(
  applicantUserId: number,
  cycleStart: Date,
  tx: DBTransaction
): Promise<{ booked: number; completed: number; evaluators: number[] }> {
  const rows = await tx
    .select({
      booked: sql<number>`count(*) filter (where ${session.status} <> ${SessionStatus.Cancelled})`.mapWith(Number),
      completed: sql<number>`count(*) filter (where ${session.status} = ${SessionStatus.Completed})`.mapWith(Number),
      evaluators: sql<
        number[] | null
      >`array_agg(distinct ${session.teacherId}) filter (where ${session.status} <> ${SessionStatus.Cancelled})`,
    })
    .from(session)
    .where(
      and(
        eq(session.studentId, applicantUserId),
        eq(session.sessionType, SessionType.TeacherEvaluation),
        gte(session.createdAt, cycleStart)
      )
    );
  const row = rows[0];
  return {
    booked: row?.booked ?? 0,
    completed: row?.completed ?? 0,
    evaluators: row?.evaluators ?? [],
  };
}

/**
 * Lists the applicant's own evaluation sessions, newest first, paged: the
 * owner equality on the session's student leg plus the session type pinned
 * to the teacher-evaluation member (the shared predicate builder), an
 * optional lifecycle-state filter, and a normalized page window (a page
 * below 1 falls back to the first page, a page size outside 1..50 falls
 * back to the default — the read never fabricates a window). The page
 * query and the same-predicate `count(*)` describe one filtered set, so
 * the total is always honest.
 *
 * Read-only and standalone-capable: see the module doc block for the
 * executor routing.
 *
 * @returns The page rows plus the honest total (an out-of-range page
 *          yields an empty `items` array with the unchanged total).
 */
export async function listEvaluationSessionsForApplicant(
  applicantUserId: number,
  filter: EvaluationSessionListFilter,
  tx?: DBQueryExecutor
): Promise<{ items: SessionSelectType[]; total: number }> {
  const safePage = Number.isSafeInteger(filter.page) && filter.page >= 1 ? filter.page : 1;
  const safePageSize =
    Number.isSafeInteger(filter.pageSize) && filter.pageSize >= 1 && filter.pageSize <= MAX_PAGE_SIZE
      ? filter.pageSize
      : DEFAULT_PAGE_SIZE;
  const resolvedOffset = (safePage - 1) * safePageSize;
  const predicate = buildEvaluationSessionPredicate(applicantUserId, filter.status ?? null);
  if (tx && typeof tx === "object" && "select" in tx) {
    // Drizzle executor (transaction) — typed page + count reads on the
    // supplied executor, sharing the ONE predicate builder.
    const [items, countRows] = await Promise.all([
      tx
        .select()
        .from(session)
        .where(predicate)
        .orderBy(desc(session.createdAt), desc(session.id))
        .limit(safePageSize)
        .offset(resolvedOffset),
      tx.select({ value: count() }).from(session).where(predicate),
    ]);
    return { items, total: countRows[0]?.value ?? 0 };
  }
  // Pool-client / standalone read — the SAME predicate is rendered to
  // parameterized SQL (placeholders $1…) and executed on the checked-out
  // client when one is supplied (session-faithful) or via the queryDb pool
  // path otherwise.
  const rendered = evaluationDialect.sqlToQuery(predicate);
  const poolClient = tx && isPoolClientExecutor(tx) ? tx : null;
  const items = await runEvaluationRead<SessionSelectType>(
    poolClient,
    `SELECT ${EVALUATION_SESSION_SELECT_COLUMNS}
     FROM session
     WHERE ${rendered.sql}
     ORDER BY created_at DESC, id DESC LIMIT $${rendered.params.length + 1} OFFSET $${rendered.params.length + 2}`,
    [...rendered.params, safePageSize, resolvedOffset]
  );
  const countRows = await runEvaluationRead<{ value: string }>(
    poolClient,
    `SELECT count(*) AS "value" FROM session WHERE ${rendered.sql}`,
    [...rendered.params]
  );
  return { items, total: Number(countRows[0]?.value ?? 0) };
}

/**
 * Type guard — narrows `DBQueryExecutor` to a checked-out `PoolClient`.
 *
 * A `PoolClient` (pg) carries no Drizzle cursor; its runtime fingerprint is
 * the `.release()` method that returns it to the pool. The Drizzle-branch
 * check (`.select` presence) cannot recognize it, so without this guard a
 * supplied client would fall through to `queryDb` and execute on the
 * GLOBAL pool — outside the caller's session/transaction.
 */
function isPoolClientExecutor(tx: DBQueryExecutor): tx is PoolClient {
  return typeof tx === "object" && "release" in tx && typeof tx.release === "function";
}

/**
 * Lists the evaluator's OWN completed evaluation sessions that still await
 * a rubric submission, newest first, paged: a LEFT JOIN anti-join against
 * the evaluator's own `evaluations` rows (the join binds BOTH the session
 * link and the evaluator id, and the predicate keeps only the rows whose
 * joined side is NULL — a session this evaluator already scored drops
 * out, while another evaluator's submission on it changes nothing), over
 * the owner equality on the session's teacher leg, the session type pinned
 * to the teacher-evaluation member, the evaluation-intent pin (the same
 * value-import enum member the submission gate enforces — the read gate
 * and the write gate describe one and the same session set), and the
 * completed lifecycle state.
 * The (session_id, evaluator_id) unique arbiter caps the join at one row
 * per session, so the anti-join never multiplies rows and the page count
 * stays honest.
 *
 * The page window normalizes with the same sane-fallback shape the
 * applicant list uses — a page below 1 falls back to the first page, a
 * page size outside 1..100 falls back to the default 25 — and never
 * throws. The page query and the same-predicate `count(*)` describe one
 * filtered set, so the total is always honest.
 *
 * `tx` is REQUIRED: the caller resolves the evaluator's certification
 * inside the same transaction and the page must observe that snapshot.
 *
 * @returns The page rows plus the honest total (an out-of-range page
 *          yields an empty `items` array with the unchanged total).
 */
export async function listCompletedRubricPendingSessions(
  evaluatorUserId: number,
  filter: RubricPendingSessionsFilter,
  tx: DBTransaction
): Promise<{ items: SessionSelectType[]; totalCount: number }> {
  const safePage = Number.isSafeInteger(filter.page) && filter.page >= 1 ? filter.page : 1;
  const safePageSize =
    Number.isSafeInteger(filter.pageSize) && filter.pageSize >= 1 && filter.pageSize <= RUBRIC_PENDING_MAX_PAGE_SIZE
      ? filter.pageSize
      : DEFAULT_PAGE_SIZE;
  const resolvedOffset = (safePage - 1) * safePageSize;
  const ownSubmissionJoin = and(eq(evaluations.sessionId, session.id), eq(evaluations.evaluatorId, evaluatorUserId));
  const pendingPredicate = and(
    eq(session.teacherId, evaluatorUserId),
    eq(session.sessionType, SessionType.TeacherEvaluation),
    // The intent pin mirrors the submission gate's semantics: only
    // evaluation-intent sessions are scorable, so only those are pending.
    eq(session.intent, SessionIntent.Evaluation),
    eq(session.status, SessionStatus.Completed),
    isNull(evaluations.id)
  );
  const [rows, countRows] = await Promise.all([
    tx
      .select({ sessionRow: session })
      .from(session)
      .leftJoin(evaluations, ownSubmissionJoin)
      .where(pendingPredicate)
      .orderBy(desc(session.createdAt), desc(session.id))
      .limit(safePageSize)
      .offset(resolvedOffset),
    tx.select({ value: count() }).from(session).leftJoin(evaluations, ownSubmissionJoin).where(pendingPredicate),
  ]);
  return { items: rows.map(row => row.sessionRow), totalCount: countRows[0]?.value ?? 0 };
}
