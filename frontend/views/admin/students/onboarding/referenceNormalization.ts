/**
 * referenceNormalization — the payment-reference paste-hygiene vocabulary:
 * a pasted reference is ONE token, but payment-app / banking copies often
 * ride line breaks, NBSP runs, or invisible bidi controls. The normalizer
 * strips those to the token the admin actually meant; length and charset
 * authority stays with the existing 1–255 validation (client) and the
 * service's own re-validation — this seam never invents characters.
 */

/** Invisible bidi/zero-width controls that ride clipboard copies silently. */
const INVISIBLE_CHARACTER_PATTERN = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;

/**
 * Normalizes a pasted payment reference: strips invisible controls,
 * collapses every whitespace run (JS `\s` already covers NBSP), and trims
 * the edges — the field then holds the plain token.
 */
export function normalizePastedReference(raw: string): string {
  return raw.replace(INVISIBLE_CHARACTER_PATTERN, "").replace(/\s+/g, "").trim();
}

/** True when normalization would change the pasted text (drives the notice). */
export function needsReferenceNormalization(raw: string): boolean {
  return normalizePastedReference(raw) !== raw;
}
