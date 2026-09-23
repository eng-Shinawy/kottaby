/**
 * SessionAdminGovernanceService — the admin-only governance surface over
 * the `session` entity: the directory read pair (filterable list with the
 * derived attention badge, plus the any-state browse detail) and the four
 * operator mutations (reschedule the timing pair, cancel with the
 * same-lane hold release, reassign the teacher, and join a live session as
 * a read-only observer).
 *
 * Every method opens with the defense-in-depth admin gate
 * (`assertAdminGovernanceClean` — the SAME gate the declared
 * byte-identical reference operation `resolveSessionDispute` enforces):
 * the GraphQL scope gate is the first wall, this service-side
 * re-assertion is the second, and it verifies the governance-clean ADMIN
 * role from the user row — the DB row is the authority, never a
 * still-valid token, so an account deleted/blocked/suspended after login
 * (or an unresolvable actor id) fails closed `FORBIDDEN` before any read
 * or write. The gate itself performs ZERO reads past it and ZERO writes.
 * Every user-facing message resolves
 * through `getServerTranslations(locale)`; rejections log via
 * `logger.logDomainError` with `{code, entity, entityId}` only.
 *
 * Mutation discipline (mirrors the session lifecycle's own flows):
 *  - each mutation wraps its writes in ONE `withTransaction(outerTx, …)`
 *    and hands that SAME `tx` to every repository, audit, refund, and
 *    notification call — partial application is impossible;
 *  - state eligibility is enforced by the guarded single-statement
 *    UPDATEs (the eligibility clause IS the atomic gate); a zero-row miss
 *    is classified by ONE cold probe read that never feeds a write
 *    (unknown id → localized not-found; anything else → the localized
 *    state conflict);
 *  - each committed mutation appends exactly one audit row (the join via
 *    its atomic eligibility-fold INSERT; the rest via the composition-only
 *    audit writer), inside the same transaction; denial paths append ZERO
 *    audit rows;
 *  - the cancel's hold release composes the ONE shared same-lane refund
 *    primitive verbatim (a row with no recorded lane refunds nothing;
 *    an unreadable lane fails closed and rolls the mutation back);
 *  - the cancel is idempotent through the same claim-table mechanism the
 *    booking flow uses: the claim is inserted savepoint-bracketed inside
 *    the mutation transaction, a duplicate key (PG 23505) resolves the
 *    replay, and a replayed cancel returns the already-cancelled row with
 *    no duplicate audit row, no second refund, and no wave — the claim's
 *    session pointer backfills on the replay arm too, so a committed claim
 *    always names the session it resolved against;
 *  - notification waves persist inside the mutation transaction as
 *    unpublished delivery receipts and are published strictly AFTER the
 *    caller's own commit (publish-after-commit — nothing is ever pushed
 *    for a rolled-back emit; on the caller-transaction test path the
 *    publish step is skipped because the caller owns the commit).
 *
 * File layout: the flow internals live in a sibling module extracted
 * verbatim (behavior-identical max-lines refactor) —
 * `session-admin-governance.helpers.ts` holds the shared denial
 * classifiers, the audit contract composer, the cancel-reason normalizer,
 * the idempotent-cancel replay machinery, and the three mutation
 * transaction bodies. Every public method below is the same flow in the
 * same order — each owns its boundary validation ordering, the admin gate,
 * and the `withTransaction` composition, delegating only the transaction
 * bodies and shared pre-DB checks to the sibling. The public API (names,
 * signatures, behavior) is unchanged.
 *
 * No module-level mutable state; no swallowed catches; no hardcoded
 * strings.
 */

import { SessionRepository } from "@/backend/db/repo";
import { withTransaction } from "@/backend/lib/db/with-transaction";
import { ValidationError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import {
  cancelSessionInTx,
  joinObservationInTx,
  normalizeAdminCancelReason,
  RESCHEDULE_START_PAST_GRACE_MS,
  reassignTeacherInTx,
  rejectSessionNotFound,
  rejectStateConflict,
  rescheduleSessionInTx,
} from "@/backend/services/classes/session-admin-governance.helpers";
import { assertAdminGovernanceClean } from "@/backend/services/classes/session-lifecycle.governance";
import {
  MAX_IDEMPOTENCY_KEY_LENGTH,
  normalizePageBounds,
  SESSION_STARTED_STATUS,
} from "@/backend/services/classes/session-lifecycle.guards";
import { NotificationEngine, type NotificationEngineCallOptions } from "@/backend/services/notifications";
import {
  type AdminSessionCancelInput,
  AdminSessionCancelInputSchema,
  type AdminSessionDetail,
  type AdminSessionJoinInput,
  AdminSessionJoinInputSchema,
  type AdminSessionListFilterInput,
  AdminSessionListFilterInputSchema,
  type AdminSessionReassignInput,
  AdminSessionReassignInputSchema,
  type AdminSessionRescheduleInput,
  AdminSessionRescheduleInputSchema,
  type AdminSessionRowReturnType,
  type DBTransaction,
  type SessionReturnType,
} from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";

export namespace SessionAdminGovernanceService {
  /**
   * Lists every session for the admin governance directory: ALL rows
   * regardless of state or ownership, newest first, paged, under the
   * caller's optional filter set. The filter is shape-validated against
   * its boundary schema BEFORE any read (a violation is the localized
   * validation denial, never a database round-trip); the page window
   * normalizes before any database work exactly like the participant
   * lists (a page below 1 falls back to the first page, a page size
   * outside 1..50 falls back to the default) and the effective values are
   * what the result echoes. The total is computed by the SAME filtered
   * predicate as the rows, so it can never diverge from the items. The
   * read is strictly side-effect free: no session, audit, or notification
   * write exists on this path.
   *
   * @param actorId  The acting admin's id (context-resolved server-side
   *     by the caller; shared PK with the users table).
   * @param filter  The optional directory filter (absent members drop
   *     out; the creation window is half-open over `createdAt`).
   * @param page  Requested page (≥ 1; invalid values normalize to 1).
   * @param pageSize  Requested page size (1..50; invalid values normalize
   *     to the default).
   * @param locale  Active request locale (for the localized error
   *     messages).
   * @param tx  Optional transaction — propagated to the admin gate and
   *     both reads so a caller-owned atomic flow stays atomic.
   */
  export async function listAll(
    actorId: number,
    filter: AdminSessionListFilterInput,
    page: number,
    pageSize: number,
    locale: string,
    tx?: DBTransaction
  ): Promise<{
    readonly items: readonly AdminSessionRowReturnType[];
    readonly totalCount: number;
    readonly page: number;
    readonly pageSize: number;
  }> {
    const t = getServerTranslations(locale).errorsTranslations;

    // The service-side governance-clean admin gate — the FIRST statement
    // of every method (the same gate the reference arbitration op enforces).
    await assertAdminGovernanceClean(actorId, t, tx);

    // Shape-validate the filter BEFORE any read; a violation (including an
    // inverted creation window) is the localized validation denial.
    const parsedFilter = AdminSessionListFilterInputSchema.safeParse(filter);
    if (!parsedFilter.success) {
      throw new ValidationError(t.validation);
    }

    const bounds = normalizePageBounds(page, pageSize);
    const directoryPage = await SessionRepository.listForAdmin(parsedFilter.data, bounds.page, bounds.pageSize, tx);
    return { items: directoryPage.rows, totalCount: directoryPage.total, page: bounds.page, pageSize: bounds.pageSize };
  }

  /**
   * Reads one session for the admin browse/detail view: the row for ANY id
   * regardless of lifecycle state (the view is read-only and role-gated
   * upstream). A nonexistent id — and equally a malformed one, which is
   * caught by the pre-read shape guard — resolves to `null`, never to a
   * thrown not-found error: the browse plane answers "no such row" with
   * data. The read is strictly side-effect free.
   *
   * @param actorId  The acting admin's id.
   * @param sessionId  The target session id.
   * @param locale  Active request locale (for the localized error
   *     messages).
   * @param tx  Optional transaction — propagated to the admin gate and
   *     the read.
   */
  export async function getDetail(
    actorId: number,
    sessionId: number,
    locale: string,
    tx?: DBTransaction
  ): Promise<AdminSessionDetail> {
    const t = getServerTranslations(locale).errorsTranslations;

    // The service-side governance-clean admin gate — the FIRST statement
    // of every method (the same gate the reference arbitration op enforces).
    await assertAdminGovernanceClean(actorId, t, tx);

    // Oracle-safe malformed-id channel: anything that is not a positive
    // safe integer resolves to the SAME `null` as a nonexistent id, before
    // any database read (this browse surface never throws for shape).
    if (!(Number.isSafeInteger(sessionId) && sessionId > 0)) {
      return null;
    }
    return SessionRepository.getAnyByIdForAdmin(sessionId, tx);
  }

  /**
   * Reschedules a session's timing pair (the two states with mutable
   * timing are the pre-start and in-progress ones) as an ADMIN.
   *
   * Validation runs BEFORE any read: the boundary schema shape-guards the
   * payload (an inverted or zero-width timing pair is the localized
   * window-invalid denial — the schema's only refinement is exactly that
   * rule — while every other shape violation is the generic validation
   * denial), and the replacement start may not sit further than one grace
   * window into the past relative to the captured instant.
   *
   * Inside ONE transaction (the extracted `rescheduleSessionInTx` body):
   * the pre-write row read captures the timing the audit metadata reports
   * as the "from" values (and classifies an unknown id), the guarded
   * UPDATE re-asserts the state eligibility atomically (a zero-row miss is
   * classified by the cold probe), the single audit row is appended on the
   * same transaction, and the reschedule wave persists as unpublished
   * delivery receipts for both participants — published strictly after
   * this call's own commit.
   *
   * @param actorId  The acting admin's id.
   * @param input  The target session id and the replacement timing pair.
   * @param locale  Active request locale.
   * @param outerTx  Optional outer transaction. When provided (test
   *     path), the flow runs inside a SAVEPOINT on it; production callers
   *     omit it and the service opens its own transaction.
   * @param options  Optional notification-engine call options (the
   *     transport/claim-cache injection seam).
   */
  export async function reschedule(
    actorId: number,
    input: AdminSessionRescheduleInput,
    locale: string,
    outerTx?: DBTransaction,
    options?: NotificationEngineCallOptions
  ): Promise<SessionReturnType> {
    const t = getServerTranslations(locale).errorsTranslations;

    // The service-side governance-clean admin gate — the FIRST statement
    // of every method (the same gate the reference arbitration op enforces).
    await assertAdminGovernanceClean(actorId, t, outerTx);

    // Boundary validation BEFORE any read. The schema's only ROOT-pathed
    // refinement is the ordered timing pair — the object-level `.refine`
    // reports code "custom" at path [] (zod issue shape verified at
    // runtime), so a root-pathed custom issue is exactly the window-invalid
    // denial; every other issue — including the id refine's own "custom"
    // issue at path ["sessionId"] — is a generic shape issue.
    const parsed = AdminSessionRescheduleInputSchema.safeParse(input);
    if (!parsed.success) {
      const orderingViolated = parsed.error.issues.some(issue => issue.path.length === 0 && issue.code === "custom");
      if (orderingViolated) {
        logger.logDomainError("Admin reschedule denied: replacement timing pair is not ordered", {
          code: "SESSION_RESCHEDULE_WINDOW_INVALID",
          entity: "session",
          entityId: input.sessionId,
        });
        throw new ValidationError("SESSION_RESCHEDULE_WINDOW_INVALID", t.sessionRescheduleWindowInvalid);
      }
      throw new ValidationError(t.validation);
    }

    // One captured instant governs the grace comparison.
    const now = new Date();
    if (parsed.data.startedAt.getTime() < now.getTime() - RESCHEDULE_START_PAST_GRACE_MS) {
      logger.logDomainError("Admin reschedule denied: replacement start is further than the grace window in the past", {
        code: "SESSION_RESCHEDULE_START_IN_PAST",
        entity: "session",
        entityId: parsed.data.sessionId,
      });
      throw new ValidationError("SESSION_RESCHEDULE_START_IN_PAST", t.sessionRescheduleStartInPast);
    }

    const outcome = await withTransaction(outerTx, tx =>
      rescheduleSessionInTx(actorId, parsed.data, locale, tx, t, options)
    );

    // Publish AFTER commit — and only when THIS call owns the commit (on
    // the caller-transaction path the caller publishes).
    if (outerTx === undefined) {
      await NotificationEngine.publishReceipts(outcome.receipts, locale, options);
    }
    return outcome.session;
  }

  /**
   * Cancels a pre-terminal session as an ADMIN, releasing the held fee
   * back to the lane that funded it.
   *
   * The optional idempotency key reuses the booking flow's claim-table
   * mechanism verbatim: when present, the claim is inserted
   * savepoint-bracketed inside the mutation transaction (a duplicate key
   * resolves the replay branch; any other error surfaces untouched and
   * rolls the whole mutation back, so a failed cancel never burns its
   * key). The replayed cancel returns the already-cancelled row untouched
   * — no duplicate audit row, no second refund, no notification wave; the
   * claim's session pointer backfills in the same transaction (a committed
   * claim always names the session it replayed against, which is what
   * keeps a later different-session retry on the mis-point classification).
   * A key spent by a DIFFERENT caller is denied with the oracle-safe
   * session-not-found error; a key spent on a DIFFERENT session is the
   * state conflict.
   *
   * Inside ONE transaction (the extracted `cancelSessionInTx` body): the
   * guarded cancel UPDATE re-asserts the eligibility atomically (a row
   * taken out of the eligible set — including a disputed row, which
   * belongs to the arbitration surface — yields the zero-row miss whose
   * classification may resolve the idempotent replay when the row is
   * already cancelled and the caller's claim exists), the released hold is
   * refunded through the ONE shared same-lane primitive on the returned
   * row (a row with no recorded lane refunds nothing), exactly ONE audit
   * row is appended (the admin reason trimmed inside its metadata), the
   * claim's session pointer is backfilled, and the cancellation wave
   * persists as unpublished delivery receipts for both participants —
   * published strictly after this call's own commit.
   *
   * @param actorId  The acting admin's id.
   * @param input  The target session id plus the optional free-text
   *     reason (length-capped at the boundary; trimmed here).
   * @param locale  Active request locale.
   * @param idempotencyKey  Optional idempotency key — carried verbatim
   *     (never trimmed, never coerced, never logged); absent disables the
   *     claim mechanism for this call.
   * @param outerTx  Optional outer transaction (test path — SAVEPOINT).
   * @param options  Optional notification-engine call options.
   */
  export async function cancel(
    actorId: number,
    input: AdminSessionCancelInput,
    locale: string,
    idempotencyKey?: string | null,
    outerTx?: DBTransaction,
    options?: NotificationEngineCallOptions
  ): Promise<SessionReturnType> {
    const t = getServerTranslations(locale).errorsTranslations;

    // The service-side governance-clean admin gate — the FIRST statement
    // of every method (the same gate the reference arbitration op enforces).
    await assertAdminGovernanceClean(actorId, t, outerTx);

    const parsed = AdminSessionCancelInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new ValidationError(t.validation);
    }
    const cancelReason = normalizeAdminCancelReason(parsed.data.reason);

    // A present key must fit the claim column (carried verbatim — the
    // same guard the booking flow applies; an absent key disables the
    // claim mechanism for this call).
    if (idempotencyKey !== null && idempotencyKey !== undefined) {
      if (idempotencyKey.length === 0 || idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
        throw new ValidationError(t.idempotencyKeyRequired);
      }
    }

    const outcome = await withTransaction(outerTx, tx =>
      cancelSessionInTx(actorId, parsed.data, cancelReason, idempotencyKey ?? null, locale, tx, t, options)
    );

    if (outerTx === undefined) {
      await NotificationEngine.publishReceipts(outcome.receipts, locale, options);
    }
    return outcome.session;
  }

  /**
   * Reassigns a scheduled session to a different teacher as an ADMIN.
   *
   * The candidate teacher's certification is asserted inside the mutation
   * transaction BEFORE the guarded write, through the same locking read
   * the booking flow uses: the `SELECT … FOR UPDATE` row lock is held
   * until this transaction resolves, so the certification value the check
   * sees is the value the reassignment commits against — no flip window.
   * A candidate that is not a teacher at all is the localized not-found
   * denial; a teacher row without an active approval flag is the
   * localized certification conflict.
   *
   * Inside ONE transaction (the extracted `reassignTeacherInTx` body) the
   * pre-write row read captures the outgoing teacher id for the audit
   * metadata (and classifies an unknown session id), the certification
   * lock runs, the guarded UPDATE re-asserts the scheduled-only
   * eligibility atomically (a disputed row is structurally unreachable —
   * an open dispute belongs to the arbitration surface), the single audit
   * row records the outgoing/incoming teacher ids, and the reassignment
   * wave persists as unpublished delivery receipts for the student, the
   * outgoing teacher, and the incoming teacher — published strictly after
   * this call's own commit.
   *
   * @param actorId  The acting admin's id.
   * @param input  The target session id and the candidate teacher's user
   *     id.
   * @param locale  Active request locale.
   * @param outerTx  Optional outer transaction (test path — SAVEPOINT).
   * @param options  Optional notification-engine call options.
   */
  export async function reassignTeacher(
    actorId: number,
    input: AdminSessionReassignInput,
    locale: string,
    outerTx?: DBTransaction,
    options?: NotificationEngineCallOptions
  ): Promise<SessionReturnType> {
    const t = getServerTranslations(locale).errorsTranslations;

    // The service-side governance-clean admin gate — the FIRST statement
    // of every method (the same gate the reference arbitration op enforces).
    await assertAdminGovernanceClean(actorId, t, outerTx);

    const parsed = AdminSessionReassignInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new ValidationError(t.validation);
    }

    const outcome = await withTransaction(outerTx, tx =>
      reassignTeacherInTx(actorId, parsed.data, locale, tx, t, options)
    );

    if (outerTx === undefined) {
      await NotificationEngine.publishReceipts(outcome.receipts, locale, options);
    }
    return outcome.session;
  }

  /**
   * Joins a live (in-progress) session as a read-only ADMIN observer.
   *
   * The operation is audit-only: it changes NO session column and writes
   * EXACTLY ONE audit row. Eligibility is validated BEFORE any write
   * (a pre-transaction read answers the not-started and unknown-id
   * denials with zero audit rows), then re-asserted ATOMICALLY inside the
   * transaction: the audit append is a single INSERT..SELECT whose
   * selection is gated by the row still being `started` in the SAME
   * statement — the check-then-insert window is zero by construction, so
   * a denied join can never leave an audit row behind. The returned row
   * is the same canonical shape the
   * participant read paths return (data reuse — the admin UI renders the
   * read-only live view from it).
   *
   * @param actorId  The acting admin's id.
   * @param input  The target session id.
   * @param locale  Active request locale.
   * @param outerTx  Optional outer transaction (test path — SAVEPOINT).
   */
  export async function join(
    actorId: number,
    input: AdminSessionJoinInput,
    locale: string,
    outerTx?: DBTransaction
  ): Promise<SessionReturnType> {
    const t = getServerTranslations(locale).errorsTranslations;

    // The service-side governance-clean admin gate — the FIRST statement
    // of every method (the same gate the reference arbitration op enforces).
    await assertAdminGovernanceClean(actorId, t, outerTx);

    const parsed = AdminSessionJoinInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new ValidationError(t.validation);
    }

    // Pre-transaction eligibility read — validate BEFORE any write. Both
    // denial arms below append zero audit rows and flip zero columns.
    const preRead = await SessionRepository.getAnyByIdForAdmin(parsed.data.sessionId, outerTx);
    if (preRead === null) {
      return rejectSessionNotFound("Admin session join denied: session not found", parsed.data.sessionId, t);
    }
    if (preRead.status !== SESSION_STARTED_STATUS) {
      return rejectStateConflict(
        "Admin session join denied: session not joinable in its current state",
        parsed.data.sessionId,
        t
      );
    }

    return withTransaction(outerTx, tx => joinObservationInTx(actorId, parsed.data.sessionId, tx, t));
  }
}
