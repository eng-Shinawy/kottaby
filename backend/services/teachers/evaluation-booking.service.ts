/**
 * EvaluationBookingService — the applicant-facing surfaces of the
 * five-session evaluation loop: the booking write (`bookEvaluation`) and
 * its three reads (the current-cycle status blob, the evaluator picker,
 * the caller's evaluation-session list).
 *
 * The booking write serializes on the applicant's own row: ONE
 * transaction takes the `FOR UPDATE` applicant lock, re-reads the status
 * gate, resolves the CURRENT verification cycle, and counts the cycle's
 * bookings under that lock — a rival booking by the same applicant is
 * always observed before the capacity or distinctness decision. The
 * idempotency claim is savepoint-bracketed; a duplicate key replays by
 * THROWING (never by returning a row), and a key spent by a different
 * caller is denied with the oracle-safe session-not-found error. Every
 * stored session column is server-owned; the teacher notification emits
 * on the booking's own savepoint (a dispatch failure is logged, never
 * rethrown — the booking stays durable) and its receipt publishes via
 * the engine's public post-commit seam strictly after the commit.
 *
 * The reads are oracle-conservative: the loop status returns a fixed
 * zero-shape for callers with no applicant row or no active cycle (no
 * read leaks whether an account is an applicant at all), the session
 * list is caller-keyed (empty for non-participants by construction),
 * and the picker — a booking surface — denies oracle-safely without an
 * active cycle (no evaluator identities are revealed).
 *
 * All user-facing messages resolve through `getServerTranslations(locale)`;
 * every denial logs exactly ONE bounded `logger.logDomainError` entry;
 * happy paths log nothing. No module-level mutable state; every repository
 * call inside the write flow receives the SAME transaction. The
 * transactional write pipeline lives in the sibling
 * `evaluation-booking.helpers.ts` module (not part of the public API).
 */

import { ApplicantRepository, SessionRepository, TeacherRepository } from "@/backend/db/repo";
import type { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import { withTransaction } from "@/backend/lib/db/with-transaction";
import { ConflictError, ValidationError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import { isCarryableIdempotencyKey } from "@/backend/services/billing/purchase-guards.helpers";
import { assertActorGovernanceClean } from "@/backend/services/classes/session-lifecycle.governance";
import { isPositiveSafeInteger, normalizePageBounds } from "@/backend/services/classes/session-lifecycle.guards";
import { SessionRequestNotificationService } from "@/backend/services/classes/session-request-notification.service";
import { NotificationEngine } from "@/backend/services/notifications/notification-engine.service";
import { bookEvaluationInTx } from "@/backend/services/teachers/evaluation-booking.helpers";
import type {
  BookEvaluationSessionInput,
  DBTransaction,
  EvaluationEvaluatorOptionPageReturnType,
  EvaluationEvaluatorOptionType,
  EvaluationLoopStatusReturnType,
  NotificationDeliveryReceipt,
  SessionPageReturnType,
  SessionReturnType,
} from "@/backend/types";
import { VERIFICATION_PLAN_SESSION_COUNT } from "@/shared/constants/verification-plan.constants";
import { getServerTranslations } from "@/shared/locale/server-graphql";

/** Picker page-size fallback. */
const PICKER_DEFAULT_PAGE_SIZE = 25;

/** Upper bound of the picker page size. */
const PICKER_MAX_PAGE_SIZE = 100;

/**
 * The ONE bounded denial-log entry a rejection emits: code, entity, entity
 * id. The `entityId` is the DENIED entity's id — for the evaluator gate
 * denials (`EVALUATOR_ALREADY_USED`, `TEACHER_NOT_FOUND`,
 * `TEACHER_NOT_CERTIFIED`) that is the client-submitted evaluator id (the
 * only value the denial has); idempotency-key denials log the actor's
 * applicant id. Never the submitted payload, never a counterparty value.
 */
function logDenial(message: string, code: string, entity: string, entityId: number): void {
  logger.logDomainError(message, { code, entity, entityId });
}

export namespace EvaluationBookingService {
  /**
   * Books one evaluation session for the acting applicant against a
   * certified evaluator, consuming one of the current cycle's credits.
   * Pre-DB shape guards and the governance re-check fail before any
   * database work; inside ONE transaction the applicant lock, the status
   * gate, the cycle probe, the capacity + distinctness gates, the
   * evaluator certification + governance lock, the idempotency claim,
   * the session insert, and the claim backfill run in a fixed order (the
   * sibling helpers module). A duplicate claim key replays by throwing
   * the typed duplicate conflict — never by returning a row. After the
   * commit the teacher notification dispatches outside the transaction; a
   * dispatch failure is logged and never rethrown (the booking is already
   * durable).
   *
   * @param applicantUserId  The acting applicant's users id.
   * @param input  The client-controlled booking input (the evaluator id
   *     is the ONLY client-owned value).
   * @param idempotencyKey  The opaque request key, carried verbatim.
   * @param locale  Active request locale (for the localized error messages).
   * @param outerTx  Optional outer transaction — the flow runs inside a
   *     SAVEPOINT on it; production callers omit it. On a caller-owned
   *     transaction the booking's notification receipt is intentionally
   *     NOT published by this method (the caller owns the commit
   *     boundary).
   * @returns The created session row in its full, type-stable shape.
   */
  export async function bookEvaluation(
    applicantUserId: number,
    input: BookEvaluationSessionInput,
    idempotencyKey: string,
    locale: string,
    outerTx?: DBTransaction
  ): Promise<SessionReturnType> {
    const t = getServerTranslations(locale).errorsTranslations;
    if (!isPositiveSafeInteger(applicantUserId) || !isPositiveSafeInteger(input.evaluatorId)) {
      logDenial("Evaluation booking denied: malformed ids", "VALIDATION", "applicants", applicantUserId);
      throw new ValidationError(t.validation);
    }
    if (!isCarryableIdempotencyKey(idempotencyKey)) {
      logDenial("Evaluation booking denied: idempotency key required", "VALIDATION", "applicants", applicantUserId);
      throw new ValidationError(t.idempotencyKeyRequired);
    }
    await assertActorGovernanceClean(applicantUserId, t, outerTx);
    const now = new Date();
    const { session: createdSession, receipt } = await withTransaction(outerTx, async tx => {
      const created = await bookEvaluationInTx(applicantUserId, input.evaluatorId, idempotencyKey, now, tx, t);
      // The teacher wave rides the booking's own nested SAVEPOINT: a
      // dispatch failure rolls only that savepoint back — it is logged,
      // never rethrown, and the booking stays durable.
      let waveReceipt: NotificationDeliveryReceipt | undefined;
      try {
        waveReceipt = await withTransaction(tx, txArg =>
          SessionRequestNotificationService.notifyTeacherOfSessionRequest(created.id, locale, txArg)
        );
      } catch (error) {
        logger.error("Evaluation booking notification dispatch failed", { sessionId: created.id, error });
      }
      return { session: created, receipt: waveReceipt };
    });
    // Publish strictly AFTER the commit — a denied or rolled-back booking
    // never pushes its receipt. On a caller-owned transaction this method
    // intentionally does NOT publish the receipt (the caller owns the
    // commit boundary, so it cannot know the receipt survived it);
    // production callers pass no outerTx and take the resolver-driven
    // post-commit publish path above.
    if (outerTx === undefined && receipt !== undefined) {
      await NotificationEngine.publishReceipts([receipt], locale);
    }
    return createdSession;
  }

  /**
   * Reads the caller's CURRENT evaluation-loop status. Oracle-conservative:
   * a caller with no applicant row or no active cycle gets the fixed
   * zero-shape (never an error) — no read leaks whether an account is an
   * applicant at all. No lock is taken (a status read mutates nothing).
   *
   * @param callerUserId  The calling user's id.
   * @param locale  Active request locale (for the localized error messages).
   * @param outerTx  Optional outer transaction for the read.
   * @returns The current-cycle status blob; the zero-shape when the loop
   *     is closed for this caller.
   */
  export async function myEvaluationLoopStatus(
    callerUserId: number,
    locale: string,
    outerTx?: DBTransaction
  ): Promise<EvaluationLoopStatusReturnType> {
    const t = getServerTranslations(locale).errorsTranslations;
    if (!isPositiveSafeInteger(callerUserId)) {
      logDenial("Evaluation loop status denied: malformed caller id", "VALIDATION", "applicants", callerUserId);
      throw new ValidationError(t.validation);
    }
    return withTransaction(outerTx, async tx => {
      const applicant = await ApplicantRepository.findByUserId(callerUserId, tx);
      if (applicant === null) {
        return { bookedCount: 0, completedCount: 0, remainingCredits: 0, cycleStartDate: null };
      }
      const cycle = await SessionRepository.resolveCurrentEvaluationCycle(callerUserId, tx);
      if (cycle.cycleStart === null) {
        return { bookedCount: 0, completedCount: 0, remainingCredits: 0, cycleStartDate: null };
      }
      const { booked, completed } = await SessionRepository.countEvaluationBookingsInCycle(
        callerUserId,
        cycle.cycleStart,
        tx
      );
      return {
        bookedCount: booked,
        completedCount: completed,
        remainingCredits: VERIFICATION_PLAN_SESSION_COUNT - booked,
        cycleStartDate: cycle.cycleStart,
      };
    });
  }

  /**
   * Lists the certified evaluators the caller may still book in the
   * CURRENT cycle — a booking surface, so the gate mirrors the write
   * path's precondition: a caller without an applicant row or without an
   * active cycle gets the SAME verification-not-active conflict
   * (oracle-safe — no evaluator identities are revealed). The returned
   * options are PII-free and exclude every evaluator already used in the
   * cycle; the total subtracts the used evaluators that still match the
   * certified + evaluator predicate.
   *
   * @param callerUserId  The calling user's id.
   * @param page  Requested page (≥ 1; invalid values normalize to 1).
   * @param pageSize  Requested page size (1..100; invalid values
   *     normalize to 25).
   * @param locale  Active request locale (for the localized error messages).
   * @param outerTx  Optional outer transaction for the read.
   * @returns The paged, PII-free evaluator options with an honest total.
   */
  export async function availableEvaluators(
    callerUserId: number,
    page: number,
    pageSize: number,
    locale: string,
    outerTx?: DBTransaction
  ): Promise<EvaluationEvaluatorOptionPageReturnType> {
    const t = getServerTranslations(locale).errorsTranslations;
    if (!isPositiveSafeInteger(callerUserId)) {
      logDenial("Available evaluators denied: malformed caller id", "VALIDATION", "applicants", callerUserId);
      throw new ValidationError(t.validation);
    }
    const safePage = Number.isSafeInteger(page) && page >= 1 ? page : 1;
    const safePageSize =
      Number.isSafeInteger(pageSize) && pageSize >= 1 && pageSize <= PICKER_MAX_PAGE_SIZE
        ? pageSize
        : PICKER_DEFAULT_PAGE_SIZE;
    return withTransaction(outerTx, async tx => {
      const applicant = await ApplicantRepository.findByUserId(callerUserId, tx);
      if (applicant === null) {
        logDenial(
          "Available evaluators denied: no active evaluation cycle",
          "VERIFICATION_NOT_ACTIVE",
          "applicants",
          callerUserId
        );
        throw new ConflictError("VERIFICATION_NOT_ACTIVE", t.verificationSubscriptionNotActive);
      }
      const cycle = await SessionRepository.resolveCurrentEvaluationCycle(callerUserId, tx);
      if (cycle.cycleStart === null) {
        logDenial(
          "Available evaluators denied: no active evaluation cycle",
          "VERIFICATION_NOT_ACTIVE",
          "applicants",
          callerUserId
        );
        throw new ConflictError("VERIFICATION_NOT_ACTIVE", t.verificationSubscriptionNotActive);
      }
      const { evaluators } = await SessionRepository.countEvaluationBookingsInCycle(callerUserId, cycle.cycleStart, tx);
      const probe = await TeacherRepository.listDirectory(
        { isApproved: true, isEvaluator: true },
        safePageSize,
        (safePage - 1) * safePageSize,
        tx
      );
      const items = probe.rows
        .filter(
          row =>
            row.isDeleted !== true && row.isBlocked !== true && row.suspended !== true && !evaluators.includes(row.id)
        )
        .map(
          (row): EvaluationEvaluatorOptionType => ({
            id: row.id,
            fullName: row.name,
            isOnline: row.isOnline === true,
            averageRating: row.averageRating,
            subjects: row.subjects,
          })
        );
      const stillCertifiedFlags = await Promise.all(
        evaluators.map(async usedEvaluatorId => {
          const usedTeacher = await TeacherRepository.findById(usedEvaluatorId, tx);
          return usedTeacher !== null && usedTeacher.isApproved === true && usedTeacher.isEvaluator === true;
        })
      );
      const excludedFromTotal = stillCertifiedFlags.filter(stillCertified => stillCertified).length;
      return {
        items,
        totalCount: probe.total - excludedFromTotal,
        page: safePage,
        pageSize: safePageSize,
      };
    });
  }

  /**
   * Lists the caller's own evaluation sessions, newest first, paged.
   * Caller-keyed by construction: the owner equality on the session's
   * student leg plus the session type pinned to the teacher-evaluation
   * member are the read's only scope, so a non-applicant's predicate
   * never matches (an empty page, never an error). Page bounds normalize
   * like the participant list helpers (a page below 1 falls back to the
   * first page, a page size outside 1..50 falls back to the default) and
   * the effective values echo honestly.
   *
   * @param callerUserId  The calling user's id.
   * @param filter  Optional lifecycle-state filter (null = no constraint).
   * @param page  Requested page (≥ 1; invalid values normalize to 1).
   * @param pageSize  Requested page size (1..50; invalid values
   *     normalize to 25).
   * @param locale  Active request locale (for the localized error messages).
   * @param outerTx  Optional read executor — propagated so a caller-owned
   *     atomic flow stays atomic (standalone callers resolve through the
   *     repository's parameterized cold read).
   * @returns The caller's evaluation-session page.
   */
  export async function myEvaluationSessions(
    callerUserId: number,
    filter: { status?: SessionStatus | null },
    page: number,
    pageSize: number,
    locale: string,
    outerTx?: DBTransaction
  ): Promise<SessionPageReturnType> {
    const t = getServerTranslations(locale).errorsTranslations;
    if (!isPositiveSafeInteger(callerUserId)) {
      logDenial("My evaluation sessions denied: malformed caller id", "VALIDATION", "applicants", callerUserId);
      throw new ValidationError(t.validation);
    }
    const bounds = normalizePageBounds(page, pageSize);
    const result = await SessionRepository.listEvaluationSessionsForApplicant(
      callerUserId,
      { status: filter.status ?? null, page: bounds.page, pageSize: bounds.pageSize },
      outerTx
    );
    return { items: result.items, totalCount: result.total, page: bounds.page, pageSize: bounds.pageSize };
  }
}
