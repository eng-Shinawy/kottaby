/**
 * `adminFinance`-namespace + admin finance error-key locale verification
 * · ar+en parity gates over the NEW `adminFinance` UI namespace and the
 *   four keys added to the `errors` namespace, plus synchronous resolution
 *   checks through `getTranslations(locale)`.
 *
 * WHAT THIS LOCKS
 *   1. ERRORS REGISTRY PIN — the four admin finance keys
 *      (`withdrawalRequestNotFound`, `withdrawalNotPending`,
 *      `invalidAdjustmentAmount`, `adjustmentReasonRequired`) exist as
 *      NON-EMPTY strings in BOTH locale maps of the `errors` namespace, and
 *      `insufficientBalance` (the REUSED funds-denial copy) stays present
 *      in both.
 *   2. ADMINFINANCE PARITY BELT — the ar/en `adminFinance` leaf maps expose
 *      IDENTICAL key sets with non-empty string values (belt #2: the PRIMARY
 *      parity gate is compile-time typing where BOTH leaf consts are typed
 *      `AdminFinanceLabels`; any missing key fails `bun tsgo`). This suite
 *      keeps the guarantee enforced even if someone loosens that typing
 *      later. The function-valued keys (`paymentsResultCount`,
 *      `pendingWithdrawalsCount`) agree across locales on their argument
 *      arity.
 *   3. REGISTRY WIRING — the `AdminFinance` handle is registered in
 *      `shared/locale/namespaces/index.ts` with the conventional `<ns>.<ns>`
 *      id and its getter resolves to the composed bundle slice; both message
 *      bundles carry `adminFinanceTranslations`.
 *   4. SYNC RESOLUTION — `getTranslations(locale)` (pure, in-memory, never
 *      suspends) resolves a sample of the new keys in BOTH locales.
 *   5. ARABIC-SCRIPT SANITY — sampled Arabic values actually contain Arabic
 *      script (guards a copy paste of English into the `ar` leaf).
 *
 * Mirrors the structure of `shared/locale/wallet-namespace.parity.test.ts`.
 *
 * Pure unit tier — NO server boot, NO network, NO DB.
 */

import { describe, expect, test } from "bun:test";
import { defaultLocale } from "@/shared/locale/AppLocale";
import { adminFinanceAr } from "@/shared/locale/ar/adminFinance";
import { errorsAr } from "@/shared/locale/ar/errors";
import { arMessages } from "@/shared/locale/ar/messages";
import { adminFinanceEn } from "@/shared/locale/en/adminFinance";
import { errorsEn } from "@/shared/locale/en/errors";
import { enMessages } from "@/shared/locale/en/messages";
import { AdminFinance } from "@/shared/locale/namespaces/adminFinance";
import { namespaces } from "@/shared/locale/namespaces/index";
import { getTranslations } from "@/shared/locale/server";

// ─── Mandated registries ─────────────────────────────────────────────────────

/** The admin finance keys mandated on the flat `ErrorsLabels` interface. */
const ADMIN_FINANCE_ERROR_KEYS = [
  "withdrawalRequestNotFound",
  "withdrawalNotPending",
  "invalidAdjustmentAmount",
  "adjustmentReasonRequired",
] as const;
/** The REUSED funds-denial copy (insufficient-balance family — no new key). */
const REUSED_ERROR_KEYS = ["insufficientBalance"] as const;

/** Every string-valued key on the `AdminFinanceLabels` interface (parity belt surface). */
const ADMIN_FINANCE_STRING_KEYS = [
  "metaTitle",
  "metaDescription",
  "title",
  "subtitle",
  "paymentsTab",
  "withdrawalsTab",
  "walletInspectorTab",
  "studentSearchLabel",
  "studentSearchPlaceholder",
  "filtersTitle",
  "statusFilterLabel",
  "gatewayFilterLabel",
  "dateFromLabel",
  "dateToLabel",
  "applyFilters",
  "resetFilters",
  "studentHeader",
  "amountHeader",
  "currencyHeader",
  "gatewayHeader",
  "statusHeader",
  "dateHeader",
  "teacherHeader",
  "walletBalanceHeader",
  "requestedAtHeader",
  "approveAction",
  "rejectAction",
  "actionsHeader",
  "rejectDialogTitle",
  "rejectReasonLabel",
  "rejectReasonPlaceholder",
  "rejectConfirm",
  "rejectCancel",
  "teacherPickerLabel",
  "teacherPickerPlaceholder",
  "balanceLabel",
  "totalEarningsLabel",
  "typeHeader",
  "descriptionHeader",
  "adjustDialogTitle",
  "directionCredit",
  "directionDebit",
  "adjustAmountLabel",
  "adjustReasonLabel",
  "adjustSubmit",
  "loadingLabel",
  "errorTitle",
  "forbiddenTitle",
  "forbiddenBody",
  "paymentsEmpty",
  "withdrawalsEmpty",
  "inspectorEmpty",
  "walletEmptyHint",
] as const;

/** The count-rendering pluralization keys on `AdminFinanceLabels`. */
const ADMIN_FINANCE_COUNT_KEYS = ["paymentsResultCount", "pendingWithdrawalsCount"] as const;

/** Sampled keys for the sync-resolution + Arabic-script gates. */
const ARABIC_SAMPLE_KEYS = ["title", "withdrawalsTab", "rejectDialogTitle", "inspectorEmpty"] as const;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Arabic-script presence probe (U+0600–U+06FF). */
function containsArabicScript(value: string): boolean {
  return /[\u0600-\u06FF]/.test(value);
}

/** Asserts the value is a non-empty string (or an empty string is a fail). */
function expectNonEmptyString(value: unknown, label: string): void {
  expect(typeof value, `${label} must be a string`).toBe("string");
  expect(value, `${label} must be non-empty`).not.toBe("");
}

// ─── 1. Errors registry pins ────────────────────────────────────────────────

describe("errors namespace — admin finance keys pinned in BOTH locales", () => {
  for (const key of [...ADMIN_FINANCE_ERROR_KEYS, ...REUSED_ERROR_KEYS]) {
    test(`en.errors.${key} is a non-empty string`, () => {
      expectNonEmptyString(errorsEn[key], `en.errors.${key}`);
    });
    test(`ar.errors.${key} is a non-empty string`, () => {
      expectNonEmptyString(errorsAr[key], `ar.errors.${key}`);
      expect(containsArabicScript(errorsAr[key]), `ar.errors.${key} must be Arabic script`).toBe(true);
    });
  }
});

// ─── 2. AdminFinance parity belt ─────────────────────────────────────────────

describe("adminFinance namespace — ar/en parity belt", () => {
  for (const key of ADMIN_FINANCE_STRING_KEYS) {
    test(`adminFinance.${key}: non-empty in BOTH locales`, () => {
      expectNonEmptyString(adminFinanceEn[key], `adminFinanceEn.${key}`);
      expectNonEmptyString(adminFinanceAr[key], `adminFinanceAr.${key}`);
    });
  }

  for (const key of ADMIN_FINANCE_COUNT_KEYS) {
    test(`adminFinance.${key} is a 1-arg function in BOTH locales and renders the count`, () => {
      expect(typeof adminFinanceEn[key]).toBe("function");
      expect(typeof adminFinanceAr[key]).toBe("function");
      expect(adminFinanceEn[key]).toHaveLength(1);
      expect(adminFinanceAr[key]).toHaveLength(1);
      expect(adminFinanceEn[key](7)).toContain("7");
      expect(adminFinanceAr[key](7)).toContain("7");
    });
  }

  test("identical key sets across BOTH leaf maps", () => {
    const arKeys = Object.keys(adminFinanceAr).toSorted((a, b) => a.localeCompare(b));
    const enKeys = Object.keys(adminFinanceEn).toSorted((a, b) => a.localeCompare(b));
    expect(arKeys.length).toBeGreaterThan(0);
    expect(enKeys).toEqual(arKeys);
  });

  test("arabic leaf carries Arabic script on sampled keys", () => {
    for (const key of ARABIC_SAMPLE_KEYS) {
      expect(containsArabicScript(adminFinanceAr[key]), `adminFinanceAr.${key} must be Arabic script`).toBe(true);
    }
  });
});

// ─── 3. Registry wiring ──────────────────────────────────────────────────────

describe("adminFinance namespace — registry wiring", () => {
  test("AdminFinance handle registered with the conventional adminFinance.adminFinance id", () => {
    expect(AdminFinance.id).toBe("adminFinance.adminFinance");
    expect(namespaces.AdminFinance).toBe(AdminFinance);
  });

  test("both message bundles carry adminFinanceTranslations", () => {
    expect(enMessages.adminFinanceTranslations).toBe(adminFinanceEn);
    expect(arMessages.adminFinanceTranslations).toBe(adminFinanceAr);
  });

  test("the AdminFinance getter resolves the composed bundle slice", () => {
    expect(AdminFinance.getLabels(enMessages)).toBe(adminFinanceEn);
    expect(AdminFinance.getLabels(arMessages)).toBe(adminFinanceAr);
  });
});

// ─── 4/5. Sync resolution + script sanity ────────────────────────────────────

describe("adminFinance namespace — sync resolution through getTranslations", () => {
  test("en resolves the sampled keys", () => {
    const t = getTranslations("en").adminFinanceTranslations;
    expect(t.title).toBe(adminFinanceEn.title);
    expect(t.withdrawalsTab).toBe(adminFinanceEn.withdrawalsTab);
    expect(t.rejectDialogTitle).toBe(adminFinanceEn.rejectDialogTitle);
  });

  test("ar resolves the sampled keys (Arabic script)", () => {
    const t = getTranslations("ar").adminFinanceTranslations;
    expect(t.title).toBe(adminFinanceAr.title);
    expect(containsArabicScript(t.title)).toBe(true);
    expect(containsArabicScript(t.rejectDialogTitle)).toBe(true);
  });

  test("unknown locales fall back to the DEFAULT locale (ar) without throwing", () => {
    const fallback = getTranslations(defaultLocale).adminFinanceTranslations;
    const t = getTranslations("xx").adminFinanceTranslations;
    expect(t.title).toBe(fallback.title);
  });
});
