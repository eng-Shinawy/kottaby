/**
 * SessionArbitrationService — the post-confirmation (consumed-escrow)
 * dispute path over the `session` entity: the student's dispute entry on a
 * dual-confirmed session, the admin's binding three-outcome arbitration
 * (full refund | partial refund | uphold), and the admin's case-review
 * read that feeds the arbitration decision.
 *
 * Two dispute generations share the `disputed` state and are discriminated
 * by the row's persisted hold marker: a HELD dispute (the fee still
 * frozen) resolves through the shipped held-family service (Cancel |
 * Complete); a CONSUMED dispute — the fee already credited to the
 * teacher's wallet by the dual confirmation — resolves HERE. This surface
 * rejects held-family rows with the classification-mismatch denial, and
 * the held-family service keeps its own vocabulary untouched: the single
 * `resolveSessionDispute` mutation dispatches between the two services by
 * the row's class, and neither service can apply the other's semantics.
 *
 * `openPostConfirmationDispute` moves a dual-confirmed, escrow-consumed
 * row into `disputed` exactly once, for its OWN student only. The
 * classification read runs INSIDE the transaction and the guarded write
 * re-asserts the full predicate (row identity + the student caller +
 * `completed` + the student's confirmation stamp + `fee_held = false`), so
 * a drifted read cannot pass a write and a double submission is the
 * state-conflict loser — the recorded reason is never rewritten. The
 * escrow and both wallets are deliberately untouched here: opening the
 * dispute records intent only, and every financial write belongs to the
 * arbitration outcome. Zero audit rows are written on this path (a
 * participant action, mirroring the shipped pre-completion dispute).
 *
 * `arbitrateDispute` executes the binding outcome as ONE transaction with
 * a fixed composition order:
 *   1. the classification probe read INSIDE the transaction (no TOCTOU:
 *      the guarded write below re-asserts the same classification);
 *   2. the amount policy (the partial refund's shape + open (0, fee)
 *      range, and the no-stray-money rule) resolved BEFORE any write;
 *   3. the guarded completion leg — `status='disputed' ∧ fee_held=false`
 *      — which fires FIRST, so the loser of a concurrent arbitration
 *      classifies as the state conflict before any money moves;
 *   4. the financial legs on the SAME transaction: the compensating
 *      teacher reversal (one `withdrawal` ledger row keyed to the session
 *      + the guarded balance decrement; a shortfall is the typed
 *      insufficient-funds conflict that rolls everything back) for the
 *      refund outcomes, and the quantized student credit (ONE session
 *      credit to the recorded provenance lane; a row with no recorded lane
 *      skips the credit as a no-op while the teacher debit still applies);
 *   5. exactly ONE `Override` audit row for the session entity, appended
 *      through the shared writer on the same transaction — its `details`
 *      carry the resolution, the refunded amount under the outcome's own
 *      key, and the note's PRESENCE, never the note's content;
 *   6. the participants' dispute-resolved wave on the SAME transaction —
 *      persisted receipts that share the arbitration's fate, pushed by the
 *      transaction owner strictly after the commit.
 *
 * `getAdminDisputeCase` composes the evidence bundle for the arbitration
 * decision — the full session detail (through the admin browse/detail
 * service), the session report, the homework row, the recitation record,
 * and the session-scoped audit trail — as concurrent independent reads
 * with honest nulls wherever an artifact was never produced. The read is
 * strictly side-effect free.
 *
 * Notification seam: the dispute waves (the admin cohort on open; both
 * participants on resolution) are emitted by the dispute-notification
 * service on the flow's own transaction at the marked composition points —
 * the persisted receipts share the flow's single transaction and its fate.
 * Publish-after-commit is the transaction owner's: each flow pushes its
 * receipts strictly AFTER its own commit, and only when IT opened the
 * transaction (on the caller-transaction path the caller publishes). The
 * held dispute generation stays notification-silent (the shipped
 * session-lifecycle ruling): this surface is the only dispute path that
 * emits.
 *
 * All user-facing messages resolve through `getServerTranslations(locale)`;
 * rejections log via `logger.logDomainError` with `{code, entity,
 * entityId}` only. No module-level mutable state; no swallowed catches;
 * every mutation flow is one transaction with `tx` propagated to every
 * repository, wallet, and audit call. The flow internals live in the
 * sibling `session-arbitration.service.helpers.ts` module (the
 * session-services' extraction layout).
 */

import { SessionRepository, UserRepository } from "@/backend/db/repo";
import { DisputeResolution } from "@/backend/enum/scheduling/dispute-resolution.enum";
import { withTransaction } from "@/backend/lib/db/with-transaction";
import { AuditService } from "@/backend/services/admin/audit.service";
import {
  rejectSessionNotFound,
  rejectStateConflict,
} from "@/backend/services/classes/session-admin-governance.helpers";
import * as caseReads from "@/backend/services/classes/session-arbitration.case-reads.helpers";
import {
  assertArbitrationResolution,
  buildArbitrationAuditContract,
  classifyArbitrationProbe,
  classifyOpenDisputeProbe,
  creditLaneForArbitration,
  debitTeacherWalletForArbitration,
  rejectResolutionFamilyMismatch,
  resolveArbitrationDebitAmount,
} from "@/backend/services/classes/session-arbitration.service.helpers";
import { SessionDisputeNotificationService } from "@/backend/services/classes/session-dispute-notification.service";
import { assertAdminGovernanceClean } from "@/backend/services/classes/session-lifecycle.governance";
import {
  assertPositiveSafeSessionId,
  normalizeOptionalReasonText,
  normalizeRequiredReasonText,
  SESSION_DISPUTED_STATUS,
} from "@/backend/services/classes/session-lifecycle.guards";
import { SessionLifecycleQueries } from "@/backend/services/classes/session-lifecycle.queries";
import { NotificationEngine } from "@/backend/services/notifications";
import type {
  AdminDisputeAnalyticsReturnType,
  AdminDisputeCaseReturnType,
  AdminDisputedSessionPageReturnType,
  DBTransaction,
  SessionListFilterInput,
  SessionReturnType,
  StudentDisputeCaseReturnType,
  TeacherDisputeCaseReturnType,
} from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";

export namespace SessionArbitrationService {
  /**
   * Opens a post-confirmation dispute on a dual-confirmed session, as its
   * OWN student, moving the row into the arbitration state exactly once.
   *
   * The target session id is guarded as a positive safe integer BEFORE any
   * database work, and the required reason is trimmed and length-capped
   * (whitespace-only or over-limit content is the pre-DB `VALIDATION`
   * denial). Deliberately NO governance re-check (mirroring the shipped
   * participant-dispute exemption: a dispute is a participant's
   * self-protection action over their own row; the student predicate is
   * the whole authorization surface). Inside ONE transaction the
   * classification probe read runs first — an unknown id and a caller who
   * is not the session's student are the SAME oracle-safe not-found
   * denial, and an owned row that is not dual-confirmed-and-consumed is
   * the lifecycle-state conflict — then the guarded write re-asserts the
   * full predicate atomically: a zero-row miss there is the double-submit
   * loser (or a row flipped between the probe and the write), never a
   * second dispute. The recorded reason, the dispute stamp, and the
   * escrow are otherwise untouched; zero audit rows are written. The
   * admin dispute-opened wave rides the SAME transaction — its receipts
   * share the dispute's fate, and the post-commit publish belongs to the
   * transaction owner (this flow itself, on the own-commit path).
   *
   * @param callerUserId  The acting student's id (context-resolved
   *     server-side by the caller; shared PK with the users table).
   * @param sessionId  The target session id.
   * @param reason  REQUIRED free-text reason — trimmed non-empty, ≤500
   *     chars, persisted into `dispute_reason`.
   * @param locale  Active request locale (for the localized error messages).
   * @param outerTx  Optional outer transaction. When provided (test path),
   *     the flow runs inside a SAVEPOINT on it; production callers omit it
   *     and the service opens its own transaction.
   * @returns The disputed session row.
   */
  /**
   * Pre-flight escrow-classification gate for the shared arbitration entry:
   * a resolution submitted for a CURRENTLY DISPUTED row must belong to the
   * row's own generation vocabulary (held rows answer only the held family,
   * consumed rows only the consumed family). A cross-family submission is
   * the localized classification-mismatch denial BEFORE any service runs —
   * zero writes, and neither generation's service ever applies the other
   * generation's semantics. Non-disputed (or unknown) rows pass through
   * untouched: their own service owns the state-conflict classification.
   *
   * Advisory by construction — the dispatched service re-classifies the
   * row inside its own transaction, so a row that flips between this read
   * and the write still cannot execute the wrong generation's effects.
   */
  export async function assertResolutionFamilyMatchesEscrow(
    sessionId: number,
    resolution: DisputeResolution,
    locale: string
  ): Promise<void> {
    const t = getServerTranslations(locale).errorsTranslations;
    assertPositiveSafeSessionId(sessionId, t);
    const probe = await SessionRepository.findArbitrationProbe(sessionId);
    if (probe?.status !== SESSION_DISPUTED_STATUS) {
      return;
    }
    const heldFamily = resolution === DisputeResolution.Cancel || resolution === DisputeResolution.Complete;
    const rowIsConsumed = probe.feeHeld === false;
    if (heldFamily === rowIsConsumed) {
      rejectResolutionFamilyMismatch(
        "Session arbitration denied: the submitted outcome does not apply to the row's escrow generation",
        sessionId,
        t
      );
    }
  }

  export async function openPostConfirmationDispute(
    callerUserId: number,
    sessionId: number,
    reason: string,
    locale: string,
    outerTx?: DBTransaction
  ): Promise<SessionReturnType> {
    const t = getServerTranslations(locale).errorsTranslations;

    // Pre-DB id-shape guard — the FIRST check of the flow, before the
    // reason guard: a malformed target id is the canonical VALIDATION
    // denial, never a SQL round-trip.
    assertPositiveSafeSessionId(sessionId, t);

    // The reason is REQUIRED: trimmed non-empty, ≤500 — validated pre-DB.
    const disputeReason = normalizeRequiredReasonText(reason, t);

    const committed = await withTransaction(outerTx, async tx => {
      // Classification read INSIDE the transaction: unknown id and a
      // non-student caller collapse to the same not-found denial; an owned
      // row in a non-disputable shape (not dual-confirmed `completed`, or
      // the fee still held) is the state conflict.
      const probe = await SessionRepository.findArbitrationProbe(sessionId, tx);
      if (probe === null) {
        rejectSessionNotFound("Post-confirmation dispute denied: session not found", sessionId, t);
      }
      classifyOpenDisputeProbe(probe, callerUserId, sessionId, t);

      // The guarded write re-asserts the whole predicate (row identity +
      // student caller + completed + student stamp + consumed escrow): a
      // zero-row miss is the double-submit loser — the state conflict.
      const disputed = await SessionRepository.openPostConfirmationDisputeOnce(
        sessionId,
        callerUserId,
        disputeReason,
        tx
      );
      if (disputed === null) {
        rejectStateConflict(
          "Post-confirmation dispute denied: session not disputable in its current state",
          sessionId,
          t
        );
      }

      // Dispute-wave seam: the admin `session_dispute_opened` wave rides
      // THIS transaction — the persisted receipts share the dispute's fate
      // (they survive the commit, vanish on any rollback); the publish
      // happens strictly after this transaction commits, below.
      const waveReceipts = await SessionDisputeNotificationService.notifyAdminsOfDisputeOpened(
        sessionId,
        callerUserId,
        locale,
        tx
      );
      return { session: disputed, waveReceipts };
    });

    // Publish-after-commit — the wave is pushed only once this flow's
    // transaction has committed, and only when THIS call owns the commit
    // (on the caller-transaction path the caller publishes). A publish
    // failure degrades at the engine boundary; it never fails the
    // committed dispute.
    if (outerTx === undefined) {
      await NotificationEngine.publishReceipts(committed.waveReceipts, locale);
    }
    return committed.session;
  }

  /**
   * Arbitrates a post-confirmation (consumed-escrow) disputed session into
   * exactly one terminal outcome, as an ADMIN — the binding decision.
   *
   * The target session id is guarded as a positive safe integer BEFORE any
   * database work; the resolution vocabulary is re-guarded at runtime (a
   * payload that skipped the boundary's enum parse fails closed pre-DB);
   * the held-family outcomes (`Cancel` | `Complete`) are rejected outright
   * — they resolve held-escrow disputes through the shipped service, never
   * here; and the optional note is trimmed, ≤500-checked, and persisted
   * (`resolution_note`; whitespace-only persists as NULL). The caller's
   * governance AND admin role are re-asserted from the user row — defense
   * in depth on top of the GraphQL scope gate.
   *
   * Inside ONE transaction (the fixed composition order in the module
   * docblock): the in-transaction classification probe denies an unknown
   * id (not-found), a non-disputed row (state conflict) and a HELD-family
   * row (classification mismatch) before any write; the amount policy
   * resolves the teacher-debit amount — the full refund debits the row's
   * own fee verbatim, the partial refund validates the supplied string
   * (strict decimal shape, strictly between zero and the fee, the exact
   * string carried into the ledger and the audit row) and any stray money
   * input on a non-partial outcome is rejected — BEFORE the first write;
   * the guarded completion leg fires first so a concurrent arbitration's
   * loser classifies as the state conflict with zero financial writes; the
   * compensating teacher reversal and the quantized student lane credit
   * compose on the same transaction for the refund outcomes (a wallet
   * shortfall is the typed insufficient-funds conflict that rolls the
   * whole arbitration back — zero financial writes survive); and exactly
   * ONE `Override` audit row is appended through the shared writer, its
   * `details` free of the note's content. The participants'
   * dispute-resolved wave rides the SAME transaction — its receipts share
   * the arbitration's fate, and the post-commit publish belongs to the
   * transaction owner (this flow itself, on the own-commit path).
   *
   * @param adminId  The acting admin's id (context-resolved server-side by
   *     the caller; shared PK with the users table).
   * @param sessionId  The target session id.
   * @param resolution  The arbitration outcome (Refund | PartialRefund |
   *     Uphold).
   * @param note  Optional free-text note — trimmed ≤500, persisted into
   *     `resolution_note`; its CONTENT never enters the audit trail.
   * @param partialAmount  The partial refund amount as a decimal string —
   *     required iff `resolution = PartialRefund`, rejected as stray money
   *     input alongside any other outcome.
   * @param locale  Active request locale (for the localized error messages).
   * @param outerTx  Optional outer transaction. When provided (test path),
   *     the flow runs inside a SAVEPOINT on it; production callers omit it
   *     and the service opens its own transaction.
   * @returns The resolved session row.
   */
  export async function arbitrateDispute(
    adminId: number,
    sessionId: number,
    resolution: DisputeResolution,
    note: string | null,
    partialAmount: string | null,
    locale: string,
    outerTx?: DBTransaction
  ): Promise<SessionReturnType> {
    const t = getServerTranslations(locale).errorsTranslations;

    // Pre-DB id-shape guard — the FIRST check of the flow.
    assertPositiveSafeSessionId(sessionId, t);

    // The resolution vocabulary is a closed runtime guard (BOPLA — a
    // payload that skipped the boundary's enum parse fails closed here,
    // pre-DB), and the held-family outcomes are denied outright: they
    // belong to the shipped held-escrow resolution service.
    assertArbitrationResolution(resolution, sessionId, t);

    // The optional note: trimmed, ≤500 — validated pre-DB; whitespace-only
    // persists as NULL.
    const resolutionNote = normalizeOptionalReasonText(note, t);

    // Governance + role re-check — the acting caller must be a
    // governance-clean ADMIN (defense in depth over the scope gate).
    await assertAdminGovernanceClean(adminId, t, outerTx);

    const committed = await withTransaction(outerTx, async tx => {
      // Classification read INSIDE the transaction (no TOCTOU — the
      // guarded write below re-asserts the same classification).
      const probe = await SessionRepository.findArbitrationProbe(sessionId, tx);
      if (probe === null) {
        rejectSessionNotFound("Session arbitration denied: session not found", sessionId, t);
      }
      classifyArbitrationProbe(probe, sessionId, t);

      // The amount policy resolves the teacher-debit amount BEFORE any
      // write: the full refund's fee (verbatim), the validated partial
      // amount string, or null for the zero-financial-write outcome.
      const debitAmount = resolveArbitrationDebitAmount(resolution, partialAmount, probe.fee, sessionId, t);

      // The guarded completion leg fires FIRST: the loser of a concurrent
      // arbitration matches zero rows here and classifies as the state
      // conflict before any money moves.
      const resolved = await SessionRepository.resolveConsumedDisputeOnce(sessionId, resolutionNote, resolution, tx);
      if (resolved === null) {
        rejectStateConflict("Session arbitration denied: session not resolvable in its current state", sessionId, t);
      }

      // Financial legs — the refund outcomes reverse the teacher's earning
      // through the compensating ledger row + guarded debit, and restore
      // ONE session credit to the recorded provenance lane (a row with no
      // recorded lane skips the credit as a no-op; the teacher debit still
      // applies). The uphold outcome performs zero financial writes.
      if (debitAmount !== null) {
        await debitTeacherWalletForArbitration(resolved.teacherId, sessionId, debitAmount, t, tx);
      }
      if (resolution !== DisputeResolution.Uphold) {
        await creditLaneForArbitration(resolved.studentId, resolved.heldBalanceLane, sessionId, tx);
      }

      // The arbitration's audit trail row rides the SAME transaction: one
      // Override row for the session entity, appended only after the
      // guarded update and the financial legs succeeded — an audit failure
      // throws, so a partially-applied arbitration can never commit. The
      // note's content stays out of the trail; only its presence is
      // recorded.
      await AuditService.createAuditLog(
        buildArbitrationAuditContract(adminId, sessionId, resolution, debitAmount, resolutionNote !== null),
        tx
      );

      // The guarded write's own probe carries the classification columns;
      // the canonical row shape for the response is re-read on the SAME
      // transaction (response payload only — never a gating read).
      const current = await SessionRepository.findById(sessionId, tx);
      if (current === null) {
        throw new Error(
          "SessionArbitrationService.arbitrateDispute: resolved session row vanished inside the transaction"
        );
      }

      // Dispute-wave seam: the participants' `session_dispute_resolved`
      // wave rides THIS transaction — the persisted receipts share the
      // arbitration's fate (they survive the commit, vanish on any
      // rollback, including the insufficient-funds one); the publish
      // happens strictly after this transaction commits, below.
      const waveReceipts = await SessionDisputeNotificationService.notifyParticipantsOfDisputeResolved(
        sessionId,
        resolved.studentId,
        resolved.teacherId,
        resolution,
        locale,
        tx
      );
      return { session: current, waveReceipts };
    });

    // Publish-after-commit — the wave is pushed only once this flow's
    // transaction has committed, and only when THIS call owns the commit
    // (on the caller-transaction path the caller publishes). A publish
    // failure degrades at the engine boundary; it never fails the
    // committed arbitration.
    if (outerTx === undefined) {
      await NotificationEngine.publishReceipts(committed.waveReceipts, locale);
    }
    return committed.session;
  }

  /**
   * Reads the full dispute case for one session, as an ADMIN — the
   * evidence bundle behind the arbitration decision. One-to-one
   * delegation to the case-read helper (the max-lines split; see
   * `session-arbitration.case-reads.helpers.ts`).
   */
  export async function getAdminDisputeCase(
    adminId: number,
    sessionId: number,
    locale: string,
    tx?: DBTransaction
  ): Promise<AdminDisputeCaseReturnType> {
    return caseReads.getAdminDisputeCase(adminId, sessionId, locale, tx);
  }

  /**
   * Reads the dispute case for one session, as the session's OWN TEACHER —
   * the teacher-side transparency bundle. One-to-one delegation to the
   * case-read helper.
   */
  export async function getTeacherDisputeCase(
    teacherId: number,
    sessionId: number,
    locale: string,
    tx?: DBTransaction
  ): Promise<TeacherDisputeCaseReturnType> {
    return caseReads.getTeacherDisputeCase(teacherId, sessionId, locale, tx);
  }

  /**
   * Reads the dispute case for one session, as the session's OWN STUDENT —
   * the filing participant's mirror. One-to-one delegation to the
   * case-read helper.
   */
  export async function getStudentDisputeCase(
    studentId: number,
    sessionId: number,
    locale: string,
    tx?: DBTransaction
  ): Promise<StudentDisputeCaseReturnType> {
    return caseReads.getStudentDisputeCase(studentId, sessionId, locale, tx);
  }

  /**
   * The admin arbitration queue: one page of the pinned `disputed` scope
   * with the participant display names resolved in a single batched read
   * over the page's ids — the queue renders identities without per-row
   * user probes. The pagination tail echoes the wrapped query's own
   * values; the read is strictly side-effect free. When a caller
   * transaction is supplied, every read rides it.
   */
  export async function listDisputedSessionRows(
    filter: SessionListFilterInput,
    limit: number,
    offset: number,
    tx?: DBTransaction
  ): Promise<AdminDisputedSessionPageReturnType> {
    const page = await SessionLifecycleQueries.listAdminDisputedSessions(filter, limit, offset, tx);
    const participantIds = [...new Set(page.items.flatMap(row => [row.studentId, row.teacherId]))];
    const names = await UserRepository.findNamesByIds(participantIds, tx);
    return {
      items: page.items.map(session => ({
        session,
        studentName: names.get(session.studentId) ?? null,
        teacherName: names.get(session.teacherId) ?? null,
      })),
      totalCount: page.totalCount,
      page: page.page,
      pageSize: page.pageSize,
    };
  }

  /**
   * The admin dispute-analytics snapshot: the aggregate dispute counts
   * (open, resolved, and the per-outcome breakdown) read in ONE table
   * pass over the `session` entity. The admin gate is re-asserted first
   * (defense in depth over the scope gate), then the read runs — strictly
   * side-effect free, honest zeros on an empty table, no fabricated
   * placeholders. The snapshot is deliberately UNFILTERED (all time, both
   * escrow generations): the queue's own count already answers "what is
   * open right now", this read adds the trend vocabulary around it.
   *
   * @param adminId  The acting admin's id (never client input).
   * @param locale  Active request locale (for the localized error messages).
   * @param tx  Optional transaction — propagated to the read so a
   *     caller-owned atomic flow stays atomic.
   * @returns The analytics snapshot (see `AdminDisputeAnalyticsReturnType`).
   */
  export async function getDisputeAnalytics(
    adminId: number,
    locale: string,
    tx?: DBTransaction
  ): Promise<AdminDisputeAnalyticsReturnType> {
    const t = getServerTranslations(locale).errorsTranslations;

    // The service-side governance-clean admin gate — the FIRST statement.
    await assertAdminGovernanceClean(adminId, t, tx);

    return SessionRepository.getDisputeAnalyticsCounts(tx);
  }
}
