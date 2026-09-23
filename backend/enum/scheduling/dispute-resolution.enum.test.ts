/**
 * DisputeResolution + isDisputeResolution test suite.
 * Pure unit tier — NO DB, NO schema imports (the vocabulary has no pgEnum
 *   backing; it is a pure transition selector).
 * Vocabulary tier: pins the full member list byte-for-byte (declaration
 *   order), the wire-identical key↔value contract, and the two-generation
 *   escrow split (held: Cancel|Complete — consumed: Refund|PartialRefund|Uphold).
 * Guard tiers: 100% branch/statement coverage of the guard, boundary
 *   hostility, deterministic chaos/fuzz, and coercion-resistance security.
 */
import { describe, expect, test } from "bun:test";
import { DisputeResolution, isDisputeResolution } from "@/backend/enum/scheduling/dispute-resolution.enum";

/** Canonical member order — the single hardcoded ground truth every vocabulary assertion derives from. */
const CANONICAL_VALUES = ["Cancel", "Complete", "Refund", "PartialRefund", "Uphold"] as const;

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

/** Module-scope fixture used by the security tier (a function masquerading as a resolution value). */
function memberReturningFunction(): string {
  return DisputeResolution.Uphold;
}

describe("DisputeResolution vocabulary", () => {
  test("exposes exactly the canonical members, in declaration order", () => {
    expect(Object.values(DisputeResolution).join("|")).toBe(CANONICAL_VALUES.join("|"));
    expect(Object.values(DisputeResolution)).toHaveLength(CANONICAL_VALUES.length);
  });

  test("held-escrow members keep their shipped byte-stable names and values", () => {
    expect([DisputeResolution.Cancel, DisputeResolution.Complete].join("|")).toBe("Cancel|Complete");
  });

  test("consumed-escrow members carry the exact wire strings", () => {
    expect([DisputeResolution.Refund, DisputeResolution.PartialRefund, DisputeResolution.Uphold].join("|")).toBe(
      "Refund|PartialRefund|Uphold"
    );
  });

  test("values are wire-identical to member names (round-trip over the whole vocabulary)", () => {
    const keys = Object.keys(DisputeResolution);
    const values = Object.values(DisputeResolution);
    expect(values).toHaveLength(keys.length);
    expect(values.join("|")).toBe(keys.join("|"));
    // Round-trip totality: every value is a key, every key is a value.
    expect(new Set(values).size).toBe(keys.length);
    for (const value of values) {
      expect(keys).toContain(value);
    }
  });
});

describe("isDisputeResolution", () => {
  // ---- Tier 1: Branch/Statement Coverage ----
  describe("Tier 1 — branch coverage", () => {
    test("every enum member passes the guard (true branch)", () => {
      expect(isDisputeResolution(DisputeResolution.Cancel)).toBe(true);
      expect(isDisputeResolution(DisputeResolution.Complete)).toBe(true);
      expect(isDisputeResolution(DisputeResolution.Refund)).toBe(true);
      expect(isDisputeResolution(DisputeResolution.PartialRefund)).toBe(true);
      expect(isDisputeResolution(DisputeResolution.Uphold)).toBe(true);
    });

    test("Object.values round-trip: every runtime value passes the guard", () => {
      for (const value of Object.values(DisputeResolution)) {
        expect(isDisputeResolution(value)).toBe(true);
      }
    });

    test("string that is not a member fails the membership check (false branch)", () => {
      expect(isDisputeResolution("Reversed")).toBe(false);
      expect(isDisputeResolution("Dismissed")).toBe(false);
    });

    test("non-string input short-circuits on the typeof check (left-false branch)", () => {
      expect(isDisputeResolution(undefined)).toBe(false);
      expect(isDisputeResolution(0)).toBe(false);
    });

    test("true result narrows unknown to DisputeResolution", () => {
      const value: unknown = "PartialRefund";
      if (!isDisputeResolution(value)) {
        expect.unreachable("guard should accept the exact member string");
      }
      expect(value).toBe(DisputeResolution.PartialRefund);
    });
  });

  // ---- Tier 2: Boundary & Edge Cases ----
  describe("Tier 2 — boundary cases", () => {
    test("case mismatches are rejected", () => {
      expect(isDisputeResolution("cancel")).toBe(false);
      expect(isDisputeResolution("CANCEL")).toBe(false);
      expect(isDisputeResolution("cAnCeL")).toBe(false);
      expect(isDisputeResolution("refund")).toBe(false);
      expect(isDisputeResolution("REFUND")).toBe(false);
      expect(isDisputeResolution("partialrefund")).toBe(false);
      expect(isDisputeResolution("Partialrefund")).toBe(false);
      expect(isDisputeResolution("PARTIAL_REFUND")).toBe(false);
      expect(isDisputeResolution("partial_refund")).toBe(false);
      expect(isDisputeResolution("uphold")).toBe(false);
      expect(isDisputeResolution("UPHOLD")).toBe(false);
    });

    test("whitespace boundaries are rejected", () => {
      expect(isDisputeResolution("Refund ")).toBe(false);
      expect(isDisputeResolution(" Refund")).toBe(false);
      expect(isDisputeResolution("\tRefund")).toBe(false);
      expect(isDisputeResolution("Complete\n")).toBe(false);
      expect(isDisputeResolution(" PartialRefund ")).toBe(false);
    });

    test("empty string is rejected", () => {
      expect(isDisputeResolution("")).toBe(false);
    });

    test("near-miss spellings are rejected", () => {
      expect(isDisputeResolution("Refunds")).toBe(false);
      expect(isDisputeResolution("Re fund")).toBe(false);
      expect(isDisputeResolution("Partial Refund")).toBe(false);
      expect(isDisputeResolution("Partial-Refund")).toBe(false);
      expect(isDisputeResolution("Upheld")).toBe(false);
      expect(isDisputeResolution("Upholds")).toBe(false);
      expect(isDisputeResolution("Canceled")).toBe(false);
      expect(isDisputeResolution("Cancelled")).toBe(false);
    });

    test("null, undefined, numbers and booleans are rejected", () => {
      expect(isDisputeResolution(null)).toBe(false);
      expect(isDisputeResolution(undefined)).toBe(false);
      expect(isDisputeResolution(0)).toBe(false);
      expect(isDisputeResolution(5)).toBe(false);
      expect(isDisputeResolution(Number.NaN)).toBe(false);
      expect(isDisputeResolution(true)).toBe(false);
    });

    test("objects (including member-bearing ones) are rejected", () => {
      expect(isDisputeResolution({})).toBe(false);
      expect(isDisputeResolution({ resolution: "Refund" })).toBe(false);
      expect(isDisputeResolution(["Refund"])).toBe(false);
    });

    test("unicode / Arabic / RTL strings are rejected", () => {
      const unicodeInputs = [
        "استرداد",
        "إبقاء",
        "قرار",
        "\u200FRefund",
        "Refund\u200F",
        "\u05D0\u05D1\u05D2",
        "Refu\u0646d",
        "✅",
        "⚖️",
        "Refu\u0300nd",
      ];
      for (const input of unicodeInputs) {
        expect(isDisputeResolution(input)).toBe(false);
      }
    });

    test("long strings (10k chars) are rejected", () => {
      expect(isDisputeResolution("x".repeat(10000))).toBe(false);
      expect(isDisputeResolution(`${DisputeResolution.Refund}${"@".repeat(9994)}`)).toBe(false);
      expect(isDisputeResolution(`${"@".repeat(9993)}${DisputeResolution.Uphold}`)).toBe(false);
    });

    test("control characters embedded in member-like strings are rejected", () => {
      expect(isDisputeResolution("Refu\x00nd")).toBe(false);
      expect(isDisputeResolution("Uphold\r")).toBe(false);
      expect(isDisputeResolution("\ufeffCancel")).toBe(false);
    });
  });

  // ---- Tier 3: Chaos/Fuzz ----
  describe("Tier 3 — chaos & fuzz", () => {
    test("random non-member strings are ALL rejected without throwing", () => {
      for (const candidate of fuzzStrings(200)) {
        expect(isDisputeResolution(candidate)).toBe(false);
      }
    });

    test("strings containing LIKE wildcards, quotes and injection shapes are rejected", () => {
      const hostileInputs = [
        "%",
        "_",
        "\\",
        "'",
        "%\"%'\\_",
        "%Refund",
        "Refu%nd",
        "_Uphold",
        "'; DROP TABLE sessions; --",
        '"Refund"',
      ];
      for (const input of hostileInputs) {
        expect(isDisputeResolution(input)).toBe(false);
      }
    });

    test("symbols are rejected WITHOUT throwing", () => {
      const symbolInputs = [Symbol.for("Refund"), Symbol(DisputeResolution.Cancel), Symbol.iterator];
      for (const input of symbolInputs) {
        expect(() => isDisputeResolution(input)).not.toThrow();
        expect(isDisputeResolution(input)).toBe(false);
      }
    });

    test("objects and arrays are rejected WITHOUT throwing", () => {
      const hostileInputs: unknown[] = [
        null,
        undefined,
        {},
        { resolution: DisputeResolution.Refund },
        { toString: null },
        [],
        [DisputeResolution.Uphold],
        new Date(),
        new Map(),
        new Set([DisputeResolution.Cancel]),
        /Refund/,
      ];
      for (const input of hostileInputs) {
        expect(() => isDisputeResolution(input)).not.toThrow();
        expect(isDisputeResolution(input)).toBe(false);
      }
    });

    test("functions masquerading as members are rejected WITHOUT throwing", () => {
      const fnInput: unknown = memberReturningFunction;
      expect(() => isDisputeResolution(fnInput)).not.toThrow();
      expect(isDisputeResolution(fnInput)).toBe(false);
    });
  });

  // ---- Tier 4: Security & Abuse (coercion resistance) ----
  describe("Tier 4 — coercion resistance", () => {
    test("boxed String objects are NEVER coerced to true", () => {
      // Object(...) wraps the primitive in a String object (typeof "object") —
      // the same boxed-value shape `new String(...)` would produce, expressed
      // without the primitive-wrapper constructor that linting forbids.
      const boxedMember: unknown = Object(DisputeResolution.Refund);
      const boxedCasing: unknown = Object("refund");
      const boxedEmpty: unknown = Object("");
      for (const input of [boxedMember, boxedCasing, boxedEmpty]) {
        expect(() => isDisputeResolution(input)).not.toThrow();
        expect(isDisputeResolution(input)).toBe(false);
      }
    });

    test("object with toString override returning a member is rejected WITHOUT throwing", () => {
      const malicious: unknown = { toString: () => DisputeResolution.PartialRefund };
      expect(() => isDisputeResolution(malicious)).not.toThrow();
      expect(isDisputeResolution(malicious)).toBe(false);
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
      expect(() => isDisputeResolution(explosive)).not.toThrow();
      expect(isDisputeResolution(explosive)).toBe(false);
    });

    test("Object.create(null) input is rejected WITHOUT throwing", () => {
      const nullProto: unknown = Object.create(null);
      expect(() => isDisputeResolution(nullProto)).not.toThrow();
      expect(isDisputeResolution(nullProto)).toBe(false);

      const forgedNullProto: unknown = Object.assign(Object.create(null), { 0: "Uphold", length: 6 });
      expect(() => isDisputeResolution(forgedNullProto)).not.toThrow();
      expect(isDisputeResolution(forgedNullProto)).toBe(false);
    });

    test("crafted __proto__-bearing payload is rejected WITHOUT throwing", () => {
      // JSON-string-shaped attacker payload — "__proto__" lands as an own enumerable key.
      const protoPayload: Record<string, unknown> = { ["__proto__"]: { isAdmin: true }, resolution: "Refund" };
      expect(() => isDisputeResolution(protoPayload)).not.toThrow();
      expect(isDisputeResolution(protoPayload)).toBe(false);
      expect(Object.keys(protoPayload)).toContain("__proto__");
    });

    test("numeric coercion traps are rejected WITHOUT throwing", () => {
      const traps: unknown[] = [0, -0, Number.NaN, Number.POSITIVE_INFINITY, 1e21, true, false, 0n, BigInt(1)];
      for (const input of traps) {
        expect(() => isDisputeResolution(input)).not.toThrow();
        expect(isDisputeResolution(input)).toBe(false);
      }
    });
  });
});
