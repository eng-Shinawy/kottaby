/**
 * SubscriptionAdmin plan-change replay resolvers — the duplicate-claim
 * REPLAY half of the plan-change flow, extracted from
 * `subscription-plan-change.helpers.ts` following the file's
 * sibling-helper convention so the flow module stays within its line
 * budget. Nothing here is part of the public API beyond the flow module's
 * imports.
 *
 * Two duplicate shapes resolve here, both returning the FIRST change's
 * result with zeros (the replayed call moved nothing) and re-deriving the
 * plan-pair direction from the stored rows:
 *  - the SERIALIZED duplicate — a call arriving after the first change
 *    committed reaches the flow with its source row already `cancelled`,
 *    so the flow's source-status guard would deny before the race-path
 *    claim lookup ever ran; the flow therefore probes the claim key
 *    BEFORE the guard and hands the hit to `replaySerializedPlanChange`;
 *  - the CONCURRENT duplicate — the savepoint-bracketed claim insert lost
 *    the unique-index race (23505); the flow hands the already-loaded
 *    source/target rows to `resolvePlanChangeReplayRow`.
 *
 * A claim that cannot resolve to a same-owner result row (the set-null FK
 * after the result row's deletion, or a foreign owner) surfaces the
 * localized already-plan-changed conflict — never a re-creation, never a
 * replay across owners.
 *
 * The claim key is SERVER-CONSTRUCTED under the reserved admin namespace
 * (see `subscription-admin.helpers.ts`): the single builder here composes
 * it for the claim insert, the serialized probe, and every lookup, so the
 * identity can never drift between the write and the lookups.
 *
 * Runtime only — no types are declared here; every shape lives in
 * `backend/types/` and is imported through `@/backend/types`.
 */

import { PlanRepository } from "@/backend/db/repo/billing/plan.repository";
import { SubscriptionRepository } from "@/backend/db/repo/billing/subscription.repository";
import { SubscriptionPurchaseIdempotencyRepository } from "@/backend/db/repo/billing/subscription-purchase-idempotency.repository";
import { ConflictError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import {
  SUBSCRIPTION_ADMIN_CLAIM_PREFIXES,
  toSubscriptionAdminReturnType,
} from "@/backend/services/billing/subscription-admin.helpers";
import { prorationDirectionOf } from "@/backend/services/billing/subscription-proration.helpers";
import type {
  ChangeSubscriptionPlanResult,
  ChangeSubscriptionPlanSubmitInput,
  DBTransaction,
  PlanSelectType,
  SubscriptionPurchaseIdempotencySelectType,
  SubscriptionSelectType,
} from "@/backend/types";
import type { ErrorsLabels } from "@/shared/locale/types/errors";

/**
 * The plan-change claim key for one (source row, target plan) pair — the
 * single builder every claim insert, replay lookup, and serialized probe
 * composes, so the server-constructed identity can never drift between
 * the write and the lookups.
 */
export function planChangeClaimKey(sourceSubscriptionId: number, targetPlanId: number): string {
  return `${SUBSCRIPTION_ADMIN_CLAIM_PREFIXES.planChange}:${sourceSubscriptionId}:${targetPlanId}`;
}

/**
 * One bounded `already-plan-changed` denial (the localized default-code
 * conflict) for a committed claim that cannot resolve to a same-owner
 * result row — `detail` names the unresolvable shape, ids only in the log.
 */
function replayConflict(sourceSubscriptionId: number, detail: string, tErrors: ErrorsLabels): never {
  logger.logDomainError(`Subscription plan change denied: ${detail}`, {
    code: "CONFLICT",
    entity: "subscriptions",
    entityId: sourceSubscriptionId,
  });
  throw new ConflictError(tErrors.subscriptionAdmin.alreadyPlanChanged);
}

/**
 * Resolves a claim found by the SERIALIZED-replay probe: a duplicate that
 * arrives after the first change committed reaches this flow with its
 * source row already `cancelled`, so the guarded-cancel ladder downstream
 * would deny before the race-path claim lookup ever ran. The probe's key
 * is the same server-constructed (source row, target plan) identity the
 * winning path inserts, so a committed first change is REPLAYED here: its
 * pointed row is returned with zeros (THIS call moved nothing) and the
 * plan-pair direction re-derived from the stored rows. A pointer-less
 * claim (the set-null FK after the result row's deletion) or a claim whose
 * first result belongs to another owner cannot be replayed — the
 * localized already-plan-changed conflict denies instead.
 */
export async function replaySerializedPlanChange(
  input: ChangeSubscriptionPlanSubmitInput,
  priorClaim: SubscriptionPurchaseIdempotencySelectType,
  scopedTx: DBTransaction,
  tErrors: ErrorsLabels
): Promise<ChangeSubscriptionPlanResult> {
  const replayedId = priorClaim.subscriptionId ?? null;
  if (replayedId === null) {
    replayConflict(input.subscriptionId, "claim exists without a subscription pointer", tErrors);
  }
  const replayed = await SubscriptionRepository.findById(replayedId, scopedTx);
  if (replayed === null) {
    replayConflict(input.subscriptionId, "claim pointer resolves to no subscription row", tErrors);
  }
  const source = await SubscriptionRepository.findById(input.subscriptionId, scopedTx);
  if (source === null) {
    replayConflict(input.subscriptionId, "claim's source row no longer exists", tErrors);
  }
  // Both owner anchors were minted server-side: the claim's owner stamp
  // at claim time and the source row's own owner. A first result
  // belonging to anyone else is never replayed to this caller.
  if (replayed.userId !== priorClaim.userId || replayed.userId !== source.userId) {
    replayConflict(input.subscriptionId, "claim's first result belongs to another owner", tErrors);
  }
  const [oldPlan, targetPlan] = await Promise.all([
    PlanRepository.findById(source.planId, scopedTx),
    PlanRepository.findById(input.newPlanId, scopedTx),
  ]);
  if (oldPlan === null || targetPlan === null) {
    replayConflict(input.subscriptionId, "claim's plan pair no longer resolvable", tErrors);
  }
  return {
    subscription: toSubscriptionAdminReturnType(replayed, tErrors),
    direction: prorationDirectionOf(oldPlan, targetPlan, tErrors),
    carrySessions: 0,
    forfeitedSessions: 0,
  };
}

/**
 * Resolves a duplicate plan-change claim to its REPLAYED first result:
 * the claim's subscription pointer is loaded and returned with the
 * plan-pair-derived direction — THIS call moved nothing, so the carry and
 * forfeit report zero (the original arithmetic lives in the committed
 * audit row). A pointer that resolves to nothing (the set-null FK after
 * the result row's deletion) or to a foreign owner cannot be replayed:
 * the localized already-plan-changed conflict denies instead.
 */
export async function resolvePlanChangeReplayRow(
  source: { subscription: SubscriptionSelectType; plan: PlanSelectType },
  target: PlanSelectType,
  scopedTx: DBTransaction,
  tErrors: ErrorsLabels
): Promise<ChangeSubscriptionPlanResult> {
  const priorClaim = await SubscriptionPurchaseIdempotencyRepository.findByKey(
    planChangeClaimKey(source.subscription.id, target.id),
    scopedTx
  );
  const replayedId = priorClaim?.subscriptionId ?? null;
  if (replayedId === null) {
    replayConflict(source.subscription.id, "claim exists without a subscription pointer", tErrors);
  }
  const replayed = await SubscriptionRepository.findById(replayedId, scopedTx);
  if (replayed === null) {
    replayConflict(source.subscription.id, "claim pointer resolves to no subscription row", tErrors);
  }
  if (replayed.userId !== source.subscription.userId) {
    // The key space is server-constructed here, but the shared claim
    // store also carries client-supplied purchase keys — a foreign-owner
    // pointer is never replayed to this caller.
    replayConflict(source.subscription.id, "claim's first result belongs to another owner", tErrors);
  }
  return {
    subscription: toSubscriptionAdminReturnType(replayed, tErrors),
    direction: prorationDirectionOf(source.plan, target, tErrors),
    carrySessions: 0,
    forfeitedSessions: 0,
  };
}
