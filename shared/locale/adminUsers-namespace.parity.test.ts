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
 *   7. CHANGE-PASSWORD SURFACE PIN — every key of the `changePasswordDialog`
 *      block plus the standalone `changePasswordAction`,
 *      `detail.mustChangePasswordLabel`, `detail.mustChangePasswordValue`, and
 *      `snackbars.passwordChanged` leaves is pinned under BOTH locales — a key
 *      dropped from both maps simultaneously still fails this suite. All
 *      twelve leaves are flat strings (no function leaves — the dialog block
 *      adds none and none may ever be minted for this surface).
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
 * Every leaf key the `auditTrail` block must carry (48 slots) — dotted paths
 * RELATIVE to the block root, grouped by sub-block.
 */
const AUDIT_TRAIL_LEAF_PATHS = [
  "pageTitle",
  "pageSubtitle",
  "filteredViewLabel",
  "filters.actorIdLabel",
  "filters.entityTypeLabel",
  "filters.entityTypeHint",
  "filters.entityIdLabel",
  "filters.actionTypeLabel",
  "filters.fromDateLabel",
  "filters.toDateLabel",
  "filters.applyAction",
  "filters.clearAction",
  "filters.quickPickCaption",
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
  "table.entityRefCopy",
  "table.entityRefCopied",
  "table.actorLinkLabel",
  "table.userEntityLinkLabel",
  "entityTypeLabels.user",
  "entityTypeLabels.teacher",
  "entityTypeLabels.applicant",
  "entityTypeLabels.session",
  "entityTypeLabels.subscription",
  "entityTypeLabels.plan",
  "entityTypeLabels.teacherTransaction",
  "entityTypeLabels.parentLinkRequest",
  "entityTypeLabels.parentLinkRequestDecision",
  "entityTypeLabels.parentLinkRequestExpiry",
  "entityTypeLabels.notificationBroadcast",
  "emptyState.title",
  "emptyState.message",
  "errorState.title",
  "errorState.message",
  "export.exportPageCsv",
  "export.exportPageCsvEmpty",
  "export.exportedRows",
  "export.exportFailed",
  "export.exportAllCsv",
  "export.exportTruncated",
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

/**
 * Mandated inventory of the admin-ordered re-evaluation affordance (the
 * `orderReEvaluation` block) — 8 slots.
 */
const ORDER_RE_EVALUATION_LEAF_PATHS = [
  "action",
  "dialogTitle",
  "reasonLabel",
  "reasonRequiredHint",
  "feeExplanation",
  "confirm",
  "cancel",
  "successToast",
] as const;

/**
 * Every leaf key the `changePasswordDialog` block must carry (8 slots) —
 * dotted paths RELATIVE to the block root. Flat admin chrome copy only.
 */
const CHANGE_PASSWORD_DIALOG_LEAF_PATHS = [
  "title",
  "subtitle",
  "newPasswordLabel",
  "confirmPasswordLabel",
  "mustChangePasswordLabel",
  "mustChangePasswordHelper",
  "submit",
  "cancel",
] as const;

/**
 * The four change-password leaves living OUTSIDE the dialog block — the
 * directory/hero action label, the detail governance-card flag label + value,
 * and the success snackbar. Dotted paths relative to the namespace root.
 */
const CHANGE_PASSWORD_FLAT_PATHS = [
  "changePasswordAction",
  "detail.mustChangePasswordLabel",
  "detail.mustChangePasswordValue",
  "snackbars.passwordChanged",
] as const;

/** Locale-neutral null placeholder for copy slots with nothing to show. */
const NULL_PLACEHOLDER = "—";

/** Arabic-script probe — at least one Arabic-block character in the value. */
const ARABIC_SCRIPT = /[\u0600-\u06FF]/;

/**
 * The function-valued caption slots of the activity block — count-aware
 * leaves (`(days: number) => string`) rather than plain strings. They join
 * the key-set parity sweep like any leaf; their OUTPUT is pinned by the
 * dedicated function-slot block below (the parentMonitoring pattern).
 */
const FUNCTION_SLOT_PATHS = ["activity.captionCooldownDays", "activity.captionCooldownExtended"] as const;

/** Sample day count exercising the pluralizer leaves. */
const CAPTION_SAMPLE_DAYS = 7;

const isFunctionSlotPath = (path: string): boolean => (FUNCTION_SLOT_PATHS as readonly string[]).includes(path);

/**
 * Type guard for the count-aware caption slots — narrows a traversed node
 * to the `(days: number) => string` pluralizer signature (the
 * `no-unsafe-type-assertion`-compliant alternative to an `as` cast).
 */
function isDayCountCaption(value: unknown): value is (days: number) => string {
  return typeof value === "function";
}

/** Resolves + invokes one function-valued slot by dotted path. */
function functionSlotOutputOf(localeMap: object, path: string): string {
  let node: unknown = localeMap;
  for (const segment of path.split(".")) {
    if (node === null || typeof node !== "object") {
      throw new Error(`adminUsers.${path} traverses a non-block node`);
    }
    node = Reflect.get(node, segment);
  }
  if (!isDayCountCaption(node)) {
    throw new Error(`adminUsers.${path} must be a function-valued caption slot`);
  }
  return node(CAPTION_SAMPLE_DAYS);
}

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
    if (typeof value === "function") {
      // Count-aware caption slots are function leaves — the parity set
      // includes them; their output is pinned by the function-slot block.
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

/** Invokes the ar `activity.captionCooldownDays` pluralizer slot for one day count. */
function arDays(days: number): string {
  return adminUsersAr.activity.captionCooldownDays(days);
}

/** Invokes the en `activity.captionCooldownDays` pluralizer slot for one day count. */
function enDays(days: number): string {
  return adminUsersEn.activity.captionCooldownDays(days);
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
      const value = isFunctionSlotPath(path)
        ? functionSlotOutputOf(adminUsersAr, path)
        : leafValueOf(adminUsersAr, path, "ar");
      expect(value.length).toBeGreaterThan(0);
    }
    // Symmetric sweep — guards an en-only leaf that ar lost via future drift.
    for (const path of sortedLeafPathsOf(adminUsersEn)) {
      const value = isFunctionSlotPath(path)
        ? functionSlotOutputOf(adminUsersEn, path)
        : leafValueOf(adminUsersEn, path, "en");
      expect(value.length).toBeGreaterThan(0);
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
describe("change-password surface — pinned under BOTH locales", () => {
  test("exact changePasswordDialog leaf-path set on BOTH locale sources (no key added, none dropped)", () => {
    const pinned = [...CHANGE_PASSWORD_DIALOG_LEAF_PATHS].toSorted((a, b) => a.localeCompare(b));

    expect(leafPathsOf(adminUsersAr.changePasswordDialog).toSorted((a, b) => a.localeCompare(b))).toEqual(pinned);
    expect(leafPathsOf(adminUsersEn.changePasswordDialog).toSorted((a, b) => a.localeCompare(b))).toEqual(pinned);
  });

  test.each([...CHANGE_PASSWORD_DIALOG_LEAF_PATHS])(
    "changePasswordDialog.%s resolves as a non-empty string in BOTH locales",
    path => {
      expect(leafValueOf(adminUsersAr.changePasswordDialog, path, "ar").length).toBeGreaterThan(0);
      expect(leafValueOf(adminUsersEn.changePasswordDialog, path, "en").length).toBeGreaterThan(0);
    }
  );

  test.each([...CHANGE_PASSWORD_FLAT_PATHS])(
    "change-password leaf `%s` resolves as a non-empty string in BOTH locales",
    path => {
      expect(leafValueOf(adminUsersAr, path, "ar").length).toBeGreaterThan(0);
      expect(leafValueOf(adminUsersEn, path, "en").length).toBeGreaterThan(0);
    }
  );

  test("all twelve change-password leaves are flat strings — ZERO function leaves on the surface", () => {
    const allLeafPaths = [
      ...CHANGE_PASSWORD_DIALOG_LEAF_PATHS.map(path => `changePasswordDialog.${path}`),
      ...CHANGE_PASSWORD_FLAT_PATHS,
    ];
    for (const [localeMap, localeName] of [
      [adminUsersAr, "ar"],
      [adminUsersEn, "en"],
    ] as const) {
      for (const path of allLeafPaths) {
        // leafValueOf throws on any non-string node — a function leaf minted
        // on this surface would fail the suite right here.
        expect(leafValueOf(localeMap, path, localeName)).toBeDefined();
      }
    }
  });
});

// ===========================================================================
describe("no English fallthrough — ar map carries Arabic copy for every prose slot", () => {
  test("every ar leaf contains Arabic script (locale-neutral em-dash placeholder tolerated)", () => {
    const fallthroughs = sortedLeafPathsOf(adminUsersAr).filter(path => {
      const value = isFunctionSlotPath(path)
        ? functionSlotOutputOf(adminUsersAr, path)
        : leafValueOf(adminUsersAr, path, "ar");
      return !ARABIC_SCRIPT.test(value) && value !== NULL_PLACEHOLDER;
    });
    expect(fallthroughs).toHaveLength(0);
  });
});

// ===========================================================================
describe("activity caption function slots — count-aware leaves pinned on BOTH locales", () => {
  test.each([...FUNCTION_SLOT_PATHS])(
    "%s resolves to a non-empty string on BOTH locales for the sample count",
    path => {
      expect(functionSlotOutputOf(adminUsersAr, path).length).toBeGreaterThan(0);
      expect(functionSlotOutputOf(adminUsersEn, path).length).toBeGreaterThan(0);
    }
  );

  test("ar plural classes stay distinct across the count grammar (1 / 2 / 3–10 / 11+)", () => {
    const outputs = [arDays(1), arDays(2), arDays(7), arDays(30)];
    // Every class output is non-empty, Arabic-scripted, and pairwise distinct.
    for (const output of outputs) {
      expect(output.length).toBeGreaterThan(0);
      expect(ARABIC_SCRIPT.test(output)).toBe(true);
    }
    expect(new Set(outputs).size).toBe(outputs.length);
  });

  test("en plural classes stay distinct across the count grammar (1 vs many)", () => {
    expect(enDays(1)).toContain("1 day");
    expect(enDays(1)).not.toContain("days");
    expect(enDays(30)).toContain("30 days");
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
describe("orderReEvaluation block — pinned under BOTH locales + amount-free fee copy", () => {
  test("exact leaf-path set on BOTH locale sources (no key added, none dropped)", () => {
    const pinned = [...ORDER_RE_EVALUATION_LEAF_PATHS].toSorted((a, b) => a.localeCompare(b));

    expect(leafPathsOf(adminUsersAr.orderReEvaluation).toSorted((a, b) => a.localeCompare(b))).toEqual(pinned);
    expect(leafPathsOf(adminUsersEn.orderReEvaluation).toSorted((a, b) => a.localeCompare(b))).toEqual(pinned);
  });

  test.each([...ORDER_RE_EVALUATION_LEAF_PATHS])(
    "orderReEvaluation.%s resolves as a non-empty string in BOTH locales",
    path => {
      expect(leafValueOf(adminUsersAr.orderReEvaluation, path, "ar").length).toBeGreaterThan(0);
      expect(leafValueOf(adminUsersEn.orderReEvaluation, path, "en").length).toBeGreaterThan(0);
    }
  );

  test("feeExplanation carries NO hardcoded amount or currency figures in EITHER locale", () => {
    // Pricing is server-owned: the copy explains the deduction generically
    // ("the re-evaluation fee") — a digit anywhere would hardcode the
    // provisional product-owned fee into shipped UI copy.
    for (const [localeMap, localeName] of [
      [adminUsersAr.orderReEvaluation, "ar"],
      [adminUsersEn.orderReEvaluation, "en"],
    ] as const) {
      expect(/\d/.test(leafValueOf(localeMap, "feeExplanation", localeName))).toBe(false);
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
