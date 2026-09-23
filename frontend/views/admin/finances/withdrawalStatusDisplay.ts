/**
 * withdrawalStatusDisplay — the withdrawal / ledger status → tonal-lane +
 * localized-label mappings shared by the admin finance display projections
 * (`/admin/finances`): mapped lookups over the canonical capitalized
 * `TransactionStatus` wire values; any unknown wire value renders VERBATIM
 * (honest fallback — these are display projections, never lifecycle
 * authorities).
 */

import type { DirectoryTone } from "@/frontend/views/admin/users/utils";
import type { AdminFinanceLabels } from "@/shared/locale/types/adminFinance";

/**
 * Settlement / ledger status → tonal lane over the canonical capitalized
 * `TransactionStatus` wire values (Pending = warning, Completed = success,
 * Failed = error); unknown wire values fall to error.
 */
export function withdrawalStatusTone(status: string): DirectoryTone {
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
 * Localized withdrawal-status label — mapped lookup over the canonical
 * capitalized `TransactionStatus` wire values; any unknown wire value
 * renders VERBATIM.
 */
export function withdrawalStatusLabel(status: string, labels: AdminFinanceLabels): string {
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
