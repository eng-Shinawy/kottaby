/**
 * SubscriptionAdmin settlement builders — the fresh-period insert and the
 * lane/junction/claim settlement sequence SHARED by the two admin
 * lifecycle flows that mint a new `active` period (renew and plan
 * change). Extracted from the twin inline implementations (the sibling
 * `subscription-admin.helpers.ts` / `subscription-plan-change.helpers.ts`
 * files) so the payment-column and junction semantics can never drift
 * between the flows: one insert shape, one settlement ORDER (lane write →
 * student↔subscription junction row → claim pointer backfill), one
 * fail-closed zero-row contract.
 *
 * The only per-flow variance is intentional and explicit at each call
 * site: the plan snapshot that anchors the window arithmetic (the
 * renewal's fresh read vs the plan-change target) and the lane write fn
 * (the renewal's relative `creditLaneBalance` increment vs the plan
 * change's exact `setLaneBalanceValue` settlement, which supersedes the
 * old lane contribution under the owner row's `FOR UPDATE` lock).
 *
 * Runtime only — no types are declared here; every shape lives in
 * `backend/types/` and is imported through `@/backend/types`.
 */

import { SubscriptionRepository } from "@/backend/db/repo/billing/subscription.repository";
import { SubscriptionPurchaseIdempotencyRepository } from "@/backend/db/repo/billing/subscription-purchase-idempotency.repository";
import { StudentRepository } from "@/backend/db/repo/students/student.repository";
import { studentSubscriptions } from "@/backend/db/schema/billing/student-subscriptions";
import type { SubscriptionCreditLane } from "@/backend/enum/billing/subscription-credit-lane.enum";
import { SubscriptionStatus } from "@/backend/enum/billing/subscription-status.enum";
import { ConflictError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import { MS_PER_DAY } from "@/backend/services/billing/subscription-admin.helpers";
import type { DBTransaction, PlanSelectType, StudentSelectType, SubscriptionSelectType } from "@/backend/types";
import type { ErrorsLabels } from "@/shared/locale/types/errors";

/**
 * Inserts the flow's fresh subscription row: one captured instant governs
 * the window (start = the mutation moment, end = start + the plan
 * snapshot's interval), the lifecycle state opens `active`, and the admin
 * mutation carries no gateway payload — the payment columns stay
 * explicitly null. Both flows anchor on a SERVER-read plan snapshot (the
 * caller never supplies window material).
 */
export async function insertAdminPeriodSubscription(
  ownerId: number,
  planSnapshot: Pick<PlanSelectType, "id" | "intervalDays">,
  scopedTx: DBTransaction
): Promise<SubscriptionSelectType> {
  const mutationInstant = new Date();
  return SubscriptionRepository.insertSubscription(
    {
      userId: ownerId,
      planId: planSnapshot.id,
      status: SubscriptionStatus.Active,
      startDate: mutationInstant,
      endDate: new Date(mutationInstant.getTime() + planSnapshot.intervalDays * MS_PER_DAY),
      paymentMethod: null,
      paymentReference: null,
      paymentVerifiedAt: null,
    },
    scopedTx
  );
}

/**
 * Settles the flow's balance side effects in order: the caller's lane
 * write runs first (zero rows means the owner's student row vanished,
 * unreachable through the FK restrict, and fails closed rather than
 * committing a period without its settlement), the student↔subscription
 * junction row is inserted, and the claim's subscription pointer is
 * backfilled — the claim and the mutation commit atomically.
 *
 * `flowLabel` + `zeroRowDetail` compose the zero-row denial's correlated
 * domain log ("Subscription <flowLabel> denied: owner student row vanished
 * before the lane <zeroRowDetail>") so diagnostics name the actual flow.
 */
export async function settleAdminSideEffects(options: {
  readonly flowLabel: string;
  readonly zeroRowDetail: string;
  readonly studentId: number;
  readonly writeLane: (tx: DBTransaction) => Promise<StudentSelectType | null>;
  readonly created: SubscriptionSelectType;
  readonly claimId: number;
  readonly tErrors: ErrorsLabels;
  readonly scopedTx: DBTransaction;
}): Promise<void> {
  const settled = await options.writeLane(options.scopedTx);
  if (settled === null) {
    logger.logDomainError(
      `Subscription ${options.flowLabel} denied: owner student row vanished before the lane ${options.zeroRowDetail}`,
      {
        code: "CONFLICT",
        entity: "subscriptions",
        entityId: options.created.id,
      }
    );
    throw new ConflictError(options.tErrors.conflict);
  }
  await options.scopedTx.insert(studentSubscriptions).values({
    studentId: options.studentId,
    subscriptionId: options.created.id,
  });
  await SubscriptionPurchaseIdempotencyRepository.updateClaimSubscriptionId(
    options.claimId,
    options.created.id,
    options.scopedTx
  );
}

/**
 * The renewal's fresh subscription row on the source row's plan (the
 * flow-shaped delegate over `insertAdminPeriodSubscription` — the source
 * row's owner and the fresh plan read's snapshot anchor the window).
 */
export async function insertRenewedSubscription(
  source: SubscriptionSelectType,
  plan: PlanSelectType,
  scopedTx: DBTransaction
): Promise<SubscriptionSelectType> {
  return insertAdminPeriodSubscription(source.userId, plan, scopedTx);
}

/**
 * Settles the renewal's balance side effects (the flow-shaped delegate
 * over `settleAdminSideEffects`): the owner's lane is CREDITED the plan's
 * full session count (the lane arrives pre-resolved through the helpers'
 * fail-closed member lookup), then the junction row and claim backfill.
 */
export async function settleRenewalSideEffects(
  source: SubscriptionSelectType,
  lane: SubscriptionCreditLane,
  creditedSessions: number,
  created: SubscriptionSelectType,
  claimId: number,
  tErrors: ErrorsLabels,
  scopedTx: DBTransaction
): Promise<void> {
  return settleAdminSideEffects({
    flowLabel: "renew",
    zeroRowDetail: "credit",
    studentId: source.userId,
    writeLane: tx => StudentRepository.creditLaneBalance(source.userId, lane, creditedSessions, tx),
    created,
    claimId,
    tErrors,
    scopedTx,
  });
}
