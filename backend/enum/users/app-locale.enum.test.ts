/**
 * AppLocale + toAppLocale test suite.
 * Parity tier — pins the TS mirror byte-identical to BOTH the `app_locale`
 *   pgEnum registry entry and the shared locale list
 *   (`shared/locale/AppLocale.ts`): same 2 members, same order. A new locale
 *   can never land in one source only.
 * Tier 1: 100% branch coverage of the `toAppLocale` mapping helper.
 * Tier 2: Boundary cases — case mismatch, whitespace, empty, primitives.
 * Unit tier — the schema import pulls the pgEnum definition only (no DB
 * client, no connection); every guard test is pure.
 */
import { describe, expect, test } from "bun:test";
import { appLocale } from "@/backend/db/schema/enums";
import { AppLocale, toAppLocale } from "@/backend/enum/users/app-locale.enum";
import { locales } from "@/shared/locale/AppLocale";

/** Canonical member order — the single hardcoded ground truth every parity assertion derives from. */
const CANONICAL_VALUES = ["ar", "en"] as const;

describe("appLocale pgEnum ↔ AppLocale mirror ↔ shared locales parity", () => {
  test("pgEnum enumValues is exactly the 2 canonical values, in order", () => {
    expect([...appLocale.enumValues]).toEqual([...CANONICAL_VALUES]);
  });

  test("TS mirror Object.values is exactly the 2 canonical values, in order", () => {
    expect(Object.values(AppLocale).join("|")).toBe(CANONICAL_VALUES.join("|"));
  });

  test("shared `locales` const is exactly the 2 canonical values, in order", () => {
    expect([...locales]).toEqual([...CANONICAL_VALUES]);
  });

  test("pgEnum, TS mirror, and shared list are byte-identical (order-sensitive)", () => {
    expect([...appLocale.enumValues].join("|")).toBe(Object.values(AppLocale).join("|"));
    expect([...appLocale.enumValues].join("|")).toBe([...locales].join("|"));
    expect(Object.values(AppLocale).join("|")).toBe([...locales].join("|"));
  });
});

describe("toAppLocale", () => {
  // ---- Tier 1: Branch/Statement Coverage ----
  test("every canonical value maps to its enum member (true branches)", () => {
    expect(toAppLocale("ar")).toBe(AppLocale.Ar);
    expect(toAppLocale("en")).toBe(AppLocale.En);
  });

  test("enum members round-trip through their string values", () => {
    expect(toAppLocale(AppLocale.Ar)).toBe(AppLocale.Ar);
    expect(toAppLocale(AppLocale.En)).toBe(AppLocale.En);
  });

  // ---- Tier 2: Boundary Cases ----
  test("case mismatch, whitespace, and near-misses return null", () => {
    expect(toAppLocale("AR")).toBeNull();
    expect(toAppLocale("En")).toBeNull();
    expect(toAppLocale(" ar")).toBeNull();
    expect(toAppLocale("en ")).toBeNull();
    expect(toAppLocale("ar,en")).toBeNull();
    expect(toAppLocale("")).toBeNull();
  });

  test("unrelated + foreign-locale strings return null (closed set)", () => {
    expect(toAppLocale("fr")).toBeNull();
    expect(toAppLocale("arabic")).toBeNull();
    expect(toAppLocale("english")).toBeNull();
    expect(toAppLocale("ar-SA")).toBeNull();
  });
});
