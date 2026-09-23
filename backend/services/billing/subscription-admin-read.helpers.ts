/**
 * SubscriptionAdmin read-surface helpers — the admin list flow's shared
 * runtime pieces (the sibling-helpers split keeps the service namespace
 * and the write-flow helpers file within their line budgets).
 *
 * Runtime only — no types are declared here; every shape lives in
 * `backend/types/` and is imported through `@/backend/types`.
 */

import { ValidationError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import { MAX_INT4 } from "@/backend/services/billing/subscription-admin.helpers";
import type { ErrorsLabels } from "@/shared/locale/types/errors";

/**
 * Coerces a wire `ID` into a STUDENT-OWNER user id for the admin read
 * surface (`adminStudentSubscriptions`). The strictness goes one notch
 * beyond the subscription-id twin: GraphQL preserves `ID` as a string,
 * and `Number()` lazily coerces non-decimal syntax ("1e0", "0x1", " 1")
 * into a valid integer — silently addressing a DIFFERENT owner than the
 * one named on the wire — so a string is accepted only in canonical
 * decimal form (the resolver-guard module's documented wire-id
 * discipline), while numeric input (direct service callers) must already
 * be a positive safe integer inside the int4 id range (`MAX_INT4` — the
 * column can never hold a larger value). Any malformed value maps onto the
 * canonical localized VALIDATION denial — never a silent mis-target, never
 * a 500.
 */
export function coerceUserId(rawId: string | number, tErrors: ErrorsLabels): number {
  let id: number;
  if (typeof rawId === "number") {
    id = rawId;
  } else if (/^[1-9]\d*$/.test(rawId)) {
    id = Number(rawId);
  } else {
    id = Number.NaN;
  }
  if (!Number.isSafeInteger(id) || id < 1 || id > MAX_INT4) {
    logger.logDomainError("Subscription admin list denied: user id failed strict numeric coercion", {
      code: "VALIDATION",
      entity: "user",
    });
    throw new ValidationError(tErrors.badRequest);
  }
  return id;
}
