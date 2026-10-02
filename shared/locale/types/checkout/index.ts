/**
 * Checkout namespace labels — the student subscription-purchase funnel:
 * the plan catalog, the purchase confirmation dialog, the payment result
 * page, and the my-subscriptions list.
 *
 * Used by:
 *  - `frontend/views/student/plans/` (catalog + confirm dialog) via
 *    `useAppTranslation(Checkout)` with property access.
 *  - `frontend/views/student/checkout/result/` (payment result branches).
 *  - `frontend/views/student/subscriptions/` (list + status chips).
 *  - Server Components rendering the funnel pages via
 *    `await getTranslations(locale)` → property access.
 *
 * All keys MUST have both `en` and `ar` implementations with EXACT key-set
 * parity (compile-typed on both leaves + `checkout-namespace.parity.test.ts`
 * runtime belt). Property access only — never call-by-key.
 *
 * Transport-error copy lives in the `errors` namespace (including its
 * `subscriptionPurchase` section) — this namespace owns funnel copy only.
 */
export interface CheckoutLabels {
  // ── Plan catalog ────────────────────────────────────────────────────────
  /** Catalog page <title>/header. */
  readonly pageTitle: string;
  /** Catalog page subtitle under the header. */
  readonly pageSubtitle: string;
  /** Localized page metadata — catalog route <title>. */
  readonly metaTitle: string;
  /** Localized page metadata — catalog route meta description. */
  readonly metaDescription: string;
  /** Per-plan purchase CTA on every catalog card. */
  readonly buyButton: string;
  /** Plan card feature line — the number of lesson sessions included (ICU {count}). */
  readonly sessionsIncludedLine: (count: number) => string;
  /** Plan card feature line — the validity window in days (ICU {days}). */
  readonly validityLine: (days: number) => string;
  /**
   * Plan card derived-price line — the bundle price divided by the included
   * session count, shown as a comparison aid under the prominent total
   * (ICU {amount}; the amount arrives pre-formatted with currency label).
   */
  readonly perSessionLine: (amount: string) => string;
  /** Balance-lane vocabulary — mirrors the Hifz credit-lane value. */
  readonly laneHifz: string;
  /** Balance-lane vocabulary — mirrors the Tajweed credit-lane value. */
  readonly laneTajweed: string;
  /** Balance-lane vocabulary — mirrors the Reviews credit-lane value. */
  readonly laneReviews: string;
  /** Balance-lane vocabulary — the general account balance for lane-less plans. */
  readonly laneGeneralLabel: string;
  /** Currency label — the EGP display label in the active locale. */
  readonly currencyEgp: string;
  /** Trust note under the catalog grid — the hosted Paymob payment surface. */
  readonly paymobTrustNote: string;
  /** Plan card feature line — the lane the included sessions credit to (ICU {lane}). */
  readonly laneCreditLine: (laneLabel: string) => string;
  /** Empty-catalog title (no active plans). */
  readonly emptyTitle: string;
  /** Empty-catalog body. */
  readonly emptyBody: string;
  /** Empty-catalog CTA — re-checks the catalog for newly published plans. */
  readonly emptyActionButton: string;

  // ── Purchase confirmation dialog ────────────────────────────────────────
  /** Confirm-dialog title before a purchase is submitted. */
  readonly confirmDialogTitle: string;
  /** Summary row label — the plan being purchased. */
  readonly planLabel: string;
  /** Summary row label — the included session count. */
  readonly sessionsLabel: string;
  /** Summary row label — the validity window. */
  readonly validityLabel: string;
  /** Summary row label — the total charged amount. */
  readonly amountDueLabel: string;
  /** Dialog explainer — the hosted-checkout redirect that follows confirmation. */
  readonly confirmDialogSecureNote: string;
  /** Dialog submit CTA — opens the gateway checkout session. */
  readonly confirmButton: string;
  /** Dialog submit CTA while the purchase mutation is in flight. */
  readonly confirmBusyButton: string;
  /** Dialog dismiss CTA — keeps the purchase attempt's idempotency key. */
  readonly cancelButton: string;
  /** Snackbar notice when the provider activates instantly with no hosted checkout. */
  readonly purchaseCompletedNotice: string;

  // ── Payment result page ─────────────────────────────────────────────────
  /** Localized page metadata — result route <title>. */
  readonly resultMetaTitle: string;
  /** Result page loading title — while the authoritative re-query runs. */
  readonly resultCheckingTitle: string;
  /** Result page loading body — while the authoritative re-query runs. */
  readonly resultCheckingBody: string;
  /** Result branch title — the payment was confirmed and the subscription activated. */
  readonly resultSuccessTitle: string;
  /** Result branch body — the payment was confirmed and the subscription activated. */
  readonly resultSuccessBody: string;
  /** Result branch title — the payment was declined or did not complete. */
  readonly resultFailedTitle: string;
  /** Result branch body — the payment was declined or did not complete. */
  readonly resultFailedBody: string;
  /** Result branch title — the payment is still being processed. */
  readonly resultPendingTitle: string;
  /** Result branch body — the payment is still being processed. */
  readonly resultPendingBody: string;
  /** Result-page CTA — returns to the catalog to retry the purchase. */
  readonly retryButton: string;
  /** Result-page CTA — opens the my-subscriptions list. */
  readonly viewSubscriptionsButton: string;

  // ── My subscriptions ────────────────────────────────────────────────────
  /** My-subscriptions page <title>/header. */
  readonly subscriptionsPageTitle: string;
  /** My-subscriptions page subtitle under the header. */
  readonly subscriptionsPageSubtitle: string;
  /** Localized page metadata — subscriptions route <title>. */
  readonly subscriptionsMetaTitle: string;
  /** Localized page metadata — subscriptions route meta description. */
  readonly subscriptionsMetaDescription: string;
  /** List column label — the subscription lifecycle chip. */
  readonly statusColumn: string;
  /** List column label — the period start (blank while pending). */
  readonly startDateColumn: string;
  /** List column label — the period end (blank while pending). */
  readonly endDateColumn: string;
  /** Placeholder for absent values (e.g. no start/end date while pending). */
  readonly emptyValue: string;
  /** Lifecycle chip — mirrors the Active subscription status value. */
  readonly statusActive: string;
  /** Lifecycle chip — mirrors the Pending subscription status value. */
  readonly statusPending: string;
  /** Lifecycle chip — mirrors the Expired subscription status value. */
  readonly statusExpired: string;
  /** Lifecycle chip — mirrors the Cancelled subscription status value. */
  readonly statusCancelled: string;
  /** Lifecycle chip — mirrors the Suspended subscription status value. */
  readonly statusSuspended: string;
  /** Derived chip — the payment behind a pending subscription failed. */
  readonly statusFailed: string;
  /** Failed-payment guidance copy under a payment-failed row. */
  readonly failedPaymentGuidance: string;
  /** Empty-list title (no subscriptions yet). */
  readonly subscriptionsEmptyTitle: string;
  /** Empty-list body. */
  readonly subscriptionsEmptyBody: string;
  /** Empty-list CTA — opens the plan catalog. */
  readonly browsePlansButton: string;
  /** Generic failure fallback for the funnel's query error arms. */
  readonly genericError: string;
}
