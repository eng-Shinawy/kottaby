/**
 * SubscriptionAdmin helpers — audit-contract composition, strict id
 * coercion, write-error translation, and the canonical row mapping for
 * the subscription-admin service (mirroring the plan-catalog helpers
 * split: the service namespace stays focused on orchestration).
 *
 * Runtime only — no types are declared here; every shape lives in
 * `backend/types/billing/subscription-admin.types.ts` and is imported
 * through `@/backend/types`.
 *
 * Disciplines enforced here:
 *  - Audit contract: `details` carries ids, integers, and ISO date
 *    strings only — never contact-PII, never credentials, never free
 *    text. The composed row is persisted by `AuditService.createAuditLog`
 *    inside the caller's transaction so it can never outlive a
 *    rolled-back mutation.
 *  - Id coercion: STRICT numeric parsing (never `Number.parseInt`), so a
 *    malformed id can never silently address an unrelated row.
 *  - Row mapping: the raw `$inferSelect` projection carries pg-enum
 *    string unions; the ReturnType's enum contract is applied through a
 *    total, fail-closed lookup over each closed vocabulary — never a
 *    cast, never a silent degrade.
 *  - Cancel denials: the zero-row guarded flip is disambiguated into the
 *    not-found miss, the idempotent already-cancelled replay conflict, or
 *    the localized active-only deny; the optional free-text reason is
 *    trimmed and bounded BEFORE any write and never enters a log.
 */

import { PlanRepository } from "@/backend/db/repo/billing/plan.repository";
import { SubscriptionRepository } from "@/backend/db/repo/billing/subscription.repository";
import { SubscriptionPurchaseIdempotencyRepository } from "@/backend/db/repo/billing/subscription-purchase-idempotency.repository";
import { StudentRepository } from "@/backend/db/repo/students/student.repository";
import type { AuditActionType } from "@/backend/enum/audit/audit-action-type.enum";
import { PaymentGateway } from "@/backend/enum/billing/payment-gateway.enum";
import { SubscriptionCreditLane } from "@/backend/enum/billing/subscription-credit-lane.enum";
import { SubscriptionStatus } from "@/backend/enum/billing/subscription-status.enum";
import { ConflictError, hasPgCode, isPgUniqueViolation, NotFoundError, ValidationError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import { MAX_INTERVAL_DAYS, MAX_SESSION_COUNT } from "@/backend/services/billing/plan-catalog.helpers";
import type {
  AuditLogWriteContract,
  DBTransaction,
  PlanSelectType,
  StudentSelectType,
  SubscriptionReturnType,
  SubscriptionSelectType,
} from "@/backend/types";
import type { ErrorsLabels } from "@/shared/locale/types/errors";

/**
 * The `entity_type` label minted into every subscription-admin audit row.
 */
export const SUBSCRIPTION_AUDIT_ENTITY_TYPE = "subscription";

/**
 * The RESERVED server-owned namespace every admin subscription claim key
 * lives under. The shared `subscription_purchase_idempotency` store also
 * carries RAW client-supplied purchase `x-idempotency-key` headers, so an
 * unreserved, predictably-shaped admin key (`renew:<id>`) could be
 * pre-claimed by a student and permanently block the admin renew /
 * plan-change flows for that row. Both ends keep the space server-owned:
 * the admin flows mint every claim key under this prefix (the builders
 * below), and the purchase boundary rejects client-supplied keys that
 * start with it (see `purchase-guards.helpers.ts`).
 */
export const SUBSCRIPTION_ADMIN_CLAIM_KEY_PREFIX = "subscription-admin";

/**
 * Server-constructed idempotency-claim key prefixes for the admin
 * subscription flows, composed under the reserved server prefix. The
 * caller never supplies claim material on this surface — the claim
 * identity is derived from the targeted row's id, so the shared claim
 * store's key space stays server-owned (the purchase surface's
 * client-header keys are a different, client-supplied space).
 */
export const SUBSCRIPTION_ADMIN_CLAIM_PREFIXES = {
  /** `subscription-admin:renew:<sourceSubscriptionId>` — one fresh period per expired source row. */
  renew: `${SUBSCRIPTION_ADMIN_CLAIM_KEY_PREFIX}:renew`,
  /** `subscription-admin:planChange:<sourceSubscriptionId>:<targetPlanId>` — one plan change per (source row, target plan) pair; a different target on the same source row is a genuinely new change, not a replay. */
  planChange: `${SUBSCRIPTION_ADMIN_CLAIM_KEY_PREFIX}:planChange`,
} as const;

/**
 * The renew claim key for one source row — the single builder every claim
 * insert, replay lookup, and probe composes (the renew twin of the
 * plan-change flow's `planChangeClaimKey`), so the server-constructed
 * identity can never drift between the write and the lookups.
 */
export function renewClaimKey(sourceSubscriptionId: number): string {
  return `${SUBSCRIPTION_ADMIN_CLAIM_PREFIXES.renew}:${sourceSubscriptionId}`;
}

/**
 * The PostgreSQL `integer` column's hard ceiling (int4 max): every
 * wire-supplied id coerces under it (a canonical decimal past it can never
 * name a row), and the renew flow pre-checks its relative lane credit
 * against it so the balance column can never be pushed out of range (a raw
 * 22003 never surfaces as a 500).
 */
export const MAX_INT4 = 2_147_483_647;

/** Milliseconds per day — the subscription window arithmetic unit shared by the extend, renew, and plan-change flows. */
export const MS_PER_DAY = 86_400_000;

/**
 * Resolves a duplicate renew claim to its REPLAYED first result: the
 * claim's subscription pointer is loaded and returned as the row the
 * original renewal created. A pointer that resolves to nothing (the
 * set-null FK after the result row's deletion — the aborted-original
 * shape) or to a foreign owner cannot be replayed: the localized
 * already-renewed conflict denies instead of re-creating anything.
 */
export async function resolveRenewalReplayRow(
  source: SubscriptionSelectType,
  scopedTx: DBTransaction,
  tErrors: ErrorsLabels
): Promise<SubscriptionSelectType> {
  const claimKey = renewClaimKey(source.id);
  const priorClaim = await SubscriptionPurchaseIdempotencyRepository.findByKey(claimKey, scopedTx);
  const replayedId = priorClaim?.subscriptionId ?? null;
  if (replayedId === null) {
    // The set-null FK after the result row's deletion (or an aborted
    // original): the claim is spent but points at nothing.
    logger.logDomainError("Subscription renew denied: claim exists without a subscription pointer", {
      code: "CONFLICT",
      entity: "subscriptions",
      entityId: source.id,
    });
    throw new ConflictError(tErrors.subscriptionAdmin.alreadyRenewed);
  }
  const replayed = await SubscriptionRepository.findById(replayedId, scopedTx);
  if (replayed === null) {
    logger.logDomainError("Subscription renew denied: claim pointer resolves to no subscription row", {
      code: "CONFLICT",
      entity: "subscriptions",
      entityId: source.id,
    });
    throw new ConflictError(tErrors.subscriptionAdmin.alreadyRenewed);
  }
  if (replayed.userId !== source.userId) {
    // The key space is server-constructed here, but the shared claim
    // store also carries client-supplied purchase keys — a foreign-owner
    // pointer is never replayed to this caller.
    logger.logDomainError("Subscription renew denied: claim's first result belongs to another owner", {
      code: "CONFLICT",
      entity: "subscriptions",
      entityId: source.id,
    });
    throw new ConflictError(tErrors.subscriptionAdmin.alreadyRenewed);
  }
  return replayed;
}

/**
 * The renewal's fresh plan read with its fail-closed guards: the
 * snapshot is the plan row's CURRENT content (activity is a
 * purchase-time property; the credit lane is not), and a missing row or
 * an unconfigured lane or an interval past the catalog's ceiling or a
 * lane balance without the credit's int4 headroom aborts the renewal — the caller's transaction rolls the just-inserted claim
 * back with it. The stored lane resolves to its canonical credit-lane
 * member here, so the caller receives a certified lane instead of a
 * nullable column.
 */
export async function readRenewalPlan(
  source: SubscriptionSelectType,
  scopedTx: DBTransaction,
  tErrors: ErrorsLabels
): Promise<{ plan: PlanSelectType; lane: SubscriptionCreditLane }> {
  const plan = await PlanRepository.findById(source.planId, scopedTx);
  if (plan === null) {
    logger.logDomainError("Subscription renew denied: plan row missing", {
      code: "CONFLICT",
      entity: "plans",
      entityId: source.planId,
    });
    throw new ConflictError(tErrors.conflict);
  }
  // The renewal opens a fresh one-interval window — a plan row past the
  // catalog's interval ceiling (purchasable copy until this read) can
  // never anchor one, so it fails closed before any arithmetic. The
  // session-count ceiling is re-asserted beside it: a legacy row above it
  // must fail as the localized VALIDATION denial, never as a raw lane
  // write overflow.
  if (plan.intervalDays > MAX_INTERVAL_DAYS) {
    logger.logDomainError("Subscription renew denied: plan interval days exceeds the catalog ceiling", {
      code: "VALIDATION",
      entity: "plans",
      entityId: plan.id,
    });
    throw new ValidationError(tErrors.subscriptionAdmin.prorationOverflow);
  }
  if (plan.sessionCount > MAX_SESSION_COUNT) {
    logger.logDomainError("Subscription renew denied: plan session count exceeds the catalog ceiling", {
      code: "VALIDATION",
      entity: "plans",
      entityId: plan.id,
    });
    throw new ValidationError(tErrors.subscriptionAdmin.prorationOverflow);
  }
  if (plan.balanceLane === null) {
    logger.logDomainError("Subscription renew denied: plan balance lane is not configured", {
      code: "CONFLICT",
      entity: "plans",
      entityId: source.planId,
    });
    throw new ConflictError(tErrors.conflict);
  }
  const lane = subscriptionCreditLaneMemberOf(plan.balanceLane, tErrors);
  await assertRenewalCreditHeadroom(source, plan, lane, scopedTx, tErrors);
  return { plan, lane };
}

/**
 * Frozen credit-lane → `students` row lane-column reader (the renew flow's
 * mirror of the plan-change reader) — the headroom pre-check's balance
 * source; a legacy NULL lane reads as zero.
 */
const RENEWAL_LANE_BALANCE_READERS: Readonly<
  Record<SubscriptionCreditLane, (student: StudentSelectType) => number | null>
> = Object.freeze({
  [SubscriptionCreditLane.Hifz]: student => student.balanceHifz,
  [SubscriptionCreditLane.Tajweed]: student => student.balanceTajweed,
  [SubscriptionCreditLane.Reviews]: student => student.balanceReviews,
});

/**
 * The renewal's credit-headroom pre-check: the renewal CREDITS the plan's
 * full session count on top of the owner's current lane balance, and the
 * balance column is a PostgreSQL int4 — a balance already past
 * `MAX_INT4 - plan.sessionCount` would push the relative credit out of the
 * column's range. The plan-change flow applies the same fail-closed
 * posture to its prepared total; the renewal denies here with the
 * localized conflict BEFORE the fresh period and its credit — never a raw
 * 22003 surfacing as a 500. The owner read takes the plan-change owner
 * read's `FOR UPDATE` recipe so the headroom read and the relative credit
 * serialize against concurrent lane writes; a vanished owner row is left
 * to the settlement's zero-row contract (the identical conflict at write
 * time).
 */
async function assertRenewalCreditHeadroom(
  source: SubscriptionSelectType,
  plan: PlanSelectType,
  lane: SubscriptionCreditLane,
  scopedTx: DBTransaction,
  tErrors: ErrorsLabels
): Promise<void> {
  const owner = await StudentRepository.findByIdForUpdate(source.userId, scopedTx);
  if (owner === null) {
    return; // the settlement's zero-row contract denies identically at write time
  }
  if ((RENEWAL_LANE_BALANCE_READERS[lane](owner) ?? 0) > MAX_INT4 - plan.sessionCount) {
    logger.logDomainError("Subscription renew denied: the lane credit would overflow the balance column's int4 range", {
      code: "CONFLICT",
      entity: "subscriptions",
      entityId: source.id,
    });
    throw new ConflictError(tErrors.conflict);
  }
}

/**
 * The renewal's fresh-period insert and settlement live in the sibling
 * `subscription-admin-settle.helpers.ts` module (the shared builders both
 * admin flows delegate to, so the payment-column/junction semantics can
 * never drift); the service imports the flow-shaped delegates from there.
 *
 * The cancelled-status member, widened to a plain string: the same
 * read-row guard idiom as the service's active/expired twins — the
 * already-cancelled state is the guarded cancel's replay signature.
 */
const STATUS_CANCELLED: string = SubscriptionStatus.Cancelled;

/**
 * Hard bound for the optional cancel reason after trimming — the audit
 * trail's ONLY free-text field on this surface, so it is the one detail
 * that carries an explicit ceiling (ids, integers, and ISO date strings
 * dominate everywhere else).
 */
export const CANCEL_REASON_MAX_LENGTH = 200;

/**
 * Validates and normalizes the optional cancel reason: trimmed, bounded
 * (a longer submit is a caller bug → the localized validation reject), and
 * collapsed to `undefined` when nothing survives trimming — blank noise is
 * never minted into the trail. The reason NEVER enters a diagnostic log:
 * denials carry ids only.
 */
export function normalizeCancelReason(
  rawReason: string | undefined,
  subscriptionId: number,
  tErrors: ErrorsLabels
): string | undefined {
  const trimmed = rawReason?.trim();
  if (trimmed === undefined || trimmed.length === 0) {
    return undefined;
  }
  if (trimmed.length > CANCEL_REASON_MAX_LENGTH) {
    logger.logDomainError("Subscription cancel denied: reason exceeds the bounded length", {
      code: "VALIDATION",
      entity: "subscriptions",
      entityId: subscriptionId,
    });
    throw new ValidationError(tErrors.badRequest);
  }
  return trimmed;
}

/**
 * Resolves a zero-row guarded cancel to its precise denial. The fresh read
 * (the caller's executor observes whichever writer won the race) splits
 * the three zero-row meanings: a vanished row is the canonical not-found
 * denial, an already-cancelled row is the idempotent replay conflict (the
 * denied call wrote nothing — the first cancel did), and any other status
 * is the localized active-only deny. One bounded log each, ids only —
 * `flow` names the calling flow ("cancel", "plan change") so the
 * diagnostics name the actual flow and can never mislead an operator.
 */
export function resolveCancelDenial(
  subscriptionId: number,
  current: SubscriptionSelectType | null,
  tErrors: ErrorsLabels,
  flow: string
): never {
  if (current === null) {
    logger.logDomainError(`Subscription ${flow} denied: row does not exist`, {
      code: "NOT_FOUND",
      entity: "subscriptions",
      entityId: subscriptionId,
    });
    throw new NotFoundError("SUBSCRIPTION", tErrors.notFound);
  }
  if (current.status === STATUS_CANCELLED) {
    logger.logDomainError(`Subscription ${flow} denied: already cancelled (replay)`, {
      code: "CONFLICT",
      entity: "subscriptions",
      entityId: subscriptionId,
    });
    throw new ConflictError(tErrors.conflict);
  }
  logger.logDomainError(`Subscription ${flow} denied: row is not active`, {
    code: "CONFLICT",
    entity: "subscriptions",
    entityId: subscriptionId,
  });
  throw new ConflictError(tErrors.subscriptionAdmin.notActive);
}

/**
 * Composes the audit-log write contract for a subscription lifecycle
 * mutation. The `details` payload carries ids, integers, and ISO date
 * strings only (window bounds, day counts) — never contact-PII or
 * credentials.
 */
export function buildSubscriptionAuditContract(
  actorId: number,
  actionType: AuditActionType,
  entityId: number,
  details: Record<string, unknown>
): AuditLogWriteContract {
  return {
    actorId,
    actionType,
    entityType: SUBSCRIPTION_AUDIT_ENTITY_TYPE,
    entityId,
    details: JSON.stringify(details),
  };
}

/**
 * Coerces a wire `ID` into a subscription id using STRICT numeric parsing
 * (mirrors the plan-catalog id coercion). GraphQL preserves `ID` as a
 * string, and `Number()` lazily coerces non-decimal syntax ("1e0", "0x1",
 * " 1") into a valid integer — silently addressing a DIFFERENT row than
 * the one named on the wire — so a STRING is accepted only in canonical
 * decimal form (the `/^[1-9]\d*$/` gate the user-id twin applies), while
 * numeric input (direct service callers) keeps the strict `Number()`
 * parse. Any non-integer / non-positive result — and any canonical decimal
 * past the int4 id range (`MAX_INT4`; the column can never hold it) — maps
 * onto the canonical `SUBSCRIPTION_NOT_FOUND` domain error.
 */
export function coerceSubscriptionId(rawId: string | number, tErrors: ErrorsLabels): number {
  let id = Number.NaN;
  if (typeof rawId === "number") {
    id = rawId;
  } else if (/^[1-9]\d*$/.test(rawId)) {
    id = Number(rawId);
  }
  if (!Number.isInteger(id) || id < 1 || id > MAX_INT4) {
    logger.logDomainError("Subscription id failed strict numeric coercion", {
      code: "SUBSCRIPTION_NOT_FOUND",
      entity: "subscriptions",
    });
    throw new NotFoundError("SUBSCRIPTION", tErrors.notFound);
  }
  return id;
}

/**
 * The check-constraint (23514) leg — the fail-closed backstop of guarded
 * balance writes whose values are computed server-side: the lanes'
 * `balance_* >= 0` CHECK constraints trip only if a prepared value were
 * negative, which the flows' arithmetic never produces.
 */
const isPgCheckViolation = (error: unknown): boolean => hasPgCode(error, "23514");

/**
 * The integer-out-of-range (22003) leg — the lane-balance column's int4
 * ceiling reached through a write: the headroom pre-check's fail-closed
 * backstop, translated beside the other violation legs so a raw driver
 * error never surfaces as a 500.
 */
const isPgIntegerOutOfRange = (error: unknown): boolean => hasPgCode(error, "22003");

/**
 * The deadlock-detected (40P01) leg — two writers taking the same row
 * locks in opposite orders (a concurrent sweep × admin flow) abort one
 * side when PostgreSQL's deadlock detector fires. The aborted transaction
 * rolled back clean, so the caller resurfaces the localized conflict (a
 * retriable conflict, never a raw 40P01 surfacing as a 500).
 */
const isPgDeadlockDetected = (error: unknown): boolean => hasPgCode(error, "40P01");

/**
 * Maps PostgreSQL violations from subscription-admin writes onto their
 * canonical domain errors: uniqueness conflicts (the shared, cycle-safe
 * `23505` walker), balance CHECK violations (the cycle-safe `23514`
 * walker), integer-out-of-range writes (the cycle-safe `22003` walker
 * — the lane column's int4 ceiling), and deadlock-detected aborts (the
 * cycle-safe `40P01` walker — two writers taking the same row locks in
 * opposite orders; the aborted side may retry) become the localized
 * `ConflictError`. Any other failure is returned untouched so the caller
 * rethrows it verbatim.
 */
export function toSubscriptionAdminDomainError(error: unknown, tErrors: ErrorsLabels): unknown {
  if (
    isPgUniqueViolation(error) ||
    isPgCheckViolation(error) ||
    isPgIntegerOutOfRange(error) ||
    isPgDeadlockDetected(error)
  ) {
    return new ConflictError(tErrors.conflict, { cause: error });
  }
  return error;
}

/**
 * Pre-allocated lookup maps for fail-closed O(1) vocabulary resolution:
 * the stored row's status/payment columns are raw pg-enum string unions,
 * so the mappers resolve the member by the enum objects' own values — the
 * vocabulary still flows from the enums, never from bare literals.
 */
const SUBSCRIPTION_STATUS_MAP: ReadonlyMap<string, SubscriptionStatus> = new Map(
  Object.values(SubscriptionStatus).map(value => [value, value])
);
const PAYMENT_GATEWAY_MAP: ReadonlyMap<string, PaymentGateway> = new Map(
  Object.values(PaymentGateway).map(value => [value, value])
);
const SUBSCRIPTION_CREDIT_LANE_MAP: ReadonlyMap<string, SubscriptionCreditLane> = new Map(
  Object.values(SubscriptionCreditLane).map(value => [value, value])
);

/**
 * Fail-closed abort for a stored value outside a closed vocabulary — an
 * internal invariant breach (the DB pgEnum constrains every writable
 * value), never a caller-input matter. ONE correlated diagnostic log,
 * then the localized conflict copy; the caller's transaction rolls back.
 */
function abortRowMapping(detail: string, context: Record<string, unknown>, tErrors: ErrorsLabels): never {
  logger.error(`Subscription admin row mapping aborted: ${detail}`, context);
  throw new ConflictError(tErrors.conflict);
}

function subscriptionStatusMemberOf(
  status: SubscriptionSelectType["status"],
  tErrors: ErrorsLabels
): SubscriptionStatus {
  const member = SUBSCRIPTION_STATUS_MAP.get(status);
  if (member === undefined) {
    abortRowMapping(
      "stored subscription status is not a member of the closed status vocabulary",
      { storedStatus: status },
      tErrors
    );
  }
  return member;
}

/**
 * Resolves a stored plan `balance_lane` onto its canonical
 * `SubscriptionCreditLane` member — the same total, fail-closed lookup
 * as the status/gateway mappers (the renewal lane credit keys on it). An
 * unresolvable stored lane is an internal invariant breach (the pgEnum
 * constrains every writable value); ONE correlated diagnostic, then the
 * localized conflict copy — never a cast, never a guessed lane.
 */
export function subscriptionCreditLaneMemberOf(
  lane: PlanSelectType["balanceLane"] & string,
  tErrors: ErrorsLabels
): SubscriptionCreditLane {
  const member = SUBSCRIPTION_CREDIT_LANE_MAP.get(lane);
  if (member === undefined) {
    abortRowMapping(
      "stored plan balance lane is not a member of the closed credit-lane vocabulary",
      { storedLane: lane },
      tErrors
    );
  }
  return member;
}

function paymentGatewayMemberOf(
  gateway: SubscriptionSelectType["paymentMethod"] & string,
  tErrors: ErrorsLabels
): PaymentGateway {
  const member = PAYMENT_GATEWAY_MAP.get(gateway);
  if (member === undefined) {
    abortRowMapping(
      "stored payment gateway is not a member of the closed gateway vocabulary",
      { storedGateway: gateway },
      tErrors
    );
  }
  return member;
}

/**
 * Projects one stored subscription row onto the strongly-typed
 * ReturnType (`SubscriptionReturnType` re-types the status/payment
 * columns to their canonical TS enums — the mapping makes that enum
 * contract explicit, never a cast).
 */
export function toSubscriptionAdminReturnType(
  row: SubscriptionSelectType,
  tErrors: ErrorsLabels
): SubscriptionReturnType {
  return {
    ...row,
    status: subscriptionStatusMemberOf(row.status, tErrors),
    paymentMethod: row.paymentMethod === null ? null : paymentGatewayMemberOf(row.paymentMethod, tErrors),
  };
}
