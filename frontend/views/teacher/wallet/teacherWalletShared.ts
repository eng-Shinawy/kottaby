/**
 * Teacher wallet — shared constants, the notice shape, and the client-side
 * amount rules. Extracted verbatim from `TeacherWalletContainer` (the
 * max-lines split).
 */

/** Snackbar autohide — parity with the sessions containers. */
export const SNACKBAR_AUTOHIDE_MS = 4000;

/** The Apollo `__typename` of the normalized wallet entity. */
export const WALLET_TYPE_NAME = "Wallet";

/**
 * UX-only mirror of the server's withdrawal-amount grammar (R-303):
 * 1-7 integer digits, an optional 1-2 digit fraction. The server matrix
 * stays the authority — this only gates the submit button + inline hint.
 */
export const WITHDRAWAL_AMOUNT_PATTERN = /^\d{1,7}(\.\d{1,2})?$/;

/** One transient container-level notice rendered in the MUI Snackbar slot. */
export interface ContainerNotice {
  readonly message: string;
  readonly severity: "success" | "info" | "error";
}

/**
 * Client-side mirror of the server's positivity rule: the grammar matched
 * AND at least one nonzero digit present. Pure string predicates — no
 * numeric parse of a money value.
 */
export function isClientValidAmount(trimmed: string): boolean {
  return WITHDRAWAL_AMOUNT_PATTERN.test(trimmed) && /[1-9]/.test(trimmed);
}
