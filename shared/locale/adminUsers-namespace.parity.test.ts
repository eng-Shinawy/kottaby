/**
 * `adminUsers`-namespace locale-parity verification
 * · ar+en parity gate + Arabic-script sweep + auditTrail block pin + registry wiring.
 *
 * WHAT THIS LOCKS
 *   1. RUNTIME PARITY BELT — the ar/en `adminUsers` leaf maps expose IDENTICAL
 *      depth-first leaf-path sets where every leaf is a non-empty localized
 *      string (belt #2: the PRIMARY parity gate is compile-time typing where
 *      BOTH leaf consts are typed `AdminUsersLabels`; any missing key fails
 *      `bun tsgo`. This suite keeps the guarantee enforced even if someone
 *      loosens that typing later).
 *   2. AUDIT-TRAIL BLOCK PIN — every key of the `auditTrail` block (page
 *      title/subtitle, filter labels + apply/clear, table headers, details
 *      show/hide + null placeholders, empty/error states) is pinned under
 *      BOTH locales — a key dropped from both maps simultaneously still
 *      fails this suite.
 *   3. NO ENGLISH FALLTHROUGH — every ar leaf contains Arabic script except
 *      the locale-neutral em-dash null placeholder, which is exact-pinned
 *      to `—` wherever copy has nothing to show.
 *   4. SINGLE ACTION VOCABULARY — the seven `activity.action*` chip labels
 *      are the canonical action vocabulary for the whole admin-users domain
 *      (the audit-trail action column reuses them); the `auditTrail` block
 *      carries ZERO action-chip keys of its own so near-duplicate action
 *      labels cannot be minted.
 *   5. PLACEHOLDER-NAME PARITY — ICU placeholder-name sets are IDENTICAL
 *      across ar/en per auditTrail key (currently zero placeholders; future
 *      keys with interpolation inherit the pin).
 *   6. REGISTRY WIRING — the `AdminUsers` handle is registered in
 *      `shared/locale/namespaces/index.ts` with the conventional `<ns>.<ns>`
 *      id and its getter resolves the composed bundle slice.
 *
 * Mirrors the structure of `shared/locale/handshakeCode-namespace.parity.test.ts`
 * (the sibling namespace gate), extended with a depth-first leaf walk for
 * this namespace's grouped sub-blocks.
 *
 * Pure unit tier — NO server boot, NO network, NO DB. Runs via the mandated
 * runner: `bun run test/scripts/run-test.ts shared/locale/adminUsers-namespace.parity.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import { adminUsersAr } from "@/shared/locale/ar/adminUsers";
import { arMessages } from "@/shared/locale/ar/messages";
import { adminUsersEn } from "@/shared/locale/en/adminUsers";
import { enMessages } from "@/shared/locale/en/messages";
import { AdminUsers } from "@/shared/locale/namespaces/adminUsers";
import { namespaces } from "@/shared/locale/namespaces/index";

// ─── Mandated inventory of the audit-trail read surface ──────────────────────

/**
 * Every leaf key the `auditTrail` block must carry (25 slots) — dotted paths
 * RELATIVE to the block root, grouped by sub-block.
 */
const AUDIT_TRAIL_LEAF_PATHS = [
  "pageTitle",
  "pageSubtitle",
  "filters.actorIdLabel",
  "filters.entityTypeLabel",
  "filters.entityIdLabel",
  "filters.actionTypeLabel",
  "filters.fromDateLabel",
  "filters.toDateLabel",
  "filters.applyAction",
  "filters.clearAction",
  "table.whenHeader",
  "table.actorHeader",
  "table.actionHeader",
  "table.entityTypeHeader",
  "table.entityIdHeader",
  "table.detailsHeader",
  "table.detailsShowLabel",
  "table.detailsHideLabel",
  "table.noDetailsValue",
  "table.noEntityIdValue",
  "table.allActionsOption",
  "emptyState.title",
  "emptyState.message",
  "errorState.title",
  "errorState.message",
] as const;

/**
 * The seven canonical action-chip keys — rendering vocabulary for BOTH the
 * per-user activity timeline and the audit-trail action column.
 */
const ACTION_CHIP_KEYS = [
  "actionCreate",
  "actionUpdate",
  "actionDelete",
  "actionReactivate",
  "actionOverride",
  "actionAdjust",
  "actionSuspend",
] as const;

/** Locale-neutral null placeholder for copy slots with nothing to show. */
const NULL_PLACEHOLDER = "—";

/** Arabic-script probe — at least one Arabic-block character in the value. */
const ARABIC_SCRIPT = /[\u0600-\u06FF]/;

/**
 * Depth-first leaf paths of a locale map — grouped sub-blocks are flattened
 * into dotted paths so nested blocks keep the same zero-dead-key discipline
 * as top-level string slots. Throws on any node that is neither a string nor
 * a grouped labels block.
 */
function leafPathsOf(localeMap: object, prefix = ""): string[] {
  const paths: string[] = [];
  for (const key of Object.keys(localeMap)) {
    const value: unknown = Reflect.get(localeMap, key);
    const path = prefix.length === 0 ? key : `${prefix}.${key}`;
    if (typeof value === "string") {
      paths.push(path);
      continue;
    }
    if (value !== null && typeof value === "object") {
      paths.push(...leafPathsOf(value, path));
      continue;
    }
    throw new Error(`adminUsers.${path} must be a non-empty localized string or a grouped labels block`);
  }
  return paths;
}

/** Locale-sorted leaf paths of a locale map (stable comparison key set). */
function sortedLeafPathsOf(localeMap: object): string[] {
  return leafPathsOf(localeMap).toSorted((a, b) => a.localeCompare(b));
}

/** Reads one leaf value off a locale map by dotted path — throws otherwise. */
function leafValueOf(localeMap: object, path: string, localeName: string): string {
  let node: unknown = localeMap;
  for (const segment of path.split(".")) {
    if (node === null || typeof node !== "object") {
      throw new Error(`adminUsers.${localeName}.${path} traverses a non-block node`);
    }
    node = Reflect.get(node, segment);
  }
  if (typeof node !== "string" || node.length === 0) {
    throw new Error(`adminUsers.${localeName}.${path} must be a non-empty localized string`);
  }
  return node;
}

/** Every `{name}` ICU placeholder occurring in a template, deduplicated + sorted. */
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
describe("compile-time parity mirror — ar/en adminUsers key sets agree", () => {
  test("identical sorted leaf-path sets across BOTH locale sources (depth-first)", () => {
    const arPaths = sortedLeafPathsOf(adminUsersAr);
    const enPaths = sortedLeafPathsOf(adminUsersEn);

    expect(arPaths.length).toBeGreaterThan(0);
    expect(enPaths).toEqual(arPaths);
  });

  test("every leaf value on BOTH maps is a non-empty localized string (zero dead keys)", () => {
    for (const path of sortedLeafPathsOf(adminUsersAr)) {
      expect(leafValueOf(adminUsersAr, path, "ar").length).toBeGreaterThan(0);
    }
    // Symmetric sweep — guards an en-only leaf that ar lost via future drift.
    for (const path of sortedLeafPathsOf(adminUsersEn)) {
      expect(leafValueOf(adminUsersEn, path, "en").length).toBeGreaterThan(0);
    }
  });
});

// ===========================================================================
describe("auditTrail block — pinned under BOTH locales", () => {
  test("exact leaf-path set on BOTH locale sources (no key added, none dropped)", () => {
    const pinned = [...AUDIT_TRAIL_LEAF_PATHS].toSorted((a, b) => a.localeCompare(b));

    expect(leafPathsOf(adminUsersAr.auditTrail).toSorted((a, b) => a.localeCompare(b))).toEqual(pinned);
    expect(leafPathsOf(adminUsersEn.auditTrail).toSorted((a, b) => a.localeCompare(b))).toEqual(pinned);
  });

  test.each([...AUDIT_TRAIL_LEAF_PATHS])("auditTrail.%s resolves as a non-empty string in BOTH locales", path => {
    expect(leafValueOf(adminUsersAr.auditTrail, path, "ar").length).toBeGreaterThan(0);
    expect(leafValueOf(adminUsersEn.auditTrail, path, "en").length).toBeGreaterThan(0);
  });

  test("null placeholders are exact-pinned to the locale-neutral em-dash in BOTH locales", () => {
    for (const path of ["table.noDetailsValue", "table.noEntityIdValue"] as const) {
      expect(leafValueOf(adminUsersAr.auditTrail, path, "ar")).toBe(NULL_PLACEHOLDER);
      expect(leafValueOf(adminUsersEn.auditTrail, path, "en")).toBe(NULL_PLACEHOLDER);
    }
  });
});

// ===========================================================================
describe("no English fallthrough — ar map carries Arabic copy for every prose slot", () => {
  test("every ar leaf contains Arabic script (locale-neutral em-dash placeholder tolerated)", () => {
    const fallthroughs = sortedLeafPathsOf(adminUsersAr).filter(path => {
      const value = leafValueOf(adminUsersAr, path, "ar");
      return !ARABIC_SCRIPT.test(value) && value !== NULL_PLACEHOLDER;
    });
    expect(fallthroughs).toHaveLength(0);
  });
});

// ===========================================================================
describe("single action vocabulary — activity.action* reused, no near-duplicates minted", () => {
  test.each([...ACTION_CHIP_KEYS])("canonical action chip `%s` resolves as a non-empty string in BOTH locales", key => {
    expect(leafValueOf(adminUsersAr.activity, key, "ar").length).toBeGreaterThan(0);
    expect(leafValueOf(adminUsersEn.activity, key, "en").length).toBeGreaterThan(0);
  });

  test("the seven action-chip labels are pairwise distinct within EACH locale (no merged copy)", () => {
    for (const [localeMap, localeName] of [
      [adminUsersAr, "ar"],
      [adminUsersEn, "en"],
    ] as const) {
      const values = ACTION_CHIP_KEYS.map(key => leafValueOf(localeMap.activity, key, localeName));
      expect(new Set(values).size).toBe(ACTION_CHIP_KEYS.length);
    }
  });

  test("auditTrail mints ZERO action-chip keys of its own (action rendering reuses activity.action*)", () => {
    const minted = leafPathsOf(adminUsersAr.auditTrail).filter(path =>
      (ACTION_CHIP_KEYS as readonly string[]).includes(path.split(".").pop() ?? "")
    );
    expect(minted).toHaveLength(0);
  });
});

// ===========================================================================
describe("placeholder-name sets are IDENTICAL across ar/en per auditTrail key", () => {
  test("per-key placeholder-name sets agree ar/en (currently zero placeholders)", () => {
    for (const path of AUDIT_TRAIL_LEAF_PATHS) {
      const arNames = icuPlaceholdersOf(leafValueOf(adminUsersAr.auditTrail, path, "ar"));
      const enNames = icuPlaceholdersOf(leafValueOf(adminUsersEn.auditTrail, path, "en"));
      expect(enNames).toEqual(arNames);
    }
  });
});

// ===========================================================================
describe("registry + bundle wiring", () => {
  test("namespaces registry exposes the AdminUsers handle with the `<ns>.<ns>` id convention", () => {
    expect(Object.hasOwn(namespaces, "AdminUsers")).toBe(true);
    expect(AdminUsers.id).toBe("adminUsers.adminUsers");
  });

  test("handle getter resolves the composed bundle slice (both locales)", () => {
    expect(AdminUsers.getLabels(enMessages)).toBe(enMessages.adminUsersTranslations);
    expect(AdminUsers.getLabels(arMessages)).toBe(arMessages.adminUsersTranslations);
  });

  test("`adminUsersTranslations` exists on BOTH message bundles", () => {
    expect(Object.hasOwn(enMessages, "adminUsersTranslations")).toBe(true);
    expect(Object.hasOwn(arMessages, "adminUsersTranslations")).toBe(true);
  });
});
