/**
 * `plans`-namespace locale-parity verification.
 *
 * WHAT THIS LOCKS
 *   1. RUNTIME PARITY BELT — the ar/en `plans` leaf maps expose IDENTICAL key
 *      sets with shape-matched values (belt #2: the PRIMARY parity gate is
 *      compile-time typing where BOTH leaf consts are typed `PlansLabels`;
 *      any missing key fails `bun tsgo`. This suite keeps the guarantee
 *      enforced even if someone loosens that typing later).
 *   2. TYPE-SHAPE PARITY — per key, the value kind (string vs title-formatter
 *      function) is identical across ar/en; plain strings are non-empty and
 *      carry no ICU braces (dashboard-style closures are the only
 *      interpolation mechanism on this namespace); every interpolating key
 *      expands its single plan-title argument EXACTLY once in BOTH locales.
 *   3. REGISTRY + SERVER WIRING — the `Plans` handle is registered in
 *      `shared/locale/namespaces/index.ts` under the conventional `<ns>.<ns>`
 *      id, its getter resolves the composed bundle slice on both message
 *      bundles, and `getTranslations(locale)` exposes `plansTranslations.*`
 *      (the server `getServerTranslations` path). Client-hook
 *      `useAppTranslation(Plans)` consumes the same handle + getter — wiring
 *      proof is the Phase-4 consumers' job; this stays structural.
 *
 * Mirrors the structure of `shared/locale/applicant-namespace.parity.test.ts`.
 *
 * Pure unit tier — NO server boot, NO network, NO DB. Runs via the mandated
 * runner: `bun run test/scripts/run-test.ts shared/locale/plans-namespace.parity.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import { arMessages } from "@/shared/locale/ar/messages";
import { plansAr } from "@/shared/locale/ar/plans";
import { enMessages } from "@/shared/locale/en/messages";
import { plansEn } from "@/shared/locale/en/plans";
import { namespaces } from "@/shared/locale/namespaces/index";
import { Plans } from "@/shared/locale/namespaces/plans";
import { getTranslations } from "@/shared/locale/server";
import type { PlansLabels } from "@/shared/locale/types/plans";

const INTERPOLATING_KEYS = [
  "deactivateConfirmBody",
  "activateConfirmBody",
  "toastCreated",
  "toastUpdated",
  "toastActivated",
  "toastDeactivated",
] as const;

const EXPECTED_KEY_COUNT = 47;

const TITLE_SENTINEL = "PLAN_TITLE_SENTINEL";

/** Number of times `needle` occurs in `haystack` (no dedup). */
function occurrenceCount(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** Narrows one locale slot to the title-formatter kind (undefined otherwise). */
function titleFormatterOf(
  value: string | ((planTitle: string) => string) | undefined
): ((planTitle: string) => string) | undefined {
  if (typeof value === "function") {
    return value;
  }
  return undefined;
}

/**
 * Asserts per-slot sanity across one locale leaf and returns key → kind:
 * "formatter" for the plan-title closures, "string" for plain labels.
 */
function slotKindsOf(localeMap: PlansLabels): Map<string, "string" | "formatter"> {
  const kinds = new Map<string, "string" | "formatter">();
  for (const [key, value] of Object.entries(localeMap)) {
    if (typeof value === "string") {
      expect(value.length).toBeGreaterThan(0);
      // Dashboard-style closures own interpolation here — plain strings must
      // stay free of ICU braces so no formatter coupling sneaks in.
      expect(value.includes("{")).toBe(false);
      kinds.set(key, "string");
    } else {
      const expanded = value(TITLE_SENTINEL);
      expect(expanded.length).toBeGreaterThan(0);
      expect(expanded).not.toBe(TITLE_SENTINEL);
      kinds.set(key, "formatter");
    }
  }
  return kinds;
}

// ===========================================================================
describe("compile-time parity mirror — ar/en plans key sets agree", () => {
  test("identical sorted key sets across BOTH locale sources", () => {
    const arKeys = Object.keys(plansAr).toSorted((a, b) => a.localeCompare(b));
    const enKeys = Object.keys(plansEn).toSorted((a, b) => a.localeCompare(b));

    expect(arKeys).toHaveLength(EXPECTED_KEY_COUNT);
    expect(enKeys).toEqual(arKeys);
  });

  test("every value is a non-empty localized slot with matching value kind on BOTH maps", () => {
    const arKinds = slotKindsOf(plansAr);
    const enKinds = slotKindsOf(plansEn);
    expect(enKinds).toEqual(arKinds);
  });
});

// ===========================================================================
describe("plan-title interpolation pin — single sentinel expansion, BOTH locales", () => {
  test.each([...INTERPOLATING_KEYS])("%s expands its title argument exactly once in BOTH locales", key => {
    const arFormatter = titleFormatterOf(Reflect.get(plansAr, key));
    const enFormatter = titleFormatterOf(Reflect.get(plansEn, key));
    expect(arFormatter).toBeDefined();
    expect(enFormatter).toBeDefined();

    const arExpanded = arFormatter?.(TITLE_SENTINEL);
    const enExpanded = enFormatter?.(TITLE_SENTINEL);
    if (arExpanded === undefined || enExpanded === undefined) {
      throw new Error(`plans.${key} must be a plan-title formatter in BOTH locales`);
    }
    expect(occurrenceCount(arExpanded, TITLE_SENTINEL)).toBe(1);
    expect(occurrenceCount(enExpanded, TITLE_SENTINEL)).toBe(1);
  });

  test("interpolator set is exactly the six declared title surfaces (no hidden extras)", () => {
    const functionKeys = [...slotKindsOf(plansAr).entries()]
      .filter(([, kind]) => kind === "formatter")
      .map(([key]) => key);
    expect(functionKeys.toSorted((a, b) => a.localeCompare(b))).toEqual(
      [...INTERPOLATING_KEYS].toSorted((a, b) => a.localeCompare(b))
    );
  });
});

// ===========================================================================
describe("registry + bundle + server wiring", () => {
  test("namespaces registry exposes the Plans handle with the `<ns>.<ns>` id convention", () => {
    expect(Object.hasOwn(namespaces, "Plans")).toBe(true);
    expect(Plans.id).toBe("plans.plans");
  });

  test("handle getter resolves the composed bundle slice (both locales)", () => {
    expect(Plans.getLabels(enMessages)).toBe(enMessages.plansTranslations);
    expect(Plans.getLabels(arMessages)).toBe(arMessages.plansTranslations);
  });

  test("`plansTranslations` exists on BOTH message bundles", () => {
    expect(Object.hasOwn(enMessages, "plansTranslations")).toBe(true);
    expect(Object.hasOwn(arMessages, "plansTranslations")).toBe(true);
  });

  test("server `getTranslations(locale)` exposes `t.plansTranslations.*` for both locales", () => {
    expect(getTranslations("en").plansTranslations).toBe(plansEn);
    expect(getTranslations("ar").plansTranslations).toBe(plansAr);
    expect(typeof getTranslations("en").plansTranslations.pageTitle).toBe("string");
    expect(typeof getTranslations("ar").plansTranslations.pageTitle).toBe("string");
  });

  test("handle satisfies the shape consumed by useAppTranslation(Plans) (id + getter)", () => {
    expect(typeof Plans.id).toBe("string");
    expect(typeof Plans.getLabels).toBe("function");
  });
});
