/**
 * SubscriptionAdmin proration helpers — the exact plan-change carry
 * arithmetic and its direction derivation.
 *
 * Split into a dedicated module (the sibling `subscription-admin.helpers.ts`
 * file convention) because the plan-change flow is arithmetic-heavy: every
 * computation here runs in EXACT BigInt minor units over the plans'
 * `decimal(10,2)` price strings — never a binary float, never a percent
 * estimate. A price string that is not the canonical two-decimal form
 * (e.g. `"200.00"`) is a caller-contract breach and rejects with the
 * localized validation error before any arithmetic can silently drift.
 *
 * Direction semantics (per the admin plan-change design):
 *  - the unit value of a plan is `price / sessionCount` (minor units kept
 *    as an exact BigInt ratio — the comparison cross-multiplies, never
 *    divides);
 *  - a target plan with a STRICTLY greater unit value is an UPGRADE, a
 *    strictly smaller one a DOWNGRADE;
 *  - a unit-value TIE breaks on session count (at least as many sessions
 *    → upgrade, fewer → downgrade) — a same-shape plan swap is the
 *    value-neutral upgrade whose carry formula reproduces the remainder
 *    exactly;
 *  - an UPGRADE carries `floor(remaining × priceOld × scNew /
 *    (scOld × priceNew))` sessions on top of the target plan's full
 *    session count, clamped to the catalog's session ceiling;
 *  - a DOWNGRADE forfeits: the credit is the target plan's session count
 *    only, and the discarded remainder is reported as `forfeitedSessions`.
 *
 * Runtime only — no types are declared here; every shape lives in
 * `backend/types/` and is imported through `@/backend/types`.
 */

import { ProrationDirection } from "@/backend/enum/billing/proration-direction.enum";
import { ValidationError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import { MAX_INTERVAL_DAYS, MAX_SESSION_COUNT } from "@/backend/services/billing/plan-catalog.helpers";
import type { PlanSelectType, ProrationComputation } from "@/backend/types";
import type { ErrorsLabels } from "@/shared/locale/types/errors";

/**
 * The canonical `decimal(10,2)` wire/storage form: one to eight whole
 * digits plus EXACTLY two decimals. Anything else (a bare integer, a
 * single-decimal short form, a signed or malformed value) cannot be
 * interpreted without guessing scale, so it rejects instead.
 */
const PLAN_PRICE_CANONICAL = /^\d{1,8}\.\d{2}$/;

/**
 * Parses a plan's price string into EXACT minor units (BigInt). A
 * non-canonical decimal is a validation reject — the caller's transaction
 * rolls back with nothing written, and no float coercion ever touches the
 * value.
 */
function parsePlanPriceMinor(plan: PlanSelectType, tErrors: ErrorsLabels): bigint {
  if (!PLAN_PRICE_CANONICAL.test(plan.price)) {
    logger.logDomainError("Plan change denied: plan price is not a canonical decimal string", {
      code: "VALIDATION",
      entity: "plans",
      entityId: plan.id,
    });
    throw new ValidationError(tErrors.badRequest);
  }
  const [whole, decimals] = plan.price.split(".");
  return BigInt(whole) * 100n + BigInt(decimals);
}

/**
 * Rejects a zero price (the unit value would be undefined — the carry
 * formula would divide by zero) and a non-positive session count before
 * either can reach the arithmetic.
 */
function rejectDegeneratePlan(plan: PlanSelectType, priceMinor: bigint, tErrors: ErrorsLabels): void {
  if (priceMinor === 0n || plan.sessionCount < 1) {
    logger.logDomainError("Plan change denied: plan price or session count cannot define a unit value", {
      code: "VALIDATION",
      entity: "plans",
      entityId: plan.id,
    });
    throw new ValidationError(tErrors.badRequest);
  }
}

/**
 * Compares the two plans' per-session unit values through EXACT BigInt
 * cross-multiplication (`priceOld × scNew` vs `priceNew × scOld` — never
 * a division), breaking a unit-value tie on the session-count comparison.
 */
function comparePlanUnitValues(
  priceMinorOld: bigint,
  sessionCountOld: number,
  priceMinorNew: bigint,
  sessionCountNew: number
): ProrationDirection {
  const oldUnitTimesNewCount = priceMinorOld * BigInt(sessionCountNew);
  const newUnitTimesOldCount = priceMinorNew * BigInt(sessionCountOld);
  if (newUnitTimesOldCount > oldUnitTimesNewCount) {
    return ProrationDirection.Upgrade;
  }
  if (newUnitTimesOldCount < oldUnitTimesNewCount) {
    return ProrationDirection.Downgrade;
  }
  // Unit-value tie — the session-count comparison breaks it. At least as
  // many sessions reads as the upgrade leg (an equal-shape swap carries
  // the remainder exactly); strictly fewer sessions is the downgrade.
  return sessionCountNew >= sessionCountOld ? ProrationDirection.Upgrade : ProrationDirection.Downgrade;
}

/**
 * Derives the plan-change direction from the two plan rows alone (the
 * replay path re-derives it after the original computation's remainder is
 * gone). Parses both price strings through the canonical-form guard, so a
 * corrupt stored price denies instead of comparing garbage.
 */
export function prorationDirectionOf(
  oldPlan: PlanSelectType,
  newPlan: PlanSelectType,
  tErrors: ErrorsLabels
): ProrationDirection {
  return comparePlanUnitValues(
    parsePlanPriceMinor(oldPlan, tErrors),
    oldPlan.sessionCount,
    parsePlanPriceMinor(newPlan, tErrors),
    newPlan.sessionCount
  );
}

/**
 * Computes the exact proration for a plan change.
 *
 * Guards run before any arithmetic: both prices must be canonical
 * decimal strings, both plans must define a positive unit value, and the
 * target plan's interval must sit inside the catalog's interval ceiling
 * (the change opens a fresh one-interval window — a legacy row past the
 * ceiling rejects with the localized overflow copy). On the upgrade leg
 * the carry is the floored exact-BigInt ratio clamped to the catalog's
 * session ceiling; on the downgrade leg the remainder is forfeited and
 * reported as `forfeitedSessions`.
 */
export function computeProration(
  input: { remainingSessions: number; oldPlan: PlanSelectType; newPlan: PlanSelectType },
  tErrors: ErrorsLabels
): ProrationComputation {
  const priceMinorOld = parsePlanPriceMinor(input.oldPlan, tErrors);
  const priceMinorNew = parsePlanPriceMinor(input.newPlan, tErrors);
  rejectDegeneratePlan(input.oldPlan, priceMinorOld, tErrors);
  rejectDegeneratePlan(input.newPlan, priceMinorNew, tErrors);
  if (input.newPlan.intervalDays > MAX_INTERVAL_DAYS) {
    logger.logDomainError("Plan change denied: resulting window exceeds the interval ceiling", {
      code: "VALIDATION",
      entity: "plans",
      entityId: input.newPlan.id,
    });
    throw new ValidationError(tErrors.subscriptionAdmin.prorationOverflow);
  }

  const direction = comparePlanUnitValues(
    priceMinorOld,
    input.oldPlan.sessionCount,
    priceMinorNew,
    input.newPlan.sessionCount
  );
  if (direction === ProrationDirection.Downgrade) {
    return {
      direction,
      carrySessions: 0,
      forfeitedSessions: input.remainingSessions,
    };
  }

  const numerator = BigInt(input.remainingSessions) * priceMinorOld * BigInt(input.newPlan.sessionCount);
  const denominator = BigInt(input.oldPlan.sessionCount) * priceMinorNew;
  const carryRaw = numerator / denominator;
  const carryLimit = BigInt(MAX_SESSION_COUNT);
  const carrySessions = Number(carryRaw > carryLimit ? carryLimit : carryRaw);
  return {
    direction,
    carrySessions,
    forfeitedSessions: 0,
  };
}
