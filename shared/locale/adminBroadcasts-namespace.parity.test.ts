/**
 * `adminBroadcasts`-namespace locale-parity verification
 * · ar+en parity gate + pluralization function pins + registry wiring.
 *
 * WHAT THIS LOCKS
 *   1. RUNTIME PARITY BELT — the ar/en `adminBroadcasts` leaf maps expose
 *      IDENTICAL key sets where every STRING slot is non-empty and every
 *      FUNCTION slot is present (belt #2: the PRIMARY parity gate is
 *      compile-time typing where BOTH leaf consts are typed
 *      `AdminBroadcastsLabels`; any missing key fails `bun tsgo`. This suite
 *      keeps the guarantee enforced even if someone loosens that typing
 *      later).
 *   2. MANDATED CONTENT — every key required by the broadcast compose
 *      surface (page title/subtitle, title/body fields with placeholder +
 *      required validation, the audience selector with its four options,
 *      the three companion-field groups — role, country (placeholder +
 *      exact-match helper), plan (label + loading copy) —, the oracle-hygiene
 *      disclaimer, the confirmation dialog, the send/cancel/sending
 *      affordances, the pluralized success toast, and the generic failure
 *      title) exists on BOTH maps — a key deleted from both maps
 *      simultaneously still fails this suite.
 *   3. NO ENGLISH FALLTHROUGH — every ar STRING slot contains Arabic script
 *      (an accidentally English value in the ar map fails the sweep).
 *   4. PLURALIZATION PIN — `successToast` branch outputs are exact-pinned at
 *      the Arabic plural boundaries (0 / 1 / 2 / 3–10 few / 11+ counted) and
 *      the English boundaries (0 / 1 / many) in BOTH locales, INCLUDING the
 *      server cap boundary (5000 recipients — BROADCAST_MAX_RECIPIENTS).
 *   5. PLACEHOLDER PARITY — `successToast` is the namespace's ONLY
 *      function-valued slot and the numeric count is the ONLY interpolated
 *      value: both locales actually carry the number in the rendered toast
 *      (no locale drops the placeholder).
 *   6. REGISTRY WIRING — the `AdminBroadcasts` handle is registered in
 *      `shared/locale/namespaces/index.ts` with the conventional
 *      `<ns>.<ns>` id and its getter resolves the composed bundle slice.
 *
 * Mirrors the structure of `shared/locale/notifications-namespace.parity.test.ts`
 * (the sibling notification-domain namespace gate).
 *
 * Pure unit tier — NO server boot, NO network, NO DB. Runs via the mandated
 * runner: `bun run test/scripts/run-test.ts shared/locale/adminBroadcasts-namespace.parity.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import { adminBroadcastsAr } from "@/shared/locale/ar/adminBroadcasts";
import { arMessages } from "@/shared/locale/ar/messages";
import { adminBroadcastsEn } from "@/shared/locale/en/adminBroadcasts";
import { enMessages } from "@/shared/locale/en/messages";
import { AdminBroadcasts } from "@/shared/locale/namespaces/adminBroadcasts";
import { namespaces } from "@/shared/locale/namespaces/index";

// ─── Mandated key inventory (the broadcast-compose surface ground truth) ────

/** Every key the AdminBroadcasts UI namespace must carry (27 slots). */
const MANDATED_KEYS = [
  "pageTitle",
  "pageSubtitle",
  "titleLabel",
  "titlePlaceholder",
  "titleRequired",
  "bodyLabel",
  "bodyPlaceholder",
  "audienceLabel",
  "audienceAll",
  "audienceRole",
  "audienceCountry",
  "audiencePlan",
  "roleLabel",
  "countryLabel",
  "countryPlaceholder",
  "countryHelperText",
  "planLabel",
  "planLoading",
  "previewDisclaimer",
  "confirmTitle",
  "confirmBody",
  "confirmAction",
  "cancelAction",
  "sendAction",
  "sendingAction",
  "successToast",
  "errorTitle",
] as const;

/** The audience-option keys — exactly the four audience branches of the selector. */
const AUDIENCE_OPTION_KEYS = ["audienceAll", "audienceRole", "audienceCountry", "audiencePlan"] as const;

/** The single function-valued slot (the pluralized success toast). */
const FUNCTION_KEYS = ["successToast"] as const;

/** Arabic-script probe — at least one Arabic-block character in the value. */
const ARABIC_SCRIPT = /[\u0600-\u06FF]/;

/** Reads one non-empty-string value slot off a locale map — throws otherwise. */
function stringSlotOf(localeMap: object, key: string, localeName: string): string {
  const value: unknown = Reflect.get(localeMap, key);
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`adminBroadcasts.${localeName}.${key} must be a non-empty localized string`);
  }
  return value;
}

// ===========================================================================
describe("compile-time parity mirror — ar/en key sets agree", () => {
  test("identical sorted key sets across BOTH locale sources", () => {
    const arKeys = Object.keys(adminBroadcastsAr).toSorted((a, b) => a.localeCompare(b));
    const enKeys = Object.keys(adminBroadcastsEn).toSorted((a, b) => a.localeCompare(b));

    expect(arKeys.length).toBeGreaterThan(0);
    expect(enKeys).toEqual(arKeys);
  });

  test("every value on BOTH maps is a non-empty string or a function (zero dead keys)", () => {
    for (const key of Object.keys(adminBroadcastsAr)) {
      const arValue: unknown = Reflect.get(adminBroadcastsAr, key);
      const enValue: unknown = Reflect.get(adminBroadcastsEn, key);
      expect(typeof arValue === "string" || typeof arValue === "function").toBe(true);
      expect(typeof enValue === "string" || typeof enValue === "function").toBe(true);
      if (typeof arValue === "string") {
        expect(arValue.length).toBeGreaterThan(0);
        expect(stringSlotOf(adminBroadcastsEn, key, "en").length).toBeGreaterThan(0);
      }
    }
    // Symmetric sweep — guards an en-only key that ar lost via future drift.
    for (const key of Object.keys(adminBroadcastsEn)) {
      const enValue: unknown = Reflect.get(adminBroadcastsEn, key);
      if (typeof enValue === "string") {
        expect(stringSlotOf(adminBroadcastsAr, key, "ar").length).toBeGreaterThan(0);
      }
    }
  });

  test.each([...MANDATED_KEYS])("mandated key `%s` exists on BOTH maps", key => {
    expect(Object.hasOwn(adminBroadcastsAr, key)).toBe(true);
    expect(Object.hasOwn(adminBroadcastsEn, key)).toBe(true);
  });

  test("the mandated inventory is exhaustive (no silent key minting beyond the 27 slots)", () => {
    const mandated = new Set<string>(MANDATED_KEYS);
    for (const key of Object.keys(adminBroadcastsAr)) {
      expect(mandated.has(key)).toBe(true);
    }
  });
});

// ===========================================================================
describe("audience-option coverage — exactly the four audience branches on the selector", () => {
  test("exactly FOUR audience-option keys exist (all / role / country / plan)", () => {
    const audienceKeysOnMap = Object.keys(adminBroadcastsEn)
      .filter(key => key.startsWith("audience"))
      .toSorted((a, b) => a.localeCompare(b));
    expect(audienceKeysOnMap).toEqual(
      ["audienceLabel", ...AUDIENCE_OPTION_KEYS].toSorted((a, b) => a.localeCompare(b))
    );
  });

  test.each([...AUDIENCE_OPTION_KEYS])("audience option `%s` is a non-empty string in BOTH locales", key => {
    expect(stringSlotOf(adminBroadcastsAr, key, "ar").length).toBeGreaterThan(0);
    expect(stringSlotOf(adminBroadcastsEn, key, "en").length).toBeGreaterThan(0);
  });
});

// ===========================================================================
describe("no English fallthrough — ar map carries Arabic copy for every string slot", () => {
  test("every ar STRING slot contains Arabic script", () => {
    for (const key of Object.keys(adminBroadcastsAr)) {
      const value: unknown = Reflect.get(adminBroadcastsAr, key);
      if (typeof value === "string") {
        expect(ARABIC_SCRIPT.test(value)).toBe(true);
      }
    }
  });

  test("the ar FUNCTION slot returns Arabic-script output", () => {
    expect(ARABIC_SCRIPT.test(adminBroadcastsAr.successToast(7))).toBe(true);
  });
});

// ===========================================================================
describe("pluralization pin — successToast exact branch outputs in BOTH locales", () => {
  // Arabic plural boundaries — CLDR classes: 0→zero-form message · 1 singular
  // (n = 1 EXACTLY) · 2 dual (n = 2 EXACTLY) · 3–10 counted plural ·
  // 11–99 tamyiz singular · other = 100/101/102 and their ×100 re-entries
  // (one/two never re-enter via the last-two-digit cycle).
  test.each([
    [0, "No recipients were reached", "لم يتم إشعار أي مستلم"],
    [1, "Broadcast sent to 1 recipient", "تم إرسال الإعلان إلى مستلم واحد"],
    [2, "Broadcast sent to 2 recipients", "تم إرسال الإعلان إلى مستلمين"],
    [3, "Broadcast sent to 3 recipients", "تم إرسال الإعلان إلى 3 مستلمين"],
    [10, "Broadcast sent to 10 recipients", "تم إرسال الإعلان إلى 10 مستلمين"],
    [11, "Broadcast sent to 11 recipients", "تم إرسال الإعلان إلى 11 مستلماً"],
    [42, "Broadcast sent to 42 recipients", "تم إرسال الإعلان إلى 42 مستلماً"],
    [100, "Broadcast sent to 100 recipients", "تم إرسال الإعلان إلى 100 مستلماً"],
    [101, "Broadcast sent to 101 recipients", "تم إرسال الإعلان إلى 101 مستلماً"],
    [102, "Broadcast sent to 102 recipients", "تم إرسال الإعلان إلى 102 مستلماً"],
    [105, "Broadcast sent to 105 recipients", "تم إرسال الإعلان إلى 105 مستلمين"],
    [142, "Broadcast sent to 142 recipients", "تم إرسال الإعلان إلى 142 مستلماً"],
    [5000, "Broadcast sent to 5000 recipients", "تم إرسال الإعلان إلى 5000 مستلماً"],
  ])("successToast(%d)", (count, expectedEn, expectedAr) => {
    expect(adminBroadcastsEn.successToast(count)).toBe(expectedEn);
    expect(adminBroadcastsAr.successToast(count)).toBe(expectedAr);
  });

  test("interpolated counts actually carry the number in BOTH locales (placeholder parity)", () => {
    expect(adminBroadcastsEn.successToast(5)).toContain("5");
    expect(adminBroadcastsAr.successToast(5)).toContain("5");
    expect(adminBroadcastsAr.successToast(27)).toContain("27");
    expect(adminBroadcastsEn.successToast(27)).toContain("27");
  });
});

// ===========================================================================
describe("registry + bundle wiring", () => {
  test("namespaces registry exposes the AdminBroadcasts handle with the `<ns>.<ns>` id convention", () => {
    expect(Object.hasOwn(namespaces, "AdminBroadcasts")).toBe(true);
    expect(AdminBroadcasts.id).toBe("adminBroadcasts.adminBroadcasts");
  });

  test("handle getter resolves the composed bundle slice (both locales)", () => {
    expect(AdminBroadcasts.getLabels(enMessages)).toBe(enMessages.adminBroadcastsTranslations);
    expect(AdminBroadcasts.getLabels(arMessages)).toBe(arMessages.adminBroadcastsTranslations);
  });

  test("`adminBroadcastsTranslations` exists on BOTH message bundles", () => {
    expect(Object.hasOwn(enMessages, "adminBroadcastsTranslations")).toBe(true);
    expect(Object.hasOwn(arMessages, "adminBroadcastsTranslations")).toBe(true);
  });

  test("the bundle slice IS the leaf map (no re-wrapper indirection) in BOTH locales", () => {
    expect(enMessages.adminBroadcastsTranslations).toBe(adminBroadcastsEn);
    expect(arMessages.adminBroadcastsTranslations).toBe(adminBroadcastsAr);
  });
});

// ===========================================================================
describe("function-slot inventory — exactly the pluralized toast, on BOTH maps", () => {
  test.each([...FUNCTION_KEYS])("slot `%s` is a function on BOTH maps", key => {
    expect(typeof Reflect.get(adminBroadcastsAr, key)).toBe("function");
    expect(typeof Reflect.get(adminBroadcastsEn, key)).toBe("function");
  });

  test("no OTHER slot is function-valued (string/function split is stable)", () => {
    for (const key of Object.keys(adminBroadcastsEn)) {
      const isFunction = typeof Reflect.get(adminBroadcastsEn, key) === "function";
      expect(isFunction).toBe((FUNCTION_KEYS as readonly string[]).includes(key));
    }
  });
});

// ===========================================================================
describe("dashboard nav label — the `broadcasts` key on the DASHBOARD bundle", () => {
  test("`broadcasts` resolves non-empty in BOTH locales from the dashboard bundle", () => {
    expect(enMessages.dashboardTranslations.broadcasts.length).toBeGreaterThan(0);
    expect(arMessages.dashboardTranslations.broadcasts.length).toBeGreaterThan(0);
  });

  test("the dashboard `broadcasts` label carries Arabic script in ar", () => {
    expect(ARABIC_SCRIPT.test(arMessages.dashboardTranslations.broadcasts)).toBe(true);
  });
});
