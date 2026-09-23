/**
 * BroadcastStatus + isBroadcastStatus test suite.
 * Tier 1: Member values — the canonical two-state one-way lifecycle.
 * Tier 2: Boundary cases — case mismatch, whitespace, empty, primitives, objects.
 * Tier 3: Chaos/fuzz — random strings, 10k payloads, unicode/RTL,
 *   null-prototype objects, `__proto__`-bearing payloads.
 * Tier 4: Security — the guard's accepted string set is exactly the two
 *   members (no accidental string-literal acceptance), coercion overrides
 *   are ignored, and rejection never throws.
 * Unit tier — pure enum/guard tests: no DB client, no connection, no I/O.
 */
import { describe, expect, test } from "bun:test";
import { BroadcastStatus, isBroadcastStatus } from "@/backend/enum/notifications/broadcast-status.enum";

/** Canonical member order — the single hardcoded ground truth every membership assertion derives from. */
const CANONICAL_VALUES = ["active", "stopped"] as const;

/** Deterministic ascending string comparator so accepted-set assertions order identically on every run. */
function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** Deterministic LCG-backed fuzz generator (same output on every run). */
function fuzzStrings(count: number): string[] {
  let seed = 48271;
  const next = (): number => {
    seed = (seed * 69069 + 12345) % 2147483647;
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

/** Module-scope fixture used by the security tier (a function masquerading as a status value). */
function memberReturningFunction(): string {
  return BroadcastStatus.Stopped;
}

describe("BroadcastStatus member values", () => {
  test("enum has exactly the two canonical members, in declared order", () => {
    expect(Object.values(BroadcastStatus).join("|")).toBe(CANONICAL_VALUES.join("|"));
    expect(Object.values(BroadcastStatus)).toHaveLength(2);
  });

  test("every member maps to its exact wire string", () => {
    const active: string = BroadcastStatus.Active;
    const stopped: string = BroadcastStatus.Stopped;
    expect(active).toBe("active");
    expect(stopped).toBe("stopped");
  });
});

describe("isBroadcastStatus", () => {
  // ---- Tier 1: Member Values ----
  describe("Tier 1 — member values", () => {
    test("every enum member passes the guard (true branch)", () => {
      expect(isBroadcastStatus(BroadcastStatus.Active)).toBe(true);
      expect(isBroadcastStatus(BroadcastStatus.Stopped)).toBe(true);
    });

    test("exact member strings pass the guard", () => {
      for (const value of CANONICAL_VALUES) {
        expect(isBroadcastStatus(value)).toBe(true);
      }
    });

    test("string that is not a member fails the membership check (false branch)", () => {
      expect(isBroadcastStatus("running")).toBe(false);
      expect(isBroadcastStatus("archived")).toBe(false);
    });

    test("non-string input short-circuits on the typeof check (left-false branch)", () => {
      expect(isBroadcastStatus(undefined)).toBe(false);
      expect(isBroadcastStatus(0)).toBe(false);
    });

    test("true result narrows unknown to BroadcastStatus", () => {
      const value: unknown = "stopped";
      if (!isBroadcastStatus(value)) {
        expect.unreachable("guard should accept the exact member string");
      }
      expect(value).toBe(BroadcastStatus.Stopped);
    });
  });

  // ---- Tier 2: Boundary & Edge Cases ----
  describe("Tier 2 — boundary cases", () => {
    test("case mismatches are rejected", () => {
      expect(isBroadcastStatus("Active")).toBe(false);
      expect(isBroadcastStatus("ACTIVE")).toBe(false);
      expect(isBroadcastStatus("Stopped")).toBe(false);
      expect(isBroadcastStatus("STOPPED")).toBe(false);
    });

    test('whitespace boundaries are rejected ("active ", " active", tab/newline)', () => {
      expect(isBroadcastStatus("active ")).toBe(false);
      expect(isBroadcastStatus(" active")).toBe(false);
      expect(isBroadcastStatus("\tactive")).toBe(false);
      expect(isBroadcastStatus("stopped\n")).toBe(false);
      expect(isBroadcastStatus(" active ")).toBe(false);
    });

    test("empty string is rejected", () => {
      expect(isBroadcastStatus("")).toBe(false);
    });

    test("near-miss spellings are rejected", () => {
      expect(isBroadcastStatus("actives")).toBe(false);
      expect(isBroadcastStatus("stoppedd")).toBe(false);
      expect(isBroadcastStatus("stop")).toBe(false);
      expect(isBroadcastStatus("stopt")).toBe(false);
      expect(isBroadcastStatus("active-stopped")).toBe(false);
      expect(isBroadcastStatus("status_active")).toBe(false);
    });

    test("null, undefined, numbers and booleans are rejected", () => {
      expect(isBroadcastStatus(null)).toBe(false);
      expect(isBroadcastStatus(undefined)).toBe(false);
      expect(isBroadcastStatus(0)).toBe(false);
      expect(isBroadcastStatus(1)).toBe(false);
      expect(isBroadcastStatus(Number.NaN)).toBe(false);
      expect(isBroadcastStatus(true)).toBe(false);
    });

    test("objects (including member-bearing ones) are rejected", () => {
      expect(isBroadcastStatus({})).toBe(false);
      expect(isBroadcastStatus({ status: "active" })).toBe(false);
      expect(isBroadcastStatus({ status: BroadcastStatus.Stopped })).toBe(false);
      expect(isBroadcastStatus(["active"])).toBe(false);
    });
  });

  // ---- Tier 3: Chaos/Fuzz ----
  describe("Tier 3 — chaos & fuzz", () => {
    test("random non-member strings are ALL rejected without throwing", () => {
      for (const candidate of fuzzStrings(200)) {
        expect(isBroadcastStatus(candidate)).toBe(false);
      }
    });

    test("long strings (10k chars) are rejected", () => {
      expect(isBroadcastStatus("x".repeat(10000))).toBe(false);
      expect(isBroadcastStatus(`${BroadcastStatus.Active}${"@".repeat(9994)}`)).toBe(false);
      expect(isBroadcastStatus(`${"@".repeat(9993)}${BroadcastStatus.Stopped}`)).toBe(false);
    });

    test("unicode / Arabic / RTL strings are rejected", () => {
      const unicodeInputs = [
        "نشط",
        "متوقف",
        "حالة",
        "\u200Factive",
        "active\u200F",
        "\u05D0\u05D1\u05D2",
        "st\u0648pped",
        "✅",
        "📢",
        "a\u0300ctive",
      ];
      for (const input of unicodeInputs) {
        expect(isBroadcastStatus(input)).toBe(false);
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
        "a%ctive",
        "_stopped",
        "stopped_",
        "a'ctive",
        "\\nactive",
        "'; DROP TABLE notifications; --",
        '"stopped"',
      ];
      for (const input of hostileInputs) {
        expect(isBroadcastStatus(input)).toBe(false);
      }
    });

    test("control characters embedded in member-like strings are rejected", () => {
      expect(isBroadcastStatus("a\x00ctive")).toBe(false);
      expect(isBroadcastStatus("stopped\r")).toBe(false);
      expect(isBroadcastStatus("\ufeffactive")).toBe(false);
    });

    test("null-prototype objects are rejected WITHOUT throwing", () => {
      const nullProto: unknown = Object.create(null);
      expect(() => isBroadcastStatus(nullProto)).not.toThrow();
      expect(isBroadcastStatus(nullProto)).toBe(false);

      const forgedNullProto: unknown = Object.assign(Object.create(null), { 0: "active", length: 3 });
      expect(() => isBroadcastStatus(forgedNullProto)).not.toThrow();
      expect(isBroadcastStatus(forgedNullProto)).toBe(false);
    });

    test("crafted __proto__-bearing payloads are rejected WITHOUT throwing", () => {
      // JSON-string-shaped attacker payload — "__proto__" lands as an own enumerable key.
      const protoPayload: Record<string, unknown> = { ["__proto__"]: { isAdmin: true }, status: "active" };
      expect(() => isBroadcastStatus(protoPayload)).not.toThrow();
      expect(isBroadcastStatus(protoPayload)).toBe(false);
      expect(Object.keys(protoPayload)).toContain("__proto__");

      const nestedProtoPayload: Record<string, unknown> = {
        lifecycle: { ["__proto__"]: { polluted: true }, status: "stopped" },
      };
      expect(() => isBroadcastStatus(nestedProtoPayload)).not.toThrow();
      expect(isBroadcastStatus(nestedProtoPayload)).toBe(false);
    });
  });

  // ---- Tier 4: Security & Abuse ----
  describe("Tier 4 — security & abuse", () => {
    test("accepted string set is EXACTLY the two members — no accidental string-literal acceptance", () => {
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
      const accepted: string[] = [...candidates].filter(candidate => isBroadcastStatus(candidate));
      expect(accepted.toSorted(compareStrings)).toEqual([...CANONICAL_VALUES].toSorted(compareStrings));
    });

    test("object with toString override returning a member is rejected WITHOUT throwing", () => {
      const malicious: unknown = { toString: () => BroadcastStatus.Active };
      expect(() => isBroadcastStatus(malicious)).not.toThrow();
      expect(isBroadcastStatus(malicious)).toBe(false);
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
      expect(() => isBroadcastStatus(explosive)).not.toThrow();
      expect(isBroadcastStatus(explosive)).toBe(false);
    });

    test("Symbol masquerading as a member name is rejected WITHOUT throwing", () => {
      const symbolInput = Symbol.for("active");
      expect(() => isBroadcastStatus(symbolInput)).not.toThrow();
      expect(isBroadcastStatus(symbolInput)).toBe(false);
    });

    test("arrays and functions are rejected WITHOUT throwing", () => {
      const arrayInput: unknown = [BroadcastStatus.Stopped];
      const fnInput: unknown = memberReturningFunction;
      expect(() => isBroadcastStatus(arrayInput)).not.toThrow();
      expect(isBroadcastStatus(arrayInput)).toBe(false);
      expect(() => isBroadcastStatus(fnInput)).not.toThrow();
      expect(isBroadcastStatus(fnInput)).toBe(false);
    });
  });
});
