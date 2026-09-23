/**
 * SessionRepository arbitration helpers — the implementations of the
 * post-confirmation dispute primitives, extracted behind the public
 * `SessionRepository` namespace (the max-lines refactor pattern of the
 * sibling helpers modules; the namespace binds them one-to-one so the
 * public API is unchanged). Nothing in this module is part of the public
 * API.
 *
 * The two guarded writes are single conditional UPDATE statements: the
 * full predicate (row identity + participant + lifecycle state + escrow
 * class) and the mutation share one statement, so predicate evaluation
 * happens under PostgreSQL's row lock with zero check-then-write window.
 * A transition that matches zero rows reports `null`; deciding WHY belongs
 * to the caller, which classifies via `findArbitrationProbe` — a cold-path
 * projection read that never feeds writes.
 *
 * Conventions carried over unchanged (per `backend/db/repo/AGENTS.md`):
 *  - every function takes `tx?: DBTransaction` as its LAST parameter;
 *    writes execute on `tx ?? db`, the probe read runs on the caller's
 *    transaction when supplied and falls back to raw parameterized SQL via
 *    `queryDb` otherwise;
 *  - no prepared statements, no SQL line-comment sequences, and the
 *    lifecycle vocabulary is carried by the `SessionStatus` enum members,
 *    never string literals;
 *  - no business logic, no permission checks, no i18n or logging — the
 *    caller decides what `null` means.
 */

import { and, eq, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { db, queryDb } from "@/backend/db";
import { session } from "@/backend/db/schema/classes/session";
import { DisputeResolution } from "@/backend/enum/scheduling/dispute-resolution.enum";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import type {
  AdminDisputeAnalyticsReturnType,
  DBTransaction,
  SessionArbitrationProbeType,
  SessionSelectType,
} from "@/backend/types";

/**
 * Opens a post-confirmation dispute exactly once (the student-only entry
 * for the consumed escrow generation): a single guarded UPDATE whose
 * predicate requires row identity, the caller being the session's student,
 * the row `completed` with the student's dual-confirmation stamp written,
 * AND the escrow already consumed — the held generation (fees still
 * frozen) and the teacher-confirmed-only rows inside their confirmation
 * window are structurally unreachable, as is any replay against a row
 * already disputed. Writes the dispute reason and the dispute stamp from
 * one captured instant. The escrow columns and the completion stamps are
 * deliberately untouched: opening the dispute records intent only, and
 * every financial write belongs to the arbitration outcome that later
 * resolves it.
 *
 * @returns The updated row, or `null` when zero rows matched (unknown id,
 *          non-participant caller, wrong state, missing student stamp, or
 *          a row whose fee is still held — the caller classifies via the
 *          arbitration probe).
 */
export async function openPostConfirmationDisputeOnce(
  id: number,
  studentId: number,
  disputeReason: string,
  tx?: DBTransaction
): Promise<SessionSelectType | null> {
  const now = new Date();
  const executor = tx ?? db;
  const rows = await executor
    .update(session)
    .set({ status: SessionStatus.Disputed, disputeReason, disputedAt: now, updatedAt: now })
    .where(
      and(
        eq(session.id, id),
        eq(session.studentId, studentId),
        eq(session.status, SessionStatus.Completed),
        isNotNull(session.confirmedByStudentAt),
        eq(session.feeHeld, false),
        // Arbitration terminality: a row the admin has already decided
        // (resolved_at stamped — BOTH resolution families stamp it) can
        // never re-enter the disputed state. Without this leg the
        // dispute→arbitrate→dispute loop could re-open a decided case and
        // a second arbitration could move money for the same fee again.
        isNull(session.resolvedAt)
      )
    )
    .returning();
  return rows[0] ?? null;
}

/**
 * Resolves a consumed-escrow dispute into `completed` exactly once (the
 * arbitration completion leg shared by the REFUND, PARTIAL REFUND, and
 * UPHELD outcomes): a single guarded UPDATE whose predicate requires row
 * identity, the disputed state, AND the consumed escrow — a held-generation
 * dispute is structurally unreachable (its own resolutions are the shipped
 * CANCEL/COMPLETE pair), and a row already resolved matches zero rows, so
 * an outcome can never commit twice. Writes the resolution note and stamp
 * from one captured instant and returns the arbitration probe projection
 * (both participants, the fee, the hold marker, the provenance lane, the
 * student's dual-confirmation stamp) so the caller composes the outcome's
 * financial legs — the wallet reversal and the same-lane credit — on the
 * SAME transaction without a re-read. No financial write is part of this
 * method, and the original completion stamps are deliberately preserved
 * (the meeting ended once).
 *
 * @returns The probe-shaped row, or `null` when zero rows matched (unknown
 *          id, a row no longer disputed, or a disputed row whose fee is
 *          still held — the caller classifies via the arbitration probe).
 */
export async function resolveConsumedDisputeOnce(
  id: number,
  resolutionNote: string | null,
  resolutionOutcome: DisputeResolution,
  tx?: DBTransaction
): Promise<SessionArbitrationProbeType | null> {
  const now = new Date();
  const executor = tx ?? db;
  const rows = await executor
    .update(session)
    .set({ status: SessionStatus.Completed, resolutionNote, resolutionOutcome, resolvedAt: now, updatedAt: now })
    .where(and(eq(session.id, id), eq(session.status, SessionStatus.Disputed), eq(session.feeHeld, false)))
    .returning({
      id: session.id,
      status: session.status,
      studentId: session.studentId,
      teacherId: session.teacherId,
      fee: session.fee,
      feeHeld: session.feeHeld,
      heldBalanceLane: session.heldBalanceLane,
      confirmedByStudentAt: session.confirmedByStudentAt,
      resolutionOutcome: session.resolutionOutcome,
      resolvedAt: session.resolvedAt,
    });
  return rows[0] ?? null;
}

/**
 * Arbitration classification probe: the escrow-focused column projection
 * (identity + lifecycle state + both participants + the fee, the hold
 * marker, the permanent provenance lane, and the student's dual-confirmation
 * stamp) — the transition probe's financial twin. A `null` lane on a
 * returned probe means no fee was ever held. Classification-only: it never
 * gates or feeds a write. On the caller's transaction it runs as a Drizzle
 * select; standalone it runs as raw parameterized SQL via the queryDb pool
 * path.
 */
export async function findArbitrationProbe(
  id: number,
  tx?: DBTransaction
): Promise<SessionArbitrationProbeType | null> {
  const projection = {
    id: session.id,
    status: session.status,
    studentId: session.studentId,
    teacherId: session.teacherId,
    fee: session.fee,
    feeHeld: session.feeHeld,
    heldBalanceLane: session.heldBalanceLane,
    confirmedByStudentAt: session.confirmedByStudentAt,
    resolutionOutcome: session.resolutionOutcome,
    resolvedAt: session.resolvedAt,
  };
  if (tx) {
    const rows = await tx.select(projection).from(session).where(eq(session.id, id)).limit(1);
    return rows[0] ?? null;
  }
  const result = await queryDb<SessionArbitrationProbeType>(
    `SELECT id, status, student_id AS "studentId", teacher_id AS "teacherId", fee,
     fee_held AS "feeHeld", held_balance_lane AS "heldBalanceLane",
     confirmed_by_student_at AS "confirmedByStudentAt",
     resolution_outcome AS "resolutionOutcome",
     resolved_at AS "resolvedAt"
     FROM session WHERE id = $1 LIMIT 1`,
    [id]
  );
  return result.rows[0] ?? null;
}

/**
 * The admin dispute-analytics counts, aggregated in ONE table pass: the
 * open disputes (the same pinned `disputed` membership the arbitration
 * queue serves), the resolved total (any stamped `resolved_at` — both
 * escrow generations), and one filtered count per `DisputeResolution`
 * member over the persisted `resolution_outcome` column. The lifecycle
 * and outcome vocabularies ride the canonical enum members as bound
 * parameters — never string literals. A read-only aggregate: no lock is
 * taken beyond the scan's MVCC snapshot, and an empty table answers the
 * all-zero row (zero is the honest empty analytics state).
 */
export async function getDisputeAnalyticsCounts(tx?: DBTransaction): Promise<AdminDisputeAnalyticsReturnType> {
  const executor = tx ?? db;
  const rows = await executor
    .select({
      openDisputes: sql<number>`count(*) filter (where ${session.status} = ${SessionStatus.Disputed})`.mapWith(Number),
      resolvedDisputes: sql<number>`count(*) filter (where ${session.resolvedAt} is not null)`.mapWith(Number),
      cancelCount:
        sql<number>`count(*) filter (where ${session.resolutionOutcome} = ${DisputeResolution.Cancel})`.mapWith(Number),
      completeCount:
        sql<number>`count(*) filter (where ${session.resolutionOutcome} = ${DisputeResolution.Complete})`.mapWith(
          Number
        ),
      refundCount:
        sql<number>`count(*) filter (where ${session.resolutionOutcome} = ${DisputeResolution.Refund})`.mapWith(Number),
      partialRefundCount:
        sql<number>`count(*) filter (where ${session.resolutionOutcome} = ${DisputeResolution.PartialRefund})`.mapWith(
          Number
        ),
      upholdCount:
        sql<number>`count(*) filter (where ${session.resolutionOutcome} = ${DisputeResolution.Uphold})`.mapWith(Number),
    })
    .from(session);
  const row = rows[0];
  return {
    openDisputes: row?.openDisputes ?? 0,
    resolvedDisputes: row?.resolvedDisputes ?? 0,
    cancelCount: row?.cancelCount ?? 0,
    completeCount: row?.completeCount ?? 0,
    refundCount: row?.refundCount ?? 0,
    partialRefundCount: row?.partialRefundCount ?? 0,
    upholdCount: row?.upholdCount ?? 0,
  };
}

/**
 * Admin teacher-reassignment guard: a single guarded UPDATE whose
 * predicate requires row identity, the row still being `scheduled`, and
 * the row's owning teacher being DIFFERENT from the candidate — the only
 * state in which the owning teacher may be swapped (an in-progress or
 * finished meeting has its teacher fixed, and a disputed row belongs to
 * arbitration). The different-teacher fold is fail-closed: a same-teacher
 * call (a no-op swap) matches zero rows like any other ineligible state —
 * the eligibility-fold pattern — so the caller's transition probe
 * classifies it as the state conflict with zero writes, never as a
 * silent success. Writes ONLY the replacement teacher id plus the audit
 * stamp from one captured instant — the candidate's certification is the
 * CALLER's pre-write assertion (the fused certification re-assertion
 * shape of `completeSessionOnce` is the lifecycle's own pattern for
 * writes that cannot tolerate the gap).
 *
 * @returns The updated row, or `null` when zero rows matched (unknown id,
 *          a row no longer `scheduled`, or a same-teacher candidate —
 *          the caller classifies via the transition probe).
 */
export async function guardReassignTeacher(
  sessionId: number,
  newTeacherId: number,
  tx?: DBTransaction
): Promise<SessionSelectType | null> {
  const now = new Date();
  const executor = tx ?? db;
  const rows = await executor
    .update(session)
    .set({ teacherId: newTeacherId, updatedAt: now })
    .where(
      and(eq(session.id, sessionId), eq(session.status, SessionStatus.Scheduled), ne(session.teacherId, newTeacherId))
    )
    .returning();
  return rows[0] ?? null;
}
