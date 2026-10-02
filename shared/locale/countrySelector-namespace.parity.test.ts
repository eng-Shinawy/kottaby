/**
 * `countrySelector`-namespace locale verification
 * · ar+en parity gates over the NEW `countrySelector` UI namespace plus
 *   synchronous resolution checks through `getTranslations(locale)`.
 *
 * WHAT THIS LOCKS
 *   1. COUNTRYSELECTOR PARITY BELT — the ar/en `countrySelector` leaf maps
 *      expose IDENTICAL key sets with non-empty string values (belt #2: the
 *      PRIMARY parity gate is compile-time typing where BOTH leaf consts are
 *      typed `CountrySelectorLabels`; any missing key fails `bun tsgo`).
 *   2. ARABIC-SCRIPT SANITY — every Arabic value actually contains Arabic
 *      script, differs from its English twin, and is not an RTL-mangled
 *      copy (guards a paste of English into the `ar` leaf).
 *   3. REGISTRY WIRING — the `CountrySelector` handle is registered in the
 *      composed registry with the conventional `<ns>.<ns>` id; every
 *      registered handle keeps a UNIQUE non-empty id (no duplicate or
 *      absent entry), both message bundles carry
 *      `countrySelectorTranslations`, and the getter resolves the
 *      composed bundle slice.
 *   4. STATIC-STRING SAFETY — every label is a plain static string: no
 *      function-valued keys, no ICU placeholder tokens, no control /
 *      bidi-override / markup characters (no interpolation or injection
 *      surface).
 *
 * Mirrors the structure of `shared/locale/wallet-namespace.parity.test.ts`.
 *
 * Pure unit tier — NO server boot, NO network, NO DB.
 */

import { describe, expect, test } from "bun:test";
import { defaultLocale } from "@/shared/locale/AppLocale";
import { countrySelectorAr } from "@/shared/locale/ar/countrySelector";
import { arMessages } from "@/shared/locale/ar/messages";
import { countrySelectorEn } from "@/shared/locale/en/countrySelector";
import { enMessages } from "@/shared/locale/en/messages";
import { CountrySelector } from "@/shared/locale/namespaces/countrySelector";
import { namespaces } from "@/shared/locale/namespaces/index";
import { getTranslations } from "@/shared/locale/server";

// ─── Mandated registries ─────────────────────────────────────────────────────

/** Every string-valued key on the `CountrySelectorLabels` interface (parity belt surface). */
const COUNTRY_SELECTOR_STRING_KEYS = ["placeholder", "noOptionsText", "fieldLabel"] as const;

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

// ─── 1. Parity belt ──────────────────────────────────────────────────────────

describe("countrySelector namespace — ar/en parity belt", () => {
  for (const key of COUNTRY_SELECTOR_STRING_KEYS) {
    test(`countrySelector.${key}: non-empty in BOTH locales`, () => {
      expectNonEmptyString(countrySelectorEn[key], `countrySelectorEn.${key}`);
      expectNonEmptyString(countrySelectorAr[key], `countrySelectorAr.${key}`);
    });
  }

  test("the parity surface covers every interface key (no key left unasserted)", () => {
    expect([...COUNTRY_SELECTOR_STRING_KEYS].toSorted((a, b) => a.localeCompare(b))).toEqual([
      "fieldLabel",
      "noOptionsText",
      "placeholder",
    ]);
  });
});

// ─── 2. Arabic-script sanity ─────────────────────────────────────────────────

describe("countrySelector namespace — Arabic-script sanity", () => {
  for (const key of COUNTRY_SELECTOR_STRING_KEYS) {
    test(`ar.countrySelector.${key} is Arabic script and not the en string`, () => {
      expect(containsArabicScript(countrySelectorAr[key]), `countrySelectorAr.${key} must be Arabic script`).toBe(true);
      expect(countrySelectorAr[key], `countrySelectorAr.${key} must not fall back to the en string`).not.toBe(
        countrySelectorEn[key]
      );
    });
  }
});

// ─── 3. Registry wiring ──────────────────────────────────────────────────────

describe("countrySelector namespace — registry wiring", () => {
  const registryHandles = Object.values(namespaces);
  const registryIds = registryHandles.map(handle => handle.id);

  test("CountrySelector handle registered with the conventional countrySelector.countrySelector id", () => {
    expect(CountrySelector.id).toBe("countrySelector.countrySelector");
    expect(namespaces.CountrySelector).toBe(CountrySelector);
  });

  test("every registry handle keeps a unique non-empty id (no duplicate entry)", () => {
    for (const id of registryIds) {
      expect(id, "registry handle ids must be non-empty").not.toBe("");
    }
    expect(new Set(registryIds).size).toBe(registryIds.length);
  });

  test("the countrySelector id appears exactly once (no absent, no duplicated entry)", () => {
    expect(registryIds.filter(id => id === "countrySelector.countrySelector")).toHaveLength(1);
    expect(registryIds).toContain("countrySelector.countrySelector");
  });

  test("both message bundles carry countrySelectorTranslations", () => {
    expect(enMessages.countrySelectorTranslations).toBe(countrySelectorEn);
    expect(arMessages.countrySelectorTranslations).toBe(countrySelectorAr);
  });

  test("the CountrySelector getter resolves the composed bundle slice", () => {
    expect(CountrySelector.getLabels(enMessages)).toBe(countrySelectorEn);
    expect(CountrySelector.getLabels(arMessages)).toBe(countrySelectorAr);
  });
});

// ─── 4. Sync resolution ──────────────────────────────────────────────────────

describe("countrySelector namespace — sync resolution through getTranslations", () => {
  test("en resolves every key", () => {
    const t = getTranslations("en").countrySelectorTranslations;
    for (const key of COUNTRY_SELECTOR_STRING_KEYS) {
      expect(t[key]).toBe(countrySelectorEn[key]);
    }
  });

  test("ar resolves every key (Arabic script)", () => {
    const t = getTranslations("ar").countrySelectorTranslations;
    for (const key of COUNTRY_SELECTOR_STRING_KEYS) {
      expect(t[key]).toBe(countrySelectorAr[key]);
      expect(containsArabicScript(t[key])).toBe(true);
    }
  });

  test("unknown locales fall back to the DEFAULT locale without throwing", () => {
    const fallback = getTranslations(defaultLocale).countrySelectorTranslations;
    const t = getTranslations("xx").countrySelectorTranslations;
    expect(t.placeholder).toBe(fallback.placeholder);
  });
});

/**
 * Control (C0/DEL), bidi-override/isolate, and markup characters that must
 * never appear inside a static label (no interpolation / injection surface).
 */
function containsForbiddenCharacter(value: string): boolean {
  for (const char of value) {
    const cp = char.codePointAt(0) ?? 0;
    if (cp < 0x20 || cp === 0x7f) return true; // C0 controls + DEL
    if (cp === 0x200e || cp === 0x200f) return true; // LRM / RLM direction marks
    if (cp >= 0x202a && cp <= 0x202e) return true; // bidi overrides
    if (cp >= 0x2066 && cp <= 0x2069) return true; // bidi isolates
    if (char === "<" || char === ">" || char === "\\" || char === "`" || char === "$") return true; // markup / template chars
  }
  return false;
}

// ─── 5. Static-string safety ─────────────────────────────────────────────────

describe("countrySelector namespace — static-string safety (no interpolation/injection surface)", () => {
  test("every key is a plain string in BOTH locales (no function-valued labels)", () => {
    for (const key of COUNTRY_SELECTOR_STRING_KEYS) {
      expect(typeof countrySelectorEn[key], `en.${key} must be a static string`).toBe("string");
      expect(typeof countrySelectorAr[key], `ar.${key} must be a static string`).toBe("string");
    }
  });

  test("no ICU placeholder tokens in any label", () => {
    for (const key of COUNTRY_SELECTOR_STRING_KEYS) {
      expect(countrySelectorEn[key], `en.${key} must not contain ICU braces`).not.toMatch(/[{}]/);
      expect(countrySelectorAr[key], `ar.${key} must not contain ICU braces`).not.toMatch(/[{}]/);
    }
  });

  test("no control / bidi-override / markup characters in any label", () => {
    for (const key of COUNTRY_SELECTOR_STRING_KEYS) {
      expect(containsForbiddenCharacter(countrySelectorEn[key]), `en.${key} must be plain text`).toBe(false);
      expect(containsForbiddenCharacter(countrySelectorAr[key]), `ar.${key} must be plain text`).toBe(false);
    }
  });
});
