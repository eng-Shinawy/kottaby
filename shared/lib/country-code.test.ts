/**
 * Country-code validation suite (`normalizeCountryCode`, `isValidCountryCode`,
 * `countryCodeSchema`, `countryCodeShapeSchema`, `COUNTRY_CODE_PATTERN`) — 4 tiers.
 *
 * WHAT THIS LOCKS
 *   1. BRANCH COMPLETENESS — every code path: normalization (trim + uppercase),
 *      the strict raw-value guard (member / valid-shape non-member / lowercase /
 *      empty / whitespace / non-string), and `safeParse` success + failure for
 *      BOTH schemas (full membership gate vs shape-only).
 *   2. BOUNDARY CONDITIONS — empty string, whitespace-only, single letter,
 *      three letters, legacy free text ("Egypt"), whitespace flavors that trim
 *      (space, tab, NBSP) vs hostile format characters that do not (ZWSP, RLM),
 *      RTL/Arabic text, and emoji input.
 *   3. DETERMINISTIC FUZZ — 200 seeded random strings through
 *      `Promise.allSettled` + `safeParse`: never throws, always reports a
 *      `{ success }` envelope, and results are byte-deterministic across runs.
 *   4. HOSTILE INPUT — prototype-pollution-shaped keys, SQL/LIKE wildcards,
 *      and huge strings: all rejected, all bounded (anchored `{2}` regex cannot
 *      backtrack), with a wall-clock guard against regex blowup.
 *   5. HOMOGLYPH HARDENING (D-IP-2) — non-ASCII seeds that uppercase-map
 *      onto ASCII member codes ("ſg" → "SG", "ﬁ" → "FI") are rejected on
 *      the RAW shape before canonicalization, while non-ASCII legacy display
 *      names keep resolving through the exact-match name index.
 *
 * Pure unit tier — NO server boot, NO network, NO DB. Runs via the mandated
 * runner: `bun run test/scripts/run-test.ts shared/lib/country-code.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import { COUNTRIES, COUNTRY_CODES, type CountryCode } from "@/shared/constants/countries";
import {
  COUNTRY_CODE_PATTERN,
  countryCodeSchema,
  countryCodeShapeSchema,
  countryDisplayLabel,
  countrySeedToCode,
  isValidCountryCode,
  normalizeCountryCode,
} from "@/shared/lib/country-code";

// ─── countryDisplayLabel — display grammar over the seed bridge ─────────────

describe("countryDisplayLabel — display grammar over the seed bridge", () => {
  test("canonical codes render the flag + locale dataset name", () => {
    for (const locale of ["en", "ar"] as const) {
      expect(countryDisplayLabel("EG", locale)).toBe(`${COUNTRIES.EG.flag} ${COUNTRIES.EG[locale]}`);
      expect(countryDisplayLabel("JO", locale)).toBe(`${COUNTRIES.JO.flag} ${COUNTRIES.JO[locale]}`);
    }
  });

  test("padded/lowercase code variants normalize before rendering", () => {
    expect(countryDisplayLabel(" eg ", "en")).toBe(`${COUNTRIES.EG.flag} ${COUNTRIES.EG.en}`);
    expect(countryDisplayLabel("jo", "ar")).toBe(`${COUNTRIES.JO.flag} ${COUNTRIES.JO.ar}`);
  });

  test("legacy display-text seeds resolve through the English-name index", () => {
    expect(countryDisplayLabel("Egypt", "en")).toBe(`${COUNTRIES.EG.flag} ${COUNTRIES.EG.en}`);
    expect(countryDisplayLabel("Egypt", "ar")).toBe(`${COUNTRIES.EG.flag} ${COUNTRIES.EG.ar}`);
    expect(countryDisplayLabel("egypt", "en")).toBe(`${COUNTRIES.EG.flag} ${COUNTRIES.EG.en}`);
  });

  test("unresolvable free text renders verbatim (fail-open display)", () => {
    expect(countryDisplayLabel("Cairo", "en")).toBe("Cairo");
    expect(countryDisplayLabel("مصر", "ar")).toBe("مصر"); // AR names are display vocabulary, never seeds
    expect(countryDisplayLabel("EGY", "en")).toBe("EGY");
  });

  test("every dataset entry renders in both locales from its own values", () => {
    for (const code of COUNTRY_CODES) {
      expect(countryDisplayLabel(code, "en")).toBe(`${COUNTRIES[code].flag} ${COUNTRIES[code].en}`);
      expect(countryDisplayLabel(code, "ar")).toBe(`${COUNTRIES[code].flag} ${COUNTRIES[code].ar}`);
    }
  });
});

// ─── Tier 1: branch completeness ─────────────────────────────────────────────

describe("normalizeCountryCode — Tier 1: branch completeness", () => {
  test("trims surrounding whitespace and uppercases", () => {
    expect(normalizeCountryCode(" eg ")).toBe("EG");
    expect(normalizeCountryCode("eg")).toBe("EG");
    expect(normalizeCountryCode("eG")).toBe("EG");
  });

  test("leaves an already-canonical code unchanged", () => {
    expect(normalizeCountryCode("EG")).toBe("EG");
  });

  test("trims every whitespace flavor the trim spec covers", () => {
    expect(normalizeCountryCode("\tEG\n")).toBe("EG");
    expect(normalizeCountryCode("\u00A0EG\u00A0")).toBe("EG"); // NBSP is Unicode whitespace
  });
});

describe("isValidCountryCode — Tier 1: branch completeness", () => {
  test("accepts dataset members", () => {
    expect(isValidCountryCode("EG")).toBe(true);
    expect(isValidCountryCode(COUNTRY_CODES[0])).toBe(true);
    expect(isValidCountryCode(COUNTRY_CODES[COUNTRY_CODES.length - 1])).toBe(true);
  });

  test("rejects valid-shape non-members (XX, AA, ZZ)", () => {
    expect(isValidCountryCode("XX")).toBe(false);
    expect(isValidCountryCode("AA")).toBe(false);
    expect(isValidCountryCode("ZZ")).toBe(false);
  });

  test("rejects lowercase and padded values — the guard is strict on the raw value", () => {
    // Normalization is the schema's job; accepting "eg" would make the
    // `value is CountryCode` narrowing unsound.
    expect(isValidCountryCode("eg")).toBe(false);
    expect(isValidCountryCode(" EG ")).toBe(false);
    expect(isValidCountryCode("Eg")).toBe(false);
  });

  test("rejects empty and whitespace-only strings", () => {
    expect(isValidCountryCode("")).toBe(false);
    expect(isValidCountryCode("   ")).toBe(false);
    expect(isValidCountryCode("\t\n")).toBe(false);
  });

  test("returns false for every non-string without throwing", () => {
    const nonStrings: unknown[] = [null, undefined, 42, NaN, true, {}, ["EG"], Symbol("EG"), 42n];
    for (const value of nonStrings) {
      expect(isValidCountryCode(value)).toBe(false);
    }
  });

  test("narrows an unknown value to CountryCode (compile-time proof)", () => {
    const value: unknown = COUNTRY_CODES[0];
    if (!isValidCountryCode(value)) {
      throw new Error("dataset member must pass the guard");
    }
    const code: CountryCode = value; // type error here would mean a broken guard
    expect(code).toBe(COUNTRY_CODES[0]);
  });
});

describe("COUNTRY_CODE_PATTERN — Tier 1: branch completeness", () => {
  test("matches exactly two uppercase letters, nothing else", () => {
    expect(COUNTRY_CODE_PATTERN.test("EG")).toBe(true);
    expect(COUNTRY_CODE_PATTERN.test("eg")).toBe(false);
    expect(COUNTRY_CODE_PATTERN.test("E1")).toBe(false);
    expect(COUNTRY_CODE_PATTERN.test("EGY")).toBe(false);
    expect(COUNTRY_CODE_PATTERN.test("E")).toBe(false);
    expect(COUNTRY_CODE_PATTERN.test(" EG ")).toBe(false);
  });

  test("is stateless across repeated tests (no sticky lastIndex)", () => {
    expect(COUNTRY_CODE_PATTERN.test("EG")).toBe(true);
    expect(COUNTRY_CODE_PATTERN.test("EG")).toBe(true);
    expect(COUNTRY_CODE_PATTERN.lastIndex).toBe(0);
  });
});

describe("countryCodeSchema — Tier 1: safeParse success + failure", () => {
  test("normalizes first, then requires membership", () => {
    for (const raw of ["EG", " eg ", "eg", "\tEg\n"]) {
      const result = countryCodeSchema.safeParse(raw);
      expect(result.success).toBe(true);
      if (result.success) {
        const code: CountryCode = result.data; // schema output must be CountryCode
        expect(code).toBe("EG");
      }
    }
  });

  test("rejects non-members, legacy text, and malformed shapes", () => {
    for (const raw of ["XX", "AA", "ZZ", "EGYPT", "Egypt", "EGY", "E", "E1", ""]) {
      const result = countryCodeSchema.safeParse(raw);
      expect(result.success).toBe(false);
    }
  });

  test("rejects non-strings with a failure envelope, never a throw", () => {
    for (const raw of [null, undefined, 42, true, {}, ["EG"]]) {
      const result = countryCodeSchema.safeParse(raw);
      expect(result.success).toBe(false);
    }
  });
});

describe("countryCodeShapeSchema — Tier 1: safeParse success + failure", () => {
  test("accepts any-case two-letter shapes without dataset membership", () => {
    for (const raw of ["EG", "eg", "Eg", "eG", "XX"]) {
      const result = countryCodeShapeSchema.safeParse(raw);
      expect(result.success).toBe(true); // XX is shape-legal — membership is not checked
      if (result.success) {
        expect(result.data).toBe(raw); // shape-only: value is passed through untouched
      }
    }
  });

  test("rejects anything that is not exactly two letters", () => {
    for (const raw of ["", "E", "EGY", "EGYPT", " EG ", "EG ", "E1", "E G", null, undefined, 42]) {
      expect(countryCodeShapeSchema.safeParse(raw).success).toBe(false);
    }
  });
});

// ─── Tier 2: boundary conditions ─────────────────────────────────────────────

describe("countryCodeSchema — Tier 2: boundary conditions", () => {
  test("empty, whitespace-only, one letter, three letters, legacy free text", () => {
    expect(countryCodeSchema.safeParse("").success).toBe(false);
    expect(countryCodeSchema.safeParse("   ").success).toBe(false);
    expect(countryCodeSchema.safeParse("E").success).toBe(false);
    expect(countryCodeSchema.safeParse("EGY").success).toBe(false);
    expect(countryCodeSchema.safeParse("Egypt").success).toBe(false);
  });

  test("lowercase and padded members normalize into the dataset", () => {
    expect(countryCodeSchema.safeParse("eg")).toEqual({ success: true, data: "EG" });
    expect(countryCodeSchema.safeParse(" EG ")).toEqual({ success: true, data: "EG" });
  });

  test("NBSP padding trims away; zero-width and RTL marks do not (fail closed)", () => {
    expect(countryCodeSchema.safeParse("\u00A0eg\u00A0")).toEqual({ success: true, data: "EG" });
    expect(countryCodeSchema.safeParse("\u200BEG").success).toBe(false); // ZWSP: not whitespace
    expect(countryCodeSchema.safeParse("\u200FEG").success).toBe(false); // RLM: not whitespace
  });

  test("RTL text and emoji are rejected, not mangled", () => {
    expect(countryCodeSchema.safeParse("مصر").success).toBe(false);
    expect(countryCodeSchema.safeParse("🇪🇬").success).toBe(false);
    expect(countryCodeSchema.safeParse("😀").success).toBe(false);
    expect(countryCodeSchema.safeParse("☁").success).toBe(false); // 3-byte UTF-8 emoji
    expect(isValidCountryCode("مصر")).toBe(false);
    expect(isValidCountryCode("🇪🇬")).toBe(false);
    expect(countryCodeShapeSchema.safeParse("مصر").success).toBe(false);
  });
});

// ─── Tier 3: deterministic fuzz ──────────────────────────────────────────────

/** Seeded LCG (Numerical Recipes constants) — reproducible fixture stream. */
function createSeededFuzz(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

describe("countryCodeSchema — Tier 3: deterministic fuzz", () => {
  const ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 _%\\-ع😀";

  function buildFuzzCorpus(size: number): string[] {
    const random = createSeededFuzz(0x230);
    const corpus: string[] = [];
    for (let i = 0; i < size; i++) {
      const length = Math.floor(random() * 9); // 0–8 chars
      let value = "";
      for (let j = 0; j < length; j++) {
        value += ALPHABET[Math.floor(random() * ALPHABET.length)];
      }
      corpus.push(value);
    }
    return corpus;
  }

  test("200 concurrent safeParses never throw and always report { success }", async () => {
    const corpus = buildFuzzCorpus(200);
    const settled = await Promise.allSettled(corpus.map(async value => countryCodeSchema.safeParse(value)));

    expect(settled).toHaveLength(corpus.length);
    for (const outcome of settled) {
      expect(outcome.status).toBe("fulfilled");
      if (outcome.status === "fulfilled") {
        expect(typeof outcome.value.success).toBe("boolean");
      }
    }
  });

  test("fuzz results are deterministic across repeated runs", () => {
    const corpus = buildFuzzCorpus(200);
    const first = corpus.map(value => {
      const result = countryCodeSchema.safeParse(value);
      return result.success ? result.data : null;
    });
    const second = corpus.map(value => {
      const result = countryCodeSchema.safeParse(value);
      return result.success ? result.data : null;
    });
    expect(second).toEqual(first);

    const guardFirst = corpus.map(value => isValidCountryCode(value));
    const guardSecond = corpus.map(value => isValidCountryCode(value));
    expect(guardSecond).toEqual(guardFirst);
    for (const flag of guardFirst) {
      expect(typeof flag).toBe("boolean");
    }
  });
});

// ─── Tier 4: hostile input ───────────────────────────────────────────────────

describe("country-code module — Tier 4: hostile input", () => {
  test("prototype-pollution-shaped keys are never members and poison nothing", () => {
    for (const hostile of ["__proto__", "constructor", "prototype"]) {
      expect(isValidCountryCode(hostile)).toBe(false);
      expect(countryCodeSchema.safeParse(hostile).success).toBe(false);
      expect(countryCodeShapeSchema.safeParse(hostile).success).toBe(false);
    }
    // Module state is untouched: membership still behaves after the probes.
    expect(isValidCountryCode("EG")).toBe(true);
    expect(isValidCountryCode("XX")).toBe(false);
  });

  test("SQL/LIKE wildcards and injection payloads are rejected", () => {
    const payloads = ["%", "_", "\\", "%EG", "EG%", "E_", "%_%", "'; DROP TABLE users; --"];
    for (const payload of payloads) {
      expect(isValidCountryCode(payload)).toBe(false);
      expect(countryCodeSchema.safeParse(payload).success).toBe(false);
      expect(countryCodeShapeSchema.safeParse(payload).success).toBe(false);
    }
  });

  test("huge strings are rejected with bounded work (no regex blowup)", () => {
    const hugeGarbage = "E".repeat(10_000);
    const hugeMixed = "EG".repeat(5_000);
    const hugePadded = `EG${" ".repeat(10_000)}`;

    expect(countryCodeSchema.safeParse(hugeGarbage).success).toBe(false);
    expect(countryCodeSchema.safeParse(hugeMixed).success).toBe(false);
    expect(isValidCountryCode(hugeGarbage)).toBe(false);
    // Surrounding whitespace is trimmed at any size; the member itself survives.
    expect(countryCodeSchema.safeParse(hugePadded)).toEqual({ success: true, data: "EG" });

    const startedAt = performance.now();
    for (let i = 0; i < 200; i++) {
      countryCodeSchema.safeParse(hugeMixed);
      countryCodeShapeSchema.safeParse(hugeMixed);
    }
    expect(performance.now() - startedAt).toBeLessThan(2_000);
  });
});

// ─── D-IP-2: homoglyph hardening (raw ASCII gate before canonicalization) ────

describe("homoglyph hardening — non-ASCII uppercase mappings are rejected on the raw shape", () => {
  // Each entry uppercases (through normalizeCountryCode) onto an ASCII letter
  // run; without the raw gate several of these canonicalize onto DATASET
  // MEMBERS — the exact hole D-IP-2 closed.
  const HOMOGLYPH_SEEDS: ReadonlyArray<readonly [seed: string, uppercaseTarget: string]> = [
    ["ſg", "SG"], // U+017F LATIN SMALL LETTER LONG S → S (SG is a member!)
    ["ſG", "SG"],
    ["ıq", "IQ"], // U+0131 DOTLESS I → I (IQ is a member!)
    ["ﬁ", "FI"], // U+FB01 ligature — ONE char uppercases to two letters (member!)
    ["ﬅ", "ST"], // U+FB05 st ligature (member!)
    ["ﬀ", "FF"], // U+FB00 ff ligature — target is not a member but must still fail on the raw shape
  ];

  test("the uppercase mappings the guard defends against really exist", () => {
    // Proves the rejection below is the raw gate firing — not a coincidence
    // of enum membership: without the guard these normalized onto codes.
    for (const [seed, target] of HOMOGLYPH_SEEDS) {
      expect(normalizeCountryCode(seed)).toBe(target);
    }
  });

  test("countryCodeSchema rejects every homoglyph seed", () => {
    for (const [seed] of HOMOGLYPH_SEEDS) {
      expect(countryCodeSchema.safeParse(seed).success).toBe(false);
    }
  });

  test("countrySeedToCode fails closed on homoglyph seeds (was: resolved onto members)", () => {
    for (const [seed, target] of HOMOGLYPH_SEEDS) {
      expect(countrySeedToCode(seed)).toBe("");
      expect(countrySeedToCode(seed)).not.toBe(target);
    }
  });

  test("countryDisplayLabel renders homoglyph junk verbatim instead of a canonical identity", () => {
    expect(countryDisplayLabel("ſg", "en")).toBe("ſg");
    expect(countryDisplayLabel("ﬁ", "ar")).toBe("ﬁ");
  });

  test("non-ASCII legacy display names still resolve through the exact-match name index", () => {
    // The raw gate covers the CODE arm only — the name arm never case-maps,
    // so the dataset's non-ASCII names must keep resolving (the round-trip
    // contract shared links depend on).
    expect(countrySeedToCode(COUNTRIES.CW.en)).toBe("CW"); // Curaçao
    expect(countrySeedToCode(COUNTRIES.TR.en)).toBe("TR"); // Türkiye
    expect(countrySeedToCode(COUNTRIES.AX.en)).toBe("AX"); // Åland Islands
    expect(countrySeedToCode(COUNTRIES.CI.en)).toBe("CI"); // Côte d’Ivoire
    expect(countryDisplayLabel(COUNTRIES.CW.en, "en")).toBe(`${COUNTRIES.CW.flag} ${COUNTRIES.CW.en}`);
  });

  test("zero-width and RTL marks stay fail-closed on every surface (regression pin)", () => {
    // ZWSP/RLM are neither ASCII letters nor trim-removable, so they fail the
    // raw gate AND (as before) the membership check.
    expect(countrySeedToCode("E\u200BG")).toBe("");
    expect(countryCodeSchema.safeParse("E\u200BG").success).toBe(false);
    expect(countryCodeSchema.safeParse("\u200FEG").success).toBe(false);
    expect(countryDisplayLabel("E\u200BG", "en")).toBe("E\u200BG");
  });

  test("legitimate ASCII normalization is untouched by the raw gate", () => {
    expect(countryCodeSchema.safeParse(" eg ")).toEqual({ success: true, data: "EG" });
    expect(countryCodeSchema.safeParse("\u00A0eg\u00A0")).toEqual({ success: true, data: "EG" });
    expect(countrySeedToCode(" eg ")).toBe("EG");
    expect(countrySeedToCode("Egypt")).toBe("EG");
  });
});

// ─── countrySeedToCode: URL-seed resolution (directory filter bridge) ────────

describe("countrySeedToCode — URL-seed resolution", () => {
  test("empty and whitespace-only seeds resolve to the no-filter default", () => {
    expect(countrySeedToCode("")).toBe("");
    expect(countrySeedToCode("   ")).toBe("");
    expect(countrySeedToCode("\t\n")).toBe("");
  });

  test("canonical and padded/lowercase codes resolve through normalization", () => {
    expect(countrySeedToCode("EG")).toBe("EG");
    expect(countrySeedToCode(" eg ")).toBe("EG");
    expect(countrySeedToCode("eg")).toBe("EG");
  });

  test("legacy display-text seeds resolve through the English-name index", () => {
    // Historical /users links carry the stored display string, not a code.
    expect(countrySeedToCode("Egypt")).toBe("EG");
    expect(countrySeedToCode("egypt")).toBe("EG");
    expect(countrySeedToCode("EGYPT")).toBe("EG");
    expect(countrySeedToCode(" United States ")).toBe("US");
  });

  test("unresolvable seeds fail closed to the no-filter default", () => {
    expect(countrySeedToCode("EGY")).toBe("");
    expect(countrySeedToCode("XX")).toBe("");
    expect(countrySeedToCode("%")).toBe("");
    expect(countrySeedToCode("'; DROP TABLE users; --")).toBe("");
    // Localized names are display vocabulary, not seed vocabulary: only the
    // canonical code and the English display text have ever been persisted.
    expect(countrySeedToCode("مصر")).toBe("");
  });

  test("every dataset entry round-trips: code and English name both resolve", () => {
    for (const code of COUNTRY_CODES) {
      expect(countrySeedToCode(code)).toBe(code);
      expect(countrySeedToCode(COUNTRIES[code].en)).toBe(code);
    }
  });
});
