import { groupDecimalDigits } from "@/shared/lib/group-decimal-digits";

/**
 * planPresentation — display helpers for the student plan catalog.
 *
 * Money rendering follows the wire discipline: the price arrives as an
 * exact decimal STRING and the amount is assembled by string manipulation
 * alone (the shared `groupDecimalDigits` helper) — never parsed to a
 * float, never re-rounded. The currency label stays verbatim from the
 * server value.
 */

/**
 * Formats one exact-decimal amount with its currency label
 * (`"1200.00"`, `"EGP"` → `"1,200.00 EGP"` in en / `"١,٢٠٠٫٠٠ EGP"`-shaped
 * digit localization in ar). The digits group through the shared
 * `groupDecimalDigits` helper — the fraction digits and any sign stay
 * verbatim from the wire value.
 */
export function formatPlanAmount(amount: string, currency: string, localizedLabel?: string): string {
  return `${groupDecimalDigits(amount)} ${localizedLabel ?? currency}`;
}
