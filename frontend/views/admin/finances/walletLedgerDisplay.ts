/**
 * walletLedgerDisplay — the ledger entry type/status → tonal-lane +
 * localized-label mappings of the admin wallet inspector's transaction
 * ledger (`/admin/finances`, wallet tab): mapped lookups over the
 * canonical capitalized `TransactionType` / `TransactionStatus` wire
 * values; unknown wire values render VERBATIM (honest fallback — the
 * ledger is a display projection, never a lifecycle authority).
 */

import type { DirectoryTone } from "@/frontend/views/admin/users/utils";
import type { AdminFinanceLabels } from "@/shared/locale/types/adminFinance";

/**
 * Ledger entry type → tonal lane over the canonical capitalized
 * `TransactionType` wire values (Withdrawal = secondary copper, Bonus =
 * neutral surface pair, Earning = primary blue) — lanes chosen to stay
 * DISTINCT from the status lanes (success/warning/error) and from each
 * other; unknown wire values fall to primary.
 */
export function ledgerTypeTone(type: string): DirectoryTone {
  switch (type) {
    case "Withdrawal":
      return "secondary";
    case "Bonus":
      return "neutral";
    case "Earning":
      return "primary";
    default:
      return "primary";
  }
}

/**
 * Localized ledger entry-type label — mapped lookup over the canonical
 * capitalized `TransactionType` wire values; any unknown wire value
 * renders VERBATIM.
 */
export function ledgerTypeLabel(type: string, labels: AdminFinanceLabels): string {
  switch (type) {
    case "Earning":
      return labels.typeEarning;
    case "Bonus":
      return labels.typeBonus;
    case "Withdrawal":
      return labels.typeWithdrawal;
    default:
      return type;
  }
}

/**
 * Ledger entry status → tonal lane over the canonical capitalized
 * `TransactionStatus` wire values (Pending = warning, Completed = success,
 * Failed = error); unknown wire values fall to error.
 */
export function ledgerStatusTone(status: string): DirectoryTone {
  switch (status) {
    case "Pending":
      return "warning";
    case "Completed":
      return "success";
    case "Failed":
      return "error";
    default:
      return "error";
  }
}

/**
 * Localized ledger entry-status label — mapped lookup over the canonical
 * capitalized `TransactionStatus` wire values; any unknown wire value
 * renders VERBATIM.
 */
export function ledgerStatusLabel(status: string, labels: AdminFinanceLabels): string {
  switch (status) {
    case "Pending":
      return labels.statusPending;
    case "Completed":
      return labels.statusCompleted;
    case "Failed":
      return labels.statusFailed;
    default:
      return status;
  }
}
