/**
 * Lessons namespace parity test — verifies structural and content parity
 * between EN and AR translations for both `lessonsTranslations` and
 * `errors.lessonCatalog`, plus the Arabic-script probe on the AR leaves and
 * the compile-time handle wiring.
 */

import { describe, expect, test } from "bun:test";
import { errorsAr } from "@/shared/locale/ar/errors";
import { lessonsAr } from "@/shared/locale/ar/lessons";
import { errorsEn } from "@/shared/locale/en/errors";
import { lessonsEn } from "@/shared/locale/en/lessons";
import { ARABIC_SCRIPT, namespaceParityKit } from "@/shared/locale/namespace-parity.helpers";
import { Lessons } from "@/shared/locale/namespaces/lessons";
import { getTranslations } from "@/shared/locale/server";

const lessonsKit = namespaceParityKit("lessons");

describe("Lessons Namespace Parity", () => {
  test("lessons translations have identical non-empty leaf sets across en and ar", () => {
    const enPaths = lessonsKit.sortedLeafPathsOf(lessonsEn);
    const arPaths = lessonsKit.sortedLeafPathsOf(lessonsAr);

    expect(enPaths.length).toBeGreaterThan(0);
    expect(enPaths).toEqual(arPaths);

    for (const path of enPaths) {
      expect(lessonsKit.leafValueOf(lessonsEn, path, "en").trim().length).toBeGreaterThan(0);
      expect(lessonsKit.leafValueOf(lessonsAr, path, "ar").trim().length).toBeGreaterThan(0);
    }
  });

  test("errors.lessonCatalog translations have identical non-empty keys across en and ar", () => {
    const enKeys = Object.keys(errorsEn.lessonCatalog).toSorted((a, b) => a.localeCompare(b));
    const arKeys = Object.keys(errorsAr.lessonCatalog).toSorted((a, b) => a.localeCompare(b));

    expect(enKeys).toHaveLength(5);
    expect(enKeys).toEqual(arKeys);

    for (const [key, enValue] of Object.entries(errorsEn.lessonCatalog)) {
      expect(enValue.trim().length).toBeGreaterThan(0);
      const arValue: unknown = Reflect.get(errorsAr.lessonCatalog, key);
      if (typeof arValue === "string") {
        expect(arValue.trim().length).toBeGreaterThan(0);
      }
    }
  });

  test("every AR lessons leaf carries Arabic script", () => {
    for (const path of lessonsKit.sortedLeafPathsOf(lessonsAr)) {
      expect(ARABIC_SCRIPT.test(lessonsKit.leafValueOf(lessonsAr, path, "ar"))).toBe(true);
    }
  });

  test("every AR errors.lessonCatalog leaf carries Arabic script", () => {
    for (const arValue of Object.values(errorsAr.lessonCatalog)) {
      expect(ARABIC_SCRIPT.test(arValue)).toBe(true);
    }
  });

  test("new lessons strings carry ZERO ICU placeholders (static labels only)", () => {
    for (const path of lessonsKit.sortedLeafPathsOf(lessonsEn)) {
      expect(lessonsKit.leafValueOf(lessonsEn, path, "en")).not.toMatch(/\{\w+\}/);
    }
  });

  test("server translation resolution exposes lessonsTranslations correctly", () => {
    const enT = getTranslations("en");
    const arT = getTranslations("ar");

    expect(enT.lessonsTranslations.pageTitle).toBe("Lessons");
    expect(arT.lessonsTranslations.pageTitle).toBe("الدروس");
  });

  test("Lessons namespace handle resolves correct property path", () => {
    expect(Lessons.id).toBe("lessons.lessons");
    const enT = getTranslations("en");
    expect(Lessons.getLabels(enT).pageTitle).toBe("Lessons");
  });
});
