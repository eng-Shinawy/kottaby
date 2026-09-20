/**
 * SubscriptionAdmin plan-change flow — the upgrade/downgrade lifecycle
 * writer, split into its own module (the sibling-helpers file convention)
 * so the `SubscriptionAdminService` namespace stays focused on
 * orchestration-sized flows. The duplicate-claim REPLAY half (the
 * claim-key builder, the serialized-probe resolver, and the 23505 race
 * resolver) lives in the sibling `subscription-plan-change.replay.helpers.ts`
 * module — same extraction convention.
 *
 * Semantics: the source row must be `active` (a missing row denies with
 * the canonical not-found error, an already-cancelled row surfaces the
 * idempotent replay conflict, any other state the localized active-only
 * deny — the guarded-cancel disambiguation ladder reused verbatim), and
 * the TARGET plan must be active, different from the source plan, and
 * credit the SAME balance lane (cross-lane migration is out of scope).
 * The proration is computed from the student's CURRENT lane balance read
 * inside the transaction under the owner row's `FOR UPDATE` lock — the
 * lock (held to the transaction's end) serializes the read→settle pair
 * with concurrent lane debits, so a booking can never commit between the
 * balance read and the EXACT-value lane settlement (which still lands one
 * prepared total, never a relative increment).
 *
 * The idempotency claim
 * `subscription-admin:planChange:<sourceId>:<targetPlanId>` (minted under
 * the reserved server-owned namespace the purchase boundary refuses to
 * carry) is inserted (savepoint-bracketed) BEFORE any result write — the
 * flow's atomicity point. A duplicate REPLAYS the first result through
 * the claim's subscription pointer instead of re-crediting: the
 * serialized probe resolves a claim committed by an EARLIER call (its
 * source row is already `cancelled`) before the source-status guard, and
 * the savepoint-bracketed 23505 handler covers the concurrent window; a
 * committed claim that cannot resolve to a same-owner row surfaces the
 * localized already-plan-changed conflict. On the winning path the old
 * row is guarded-flipped to `cancelled` (fail closed on a zero-row
 * result — no disambiguation: the opening read already certified the
 * row's state under this transaction), the owner's lane is set to the
 * prepared exact total (the target plan's full session count plus the
 * computed carry on the upgrade leg; the downgrade forfeits the
 * remainder), the fresh period + junction row + claim backfill commit
 * together, and exactly ONE audit row (`Override` on the `subscription`
 * entity, details `{ direction, fromSubscriptionId, fromPlanId, toPlanId,
 * carrySessions, forfeitedExcess }` — enum values, ids, and integers
 * only) shares the transaction's fate.
 *
 * Runtime only — no types are declared here; every shape lives in
 * `backend/types/` and is imported through `@/backend/types`.
 */

import { PlanRepository } from "@/backend/db/repo/billing/plan.repository";
import { SubscriptionRepository } from "@/backend/db/repo/billing/subscription.repository";
import { SubscriptionPurchaseIdempotencyRepository } from "@/backend/db/repo/billing/subscription-purchase-idempotency.repository";
import { StudentRepository } from "@/backend/db/repo/students/student.repository";
import { AuditActionType } from "@/backend/enum/audit/audit-action-type.enum";
import { ProrationDirection } from "@/backend/enum/billing/proration-direction.enum";
import { SubscriptionCreditLane } from "@/backend/enum/billing/subscription-credit-lane.enum";
import { withTransaction } from "@/backend/lib/db/with-transaction";
import { ConflictError, isPgUniqueViolation, NotFoundError, ValidationError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import { assertActorAdmin } from "@/backend/services/admin/admin-gate.helpers";
import { AuditService } from "@/backend/services/admin/audit.service";
import { MAX_SESSION_COUNT } from "@/backend/services/billing/plan-catalog.helpers";
import {
  buildSubscriptionAuditContract,
  resolveCancelDenial,
  subscriptionCreditLaneMemberOf,
  toSubscriptionAdminDomainError,
  toSubscriptionAdminReturnType,
} from "@/backend/services/billing/subscription-admin.helpers";
import {
  insertAdminPeriodSubscription,
  settleAdminSideEffects,
} from "@/backend/services/billing/subscription-admin-settle.helpers";
import {
  planChangeClaimKey,
  replaySerializedPlanChange,
  resolvePlanChangeReplayRow,
} from "@/backend/services/billing/subscription-plan-change.replay.helpers";
import { computeProration } from "@/backend/services/billing/subscription-proration.helpers";
import type {
  ChangeSubscriptionPlanResult,
  ChangeSubscriptionPlanSubmitInput,
  DBTransaction,
  PlanSelectType,
  StudentSelectType,
  SubscriptionPurchaseIdempotencySelectType,
  SubscriptionSelectType,
} from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import type { ErrorsLabels } from "@/shared/locale/types/errors";

/**
 * Frozen credit-lane → `students` row lane-column reader. Keys are the
 * `SubscriptionCreditLane` enum members themselves — never caller
 * strings — so the proration's remaining-sessions read can only ever
 * select one of the real balance columns (`Object.freeze` blocks runtime
 * mutation; the `Record<SubscriptionCreditLane, ...>` annotation makes a
 * missing enum member a compile error).
 */
const STUDENT_LANE_BALANCE_READERS: Readonly<
  Record<SubscriptionCreditLane, (student: StudentSelectType) => number | null>
> = Object.freeze({
  [SubscriptionCreditLane.Hifz]: student => student.balanceHifz,
  [SubscriptionCreditLane.Tajweed]: student => student.balanceTajweed,
  [SubscriptionCreditLane.Reviews]: student => student.balanceReviews,
});

/**
 * The student's current balance on ONE lane — the proration's
 * `remainingSessions`. A legacy NULL lane reads as zero (the crediting
 * statements seed NULL lanes from zero through the same convention).
 */
function studentLaneBalanceOf(student: StudentSelectType, lane: SubscriptionCreditLane): number {
  return STUDENT_LANE_BALANCE_READERS[lane](student) ?? 0;
}

/**
 * Certifies the SOURCE plan's credit lane: an unconfigured lane cannot
 * anchor the settlement (the flow cannot know which column to supersede),
 * so it fails closed; the stored lane resolves to its canonical
 * credit-lane member through the helpers' total vocabulary lookup.
 */
function certifySourceLane(sourcePlan: PlanSelectType, tErrors: ErrorsLabels): SubscriptionCreditLane {
  if (sourcePlan.balanceLane === null) {
    logger.logDomainError("Subscription plan change denied: source plan balance lane is not configured", {
      code: "CONFLICT",
      entity: "plans",
      entityId: sourcePlan.id,
    });
    throw new ConflictError(tErrors.conflict);
  }
  return subscriptionCreditLaneMemberOf(sourcePlan.balanceLane, tErrors);
}

/**
 * The TARGET plan read with its guard ladder: a missing row denies with
 * the canonical plan not-found error, an inactive plan with the localized
 * inactive-plan deny, the source plan itself with the same-plan deny, and
 * a lane-less or DIFFERENT-lane plan with the localized incompatible-lane
 * deny (cross-lane migration is out of scope) — every denial zero-write.
 */
async function readPlanChangeTarget(
  newPlanId: number,
  sourcePlan: PlanSelectType,
  scopedTx: DBTransaction,
  tErrors: ErrorsLabels
): Promise<PlanSelectType> {
  const target = await PlanRepository.findById(newPlanId, scopedTx);
  if (target === null) {
    logger.logDomainError("Subscription plan change denied: target plan row missing", {
      code: "NOT_FOUND",
      entity: "plans",
      entityId: newPlanId,
    });
    throw new NotFoundError("PLAN", tErrors.planCatalog.planNotFound);
  }
  if (!target.isActive) {
    logger.logDomainError("Subscription plan change denied: target plan is inactive", {
      code: "CONFLICT",
      entity: "plans",
      entityId: target.id,
    });
    throw new ConflictError(tErrors.subscriptionAdmin.inactivePlan);
  }
  if (target.id === sourcePlan.id) {
    logger.logDomainError("Subscription plan change denied: target plan is the source plan", {
      code: "CONFLICT",
      entity: "plans",
      entityId: target.id,
    });
    throw new ConflictError(tErrors.subscriptionAdmin.samePlan);
  }
  if (target.balanceLane === null || target.balanceLane !== sourcePlan.balanceLane) {
    logger.logDomainError("Subscription plan change denied: target plan credits a different balance lane", {
      code: "CONFLICT",
      entity: "plans",
      entityId: target.id,
    });
    throw new ConflictError(tErrors.subscriptionAdmin.incompatibleLane);
  }
  // The session-count ceiling re-asserted at the target read (beside the
  // interval ceiling the proration re-checks): a legacy row above the
  // catalog ceiling must fail as the localized VALIDATION denial before
  // any claim or write, never as a raw lane-write overflow.
  if (target.sessionCount > MAX_SESSION_COUNT) {
    logger.logDomainError("Subscription plan change denied: target plan session count exceeds the catalog ceiling", {
      code: "VALIDATION",
      entity: "plans",
      entityId: target.id,
    });
    throw new ValidationError(tErrors.subscriptionAdmin.prorationOverflow);
  }
  return target;
}

/**
 * Inserts the plan-change claim (savepoint-bracketed so a duplicate key
 * poisons only the savepoint, keeping this transaction readable for the
 * replay lookup — the purchase flow's claim idiom). The key is
 * SERVER-CONSTRUCTED from the certified source row and target plan — the
 * caller never supplies claim material on this surface.
 *
 * @returns The fresh claim row, or `null` when the key was already
 *     claimed (the caller resolves the REPLAY through the committed claim
 *     instead of writing anything).
 */
async function insertPlanChangeClaim(
  sourceSubscriptionId: number,
  userId: number,
  targetPlanId: number,
  scopedTx: DBTransaction
): Promise<SubscriptionPurchaseIdempotencySelectType | null> {
  const claimKey = planChangeClaimKey(sourceSubscriptionId, targetPlanId);
  try {
    return await scopedTx.transaction(claimTx =>
      SubscriptionPurchaseIdempotencyRepository.insertClaim({ idempotencyKey: claimKey, userId }, claimTx)
    );
  } catch (error: unknown) {
    if (!isPgUniqueViolation(error)) {
      throw error;
    }
    return null;
  }
}

/**
 * Inserts the plan change's fresh subscription row via the shared
 * settlement builder (the sibling `subscription-admin-settle.helpers.ts`
 * module): one captured instant governs the window (start = the change
 * moment, end = start + the TARGET plan's interval), the lifecycle state
 * opens `active`, and the admin change carries no gateway payload — the
 * payment columns stay explicitly null. The TARGET plan's snapshot is the
 * window anchor (the plan-change variance the shared builder takes).
 */
async function insertChangedSubscription(
  source: SubscriptionSelectType,
  plan: PlanSelectType,
  scopedTx: DBTransaction
): Promise<SubscriptionSelectType> {
  return insertAdminPeriodSubscription(source.userId, plan, scopedTx);
}

/**
 * Settles the plan change's balance side effects via the shared settlement
 * builder (the sibling `subscription-admin-settle.helpers.ts` module), in
 * order: the owner's lane is set to the prepared EXACT total (the owner
 * row's `FOR UPDATE` lock from the proration read holds to this
 * transaction's end, so no debit can interleave — the exact-value write is
 * this flow's variance over the shared builder), the student↔subscription
 * junction row is inserted, and the claim's subscription pointer is
 * backfilled — the claim and the change commit atomically.
 */
async function settlePlanChangeSideEffects(
  studentId: number,
  lane: SubscriptionCreditLane,
  creditedSessions: number,
  created: SubscriptionSelectType,
  claimId: number,
  tErrors: ErrorsLabels,
  scopedTx: DBTransaction
): Promise<void> {
  return settleAdminSideEffects({
    flowLabel: "plan change",
    zeroRowDetail: "settlement",
    studentId,
    writeLane: tx => StudentRepository.setLaneBalanceValue(studentId, lane, creditedSessions, tx),
    created,
    claimId,
    tErrors,
    scopedTx,
  });
}

/**
 * Reads the change's owner `students` row — the proration's
 * remaining-sessions source — under a `FOR UPDATE` row lock on the SAME
 * transaction that later settles: the lock is held to the transaction's
 * end, so the balance read and the exact-value lane settlement serialize
 * against concurrent lane debits (a booking either lands BEFORE this read
 * and is honestly reflected in the proration, or blocks until after the
 * settlement commits — it can never commit in between and be silently
 * superseded by the prepared total). The lock is acquired only AFTER the
 * source subscription row's guarded flip, so the flow takes its two row
 * locks in the expiry sweep's order (subscriptions first, then the
 * owner's students row) — the reverse order would let a concurrent
 * sweep × plan-change race deadlock. `tx` is always supplied here (the
 * flow's transaction): a locking read without a transaction would release
 * its lock as soon as the statement finished. Fail-closed: a vanished
 * owner (unreachable through the FK restrict while the subscription
 * exists) denies with the localized conflict instead of committing a
 * change without its settlement.
 */
async function readPlanChangeOwner(
  source: { subscription: SubscriptionSelectType },
  tErrors: ErrorsLabels,
  scopedTx: DBTransaction
): Promise<StudentSelectType> {
  // The locking read lives in the repository layer (`findByIdForUpdate`,
  // mirroring the teacher repository's certification-check read) — the
  // service layer never issues `SELECT … FOR UPDATE` directly.
  const student = await StudentRepository.findByIdForUpdate(source.subscription.userId, scopedTx);
  if (!student) {
    logger.logDomainError("Subscription plan change denied: owner student row missing", {
      code: "CONFLICT",
      entity: "subscriptions",
      entityId: source.subscription.id,
    });
    throw new ConflictError(tErrors.conflict);
  }
  return student;
}

/**
 * Terminates the source period on the winning path: the guarded
 * active→cancelled flip (the cancel flow's exact single-statement
 * transition) runs AFTER the claim is won and BEFORE the fresh period is
 * inserted, so the lane settlement's exact total supersedes the old
 * contribution while the lane never carries two covering periods. A
 * zero-row result means a concurrent writer won between the opening read
 * and this flip — fail closed, the transaction rolls back with nothing
 * committed.
 */
async function cancelPlanChangeSource(
  source: SubscriptionSelectType,
  tErrors: ErrorsLabels,
  scopedTx: DBTransaction
): Promise<void> {
  const cancelled = await SubscriptionRepository.cancelActiveOnce(source.id, scopedTx);
  if (cancelled === null) {
    logger.logDomainError("Subscription plan change aborted: the source row's guarded cancel matched zero rows", {
      code: "CONFLICT",
      entity: "subscriptions",
      entityId: source.id,
    });
    throw new ConflictError(tErrors.conflict);
  }
}

/**
 * The plan-change flow's transaction body — every write of one committed
 * change (guarded old-row flip, exact lane settlement, fresh period,
 * junction, claim backfill) plus its exactly-one audit row, in ONE
 * transaction.
 */
async function changeSubscriptionPlanTx(
  input: ChangeSubscriptionPlanSubmitInput,
  actorId: number,
  tErrors: ErrorsLabels,
  scopedTx: DBTransaction
): Promise<ChangeSubscriptionPlanResult> {
  // The serialized-replay probe: a duplicate that arrives AFTER the first
  // change committed finds its source row already `cancelled` — the
  // guarded-cancel ladder below would deny before the race-path claim
  // lookup ever ran. A committed claim for this (source row, target plan)
  // pair is therefore resolved FIRST (REPLAY, or the localized
  // already-plan-changed conflict); with no committed claim the flow
  // proceeds, and the savepoint-bracketed 23505 handler below keeps
  // covering the concurrent window.
  const priorClaim = await SubscriptionPurchaseIdempotencyRepository.findByKey(
    planChangeClaimKey(input.subscriptionId, input.newPlanId),
    scopedTx
  );
  if (priorClaim !== null) {
    return replaySerializedPlanChange(input, priorClaim, scopedTx, tErrors);
  }

  const source = await SubscriptionRepository.findActiveWithPlan(input.subscriptionId, scopedTx);
  if (source === null) {
    // Missing, cancelled, or moved-on source: the fresh read
    // disambiguates — the not-found / replay-conflict / active-only deny
    // ladder, all zero-write. The log label names THIS flow.
    const current = await SubscriptionRepository.findById(input.subscriptionId, scopedTx);
    resolveCancelDenial(input.subscriptionId, current, tErrors, "plan change");
  }
  const lane = certifySourceLane(source.plan, tErrors);
  const target = await readPlanChangeTarget(input.newPlanId, source.plan, scopedTx, tErrors);

  const claim = await insertPlanChangeClaim(source.subscription.id, source.subscription.userId, target.id, scopedTx);
  if (claim === null) {
    return resolvePlanChangeReplayRow(source, target, scopedTx, tErrors);
  }

  await cancelPlanChangeSource(source.subscription, tErrors, scopedTx);

  // The proration's remaining-sessions input is the student's CURRENT lane
  // balance for the OLD lane, read inside this transaction (flat lanes).
  // The owner's FOR UPDATE lock is taken only AFTER the source row's
  // guarded flip, so this flow acquires its two row locks in the expiry
  // sweep's order (subscriptions first, then the owner's students row) —
  // the reverse order would let a concurrent sweep × plan-change race
  // deadlock (40P01). Held to the commit, the read→settle serialization
  // is unchanged and the proration input semantics are identical.
  const student = await readPlanChangeOwner(source, tErrors, scopedTx);
  const proration = computeProration(
    { remainingSessions: studentLaneBalanceOf(student, lane), oldPlan: source.plan, newPlan: target },
    tErrors
  );

  // The credit: the target plan's full session count, plus the computed
  // carry on the upgrade leg — the downgrade forfeits the remainder
  // (carrySessions arrives zero from the proration). The arithmetic cannot
  // overflow the lane's integer column: the target read re-asserts the
  // catalog's session ceiling (a legacy row above it fails as the
  // localized VALIDATION denial before any write) and the proration clamps
  // the carry at the same ceiling, so the settled total stays far inside
  // int4 — never a raw 22003 surfacing as a 500.
  const direction = proration.direction;
  const creditedSessions =
    direction === ProrationDirection.Upgrade ? target.sessionCount + proration.carrySessions : target.sessionCount;

  const created = await insertChangedSubscription(source.subscription, target, scopedTx);
  await settlePlanChangeSideEffects(
    source.subscription.userId,
    lane,
    creditedSessions,
    created,
    claim.id,
    tErrors,
    scopedTx
  );

  await AuditService.createAuditLog(
    buildSubscriptionAuditContract(actorId, AuditActionType.Override, created.id, {
      direction,
      fromSubscriptionId: source.subscription.id,
      fromPlanId: source.plan.id,
      toPlanId: target.id,
      carrySessions: proration.carrySessions,
      forfeitedExcess: proration.forfeitedSessions,
    }),
    scopedTx
  );

  return {
    subscription: toSubscriptionAdminReturnType(created, tErrors),
    direction,
    carrySessions: proration.carrySessions,
    forfeitedSessions: proration.forfeitedSessions,
  };
}

/**
 * Runs the plan-change flow: the admin gate re-asserts the actor's role
 * with zero writes on denial, then ONE transaction owns the reads, the
 * claim, every write, and the audit row. Domain errors map through the
 * shared translation (uniqueness and balance-CHECK violations become the
 * localized conflict) so the caller rethrows canonical domain errors.
 */
export async function changeSubscriptionPlanFlow(
  input: ChangeSubscriptionPlanSubmitInput,
  actorId: number,
  locale: string,
  tx?: DBTransaction
): Promise<ChangeSubscriptionPlanResult> {
  const tErrors = getServerTranslations(locale).errorsTranslations;

  // Defense-in-depth BFLA gate — zero writes, zero audit rows on denial.
  await assertActorAdmin(actorId, locale, tx);

  try {
    return await withTransaction(tx, scopedTx => changeSubscriptionPlanTx(input, actorId, tErrors, scopedTx));
  } catch (error: unknown) {
    throw toSubscriptionAdminDomainError(error, tErrors);
  }
}
