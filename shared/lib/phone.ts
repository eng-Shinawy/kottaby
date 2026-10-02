/**
 * Canonical phone-number validation shared by the frontend and the backend.
 *
 * The accepted shape is strict E.164: a leading `+`, a non-zero country digit,
 * and 8–15 digits in total (e.g. `+201001234567`). Spaces, dashes, and
 * parentheses are not part of the canonical shape; callers that collect
 * user-formatted input can canonicalize it with `normalizePhone` before
 * validating. No country code is ever inferred or prepended and no per-country
 * rules are applied — the shape check is deliberately dial-code-independent.
 *
 * Machine-code convention: the `message` values carried by `phoneSchema`
 * (`PHONE_REQUIRED`, `PHONE_TOO_LONG`, `PHONE_INVALID`) are machine codes, NOT
 * user-facing text. Producers (backend validation helpers, frontend form rules)
 * translate each code into a localized message. Keeping the codes in the schema
 * keeps this module free of i18n — and of any layer — dependencies.
 */
import { z } from "zod";

/** Strict E.164 shape: leading `+`, non-zero country digit, 8–15 digits in total. */
export const PHONE_E164_PATTERN = /^\+[1-9]\d{7,14}$/;

/** E.164 wire ceiling: the leading `+` plus up to 15 digits. */
export const PHONE_MAX_LENGTH = 16;

/**
 * Canonical phone shape contract. Each `message` carries a machine code
 * (`PHONE_REQUIRED` | `PHONE_TOO_LONG` | `PHONE_INVALID`) — never user copy.
 * Producers map the code to a localized string at their own boundary.
 */
export const phoneSchema = z
  .string()
  .trim()
  .min(1, { message: "PHONE_REQUIRED" })
  .max(PHONE_MAX_LENGTH, { message: "PHONE_TOO_LONG" })
  .regex(PHONE_E164_PATTERN, { message: "PHONE_INVALID" });

/**
 * True when `value` holds a valid phone number (surrounding whitespace
 * tolerated). Delegates to `phoneSchema` so the predicate and the schema can
 * never disagree. Pure; never throws.
 */
export function isValidPhone(value: string): boolean {
  return phoneSchema.safeParse(value).success;
}

/**
 * Canonicalize user-formatted input: strip ASCII spaces, dashes, and
 * parentheses first, then trim — stripping runs before the trim so removing a
 * separator can never expose a fresh whitespace edge that survives the pass
 * (this ordering is what makes the function idempotent). Keeps at most a
 * single leading `+`. Never invents a `+` when the input had none and never
 * prepends a country code. Pure, deterministic, idempotent: the output always
 * satisfies `normalizePhone(out) === out`.
 */
export function normalizePhone(value: string): string {
  const stripped = value.replace(/[ ()-]/g, "").trim();
  return stripped.startsWith("+") ? `+${stripped.replace(/^\++/, "")}` : stripped;
}
