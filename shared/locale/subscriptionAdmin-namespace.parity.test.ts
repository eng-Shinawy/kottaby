/**
 * `subscriptionAdmin`-namespace locale-parity verification
 * · ar+en parity gate + Arabic-script sweep + status/actions block pin +
 *   function-leaf inventory + registry wiring.
 *
 * WHAT THIS LOCKS
 *   1. RUNTIME PARITY BELT — the ar/en `subscriptionAdmin` leaf maps expose
 *      IDENTICAL depth-first leaf-path sets where every STRING leaf is
 *      non-empty and every FUNCTION leaf sits at the SAME path on both maps
 *      (belt #2: the PRIMARY parity gate is compile-time typing where BOTH
 *      leaf consts are typed `SubscriptionAdminLabels`; any missing key
 *      fails `bun tsgo`. This suite keeps the guarantee enforced even if
 *      someone loosens that typing later).
 *   2. STATUS + ACTIONS BLOCK PIN — every key of the `status` block (one
 *      slot per `SubscriptionStatus` wire member) and of the `actions`
 *      block (extend/renew/cancel/changePlan — the four-action lifecycle inventory)
 *      is pinned under BOTH locales — a key dropped from both maps
 *      simultaneously still fails this suite.
 *   3. FUNCTION-LEAF INVENTORY — the count-bearing proration/success
 *      leaves, the relative expiry-badge day forms, the plan-facts
 *      counted fragments, the audit-link trail-depth badge, plus the
 *      cancel reason counter are exactly the nine declared
 *      function slots (no silent minting, no downgrade into a plain
 *      string) and each renders non-empty output carrying its probe count
 *      in BOTH locales.
 *   4. NO ENGLISH FALLTHROUGH — every ar STRING leaf contains Arabic
 *      script, and every ar function leaf RETURNS Arabic-script output
 *      (an accidentally English value fails the sweep).
 *   5. PLACEHOLDER-NAME PARITY — ICU placeholder-name sets are IDENTICAL
 *      across ar/en per STRING key (currently zero placeholders; the
 *      count-bearing leaves interpolate via function arguments, not ICU
 *      templates).
 *   6. REGISTRY WIRING — the `SubscriptionAdmin` handle is registered in
 *      `shared/locale/namespaces/index.ts` with the conventional
 *      `<ns>.<ns>` id and its getter resolves the composed bundle slice.
 *
 * Mirrors the structure of `shared/locale/adminStudents-namespace.parity.test.ts`
 * (the sibling namespace gate); the function-tolerant leaf walker follows
 * the `adminBroadcasts-namespace.parity.test.ts` precedent (that gate's
 * function slots are the same shape, just not nested).
 *
 * Pure unit tier — NO server boot, NO network, NO DB. Runs via the mandated
 * runner: `bun run test/scripts/run-test.ts shared/locale/subscriptionAdmin-namespace.parity.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import { arMessages } from "@/shared/locale/ar/messages";
import { subscriptionAdminAr } from "@/shared/locale/ar/subscriptionAdmin";
import { enMessages } from "@/shared/locale/en/messages";
import { subscriptionAdminEn } from "@/shared/locale/en/subscriptionAdmin";
import { namespaces } from "@/shared/locale/namespaces/index";
import { SubscriptionAdmin } from "@/shared/locale/namespaces/subscriptionAdmin";

// ─── Mandated inventory of the lifecycle surface ────────────────────────────

/** Every leaf key the `status` block must carry (5 slots — the wire enum). */
const STATUS_LEAF_PATHS = ["active", "cancelled", "expired", "pending", "suspended"] as const;

/** Every leaf key the `actions` block must carry (4-slot lifecycle inventory). */
const ACTIONS_LEAF_PATHS = ["cancel", "changePlan", "extend", "renew"] as const;

/** The EXACT function-leaf inventory (dotted paths — count-bearing copy). */
const FUNCTION_LEAF_PATHS = [
  "auditLinkCount",
  "cancel.reasonCounter",
  "expiryBadge.past",
  "expiryBadge.upcoming",
  "planFacts.cycle",
  "planFacts.sessions",
  "success.extend",
  "success.planChangeCarried",
  "success.planChangeForfeited",
] as const;

/**
 * Probe counts for the function leaves — the CLDR Arabic boundary set:
 * one/two apply to n = 1/2 EXACTLY, few = 3–10, many = 11–99, and other =
 * 100/101/102 with their ×100 re-entries (the adminBroadcasts counted-copy
 * mechanism's probe set).
 */
const PROBE_COUNTS = [1, 2, 3, 10, 11, 99, 100, 101, 102] as const;

/** Probe seam cap for the counter leaf (rides the second argument). */
const PROBE_MAX = 200;

/** Arabic-script probe — at least one Arabic-block character in the value. */
const ARABIC_SCRIPT = /[\u0600-\u06FF]/;

/** Type guard: the leaf is one of the declared count-bearing label functions. */
function isCountLeaf(value: unknown): value is (...args: number[]) => string {
  return typeof value === "function";
}

/**
 * Depth-first leaf paths of a locale map — grouped sub-blocks are flattened
 * into dotted paths; string AND function slots count as leaves (the
 * function-tolerant rule of the `adminBroadcasts` gate). Throws on any node
 * that is neither a string, a function, nor a grouped labels block.
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
      `subscriptionAdmin.${path} must be a non-empty localized string, a function, or a grouped labels block`
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
      throw new Error(`subscriptionAdmin.${localeName}.${path} traverses a non-block node`);
    }
    node = Reflect.get(node, segment);
  }
  if ((typeof node !== "string" && typeof node !== "function") || node.length === 0) {
    throw new Error(`subscriptionAdmin.${localeName}.${path} must be a non-empty localized string or a function`);
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
describe("compile-time parity mirror — ar/en subscriptionAdmin key sets agree", () => {
  test("identical sorted leaf-path sets across BOTH locale sources (depth-first)", () => {
    const arPaths = sortedLeafPathsOf(subscriptionAdminAr);
    const enPaths = sortedLeafPathsOf(subscriptionAdminEn);

    expect(arPaths.length).toBeGreaterThan(0);
    expect(enPaths).toEqual(arPaths);
  });

  test("every STRING leaf on BOTH maps is non-empty (zero dead keys); leaf TYPES agree per path", () => {
    for (const path of sortedLeafPathsOf(subscriptionAdminAr)) {
      const arValue = leafValueOf(subscriptionAdminAr, path, "ar");
      const enValue = leafValueOf(subscriptionAdminEn, path, "en");
      expect(typeof enValue).toBe(typeof arValue);
    }
    // Symmetric sweep — guards an en-only leaf that ar lost via future drift.
    for (const path of sortedLeafPathsOf(subscriptionAdminEn)) {
      const enValue = leafValueOf(subscriptionAdminEn, path, "en");
      const arValue = leafValueOf(subscriptionAdminAr, path, "ar");
      expect(typeof arValue).toBe(typeof enValue);
    }
  });
});

// ===========================================================================
describe("status block — pinned under BOTH locales (wire enum members)", () => {
  test("exact leaf-path set on BOTH locale sources (no key added, none dropped)", () => {
    const pinned = [...STATUS_LEAF_PATHS].toSorted((a, b) => a.localeCompare(b));

    expect(leafPathsOf(subscriptionAdminAr.status).toSorted((a, b) => a.localeCompare(b))).toEqual(pinned);
    expect(leafPathsOf(subscriptionAdminEn.status).toSorted((a, b) => a.localeCompare(b))).toEqual(pinned);
  });

  test.each([...STATUS_LEAF_PATHS])("status.%s resolves as a non-empty string in BOTH locales", path => {
    const arLeaf = leafValueOf(subscriptionAdminAr.status, path, "ar");
    const enLeaf = leafValueOf(subscriptionAdminEn.status, path, "en");
    if (typeof arLeaf !== "string" || typeof enLeaf !== "string") {
      throw new Error(`subscriptionAdmin.status.${path} must be a localized string on BOTH maps`);
    }
    expect(arLeaf.length).toBeGreaterThan(0);
    expect(enLeaf.length).toBeGreaterThan(0);
  });
});

// ===========================================================================
describe("actions block — pinned under BOTH locales (four-action lifecycle inventory)", () => {
  test("exact leaf-path set on BOTH locale sources (no key added, none dropped)", () => {
    const pinned = [...ACTIONS_LEAF_PATHS].toSorted((a, b) => a.localeCompare(b));

    expect(leafPathsOf(subscriptionAdminAr.actions).toSorted((a, b) => a.localeCompare(b))).toEqual(pinned);
    expect(leafPathsOf(subscriptionAdminEn.actions).toSorted((a, b) => a.localeCompare(b))).toEqual(pinned);
  });

  test.each([...ACTIONS_LEAF_PATHS])("actions.%s resolves as a non-empty string in BOTH locales", path => {
    const arLeaf = leafValueOf(subscriptionAdminAr.actions, path, "ar");
    const enLeaf = leafValueOf(subscriptionAdminEn.actions, path, "en");
    if (typeof arLeaf !== "string" || typeof enLeaf !== "string") {
      throw new Error(`subscriptionAdmin.actions.${path} must be a localized string on BOTH maps`);
    }
    expect(arLeaf.length).toBeGreaterThan(0);
    expect(enLeaf.length).toBeGreaterThan(0);
  });
});

// ===========================================================================
describe("function-leaf inventory — exactly the nine count-bearing slots", () => {
  test("the function slots are EXACTLY the declared inventory (no minting, no downgrade)", () => {
    const functionPaths = sortedLeafPathsOf(subscriptionAdminAr).filter(path => {
      return typeof leafValueOf(subscriptionAdminAr, path, "ar") === "function";
    });
    expect(functionPaths).toEqual([...FUNCTION_LEAF_PATHS].toSorted((a, b) => a.localeCompare(b)));
  });

  test("every function leaf resolves non-empty output carrying EACH probe count in BOTH locales", () => {
    for (const path of FUNCTION_LEAF_PATHS) {
      const arLeaf = leafValueOf(subscriptionAdminAr, path, "ar");
      const enLeaf = leafValueOf(subscriptionAdminEn, path, "en");
      if (!isCountLeaf(arLeaf) || !isCountLeaf(enLeaf)) {
        throw new Error(`subscriptionAdmin.${path} must be a count-bearing function on BOTH maps`);
      }
      for (const count of PROBE_COUNTS) {
        // The counter leaf carries the seam cap on its second argument; the
        // other slots ignore it.
        const arOutput = arLeaf(count, PROBE_MAX);
        const enOutput = enLeaf(count, PROBE_MAX);
        expect(arOutput.length).toBeGreaterThan(0);
        expect(enOutput.length).toBeGreaterThan(0);
        expect(enOutput).toContain(String(count));
        // ar spells the CLDR one/two classes as words (يوماً واحداً / يومين
        // / جلسة واحدة / جلستين — exact-pinned by the plural-branch tables
        // below), so the ar digit carry applies from the counted-plural
        // class upward (the adminBroadcasts placeholder-parity precedent:
        // digit probes ride the numeric branches only).
        if (count > 2) {
          expect(arOutput).toContain(String(count));
        } else {
          expect(ARABIC_SCRIPT.test(arOutput)).toBe(true);
        }
      }
    }
  });
});

// ===========================================================================
describe("expiry-badge branch pin — the relative-window day forms on BOTH maps", () => {
  /** The badge's two arms (the past count is strictly positive). */
  const EXPIRY_LEAF_PATHS = ["expiryBadge.past", "expiryBadge.upcoming"] as const;

  /** The upcoming arm's fixed forms: [count, ar full form, en full form]. */
  const UPCOMING_FORM_PROBES: ReadonlyArray<readonly [number, string, string]> = [
    [0, "ينتهي اليوم", "Ends today"],
    [1, "ينتهي خلال يوم واحد", "Ends in 1 day"],
    [2, "ينتهي خلال يومين", "Ends in 2 days"],
    [3, "ينتهي خلال 3 أيام", "Ends in 3 days"],
    [10, "ينتهي خلال 10 أيام", "Ends in 10 days"],
    [11, "ينتهي خلال 11 يوماً", "Ends in 11 days"],
    [99, "ينتهي خلال 99 يوماً", "Ends in 99 days"],
    [100, "ينتهي خلال 100 يوماً", "Ends in 100 days"],
  ];

  /** The past arm's fixed forms: [count, ar full form, en full form]. */
  const PAST_FORM_PROBES: ReadonlyArray<readonly [number, string, string]> = [
    [1, "انتهى منذ يوم واحد", "Expired 1 day ago"],
    [2, "انتهى منذ يومين", "Expired 2 days ago"],
    [3, "انتهى منذ 3 أيام", "Expired 3 days ago"],
    [10, "انتهى منذ 10 أيام", "Expired 10 days ago"],
    [11, "انتهى منذ 11 يوماً", "Expired 11 days ago"],
    [99, "انتهى منذ 99 يوماً", "Expired 99 days ago"],
    [100, "انتهى منذ 100 يوماً", "Expired 100 days ago"],
  ];

  test("the upcoming arm renders the exact today/one/two/few/other forms", () => {
    const arLeaf = leafValueOf(subscriptionAdminAr, "expiryBadge.upcoming", "ar");
    const enLeaf = leafValueOf(subscriptionAdminEn, "expiryBadge.upcoming", "en");
    if (!isCountLeaf(arLeaf) || !isCountLeaf(enLeaf)) {
      throw new Error("subscriptionAdmin.expiryBadge.upcoming must be a count-bearing function on BOTH maps");
    }
    for (const [count, ar, en] of UPCOMING_FORM_PROBES) {
      expect(arLeaf(count)).toBe(ar);
      expect(enLeaf(count)).toBe(en);
    }
  });

  test("the past arm renders the exact one/two/few/other forms (strictly positive counts)", () => {
    const arLeaf = leafValueOf(subscriptionAdminAr, "expiryBadge.past", "ar");
    const enLeaf = leafValueOf(subscriptionAdminEn, "expiryBadge.past", "en");
    if (!isCountLeaf(arLeaf) || !isCountLeaf(enLeaf)) {
      throw new Error("subscriptionAdmin.expiryBadge.past must be a count-bearing function on BOTH maps");
    }
    for (const [count, ar, en] of PAST_FORM_PROBES) {
      expect(arLeaf(count)).toBe(ar);
      expect(enLeaf(count)).toBe(en);
    }
  });

  test("both arms are declared function leaves (the inventory covers the badge)", () => {
    for (const path of EXPIRY_LEAF_PATHS) {
      expect(FUNCTION_LEAF_PATHS).toContain(path);
    }
  });
});

// ===========================================================================
describe("counted-copy plural-branch pin — the CLDR boundary probes on BOTH maps", () => {
  /** The two session-copy counted leaves (one shared branch-word table). */
  const SESSION_COUNT_LEAF_PATHS = ["success.planChangeCarried", "success.planChangeForfeited"] as const;

  /** Arabic branch word per boundary count: [count, session word, day word]. */
  const CLDR_BRANCH_PROBES: readonly (readonly [number, string, string])[] = [
    [1, "جلسة واحدة", "يوماً واحداً"],
    [2, "جلستين", "يومين"],
    [3, "جلسات", "أيام"],
    [10, "جلسات", "أيام"],
    [11, "جلسة", "يوماً"],
    [99, "جلسة", "يوماً"],
    [100, "جلسة", "يوماً"],
    [101, "جلسة", "يوماً"],
    [102, "جلسة", "يوماً"],
  ];

  // The Arabic session/day copy branches on the CLDR classes — singular
  // (n = 1 EXACTLY), dual (n = 2 EXACTLY), counted-plural few (3–10),
  // tamyiz-singular other (11–99 AND the 100/101/102 ×100 re-entries);
  // the EN copy branches on 1 vs the rest (session/sessions, day/days).
  test.each(CLDR_BRANCH_PROBES)(
    "count %i renders the exact plural-branch word for the sessions + days copy",
    (count, arSessionWord, arDayWord) => {
      const enSessionWord = count === 1 ? "session" : "sessions";
      const enDayWord = count === 1 ? "day" : "days";
      for (const path of SESSION_COUNT_LEAF_PATHS) {
        const arLeaf = leafValueOf(subscriptionAdminAr, path, "ar");
        const enLeaf = leafValueOf(subscriptionAdminEn, path, "en");
        if (!isCountLeaf(arLeaf) || !isCountLeaf(enLeaf)) {
          throw new Error(`subscriptionAdmin.${path} must be a count-bearing function on BOTH maps`);
        }
        expect(arLeaf(count, PROBE_MAX)).toContain(arSessionWord);
        expect(enLeaf(count, PROBE_MAX)).toContain(enSessionWord);
      }
      const arExtend = leafValueOf(subscriptionAdminAr, "success.extend", "ar");
      const enExtend = leafValueOf(subscriptionAdminEn, "success.extend", "en");
      if (!isCountLeaf(arExtend) || !isCountLeaf(enExtend)) {
        throw new Error("subscriptionAdmin.success.extend must be a count-bearing function on BOTH maps");
      }
      expect(arExtend(count, PROBE_MAX)).toContain(arDayWord);
      expect(enExtend(count, PROBE_MAX)).toContain(enDayWord);
    }
  );
});

// ===========================================================================
describe("zero-count pin — 0 renders the suppressed plain form (no counted clause)", () => {
  /**
   * Probe 0 rides THIS block, not `PROBE_COUNTS`: the generic probe loop
   * pins the count digit in the output, while the zero arm SUPPRESSES the
   * counted clause entirely (the plain success line — exactly what the
   * hook's `planChangeToast` renders when the chosen arm's count is 0, so
   * a 0 can never fall through to a broken "0 sessions / تم ترحيل 0 جلسة" form).
   */
  const ZERO_PLAIN_FORMS: ReadonlyArray<readonly [path: string, en: string, ar: string]> = [
    ["success.planChangeCarried", "Plan changed.", "تم تغيير الخطة."],
    ["success.planChangeForfeited", "Plan changed.", "تم تغيير الخطة."],
  ];

  test.each(ZERO_PLAIN_FORMS)("%s renders the plain suppressed form at count 0 on BOTH maps", (path, en, ar) => {
    const arLeaf = leafValueOf(subscriptionAdminAr, path, "ar");
    const enLeaf = leafValueOf(subscriptionAdminEn, path, "en");
    if (!isCountLeaf(arLeaf) || !isCountLeaf(enLeaf)) {
      throw new Error(`subscriptionAdmin.${path} must be a count-bearing function on BOTH maps`);
    }
    expect(arLeaf(0, PROBE_MAX)).toBe(ar);
    expect(enLeaf(0, PROBE_MAX)).toBe(en);
    expect(ARABIC_SCRIPT.test(ar)).toBe(true);
  });

  test("the plain success line label itself carries the suppressed form on BOTH maps", () => {
    expect(subscriptionAdminEn.success.planChange).toBe("Plan changed.");
    expect(subscriptionAdminAr.success.planChange).toBe("تم تغيير الخطة.");
  });
});

// ===========================================================================
describe("no English fallthrough — ar map carries Arabic copy for every slot", () => {
  test("every ar STRING leaf contains Arabic script", () => {
    const fallthroughs = sortedLeafPathsOf(subscriptionAdminAr).filter(path => {
      const value = leafValueOf(subscriptionAdminAr, path, "ar");
      return typeof value === "string" && !ARABIC_SCRIPT.test(value);
    });
    expect(fallthroughs).toHaveLength(0);
  });

  test("every ar FUNCTION leaf returns Arabic-script output", () => {
    for (const path of FUNCTION_LEAF_PATHS) {
      const leaf = leafValueOf(subscriptionAdminAr, path, "ar");
      if (!isCountLeaf(leaf)) {
        throw new Error(`subscriptionAdmin.ar.${path} must be a count-bearing function`);
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
    for (const path of sortedLeafPathsOf(subscriptionAdminAr)) {
      const arValue = leafValueOf(subscriptionAdminAr, path, "ar");
      if (typeof arValue !== "string") {
        continue;
      }
      const enValue = leafValueOf(subscriptionAdminEn, path, "en");
      if (typeof enValue !== "string") {
        throw new Error(`subscriptionAdmin.en.${path} drifted off the ar map's string slot`);
      }
      const arNames = icuPlaceholdersOf(arValue);
      const enNames = icuPlaceholdersOf(enValue);
      expect(enNames).toEqual(arNames);
    }
  });
});

// ===========================================================================
describe("registry + bundle wiring", () => {
  test("namespaces registry exposes the SubscriptionAdmin handle with the `<ns>.<ns>` id convention", () => {
    expect(Object.hasOwn(namespaces, "SubscriptionAdmin")).toBe(true);
    expect(SubscriptionAdmin.id).toBe("subscriptionAdmin.subscriptionAdmin");
  });

  test("handle getter resolves the composed bundle slice (both locales)", () => {
    expect(SubscriptionAdmin.getLabels(enMessages)).toBe(enMessages.subscriptionAdminTranslations);
    expect(SubscriptionAdmin.getLabels(arMessages)).toBe(arMessages.subscriptionAdminTranslations);
  });

  test("`subscriptionAdminTranslations` exists on BOTH message bundles", () => {
    expect(Object.hasOwn(enMessages, "subscriptionAdminTranslations")).toBe(true);
    expect(Object.hasOwn(arMessages, "subscriptionAdminTranslations")).toBe(true);
  });
});
