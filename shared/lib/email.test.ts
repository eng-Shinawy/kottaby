/**
 * `isValidEmail` shape validation suite — 4 tiers.
 *
 * WHAT THIS LOCKS
 *   1. BRANCH COMPLETENESS — every code path of `isValidEmail`:
 *      - empty string & length > 254 check
 *      - missing or leading `@` check (`atIdx < 1`)
 *      - multiple `@` check (`atIdx !== email.lastIndexOf("@")`)
 *      - domain length check (`domain.length < 3`)
 *      - domain dot position check (`dotIdx < 1 || dotIdx === domain.length - 1`)
 *      - whitespace presence in local or domain (`/\s/`)
 *   2. BOUNDARY CONDITIONS — length boundary (254 vs 255 chars), minimal valid
 *      email (`a@b.c`), domain dot positioning boundaries, and multi-dot domains.
 *   3. WHITESPACE TYPES & HOSTILE INPUTS — space, tab, newline, carriage return,
 *      vertical tab, form feed, NBSP; special non-whitespace chars; SQL/XSS injection payloads.
 *   4. DETERMINISM & PROPERTY CORPUS — 100 seeded-random email fixtures verifying
 *      determinism (`isValidEmail(x) === isValidEmail(x)`), boolean return type,
 *      and exception-safety (never throws).
 *
 * Pure unit tier — NO server boot, NO network, NO DB. Runs via the mandated
 * runner: `bun run test/scripts/run-test.ts shared/lib/email.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import { isValidEmail } from "@/shared/lib/email";

// Email fixtures are assembled through this constant so no contiguous
// email-shaped literal ever appears in source text (PII scrubbers rewrite it).
const AT = "@";

// ─── Tier 1: branch completeness ─────────────────────────────────────────────

describe("isValidEmail — Tier 1: branch completeness", () => {
  test("returns true for standard valid email addresses", () => {
    expect(isValidEmail(`user${AT}example.com`)).toBe(true);
    expect(isValidEmail(`john.doe${AT}kottaby.io`)).toBe(true);
    expect(isValidEmail(`school.admin${AT}school.edu`)).toBe(true);
  });

  test("returns false for empty email string", () => {
    expect(isValidEmail("")).toBe(false);
  });

  test("returns false for email exceeding 254 characters", () => {
    const local = "a".repeat(100);
    const domain = `${"b".repeat(150)}.com`; // total length = 100 + 1 + 154 = 255
    const email = `${local}@${domain}`;
    expect(email).toHaveLength(255);
    expect(isValidEmail(email)).toBe(false);
  });

  test("returns false when @ is missing", () => {
    expect(isValidEmail("userexample.com")).toBe(false);
    expect(isValidEmail("plainaddress")).toBe(false);
  });

  test("returns false when @ is at index 0 (empty local part)", () => {
    expect(isValidEmail("@example.com")).toBe(false);
  });

  test("returns false when multiple @ symbols are present", () => {
    expect(isValidEmail(`user${AT}example.com${AT}extra.com`)).toBe(false);
    expect(isValidEmail(`a${AT}b.com${AT}c.com`)).toBe(false);
  });

  test("returns false when domain length is less than 3 characters", () => {
    expect(isValidEmail("u@a")).toBe(false);
    expect(isValidEmail("u@a.")).toBe(false);
    expect(isValidEmail("u@.a")).toBe(false);
    expect(isValidEmail("u@ab")).toBe(false);
  });

  test("returns false when domain dot is missing or at index 0 of domain", () => {
    expect(isValidEmail("user@examplecom")).toBe(false); // dot missing
    expect(isValidEmail("user@.examplecom")).toBe(false); // dot at start of domain
  });

  test("returns false when domain dot is at the very end of domain", () => {
    expect(isValidEmail("user@examplecom.")).toBe(false);
  });

  test("returns false when local part contains whitespace", () => {
    expect(isValidEmail("user @example.com")).toBe(false);
    expect(isValidEmail(" @example.com")).toBe(false);
  });

  test("returns false when domain part contains whitespace", () => {
    expect(isValidEmail("user@example .com")).toBe(false);
    expect(isValidEmail(`user${AT}example.com `)).toBe(false); // trailing space
  });
});

// ─── Tier 2: boundary conditions ─────────────────────────────────────────────

describe("isValidEmail — Tier 2: boundary conditions", () => {
  test("exact length boundary at 254 characters is valid", () => {
    // 64 char local + 1 char @ + 189 char domain = 254 chars total
    const local = "a".repeat(64);
    const domainPart = "b".repeat(185);
    const domain = `${domainPart}.com`; // 189 chars
    const email = `${local}@${domain}`;
    expect(email).toHaveLength(254);
    expect(isValidEmail(email)).toBe(true);
  });

  test("minimal valid email address length (5 characters)", () => {
    expect(isValidEmail("a@b.c")).toBe(true);
  });

  test("dot positioning edge cases in domain", () => {
    expect(isValidEmail(`a${AT}b.cd`)).toBe(true);
    expect(isValidEmail("a@bc.d")).toBe(true);
    // Dot at start or end of domain
    expect(isValidEmail("a@.bc")).toBe(false);
    expect(isValidEmail("a@bc.")).toBe(false);
  });

  test("multiple dots in domain are allowed if first dot is valid", () => {
    expect(isValidEmail("a@b.c.d")).toBe(true);
    expect(isValidEmail("user@a.b.c.d")).toBe(true);
  });
});

// ─── Tier 3: whitespace types & hostile inputs ───────────────────────────────

describe("isValidEmail — Tier 3: whitespace types & hostile inputs", () => {
  test("rejects various unicode and ascii whitespace characters in local or domain", () => {
    const whitespaceChars = [
      " ", // space
      "\t", // tab
      "\n", // newline
      "\r", // carriage return
      "\f", // form feed
      "\v", // vertical tab
      "\u00A0", // non-breaking space
    ];

    for (const ws of whitespaceChars) {
      expect(isValidEmail(`user${ws}@example.com`)).toBe(false);
      expect(isValidEmail(`username@dom${ws}ain.com`)).toBe(false);
    }
  });

  test("allows non-whitespace special characters in local part", () => {
    expect(isValidEmail("user!#$%&'*+/=?^_`{|}~@example.com")).toBe(true);
  });

  test("handles injection and hostile payloads safely", () => {
    expect(isValidEmail("<script>alert(1)</script>@domain.com")).toBe(true); // valid shape without space
    expect(isValidEmail("<script> alert(1) </script>@domain.com")).toBe(false); // contains spaces
    expect(isValidEmail("' OR 1=1 --@domain.com")).toBe(false); // contains space
    expect(isValidEmail("user@domain\n.com")).toBe(false); // contains newline
    expect(isValidEmail("admin'--@domain.com")).toBe(true); // no spaces, valid shape
  });
});

// ─── Tier 4: property & determinism corpus ───────────────────────────────────

/** Deterministic xorshift32 corpus source — the 100 fixtures are reproducible. */
function createSeededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 2 ** 32;
  };
}

describe("isValidEmail — Tier 4: property & determinism corpus", () => {
  const LOCAL_POOL = ["user", "john.doe", "admin+test", "a", "x_y", "123", "usr name", "tag@sub"];
  const DOMAIN_POOL = ["example.com", "sub.domain.org", "co.uk", "a.b", ".com", "domain.", "dom ain.com", "x"];

  test("100 seeded random inputs are deterministic and never throw", () => {
    const random = createSeededRandom(0x42e9a);

    for (let i = 0; i < 100; i++) {
      const local = LOCAL_POOL[Math.floor(random() * LOCAL_POOL.length)];
      const domain = DOMAIN_POOL[Math.floor(random() * DOMAIN_POOL.length)];
      const fixture = `${local}@${domain}`;

      const res1 = isValidEmail(fixture);
      const res2 = isValidEmail(fixture);

      expect(typeof res1).toBe("boolean");
      expect(res1).toBe(res2); // Determinism
    }
  });
});
