/**
 * Shared purchase-boundary guards — the identifier and idempotency-key
 * preconditions every purchase flow asserts at its pre-DB boundary.
 *
 * Both checks are behavior-critical and shared verbatim by every purchase
 * surface (the student subscription purchase and the teacher verification
 * purchase): one canonical copy lives here so the boundary semantics can
 * never drift between flows.
 *
 *  - `isPositiveSafeId` — a caller-supplied identifier must be a positive
 *    safe integer (no casts, no coercion) before it may reach any query.
 *  - `isCarryableIdempotencyKey` — a claimable idempotency key is present
 *    and within the claim column's length. An absent key is a validation
 *    reject BEFORE any database work (the claim insert would otherwise fail
 *    on a NOT NULL or an over-length value deep inside the transaction).
 *    The key is never trimmed — an opaque value is carried verbatim.
 *  - `assertNotReservedAdminClaimKey` — a client-supplied key is NEVER
 *    carried under the admin claim namespace's reserved prefix: the admin
 *    subscription flows mint their claim keys server-side under
 *    `subscription-admin:` (see `subscription-admin.helpers.ts`), and a
 *    client header squatting that prefix could pre-claim (and permanently
 *    block) the admin renew / plan-change flows for a targeted row.
 */

import { ValidationError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import { SUBSCRIPTION_ADMIN_CLAIM_KEY_PREFIX } from "@/backend/services/billing/subscription-admin.helpers";
import type { PlanSelectType } from "@/backend/types";
import type { getServerTranslations } from "@/shared/locale/server-graphql";

/** The errors-namespace bundle shape consumed by the localized denials. */
type ErrorsTranslations = ReturnType<typeof getServerTranslations>["errorsTranslations"];

/** The idempotency claim column's maximum key length (varchar(128) backstop). */
const MAX_IDEMPOTENCY_KEY_LENGTH = 128;
/** Positive safe-integer guard for caller-supplied identifiers (no casts). */
export function isPositiveSafeId(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

/**
 * The carryable-key check: a claimable idempotency key is present and
 * within the claim column's length. An absent key is a validation reject
 * BEFORE any database work (the claim insert would otherwise fail on a
 * NOT NULL or an over-length value deep inside the transaction). The key
 * is never trimmed — an opaque value is carried verbatim.
 */
export function isCarryableIdempotencyKey(key: string | null): key is string {
  return key !== null && key.length > 0 && key.length <= MAX_IDEMPOTENCY_KEY_LENGTH;
}

/**
 * Reserves the admin claim namespace at the purchase ingestion boundary:
 * a client-supplied key under the reserved `subscription-admin:` prefix is
 * rejected BEFORE any database work. The shared claim store is
 * global-unique across the purchase and admin surfaces, so an unreserved
 * client key shaped like a predictable admin claim (`renew:<id>`,
 * `planChange:<id>:<planId>`) could be pre-claimed by a student and
 * permanently block the admin renew / plan-change flows for that row —
 * the admin flows therefore mint their keys under the reserved prefix and
 * this guard refuses to carry any client key inside it.
 *
 * One canonical copy shared verbatim by every purchase surface (the
 * student subscription purchase and the teacher verification purchase):
 * `flowLabel` names the calling surface in the correlated domain log line.
 * The rejection follows this file's localized validation pattern (the
 * `assertPlanUnchangedSinceCheckout` shape): the generic localized
 * validation message plus a property-mapped `{field, code, message}`
 * payload naming the header — ids only in the log, never the key itself.
 */
export function assertNotReservedAdminClaimKey(
  flowLabel: string,
  key: string,
  callerUserId: number,
  t: ErrorsTranslations
): void {
  if (!key.startsWith(`${SUBSCRIPTION_ADMIN_CLAIM_KEY_PREFIX}:`)) {
    return;
  }
  logger.logDomainError(`${flowLabel} rejected: idempotency key uses the reserved admin claim namespace`, {
    code: "VALIDATION",
    entity: "users",
    entityId: callerUserId,
  });
  throw new ValidationError(t.validation, [
    { field: "idempotencyKey", code: "RESERVED_ADMIN_IDEMPOTENCY_KEY", message: t.validation },
  ]);
}

/**
 * Re-compares the FRESH in-transaction plan row against the price/currency
 * the gateway checkout was created with (both carried verbatim from the
 * pre-checkout plan read). An admin price or currency change between the
 * checkout creation and the purchase transaction would otherwise commit a
 * pending pair whose stored amount disagrees with the amount the provider
 * actually charged — a settlement guaranteed to quarantine. The mismatch is
 * the generic localized validation denial (machine code
 * `PLAN_PRICE_CHANGED`, field `planId`) thrown BEFORE any row write, so
 * the transaction rolls back with nothing to release.
 *
 * One canonical copy shared verbatim by every checkout-priced purchase
 * flow (the student subscription purchase and the teacher verification
 * purchase): `flowLabel` names the calling surface in the correlated
 * domain log line ("Subscription purchase" / "Verification purchase").
 *
 * The abandoned checkout session needs no compensation inside the calling
 * flow: the built-in mock provider is stateless (a checkout is a pure
 * descriptor mint — no provider-side session exists to void). A stateful
 * provider integration owns its own abandoned-session compensation
 * out-of-band.
 */
export function assertPlanUnchangedSinceCheckout(
  flowLabel: string,
  freshPlan: PlanSelectType,
  checkoutAmount: string,
  checkoutCurrency: string,
  t: ErrorsTranslations
): void {
  if (freshPlan.price === checkoutAmount && freshPlan.currency === checkoutCurrency) {
    return;
  }
  logger.logDomainError(`${flowLabel} rejected: plan price or currency changed during checkout`, {
    code: "PLAN_PRICE_CHANGED",
    entity: "plans",
    entityId: freshPlan.id,
  });
  throw new ValidationError(t.validation, [{ field: "planId", code: "PLAN_PRICE_CHANGED", message: t.validation }]);
}
