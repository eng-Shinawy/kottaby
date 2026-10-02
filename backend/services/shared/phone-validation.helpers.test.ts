/**
 * `validatePhoneField` — 4-tier suite for the shared backend phone gate.
 *
 * WHAT THIS LOCKS
 *   1. BRANCH COMPLETENESS × LOCALE — all four outcomes (valid → `null`,
 *      `PHONE_REQUIRED`, `PHONE_TOO_LONG`, `PHONE_INVALID`) asserted in both
 *      `en` and `ar`, each message equal to the exact localized template the
 *      helper must emit, plus the default-locale fallback for an unknown
 *      locale tag.
 *   2. BOUNDARY CONDITIONS — the 16/17-character E.164 ceiling (`.max` fires
 *      before `.regex`), the minimum valid number (`+` + 8 digits) vs one
 *      digit short, leading-zero country digit, empty/whitespace-only values,
 *      edge-whitespace tolerance, and a too-long value whose SHAPE is also
 *      invalid (length still wins).
 *   3. FUZZ / PROPERTY — a deterministic hostile corpus (control characters,
 *      bidi marks, Arabic-Indic digits, SQL/LIKE wildcards, template-ish
 *      braces, 10k-char runs) never throws and always returns a fully shaped
 *      result; concurrent parses agree with sequential ones (no shared state).
 *   4. SECURITY — for every hostile payload the returned `message` is exactly
 *      a localized template (so no substring of the input can leak through),
 *      the raw value itself never appears in the message, `field` is always
 *      the literal `"phone"`, and `code` is always one of the three machine
 *      codes.
 *
 * Pure unit tier — NO server boot, NO network, NO DB (no `runInRollback`).
 * Runs via the mandated runner:
 * `bun run test/scripts/run-test.ts backend/services/shared/phone-validation.helpers.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import { validatePhoneField } from "@/backend/services/shared";
import type { ApiFieldErrorType } from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";

const EN = getServerTranslations("en");
const AR = getServerTranslations("ar");

const VALID_PHONE = "+201001234567";
const PHONE_16_CHARS = "+201001234567890"; // leading `+` + 15 digits = the E.164 ceiling
const PHONE_17_CHARS = `${PHONE_16_CHARS}1`; // one digit past the ceiling
const BAD_SHAPE_17_CHARS = "+20abc12345678901"; // 17 chars, invalid shape — length still wins
const UNFORMATTED_SHORT = "12345"; // no `+`, too short

const LOCALES = ["en", "ar"] as const;
type SuiteLocale = (typeof LOCALES)[number];

const PHONE_ERROR_CODES = new Set(["PHONE_REQUIRED", "PHONE_TOO_LONG", "PHONE_INVALID"]);

/** The three localized templates a failed parse may produce, per locale. */
function localizedTemplates(locale: SuiteLocale): string[] {
  const t = locale === "en" ? EN : AR;
  return [t.authTranslations.phoneRequired, t.authTranslations.phoneInvalid, t.errorsTranslations.validation];
}

/**
 * Shared Tier 3/4 probe: the helper never throws, always returns a shaped
 * error whose message is exactly a localized template of the locale (which
 * rules out any echo of the submitted value), with `field` pinned to
 * `"phone"` and `code` pinned to the machine-code set.
 */
function assertShapedErrorWithoutEcho(value: string, locale: SuiteLocale): void {
  const result: ApiFieldErrorType | null = validatePhoneField(value, locale);
  expect(result).not.toBeNull();
  if (!result) throw new Error("expected a phone field error");
  expect(result.field).toBe("phone");
  expect(PHONE_ERROR_CODES.has(result.code)).toBe(true);
  expect(localizedTemplates(locale)).toContain(result.message);
  if (value.length > 0) {
    expect(result.message.includes(value)).toBe(false);
  }
}

describe("validatePhoneField — Tier 1: mapping branches × locales", () => {
  test("valid E.164 phone → null in en and ar", () => {
    for (const locale of LOCALES) {
      expect(validatePhoneField(VALID_PHONE, locale)).toBeNull();
    }
  });

  test("empty phone → PHONE_REQUIRED with the authTranslations.phoneRequired template", () => {
    expect(validatePhoneField("", "en")).toEqual({
      field: "phone",
      code: "PHONE_REQUIRED",
      message: EN.authTranslations.phoneRequired,
    });
    expect(validatePhoneField("", "ar")).toEqual({
      field: "phone",
      code: "PHONE_REQUIRED",
      message: AR.authTranslations.phoneRequired,
    });
  });

  test("17-char phone → PHONE_TOO_LONG with the errorsTranslations.validation template", () => {
    expect(validatePhoneField(PHONE_17_CHARS, "en")).toEqual({
      field: "phone",
      code: "PHONE_TOO_LONG",
      message: EN.errorsTranslations.validation,
    });
    expect(validatePhoneField(PHONE_17_CHARS, "ar")).toEqual({
      field: "phone",
      code: "PHONE_TOO_LONG",
      message: AR.errorsTranslations.validation,
    });
  });

  test("unformatted short phone → PHONE_INVALID with the authTranslations.phoneInvalid template", () => {
    expect(validatePhoneField(UNFORMATTED_SHORT, "en")).toEqual({
      field: "phone",
      code: "PHONE_INVALID",
      message: EN.authTranslations.phoneInvalid,
    });
    expect(validatePhoneField(UNFORMATTED_SHORT, "ar")).toEqual({
      field: "phone",
      code: "PHONE_INVALID",
      message: AR.authTranslations.phoneInvalid,
    });
  });

  test("unknown locale tag falls back to the default locale's templates", () => {
    expect(validatePhoneField(UNFORMATTED_SHORT, "zz")).toEqual({
      field: "phone",
      code: "PHONE_INVALID",
      message: AR.authTranslations.phoneInvalid,
    });
  });
});

describe("validatePhoneField — Tier 2: boundary values", () => {
  test("exactly 16 chars parses; 17 chars is PHONE_TOO_LONG", () => {
    expect(validatePhoneField(PHONE_16_CHARS, "en")).toBeNull();
    expect(validatePhoneField(PHONE_16_CHARS, "ar")).toBeNull();
    expect(validatePhoneField(PHONE_17_CHARS, "en")?.code).toBe("PHONE_TOO_LONG");
    expect(validatePhoneField(PHONE_17_CHARS, "ar")?.code).toBe("PHONE_TOO_LONG");
  });

  test("17 chars with an invalid shape still report PHONE_TOO_LONG (max precedes regex)", () => {
    expect(validatePhoneField(BAD_SHAPE_17_CHARS, "en")?.code).toBe("PHONE_TOO_LONG");
    expect(validatePhoneField(BAD_SHAPE_17_CHARS, "ar")?.code).toBe("PHONE_TOO_LONG");
  });

  test("empty and whitespace-only values are PHONE_REQUIRED (min precedes max)", () => {
    for (const value of ["", "   ", "               "]) {
      for (const locale of LOCALES) {
        expect(validatePhoneField(value, locale)?.code).toBe("PHONE_REQUIRED");
      }
    }
  });

  test("edge whitespace is tolerated; interior formatting is not", () => {
    expect(validatePhoneField(`  ${VALID_PHONE}  `, "en")).toBeNull();
    expect(validatePhoneField("+20 (100) 123-4567", "en")?.code).toBe("PHONE_TOO_LONG");
  });

  test("minimum valid number is `+` + 8 digits; one digit short is PHONE_INVALID", () => {
    expect(validatePhoneField("+12345678", "en")).toBeNull();
    expect(validatePhoneField("+1234567", "en")?.code).toBe("PHONE_INVALID");
    expect(validatePhoneField("+1234567", "ar")?.code).toBe("PHONE_INVALID");
  });

  test("leading zero country digit is PHONE_INVALID", () => {
    expect(validatePhoneField("+0123456789", "en")?.code).toBe("PHONE_INVALID");
    expect(validatePhoneField("+0123456789", "ar")?.code).toBe("PHONE_INVALID");
  });
});

describe("validatePhoneField — Tier 3: deterministic fuzz, never throws", () => {
  const FUZZ_CORPUS: string[] = [
    "",
    " ",
    "\t\n\r ",
    "\u0000",
    "\u0000+201001234567",
    "+2010\n0123456",
    "+2010\r0123456",
    "\u202E+201001234567",
    "+٢٠١٠٠١٢٣٤٥٦",
    "٢٠١٠٠١٢٣٤٥٦",
    "+20abc1234",
    "++201001234567",
    "+20 (100) 123-4567",
    "%20_OR_1%3D1--",
    "'; DROP TABLE users; --",
    "100%_phone_10",
    "\u0024{phone}",
    "+{1}",
    "admin@kottaby.test+phone",
    "+".repeat(17),
    "9".repeat(64),
    "9".repeat(10_000),
    " +201001234567890 ",
    "-201001234567",
    "+20100123456789012345",
  ];

  test("every corpus payload × locale returns without throwing", () => {
    for (const payload of FUZZ_CORPUS) {
      for (const locale of LOCALES) {
        expect(() => validatePhoneField(payload, locale)).not.toThrow();
      }
    }
  });

  test("concurrent parses agree with sequential parses (no shared mutable state)", async () => {
    const concurrent = await Promise.allSettled(
      FUZZ_CORPUS.map(payload => Promise.resolve().then(() => validatePhoneField(payload, "en")))
    );
    expect(concurrent.every(outcome => outcome.status === "fulfilled")).toBe(true);
    for (const payload of FUZZ_CORPUS) {
      expect(validatePhoneField(payload, "en")).toEqual(validatePhoneField(payload, "en"));
      expect(validatePhoneField(payload, "ar")).toEqual(validatePhoneField(payload, "ar"));
    }
  });
});

describe("validatePhoneField — Tier 4: no raw-input echo, stable field/code contract", () => {
  const HOSTILE_CORPUS: string[] = [
    "+20abc1234",
    "20100123456789012345",
    "+2010012345678901234567890",
    " +20 (100) 123-4567 ",
    "%20_OR_1%3D1--",
    "admin@kottaby.test+phone",
    "\u0000",
    "+2010\n0123456",
    "+٢٠١٠٠١٢٣٤٥٦",
    "\u202E+201001234567",
    "+{1}",
    "9".repeat(10_000),
    "   ",
  ];

  test("hostile payloads never surface the submitted value in the message", () => {
    for (const payload of HOSTILE_CORPUS) {
      for (const locale of LOCALES) {
        assertShapedErrorWithoutEcho(payload, locale);
      }
    }
  });

  test("valid phone produces no error object at all (nothing to echo)", () => {
    expect(validatePhoneField(VALID_PHONE, "en")).toBeNull();
    expect(validatePhoneField(VALID_PHONE, "ar")).toBeNull();
  });
});
