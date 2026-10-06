/**
 * `availability`-namespace locale-parity verification
 * · ar+en parity gate + 10-key frozen set pin + Arabic-script sanity.
 *
 * WHAT THIS LOCKS
 *   1. AVAILABILITY PARITY BELT — the ar/en `availability` leaf maps expose
 *      IDENTICAL key sets with non-empty string values (belt #2: the PRIMARY
 *      parity gate is compile-time typing where BOTH leaf consts are typed
 *      `AvailabilityLabels`; any missing key fails `bun tsgo`). This suite
 *      keeps the guarantee enforced even if someone loosens that typing
 *      later.
 *   2. FROZEN 10-KEY SET PIN — the `availability` namespace admits EXACTLY
 *      these ten leaf-string keys (no functions, no grouped sub-blocks):
 *      `cardTitle`, `statusAvailable`, `statusUnavailable`,
 *      `toggleToAvailableCta`, `toggleToUnavailableCta`,
 *      `certificationRequiredHint`, `inSessionLockedHint`, `updateSuccess`,
 *      `updateGenericError`, `loadErrorNotice`. Adding or removing any key
 *      fails this gate even if compile-time parity is intact.
 *   3. ARABIC-SCRIPT SANITY — EVERY `ar` leaf carries Arabic script
 *      (U+0600–U+06FF), guarding against an accidental copy-paste of the
 *      English copy into the `ar` leaf.
 *   4. REGISTRY WIRING — the `Availability` handle is registered in
 *      `shared/locale/namespaces/registry.ts` with the conventional
 *      `<ns>.<ns>` id (`availability.availability`) and its getter resolves
 *      to the composed bundle slice; both message bundles carry
 *      `availabilityTranslations`.
 *   5. SYNC RESOLUTION — `getTranslations(locale)` (pure, in-memory, never
 *      suspends) resolves a sample of the new keys in BOTH locales.
 *   6. INTERPOLATION-FREE PIN — EVERY leaf is a STATIC string with ZERO
 *      ICU placeholders. The availability card surfaces NO identifier (no
 *      teacher id, name, email, or session id) — the structured denial codes
 *      (`TEACHER_IN_ACTIVE_SESSION`, `FORBIDDEN`, `TEACHER_NOT_FOUND`,
 *      `VALIDATION`) are surfaced via the error-link map against the REUSED
 *      `errors` keys, never through this namespace.
 *
 * Mirrors the structure of `shared/locale/wallet-namespace.parity.test.ts`
 * (the all-leaf-string namespace exemplar).
 *
 * Pure unit tier — NO server boot, NO network, NO DB. Runs via the mandated
 * runner: `bun run test/scripts/run-test.ts shared/locale/availability-namespace.parity.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import { defaultLocale } from "@/shared/locale/AppLocale";
import { availabilityAr } from "@/shared/locale/ar/availability";
import { arMessages } from "@/shared/locale/ar/messages";
import { availabilityEn } from "@/shared/locale/en/availability";
import { enMessages } from "@/shared/locale/en/messages";
import { Availability } from "@/shared/locale/namespaces/availability";
import { namespaces } from "@/shared/locale/namespaces/index";
import { getTranslations } from "@/shared/locale/server";
import type { AvailabilityLabels } from "@/shared/locale/types/availability";

// ─── Mandated registries ─────────────────────────────────────────────────────

/**
 * The frozen 10-key leaf-string set of the `availability` namespace.
 * Adding or removing a key fails this gate even if the compile-time
 * `AvailabilityLabels` typing is intact (this pin guards both the en and ar
 * leaves from silent drift).
 *
 * History: the original 8-key set (cardTitle, the two CTA labels, the two
 * hints, and the three notice keys) grew `statusAvailable`/`statusUnavailable`
 * in the visual-improvement loop for plan #297 — the status chip used to be
 * icon-only (no accessible name, state word missing from the indicator);
 * the loop added the two state-word leaves so the chip is never icon-only.
 */
const AVAILABILITY_FROZEN_KEYS = [
  "cardTitle",
  "statusAvailable",
  "statusUnavailable",
  "toggleToAvailableCta",
  "toggleToUnavailableCta",
  "certificationRequiredHint",
  "inSessionLockedHint",
  "updateSuccess",
  "updateGenericError",
  "loadErrorNotice",
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

/**
 * Reads one non-empty-string value slot off an `AvailabilityLabels` map —
 * throws otherwise. Reserved for the leaf-string surfaces the parity belt
 * covers (the namespace admits no grouped sub-blocks).
 */
function nonEmptyAvailabilityLeaf(
  localeMap: AvailabilityLabels,
  key: (typeof AVAILABILITY_FROZEN_KEYS)[number],
  localeName: string
): string {
  const value: unknown = Reflect.get(localeMap, key);
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`availability.${localeName}.${key} must be a non-empty localized string`);
  }
  return value;
}

// ===========================================================================
describe("availability namespace — frozen 10-key set pin", () => {
  test("the en leaf exposes EXACTLY the 10 frozen keys (no extra, no missing)", () => {
    const enKeys = Object.keys(availabilityEn).toSorted((a, b) => a.localeCompare(b));
    const frozen = [...AVAILABILITY_FROZEN_KEYS].toSorted((a, b) => a.localeCompare(b));
    expect(enKeys).toEqual(frozen);
    expect(enKeys).toHaveLength(AVAILABILITY_FROZEN_KEYS.length);
  });

  test("the ar leaf exposes EXACTLY the 10 frozen keys (no extra, no missing)", () => {
    const arKeys = Object.keys(availabilityAr).toSorted((a, b) => a.localeCompare(b));
    const frozen = [...AVAILABILITY_FROZEN_KEYS].toSorted((a, b) => a.localeCompare(b));
    expect(arKeys).toEqual(frozen);
    expect(arKeys).toHaveLength(AVAILABILITY_FROZEN_KEYS.length);
  });
});

// ===========================================================================
describe("availability namespace — ar/en parity belt", () => {
  test("identical sorted key sets across BOTH locale sources", () => {
    const arKeys = Object.keys(availabilityAr).toSorted((a, b) => a.localeCompare(b));
    const enKeys = Object.keys(availabilityEn).toSorted((a, b) => a.localeCompare(b));

    expect(arKeys).toHaveLength(AVAILABILITY_FROZEN_KEYS.length);
    expect(enKeys).toEqual(arKeys);
  });

  for (const key of AVAILABILITY_FROZEN_KEYS) {
    test(`availability.${key}: non-empty in BOTH locales`, () => {
      expectNonEmptyString(availabilityEn[key], `availabilityEn.${key}`);
      expectNonEmptyString(availabilityAr[key], `availabilityAr.${key}`);
    });
  }

  test("every leaf value on BOTH maps is a non-empty string (zero dead keys, zero grouped blocks)", () => {
    for (const key of Object.keys(availabilityAr)) {
      const arValue: unknown = Reflect.get(availabilityAr, key);
      const enValue: unknown = Reflect.get(availabilityEn, key);
      expect(typeof arValue, `availabilityAr.${key} must be a string`).toBe("string");
      expect(typeof enValue, `availabilityEn.${key} must be a string`).toBe("string");
      expect(arValue, `availabilityAr.${key} must be non-empty`).not.toBe("");
      expect(enValue, `availabilityEn.${key} must be non-empty`).not.toBe("");
    }
  });
});

// ===========================================================================
describe("availability namespace — Arabic-script sanity on EVERY ar leaf", () => {
  for (const key of AVAILABILITY_FROZEN_KEYS) {
    test(`availabilityAr.${key} carries Arabic script (no English slip-through)`, () => {
      const value = nonEmptyAvailabilityLeaf(availabilityAr, key, "ar");
      expect(containsArabicScript(value), `availabilityAr.${key} must be Arabic script`).toBe(true);
    });
  }
});

// ===========================================================================
describe("availability namespace — interpolation-free pin (zero ICU placeholders)", () => {
  for (const key of AVAILABILITY_FROZEN_KEYS) {
    test(`availability.${key} carries ZERO ICU placeholders in BOTH locales (no identifier surfaced)`, () => {
      expect(
        icuPlaceholdersOf(nonEmptyAvailabilityLeaf(availabilityEn, key, "en")),
        `availabilityEn.${key} must be interpolation-free`
      ).toEqual([]);
      expect(
        icuPlaceholdersOf(nonEmptyAvailabilityLeaf(availabilityAr, key, "ar")),
        `availabilityAr.${key} must be interpolation-free`
      ).toEqual([]);
    });
  }
});

// ===========================================================================
describe("availability namespace — registry wiring", () => {
  test("Availability handle registered with the conventional availability.availability id", () => {
    expect(Availability.id).toBe("availability.availability");
    expect(namespaces.Availability).toBe(Availability);
  });

  test("both message bundles carry availabilityTranslations", () => {
    expect(enMessages.availabilityTranslations).toBe(availabilityEn);
    expect(arMessages.availabilityTranslations).toBe(availabilityAr);
  });

  test("the Availability getter resolves the composed bundle slice (both locales)", () => {
    expect(Availability.getLabels(enMessages)).toBe(availabilityEn);
    expect(Availability.getLabels(arMessages)).toBe(availabilityAr);
  });
});

// ===========================================================================
describe("availability namespace — sync resolution through getTranslations", () => {
  test("en resolves the sampled keys", () => {
    const t: AvailabilityLabels = getTranslations("en").availabilityTranslations;
    expect(t.cardTitle).toBe(availabilityEn.cardTitle);
    expect(t.toggleToAvailableCta).toBe(availabilityEn.toggleToAvailableCta);
    expect(t.updateSuccess).toBe(availabilityEn.updateSuccess);
  });

  test("ar resolves the sampled keys (Arabic script)", () => {
    const t: AvailabilityLabels = getTranslations("ar").availabilityTranslations;
    expect(t.cardTitle).toBe(availabilityAr.cardTitle);
    expect(containsArabicScript(t.cardTitle)).toBe(true);
    expect(containsArabicScript(t.toggleToUnavailableCta)).toBe(true);
    expect(containsArabicScript(t.loadErrorNotice)).toBe(true);
  });

  test("unknown locales fall back to the DEFAULT locale without throwing", () => {
    const fallback: AvailabilityLabels = getTranslations(defaultLocale).availabilityTranslations;
    const t: AvailabilityLabels = getTranslations("xx").availabilityTranslations;
    expect(t.cardTitle).toBe(fallback.cardTitle);
  });
});
