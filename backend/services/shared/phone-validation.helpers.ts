/**
 * Shared backend phone-field validation — the single server-side gate every
 * phone write path composes (public registration and the admin user
 * create/update flows funnel through this one helper, so no surface can
 * drift from the shared rule or skip it).
 *
 * The shared `phoneSchema` (`@/shared/lib/phone`) is the only shape
 * authority. Its zod `message` values are machine codes, never user copy;
 * this helper is the producer that translates a failed parse into a fully
 * localized `ApiFieldErrorType`:
 *
 *  - `PHONE_REQUIRED` → `authTranslations.phoneRequired`
 *  - `PHONE_TOO_LONG` → `errorsTranslations.validation`
 *  - `PHONE_INVALID`  → `authTranslations.phoneInvalid`
 *
 * Contract details:
 *  - `field` is always the literal `"phone"` — the form path the register
 *    form and the admin create/edit dialogs project errors by.
 *  - The returned `message` is a fixed localized template; the submitted
 *    value is never echoed into it.
 *  - Pure and synchronous — no DB, no I/O — so the format gate can never
 *    act as a tenancy or enumeration oracle.
 *  - The wire value is parsed as-is: the schema tolerates edge whitespace,
 *    while canonicalization of user-formatted separators (spaces, dashes,
 *    parentheses) stays the caller's concern via `normalizePhone`.
 */

import type { ApiFieldErrorType } from "@/backend/types";
import { phoneSchema } from "@/shared/lib/phone";
import { getServerTranslations } from "@/shared/locale/server-graphql";

/**
 * Validates one phone value against the shared E.164 contract. Returns
 * `null` when the value parses; otherwise the localized field error for the
 * FIRST failing schema check (required → too-long → invalid, matching the
 * schema's check order).
 */
export function validatePhoneField(value: string, locale: string): ApiFieldErrorType | null {
  const parsed = phoneSchema.safeParse(value);
  if (parsed.success) {
    return null;
  }
  const code = parsed.error.issues[0].message;
  const translations = getServerTranslations(locale);
  switch (code) {
    case "PHONE_REQUIRED":
      return { field: "phone", code, message: translations.authTranslations.phoneRequired };
    case "PHONE_TOO_LONG":
      return { field: "phone", code, message: translations.errorsTranslations.validation };
    case "PHONE_INVALID":
      return { field: "phone", code, message: translations.authTranslations.phoneInvalid };
    default: {
      // Exhaustiveness guard — phoneSchema emits only the three codes above.
      throw new Error(`Unexpected phone validation code: ${code}`);
    }
  }
}
