/**
 * `audit`-namespace locale-parity verification (DEV3-020 Phase 1).
 *
 * WHAT THIS LOCKS
 *   1. RUNTIME PARITY BELT — the ar/en `audit` leaf maps expose IDENTICAL
 *      key sets with shape-matched values (belt #2: the PRIMARY parity gate
 *      is compile-time typing where BOTH leaf consts are typed
 *      `AuditLabels`; any missing key fails `bun tsgo`. This suite keeps the
 *      guarantee enforced even if someone loosens that typing later).
 *   2. TYPE-SHAPE PARITY — per key, the value kind (string vs formatter
 *      function) is identical across ar/en; plain strings are non-empty and
 *      carry no ICU braces; the single interpolating key (`pageInfo`)
 *      expands EACH of its three numeric arguments in BOTH locales.
 *   3. REGISTRY + SERVER WIRING — the `Audit` handle is registered in
 *      `shared/locale/namespaces/index.ts` under the conventional
 *      `<group>.<ns>` id, its getter resolves the composed bundle slice on
 *      both message bundles, and `getTranslations(locale)` exposes
 *      `auditTranslations.*` (the server `getServerTranslations` path).
 *
 * Mirrors the structure of
 * `shared/locale/payment-verification-namespace.parity.test.ts`.
 *
 * Pure unit tier — NO server boot, NO network, NO DB. Runs via the mandated
 * runner: `bun run test/scripts/run-test.ts shared/locale/audit-namespace.parity.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import { auditAr } from "@/shared/locale/ar/audit";
import { arMessages } from "@/shared/locale/ar/messages";
import { auditEn } from "@/shared/locale/en/audit";
import { enMessages } from "@/shared/locale/en/messages";
import { Audit } from "@/shared/locale/namespaces/audit";
import { namespaces } from "@/shared/locale/namespaces/index";
import { getTranslations } from "@/shared/locale/server";
import type { AuditLabels } from "@/shared/locale/types/audit";

const INTERPOLATING_KEYS = ["pageInfo"] as const;

const EXPECTED_KEY_COUNT = 43;

describe("audit namespace — locale parity", () => {
  test("en and ar expose the SAME key sets", () => {
    const enKeys = Object.keys(auditEn).sort();
    const arKeys = Object.keys(auditAr).sort();
    expect(arKeys).toEqual(enKeys);
  });

  test(`every key is present — exactly ${EXPECTED_KEY_COUNT} keys`, () => {
    expect(Object.keys(auditEn).length).toBe(EXPECTED_KEY_COUNT);
    expect(Object.keys(auditAr).length).toBe(EXPECTED_KEY_COUNT);
  });

  test("plain strings are non-empty and carry no ICU braces (both locales)", () => {
    for (const [locale, labels] of [
      ["en", auditEn],
      ["ar", auditAr],
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
    for (const key of Object.keys(auditEn) as Array<keyof AuditLabels>) {
      const enIsFunction = typeof auditEn[key] === "function";
      const arIsFunction = typeof auditAr[key] === "function";
      expect(enIsFunction, `${key}: en kind`).toBe(arIsFunction);
    }
  });

  test("pageInfo expands ALL THREE numeric arguments (both locales)", () => {
    for (const [locale, labels] of [
      ["en", auditEn],
      ["ar", auditAr],
    ] as const) {
      const rendered = labels.pageInfo(1, 50, 137);
      // Each sentinel digit must survive into the rendered string — a
      // dropped argument would silently corrupt the pagination footer.
      for (const sentinel of ["1", "50", "137"]) {
        expect(rendered.includes(sentinel), `${locale}.pageInfo must render ${sentinel}`).toBeTrue();
      }
    }
  });

  test("INTERPOLATING_KEYS covers exactly the formatter members of the namespace", () => {
    const formatterKeys = (Object.keys(auditEn) as Array<keyof AuditLabels>).filter(
      key => typeof auditEn[key] === "function"
    );
    expect([...formatterKeys].sort()).toEqual([...INTERPOLATING_KEYS].sort());
  });
});

describe("audit namespace — registry + server wiring", () => {
  test("handle is registered under the conventional `<group>.<ns>` id", () => {
    expect(Audit.id).toBe("admin.audit");
    expect(Object.values(namespaces)).toContain(Audit);
  });

  test("getter resolves the composed bundle slice on BOTH message bundles", () => {
    const enSlice = Audit.getLabels(enMessages);
    const arSlice = Audit.getLabels(arMessages);
    expect(enSlice).toBe(enMessages.auditTranslations);
    expect(arSlice).toBe(arMessages.auditTranslations);
  });

  test("server getTranslations exposes auditTranslations for both locales", () => {
    const en = getTranslations("en").auditTranslations;
    const ar = getTranslations("ar").auditTranslations;
    expect(en.pageTitle).toBe(auditEn.pageTitle);
    expect(ar.pageTitle).toBe(auditAr.pageTitle);
  });
});
