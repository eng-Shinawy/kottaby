/**
 * paymentStatusDisplay — the payment lifecycle → tonal-lane +
 * localized-label mappings of the payments audit display projection
 * (`/admin/finances`, payments tab): mapped lookups over the canonical
 * capitalized `PaymentStatus` / `PaymentGateway` wire values; unknown wire
 * values fall to neutral / render VERBATIM (honest fallback — the audit
 * table is a display projection, never a lifecycle authority).
 */

import type { DirectoryTone } from "@/frontend/views/admin/users/utils";
import type { AdminFinanceLabels } from "@/shared/locale/types/adminFinance";

/**
 * Payment lifecycle → tonal lane over the canonical capitalized
 * `PaymentStatus` wire values (Paid = success, Pending = warning,
 * Failed = error, Refunded = neutral); unknown wire values fall to neutral.
 */
export function paymentStatusTone(status: string): DirectoryTone {
  switch (status) {
    case "Paid":
      return "success";
    case "Pending":
      return "warning";
    case "Failed":
      return "error";
    case "Refunded":
      return "neutral";
    default:
      return "neutral";
  }
}

/**
 * Localized payment-status label — mapped lookup over the four canonical
 * `PaymentStatus` wire values; any unknown wire value renders VERBATIM.
 */
export function paymentStatusLabel(status: string, labels: AdminFinanceLabels): string {
  switch (status) {
    case "Paid":
      return labels.statusPaid;
    case "Pending":
      return labels.statusPending;
    case "Failed":
      return labels.statusFailed;
    case "Refunded":
      return labels.statusRefunded;
    default:
      return status;
  }
}

/**
 * Localized payment-gateway label — mapped lookup over the canonical
 * `PaymentGateway` wire values; any unknown wire value renders VERBATIM.
 */
export function paymentGatewayLabel(gateway: string, labels: AdminFinanceLabels): string {
  switch (gateway) {
    case "Stripe":
      return labels.gatewayStripe;
    case "Paypal":
      return labels.gatewayPaypal;
    case "Paymob":
      return labels.gatewayPaymob;
    case "Fawry":
      return labels.gatewayFawry;
    case "OfflineCash":
      return labels.gatewayOfflineCash;
    case "BankTransfer":
      return labels.gatewayBankTransfer;
    case "Scholarship":
      return labels.gatewayScholarship;
    case "Mock":
      return labels.gatewayMock;
    case "Other":
      return labels.gatewayOther;
    default:
      return gateway;
  }
}
