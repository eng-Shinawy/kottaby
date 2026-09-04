/**
 * `notifications`-namespace locale-parity verification
 * · ar+en parity gate + pluralization function pins + registry wiring.
 *
 * WHAT THIS LOCKS
 *   1. RUNTIME PARITY BELT — the ar/en `notifications` leaf maps expose
 *      IDENTICAL key sets where every STRING slot is non-empty and every
 *      FUNCTION slot is present (belt #2: the PRIMARY parity gate is
 *      compile-time typing where BOTH leaf consts are typed
 *      `NotificationsLabels`; any missing key fails `bun tsgo`. This suite
 *      keeps the guarantee enforced even if someone loosens that typing
 *      later).
 *   2. MANDATED CONTENT — every key required by the notification-feed
 *      surface (feed title, empty/error states, filter labels, the SEVEN
 *      notification-type display labels, mark-read/mark-all affordances,
 *      badge aria, pluralized counts, realtime toast, quiet reconnect copy,
 *      parent-link lifecycle event copy) exists on BOTH maps — a key
 *      deleted from both maps simultaneously still fails this suite.
 *   3. NO ENGLISH FALLTHROUGH — every ar STRING slot contains Arabic script
 *      (an accidentally English value in the ar map fails the sweep).
 *   4. PLURALIZATION PINS — `unreadCount` + `markAllResult` branch outputs
 *      are exact-pinned at the Arabic plural boundaries (0 / 1 / 2 /
 *      3–10 few / 11+ counted) and the English boundaries (0 / 1 / many)
 *      in BOTH locales.
 *   5. TEMPLATE PINS — `markReadAriaLabel`, `realtimeToast`, and the three
 *      parent-link event-body functions expand their arguments into the
 *      returned message in BOTH locales.
 *   6. REGISTRY WIRING — the `Notifications` handle is registered in
 *      `shared/locale/namespaces/index.ts` with the conventional
 *      `<ns>.<ns>` id and its getter resolves the composed bundle slice.
 *
 * Mirrors the structure of `shared/locale/applicant-namespace.parity.test.ts`
 * (the sibling namespace gate), extended for this namespace's function-valued
 * slots (pluralization + interpolation templates).
 *
 * Pure unit tier — NO server boot, NO network, NO DB. Runs via the mandated
 * runner: `bun run test/scripts/run-test.ts shared/locale/notifications-namespace.parity.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import { arMessages } from "@/shared/locale/ar/messages";
import { notificationsAr } from "@/shared/locale/ar/notifications";
import { enMessages } from "@/shared/locale/en/messages";
import { notificationsEn } from "@/shared/locale/en/notifications";
import { namespaces } from "@/shared/locale/namespaces/index";
import { Notifications } from "@/shared/locale/namespaces/notifications";

// ─── Mandated key inventory (the notification-feed surface ground truth) ────

/** Every key the notifications UI namespace must carry (34 slots). */
const MANDATED_KEYS = [
  "title",
  "emptyTitle",
  "emptyBody",
  "loadErrorTitle",
  "loadErrorBody",
  "filterAll",
  "filterUnread",
  "typeSessionRequest",
  "typeSessionCompletion",
  "typeSessionCancellation",
  "typeParentLinkRequest",
  "typeSystemBroadcast",
  "typePaymentConfirmation",
  "typeEvaluationResult",
  "markRead",
  "markReadAriaLabel",
  "markAllRead",
  "markAllConfirmTitle",
  "markAllConfirmBody",
  "markAllResult",
  "badgeAriaLabel",
  "unreadCount",
  "viewAllNotifications",
  "realtimeToast",
  "reconnecting",
  "reconnectedQuietly",
  "eventParentLinkRequestTitle",
  "eventParentLinkRequestBody",
  "eventParentLinkAcceptedTitle",
  "eventParentLinkAcceptedBody",
  "eventParentLinkRejectedTitle",
  "eventParentLinkRejectedBody",
  "eventParentLinkExpiringTitle",
  "eventParentLinkExpiringBody",
] as const;

/**
 * One display-label key per each of the seven notification-type values —
 * `session_request` ↔ typeSessionRequest, `session_completion` ↔
 * typeSessionCompletion, `session_cancellation` ↔ typeSessionCancellation,
 * `parent_link_request` ↔ typeParentLinkRequest, `system_broadcast` ↔
 * typeSystemBroadcast, `payment_confirmation` ↔ typePaymentConfirmation,
 * `evaluation_result` ↔ typeEvaluationResult. (Pinned as a test fixture —
 * this file must not import the backend enum layer.)
 */
const TYPE_LABEL_KEYS = [
  "typeSessionRequest",
  "typeSessionCompletion",
  "typeSessionCancellation",
  "typeParentLinkRequest",
  "typeSystemBroadcast",
  "typePaymentConfirmation",
  "typeEvaluationResult",
] as const;

/** The eight function-valued slots (pluralization + interpolation templates). */
const FUNCTION_KEYS = [
  "markReadAriaLabel",
  "markAllResult",
  "unreadCount",
  "realtimeToast",
  "eventParentLinkRequestBody",
  "eventParentLinkAcceptedBody",
  "eventParentLinkRejectedBody",
  "eventParentLinkExpiringBody",
] as const;

/** Arabic-script probe — at least one Arabic-block character in the value. */
const ARABIC_SCRIPT = /[\u0600-\u06FF]/;

/** Reads one non-empty-string value slot off a locale map — throws otherwise. */
function stringSlotOf(localeMap: object, key: string, localeName: string): string {
  const value: unknown = Reflect.get(localeMap, key);
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`notifications.${localeName}.${key} must be a non-empty localized string`);
  }
  return value;
}

// ===========================================================================
describe("compile-time parity mirror — ar/en key sets agree", () => {
  test("identical sorted key sets across BOTH locale sources", () => {
    const arKeys = Object.keys(notificationsAr).toSorted((a, b) => a.localeCompare(b));
    const enKeys = Object.keys(notificationsEn).toSorted((a, b) => a.localeCompare(b));

    expect(arKeys.length).toBeGreaterThan(0);
    expect(enKeys).toEqual(arKeys);
  });

  test("every value on BOTH maps is a non-empty string or a function (zero dead keys)", () => {
    for (const key of Object.keys(notificationsAr)) {
      const arValue: unknown = Reflect.get(notificationsAr, key);
      const enValue: unknown = Reflect.get(notificationsEn, key);
      expect(typeof arValue === "string" || typeof arValue === "function").toBe(true);
      expect(typeof enValue === "string" || typeof enValue === "function").toBe(true);
      if (typeof arValue === "string") {
        expect(arValue.length).toBeGreaterThan(0);
        expect(stringSlotOf(notificationsEn, key, "en").length).toBeGreaterThan(0);
      }
    }
    // Symmetric sweep — guards an en-only key that ar lost via future drift.
    for (const key of Object.keys(notificationsEn)) {
      const enValue: unknown = Reflect.get(notificationsEn, key);
      if (typeof enValue === "string") {
        expect(stringSlotOf(notificationsAr, key, "ar").length).toBeGreaterThan(0);
      }
    }
  });

  test.each([...MANDATED_KEYS])("mandated key `%s` exists on BOTH maps", key => {
    expect(Object.hasOwn(notificationsAr, key)).toBe(true);
    expect(Object.hasOwn(notificationsEn, key)).toBe(true);
  });

  test("the mandated inventory is exhaustive (no silent key minting beyond the 32 slots)", () => {
    const mandated = new Set<string>(MANDATED_KEYS);
    for (const key of Object.keys(notificationsAr)) {
      expect(mandated.has(key)).toBe(true);
    }
  });
});

// ===========================================================================
describe("type-label coverage — one display label per notification-type value", () => {
  test("exactly SEVEN type-label keys exist (all 7 NotificationType values covered)", () => {
    const typeKeysOnMap = Object.keys(notificationsEn).filter(key => key.startsWith("type"));
    expect(typeKeysOnMap).toEqual([...TYPE_LABEL_KEYS]);
  });

  test.each([...TYPE_LABEL_KEYS])("type label `%s` is a non-empty string in BOTH locales", key => {
    expect(stringSlotOf(notificationsAr, key, "ar").length).toBeGreaterThan(0);
    expect(stringSlotOf(notificationsEn, key, "en").length).toBeGreaterThan(0);
  });
});

// ===========================================================================
describe("no English fallthrough — ar map carries Arabic copy for every string slot", () => {
  test("every ar STRING slot contains Arabic script", () => {
    for (const key of Object.keys(notificationsAr)) {
      const value: unknown = Reflect.get(notificationsAr, key);
      if (typeof value === "string") {
        expect(ARABIC_SCRIPT.test(value)).toBe(true);
      }
    }
  });

  test("all seven ar FUNCTION slots return Arabic-script output for Arabic-flavored arguments", () => {
    const arTitle = "طلب جلسة جديد";
    expect(ARABIC_SCRIPT.test(notificationsAr.markReadAriaLabel(arTitle))).toBe(true);
    expect(ARABIC_SCRIPT.test(notificationsAr.markAllResult(7))).toBe(true);
    expect(ARABIC_SCRIPT.test(notificationsAr.unreadCount(7))).toBe(true);
    expect(ARABIC_SCRIPT.test(notificationsAr.realtimeToast("طلب جلسة", arTitle))).toBe(true);
    expect(ARABIC_SCRIPT.test(notificationsAr.eventParentLinkRequestBody("ولي الأمر"))).toBe(true);
    expect(ARABIC_SCRIPT.test(notificationsAr.eventParentLinkAcceptedBody("الطالب"))).toBe(true);
    expect(ARABIC_SCRIPT.test(notificationsAr.eventParentLinkRejectedBody("الطالب"))).toBe(true);
  });
});

// ===========================================================================
describe("pluralization pin — unreadCount exact branch outputs in BOTH locales", () => {
  // Arabic plural boundaries: 0 zero-form · 1 singular · 2 dual · 3–10 few-plural · 11+ counted-singular.
  test.each([
    [0, "No unread notifications", "لا توجد إشعارات غير مقروءة"],
    [1, "1 unread notification", "إشعار واحد غير مقروء"],
    [2, "2 unread notifications", "إشعاران غير مقروءان"],
    [3, "3 unread notifications", "3 إشعارات غير مقروءة"],
    [10, "10 unread notifications", "10 إشعارات غير مقروءة"],
    [11, "11 unread notifications", "11 إشعاراً غير مقروءاً"],
    [42, "42 unread notifications", "42 إشعاراً غير مقروءاً"],
  ])("unreadCount(%d)", (count, expectedEn, expectedAr) => {
    expect(notificationsEn.unreadCount(count)).toBe(expectedEn);
    expect(notificationsAr.unreadCount(count)).toBe(expectedAr);
  });

  test("interpolated counts actually carry the number in BOTH locales", () => {
    expect(notificationsEn.unreadCount(5)).toContain("5");
    expect(notificationsAr.unreadCount(5)).toContain("5");
    expect(notificationsAr.unreadCount(27)).toContain("27");
  });
});

// ===========================================================================
describe("pluralization pin — markAllResult exact branch outputs in BOTH locales", () => {
  test.each([
    [0, "No unread notifications", "لا توجد إشعارات غير مقروءة"],
    [1, "1 notification marked as read", "تم تحديد إشعار واحد كمقروء"],
    [2, "2 notifications marked as read", "تم تحديد إشعارين كمقروءين"],
    [3, "3 notifications marked as read", "تم تحديد 3 إشعارات كمقروءة"],
    [11, "11 notifications marked as read", "تم تحديد 11 إشعاراً كمقروءاً"],
  ])("markAllResult(%d)", (count, expectedEn, expectedAr) => {
    expect(notificationsEn.markAllResult(count)).toBe(expectedEn);
    expect(notificationsAr.markAllResult(count)).toBe(expectedAr);
  });
});

// ===========================================================================
describe("template pins — function slots expand their arguments", () => {
  test("markReadAriaLabel embeds the notification title in BOTH locales", () => {
    expect(notificationsEn.markReadAriaLabel("New session request")).toBe("Mark as read: New session request");
    expect(notificationsAr.markReadAriaLabel("طلب جلسة جديد")).toBe("تحديد كمقروء: طلب جلسة جديد");
  });

  test("realtimeToast embeds the type label AND the notification title in BOTH locales", () => {
    expect(notificationsEn.realtimeToast("Session Request", "New session request")).toBe(
      "New notification — Session Request: New session request"
    );
    expect(notificationsAr.realtimeToast("طلب جلسة", "طلب جلسة جديد")).toBe("إشعار جديد — طلب جلسة: طلب جلسة جديد");
  });

  test("parent-link event bodies embed the counterpart name in BOTH locales", () => {
    expect(notificationsEn.eventParentLinkRequestBody("Adam")).toContain("Adam");
    expect(notificationsAr.eventParentLinkRequestBody("ولي الأمر")).toContain("ولي الأمر");
    expect(notificationsEn.eventParentLinkAcceptedBody("Yusuf")).toContain("Yusuf");
    expect(notificationsAr.eventParentLinkAcceptedBody("الطالب")).toContain("الطالب");
    expect(notificationsEn.eventParentLinkRejectedBody("Yusuf")).toContain("Yusuf");
    expect(notificationsAr.eventParentLinkRejectedBody("الطالب")).toContain("الطالب");
  });

  test("all seven function slots are callable with non-empty output in BOTH locales", () => {
    expect(notificationsEn.markReadAriaLabel("Payment received").length).toBeGreaterThan(0);
    expect(notificationsEn.markAllResult(4).length).toBeGreaterThan(0);
    expect(notificationsEn.unreadCount(4).length).toBeGreaterThan(0);
    expect(notificationsEn.realtimeToast("System Announcement", "Maintenance tonight").length).toBeGreaterThan(0);
    expect(notificationsAr.markReadAriaLabel("تأكيد الدفع").length).toBeGreaterThan(0);
    expect(notificationsAr.markAllResult(4).length).toBeGreaterThan(0);
    expect(notificationsAr.unreadCount(4).length).toBeGreaterThan(0);
    expect(notificationsAr.realtimeToast("إعلان النظام", "صيانة الليلة").length).toBeGreaterThan(0);
    expect(notificationsEn.eventParentLinkRequestBody("Adam").length).toBeGreaterThan(0);
    expect(notificationsEn.eventParentLinkAcceptedBody("Yusuf").length).toBeGreaterThan(0);
    expect(notificationsEn.eventParentLinkRejectedBody("Yusuf").length).toBeGreaterThan(0);
    expect(notificationsAr.eventParentLinkRequestBody("ولي الأمر").length).toBeGreaterThan(0);
    expect(notificationsAr.eventParentLinkAcceptedBody("الطالب").length).toBeGreaterThan(0);
    expect(notificationsAr.eventParentLinkRejectedBody("الطالب").length).toBeGreaterThan(0);
  });
});

// ===========================================================================
describe("registry + bundle wiring", () => {
  test("namespaces registry exposes the Notifications handle with the `<ns>.<ns>` id convention", () => {
    expect(Object.hasOwn(namespaces, "Notifications")).toBe(true);
    expect(Notifications.id).toBe("notifications.notifications");
  });

  test("handle getter resolves the composed bundle slice (both locales)", () => {
    expect(Notifications.getLabels(enMessages)).toBe(enMessages.notificationsTranslations);
    expect(Notifications.getLabels(arMessages)).toBe(arMessages.notificationsTranslations);
  });

  test("`notificationsTranslations` exists on BOTH message bundles", () => {
    expect(Object.hasOwn(enMessages, "notificationsTranslations")).toBe(true);
    expect(Object.hasOwn(arMessages, "notificationsTranslations")).toBe(true);
  });

  test("the bundle slice IS the leaf map (no re-wrapper indirection) in BOTH locales", () => {
    expect(enMessages.notificationsTranslations).toBe(notificationsEn);
    expect(arMessages.notificationsTranslations).toBe(notificationsAr);
  });
});

// ===========================================================================
describe("function-slot inventory — exactly the eight locale functions, on BOTH maps", () => {
  test.each([...FUNCTION_KEYS])("slot `%s` is a function on BOTH maps", key => {
    expect(typeof Reflect.get(notificationsAr, key)).toBe("function");
    expect(typeof Reflect.get(notificationsEn, key)).toBe("function");
  });

  test("no OTHER slot is function-valued (string/function split is stable)", () => {
    for (const key of Object.keys(notificationsEn)) {
      const isFunction = typeof Reflect.get(notificationsEn, key) === "function";
      expect(isFunction).toBe((FUNCTION_KEYS as readonly string[]).includes(key));
    }
  });
});
