/**
 * Handshake-code format constants — 4-tier guard verification.
 *
 * WHAT THIS LOCKS
 *   1. TIER 1 (branch coverage) — EVERY branch of `isHandshakeCode`: the
 *      `typeof` branch (all non-string kinds: object/array/undefined/null/
 *      number/bigint/boolean/symbol/function/Date), the string-but-miss
 *      branch (empty string, near-miss strings), and the accept branch
 *      (valid canonical codes). Plus the canonical-constants contract: the
 *      prefix is exactly `KSB-`, the pattern is the anchored, bounded,
 *      flagless shape `^KSB-[0-9A-F]{8}$`, and the prefix constant composes
 *      with 8 hex chars into a pattern-accepted code.
 *   2. TIER 2 (boundaries) — hex-tail length 7/8/9, prefix variants
 *      (`KSB…` without the dash, bare `KSB-` with an empty tail, missing
 *      prefix, trailing dash), lowercase hex rejected raw, and
 *      leading/trailing whitespace failing PRE-normalization but passing
 *      POST-normalization (internal whitespace stays rejected).
 *   3. TIER 3 (hostile fuzz, fail closed) — LIKE wildcards (`%`/`_`),
 *      backslashes, SQL comment markers, unicode/RTL bidi-override and
 *      zero-width injections, emoji (incl. ZWJ sequences), NUL bytes, and
 *      multi-KB payloads: rejected BOTH raw and after normalization, so no
 *      payload smuggles a second string past the guard.
 *   4. TIER 4 (normalization algebra) — `normalize` is idempotent across
 *      the whole corpus plus a seeded 200-case fuzz sweep, is a pure
 *      deterministic function (same input → same output, no hidden state),
 *      and lowercase/whitespace variants of VALID codes normalize INTO
 *      acceptance while near-miss variants normalize OUT.
 *
 * Barrel pinning: the `@/shared/constants` barrel re-exports all four
 * symbols by identity.
 *
 * Pure unit tier — NO server boot, NO network, NO DB. Runs via the mandated
 * runner: `bun run test/scripts/run-test.ts shared/constants/handshake-code.constants.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import * as constantsBarrel from "@/shared/constants";
import {
  HANDSHAKE_CODE_PATTERN,
  HANDSHAKE_CODE_PREFIX,
  isHandshakeCode,
  normalizeHandshakeCode,
} from "@/shared/constants/handshake-code.constants";

// ─── Shared fixtures ─────────────────────────────────────────────────────────

const VALID_CODES = [
  "KSB-ABCD1234",
  "KSB-01234567",
  "KSB-89ABCDEF",
  "KSB-FEDCBA98",
  "KSB-00000000",
  "KSB-FFFFFFFF",
] as const;

/** Near-miss and hostile string corpus reused by the idempotence sweep. */
const STRING_CORPUS: readonly string[] = [
  ...VALID_CODES,
  "ksb-abcd1234",
  "Ksb-AbCd1234",
  "",
  "   ",
  "\t\n KSB-ABCD1234 \r\n",
  "KSB-",
  "KSB-ABCDEF1",
  "KSB-ABCD12345",
  "KSBABCD1234",
  "ABCD1234",
  "KSB-ABCD1234-",
  "KSB-ABCD 1234",
  "%KSB-ABCD1234",
  "KSB-ABCD1234%",
  "KSB-ABCD12%4",
  "KSB_ABCD1234",
  "KSB-AB_D1234",
  "_KSB-ABCD1234",
  "\\KSB-ABCD1234",
  "KSB-ABCD12\\4",
  "KSB-ABCD1234--",
  "\u202Eksb-abcd1234",
  "\u2066KSB-ABCD1234\u2069",
  "كود-12345678",
  "كود-أبجد",
  "KSB-😀12345",
  "KSB-👨‍👩‍👦12345",
  "KSB-ABCD1234\u0000",
  "\u0000KSB-ABCD1234",
  "KSB-ABCD12\u000034",
  "KSB-ABCD12\u200D34",
  "KSB-ABCD12\u200B34",
  `KSB-${"A".repeat(5000)}`,
  "%".repeat(10_000),
  "KSB-ABCD1234".repeat(1000),
];

// ===========================================================================
describe("canonical constants contract", () => {
  test("prefix is exactly 'KSB-'", () => {
    expect(HANDSHAKE_CODE_PREFIX).toBe("KSB-");
  });

  test("pattern is the anchored, bounded, flagless canonical shape (no drift)", () => {
    expect(HANDSHAKE_CODE_PATTERN.source).toBe("^KSB-[0-9A-F]{8}$");
    expect(HANDSHAKE_CODE_PATTERN.flags).toBe("");
  });

  test("prefix constant composes with 8 hex chars into a pattern-accepted code", () => {
    expect(HANDSHAKE_CODE_PATTERN.test(`${HANDSHAKE_CODE_PREFIX}ABCD1234`)).toBe(true);
  });
});

// ===========================================================================
describe("tier 1 — isHandshakeCode branch coverage", () => {
  test("accept branch: valid canonical codes pass", () => {
    for (const code of VALID_CODES) {
      expect(isHandshakeCode(code)).toBe(true);
    }
  });

  const nonStrings: ReadonlyArray<readonly [string, unknown]> = [
    ["null", null],
    ["undefined", undefined],
    ["number", 42],
    ["NaN", Number.NaN],
    ["bigint", 42n],
    ["boolean", true],
    ["plain object carrying a valid code", { code: "KSB-ABCD1234" }],
    ["empty object", {}],
    ["array wrapping a valid code", ["KSB-ABCD1234"]],
    ["empty array", []],
    ["function returning a valid code", () => "KSB-ABCD1234"],
    ["symbol", Symbol("KSB-ABCD1234")],
    ["Date", new Date(0)],
  ];

  test.each(nonStrings)("typeof branch: rejects non-string %s", (_label, value) => {
    expect(isHandshakeCode(value)).toBe(false);
  });

  test("string-miss branch: rejects the empty string", () => {
    expect(isHandshakeCode("")).toBe(false);
  });

  test("string-miss branch: rejects a near-miss string", () => {
    expect(isHandshakeCode("KSB-ABCD123")).toBe(false);
  });
});

// ===========================================================================
describe("tier 2 — boundary lengths and prefix variants", () => {
  test.each([
    ["7 hex chars", "KSB-ABCDEF1"],
    ["9 hex chars", "KSB-ABCDEF123"],
    ["0 hex chars (bare prefix)", "KSB-"],
  ])("length boundary: rejects %s", (_label, value) => {
    expect(isHandshakeCode(value)).toBe(false);
  });

  test("length boundary: accepts EXACTLY 8 hex chars across the alphabet span", () => {
    expect(isHandshakeCode("KSB-01234567")).toBe(true);
    expect(isHandshakeCode("KSB-89ABCDEF")).toBe(true);
  });

  test.each([
    ["prefix without dash", "KSBABCD1234"],
    ["missing prefix", "ABCD1234"],
    ["wrong prefix letter", "XSB-ABCD1234"],
    ["trailing dash", "KSB-ABCD1234-"],
    ["lowercase hex", "ksb-abcd1234"],
    ["lowercase hex tail", "KSB-abcd1234"],
  ])("prefix variant: rejects %s", (_label, value) => {
    expect(isHandshakeCode(value)).toBe(false);
  });

  test("whitespace: leading/trailing padding fails RAW but passes POST-normalization", () => {
    for (const padded of ["  KSB-ABCD1234  ", "\tKSB-ABCD1234\n", "\u00A0KSB-ABCD1234\u00A0"]) {
      expect(isHandshakeCode(padded)).toBe(false);
      expect(isHandshakeCode(normalizeHandshakeCode(padded))).toBe(true);
    }
  });

  test("whitespace: INTERNAL padding stays rejected even post-normalization", () => {
    const internal = "KSB-ABCD 1234";
    expect(isHandshakeCode(internal)).toBe(false);
    expect(isHandshakeCode(normalizeHandshakeCode(internal))).toBe(false);
  });
});

// ===========================================================================
describe("tier 3 — hostile fuzz inputs fail closed (raw AND post-normalization)", () => {
  test.each([
    ["LIKE wildcard % prefix", "%KSB-ABCD1234"],
    ["LIKE wildcard % suffix", "KSB-ABCD1234%"],
    ["LIKE wildcard % inside hex", "KSB-ABCD12%4"],
    ["LIKE wildcard _ replacing dash", "KSB_ABCD1234"],
    ["LIKE wildcard _ inside hex", "KSB-AB_D1234"],
    ["leading underscore", "_KSB-ABCD1234"],
    ["backslash prefix", "\\KSB-ABCD1234"],
    ["backslash inside hex", "KSB-ABCD12\\4"],
    ["trailing backslash", "KSB-ABCD1234\\"],
    ["SQL comment marker", "KSB-ABCD1234--"],
    ["RTL override injection", "\u202Eksb-abcd1234"],
    ["bidi embedding injection", "\u2066KSB-ABCD1234\u2069"],
    ["arabic unicode payload", "كود-12345678"],
    ["arabic RTL full payload", "كود-أبجد"],
    ["emoji payload", "KSB-😀12345"],
    ["emoji ZWJ family payload", "KSB-👨‍👩‍👦12345"],
    ["NUL byte suffix", "KSB-ABCD1234\u0000"],
    ["NUL byte prefix", "\u0000KSB-ABCD1234"],
    ["NUL byte inside hex", "KSB-ABCD12\u000034"],
    ["zero-width joiner inside hex", "KSB-ABCD12\u200D34"],
    ["zero-width space inside hex", "KSB-ABCD12\u200B34"],
  ])("hostile input rejected: %s", (_label, value) => {
    expect(isHandshakeCode(value)).toBe(false);
    expect(isHandshakeCode(normalizeHandshakeCode(value))).toBe(false);
  });

  test("multi-KB payloads fail closed", () => {
    expect(isHandshakeCode(`KSB-${"A".repeat(5000)}`)).toBe(false);
    expect(isHandshakeCode("%".repeat(10_000))).toBe(false);
    expect(isHandshakeCode("KSB-ABCD1234".repeat(1000))).toBe(false);
    expect(isHandshakeCode(normalizeHandshakeCode("KSB-ABCD1234".repeat(1000)))).toBe(false);
  });
});

// ===========================================================================
describe("tier 4 — normalization algebra (idempotence + case folding)", () => {
  test("normalize is idempotent across the full corpus", () => {
    for (const value of STRING_CORPUS) {
      const once = normalizeHandshakeCode(value);
      expect(normalizeHandshakeCode(once)).toBe(once);
    }
  });

  test("normalize is idempotent across a seeded 200-case fuzz sweep", () => {
    // Deterministic LCG so the sweep is reproducible — never flaky.
    let seed = 0x2f6e2b1;
    const alphabet = "KSBksb-0123456789abcdefABCDEF%_\\ \t\u202E😀\u0000";
    for (let i = 0; i < 200; i++) {
      const length = seed % 20;
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      let value = "";
      for (let j = 0; j <= length; j++) {
        seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
        value += alphabet[seed % alphabet.length];
      }
      const once = normalizeHandshakeCode(value);
      expect(normalizeHandshakeCode(once)).toBe(once);
    }
  });

  test("normalize is a pure deterministic function (no hidden state, same input → same output)", () => {
    const first = normalizeHandshakeCode("  ksb-ABCD1234  ");
    const second = normalizeHandshakeCode("  ksb-ABCD1234  ");
    expect(first).toBe(second);
    expect(first).toBe("KSB-ABCD1234");
    expect(normalizeHandshakeCode("ksb-abcd1234")).toBe("KSB-ABCD1234");
  });

  test("lowercase-of-valid normalizes INTO acceptance (case is presentation, not entropy)", () => {
    for (const variant of ["ksb-abcd1234", "Ksb-AbCd1234", "ksb-00000000", "  ksb-fedcba98  ", "\tksb-89abcdef\n"]) {
      expect(isHandshakeCode(variant)).toBe(false);
      const normalized = normalizeHandshakeCode(variant);
      expect(isHandshakeCode(normalized)).toBe(true);
      expect(normalized).toBe(variant.trim().toUpperCase());
    }
  });

  test("near-miss variants stay rejected post-normalization (no smuggling)", () => {
    for (const nearMiss of ["ksb-abcd123", "ksb-abcd12345", "ksb-abcd_234", "%ksb-abcd1234", "ksb-abcd 1234"]) {
      expect(isHandshakeCode(normalizeHandshakeCode(nearMiss))).toBe(false);
    }
  });
});

// ===========================================================================
describe("barrel re-export pinning", () => {
  test("@/shared/constants barrel re-exports all four symbols by identity", () => {
    expect(constantsBarrel.HANDSHAKE_CODE_PREFIX).toBe(HANDSHAKE_CODE_PREFIX);
    expect(constantsBarrel.HANDSHAKE_CODE_PATTERN).toBe(HANDSHAKE_CODE_PATTERN);
    expect(constantsBarrel.isHandshakeCode).toBe(isHandshakeCode);
    expect(constantsBarrel.normalizeHandshakeCode).toBe(normalizeHandshakeCode);
  });
});
