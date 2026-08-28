/**
 * `errors.planCatalog` — plan-catalog domain error-message parity gate
 * (the flat `plan*` key family on the `errors` namespace).
 *
 * WHAT THIS LOCKS
 *   1. ENUMERATED COVERAGE — every plan-catalog error key exists on BOTH
 *      locale maps as a non-empty localized string, and the `plan*` key
 *      family equals the enumerated set EXACTLY (no stray `plan*` keys,
 *      no missing keys — new domain errors must join the enumeration).
 *   2. TYPE-SHAPE ALIGNMENT — every enumerated key resolves to a
 *      string-valued member of the compile-time `ErrorsLabels` interface:
 *      the picked slice is typed `Record<PlanCatalogKey, string>`, so a
 *      rename/removal/retype anywhere fails `bun tsgo` before any test runs.
 *   3. PLACEHOLDER PARITY — the family is interpolation-free today; any
 *      value carrying an ICU `{var}` slot fails this suite, forcing both
 *      locales to pin IDENTICAL placeholder names (same contract the
 *      applicant cooldown key is held to).
 *   4. DISCLOSURE AUDIT — zero internal hints: no machine codes, column
 *      identifiers, constraint names, or SQL fragments inside any message.
 *
 * Pure unit tier — NO server boot, NO network, NO DB. Runs via the mandated
 * runner: `bun run test/scripts/run-test.ts shared/locale/plan-catalog-errors.parity.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import { errorsAr } from "@/shared/locale/ar/errors";
import { errorsEn } from "@/shared/locale/en/errors";
import type { ErrorsLabels } from "@/shared/locale/types/errors";

// ─── Enumeration — the planCatalog grouping, explicit and exhaustive ─────────

const PLAN_CATALOG_KEYS = [
  "planNotFound",
  "planAlreadyInactive",
  "planAlreadyActive",
  "planTitleRequired",
  "planTitleTooLong",
  "planSessionCountInvalid",
  "planPriceInvalid",
  "planCurrencyInvalid",
  "planIntervalDaysInvalid",
  "planPatchEmpty",
] as const;

type PlanCatalogKey = (typeof PLAN_CATALOG_KEYS)[number];

/** Compile-time shape gate: every enumerated key MUST be a string on `ErrorsLabels`. */
type PlanCatalogKeyShape = {
  readonly [K in PlanCatalogKey]: ErrorsLabels[K] extends string ? true : never;
};

// A rename/removal/retype anywhere in ErrorsLabels breaks this literal → tsgo fails.
const KEY_SHAPE: PlanCatalogKeyShape = {
  planNotFound: true,
  planAlreadyInactive: true,
  planAlreadyActive: true,
  planTitleRequired: true,
  planTitleTooLong: true,
  planSessionCountInvalid: true,
  planPriceInvalid: true,
  planCurrencyInvalid: true,
  planIntervalDaysInvalid: true,
  planPatchEmpty: true,
};

/** Picks exactly the plan-catalog slice; the picked map is typed
 *  `Record<PlanCatalogKey, string>`, so a missing/retyped key fails `bun tsgo`. */
function pickPlanCatalog(map: ErrorsLabels): Record<PlanCatalogKey, string> {
  return {
    planNotFound: map.planNotFound,
    planAlreadyInactive: map.planAlreadyInactive,
    planAlreadyActive: map.planAlreadyActive,
    planTitleRequired: map.planTitleRequired,
    planTitleTooLong: map.planTitleTooLong,
    planSessionCountInvalid: map.planSessionCountInvalid,
    planPriceInvalid: map.planPriceInvalid,
    planCurrencyInvalid: map.planCurrencyInvalid,
    planIntervalDaysInvalid: map.planIntervalDaysInvalid,
    planPatchEmpty: map.planPatchEmpty,
  };
}

const planCatalogEn = pickPlanCatalog(errorsEn);
const planCatalogAr = pickPlanCatalog(errorsAr);

// ===========================================================================
describe("enumerated coverage — the plan* family on BOTH locales", () => {
  test("the plan* key family equals the enumerated planCatalog set EXACTLY on both maps", () => {
    const enumerated = [...PLAN_CATALOG_KEYS].toSorted((a, b) => a.localeCompare(b));
    for (const map of [errorsEn, errorsAr]) {
      const planKeys = Object.keys(map)
        .filter(key => key.startsWith("plan"))
        .toSorted((a, b) => a.localeCompare(b));
      expect(planKeys).toEqual(enumerated);
      expect(planKeys.length).toBeGreaterThan(0);
    }
  });

  test.each([...PLAN_CATALOG_KEYS])("key `%s` is a non-empty string on BOTH locales", key => {
    expect(Object.hasOwn(errorsEn, key)).toBe(true);
    expect(Object.hasOwn(errorsAr, key)).toBe(true);
    expect(planCatalogEn[key].length).toBeGreaterThan(0);
    expect(planCatalogAr[key].length).toBeGreaterThan(0);
  });
});

// ===========================================================================
describe("structural equality — ar/en alignment + compile-time shape mirror", () => {
  test("identical sorted key sets across the picked ar/en slices", () => {
    const arKeys = Object.keys(planCatalogAr).toSorted((a, b) => a.localeCompare(b));
    const enKeys = Object.keys(planCatalogEn).toSorted((a, b) => a.localeCompare(b));
    expect(arKeys).toHaveLength(PLAN_CATALOG_KEYS.length);
    expect(enKeys).toEqual(arKeys);
  });

  test("KEY_SHAPE compiles AND resolves true for every key (type-shape alignment)", () => {
    for (const key of PLAN_CATALOG_KEYS) {
      expect(KEY_SHAPE[key]).toBe(true);
    }
  });
});

// ===========================================================================
describe("placeholder parity — the family is interpolation-free", () => {
  test("zero ICU `{var}` slots on either locale (re-add only with pinned placeholder names)", () => {
    for (const key of PLAN_CATALOG_KEYS) {
      expect(planCatalogEn[key].includes("{")).toBe(false);
      expect(planCatalogAr[key].includes("{")).toBe(false);
    }
  });
});

// ===========================================================================
describe("disclosure audit — no internal identifiers, constraints, or SQL hints", () => {
  const FORBIDDEN_FRAGMENTS = [
    "plan_", // raw machine-code prefix (PLAN_NOT_FOUND-style) must never surface
    "plans.", // table-qualified reference
    "is_active",
    "deactivated_at",
    "interval_days",
    "session_count",
    "unique",
    "constraint",
    "check_",
    "duplicate key",
    "select ",
    "insert ",
    "sql",
    "23514",
    "23p01",
  ] as const;

  test("no message leaks machine codes, columns, constraint names, or SQL fragments", () => {
    for (const key of PLAN_CATALOG_KEYS) {
      for (const value of [planCatalogEn[key], planCatalogAr[key]]) {
        const haystack = value.toLowerCase();
        for (const fragment of FORBIDDEN_FRAGMENTS) {
          expect(haystack.includes(fragment)).toBe(false);
        }
        // Bare interpolation braces were already barred — double-guard here.
        expect(value.includes("{")).toBe(false);
      }
    }
  });
});
