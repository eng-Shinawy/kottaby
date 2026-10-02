/**
 * Shared phone-contract validation suite (`phoneSchema`, `isValidPhone`,
 * `normalizePhone`) — 4 tiers.
 *
 * WHAT THIS LOCKS
 *   1. BRANCH & STATEMENT COVERAGE — every outcome of the shared contract:
 *      - `phoneSchema` machine codes (`PHONE_REQUIRED` / `PHONE_TOO_LONG` /
 *        `PHONE_INVALID`) and the success arm (trimmed `data`, no issues),
 *        including the `.max`-before-`.regex` precedence on the chain
 *      - every behavioral branch of `isValidPhone`: empty, whitespace-only,
 *        valid E.164, missing `+`, leading zero, too short, too long,
 *        non-digit body
 *      - both arms of `normalizePhone` (leading-`+` collapse vs passthrough)
 *        and each stripped character class (spaces, dashes, parentheses)
 *   2. BOUNDARY VALUES — `PHONE_MAX_LENGTH` (16) exactly valid vs 17 rejected;
 *      the E.164 digit floor (8) and ceiling (15); bare `+`; leading zero;
 *      non-ASCII digit scripts and bidi marks; empty / whitespace-only.
 *   3. FUZZ & PROPERTY — a deterministic corpus (seeded xorshift32, fixed
 *      iteration count, lengths 0–64 over digits/`+`/spaces/dashes/parens/
 *      control chars) proving exception-safety, determinism, `normalizePhone`
 *      idempotency, and predicate/schema agreement in both directions;
 *      concurrency through `Promise.allSettled`.
 *   4. SECURITY & ABUSE — 10k-char payloads, SQL/LIKE wildcards, null bytes,
 *      embedded CRLF, template-injection-shaped strings: only `boolean` /
 *      `string` comes back, nothing throws, no hostile payload is partially
 *      accepted, and machine-code messages never echo the raw input.
 *
 * Pure unit tier — NO server boot, NO network, NO DB, NO render. Runs via the
 * mandated runner: `bun run test/scripts/run-test.ts shared/lib/phone.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import { isValidPhone, normalizePhone, PHONE_E164_PATTERN, PHONE_MAX_LENGTH, phoneSchema } from "@/shared/lib/phone";

/** Machine codes carried by `phoneSchema` issues — never user-facing copy. */
const MACHINE_CODES = new Set(["PHONE_REQUIRED", "PHONE_TOO_LONG", "PHONE_INVALID"]);

/** Machine code of the first parse issue, or `undefined` when parsing succeeds. */
function firstErrorCode(value: string): string | undefined {
  const result = phoneSchema.safeParse(value);
  return result.success ? undefined : result.error.issues[0]?.message;
}

/** A hostile payload must be rejected by the predicate and carry a machine code. */
function expectRejectedWithMachineCode(payload: string): void {
  expect(isValidPhone(payload)).toBe(false);
  const code = firstErrorCode(payload);
  if (code === undefined) throw new Error("expected a machine code for the failed parse");
  expect(MACHINE_CODES.has(code)).toBe(true);
}

// ─── Tier 1: branch & statement coverage ─────────────────────────────────────

describe("phoneSchema — Tier 1: branch & statement coverage", () => {
  test("empty string hits the min arm and carries the PHONE_REQUIRED machine code", () => {
    expect(phoneSchema.safeParse("").success).toBe(false);
    expect(firstErrorCode("")).toBe("PHONE_REQUIRED");
  });

  test("whitespace-only input trims to empty and carries PHONE_REQUIRED", () => {
    expect(firstErrorCode("   ")).toBe("PHONE_REQUIRED");
    expect(firstErrorCode(" \t\n ")).toBe("PHONE_REQUIRED");
  });

  test("max arm outranks the regex arm for over-long non-E.164 shapes", () => {
    // Missing `+` AND 17 chars — `.max` must report before `.regex`.
    expect(firstErrorCode("20100123456789012")).toBe("PHONE_TOO_LONG");
  });

  test("a well-shaped 17-char number still lands on the max arm", () => {
    expect(firstErrorCode("+2010012345678901")).toBe("PHONE_TOO_LONG");
  });

  test("shape failures inside the length cap carry PHONE_INVALID", () => {
    expect(firstErrorCode("+20abc1234")).toBe("PHONE_INVALID");
  });

  test("success arm yields the value unchanged with no issues", () => {
    expect(phoneSchema.parse("+201001234567")).toBe("+201001234567");
  });

  test("whitespace-padded valid numbers parse to their trimmed value", () => {
    expect(phoneSchema.parse(" +201001234567 ")).toBe("+201001234567");
    expect(phoneSchema.parse("\t+12345678\n")).toBe("+12345678");
  });
});

describe("isValidPhone — Tier 1: branch & statement coverage", () => {
  test("accepts valid E.164 numbers", () => {
    expect(isValidPhone("+201001234567")).toBe(true);
    expect(isValidPhone("+1234567890")).toBe(true);
    expect(isValidPhone("+441632960754")).toBe(true);
  });

  test("rejects the empty string", () => {
    expect(isValidPhone("")).toBe(false);
  });

  test("rejects whitespace-only input", () => {
    expect(isValidPhone("   ")).toBe(false);
    expect(isValidPhone(" \t\r\n ")).toBe(false);
  });

  test("rejects numbers missing the leading +", () => {
    expect(isValidPhone("201001234567")).toBe(false);
  });

  test("rejects a leading zero after the + (country digit must be 1-9)", () => {
    expect(isValidPhone("+0123456789")).toBe(false);
  });

  test("rejects numbers that are too short", () => {
    expect(isValidPhone("+201")).toBe(false);
  });

  test("rejects numbers that are too long", () => {
    expect(isValidPhone("+2010012345678901")).toBe(false);
  });

  test("rejects non-digit bodies", () => {
    expect(isValidPhone("+20abc1234")).toBe(false);
    // Interior formatting characters are not part of the canonical shape;
    // producers canonicalize with normalizePhone before validating.
    expect(isValidPhone("+20 100 123")).toBe(false);
  });
});

describe("normalizePhone — Tier 1: branch & statement coverage", () => {
  test("collapses any run of leading + to exactly one", () => {
    expect(normalizePhone("++20 100 123")).toBe("+20100123");
    expect(normalizePhone("+++20")).toBe("+20");
    expect(normalizePhone("+")).toBe("+");
  });

  test("never invents a + when the input had none", () => {
    expect(normalizePhone("20100")).toBe("20100");
    expect(normalizePhone("20-100")).toBe("20100");
    expect(normalizePhone("")).toBe("");
  });

  test("strips leading and trailing whitespace", () => {
    expect(normalizePhone("  +201001234567  ")).toBe("+201001234567");
  });

  test("strips internal spaces", () => {
    expect(normalizePhone("+20 100 123")).toBe("+20100123");
  });

  test("strips dashes", () => {
    expect(normalizePhone("+20-100-123-4567")).toBe("+201001234567");
  });

  test("strips parentheses", () => {
    expect(normalizePhone("+20(100)1234567")).toBe("+201001234567");
  });

  test("strips mixed formatting characters in one pass", () => {
    expect(normalizePhone(" +20 (100) 123-4567 ")).toBe("+201001234567");
  });

  test("leaves already-canonical input untouched", () => {
    expect(normalizePhone("+201001234567")).toBe("+201001234567");
  });

  test("preserves characters outside the documented strip set", () => {
    expect(normalizePhone("+1\t234")).toBe("+1\t234");
  });
});

// ─── Tier 2: boundary values ─────────────────────────────────────────────────

describe("length boundaries — Tier 2: boundary values", () => {
  test("PHONE_MAX_LENGTH is 16 — the + plus the 15-digit E.164 ceiling", () => {
    expect(PHONE_MAX_LENGTH).toBe(16);
    expect("+123456789012345").toHaveLength(16);
    expect(isValidPhone("+123456789012345")).toBe(true);
  });

  test("exactly PHONE_MAX_LENGTH characters parse successfully", () => {
    expect(phoneSchema.parse("+123456789012345")).toBe("+123456789012345");
  });

  test("one character over the cap is rejected with PHONE_TOO_LONG", () => {
    const tooLong = "+1234567890123456";
    expect(tooLong).toHaveLength(17);
    expect(isValidPhone(tooLong)).toBe(false);
    expect(firstErrorCode(tooLong)).toBe("PHONE_TOO_LONG");
  });

  test("a 16th digit can never fit — the wire cap rejects it first", () => {
    expect(isValidPhone("+123456789012345")).toBe(true); // 15 digits: E.164 max
    expect(isValidPhone("+11234567890123456")).toBe(false); // 17 chars: length cap
  });

  test("exactly 8 digits after the + is the shortest valid number", () => {
    expect("+12345678").toHaveLength(9);
    expect(isValidPhone("+12345678")).toBe(true);
  });

  test("7 digits after the + is rejected inside the length cap", () => {
    expect("+1234567").toHaveLength(8);
    expect(isValidPhone("+1234567")).toBe(false);
    expect(firstErrorCode("+1234567")).toBe("PHONE_INVALID");
  });

  test("a bare + is rejected", () => {
    expect(isValidPhone("+")).toBe(false);
    expect(firstErrorCode("+")).toBe("PHONE_INVALID");
  });

  test("a leading zero after the + is rejected", () => {
    expect(isValidPhone("+0123456789")).toBe(false);
    expect(firstErrorCode("+0123456789")).toBe("PHONE_INVALID");
  });

  test("empty and whitespace-only inputs sit on the required boundary", () => {
    expect(firstErrorCode("")).toBe("PHONE_REQUIRED");
    expect(firstErrorCode("   ")).toBe("PHONE_REQUIRED");
  });
});

describe("non-ASCII scripts — Tier 2: boundary values", () => {
  test("Arabic-Indic digit bodies are rejected (the pattern is ASCII \\d)", () => {
    expect(isValidPhone("+٢٠١٠٠١٢٣٤٥٦")).toBe(false);
    expect(isValidPhone("+۲۰۱۰۰۱۲۳۴۵۶")).toBe(false);
    expect(firstErrorCode("+٢٠١٠٠١٢٣٤٥٦")).toBe("PHONE_INVALID");
  });

  test("fullwidth digit bodies are rejected", () => {
    expect(isValidPhone("+２０１００１２３")).toBe(false);
  });

  test("bidi marks and directional isolates defeat the shape check", () => {
    expect(isValidPhone("\u200F+201001234567")).toBe(false); // RLM before the +
    expect(isValidPhone("+201001234567\u200E")).toBe(false); // trailing LRM
    expect(isValidPhone("\u2066+201001234567\u2069")).toBe(false); // isolates
    expect(isValidPhone("+2010\u202B01234567")).toBe(false); // RLE inside
  });
});

// ─── Tier 3: fuzz & property ─────────────────────────────────────────────────

/** Deterministic xorshift32 source — the corpus is fully reproducible. */
function createSeededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state ^= state << 13;
    state ^= state >>> 7;
    state ^= state << 17;
    return (state >>> 0) / 2 ** 32;
  };
}

const FUZZ_ALPHABET = "+-()0123456789 \t\n\r".split("");
const FUZZ_ITERATIONS = 400;
const FUZZ_MAX_LENGTH = 64;

/** Crafted anchors guarantee the corpus contains accepted members as well. */
const CORPUS_ANCHORS = [
  "+201001234567",
  "+12345678",
  "+123456789012345",
  " +12345678 ",
  "  +201001234567\t",
  "201001234567",
  "+20 (100) 123-4567",
  "",
];

function buildFuzzCorpus(): string[] {
  const random = createSeededRandom(0x51c4b3);
  const corpus = [...CORPUS_ANCHORS];
  for (let i = 0; i < FUZZ_ITERATIONS; i++) {
    const length = Math.floor(random() * (FUZZ_MAX_LENGTH + 1));
    let payload = "";
    for (let j = 0; j < length; j++) {
      payload += FUZZ_ALPHABET[Math.floor(random() * FUZZ_ALPHABET.length)];
    }
    corpus.push(payload);
  }
  return corpus;
}

describe("deterministic fuzz corpus — Tier 3: fuzz & property", () => {
  const corpus = buildFuzzCorpus();

  test("isValidPhone never throws, stays boolean, and is deterministic", () => {
    for (const payload of corpus) {
      const first = isValidPhone(payload);
      const second = isValidPhone(payload);
      expect(typeof first).toBe("boolean");
      expect(first).toBe(second);
    }
  });

  test("normalizePhone is idempotent over the whole corpus", () => {
    for (const payload of corpus) {
      const once = normalizePhone(payload);
      expect(typeof once).toBe("string");
      expect(normalizePhone(once)).toBe(once);
    }
  });

  test("predicate and schema agree in both directions on every payload", () => {
    for (const payload of corpus) {
      expect(isValidPhone(payload)).toBe(phoneSchema.safeParse(payload).success);
    }
  });

  test("validity survives canonicalization", () => {
    for (const payload of corpus) {
      if (!isValidPhone(payload)) continue;
      const normalized = normalizePhone(payload);
      expect(isValidPhone(normalized)).toBe(true);
      expect(normalized).toMatch(PHONE_E164_PATTERN);
    }
    // The converse is intentionally not asserted: canonicalization may
    // legitimately repair formatted input (see the mixed-format fixture in
    // Tier 1), so normalized-valid does not imply raw-valid.
  });

  test("concurrent parses settle fulfilled and match the predicate", async () => {
    const probes = corpus.map(async payload => ({
      payload,
      predicate: isValidPhone(payload),
      schema: phoneSchema.safeParse(payload).success,
    }));
    const settled = await Promise.allSettled(probes);
    expect(settled).toHaveLength(corpus.length);
    for (const outcome of settled) {
      if (outcome.status !== "fulfilled") throw new Error("concurrent parse rejected");
      expect(outcome.value.predicate).toBe(outcome.value.schema);
    }
  });
});

// ─── Tier 4: security & abuse ────────────────────────────────────────────────

const LONG_PAYLOAD = `+${"2".repeat(9999)}`;

describe("hostile payloads — Tier 4: security & abuse", () => {
  test("10k-character payloads return without throwing or accepting", () => {
    expect(LONG_PAYLOAD).toHaveLength(10000);
    expect(typeof isValidPhone(LONG_PAYLOAD)).toBe("boolean");
    expect(isValidPhone(LONG_PAYLOAD)).toBe(false);
    expect(firstErrorCode(LONG_PAYLOAD)).toBe("PHONE_TOO_LONG");

    const digitsOnly = "2".repeat(10000);
    expect(isValidPhone(digitsOnly)).toBe(false);
    expect(firstErrorCode(digitsOnly)).toBe("PHONE_TOO_LONG");

    expect(typeof normalizePhone(LONG_PAYLOAD)).toBe("string");
    expect(isValidPhone(normalizePhone(LONG_PAYLOAD))).toBe(false);
  });

  test("SQL and LIKE wildcard metacharacters are inert", () => {
    const hostile = ["%", "_", "\\", "' OR 1=1 --", "%1%1%1%", "_1_", "+%20", "+20_100", "\\x41"];
    for (const payload of hostile) {
      expectRejectedWithMachineCode(payload);
      expect(typeof normalizePhone(payload)).toBe("string");
    }
  });

  test("null bytes and control characters never open an acceptance path", () => {
    const hostile = [
      "\u0000",
      "+201001234567\u0000",
      "\u0000+201001234567",
      "+2010\u0000012345\u00006",
      "\u0007",
      "+2010\u00070123",
    ];
    for (const payload of hostile) {
      expectRejectedWithMachineCode(payload);
    }
  });

  test("carriage returns and line feeds are rejected inside the value", () => {
    expectRejectedWithMachineCode("+1\n234");
    expect(firstErrorCode("+1\n234")).toBe("PHONE_INVALID");
    expect(isValidPhone("+20\r100123456")).toBe(false);
    expect(isValidPhone("+20100\r\n1234567")).toBe(false);
  });

  test("edge-only line breaks follow the same trim rule as spaces", () => {
    expect(phoneSchema.parse("+201001234567\r\n")).toBe("+201001234567");
    expect(isValidPhone("\r\n+201001234567\r\n")).toBe(true);
    expect(firstErrorCode("\r\n")).toBe("PHONE_REQUIRED");
  });

  test("template-injection-shaped strings are rejected", () => {
    // The escaped template placeholder keeps the `${placeholder}`-shaped
    // payload verbatim at runtime; a plain "..." literal would trip the
    // template-placeholder lint and a concat would trip useless-concat.
    const hostile = ["+{1}", `\${phone}`, "+<script>", "+1{2}3"];
    for (const payload of hostile) {
      expectRejectedWithMachineCode(payload);
      expect(typeof normalizePhone(payload)).toBe("string");
    }
    expect(normalizePhone("+{1}")).toBe("+{1}");
  });

  test("machine-code messages never echo the hostile payload", () => {
    // The message channel can only carry the three fixed codes, so nothing
    // payload-shaped can be reflected. The underscore is excluded here solely
    // because it is itself a character of those fixed code strings.
    const hostile = ["%", "\\", "\u0000", "+1\n234", "+{1}", "+2010\u0000012345", "x".repeat(300)];
    for (const payload of hostile) {
      const code = firstErrorCode(payload);
      if (code === undefined) throw new Error("expected a machine code for the failed parse");
      expect(MACHINE_CODES.has(code)).toBe(true);
      expect(code.includes(payload)).toBe(false);
    }
  });
});
