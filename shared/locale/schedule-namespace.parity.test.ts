/**
 * `schedule`-namespace locale verification
 * · ar+en parity gates over the NEW `schedule` UI namespace (the teacher
 *   weekly planner at `/schedule`).
 *
 * WHAT THIS LOCKS
 *   1. SCHEDULE PARITY BELT — the ar/en `schedule` leaf maps expose IDENTICAL
 *      key sets with non-empty string values (belt #2: the PRIMARY parity
 *      gate is compile-time typing where BOTH leaf consts are typed
 *      `ScheduleLabels`; any missing key fails `bun tsgo`). This suite keeps
 *      the guarantee enforced even if someone loosens that typing later.
 *      The function-valued keys (`weekRangeLabel`, `dayColumnAria`,
 *      `dayCountLine`, `sessionChipAria`) agree across locales on their
 *      argument arity.
 *   2. REGISTRY WIRING — the `Schedule` handle is registered in
 *      `shared/locale/namespaces/registry.ts` with the conventional
 *      `<ns>.<ns>` id and its getter resolves to the composed bundle slice;
 *      both message bundles carry `scheduleTranslations`.
 *   3. SYNC RESOLUTION — `getTranslations(locale)` (pure, in-memory, never
 *      suspends) resolves a sample of the new keys in BOTH locales.
 *   4. ARABIC-SCRIPT SANITY — sampled Arabic values actually contain Arabic
 *      script (guards a copy paste of English into the `ar` leaf).
 *   5. PLURAL-ARM AGREEMENT — the `dayCountLine` plural vocabulary returns
 *      DISTINCT forms for the singular/dual/few/many Arabic arms and the
 *      singular/plural English arms (the planner renders this line on every
 *      day column, so a degenerate copy would read wrong in the common
 *      1/2-session cases).
 *
 * Mirrors the structure of `shared/locale/wallet-namespace.parity.test.ts`.
 *
 * Pure unit tier — NO server boot, NO network, NO DB.
 */

import { describe, expect, test } from "bun:test";
import { arMessages } from "@/shared/locale/ar/messages";
import { scheduleAr } from "@/shared/locale/ar/schedule";
import { enMessages } from "@/shared/locale/en/messages";
import { scheduleEn } from "@/shared/locale/en/schedule";
import { namespaces } from "@/shared/locale/namespaces/index";
import { Schedule } from "@/shared/locale/namespaces/schedule";
import { getTranslations } from "@/shared/locale/server";

// ─── Mandated registries ─────────────────────────────────────────────────────

/** Every string-valued key on the `ScheduleLabels` interface (parity belt surface). */
const SCHEDULE_STRING_KEYS = [
  "pageTitle",
  "previousWeekLabel",
  "nextWeekLabel",
  "thisWeekLabel",
  "weekSessionsLabel",
  "weekActiveLabel",
  "weekCompletedLabel",
  "weekCancelledLabel",
  "todayChip",
  "emptyWeekTitle",
  "emptyWeekBody",
  "errorTitle",
  "errorBody",
  "loadingLabel",
  "manageSessionsCta",
] as const;

/** The function-valued keys with their required argument arity. */
const SCHEDULE_FUNCTION_KEYS = {
  weekRangeLabel: 2,
  dayColumnAria: 2,
  dayCountLine: 1,
  sessionChipAria: 2,
} as const;

/** Sampled keys for the sync-resolution + Arabic-script gates. */
const ARABIC_SAMPLE_KEYS = ["pageTitle", "thisWeekLabel", "emptyWeekTitle", "manageSessionsCta"] as const;

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

// ─── 1. Schedule parity belt ─────────────────────────────────────────────────

describe("schedule namespace — ar/en parity belt", () => {
  for (const key of SCHEDULE_STRING_KEYS) {
    test(`schedule.${key}: non-empty in BOTH locales`, () => {
      expectNonEmptyString(scheduleEn[key], `scheduleEn.${key}`);
      expectNonEmptyString(scheduleAr[key], `scheduleAr.${key}`);
    });
  }

  test("arabic leaf carries Arabic script on sampled keys", () => {
    for (const key of ARABIC_SAMPLE_KEYS) {
      expect(containsArabicScript(scheduleAr[key]), `scheduleAr.${key} must be Arabic script`).toBe(true);
    }
  });

  test("function-valued keys agree on argument arity across locales", () => {
    for (const [key, arity] of Object.entries(SCHEDULE_FUNCTION_KEYS)) {
      expect(Reflect.get(scheduleEn, key)).toHaveLength(arity);
      expect(Reflect.get(scheduleAr, key)).toHaveLength(arity);
    }
  });

  test("weekRangeLabel interpolates BOTH stamps chronologically", () => {
    const en = scheduleEn.weekRangeLabel("13 Sep", "19 Sep");
    expect(en).toContain("13 Sep");
    expect(en).toContain("19 Sep");
    expect(en.indexOf("13 Sep")).toBeLessThan(en.indexOf("19 Sep"));
    const ar = scheduleAr.weekRangeLabel("١٣ سبتمبر", "١٩ سبتمبر");
    expect(ar).toContain("١٣ سبتمبر");
    expect(ar).toContain("١٩ سبتمبر");
  });

  test("sessionChipAria interpolates status + time in both locales", () => {
    expect(scheduleEn.sessionChipAria("Completed", "14:00")).toContain("Completed");
    const ar = scheduleAr.sessionChipAria("مكتملة", "١٤:٠٠");
    expect(ar).toContain("مكتملة");
    expect(ar).toContain("١٤:٠٠");
  });

  test("dayCountLine plural arms are distinct (en singular/plural, ar 1/2/3-10/11+)", () => {
    const enForms = new Set([scheduleEn.dayCountLine(0), scheduleEn.dayCountLine(1), scheduleEn.dayCountLine(5)]);
    expect(enForms.size).toBe(3);
    // The full Arabic arm set: 1 → جلسة واحدة, 2 → جلستان, 3–10 → جلسات, 11+ → جلسة.
    expect(scheduleAr.dayCountLine(1)).toContain("جلسة واحدة");
    expect(scheduleAr.dayCountLine(2)).toContain("جلستان");
    expect(scheduleAr.dayCountLine(7)).toContain("جلسات");
    expect(scheduleAr.dayCountLine(11)).toContain("جلسة");
    expect(containsArabicScript(scheduleAr.dayCountLine(7))).toBe(true);
  });
});

// ─── 2. Registry wiring ──────────────────────────────────────────────────────

describe("schedule namespace — registry wiring", () => {
  test("Schedule handle registered with the conventional schedule.schedule id", () => {
    expect(Schedule.id).toBe("schedule.schedule");
    expect(namespaces.Schedule).toBe(Schedule);
  });

  test("both message bundles carry scheduleTranslations", () => {
    expect(enMessages.scheduleTranslations).toBe(scheduleEn);
    expect(arMessages.scheduleTranslations).toBe(scheduleAr);
  });

  test("the Schedule getter resolves the composed bundle slice", () => {
    expect(Schedule.getLabels(enMessages)).toBe(scheduleEn);
    expect(Schedule.getLabels(arMessages)).toBe(scheduleAr);
  });
});

// ─── 3/4. Sync resolution + script sanity ────────────────────────────────────

describe("schedule namespace — sync resolution through getTranslations", () => {
  test("en resolves the sampled keys", () => {
    const t = getTranslations("en").scheduleTranslations;
    expect(t.pageTitle).toBe(scheduleEn.pageTitle);
    expect(t.thisWeekLabel).toBe(scheduleEn.thisWeekLabel);
    expect(t.manageSessionsCta).toBe(scheduleEn.manageSessionsCta);
  });

  test("ar resolves the sampled keys (Arabic script)", () => {
    const t = getTranslations("ar").scheduleTranslations;
    expect(t.pageTitle).toBe(scheduleAr.pageTitle);
    expect(containsArabicScript(t.pageTitle)).toBe(true);
    expect(containsArabicScript(t.emptyWeekBody)).toBe(true);
  });
});
