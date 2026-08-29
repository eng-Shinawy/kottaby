/**
 * `studentPlans`-namespace locale-parity verification.
 *
 * WHAT THIS LOCKS
 *   1. RUNTIME PARITY BELT — the ar/en `studentPlans` leaf maps expose
 *      IDENTICAL key sets with shape-matched values (belt #2: the PRIMARY
 *      parity gate is compile-time typing where BOTH leaf consts are typed
 *      `StudentPlansLabels`; any missing key fails `bun tsgo`. This suite
 *      keeps the guarantee enforced even if someone loosens that typing
 *      later).
 *   2. TYPE-SHAPE PARITY — per key, the value kind (string vs formatter
 *      function) is identical across ar/en; plain strings are non-empty and
 *      carry no ICU braces; every interpolating key expands its single
 *      argument EXACTLY once in BOTH locales.
 *   3. REGISTRY + SERVER WIRING — the `StudentPlans` handle is registered
 *      in `shared/locale/namespaces/index.ts` under the conventional
 *      `<group>.<ns>` id, its getter resolves the composed bundle slice on
 *      both message bundles, and `getTranslations(locale)` exposes
 *      `studentPlansTranslations.*` (the server `getServerTranslations`
 *      path). Client-hook `useAppTranslation(StudentPlans)` consumes the
 *      same handle + getter — wiring proof is the consumer view's job;
 *      this stays structural.
 *
 * Mirrors the structure of `shared/locale/plans-namespace.parity.test.ts`.
 *
 * Pure unit tier — NO server boot, NO network, NO DB. Runs via the mandated
 * runner: `bun run test/scripts/run-test.ts shared/locale/student-plans-namespace.parity.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import { arMessages } from "@/shared/locale/ar/messages";
import { studentPlansAr } from "@/shared/locale/ar/studentPlans";
import { enMessages } from "@/shared/locale/en/messages";
import { studentPlansEn } from "@/shared/locale/en/studentPlans";
import { namespaces } from "@/shared/locale/namespaces/index";
import { StudentPlans } from "@/shared/locale/namespaces/studentPlans";
import { getTranslations } from "@/shared/locale/server";
import type { StudentPlansLabels } from "@/shared/locale/types/studentPlans";

const INTERPOLATING_KEYS = ["intervalDays", "purchaseDialogBody"] as const;

const EXPECTED_KEY_COUNT = 19;

const TITLE_SENTINEL = "SENTINEL";
const DAYS_SENTINEL = 30;

/** Narrows one locale slot to the day-count formatter kind (undefined otherwise). */
function dayFormatterOf(
  value: string | ((days: number) => string) | undefined
): ((days: number) => string) | undefined {
  return typeof value === "function" ? value : undefined;
}

/** Narrows one locale slot to the plan-title formatter kind (undefined otherwise). */
function titleFormatterOf(
  value: string | ((planTitle: string) => string) | undefined
): ((planTitle: string) => string) | undefined {
  return typeof value === "function" ? value : undefined;
}

describe("studentPlans namespace — locale parity", () => {
  test("en and ar expose the SAME key sets", () => {
    const enKeys = Object.keys(studentPlansEn).sort();
    const arKeys = Object.keys(studentPlansAr).sort();
    expect(arKeys).toEqual(enKeys);
  });

  test(`every key is present — exactly ${EXPECTED_KEY_COUNT} keys`, () => {
    expect(Object.keys(studentPlansEn).length).toBe(EXPECTED_KEY_COUNT);
    expect(Object.keys(studentPlansAr).length).toBe(EXPECTED_KEY_COUNT);
  });

  test("plain strings are non-empty and carry no ICU braces (both locales)", () => {
    for (const [locale, labels] of [
      ["en", studentPlansEn],
      ["ar", studentPlansAr],
    ] as const) {
      for (const [key, value] of Object.entries(labels)) {
        if (typeof value !== "string") continue;
        expect(value.length, `${locale}.${key} must be non-empty`).toBeGreaterThan(0);
        expect(value.includes("{"), `${locale}.${key} must not use ICU braces`).toBeFalse();
        expect(value.includes("}"), `${locale}.${key} must not use ICU braces`).toBeFalse();
      }
    }
  });

  test("type-shape parity — formatter keys are formatters in BOTH locales, strings in BOTH", () => {
    for (const key of Object.keys(studentPlansEn) as Array<keyof StudentPlansLabels>) {
      const enIsFunction = typeof studentPlansEn[key] === "function";
      const arIsFunction = typeof studentPlansAr[key] === "function";
      expect(enIsFunction, `${key}: en kind`).toBe(arIsFunction);
    }
  });

  test("intervalDays expands its single day-count argument EXACTLY once (both locales)", () => {
    for (const [locale, labels] of [
      ["en", studentPlansEn],
      ["ar", studentPlansAr],
    ] as const) {
      const formatter = dayFormatterOf(labels.intervalDays);
      expect(formatter, `${locale}.intervalDays must be a function`).toBeDefined();
      const rendered = formatter?.(DAYS_SENTINEL);
      if (rendered === undefined) {
        throw new Error(`${locale}.intervalDays must be a day-count formatter`);
      }
      expect(rendered).toContain(String(DAYS_SENTINEL));
      expect(rendered.split(String(DAYS_SENTINEL)).length - 1).toBe(1);
    }
  });

  test("purchaseDialogBody expands its single plan-title argument EXACTLY once (both locales)", () => {
    for (const [locale, labels] of [
      ["en", studentPlansEn],
      ["ar", studentPlansAr],
    ] as const) {
      const formatter = titleFormatterOf(labels.purchaseDialogBody);
      expect(formatter, `${locale}.purchaseDialogBody must be a function`).toBeDefined();
      const rendered = formatter?.(TITLE_SENTINEL);
      if (rendered === undefined) {
        throw new Error(`${locale}.purchaseDialogBody must be a plan-title formatter`);
      }
      expect(rendered).toContain(TITLE_SENTINEL);
      expect(rendered.split(TITLE_SENTINEL).length - 1).toBe(1);
    }
  });

  test("INTERPOLATING_KEYS covers exactly the formatter members of the namespace", () => {
    const formatterKeys = (Object.keys(studentPlansEn) as Array<keyof StudentPlansLabels>).filter(
      key => typeof studentPlansEn[key] === "function"
    );
    expect([...formatterKeys].sort()).toEqual([...INTERPOLATING_KEYS].sort());
  });
});

describe("studentPlans namespace — registry + server wiring", () => {
  test("handle is registered under the conventional `<group>.<ns>` id", () => {
    expect(StudentPlans.id).toBe("plans.studentPlans");
    expect(Object.values(namespaces)).toContain(StudentPlans);
  });

  test("getter resolves the composed bundle slice on BOTH message bundles", () => {
    const enSlice = StudentPlans.getLabels(enMessages);
    const arSlice = StudentPlans.getLabels(arMessages);
    expect(enSlice).toBe(enMessages.studentPlansTranslations);
    expect(arSlice).toBe(arMessages.studentPlansTranslations);
  });

  test("server getTranslations exposes studentPlansTranslations for both locales", () => {
    const en = getTranslations("en").studentPlansTranslations;
    const ar = getTranslations("ar").studentPlansTranslations;
    expect(en.pageTitle).toBe(studentPlansEn.pageTitle);
    expect(ar.pageTitle).toBe(studentPlansAr.pageTitle);
  });
});
