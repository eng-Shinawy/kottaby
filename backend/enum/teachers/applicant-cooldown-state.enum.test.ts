/**
 * ApplicantCooldownState + isApplicantCooldownState 4-Tier Test Suite.
 * Pure unit tier — NO DB, NO schema imports.
 * Tier 1: 100% branch/statement coverage of the guard.
 * Tier 2: Boundary cases — case mismatch, whitespace, empty, primitive types.
 * Tier 3: Chaos/fuzz — random strings, 10k payloads, unicode/RTL, wildcards.
 * Tier 4: Security — coercion overrides, prototype attacks; reject, never throw.
 */
import { describe, expect, test } from "bun:test";
import {
  ApplicantCooldownState,
  isApplicantCooldownState,
} from "@/backend/enum/teachers/applicant-cooldown-state.enum";

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

/** Module-scope fixture used by the security tier (a function masquerading as a state value). */
function memberReturningFunction(): string {
  return ApplicantCooldownState.Active;
}

describe("isApplicantCooldownState", () => {
  // ---- Tier 1: Branch/Statement Coverage ----
  describe("Tier 1 — branch coverage", () => {
    test("canonical value set frozen exactly as declared", () => {
      expect((Object.values(ApplicantCooldownState) as string[]).join("|")).toBe("none|active|expired");
    });

    test("every enum member passes the guard (true branch)", () => {
      expect(isApplicantCooldownState(ApplicantCooldownState.None)).toBe(true);
      expect(isApplicantCooldownState(ApplicantCooldownState.Active)).toBe(true);
      expect(isApplicantCooldownState(ApplicantCooldownState.Expired)).toBe(true);
    });

    test("string that is not a member fails the membership check (false branch)", () => {
      expect(isApplicantCooldownState("cooling")).toBe(false);
      expect(isApplicantCooldownState("suspended")).toBe(false);
    });

    test("non-string input short-circuits on the typeof check (left-false branch)", () => {
      expect(isApplicantCooldownState(undefined)).toBe(false);
      expect(isApplicantCooldownState(0)).toBe(false);
    });

    test("true result narrows unknown to ApplicantCooldownState", () => {
      const value: unknown = "expired";
      if (!isApplicantCooldownState(value)) {
        expect.unreachable("guard should accept the exact member string");
      }
      expect(value).toBe(ApplicantCooldownState.Expired);
    });
  });

  // ---- Tier 2: Boundary & Edge Cases ----
  describe("Tier 2 — boundary cases", () => {
    test("case mismatches are rejected", () => {
      expect(isApplicantCooldownState("None")).toBe(false);
      expect(isApplicantCooldownState("NONE")).toBe(false);
      expect(isApplicantCooldownState("Active")).toBe(false);
      expect(isApplicantCooldownState("ACTIVE")).toBe(false);
      expect(isApplicantCooldownState("Expired")).toBe(false);
      expect(isApplicantCooldownState("aCtIvE")).toBe(false);
    });

    test('whitespace boundaries are rejected ("active ", " none", tab/newline)', () => {
      expect(isApplicantCooldownState("active ")).toBe(false);
      expect(isApplicantCooldownState(" none")).toBe(false);
      expect(isApplicantCooldownState("\texpired")).toBe(false);
      expect(isApplicantCooldownState("active\n")).toBe(false);
      expect(isApplicantCooldownState(" none ")).toBe(false);
    });

    test("empty string is rejected", () => {
      expect(isApplicantCooldownState("")).toBe(false);
    });

    test("near-miss spellings are rejected", () => {
      expect(isApplicantCooldownState("non")).toBe(false);
      expect(isApplicantCooldownState("nonee")).toBe(false);
      expect(isApplicantCooldownState("actve")).toBe(false);
      expect(isApplicantCooldownState("acti ve")).toBe(false);
      expect(isApplicantCooldownState("expire")).toBe(false);
      expect(isApplicantCooldownState("expiredd")).toBe(false);
    });

    test("sibling applicant vocabularies are not cooldown states", () => {
      expect(isApplicantCooldownState("pending")).toBe(false);
      expect(isApplicantCooldownState("in_evaluation")).toBe(false);
      expect(isApplicantCooldownState("failed")).toBe(false);
      expect(isApplicantCooldownState("passed")).toBe(false);
    });

    test("primitive non-strings are rejected", () => {
      expect(isApplicantCooldownState(0)).toBe(false);
      expect(isApplicantCooldownState(Number.NaN)).toBe(false);
      expect(isApplicantCooldownState(true)).toBe(false);
      expect(isApplicantCooldownState(undefined)).toBe(false);
      expect(isApplicantCooldownState(null)).toBe(false);
    });
  });

  // ---- Tier 3: Chaos/Fuzz ----
  describe("Tier 3 — chaos & fuzz", () => {
    test("random non-member strings are ALL rejected without throwing", () => {
      for (const candidate of fuzzStrings(200)) {
        expect(isApplicantCooldownState(candidate)).toBe(false);
      }
    });

    test("long strings (10k chars) are rejected", () => {
      expect(isApplicantCooldownState("x".repeat(10000))).toBe(false);
      expect(isApplicantCooldownState(`${ApplicantCooldownState.None}${"@".repeat(9995)}`)).toBe(false);
      expect(isApplicantCooldownState(`${"@".repeat(9993)}${ApplicantCooldownState.Active}`)).toBe(false);
    });

    test("unicode / Arabic / RTL strings are rejected", () => {
      const unicodeInputs = [
        "القرآن",
        "التجويد",
        "الحفظ",
        "\u200Factive",
        "none\u200F",
        "\u05D0\u05D1\u05D2",
        "activ\u0645e",
        "✅",
        "🄰🄲🅃",
        "acti\u0300ve",
      ];
      for (const input of unicodeInputs) {
        expect(isApplicantCooldownState(input)).toBe(false);
      }
    });

    test("strings containing LIKE wildcards, underscores, backslashes and quotes are rejected", () => {
      const hostileInputs = [
        "%",
        "_",
        "\\",
        "'",
        "%\"%'\\_",
        "%active",
        "act%ive",
        "_none",
        "expired_",
        "none_",
        "e'_xpired",
        "\\nactive",
        "'; DROP TABLE applicants; --",
        '"expired"',
      ];
      for (const input of hostileInputs) {
        expect(isApplicantCooldownState(input)).toBe(false);
      }
    });

    test("control characters embedded in member-like strings are rejected", () => {
      expect(isApplicantCooldownState("act\x00ive")).toBe(false);
      expect(isApplicantCooldownState("expired\r")).toBe(false);
      expect(isApplicantCooldownState("\ufeffnone")).toBe(false);
    });
  });

  // ---- Tier 4: Security & Abuse ----
  describe("Tier 4 — security & abuse", () => {
    test("object with toString override returning a member is rejected WITHOUT throwing", () => {
      const malicious: unknown = { toString: () => ApplicantCooldownState.Active };
      expect(() => isApplicantCooldownState(malicious)).not.toThrow();
      expect(isApplicantCooldownState(malicious)).toBe(false);
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
      expect(() => isApplicantCooldownState(explosive)).not.toThrow();
      expect(isApplicantCooldownState(explosive)).toBe(false);
    });

    test("Object.create(null) input is rejected WITHOUT throwing", () => {
      const nullProto: unknown = Object.create(null);
      expect(() => isApplicantCooldownState(nullProto)).not.toThrow();
      expect(isApplicantCooldownState(nullProto)).toBe(false);

      const forgedNullProto: unknown = Object.assign(Object.create(null), { 0: "active", length: 6 });
      expect(() => isApplicantCooldownState(forgedNullProto)).not.toThrow();
      expect(isApplicantCooldownState(forgedNullProto)).toBe(false);
    });

    test("crafted __proto__-bearing payload is rejected WITHOUT throwing", () => {
      // JSON-string-shaped attacker payload — "__proto__" lands as an own enumerable key.
      const protoPayload: Record<string, unknown> = { ["__proto__"]: { isAdmin: true }, state: "expired" };
      expect(() => isApplicantCooldownState(protoPayload)).not.toThrow();
      expect(isApplicantCooldownState(protoPayload)).toBe(false);
      expect(Object.keys(protoPayload)).toContain("__proto__");
    });

    test("Symbol masquerading as a member name is rejected WITHOUT throwing", () => {
      const symbolInput = Symbol.for("active");
      expect(() => isApplicantCooldownState(symbolInput)).not.toThrow();
      expect(isApplicantCooldownState(symbolInput)).toBe(false);
    });

    test("arrays and functions are rejected WITHOUT throwing", () => {
      const arrayInput: unknown = [ApplicantCooldownState.Expired];
      const fnInput: unknown = memberReturningFunction;
      expect(() => isApplicantCooldownState(arrayInput)).not.toThrow();
      expect(isApplicantCooldownState(arrayInput)).toBe(false);
      expect(() => isApplicantCooldownState(fnInput)).not.toThrow();
      expect(isApplicantCooldownState(fnInput)).toBe(false);
    });
  });
});
