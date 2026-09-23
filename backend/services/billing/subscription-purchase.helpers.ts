/**
 * Subscription-purchase checkout-input helpers — the derivations that
 * bridge the purchase flow's server-owned reads and the gateway port:
 * the fail-closed purchaser load (the billing identity's source row) and
 * the provider-facing billing projection derived from it. Kept beside the
 * flow in its own module per the service-layer split convention.
 */

import { UserRepository } from "@/backend/db/repo";
import { ForbiddenError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import type { DBTransaction, PaymentCheckoutInput, UserSelectType } from "@/backend/types";
import type { getServerTranslations } from "@/shared/locale/server-graphql";

/** The localized errors bundle shape consumed by the purchase flows. */
type ErrorsTranslations = ReturnType<typeof getServerTranslations>["errorsTranslations"];

/**
 * Loads the acting student's user row and derives the checkout billing
 * identity from it — the recorded name, email, and phone, server-side
 * only. The read rides the caller's transaction when `outerTx` is
 * supplied (the same shape as the plan lookup); the purchase flow's
 * governance assert already failed closed on a vanished caller, and
 * re-narrowing here keeps the row read honest instead of trusting a
 * race-free world.
 */
export async function buildCheckoutBillingInput(
  studentUserId: number,
  t: ErrorsTranslations,
  tx?: DBTransaction
): Promise<PaymentCheckoutInput["billing"]> {
  const purchaser = await UserRepository.findById(studentUserId, tx);
  if (purchaser === null) {
    logger.logDomainError("Subscription purchase rejected: purchaser record vanished before checkout", {
      code: "FORBIDDEN",
      entity: "users",
      entityId: studentUserId,
    });
    throw new ForbiddenError(t.forbidden);
  }
  return billingFromUserRow(purchaser);
}

/**
 * Projects the user row onto the port's billing identity. The users table
 * keeps a single `full_name` column, so the first whitespace-separated
 * token is the given name and the remainder is the family name (empty
 * when the record holds a single-token name); the recorded phone rides as
 * null when absent — inventing placeholder values here would put fake
 * contact data into the purchase record, and the provider boundary owns
 * any vendor-required placeholder policy.
 */
function billingFromUserRow(user: UserSelectType): PaymentCheckoutInput["billing"] {
  const fullName = user.fullName.trim();
  const givenNameEnd = fullName.search(/\s/);
  const firstName = givenNameEnd === -1 ? fullName : fullName.slice(0, givenNameEnd);
  const lastName = givenNameEnd === -1 ? "" : fullName.slice(givenNameEnd).trim();
  return { firstName, lastName, email: user.email, phone: user.phone };
}
