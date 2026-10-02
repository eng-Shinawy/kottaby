/**
 * `parentMonitoring`-namespace locale-parity verification
 * · ar+en parity gate + function-slot pins + registry wiring.
 *
 * WHAT THIS LOCKS
 *   1. RUNTIME PARITY BELT — the ar/en `parentMonitoring` leaf maps expose
 *      IDENTICAL key sets where every STRING slot is non-empty and every
 *      FUNCTION slot is present (belt #2: the PRIMARY parity gate is
 *      compile-time typing where BOTH leaf consts are typed
 *      `ParentMonitoringLabels`; any missing key fails `bun tsgo`. This
 *      suite keeps the guarantee enforced even if someone loosens that
 *      typing later).
 *   2. MANDATED CONTENT — every key required by the parent-monitoring
 *      portal surfaces (portal root + child switcher + zero-children
 *      empty state + session deep-link fallback notice, detail page
 *      header, the five tab labels, Jadid/Madi
 *      track vocabulary, "not rated yet" / "none assigned" / "no
 *      recorded progress yet" fallbacks, per-tab section headings /
 *      counts / empty states / column headers, loading and error copy)
 *      exists on BOTH maps — a key deleted from both maps simultaneously
 *      still fails this suite.
 *   3. NO ENGLISH FALLTHROUGH — every ar STRING slot contains Arabic
 *      script (an accidentally English value in the ar map fails the
 *      sweep).
 *   4. TAB VOCABULARY — exactly five tab-label keys exist (attendance,
 *      reports, homework, evaluations, progress).
 *   5. ATTENDANCE STATUS VOCABULARY — exactly five attendance-status-label
 *      keys exist (attended, cancelled, disputed, scheduled, started).
 *   6. TEMPLATE PINS — `detailPageTitle` and the seven plural-count
 *      functions (`childrenCount`, `attendanceCount`, `reportsCount`,
 *      `homeworkCount`, `evaluationsCount`, `progressRowCount`) expand
 *      their arguments into the returned message in BOTH locales, with
 *      exact-pinned en outputs and Arabic-script-containment ar pins
 *      (the ar plural-class words stay pinned so 0/1/2/3–10/11+ remain
 *      mutually distinguishable; digit FORM is pinned once by the
 *      count-cell pin in the function-slot inventory block).
 *   7. REGISTRY WIRING — the `ParentMonitoring` handle is registered in
 *      `shared/locale/namespaces/index.ts` with the conventional
 *      `<ns>.<ns>` id and its getter resolves the composed bundle slice.
 *   8. SESSION-TARGET FALLBACK — the deep-link resolution fallback
 *      notice `sessionTargetUnavailableNotice` exists on BOTH maps,
 *      pinned to its exact en/ar copy; the ar value is pure Arabic
 *      script (RTL-correct — no Latin letters, no embedded bidi control
 *      characters), and BOTH locales stay free of digits and of any
 *      grade/score/notes/rating surface (the notice states
 *      unavailability only — no session or child data may surface).
 *
 * Mirrors the structure of `shared/locale/parentLink-namespace.parity.test.ts`
 * (the sibling namespace gate), scaled to this namespace's eight
 * function-valued slots (detail-page title interpolation + seven
 * plural-count functions).
 *
 * Pure unit tier — NO server boot, NO network, NO DB. Runs via the mandated
 * runner: `bun run test/scripts/run-test.ts shared/locale/parentMonitoring-namespace.parity.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import { arMessages } from "@/shared/locale/ar/messages";
import { parentMonitoringAr } from "@/shared/locale/ar/parentMonitoring";
import { enMessages } from "@/shared/locale/en/messages";
import { parentMonitoringEn } from "@/shared/locale/en/parentMonitoring";
import { namespaces } from "@/shared/locale/namespaces/index";
import { ParentMonitoring } from "@/shared/locale/namespaces/parentMonitoring";

// ─── Mandated key inventory (the parent-monitoring surface ground truth) ───

/** Every key the parentMonitoring UI namespace must carry (118 slots). */
const MANDATED_KEYS = [
  // Portal root / linked-children list
  "portalPageTitle",
  "portalPageSubtitle",
  "childSwitcherLabel",
  "childrenCount",
  "childrenEmptyTitle",
  "childrenEmptyBody",
  "childrenEmptyCta",
  "sessionTargetUnavailableNotice",
  // Detail page header
  "detailPageTitle",
  "detailPageSubtitle",
  // Session deep-link row chip
  "deepLinkChip",
  // Tab labels
  "tabAttendance",
  "tabReports",
  "tabHomework",
  "tabEvaluations",
  "tabProgress",
  // Homework track vocabulary
  "trackJadid",
  "trackMadi",
  "trackNoneAssigned",
  // Rating / progress / position fallbacks
  "ratingNotRated",
  "ratingColumnLabel",
  "progressNoRecorded",
  "progressPositionNone",
  "progressLatestJadidLabel",
  "progressLatestMadiLabel",
  // Attendance tab
  "attendanceSectionTitle",
  "attendanceCount",
  "attendanceEmptyTitle",
  "attendanceEmptyBody",
  "attendanceColumnDate",
  "attendanceColumnStatus",
  "attendanceStatusAttended",
  "attendanceStatusCancelled",
  "attendanceStatusDisputed",
  "attendanceStatusScheduled",
  "attendanceStatusStarted",
  // Reports tab
  "reportsSectionTitle",
  "reportsCount",
  "reportsEmptyTitle",
  "reportsEmptyBody",
  "reportsColumnDate",
  "reportsColumnNotes",
  "reportsColumnRating",
  // Homework tab
  "homeworkSectionTitle",
  "homeworkCount",
  "homeworkEmptyTitle",
  "homeworkEmptyBody",
  "homeworkColumnDate",
  "homeworkColumnJadid",
  "homeworkColumnMadi",
  "homeworkColumnGrade",
  // Evaluations tab
  "evaluationsSectionTitle",
  "evaluationsCount",
  "evaluationsEmptyTitle",
  "evaluationsEmptyBody",
  "evaluationsColumnDate",
  "evaluationsColumnScore",
  "evaluationsColumnNotes",
  // Progress tab
  "progressSectionTitle",
  "progressRowCount",
  "progressEmptyTitle",
  "progressEmptyBody",
  // Loading / error scaffolding
  "loadingLabel",
  "loadErrorBody",
  "refreshLabel",
  "ayahRangeLabel",
  "backToChildrenAction",
  "lastUpdatedLabel",
  "statTotalChildren",
  "statRecentSessions",
  // Print/Export feature
  "printLabel",
  "printDialogTitle",
  "printOption",
  "exportCsvOption",
  "exportSuccess",
  // Calendar view feature
  "calendarViewLabel",
  "listViewLabel",
  "calendarMonthLabel",
  // Print timestamp + CSV status
  "printTimestampLabel",
  "csvStatusColumn",
  // Attendance summary stats
  "statTotalSessions",
  "statCompletedSessions",
  "statCompletionRate",
  "statUpcomingSessions",
  "summaryHeading",
  // Homework summary stats
  "homeworkSummaryHeading",
  "statLatestJadid",
  "statLatestMadi",
  "statAverageGrade",
  "statHomeworkCount",
  // Reports rating trend chart
  "ratingTrendHeading",
  "ratingTrendAxisLabel",
  "ratingTrendSessionLabel",
  "ratingTrendEmpty",
  // Progress summary
  "progressSummaryHeading",
  "statProgressRows",
  "statCoverageAreas",
  "statActiveTrack",
  "statEnrolledSince",
  // Evaluations summary
  "evaluationsSummaryHeading",
  "statTotalEvaluations",
  "statAverageScore",
  "statHighestScore",
  "statRatedSessions",
  // Search / filter
  "searchPlaceholder",
  "searchClearLabel",
  "searchNoResults",
  "filterByRatingLabel",
  "filterAllRatings",
  // Sort
  "sortByLabel",
  "sortDateDesc",
  "sortDateAsc",
  "sortRatingDesc",
  "sortRatingAsc",
  // Homework CSV export
  "csvJadidColumn",
  "csvMadiColumn",
  "csvGradeColumn",
  "homeworkPrintDialogTitle",
] as const;

/**
 * One display-label key per portal tab — `attendance` ↔ tabAttendance,
 * `reports` ↔ tabReports, `homework` ↔ tabHomework, `evaluations` ↔
 * tabEvaluations, `progress` ↔ tabProgress.
 */
const TAB_LABEL_KEYS = ["tabAttendance", "tabReports", "tabHomework", "tabEvaluations", "tabProgress"] as const;

/**
 * One display-label key per attendance-status classification —
 * `completed` → attendanceStatusAttended, `cancelled` →
 * attendanceStatusCancelled, `disputed` → attendanceStatusDisputed,
 * `scheduled` → attendanceStatusScheduled, `started` →
 * attendanceStatusStarted.
 */
const STATUS_LABEL_KEYS = [
  "attendanceStatusAttended",
  "attendanceStatusCancelled",
  "attendanceStatusDisputed",
  "attendanceStatusScheduled",
  "attendanceStatusStarted",
] as const;

/**
 * The ten function-valued slots (detail-page title interpolation + the
 * eight function slots (seven plural-count + last-updated interpolation) across children, attendance, reports,
 * homework, evaluations, progress).
 */
const FUNCTION_KEYS = [
  "childrenCount",
  "detailPageTitle",
  "attendanceCount",
  "reportsCount",
  "homeworkCount",
  "evaluationsCount",
  "progressRowCount",
  "lastUpdatedLabel",
  "printTimestampLabel",
] as const;

/** Arabic-script probe — at least one Arabic-block character in the value. */
const ARABIC_SCRIPT = /[\u0600-\u06FF]/;

/** Reads one non-empty-string value slot off a locale map — throws otherwise. */
function stringSlotOf(localeMap: object, key: string, localeName: string): string {
  const value: unknown = Reflect.get(localeMap, key);
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`parentMonitoring.${localeName}.${key} must be a non-empty localized string`);
  }
  return value;
}

// ===========================================================================
describe("compile-time parity mirror — ar/en key sets agree", () => {
  test("identical sorted key sets across BOTH locale sources", () => {
    const arKeys = Object.keys(parentMonitoringAr).toSorted((a, b) => a.localeCompare(b));
    const enKeys = Object.keys(parentMonitoringEn).toSorted((a, b) => a.localeCompare(b));

    expect(arKeys.length).toBeGreaterThan(0);
    expect(enKeys).toEqual(arKeys);
  });

  test("every value on BOTH maps is a non-empty string or a function (zero dead keys)", () => {
    for (const key of Object.keys(parentMonitoringAr)) {
      const arValue: unknown = Reflect.get(parentMonitoringAr, key);
      const enValue: unknown = Reflect.get(parentMonitoringEn, key);
      expect(typeof arValue === "string" || typeof arValue === "function").toBe(true);
      expect(typeof enValue === "string" || typeof enValue === "function").toBe(true);
      if (typeof arValue === "string") {
        expect(arValue.length).toBeGreaterThan(0);
        expect(stringSlotOf(parentMonitoringEn, key, "en").length).toBeGreaterThan(0);
      }
    }
    // Symmetric sweep — guards an en-only key that ar lost via future drift.
    for (const key of Object.keys(parentMonitoringEn)) {
      const enValue: unknown = Reflect.get(parentMonitoringEn, key);
      if (typeof enValue === "string") {
        expect(stringSlotOf(parentMonitoringAr, key, "ar").length).toBeGreaterThan(0);
      }
    }
  });

  test.each([...MANDATED_KEYS])("mandated key `%s` exists on BOTH maps", key => {
    expect(Object.hasOwn(parentMonitoringAr, key)).toBe(true);
    expect(Object.hasOwn(parentMonitoringEn, key)).toBe(true);
  });

  test("the mandated inventory is exhaustive (no silent key minting beyond the 118 slots)", () => {
    const mandated = new Set<string>(MANDATED_KEYS);
    for (const key of Object.keys(parentMonitoringAr)) {
      expect(mandated.has(key)).toBe(true);
    }
  });
});

// ===========================================================================
describe("tab vocabulary — one display label per portal tab", () => {
  test("exactly FIVE tab-label keys exist (all 5 portal tabs covered)", () => {
    const tabKeysOnMap = Object.keys(parentMonitoringEn).filter(key => key.startsWith("tab"));
    expect(tabKeysOnMap).toEqual([...TAB_LABEL_KEYS]);
  });

  test.each([...TAB_LABEL_KEYS])("tab label `%s` is a non-empty string in BOTH locales", key => {
    expect(stringSlotOf(parentMonitoringAr, key, "ar").length).toBeGreaterThan(0);
    expect(stringSlotOf(parentMonitoringEn, key, "en").length).toBeGreaterThan(0);
  });
});

// ===========================================================================
describe("attendance status vocabulary — one display label per status classification", () => {
  test("exactly FIVE attendance-status-label keys exist (all 5 statuses covered)", () => {
    const statusKeysOnMap = Object.keys(parentMonitoringEn).filter(key => key.startsWith("attendanceStatus"));
    expect(statusKeysOnMap).toEqual([...STATUS_LABEL_KEYS]);
  });

  test.each([...STATUS_LABEL_KEYS])("status label `%s` is a non-empty string in BOTH locales", key => {
    expect(stringSlotOf(parentMonitoringAr, key, "ar").length).toBeGreaterThan(0);
    expect(stringSlotOf(parentMonitoringEn, key, "en").length).toBeGreaterThan(0);
  });
});

// ===========================================================================
describe("no English fallthrough — ar map carries Arabic copy for every string slot", () => {
  test("every ar STRING slot contains Arabic script", () => {
    for (const key of Object.keys(parentMonitoringAr)) {
      const value: unknown = Reflect.get(parentMonitoringAr, key);
      if (typeof value === "string") {
        expect(ARABIC_SCRIPT.test(value)).toBe(true);
      }
    }
  });

  test("all ten ar FUNCTION slots return Arabic-script output for Arabic-flavored arguments", () => {
    const arChildName = "ولي الأمر";
    expect(ARABIC_SCRIPT.test(parentMonitoringAr.childrenCount(2))).toBe(true);
    expect(ARABIC_SCRIPT.test(parentMonitoringAr.detailPageTitle(arChildName))).toBe(true);
    expect(ARABIC_SCRIPT.test(parentMonitoringAr.attendanceCount(2))).toBe(true);
    expect(ARABIC_SCRIPT.test(parentMonitoringAr.reportsCount(2))).toBe(true);
    expect(ARABIC_SCRIPT.test(parentMonitoringAr.homeworkCount(2))).toBe(true);
    expect(ARABIC_SCRIPT.test(parentMonitoringAr.evaluationsCount(2))).toBe(true);
    expect(ARABIC_SCRIPT.test(parentMonitoringAr.progressRowCount(2))).toBe(true);
  });
});

// ===========================================================================
describe("template pins — function slots expand their arguments", () => {
  test("detailPageTitle embeds the child name in BOTH locales", () => {
    expect(parentMonitoringEn.detailPageTitle("Adam")).toBe("Adam's progress");
    expect(parentMonitoringAr.detailPageTitle("ولي الأمر")).toBe("تقدّم ولي الأمر");
  });

  test("childrenCount renders plural-safe counts in BOTH locales", () => {
    expect(parentMonitoringEn.childrenCount(0)).toBe("No linked children");
    expect(parentMonitoringEn.childrenCount(1)).toBe("1 linked child");
    expect(parentMonitoringEn.childrenCount(3)).toBe("3 linked children");
    // ar pins probe CONTAINMENT of the plural-class words, not exact strings.
    // The rendered digits come from `toLocaleString("ar")`, whose
    // Arabic-Indic shaping is ICU/toolchain-dependent — a bun/ICU upgrade
    // must not fail this gate, so NO digit-shape assertion is made here.
    expect(parentMonitoringAr.childrenCount(0)).toContain("لا يوجد");
    expect(parentMonitoringAr.childrenCount(1)).toContain("واحد");
    expect(parentMonitoringAr.childrenCount(2)).toContain("طفلان");
    expect(parentMonitoringAr.childrenCount(5)).toContain("أبناء");
    expect(parentMonitoringAr.childrenCount(15)).toContain("طفلاً");
  });

  test("attendanceCount renders plural-safe counts in BOTH locales", () => {
    expect(parentMonitoringEn.attendanceCount(0)).toBe("No sessions");
    expect(parentMonitoringEn.attendanceCount(1)).toBe("1 session");
    expect(parentMonitoringEn.attendanceCount(3)).toBe("3 sessions");
    expect(parentMonitoringAr.attendanceCount(0)).toContain("لا توجد جلسات");
    expect(parentMonitoringAr.attendanceCount(1)).toContain("واحدة");
    expect(parentMonitoringAr.attendanceCount(2)).toContain("جلستان");
    expect(parentMonitoringAr.attendanceCount(5)).toContain("جلسات");
    expect(parentMonitoringAr.attendanceCount(15)).toContain("جلسة");
  });

  test("reportsCount renders plural-safe counts in BOTH locales", () => {
    expect(parentMonitoringEn.reportsCount(0)).toBe("No reports");
    expect(parentMonitoringEn.reportsCount(1)).toBe("1 report");
    expect(parentMonitoringEn.reportsCount(3)).toBe("3 reports");
    expect(parentMonitoringAr.reportsCount(0)).toContain("لا توجد تقارير");
    expect(parentMonitoringAr.reportsCount(1)).toContain("واحد");
    expect(parentMonitoringAr.reportsCount(2)).toContain("تقريران");
    expect(parentMonitoringAr.reportsCount(5)).toContain("تقارير");
    expect(parentMonitoringAr.reportsCount(15)).toContain("تقريراً");
  });

  test("homeworkCount renders plural-safe counts in BOTH locales", () => {
    expect(parentMonitoringEn.homeworkCount(0)).toBe("No homework");
    expect(parentMonitoringEn.homeworkCount(1)).toBe("1 homework entry");
    expect(parentMonitoringEn.homeworkCount(3)).toBe("3 homework entries");
    expect(parentMonitoringAr.homeworkCount(0)).toContain("لا توجد واجبات");
    expect(parentMonitoringAr.homeworkCount(1)).toContain("واحد");
    expect(parentMonitoringAr.homeworkCount(2)).toContain("واجبان");
    expect(parentMonitoringAr.homeworkCount(5)).toContain("واجبات");
    expect(parentMonitoringAr.homeworkCount(15)).toContain("واجباً");
  });

  test("evaluationsCount renders plural-safe counts in BOTH locales", () => {
    expect(parentMonitoringEn.evaluationsCount(0)).toBe("No evaluations");
    expect(parentMonitoringEn.evaluationsCount(1)).toBe("1 evaluation");
    expect(parentMonitoringEn.evaluationsCount(3)).toBe("3 evaluations");
    expect(parentMonitoringAr.evaluationsCount(0)).toContain("لا توجد تقييمات");
    expect(parentMonitoringAr.evaluationsCount(1)).toContain("واحد");
    expect(parentMonitoringAr.evaluationsCount(2)).toContain("تقييمان");
    expect(parentMonitoringAr.evaluationsCount(5)).toContain("تقييمات");
    expect(parentMonitoringAr.evaluationsCount(15)).toContain("تقييماً");
  });

  test("progressRowCount renders plural-safe counts in BOTH locales", () => {
    expect(parentMonitoringEn.progressRowCount(0)).toBe("No recorded progress");
    expect(parentMonitoringEn.progressRowCount(1)).toBe("1 progress entry");
    expect(parentMonitoringEn.progressRowCount(3)).toBe("3 progress entries");
    expect(parentMonitoringAr.progressRowCount(0)).toContain("لا يوجد");
    expect(parentMonitoringAr.progressRowCount(1)).toContain("واحد");
    expect(parentMonitoringAr.progressRowCount(2)).toContain("سجلا");
    expect(parentMonitoringAr.progressRowCount(5)).toContain("سجلات");
    expect(parentMonitoringAr.progressRowCount(15)).toContain("سجل");
  });

  test("all ten function slots are callable with non-empty output in BOTH locales", () => {
    expect(parentMonitoringEn.childrenCount(2).length).toBeGreaterThan(0);
    expect(parentMonitoringEn.detailPageTitle("Adam").length).toBeGreaterThan(0);
    expect(parentMonitoringEn.attendanceCount(2).length).toBeGreaterThan(0);
    expect(parentMonitoringEn.reportsCount(2).length).toBeGreaterThan(0);
    expect(parentMonitoringEn.homeworkCount(2).length).toBeGreaterThan(0);
    expect(parentMonitoringEn.evaluationsCount(2).length).toBeGreaterThan(0);
    expect(parentMonitoringEn.progressRowCount(2).length).toBeGreaterThan(0);
    expect(parentMonitoringAr.childrenCount(2).length).toBeGreaterThan(0);
    expect(parentMonitoringAr.detailPageTitle("ولي الأمر").length).toBeGreaterThan(0);
    expect(parentMonitoringAr.attendanceCount(2).length).toBeGreaterThan(0);
    expect(parentMonitoringAr.reportsCount(2).length).toBeGreaterThan(0);
    expect(parentMonitoringAr.homeworkCount(2).length).toBeGreaterThan(0);
    expect(parentMonitoringAr.evaluationsCount(2).length).toBeGreaterThan(0);
    expect(parentMonitoringAr.progressRowCount(2).length).toBeGreaterThan(0);
  });
});

// ===========================================================================
describe("function-slot inventory — exactly the ten locale functions, on BOTH maps", () => {
  test.each([...FUNCTION_KEYS])("slot `%s` is a function on BOTH maps", key => {
    expect(typeof Reflect.get(parentMonitoringAr, key)).toBe("function");
    expect(typeof Reflect.get(parentMonitoringEn, key)).toBe("function");
  });

  test("no OTHER slot is function-valued (string/function split is stable)", () => {
    for (const key of Object.keys(parentMonitoringEn)) {
      const isFunction = typeof Reflect.get(parentMonitoringEn, key) === "function";
      expect(isFunction).toBe((FUNCTION_KEYS as readonly string[]).includes(key));
    }
  });

  test("the ar children count renders Arabic-Indic digits (page-date parity)", () => {
    expect(parentMonitoringAr.childrenCount(5)).toContain("٥");
    expect(parentMonitoringEn.childrenCount(5)).toContain("5");
  });
});

// ===========================================================================
describe("session-target deep-link fallback — sessionTargetUnavailableNotice", () => {
  const EN_NOTICE = "This session's details are no longer available.";
  const AR_NOTICE = "تفاصيل هذه الجلسة لم تعد متاحة.";

  test("the notice is a non-empty string slot on BOTH maps", () => {
    expect(stringSlotOf(parentMonitoringEn, "sessionTargetUnavailableNotice", "en")).toBe(EN_NOTICE);
    expect(stringSlotOf(parentMonitoringAr, "sessionTargetUnavailableNotice", "ar")).toBe(AR_NOTICE);
  });

  test("the Arabic notice is RTL-correct — pure Arabic script, no Latin letters, no bidi controls", () => {
    expect(ARABIC_SCRIPT.test(AR_NOTICE)).toBe(true);
    expect(/[A-Za-z]/.test(AR_NOTICE)).toBe(false);
    expect(/[\u202A-\u202E\u2066-\u2069\u200E\u200F]/.test(AR_NOTICE)).toBe(false);
  });

  test("the notice states unavailability only — no digits or grade/score/notes/rating surface in EITHER locale", () => {
    for (const notice of [EN_NOTICE, AR_NOTICE]) {
      expect(/\b(grade|graded|score|notes?|rating)\b/i.test(notice)).toBe(false);
      expect(/\d/.test(notice)).toBe(false);
    }
  });
});

// ===========================================================================
describe("registry + bundle wiring", () => {
  test("namespaces registry exposes the ParentMonitoring handle with the `<ns>.<ns>` id convention", () => {
    expect(Object.hasOwn(namespaces, "ParentMonitoring")).toBe(true);
    expect(ParentMonitoring.id).toBe("parentMonitoring.parentMonitoring");
  });

  test("handle getter resolves the composed bundle slice (both locales)", () => {
    expect(ParentMonitoring.getLabels(enMessages)).toBe(enMessages.parentMonitoringTranslations);
    expect(ParentMonitoring.getLabels(arMessages)).toBe(arMessages.parentMonitoringTranslations);
  });

  test("`parentMonitoringTranslations` exists on BOTH message bundles", () => {
    expect(Object.hasOwn(enMessages, "parentMonitoringTranslations")).toBe(true);
    expect(Object.hasOwn(arMessages, "parentMonitoringTranslations")).toBe(true);
  });

  test("the bundle slice IS the leaf map (no re-wrapper indirection) in BOTH locales", () => {
    expect(enMessages.parentMonitoringTranslations).toBe(parentMonitoringEn);
    expect(arMessages.parentMonitoringTranslations).toBe(parentMonitoringAr);
  });
});
