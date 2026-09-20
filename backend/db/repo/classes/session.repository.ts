/**
 * SessionRepository — data-access layer for the `session` table.
 *
 * The `session` row is the central scheduling entity: one meeting between a
 * teacher and a student (`teacher_id`/`student_id` are NOT NULL restrict FKs
 * onto the shared `users.id` PKs). Lifecycle transitions are SINGLE guarded
 * conditional UPDATE statements: the full predicate (row identity + owning
 * teacher/participant + current lifecycle state, and for completion the
 * fused certification re-assertion) and the mutation share one statement, so
 * predicate evaluation happens under PostgreSQL's row lock with zero
 * check-then-write window. A transition that matches zero rows reports
 * `null`; deciding WHY (unknown row vs non-participant vs wrong state vs
 * decertified teacher) belongs to the caller, which classifies via
 * `findTransitionProbe` — a cold-path projection read that never feeds
 * writes.
 *
 * Conventions per `backend/db/repo/AGENTS.md`:
 *  - One `namespace` per repository file; the namespace name is the
 *    canonical export.
 *  - Every method takes `tx` as its LAST parameter. Reads run on the
 *    caller's transaction when supplied and fall back to raw
 *    parameterized SQL via `queryDb` (the Neon-HTTP-eligible pattern, as in
 *    `UserRepository.findById`) otherwise; writes execute on `tx ?? db`
 *    (the same fallback the student lane debit/refund methods use).
 *    Locking reads and the evaluation-cycle probes take a REQUIRED `tx`
 *    (`lockForReportGate`, `resolveCurrentEvaluationCycle`,
 *    `countEvaluationBookingsInCycle`): a `FOR UPDATE` lock taken outside
 *    a transaction releases when the statement ends and protects nothing
 *    (the `lockForCertificationCheck` shape), and a cycle/capacity
 *    decision must observe the caller transaction's own writes.
 *  - NO prepared statements — the list predicates are dynamically composed
 *    and every write is transactional (`docs/drizzle/prepared-statements.md`
 *    excludes both from preparation). NO array-membership operators — the
 *    cancel/dispute-state memberships and every other predicate are
 *    composed from equality conditions. No SQL line-comment sequences in
 *    any statement. Lifecycle vocabulary is carried by the `SessionStatus`
 *    enum members, never string literals.
 *  - No business logic, no permission checks, no i18n or logging imports —
 *    the caller decides what `null` means.
 *
 * Dispute transitions extend the same guarded-UPDATE family: a participant
 * opens a dispute from a live state exactly once, and an admin resolves a
 * disputed row into exactly one terminal state. The CANCEL resolution
 * clears the hold marker inside its guarded UPDATE and leaves the
 * provenance lane intact — the same-lane refund that completes the
 * arbitration is the CALLER's follow-up write on the same transaction
 * (the identical shape `cancelSession` composes), driven by the returned
 * row's recorded lane. The dispute surface is two-generation: rows whose
 * fee is still held dispute from a live state and resolve with the
 * shipped CANCEL/COMPLETE pair, while consumed-escrow rows (dual-confirmed
 * completions whose fee was already earned) dispute through the
 * student-only post-confirmation entry and resolve through the
 * consumed-generation completion leg — both generations share the
 * `disputed` state and are discriminated everywhere by `fee_held` inside
 * the write predicates themselves, never by a prior read.
 *
 * File layout: the standalone-capable read machinery (shared predicate
 * builders, the select-column shape, the list/count/probe reads) lives in
 * the sibling `session.repository.helpers.ts` module (extracted verbatim);
 * the joined wave-context read lives in the sibling
 * `session.repository.wave.helpers.ts` module (extracted verbatim); the
 * gate-supporting row reads (the report gate's `FOR UPDATE` lock and the
 * rating-eligibility probe) live in the sibling
 * `session.repository.gate.helpers.ts` module (extracted verbatim); the
 * post-confirmation dispute primitives live in the sibling
 * `session.repository.arbitration.helpers.ts` module (same extraction
 * pattern); the evaluation-booking cycle reads (the active-cycle probe,
 * the per-cycle aggregate, and the applicant evaluation-session list) live
 * in the sibling `session.repository.evaluation.helpers.ts` module. The
 * guarded write transitions stay in this file, their shared
 * participant live-state predicate factored into the module-level
 * `buildLiveParticipantTransitionPredicate` builder. Every read
 * method is a one-to-one delegation (signature wrappers or type-exact
 * const re-exports), so the public API (names, signatures, behavior) is
 * unchanged.
 */

import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/backend/db";
import * as arbitrationImpl from "@/backend/db/repo/classes/session.repository.arbitration.helpers";
import type {
  EvaluationCycleWindow,
  EvaluationSessionListFilter,
} from "@/backend/db/repo/classes/session.repository.evaluation.helpers";
import * as sessionRepositoryEvaluationImpl from "@/backend/db/repo/classes/session.repository.evaluation.helpers";
import * as sessionRepositoryGateImpl from "@/backend/db/repo/classes/session.repository.gate.helpers";
import * as sessionRepositoryImpl from "@/backend/db/repo/classes/session.repository.helpers";
import * as sessionRepositoryLifecycleImpl from "@/backend/db/repo/classes/session.repository.lifecycle.helpers";
import * as sessionRepositoryWaveImpl from "@/backend/db/repo/classes/session.repository.wave.helpers";
import { session } from "@/backend/db/schema/classes/session";
import type { DisputeResolution } from "@/backend/enum/scheduling/dispute-resolution.enum";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import type {
  AdminSessionDetail,
  DBQueryExecutor,
  DBTransaction,
  SessionInsertType,
  SessionListFilterInput,
  SessionRatingEligibilityProbeType,
  SessionReportWaveContextRow,
  SessionSelectType,
  SessionTransitionProbeRowType,
  SessionWaveContextRow,
} from "@/backend/types";
import { SESSION_CONFIRMATION_WINDOW_MS } from "@/shared/constants/session-fees.constants";

export namespace SessionRepository {
  /**
   * Inserts one `session` row and returns it (`INSERT … RETURNING`).
   *
   * The caller (session creation flow) supplies every server-controlled
   * column: the participant ids resolved from locked identities, the
   * lifecycle/type/intent vocabulary, the platform fee (a decimal string
   * carried verbatim — no arithmetic), the escrow hold marker and its
   * provenance lane, and the confirmation deadline. Schema defaults fill
   * anything the caller legitimately omits (lifecycle state defaults to the
   * pre-start state, the hold marker to false).
   *
   * @returns The inserted row with all server-generated columns populated.
   */
  export async function insertSession(insert: SessionInsertType, tx?: DBTransaction): Promise<SessionSelectType> {
    const executor = tx ?? db;
    const [row] = await executor.insert(session).values(insert).returning();
    if (!row) {
      throw new Error("SessionRepository.insertSession: insert returned no rows");
    }
    return row;
  }

  /**
   * Finds a session row by primary key.
   *
   * Read-only: on the caller's transaction it runs as a Drizzle select;
   * standalone it runs as raw parameterized SQL via `queryDb`.
   *
   * @returns The matching session row, or `null` when the id is unknown.
   *          Participant-scoping (returning null for non-participants) is
   *          the read service's decision — this method is the raw PK read.
   */
  export async function findById(id: number, tx?: DBTransaction): Promise<SessionSelectType | null> {
    return sessionRepositoryImpl.findById(id, tx);
  }

  /**
   * ONE joined read of the session-request wave context: the session's
   * `id` + raw `intent` (untrusted storage — the service layer validates
   * it) together with BOTH participants' `userId`/`fullName`/`locale`.
   *
   * Read-only: on the caller's transaction it runs as a Drizzle join;
   * standalone it runs as raw parameterized SQL via `queryDb`.
   *
   * @returns The joined wave-context row, or `null` when no session
   *          carries that id (the INNER JOINs make a participant-missing
   *          row structurally impossible, so `null` uniformly means
   *          session-not-found).
   */
  export async function findWaveContextById(id: number, tx?: DBTransaction): Promise<SessionWaveContextRow | null> {
    return sessionRepositoryWaveImpl.findWaveContextById(id, tx);
  }

  /**
   * Starts a session exactly once: a single guarded UPDATE whose predicate
   * requires row identity, the owning teacher, and the pre-start state.
   * Writes the start stamp and the audit stamp from one captured instant.
   * The confirmation deadline is deliberately NOT in the SET clause — it is
   * written at creation and never re-armed by any transition.
   *
   * @returns The updated row, or `null` when zero rows matched (unknown id,
   *          non-owner teacher, or the row is no longer in the pre-start
   *          state — the caller classifies via the transition probe).
   */
  export async function startSessionOnce(
    id: number,
    teacherId: number,
    tx?: DBTransaction
  ): Promise<SessionSelectType | null> {
    const now = new Date();
    const executor = tx ?? db;
    const rows = await executor
      .update(session)
      .set({ status: SessionStatus.Started, startedAt: now, updatedAt: now })
      .where(and(eq(session.id, id), eq(session.teacherId, teacherId), eq(session.status, SessionStatus.Scheduled)))
      .returning();
    return rows[0] ?? null;
  }

  /**
   * Completes a session exactly once: a single guarded UPDATE whose
   * predicate fuses the ownership/state conditions with the certification
   * re-assertion — an `EXISTS (SELECT 1 FROM teacher …)` subquery evaluated
   * inside the same statement, so a teacher decertified between booking and
   * completion can never complete (zero rows match; no separate read exists
   * to race against). Writes the end stamp, the teacher confirmation stamp,
   * and the audit stamp from one captured instant. Report/homework side
   * effects are deliberately absent — this method touches ONLY the session
   * row.
   *
   * @returns The updated row, or `null` when zero rows matched (unknown id,
   *          non-owner, wrong state, or the owning teacher no longer holds a
   *          strictly-true certification — the caller classifies via the
   *          transition probe).
   */
  export async function completeSessionOnce(
    id: number,
    teacherId: number,
    tx?: DBTransaction
  ): Promise<SessionSelectType | null> {
    return sessionRepositoryLifecycleImpl.completeSessionOnce(id, teacherId, tx);
  }

  /**
   * Cancels a session exactly once, callable by EITHER participant: a
   * single guarded UPDATE whose predicate requires row identity, the caller
   * being the session's student OR its teacher, and the lifecycle state
   * still being cancellable (pre-start or in-progress — completed and
   * cancelled rows are structurally unreachable, so a double cancel can
   * never double-release the held fee). Clears the escrow hold marker;
   * keeps the start stamp as-is and never writes an end stamp for a
   * cancellation. The trimmed cancellation reason is persisted inside this
   * same guarded statement (NULL when the caller supplied none — no
   * behavior change to the predicate or stamps). The held-fee refund to
   * the funding lane is the caller's follow-up write inside the same
   * transaction, driven by the returned row's provenance lane.
   *
   * @returns The updated row, or `null` when zero rows matched (unknown id,
   *          non-participant caller, or the row already reached a terminal
   *          state — the caller classifies via the transition probe).
   */
  export async function cancelSessionOnce(
    id: number,
    participantId: number,
    cancelReason: string | null,
    tx?: DBTransaction
  ): Promise<SessionSelectType | null> {
    const now = new Date();
    const executor = tx ?? db;
    const rows = await executor
      .update(session)
      .set({ status: SessionStatus.Cancelled, feeHeld: false, cancelReason, updatedAt: now })
      .where(sessionRepositoryWaveImpl.buildLiveParticipantTransitionPredicate(id, participantId))
      .returning();
    return rows[0] ?? null;
  }

  /**
   * Opens a dispute exactly once, callable by EITHER participant: a single
   * guarded UPDATE whose predicate requires row identity, the caller being
   * the session's student OR its teacher, and the lifecycle state still
   * live (pre-start or in-progress — terminal rows and already-disputed
   * rows are structurally unreachable, so a double dispute can never
   * rewrite a recorded reason). Writes the dispute reason and the dispute
   * stamp from one captured instant. The escrow hold is deliberately
   * untouched — the hold money stays frozen until the admin resolution
   * releases or consumes it.
   *
   * @returns The updated row, or `null` when zero rows matched (unknown id,
   *          non-participant caller, or the row is not in a live state —
   *          the caller classifies via the transition probe).
   */
  export async function openDisputeOnce(
    id: number,
    participantId: number,
    disputeReason: string,
    tx?: DBTransaction
  ): Promise<SessionSelectType | null> {
    const now = new Date();
    const executor = tx ?? db;
    const rows = await executor
      .update(session)
      .set({ status: SessionStatus.Disputed, disputeReason, disputedAt: now, updatedAt: now })
      .where(sessionRepositoryWaveImpl.buildLiveParticipantTransitionPredicate(id, participantId))
      .returning();
    return rows[0] ?? null;
  }

  /**
   * Resolves a disputed session into `cancelled` exactly once (the admin
   * arbitration CANCEL outcome): a single guarded UPDATE whose predicate
   * requires row identity and the disputed state — a row in any other
   * state is structurally unreachable, so a resolution can never run
   * twice. Writes the resolution note and stamp from one captured instant
   * and clears the escrow hold marker inside the same statement, keeping
   * the provenance lane intact for the caller's same-lane refund — the
   * refund and the status flip land in ONE transaction only because the
   * caller composes them there (the identical shape `cancelSessionOnce`
   * leaves behind).
   *
   * @returns The updated row, or `null` when zero rows matched (unknown id
   *          or a row no longer disputed — the caller classifies via the
   *          transition probe).
   */
  export async function resolveDisputeCancelOnce(
    id: number,
    resolutionNote: string | null,
    resolutionOutcome: DisputeResolution,
    tx?: DBTransaction
  ): Promise<SessionSelectType | null> {
    const now = new Date();
    const executor = tx ?? db;
    const rows = await executor
      .update(session)
      .set({
        status: SessionStatus.Cancelled,
        feeHeld: false,
        resolutionNote,
        resolutionOutcome,
        resolvedAt: now,
        updatedAt: now,
      })
      .where(and(eq(session.id, id), eq(session.status, SessionStatus.Disputed)))
      .returning();
    return rows[0] ?? null;
  }

  /**
   * Opens a post-confirmation dispute exactly once (the student-only entry
   * for the consumed escrow generation): a single guarded UPDATE whose
   * predicate requires row identity, the caller being the session's
   * student, the row `completed` with the student's dual-confirmation stamp
   * written, AND the escrow already consumed — the held generation (fees
   * still frozen) and the teacher-confirmed-only rows inside their
   * confirmation window are structurally unreachable, as is any replay
   * against a row already disputed. Writes the dispute reason and the
   * dispute stamp from one captured instant. The escrow columns and the
   * completion stamps are deliberately untouched: opening the dispute
   * records intent only, and every financial write belongs to the
   * arbitration outcome that later resolves it.
   *
   * @returns The updated row, or `null` when zero rows matched (unknown
   *          id, non-participant caller, wrong state, missing student
   *          stamp, or a row whose fee is still held — the caller
   *          classifies via the arbitration probe).
   */
  export const openPostConfirmationDisputeOnce = arbitrationImpl.openPostConfirmationDisputeOnce;

  /**
   * Resolves a disputed session into `completed` exactly once (the admin
   * arbitration COMPLETE outcome): a single guarded UPDATE whose predicate
   * requires row identity, the disputed state, AND a written start stamp —
   * a dispute on a session that never started is structurally unreachable
   * here (the caller pre-validates that shape before this write, and the
   * fused `IS NOT NULL` predicate keeps the statement self-sufficient
   * under races). Writes the end stamp, resolution note and stamp from one
   * captured instant and consumes the hold (`fee_held = false`) in the
   * same statement — no credit write is part of this method (the escrow
   * hold is consumed, never reimbursed; the credit flow is a later
   * ticket's concern).
   *
   * @returns The updated row, or `null` when zero rows matched (unknown
   *          id, a row no longer disputed, or a disputed row without a
   *          start stamp — the caller classifies via the transition
   *          probe).
   */
  export async function resolveDisputeCompleteOnce(
    id: number,
    resolutionNote: string | null,
    resolutionOutcome: DisputeResolution,
    tx?: DBTransaction
  ): Promise<SessionSelectType | null> {
    const now = new Date();
    const executor = tx ?? db;
    const rows = await executor
      .update(session)
      .set({
        status: SessionStatus.Completed,
        feeHeld: false,
        endedAt: now,
        resolutionNote,
        resolutionOutcome,
        resolvedAt: now,
        updatedAt: now,
      })
      .where(and(eq(session.id, id), eq(session.status, SessionStatus.Disputed), isNotNull(session.startedAt)))
      .returning();
    return rows[0] ?? null;
  }

  /**
   * Resolves a consumed-escrow dispute into `completed` exactly once (the
   * arbitration completion leg shared by the REFUND, PARTIAL REFUND, and
   * UPHELD outcomes): a single guarded UPDATE whose predicate requires row
   * identity, the disputed state, AND the consumed escrow — a held-
   * generation dispute is structurally unreachable (its own resolutions
   * are the CANCEL/COMPLETE pair above), and a row already resolved
   * matches zero rows, so an outcome can never commit twice. Writes the
   * resolution note and stamp from one captured instant and returns the
   * arbitration probe projection (both participants, the fee, the hold
   * marker, the provenance lane, the student's dual-confirmation stamp) so
   * the caller composes the outcome's financial legs — the wallet
   * reversal and the same-lane credit — on the SAME transaction without a
   * re-read. No financial write is part of this method, and the original
   * completion stamps are deliberately preserved (the meeting ended once).
   *
   * @returns The probe-shaped row, or `null` when zero rows matched
   *          (unknown id, a row no longer disputed, or a disputed row
   *          whose fee is still held — the caller classifies via the
   *          arbitration probe).
   */
  export const resolveConsumedDisputeOnce = arbitrationImpl.resolveConsumedDisputeOnce;

  /**
   * Cold-path probe: reads the minimal classification projection (identity
   * + lifecycle state + both participants + the start stamp) for a session
   * id. Used ONLY AFTER a guarded transition matched zero rows (or, for
   * the arbitration COMPLETE outcome, BEFORE the guarded write) to
   * distinguish an unknown id from a non-participant caller from a
   * wrong-state row from a never-started dispute; the probe is
   * classification-only — it never gates or influences any write.
   *
   * @returns The five-column projection, or `null` when the id is unknown.
   */
  export async function findTransitionProbe(
    id: number,
    tx?: DBTransaction
  ): Promise<SessionTransitionProbeRowType | null> {
    return sessionRepositoryImpl.findTransitionProbe(id, tx);
  }

  /**
   * Rating-eligibility probe: reads the minimal gate projection (row
   * identity, both participants, the lifecycle state, and the dual
   * completion stamps) for a session id. A plain (non-locking) read —
   * the probe is classification-only and never feeds a guarded update;
   * duplicate submissions are arbitrated downstream by the evaluations
   * table's unique (session, evaluator) constraint. `tx` is REQUIRED:
   * the gate decision observes the caller transaction's own writes.
   *
   * @returns The six-column probe row, or `null` when the id is unknown
   *          (the caller owns the not-found semantics).
   */
  export async function findRatingEligibilityProbe(
    sessionId: number,
    tx: DBTransaction
  ): Promise<SessionRatingEligibilityProbeType | null> {
    return sessionRepositoryGateImpl.findRatingEligibilityProbe(sessionId, tx);
  }

  /**
   * Arbitration classification probe: the escrow-focused column projection
   * (identity + lifecycle state + both participants + the fee, the hold
   * marker, the permanent provenance lane, and the student's dual-
   * confirmation stamp) — the transition probe's financial twin, read by
   * the arbitration surface to classify a row into its dispute generation
   * and to drive the outcome legs. A `null` lane on a returned probe means
   * no fee was ever held (the never-held defensive case; the caller's
   * lane-credit leg becomes a no-op). Like every probe, it is
   * classification-only — it never gates or influences any write.
   *
   * @returns The eight-column projection, or `null` when the id is
   *          unknown.
   */
  export const findArbitrationProbe = arbitrationImpl.findArbitrationProbe;
  export const getDisputeAnalyticsCounts = arbitrationImpl.getDisputeAnalyticsCounts;

  /**
   * Report-gate row lock: takes the `FOR UPDATE` lock on the session row
   * and reads the transition-probe projection inside the SAME statement,
   * so a report submission serializes against every other
   * gate-locked writer of that row and the returned lifecycle state is
   * the state the caller's subsequent writes commit against (no window
   * for the row to change between the read and the caller's writes).
   *
   * `tx` is REQUIRED (not optional): a locking read without a transaction
   * releases its lock as soon as the statement finishes, which would make
   * the gate meaningless — the shape mirrors
   * `TeacherRepository.lockForCertificationCheck`. The projection reuses
   * the transition-probe row type (identity, lifecycle state, both
   * participants, start stamp — the stamp rides along unused by callers
   * that only need the gate quadruple).
   *
   * @returns The locked probe row, or `null` when the id is unknown
   *          (the caller classifies, exactly as for the transition
   *          probe).
   */
  export async function lockForReportGate(
    sessionId: number,
    tx: DBTransaction
  ): Promise<SessionTransitionProbeRowType | null> {
    return sessionRepositoryGateImpl.lockForReportGate(sessionId, tx);
  }

  /**
   * ONE joined read of the report wave context: BOTH participants'
   * `userId`/`fullName`/`locale` together with the student's LINKED PARENT
   * (via `students.parent_id`, LEFT JOINed — unlinked students yield a
   * `null` parent leg). This is exactly the recipient set the report
   * notification seam needs, and nothing else.
   *
   * Read-only: on the caller's transaction it runs as a Drizzle join;
   * standalone it runs as raw parameterized SQL via `queryDb`.
   *
   * @returns The joined wave-context row, or `null` when no session
   *          carries that id (the participant INNER JOINs make a
   *          participant-missing row structurally impossible, so `null`
   *          uniformly means session-not-found; the `students` bridge is
   *          LEFT JOINed, so a student user without a `students` row still
   *          yields the context with a `null` parent leg).
   */
  export async function findReportWaveContextById(
    id: number,
    tx?: DBTransaction
  ): Promise<SessionReportWaveContextRow | null> {
    return sessionRepositoryWaveImpl.findReportWaveContextById(id, tx);
  }

  /**
   * Student completion confirmation — commits the student's half of the
   * dual confirmation EXACTLY once: a single guarded UPDATE whose predicate
   * requires row identity, the student being the caller, the row already
   * `completed` with the teacher's stamp written (structurally true of
   * every completed row — `completeSessionOnce` writes it), the student
   * stamp still absent, AND the escrow hold still marked — the credit's
   * exactly-once guard lives in the statement itself, so a replayed
   * confirm matches zero rows and can never double-credit. Flips
   * `fee_held = false` (the hold consumed by earning) and writes the
   * student stamp from one captured instant; the caller composes the
   * wallet credit on the SAME transaction.
   *
   * @returns The updated row (its `fee` and `teacherId` feed the credit
   *          slice), or `null` when zero rows matched (already confirmed,
   *          hold already released, wrong state, non-participant, unknown
   *          id — the caller classifies via the transition probe).
   */
  export async function confirmStudentCompletionOnce(
    id: number,
    studentUserId: number,
    tx?: DBTransaction
  ): Promise<SessionSelectType | null> {
    const now = new Date();
    const executor = tx ?? db;
    const rows = await executor
      .update(session)
      .set({ confirmedByStudentAt: now, feeHeld: false, updatedAt: now })
      .where(
        and(
          eq(session.id, id),
          eq(session.studentId, studentUserId),
          eq(session.status, SessionStatus.Completed),
          eq(session.feeHeld, true),
          isNotNull(session.confirmedByTeacherAt),
          sql`${session.confirmedByStudentAt} IS NULL`
        )
      )
      .returning();
    return rows[0] ?? null;
  }

  /**
   * Confirmation-deadline sweeper: ONE guarded batch UPDATE cancelling
   * every still-`scheduled` session whose confirmation deadline has
   * passed. The deadline is never re-armed anywhere (written at creation
   * only), so `confirmation_deadline < now` is a stable predicate. The
   * statement clears the hold marker (the caller refunds
   * each returned row's recorded lane through the shared same-lane
   * primitive); rows WITHOUT a hold match too (a deadline breach cancels
   * regardless of escrow) — a NULL lane on a returned row means there is
   * nothing to refund. Idempotent: a second run matches zero rows.
   *
   * @param now  The caller's single captured sweep instant — every row's
   *     `updated_at` shares it, and the deadline comparison uses the same
   *     clock reading.
   * @returns Every cancelled row (the caller refunds the held ones).
   */
  export async function sweepExpiredScheduledOnce(now: Date, tx?: DBTransaction): Promise<SessionSelectType[]> {
    const executor = tx ?? db;
    return executor
      .update(session)
      .set({ status: SessionStatus.Cancelled, feeHeld: false, updatedAt: now })
      .where(and(eq(session.status, SessionStatus.Scheduled), sql`${session.confirmationDeadline} < ${now}`))
      .returning();
  }

  /**
   * Post-completion confirmation sweeper: ONE guarded batch UPDATE
   * cancelling every `completed` session whose student-confirmation window
   * has elapsed — the teacher's confirmation stamp is older than the
   * window while the student stamp is still absent. The window is
   * evaluated at sweep time from the recorded teacher stamp (pure
   * predicate arithmetic — the confirmation deadline column is written at
   * creation and never re-armed by any transition). The statement clears
   * the hold marker (the caller refunds each returned row's recorded lane
   * through the shared same-lane primitive); rows WITHOUT a recorded lane
   * match too — a NULL lane on a returned row means there is nothing to
   * refund. A student-confirmed row never matches (its escrow was
   * consumed by earning, not held for refund), and a row in any
   * non-completed state is structurally unreachable. Idempotent: a second
   * run matches zero rows.
   *
   * @param now  The caller's single captured sweep instant — every row's
   *     `updated_at` shares it, and the window comparison uses the same
   *     clock reading.
   * @returns Every cancelled row (the caller refunds the held ones).
   */
  export async function sweepExpiredCompletedOnce(now: Date, tx?: DBTransaction): Promise<SessionSelectType[]> {
    const cutoff = new Date(now.getTime() - SESSION_CONFIRMATION_WINDOW_MS);
    const executor = tx ?? db;
    return executor
      .update(session)
      .set({ status: SessionStatus.Cancelled, feeHeld: false, updatedAt: now })
      .where(
        and(
          eq(session.status, SessionStatus.Completed),
          sql`${session.confirmedByStudentAt} IS NULL`,
          sql`${session.confirmedByTeacherAt} < ${cutoff}`
        )
      )
      .returning();
  }

  /**
   * Lists the student's own sessions, newest first, paged. Consumes the
   * shared module-scope predicate builder together with
   * `countForStudent`, so the page window and the honest total describe the
   * same filtered set.
   *
   * @returns The page rows (an empty array when the window falls past the
   *          end — the count companion still reports the true total).
   */
  export async function listForStudent(
    studentId: number,
    filter: SessionListFilterInput,
    limit: number,
    offset: number,
    tx?: DBTransaction
  ): Promise<SessionSelectType[]> {
    return sessionRepositoryImpl.listParticipantSessions(session.studentId, studentId, filter, limit, offset, tx);
  }

  /**
   * Lists the teacher's own sessions — the teacher-side twin of
   * `listForStudent`, identical ordering/paging/filter semantics over the
   * owning-teacher predicate.
   */
  export async function listForTeacher(
    teacherId: number,
    filter: SessionListFilterInput,
    limit: number,
    offset: number,
    tx?: DBTransaction
  ): Promise<SessionSelectType[]> {
    return sessionRepositoryImpl.listParticipantSessions(session.teacherId, teacherId, filter, limit, offset, tx);
  }

  /**
   * Counts the student's own sessions under the SAME filter semantics as
   * `listForStudent` (one shared predicate builder) — the honest total for
   * the paginated read.
   */
  export async function countForStudent(
    studentId: number,
    filter: SessionListFilterInput,
    tx?: DBTransaction
  ): Promise<number> {
    return sessionRepositoryImpl.countParticipantSessions(session.studentId, studentId, filter, tx);
  }

  /**
   * Counts the teacher's own sessions — the teacher-side twin of
   * `countForStudent`, same shared predicate builder.
   */
  export async function countForTeacher(
    teacherId: number,
    filter: SessionListFilterInput,
    tx?: DBTransaction
  ): Promise<number> {
    return sessionRepositoryImpl.countParticipantSessions(session.teacherId, teacherId, filter, tx);
  }

  /**
   * Lists the disputed sessions (the admin arbitration work queue), newest
   * first, paged. Consumes the ONE status-first admin predicate together
   * with `countAdminDisputed`, so the page window and the honest total
   * describe the same filtered set. No owner equality exists on this read
   * — the admin surface is role-gated upstream, and ownership scoping is
   * the participant lists' job.
   *
   * @returns The page rows (an empty array when the window falls past the
   *          end — the count companion still reports the true total).
   */
  export const listAdminDisputed = sessionRepositoryImpl.listAdminDisputed;

  /**
   * Counts the disputed sessions under the SAME status-first predicate as
   * `listAdminDisputed` — the honest total for the paginated arbitration
   * read.
   */
  export const countAdminDisputed = sessionRepositoryImpl.countAdminDisputed;

  /**
   * Lists sessions for the admin governance directory: EVERY row regardless
   * of state or ownership (the admin surface is role-gated upstream — no
   * participant scoping exists on this read), newest first, paged, under
   * the caller's optional filter set: owning teacher, owning student, the
   * session type, the lifecycle status, and the half-open creation window
   * (`created_at >= dateFrom`, `created_at < dateTo`, UTC instants — a
   * zero-width window is a legitimate empty result). Absent members drop
   * out of the predicate; they never error. The page window normalizes
   * before any database work exactly like the participant lists: a page
   * below 1 falls back to the first page and a page size outside 1..50
   * falls back to the default — the read never fabricates a window.
   * READ-ONLY by contract: no session, audit, or notification write exists
   * on this path, and no lazy side effect rides inside the query.
   *
   * @returns The page rows with the derived `needsAttention` badge flag
   *          projected per row (disputed, or scheduled with a lapsed
   *          confirmation deadline — styling only, never authorization),
   *          plus the honest total computed by the SAME filtered predicate
   *          (list and count share one predicate builder — the total can
   *          never diverge from the items).
   */
  export const listForAdmin = sessionRepositoryImpl.listAdminDirectoryPage;

  /**
   * Admin browse read of ANY session row by primary key — no participant
   * scoping and no lifecycle restriction (the detail view is read-only and
   * role-gated upstream; ownership scoping is the participant reads' job).
   *
   * @returns The full row, or `null` when the id is unknown — a browse read
   *          answers "no such row" with data, never with a thrown
   *          not-found error; classifying an id-probe is the participant
   *          reads' concern, not this one's.
   */
  export async function getAnyByIdForAdmin(id: number, tx?: DBTransaction): Promise<AdminSessionDetail> {
    return sessionRepositoryImpl.findById(id, tx);
  }

  /**
   * Admin reschedule guard: a single guarded UPDATE whose predicate
   * requires row identity and the row still being in one of the two states
   * with mutable timing (pre-start or in-progress — see the shared
   * predicate builder). Writes ONLY the replacement timing pair plus the
   * audit stamp from one captured instant — every other column is
   * structurally absent from the SET clause, so a caller-supplied extra
   * field has nowhere to land.
   *
   * @returns The updated row, or `null` when zero rows matched (unknown id
   *          or a row no longer eligible — terminal rows and disputed rows
   *          are structurally unreachable). The eligibility clause IS the
   *          atomic gate: no read-then-write gap and no row lock beyond
   *          the statement's own — the caller classifies a miss without a
   *          second write attempt.
   */
  export async function guardReschedule(
    sessionId: number,
    startedAt: Date,
    endedAt: Date,
    tx?: DBTransaction
  ): Promise<SessionSelectType | null> {
    return sessionRepositoryImpl.guardReschedule(sessionId, startedAt, endedAt, tx);
  }

  /**
   * Admin cancel guard: a single guarded UPDATE whose predicate requires
   * row identity and the row still being in one of the two pre-terminal
   * live states (pre-start or in-progress). A disputed row is NOT
   * eligible — an open dispute belongs to the arbitration surface, which
   * is the only writer allowed to exit a disputed row into a terminal
   * state — and a cancelled row is unreachable (terminal), so a replayed
   * cancel matches zero rows and can never re-cancel. Writes the cancelled
   * status, the CLEARED hold marker, and the audit stamp from one captured
   * instant — the participant cancel's exact terminal shape
   * (`cancelSessionOnce`), so a committed admin cancellation can never
   * leave a `fee_held = true` terminal row behind. The provenance lane is
   * deliberately untouched: the RETURNING row still carries the recorded
   * lane the caller's same-transaction same-lane refund composes against.
   *
   * @returns The updated row, or `null` when zero rows matched (unknown id
   *          or a row no longer eligible — the caller classifies via the
   *          transition probe).
   */
  export async function guardCancelPreTerminal(
    sessionId: number,
    tx?: DBTransaction
  ): Promise<SessionSelectType | null> {
    return sessionRepositoryImpl.guardCancelPreTerminal(sessionId, tx);
  }

  export async function guardReassignTeacher(
    sessionId: number,
    newTeacherId: number,
    tx?: DBTransaction
  ): Promise<SessionSelectType | null> {
    return arbitrationImpl.guardReassignTeacher(sessionId, newTeacherId, tx);
  }

  /**
   * Active-verification-cycle probe: resolves the applicant's CURRENT
   * evaluation cycle window — the newest ACTIVE subscription whose plan is
   * the verification plan, read as `{ cycleStart, activeSubscriptionId }`.
   * A `null` cycleStart means no active cycle (the loop is closed).
   * `tx` is REQUIRED: the cycle decision must observe the caller
   * transaction's own writes under the applicant row lock.
   *
   * @returns The cycle window (`cycleStart` null when no active
   *          verification subscription exists).
   */
  export async function resolveCurrentEvaluationCycle(
    applicantUserId: number,
    tx: DBTransaction
  ): Promise<EvaluationCycleWindow> {
    return sessionRepositoryEvaluationImpl.resolveCurrentEvaluationCycle(applicantUserId, tx);
  }

  /**
   * Per-cycle aggregate: counts the applicant's evaluation bookings inside
   * one purchased cycle in ONE table pass — the non-cancelled count, the
   * completed count, and the DISTINCT evaluator ids of the non-cancelled
   * rows (the distinctness memory), scoped to the half-open cycle window
   * (`created_at >= cycleStart`). `tx` is REQUIRED: the aggregate runs
   * under the caller's applicant row lock.
   *
   * @returns `{ booked, completed, evaluators }` — zero counts and an
   *          empty evaluator list when the cycle holds no non-cancelled
   *          rows.
   */
  export async function countEvaluationBookingsInCycle(
    applicantUserId: number,
    cycleStart: Date,
    tx: DBTransaction
  ): Promise<{ booked: number; completed: number; evaluators: number[] }> {
    return sessionRepositoryEvaluationImpl.countEvaluationBookingsInCycle(applicantUserId, cycleStart, tx);
  }

  /**
   * Lists the applicant's own evaluation sessions, newest first, paged:
   * the owner equality on the session's student leg plus the session type
   * pinned to the teacher-evaluation member, an optional lifecycle-state
   * filter, and a normalized page window (sane-fallback, never thrown) —
   * the page query and the same-predicate count describe one filtered
   * set, so the total is always honest.
   *
   * Read-only and standalone-capable: a Drizzle executor runs the typed
   * page + count reads on the supplied transaction; a checked-out
   * PoolClient runs the same parameterized SQL on the SUPPLIED client;
   * standalone callers fall back to the queryDb pool path.
   *
   * @returns The page rows plus the honest total (an out-of-range page
   *          yields an empty `items` array with the unchanged total).
   */
  export async function listEvaluationSessionsForApplicant(
    applicantUserId: number,
    filter: EvaluationSessionListFilter,
    tx?: DBQueryExecutor
  ): Promise<{ items: SessionSelectType[]; total: number }> {
    return sessionRepositoryEvaluationImpl.listEvaluationSessionsForApplicant(applicantUserId, filter, tx);
  }

  /**
   * Teacher↔student relationship probe: does ANY session row (any status)
   * link this teacher (shared PK with `users.id`, stored verbatim on
   * `session.teacher_id`) to this student? EXISTS-select only — no row
   * data is projected, no lock is taken; the probe rides the caller's
   * transaction when supplied and falls back to the pool otherwise.
   *
   * The composite index `session_teacher_id_student_id_idx` makes the probe
   * indexed: the scan is O(1) on the relationship pair. The predicate fuses
   * the teacher equality (`session.teacher_id = caller`) AND the student
   * equality (`session.student_id = studentId`) inside ONE statement, so the
   * tenancy decision lands SQL-side with zero post-filter surface — the
   * caller's identity (a teacher user id shared-PK'd with `teacher.id`) is
   * the probe's only authority, never client input.
   *
   * @returns `true` when at least one session links the caller (as teacher)
   *          to the student; `false` for an unknown caller, an unknown
   *          student, or a pair with zero shared sessions.
   */
  export const existsSessionForTeacherStudent = sessionRepositoryGateImpl.existsSessionForTeacherStudent;
}
