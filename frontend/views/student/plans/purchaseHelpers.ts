/**
 * purchaseHelpers — shared constants + the idempotency-key minter for the
 * student plan-catalog view (the view-flat helpers module convention).
 */

/** Snackbar autohide — parity with the sessions/wallet containers. */
export const PLAN_CATALOG_SNACKBAR_AUTOHIDE_MS = 4000;

/** Fresh purchase-attempt idempotency key (UUID v4, transport-header carrier). */
export function randomUUID(): string {
  return crypto.randomUUID();
}
