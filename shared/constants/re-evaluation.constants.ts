/**
 * Re-evaluation fee constants — single source of truth for the price an
 * admin-ordered re-evaluation charges the subject teacher's wallet.
 *
 * `RE_EVALUATION_FEE` is a product-owned pricing input, NOT a request
 * parameter: no caller can supply, override, or negotiate the amount —
 * the server reads it from here when composing the wallet debit. The
 * value below is PROVISIONAL: it stands until the product owner confirms
 * the final re-evaluation pricing, at which point only this one line
 * changes and every consumer follows. Re-pricing is therefore a product
 * confirmation followed by a one-line edit — never a per-request decision.
 *
 * The amount is carried end-to-end as a verbatim decimal string (never
 * parsed into a number, never re-rounded) so the charged ledger row, the
 * audit trail, and the API response all carry byte-identical money.
 *
 * `RE_EVALUATION_FEE_CURRENCY` pins the ISO currency the fee is charged in.
 *
 * Shared-layer isolation: this module imports nothing from the backend,
 * frontend, or app layers. It is safe to import from any layer.
 */

/**
 * Exact wallet-deduction amount for an admin-ordered re-evaluation, as a
 * verbatim decimal string (product-owned pricing input — provisional
 * until the product owner confirms the final re-evaluation pricing).
 */
export const RE_EVALUATION_FEE = "100.00" as const;

/** Exact ISO currency code the re-evaluation fee is charged in (product contract). */
export const RE_EVALUATION_FEE_CURRENCY = "EGP" as const;
