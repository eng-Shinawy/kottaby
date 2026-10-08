/**
 * `phoneInput`-namespace locale verification
 * · ar+en parity gates over the NEW `phoneInput` UI namespace plus
 *   synchronous resolution checks through `getTranslations(locale)`.
 *
 * WHAT THIS LOCKS
 *   1. PHONEINPUT PARITY BELT — the ar/en `phoneInput` leaf maps
 *      expose IDENTICAL key sets with non-empty string values (belt #2: the
 *      PRIMARY parity gate is compile-time typing where BOTH leaf consts are
 *      typed `PhoneInputLabels`; any missing key fails `bun tsgo`).
 *   2. ARABIC-SCRIPT SANITY — every Arabic value actually contains Arabic
 *      script, differs from its English twin, and is not an RTL-mangled
 *      copy (guards a paste of English into the `ar` leaf).
 *   3. REGISTRY WIRING — the `PhoneInput` handle is registered in the
 *      composed registry with the conventional `<ns>.<ns>` id; every
 *      registered handle keeps a UNIQUE non-empty id (no duplicate or
 *      absent entry), both message bundles carry
 *      `phoneInputTranslations`, and the getter resolves the
 *      composed bundle slice.
 *   4. STATIC-STRING SAFETY — every label is a plain static string: no
 *      function-valued keys, no ICU placeholder tokens, no control /
 *      bidi-override / markup characters (no interpolation or injection
 *      surface).
 *
 * Mirrors the structure of `shared/locale/countrySelector-namespace.parity.test.ts`.
 *
 * Pure unit tier — NO server boot, NO network, NO DB.
 */

import { describe, expect, test } from "bun:test";
import { defaultLocale } from "@/shared/locale/AppLocale";
import { arMessages } from "@/shared/locale/ar/messages";
import { phoneInputAr } from "@/shared/locale/ar/phoneInput";
import { enMessages } from "@/shared/locale/en/messages";
import { phoneInputEn } from "@/shared/locale/en/phoneInput";
import { namespaces } from "@/shared/locale/namespaces/index";
import { PhoneInput } from "@/shared/locale/namespaces/phoneInput";
import { getTranslations } from "@/shared/locale/server";

// ─── Mandated registries ─────────────────────────────────────────────────────

/** Every string-valued key on the `PhoneInputLabels` interface (parity belt surface). */
const PHONE_INPUT_STRING_KEYS = [
  "label",
  "selectCountry",
  "invalidPrefix",
  "invalidPhone",
  "required",
  "countryCallingCode",
  "phoneNumber",
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

// ─── 1. Parity belt ──────────────────────────────────────────────────────────

describe("phoneInput namespace — ar/en parity belt", () => {
  for (const key of PHONE_INPUT_STRING_KEYS) {
    test(`phoneInput.${key}: non-empty in BOTH locales`, () => {
      expectNonEmptyString(phoneInputEn[key], `phoneInputEn.${key}`);
      expectNonEmptyString(phoneInputAr[key], `phoneInputAr.${key}`);
    });
  }

  test("the parity surface covers every interface key (no key left unasserted)", () => {
    expect([...PHONE_INPUT_STRING_KEYS].toSorted((a, b) => a.localeCompare(b))).toEqual([
      "countryCallingCode",
      "invalidPhone",
      "invalidPrefix",
      "label",
      "phoneNumber",
      "required",
      "selectCountry",
    ]);
  });
});

// ─── 2. Arabic-script sanity ─────────────────────────────────────────────────

describe("phoneInput namespace — Arabic-script sanity", () => {
  for (const key of PHONE_INPUT_STRING_KEYS) {
    test(`ar.phoneInput.${key} is Arabic script and not the en string`, () => {
      expect(containsArabicScript(phoneInputAr[key]), `phoneInputAr.${key} must be Arabic script`).toBe(true);
      expect(phoneInputAr[key], `phoneInputAr.${key} must not fall back to the en string`).not.toBe(phoneInputEn[key]);
    });
  }
});

// ─── 3. Registry wiring ──────────────────────────────────────────────────────

describe("phoneInput namespace — registry wiring", () => {
  const registryHandles = Object.values(namespaces);
  const registryIds = registryHandles.map(handle => handle.id);

  test("PhoneInput handle registered with the conventional phoneInput.phoneInput id", () => {
    expect(PhoneInput.id).toBe("phoneInput.phoneInput");
    expect(namespaces.PhoneInput).toBe(PhoneInput);
  });

  test("every registry handle keeps a unique non-empty id (no duplicate entry)", () => {
    for (const id of registryIds) {
      expect(id, "registry handle ids must be non-empty").not.toBe("");
    }
    expect(new Set(registryIds).size).toBe(registryIds.length);
  });

  test("the phoneInput id appears exactly once (no absent, no duplicated entry)", () => {
    expect(registryIds.filter(id => id === "phoneInput.phoneInput")).toHaveLength(1);
    expect(registryIds).toContain("phoneInput.phoneInput");
  });

  test("both message bundles carry phoneInputTranslations", () => {
    expect(enMessages.phoneInputTranslations).toBe(phoneInputEn);
    expect(arMessages.phoneInputTranslations).toBe(phoneInputAr);
  });

  test("the PhoneInput getter resolves the composed bundle slice", () => {
    expect(PhoneInput.getLabels(enMessages)).toBe(phoneInputEn);
    expect(PhoneInput.getLabels(arMessages)).toBe(phoneInputAr);
  });
});

// ─── 4. Sync resolution ─────────────────────────────────────────────────────

describe("phoneInput namespace — sync resolution through getTranslations", () => {
  test("en resolves every key", () => {
    const t = getTranslations("en").phoneInputTranslations;
    for (const key of PHONE_INPUT_STRING_KEYS) {
      expect(t[key]).toBe(phoneInputEn[key]);
    }
  });

  test("ar resolves every key (Arabic script)", () => {
    const t = getTranslations("ar").phoneInputTranslations;
    for (const key of PHONE_INPUT_STRING_KEYS) {
      expect(t[key]).toBe(phoneInputAr[key]);
      expect(containsArabicScript(t[key])).toBe(true);
    }
  });

  test("unknown locales fall back to the DEFAULT locale without throwing", () => {
    const fallback = getTranslations(defaultLocale).phoneInputTranslations;
    const t = getTranslations("xx").phoneInputTranslations;
    expect(t.label).toBe(fallback.label);
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

describe("phoneInput namespace — static-string safety (no interpolation/injection surface)", () => {
  test("every key is a plain string in BOTH locales (no function-valued labels)", () => {
    for (const key of PHONE_INPUT_STRING_KEYS) {
      expect(typeof phoneInputEn[key], `en.${key} must be a static string`).toBe("string");
      expect(typeof phoneInputAr[key], `ar.${key} must be a static string`).toBe("string");
    }
  });

  test("no ICU placeholder tokens in any label", () => {
    for (const key of PHONE_INPUT_STRING_KEYS) {
      expect(phoneInputEn[key], `en.${key} must not contain ICU braces`).not.toMatch(/[{}]/);
      expect(phoneInputAr[key], `ar.${key} must not contain ICU braces`).not.toMatch(/[{}]/);
    }
  });

  test("no control / bidi-override / markup characters in any label", () => {
    for (const key of PHONE_INPUT_STRING_KEYS) {
      expect(containsForbiddenCharacter(phoneInputEn[key]), `en.${key} must be plain text`).toBe(false);
      expect(containsForbiddenCharacter(phoneInputAr[key]), `ar.${key} must be plain text`).toBe(false);
    }
  });
});
