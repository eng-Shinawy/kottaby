/**
 * HeldBalanceLane + isHeldBalanceLane 4-Tier Test Suite.
 * Pure unit tier — NO DB, NO schema imports.
 * Tier 1: 100% branch/statement coverage of the guard.
 * Tier 2: Boundary cases — unicode/RTL, long strings, near-miss spellings.
 * Tier 3: Chaos/fuzz — deterministic fuzz, symbol/object/null/undefined/array hostility.
 * Tier 4: Security — a non-string can never be coerced to true; reject, never throw.
 */
import { describe, expect, test } from "bun:test";
import { HeldBalanceLane, isHeldBalanceLane } from "@/backend/enum/scheduling/held-balance-lane.enum";

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

/** Module-scope fixture used by the chaos tier (a function masquerading as a lane value). */
function memberReturningFunction(): string {
  return HeldBalanceLane.Trial;
}

describe("isHeldBalanceLane", () => {
  // ---- Tier 1: Branch/Statement Coverage ----
  describe("Tier 1 — branch coverage", () => {
    test("canonical value set frozen exactly as declared", () => {
      expect((Object.values(HeldBalanceLane) as string[]).join("|")).toBe("trial|hifz|tajweed");
    });

    test("every enum member passes the guard (true branch)", () => {
      expect(isHeldBalanceLane(HeldBalanceLane.Trial)).toBe(true);
      expect(isHeldBalanceLane(HeldBalanceLane.Hifz)).toBe(true);
      expect(isHeldBalanceLane(HeldBalanceLane.Tajweed)).toBe(true);
    });

    test("casing variants of members fail the membership check (false branch)", () => {
      expect(isHeldBalanceLane("Trial")).toBe(false);
      expect(isHeldBalanceLane("TRIAL")).toBe(false);
      expect(isHeldBalanceLane("tRial")).toBe(false);
      expect(isHeldBalanceLane("Hifz")).toBe(false);
      expect(isHeldBalanceLane("HIFZ")).toBe(false);
      expect(isHeldBalanceLane("Tajweed")).toBe(false);
      expect(isHeldBalanceLane("TAJWEED")).toBe(false);
    });

    test("string that is not a member fails the membership check (false branch)", () => {
      expect(isHeldBalanceLane("reviews")).toBe(false);
      expect(isHeldBalanceLane("session")).toBe(false);
    });

    test("empty string is rejected", () => {
      expect(isHeldBalanceLane("")).toBe(false);
    });

    test("non-string input short-circuits on the typeof check (left-false branch)", () => {
      expect(isHeldBalanceLane(undefined)).toBe(false);
      expect(isHeldBalanceLane(0)).toBe(false);
    });

    test("true result narrows unknown to HeldBalanceLane", () => {
      const value: unknown = "hifz";
      if (!isHeldBalanceLane(value)) {
        expect.unreachable("guard should accept the exact member string");
      }
      expect(value).toBe(HeldBalanceLane.Hifz);
    });
  });

  // ---- Tier 2: Boundary & Edge Cases ----
  describe("Tier 2 — boundary cases", () => {
    test("unicode / Arabic / RTL strings are rejected", () => {
      const unicodeInputs = [
        "القرآن",
        "حفظ",
        "تجويد",
        "تجويد ",
        "\u200Ftrial",
        "trial\u200F",
        "\u05D0\u05D1\u05D2",
        "hif\u0632",
        "✅",
        "🅃🅁🄸🄰🄻",
        "tr\u0300ial",
      ];
      for (const input of unicodeInputs) {
        expect(isHeldBalanceLane(input)).toBe(false);
      }
    });

    test("long strings (10k chars) are rejected", () => {
      expect(isHeldBalanceLane("x".repeat(10000))).toBe(false);
      expect(isHeldBalanceLane(`${HeldBalanceLane.Trial}${"@".repeat(9995)}`)).toBe(false);
      expect(isHeldBalanceLane(`${"@".repeat(9994)}${HeldBalanceLane.Tajweed}`)).toBe(false);
      expect(isHeldBalanceLane(`${HeldBalanceLane.Hifz}${HeldBalanceLane.Hifz}`.repeat(2500))).toBe(false);
    });

    test("near-miss spellings are rejected", () => {
      expect(isHeldBalanceLane("trials")).toBe(false);
      expect(isHeldBalanceLane("trial1")).toBe(false);
      expect(isHeldBalanceLane("hifzz")).toBe(false);
      expect(isHeldBalanceLane("hif z")).toBe(false);
      expect(isHeldBalanceLane("tajweeed")).toBe(false);
      expect(isHeldBalanceLane("tajweed ")).toBe(false);
    });

    test("whitespace boundaries are rejected", () => {
      expect(isHeldBalanceLane(" trial")).toBe(false);
      expect(isHeldBalanceLane("trial ")).toBe(false);
      expect(isHeldBalanceLane("\ttrial")).toBe(false);
      expect(isHeldBalanceLane("hifz\n")).toBe(false);
      expect(isHeldBalanceLane(" tajweed ")).toBe(false);
    });

    test("control characters embedded in member-like strings are rejected", () => {
      expect(isHeldBalanceLane("tr\x00ial")).toBe(false);
      expect(isHeldBalanceLane("hifz\r")).toBe(false);
      expect(isHeldBalanceLane("\ufefftajweed")).toBe(false);
    });

    test("primitive non-strings are rejected", () => {
      expect(isHeldBalanceLane(0)).toBe(false);
      expect(isHeldBalanceLane(Number.NaN)).toBe(false);
      expect(isHeldBalanceLane(true)).toBe(false);
      expect(isHeldBalanceLane(undefined)).toBe(false);
      expect(isHeldBalanceLane(null)).toBe(false);
    });
  });

  // ---- Tier 3: Chaos/Fuzz ----
  describe("Tier 3 — chaos & fuzz", () => {
    test("random non-member strings are ALL rejected without throwing", () => {
      for (const candidate of fuzzStrings(200)) {
        expect(isHeldBalanceLane(candidate)).toBe(false);
      }
    });

    test("symbols are rejected WITHOUT throwing", () => {
      const symbolInputs = [Symbol.for("trial"), Symbol(HeldBalanceLane.Hifz), Symbol.iterator];
      for (const input of symbolInputs) {
        expect(() => isHeldBalanceLane(input)).not.toThrow();
        expect(isHeldBalanceLane(input)).toBe(false);
      }
    });

    test("objects and arrays are rejected WITHOUT throwing", () => {
      const hostileInputs: unknown[] = [
        null,
        undefined,
        {},
        { lane: HeldBalanceLane.Trial },
        { toString: null },
        [],
        [HeldBalanceLane.Tajweed],
        [HeldBalanceLane.Trial, HeldBalanceLane.Hifz],
        new Date(),
        new Map(),
        new Set([HeldBalanceLane.Hifz]),
        /trial/,
      ];
      for (const input of hostileInputs) {
        expect(() => isHeldBalanceLane(input)).not.toThrow();
        expect(isHeldBalanceLane(input)).toBe(false);
      }
    });

    test("strings containing LIKE wildcards, quotes and injection shapes are rejected", () => {
      const hostileInputs = [
        "%",
        "_",
        "\\",
        "'",
        "%\"%'\\_",
        "%trial",
        "hif%z",
        "_tajweed",
        "'; DROP TABLE students; --",
        '"trial"',
      ];
      for (const input of hostileInputs) {
        expect(isHeldBalanceLane(input)).toBe(false);
      }
    });

    test("functions masquerading as members are rejected WITHOUT throwing", () => {
      const fnInput: unknown = memberReturningFunction;
      expect(() => isHeldBalanceLane(fnInput)).not.toThrow();
      expect(isHeldBalanceLane(fnInput)).toBe(false);
    });
  });

  // ---- Tier 4: Security & Abuse (coercion resistance) ----
  describe("Tier 4 — coercion resistance", () => {
    test("boxed String objects are NEVER coerced to true", () => {
      // Object(...) wraps the primitive in a String object (typeof "object") —
      // the same boxed-value shape `new String(...)` would produce, expressed
      // without the primitive-wrapper constructor that linting forbids.
      const boxedMember: unknown = Object(HeldBalanceLane.Trial);
      const boxedCasing: unknown = Object("Trial");
      const boxedEmpty: unknown = Object("");
      for (const input of [boxedMember, boxedCasing, boxedEmpty]) {
        expect(() => isHeldBalanceLane(input)).not.toThrow();
        expect(isHeldBalanceLane(input)).toBe(false);
      }
    });

    test("whitespace-padded member strings are never accepted as members", () => {
      expect(isHeldBalanceLane(" trial")).toBe(false);
      expect(isHeldBalanceLane("trial ")).toBe(false);
      expect(isHeldBalanceLane("\u00A0trial")).toBe(false);
    });

    test("object with toString override returning a member is rejected WITHOUT throwing", () => {
      const malicious: unknown = { toString: () => HeldBalanceLane.Tajweed };
      expect(() => isHeldBalanceLane(malicious)).not.toThrow();
      expect(isHeldBalanceLane(malicious)).toBe(false);
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
      expect(() => isHeldBalanceLane(explosive)).not.toThrow();
      expect(isHeldBalanceLane(explosive)).toBe(false);
    });

    test("Object.create(null) input is rejected WITHOUT throwing", () => {
      const nullProto: unknown = Object.create(null);
      expect(() => isHeldBalanceLane(nullProto)).not.toThrow();
      expect(isHeldBalanceLane(nullProto)).toBe(false);

      const forgedNullProto: unknown = Object.assign(Object.create(null), { 0: "hifz", length: 4 });
      expect(() => isHeldBalanceLane(forgedNullProto)).not.toThrow();
      expect(isHeldBalanceLane(forgedNullProto)).toBe(false);
    });

    test("crafted __proto__-bearing payload is rejected WITHOUT throwing", () => {
      // JSON-string-shaped attacker payload — "__proto__" lands as an own enumerable key.
      const protoPayload: Record<string, unknown> = { ["__proto__"]: { isAdmin: true }, lane: "tajweed" };
      expect(() => isHeldBalanceLane(protoPayload)).not.toThrow();
      expect(isHeldBalanceLane(protoPayload)).toBe(false);
      expect(Object.keys(protoPayload)).toContain("__proto__");
    });

    test("numeric coercion traps are rejected WITHOUT throwing", () => {
      const traps: unknown[] = [0, -0, Number.NaN, Number.POSITIVE_INFINITY, 1e21, true, false, 0n, BigInt(1)];
      for (const input of traps) {
        expect(() => isHeldBalanceLane(input)).not.toThrow();
        expect(isHeldBalanceLane(input)).toBe(false);
      }
    });
  });
});
