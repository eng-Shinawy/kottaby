/**
 * LinkStatus + isLinkStatus 4-Tier Test Suite (compact sibling of the
 * applicant-status guard suite).
 * Pure unit tier — NO DB, NO schema imports.
 * Tier 1: 100% branch/statement coverage of the guard.
 * Tier 2: Boundary cases — case mismatch, whitespace, empty, primitive types.
 * Tier 3: Chaos/fuzz — random strings, 10k payloads, unicode/RTL, wildcards.
 * Tier 4: Security — coercion overrides, prototype attacks; reject, never throw.
 */
import { describe, expect, test } from "bun:test";
import { isLinkStatus, LinkStatus } from "@/backend/enum/shared/link-status.enum";

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

/** Module-scope fixture used by the security tier (a function masquerading as a status value). */
function memberReturningFunction(): string {
  return LinkStatus.Pending;
}

describe("isLinkStatus", () => {
  // ---- Tier 1: Branch/Statement Coverage ----
  describe("Tier 1 — branch coverage", () => {
    test("canonical value set frozen exactly as declared", () => {
      expect((Object.values(LinkStatus) as string[]).join("|")).toBe("pending|confirmed|rejected|expired");
    });

    test("every enum member passes the guard (true branch)", () => {
      expect(isLinkStatus(LinkStatus.Pending)).toBe(true);
      expect(isLinkStatus(LinkStatus.Confirmed)).toBe(true);
      expect(isLinkStatus(LinkStatus.Rejected)).toBe(true);
      expect(isLinkStatus(LinkStatus.Expired)).toBe(true);
    });

    test("string that is not a member fails the membership check (false branch)", () => {
      expect(isLinkStatus("cancelled")).toBe(false);
      expect(isLinkStatus("linked")).toBe(false);
    });

    test("non-string input short-circuits on the typeof check (left-false branch)", () => {
      expect(isLinkStatus(undefined)).toBe(false);
      expect(isLinkStatus(0)).toBe(false);
    });

    test("true result narrows unknown to LinkStatus", () => {
      const value: unknown = "expired";
      if (!isLinkStatus(value)) {
        expect.unreachable("guard should accept the exact member string");
      }
      expect(value).toBe(LinkStatus.Expired);
    });
  });

  // ---- Tier 2: Boundary & Edge Cases ----
  describe("Tier 2 — boundary cases", () => {
    test("case mismatches are rejected", () => {
      expect(isLinkStatus("Pending")).toBe(false);
      expect(isLinkStatus("PENDING")).toBe(false);
      expect(isLinkStatus("Confirmed")).toBe(false);
      expect(isLinkStatus("CONFIRMED")).toBe(false);
      expect(isLinkStatus("Rejected")).toBe(false);
      expect(isLinkStatus("Expired")).toBe(false);
    });

    test('whitespace boundaries are rejected ("pending ", " pending", tab/newline)', () => {
      expect(isLinkStatus("pending ")).toBe(false);
      expect(isLinkStatus(" pending")).toBe(false);
      expect(isLinkStatus("\tpending")).toBe(false);
      expect(isLinkStatus("pending\n")).toBe(false);
      expect(isLinkStatus(" pending ")).toBe(false);
    });

    test("empty string is rejected", () => {
      expect(isLinkStatus("")).toBe(false);
    });

    test("near-miss spellings are rejected", () => {
      expect(isLinkStatus("confirm")).toBe(false);
      expect(isLinkStatus("expire")).toBe(false);
      expect(isLinkStatus("expiredd")).toBe(false);
      expect(isLinkStatus("reject")).toBe(false);
      expect(isLinkStatus("pend")).toBe(false);
    });

    test("primitive non-strings are rejected", () => {
      expect(isLinkStatus(0)).toBe(false);
      expect(isLinkStatus(Number.NaN)).toBe(false);
      expect(isLinkStatus(true)).toBe(false);
      expect(isLinkStatus(undefined)).toBe(false);
      expect(isLinkStatus(null)).toBe(false);
    });
  });

  // ---- Tier 3: Chaos/Fuzz ----
  describe("Tier 3 — chaos & fuzz", () => {
    test("random non-member strings are ALL rejected without throwing", () => {
      for (const candidate of fuzzStrings(200)) {
        expect(isLinkStatus(candidate)).toBe(false);
      }
    });

    test("long strings (10k chars) are rejected", () => {
      expect(isLinkStatus("x".repeat(10000))).toBe(false);
      expect(isLinkStatus(`${LinkStatus.Pending}${"@".repeat(9992)}`)).toBe(false);
      expect(isLinkStatus(`${"@".repeat(9992)}${LinkStatus.Expired}`)).toBe(false);
    });

    test("unicode / Arabic / RTL strings are rejected", () => {
      const unicodeInputs = [
        "القرآن",
        "الحالة",
        "مؤكد",
        "\u200Fpending",
        "pending\u200F",
        "\u05D0\u05D1\u05D2",
        "pendi\u0300ng",
        "✅",
        "🄿🄰🅂🅂",
        "confirmed️",
      ];
      for (const input of unicodeInputs) {
        expect(isLinkStatus(input)).toBe(false);
      }
    });

    test("strings containing LIKE wildcards, underscores, backslashes and quotes are rejected", () => {
      const hostileInputs = [
        "%",
        "_",
        "\\",
        "'",
        "%\"%'\\_",
        "%pending",
        "pend%ing",
        "_pending",
        "pending_",
        "rejected_",
        "c'_onfirmed",
        "\\npending",
        "'; DROP TABLE parent_link_requests; --",
        '"pending"',
      ];
      for (const input of hostileInputs) {
        expect(isLinkStatus(input)).toBe(false);
      }
    });

    test("control characters embedded in member-like strings are rejected", () => {
      expect(isLinkStatus("pend\x00ing")).toBe(false);
      expect(isLinkStatus("confirmed\r")).toBe(false);
      expect(isLinkStatus("\ufeffexpired")).toBe(false);
    });
  });

  // ---- Tier 4: Security & Abuse ----
  describe("Tier 4 — security & abuse", () => {
    test("object with toString override returning a member is rejected WITHOUT throwing", () => {
      const malicious: unknown = { toString: () => LinkStatus.Pending };
      expect(() => isLinkStatus(malicious)).not.toThrow();
      expect(isLinkStatus(malicious)).toBe(false);
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
      expect(() => isLinkStatus(explosive)).not.toThrow();
      expect(isLinkStatus(explosive)).toBe(false);
    });

    test("Object.create(null) input is rejected WITHOUT throwing", () => {
      const nullProto: unknown = Object.create(null);
      expect(() => isLinkStatus(nullProto)).not.toThrow();
      expect(isLinkStatus(nullProto)).toBe(false);

      const forgedNullProto: unknown = Object.assign(Object.create(null), { 0: "confirmed", length: 9 });
      expect(() => isLinkStatus(forgedNullProto)).not.toThrow();
      expect(isLinkStatus(forgedNullProto)).toBe(false);
    });

    test("crafted __proto__-bearing payload is rejected WITHOUT throwing", () => {
      // JSON-string-shaped attacker payload — "__proto__" lands as an own enumerable key.
      const protoPayload: Record<string, unknown> = { ["__proto__"]: { isAdmin: true }, status: "confirmed" };
      expect(() => isLinkStatus(protoPayload)).not.toThrow();
      expect(isLinkStatus(protoPayload)).toBe(false);
      expect(Object.keys(protoPayload)).toContain("__proto__");
    });

    test("Symbol masquerading as a member name is rejected WITHOUT throwing", () => {
      const symbolInput = Symbol.for("pending");
      expect(() => isLinkStatus(symbolInput)).not.toThrow();
      expect(isLinkStatus(symbolInput)).toBe(false);
    });

    test("arrays and functions are rejected WITHOUT throwing", () => {
      const arrayInput: unknown = [LinkStatus.Pending];
      const fnInput: unknown = memberReturningFunction;
      expect(() => isLinkStatus(arrayInput)).not.toThrow();
      expect(isLinkStatus(arrayInput)).toBe(false);
      expect(() => isLinkStatus(fnInput)).not.toThrow();
      expect(isLinkStatus(fnInput)).toBe(false);
    });
  });
});
