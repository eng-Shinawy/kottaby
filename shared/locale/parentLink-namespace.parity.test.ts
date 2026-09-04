/**
 * `parentLink`-namespace locale-parity verification
 * · ar+en parity gate + function-slot pins + registry wiring.
 *
 * WHAT THIS LOCKS
 *   1. RUNTIME PARITY BELT — the ar/en `parentLink` leaf maps expose
 *      IDENTICAL key sets where every STRING slot is non-empty and every
 *      FUNCTION slot is present (belt #2: the PRIMARY parity gate is
 *      compile-time typing where BOTH leaf consts are typed
 *      `ParentLinkLabels`; any missing key fails `bun tsgo`. This suite
 *      keeps the guarantee enforced even if someone loosens that typing
 *      later).
 *   2. MANDATED CONTENT — every key required by the two parent-link
 *      surfaces (student inbox title/empty/identity/expiry/status/action
 *      copy, confirm/reject dialogs, parent outgoing list, cancel dialog,
 *      send-flow affordance + success/pending/unavailable feedback)
 *      exists on BOTH maps — a key deleted from both maps simultaneously
 *      still fails this suite.
 *   3. NO ENGLISH FALLTHROUGH — every ar STRING slot contains Arabic script
 *      (an accidentally English value in the ar map fails the sweep).
 *   4. STATUS VOCABULARY — one display label per link-request state
 *      (`pending` ↔ statusPending, `confirmed` ↔ statusConfirmed,
 *      `rejected` ↔ statusRejected, `expired` ↔ statusExpired); the
 *      expired chip is rendered from the computed state, never a stale
 *      write.
 *   5. TEMPLATE PINS — `expiresLine`, `confirmDialogBody`, and
 *      `rejectDialogBody` expand their arguments into the returned message
 *      in BOTH locales, with exact-pinned outputs and Arabic-script output
 *      on the ar side.
 *   6. REGISTRY WIRING — the `ParentLink` handle is registered in
 *      `shared/locale/namespaces/index.ts` with the conventional
 *      `<ns>.<ns>` id and its getter resolves the composed bundle slice.
 *
 * Mirrors the structure of `shared/locale/notifications-namespace.parity.test.ts`
 * (the sibling namespace gate), scaled to this namespace's three
 * function-valued slots (expiry line + confirmation dialog bodies).
 *
 * Pure unit tier — NO server boot, NO network, NO DB. Runs via the mandated
 * runner: `bun run test/scripts/run-test.ts shared/locale/parentLink-namespace.parity.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import { arMessages } from "@/shared/locale/ar/messages";
import { parentLinkAr } from "@/shared/locale/ar/parentLink";
import { enMessages } from "@/shared/locale/en/messages";
import { parentLinkEn } from "@/shared/locale/en/parentLink";
import { namespaces } from "@/shared/locale/namespaces/index";
import { ParentLink } from "@/shared/locale/namespaces/parentLink";

// ─── Mandated key inventory (the parent-link surface ground truth) ──────────

/** Every key the parentLink UI namespace must carry (33 slots). */
const MANDATED_KEYS = [
  "studentPageTitle",
  "studentPageSubtitle",
  "incomingEmptyTitle",
  "incomingEmptyBody",
  "listSummaryLabel",
  "summaryCountChip",
  "incomingHintBody",
  "fromLabel",
  "sentAtLabel",
  "expiresLine",
  "statusPending",
  "statusConfirmed",
  "statusRejected",
  "statusExpired",
  "confirmAction",
  "rejectAction",
  "confirmDialogTitle",
  "confirmDialogBody",
  "rejectDialogTitle",
  "rejectDialogBody",
  "confirmSuccessToast",
  "rejectSuccessToast",
  "cancelAction",
  "cancelDialogTitle",
  "cancelDialogBody",
  "cancelSuccessToast",
  "outgoingTitle",
  "outgoingEmptyTitle",
  "outgoingEmptyBody",
  "sendRequestAction",
  "sendRequestSuccessToast",
  "requestPendingNotice",
  "sendUnavailableNotice",
] as const;

/**
 * One display-label key per link-request state value — `pending` ↔
 * statusPending, `confirmed` ↔ statusConfirmed, `rejected` ↔ statusRejected,
 * `expired` ↔ statusExpired (pinned as a test fixture — this file must not
 * import the backend enum layer).
 */
const STATUS_LABEL_KEYS = ["statusPending", "statusConfirmed", "statusRejected", "statusExpired"] as const;

/** The four function-valued slots (summary chip + expiry line + dialog bodies). */
const FUNCTION_KEYS = ["summaryCountChip", "expiresLine", "confirmDialogBody", "rejectDialogBody"] as const;

/** Arabic-script probe — at least one Arabic-block character in the value. */
const ARABIC_SCRIPT = /[\u0600-\u06FF]/;

/** Reads one non-empty-string value slot off a locale map — throws otherwise. */
function stringSlotOf(localeMap: object, key: string, localeName: string): string {
  const value: unknown = Reflect.get(localeMap, key);
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`parentLink.${localeName}.${key} must be a non-empty localized string`);
  }
  return value;
}

// ===========================================================================
describe("compile-time parity mirror — ar/en key sets agree", () => {
  test("identical sorted key sets across BOTH locale sources", () => {
    const arKeys = Object.keys(parentLinkAr).toSorted((a, b) => a.localeCompare(b));
    const enKeys = Object.keys(parentLinkEn).toSorted((a, b) => a.localeCompare(b));

    expect(arKeys.length).toBeGreaterThan(0);
    expect(enKeys).toEqual(arKeys);
  });

  test("every value on BOTH maps is a non-empty string or a function (zero dead keys)", () => {
    for (const key of Object.keys(parentLinkAr)) {
      const arValue: unknown = Reflect.get(parentLinkAr, key);
      const enValue: unknown = Reflect.get(parentLinkEn, key);
      expect(typeof arValue === "string" || typeof arValue === "function").toBe(true);
      expect(typeof enValue === "string" || typeof enValue === "function").toBe(true);
      if (typeof arValue === "string") {
        expect(arValue.length).toBeGreaterThan(0);
        expect(stringSlotOf(parentLinkEn, key, "en").length).toBeGreaterThan(0);
      }
    }
    // Symmetric sweep — guards an en-only key that ar lost via future drift.
    for (const key of Object.keys(parentLinkEn)) {
      const enValue: unknown = Reflect.get(parentLinkEn, key);
      if (typeof enValue === "string") {
        expect(stringSlotOf(parentLinkAr, key, "ar").length).toBeGreaterThan(0);
      }
    }
  });

  test.each([...MANDATED_KEYS])("mandated key `%s` exists on BOTH maps", key => {
    expect(Object.hasOwn(parentLinkAr, key)).toBe(true);
    expect(Object.hasOwn(parentLinkEn, key)).toBe(true);
  });

  test("the mandated inventory is exhaustive (no silent key minting beyond the 30 slots)", () => {
    const mandated = new Set<string>(MANDATED_KEYS);
    for (const key of Object.keys(parentLinkAr)) {
      expect(mandated.has(key)).toBe(true);
    }
  });
});

// ===========================================================================
describe("status vocabulary — one display label per link-request state value", () => {
  test("exactly FOUR status-label keys exist (all 4 link-request states covered)", () => {
    const statusKeysOnMap = Object.keys(parentLinkEn).filter(key => key.startsWith("status"));
    expect(statusKeysOnMap).toEqual([...STATUS_LABEL_KEYS]);
  });

  test.each([...STATUS_LABEL_KEYS])("status label `%s` is a non-empty string in BOTH locales", key => {
    expect(stringSlotOf(parentLinkAr, key, "ar").length).toBeGreaterThan(0);
    expect(stringSlotOf(parentLinkEn, key, "en").length).toBeGreaterThan(0);
  });
});

// ===========================================================================
describe("no English fallthrough — ar map carries Arabic copy for every string slot", () => {
  test("every ar STRING slot contains Arabic script", () => {
    for (const key of Object.keys(parentLinkAr)) {
      const value: unknown = Reflect.get(parentLinkAr, key);
      if (typeof value === "string") {
        expect(ARABIC_SCRIPT.test(value)).toBe(true);
      }
    }
  });

  test("all four ar FUNCTION slots return Arabic-script output for Arabic-flavored arguments", () => {
    const arParentName = "ولي الأمر";
    expect(ARABIC_SCRIPT.test(parentLinkAr.summaryCountChip("قيد الانتظار", 2))).toBe(true);
    expect(ARABIC_SCRIPT.test(parentLinkAr.expiresLine("١٤ سبتمبر ٢٠٢٦"))).toBe(true);
    expect(ARABIC_SCRIPT.test(parentLinkAr.confirmDialogBody(arParentName))).toBe(true);
    expect(ARABIC_SCRIPT.test(parentLinkAr.rejectDialogBody(arParentName))).toBe(true);
  });
});

// ===========================================================================
describe("template pins — function slots expand their arguments", () => {
  test("summaryCountChip embeds the status word and its count in BOTH locales", () => {
    expect(parentLinkEn.summaryCountChip("Pending", 2)).toBe("Pending · 2");
    expect(parentLinkEn.summaryCountChip("Confirmed", 0)).toBe("Confirmed · 0");
    expect(parentLinkAr.summaryCountChip("قيد الانتظار", 2)).toBe("قيد الانتظار · ٢");
    expect(parentLinkAr.summaryCountChip("تم التأكيد", 0)).toBe("تم التأكيد · ٠");
  });

  test("expiresLine embeds the formatted expiry moment in BOTH locales", () => {
    expect(parentLinkEn.expiresLine("Sep 14, 2026")).toBe("Expires on Sep 14, 2026");
    expect(parentLinkAr.expiresLine("١٤ سبتمبر ٢٠٢٦")).toBe("ينتهي في ١٤ سبتمبر ٢٠٢٦");
  });

  test("confirmDialogBody embeds the parent name in BOTH locales", () => {
    expect(parentLinkEn.confirmDialogBody("Adam")).toBe(
      "Adam will be linked to your account and will be able to follow your progress."
    );
    expect(parentLinkAr.confirmDialogBody("ولي الأمر")).toBe("سيتم ربط ولي الأمر بحسابك وسيتمكن من متابعة تقدمك.");
  });

  test("rejectDialogBody embeds the parent name in BOTH locales", () => {
    expect(parentLinkEn.rejectDialogBody("Adam")).toBe(
      "Adam will not be linked to your account. They can send a new request later."
    );
    expect(parentLinkAr.rejectDialogBody("ولي الأمر")).toBe("لن يتم ربط ولي الأمر بحسابك. يمكنه إرسال طلب جديد لاحقاً.");
  });

  test("all four function slots are callable with non-empty output in BOTH locales", () => {
    expect(parentLinkEn.summaryCountChip("Pending", 2).length).toBeGreaterThan(0);
    expect(parentLinkEn.expiresLine("Sep 14, 2026").length).toBeGreaterThan(0);
    expect(parentLinkEn.confirmDialogBody("Adam").length).toBeGreaterThan(0);
    expect(parentLinkEn.rejectDialogBody("Adam").length).toBeGreaterThan(0);
    expect(parentLinkAr.expiresLine("١٤ سبتمبر ٢٠٢٦").length).toBeGreaterThan(0);
    expect(parentLinkAr.confirmDialogBody("ولي الأمر").length).toBeGreaterThan(0);
    expect(parentLinkAr.rejectDialogBody("ولي الأمر").length).toBeGreaterThan(0);
  });
});

// ===========================================================================
describe("function-slot inventory — exactly the four locale functions, on BOTH maps", () => {
  test.each([...FUNCTION_KEYS])("slot `%s` is a function on BOTH maps", key => {
    expect(typeof Reflect.get(parentLinkAr, key)).toBe("function");
    expect(typeof Reflect.get(parentLinkEn, key)).toBe("function");
  });

  test("no OTHER slot is function-valued (string/function split is stable)", () => {
    for (const key of Object.keys(parentLinkEn)) {
      const isFunction = typeof Reflect.get(parentLinkEn, key) === "function";
      expect(isFunction).toBe((FUNCTION_KEYS as readonly string[]).includes(key));
    }
  });

  test("the ar summary chip renders Arabic-Indic digits (page-date parity)", () => {
    expect(parentLinkAr.summaryCountChip("مرفوض", 3)).toContain("٣");
    expect(parentLinkEn.summaryCountChip("Rejected", 3)).toContain("3");
  });
});

// ===========================================================================
describe("registry + bundle wiring", () => {
  test("namespaces registry exposes the ParentLink handle with the `<ns>.<ns>` id convention", () => {
    expect(Object.hasOwn(namespaces, "ParentLink")).toBe(true);
    expect(ParentLink.id).toBe("parentLink.parentLink");
  });

  test("handle getter resolves the composed bundle slice (both locales)", () => {
    expect(ParentLink.getLabels(enMessages)).toBe(enMessages.parentLinkTranslations);
    expect(ParentLink.getLabels(arMessages)).toBe(arMessages.parentLinkTranslations);
  });

  test("`parentLinkTranslations` exists on BOTH message bundles", () => {
    expect(Object.hasOwn(enMessages, "parentLinkTranslations")).toBe(true);
    expect(Object.hasOwn(arMessages, "parentLinkTranslations")).toBe(true);
  });

  test("the bundle slice IS the leaf map (no re-wrapper indirection) in BOTH locales", () => {
    expect(enMessages.parentLinkTranslations).toBe(parentLinkEn);
    expect(arMessages.parentLinkTranslations).toBe(parentLinkAr);
  });
});
