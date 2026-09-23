/**
 * `studentOnboarding`-namespace locale-parity verification
 * · ar+en parity gate + Arabic-script sweep + sections/methods/lane/errors
 *   block pins + function-leaf inventory + registry wiring.
 *
 * WHAT THIS LOCKS
 *   1. RUNTIME PARITY BELT — the ar/en `studentOnboarding` leaf maps expose
 *      IDENTICAL depth-first leaf-path sets where every STRING leaf is
 *      non-empty and every FUNCTION leaf sits at the SAME path on both maps
 *      (belt #2: the PRIMARY parity gate is compile-time typing where BOTH
 *      leaf consts are typed `StudentOnboardingLabels`; any missing key
 *      fails `bun tsgo`. This suite keeps the guarantee enforced even if
 *      someone loosens that typing later).
 *   2. BLOCK PINS — every key of the `sections` block (the four dialog
 *      sections), the `methods` block (one slot per supported offline
 *      payment method), the `lane` block (one slot per credit-lane member),
 *      and the `errors` block (the flow's rejection inventory) is pinned
 *      under BOTH locales — a key dropped from both maps simultaneously
 *      still fails this suite.
 *   3. FUNCTION-LEAF INVENTORY — the plan's counted fragments (sessions +
 *      cycle days), the credited-balance line, the parent handoff-code
 *      line, the meter's percentage caption, and the autosave stamp line
 *      are exactly the six declared function slots (no silent
 *      minting, no downgrade into a plain string) and each renders
 *      non-empty output carrying its probe value in BOTH locales.
 *   4. NO ENGLISH FALLTHROUGH — every ar STRING leaf contains Arabic
 *      script, and every ar function leaf RETURNS Arabic-script output
 *      (an accidentally English value fails the sweep).
 *   5. PLACEHOLDER-NAME PARITY — ICU placeholder-name sets are IDENTICAL
 *      across ar/en per STRING key (currently zero placeholders; the
 *      counted leaves interpolate via function arguments, not ICU
 *      templates).
 *   6. REGISTRY WIRING — the `StudentOnboarding` handle is registered in
 *      `shared/locale/namespaces/index.ts` with the conventional
 *      `<ns>.<ns>` id and its getter resolves the composed bundle slice.
 *
 * Mirrors the structure of `shared/locale/subscriptionAdmin-namespace.parity.test.ts`
 * (the sibling namespace gate with the same function-tolerant leaf walker,
 * extended here with a string-parameter slot for the handoff-code line).
 *
 * Pure unit tier — NO server boot, NO network, NO DB. Runs via the mandated
 * runner: `bun run test/scripts/run-test.ts shared/locale/studentOnboarding-namespace.parity.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import { arMessages } from "@/shared/locale/ar/messages";
import { studentOnboardingAr } from "@/shared/locale/ar/studentOnboarding";
import { enMessages } from "@/shared/locale/en/messages";
import { studentOnboardingEn } from "@/shared/locale/en/studentOnboarding";
import { namespaces } from "@/shared/locale/namespaces/index";
import { StudentOnboarding } from "@/shared/locale/namespaces/studentOnboarding";

// ─── Mandated inventory of the onboarding surface ───────────────────────────

/** Every leaf key the `sections` block must carry (4 dialog sections). */
const SECTIONS_LEAF_PATHS = ["parent", "payment", "plan", "profile"] as const;

/** Every leaf key the `methods` block must carry (offline-method inventory). */
const METHODS_LEAF_PATHS = ["bankTransfer", "offlineCash", "scholarship"] as const;

/** Every leaf key the `lane` block must carry (credit-lane inventory). */
const LANE_LEAF_PATHS = ["hifz", "reviews", "tajweed"] as const;

/** Every leaf key the `errors` block must carry (the flow's rejections). */
const ERRORS_LEAF_PATHS = [
  "duplicateReference",
  "methodNotOffline",
  "methodRequired",
  "parentRoleInvalid",
  "parentsRowMissing",
  "planInactive",
  "planLaneUnconfigured",
  "referenceInvalid",
] as const;

/** The EXACT function-leaf inventory (dotted paths — interpolated copy). */
const FUNCTION_LEAF_PATHS = [
  "draft.progressValue",
  "draft.savedAt",
  "planSection.intervalDays",
  "planSection.sessions",
  "success.balanceCredited",
  "success.handshakeCode",
] as const;

/** The count-bearing subset of the function inventory (number parameters). */
const COUNT_LEAF_PATHS = [
  "draft.progressValue",
  "planSection.intervalDays",
  "planSection.sessions",
  "success.balanceCredited",
] as const;

/** The single string-parameter slot (the parent handoff code). */
const CODE_LEAF_PATH = "success.handshakeCode";

/** The second string-parameter slot (the autosave stamp — a formatted HH:MM). */
const STAMP_LEAF_PATH = "draft.savedAt";

/** Probe code for the handoff-code leaf (the `KSB-` + 8-hex wire format). */
const PROBE_CODE = "KSB-1A2B3C4D";

/** Probe stamp for the autosave leaf (a locale-formatted HH:MM string). */
const PROBE_STAMP = "09:15";

/**
 * Probe counts for the count-bearing leaves — the CLDR Arabic boundary set:
 * one/two apply to n = 1/2 EXACTLY, few = 3–10, many = 11–99, and other =
 * 100/101/102 with their ×100 re-entries.
 */
const PROBE_COUNTS = [1, 2, 3, 10, 11, 99, 100, 101, 102] as const;

/** Arabic-script probe — at least one Arabic-block character in the value. */
const ARABIC_SCRIPT = /[\u0600-\u06FF]/;

/** A count-bearing leaf's declared single-number signature. */
type CountLeaf = (count: number) => string;

/** A code-bearing leaf's declared single-string signature. */
type CodeLeaf = (code: string) => string;

/** Type guard: the leaf is one of the declared count-bearing label functions. */
function isCountLeaf(value: unknown): value is CountLeaf {
  return typeof value === "function";
}

/** Type guard: the leaf is the declared code-bearing handoff function. */
function isCodeLeaf(value: unknown): value is CodeLeaf {
  return typeof value === "function";
}

/**
 * Depth-first leaf paths of a locale map — grouped sub-blocks are flattened
 * into dotted paths; string AND function slots count as leaves (the
 * function-tolerant rule of the `subscriptionAdmin` gate). Throws on any
 * node that is neither a string, a function, nor a grouped labels block.
 */
function leafPathsOf(localeMap: object, prefix = ""): string[] {
  const paths: string[] = [];
  for (const key of Object.keys(localeMap)) {
    const value: unknown = Reflect.get(localeMap, key);
    const path = prefix.length === 0 ? key : `${prefix}.${key}`;
    if (typeof value === "string" || typeof value === "function") {
      paths.push(path);
      continue;
    }
    if (value !== null && typeof value === "object") {
      paths.push(...leafPathsOf(value, path));
      continue;
    }
    throw new Error(
      `studentOnboarding.${path} must be a non-empty localized string, a function, or a grouped labels block`
    );
  }
  return paths;
}

/** Locale-sorted leaf paths of a locale map (stable comparison key set). */
function sortedLeafPathsOf(localeMap: object): string[] {
  return leafPathsOf(localeMap).toSorted((a, b) => a.localeCompare(b));
}

/** Reads one leaf value off a locale map by dotted path — throws otherwise. */
function leafValueOf(localeMap: object, path: string, localeName: string): unknown {
  let node: unknown = localeMap;
  for (const segment of path.split(".")) {
    if (node === null || typeof node !== "object") {
      throw new Error(`studentOnboarding.${localeName}.${path} traverses a non-block node`);
    }
    node = Reflect.get(node, segment);
  }
  if ((typeof node !== "string" && typeof node !== "function") || node.length === 0) {
    throw new Error(`studentOnboarding.${localeName}.${path} must be a non-empty localized string or a function`);
  }
  return node;
}

/** Every ICU `{name}` placeholder occurring in a template, deduplicated + sorted. */
function icuPlaceholdersOf(template: string): string[] {
  const seen = new Set<string>();
  const placeholder = /\{([A-Za-z]\w*)\}/g;
  let match = placeholder.exec(template);
  while (match !== null) {
    if (typeof match[1] === "string") {
      seen.add(match[1]);
    }
    match = placeholder.exec(template);
  }
  return [...seen].toSorted((a, b) => a.localeCompare(b));
}

// ===========================================================================
describe("compile-time parity mirror — ar/en studentOnboarding key sets agree", () => {
  test("identical sorted leaf-path sets across BOTH locale sources (depth-first)", () => {
    const arPaths = sortedLeafPathsOf(studentOnboardingAr);
    const enPaths = sortedLeafPathsOf(studentOnboardingEn);

    expect(arPaths.length).toBeGreaterThan(0);
    expect(enPaths).toEqual(arPaths);
  });

  test("every STRING leaf on BOTH maps is non-empty (zero dead keys); leaf TYPES agree per path", () => {
    for (const path of sortedLeafPathsOf(studentOnboardingAr)) {
      const arValue = leafValueOf(studentOnboardingAr, path, "ar");
      const enValue = leafValueOf(studentOnboardingEn, path, "en");
      expect(typeof enValue).toBe(typeof arValue);
    }
    // Symmetric sweep — guards an en-only leaf that ar lost via future drift.
    for (const path of sortedLeafPathsOf(studentOnboardingEn)) {
      const enValue = leafValueOf(studentOnboardingEn, path, "en");
      const arValue = leafValueOf(studentOnboardingAr, path, "ar");
      expect(typeof arValue).toBe(typeof enValue);
    }
  });
});

// ===========================================================================
describe("sections block — pinned under BOTH locales (the four dialog sections)", () => {
  test("exact leaf-path set on BOTH locale sources (no key added, none dropped)", () => {
    const pinned = [...SECTIONS_LEAF_PATHS].toSorted((a, b) => a.localeCompare(b));

    expect(leafPathsOf(studentOnboardingAr.sections).toSorted((a, b) => a.localeCompare(b))).toEqual(pinned);
    expect(leafPathsOf(studentOnboardingEn.sections).toSorted((a, b) => a.localeCompare(b))).toEqual(pinned);
  });

  test.each([...SECTIONS_LEAF_PATHS])("sections.%s resolves as a non-empty string in BOTH locales", path => {
    const arLeaf = leafValueOf(studentOnboardingAr.sections, path, "ar");
    const enLeaf = leafValueOf(studentOnboardingEn.sections, path, "en");
    if (typeof arLeaf !== "string" || typeof enLeaf !== "string") {
      throw new Error(`studentOnboarding.sections.${path} must be a localized string on BOTH maps`);
    }
    expect(arLeaf.length).toBeGreaterThan(0);
    expect(enLeaf.length).toBeGreaterThan(0);
  });
});

// ===========================================================================
describe("payment methods block — pinned under BOTH locales (offline-method inventory)", () => {
  test("exact leaf-path set on BOTH locale sources (no key added, none dropped)", () => {
    const pinned = [...METHODS_LEAF_PATHS].toSorted((a, b) => a.localeCompare(b));

    expect(leafPathsOf(studentOnboardingAr.paymentSection.methods).toSorted((a, b) => a.localeCompare(b))).toEqual(
      pinned
    );
    expect(leafPathsOf(studentOnboardingEn.paymentSection.methods).toSorted((a, b) => a.localeCompare(b))).toEqual(
      pinned
    );
  });

  test.each([...METHODS_LEAF_PATHS])(
    "paymentSection.methods.%s resolves as a non-empty string in BOTH locales",
    path => {
      const arLeaf = leafValueOf(studentOnboardingAr.paymentSection.methods, path, "ar");
      const enLeaf = leafValueOf(studentOnboardingEn.paymentSection.methods, path, "en");
      if (typeof arLeaf !== "string" || typeof enLeaf !== "string") {
        throw new Error(`studentOnboarding.paymentSection.methods.${path} must be a localized string on BOTH maps`);
      }
      expect(arLeaf.length).toBeGreaterThan(0);
      expect(enLeaf.length).toBeGreaterThan(0);
    }
  );
});

// ===========================================================================
describe("lane block — pinned under BOTH locales (credit-lane inventory)", () => {
  test("exact leaf-path set on BOTH locale sources (no key added, none dropped)", () => {
    const pinned = [...LANE_LEAF_PATHS].toSorted((a, b) => a.localeCompare(b));

    expect(leafPathsOf(studentOnboardingAr.planSection.lane).toSorted((a, b) => a.localeCompare(b))).toEqual(pinned);
    expect(leafPathsOf(studentOnboardingEn.planSection.lane).toSorted((a, b) => a.localeCompare(b))).toEqual(pinned);
  });

  test.each([...LANE_LEAF_PATHS])("planSection.lane.%s resolves as a non-empty string in BOTH locales", path => {
    const arLeaf = leafValueOf(studentOnboardingAr.planSection.lane, path, "ar");
    const enLeaf = leafValueOf(studentOnboardingEn.planSection.lane, path, "en");
    if (typeof arLeaf !== "string" || typeof enLeaf !== "string") {
      throw new Error(`studentOnboarding.planSection.lane.${path} must be a localized string on BOTH maps`);
    }
    expect(arLeaf.length).toBeGreaterThan(0);
    expect(enLeaf.length).toBeGreaterThan(0);
  });
});

// ===========================================================================
describe("errors block — pinned under BOTH locales (the flow's rejection inventory)", () => {
  test("exact leaf-path set on BOTH locale sources (no key added, none dropped)", () => {
    const pinned = [...ERRORS_LEAF_PATHS].toSorted((a, b) => a.localeCompare(b));

    expect(leafPathsOf(studentOnboardingAr.errors).toSorted((a, b) => a.localeCompare(b))).toEqual(pinned);
    expect(leafPathsOf(studentOnboardingEn.errors).toSorted((a, b) => a.localeCompare(b))).toEqual(pinned);
  });

  test.each([...ERRORS_LEAF_PATHS])("errors.%s resolves as a non-empty string in BOTH locales", path => {
    const arLeaf = leafValueOf(studentOnboardingAr.errors, path, "ar");
    const enLeaf = leafValueOf(studentOnboardingEn.errors, path, "en");
    if (typeof arLeaf !== "string" || typeof enLeaf !== "string") {
      throw new Error(`studentOnboarding.errors.${path} must be a localized string on BOTH maps`);
    }
    expect(arLeaf.length).toBeGreaterThan(0);
    expect(enLeaf.length).toBeGreaterThan(0);
  });
});

// ===========================================================================
describe("function-leaf inventory — exactly the six interpolated slots", () => {
  test("the function slots are EXACTLY the declared inventory (no minting, no downgrade)", () => {
    const functionPaths = sortedLeafPathsOf(studentOnboardingAr).filter(path => {
      return typeof leafValueOf(studentOnboardingAr, path, "ar") === "function";
    });
    expect(functionPaths).toEqual([...FUNCTION_LEAF_PATHS].toSorted((a, b) => a.localeCompare(b)));
  });

  test("every count-bearing leaf resolves non-empty output carrying EACH probe count in BOTH locales", () => {
    for (const path of COUNT_LEAF_PATHS) {
      const arLeaf = leafValueOf(studentOnboardingAr, path, "ar");
      const enLeaf = leafValueOf(studentOnboardingEn, path, "en");
      if (!isCountLeaf(arLeaf) || !isCountLeaf(enLeaf)) {
        throw new Error(`studentOnboarding.${path} must be a count-bearing function on BOTH maps`);
      }
      for (const count of PROBE_COUNTS) {
        const arOutput = arLeaf(count);
        const enOutput = enLeaf(count);
        expect(arOutput.length).toBeGreaterThan(0);
        expect(enOutput.length).toBeGreaterThan(0);
        expect(enOutput).toContain(String(count));
        // ar spells the CLDR one/two classes as words (جلسة واحدة / جلستين
        // / يوم واحد / يومين — exact-pinned by the plural-branch tables
        // below), so the ar digit carry applies from the counted-plural
        // class upward (the subscriptionAdmin placeholder-parity precedent:
        // digit probes ride the numeric branches only).
        if (count > 2) {
          expect(arOutput).toContain(String(count));
        } else {
          expect(ARABIC_SCRIPT.test(arOutput)).toBe(true);
        }
      }
    }
  });

  test("the handoff-code leaf embeds the probe code in BOTH locales (string parameter slot)", () => {
    const arLeaf = leafValueOf(studentOnboardingAr, CODE_LEAF_PATH, "ar");
    const enLeaf = leafValueOf(studentOnboardingEn, CODE_LEAF_PATH, "en");
    if (!isCodeLeaf(arLeaf) || !isCodeLeaf(enLeaf)) {
      throw new Error(`studentOnboarding.${CODE_LEAF_PATH} must be a code-bearing function on BOTH maps`);
    }
    const arOutput = arLeaf(PROBE_CODE);
    const enOutput = enLeaf(PROBE_CODE);
    expect(arOutput).toContain(PROBE_CODE);
    expect(enOutput).toContain(PROBE_CODE);
    expect(ARABIC_SCRIPT.test(arOutput)).toBe(true);
  });

  test("the autosave-stamp leaf embeds the probe stamp in BOTH locales (string parameter slot)", () => {
    const arLeaf = leafValueOf(studentOnboardingAr, STAMP_LEAF_PATH, "ar");
    const enLeaf = leafValueOf(studentOnboardingEn, STAMP_LEAF_PATH, "en");
    if (!isCodeLeaf(arLeaf) || !isCodeLeaf(enLeaf)) {
      throw new Error(`studentOnboarding.${STAMP_LEAF_PATH} must be a stamp-bearing function on BOTH maps`);
    }
    const arOutput = arLeaf(PROBE_STAMP);
    const enOutput = enLeaf(PROBE_STAMP);
    expect(arOutput).toContain(PROBE_STAMP);
    expect(enOutput).toContain(PROBE_STAMP);
    expect(ARABIC_SCRIPT.test(arOutput)).toBe(true);
  });
});

// ===========================================================================
describe("counted-copy plural-branch pin — the CLDR boundary probes on BOTH maps", () => {
  /**
   * The in-sentence credited-balance leaf — the shared branch-word table
   * (the dual form is the in-sentence accusative جلستين, matching the
   * sentence position of the copy).
   */
  const BALANCE_CREDIT_LEAF_PATH = "success.balanceCredited";

  /** Arabic branch word per boundary count: [count, session word, day word]. */
  const CLDR_BRANCH_PROBES: readonly (readonly [number, string, string])[] = [
    [1, "جلسة واحدة", "يوم واحد"],
    [2, "جلستين", "يومين"],
    [3, "جلسات", "أيام"],
    [10, "جلسات", "أيام"],
    [11, "جلسة", "يوماً"],
    [99, "جلسة", "يوماً"],
    [100, "جلسة", "يوماً"],
    [101, "جلسة", "يوماً"],
    [102, "جلسة", "يوماً"],
  ];

  /**
   * The standalone plan-fragment leaf — same CLDR classes with the
   * fragment's nominative dual form جلستان (caption position, not an
   * in-sentence object — the `planFacts` precedent).
   */
  const STANDALONE_SESSION_PROBES: readonly (readonly [number, string])[] = [
    [1, "جلسة واحدة"],
    [2, "جلستان"],
    [3, "جلسات"],
    [10, "جلسات"],
    [11, "جلسة"],
    [99, "جلسة"],
    [100, "جلسة"],
    [101, "جلسة"],
    [102, "جلسة"],
  ];

  // The Arabic session/day copy branches on the CLDR classes — singular
  // (n = 1 EXACTLY), dual (n = 2 EXACTLY), counted-plural few (3–10),
  // tamyiz-singular other (11–99 AND the 100/101/102 ×100 re-entries);
  // the EN session copy branches on 1 vs the rest (session/sessions),
  // while the EN cycle compound keeps its singular day word throughout.
  test.each(CLDR_BRANCH_PROBES)(
    "count %i renders the exact plural-branch word for the credited-balance + days copy",
    (count, arSessionWord, arDayWord) => {
      const enSessionWord = count === 1 ? "session" : "sessions";
      // The EN cycle copy is a hyphenated compound ("1-day cycle",
      // "5-day cycle") — the day word stays singular for every count.
      const enDayWord = "day";
      const arLeaf = leafValueOf(studentOnboardingAr, BALANCE_CREDIT_LEAF_PATH, "ar");
      const enLeaf = leafValueOf(studentOnboardingEn, BALANCE_CREDIT_LEAF_PATH, "en");
      if (!isCountLeaf(arLeaf) || !isCountLeaf(enLeaf)) {
        throw new Error(`studentOnboarding.${BALANCE_CREDIT_LEAF_PATH} must be a count-bearing function on BOTH maps`);
      }
      expect(arLeaf(count)).toContain(arSessionWord);
      expect(enLeaf(count)).toContain(enSessionWord);
      const arDays = leafValueOf(studentOnboardingAr, "planSection.intervalDays", "ar");
      const enDays = leafValueOf(studentOnboardingEn, "planSection.intervalDays", "en");
      if (!isCountLeaf(arDays) || !isCountLeaf(enDays)) {
        throw new Error("studentOnboarding.planSection.intervalDays must be a count-bearing function on BOTH maps");
      }
      expect(arDays(count)).toContain(arDayWord);
      expect(enDays(count)).toContain(enDayWord);
    }
  );

  test.each(STANDALONE_SESSION_PROBES)(
    "count %i renders the exact plural-branch word for the standalone plan-fragment copy",
    (count, arSessionWord) => {
      const enSessionWord = count === 1 ? "session" : "sessions";
      const arLeaf = leafValueOf(studentOnboardingAr, "planSection.sessions", "ar");
      const enLeaf = leafValueOf(studentOnboardingEn, "planSection.sessions", "en");
      if (!isCountLeaf(arLeaf) || !isCountLeaf(enLeaf)) {
        throw new Error("studentOnboarding.planSection.sessions must be a count-bearing function on BOTH maps");
      }
      expect(arLeaf(count)).toContain(arSessionWord);
      expect(enLeaf(count)).toContain(enSessionWord);
    }
  );
});

// ===========================================================================
describe("no English fallthrough — ar map carries Arabic copy for every slot", () => {
  test("every ar STRING leaf contains Arabic script", () => {
    const fallthroughs = sortedLeafPathsOf(studentOnboardingAr).filter(path => {
      const value = leafValueOf(studentOnboardingAr, path, "ar");
      return typeof value === "string" && !ARABIC_SCRIPT.test(value);
    });
    expect(fallthroughs).toHaveLength(0);
  });

  test("every ar FUNCTION leaf returns Arabic-script output", () => {
    for (const path of FUNCTION_LEAF_PATHS) {
      const leaf = leafValueOf(studentOnboardingAr, path, "ar");
      if (path === CODE_LEAF_PATH) {
        if (!isCodeLeaf(leaf)) {
          throw new Error(`studentOnboarding.ar.${path} must be a code-bearing function`);
        }
        expect(ARABIC_SCRIPT.test(leaf(PROBE_CODE))).toBe(true);
        continue;
      }
      if (!isCountLeaf(leaf)) {
        throw new Error(`studentOnboarding.ar.${path} must be a count-bearing function`);
      }
      for (const count of PROBE_COUNTS) {
        expect(ARABIC_SCRIPT.test(leaf(count))).toBe(true);
      }
    }
  });
});

// ===========================================================================
describe("placeholder-name sets are IDENTICAL across ar/en per string key", () => {
  test("per-key placeholder-name sets agree ar/en (count leaves are functions, not ICU templates)", () => {
    for (const path of sortedLeafPathsOf(studentOnboardingAr)) {
      const arValue = leafValueOf(studentOnboardingAr, path, "ar");
      if (typeof arValue !== "string") {
        continue;
      }
      const enValue = leafValueOf(studentOnboardingEn, path, "en");
      if (typeof enValue !== "string") {
        throw new Error(`studentOnboarding.en.${path} drifted off the ar map's string slot`);
      }
      const arNames = icuPlaceholdersOf(arValue);
      const enNames = icuPlaceholdersOf(enValue);
      expect(enNames).toEqual(arNames);
    }
  });
});

// ===========================================================================
describe("registry + bundle wiring", () => {
  test("namespaces registry exposes the StudentOnboarding handle with the `<ns>.<ns>` id convention", () => {
    expect(Object.hasOwn(namespaces, "StudentOnboarding")).toBe(true);
    expect(StudentOnboarding.id).toBe("studentOnboarding.studentOnboarding");
  });

  test("handle getter resolves the composed bundle slice (both locales)", () => {
    expect(StudentOnboarding.getLabels(enMessages)).toBe(enMessages.studentOnboardingTranslations);
    expect(StudentOnboarding.getLabels(arMessages)).toBe(arMessages.studentOnboardingTranslations);
  });

  test("`studentOnboardingTranslations` exists on BOTH message bundles", () => {
    expect(Object.hasOwn(enMessages, "studentOnboardingTranslations")).toBe(true);
    expect(Object.hasOwn(arMessages, "studentOnboardingTranslations")).toBe(true);
  });
});
