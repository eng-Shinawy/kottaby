/**
 * Plans namespace parity test — verifies structural and content parity
 * between EN and AR translations for both `plansTranslations` and `errors.planCatalog`.
 */

import { describe, expect, test } from "bun:test";
import { errorsAr } from "@/shared/locale/ar/errors";
import { plansAr } from "@/shared/locale/ar/plans";
import { errorsEn } from "@/shared/locale/en/errors";
import { plansEn } from "@/shared/locale/en/plans";
import { Plans } from "@/shared/locale/namespaces/plans";
import { getTranslations } from "@/shared/locale/server";

describe("Plans Namespace Parity", () => {
  test("plans translations have identical non-empty keys across en and ar", () => {
    const enKeys = Object.keys(plansEn).toSorted((a, b) => a.localeCompare(b));
    const arKeys = Object.keys(plansAr).toSorted((a, b) => a.localeCompare(b));

    expect(enKeys).toEqual(arKeys);

    for (const key of enKeys) {
      const enVal: unknown = Reflect.get(plansEn, key);
      const arVal: unknown = Reflect.get(plansAr, key);
      expect(typeof enVal).toBe("string");
      expect(typeof arVal).toBe("string");
      if (typeof enVal === "string") {
        expect(enVal.trim().length).toBeGreaterThan(0);
      }
      if (typeof arVal === "string") {
        expect(arVal.trim().length).toBeGreaterThan(0);
      }
    }
  });

  test("errors.planCatalog translations have identical non-empty keys across en and ar", () => {
    const enKeys = Object.keys(errorsEn.planCatalog).toSorted((a, b) => a.localeCompare(b));
    const arKeys = Object.keys(errorsAr.planCatalog).toSorted((a, b) => a.localeCompare(b));

    expect(enKeys).toEqual(arKeys);

    for (const key of enKeys) {
      const enVal: unknown = Reflect.get(errorsEn.planCatalog, key);
      const arVal: unknown = Reflect.get(errorsAr.planCatalog, key);
      expect(typeof enVal).toBe("string");
      expect(typeof arVal).toBe("string");
      if (typeof enVal === "string") {
        expect(enVal.trim().length).toBeGreaterThan(0);
      }
      if (typeof arVal === "string") {
        expect(arVal.trim().length).toBeGreaterThan(0);
      }
    }
  });

  test("server translation resolution exposes plansTranslations correctly", () => {
    const enT = getTranslations("en");
    const arT = getTranslations("ar");

    expect(enT.plansTranslations.pageTitle).toBe("Subscription Plans");
    expect(arT.plansTranslations.pageTitle).toBe("خطط الاشتراك");
  });

  test("Plans namespace handle resolves correct property path", () => {
    expect(Plans.id).toBe("plans.plans");
    const enT = getTranslations("en");
    expect(Plans.getLabels(enT).pageTitle).toBe("Subscription Plans");
  });
});
