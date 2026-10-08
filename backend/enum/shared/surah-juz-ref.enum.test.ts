/**
 * SurahJuzRef + isSurahJuzRef 4-Tier Test Suite + pgEnum mirror parity.
 * Pure unit tier — NO DB connection. The parity describe imports the pgEnum
 * definition only (no DB client, no connection); every guard test is pure.
 * Parity: pins the TS mirror byte-identical to the `surah_juz_ref`
 *   pgEnum registry entry: same 144 members, same order.
 * Tier 1: 100% branch/statement coverage of the guard over ALL shipped members.
 * Tier 2: Boundary cases — case mismatch, whitespace, empty, primitive types.
 * Tier 3: Chaos/fuzz — random strings, 10k payloads, unicode/RTL, wildcards.
 * Tier 4: Security — coercion overrides, prototype attacks; reject, never throw.
 */
import { describe, expect, test } from "bun:test";
import { surahJuzRef } from "@/backend/db/schema/enums";
import { isSurahJuzRef, SurahJuzRef } from "@/backend/enum/shared/surah-juz-ref.enum";

/** Canonical surah values — mushaf order #1..#114, the hardcoded parity ground truth. */
const CANONICAL_SURAH_VALUES = [
  "surah_al_fatihah",
  "surah_al_baqarah",
  "surah_aal_imran",
  "surah_an_nisa",
  "surah_al_maidah",
  "surah_al_anam",
  "surah_al_araf",
  "surah_al_anfal",
  "surah_at_tawbah",
  "surah_yunus",
  "surah_hud",
  "surah_yusuf",
  "surah_ar_rad",
  "surah_ibrahim",
  "surah_al_hijr",
  "surah_an_nahl",
  "surah_al_isra",
  "surah_al_kahf",
  "surah_maryam",
  "surah_ta_ha",
  "surah_al_anbiya",
  "surah_al_hajj",
  "surah_al_muminun",
  "surah_an_nur",
  "surah_al_furqan",
  "surah_ash_shuara",
  "surah_an_naml",
  "surah_al_qasas",
  "surah_al_ankabut",
  "surah_ar_rum",
  "surah_luqman",
  "surah_as_sajdah",
  "surah_al_ahzab",
  "surah_saba",
  "surah_fatir",
  "surah_ya_sin",
  "surah_as_saffat",
  "surah_sad",
  "surah_az_zumar",
  "surah_ghafir",
  "surah_fussilat",
  "surah_ash_shura",
  "surah_az_zukhruf",
  "surah_ad_dukhan",
  "surah_al_jathiyah",
  "surah_al_ahqaf",
  "surah_muhammad",
  "surah_al_fath",
  "surah_al_hujurat",
  "surah_qaf",
  "surah_ad_dhariyat",
  "surah_at_tur",
  "surah_an_najm",
  "surah_al_qamar",
  "surah_ar_rahman",
  "surah_al_waqiah",
  "surah_al_hadid",
  "surah_al_mujadilah",
  "surah_al_hashr",
  "surah_al_mumtahanah",
  "surah_as_saff",
  "surah_al_jumuah",
  "surah_al_munafiqun",
  "surah_at_taghabun",
  "surah_at_talaq",
  "surah_at_tahrim",
  "surah_al_mulk",
  "surah_al_qalam",
  "surah_al_haqqah",
  "surah_al_maarij",
  "surah_nuh",
  "surah_al_jinn",
  "surah_al_muzzammil",
  "surah_al_muddaththir",
  "surah_al_qiyamah",
  "surah_al_insan",
  "surah_al_mursalat",
  "surah_an_naba",
  "surah_an_naziat",
  "surah_abasa",
  "surah_at_takwir",
  "surah_al_infitar",
  "surah_al_mutaffifin",
  "surah_al_inshiqaq",
  "surah_al_buruj",
  "surah_at_tariq",
  "surah_al_ala",
  "surah_al_ghashiyah",
  "surah_al_fajr",
  "surah_al_balad",
  "surah_ash_shams",
  "surah_al_layl",
  "surah_ad_duha",
  "surah_ash_sharh",
  "surah_at_tin",
  "surah_al_alaq",
  "surah_al_qadr",
  "surah_al_bayyinah",
  "surah_az_zalzalah",
  "surah_al_adiyat",
  "surah_al_qariah",
  "surah_at_takathur",
  "surah_al_asr",
  "surah_al_humazah",
  "surah_al_fil",
  "surah_quraysh",
  "surah_al_maun",
  "surah_al_kawthar",
  "surah_al_kafirun",
  "surah_an_nasr",
  "surah_al_masad",
  "surah_al_ikhlas",
  "surah_al_falaq",
  "surah_an_nas",
] as const;

/** Canonical juz values — juz_1..juz_30. */
const CANONICAL_JUZ_VALUES: string[] = Array.from({ length: 30 }, (_, i) => `juz_${i + 1}`);

/** Full canonical vocabulary — 144 members (114 surahs then 30 juz), order-sensitive. */
const CANONICAL_VALUES: string[] = [...CANONICAL_SURAH_VALUES, ...CANONICAL_JUZ_VALUES];

/** Deterministic LCG-backed fuzz generator (same output on every run). */
function fuzzStrings(count: number): string[] {
  let seed = 8675309;
  const next = (): number => {
    seed = (seed * 1103515245 + 12345) % 2147483647;
    return seed;
  };
  const alphabet = "xyzXYZ019!@#$%^&*()[]{}<>~`|;:,./? ";
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const len = 1 + (next() % 24);
    let candidate = "";
    for (let j = 0; j < len; j++) {
      candidate += alphabet[next() % alphabet.length];
    }
    out.push(candidate);
  }
  return out;
}

/** Module-scope fixture used by the security tier (a function masquerading as a member value). */
function memberReturningFunction(): string {
  return SurahJuzRef.Juz1;
}

describe("surah_juz_ref pgEnum ↔ SurahJuzRef mirror parity", () => {
  test("pgEnum enumValues is exactly the 144 canonical values, in order", () => {
    expect([...surahJuzRef.enumValues].join("|")).toBe(CANONICAL_VALUES.join("|"));
  });

  test("TS mirror Object.values is exactly the 144 canonical values, in order", () => {
    expect(Object.values(SurahJuzRef).join("|")).toBe(CANONICAL_VALUES.join("|"));
  });

  test("pgEnum and TS mirror are byte-identical (144 members each, order-sensitive)", () => {
    expect(surahJuzRef.enumValues).toHaveLength(144);
    expect(Object.values(SurahJuzRef)).toHaveLength(144);
    expect([...surahJuzRef.enumValues].join("|")).toBe(Object.values(SurahJuzRef).join("|"));
    expect([...surahJuzRef.enumValues]).toEqual(Object.values(SurahJuzRef));
  });
});

describe("isSurahJuzRef", () => {
  // ---- Tier 1: Branch/Statement Coverage ----
  describe("Tier 1 — branch coverage", () => {
    test("shipped member set is frozen at 144 (114 surah refs + 30 juz) in declaration order", () => {
      const members: string[] = Object.values(SurahJuzRef);
      expect(members).toHaveLength(144);
      expect(members.slice(0, 114).join("|")).toBe(CANONICAL_SURAH_VALUES.join("|"));
      expect(members.slice(114)).toEqual(CANONICAL_JUZ_VALUES);
    });

    test("EVERY shipped enum member passes the guard (true branch, all 144)", () => {
      for (const member of Object.values(SurahJuzRef)) {
        expect(isSurahJuzRef(member)).toBe(true);
      }
    });

    test("post-expansion member surah_al_furqan (#25) passes the guard (fixture audit)", () => {
      expect(isSurahJuzRef("surah_al_furqan")).toBe(true);
      expect(isSurahJuzRef(SurahJuzRef.SurahAlFurqan)).toBe(true);
    });

    test("string that is not a member fails the membership check (false branch)", () => {
      expect(isSurahJuzRef("juz_31")).toBe(false);
      expect(isSurahJuzRef("juz_0")).toBe(false);
      expect(isSurahJuzRef("page_1")).toBe(false);
      // surah_an_nuh is NOT a member: surah 71 ships as `surah_nuh` (canonical
      // naming), so the definite-article near-miss stays a hostile probe.
      expect(isSurahJuzRef("surah_an_nuh")).toBe(false);
    });

    test("non-string input short-circuits on the typeof check (left-false branch)", () => {
      expect(isSurahJuzRef(undefined)).toBe(false);
      expect(isSurahJuzRef(1)).toBe(false);
    });

    test("true result narrows unknown to SurahJuzRef", () => {
      const value: unknown = "juz_30";
      if (!isSurahJuzRef(value)) {
        expect.unreachable("guard should accept the exact member string");
      }
      expect(value).toBe(SurahJuzRef.Juz30);
    });
  });

  // ---- Tier 2: Boundary & Edge Cases ----
  describe("Tier 2 — boundary cases", () => {
    test("case mismatches are rejected", () => {
      expect(isSurahJuzRef("Juz_1")).toBe(false);
      expect(isSurahJuzRef("JUZ_1")).toBe(false);
      expect(isSurahJuzRef("Surah_Al_Fatihah")).toBe(false);
      expect(isSurahJuzRef("SURAH_AL_FATIHAH")).toBe(false);
      expect(isSurahJuzRef("juz_1 ")).toBe(false);
    });

    test("whitespace boundaries are rejected (trailing, leading, tab/newline)", () => {
      expect(isSurahJuzRef("juz_1 ")).toBe(false);
      expect(isSurahJuzRef(" juz_1")).toBe(false);
      expect(isSurahJuzRef("\tjuz_1")).toBe(false);
      expect(isSurahJuzRef("juz_1\n")).toBe(false);
      expect(isSurahJuzRef(" juz_1 ")).toBe(false);
    });

    test("empty string is rejected", () => {
      expect(isSurahJuzRef("")).toBe(false);
    });

    test("numeric-adjacent near-misses are rejected", () => {
      expect(isSurahJuzRef("juz_0")).toBe(false);
      expect(isSurahJuzRef("juz_00")).toBe(false);
      expect(isSurahJuzRef("juz_1.0")).toBe(false);
      expect(isSurahJuzRef("juz_+1")).toBe(false);
      expect(isSurahJuzRef("juz_30 ")).toBe(false);
      expect(isSurahJuzRef("juz_130")).toBe(false);
    });

    test("primitive non-strings are rejected", () => {
      expect(isSurahJuzRef(0)).toBe(false);
      expect(isSurahJuzRef(1)).toBe(false);
      expect(isSurahJuzRef(30)).toBe(false);
      expect(isSurahJuzRef(Number.NaN)).toBe(false);
      expect(isSurahJuzRef(true)).toBe(false);
      expect(isSurahJuzRef(false)).toBe(false);
      expect(isSurahJuzRef(undefined)).toBe(false);
      expect(isSurahJuzRef(null)).toBe(false);
    });
  });

  // ---- Tier 3: Chaos/Fuzz ----
  describe("Tier 3 — chaos & fuzz", () => {
    test("random non-member strings are ALL rejected without throwing", () => {
      for (const candidate of fuzzStrings(200)) {
        expect(isSurahJuzRef(candidate)).toBe(false);
      }
    });

    test("long strings (10k chars) are rejected", () => {
      expect(isSurahJuzRef("x".repeat(10000))).toBe(false);
      expect(isSurahJuzRef(`${SurahJuzRef.Juz1}${"@".repeat(9995)}`)).toBe(false);
      expect(isSurahJuzRef(`${"@".repeat(9995)}${SurahJuzRef.Juz30}`)).toBe(false);
    });

    test("unicode / Arabic / RTL strings are rejected", () => {
      const unicodeInputs = [
        "الجزء الأول",
        "سورة الفاتحة",
        "جزء",
        "\u200Fjuz_1",
        "juz_1\u200F",
        "\u05D0\u05D1\u05D2",
        "juz\u0661_1",
        "✅",
        "🄹🅄🅉_1",
        "juz\u0300_1",
      ];
      for (const input of unicodeInputs) {
        expect(isSurahJuzRef(input)).toBe(false);
      }
    });

    test("strings containing LIKE wildcards, underscores, backslashes and quotes are rejected", () => {
      const hostileInputs = [
        "%",
        "_",
        "\\",
        "'",
        "%\"%'\\_",
        "%juz_1",
        "juz%_1",
        "_juz_1",
        "juz_1_",
        "juz__1",
        "j'_uz_1",
        "\\njuz_1",
        "'; DROP TABLE home_work; --",
        '"juz_1"',
      ];
      for (const input of hostileInputs) {
        expect(isSurahJuzRef(input)).toBe(false);
      }
    });

    test("control characters embedded in member-like strings are rejected", () => {
      expect(isSurahJuzRef("juz\x00_1")).toBe(false);
      expect(isSurahJuzRef("juz_1\r")).toBe(false);
      expect(isSurahJuzRef("\ufeffjuz_1")).toBe(false);
    });
  });

  // ---- Tier 4: Security & Abuse ----
  describe("Tier 4 — security & abuse", () => {
    test("object with toString override returning a member is rejected WITHOUT throwing", () => {
      const malicious: unknown = { toString: () => SurahJuzRef.Juz1 };
      expect(() => isSurahJuzRef(malicious)).not.toThrow();
      expect(isSurahJuzRef(malicious)).toBe(false);
    });

    test("object with throwing toString/valueOf never triggers coercion", () => {
      const explosive: unknown = {
        toString: () => {
          throw new Error("toString should never be called by the guard");
        },
        valueOf: () => {
          throw new Error("valueOf should never be called by the guard");
        },
      };
      expect(() => isSurahJuzRef(explosive)).not.toThrow();
      expect(isSurahJuzRef(explosive)).toBe(false);
    });

    test("Object.create(null) input is rejected WITHOUT throwing", () => {
      const nullProto: unknown = Object.create(null);
      expect(() => isSurahJuzRef(nullProto)).not.toThrow();
      expect(isSurahJuzRef(nullProto)).toBe(false);

      const forgedNullProto: unknown = Object.assign(Object.create(null), { 0: "juz_1", length: 5 });
      expect(() => isSurahJuzRef(forgedNullProto)).not.toThrow();
      expect(isSurahJuzRef(forgedNullProto)).toBe(false);
    });

    test("crafted __proto__-bearing payload is rejected WITHOUT throwing", () => {
      // JSON-string-shaped attacker payload — "__proto__" lands as an own enumerable key.
      const protoPayload: Record<string, unknown> = { ["__proto__"]: { isAdmin: true }, value: "juz_1" };
      expect(() => isSurahJuzRef(protoPayload)).not.toThrow();
      expect(isSurahJuzRef(protoPayload)).toBe(false);
      expect(Object.keys(protoPayload)).toContain("__proto__");
    });

    test("Symbol masquerading as a member name is rejected WITHOUT throwing", () => {
      const symbolInput = Symbol.for("juz_1");
      expect(() => isSurahJuzRef(symbolInput)).not.toThrow();
      expect(isSurahJuzRef(symbolInput)).toBe(false);
    });

    test("arrays and functions are rejected WITHOUT throwing", () => {
      const arrayInput: unknown = [SurahJuzRef.Juz1];
      const fnInput: unknown = memberReturningFunction;
      expect(() => isSurahJuzRef(arrayInput)).not.toThrow();
      expect(isSurahJuzRef(arrayInput)).toBe(false);
      expect(() => isSurahJuzRef(fnInput)).not.toThrow();
      expect(isSurahJuzRef(fnInput)).toBe(false);
    });
  });
});
