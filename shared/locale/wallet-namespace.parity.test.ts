/**
 * `wallet`-namespace + wallet error-key locale verification (DEV3-013)
 * · ar+en parity gates over the NEW `wallet` UI namespace and the
 *   `walletInvalidAmount` key added to the `errors` namespace, plus
 *   synchronous resolution checks through `getTranslations(locale)`.
 *
 * WHAT THIS LOCKS
 *   1. ERRORS REGISTRY PIN — the withdrawal-amount rejection key
 *      (`walletInvalidAmount`) exists as a NON-EMPTY string in BOTH locale
 *      maps of the `errors` namespace, and `insufficientBalance` (the
 *      REUSED funds-denial copy) stays present in both.
 *   2. WALLET PARITY BELT — the ar/en `wallet` leaf maps expose IDENTICAL
 *      key sets with non-empty string values (belt #2: the PRIMARY parity
 *      gate is compile-time typing where BOTH leaf consts are typed
 *      `WalletLabels`; any missing key fails `bun tsgo`). This suite keeps
 *      the guarantee enforced even if someone loosens that typing later.
 *      The function-valued key (`availableBalanceHint`) agrees across
 *      locales on its argument arity.
 *   3. REGISTRY WIRING — the `Wallet` handle is registered in
 *      `shared/locale/namespaces/index.ts` with the conventional `<ns>.<ns>`
 *      id and its getter resolves to the composed bundle slice; both message
 *      bundles carry `walletTranslations`.
 *   4. SYNC RESOLUTION — `getTranslations(locale)` (pure, in-memory, never
 *      suspends) resolves a sample of the new keys in BOTH locales.
 *   5. ARABIC-SCRIPT SANITY — sampled Arabic values actually contain Arabic
 *      script (guards a copy paste of English into the `ar` leaf).
 *
 * Mirrors the structure of `shared/locale/sessions-namespace.parity.test.ts`.
 *
 * Pure unit tier — NO server boot, NO network, NO DB.
 */

import { describe, expect, test } from "bun:test";
import { defaultLocale } from "@/shared/locale/AppLocale";
import { errorsAr } from "@/shared/locale/ar/errors";
import { arMessages } from "@/shared/locale/ar/messages";
import { walletAr } from "@/shared/locale/ar/wallet";
import { errorsEn } from "@/shared/locale/en/errors";
import { enMessages } from "@/shared/locale/en/messages";
import { walletEn } from "@/shared/locale/en/wallet";
import { namespaces } from "@/shared/locale/namespaces/index";
import { Wallet } from "@/shared/locale/namespaces/wallet";
import { getTranslations } from "@/shared/locale/server";

// ─── Mandated registries ─────────────────────────────────────────────────────

/** The withdrawal-amount rejection key mandated on the flat `ErrorsLabels` interface. */
const WALLET_ERROR_KEYS = ["walletInvalidAmount"] as const;
/** The REUSED funds-denial copy (one message, two flows — booking + payout). */
const REUSED_ERROR_KEYS = ["insufficientBalance"] as const;

/** Every string-valued key on the `WalletLabels` interface (parity belt surface). */
const WALLET_STRING_KEYS = [
  "pageTitle",
  "balanceLabel",
  "totalEarningLabel",
  "requestWithdrawal",
  "withdrawDialogTitle",
  "withdrawDialogBody",
  "amountLabel",
  "amountPlaceholder",
  "withdrawSubmit",
  "withdrawSuccessNotice",
  "invalidAmount",
  "genericError",
  "ledgerTitle",
  "typeEarning",
  "typeWithdrawal",
  "typeBonus",
  "statusPending",
  "statusCompleted",
  "statusFailed",
  "createdAt",
  "ledgerEmptyTitle",
  "ledgerEmptyBody",
] as const;

/** Sampled keys for the sync-resolution + Arabic-script gates. */
const ARABIC_SAMPLE_KEYS = ["pageTitle", "requestWithdrawal", "ledgerTitle", "statusPending"] as const;

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

describe("errors namespace — wallet keys pinned in BOTH locales", () => {
  for (const key of [...WALLET_ERROR_KEYS, ...REUSED_ERROR_KEYS]) {
    test(`en.errors.${key} is a non-empty string`, () => {
      expectNonEmptyString(errorsEn[key], `en.errors.${key}`);
    });
    test(`ar.errors.${key} is a non-empty string`, () => {
      expectNonEmptyString(errorsAr[key], `ar.errors.${key}`);
      expect(containsArabicScript(errorsAr[key]), `ar.errors.${key} must be Arabic script`).toBe(true);
    });
  }
});

// ─── 2. Wallet parity belt ───────────────────────────────────────────────────

describe("wallet namespace — ar/en parity belt", () => {
  for (const key of WALLET_STRING_KEYS) {
    test(`wallet.${key}: non-empty in BOTH locales`, () => {
      expectNonEmptyString(walletEn[key], `walletEn.${key}`);
      expectNonEmptyString(walletAr[key], `walletAr.${key}`);
    });
  }

  test("arabic leaf carries Arabic script on sampled keys", () => {
    for (const key of ARABIC_SAMPLE_KEYS) {
      expect(containsArabicScript(walletAr[key]), `walletAr.${key} must be Arabic script`).toBe(true);
    }
  });

  test("availableBalanceHint is a 1-arg function in BOTH locales and interpolates the balance", () => {
    expect(typeof walletEn.availableBalanceHint).toBe("function");
    expect(typeof walletAr.availableBalanceHint).toBe("function");
    const en = walletEn.availableBalanceHint("125.00");
    const ar = walletAr.availableBalanceHint("125.00");
    expect(en).toContain("125.00");
    expect(ar).toContain("125.00");
  });

  test("ICU placeholder sets agree across locales for the function-valued key", () => {
    // The only interpolable key is availableBalanceHint ({balance}) — both
    // locales must consume exactly one argument.
    expect(walletEn.availableBalanceHint).toHaveLength(1);
    expect(walletAr.availableBalanceHint).toHaveLength(1);
  });
});

// ─── 3. Registry wiring ──────────────────────────────────────────────────────

describe("wallet namespace — registry wiring", () => {
  test("Wallet handle registered with the conventional wallet.wallet id", () => {
    expect(Wallet.id).toBe("wallet.wallet");
    expect(namespaces.Wallet).toBe(Wallet);
  });

  test("both message bundles carry walletTranslations", () => {
    expect(enMessages.walletTranslations).toBe(walletEn);
    expect(arMessages.walletTranslations).toBe(walletAr);
  });

  test("the Wallet getter resolves the composed bundle slice", () => {
    expect(Wallet.getLabels(enMessages)).toBe(walletEn);
    expect(Wallet.getLabels(arMessages)).toBe(walletAr);
  });
});

// ─── 4/5. Sync resolution + script sanity ────────────────────────────────────

describe("wallet namespace — sync resolution through getTranslations", () => {
  test("en resolves the sampled keys", () => {
    const t = getTranslations("en").walletTranslations;
    expect(t.pageTitle).toBe(walletEn.pageTitle);
    expect(t.requestWithdrawal).toBe(walletEn.requestWithdrawal);
    expect(t.ledgerTitle).toBe(walletEn.ledgerTitle);
  });

  test("ar resolves the sampled keys (Arabic script)", () => {
    const t = getTranslations("ar").walletTranslations;
    expect(t.pageTitle).toBe(walletAr.pageTitle);
    expect(containsArabicScript(t.pageTitle)).toBe(true);
    expect(containsArabicScript(t.withdrawDialogTitle)).toBe(true);
  });

  test("unknown locales fall back to the DEFAULT locale (ar) without throwing", () => {
    const fallback = getTranslations(defaultLocale).walletTranslations;
    const t = getTranslations("xx").walletTranslations;
    expect(t.pageTitle).toBe(fallback.pageTitle);
  });
});
