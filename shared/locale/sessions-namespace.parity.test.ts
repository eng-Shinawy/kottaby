/**
 * `sessions`-namespace + session error-key locale verification
 * · ar+en parity gates over the NEW `sessions` UI namespace and the SEVEN
 *   session-lifecycle keys added to the `errors` namespace, plus synchronous
 *   resolution checks through `getTranslations(locale)`.
 *
 * WHAT THIS LOCKS
 *   1. ERRORS REGISTRY PIN — every session-lifecycle error key
 *      (`sessionNotFound`, `sessionInvalidTransition`, `teacherNotCertified`,
 *      `teacherNotFound`, `insufficientBalance`, `idempotencyKeyRequired`,
 *      `invalidSessionIntent`) exists as a NON-EMPTY string in BOTH locale
 *      maps of the `errors` namespace. `teacherNotFound` is a DEDICATED key —
 *      it must stay distinct from the generic `notFound` (different copy).
 *   2. SESSIONS PARITY BELT — the ar/en `sessions` leaf maps expose IDENTICAL
 *      key sets with non-empty string values (belt #2: the PRIMARY parity
 *      gate is compile-time typing where BOTH leaf consts are typed
 *      `SessionsLabels`; any missing key fails `bun tsgo`. This suite keeps
 *      the guarantee enforced even if someone loosens that typing later).
 *      Every mandated registry key is asserted present on BOTH maps; ICU
 *      placeholder-name sets agree across locales per key (no locale-local
 *      drift).
 *   3. REGISTRY WIRING — the `Sessions` handle is registered in
 *      `shared/locale/namespaces/index.ts` with the conventional `<ns>.<ns>`
 *      id and its getter resolves to the composed bundle slice; both message
 *      bundles carry `sessionsTranslations`.
 *   4. SYNC RESOLUTION — `getTranslations(locale)` (pure, in-memory, never
 *      suspends) resolves a sample of the new keys in BOTH locales, warming
 *      the namespace the way component suites warm it before rendering.
 *   5. ARABIC-SCRIPT SANITY — sampled Arabic values actually contain Arabic
 *      script (guards a copy paste of English into the `ar` leaf).
 *
 * Mirrors the structure of `shared/locale/applicant-namespace.parity.test.ts`
 * (the closest sibling: new keys on `errors` + a brand-new namespace).
 *
 * Pure unit tier — NO server boot, NO network, NO DB. Runs via the mandated
 * runner: `bun run test/scripts/run-test.ts shared/locale/sessions-namespace.parity.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import { errorsAr } from "@/shared/locale/ar/errors";
import { arMessages } from "@/shared/locale/ar/messages";
import { sessionsAr } from "@/shared/locale/ar/sessions";
import { errorsEn } from "@/shared/locale/en/errors";
import { enMessages } from "@/shared/locale/en/messages";
import { sessionsEn } from "@/shared/locale/en/sessions";
import { namespaces } from "@/shared/locale/namespaces/index";
import { Sessions } from "@/shared/locale/namespaces/sessions";
import { getTranslations } from "@/shared/locale/server";

// ─── Mandated registries ─────────────────────────────────────────────────────

/** The SEVEN session-lifecycle keys mandated on the flat `ErrorsLabels` interface. */
const SESSION_ERROR_KEYS = [
  "sessionNotFound",
  "sessionInvalidTransition",
  "teacherNotCertified",
  "teacherNotFound",
  "insufficientBalance",
  "idempotencyKeyRequired",
  "invalidSessionIntent",
] as const;

/** The full key registry mandated for the `sessions` UI namespace. */
const MANDATED_SESSIONS_KEYS = [
  "studentPageTitle",
  "teacherPageTitle",
  "statusFilterAll",
  "status",
  "intent",
  "fee",
  "deadline",
  "createdAt",
  "studentEmptyTitle",
  "studentEmptyBody",
  "teacherEmptyTitle",
  "teacherEmptyBody",
  "statusScheduled",
  "statusStarted",
  "statusCompleted",
  "statusCancelled",
  "statusDisputed",
  "startSession",
  "completeSession",
  "cancelSession",
  "cancelConfirmTitle",
  "cancelConfirmBody",
  "cancelReasonLabel",
  "cancelReasonPlaceholder",
  "openDispute",
  "disputeConfirmTitle",
  "disputeConfirmBody",
  "disputeReasonLabel",
  "disputeReasonPlaceholder",
  "disputeReasonRequired",
  "disputeOpenedNotice",
  "cancelDisabledDisputed",
  "cancelReasonLine",
  "sessionStartedNotice",
  "sessionCompletedNotice",
  "sessionCancelledNotice",
  "holdReleasedNotice",
  "duplicateBookingInfo",
  "genericError",
  "adminDisputesPageTitle",
  "adminDisputesCountLine",
  "adminDisputesEmptyTitle",
  "adminDisputesEmptyBody",
  "disputeReasonMeta",
  "disputedAtLabel",
  "participantsLabel",
  "resolveDispute",
  "resolveDisputeTitle",
  "resolveDisputeBody",
  "resolutionCancelLabel",
  "resolutionCancelHelper",
  "resolutionCompleteLabel",
  "resolutionCompleteHelper",
  "resolutionNoteLabel",
  "resolutionNotePlaceholder",
  "resolveDisputeSubmit",
  "disputeResolvedNotice",
  "disputeReasonExpand",
  "disputeReasonCollapse",
  "pagerPreviousLabel",
  "pagerNextLabel",
] as const;

/**
 * Keys whose values are TEMPLATE FUNCTIONS (the `DashboardLabels.welcome`
 * precedent) instead of plain strings — the arbitration count line
 * interpolates the honest total. Resolved by INVOKING them with a sample
 * argument rather than the string path.
 */
const FUNCTION_LABEL_KEYS: ReadonlySet<string> = new Set(["adminDisputesCountLine"]);

/** Keys resolved through `getTranslations(locale)` in the sync-resolution tier. */
const SYNC_SAMPLE_ERROR_KEYS = ["sessionNotFound", "teacherNotFound", "insufficientBalance"] as const;
const SYNC_SAMPLE_SESSIONS_KEYS = [
  "studentPageTitle",
  "statusScheduled",
  "statusDisputed",
  "disputeOpenedNotice",
  "adminDisputesPageTitle",
  "duplicateBookingInfo",
  "genericError",
] as const;

/** Keys probed for Arabic-script content in the `ar` leaf. */
const ARABIC_SCRIPT_SAMPLE_KEYS = [
  "studentEmptyBody",
  "cancelConfirmBody",
  "disputeConfirmBody",
  "statusScheduled",
  "statusDisputed",
  "duplicateBookingInfo",
  "adminDisputesEmptyBody",
] as const;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Every `{name}` ICU placeholder occurring in a template, deduplicated + sorted. */
function icuPlaceholdersOf(template: string): string[] {
  const seen = new Set<string>();
  const placeholder = /\{([A-Za-z]\w*)\}/g;
  let match = placeholder.exec(template);
  while (match !== null) {
    if (typeof match[1] === "string") {
      seen.add(match[1]);
    }
    match = placeholder.exec(template);
  }
  return [...seen].toSorted((a, b) => a.localeCompare(b));
}

/** Reads one non-empty-string value slot off a locale map — throws otherwise. */
function nonEmptyLabelOf(localeMap: object, key: string, localeName: string): string {
  const value: unknown = Reflect.get(localeMap, key);
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${localeName}.${key} must be a non-empty localized string`);
  }
  return value;
}

/**
 * Reads one label slot accepting BOTH value shapes: plain-string keys read
 * directly; template-function keys (see {@link FUNCTION_LABEL_KEYS}) resolve
 * by invocation with a sample argument. Throws on anything that does not
 * produce a non-empty string.
 */
function resolvedLabelOf(localeMap: object, key: string, localeName: string): string {
  if (FUNCTION_LABEL_KEYS.has(key)) {
    const fn: unknown = Reflect.get(localeMap, key);
    if (typeof fn !== "function") {
      throw new Error(`${localeName}.${key} must be a template function`);
    }
    // Reflect.apply (not a direct call): the value is only known as
    // `Function` here — invoking through the Reflect channel keeps the
    // unsafe-call lint table satisfied while the result is re-narrowed.
    const value: unknown = Reflect.apply(fn, undefined, [2]);
    if (typeof value !== "string" || value.length === 0) {
      throw new Error(`${localeName}.${key} must resolve to a non-empty localized string`);
    }
    return value;
  }
  return nonEmptyLabelOf(localeMap, key, localeName);
}

// ===========================================================================
describe("errors registry — the seven session-lifecycle keys in BOTH locales", () => {
  test.each([...SESSION_ERROR_KEYS])("errors key `%s` resolves as a non-empty string in BOTH locales", key => {
    expect(nonEmptyLabelOf(errorsAr, key, "ar").length).toBeGreaterThan(0);
    expect(nonEmptyLabelOf(errorsEn, key, "en").length).toBeGreaterThan(0);
    // Key must be part of the COMPILE-TIME schema too — Reflect-only
    // additions (untyped holes) are prohibited by the ErrorsLabels contract.
    expect(Object.hasOwn(errorsEn, key)).toBe(true);
    expect(Object.hasOwn(errorsAr, key)).toBe(true);
  });

  test("`teacherNotFound` stays a DEDICATED key — copy differs from the generic `notFound`", () => {
    expect(nonEmptyLabelOf(errorsEn, "teacherNotFound", "en")).not.toBe(nonEmptyLabelOf(errorsEn, "notFound", "en"));
    expect(nonEmptyLabelOf(errorsAr, "teacherNotFound", "ar")).not.toBe(nonEmptyLabelOf(errorsAr, "notFound", "ar"));
  });

  test("placeholder-name sets agree across ar/en for EVERY errors key (no locale-local drift)", () => {
    for (const key of Object.keys(errorsAr)) {
      const arNames = icuPlaceholdersOf(nonEmptyLabelOf(errorsAr, key, "ar"));
      const enNames = icuPlaceholdersOf(nonEmptyLabelOf(errorsEn, key, "en"));
      expect(enNames).toEqual(arNames);
    }
  });
});

// ===========================================================================
describe("sessions namespace — compile-time parity mirror", () => {
  test("identical sorted key sets across BOTH locale sources", () => {
    const arKeys = Object.keys(sessionsAr).toSorted((a, b) => a.localeCompare(b));
    const enKeys = Object.keys(sessionsEn).toSorted((a, b) => a.localeCompare(b));

    expect(arKeys.length).toBeGreaterThan(0);
    expect(enKeys).toEqual(arKeys);
  });

  test("every mandated registry key exists on BOTH maps", () => {
    for (const key of MANDATED_SESSIONS_KEYS) {
      expect(Object.hasOwn(sessionsEn, key)).toBe(true);
      expect(Object.hasOwn(sessionsAr, key)).toBe(true);
    }
  });

  test("every value on BOTH maps is a non-empty localized string (zero dead keys)", () => {
    for (const key of Object.keys(sessionsAr)) {
      expect(resolvedLabelOf(sessionsAr, key, "ar").length).toBeGreaterThan(0);
      expect(resolvedLabelOf(sessionsEn, key, "en").length).toBeGreaterThan(0);
    }
    // Symmetric sweep — guards an en-only key that ar lost via future drift.
    for (const key of Object.keys(sessionsEn)) {
      expect(resolvedLabelOf(sessionsAr, key, "ar").length).toBeGreaterThan(0);
    }
  });

  test("placeholder-name sets agree across ar/en for EVERY sessions key (no locale-local drift)", () => {
    for (const key of Object.keys(sessionsAr)) {
      // Template-function keys interpolate through arguments (no ICU braces);
      // the invocation above still yields comparable resolved strings.
      const arNames = icuPlaceholdersOf(resolvedLabelOf(sessionsAr, key, "ar"));
      const enNames = icuPlaceholdersOf(resolvedLabelOf(sessionsEn, key, "en"));
      expect(enNames).toEqual(arNames);
    }
  });

  test("sampled Arabic values carry Arabic script (guards an English paste into the ar leaf)", () => {
    const arabicLetter = /[\u0600-\u06FF]/;
    for (const key of ARABIC_SCRIPT_SAMPLE_KEYS) {
      expect(arabicLetter.test(nonEmptyLabelOf(sessionsAr, key, "ar"))).toBe(true);
    }
  });
});

// ===========================================================================
describe("sessions registry + bundle wiring", () => {
  test("namespaces registry exposes the Sessions handle with the `<ns>.<ns>` id convention", () => {
    expect(Object.hasOwn(namespaces, "Sessions")).toBe(true);
    expect(Sessions.id).toBe("sessions.sessions");
  });

  test("handle getter resolves the composed bundle slice (both locales)", () => {
    expect(Sessions.getLabels(enMessages)).toBe(enMessages.sessionsTranslations);
    expect(Sessions.getLabels(arMessages)).toBe(arMessages.sessionsTranslations);
  });

  test("`sessionsTranslations` exists on BOTH message bundles", () => {
    expect(Object.hasOwn(enMessages, "sessionsTranslations")).toBe(true);
    expect(Object.hasOwn(arMessages, "sessionsTranslations")).toBe(true);
  });
});

// ===========================================================================
describe("sync resolution — getTranslations(locale) resolves the new keys", () => {
  test("sampled error keys resolve synchronously in BOTH locales", () => {
    for (const locale of ["en", "ar"] as const) {
      const translations = getTranslations(locale);
      for (const key of SYNC_SAMPLE_ERROR_KEYS) {
        const value = translations.errorsTranslations[key];
        expect(typeof value).toBe("string");
        expect(value.length).toBeGreaterThan(0);
      }
    }
  });

  test("sampled sessions keys resolve synchronously in BOTH locales", () => {
    for (const locale of ["en", "ar"] as const) {
      const translations = getTranslations(locale);
      for (const key of SYNC_SAMPLE_SESSIONS_KEYS) {
        const value = translations.sessionsTranslations[key];
        expect(typeof value).toBe("string");
        expect(value.length).toBeGreaterThan(0);
      }
    }
  });

  test("unknown locale falls back to the default bundle without throwing", () => {
    const translations = getTranslations("xx");
    expect(typeof translations.sessionsTranslations.studentPageTitle).toBe("string");
  });
});
