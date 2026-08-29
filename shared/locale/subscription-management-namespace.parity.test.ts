/**
 * `subscriptionManagement`-namespace locale-parity verification (DEV1-009).
 *
 * WHAT THIS LOCKS
 *   1. RUNTIME PARITY BELT — the ar/en `subscriptionManagement` leaf maps
 *      expose IDENTICAL key sets with shape-matched values (belt #2: the
 *      PRIMARY parity gate is compile-time typing where BOTH leaf consts
 *      are typed `SubscriptionManagementLabels`; any missing key fails
 *      `bun tsgo`. This suite keeps the guarantee enforced even if someone
 *      loosens that typing later).
 *   2. TYPE-SHAPE PARITY — per key, the value kind (string vs formatter
 *      function) is identical across ar/en; plain strings are non-empty and
 *      carry no ICU braces; the two interpolating keys expand EVERY argument
 *      exactly once in BOTH locales (`cancelDialogBody` carries the
 *      subscriber name + plan title sentinels; `pageInfo` carries the
 *      three-sentinel pagination window, mirroring the audit namespace's
 *      range formatter).
 *   3. REGISTRY + SERVER WIRING — the `SubscriptionManagement` handle is
 *      registered in `shared/locale/namespaces/index.ts` under the
 *      conventional `<group>.<ns>` id, its getter resolves the composed
 *      bundle slice on both message bundles, and `getTranslations(locale)`
 *      exposes `subscriptionManagementTranslations.*` (the server
 *      `getServerTranslations` path). Client-hook
 *      `useAppTranslation(SubscriptionManagement)` consumes the same handle
 *      + getter — wiring proof is the consumer view's job; this stays
 *      structural.
 *
 * Mirrors the structure of
 * `shared/locale/payment-verification-namespace.parity.test.ts` and
 * `shared/locale/audit-namespace.parity.test.ts` (multi-arg formatters).
 *
 * Pure unit tier — NO server boot, NO network, NO DB. Runs via the mandated
 * runner: `bun run test/scripts/run-test.ts shared/locale/subscription-management-namespace.parity.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import { arMessages } from "@/shared/locale/ar/messages";
import { subscriptionManagementAr } from "@/shared/locale/ar/subscriptionManagement";
import { enMessages } from "@/shared/locale/en/messages";
import { subscriptionManagementEn } from "@/shared/locale/en/subscriptionManagement";
import { namespaces } from "@/shared/locale/namespaces/index";
import { SubscriptionManagement } from "@/shared/locale/namespaces/subscriptionManagement";
import { getTranslations } from "@/shared/locale/server";
import type { SubscriptionManagementLabels } from "@/shared/locale/types/subscriptionManagement";

const INTERPOLATING_KEYS = ["cancelDialogBody", "pageInfo"] as const;

const EXPECTED_KEY_COUNT = 40;

const SUBSCRIBER_SENTINEL = "SUBSCRIBER_SENTINEL";
const PLAN_SENTINEL = "PLAN_SENTINEL";

describe("subscriptionManagement namespace — locale parity", () => {
  test("en and ar expose the SAME key sets", () => {
    const enKeys = Object.keys(subscriptionManagementEn).sort();
    const arKeys = Object.keys(subscriptionManagementAr).sort();
    expect(arKeys).toEqual(enKeys);
  });

  test(`every key is present — exactly ${EXPECTED_KEY_COUNT} keys`, () => {
    expect(Object.keys(subscriptionManagementEn)).toHaveLength(EXPECTED_KEY_COUNT);
    expect(Object.keys(subscriptionManagementAr)).toHaveLength(EXPECTED_KEY_COUNT);
  });

  test("plain strings are non-empty and carry no ICU braces (both locales)", () => {
    for (const [locale, labels] of [
      ["en", subscriptionManagementEn],
      ["ar", subscriptionManagementAr],
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
    for (const key of Object.keys(subscriptionManagementEn) as Array<keyof SubscriptionManagementLabels>) {
      const enIsFunction = typeof subscriptionManagementEn[key] === "function";
      const arIsFunction = typeof subscriptionManagementAr[key] === "function";
      expect(enIsFunction, `${key}: en kind`).toBe(arIsFunction);
    }
  });

  test("cancelDialogBody expands BOTH arguments exactly once (both locales)", () => {
    for (const [locale, labels] of [
      ["en", subscriptionManagementEn],
      ["ar", subscriptionManagementAr],
    ] as const) {
      const rendered = labels.cancelDialogBody(SUBSCRIBER_SENTINEL, PLAN_SENTINEL);
      // Each sentinel must survive into the rendered string EXACTLY once —
      // a dropped or duplicated argument corrupts the confirmation copy.
      for (const sentinel of [SUBSCRIBER_SENTINEL, PLAN_SENTINEL]) {
        expect(rendered.includes(sentinel), `${locale}.cancelDialogBody must render the sentinel`).toBeTrue();
        expect(rendered.split(sentinel).length - 1, `${locale}.cancelDialogBody sentinel count`).toBe(1);
      }
    }
  });

  test("pageInfo expands ALL THREE numeric arguments (both locales)", () => {
    for (const [locale, labels] of [
      ["en", subscriptionManagementEn],
      ["ar", subscriptionManagementAr],
    ] as const) {
      const rendered = labels.pageInfo(1, 10, 137);
      // Each sentinel digit must survive into the rendered string — a
      // dropped argument would silently corrupt the pagination footer.
      for (const sentinel of ["1", "10", "137"]) {
        expect(rendered.includes(sentinel), `${locale}.pageInfo must render ${sentinel}`).toBeTrue();
      }
    }
  });

  test("INTERPOLATING_KEYS covers exactly the formatter members of the namespace", () => {
    const formatterKeys = (Object.keys(subscriptionManagementEn) as Array<keyof SubscriptionManagementLabels>).filter(
      key => typeof subscriptionManagementEn[key] === "function"
    );
    expect([...formatterKeys].sort()).toEqual([...INTERPOLATING_KEYS].sort());
  });
});

describe("subscriptionManagement namespace — registry + server wiring", () => {
  test("handle is registered under the conventional `<group>.<ns>` id", () => {
    expect(SubscriptionManagement.id).toBe("admin.subscriptionManagement");
    expect(Object.values(namespaces)).toContain(SubscriptionManagement);
  });

  test("getter resolves the composed bundle slice on BOTH message bundles", () => {
    const enSlice = SubscriptionManagement.getLabels(enMessages);
    const arSlice = SubscriptionManagement.getLabels(arMessages);
    expect(enSlice).toBe(enMessages.subscriptionManagementTranslations);
    expect(arSlice).toBe(arMessages.subscriptionManagementTranslations);
  });

  test("server getTranslations exposes subscriptionManagementTranslations for both locales", () => {
    const en = getTranslations("en").subscriptionManagementTranslations;
    const ar = getTranslations("ar").subscriptionManagementTranslations;
    expect(en.pageTitle).toBe(subscriptionManagementEn.pageTitle);
    expect(ar.pageTitle).toBe(subscriptionManagementAr.pageTitle);
  });
});
