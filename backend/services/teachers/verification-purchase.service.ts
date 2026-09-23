/**
 * VerificationPurchaseService — the purchase flow for the teacher
 * verification plan through the provider-agnostic payment-gateway port.
 *
 * The verification plan is resolved SERVER-SIDE: the wire carries no plan
 * selector at all — the purchasable plan is the ACTIVE catalog row whose
 * title equals the shared verification-plan title constant, so purchase,
 * seeding, and UI can never drift apart on the product's identity.
 *
 * `purchase` composes the flow in a fixed order:
 *
 *   1. the pre-DB boundary: the caller id is a positive safe integer, the
 *      acting user's governance state is re-asserted (deleted/blocked/
 *      suspended callers are denied), and the idempotency key must be
 *      present and within the claim column's length — the key is carried
 *      verbatim (never trimmed, never coerced, never logged);
 *   2. the plan resolve from the active catalog (on the caller's
 *      transaction when `outerTx` is supplied, otherwise a bare pool read)
 *      — a missing or inactive plan fails the purchase BEFORE the gateway
 *      call and before any database write;
 *   3. the gateway checkout, OUTSIDE any database transaction — a provider
 *      call is a network boundary and must never hold a transaction open.
 *      The plan row feeding the checkout input (price + currency, carried
 *      verbatim as decimal strings) is read before the gateway call; the
 *      applicant's user id rides the checkout input's generic purchaser
 *      slot;
 *   4. ONE transaction that owns the authoritative validation and every
 *      write: the plan is re-validated as active (the pre-checkout read is
 *      only a gateway-input lookup — a plan deactivated mid-checkout fails
 *      the purchase), the fresh row is re-compared against the price and
 *      currency the checkout was created with (`PLAN_PRICE_CHANGED` denial
 *      before any write), the caller's governance state is re-asserted
 *      (a caller deleted/blocked/suspended during checkout fails here),
 *      the applicant lifecycle guard is re-asserted (a missing applicants
 *      row, an active re-application cooldown, and a certified applicant
 *      each fail the purchase BEFORE any write), the idempotency claim is
 *      inserted savepoint-bracketed, and the pending subscription + pending
 *      payment rows commit atomically with the claim's subscription
 *      backfill.
 *
 * The verification purchaser is an APPLICANT — a user without a `students`
 * row by construction. The payment row is therefore written with a NULL
 * owner (the owner of record is the subscription's generic user id) and
 * the student↔subscription junction insert is deliberately NOT performed.
 * A re-application from `failed` records one verification attempt in the
 * same transaction; the applicant row then flips to `in_evaluation`
 * through the guarded transition, whose zero-row result (the applicant is
 * already in evaluation under a concurrent or repeat purchase) is a
 * silent no-op, never an error.
 *
 * On a duplicate claim key the flow REPLAYS BY THROWING
 * (`ConflictError("DUPLICATE_REQUEST")` — never a row): throwing is what
 * keeps the replayed attempt free of charge, its own partial writes roll
 * back with the transaction. A key spent by a DIFFERENT caller is denied
 * with the oracle-safe payment-not-found error — another user's claim is
 * never surfaced.
 *
 * The purchaser identity comes exclusively from the caller's argument
 * (context-resolved server-side); the amount and currency come
 * exclusively from the plan row. There is no client-controlled purchase
 * input on this surface — the payment amount is carried verbatim from the
 * plan price: never a number, never arithmetic, never client-derived.
 */

import {
  ApplicantRepository,
  PlanRepository,
  StudentPaymentRepository,
  SubscriptionPurchaseIdempotencyRepository,
  SubscriptionRepository,
} from "@/backend/db/repo";
import { PaymentStatus } from "@/backend/enum/billing/payment-status.enum";
import { SubscriptionCreditLane } from "@/backend/enum/billing/subscription-credit-lane.enum";
import { SubscriptionStatus } from "@/backend/enum/billing/subscription-status.enum";
import { ApplicantStatus } from "@/backend/enum/teachers/applicant-status.enum";
import { withTransaction } from "@/backend/lib/db/with-transaction";
import { ConflictError, isPgUniqueViolation, NotFoundError, ValidationError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import { getPaymentGateway } from "@/backend/services/billing/payment-gateway/payment-gateway.factory";
import {
  assertNotReservedAdminClaimKey,
  assertPlanUnchangedSinceCheckout,
  isCarryableIdempotencyKey,
  isPositiveSafeId,
} from "@/backend/services/billing/purchase-guards.helpers";
import { buildCheckoutBillingInput } from "@/backend/services/billing/subscription-purchase.helpers";
import { assertActorGovernanceClean } from "@/backend/services/classes/session-lifecycle.governance";
import { ApplicantLifecycleService } from "@/backend/services/teachers/applicant-lifecycle.service";
import type {
  DBTransaction,
  PaymentCheckoutSession,
  PlanSelectType,
  PurchaseSubscriptionReturnType,
  StudentPaymentReturnType,
  StudentPaymentSelectType,
  SubscriptionPurchaseIdempotencySelectType,
  SubscriptionReturnType,
  SubscriptionSelectType,
} from "@/backend/types";
import {
  VERIFICATION_PLAN_CURRENCY,
  VERIFICATION_PLAN_INTERVAL_DAYS,
  VERIFICATION_PLAN_PRICE,
  VERIFICATION_PLAN_SESSION_COUNT,
  VERIFICATION_PLAN_TITLE,
} from "@/shared/constants/verification-plan.constants";
import { getServerTranslations } from "@/shared/locale/server-graphql";

/**
 * The client-safe conflict copy for an internal invariant breach — the
 * activation service's `abortActivation` discipline mirrored: the exact
 * breach belongs to the adjacent correlated log line, never to the thrown
 * message, because a purchase denial surfaces to the purchasing applicant
 * (the wire copy must stay generic).
 */
const PAYMENT_PROCESSING_CONFLICT_MESSAGE = "Payment could not be processed.";

/** The localized errors bundle shape consumed by every flow in this file. */
type ErrorsTranslations = ReturnType<typeof getServerTranslations>["errorsTranslations"];

/**
 * Resolves a duplicate-claim purchase into its replay outcome.
 *
 * Every same-caller duplicate — a claim with or without its subscription
 * pointer, and a vanished claim (fail-closed) — surfaces the
 * duplicate-replay conflict. THROWING (never returning a row) is what
 * makes a replay free of charge: this attempt's own partial writes roll
 * back with the transaction, so the replay commits zero new rows. A key
 * spent by a DIFFERENT caller is denied with the oracle-safe
 * payment-not-found error — another user's claim is never surfaced.
 */
async function replayPurchaseOrThrow(
  idempotencyKey: string,
  callerUserId: number,
  tx: DBTransaction,
  t: ErrorsTranslations
): Promise<never> {
  const claim = await SubscriptionPurchaseIdempotencyRepository.findByKey(idempotencyKey, tx);
  if (claim !== null && claim.userId !== callerUserId) {
    // Entity vocabulary: the id attributed here is a USERS id (the caller
    // whose key was probed), so the tag is "users" — never a subscription
    // tag under a user id.
    logger.logDomainError("Verification purchase replay denied: key claimed by another caller", {
      code: "PAYMENT_NOT_FOUND",
      entity: "users",
      entityId: callerUserId,
    });
    throw new NotFoundError("PAYMENT", t.notFound);
  }
  // No id is attributable yet (the replayed claim has produced no
  // subscription row for THIS attempt), so the tag carries the surface only.
  logger.logDomainError("Verification purchase replay blocked: key already claimed", {
    code: "DUPLICATE_REQUEST",
    entity: "subscriptions",
  });
  throw new ConflictError("DUPLICATE_REQUEST", t.duplicateRequest);
}

/**
 * The idempotency claim — savepoint-bracketed so a duplicate key poisons
 * only the savepoint, keeping the transaction readable for the replay
 * lookup. A duplicate key never returns: the flow replays by throwing
 * through `replayPurchaseOrThrow` (a non-duplicate failure surfaces
 * untouched, so the transaction rolls the whole purchase — claim
 * included — back together).
 */
async function insertClaimOrReplay(
  purchaserUserId: number,
  idempotencyKey: string,
  tx: DBTransaction,
  t: ErrorsTranslations
): Promise<SubscriptionPurchaseIdempotencySelectType> {
  try {
    return await tx.transaction(claimTx =>
      SubscriptionPurchaseIdempotencyRepository.insertClaim({ idempotencyKey, userId: purchaserUserId }, claimTx)
    );
  } catch (error) {
    if (!isPgUniqueViolation(error)) {
      throw error;
    }
    return replayPurchaseOrThrow(idempotencyKey, purchaserUserId, tx, t);
  }
}

/**
 * The pending subscription insert with the reference-collision
 * translation: the gateway checkout descriptor is carried verbatim (the
 * provider member becomes the payment method, the provider-minted
 * reference the payment reference) and the lifecycle state defaults to
 * `pending` at the database. A reference collision (the provider minted
 * the same reference for two purchases) becomes a conflict — the raw
 * driver error never escapes.
 */
async function insertPendingSubscription(
  purchaserUserId: number,
  planId: number,
  checkout: PaymentCheckoutSession,
  tx: DBTransaction,
  t: ErrorsTranslations
): Promise<SubscriptionSelectType> {
  try {
    return await SubscriptionRepository.insertSubscription(
      {
        userId: purchaserUserId,
        planId,
        paymentMethod: checkout.provider,
        paymentReference: checkout.providerReference,
      },
      tx
    );
  } catch (error) {
    if (!isPgUniqueViolation(error)) {
      throw error;
    }
    // Entity vocabulary: the only attributable id here is the PLAN row the
    // checkout was priced from — the colliding subscription row never
    // existed (its insert failed), so a plans id rides the "plans" tag.
    logger.logDomainError("Verification purchase rejected: payment reference already claimed", {
      code: "CONFLICT",
      entity: "plans",
      entityId: planId,
    });
    throw new ConflictError(t.subscriptionPurchase.paymentReferenceConflict, {
      cause: error instanceof Error ? error : undefined,
    });
  }
}

/**
 * The canonical member must carry the FULL seeded product contract — a
 * title match alone would let a mis-priced or mis-termed catalog row be
 * charged verbatim by the gateway and referenced as the subscription's
 * terms, and a price/currency match alone would let a re-titled or
 * re-termed row drift while the shared checkout guard still passes. The
 * mismatch is the same catalog-misconfiguration conflict: denied with the
 * client-safe copy before the gateway call and any write (the exact
 * divergent field belongs to the adjacent correlated log line, never to
 * the wire message).
 */
function assertCanonicalPlanContract(plan: PlanSelectType): void {
  if (
    plan.title === VERIFICATION_PLAN_TITLE &&
    plan.price === VERIFICATION_PLAN_PRICE &&
    plan.currency === VERIFICATION_PLAN_CURRENCY &&
    plan.sessionCount === VERIFICATION_PLAN_SESSION_COUNT &&
    plan.intervalDays === VERIFICATION_PLAN_INTERVAL_DAYS &&
    plan.balanceLane === SubscriptionCreditLane.Reviews
  ) {
    return;
  }
  logger.logDomainError("Verification purchase rejected: canonical plan contract mismatch", {
    code: "CONFLICT",
    entity: "plans",
    entityId: plan.id,
  });
  throw new ConflictError(PAYMENT_PROCESSING_CONFLICT_MESSAGE);
}

/**
 * The purchase transaction body — the fixed, never reordered write order
 * (active-plan re-validation → checkout-value re-comparison → governance
 * re-assertion → lifecycle guard → savepoint-bracketed idempotency claim →
 * applicant read → pending subscription insert → NULL-owner pending
 * payment insert → re-application attempt accounting from `failed` →
 * guarded flip to in-evaluation → claim backfill). Any failure rolls the
 * whole purchase back, which also releases the claim (a failed purchase
 * never burns its key).
 */
async function purchaseVerificationInTx(
  applicantUserId: number,
  planId: number,
  checkoutAmount: string,
  checkoutCurrency: string,
  checkout: PaymentCheckoutSession,
  idempotencyKey: string,
  locale: string,
  tx: DBTransaction,
  t: ErrorsTranslations
): Promise<PurchaseSubscriptionReturnType> {
  // The authoritative plan re-read: the pre-checkout catalog scan only fed
  // the gateway input — THIS read decides the purchase. A plan deactivated
  // mid-checkout fails here, before any write.
  const activePlan = await PlanRepository.findActiveById(planId, tx);
  if (activePlan === null) {
    logger.logDomainError("Verification purchase rejected: plan is not purchasable", {
      code: "PLAN_NOT_FOUND",
      entity: "plans",
      entityId: planId,
    });
    throw new NotFoundError("PLAN", t.subscriptionPurchase.planNotPurchasable);
  }

  // The checkout was priced from the PRE-transaction plan read; the pair is
  // only committable when the fresh row still agrees with it. Thrown before
  // ANY row write — the rollback discards the checkout session with zero
  // rows written (see the shared guard's docblock on session compensation).
  assertPlanUnchangedSinceCheckout("Verification purchase", activePlan, checkoutAmount, checkoutCurrency, t);

  // The shared guard above compares ONLY the charged pair (price/currency);
  // a same-price, same-currency admin edit to any other contract field
  // (title, session count, term, lane) during the gateway round-trip would
  // otherwise ride through and be stored as the subscription's plan terms.
  // The full canonical contract is therefore re-asserted on this fresh row
  // — still before ANY write (the gateway input was validated pre-checkout;
  // the row that gets STORED is validated here, on the authoritative read).
  assertCanonicalPlanContract(activePlan);

  // Governance re-assertion INSIDE the transaction: the pre-checkout check
  // read the actor before the gateway round-trip, so a caller deleted,
  // blocked, or suspended during checkout fails the whole purchase here —
  // the pair rolls back together with the claim.
  await assertActorGovernanceClean(applicantUserId, t, tx);

  // The lifecycle guard runs INSIDE the transaction and BEFORE any write:
  // a missing applicants row, an active re-application cooldown, and a
  // certified applicant each fail the purchase with zero rows written —
  // the guard and the writes share one transaction, so the TOCTOU window
  // between the decision and the money is closed.
  await ApplicantLifecycleService.assertCanPurchaseVerification(applicantUserId, locale, tx);

  const claim = await insertClaimOrReplay(applicantUserId, idempotencyKey, tx, t);

  // The applicant row behind the transition decision. Non-null beyond this
  // point: the lifecycle guard above just proved the row exists on this
  // transaction's snapshot. A null here is an internal invariant breach —
  // fail closed on the client-safe conflict copy instead of degrading.
  const applicant = await ApplicantRepository.findByUserId(applicantUserId, tx);
  if (applicant === null) {
    logger.error("Verification purchase aborted: applicant row vanished inside the purchase transaction", {
      applicantUserId,
    });
    throw new ConflictError(PAYMENT_PROCESSING_CONFLICT_MESSAGE);
  }

  const createdSubscription = await insertPendingSubscription(applicantUserId, activePlan.id, checkout, tx, t);

  // The pending payment — amount and currency are the plan row's values
  // carried verbatim (decimal string, ISO code): never client-derived,
  // never arithmetic. The lifecycle state defaults to `pending`. The owner
  // is deliberately NULL: a verification purchaser owns no `students` row,
  // so the student↔subscription junction insert is deliberately NOT
  // performed either — the subscription's generic user id is the owner of
  // record for this ledger entry.
  const createdPayment: StudentPaymentSelectType = await StudentPaymentRepository.insertPayment(
    {
      studentId: null,
      subscriptionId: createdSubscription.id,
      amount: activePlan.price,
      currency: activePlan.currency,
      paymentGateway: checkout.provider,
    },
    tx
  );

  // Re-application attempt accounting: only a purchase from `failed` is a
  // re-application — a first purchase from `pending` must not increment.
  if (applicant.status === ApplicantStatus.Failed) {
    await ApplicantLifecycleService.recordReapplication(applicantUserId, locale, tx);
  }

  // The purchase-time flip, guarded (pending|failed → in_evaluation). A
  // zero-row result means the applicant is already in evaluation under a
  // concurrent or repeat purchase — a silent no-op, never an error.
  await ApplicantRepository.transitionToInEvaluation(applicantUserId, tx);

  // Backfill the claim's subscription pointer in the same transaction —
  // the claim and the purchase commit atomically.
  await SubscriptionPurchaseIdempotencyRepository.updateClaimSubscriptionId(claim.id, createdSubscription.id, tx);

  // The strongly-typed return composition — each member projected by
  // field with its lifecycle enums re-applied explicitly (the raw rows
  // carry pg-enum string unions; the enum contract is made explicit,
  // never cast, never spread).
  const subscription: SubscriptionReturnType = {
    id: createdSubscription.id,
    userId: createdSubscription.userId,
    planId: createdSubscription.planId,
    startDate: createdSubscription.startDate,
    endDate: createdSubscription.endDate,
    paymentReference: createdSubscription.paymentReference,
    paymentVerifiedAt: createdSubscription.paymentVerifiedAt,
    createdAt: createdSubscription.createdAt,
    updatedAt: createdSubscription.updatedAt,
    status: SubscriptionStatus.Pending,
    paymentMethod: checkout.provider,
  };

  const payment: StudentPaymentReturnType = {
    id: createdPayment.id,
    studentId: createdPayment.studentId,
    subscriptionId: createdPayment.subscriptionId,
    amount: createdPayment.amount,
    currency: createdPayment.currency,
    createdAt: createdPayment.createdAt,
    updatedAt: createdPayment.updatedAt,
    status: PaymentStatus.Pending,
    paymentGateway: checkout.provider,
    // No provider transaction reference exists yet — the pending pair is
    // created before the gateway decision; the auditable link is recorded
    // by the guarded decision writers (the one-time NULL → value allowance).
    providerTransactionId: createdPayment.providerTransactionId,
  };

  return { subscription, payment, checkout };
}

export namespace VerificationPurchaseService {
  /**
   * Purchases the teacher verification plan for the acting applicant.
   *
   * The pre-DB boundary rejects a malformed identifier, a governed
   * caller, and a missing/over-length idempotency key BEFORE any database
   * work. The verification plan is resolved server-side from the ACTIVE
   * catalog by exact title match against the shared title constant — the
   * caller supplies no plan selector — and a missing or inactive plan
   * fails the purchase before the gateway call. The gateway checkout runs
   * outside every transaction (a network call never holds a transaction
   * open). Inside one transaction the plan is re-validated as active, the
   * applicant lifecycle guard is re-asserted (missing row / active
   * cooldown / certified each fail the purchase before any write), the
   * idempotency claim is inserted savepoint-bracketed, the pending
   * subscription + NULL-owner pending payment rows commit atomically with
   * the claim's subscription backfill, a re-application from `failed`
   * records one attempt, and the applicant row flips to `in_evaluation`
   * through the guarded transition (a zero-row result is the silent
   * no-op).
   *
   * On a duplicate claim key the flow REPLAYS BY THROWING: every
   * same-caller duplicate — a claim with or without its subscription
   * pointer, and a vanished claim (fail-closed) — surfaces the
   * `ConflictError("DUPLICATE_REQUEST")` conflict; this attempt's own
   * partial writes roll back with the transaction, so the replay commits
   * zero new rows. A key spent by a DIFFERENT caller is denied with the
   * oracle-safe payment-not-found error — another user's claim is never
   * surfaced.
   *
   * @param applicantUserId  The purchasing applicant's id (context-resolved
   *     server-side by the caller; shared PK with the users table).
   * @param idempotencyKey  The captured request idempotency key, carried
   *     verbatim (never trimmed, never coerced, never logged), or null
   *     when the transport supplied none.
   * @param locale  Active request locale (for the localized error messages).
   * @param outerTx  Optional outer transaction. When provided (test path),
   *     the flow runs inside a SAVEPOINT on it and the plan resolve rides
   *     the same transaction — the whole flow participates in the caller's
   *     unit instead of escaping to the pool; production callers omit it
   *     and the service opens its own transaction (the plan resolve is
   *     then a bare pool read).
   * @returns The pending subscription/payment pair plus the checkout
   *     descriptor for a FIRST purchase; a replay never returns — it
   *     throws `ConflictError("DUPLICATE_REQUEST")`.
   */
  export async function purchase(
    applicantUserId: number,
    idempotencyKey: string | null,
    locale: string,
    outerTx?: DBTransaction
  ): Promise<PurchaseSubscriptionReturnType> {
    const t = getServerTranslations(locale).errorsTranslations;

    // Pre-DB boundary validation — fail before any database work.
    if (!isPositiveSafeId(applicantUserId)) {
      throw new ValidationError(t.validation);
    }

    // Governance re-check — the acting user must be governance-clean.
    await assertActorGovernanceClean(applicantUserId, t, outerTx);

    if (!isCarryableIdempotencyKey(idempotencyKey)) {
      // Entity vocabulary: the attributed id is the caller's USERS id — a
      // user id rides the "users" tag, never a subscription tag.
      logger.logDomainError("Verification purchase rejected: idempotency key required", {
        code: "VALIDATION",
        entity: "users",
        entityId: applicantUserId,
      });
      throw new ValidationError(t.subscriptionPurchase.idempotencyKeyRequired);
    }
    // The reserved admin claim namespace is never a carryable client key —
    // a squat there would block the admin renew / plan-change flows for a
    // targeted row (the guard is a validation reject BEFORE any DB work).
    assertNotReservedAdminClaimKey("Verification purchase", idempotencyKey, applicantUserId, t);

    // The plan resolve — server-side only, from the ACTIVE catalog by
    // exact title match against the shared constant. The read rides the
    // caller's transaction when `outerTx` is supplied (the whole flow
    // participates in the caller's unit instead of escaping to the pool);
    // production callers omit it and this is a bare pool read. The
    // authoritative re-validation runs inside the purchase transaction
    // below. Plan titles carry no uniqueness constraint, so an ambiguous
    // catalog (two active rows sharing the canonical title) can never
    // silently bind the purchase to the first match: the ambiguity is the
    // catalog-misconfiguration conflict, denied with the client-safe copy
    // BEFORE the gateway call and any write.
    const activePlans = await PlanRepository.listActive(outerTx);
    const matchingPlans = activePlans.filter(candidate => candidate.title === VERIFICATION_PLAN_TITLE);
    if (matchingPlans.length > 1) {
      logger.logDomainError(
        "Verification purchase rejected: ambiguous catalog — multiple active plans share the canonical title",
        {
          code: "CONFLICT",
          entity: "plans",
          // No single plan row is attributable — the resolution key names
          // the ambiguous catalog member (never the idempotency key, never
          // caller identity).
          entityId: VERIFICATION_PLAN_TITLE,
        }
      );
      throw new ConflictError(PAYMENT_PROCESSING_CONFLICT_MESSAGE);
    }
    const plan = matchingPlans.at(0);
    if (plan === undefined) {
      logger.logDomainError("Verification purchase rejected: plan is not purchasable", {
        code: "PLAN_NOT_FOUND",
        entity: "plans",
        // No plan row exists to carry an id — the resolution key names the
        // missing catalog member in the correlated log line (never the
        // idempotency key, never caller identity).
        entityId: VERIFICATION_PLAN_TITLE,
      });
      throw new NotFoundError("PLAN", t.subscriptionPurchase.planNotPurchasable);
    }

    // The canonical member must carry the FULL seeded product contract
    // before the gateway may charge it (see the shared guard's docblock).
    assertCanonicalPlanContract(plan);

    // Gateway checkout BEFORE the transaction — the provider call is a
    // network boundary. The amount/currency pair is the plan row's own,
    // carried verbatim; the caller cannot influence either. The applicant's
    // user id rides the checkout input's generic purchaser slot. The
    // special reference is the purchase-claim key itself — the provider
    // echoes it back on every callback and fulfillment resolves the pending
    // pair by it, so the claim and the provider order share one correlation
    // identity. The billing identity derives server-side from the
    // purchaser's user row (never client-supplied — the same shared helper
    // the student subscription purchase flow uses).
    const gateway = getPaymentGateway(locale);
    const checkout = await gateway.createCheckout({
      studentId: applicantUserId,
      planId: plan.id,
      amount: plan.price,
      currency: plan.currency,
      specialReference: idempotencyKey,
      billing: await buildCheckoutBillingInput(applicantUserId, t, outerTx),
    });

    return withTransaction(outerTx, tx =>
      purchaseVerificationInTx(
        applicantUserId,
        plan.id,
        plan.price,
        plan.currency,
        checkout,
        idempotencyKey,
        locale,
        tx,
        t
      )
    );
  }
}
