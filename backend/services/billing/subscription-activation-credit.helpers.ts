/**
 * SubscriptionActivationService's confirmed-activation credit unit — the
 * purchaser-owner lane credit behind the webhook settlement transaction,
 * extracted from `subscription-activation.service.ts` following the sibling
 * helpers convention (`student-payment.repository.admin-row.helpers.ts`,
 * `purchase-guards.helpers.ts`): the public surface stays the service file,
 * and this module backs it one-to-one. Nothing here is part of the public
 * API.
 *
 * The failure discipline is the service's `abortActivation` mirrored
 * verbatim — one correlated `logger.error` line and the client-safe
 * conflict copy (`Payment could not be processed.`) — so a failed credit
 * rolls the activation transaction back with nothing committed and nothing
 * leaked to the wire.
 */

import { ApplicantRepository, StudentRepository } from "@/backend/db/repo";
import { SubscriptionCreditLane } from "@/backend/enum/billing/subscription-credit-lane.enum";
import { ConflictError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import type { DBTransaction, PlanSelectType, StudentPaymentSelectType, SubscriptionSelectType } from "@/backend/types";

/**
 * The client-safe conflict copy for an internal row-mapping breach — the
 * exact breach belongs to the adjacent correlated log line, never to the
 * thrown message (the activation service's `abortActivation` discipline).
 */
const PAYMENT_PROCESSING_CONFLICT_MESSAGE = "Payment could not be processed.";

/** The closed lane vocabulary as widened strings — the switch's comparands. */
const LANE_HIFZ: string = SubscriptionCreditLane.Hifz;
const LANE_TAJWEED: string = SubscriptionCreditLane.Tajweed;
const LANE_REVIEWS: string = SubscriptionCreditLane.Reviews;

/**
 * Aborts the activation unit closed — the same correlated error line and
 * client-safe conflict copy the service's `abortActivation` emits, so a
 * failed credit is indistinguishable from any other aborted activation
 * (the tx rolls back, nothing is credited, the wire copy stays generic).
 */
function abortCreditUnit(detail: string, context: Record<string, unknown>): never {
  logger.error(`Subscription activation aborted: ${detail} — unit rolled back`, context);
  throw new ConflictError(PAYMENT_PROCESSING_CONFLICT_MESSAGE);
}

/**
 * Maps the plan row's stored balance-lane value onto the strongly-typed enum
 * the credit primitive requires — FAIL-CLOSED over the closed pg-enum
 * vocabulary. The mapper maps every writable member explicitly (hifz,
 * tajweed, reviews — never a cast), and the default is an unreachable
 * invariant breach (vocabulary drift between the DB enum and this code)
 * that aborts the activation unit closed — the tx rolls back, nothing is
 * credited — instead of silently crediting a DIFFERENT lane than the plan
 * designated (loud over silent-wrong; the same exhaustive discipline as
 * `plan.pothos.ts`'s lane mapper). Unreachable through the pgEnum.
 */
function subscriptionCreditLaneOf(
  lane: PlanSelectType["balanceLane"] & string,
  correlation: { readonly reference: string; readonly subscriptionId: number; readonly planId: number }
): SubscriptionCreditLane {
  switch (lane) {
    case LANE_HIFZ:
      return SubscriptionCreditLane.Hifz;
    case LANE_TAJWEED:
      return SubscriptionCreditLane.Tajweed;
    case LANE_REVIEWS:
      return SubscriptionCreditLane.Reviews;
    default:
      // Unreachable through the pgEnum — fail the unit closed.
      return abortCreditUnit("stored plan balance lane is not a member of the closed credit-lane vocabulary", {
        ...correlation,
        storedLane: lane,
      });
  }
}

/**
 * The purchaser-owner credit decision, classified by the PERSISTED payment
 * owner inside the caller's transaction (the same transaction the credit
 * writes on):
 *
 *  - `payment.studentId != null` is the student purchase — the full session
 *    count is credited to the plan's designated lane on the persisted owner
 *    (relative accumulation); zero rows on that write ⇒ the student row
 *    vanished (unreachable through the FK restrict) — fail closed;
 *  - `payment.studentId === null` is the verification purchase — the lane
 *    credit is intentionally skipped, the purchased session grant being
 *    enforced by the booking flow off the active subscription; the
 *    `applicants` row is probed once as the corruption detector — a missing
 *    row (neither owner row exists) fails the unit closed with the
 *    vanished-row posture (the same client-safe conflict the student path
 *    raises).
 *
 * The ledger column — not a row-existence probe — is the classifier: the
 * purchasing flow writes the owner id (or NULL for a verification purchase)
 * at insert time, so the classification stays correct even for a user that
 * somehow owns BOTH a students and an applicants row (the schemas do not
 * prevent that coexistence), and a verification payment can never receive
 * lane credit.
 */
export async function applyActivationCredit(
  subscription: SubscriptionSelectType,
  payment: StudentPaymentSelectType,
  plan: PlanSelectType & { balanceLane: Exclude<PlanSelectType["balanceLane"], null> },
  reference: string,
  tx: DBTransaction
): Promise<void> {
  const vanish = () =>
    abortCreditUnit("student row vanished before the lane credit", {
      reference,
      subscriptionId: subscription.id,
      studentId: subscription.userId,
    });
  if (payment.studentId === null) {
    // The verification purchase — no lane credit; nothing else changes (the
    // purchased session grant is enforced by the booking flow off the
    // active subscription). The applicants probe is the corruption
    // detector: neither owner row is a broken purchaser — fail closed.
    if ((await ApplicantRepository.findByUserId(subscription.userId, tx)) === null) vanish();
    return;
  }
  // Fail-closed lane resolution — an unknown stored lane aborts the unit
  // closed instead of crediting a lane the plan never designated. Zero rows
  // on the credit ⇒ the student row vanished (unreachable through the FK
  // restrict) — fail closed.
  const lane = subscriptionCreditLaneOf(plan.balanceLane, {
    reference,
    subscriptionId: subscription.id,
    planId: plan.id,
  });
  if ((await StudentRepository.creditLaneBalance(payment.studentId, lane, plan.sessionCount, tx)) === null) vanish();
}
