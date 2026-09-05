/**
 * Platform session fee constants — single source of truth for interim
 * 1:1 Quran session pricing.
 *
 * The platform (not teachers, not students) sets the fee charged for each
 * session intent. Both supported intents are currently priced identically
 * as an interim platform policy; per-intent constants exist so pricing can
 * later diverge per intent without touching consumers.
 *
 * Money discipline: fees are decimal STRINGS, never numbers or floats.
 * They are carried verbatim end-to-end — written to the `session.fee`
 * decimal column (which itself infers as string), returned through the API
 * unchanged, and rendered on the client without transformation. No
 * arithmetic is ever performed on a fee anywhere in the codebase; any
 * future pricing refinement must preserve this string-carry discipline.
 *
 * All session fees are denominated in the platform currency (EGP).
 *
 * The confirmation window is the time a freshly created session remains
 * pending confirmation before it lapses and its held fee is released.
 *
 * Shared-layer isolation: this module imports nothing from the backend,
 * frontend, or app layers. It is safe to import from any layer.
 */

/** Session fee for a Hifz-intent session, in EGP (decimal string). */
export const SESSION_FEE_HIFZ = "25.00";

/** Session fee for a Tajweed-intent session, in EGP (decimal string). */
export const SESSION_FEE_TAJWEED = "25.00";

/** Platform currency all session fees are denominated in. */
export const SESSION_FEE_CURRENCY = "EGP";

/**
 * How long a freshly created session stays pending confirmation before it
 * lapses: 24 hours, expressed in milliseconds for direct use in deadline
 * arithmetic on timestamps (never on fees).
 */
export const SESSION_CONFIRMATION_WINDOW_MS = 86_400_000;
