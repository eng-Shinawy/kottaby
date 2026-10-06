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
 *      deadline) followed by the claim's session-id backfill — and then the
 *      teacher's session-request wave rides the same transaction on its own
 *      nested savepoint (a dispatch failure rolls back only that savepoint
 *      and is logged, never rethrown; the booking stays durable).
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
 * Cross-surface dependency policy: the module's cross-surface dependencies
 * are the wallet repository — composed into the dual-confirmation flow to
 * credit the teacher's earnings when the student confirms a completed
 * session — and the notification engine's emit/publish contracts for the
 * teacher-facing booking intake wave and the two student-facing completion
 * waves (the request notice once the booking commits, the confirm prompt
 * once the teacher's completion stamp lands, and the auto-cancel notice
 * once the confirmation window lapses). Notification rows are written
 * exclusively by the engine inside the owning transaction, and their
 * delivery receipts are published strictly after that transaction commits —
 * never for a rolled-back flow. The module's remaining cross-surface channel is the
 * admin arbitration's audit trail row: `resolveSessionDispute` appends its
 * single Override row through the shared `AuditService` writer on the
 * arbitration's own transaction (report surfaces stay unimported). All
 * user-facing messages resolve through
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
 * `session-lifecycle.booking.ts` (the booking transaction body),
 * `session-lifecycle.confirmation.ts` (the dual-confirmation transaction
 * body) and `session-lifecycle.queries.ts` (the read/query surface —
 * participant reads and the admin arbitration list — surfaced here through
 * thin same-signature delegates so the public namespace API is unchanged).
 * Every public method below is the same flow in the same order —
 * each owns its boundary validation ordering, governance re-check, and the
 * `withTransaction` composition, delegating only the transaction bodies and
 * shared pre-DB checks to the siblings. The public API (names, signatures,
 * behavior) is unchanged.
 */

import { SessionRepository, TeacherRepository } from "@/backend/db/repo";
import { DisputeResolution, isDisputeResolution } from "@/backend/enum/scheduling/dispute-resolution.enum";
import { withTransaction } from "@/backend/lib/db/with-transaction";
import { ValidationError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import { AuditService } from "@/backend/services/admin/audit.service";
import { assertBookingBoundary, bookSessionInTx } from "@/backend/services/classes/session-lifecycle.booking";
import { confirmCompletionInTx } from "@/backend/services/classes/session-lifecycle.confirmation";
import {
  assertActorGovernanceClean,
  assertAdminGovernanceClean,
} from "@/backend/services/classes/session-lifecycle.governance";
import {
  assertPositiveSafeSessionId,
  normalizeOptionalReasonText,
  normalizeRequiredReasonText,
  SESSION_DISPUTED_STATUS,
} from "@/backend/services/classes/session-lifecycle.guards";
import { SessionLifecycleQueries } from "@/backend/services/classes/session-lifecycle.queries";
import {
  buildDisputeAuditContract,
  refundHeldLaneToProvenance,
  refundSweptHolds,
  rejectTransitionMiss,
  releaseTeacherInSessionLock,
} from "@/backend/services/classes/session-lifecycle.transitions";
import { SessionRequestNotificationService } from "@/backend/services/classes/session-request-notification.service";
import { NotificationEngine } from "@/backend/services/notifications";
import type {
  DBTransaction,
  NotificationDeliveryReceipt,
  SessionListFilterInput,
  SessionPageReturnType,
  SessionReturnType,
  SessionSubmitInput,
} from "@/backend/types";
import { defaultLocale } from "@/shared/locale/AppLocale";
import { getServerTranslations } from "@/shared/locale/server-graphql";

/**
 * Sequential head-first collection of the swept rows' auto-cancel
 * receipts — the recursive-helper shape of the sweeper's by-design
 * sequential loop (the same shape as the refund walk): each row's notice
 * is emitted on the sweep transaction before the next row is touched, so
 * the statement order is head-first and a failure leaves the loop's
 * partial writes to the transaction's own rollback. Each await yields and
 * unwinds the stack, so the recursion only happens ACROSS awaits.
 */
async function collectAutoCancelReceipts(
  rows: readonly SessionReturnType[],
  index: number,
  tx: DBTransaction
): Promise<NotificationDeliveryReceipt[]> {
  const row = rows.at(index);
  if (row === undefined) {
    return [];
  }
  const receipt = await SessionRequestNotificationService.notifyStudentOfCompletionAutoCancelled(
    row.id,
    defaultLocale,
    tx
  );
  const rest = await collectAutoCancelReceipts(rows, index + 1, tx);
  return [receipt, ...rest];
}

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
   * @param locale  Active request locale (for the localized error messages;
   *     the teacher wave copy itself follows the teacher's persisted locale).
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

    const { session: createdSession, receipt } = await withTransaction(outerTx, async tx => {
      const created = await bookSessionInTx(studentId, input, idempotencyKey, now, tx, t);
      // The teacher wave rides the booking's own nested SAVEPOINT: a
      // dispatch failure rolls only that savepoint back — it is logged,
      // never rethrown, and the booking stays durable (the same posture
      // the evaluation booking flow established for its intake wave).
      let waveReceipt: NotificationDeliveryReceipt | undefined;
      try {
        waveReceipt = await withTransaction(tx, txArg =>
          SessionRequestNotificationService.notifyTeacherOfSessionRequest(created.id, locale, txArg)
        );
      } catch (error) {
        logger.error("Session booking notification dispatch failed", { sessionId: created.id, error });
      }
      return { session: created, receipt: waveReceipt };
    });

    // Publish strictly AFTER the commit — a denied or rolled-back booking
    // never pushes its receipt. On a caller-owned transaction this method
    // intentionally does NOT publish the receipt (the caller owns the
    // commit boundary, so it cannot know the receipt survived it).
    if (outerTx === undefined && receipt !== undefined) {
      await NotificationEngine.publishReceipts([receipt], locale);
    }

    return createdSession;
  }

  /**
   * Starts a scheduled session exactly once, as its owning teacher, and
   * applies the INV-S6 in-session lock in the SAME transaction.
   *
   * The target session id is guarded as a positive safe integer BEFORE any
   * database work (the boundary parses `ID` shape-only, so a
   * malformed id is the canonical `VALIDATION` denial, never a SQL
   * round-trip). The teacher's governance state is re-asserted next. The
   * guarded transition writes the start and audit stamps from one captured
   * instant and never touches the confirmation deadline. The lock write
   * composes onto the SAME transaction — keyed on the teacher id the
   * TRANSITIONED row carries (never caller input) — as ONE guarded
   * statement that atomically captures the teacher's pre-lock availability
   * into the persisted `was_online_before_lock` marker (first lock wins: a
   * marker an earlier session already holds is preserved verbatim) and
   * drives `teacher.is_online` offline, so a rollback of either write
   * aborts both: a started session with an unlocked teacher is structurally
   * impossible. When the session later exits, the marker-gated release
   * restores that captured intent and clears the marker — a deliberate
   * offline choice made before or during the session survives the exit
   * (the never-resurrect release contract documented in
   * `docs/teachers/teacher-availability.md` §6.2). A zero-row match
   * is classified by one cold probe read: an unknown id and a non-owning
   * caller both surface the oracle-safe session-not-found error, and any
   * other miss cause is a lifecycle-state conflict.
   *
   * @param teacherUserId  The acting teacher's id (shared PK — the value
   *     stored in the session row's teacher column).
   * @param sessionId  The target session id.
   * @param locale  Active request locale (for the localized error messages).
   * @param outerTx  Optional transaction — propagated to every read and
   *     write so a caller-owned atomic flow stays atomic (a SAVEPOINT on
   *     it); production callers omit it and the flow opens its own
   *     transaction, making the transition + lock one committed unit.
   */
  export async function startSession(
    teacherUserId: number,
    sessionId: number,
    locale: string,
    outerTx?: DBTransaction
  ): Promise<SessionReturnType> {
    const t = getServerTranslations(locale).errorsTranslations;

    // Pre-DB id-shape guard — BEFORE the governance probe: a
    // malformed target id is the canonical VALIDATION denial, never a
    // SQL round-trip.
    assertPositiveSafeSessionId(sessionId, t);

    // Governance re-check — the acting teacher must be governance-clean.
    await assertActorGovernanceClean(teacherUserId, t, outerTx);

    return withTransaction(outerTx, async tx => {
      const started = await SessionRepository.startSessionOnce(sessionId, teacherUserId, tx);
      if (started === null) {
        throw await rejectTransitionMiss("teacherStart", sessionId, teacherUserId, tx, t);
      }

      // INV-S6 lock — ONE guarded statement inside the SAME transaction:
      // the capture folds the pre-lock availability into the persisted
      // marker (first lock wins) while the write drives the row offline,
      // keyed on the transitioned row's teacher id, never the caller
      // input. Fail closed symmetrically with the release direction: a
      // zero-row acquire rolls the whole flow back instead of committing
      // a started session with no lock applied (the vanished-row case the
      // session's teacher FK otherwise renders unreachable).
      const locked = await TeacherRepository.acquireInSessionLock(started.teacherId, tx);
      if (locked === null) {
        logger.error("Session lifecycle blocked: in-session lock write matched zero teacher rows", {
          teacherId: started.teacherId,
        });
        throw new Error("SessionLifecycleService.startSession: in-session lock write matched zero teacher rows");
      }
      return started;
    });
  }

  /**
   * Completes a started session exactly once, as its owning teacher, and
   * lifts the INV-S6 in-session lock in the SAME transaction.
   *
   * The target session id is guarded as a positive safe integer BEFORE any
   * database work (the boundary parses `ID` shape-only, so a
   * malformed id is the canonical `VALIDATION` denial, never a SQL
   * round-trip). The teacher's governance state is re-asserted next. The
   * guarded transition fuses the certification re-assertion into its own
   * predicate — a teacher decertified between booking and completion matches
   * zero rows —
   * and writes the end, confirmation, and audit stamps from one captured
   * instant. Report or homework side effects are deliberately absent: the
   * guarded statement touches only the session row (plus the INV-S6 lock
   * release) — the student's confirm-prompt wave (below) is the flow's one
   * notification side effect. The guarded predicate guarantees the row
   * exited `started`, so the in-session lock its start applied is lifted
   * by the shared release primitive on the SAME transaction — a completed
   * session with a still-locked teacher is structurally impossible. A
   * zero-row match is classified by one cold probe read (unknown/foreign →
   * not-found; wrong state → transition conflict; owned + in-progress →
   * certification conflict).
   *
   * Once the guarded UPDATE matches, the student's confirm-prompt
   * notification is emitted on the same transaction — the prompt commits
   * with the completion stamp or not at all, and only for a row the
   * guarded statement actually moved (a denied completion writes zero
   * notification rows). When the flow owns its transaction, the prompt's
   * delivery receipt is published through the notification engine strictly
   * after that commit; a caller-owned transaction leaves publication to the
   * caller (the receipt is reachable through `completeSessionWithReceipt`).
   *
   * @param teacherUserId  The acting teacher's id (shared PK — the value
   *     stored in the session row's teacher column).
   * @param sessionId  The target session id.
   * @param outerTx  Optional transaction — propagated to every read and
   *     write so a caller-owned atomic flow stays atomic.
   */
  export async function completeSession(
    teacherUserId: number,
    sessionId: number,
    locale: string,
    outerTx?: DBTransaction
  ): Promise<SessionReturnType> {
    const result = await completeSessionWithReceipt(teacherUserId, sessionId, locale, outerTx);
    return result.session;
  }

  /**
   * The receipt-bearing completion flow — `completeSession` plus the
   * confirm-prompt's delivery receipt, for callers that own the commit
   * boundary.
   *
   * The transition, its guards, and its classification are identical to
   * `completeSession`. The confirm-prompt wave is emitted on the owning
   * transaction once the guarded UPDATE matches (never on a denied or
   * repeated completion), and the return carries the session row alongside
   * the wave's delivery receipt — the existing `SessionReturnType` surface
   * of `completeSession` is unchanged; this variant is the non-breaking
   * channel for the receipt.
   *
   * Receipt ownership mirrors the wave contract: when the flow opens its
   * own transaction, the receipt is published through
   * `NotificationEngine.publishReceipts` strictly after that commit and is
   * returned already published; when the caller supplies a transaction, the
   * receipt is returned UNPUBLISHED and the caller MUST publish it via
   * `NotificationEngine.publishReceipts` after its own transaction commits
   * — a rolled-back caller transaction therefore never pushes the prompt.
   *
   * @param teacherUserId  The acting teacher's id (shared PK — the value
   *     stored in the session row's teacher column).
   * @param sessionId  The target session id.
   * @param locale  Active request locale (for the localized error messages;
   *     the prompt copy itself follows the student's persisted locale).
   * @param outerTx  Optional transaction — propagated to every read and
   *     write so a caller-owned atomic flow stays atomic (a SAVEPOINT on
   *     it); production callers omit it and the flow opens its own
   *     transaction, making the transition, release, and prompt one
   *     committed unit.
   * @returns The completed session row and the confirm-prompt delivery
   *     receipt (published on the flow-owned commit path; unpublished on the
   *     caller-owned path).
   */
  export async function completeSessionWithReceipt(
    teacherUserId: number,
    sessionId: number,
    locale: string,
    outerTx?: DBTransaction
  ): Promise<{
    readonly session: SessionReturnType;
    readonly receipt: NotificationDeliveryReceipt;
  }> {
    const t = getServerTranslations(locale).errorsTranslations;

    // Pre-DB id-shape guard — BEFORE the governance probe: a
    // malformed target id is the canonical VALIDATION denial, never a
    // SQL round-trip.
    assertPositiveSafeSessionId(sessionId, t);

    // Governance re-check — the acting teacher must be governance-clean.
    await assertActorGovernanceClean(teacherUserId, t, outerTx);

    const result = await withTransaction(outerTx, async tx => {
      const completed = await SessionRepository.completeSessionOnce(sessionId, teacherUserId, tx);
      if (completed === null) {
        throw await rejectTransitionMiss("teacherComplete", sessionId, teacherUserId, tx, t);
      }

      // INV-S6 release — the predicate guaranteed the `started` pre-state,
      // so this flow's start lock is lifted on the SAME transaction.
      await releaseTeacherInSessionLock(completed.teacherId, tx);

      // The confirm prompt rides the completion's own transaction — it
      // commits with the stamp or not at all, and its receipt stays
      // unpublished until the commit boundary below.
      const receipt = await SessionRequestNotificationService.notifyStudentOfCompletionPrompt(sessionId, locale, tx);

      return { session: completed, receipt };
    });

    // Publish strictly AFTER the commit — a denied or rolled-back
    // completion never pushes its prompt. A caller-owned transaction is
    // published by the caller after its own commit.
    if (outerTx === undefined) {
      await NotificationEngine.publishReceipts([result.receipt], locale);
    }

    return result;
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
   * double cancel can never double-refund. The INV-S6 in-session lock is
   * lifted on the SAME transaction UNCONDITIONALLY — the persisted
   * availability marker captured at lock acquisition is the single gate,
   * never the row's start stamp (a stamp alone cannot classify the lock:
   * the reschedule flow writes one onto rows that never started). A row
   * that holds no lock degrades to the release's classified no-op, so a
   * pre-start cancel never spuriously restores the teacher's flag.
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

      // INV-S6 release — unconditional on the pre-state: the availability
      // marker is the single gate, so a row that never held the lock
      // degrades to the release's classified no-op (see the docblock).
      await releaseTeacherInSessionLock(cancelled.teacherId, tx);

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
   *  - Either outcome → with the guarded update (and the Cancel refund)
   *    succeeded, ONE `Override` audit row (entity `session`) is appended
   *    through the shared audit writer on the SAME transaction — an audit
   *    failure throws and rolls the whole arbitration back. The note's
   *    CONTENT never enters the trail; only its presence is recorded.
   *
   * Both outcomes lift the INV-S6 in-session lock on the SAME transaction
   * unconditionally — the persisted availability marker is the single
   * gate, and a row that never held the lock degrades to the release's
   * classified no-op. The arbitration exit is a session exit for lock
   * purposes, identical to the participant flows.
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
          ? await SessionRepository.resolveDisputeCancelOnce(sessionId, resolutionNote, resolution, tx)
          : await SessionRepository.resolveDisputeCompleteOnce(sessionId, resolutionNote, resolution, tx);
      if (resolved === null) {
        throw await rejectTransitionMiss("adminResolve", sessionId, adminId, tx, t);
      }

      // CANCEL outcome: refund the lane that funded the hold — same
      // transaction, same primitive as the participant cancel, so the
      // refund and the status flip commit atomically.
      if (resolution === DisputeResolution.Cancel) {
        await refundHeldLaneToProvenance(resolved, "resolveSessionDispute", tx);
      }

      // INV-S6 release — unconditional on the pre-state: the availability
      // marker is the single gate, so a dispute on a row that never held
      // the lock degrades to the release's classified no-op (see the
      // docblock).
      await releaseTeacherInSessionLock(resolved.teacherId, tx);

      // The arbitration's audit trail row rides the SAME transaction: one
      // Override row for the session entity, appended only after the guarded
      // update (and the Cancel refund, and the INV-S6 lock release)
      // succeeded — an audit failure throws, so a partially-applied
      // arbitration can never commit. The note's content stays out of the
      // trail; only its presence is recorded.
      await AuditService.createAuditLog(
        buildDisputeAuditContract(adminId, sessionId, resolution, resolutionNote !== null),
        tx
      );

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
   * session whose confirmation deadline has passed, then cancels every
   * `completed` session whose student-confirmation window has lapsed
   * without the student's confirmation, and refunds each held row's fee to
   * its recorded provenance lane.
   *
   * ONE captured `now` drives both legs' comparisons and stamps. Each leg
   * is ONE guarded batch UPDATE returning the cancelled rows; the refund
   * walk covers the UNION of both legs' rows on the same transaction —
   * sequential and fail-closed, so an unreadable lane rolls the whole sweep
   * back (notifications included). A NULL lane (rows with no hold) means
   * nothing to refund. The post-completion window is measured from the
   * recorded teacher stamp at sweep time; the confirmation-deadline column
   * is never re-armed. Idempotent: a second sweep matches zero rows on both
   * legs.
   *
   * Every swept completed-leg row's student receives the auto-cancel notice;
   * the scheduled-expiry leg deliberately stays notification-free (its
   * semantics are unchanged). The notices are emitted on the sweep's
   * transaction as unpublished receipts and pushed through the notification
   * engine strictly after the commit boundary. The outer-tx contract is
   * pinned: called WITH an outer transaction, the auto-cancel receipts are
   * still collected on that transaction, but the counts-only
   * `{cancelled, refunded}` return exposes no publish channel — a
   * caller-owned transaction NEVER publishes (the caller owns the commit
   * boundary and would own any publish after it). Production (the cron
   * route) calls without `outerTx`, so the flow-owned post-commit publish
   * path is the only live one. The counts-only return shape carries no
   * receipts either way, so the cron contract is unchanged: zero row
   * identities cross the wire.
   *
   * @param outerTx  Optional outer transaction. When provided (test path),
   *     the flow runs inside a SAVEPOINT on it — the auto-cancel receipts
   *     are collected on it but stay unpublished (the counts-only return
   *     hands nothing back to publish); production callers omit it and the
   *     service opens its own transaction, making the flow-owned
   *     post-commit publish the only live one.
   * @returns Honest counts: `cancelled` rows across BOTH legs and how many
   *     of them carried a refunded hold.
   */
  export async function sweepExpiredSessions(outerTx?: DBTransaction): Promise<{
    readonly cancelled: number;
    readonly refunded: number;
  }> {
    const sweep = await withTransaction(outerTx, async tx => {
      const now = new Date();
      const expiredScheduled = await SessionRepository.sweepExpiredScheduledOnce(now, tx);
      const expiredCompleted = await SessionRepository.sweepExpiredCompletedOnce(now, tx);

      // The refund walk covers BOTH legs' rows — sequential, fail-closed,
      // on the one sweep transaction.
      const refunded = await refundSweptHolds([...expiredScheduled, ...expiredCompleted], tx);

      // The auto-cancel notices ride the same transaction as unpublished
      // receipts — they commit with the sweep or not at all, and publish
      // only at the commit boundary below. The walk is sequential by
      // design (head-first, one row's notice before the next row is
      // touched).
      const autoCancelReceipts = await collectAutoCancelReceipts(expiredCompleted, 0, tx);

      return { cancelled: expiredScheduled.length + expiredCompleted.length, refunded, autoCancelReceipts };
    });

    // Publish strictly AFTER the commit — a rolled-back sweep never pushes
    // a receipt (an idle sweep publishes nothing at all), and a
    // caller-owned transaction never publishes from here (the caller owns
    // the commit boundary).
    if (outerTx === undefined && sweep.autoCancelReceipts.length > 0) {
      await NotificationEngine.publishReceipts(sweep.autoCancelReceipts, defaultLocale);
    }

    return { cancelled: sweep.cancelled, refunded: sweep.refunded };
  }

  // Read/query surface — extracted verbatim into
  // `session-lifecycle.queries.ts` (behavior-identical max-lines refactor,
  // same sibling-module layout as booking/confirmation/transitions); these
  // thin delegates pin the public namespace API so every resolver and test
  // call site stays stable.

  export function getSessionById(
    callerUserId: number,
    sessionId: number,
    tx?: DBTransaction
  ): Promise<SessionReturnType | null> {
    return SessionLifecycleQueries.getSessionById(callerUserId, sessionId, tx);
  }

  export function listMyStudentSessions(
    studentId: number,
    filter: SessionListFilterInput,
    page: number,
    pageSize: number,
    tx?: DBTransaction
  ): Promise<SessionPageReturnType> {
    return SessionLifecycleQueries.listMyStudentSessions(studentId, filter, page, pageSize, tx);
  }

  export function listMyTeacherSessions(
    teacherId: number,
    filter: SessionListFilterInput,
    page: number,
    pageSize: number,
    tx?: DBTransaction
  ): Promise<SessionPageReturnType> {
    return SessionLifecycleQueries.listMyTeacherSessions(teacherId, filter, page, pageSize, tx);
  }

  export function listAdminDisputedSessions(
    filter: SessionListFilterInput,
    limit: number,
    offset: number,
    tx?: DBTransaction
  ): Promise<SessionPageReturnType> {
    return SessionLifecycleQueries.listAdminDisputedSessions(filter, limit, offset, tx);
  }
}
