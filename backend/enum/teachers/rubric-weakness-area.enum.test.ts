/**
 * RubricWeaknessArea + isRubricWeaknessArea 4-Tier Test Suite.
 * Pure unit tier — NO DB connection; the pgEnum import is static metadata
 * only (Drizzle's enum registry carries no side effects).
 * Tier 1: 100% branch/statement coverage of the guard + value-for-value
 *         parity with the `rubric_weakness_area` pgEnum.
 * Tier 2: Boundary cases — case mismatch, whitespace, empty, primitive types.
 * Tier 3: Chaos/fuzz — random strings, 10k payloads, unicode/RTL, wildcards.
 * Tier 4: Security — coercion overrides, prototype attacks; reject, never throw.
 */
import { describe, expect, test } from "bun:test";
import { rubricWeaknessArea } from "@/backend/db/schema/enums";
import { isRubricWeaknessArea, RubricWeaknessArea } from "@/backend/enum/teachers/rubric-weakness-area.enum";

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

/** Module-scope fixture used by the security tier (a function masquerading as a weakness value). */
function memberReturningFunction(): string {
  return RubricWeaknessArea.Tajweed;
}

describe("isRubricWeaknessArea", () => {
  // ---- Tier 1: Branch/Statement Coverage ----
  describe("Tier 1 — branch coverage", () => {
    test("TS enum mirrors the rubric_weakness_area pgEnum value-for-value", () => {
      expect(rubricWeaknessArea.enumValues.join("|")).toBe("tajweed|hifz");
      expect((Object.values(RubricWeaknessArea) as string[]).join("|")).toBe("tajweed|hifz");
      expect([...rubricWeaknessArea.enumValues]).toStrictEqual(Object.values(RubricWeaknessArea));
    });

    test("every enum member passes the guard (true branch)", () => {
      expect(isRubricWeaknessArea(RubricWeaknessArea.Tajweed)).toBe(true);
      expect(isRubricWeaknessArea(RubricWeaknessArea.Hifz)).toBe(true);
    });

    test("string that is not a member fails the membership check (false branch)", () => {
      expect(isRubricWeaknessArea("makharij")).toBe(false);
      expect(isRubricWeaknessArea("qiraah")).toBe(false);
    });

    test("non-string input short-circuits on the typeof check (left-false branch)", () => {
      expect(isRubricWeaknessArea(undefined)).toBe(false);
      expect(isRubricWeaknessArea(0)).toBe(false);
    });

    test("true result narrows unknown to RubricWeaknessArea", () => {
      const value: unknown = "hifz";
      if (!isRubricWeaknessArea(value)) {
        expect.unreachable("guard should accept the exact member string");
      }
      expect(value).toBe(RubricWeaknessArea.Hifz);
    });
  });

  // ---- Tier 2: Boundary & Edge Cases ----
  describe("Tier 2 — boundary cases", () => {
    test("case mismatches are rejected", () => {
      expect(isRubricWeaknessArea("Tajweed")).toBe(false);
      expect(isRubricWeaknessArea("TAJWEED")).toBe(false);
      expect(isRubricWeaknessArea("Hifz")).toBe(false);
      expect(isRubricWeaknessArea("HIFZ")).toBe(false);
      expect(isRubricWeaknessArea("tAjWeEd")).toBe(false);
    });

    test('whitespace boundaries are rejected ("tajweed ", " hifz", tab/newline)', () => {
      expect(isRubricWeaknessArea("tajweed ")).toBe(false);
      expect(isRubricWeaknessArea(" hifz")).toBe(false);
      expect(isRubricWeaknessArea("\ttajweed")).toBe(false);
      expect(isRubricWeaknessArea("hifz\n")).toBe(false);
      expect(isRubricWeaknessArea(" hifz ")).toBe(false);
    });

    test("empty string is rejected", () => {
      expect(isRubricWeaknessArea("")).toBe(false);
    });

    test("near-miss spellings are rejected", () => {
      expect(isRubricWeaknessArea("tajweeed")).toBe(false);
      expect(isRubricWeaknessArea("tajwee")).toBe(false);
      expect(isRubricWeaknessArea("hiffz")).toBe(false);
      expect(isRubricWeaknessArea("hi f z")).toBe(false);
    });

    test("session-intent and other domain vocabularies are not weakness values", () => {
      expect(isRubricWeaknessArea("evaluation")).toBe(false);
      expect(isRubricWeaknessArea("student_session")).toBe(false);
      expect(isRubricWeaknessArea("teacher_evaluation")).toBe(false);
    });

    test("primitive non-strings are rejected", () => {
      expect(isRubricWeaknessArea(0)).toBe(false);
      expect(isRubricWeaknessArea(80)).toBe(false);
      expect(isRubricWeaknessArea(Number.NaN)).toBe(false);
      expect(isRubricWeaknessArea(true)).toBe(false);
      expect(isRubricWeaknessArea(undefined)).toBe(false);
      expect(isRubricWeaknessArea(null)).toBe(false);
    });
  });

  // ---- Tier 3: Chaos/Fuzz ----
  describe("Tier 3 — chaos & fuzz", () => {
    test("random non-member strings are ALL rejected without throwing", () => {
      for (const candidate of fuzzStrings(200)) {
        expect(isRubricWeaknessArea(candidate)).toBe(false);
      }
    });

    test("long strings (10k chars) are rejected", () => {
      expect(isRubricWeaknessArea("x".repeat(10000))).toBe(false);
      expect(isRubricWeaknessArea(`${RubricWeaknessArea.Tajweed}${"@".repeat(9992)}`)).toBe(false);
      expect(isRubricWeaknessArea(`${"@".repeat(9996)}${RubricWeaknessArea.Hifz}`)).toBe(false);
    });

    test("unicode / Arabic / RTL strings are rejected", () => {
      const unicodeInputs = [
        "القرآن",
        "التجويد",
        "الحفظ",
        "\u200Ftajweed",
        "hifz\u200F",
        "\u05D0\u05D1\u05D2",
        "hif\u0645z",
        "✅",
        "🅃🄰🄹",
        "taju0303weed",
      ];
      for (const input of unicodeInputs) {
        expect(isRubricWeaknessArea(input)).toBe(false);
      }
    });

    test("strings containing LIKE wildcards, underscores, backslashes and quotes are rejected", () => {
      const hostileInputs = [
        "%",
        "_",
        "\\",
        "'",
        "%\"%'\\_",
        "%tajweed",
        "taj%weed",
        "_hifz",
        "hifz_",
        "tajweed_",
        "h'_ifz",
        "\\ntajweed",
        "'; DROP TABLE evaluations; --",
        '"hifz"',
      ];
      for (const input of hostileInputs) {
        expect(isRubricWeaknessArea(input)).toBe(false);
      }
    });

    test("control characters embedded in member-like strings are rejected", () => {
      expect(isRubricWeaknessArea("taj\x00weed")).toBe(false);
      expect(isRubricWeaknessArea("hifz\r")).toBe(false);
      expect(isRubricWeaknessArea("\ufeffhifz")).toBe(false);
    });
  });

  // ---- Tier 4: Security & Abuse ----
  describe("Tier 4 — security & abuse", () => {
    test("object with toString override returning a member is rejected WITHOUT throwing", () => {
      const malicious: unknown = { toString: () => RubricWeaknessArea.Tajweed };
      expect(() => isRubricWeaknessArea(malicious)).not.toThrow();
      expect(isRubricWeaknessArea(malicious)).toBe(false);
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
      expect(() => isRubricWeaknessArea(explosive)).not.toThrow();
      expect(isRubricWeaknessArea(explosive)).toBe(false);
    });

    test("Object.create(null) input is rejected WITHOUT throwing", () => {
      const nullProto: unknown = Object.create(null);
      expect(() => isRubricWeaknessArea(nullProto)).not.toThrow();
      expect(isRubricWeaknessArea(nullProto)).toBe(false);

      const forgedNullProto: unknown = Object.assign(Object.create(null), { 0: "hifz", length: 4 });
      expect(() => isRubricWeaknessArea(forgedNullProto)).not.toThrow();
      expect(isRubricWeaknessArea(forgedNullProto)).toBe(false);
    });

    test("crafted __proto__-bearing payload is rejected WITHOUT throwing", () => {
      // JSON-string-shaped attacker payload — "__proto__" lands as an own enumerable key.
      const protoPayload: Record<string, unknown> = { ["__proto__"]: { isAdmin: true }, area: "hifz" };
      expect(() => isRubricWeaknessArea(protoPayload)).not.toThrow();
      expect(isRubricWeaknessArea(protoPayload)).toBe(false);
      expect(Object.keys(protoPayload)).toContain("__proto__");
    });

    test("Symbol masquerading as a member name is rejected WITHOUT throwing", () => {
      const symbolInput = Symbol.for("tajweed");
      expect(() => isRubricWeaknessArea(symbolInput)).not.toThrow();
      expect(isRubricWeaknessArea(symbolInput)).toBe(false);
    });

    test("arrays and functions are rejected WITHOUT throwing", () => {
      const arrayInput: unknown = [RubricWeaknessArea.Hifz];
      const fnInput: unknown = memberReturningFunction;
      expect(() => isRubricWeaknessArea(arrayInput)).not.toThrow();
      expect(isRubricWeaknessArea(arrayInput)).toBe(false);
      expect(() => isRubricWeaknessArea(fnInput)).not.toThrow();
      expect(isRubricWeaknessArea(fnInput)).toBe(false);
    });
  });
});
