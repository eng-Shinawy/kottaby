/**
 * BroadcastAudienceType + isBroadcastAudienceType test suite.
 * Tier 1: Member values — the canonical four-kind audience vocabulary.
 * Tier 2: Boundary cases — case mismatch, whitespace, empty, primitives, objects.
 * Tier 3: Chaos/fuzz — random strings, 10k payloads, unicode/RTL,
 *   null-prototype objects, `__proto__`-bearing payloads.
 * Tier 4: Security — the guard's accepted string set is exactly the four
 *   members (no accidental string-literal acceptance), coercion overrides
 *   are ignored, and rejection never throws.
 * Unit tier — pure enum/guard tests: no DB client, no connection, no I/O.
 */
import { describe, expect, test } from "bun:test";
import {
  BroadcastAudienceType,
  isBroadcastAudienceType,
} from "@/backend/enum/notifications/broadcast-audience-type.enum";

/** Canonical member order — the single hardcoded ground truth every membership assertion derives from. */
const CANONICAL_VALUES = ["all", "role", "country", "plan"] as const;

/** Deterministic ascending string comparator so accepted-set assertions order identically on every run. */
function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

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

/** Module-scope fixture used by the security tier (a function masquerading as an audience value). */
function memberReturningFunction(): string {
  return BroadcastAudienceType.Plan;
}

describe("BroadcastAudienceType member values", () => {
  test("enum has exactly the four canonical members, in declared order", () => {
    expect(Object.values(BroadcastAudienceType).join("|")).toBe(CANONICAL_VALUES.join("|"));
    expect(Object.values(BroadcastAudienceType)).toHaveLength(4);
  });

  test("every member maps to its exact wire string", () => {
    const all: string = BroadcastAudienceType.All;
    const role: string = BroadcastAudienceType.Role;
    const country: string = BroadcastAudienceType.Country;
    const plan: string = BroadcastAudienceType.Plan;
    expect(all).toBe("all");
    expect(role).toBe("role");
    expect(country).toBe("country");
    expect(plan).toBe("plan");
  });
});

describe("isBroadcastAudienceType", () => {
  // ---- Tier 1: Member Values ----
  describe("Tier 1 — member values", () => {
    test("every enum member passes the guard (true branch)", () => {
      expect(isBroadcastAudienceType(BroadcastAudienceType.All)).toBe(true);
      expect(isBroadcastAudienceType(BroadcastAudienceType.Role)).toBe(true);
      expect(isBroadcastAudienceType(BroadcastAudienceType.Country)).toBe(true);
      expect(isBroadcastAudienceType(BroadcastAudienceType.Plan)).toBe(true);
    });

    test("exact member strings pass the guard", () => {
      for (const value of CANONICAL_VALUES) {
        expect(isBroadcastAudienceType(value)).toBe(true);
      }
    });

    test("string that is not a member fails the membership check (false branch)", () => {
      expect(isBroadcastAudienceType("announcement")).toBe(false);
      expect(isBroadcastAudienceType("audience")).toBe(false);
    });

    test("non-string input short-circuits on the typeof check (left-false branch)", () => {
      expect(isBroadcastAudienceType(undefined)).toBe(false);
      expect(isBroadcastAudienceType(0)).toBe(false);
    });

    test("true result narrows unknown to BroadcastAudienceType", () => {
      const value: unknown = "country";
      if (!isBroadcastAudienceType(value)) {
        expect.unreachable("guard should accept the exact member string");
      }
      expect(value).toBe(BroadcastAudienceType.Country);
    });
  });

  // ---- Tier 2: Boundary & Edge Cases ----
  describe("Tier 2 — boundary cases", () => {
    test("case mismatches are rejected", () => {
      expect(isBroadcastAudienceType("All")).toBe(false);
      expect(isBroadcastAudienceType("ALL")).toBe(false);
      expect(isBroadcastAudienceType("ROLE")).toBe(false);
      expect(isBroadcastAudienceType("Country")).toBe(false);
      expect(isBroadcastAudienceType("PLAN")).toBe(false);
    });

    test('whitespace boundaries are rejected ("all ", " all", tab/newline)', () => {
      expect(isBroadcastAudienceType("all ")).toBe(false);
      expect(isBroadcastAudienceType(" all")).toBe(false);
      expect(isBroadcastAudienceType("\tall")).toBe(false);
      expect(isBroadcastAudienceType("plan\n")).toBe(false);
      expect(isBroadcastAudienceType(" role ")).toBe(false);
    });

    test("empty string is rejected", () => {
      expect(isBroadcastAudienceType("")).toBe(false);
    });

    test("near-miss spellings are rejected", () => {
      expect(isBroadcastAudienceType("alls")).toBe(false);
      expect(isBroadcastAudienceType("roles")).toBe(false);
      expect(isBroadcastAudienceType("countrys")).toBe(false);
      expect(isBroadcastAudienceType("planned")).toBe(false);
      expect(isBroadcastAudienceType("all-users")).toBe(false);
      expect(isBroadcastAudienceType("audience_all")).toBe(false);
    });

    test("null, undefined, numbers and booleans are rejected", () => {
      expect(isBroadcastAudienceType(null)).toBe(false);
      expect(isBroadcastAudienceType(undefined)).toBe(false);
      expect(isBroadcastAudienceType(0)).toBe(false);
      expect(isBroadcastAudienceType(1)).toBe(false);
      expect(isBroadcastAudienceType(Number.NaN)).toBe(false);
      expect(isBroadcastAudienceType(true)).toBe(false);
    });

    test("objects (including member-bearing ones) are rejected", () => {
      expect(isBroadcastAudienceType({})).toBe(false);
      expect(isBroadcastAudienceType({ type: "all" })).toBe(false);
      expect(isBroadcastAudienceType({ type: BroadcastAudienceType.Plan })).toBe(false);
      expect(isBroadcastAudienceType(["all"])).toBe(false);
    });
  });

  // ---- Tier 3: Chaos/Fuzz ----
  describe("Tier 3 — chaos & fuzz", () => {
    test("random non-member strings are ALL rejected without throwing", () => {
      for (const candidate of fuzzStrings(200)) {
        expect(isBroadcastAudienceType(candidate)).toBe(false);
      }
    });

    test("long strings (10k chars) are rejected", () => {
      expect(isBroadcastAudienceType("x".repeat(10000))).toBe(false);
      expect(isBroadcastAudienceType(`${BroadcastAudienceType.All}${"@".repeat(9997)}`)).toBe(false);
      expect(isBroadcastAudienceType(`${"@".repeat(9996)}${BroadcastAudienceType.Plan}`)).toBe(false);
    });

    test("unicode / Arabic / RTL strings are rejected", () => {
      const unicodeInputs = [
        "إشعار",
        "جميع",
        "دولة",
        "\u200Fall",
        "all\u200F",
        "\u05D0\u05D1\u05D2",
        "pl\u0627n",
        "✅",
        "📢",
        "a\u0300ll",
      ];
      for (const input of unicodeInputs) {
        expect(isBroadcastAudienceType(input)).toBe(false);
      }
    });

    test("strings containing LIKE wildcards, underscores, backslashes and quotes are rejected", () => {
      const hostileInputs = [
        "%",
        "_",
        "\\",
        "'",
        "%\"%'\\_",
        "%all",
        "r%ole",
        "_plan",
        "country_",
        "a'll",
        "\\nall",
        "'; DROP TABLE notifications; --",
        '"plan"',
      ];
      for (const input of hostileInputs) {
        expect(isBroadcastAudienceType(input)).toBe(false);
      }
    });

    test("control characters embedded in member-like strings are rejected", () => {
      expect(isBroadcastAudienceType("a\x00ll")).toBe(false);
      expect(isBroadcastAudienceType("plan\r")).toBe(false);
      expect(isBroadcastAudienceType("\ufeffrole")).toBe(false);
    });

    test("null-prototype objects are rejected WITHOUT throwing", () => {
      const nullProto: unknown = Object.create(null);
      expect(() => isBroadcastAudienceType(nullProto)).not.toThrow();
      expect(isBroadcastAudienceType(nullProto)).toBe(false);

      const forgedNullProto: unknown = Object.assign(Object.create(null), { 0: "all", length: 3 });
      expect(() => isBroadcastAudienceType(forgedNullProto)).not.toThrow();
      expect(isBroadcastAudienceType(forgedNullProto)).toBe(false);
    });

    test("crafted __proto__-bearing payloads are rejected WITHOUT throwing", () => {
      // JSON-string-shaped attacker payload — "__proto__" lands as an own enumerable key.
      const protoPayload: Record<string, unknown> = { ["__proto__"]: { isAdmin: true }, type: "all" };
      expect(() => isBroadcastAudienceType(protoPayload)).not.toThrow();
      expect(isBroadcastAudienceType(protoPayload)).toBe(false);
      expect(Object.keys(protoPayload)).toContain("__proto__");

      const nestedProtoPayload: Record<string, unknown> = {
        audience: { ["__proto__"]: { polluted: true }, type: "role" },
      };
      expect(() => isBroadcastAudienceType(nestedProtoPayload)).not.toThrow();
      expect(isBroadcastAudienceType(nestedProtoPayload)).toBe(false);
    });
  });

  // ---- Tier 4: Security & Abuse ----
  describe("Tier 4 — security & abuse", () => {
    test("accepted string set is EXACTLY the four members — no accidental string-literal acceptance", () => {
      const candidates = new Set<string>([
        ...CANONICAL_VALUES,
        ...CANONICAL_VALUES.map(v => `${v}s`),
        ...CANONICAL_VALUES.map(v => `${v} `),
        ...CANONICAL_VALUES.map(v => ` ${v}`),
        ...CANONICAL_VALUES.map(v => `_${v}`),
        ...CANONICAL_VALUES.map(v => `${v}_`),
        ...CANONICAL_VALUES.map(v => `-${v}`),
        ...CANONICAL_VALUES.map(v => `${v}-`),
        ...CANONICAL_VALUES.map(v => v.toUpperCase()),
        ...CANONICAL_VALUES.map(v => `${v}\u0000`),
        ...fuzzStrings(500),
      ]);
      const accepted: string[] = [...candidates].filter(candidate => isBroadcastAudienceType(candidate));
      expect(accepted.toSorted(compareStrings)).toEqual([...CANONICAL_VALUES].toSorted(compareStrings));
    });

    test("object with toString override returning a member is rejected WITHOUT throwing", () => {
      const malicious: unknown = { toString: () => BroadcastAudienceType.All };
      expect(() => isBroadcastAudienceType(malicious)).not.toThrow();
      expect(isBroadcastAudienceType(malicious)).toBe(false);
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
      expect(() => isBroadcastAudienceType(explosive)).not.toThrow();
      expect(isBroadcastAudienceType(explosive)).toBe(false);
    });

    test("Symbol masquerading as a member name is rejected WITHOUT throwing", () => {
      const symbolInput = Symbol.for("all");
      expect(() => isBroadcastAudienceType(symbolInput)).not.toThrow();
      expect(isBroadcastAudienceType(symbolInput)).toBe(false);
    });

    test("arrays and functions are rejected WITHOUT throwing", () => {
      const arrayInput: unknown = [BroadcastAudienceType.Plan];
      const fnInput: unknown = memberReturningFunction;
      expect(() => isBroadcastAudienceType(arrayInput)).not.toThrow();
      expect(isBroadcastAudienceType(arrayInput)).toBe(false);
      expect(() => isBroadcastAudienceType(fnInput)).not.toThrow();
      expect(isBroadcastAudienceType(fnInput)).toBe(false);
    });
  });
});
