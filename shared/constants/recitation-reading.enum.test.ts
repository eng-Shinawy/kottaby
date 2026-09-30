/**
 * RecitationReading + isRecitationReading 4-Tier Test Suite.
 * Pure unit tier — NO DB, NO schema imports.
 * Tier 1: 100% branch/statement coverage of the guard.
 * Tier 2: Boundary cases — case mismatch, whitespace, empty, primitive types.
 * Tier 3: Chaos/fuzz — random strings, 10k payloads, unicode/RTL, wildcards.
 * Tier 4: Security — coercion overrides, prototype attacks; reject, never throw.
 */
import { describe, expect, test } from "bun:test";
import {
  isRecitationReading,
  RECITATION_READINGS,
  RecitationReading,
} from "@/shared/constants/recitation-reading.enum";

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

/** Module-scope fixture used by the security tier (a function masquerading as a reading value). */
function memberReturningFunction(): string {
  return RecitationReading.HAFS_AN_ASIM;
}

describe("isRecitationReading", () => {
  // ---- Tier 1: Branch/Statement Coverage ----
  describe("Tier 1 — branch coverage", () => {
    test("canonical value set contains all 10 Qira'at", () => {
      expect(RECITATION_READINGS).toHaveLength(10);
      expect(RECITATION_READINGS[0]).toBe(RecitationReading.HAFS_AN_ASIM);
    });

    test("every enum member passes the guard (true branch)", () => {
      for (const reading of RECITATION_READINGS) {
        expect(isRecitationReading(reading)).toBe(true);
      }
    });

    test("string that is not a member fails the membership check (false branch)", () => {
      expect(isRecitationReading("unknown_reading")).toBe(false);
      expect(isRecitationReading("hafs")).toBe(false);
    });

    test("non-string input short-circuits on the typeof check (left-false branch)", () => {
      expect(isRecitationReading(undefined)).toBe(false);
      expect(isRecitationReading(0)).toBe(false);
    });

    test("true result narrows unknown to RecitationReading", () => {
      const value: unknown = "warsh_an_nafi";
      if (!isRecitationReading(value)) {
        expect.unreachable("guard should accept the exact member string");
      }
      expect(value).toBe(RecitationReading.WARSH_AN_NAFI);
    });
  });

  // ---- Tier 2: Boundary & Edge Cases ----
  describe("Tier 2 — boundary cases", () => {
    test("case mismatches are rejected", () => {
      expect(isRecitationReading("HAFS_AN_ASIM")).toBe(false);
      expect(isRecitationReading("Hafs_An_Asim")).toBe(false);
      expect(isRecitationReading("WARSH_AN_NAFI")).toBe(false);
    });

    test('whitespace boundaries are rejected ("hafs_an_asim ", " hafs_an_asim", tab/newline)', () => {
      expect(isRecitationReading("hafs_an_asim ")).toBe(false);
      expect(isRecitationReading(" hafs_an_asim")).toBe(false);
      expect(isRecitationReading("\thafs_an_asim")).toBe(false);
      expect(isRecitationReading("hafs_an_asim\n")).toBe(false);
    });

    test("empty string is rejected", () => {
      expect(isRecitationReading("")).toBe(false);
    });

    test("near-miss spellings are rejected", () => {
      expect(isRecitationReading("hafs_an_asim_")).toBe(false);
      expect(isRecitationReading("warsh")).toBe(false);
      expect(isRecitationReading("qalun")).toBe(false);
    });

    test("primitive non-strings are rejected", () => {
      expect(isRecitationReading(0)).toBe(false);
      expect(isRecitationReading(Number.NaN)).toBe(false);
      expect(isRecitationReading(true)).toBe(false);
      expect(isRecitationReading(undefined)).toBe(false);
      expect(isRecitationReading(null)).toBe(false);
    });
  });

  // ---- Tier 3: Chaos/Fuzz ----
  describe("Tier 3 — chaos & fuzz", () => {
    test("random non-member strings are ALL rejected without throwing", () => {
      for (const candidate of fuzzStrings(200)) {
        expect(isRecitationReading(candidate)).toBe(false);
      }
    });

    test("long strings (10k chars) are rejected", () => {
      expect(isRecitationReading("x".repeat(10000))).toBe(false);
      expect(isRecitationReading(`${RecitationReading.HAFS_AN_ASIM}${"@".repeat(9992)}`)).toBe(false);
      expect(isRecitationReading(`${"@".repeat(9992)}${RecitationReading.WARSH_AN_NAFI}`)).toBe(false);
    });

    test("unicode / Arabic / RTL strings are rejected", () => {
      const unicodeInputs = ["حفص عن عاصم", "ورش عن نافع", "قراءات", "\u200Fhafs_an_asim", "hafs_an_asim\u200F", "✅"];
      for (const input of unicodeInputs) {
        expect(isRecitationReading(input)).toBe(false);
      }
    });

    test("control characters embedded in member-like strings are rejected", () => {
      expect(isRecitationReading("hafs\x00_an_asim")).toBe(false);
      expect(isRecitationReading("warsh_an_nafi\r")).toBe(false);
      expect(isRecitationReading("\ufeffqalun_an_nafi")).toBe(false);
    });
  });

  // ---- Tier 4: Security & Abuse ----
  describe("Tier 4 — security & abuse", () => {
    test("object with toString override returning a member is rejected WITHOUT throwing", () => {
      const malicious: unknown = { toString: () => RecitationReading.HAFS_AN_ASIM };
      expect(() => isRecitationReading(malicious)).not.toThrow();
      expect(isRecitationReading(malicious)).toBe(false);
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
      expect(() => isRecitationReading(explosive)).not.toThrow();
      expect(isRecitationReading(explosive)).toBe(false);
    });

    test("Object.create(null) input is rejected WITHOUT throwing", () => {
      const nullProto: unknown = Object.create(null);
      expect(() => isRecitationReading(nullProto)).not.toThrow();
      expect(isRecitationReading(nullProto)).toBe(false);
    });

    test("crafted __proto__-bearing payload is rejected WITHOUT throwing", () => {
      const protoPayload: Record<string, unknown> = { ["__proto__"]: { isAdmin: true }, reading: "hafs_an_asim" };
      expect(() => isRecitationReading(protoPayload)).not.toThrow();
      expect(isRecitationReading(protoPayload)).toBe(false);
    });

    test("arrays and functions are rejected WITHOUT throwing", () => {
      const arrayInput: unknown = [RecitationReading.HAFS_AN_ASIM];
      const fnInput: unknown = memberReturningFunction;
      expect(() => isRecitationReading(arrayInput)).not.toThrow();
      expect(isRecitationReading(arrayInput)).toBe(false);
      expect(() => isRecitationReading(fnInput)).not.toThrow();
      expect(isRecitationReading(fnInput)).toBe(false);
    });
  });
});
