/**
 * Verification plan identity constants — single source of truth for the
 * canonical new-teacher verification product in the plan catalog.
 *
 * `VERIFICATION_PLAN_TITLE` pins the seeded verification plan's identity:
 * purchase resolution looks the plan up server-side from the ACTIVE catalog
 * by exact title match, so this string is the server-side resolution key and
 * must match the seeded row verbatim (the seeder sources it from here, so
 * the two can never drift). `VERIFICATION_PLAN_SESSION_COUNT` is part of the
 * product contract — a verification plan purchase grants exactly five
 * one-on-one evaluation sessions.
 *
 * Shared-layer isolation: this module imports nothing from the backend,
 * frontend, or app layers. It is safe to import from any layer.
 */

/** Exact catalog title of the seeded verification plan (server-side resolution key). */
export const VERIFICATION_PLAN_TITLE = "New Teacher Verification & Evaluation Plan" as const;

/** Exact number of sessions a verification plan purchase grants (product contract). */
export const VERIFICATION_PLAN_SESSION_COUNT = 5 as const;

/** Exact checkout/ledger price of the verification plan, verbatim decimal string (product contract). */
export const VERIFICATION_PLAN_PRICE = "150.00" as const;

/** Exact ISO currency code the verification plan is priced in (product contract). */
export const VERIFICATION_PLAN_CURRENCY = "EGP" as const;

/** Exact subscription window in days a verification purchase grants (product contract). */
export const VERIFICATION_PLAN_INTERVAL_DAYS = 14 as const;
