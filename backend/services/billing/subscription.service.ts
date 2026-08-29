/**
 * SubscriptionService — business-logic hub for the subscription-request
 * domain (DEV1-006 Phase A: offline-payment groundwork; Phase B: the admin
 * payment-verification transition; DEV1-009: the admin lifecycle surface —
 * the filtered all-statuses list + the cancel transition).
 *
 * Responsibilities:
 *  1. `requestPlanSubscription` — the purchase entry point. Inside ONE
 *     transaction it: probes the caller's unresolved duplicate request
 *     (`SUBSCRIPTION_REQUEST_EXISTS`), re-validates plan activeness under
 *     the row lock (`lockActivePlanById` — decision D2's deferred
 *     obligation: a deactivated plan can never be purchased while inactive,
 *     INV-PC1), and inserts the PENDING subscription row. The created row
 *     carries NO payment data and NO dates — the payment-confirmation
 *     stage (admin-verified offline payments per decision B.9) owns the
 *     activation transition.
 *  2. `listMySubscriptions` — the owner-scoped read behind the storefront's
 *     pending-request state. Ownership is the resolver's `ctx.user.id` —
 *     there is NO cross-user subscription read at this phase.
 *  3. `listPendingSubscriptionRequests` — the ADMIN verification-queue read
 *     (Phase B): every PENDING request with its plan and a narrow purchaser
 *     summary, oldest first. No mutation surface.
 *  4. `verifySubscriptionPayment` — the payment-confirmation transition
 *     (Phase B): pure validations → existence/status probe → guarded
 *     `pending → active` write that stamps the offline-payment columns and
 *     derives the validity window from the plan's CURRENT intervalDays.
 *     Balance crediting stays DEV1-007's concern — this touches ONLY the
 *     subscription row.
 *  5. `listAllSubscriptionsForAdmin` — the ADMIN lifecycle-list read
 *     (DEV1-009): every subscription in ALL statuses unless a narrowed
 *     `status` filter says otherwise, newest first, bounded pagination
 *     (clamped 1..100, offset floor 0 — the audit-trail discipline).
 *  6. `cancelSubscription` — the admin cancel transition (DEV1-009):
 *     guarded `active|pending → cancelled` write + in-transaction audit
 *     row. Expired/cancelled/suspended rows are terminal and reject.
 *
 * Disciplines (mirroring `PlanCatalogService`):
 *  - Validation is pure and precedes any write; ids must be positive
 *    integers (rejected with the localized plan-not-found copy).
 *  - All user-facing strings resolve through
 *    `getServerTranslations(locale).errorsTranslations`; no hardcoded
 *    messages, no raw constraint names, no print-style logging.
 *  - Expected rejections go through `logger.logDomainError` with payloads
 *    limited to ids + machine code; the audit seam emits a structured
 *    transition marker only (DEV3-020 attaches here — sanctioned deferral
 *    D1, same seam contract as the plan-catalog service).
 *  - Subscription row shaping is BOPLA: the service accepts `userId` +
 *    `planId` and nothing else — the caller cannot forge status, dates, or
 *    payment columns through any surface here.
 */
import { eq } from "drizzle-orm";
import { db } from "@/backend/db";
import { PlanRepository, SubscriptionRepository } from "@/backend/db/repo";
import type { OfflineVerificationPaymentMethod } from "@/backend/db/repo/billing/subscription.repository";
import { plans } from "@/backend/db/schema/billing/plans";
import { users } from "@/backend/db/schema/users/users";
import { ConflictError, ValidationError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import { AuditLogService } from "@/backend/services/audit/audit-log.service";
import type {
  AuditLogSelectType,
  DBTransaction,
  PlanReturnType,
  SubscriptionReturnType,
  SubscriptionUserSummary,
} from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";

/** Localized error-translation slice consumed by this service. */
type SubscriptionErrorTranslations = ReturnType<typeof getServerTranslations>["errorsTranslations"];

/** The owner-scoped read projection: subscription row + its plan row. */
export type SubscriptionWithPlan = SubscriptionReturnType & { plan: PlanReturnType };

/**
 * The admin verification-queue projection: subscription row + plan row +
 * the narrow purchaser summary. Backs the `AdminSubscriptionRequest`
 * GraphQL object (DEV1-006 Phase B) AND the `AdminSubscription` lifecycle
 * object (DEV1-009 — same projection, wider status span).
 */
export type SubscriptionWithPlanAndUser = SubscriptionReturnType & {
  plan: PlanReturnType;
  user: SubscriptionUserSummary;
};

/**
 * The sanctioned `subscription_status` values (mirrors the pgEnum in
 * `backend/db/schema/enums.ts` — the DB owns the constraint; this set owns
 * the wire-level filter narrowing for the admin lifecycle list, DEV1-009).
 */
export const SUBSCRIPTION_STATUSES = ["active", "pending", "expired", "cancelled", "suspended"] as const;

/** The page-size ceiling for the admin lifecycle-list read (DEV1-009). */
export const ADMIN_SUBSCRIPTIONS_MAX_LIMIT = 100;

/** The default page size when the caller omits one (DEV1-009). */
export const ADMIN_SUBSCRIPTIONS_DEFAULT_LIMIT = 50;

/**
 * The paginated admin lifecycle page + grand total behind the DEV1-009
 * viewer: items newest first, the total matching the SAME filter predicate,
 * and the clamped limit/offset that shaped the page.
 */
export interface AdminSubscriptionsPage {
  readonly items: SubscriptionWithPlanAndUser[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

/**
 * The ONLY payment methods the admin verification stage records (decision
 * B.9 — offline payments verified by the administration). The
 * `payment_gateway` pgEnum carries the wider gateway universe; an online
 * gateway phase widens this list, and the localized rejection copy already
 * covers the widening (one invalid-method message).
 */
const OFFLINE_PAYMENT_METHODS: readonly OfflineVerificationPaymentMethod[] = ["offline_cash", "bank_transfer"];

/** The reference column's varchar(255) bound, enforced service-side. */
const PAYMENT_REFERENCE_MAX_LENGTH = 255;

/** Milliseconds per day — `endDate` = start + plan.intervalDays × this. */
const MILLIS_PER_DAY = 86_400_000;

/**
 * Emits one expected domain rejection. Payloads stay limited to ids and the
 * machine code — no field values, no messages.
 */
function logSubscriptionRejection(
  code: string,
  message: string,
  ids: { userId?: number; planId?: number; subscriptionId?: number }
): void {
  logger.logDomainError(message, { code, entity: "subscriptions", ...ids });
}

/**
 * Emits the audit seam after a successful subscription transition.
 *
 * DEV3-020 Phase 1 semantics: when `actorId` is provided the transition is
 * recorded in the immutable audit trail INSIDE the caller's transaction
 * (fail-closed — the action and its audit row commit or roll back together;
 * currently only the payment-verification and cancellation transitions
 * carry an acting admin). Actorless transitions (the subscriber's own
 * request) keep the structured logger marker alone — they are user acts,
 * not admin actions, and audit rows require a real actor.
 *
 * `actionType` defaults to `"update"` (the generic administrative edit); a
 * caller may narrow it to a more specific `audit_action_type` verb —
 * DEV1-009's cancellation passes `"suspend"` (cancellation lands in the
 * suspend family of the audit viewer's chip taxonomy).
 *
 * `extras` carries transition-specific id references only (no field values,
 * no messages).
 */
async function emitSubscriptionAuditSeam(
  code: string,
  subscriptionId: number,
  planId: number,
  tx: DBTransaction,
  actorId?: number,
  extras: Record<string, string | number> = {},
  actionType: AuditLogSelectType["actionType"] = "update"
): Promise<void> {
  if (actorId === undefined) {
    logger.info(`Subscription transition: ${code}`, { code, entityId: subscriptionId, planId, ...extras });
    return;
  }
  await AuditLogService.recordAdminAction(
    {
      actorId,
      actionType,
      entityType: "subscriptions",
      entityId: subscriptionId,
      actionCode: code,
      details: { subscriptionId, planId, ...extras },
    },
    tx
  );
}

/**
 * Coerces and guards a caller-supplied plan id: only positive integers may
 * reach the repository. Any other shape cannot reference a plan, so it
 * rejects with the localized plan-not-found validation copy.
 */
function parsePlanId(id: number, t: SubscriptionErrorTranslations): number {
  if (!Number.isInteger(id) || id <= 0) {
    logSubscriptionRejection("PLAN_ID_INVALID", "Subscription request rejected: plan id is not a positive integer", {
      planId: id,
    });
    throw new ValidationError(t.planNotFound);
  }
  return id;
}

/**
 * Coerces and guards a caller-supplied subscription id: only positive
 * integers may reach the repository. Any other shape cannot reference a
 * subscription, so it rejects with the localized subscription-not-found
 * copy (the same "cannot reference the entity" posture as
 * {@link parsePlanId}).
 */
function parseSubscriptionId(id: number, t: SubscriptionErrorTranslations): number {
  if (!Number.isInteger(id) || id <= 0) {
    logSubscriptionRejection(
      "SUBSCRIPTION_ID_INVALID",
      "Payment verification rejected: subscription id is not a positive integer",
      { subscriptionId: id }
    );
    throw new ValidationError(t.subscriptionNotFound);
  }
  return id;
}

/**
 * Narrows a caller-supplied payment method to the sanctioned offline set.
 * Anything else cannot be recorded through the verification surface, so it
 * rejects with the localized invalid-method validation copy.
 */
function parseOfflinePaymentMethod(
  method: string,
  subscriptionId: number,
  t: SubscriptionErrorTranslations
): OfflineVerificationPaymentMethod {
  // `find` narrows the matched element to the typed array's element union —
  // a plain `includes` check would leave `method` as `string`.
  const match = OFFLINE_PAYMENT_METHODS.find(candidate => candidate === method);
  if (!match) {
    logSubscriptionRejection("PAYMENT_METHOD_INVALID", "Payment verification rejected: unsupported payment method", {
      subscriptionId,
    });
    throw new ValidationError(t.paymentMethodInvalid);
  }
  return match;
}

/**
 * Validates the caller-supplied payment reference (receipt number):
 * trimmed, non-empty, within the column's varchar(255) bound. The reference
 * is the auditable artifact of an offline payment — a blank or oversized
 * one must never reach the write.
 */
function parsePaymentReference(reference: string, subscriptionId: number, t: SubscriptionErrorTranslations): string {
  const trimmed = reference.trim();
  if (trimmed.length === 0 || trimmed.length > PAYMENT_REFERENCE_MAX_LENGTH) {
    logSubscriptionRejection(
      "PAYMENT_REFERENCE_INVALID",
      "Payment verification rejected: reference must be 1-255 characters after trimming",
      { subscriptionId }
    );
    throw new ValidationError(t.paymentReferenceInvalid);
  }
  return trimmed;
}

/**
 * Runs `fn` inside a transaction. If `outerTx` is provided (test path),
 * opens a SAVEPOINT on the outer transaction; otherwise opens a top-level
 * `db.transaction` (production path — the D2 row lock requires a live
 * transaction to survive until the INSERT commits). RegistrationService
 * precedent.
 */
async function withTransaction<T>(
  outerTx: DBTransaction | undefined,
  fn: (tx: DBTransaction) => Promise<T>
): Promise<T> {
  if (outerTx) {
    return outerTx.transaction(fn);
  }
  return db.transaction(fn);
}

export namespace SubscriptionService {
  /**
   * Requests a subscription to `planId` on behalf of `userId`.
   *
   * Guard order (all inside ONE transaction):
   *  1. id validation (pure, before the transaction opens);
   *  2. unresolved duplicate probe — a PENDING request for the same
   *     (user, plan) rejects with `SUBSCRIPTION_REQUEST_EXISTS`;
   *  3. D2 purchase-time re-validation — the plan row is SELECTed under
   *     `FOR UPDATE` with an active-only predicate; `null` rejects with
   *     `PLAN_INACTIVE` (missing and inactive are deliberately
   *     indistinguishable at this boundary);
   *  4. the PENDING insert (server-owned lifecycle columns).
   *
   * Active/expired/cancelled histories do NOT block a new request — only
   * an unresolved pending one does (renewal semantics belong to the
   * payment-activation phase).
   *
   * @param outerTx  Optional outer transaction — when provided (test path),
   *     the flow runs inside a SAVEPOINT on it; otherwise a top-level
   *     transaction opens (the D2 row lock requires a live transaction).
   * @returns The persisted PENDING subscription row with its plan row
   *     embedded (the D2-locked active plan) — the canonical wire shape
   *     for Apollo cache normalization.
   * @throws ValidationError when `planId` is not a positive integer.
   * @throws ConflictError with code `SUBSCRIPTION_REQUEST_EXISTS` when an
   *     unresolved pending request already exists for the same plan.
   * @throws ConflictError with code `PLAN_INACTIVE` when the plan is
   *     missing or deactivated (purchase-time re-validation, decision D2).
   */
  export async function requestPlanSubscription(
    userId: number,
    planId: number,
    locale: string,
    outerTx?: DBTransaction
  ): Promise<SubscriptionWithPlan> {
    const t = getServerTranslations(locale).errorsTranslations;
    const validatedPlanId = parsePlanId(planId, t);

    return withTransaction(outerTx, async tx => {
      const duplicate = await SubscriptionRepository.existsPendingByUserAndPlan(userId, validatedPlanId, tx);
      if (duplicate) {
        logSubscriptionRejection(
          "SUBSCRIPTION_REQUEST_EXISTS",
          "Subscription request rejected: an unresolved pending request already exists for this plan",
          { userId, planId: validatedPlanId }
        );
        throw new ConflictError("SUBSCRIPTION_REQUEST_EXISTS", t.subscriptionRequestExists);
      }

      // D2 purchase-time re-validation under the row lock. A deactivated
      // (or missing) plan rejects here — INV-PC1 holds at purchase time
      // even against a deactivate racing the checkout.
      const activePlan = await SubscriptionRepository.lockActivePlanById(validatedPlanId, tx);
      if (!activePlan) {
        logSubscriptionRejection(
          "PLAN_INACTIVE",
          "Subscription request rejected: plan is not active at purchase time",
          {
            userId,
            planId: validatedPlanId,
          }
        );
        throw new ConflictError("PLAN_INACTIVE", t.planInactive);
      }

      const row = await SubscriptionRepository.insertPending({ userId, planId: validatedPlanId }, tx);
      // Actorless user act — logger marker only, no audit row (DEV3-020
      // scope: ADMIN actions; the request's owner is not an admin).
      await emitSubscriptionAuditSeam("SUBSCRIPTION_REQUESTED", row.id, row.planId, tx);
      return { ...row, plan: activePlan };
    });
  }

  /**
   * Every subscription owned by `userId`, newest first, each carrying its
   * plan row (`plan`) so the storefront can render request states without
   * a per-plan join query. The active-visibility predicate deliberately
   * does NOT filter here — the owner sees the real lifecycle state of what
   * they requested (deactivation may happen AFTER a request exists).
   *
   * @param tx  Optional transaction — propagated verbatim so a caller-owned
   *     atomic flow stays atomic (test path: `runInRollback` isolation).
   * @returns The user's subscriptions with their plan rows embedded.
   */
  export async function listMySubscriptions(
    userId: number,
    _locale: string,
    tx?: DBTransaction
  ): Promise<SubscriptionWithPlan[]> {
    const rows = await SubscriptionRepository.listByUserId(userId, tx);
    if (rows.length === 0) {
      return [];
    }
    // One catalog read for the whole batch (plans are a small catalog);
    // FK `restrict` semantics make a dangling planId unreachable, but the
    // lookup stays defensive — a missing row is an unexpected state that
    // must fail loudly at the masking boundary, never silently reshape.
    const planRows = await PlanRepository.listAll(tx);
    const planById = new Map(planRows.map(plan => [plan.id, plan]));
    return rows.map(row => {
      const plan = planById.get(row.planId);
      if (!plan) {
        logger.error("Subscription read hit a dangling plan reference (FK restrict violation?)", {
          subscriptionId: row.id,
          planId: row.planId,
        });
        throw new ValidationError(`Subscription ${row.id} references a missing plan.`);
      }
      return { ...row, plan };
    });
  }

  /**
   * The ADMIN verification queue (DEV1-006 Phase B): every PENDING
   * subscription with its plan row AND a narrow purchaser summary embedded,
   * oldest first (FIFO — the longest-waiting request surfaces first).
   *
   * Deactivated plans are deliberately NOT filtered from the queue: a
   * request placed while the plan was active survives deactivation
   * (REQ-017), and the admin must still see — and may still verify — it.
   * The purchaser summary is the repository's narrow projection (id /
   * fullName / email); no cross-user payment or identity leakage beyond
   * what verification requires.
   *
   * @param tx  Optional transaction — propagated verbatim (test path).
   * @returns Pending subscription requests, oldest first.
   */
  export async function listPendingSubscriptionRequests(
    _locale: string,
    tx?: DBTransaction
  ): Promise<SubscriptionWithPlanAndUser[]> {
    return SubscriptionRepository.listPendingForVerification(tx);
  }

  /**
   * Verifies a pending subscription's offline payment and activates the
   * subscription (DEV1-006 Phase B — the payment-confirmation transition,
   * decision B.9).
   *
   * Guard order (all inside ONE transaction):
   *  1. pure validations BEFORE the transaction opens — positive-integer
   *     subscription id, offline payment method (`offline_cash` |
   *     `bank_transfer`), reference trimmed to 1..255 chars;
   *  2. existence + status probe — a missing id rejects with
   *     `SUBSCRIPTION_NOT_FOUND`; a row in ANY non-pending state rejects
   *     with `SUBSCRIPTION_ALREADY_RESOLVED` (the queue only ever shows
   *     pending rows, but the mutation is reachable directly — the probe
   *     is the idempotency fence);
   *  3. the plan row is read PLAINLY (no active predicate): a request
   *     placed while the plan was active survives a later deactivation
   *     (REQ-017) — verification proceeds even if the plan is inactive by
   *     verification time, so an already-paid user is never stranded;
   *  4. the guarded write (`verifyAndActivatePending`) stamps the payment
   *     columns and flips `pending → active` in ONE conditional statement;
   *     a zero-row outcome (a concurrent verification won the predicate)
   *     re-probes and rejects with `SUBSCRIPTION_ALREADY_RESOLVED` —
   *     exactly one admin's verification ever wins.
   *
   * Lifecycle stamps: `startDate` = verification instant, `endDate` =
   * start + the plan's CURRENT `intervalDays` (REQ-018 forward-only
   * semantics — the purchase completes at verification, so current terms
   * apply; no price/interval snapshot column exists in MVP). An interval
   * that would overflow the JS date range rejects as an invalid plan
   * interval (defensive — the catalog CHECK only bounds it below by 1).
   *
   * Balance crediting is NOT this method's concern (DEV1-007 owns
   * `students.balance_*`); neither is any `wallet`/teacher-transaction
   * write — this transition touches ONLY the subscription row.
   *
   * @param input  `subscriptionId`, `paymentMethod` (offline set),
   *     `paymentReference` (trimmed 1..255), and `verifiedBy` (the
   *     verifying session's admin id — rides into the immutable audit row,
   *     DEV3-020).
   * @param outerTx  Optional outer transaction — when provided (test path),
   *     the flow runs inside a SAVEPOINT on it; otherwise a top-level
   *     transaction opens.
   * @returns The activated subscription row with its plan row embedded
   *     (the canonical `Subscription` wire shape).
   * @throws ValidationError when the id is not a positive integer, the
   *     payment method is outside the offline set, the reference is blank
   *     or oversized, or the interval overflows the date range.
   * @throws ConflictError with code `SUBSCRIPTION_NOT_FOUND` when the id
   *     references no row.
   * @throws ConflictError with code `SUBSCRIPTION_ALREADY_RESOLVED` when
   *     the row is no longer pending (already verified, cancelled, …) or
   *     lost a concurrent-verification race.
   */
  export async function verifySubscriptionPayment(
    input: {
      subscriptionId: number;
      paymentMethod: string;
      paymentReference: string;
      verifiedBy: number;
    },
    locale: string,
    outerTx?: DBTransaction
  ): Promise<SubscriptionWithPlan> {
    const t = getServerTranslations(locale).errorsTranslations;
    const validatedSubscriptionId = parseSubscriptionId(input.subscriptionId, t);
    const validatedMethod = parseOfflinePaymentMethod(input.paymentMethod, validatedSubscriptionId, t);
    const validatedReference = parsePaymentReference(input.paymentReference, validatedSubscriptionId, t);

    return withTransaction(outerTx, async tx => {
      const existing = await SubscriptionRepository.findStatusById(validatedSubscriptionId, tx);
      if (!existing) {
        logSubscriptionRejection(
          "SUBSCRIPTION_NOT_FOUND",
          "Payment verification rejected: subscription id references no row",
          { subscriptionId: validatedSubscriptionId }
        );
        throw new ConflictError("SUBSCRIPTION_NOT_FOUND", t.subscriptionNotFound);
      }
      if (existing.status !== "pending") {
        logSubscriptionRejection(
          "SUBSCRIPTION_ALREADY_RESOLVED",
          "Payment verification rejected: subscription is no longer pending",
          { subscriptionId: validatedSubscriptionId }
        );
        throw new ConflictError("SUBSCRIPTION_ALREADY_RESOLVED", t.subscriptionAlreadyResolved);
      }

      // Plain plan read (NO active predicate — REQ-017 posture documented
      // above). FK restrict makes a dangling planId unreachable; the check
      // stays defensive and fails loudly, never silently reshapes.
      const planRows = await tx.select().from(plans).where(eq(plans.id, existing.planId)).limit(1);
      const plan = planRows[0];
      if (!plan) {
        logger.error("Payment verification hit a dangling plan reference (FK restrict violation?)", {
          subscriptionId: validatedSubscriptionId,
          planId: existing.planId,
        });
        throw new ValidationError(`Subscription ${validatedSubscriptionId} references a missing plan.`);
      }

      const now = new Date();
      const endDate = new Date(now.getTime() + plan.intervalDays * MILLIS_PER_DAY);
      if (Number.isNaN(endDate.getTime())) {
        logSubscriptionRejection(
          "PLAN_INTERVAL_OVERFLOW",
          "Payment verification rejected: plan interval overflows the representable date range",
          { subscriptionId: validatedSubscriptionId, planId: plan.id }
        );
        throw new ValidationError(t.planIntervalDaysInvalid);
      }

      const activated = await SubscriptionRepository.verifyAndActivatePending(
        {
          subscriptionId: validatedSubscriptionId,
          paymentMethod: validatedMethod,
          paymentReference: validatedReference,
          startDate: now,
          endDate,
          verifiedAt: now,
        },
        tx
      );
      if (!activated) {
        // The guarded predicate matched nothing AFTER a successful probe:
        // a concurrent verification (or cancellation) won the row between
        // the probe and the write. Re-probe to disambiguate — the row
        // cannot have vanished (restrict-delete), so this resolves to
        // already-resolved.
        logSubscriptionRejection(
          "SUBSCRIPTION_ALREADY_RESOLVED",
          "Payment verification lost a race: subscription was resolved concurrently",
          { subscriptionId: validatedSubscriptionId }
        );
        throw new ConflictError("SUBSCRIPTION_ALREADY_RESOLVED", t.subscriptionAlreadyResolved);
      }

      await emitSubscriptionAuditSeam(
        "SUBSCRIPTION_PAYMENT_VERIFIED",
        activated.id,
        activated.planId,
        tx,
        input.verifiedBy,
        {
          verifiedBy: input.verifiedBy,
        }
      );
      return { ...activated, plan };
    });
  }

  /**
   * The ADMIN lifecycle list (DEV1-009): every subscription across ALL
   * statuses — unless a narrowed `status` filter says otherwise — newest
   * first (`created_at DESC, id DESC`), each carrying its plan row AND the
   * narrow purchaser summary, with a bounded pagination envelope.
   *
   * Guard order:
   *  1. the `status` filter is narrowed against `SUBSCRIPTION_STATUSES` via
   *     `find` BEFORE any read opens — anything else rejects with the
   *     localized invalid-status validation copy (a typo must surface as a
   *     loud rejection, never as a silently empty page);
   *  2. the pagination envelope is clamped — `limit` to 1..100 (default 50
   *     when omitted, the audit-trail discipline), `offset` floored at 0 —
   *     so a caller cannot request an unbounded page;
   *  3. the page read and the count read run against the SAME repository
   *     predicate (one composition, two consumers — the page and its total
   *     can never disagree).
   *
   * @param filters  `status` (raw wire string, narrowed here), `limit`,
   *     `offset` (clamped here).
   * @param tx  Optional transaction — propagated verbatim (test path).
   * @returns One page of subscriptions with `plan` + `user` embedded plus
   *     the total matching the SAME predicate.
   * @throws ValidationError when the `status` filter is outside the
   *     sanctioned `subscription_status` set.
   */
  export async function listAllSubscriptionsForAdmin(
    filters: { status?: string; limit?: number; offset?: number },
    locale: string,
    tx?: DBTransaction
  ): Promise<AdminSubscriptionsPage> {
    const t = getServerTranslations(locale).errorsTranslations;

    // `find` narrows the matched element to the typed array's element union
    // — a plain `includes` check would leave the filter as `string`. The
    // rejection precedes EVERY read (pure validation first).
    let statusFilter: (typeof SUBSCRIPTION_STATUSES)[number] | undefined;
    if (filters.status !== undefined) {
      const match = SUBSCRIPTION_STATUSES.find(candidate => candidate === filters.status);
      if (!match) {
        logSubscriptionRejection(
          "SUBSCRIPTION_STATUS_INVALID",
          "Admin subscription list rejected: unknown status filter",
          {}
        );
        throw new ValidationError(t.subscriptionStatusInvalid);
      }
      statusFilter = match;
    }

    // `??` (not the audit suite's `||` idiom) so an EXPLICIT zero clamps to
    // the 1 floor instead of silently falling back to the default page size;
    // non-finite shapes (NaN) fall back to the default like the audit read.
    const rawLimit = filters.limit ?? ADMIN_SUBSCRIPTIONS_DEFAULT_LIMIT;
    const limit = Math.min(
      Math.max(Math.trunc(Number.isFinite(rawLimit) ? rawLimit : ADMIN_SUBSCRIPTIONS_DEFAULT_LIMIT), 1),
      ADMIN_SUBSCRIPTIONS_MAX_LIMIT
    );
    const rawOffset = filters.offset ?? 0;
    const offset = Math.max(Math.trunc(Number.isFinite(rawOffset) ? rawOffset : 0), 0);

    const [items, total] = await Promise.all([
      SubscriptionRepository.listForAdmin({ status: statusFilter, limit, offset }, tx),
      SubscriptionRepository.countForAdmin({ status: statusFilter, limit, offset }, tx),
    ]);
    return { items, total, limit, offset };
  }

  /**
   * Cancels a subscription (DEV1-009 — the admin cancel transition). Only
   * `active` and `pending` rows are cancellable; `expired`, `cancelled`,
   * and `suspended` are TERMINAL states and reject with the localized
   * already-resolved conflict (a cancel can never resurrect or double-fire).
   *
   * Guard order (all inside ONE transaction):
   *  1. pure validation BEFORE the transaction opens — positive-integer
   *     subscription id;
   *  2. existence + status probe — a missing id rejects with
   *     `SUBSCRIPTION_NOT_FOUND`; a row outside the cancellable set rejects
   *     with `SUBSCRIPTION_ALREADY_RESOLVED` (the idempotency fence);
   *  3. the plan row is read PLAINLY (no active predicate — REQ-017
   *     posture, read AFTER the status probe exactly like
   *     `verifySubscriptionPayment`): cancelling a subscription whose plan
   *     was deactivated afterwards stays a legitimate administrative act;
   *  4. the guarded write (`cancelById`) flips `active|pending → cancelled`
   *     in ONE conditional statement; a zero-row outcome (a concurrent
   *     verification or cancellation won the predicate between the probe
   *     and the write) re-probes and rejects with
   *     `SUBSCRIPTION_ALREADY_RESOLVED` — exactly one transition ever wins,
   *     mirroring the verification race handling verbatim;
   *  5. the narrow purchaser summary is read (3 columns — never the full
   *     `users` row) to compose the canonical wire shape.
   *
   * Audit: one immutable `suspend`-family row (`SUBSCRIPTION_CANCELLED`,
   * extras `{ cancelledBy }`) rides the SAME transaction (fail-closed —
   * DEV3-020).
   *
   * Balance/credit semantics: cancelling does NOT refund, credit, or adjust
   * anything — DEV1-007 owns `students.balance_*`; this transition touches
   * ONLY the subscription row (plus its audit twin).
   *
   * @param input  `subscriptionId` and `cancelledBy` (the cancelling
   *     session's admin id — rides into the immutable audit row).
   * @param outerTx  Optional outer transaction — when provided (test path),
   *     the flow runs inside a SAVEPOINT on it; otherwise a top-level
   *     transaction opens.
   * @returns The cancelled subscription row with its plan row AND the
   *     narrow purchaser summary embedded (the canonical `AdminSubscription`
   *     wire shape).
   * @throws ValidationError when the id is not a positive integer or the
   *     plan reference is dangling (defensive — FK restrict makes it
   *     unreachable in practice).
   * @throws ConflictError with code `SUBSCRIPTION_NOT_FOUND` when the id
   *     references no row.
   * @throws ConflictError with code `SUBSCRIPTION_ALREADY_RESOLVED` when
   *     the row is expired/cancelled/suspended (terminal) or lost a
   *     concurrent-transition race.
   */
  export async function cancelSubscription(
    input: { subscriptionId: number; cancelledBy: number },
    locale: string,
    outerTx?: DBTransaction
  ): Promise<SubscriptionWithPlanAndUser> {
    const t = getServerTranslations(locale).errorsTranslations;
    const validatedSubscriptionId = parseSubscriptionId(input.subscriptionId, t);

    return withTransaction(outerTx, async tx => {
      const existing = await SubscriptionRepository.findStatusById(validatedSubscriptionId, tx);
      if (!existing) {
        logSubscriptionRejection("SUBSCRIPTION_NOT_FOUND", "Cancellation rejected: subscription id references no row", {
          subscriptionId: validatedSubscriptionId,
        });
        throw new ConflictError("SUBSCRIPTION_NOT_FOUND", t.subscriptionNotFound);
      }
      if (existing.status !== "active" && existing.status !== "pending") {
        logSubscriptionRejection(
          "SUBSCRIPTION_ALREADY_RESOLVED",
          "Cancellation rejected: subscription is no longer active or pending",
          { subscriptionId: validatedSubscriptionId }
        );
        throw new ConflictError("SUBSCRIPTION_ALREADY_RESOLVED", t.subscriptionAlreadyResolved);
      }

      // Plain plan read (NO active predicate — REQ-017 posture documented
      // above). FK restrict makes a dangling planId unreachable; the check
      // stays defensive and fails loudly, never silently reshapes.
      const planRows = await tx.select().from(plans).where(eq(plans.id, existing.planId)).limit(1);
      const plan = planRows[0];
      if (!plan) {
        logger.error("Cancellation hit a dangling plan reference (FK restrict violation?)", {
          subscriptionId: validatedSubscriptionId,
          planId: existing.planId,
        });
        throw new ValidationError(`Subscription ${validatedSubscriptionId} references a missing plan.`);
      }

      const cancelled = await SubscriptionRepository.cancelById(validatedSubscriptionId, tx);
      if (!cancelled) {
        // The guarded predicate matched nothing AFTER a successful probe:
        // a concurrent verification (or cancellation) won the row between
        // the probe and the write. Re-probe to disambiguate — the row
        // cannot have vanished (restrict-delete), so this resolves to
        // already-resolved.
        logSubscriptionRejection(
          "SUBSCRIPTION_ALREADY_RESOLVED",
          "Cancellation lost a race: subscription was resolved concurrently",
          { subscriptionId: validatedSubscriptionId }
        );
        throw new ConflictError("SUBSCRIPTION_ALREADY_RESOLVED", t.subscriptionAlreadyResolved);
      }

      // Narrow purchaser summary for the wire shape (id / fullName / email
      // — never the full `users` row). FK restrict makes a dangling userId
      // unreachable; the check stays defensive and fails loudly.
      const userRows = await tx
        .select({ id: users.id, fullName: users.fullName, email: users.email })
        .from(users)
        .where(eq(users.id, cancelled.userId))
        .limit(1);
      const user = userRows[0];
      if (!user) {
        logger.error("Cancellation hit a dangling user reference (FK restrict violation?)", {
          subscriptionId: validatedSubscriptionId,
          userId: cancelled.userId,
        });
        throw new ValidationError(`Subscription ${validatedSubscriptionId} references a missing user.`);
      }

      // Cancellation lands in the suspend family of the audit viewer's
      // chip taxonomy — the actionType parameter narrowed to "suspend".
      await emitSubscriptionAuditSeam(
        "SUBSCRIPTION_CANCELLED",
        cancelled.id,
        cancelled.planId,
        tx,
        input.cancelledBy,
        { cancelledBy: input.cancelledBy },
        "suspend"
      );
      return { ...cancelled, plan, user };
    });
  }
}
