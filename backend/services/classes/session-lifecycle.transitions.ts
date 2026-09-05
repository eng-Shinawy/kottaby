/**
 * SessionLifecycleService — transition-denial classification and the
 * held-balance refund primitive (module extraction, behavior-identical).
 *
 * `rejectTransitionMiss` classifies a zero-row guarded transition by ONE
 * cold probe read, then throws the typed denial. The probe is
 * classification-only — it never gates or influences any write.
 *
 * Classification (after the probe):
 *  - unknown id → session-not-found;
 *  - a caller the row does not belong to → session-not-found (oracle-safe:
 *    a foreign target is indistinguishable from a nonexistent one) — for
 *    the participant kinds; the admin arbitration kind is role-gated
 *    upstream and NOT participant-gated, so any existing row that missed
 *    is a lifecycle-state conflict;
 *  - everything else is a lifecycle-state conflict — EXCEPT the completion
 *    of an owned in-progress row: there the fused certification predicate
 *    inside the guarded statement MAY be the miss cause, but a concurrent
 *    start committing between the guarded statement and this probe leaves
 *    the same observable shape, so the typed certification conflict is
 *    surfaced ONLY after a fresh FOR UPDATE certification re-check on the
 *    caller's transaction; an owned in-progress row with a verifiably
 *    certified teacher honestly classifies as the generic state conflict.
 *
 * `refundHeldLaneToProvenance` is the ONE same-lane refund primitive shared
 * by the participant cancel and the arbitration CANCEL outcome, always on
 * the caller's transaction (the refund and its status flip commit atomically
 * or not at all). The provenance column is a varchar read back from the
 * row: an unreadable value fails closed (the refusal rolls the
 * cancellation/resolution back, leaving the hold and the row consistent).
 *
 * `refundSweptHolds` drives the confirmation-deadline sweeper's refunds
 * SEQUENTIALLY BY DESIGN through the same primitive: every refund composes
 * on the ONE sweep transaction — interleaving them would obscure the
 * fail-closed ordering (an unreadable-lane refusal rolls the whole sweep
 * back) for zero speedup on a single connection. The sequential walk is a
 * recursive helper (no loop) so the statement order is head-first and
 * identical to the original flow; lane-less rows are pre-filtered
 * SYNCHRONOUSLY before the walk so the recursion only ever happens ACROSS
 * awaits (each await yields and unwinds the stack) — a synchronous skip
 * chain over an unbounded run of null-lane rows would exhaust the call
 * stack and abort the whole sweep transaction.
 *
 * The public surface stays the `SessionLifecycleService` namespace in
 * `session-lifecycle.service.ts`. Nothing in this module is part of the
 * public API.
 */

import { SessionRepository, StudentRepository, TeacherRepository } from "@/backend/db/repo";
import { isHeldBalanceLane } from "@/backend/enum/scheduling/held-balance-lane.enum";
import { ConflictError, NotFoundError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import { SESSION_STARTED_STATUS } from "@/backend/services/classes/session-lifecycle.guards";
import type { DBTransaction, SessionReturnType } from "@/backend/types";
import type { getServerTranslations } from "@/shared/locale/server-graphql";

/**
 * Oracle-safe not-found denial: the unknown-id / non-participant arm —
 * a foreign target is indistinguishable from a nonexistent one.
 */
function rejectSessionNotFound(
  denial: string,
  sessionId: number,
  t: ReturnType<typeof getServerTranslations>["errorsTranslations"]
): never {
  logger.logDomainError(denial, {
    code: "SESSION_NOT_FOUND",
    entity: "session",
    entityId: sessionId,
  });
  throw new NotFoundError("SESSION", t.sessionNotFound);
}

/** Lifecycle-state conflict denial: the row exists but missed the guarded predicate. */
function rejectStateConflict(
  denial: string,
  sessionId: number,
  t: ReturnType<typeof getServerTranslations>["errorsTranslations"]
): never {
  logger.logDomainError(denial, {
    code: "SESSION_INVALID_TRANSITION",
    entity: "session",
    entityId: sessionId,
  });
  throw new ConflictError("SESSION_INVALID_TRANSITION", t.sessionInvalidTransition);
}

/**
 * Certification conflict denial: the owned in-progress completion miss —
 * the fused certification predicate inside the guarded statement rejected
 * the caller.
 */
function rejectCertificationConflict(
  sessionId: number,
  t: ReturnType<typeof getServerTranslations>["errorsTranslations"]
): never {
  logger.logDomainError("Session completion denied: teacher certification no longer active", {
    code: "TEACHER_NOT_CERTIFIED",
    entity: "session",
    entityId: sessionId,
  });
  throw new ConflictError("TEACHER_NOT_CERTIFIED", t.teacherNotCertified);
}

/**
 * Completion-miss classification for the OWNING teacher (the caller already
 * passed the participant and start gates): a row not in-progress is a state
 * conflict; an owned in-progress row is AMBIGUOUS — the fused certification
 * predicate inside the guarded statement may have rejected the caller, OR a
 * concurrent start committed between the guarded statement and this probe
 * (the row was still `scheduled` at statement time). The typed certification
 * conflict is surfaced ONLY when the teacher's certification verifiably
 * fails (fresh FOR UPDATE re-check on the caller's transaction); without a
 * transaction the re-check is impossible, so the honest answer is the
 * generic state conflict.
 */
async function rejectCompletionMiss(
  sessionId: number,
  teacherId: number,
  tx: DBTransaction | undefined,
  t: ReturnType<typeof getServerTranslations>["errorsTranslations"]
): Promise<never> {
  if (tx !== undefined) {
    const lockedTeacher = await TeacherRepository.lockForCertificationCheck(teacherId, tx);
    if (lockedTeacher?.isApproved !== true) {
      return rejectCertificationConflict(sessionId, t);
    }
  }
  return rejectStateConflict("Session transition denied: session not completable in its current state", sessionId, t);
}

/**
 * Classifies a zero-row guarded transition by ONE cold probe read, then
 * throws the typed denial (see the module docblock for the full
 * classification table). The probe row's status is the raw pg-enum string
 * union, so it is compared against the enum-derived module-scope constant —
 * the vocabulary still flows from the enum, never from a bare literal.
 */
export async function rejectTransitionMiss(
  kind: "teacherStart" | "teacherComplete" | "participantCancel" | "participantDispute" | "adminResolve",
  sessionId: number,
  actorUserId: number,
  tx: DBTransaction | undefined,
  t: ReturnType<typeof getServerTranslations>["errorsTranslations"]
): Promise<never> {
  const probe = await SessionRepository.findTransitionProbe(sessionId, tx);
  if (probe === null) {
    return rejectSessionNotFound("Session transition denied: session not found", sessionId, t);
  }
  if (kind === "participantCancel" || kind === "participantDispute") {
    if (probe.studentId !== actorUserId && probe.teacherId !== actorUserId) {
      return rejectSessionNotFound(
        kind === "participantCancel"
          ? "Session transition denied: caller is not a participant"
          : "Session dispute denied: caller is not a participant",
        sessionId,
        t
      );
    }
    // The row exists and the caller participates: every remaining miss
    // cause (a terminal / already-disputed state, or a row mid-transition
    // at the guarded statement's instant) is lifecycle-state-class.
    return rejectStateConflict(
      kind === "participantCancel"
        ? "Session transition denied: session not cancellable in its current state"
        : "Session dispute denied: session not disputable in its current state",
      sessionId,
      t
    );
  }
  if (kind === "adminResolve") {
    // The arbitration surface is role-gated upstream and NOT
    // participant-gated: any existing row that failed the guarded
    // predicate is a lifecycle-state conflict (the admin is trusted to
    // see state, never participant membership).
    return rejectStateConflict("Session arbitration denied: session not resolvable in its current state", sessionId, t);
  }
  if (probe.teacherId !== actorUserId) {
    // Start/complete are teacher-side actions: a student participant (or
    // any other caller) is foreign — oracle-safe not-found.
    return rejectSessionNotFound("Session transition denied: caller is not the owning teacher", sessionId, t);
  }
  if (kind === "teacherStart") {
    // The row exists and the caller owns it: every remaining miss cause
    // (the row no longer pre-start, or mid-transition at the guarded
    // statement's instant) is lifecycle-state-class.
    return rejectStateConflict("Session transition denied: session not startable in its current state", sessionId, t);
  }
  // Completion miss for the owning teacher — the ambiguous
  // certification-vs-concurrent-start arm (see `rejectCompletionMiss`).
  if (probe.status !== SESSION_STARTED_STATUS) {
    return rejectStateConflict("Session transition denied: session not completable in its current state", sessionId, t);
  }
  return rejectCompletionMiss(sessionId, probe.teacherId, tx, t);
}

/**
 * Refunds a cancelled/resolved row's held fee to its recorded provenance
 * lane — the ONE same-lane primitive shared by the participant cancel and
 * the arbitration CANCEL outcome, always on the caller's transaction
 * (the refund and its status flip commit atomically or not at all). A
 * row with no recorded lane has nothing to refund. The provenance column
 * is a varchar read back from the row: an unreadable value fails closed
 * (the refusal rolls the cancellation/resolution back, leaving the hold
 * and the row consistent).
 */
export async function refundHeldLaneToProvenance(
  resolved: SessionReturnType,
  context: "cancelSession" | "resolveSessionDispute" | "sweepExpiredSessions",
  tx: DBTransaction
): Promise<void> {
  if (resolved.heldBalanceLane === null) {
    return;
  }
  if (!isHeldBalanceLane(resolved.heldBalanceLane)) {
    logger.error("Session lifecycle blocked: unreadable held-balance lane", {
      sessionId: resolved.id,
    });
    throw new Error(`SessionLifecycleService.${context}: unreadable held-balance lane`);
  }
  await StudentRepository.incrementLane(resolved.studentId, resolved.heldBalanceLane, tx);
}

/**
 * Sequential head-first refund walk over the sweeper's held rows —
 * the recursive-helper shape of the sweeper's by-design sequential loop
 * (see the module docblock). Callers pre-filter lane-less rows (see
 * `refundSweptHolds`); a null lane reaching this walk still refunds
 * nothing (the primitive skips it) and contributes zero to the count.
 */
async function refundHeldRowsSequentially(
  rows: readonly SessionReturnType[],
  index: number,
  tx: DBTransaction
): Promise<number> {
  if (index >= rows.length) {
    return 0;
  }
  const row = rows[index];
  await refundHeldLaneToProvenance(row, "sweepExpiredSessions", tx);
  const restRefunded = await refundHeldRowsSequentially(rows, index + 1, tx);
  return (row.heldBalanceLane === null ? 0 : 1) + restRefunded;
}

/**
 * Refunds every swept row that still carries a hold, sequentially on the
 * caller's sweep transaction, and returns the refunded-hold count. The
 * lane-less rows are pre-filtered synchronously (bounded stack — see the
 * module docblock) before the recursive walk.
 */
export async function refundSweptHolds(rows: readonly SessionReturnType[], tx: DBTransaction): Promise<number> {
  const heldRows = rows.filter(row => row.heldBalanceLane !== null);
  return refundHeldRowsSequentially(heldRows, 0, tx);
}
