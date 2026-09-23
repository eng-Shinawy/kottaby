/**
 * PlanCatalog helpers — pure validation, write-error translation, and
 * audit-contract composition for the plan-catalog service (field-by-field
 * input validation, patch projection, and the plan audit-log write
 * contract).
 *
 * Extracted from `plan-catalog.service.ts` to keep the service namespace
 * focused on orchestration; consumed directly by the service via the
 * sibling path (mirroring `user-management.helpers.ts` — helpers stay out
 * of the domain barrel because they are service-internal).
 *
 * Every validator follows the same contract: an absent field (`undefined`)
 * skips validation, a valid value is returned in `value`, and an invalid
 * value is returned as an `ApiFieldErrorType` the caller aggregates into a
 * single localized `ValidationError`. No I/O happens here — the service owns
 * orchestration, persistence, and logging.
 *
 * Disciplines enforced here:
 *  - BOPLA: patch projection is field-by-field (never a spread of transport
 *    input) so server-controlled fields are structurally absent from the
 *    write payload.
 *  - Audit contract: `details` carries plan field names + primitive values
 *    only — never contact-PII, never credentials.
 */

import type { AuditActionType } from "@/backend/enum/audit/audit-action-type.enum";
import { SubscriptionCreditLane } from "@/backend/enum/billing/subscription-credit-lane.enum";
import { ConflictError, isPgUniqueViolation, ValidationError } from "@/backend/lib/errors";
import type { ApiFieldErrorType, AuditLogWriteContract, PlanSubmitInput, PlanUpdateInput } from "@/backend/types";
import type { ErrorsLabels } from "@/shared/locale/types/errors";

const PRICE_REGEX = /^\d{1,8}(\.\d{1,2})?$/;
const CURRENCY_REGEX = /^[A-Z]{3}$/;

/**
 * Upper bound on a plan's billing interval (ten years). The activation window
 * arithmetic multiplies this field into Date milliseconds, so an unbounded
 * value would poison every confirmed delivery that reads the plan — the
 * catalog rejects anything beyond the ceiling before it can be persisted.
 *
 * Shared with the activation service (same billing layer): the ceiling is
 * re-guarded at the activation boundary because legacy/non-catalog rows can
 * carry values past it (the DB check only enforces `> 0`) — see
 * `subscription-activation.service.ts`.
 */
export const MAX_INTERVAL_DAYS = 3650;

/**
 * Upper bound on a plan's session count (one million). The activation credit
 * adds the full `sessionCount` onto the lane's integer balance column, so an
 * unbounded value would overflow int4 at the credit step (a raw driver
 * failure mid-activation, after the subscription and payment writes) — the
 * catalog rejects anything beyond the ceiling before it can be persisted.
 *
 * Shared with the activation service (same billing layer): like
 * `MAX_INTERVAL_DAYS`, the ceiling is re-guarded at the activation boundary
 * because legacy/non-catalog rows can carry values past it (the DB check
 * only enforces `> 0`) — see `subscription-activation.service.ts`.
 */
export const MAX_SESSION_COUNT = 1_000_000;

/** Runtime membership probe over the lane vocabulary (mirrors the `subscription_credit_lane` pgEnum). */
const SUBSCRIPTION_CREDIT_LANE_VALUES: readonly string[] = Object.values(SubscriptionCreditLane);

/**
 * The check-constraint (23514) leg of the plan-write translation — walks the
 * thrown value's `Error.cause` chain (Drizzle wraps the driver error, so the
 * code lives on a cause) with a cycle-safe visited set (a self-referential
 * chain must terminate, not spin). The UNIQUE-violation (23505) leg is NOT
 * reimplemented here — it delegates to the shared, cycle-safe
 * `isPgUniqueViolation` from `@/backend/lib/errors` so every service-layer
 * `23505` translation walks the identical code path.
 */
function isPgCheckViolation(error: unknown): boolean {
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    if ("code" in current && current.code === "23514") {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Maps PostgreSQL violations from plan writes onto their canonical domain
 * errors: uniqueness conflicts (the shared `23505` walker) become
 * `ConflictError`, check-constraint failures (the local `23514` walker)
 * become `ValidationError`. Any other failure is returned untouched so the
 * caller rethrows it verbatim.
 */
export function toPlanWriteDomainError(error: unknown, tErrors: ErrorsLabels): unknown {
  if (isPgUniqueViolation(error)) {
    return new ConflictError(tErrors.conflict, { cause: error });
  }
  if (isPgCheckViolation(error)) {
    return new ValidationError("VALIDATION", tErrors.validation, { cause: error });
  }
  return error;
}

/**
 * The `entity_type` label minted into every plan-catalog audit row.
 */
export const PLAN_AUDIT_ENTITY_TYPE = "plan";

/**
 * Composes the audit-log write contract for a plan create / update /
 * status transition. The `details` payload carries plan field names and
 * primitive values only (title, counts, price, currency, flags) — never
 * contact-PII or credentials. The composed row is persisted by
 * `AuditService.createAuditLog` inside the caller's transaction so it can
 * never outlive a rolled-back mutation.
 */
export function buildPlanAuditContract(
  actorId: number,
  actionType: AuditActionType,
  entityId: number,
  details: Record<string, unknown>
): AuditLogWriteContract {
  return {
    actorId,
    actionType,
    entityType: PLAN_AUDIT_ENTITY_TYPE,
    entityId,
    details: JSON.stringify(details),
  };
}

function validateTitleField(
  title: string | undefined,
  tErrors: ErrorsLabels
): { value?: string; error?: ApiFieldErrorType } {
  if (title === undefined) return {};
  const trimmed = title.trim();
  if (trimmed.length === 0) {
    return {
      error: {
        field: "title",
        code: "PLAN_TITLE_EMPTY",
        message: tErrors.planCatalog.planTitleRequired,
      },
    };
  }
  if (trimmed.length > 255) {
    return {
      error: {
        field: "title",
        code: "PLAN_TITLE_TOO_LONG",
        message: tErrors.planCatalog.planTitleTooLong,
      },
    };
  }
  return { value: trimmed };
}

function validateSessionCountField(
  count: number | undefined,
  tErrors: ErrorsLabels
): { value?: number; error?: ApiFieldErrorType } {
  if (count === undefined) return {};
  if (!Number.isInteger(count) || count < 1) {
    return {
      error: {
        field: "sessionCount",
        code: "PLAN_SESSION_COUNT_INVALID",
        message: tErrors.planCatalog.planSessionCountInvalid,
      },
    };
  }
  // The credit ceiling — same shape as the intervalDays ceiling below: the
  // activation credit adds this value onto the lane's int4 balance, so an
  // over-ceiling plan must never be persisted (generic validation label —
  // the machine code carries the diagnosis).
  if (count > MAX_SESSION_COUNT) {
    return {
      error: {
        field: "sessionCount",
        code: "PLAN_SESSION_COUNT_OUT_OF_RANGE",
        message: tErrors.validation,
      },
    };
  }
  return { value: count };
}

function validatePriceField(
  price: string | undefined,
  tErrors: ErrorsLabels
): { value?: string; error?: ApiFieldErrorType } {
  if (price === undefined) return {};
  const trimmed = price.trim();
  if (!PRICE_REGEX.test(trimmed) || Number.parseFloat(trimmed) < 0) {
    return {
      error: {
        field: "price",
        code: "PLAN_PRICE_INVALID",
        message: tErrors.planCatalog.planPriceInvalid,
      },
    };
  }
  return { value: trimmed };
}

function validateCurrencyField(
  currency: string | undefined,
  tErrors: ErrorsLabels
): { value?: string; error?: ApiFieldErrorType } {
  if (currency === undefined) return {};
  const trimmed = currency.trim();
  if (!CURRENCY_REGEX.test(trimmed)) {
    return {
      error: {
        field: "currency",
        code: "PLAN_CURRENCY_INVALID",
        message: tErrors.planCatalog.planCurrencyInvalid,
      },
    };
  }
  return { value: trimmed.toUpperCase() };
}

function validateIntervalDaysField(
  days: number | undefined,
  tErrors: ErrorsLabels
): { value?: number; error?: ApiFieldErrorType } {
  if (days === undefined) return {};
  if (!Number.isInteger(days) || days < 1) {
    return {
      error: {
        field: "intervalDays",
        code: "PLAN_INTERVAL_DAYS_INVALID",
        message: tErrors.planCatalog.planIntervalDaysInvalid,
      },
    };
  }
  if (days > MAX_INTERVAL_DAYS) {
    return {
      error: {
        field: "intervalDays",
        code: "PLAN_INTERVAL_DAYS_OUT_OF_RANGE",
        message: tErrors.validation,
      },
    };
  }
  return { value: days };
}

/**
 * Validates the plan's balance lane: only a `SubscriptionCreditLane` member or
 * an explicit `null` (clearing the lane) is accepted. An absent field
 * (`undefined`) skips validation entirely. Any other value — e.g. an unknown
 * string smuggled in by a non-GraphQL caller, which the GraphQL enum coercion
 * would otherwise block — is rejected so an unroutable lane can never be
 * persisted: activation crediting resolves a balance column from this value,
 * and an unknown lane would credit nothing.
 */
function validateBalanceLaneField(
  lane: SubscriptionCreditLane | null | undefined,
  tErrors: ErrorsLabels
): { value?: SubscriptionCreditLane | null; error?: ApiFieldErrorType } {
  if (lane === undefined) return {};
  if (lane === null) return { value: null };
  if (!SUBSCRIPTION_CREDIT_LANE_VALUES.includes(lane)) {
    return {
      error: {
        field: "balanceLane",
        code: "PLAN_BALANCE_LANE_INVALID",
        message: tErrors.validation,
      },
    };
  }
  return { value: lane };
}

/**
 * Validates plan submit/create input fields.
 */
export function validatePlanInput(input: PlanSubmitInput, tErrors: ErrorsLabels): void {
  const fields: ApiFieldErrorType[] = [];

  const titleResult = validateTitleField(input.title, tErrors);
  if (titleResult.error) fields.push(titleResult.error);

  const sessionResult = validateSessionCountField(input.sessionCount, tErrors);
  if (sessionResult.error) fields.push(sessionResult.error);

  const priceResult = validatePriceField(input.price, tErrors);
  if (priceResult.error) fields.push(priceResult.error);

  const currencyResult = validateCurrencyField(input.currency, tErrors);
  if (currencyResult.error) fields.push(currencyResult.error);

  const intervalResult = validateIntervalDaysField(input.intervalDays, tErrors);
  if (intervalResult.error) fields.push(intervalResult.error);

  const laneResult = validateBalanceLaneField(input.balanceLane, tErrors);
  if (laneResult.error) fields.push(laneResult.error);

  if (fields.length > 0) {
    throw new ValidationError(tErrors.validation, fields);
  }
}

interface ValidatedPatchResult {
  updatePatch: PlanUpdateInput;
  fields: ApiFieldErrorType[];
}

/**
 * Validates and projects supplied patch fields for updating a plan.
 */
export function validateAndExtractPlanPatch(patch: PlanUpdateInput, tErrors: ErrorsLabels): ValidatedPatchResult {
  const fields: ApiFieldErrorType[] = [];

  const titleResult = validateTitleField(patch.title, tErrors);
  if (titleResult.error) fields.push(titleResult.error);

  const sessionResult = validateSessionCountField(patch.sessionCount, tErrors);
  if (sessionResult.error) fields.push(sessionResult.error);

  const priceResult = validatePriceField(patch.price, tErrors);
  if (priceResult.error) fields.push(priceResult.error);

  const currencyResult = validateCurrencyField(patch.currency, tErrors);
  if (currencyResult.error) fields.push(currencyResult.error);

  const intervalResult = validateIntervalDaysField(patch.intervalDays, tErrors);
  if (intervalResult.error) fields.push(intervalResult.error);

  const laneResult = validateBalanceLaneField(patch.balanceLane, tErrors);
  if (laneResult.error) fields.push(laneResult.error);

  const updatePatch: PlanUpdateInput = {
    ...(titleResult.value !== undefined && { title: titleResult.value }),
    ...(sessionResult.value !== undefined && { sessionCount: sessionResult.value }),
    ...(priceResult.value !== undefined && { price: priceResult.value }),
    ...(currencyResult.value !== undefined && { currency: currencyResult.value }),
    ...(intervalResult.value !== undefined && { intervalDays: intervalResult.value }),
    // An explicit null projects into the patch so the stored lane is cleared;
    // an absent field stays out of the patch and leaves the lane untouched.
    ...(laneResult.value !== undefined && { balanceLane: laneResult.value }),
  };

  return { updatePatch, fields };
}
