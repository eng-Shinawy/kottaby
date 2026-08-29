/**
 * `paymentVerification`-namespace locale-parity verification.
 *
 * WHAT THIS LOCKS
 *   1. RUNTIME PARITY BELT — the ar/en `paymentVerification` leaf maps
 *      expose IDENTICAL key sets with shape-matched values (belt #2: the
 *      PRIMARY parity gate is compile-time typing where BOTH leaf consts
 *      are typed `PaymentVerificationLabels`; any missing key fails
 *      `bun tsgo`. This suite keeps the guarantee enforced even if someone
 *      loosens that typing later).
 *   2. TYPE-SHAPE PARITY — per key, the value kind (string vs formatter
 *      function) is identical across ar/en; plain strings are non-empty and
 *      carry no ICU braces; the single interpolating key (`verifyDialogBody`)
 *      expands its single argument EXACTLY once in BOTH locales.
 *   3. REGISTRY + SERVER WIRING — the `PaymentVerification` handle is
 *      registered in `shared/locale/namespaces/index.ts` under the
 *      conventional `<group>.<ns>` id, its getter resolves the composed
 *      bundle slice on both message bundles, and `getTranslations(locale)`
 *      exposes `paymentVerificationTranslations.*` (the server
 *      `getServerTranslations` path). Client-hook
 *      `useAppTranslation(PaymentVerification)` consumes the same handle +
 *      getter — wiring proof is the consumer view's job; this stays
 *      structural.
 *
 * Mirrors the structure of `shared/locale/student-plans-namespace.parity.test.ts`.
 *
 * Pure unit tier — NO server boot, NO network, NO DB. Runs via the mandated
 * runner: `bun run test/scripts/run-test.ts shared/locale/payment-verification-namespace.parity.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import { arMessages } from "@/shared/locale/ar/messages";
import { paymentVerificationAr } from "@/shared/locale/ar/paymentVerification";
import { enMessages } from "@/shared/locale/en/messages";
import { paymentVerificationEn } from "@/shared/locale/en/paymentVerification";
import { namespaces } from "@/shared/locale/namespaces/index";
import { PaymentVerification } from "@/shared/locale/namespaces/paymentVerification";
import { getTranslations } from "@/shared/locale/server";
import type { PaymentVerificationLabels } from "@/shared/locale/types/paymentVerification";

const INTERPOLATING_KEYS = ["verifyDialogBody"] as const;

const EXPECTED_KEY_COUNT = 25;

const TITLE_SENTINEL = "SENTINEL";

/** Narrows one locale slot to the plan-title formatter kind (undefined otherwise). */
function titleFormatterOf(
  value: string | ((planTitle: string) => string) | undefined
): ((planTitle: string) => string) | undefined {
  return typeof value === "function" ? value : undefined;
}

describe("paymentVerification namespace — locale parity", () => {
  test("en and ar expose the SAME key sets", () => {
    const enKeys = Object.keys(paymentVerificationEn).sort();
    const arKeys = Object.keys(paymentVerificationAr).sort();
    expect(arKeys).toEqual(enKeys);
  });

  test(`every key is present — exactly ${EXPECTED_KEY_COUNT} keys`, () => {
    expect(Object.keys(paymentVerificationEn).length).toBe(EXPECTED_KEY_COUNT);
    expect(Object.keys(paymentVerificationAr).length).toBe(EXPECTED_KEY_COUNT);
  });

  test("plain strings are non-empty and carry no ICU braces (both locales)", () => {
    for (const [locale, labels] of [
      ["en", paymentVerificationEn],
      ["ar", paymentVerificationAr],
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
    for (const key of Object.keys(paymentVerificationEn) as Array<keyof PaymentVerificationLabels>) {
      const enIsFunction = typeof paymentVerificationEn[key] === "function";
      const arIsFunction = typeof paymentVerificationAr[key] === "function";
      expect(enIsFunction, `${key}: en kind`).toBe(arIsFunction);
    }
  });

  test("verifyDialogBody expands its single plan-title argument EXACTLY once (both locales)", () => {
    for (const [locale, labels] of [
      ["en", paymentVerificationEn],
      ["ar", paymentVerificationAr],
    ] as const) {
      const formatter = titleFormatterOf(labels.verifyDialogBody);
      expect(formatter, `${locale}.verifyDialogBody must be a function`).toBeDefined();
      const rendered = formatter?.(TITLE_SENTINEL);
      if (rendered === undefined) {
        throw new Error(`${locale}.verifyDialogBody must be a plan-title formatter`);
      }
      expect(rendered).toContain(TITLE_SENTINEL);
      expect(rendered.split(TITLE_SENTINEL).length - 1).toBe(1);
    }
  });

  test("INTERPOLATING_KEYS covers exactly the formatter members of the namespace", () => {
    const formatterKeys = (Object.keys(paymentVerificationEn) as Array<keyof PaymentVerificationLabels>).filter(
      key => typeof paymentVerificationEn[key] === "function"
    );
    expect([...formatterKeys].sort()).toEqual([...INTERPOLATING_KEYS].sort());
  });
});

describe("paymentVerification namespace — registry + server wiring", () => {
  test("handle is registered under the conventional `<group>.<ns>` id", () => {
    expect(PaymentVerification.id).toBe("admin.paymentVerification");
    expect(Object.values(namespaces)).toContain(PaymentVerification);
  });

  test("getter resolves the composed bundle slice on BOTH message bundles", () => {
    const enSlice = PaymentVerification.getLabels(enMessages);
    const arSlice = PaymentVerification.getLabels(arMessages);
    expect(enSlice).toBe(enMessages.paymentVerificationTranslations);
    expect(arSlice).toBe(arMessages.paymentVerificationTranslations);
  });

  test("server getTranslations exposes paymentVerificationTranslations for both locales", () => {
    const en = getTranslations("en").paymentVerificationTranslations;
    const ar = getTranslations("ar").paymentVerificationTranslations;
    expect(en.pageTitle).toBe(paymentVerificationEn.pageTitle);
    expect(ar.pageTitle).toBe(paymentVerificationAr.pageTitle);
  });
});
