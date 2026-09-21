/**
 * `upNext`-namespace locale verification
 * · ar+en parity gates over the `upNext` UI namespace (the student
 *   dashboard's "What's next" card).
 *
 * WHAT THIS LOCKS
 *   1. UPNEXT PARITY BELT — the ar/en `upNext` leaf maps expose IDENTICAL
 *      key sets with non-empty string values (belt #2: the PRIMARY parity
 *      gate is compile-time typing where BOTH leaf consts are typed
 *      `UpNextLabels`; any missing key fails `bun tsgo`). This suite keeps
 *      the guarantee enforced even if someone loosens that typing later.
 *      The function-valued keys (`sessionLine`, `homeworkPendingLine`)
 *      agree across locales on their argument arity.
 *   2. REGISTRY WIRING — the `UpNext` handle is registered in
 *      `shared/locale/namespaces/registry.ts` with the conventional
 *      `<ns>.<ns>` id and its getter resolves to the composed bundle slice;
 *      both message bundles carry `upNextTranslations`.
 *   3. SYNC RESOLUTION — `getTranslations(locale)` (pure, in-memory, never
 *      suspends) resolves a sample of the new keys in BOTH locales.
 *   4. ARABIC-SCRIPT SANITY — sampled Arabic values actually contain Arabic
 *      script (guards a copy paste of English into the `ar` leaf).
 *   5. PLURAL-ARM AGREEMENT — the `homeworkPendingLine` plural vocabulary
 *      returns DISTINCT forms for the singular/dual/few/many Arabic arms
 *      and the singular/plural English arms (the homework row renders this
 *      line on the dashboard, so a degenerate copy would read wrong in the
 *      common 1/2-row cases).
 *   6. SESSION-REFERENCE ALIGNMENT — the session line vocabulary agrees
 *      with the homework namespace's `sessionLine` (one `Session #<id>` /
 *      `الجلسة #<id>` vocabulary across every student-facing surface).
 *
 * Mirrors the structure of `shared/locale/homework-namespace.parity.test.ts`.
 *
 * Pure unit tier — NO server boot, NO network, NO DB.
 */

import { describe, expect, test } from "bun:test";
import { homeworkAr } from "@/shared/locale/ar/homework";
import { arMessages } from "@/shared/locale/ar/messages";
import { upNextAr } from "@/shared/locale/ar/upNext";
import { homeworkEn } from "@/shared/locale/en/homework";
import { enMessages } from "@/shared/locale/en/messages";
import { upNextEn } from "@/shared/locale/en/upNext";
import { namespaces } from "@/shared/locale/namespaces/index";
import { UpNext } from "@/shared/locale/namespaces/upNext";
import { getTranslations } from "@/shared/locale/server";

// ─── Mandated registries ─────────────────────────────────────────────────────

/** Every string-valued key on the `UpNextLabels` interface (parity belt surface). */
const UPNEXT_STRING_KEYS = [
  "upNextTitle",
  "upcomingHeading",
  "upcomingEmpty",
  "bookedPrefix",
  "sessionsCta",
  "homeworkHeading",
  "homeworkAllGraded",
  "loadingLabel",
  "errorBody",
] as const;

/** The function-valued keys with their required argument arity. */
const UPNEXT_FUNCTION_KEYS = {
  sessionLine: 1,
  homeworkPendingLine: 1,
} as const;

/** Sampled keys for the sync-resolution + Arabic-script gates. */
const ARABIC_SAMPLE_KEYS = ["upNextTitle", "upcomingHeading", "upcomingEmpty"] as const;

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

// ─── 1. UpNext parity belt ───────────────────────────────────────────────────

describe("upNext namespace — ar/en parity belt", () => {
  for (const key of UPNEXT_STRING_KEYS) {
    test(`upNext.${key}: non-empty in BOTH locales`, () => {
      expectNonEmptyString(upNextEn[key], `upNextEn.${key}`);
      expectNonEmptyString(upNextAr[key], `upNextAr.${key}`);
    });
  }

  test("arabic leaf carries Arabic script on sampled keys", () => {
    for (const key of ARABIC_SAMPLE_KEYS) {
      expect(containsArabicScript(upNextAr[key]), `upNextAr.${key} must be Arabic script`).toBe(true);
    }
  });

  test("function-valued keys agree on argument arity across locales", () => {
    for (const [key, arity] of Object.entries(UPNEXT_FUNCTION_KEYS)) {
      expect(Reflect.get(upNextEn, key)).toHaveLength(arity);
      expect(Reflect.get(upNextAr, key)).toHaveLength(arity);
    }
  });

  test("sessionLine interpolates the session number in both locales", () => {
    expect(upNextEn.sessionLine(42)).toContain("42");
    const ar = upNextAr.sessionLine(42);
    expect(ar).toContain("42");
    expect(containsArabicScript(ar)).toBe(true);
  });
});

// ─── 2. Registry wiring ──────────────────────────────────────────────────────

describe("upNext namespace — registry wiring", () => {
  test("UpNext handle registered with the conventional upNext.upNext id", () => {
    expect(UpNext.id).toBe("upNext.upNext");
    expect(namespaces.UpNext).toBe(UpNext);
  });

  test("both message bundles carry upNextTranslations", () => {
    expect(enMessages.upNextTranslations).toBe(upNextEn);
    expect(arMessages.upNextTranslations).toBe(upNextAr);
  });

  test("the UpNext getter resolves the composed bundle slice", () => {
    expect(UpNext.getLabels(enMessages)).toBe(upNextEn);
    expect(UpNext.getLabels(arMessages)).toBe(upNextAr);
  });
});

// ─── 3/4. Sync resolution + script sanity ────────────────────────────────────

describe("upNext namespace — sync resolution through getTranslations", () => {
  test("en resolves the sampled keys", () => {
    const t = getTranslations("en").upNextTranslations;
    expect(t.upNextTitle).toBe(upNextEn.upNextTitle);
    expect(t.upcomingHeading).toBe(upNextEn.upcomingHeading);
    expect(t.homeworkAllGraded).toBe(upNextEn.homeworkAllGraded);
  });

  test("ar resolves the sampled keys (Arabic script)", () => {
    const t = getTranslations("ar").upNextTranslations;
    expect(t.upNextTitle).toBe(upNextAr.upNextTitle);
    expect(containsArabicScript(t.upNextTitle)).toBe(true);
    expect(containsArabicScript(t.upcomingEmpty)).toBe(true);
  });
});

// ─── 5. Plural-arm agreement ─────────────────────────────────────────────────

describe("upNext namespace — homeworkPendingLine plural arms", () => {
  test("en arms are distinct (singular/plural)", () => {
    const enForms = new Set([
      upNextEn.homeworkPendingLine(0),
      upNextEn.homeworkPendingLine(1),
      upNextEn.homeworkPendingLine(5),
    ]);
    expect(enForms.size).toBe(3);
  });

  test("ar arms cover the 1/2/3-10/11+ vocabulary", () => {
    expect(upNextAr.homeworkPendingLine(1)).toContain("واجب واحد");
    expect(upNextAr.homeworkPendingLine(2)).toContain("واجبان");
    expect(upNextAr.homeworkPendingLine(7)).toContain("واجبات");
    expect(upNextAr.homeworkPendingLine(11)).toContain("واجبًا");
    expect(containsArabicScript(upNextAr.homeworkPendingLine(7))).toBe(true);
  });
});

// ─── 6. Session-reference alignment with the homework surface ────────────────

describe("upNext namespace — session vocabulary alignment", () => {
  test("sessionLine copy matches the homework namespace verbatim", () => {
    expect(upNextEn.sessionLine(44)).toBe(homeworkEn.sessionLine(44));
    expect(upNextAr.sessionLine(44)).toBe(homeworkAr.sessionLine(44));
  });
});
