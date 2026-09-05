/**
 * SessionLifecycleService — the booking + lifecycle state machine for the
 * `session` entity (scheduled → started → completed | cancelled, with both
 * live states able to pass through `disputed`: scheduled|started → disputed
 * → cancelled|completed under admin arbitration).
 *
 * Booking (`createSession`) composes FOUR writes inside ONE transaction, in a
 * fixed order that is never reordered:
 *   1. the teacher certification lock (a `SELECT … FOR UPDATE` read whose
 *      certification value is the one the booking commits against);
 *   2. the guarded trial-first balance debit ladder (the trial lane is
 *      attempted first, then the intent's own lane; an all-miss booking
 *      throws and the transaction rolls back — the rollback is the only
 *      cleanup, no compensating writes exist);
 *   3. the idempotency claim insert (savepoint-bracketed so a duplicate key
 *      rolls back only the claim statement and keeps the surrounding
 *      transaction readable for the replay lookup);
 *   4. the session insert with server-side defaults (lifecycle state, type,
 *      intent, platform fee, hold marker + provenance lane, confirmation
 *      deadline) followed by the claim's session-id backfill.
 * A replayed booking (duplicate claim key) THROWS `ConflictError(
 * "DUPLICATE_REQUEST")` — never a row.
 * Throwing is what keeps the replayed attempt free of charge: its own
 * partial writes roll back with the transaction (zero new rows, no second
 * debit); the success-equivalent experience is the client-side mapping of
 * the 409 per the error-handling contract.
 *
 * Every path guards the caller-supplied target session id as a positive
 * safe integer BEFORE any database work: the three mutations deny
 * a malformed id with the canonical `VALIDATION` error, and the participant
 * read degrades one to the oracle-safe `null` — a garbage id can never reach
 * SQL.
 *
 * Transitions (`startSession` / `completeSession` / `cancelSession`) are
 * single guarded repository UPDATEs; a zero-row match is classified by ONE
 * cold probe read that never influences any write. Cancellation refunds the
 * lane that funded the hold inside the same transaction, and keeps the start
 * stamp while never writing an end stamp; the trimmed reason persists inside
 * the guarded UPDATE itself. Disputes (`openSessionDispute`) are the same
 * participant-guarded shape from either live state; the arbitration
 * (`resolveSessionDispute`) is admin-only (defense-in-depth role re-check
 * on top of the GraphQL scope gate) and resolves a disputed row into exactly
 * one terminal state — CANCEL refunds the recorded lane through the SAME
 * same-lane primitive the participant cancel uses (one transaction, no
 * partial application), COMPLETE requires a written start stamp and consumes
 * the hold without any wallet credit. Reads are participant-scoped and
 * oracle-safe: a foreign id is indistinguishable from a nonexistent one
 * (the admin arbitration surface distinguishes state, never participants).
 *
 * Governance re-checks (deleted/blocked/suspended callers) re-assert the
 * login/SSR fail-closed gate at the service boundary as defense in depth.
 * Cancellation is deliberately exempt so a governed participant can still
 * release an in-flight hold later.
 *
 * Cross-surface dependency policy: the module's ONLY cross-surface
 * dependency is the wallet repository, composed into the dual-confirmation
 * flow to credit the teacher's earnings when the student confirms a
 * completed session; it imports nothing from the notification, audit, or
 * report surfaces. All user-facing messages resolve through
 * `getServerTranslations(locale)`;
 * rejections log via `logger.logDomainError` with `{code, entity, entityId}`
 * only — never idempotency keys, payloads, or the other participant's data.
 * No module-level mutable state; no swallowed catches; every mutation flow
 * is one transaction with `tx` propagated to every repository call.
 *
 * File layout: the flow internals live in sibling modules extracted
 * verbatim (behavior-identical max-lines refactor) —
 * `session-lifecycle.guards.ts` (pure pre-DB guards/normalizers and the
 * probe-status widenings), `session-lifecycle.governance.ts` (actor/admin
 * governance re-checks), `session-lifecycle.transitions.ts` (the zero-row
 * miss classifier and the same-lane refund primitive),
 * `session-lifecycle.booking.ts` (the booking transaction body) and
 * `session-lifecycle.confirmation.ts` (the dual-confirmation transaction
 * body). Every public method below is the same flow in the same order —
 * each owns its boundary validation ordering, governance re-check, and the
 * `withTransaction` composition, delegating only the transaction bodies and
 * shared pre-DB checks to the siblings. The public API (names, signatures,
 * behavior) is unchanged.
 */

import { SessionRepository } from "@/backend/db/repo";
import { DisputeResolution, isDisputeResolution } from "@/backend/enum/scheduling/dispute-resolution.enum";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import { withTransaction } from "@/backend/lib/db/with-transaction";
import { ValidationError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import { assertBookingBoundary, bookSessionInTx } from "@/backend/services/classes/session-lifecycle.booking";
import { confirmCompletionInTx } from "@/backend/services/classes/session-lifecycle.confirmation";
import {
  assertActorGovernanceClean,
  assertAdminGovernanceClean,
} from "@/backend/services/classes/session-lifecycle.governance";
import {
  assertPositiveSafeSessionId,
  guardStatusFilter,
  isPositiveSafeSessionId,
  normalizeAdminListBounds,
  normalizeOptionalReasonText,
  normalizePageBounds,
  normalizeRequiredReasonText,
  SESSION_DISPUTED_STATUS,
} from "@/backend/services/classes/session-lifecycle.guards";
import {
  refundHeldLaneToProvenance,
  refundSweptHolds,
  rejectTransitionMiss,
} from "@/backend/services/classes/session-lifecycle.transitions";
import type {
  DBTransaction,
  SessionListFilterInput,
  SessionPageReturnType,
  SessionReturnType,
  SessionSubmitInput,
} from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";

export namespace SessionLifecycleService {
  /**
   * Books one session for the acting student against a certified teacher.
   *
   * Pre-DB boundary validation rejects an empty/overlong idempotency key,
   * non-positive-unsafe participant identifiers, and a non-bookable intent
   * before any database work. The acting student's governance state is
   * re-asserted (deleted/blocked/suspended callers are denied). One instant
   * is captured for the whole flow; the confirmation deadline derives from
   * it. Inside one transaction the certification lock, the trial-first
   * debit ladder, the idempotency claim, and the session insert + claim
   * backfill run in a fixed order; any failure rolls the whole booking back,
   * which also releases the claim (a failed booking never burns its key).
   *
   * On a duplicate claim key the flow REPLAYS BY THROWING: every same-caller
   * duplicate — a claim with or without its session pointer, and a vanished
   * claim (fail-closed) — surfaces the `ConflictError("DUPLICATE_REQUEST")`
   * conflict; this attempt's own partial writes (its debit-ladder step) roll
   * back with the transaction, so the replay commits zero new rows and burns
   * no second allowance unit. The success-equivalent experience is
   * the client-side mapping of the 409. A key spent by a DIFFERENT
   * caller is denied with the oracle-safe session-not-found error — another
   * user's claim is never surfaced.
   *
   * @param studentId  The acting student's id (context-resolved server-side
   *     by the caller; shared PK with the users table).
   * @param input  The client-controlled booking whitelist (target teacher +
   *     intent only — every other column is server-owned).
   * @param idempotencyKey  The captured request idempotency key, carried
   *     verbatim (never trimmed, never coerced, never logged).
   * @param locale  Active request locale (for the localized error messages).
   * @param outerTx  Optional outer transaction. When provided (test path),
   *     the flow runs inside a SAVEPOINT on it; production callers omit it
   *     and the service opens its own transaction.
   * @returns The booked session row for a FIRST booking; a replay never
   *     returns — it throws `ConflictError("DUPLICATE_REQUEST")`.
   */
  export async function createSession(
    studentId: number,
    input: SessionSubmitInput,
    idempotencyKey: string,
    locale: string,
    outerTx?: DBTransaction
  ): Promise<SessionReturnType> {
    const t = getServerTranslations(locale).errorsTranslations;

    // Pre-DB boundary validation — fail before any database work.
    assertBookingBoundary(studentId, input, idempotencyKey, t);

    // Governance re-check — the acting student must be governance-clean.
    await assertActorGovernanceClean(studentId, t, outerTx);

    // One captured instant governs every derivation in this flow.
    const now = new Date();

    return withTransaction(outerTx, tx => bookSessionInTx(studentId, input, idempotencyKey, now, tx, t));
  }

  /**
   * Starts a scheduled session exactly once, as its owning teacher.
   *
   * The target session id is guarded as a positive safe integer BEFORE any
   * database work (the boundary parses `ID` shape-only, so a
   * malformed id is the canonical `VALIDATION` denial, never a SQL
   * round-trip). The teacher's governance state is re-asserted next. The
   * guarded transition writes the start and audit stamps from one captured
   * instant and never touches the confirmation deadline. A zero-row match
   * is classified by one cold probe read: an unknown id and a non-owning
   * caller both surface the oracle-safe session-not-found error, and any
   * other miss cause is a lifecycle-state conflict.
   *
   * @param teacherUserId  The acting teacher's id (shared PK — the value
   *     stored in the session row's teacher column).
   * @param sessionId  The target session id.
   * @param locale  Active request locale (for the localized error messages).
   * @param tx  Optional transaction — propagated to every read and write so
   *     a caller-owned atomic flow stays atomic.
   */
  export async function startSession(
    teacherUserId: number,
    sessionId: number,
    locale: string,
    tx?: DBTransaction
  ): Promise<SessionReturnType> {
    const t = getServerTranslations(locale).errorsTranslations;

    // Pre-DB id-shape guard — BEFORE the governance probe: a
    // malformed target id is the canonical VALIDATION denial, never a
    // SQL round-trip.
    assertPositiveSafeSessionId(sessionId, t);

    // Governance re-check — the acting teacher must be governance-clean.
    await assertActorGovernanceClean(teacherUserId, t, tx);

    const started = await SessionRepository.startSessionOnce(sessionId, teacherUserId, tx);
    if (started === null) {
      throw await rejectTransitionMiss("teacherStart", sessionId, teacherUserId, tx, t);
    }
    return started;
  }

  /**
   * Completes a started session exactly once, as its owning teacher.
   *
   * The target session id is guarded as a positive safe integer BEFORE any
   * database work (the boundary parses `ID` shape-only, so a
   * malformed id is the canonical `VALIDATION` denial, never a SQL
   * round-trip). The teacher's governance state is re-asserted next. The
   * guarded transition fuses the certification re-assertion into its own
   * predicate — a teacher decertified between booking and completion matches
   * zero rows —
   * and writes the end, confirmation, and audit stamps from one captured
   * instant. Report or homework side effects are deliberately absent: this
   * transition touches only the session row. A zero-row match is classified
   * by one cold probe read (unknown/foreign → not-found; wrong state →
   * transition conflict; owned + in-progress → certification conflict).
   *
   * @param teacherUserId  The acting teacher's id (shared PK — the value
   *     stored in the session row's teacher column).
   * @param sessionId  The target session id.
   * @param locale  Active request locale (for the localized error messages).
   * @param tx  Optional transaction — propagated to every read and write so
   *     a caller-owned atomic flow stays atomic.
   */
  export async function completeSession(
    teacherUserId: number,
    sessionId: number,
    locale: string,
    tx?: DBTransaction
  ): Promise<SessionReturnType> {
    const t = getServerTranslations(locale).errorsTranslations;

    // Pre-DB id-shape guard — BEFORE the governance probe: a
    // malformed target id is the canonical VALIDATION denial, never a
    // SQL round-trip.
    assertPositiveSafeSessionId(sessionId, t);

    // Governance re-check — the acting teacher must be governance-clean.
    await assertActorGovernanceClean(teacherUserId, t, tx);

    const completed = await SessionRepository.completeSessionOnce(sessionId, teacherUserId, tx);
    if (completed === null) {
      throw await rejectTransitionMiss("teacherComplete", sessionId, teacherUserId, tx, t);
    }
    return completed;
  }

  /**
   * Cancels a cancellable session (pre-start or in-progress) as either
   * participant, releasing the held fee back to the lane that funded it.
   *
   * The target session id is guarded as a positive safe integer BEFORE any
   * database work (the boundary parses `ID` shape-only, so a
   * malformed id is the canonical `VALIDATION` denial, never a SQL
   * round-trip). Deliberately NO governance re-check: releasing an in-flight
   * hold stays available to a governed participant (governance flips never
   * rewrite history). The optional reason is length-guarded and persisted
   * TRIMMED inside the guarded UPDATE itself (`cancel_reason`; a
   * whitespace-only reason persists as NULL) — the predicate and stamps are
   * otherwise unchanged. The guarded transition keeps the start stamp and
   * never writes an end stamp. On success, a row whose provenance lane is
   * set is refunded by one unit on that same lane inside the same
   * transaction through the shared same-lane refund primitive (unguarded
   * increment — the lane that paid is refunded exactly once); a terminal or
   * foreign target is classified by one cold probe read (unknown/
   * non-participant → not-found; anything else → transition conflict), so a
   * double cancel can never double-refund.
   *
   * @param callerUserId  The acting participant's id (the session's student
   *     or its teacher).
   * @param sessionId  The target session id.
   * @param reason  Optional free-text reason — validated (≤500 chars) and
   *     persisted trimmed into `cancel_reason` by this flow.
   * @param locale  Active request locale (for the localized error messages).
   * @param outerTx  Optional outer transaction. When provided (test path),
   *     the flow runs inside a SAVEPOINT on it; production callers omit it
   *     and the service opens its own transaction.
   */
  export async function cancelSession(
    callerUserId: number,
    sessionId: number,
    reason: string | null,
    locale: string,
    outerTx?: DBTransaction
  ): Promise<SessionReturnType> {
    const t = getServerTranslations(locale).errorsTranslations;

    // Pre-DB id-shape guard — the FIRST check of the flow, before
    // the reason guard: a malformed target id is the canonical VALIDATION
    // denial, never a SQL round-trip.
    assertPositiveSafeSessionId(sessionId, t);

    // The reason is guarded, trimmed, and persisted inside the guarded
    // UPDATE (NULL when absent or whitespace-only).
    const cancelReason = normalizeOptionalReasonText(reason, t);

    return withTransaction(outerTx, async tx => {
      const cancelled = await SessionRepository.cancelSessionOnce(sessionId, callerUserId, cancelReason, tx);
      if (cancelled === null) {
        throw await rejectTransitionMiss("participantCancel", sessionId, callerUserId, tx, t);
      }

      // Refund the lane that funded the hold — same transaction, same lane,
      // through the ONE shared same-lane refund primitive.
      await refundHeldLaneToProvenance(cancelled, "cancelSession", tx);

      return cancelled;
    });
  }

  /**
   * Opens a dispute on a live session (pre-start or in-progress) as either
   * participant, moving the row into the arbitration state exactly once.
   *
   * The target session id is guarded as a positive safe integer BEFORE any
   * database work. The reason is REQUIRED: trimmed non-empty and
   * ≤500 chars, validated pre-DB. Deliberately NO governance re-check
   * (mirroring the cancel exemption: a dispute is a participant's
   * self-protection action over their own row; the participant predicate is
   * the whole authorization surface). The escrow hold is deliberately
   * untouched — the money stays frozen until the admin resolution. A
   * zero-row match is classified by one cold probe read (unknown/
   * non-participant → not-found, oracle-safe; anything else → transition
   * conflict), so a double dispute can never rewrite a recorded reason.
   *
   * @param callerUserId  The acting participant's id (the session's student
   *     or its teacher).
   * @param sessionId  The target session id.
   * @param reason  REQUIRED free-text reason — trimmed non-empty, ≤500
   *     chars, persisted into `dispute_reason`.
   * @param locale  Active request locale (for the localized error messages).
   * @param outerTx  Optional outer transaction. When provided (test path),
   *     the flow runs inside a SAVEPOINT on it; production callers omit it
   *     and the service opens its own transaction.
   */
  export async function openSessionDispute(
    callerUserId: number,
    sessionId: number,
    reason: string,
    locale: string,
    outerTx?: DBTransaction
  ): Promise<SessionReturnType> {
    const t = getServerTranslations(locale).errorsTranslations;

    // Pre-DB id-shape guard — the FIRST check of the flow, before
    // the reason guard.
    assertPositiveSafeSessionId(sessionId, t);

    // The reason is REQUIRED: trimmed non-empty, ≤500 — validated pre-DB.
    const disputeReason = normalizeRequiredReasonText(reason, t);

    return withTransaction(outerTx, async tx => {
      const disputed = await SessionRepository.openDisputeOnce(sessionId, callerUserId, disputeReason, tx);
      if (disputed === null) {
        throw await rejectTransitionMiss("participantDispute", sessionId, callerUserId, tx, t);
      }
      return disputed;
    });
  }

  /**
   * Resolves a disputed session into exactly one terminal state, as an
   * ADMIN (the arbitration surface).
   *
   * The target session id is guarded as a positive safe integer BEFORE any
   * database work. The resolution vocabulary is re-guarded at
   * runtime (a payload that skipped the GraphQL enum boundary fails closed
   * pre-DB) and the optional note is trimmed, ≤500-checked, and persisted
   * (`resolution_note`; whitespace-only persists as NULL). The caller's
   * governance AND admin role are re-asserted from the user row — defense
   * in depth on top of the GraphQL scope gate (a still-valid token held by
   * a demoted or governed account fails closed here with the canonical
   * FORBIDDEN).
   *
   * Inside ONE transaction:
   *  - `Cancel`  → the guarded UPDATE flips the row to `cancelled`, clears
   *    the hold marker, and writes the note + stamp; the same-lane refund
   *    (the EXACT primitive the participant cancel composes) runs on the
   *    same transaction, so the refund and the status flip commit
   *    atomically — partial application is impossible.
   *  - `Complete` → one cold probe read FIRST classifies a disputed row
   *    that never started as pre-DB `VALIDATION` (cannot complete what
   *    never happened); the guarded UPDATE then flips the row to
   *    `completed`, consumes the hold (`fee_held = false` — no wallet
   *    credit), and writes the end/note/stamps. Unknown ids and wrong-state
   *    rows fall through to the guarded UPDATE and classify through the
   *    standard probe chain (unknown → not-found; any existing row that
   *    missed → transition conflict — the admin surface distinguishes
   *    state, never participants).
   *
   * @param adminId  The acting admin's id (context-resolved server-side by
   *     the caller; shared PK with the users table).
   * @param sessionId  The target session id.
   * @param resolution  The arbitration outcome (Cancel | Complete).
   * @param note  Optional free-text note — trimmed ≤500, persisted into
   *     `resolution_note`.
   * @param locale  Active request locale (for the localized error messages).
   * @param outerTx  Optional outer transaction. When provided (test path),
   *     the flow runs inside a SAVEPOINT on it; production callers omit it
   *     and the service opens its own transaction.
   */
  export async function resolveSessionDispute(
    adminId: number,
    sessionId: number,
    resolution: DisputeResolution,
    note: string | null,
    locale: string,
    outerTx?: DBTransaction
  ): Promise<SessionReturnType> {
    const t = getServerTranslations(locale).errorsTranslations;

    // Pre-DB id-shape guard — the FIRST check of the flow.
    assertPositiveSafeSessionId(sessionId, t);

    // The resolution vocabulary is a closed runtime guard (BOPLA — a
    // payload that skipped the boundary's enum parse fails closed here,
    // pre-DB).
    if (!isDisputeResolution(resolution)) {
      throw new ValidationError(t.validation);
    }

    // The optional note: trimmed, ≤500 — validated pre-DB; whitespace-only
    // persists as NULL.
    const resolutionNote = normalizeOptionalReasonText(note, t);

    // Governance + role re-check — the acting caller must be a
    // governance-clean ADMIN (defense in depth over the scope gate).
    await assertAdminGovernanceClean(adminId, t, outerTx);

    return withTransaction(outerTx, async tx => {
      if (resolution === DisputeResolution.Complete) {
        // Pre-write classification (one cold probe read): a disputed row
        // that never started cannot complete — VALIDATION before the
        // guarded UPDATE. Unknown ids and wrong-state rows fall through to
        // the guarded UPDATE and classify through the standard probe chain.
        const probe = await SessionRepository.findTransitionProbe(sessionId, tx);
        if (probe !== null && probe.status === SESSION_DISPUTED_STATUS && probe.startedAt === null) {
          logger.logDomainError("Session arbitration denied: disputed session never started", {
            code: "VALIDATION",
            entity: "session",
            entityId: sessionId,
          });
          throw new ValidationError(t.validation);
        }
      }

      const resolved =
        resolution === DisputeResolution.Cancel
          ? await SessionRepository.resolveDisputeCancelOnce(sessionId, resolutionNote, tx)
          : await SessionRepository.resolveDisputeCompleteOnce(sessionId, resolutionNote, tx);
      if (resolved === null) {
        throw await rejectTransitionMiss("adminResolve", sessionId, adminId, tx, t);
      }

      // CANCEL outcome: refund the lane that funded the hold — same
      // transaction, same primitive as the participant cancel, so the
      // refund and the status flip commit atomically.
      if (resolution === DisputeResolution.Cancel) {
        await refundHeldLaneToProvenance(resolved, "resolveSessionDispute", tx);
      }

      return resolved;
    });
  }

  /**
   * The student's completion confirmation — the second half of the
   * dual-confirmation contract.
   *
   * The target session id is guarded as a positive safe integer BEFORE any
   * database work. Deliberately NO governance re-check (mirroring
   * the cancel/dispute exemption: confirming one's own completed lesson is
   * a participant self-service act; the participant predicate is the whole
   * authorization surface). The flow is IDEMPOTENT and its financial slice
   * fires EXACTLY once per session:
   *
   *  - STUDENT caller on a completed row with the hold still marked and
   *    both stamps completable: ONE guarded UPDATE writes the student
   *    stamp and flips `fee_held = false` (the exactly-once guard lives in
   *    the statement's predicate), then — same transaction — the credit
   *    slice composes through the wallet repository: the teacher's wallet
   *    row is ensured (idempotent ON CONFLICT insert; no approval-time
   *    wallet writer exists yet), ONE `earning` ledger row is inserted
   *    with the session's `fee` taken verbatim, and the wallet's
   *    `balance`/`total_earning` increase by exactly that fee (no DB
   *    trigger exists — the increment is explicit, atomic with the ledger
   *    row).
   *  - Already-confirmed student, an already-released hold (admin
   *    arbitration consumed it first), or the TEACHER caller (whose stamp
   *    `completeSessionOnce` already wrote): the current row is returned
   *    untouched — ZERO financial writes, the honest idempotent answer.
   *  - A zero-row guarded miss on a live-state row is classified by one
   *    cold probe read (unknown/non-participant → not-found, oracle-safe;
   *    anything else → transition conflict), so a foreign caller can never
   *    distinguish a missing row from one they do not own.
   *
   * @param callerUserId  The acting participant's id (the session's student
   *     or its teacher).
   * @param sessionId  The target session id.
   * @param locale  Active request locale (for the localized error messages).
   * @param outerTx  Optional outer transaction. When provided (test path),
   *     the flow runs inside a SAVEPOINT on it; production callers omit it
   *     and the service opens its own transaction.
   */
  export async function confirmSessionCompletion(
    callerUserId: number,
    sessionId: number,
    locale: string,
    outerTx?: DBTransaction
  ): Promise<SessionReturnType> {
    const t = getServerTranslations(locale).errorsTranslations;

    // Pre-DB id-shape guard — the FIRST check of the flow.
    assertPositiveSafeSessionId(sessionId, t);

    return withTransaction(outerTx, tx => confirmCompletionInTx(callerUserId, sessionId, tx, t));
  }

  /**
   * The confirmation-deadline sweeper: cancels every still-`scheduled`
   * session whose confirmation deadline has passed and refunds each held
   * row's fee to its recorded provenance lane.
   *
   * ONE captured `now` drives both the deadline comparison and the stamps.
   * The batch UPDATE (guarded on the scheduled state and the expired
   * deadline) returns the cancelled rows; each returned row with a
   * recorded lane is refunded through the ONE shared same-lane primitive
   * on the same transaction — a NULL lane (rows with no hold)
   * means nothing to refund. Idempotent: a second sweep matches zero
   * rows. Zero notification/audit writes (out of contract).
   *
   * @param outerTx  Optional outer transaction. When provided (test path),
   *     the flow runs inside a SAVEPOINT on it; production callers omit it
   *     and the service opens its own transaction.
   * @returns Honest counts: `cancelled` rows and how many of them carried
   *     a refunded hold.
   */
  export async function sweepExpiredSessions(outerTx?: DBTransaction): Promise<{
    readonly cancelled: number;
    readonly refunded: number;
  }> {
    return withTransaction(outerTx, async tx => {
      const now = new Date();
      const expired = await SessionRepository.sweepExpiredScheduledOnce(now, tx);
      const refunded = await refundSweptHolds(expired, tx);
      return { cancelled: expired.length, refunded };
    });
  }

  /**
   * Reads one session for a participant: the row is returned only when the
   * caller is the session's student or its teacher. A nonexistent id and a
   * non-participant caller resolve to the identical `null` (oracle-safe —
   * the two cases are indistinguishable). A malformed id — anything but a
   * positive safe integer, including the NaN/1.5/overflow shapes the
   * boundary's shape-only `Number` parse yields for garbage `ID` strings —
   * short-circuits to the SAME `null` before any database read (the pre-DB
   * shape guard); well-formed-but-unknown ids degrade to `null`
   * through the parameterized lookup. No error is ever raised: this read
   * surface has no locale and its only answer shape is `null`.
   *
   * @param callerUserId  The calling participant's id.
   * @param sessionId  The target session id.
   * @param tx  Optional transaction — propagated so a caller-owned atomic
   *     flow stays atomic.
   */
  export async function getSessionById(
    callerUserId: number,
    sessionId: number,
    tx?: DBTransaction
  ): Promise<SessionReturnType | null> {
    // Oracle-safe malformed-id channel: anything that is not a
    // positive safe integer — the NaN/1.5/overflow shapes the boundary's
    // shape-only `Number` parse yields for garbage `ID` strings — resolves
    // to the SAME `null` as a nonexistent id, BEFORE any database read. No
    // error is raised (this read surface has no locale and never throws).
    if (!isPositiveSafeSessionId(sessionId)) {
      return null;
    }

    const row = await SessionRepository.findById(sessionId, tx);
    if (row === null) {
      return null;
    }
    if (row.studentId !== callerUserId && row.teacherId !== callerUserId) {
      return null;
    }
    return row;
  }

  /**
   * Lists the acting student's own sessions, newest first, paged.
   *
   * Page bounds are normalized before any database work: a page below 1
   * falls back to the first page and a page size outside 1..50 falls back to
   * the default (25) — the read surface never fabricates a window, and the
   * returned `page`/`pageSize` echo the effective values honestly. The
   * lifecycle filter is guarded against the closed status vocabulary (an
   * out-of-vocabulary value drops out — filters never error); the total
   * count is computed under the SAME filtered predicate as the list, so
   * `totalCount` can never diverge from the items.
   *
   * @param studentId  The acting student's id (owner-side scoping).
   * @param filter  Optional lifecycle filter (absent/null members drop out).
   * @param page  Requested page (≥ 1; invalid values normalize to 1).
   * @param pageSize  Requested page size (1..50; invalid values normalize
   *     to the default).
   * @param tx  Optional transaction — propagated to both reads.
   */
  export async function listMyStudentSessions(
    studentId: number,
    filter: SessionListFilterInput,
    page: number,
    pageSize: number,
    tx?: DBTransaction
  ): Promise<SessionPageReturnType> {
    const bounds = normalizePageBounds(page, pageSize);
    const guardedFilter = guardStatusFilter(filter);

    const items = await SessionRepository.listForStudent(
      studentId,
      guardedFilter,
      bounds.pageSize,
      (bounds.page - 1) * bounds.pageSize,
      tx
    );
    const totalCount = await SessionRepository.countForStudent(studentId, guardedFilter, tx);

    return { items, totalCount, page: bounds.page, pageSize: bounds.pageSize };
  }

  /**
   * Lists the acting teacher's own sessions — the teacher-side twin of
   * `listMyStudentSessions`, with identical paging, guarding, filtering,
   * and honest-echo semantics over the owning-teacher predicate.
   *
   * @param teacherId  The acting teacher's id (owner-side scoping).
   * @param filter  Optional lifecycle filter (absent/null members drop out).
   * @param page  Requested page (≥ 1; invalid values normalize to 1).
   * @param pageSize  Requested page size (1..50; invalid values normalize
   *     to the default).
   * @param tx  Optional transaction — propagated to both reads.
   */
  export async function listMyTeacherSessions(
    teacherId: number,
    filter: SessionListFilterInput,
    page: number,
    pageSize: number,
    tx?: DBTransaction
  ): Promise<SessionPageReturnType> {
    const bounds = normalizePageBounds(page, pageSize);
    const guardedFilter = guardStatusFilter(filter);

    const items = await SessionRepository.listForTeacher(
      teacherId,
      guardedFilter,
      bounds.pageSize,
      (bounds.page - 1) * bounds.pageSize,
      tx
    );
    const totalCount = await SessionRepository.countForTeacher(teacherId, guardedFilter, tx);

    return { items, totalCount, page: bounds.page, pageSize: bounds.pageSize };
  }

  /**
   * Lists the disputed sessions for the admin arbitration surface, newest
   * first, paged.
   *
   * The limit clamp mirrors the participant lists exactly (1..50, default
   * 25) and the offset floors at zero — both normalize pre-DB, never
   * error. The lifecycle filter is guarded against the closed status
   * vocabulary like every other read; the field's `disputed` scope is
   * PINNED, so an explicitly contradictory filter (any status other than
   * disputed) honestly resolves to an empty page without touching the
   * database, while an absent/whitespace-drop filter returns the full
   * arbitration queue. The total count is computed under the SAME pinned
   * predicate as the list, so `totalCount` can never diverge from the
   * items. The `limit`/`offset` window maps onto the page echo honestly:
   * `pageSize` is the clamped limit and `page` is the 1-based window index
   * that contains the requested offset.
   *
   * The admin role gate lives at the GraphQL scope (`$all { authenticated,
   * role: [Admin] }`); this read takes no caller identity and never raises
   * localized errors (the read-surface contract).
   *
   * @param filter  Optional lifecycle filter (absent/null members drop
   *     out; a non-disputed member contradicts the pinned scope).
   * @param limit  Requested page size (1..50; invalid values normalize to
   *     the default).
   * @param offset  Requested row offset (≥ 0; invalid values normalize to
   *     0).
   * @param tx  Optional transaction — propagated to both reads.
   */
  export async function listAdminDisputedSessions(
    filter: SessionListFilterInput,
    limit: number,
    offset: number,
    tx?: DBTransaction
  ): Promise<SessionPageReturnType> {
    const bounds = normalizeAdminListBounds(limit, offset);

    // A filter explicitly contradicting the pinned disputed scope (any
    // in-vocabulary status other than disputed) matches zero rows by
    // definition — the honest empty page, no database round-trip.
    const guardedStatus = guardStatusFilter(filter).status;
    if (guardedStatus !== null && guardedStatus !== SessionStatus.Disputed) {
      return { items: [], totalCount: 0, page: bounds.page, pageSize: bounds.safeLimit };
    }

    const items = await SessionRepository.listAdminDisputed(bounds.safeLimit, bounds.safeOffset, tx);
    const totalCount = await SessionRepository.countAdminDisputed(tx);

    return { items, totalCount, page: bounds.page, pageSize: bounds.safeLimit };
  }
}
