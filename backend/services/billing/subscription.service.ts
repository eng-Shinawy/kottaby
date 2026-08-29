/**
 * SubscriptionService — business-logic hub for the subscription-request
 * domain (DEV1-006 Phase A: offline-payment groundwork).
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
 *     activation transition in a later phase.
 *  2. `listMySubscriptions` — the owner-scoped read behind the storefront's
 *     pending-request state. Ownership is the resolver's `ctx.user.id` —
 *     there is NO cross-user subscription read at this phase.
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
import { db } from "@/backend/db";
import { PlanRepository, SubscriptionRepository } from "@/backend/db/repo";
import { ConflictError, ValidationError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import type { DBTransaction, PlanReturnType, SubscriptionReturnType } from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";

/** Localized error-translation slice consumed by this service. */
type SubscriptionErrorTranslations = ReturnType<typeof getServerTranslations>["errorsTranslations"];

/** The owner-scoped read projection: subscription row + its plan row. */
export type SubscriptionWithPlan = SubscriptionReturnType & { plan: PlanReturnType };

/**
 * Emits one expected domain rejection. Payloads stay limited to ids and the
 * machine code — no field values, no messages.
 */
function logSubscriptionRejection(code: string, message: string, ids: { userId?: number; planId?: number }): void {
  logger.logDomainError(message, { code, entity: "subscriptions", ...ids });
}

/**
 * Emits the audit hook seam after a successful subscription request. The
 * DEV3-020 audit-log integration attaches here (sanctioned deferral D1) —
 * this marker is structured, id-limited, and performs NO audit_logs writes.
 */
function emitSubscriptionAuditSeam(code: string, subscriptionId: number, planId: number): void {
  logger.info(`Subscription transition: ${code}`, { code, entityId: subscriptionId, planId });
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
      emitSubscriptionAuditSeam("SUBSCRIPTION_REQUESTED", row.id, row.planId);
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
}
