/**
 * NotificationType + isNotificationType test suite.
 * Parity tier — pins the TS mirror byte-identical to the `notification_type`
 *   pgEnum registry entry: same 7 members, same order.
 * Tier 1: 100% branch/statement coverage of the guard.
 * Tier 2: Boundary cases — case mismatch, whitespace, empty, primitives, objects.
 * Tier 3: Chaos/fuzz — random strings, 10k payloads, unicode/RTL, wildcards.
 * Tier 4: Security — coercion overrides, prototype attacks; reject, never throw.
 * Unit tier — the schema import pulls the pgEnum definition only (no DB
 * client, no connection); every guard test is pure.
 */
import { describe, expect, test } from "bun:test";
import { notificationType } from "@/backend/db/schema/enums";
import { isNotificationType, NotificationType } from "@/backend/enum/notifications/notification-type.enum";

/** Canonical member order — the single hardcoded ground truth every parity assertion derives from. */
const CANONICAL_VALUES = [
  "session_request",
  "session_completion",
  "session_cancellation",
  "parent_link_request",
  "system_broadcast",
  "payment_confirmation",
  "evaluation_result",
] as const;

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

/** Module-scope fixture used by the security tier (a function masquerading as a type value). */
function memberReturningFunction(): string {
  return NotificationType.SessionRequest;
}

describe("notificationType pgEnum ↔ NotificationType mirror parity", () => {
  test("pgEnum enumValues is exactly the 7 canonical values, in order", () => {
    expect([...notificationType.enumValues]).toEqual([...CANONICAL_VALUES]);
  });

  test("TS mirror Object.values is exactly the 7 canonical values, in order", () => {
    expect(Object.values(NotificationType).join("|")).toBe(CANONICAL_VALUES.join("|"));
  });

  test("pgEnum and TS mirror are byte-identical (7 members each, order-sensitive)", () => {
    expect(notificationType.enumValues).toHaveLength(7);
    expect(Object.values(NotificationType)).toHaveLength(7);
    expect([...notificationType.enumValues].join("|")).toBe(Object.values(NotificationType).join("|"));
    expect([...notificationType.enumValues]).toEqual(Object.values(NotificationType));
  });
});

describe("isNotificationType", () => {
  // ---- Tier 1: Branch/Statement Coverage ----
  describe("Tier 1 — branch coverage", () => {
    test("canonical value set frozen exactly as declared", () => {
      expect((Object.values(NotificationType) as string[]).join("|")).toBe(CANONICAL_VALUES.join("|"));
    });

    test("every enum member passes the guard (true branch)", () => {
      expect(isNotificationType(NotificationType.SessionRequest)).toBe(true);
      expect(isNotificationType(NotificationType.SessionCompletion)).toBe(true);
      expect(isNotificationType(NotificationType.SessionCancellation)).toBe(true);
      expect(isNotificationType(NotificationType.ParentLinkRequest)).toBe(true);
      expect(isNotificationType(NotificationType.SystemBroadcast)).toBe(true);
      expect(isNotificationType(NotificationType.PaymentConfirmation)).toBe(true);
      expect(isNotificationType(NotificationType.EvaluationResult)).toBe(true);
    });

    test("string that is not a member fails the membership check (false branch)", () => {
      expect(isNotificationType("session_rescheduled")).toBe(false);
      expect(isNotificationType("notification")).toBe(false);
    });

    test("non-string input short-circuits on the typeof check (left-false branch)", () => {
      expect(isNotificationType(undefined)).toBe(false);
      expect(isNotificationType(0)).toBe(false);
    });

    test("true result narrows unknown to NotificationType", () => {
      const value: unknown = "session_request";
      if (!isNotificationType(value)) {
        expect.unreachable("guard should accept the exact member string");
      }
      expect(value).toBe(NotificationType.SessionRequest);
    });
  });

  // ---- Tier 2: Boundary & Edge Cases ----
  describe("Tier 2 — boundary cases", () => {
    test("case mismatches are rejected", () => {
      expect(isNotificationType("Session_Request")).toBe(false);
      expect(isNotificationType("SESSION_REQUEST")).toBe(false);
      expect(isNotificationType("sessionRequest")).toBe(false);
      expect(isNotificationType("SessionRequest")).toBe(false);
      expect(isNotificationType("Parent_Link_Request")).toBe(false);
      expect(isNotificationType("SYSTEM_BROADCAST")).toBe(false);
    });

    test('whitespace boundaries are rejected ("session_request ", " session_request", tab/newline)', () => {
      expect(isNotificationType("session_request ")).toBe(false);
      expect(isNotificationType(" session_request")).toBe(false);
      expect(isNotificationType("\tsession_request")).toBe(false);
      expect(isNotificationType("session_request\n")).toBe(false);
      expect(isNotificationType(" session_request ")).toBe(false);
    });

    test("empty string is rejected", () => {
      expect(isNotificationType("")).toBe(false);
    });

    test("near-miss spellings are rejected", () => {
      expect(isNotificationType("session request")).toBe(false);
      expect(isNotificationType("session-request")).toBe(false);
      expect(isNotificationType("session_requests")).toBe(false);
      expect(isNotificationType("payment_confirmations")).toBe(false);
      expect(isNotificationType("broadcast")).toBe(false);
      expect(isNotificationType("evaluation")).toBe(false);
    });

    test("null, undefined, numbers and booleans are rejected", () => {
      expect(isNotificationType(null)).toBe(false);
      expect(isNotificationType(undefined)).toBe(false);
      expect(isNotificationType(0)).toBe(false);
      expect(isNotificationType(7)).toBe(false);
      expect(isNotificationType(Number.NaN)).toBe(false);
      expect(isNotificationType(true)).toBe(false);
    });

    test("objects (including member-bearing ones) are rejected", () => {
      expect(isNotificationType({})).toBe(false);
      expect(isNotificationType({ type: "session_request" })).toBe(false);
      expect(isNotificationType(["session_request"])).toBe(false);
    });
  });

  // ---- Tier 3: Chaos/Fuzz ----
  describe("Tier 3 — chaos & fuzz", () => {
    test("random non-member strings are ALL rejected without throwing", () => {
      for (const candidate of fuzzStrings(200)) {
        expect(isNotificationType(candidate)).toBe(false);
      }
    });

    test("long strings (10k chars) are rejected", () => {
      expect(isNotificationType("x".repeat(10000))).toBe(false);
      expect(isNotificationType(`${NotificationType.SessionRequest}${"@".repeat(9985)}`)).toBe(false);
      expect(isNotificationType(`${"@".repeat(9985)}${NotificationType.EvaluationResult}`)).toBe(false);
    });

    test("unicode / Arabic / RTL strings are rejected", () => {
      const unicodeInputs = [
        "إشعار",
        "جلسة",
        "طلب",
        "\u200Fsession_request",
        "session_request\u200F",
        "\u05D0\u05D1\u05D2",
        "session\u0645request",
        "✅",
        "🔔",
        "session_requ\u0300st",
      ];
      for (const input of unicodeInputs) {
        expect(isNotificationType(input)).toBe(false);
      }
    });

    test("strings containing LIKE wildcards, underscores, backslashes and quotes are rejected", () => {
      const hostileInputs = [
        "%",
        "_",
        "\\",
        "'",
        "%\"%'\\_",
        "%session_request",
        "session_req%uest",
        "_session_request",
        "session_request_",
        "system_broadcast_",
        "s'ession_request",
        "\\nsession_request",
        "'; DROP TABLE notifications; --",
        '"session_request"',
      ];
      for (const input of hostileInputs) {
        expect(isNotificationType(input)).toBe(false);
      }
    });

    test("control characters embedded in member-like strings are rejected", () => {
      expect(isNotificationType("session_req\x00uest")).toBe(false);
      expect(isNotificationType("system_broadcast\r")).toBe(false);
      expect(isNotificationType("\ufeffpayment_confirmation")).toBe(false);
    });
  });

  // ---- Tier 4: Security & Abuse ----
  describe("Tier 4 — security & abuse", () => {
    test("object with toString override returning a member is rejected WITHOUT throwing", () => {
      const malicious: unknown = { toString: () => NotificationType.SessionRequest };
      expect(() => isNotificationType(malicious)).not.toThrow();
      expect(isNotificationType(malicious)).toBe(false);
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
      expect(() => isNotificationType(explosive)).not.toThrow();
      expect(isNotificationType(explosive)).toBe(false);
    });

    test("Object.create(null) input is rejected WITHOUT throwing", () => {
      const nullProto: unknown = Object.create(null);
      expect(() => isNotificationType(nullProto)).not.toThrow();
      expect(isNotificationType(nullProto)).toBe(false);

      const forgedNullProto: unknown = Object.assign(Object.create(null), { 0: "session_request", length: 15 });
      expect(() => isNotificationType(forgedNullProto)).not.toThrow();
      expect(isNotificationType(forgedNullProto)).toBe(false);
    });

    test("crafted __proto__-bearing payload is rejected WITHOUT throwing", () => {
      // JSON-string-shaped attacker payload — "__proto__" lands as an own enumerable key.
      const protoPayload: Record<string, unknown> = { ["__proto__"]: { isAdmin: true }, type: "session_request" };
      expect(() => isNotificationType(protoPayload)).not.toThrow();
      expect(isNotificationType(protoPayload)).toBe(false);
      expect(Object.keys(protoPayload)).toContain("__proto__");
    });

    test("Symbol masquerading as a member name is rejected WITHOUT throwing", () => {
      const symbolInput = Symbol.for("session_request");
      expect(() => isNotificationType(symbolInput)).not.toThrow();
      expect(isNotificationType(symbolInput)).toBe(false);
    });

    test("arrays and functions are rejected WITHOUT throwing", () => {
      const arrayInput: unknown = [NotificationType.SessionRequest];
      const fnInput: unknown = memberReturningFunction;
      expect(() => isNotificationType(arrayInput)).not.toThrow();
      expect(isNotificationType(arrayInput)).toBe(false);
      expect(() => isNotificationType(fnInput)).not.toThrow();
      expect(isNotificationType(fnInput)).toBe(false);
    });
  });
});
