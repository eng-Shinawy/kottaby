/**
 * `checkout`-namespace locale verification — the student
 * subscription-purchase funnel copy (plan catalog, purchase confirmation
 * dialog, payment result branches, my-subscriptions list).
 *
 * WHAT THIS LOCKS
 *   1. CHECKOUT PARITY BELT — the ar/en `checkout` leaf maps expose
 *      IDENTICAL key sets (runtime belt; the PRIMARY parity gate is
 *      compile-time typing where BOTH leaf consts are typed
 *      `CheckoutLabels` — any missing key fails `bun tsgo`). Every
 *      string-valued key is a NON-EMPTY string in BOTH locales.
 *   2. INTERPOLATION CONTRACT — the function-valued keys
 *      (`sessionsIncludedLine`, `validityLine`, `laneCreditLine`) are
 *      functions of the SAME arity in BOTH locales, interpolate their
 *      argument into the rendered string, and keep the Arabic
 *      singular/dual/plural grammar arms distinct (a collapsed branch
 *      fails the distinctness pins).
 *   3. REGISTRY WIRING — the `Checkout` handle is registered in
 *      `shared/locale/namespaces/index.ts` with the conventional
 *      `<ns>.<ns>` id and its getter resolves to the composed bundle
 *      slice; both message bundles carry `checkoutTranslations`.
 *   4. SYNC RESOLUTION — `getTranslations(locale)` (pure, in-memory,
 *      never suspends) resolves sampled keys in BOTH locales and unknown
 *      locales fall back to the DEFAULT locale.
 *   5. ARABIC-SCRIPT SANITY — sampled Arabic values actually contain
 *      Arabic script (guards a copy paste of English into the `ar` leaf).
 *
 * Mirrors the structure of `shared/locale/wallet-namespace.parity.test.ts`.
 *
 * Pure unit tier — NO server boot, NO network, NO DB.
 */

import { describe, expect, test } from "bun:test";
import { defaultLocale } from "@/shared/locale/AppLocale";
import { checkoutAr } from "@/shared/locale/ar/checkout";
import { arMessages } from "@/shared/locale/ar/messages";
import { checkoutEn } from "@/shared/locale/en/checkout";
import { enMessages } from "@/shared/locale/en/messages";
import { Checkout } from "@/shared/locale/namespaces/checkout";
import { namespaces } from "@/shared/locale/namespaces/index";
import { getTranslations } from "@/shared/locale/server";

// ─── Mandated registries ─────────────────────────────────────────────────────

/** Every string-valued key on the `CheckoutLabels` interface (parity belt surface). */
const CHECKOUT_STRING_KEYS = [
  "pageTitle",
  "pageSubtitle",
  "metaTitle",
  "metaDescription",
  "buyButton",
  "laneHifz",
  "laneTajweed",
  "laneReviews",
  "emptyTitle",
  "emptyBody",
  "confirmDialogTitle",
  "planLabel",
  "sessionsLabel",
  "validityLabel",
  "amountDueLabel",
  "confirmDialogSecureNote",
  "confirmButton",
  "confirmBusyButton",
  "cancelButton",
  "purchaseCompletedNotice",
  "resultMetaTitle",
  "resultCheckingTitle",
  "resultCheckingBody",
  "resultSuccessTitle",
  "resultSuccessBody",
  "resultFailedTitle",
  "resultFailedBody",
  "resultPendingTitle",
  "resultPendingBody",
  "retryButton",
  "viewSubscriptionsButton",
  "subscriptionsPageTitle",
  "subscriptionsPageSubtitle",
  "subscriptionsMetaTitle",
  "subscriptionsMetaDescription",
  "statusColumn",
  "startDateColumn",
  "endDateColumn",
  "emptyValue",
  "statusActive",
  "statusPending",
  "statusExpired",
  "statusCancelled",
  "statusSuspended",
  "statusFailed",
  "failedPaymentGuidance",
  "subscriptionsEmptyTitle",
  "subscriptionsEmptyBody",
  "browsePlansButton",
  "genericError",
] as const;

/**
 * Function-valued keys with their required argument arity — the typed
 * interpolation surface (the labels interface pins the argument TYPES;
 * this belt pins that both locales consume exactly the same arity).
 */
const CHECKOUT_FUNCTION_KEYS = [
  ["sessionsIncludedLine", 1],
  ["validityLine", 1],
  ["laneCreditLine", 1],
] as const;

/** Sampled keys for the sync-resolution + Arabic-script gates. */
const ARABIC_SAMPLE_KEYS = [
  "pageTitle",
  "buyButton",
  "confirmDialogTitle",
  "resultFailedTitle",
  "statusActive",
  "failedPaymentGuidance",
  "subscriptionsEmptyTitle",
] as const;

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

// ─── 1. Checkout parity belt ─────────────────────────────────────────────────

describe("checkout namespace — ar/en parity belt", () => {
  test("ar and en leaves expose IDENTICAL key sets", () => {
    const enKeys = Object.keys(checkoutEn).toSorted((a, b) => a.localeCompare(b));
    const arKeys = Object.keys(checkoutAr).toSorted((a, b) => a.localeCompare(b));
    expect(enKeys).toEqual(arKeys);
  });

  for (const key of CHECKOUT_STRING_KEYS) {
    test(`checkout.${key}: non-empty in BOTH locales`, () => {
      expectNonEmptyString(checkoutEn[key], `checkoutEn.${key}`);
      expectNonEmptyString(checkoutAr[key], `checkoutAr.${key}`);
    });
  }

  test("arabic leaf carries Arabic script on sampled keys", () => {
    for (const key of ARABIC_SAMPLE_KEYS) {
      expect(containsArabicScript(checkoutAr[key]), `checkoutAr.${key} must be Arabic script`).toBe(true);
    }
  });
});

// ─── 2. Interpolation contract ───────────────────────────────────────────────

describe("checkout namespace — interpolation contract", () => {
  for (const [key, arity] of CHECKOUT_FUNCTION_KEYS) {
    test(`checkout.${key}: a ${arity}-arg function in BOTH locales`, () => {
      expect(typeof Reflect.get(checkoutEn, key), `checkoutEn.${key} must be a function`).toBe("function");
      expect(typeof Reflect.get(checkoutAr, key), `checkoutAr.${key} must be a function`).toBe("function");
      expect(Reflect.get(checkoutEn, key)).toHaveLength(arity);
      expect(Reflect.get(checkoutAr, key)).toHaveLength(arity);
    });
  }

  test("sessionsIncludedLine interpolates the count in BOTH locales", () => {
    expect(checkoutEn.sessionsIncludedLine(8)).toContain("8");
    expect(checkoutAr.sessionsIncludedLine(8)).toContain("8");
  });

  test("sessionsIncludedLine keeps the English singular/plural arms apart", () => {
    expect(checkoutEn.sessionsIncludedLine(1)).toBe("Includes 1 session");
    expect(checkoutEn.sessionsIncludedLine(2)).toBe("Includes 2 sessions");
  });

  test("sessionsIncludedLine keeps the Arabic singular/dual/plural grammar arms apart", () => {
    expect(checkoutAr.sessionsIncludedLine(1)).toBe("تشمل حصة واحدة");
    expect(checkoutAr.sessionsIncludedLine(2)).toBe("تشمل حصتين");
    expect(checkoutAr.sessionsIncludedLine(8)).toBe("تشمل 8 حصص");
    expect(checkoutAr.sessionsIncludedLine(12)).toBe("تشمل 12 حصة");
  });

  test("validityLine interpolates the day count in BOTH locales", () => {
    expect(checkoutEn.validityLine(30)).toContain("30");
    expect(checkoutAr.validityLine(30)).toContain("30");
  });

  test("validityLine keeps the English singular/plural arms apart", () => {
    expect(checkoutEn.validityLine(1)).toBe("Valid for 1 day");
    expect(checkoutEn.validityLine(2)).toBe("Valid for 2 days");
  });

  test("validityLine keeps the Arabic singular/dual/plural grammar arms apart", () => {
    expect(checkoutAr.validityLine(1)).toBe("صالحة لمدة يوم واحد");
    expect(checkoutAr.validityLine(2)).toBe("صالحة لمدة يومين");
    expect(checkoutAr.validityLine(7)).toBe("صالحة لمدة 7 أيام");
    expect(checkoutAr.validityLine(30)).toBe("صالحة لمدة 30 يوماً");
  });

  test("laneCreditLine interpolates the localized lane label in BOTH locales", () => {
    expect(checkoutEn.laneCreditLine("Hifz")).toContain("Hifz");
    expect(checkoutAr.laneCreditLine("الحفظ")).toContain("الحفظ");
  });
});

// ─── 3. Registry wiring ──────────────────────────────────────────────────────

describe("checkout namespace — registry wiring", () => {
  test("Checkout handle registered with the conventional checkout.checkout id", () => {
    expect(Checkout.id).toBe("checkout.checkout");
    expect(namespaces.Checkout).toBe(Checkout);
  });

  test("both message bundles carry checkoutTranslations", () => {
    expect(enMessages.checkoutTranslations).toBe(checkoutEn);
    expect(arMessages.checkoutTranslations).toBe(checkoutAr);
  });

  test("the Checkout getter resolves the composed bundle slice", () => {
    expect(Checkout.getLabels(enMessages)).toBe(checkoutEn);
    expect(Checkout.getLabels(arMessages)).toBe(checkoutAr);
  });
});

// ─── 4/5. Sync resolution + script sanity ────────────────────────────────────

describe("checkout namespace — sync resolution through getTranslations", () => {
  test("en resolves the sampled keys", () => {
    const t = getTranslations("en").checkoutTranslations;
    expect(t.pageTitle).toBe(checkoutEn.pageTitle);
    expect(t.buyButton).toBe(checkoutEn.buyButton);
    expect(t.resultFailedTitle).toBe(checkoutEn.resultFailedTitle);
    expect(t.statusActive).toBe(checkoutEn.statusActive);
  });

  test("ar resolves the sampled keys (Arabic script)", () => {
    const t = getTranslations("ar").checkoutTranslations;
    expect(t.pageTitle).toBe(checkoutAr.pageTitle);
    expect(containsArabicScript(t.pageTitle)).toBe(true);
    expect(containsArabicScript(t.confirmDialogTitle)).toBe(true);
    expect(containsArabicScript(t.failedPaymentGuidance)).toBe(true);
  });

  test("unknown locales fall back to the DEFAULT locale (ar) without throwing", () => {
    const fallback = getTranslations(defaultLocale).checkoutTranslations;
    const t = getTranslations("xx").checkoutTranslations;
    expect(t.pageTitle).toBe(fallback.pageTitle);
  });
});
