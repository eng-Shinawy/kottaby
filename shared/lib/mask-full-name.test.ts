/**
 * `maskFullName` minimal-disclosure masking suite — 4 tiers.
 *
 * WHAT THIS LOCKS
 *   1. BRANCH COMPLETENESS — every code path of the helper: empty-after-trim
 *      placeholder, single-part masking, multi-part masking with
 *      single-space re-join, the `Intl.Segmenter` grapheme path, and the
 *      code-point fallback path (exercised by deleting `Intl.Segmenter` for
 *      the duration of one test, with restoration guarded by `finally`).
 *   2. WHITESPACE NORMALIZATION — leading/trailing whitespace is stripped,
 *      internal whitespace runs (incl. tabs, newlines, NBSP, em space)
 *      collapse to single spaces; non-whitespace zero-width characters
 *      (ZWSP) do NOT split parts.
 *   3. GRAPHEME CORRECTNESS — composed vs decomposed `é`, ZWJ emoji
 *      sequences, skin-tone modifiers, flag pairs, RTL Arabic names,
 *      Arabic/Latin mixing, digits/symbols, lone surrogates, and lone
 *      combining marks all mask without throwing and without corrupting the
 *      leading cluster.
 *   4. NON-LEAKAGE + DETERMINISM PROPERTIES — 100 seeded-random name
 *      fixtures: `mask(x) === mask(x)` (determinism) and the masked output
 *      never contains the full original string; output length is
 *      independent of the remainder length (no length-of-remainder signal).
 *      Disclosure model note: the leading grapheme of each part is disclosed
 *      BY DESIGN, so a single-grapheme part appears inside its own masked
 *      part — the property corpus therefore draws multi-grapheme parts only.
 *
 * Pure unit tier — NO server boot, NO network, NO DB. Runs via the mandated
 * runner: `bun run test/scripts/run-test.ts shared/lib/mask-full-name.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import { maskFullName } from "@/shared/lib/mask-full-name";

// ─── Tier 1: branch completeness ─────────────────────────────────────────────

describe("maskFullName — Tier 1: branch completeness", () => {
  test("empty input returns the fixed placeholder mask", () => {
    expect(maskFullName("")).toBe("***");
  });

  test("whitespace-only input returns the fixed placeholder mask", () => {
    expect(maskFullName("   ")).toBe("***");
    expect(maskFullName("\t\n  \r")).toBe("***");
    expect(maskFullName("\u00A0\u2003")).toBe("***"); // NBSP + em space are whitespace
  });

  test("single-part name masks to leading grapheme + fixed cluster", () => {
    expect(maskFullName("Yusuf")).toBe("Y***");
  });

  test("multi-part name masks every part and joins with single spaces", () => {
    expect(maskFullName("Yusuf Ali")).toBe("Y*** A***");
    expect(maskFullName("أحمد محمد")).toBe("أ*** م***");
    expect(maskFullName("a b c")).toBe("a*** b*** c***");
  });

  test("grapheme segmentation path is live (combining mark stays attached)", () => {
    // With Intl.Segmenter, base + combining acute is ONE leading grapheme;
    // the code-point fallback would emit the bare base "e" instead.
    expect(maskFullName("e\u0301l")).toBe("e\u0301***");
  });

  test("falls back to code-point extraction when Intl.Segmenter is unavailable", () => {
    // Remove the segmenter constructor for the duration of this test only;
    // restore the original property in `finally` (defineProperty — the lib
    // types mark Intl.Segmenter read-only for plain assignment) so the rest
    // of the suite sees an untouched global runtime surface.
    const originalSegmenter = Intl.Segmenter;
    Reflect.deleteProperty(Intl, "Segmenter");
    try {
      expect(maskFullName("Yusuf Ali")).toBe("Y*** A***");
      // Distinguishes the fallback path from the segmenter path: Array.from
      // yields the bare base code point, dropping the combining acute.
      expect(maskFullName("e\u0301l")).toBe("e***");
      // The code-point fallback never splits surrogate pairs:
      expect(maskFullName("😀 Muhammad")).toBe("😀*** M***");
    } finally {
      Object.defineProperty(Intl, "Segmenter", {
        value: originalSegmenter,
        writable: true,
        configurable: true,
        enumerable: false,
      });
    }
    // Guard: the global runtime surface is restored for the rest of the suite.
    expect(typeof Intl.Segmenter).toBe("function");
    // And the segmenter path is live again afterwards:
    expect(maskFullName("e\u0301l")).toBe("e\u0301***");
  });
});

// ─── Tier 2: whitespace & single-grapheme normalization ──────────────────────

describe("maskFullName — Tier 2: whitespace & single-grapheme normalization", () => {
  test("single-grapheme name discloses exactly that grapheme", () => {
    expect(maskFullName("ع")).toBe("ع***");
    expect(maskFullName("A")).toBe("A***");
    expect(maskFullName("٧")).toBe("٧***"); // Arabic-Indic digit
  });

  test("collapses extra internal whitespace runs into single spaces", () => {
    expect(maskFullName("Yusuf   Ali")).toBe("Y*** A***");
    expect(maskFullName("Yusuf\t\tAli")).toBe("Y*** A***");
    expect(maskFullName("Yusuf \t \n Ali")).toBe("Y*** A***");
    expect(maskFullName("Yusuf\u00A0\u00A0Ali")).toBe("Y*** A***"); // NBSP runs
    expect(maskFullName("أحمد    محمد")).toBe("أ*** م***");
  });

  test("strips leading and trailing whitespace before masking", () => {
    expect(maskFullName("  Yusuf  ")).toBe("Y***");
    expect(maskFullName("\t أحمد محمد \n")).toBe("أ*** م***");
  });

  test("zero-width non-whitespace characters do NOT split parts", () => {
    // U+200B (zero-width space) is not matched by \s: single part stays single.
    expect(maskFullName("Yusuf\u200BAli")).toBe("Y***");
  });
});

// ─── Tier 3: Unicode grapheme & hostile-input correctness ────────────────────

describe("maskFullName — Tier 3: Unicode grapheme & hostile-input correctness", () => {
  test("composed and decomposed é both mask as a single é grapheme", () => {
    expect(maskFullName("\u00E9milie")).toBe("\u00E9***"); // composed U+00E9
    expect(maskFullName("e\u0301milie")).toBe("e\u0301***"); // decomposed e + U+0301
  });

  test("ZWJ emoji sequence stays intact as the leading grapheme", () => {
    expect(maskFullName("👨‍👩‍👧‍👦")).toBe("👨‍👩‍👧‍👦***");
    expect(maskFullName("👨‍👩‍👧‍👦 Ali")).toBe("👨‍👩‍👧‍👦*** A***");
  });

  test("skin-tone modifier stays attached to its base emoji", () => {
    expect(maskFullName("👍🏽")).toBe("👍🏽***");
  });

  test("regional-indicator flag pair stays intact", () => {
    expect(maskFullName("🇪🇬")).toBe("🇪🇬***");
  });

  test("RTL Arabic names mask per part without reordering", () => {
    expect(maskFullName("أحمد محمد")).toBe("أ*** م***");
    expect(maskFullName("محمد عبد الرحمن")).toBe("م*** ع*** ا***");
  });

  test("Arabic and Latin parts mask independently when mixed", () => {
    expect(maskFullName("أحمد Adam")).toBe("أ*** A***");
    expect(maskFullName("Adam أحمد")).toBe("A*** أ***");
  });

  test("digits and symbols are masked like any other name content", () => {
    expect(maskFullName("123 456")).toBe("1*** 4***");
    expect(maskFullName("!@# $%^")).toBe("!*** $***");
    expect(maskFullName("٧٧ ٤٢")).toBe("٧*** ٤***"); // Arabic-Indic digits
  });

  test("lone surrogates and lone combining marks never throw", () => {
    expect(maskFullName("\uD83D")).toBe("\uD83D***"); // lone high surrogate
    expect(maskFullName("\uDE00")).toBe("\uDE00***"); // lone low surrogate
    expect(maskFullName("\u0301")).toBe("\u0301***"); // lone combining acute
  });

  test("input that already looks like a mask is still fully transformed", () => {
    // Coincidental shape: "x***" masks to itself because its remainder is
    // dropped and the fixed cluster re-appended — no remainder is disclosed.
    expect(maskFullName("x***")).toBe("x***");
    // The remainder beyond the leading grapheme never survives:
    expect(maskFullName("xy***")).toBe("x***");
    expect(maskFullName("a*** b***")).toBe("a*** b***");
  });
});

// ─── Tier 4: determinism & non-leakage properties ────────────────────────────

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

describe("maskFullName — Tier 4: determinism & non-leakage properties", () => {
  // Multi-grapheme parts only: a single-grapheme part is disclosed by design,
  // so it would trivially appear inside its own masked part.
  const NAME_PART_POOL = [
    "Yusuf",
    "Ali",
    "Omar",
    "Muhammad",
    "أحمد",
    "محمد",
    "إبراهيم",
    "عبدالله",
    "e\u0301milie",
    "\u00E9milie",
    "12345",
    "!@#$",
    "٧٧٧",
  ];
  const SEPARATOR_POOL = [" ", "  ", "\t", "\n", " \t ", "\u00A0", "\u2003"];
  const PAD_POOL = ["", " ", "  ", "\t", "\u00A0"];

  test("100 seeded random fixtures: deterministic and never disclose the full name", () => {
    const random = createSeededRandom(0x1f3e8);
    for (let fixtureIndex = 0; fixtureIndex < 100; fixtureIndex++) {
      const partCount = 1 + Math.floor(random() * 4);
      const parts: string[] = [];
      for (let partIndex = 0; partIndex < partCount; partIndex++) {
        parts.push(NAME_PART_POOL[Math.floor(random() * NAME_PART_POOL.length)]);
      }
      const separator = SEPARATOR_POOL[Math.floor(random() * SEPARATOR_POOL.length)];
      const leadingPad = PAD_POOL[Math.floor(random() * PAD_POOL.length)];
      const trailingPad = PAD_POOL[Math.floor(random() * PAD_POOL.length)];
      const fixture = `${leadingPad}${parts.join(separator)}${trailingPad}`;

      const firstMask = maskFullName(fixture);
      // Determinism: same input → same mask.
      expect(firstMask).toBe(maskFullName(fixture));
      // Non-leakage: the full original string never appears in the mask.
      expect(firstMask.includes(fixture)).toBe(false);
    }
  });

  test("masked output never contains the full multi-grapheme original", () => {
    for (const name of ["Yusuf Ali", "أحمد محمد", "Muhammad Ali", "e\u0301milie", "٧٧٧ ٤٢٤"]) {
      expect(maskFullName(name).includes(name)).toBe(false);
    }
  });

  test("mask output length is independent of the remainder length", () => {
    // Per-part disclosure is a fixed cluster: no length-of-remainder signal.
    expect(maskFullName("A")).toBe(maskFullName("Abcdefghijklmnopqrstuvwxyz"));
    expect(maskFullName("أ")).toBe(maskFullName("أحمد"));
    expect(maskFullName("😀")).toHaveLength(maskFullName("😀😀😀😀").length);
    expect(maskFullName("Yusuf Ali")).toHaveLength(maskFullName("Yusufiously Alipoulos").length);
  });
});
