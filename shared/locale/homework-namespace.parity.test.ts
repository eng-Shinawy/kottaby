/**
 * `homework`-namespace locale verification
 * · ar+en parity gates over the NEW `homework` UI namespace (the student
 *   homework-history page at `/homework`).
 *
 * WHAT THIS LOCKS
 *   1. HOMEWORK PARITY BELT — the ar/en `homework` leaf maps expose IDENTICAL
 *      key sets with non-empty string values (belt #2: the PRIMARY parity
 *      gate is compile-time typing where BOTH leaf consts are typed
 *      `HomeworkLabels`; any missing key fails `bun tsgo`). This suite keeps
 *      the guarantee enforced even if someone loosens that typing later.
 *      The function-valued keys (`sessionLine`, `countLine`) agree across
 *      locales on their argument arity.
 *   2. REGISTRY WIRING — the `Homework` handle is registered in
 *      `shared/locale/namespaces/registry.ts` with the conventional
 *      `<ns>.<ns>` id and its getter resolves to the composed bundle slice;
 *      both message bundles carry `homeworkTranslations`.
 *   3. SYNC RESOLUTION — `getTranslations(locale)` (pure, in-memory, never
 *      suspends) resolves a sample of the new keys in BOTH locales.
 *   4. ARABIC-SCRIPT SANITY — sampled Arabic values actually contain Arabic
 *      script (guards a copy paste of English into the `ar` leaf).
 *   5. PLURAL-ARM AGREEMENT — the `countLine` plural vocabulary returns
 *      DISTINCT forms for the singular/dual/few/many Arabic arms and the
 *      singular/plural English arms (the page renders this line above the
 *      list, so a degenerate copy would read wrong in the common 1/2-row
 *      cases).
 *   6. TRACK TERMINOLOGY ALIGNMENT — the homework track headings agree with
 *      the parent-monitoring namespace's track copy (the two homework
 *      surfaces — student page and parent portal tab — must speak one
 *      Jadid/Madi vocabulary; the keys stay namespace-local, the WORDS do
 *      not fork).
 *
 * Mirrors the structure of `shared/locale/schedule-namespace.parity.test.ts`.
 *
 * Pure unit tier — NO server boot, NO network, NO DB.
 */

import { describe, expect, test } from "bun:test";
import { homeworkAr } from "@/shared/locale/ar/homework";
import { arMessages } from "@/shared/locale/ar/messages";
import { parentMonitoringAr } from "@/shared/locale/ar/parentMonitoring";
import { homeworkEn } from "@/shared/locale/en/homework";
import { enMessages } from "@/shared/locale/en/messages";
import { parentMonitoringEn } from "@/shared/locale/en/parentMonitoring";
import { Homework } from "@/shared/locale/namespaces/homework";
import { namespaces } from "@/shared/locale/namespaces/index";
import { getTranslations } from "@/shared/locale/server";

// ─── Mandated registries ─────────────────────────────────────────────────────

/** Every string-valued key on the `HomeworkLabels` interface (parity belt surface). */
const HOMEWORK_STRING_KEYS = [
  "pageTitle",
  "listHeading",
  "summaryTotalLabel",
  "summaryGradedLabel",
  "summaryPendingLabel",
  "trackJadid",
  "trackMadi",
  "trackNoneAssigned",
  "gradeLabel",
  "assignedPrefix",
  "emptyTitle",
  "emptyBody",
  "errorTitle",
  "errorBody",
  "loadingLabel",
  "searchPlaceholder",
  "searchClearLabel",
  "searchNoResults",
  "searchEmptyBody",
] as const;

/** The function-valued keys with their required argument arity. */
const HOMEWORK_FUNCTION_KEYS = {
  sessionLine: 1,
  countLine: 1,
} as const;

/** Sampled keys for the sync-resolution + Arabic-script gates. */
const ARABIC_SAMPLE_KEYS = ["pageTitle", "listHeading", "emptyTitle", "emptyBody"] as const;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Arabic-script presence probe (U+0600–U+06FF). */
function containsArabicScript(value: string): boolean {
  return /[\u0600-\u06FF]/.test(value);
}

/** Asserts the value is a non-empty string (or an empty string is a fail). */
function expectNonEmptyString(value: unknown, label: string): void {
  expect(typeof value, `${label} must be a string`).toBe("string");
  expect(value, `${label} must be non-empty`).not.toBe("");
}

// ─── 1. Homework parity belt ─────────────────────────────────────────────────

describe("homework namespace — ar/en parity belt", () => {
  for (const key of HOMEWORK_STRING_KEYS) {
    test(`homework.${key}: non-empty in BOTH locales`, () => {
      expectNonEmptyString(homeworkEn[key], `homeworkEn.${key}`);
      expectNonEmptyString(homeworkAr[key], `homeworkAr.${key}`);
    });
  }

  test("arabic leaf carries Arabic script on sampled keys", () => {
    for (const key of ARABIC_SAMPLE_KEYS) {
      expect(containsArabicScript(homeworkAr[key]), `homeworkAr.${key} must be Arabic script`).toBe(true);
    }
  });

  test("function-valued keys agree on argument arity across locales", () => {
    for (const [key, arity] of Object.entries(HOMEWORK_FUNCTION_KEYS)) {
      expect(Reflect.get(homeworkEn, key)).toHaveLength(arity);
      expect(Reflect.get(homeworkAr, key)).toHaveLength(arity);
    }
  });

  test("sessionLine interpolates the session number in both locales", () => {
    expect(homeworkEn.sessionLine(42)).toContain("42");
    const ar = homeworkAr.sessionLine(42);
    expect(ar).toContain("42");
    expect(containsArabicScript(ar)).toBe(true);
  });
});

// ─── 2. Registry wiring ──────────────────────────────────────────────────────

describe("homework namespace — registry wiring", () => {
  test("Homework handle registered with the conventional homework.homework id", () => {
    expect(Homework.id).toBe("homework.homework");
    expect(namespaces.Homework).toBe(Homework);
  });

  test("both message bundles carry homeworkTranslations", () => {
    expect(enMessages.homeworkTranslations).toBe(homeworkEn);
    expect(arMessages.homeworkTranslations).toBe(homeworkAr);
  });

  test("the Homework getter resolves the composed bundle slice", () => {
    expect(Homework.getLabels(enMessages)).toBe(homeworkEn);
    expect(Homework.getLabels(arMessages)).toBe(homeworkAr);
  });
});

// ─── 3/4. Sync resolution + script sanity ────────────────────────────────────

describe("homework namespace — sync resolution through getTranslations", () => {
  test("en resolves the sampled keys", () => {
    const t = getTranslations("en").homeworkTranslations;
    expect(t.pageTitle).toBe(homeworkEn.pageTitle);
    expect(t.listHeading).toBe(homeworkEn.listHeading);
    expect(t.summaryPendingLabel).toBe(homeworkEn.summaryPendingLabel);
  });

  test("ar resolves the sampled keys (Arabic script)", () => {
    const t = getTranslations("ar").homeworkTranslations;
    expect(t.pageTitle).toBe(homeworkAr.pageTitle);
    expect(containsArabicScript(t.pageTitle)).toBe(true);
    expect(containsArabicScript(t.emptyBody)).toBe(true);
  });
});

// ─── 5. Plural-arm agreement ─────────────────────────────────────────────────

describe("homework namespace — countLine plural arms", () => {
  test("en arms are distinct (singular/plural)", () => {
    const enForms = new Set([homeworkEn.countLine(0), homeworkEn.countLine(1), homeworkEn.countLine(5)]);
    expect(enForms.size).toBe(3);
  });

  test("ar arms cover the 1/2/3-10/11+ vocabulary", () => {
    expect(homeworkAr.countLine(1)).toContain("واجب واحد");
    expect(homeworkAr.countLine(2)).toContain("واجبان");
    expect(homeworkAr.countLine(7)).toContain("واجبات");
    expect(homeworkAr.countLine(11)).toContain("واجبًا");
    expect(containsArabicScript(homeworkAr.countLine(7))).toBe(true);
  });
});

// ─── 6. Track terminology alignment with the parent portal ───────────────────

describe("homework namespace — track vocabulary alignment", () => {
  test("jadid/madi/none-assigned copy matches the parent-monitoring namespace verbatim", () => {
    expect(homeworkEn.trackJadid).toBe(parentMonitoringEn.trackJadid);
    expect(homeworkEn.trackMadi).toBe(parentMonitoringEn.trackMadi);
    expect(homeworkEn.trackNoneAssigned).toBe(parentMonitoringEn.trackNoneAssigned);
    expect(homeworkAr.trackJadid).toBe(parentMonitoringAr.trackJadid);
    expect(homeworkAr.trackMadi).toBe(parentMonitoringAr.trackMadi);
    expect(homeworkAr.trackNoneAssigned).toBe(parentMonitoringAr.trackNoneAssigned);
  });
});

// ─── 7. Search-vocabulary alignment with the parent portal ──────────────────

describe("homework namespace — search vocabulary alignment", () => {
  test("search copy matches the parent-monitoring search keys verbatim", () => {
    // The student page renders the SHARED SearchFilterBar with its own
    // namespace-local copy — the words must not fork between the two
    // homework surfaces (keys stay namespace-local, the copy does not).
    expect(homeworkEn.searchClearLabel).toBe(parentMonitoringEn.searchClearLabel);
    expect(homeworkEn.searchNoResults).toBe(parentMonitoringEn.searchNoResults);
    expect(homeworkAr.searchClearLabel).toBe(parentMonitoringAr.searchClearLabel);
    expect(homeworkAr.searchNoResults).toBe(parentMonitoringAr.searchNoResults);
  });

  test("search placeholder names the probed fields (passage + date)", () => {
    expect(containsArabicScript(homeworkAr.searchPlaceholder)).toBe(true);
    expect(containsArabicScript(homeworkAr.searchEmptyBody)).toBe(true);
  });
});
