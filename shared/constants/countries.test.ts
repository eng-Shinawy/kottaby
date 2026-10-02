/**
 * ISO 3166-1 alpha-2 country dataset (generated) — 4-tier data-integrity guard.
 *
 * WHAT THIS LOCKS
 *   1. TIER 1 (structure) — COUNTRY_CODES and COUNTRIES are a closed pair: no
 *      duplicate codes, exactly one COUNTRIES entry per code (and nothing
 *      extra), and every flag is exactly two regional-indicator codepoints
 *      derived deterministically from its own code.
 *   2. TIER 2 (content boundaries) — every en/ar name is a non-empty,
 *      non-whitespace string; spot-checked Arabic names match CLDR ground
 *      truth so RTL rendering stays correct.
 *   3. TIER 3 (deterministic shape fuzz) — every code matches the anchored
 *      `^[A-Z]{2}$` shape and a seeded fuzz sweep over the shape matcher never
 *      throws and is reproducible (fail-closed, no hidden state).
 *   4. TIER 4 (injection hygiene) — no emitted string carries markup or quote
 *      characters, escape sequences, HTML-entity shapes, control codepoints,
 *      or bidi/zero-width injection marks: the dataset is pure display data.
 *
 * Deep-import pinning: the dataset is deliberately absent from the
 * `@/shared/constants` barrel (same treatment as the iana generated files).
 *
 * Pure unit tier — NO server boot, NO network, NO DB. Runs via the mandated
 * runner: `bun run test/scripts/run-test.ts shared/constants/countries.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import * as constantsBarrel from "@/shared/constants";
import { COUNTRIES, COUNTRY_CODES } from "@/shared/constants/countries";

// ─── Shared fixtures & helpers ───────────────────────────────────────────────

const ISO_ALPHA2_PATTERN = /^[A-Z]{2}$/;

/** Codepoints of the regional-indicator block: U+1F1E6 (A) .. U+1F1FF (Z). */
const REGIONAL_INDICATOR_A = 0x1f1e6;
const REGIONAL_INDICATOR_Z = 0x1f1ff;
const LATIN_CAPITAL_A = 0x41;

/** Curated-out codes must never reappear in the emitted dataset. */
const EXCLUDED_CODES = ["EU", "EZ", "IL", "QO", "UN", "XA", "XB", "XK", "ZZ"] as const;

function derivedFlag(code: string): string {
  return code
    .split("")
    .map(letter => String.fromCodePoint(REGIONAL_INDICATOR_A + letter.charCodeAt(0) - LATIN_CAPITAL_A))
    .join("");
}

function isRegionalIndicatorPair(flag: string): boolean {
  const codePoints = Array.from(flag).map(char => char.codePointAt(0));
  if (codePoints.length !== 2) return false;
  return codePoints.every(
    codePoint => codePoint !== undefined && codePoint >= REGIONAL_INDICATOR_A && codePoint <= REGIONAL_INDICATOR_Z
  );
}

/** Every string the dataset can emit, labeled for failure reports. */
const EMITTED_STRINGS: ReadonlyArray<readonly [string, string]> = [
  ...COUNTRY_CODES.map(code => [`code:${code}`, code] as const),
  ...Object.entries(COUNTRIES).flatMap(([code, info]) => [
    [`en:${code}`, info.en] as const,
    [`ar:${code}`, info.ar] as const,
    [`flag:${code}`, info.flag] as const,
  ]),
];

const MARKUP_OR_ESCAPE_PATTERN = /["\\<>]/;
const HTML_ENTITY_PATTERN = /&(?:[a-zA-Z]{2,8}|#\d{1,7}|#x[0-9a-fA-F]{1,6});/;
const CONTROL_CHAR_PATTERN = /\p{Cc}/u;
const BIDI_AND_ZERO_WIDTH_PATTERN = /[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/;

/** Seeded LCG fuzz sweep — same seed always yields the same outcomes. */
function seededShapeSweepOutcomes(seed: number, rounds: number): boolean[] {
  const alphabet = 'ABCXYZabcxyz0123456789%_\\<>" \t\u0000😀ك';
  const outcomes: boolean[] = [];
  for (let round = 0; round < rounds; round++) {
    const length = seed % 6;
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    let value = "";
    for (let j = 0; j <= length; j++) {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      value += alphabet[seed % alphabet.length];
    }
    outcomes.push(ISO_ALPHA2_PATTERN.test(value));
  }
  return outcomes;
}

// ===========================================================================
describe("tier 1 — structural integrity", () => {
  test("COUNTRY_CODES has no duplicate entries", () => {
    expect(new Set(COUNTRY_CODES).size).toBe(COUNTRY_CODES.length);
  });

  test("COUNTRIES and COUNTRY_CODES are a closed pair (every code, nothing extra)", () => {
    expect(Object.keys(COUNTRIES).toSorted((a, b) => a.localeCompare(b))).toEqual(
      [...COUNTRY_CODES].toSorted((a, b) => a.localeCompare(b))
    );
  });

  test("every flag is exactly two regional-indicator codepoints", () => {
    for (const [code, info] of Object.entries(COUNTRIES)) {
      expect(isRegionalIndicatorPair(info.flag), `flag for ${code}`).toBe(true);
    }
  });

  test("every flag is derived deterministically from its own code", () => {
    for (const [code, info] of Object.entries(COUNTRIES)) {
      expect(info.flag, `flag for ${code}`).toBe(derivedFlag(code));
    }
  });

  test("spot-checked flags render the expected flags", () => {
    expect(COUNTRIES.AE.flag).toBe("🇦🇪");
    expect(COUNTRIES.EG.flag).toBe("🇪🇬");
    expect(COUNTRIES.US.flag).toBe("🇺🇸");
  });

  test("curated-out codes never reappear in the dataset", () => {
    const keys = Object.keys(COUNTRIES);
    for (const excluded of EXCLUDED_CODES) {
      expect(keys, `excluded code ${excluded}`).not.toContain(excluded);
    }
  });

  test("dataset is deep-import only (absent from the shared/constants barrel)", () => {
    const barrelKeys = Object.keys(constantsBarrel);
    expect(barrelKeys).not.toContain("COUNTRY_CODES");
    expect(barrelKeys).not.toContain("COUNTRIES");
    expect(barrelKeys).not.toContain("CountryCode");
  });
});

// ===========================================================================
describe("tier 2 — name content boundaries", () => {
  test("every en and ar name is a non-empty, non-blank string", () => {
    for (const [code, info] of Object.entries(COUNTRIES)) {
      expect(info.en.length, `en name for ${code}`).toBeGreaterThan(0);
      expect(info.en.trim().length, `en name for ${code}`).toBeGreaterThan(0);
      expect(info.ar.length, `ar name for ${code}`).toBeGreaterThan(0);
      expect(info.ar.trim().length, `ar name for ${code}`).toBeGreaterThan(0);
    }
  });

  test("spot-checked Arabic names match CLDR ground truth (RTL contract)", () => {
    expect(COUNTRIES.EG).toEqual({ en: "Egypt", ar: "مصر", flag: "🇪🇬" });
    expect(COUNTRIES.AE.ar).toBe("الإمارات العربية المتحدة");
    expect(COUNTRIES.SA.ar).toBe("المملكة العربية السعودية");
    expect(COUNTRIES.PS.ar).toBe("الأراضي الفلسطينية");
  });

  test("spot-checked English names match CLDR ground truth", () => {
    expect(COUNTRIES.US.en).toBe("United States");
    expect(COUNTRIES.PS.en).toBe("Palestinian Territories");
    expect(COUNTRIES.JP.en).toBe("Japan");
  });
});

// ===========================================================================
describe("tier 3 — deterministic shape fuzz", () => {
  test("every emitted code matches the anchored ^[A-Z]{2}$ shape", () => {
    for (const code of COUNTRY_CODES) {
      expect(ISO_ALPHA2_PATTERN.test(code), `code ${code}`).toBe(true);
    }
  });

  test("seeded fuzz sweep never throws and is reproducible", () => {
    const first = seededShapeSweepOutcomes(0x2f_6e_2b_1, 200);
    const second = seededShapeSweepOutcomes(0x2f_6e_2b_1, 200);
    expect(first).toHaveLength(200);
    expect(first).toEqual(second);
  });

  test("shape matcher accepts only exact two-uppercase-letter strings", () => {
    for (const value of ["", "A", "AB1", "AB ", " AB", "ab", "Ab", "ABC", "😀", "\t"]) {
      expect(ISO_ALPHA2_PATTERN.test(value), `value ${JSON.stringify(value)}`).toBe(false);
    }
  });
});

// ===========================================================================
describe("tier 4 — no injection or malformed content in emitted strings", () => {
  test("no markup, quote, or escape characters in any emitted string", () => {
    const offenders = EMITTED_STRINGS.filter(([, value]) => MARKUP_OR_ESCAPE_PATTERN.test(value));
    expect(offenders.map(([label]) => label)).toEqual([]);
  });

  test("no HTML-entity-shaped sequences in any emitted string (bare '&' allowed)", () => {
    const offenders = EMITTED_STRINGS.filter(([, value]) => HTML_ENTITY_PATTERN.test(value));
    expect(offenders.map(([label]) => label)).toEqual([]);
  });

  test("no control characters in any emitted string", () => {
    const offenders = EMITTED_STRINGS.filter(([, value]) => CONTROL_CHAR_PATTERN.test(value));
    expect(offenders.map(([label]) => label)).toEqual([]);
  });

  test("no bidi-override or zero-width injection marks in any emitted string", () => {
    const offenders = EMITTED_STRINGS.filter(([, value]) => BIDI_AND_ZERO_WIDTH_PATTERN.test(value));
    expect(offenders.map(([label]) => label)).toEqual([]);
  });
});
