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
 *  - Every method takes `tx?: DBTransaction` as its LAST parameter. Reads
 *    run on the caller's transaction when supplied and fall back to raw
 *    parameterized SQL via `queryDb` (the Neon-HTTP-eligible pattern, as in
 *    `UserRepository.findById`) otherwise; writes execute on `tx ?? db`
 *    (the same fallback the student lane debit/refund methods use).
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
 * row's recorded lane.
 *
 * File layout: the standalone-capable read machinery (shared predicate
 * builders, the select-column shape, the list/count/probe reads) lives in
 * the sibling `session.repository.helpers.ts` module (extracted verbatim);
 * the guarded write transitions stay implemented inline below. Every read
 * method is a one-to-one delegation wrapper, so the public API (names,
 * signatures, behavior) is unchanged.
 */

import { and, eq, isNotNull, or, sql } from "drizzle-orm";
import { db } from "@/backend/db";
import * as sessionRepositoryImpl from "@/backend/db/repo/classes/session.repository.helpers";
import { session } from "@/backend/db/schema/classes/session";
import { teacher } from "@/backend/db/schema/teachers/teacher";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import type {
  DBTransaction,
  SessionInsertType,
  SessionListFilterInput,
  SessionSelectType,
  SessionTransitionProbeRowType,
  SessionWaveContextRow,
} from "@/backend/types";

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
    return sessionRepositoryImpl.findWaveContextById(id, tx);
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
    const now = new Date();
    const executor = tx ?? db;
    const rows = await executor
      .update(session)
      .set({ status: SessionStatus.Completed, endedAt: now, confirmedByTeacherAt: now, updatedAt: now })
      .where(
        and(
          eq(session.id, id),
          eq(session.teacherId, teacherId),
          eq(session.status, SessionStatus.Started),
          sql`EXISTS (SELECT 1 FROM ${teacher} WHERE ${eq(teacher.id, session.teacherId)} AND ${eq(teacher.isApproved, true)})`
        )
      )
      .returning();
    return rows[0] ?? null;
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
      .where(
        and(
          eq(session.id, id),
          or(eq(session.studentId, participantId), eq(session.teacherId, participantId)),
          or(eq(session.status, SessionStatus.Scheduled), eq(session.status, SessionStatus.Started))
        )
      )
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
      .where(
        and(
          eq(session.id, id),
          or(eq(session.studentId, participantId), eq(session.teacherId, participantId)),
          or(eq(session.status, SessionStatus.Scheduled), eq(session.status, SessionStatus.Started))
        )
      )
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
    tx?: DBTransaction
  ): Promise<SessionSelectType | null> {
    const now = new Date();
    const executor = tx ?? db;
    const rows = await executor
      .update(session)
      .set({ status: SessionStatus.Cancelled, feeHeld: false, resolutionNote, resolvedAt: now, updatedAt: now })
      .where(and(eq(session.id, id), eq(session.status, SessionStatus.Disputed)))
      .returning();
    return rows[0] ?? null;
  }

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
        resolvedAt: now,
        updatedAt: now,
      })
      .where(and(eq(session.id, id), eq(session.status, SessionStatus.Disputed), isNotNull(session.startedAt)))
      .returning();
    return rows[0] ?? null;
  }

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
  export async function listAdminDisputed(
    limit: number,
    offset: number,
    tx?: DBTransaction
  ): Promise<SessionSelectType[]> {
    return sessionRepositoryImpl.listAdminDisputed(limit, offset, tx);
  }

  /**
   * Counts the disputed sessions under the SAME status-first predicate as
   * `listAdminDisputed` — the honest total for the paginated arbitration
   * read.
   */
  export async function countAdminDisputed(tx?: DBTransaction): Promise<number> {
    return sessionRepositoryImpl.countAdminDisputed(tx);
  }
}
