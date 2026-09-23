/**
 * Contract tests for frontend timestamp formatting utilities
 * (`frontend/lib/i18n/format-date.ts`).
 *
 * Exercises `formatApplicantDate` and `formatDayMonth`:
 *  - English ("en") vs Arabic ("ar") formatting outputs.
 *  - Locale tag fallback rules (only exact "en" -> English, all others -> "ar").
 *  - Deterministic UTC timezone behavior across offset ISO representations.
 *  - Day/Month tick formatting with bidi mark removal and LTR isolate wrapping (\u2066...\u2069).
 *  - Ledger stamp formatting (`formatLedgerStamp` — pure-ASCII numeric stamp
 *    for the financial-table date cells; no bidi controls, no locale punctuation).
 *  - Edge case dates (leap days, year transitions).
 */

import { describe, expect, test } from "bun:test";
import { formatApplicantDate, formatDayMonth, formatLedgerStamp } from "@/frontend/lib/i18n/format-date";

describe("formatApplicantDate — timestamp formatting contract", () => {
  const TEST_ISO = "2026-08-27T13:00:00.000Z";

  test("English ('en') locale renders Latin digits and 24-hour UTC timestamp", () => {
    const formatted = formatApplicantDate(TEST_ISO, "en");

    // Standard English DateTimeFormat with 2-digit month/day/year, 2-digit 24h hour/minute
    expect(formatted).toBe("08/27/2026, 13:00");
  });

  test("Arabic ('ar') locale renders Arabic-locale formatting (Arabic separator, RLM bidi marks)", () => {
    const formatted = formatApplicantDate(TEST_ISO, "ar");

    // The `ar` locale data swaps the date separator for the Arabic comma
    // (U+060C), reorders to day/month, and injects RLM (U+200F) bidi marks
    // around numeric runs — the injection `formatDayMonth` strips. The digit
    // system itself is runtime-ICU dependent (Bun's ICU build renders Latin
    // digits; browser ICU may render Arabic-Indic), so the contract pins the
    // separator, bidi marks, and locale-distinctness rather than a digit glyph.
    expect(formatted).toContain("،");
    expect(formatted).toContain("\u200f");
    expect(formatted).toContain("27");
    expect(formatted).toContain("2026");
    expect(formatted).toContain("13:00");
    expect(formatted).not.toBe(formatApplicantDate(TEST_ISO, "en"));
  });

  test("fallback locale resolution — non-'en' inputs resolve to Arabic ('ar')", () => {
    const arDefault = formatApplicantDate(TEST_ISO, "ar");

    for (const locale of ["fr", "es", "ar-EG", "EN", "", "english", "undefined"]) {
      expect(formatApplicantDate(TEST_ISO, locale)).toBe(arDefault);
    }
  });

  test("exact 'en' resolves to English formatting", () => {
    expect(formatApplicantDate(TEST_ISO, "en")).toBe("08/27/2026, 13:00");
  });

  test("timezone determinism — parses non-UTC ISO offsets to the identical UTC instant", () => {
    // 2026-08-27T18:00:00+05:00 is 2026-08-27T13:00:00Z
    const plusFiveIso = "2026-08-27T18:00:00.000+05:00";
    // 2026-08-27T09:00:00-04:00 is 2026-08-27T13:00:00Z
    const minusFourIso = "2026-08-27T09:00:00.000-04:00";

    const utcFormattedEn = formatApplicantDate(TEST_ISO, "en");
    const utcFormattedAr = formatApplicantDate(TEST_ISO, "ar");

    expect(formatApplicantDate(plusFiveIso, "en")).toBe(utcFormattedEn);
    expect(formatApplicantDate(minusFourIso, "en")).toBe(utcFormattedEn);
    expect(formatApplicantDate(plusFiveIso, "ar")).toBe(utcFormattedAr);
    expect(formatApplicantDate(minusFourIso, "ar")).toBe(utcFormattedAr);
  });

  test("handles boundary dates — leap days and year transitions", () => {
    const leapDay = "2024-02-29T23:59:59.999Z";
    expect(formatApplicantDate(leapDay, "en")).toBe("02/29/2024, 23:59");

    const newYearEve = "2025-12-31T23:59:00.000Z";
    expect(formatApplicantDate(newYearEve, "en")).toBe("12/31/2025, 23:59");
  });

  test("client/server option parity — matches direct Intl.DateTimeFormat with shared APPLICANT_DATE_OPTIONS", () => {
    const expectedEn = new Intl.DateTimeFormat("en", {
      timeZone: "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(TEST_ISO));

    const expectedAr = new Intl.DateTimeFormat("ar", {
      timeZone: "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(TEST_ISO));

    expect(formatApplicantDate(TEST_ISO, "en")).toBe(expectedEn);
    expect(formatApplicantDate(TEST_ISO, "ar")).toBe(expectedAr);
  });
});

describe("formatDayMonth — chart axis tick formatting contract", () => {
  const TEST_ISO = "2026-08-27T13:00:00.000Z";

  test("English ('en') day/month formatting starts with LRI (\\u2066) and ends with PDI (\\u2069)", () => {
    const result = formatDayMonth(TEST_ISO, "en");

    expect(result.startsWith("\u2066")).toBe(true);
    expect(result.endsWith("\u2069")).toBe(true);

    // Stripped inner string matches day/month 2-digit format
    const inner = result.slice(1, -1);
    expect(inner).toBe("08/27");
  });

  test("Arabic ('ar') day/month formatting strips bidi controls and isolates numeric run", () => {
    const result = formatDayMonth(TEST_ISO, "ar");

    expect(result.startsWith("\u2066")).toBe(true);
    expect(result.endsWith("\u2069")).toBe(true);

    // Must not contain any forbidden bidi control characters (\u200e, \u200f, \u202a-\u202e)
    expect(result).not.toMatch(/[\u200e\u200f\u202a-\u202e]/);

    const inner = result.slice(1, -1);
    // The `ar` locale orders day before month; the digit system is
    // runtime-ICU dependent (Bun's ICU build renders Latin digits, browser
    // ICU may render Arabic-Indic) — the contract pins the stripped,
    // day-first numeric run this runtime produces.
    expect(inner).toBe("27/08");
  });

  test("fallback locale resolution — non-'en' inputs resolve to Arabic ('ar')", () => {
    const arDefault = formatDayMonth(TEST_ISO, "ar");

    for (const locale of ["fr", "es", "ar-EG", "EN", "", "other"]) {
      expect(formatDayMonth(TEST_ISO, locale)).toBe(arDefault);
    }
  });

  test("timezone determinism for day/month calculation", () => {
    // 2026-08-27T01:00:00+05:00 is 2026-08-26T20:00:00Z (Aug 26 in UTC)
    const offsetIso = "2026-08-27T01:00:00+05:00";
    const expectedUtcDayMonth = formatDayMonth("2026-08-26T20:00:00.000Z", "en");

    expect(formatDayMonth(offsetIso, "en")).toBe(expectedUtcDayMonth);
  });
});

describe("formatLedgerStamp — financial-table numeric stamp contract", () => {
  test("renders the day-first dd/MM/yyyy HH:mm ASCII stamp from UTC components", () => {
    expect(formatLedgerStamp("2026-08-27T13:00:00.000Z")).toBe("27/08/2026 13:00");
  });

  test("pads single-digit day/month/hour/minute fields to two digits", () => {
    expect(formatLedgerStamp("2026-01-04T05:07:00.000Z")).toBe("04/01/2026 05:07");
  });

  test("contains no bidi controls and no locale punctuation (RLM/LRM/isolates)", () => {
    const stamps = [formatLedgerStamp("2026-08-27T13:00:00.000Z"), formatLedgerStamp("2026-12-31T23:59:00.000Z")];
    for (const stamp of stamps) {
      expect(stamp).not.toMatch(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/);
      expect(stamp).toMatch(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/);
    }
  });

  test("uses UTC regardless of the host timezone (offset ISO in, UTC components out)", () => {
    // 2026-08-27T01:00:00+05:00 is 2026-08-26T20:00:00Z — the previous UTC day.
    expect(formatLedgerStamp("2026-08-27T01:00:00+05:00")).toBe("26/08/2026 20:00");
  });

  test("locale independence — the same instant stamps identically for every app locale", () => {
    // The helper takes NO locale: the ar/en renders are byte-identical by
    // construction (the ICU-embedded RLM scramble cannot happen).
    expect(formatLedgerStamp("2026-08-27T13:00:00.000Z")).toBe("27/08/2026 13:00");
  });

  test("unparseable input renders the empty string (not 'Invalid Date')", () => {
    expect(formatLedgerStamp("not-a-date")).toBe("");
  });
});
