/**
 * `teacherDirectory`-namespace locale-parity verification
 * · ar+en parity gate + frozen-key-set pin + Arabic-script sanity.
 *
 * WHAT THIS LOCKS
 *   1. TEACHERDIRECTORY PARITY BELT — the ar/en `teacherDirectory` leaf maps
 *      expose IDENTICAL key sets with non-empty string values (belt #2: the
 *      PRIMARY parity gate is compile-time typing where BOTH leaf consts are
 *      typed `TeacherDirectoryLabels`; any missing key fails `bun tsgo`).
 *      This suite keeps the guarantee enforced even if someone loosens that
 *      typing later.
 *   2. FROZEN KEY-SET PIN — the `teacherDirectory` namespace admits EXACTLY
 *      the flat leaf-string keys listed below (no functions, no grouped
 *      sub-blocks). Adding or removing any key fails this gate even if
 *      compile-time parity is intact (the namespace extends additively —
 *      every future key lands in this pin alongside its siblings).
 *   3. ARABIC-SCRIPT SANITY — EVERY `ar` leaf carries Arabic script
 *      (U+0600–U+06FF), guarding against an accidental copy-paste of the
 *      English copy into the `ar` leaf.
 *   4. REGISTRY WIRING — the `TeacherDirectory` handle is registered in
 *      `shared/locale/namespaces/registry.ts` with the conventional
 *      `<ns>.<ns>` id (`teacherDirectory.teacherDirectory`) and its getter
 *      resolves to the composed bundle slice; both message bundles carry
 *      `teacherDirectoryTranslations`.
 *   5. SYNC RESOLUTION — `getTranslations(locale)` (pure, in-memory, never
 *      suspends) resolves the key in BOTH locales.
 *   6. INTERPOLATION-FREE PIN — EVERY leaf is a STATIC string with ZERO
 *      ICU placeholders. The empty-state line surfaces NO identifier (no
 *      teacher id, name, email, or filter value) — the browse result count
 *      and filters are data, never interpolated into copy.
 *
 * Mirrors the structure of `shared/locale/availability-namespace.parity.test.ts`
 * (the all-leaf-string namespace exemplar).
 *
 * Pure unit tier — NO server boot, NO network, NO DB. Runs via the mandated
 * runner: `bun run test/scripts/run-test.ts shared/locale/teacherDirectory-namespace.parity.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import { defaultLocale } from "@/shared/locale/AppLocale";
import { arMessages } from "@/shared/locale/ar/messages";
import { teacherDirectoryAr } from "@/shared/locale/ar/teacherDirectory";
import { enMessages } from "@/shared/locale/en/messages";
import { teacherDirectoryEn } from "@/shared/locale/en/teacherDirectory";
import { namespaces } from "@/shared/locale/namespaces/index";
import { TeacherDirectory } from "@/shared/locale/namespaces/teacherDirectory";
import { getTranslations } from "@/shared/locale/server";
import type { TeacherDirectoryLabels } from "@/shared/locale/types/teacherDirectory";

// ─── Mandated registries ─────────────────────────────────────────────────────

/**
 * The frozen leaf-string key set of the `teacherDirectory` namespace
 * (count-agnostic: the namespace extends ADDITIVELY, so every new key
 * lands in this list alongside its siblings and the length pins below
 * derive from it). Adding or removing a key fails this gate even if the
 * compile-time `TeacherDirectoryLabels` typing is intact (this pin guards
 * both the en and ar leaves from silent drift).
 */
const TEACHER_DIRECTORY_FROZEN_KEYS = [
  "noTeachersAvailable",
  "browseTitle",
  "browseSubtitle",
  "recitationLabel",
  "recitationAny",
  "intentLabel",
  "subjectAny",
  "intentHifz",
  "intentTajweed",
  "applyFilters",
  "resetFilters",
  "resultsTitle",
  "showingPrefix",
  "of",
  "onlineNow",
  "unrated",
  "cardRecitations",
  "cardLanguages",
  "emptyStateHint",
  "paginationLabel",
  "previousPage",
  "nextPage",
  "pageWord",
  "requestSessionCta",
  "requestDialogTitle",
  "requestDialogIntentLabel",
  "requestDialogIntentPlaceholder",
  "requestDialogNote",
  "requestDialogCreditsLabel",
  "creditLaneTrial",
  "creditLaneHifz",
  "creditLaneTajweed",
  "creditLaneReviews",
  "requestDialogInsufficientCreditsNote",
  "requestCancel",
  "requestConfirm",
  "requestSuccessNotice",
  "requestDuplicateNotice",
  "requestGenericFailure",
  "appliedFiltersLabel",
  "languageArabic",
  "languageEnglish",
  "languageFrench",
  "searchLabel",
  "searchPlaceholder",
  "minRatingLabel",
  "ratingAny",
  "ratingThreePlus",
  "ratingFourPlus",
  "ratingFourFivePlus",
  "sortLabel",
  "sortTopRated",
  "sortNameAZ",
  "sortNewest",
  "appliedSearchPrefix",
  "appliedRatingPrefix",
  "appliedSortPrefix",
] as const;

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

/**
 * Reads one non-empty-string value slot off a `TeacherDirectoryLabels` map —
 * throws otherwise. Reserved for the leaf-string surfaces the parity belt
 * covers (the namespace admits no grouped sub-blocks).
 */
function nonEmptyTeacherDirectoryLeaf(
  localeMap: TeacherDirectoryLabels,
  key: (typeof TEACHER_DIRECTORY_FROZEN_KEYS)[number],
  localeName: string
): string {
  const value: unknown = Reflect.get(localeMap, key);
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`teacherDirectory.${localeName}.${key} must be a non-empty localized string`);
  }
  return value;
}

// ===========================================================================
describe("teacherDirectory namespace — frozen key-set pin", () => {
  test("the en leaf exposes EXACTLY the frozen keys (no extra, no missing)", () => {
    const enKeys = Object.keys(teacherDirectoryEn).toSorted((a, b) => a.localeCompare(b));
    const frozen = [...TEACHER_DIRECTORY_FROZEN_KEYS].toSorted((a, b) => a.localeCompare(b));
    expect(enKeys).toEqual(frozen);
    expect(enKeys).toHaveLength(TEACHER_DIRECTORY_FROZEN_KEYS.length);
  });

  test("the ar leaf exposes EXACTLY the frozen keys (no extra, no missing)", () => {
    const arKeys = Object.keys(teacherDirectoryAr).toSorted((a, b) => a.localeCompare(b));
    const frozen = [...TEACHER_DIRECTORY_FROZEN_KEYS].toSorted((a, b) => a.localeCompare(b));
    expect(arKeys).toEqual(frozen);
    expect(arKeys).toHaveLength(TEACHER_DIRECTORY_FROZEN_KEYS.length);
  });
});

// ===========================================================================
describe("teacherDirectory namespace — ar/en parity belt", () => {
  test("identical sorted key sets across BOTH locale sources", () => {
    const arKeys = Object.keys(teacherDirectoryAr).toSorted((a, b) => a.localeCompare(b));
    const enKeys = Object.keys(teacherDirectoryEn).toSorted((a, b) => a.localeCompare(b));

    expect(arKeys).toHaveLength(TEACHER_DIRECTORY_FROZEN_KEYS.length);
    expect(enKeys).toEqual(arKeys);
  });

  for (const key of TEACHER_DIRECTORY_FROZEN_KEYS) {
    test(`teacherDirectory.${key}: non-empty in BOTH locales`, () => {
      expectNonEmptyString(teacherDirectoryEn[key], `teacherDirectoryEn.${key}`);
      expectNonEmptyString(teacherDirectoryAr[key], `teacherDirectoryAr.${key}`);
    });
  }

  test("every leaf value on BOTH maps is a non-empty string (zero dead keys, zero grouped blocks)", () => {
    for (const key of Object.keys(teacherDirectoryAr)) {
      const arValue: unknown = Reflect.get(teacherDirectoryAr, key);
      const enValue: unknown = Reflect.get(teacherDirectoryEn, key);
      expect(typeof arValue, `teacherDirectoryAr.${key} must be a string`).toBe("string");
      expect(typeof enValue, `teacherDirectoryEn.${key} must be a string`).toBe("string");
      expect(arValue, `teacherDirectoryAr.${key} must be non-empty`).not.toBe("");
      expect(enValue, `teacherDirectoryEn.${key} must be non-empty`).not.toBe("");
    }
  });
});

/**
 * The rating-chip keys whose values are locale-neutral numeric tokens in
 * BOTH locales — they match the card's rating pill, which renders the
 * numeric average with Western digits (`{teacher.averageRating}`), so the
 * filter chips must not invent a diverging digit convention. They stay
 * pinned non-empty and byte-identical across locales below.
 */
const NUMERIC_CHIP_KEYS = ["ratingThreePlus", "ratingFourPlus", "ratingFourFivePlus"] as const;

// ===========================================================================
describe("teacherDirectory namespace — Arabic-script sanity on EVERY ar leaf", () => {
  for (const key of TEACHER_DIRECTORY_FROZEN_KEYS) {
    if ((NUMERIC_CHIP_KEYS as readonly string[]).includes(key)) {
      // Locale-neutral numeric chip: pinned identical across locales
      // (the card's rating pill is the digit-convention owner).
      test(`teacherDirectory.${key} is the locale-neutral numeric chip (identical in BOTH locales)`, () => {
        const en = nonEmptyTeacherDirectoryLeaf(teacherDirectoryEn, key, "en");
        const ar = nonEmptyTeacherDirectoryLeaf(teacherDirectoryAr, key, "ar");
        expect(ar).toBe(en);
      });
      continue;
    }
    test(`teacherDirectoryAr.${key} carries Arabic script (no English slip-through)`, () => {
      const value = nonEmptyTeacherDirectoryLeaf(teacherDirectoryAr, key, "ar");
      expect(containsArabicScript(value), `teacherDirectoryAr.${key} must be Arabic script`).toBe(true);
    });
  }
});

// ===========================================================================
describe("teacherDirectory namespace — interpolation-free pin (zero ICU placeholders)", () => {
  for (const key of TEACHER_DIRECTORY_FROZEN_KEYS) {
    test(`teacherDirectory.${key} carries ZERO ICU placeholders in BOTH locales (no identifier surfaced)`, () => {
      expect(
        icuPlaceholdersOf(nonEmptyTeacherDirectoryLeaf(teacherDirectoryEn, key, "en")),
        `teacherDirectoryEn.${key} must be interpolation-free`
      ).toEqual([]);
      expect(
        icuPlaceholdersOf(nonEmptyTeacherDirectoryLeaf(teacherDirectoryAr, key, "ar")),
        `teacherDirectoryAr.${key} must be interpolation-free`
      ).toEqual([]);
    });
  }
});

// ===========================================================================
describe("teacherDirectory namespace — registry wiring", () => {
  test("TeacherDirectory handle registered with the conventional teacherDirectory.teacherDirectory id", () => {
    expect(TeacherDirectory.id).toBe("teacherDirectory.teacherDirectory");
    expect(namespaces.TeacherDirectory).toBe(TeacherDirectory);
  });

  test("both message bundles carry teacherDirectoryTranslations", () => {
    expect(enMessages.teacherDirectoryTranslations).toBe(teacherDirectoryEn);
    expect(arMessages.teacherDirectoryTranslations).toBe(teacherDirectoryAr);
  });

  test("the TeacherDirectory getter resolves the composed bundle slice (both locales)", () => {
    expect(TeacherDirectory.getLabels(enMessages)).toBe(teacherDirectoryEn);
    expect(TeacherDirectory.getLabels(arMessages)).toBe(teacherDirectoryAr);
  });
});

// ===========================================================================
describe("teacherDirectory namespace — sync resolution through getTranslations", () => {
  test("en resolves the seeded key", () => {
    const t: TeacherDirectoryLabels = getTranslations("en").teacherDirectoryTranslations;
    expect(t.noTeachersAvailable).toBe(teacherDirectoryEn.noTeachersAvailable);
  });

  test("ar resolves the seeded key (Arabic script)", () => {
    const t: TeacherDirectoryLabels = getTranslations("ar").teacherDirectoryTranslations;
    expect(t.noTeachersAvailable).toBe(teacherDirectoryAr.noTeachersAvailable);
    expect(containsArabicScript(t.noTeachersAvailable)).toBe(true);
  });

  test("en resolves a browse-surface key", () => {
    const t: TeacherDirectoryLabels = getTranslations("en").teacherDirectoryTranslations;
    expect(t.browseTitle).toBe(teacherDirectoryEn.browseTitle);
  });

  test("ar resolves a browse-surface key (Arabic script)", () => {
    const t: TeacherDirectoryLabels = getTranslations("ar").teacherDirectoryTranslations;
    expect(t.browseTitle).toBe(teacherDirectoryAr.browseTitle);
    expect(containsArabicScript(t.browseTitle)).toBe(true);
  });

  test("unknown locales fall back to the DEFAULT locale without throwing", () => {
    const fallback: TeacherDirectoryLabels = getTranslations(defaultLocale).teacherDirectoryTranslations;
    const t: TeacherDirectoryLabels = getTranslations("xx").teacherDirectoryTranslations;
    expect(t.noTeachersAvailable).toBe(fallback.noTeachersAvailable);
  });
});
