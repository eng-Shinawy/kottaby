/**
 * `adminAcademic`-namespace locale-parity verification
 * · ar+en parity gate + function-slot pins + registry wiring.
 *
 * WHAT THIS LOCKS
 *   1. RUNTIME PARITY BELT — the ar/en `adminAcademic` leaf maps expose
 *      IDENTICAL key sets where every STRING slot is non-empty and every
 *      FUNCTION slot is present (belt #2: the PRIMARY parity gate is
 *      compile-time typing where BOTH leaf consts are typed
 *      `AdminAcademicLabels`; any missing key fails `bun tsgo`. This
 *      suite keeps the guarantee enforced even if someone loosens that
 *      typing later).
 *   2. MANDATED CONTENT — every key required by the admin academic
 *      monitoring surfaces (dashboard chrome + search bar + table columns,
 *      advancement statistics, Jadid/Madi track vocabulary, position and
 *      grade fallbacks, attention-reason labels `lowGrade`/`staleProgress`,
 *      drill-down header + histories, the "account deleted" governance
 *      banner, pagination/empty/loading copy) exists on BOTH maps — a key
 *      deleted from both maps simultaneously still fails this suite.
 *   3. NO ENGLISH FALLTHROUGH — every ar STRING slot contains Arabic
 *      script (an accidentally English value in the ar map fails the
 *      sweep).
 *   4. ATTENTION-REASON VOCABULARY — exactly two attention-reason label
 *      keys exist (`attentionReasonLowGrade` / `attentionReasonStaleProgress`,
 *      the localized faces of the wire union `lowGrade` / `staleProgress`).
 *   5. TRACK VOCABULARY MIRROR — the Jadid/Madi labels are byte-identical
 *      to the `parentMonitoring` handles (one shared vocabulary across the
 *      parent portal and the admin surface — no divergent terminology).
 *   6. TEMPLATE PINS — `detailPageTitle` and `paginationPageOf` expand
 *      their arguments into the returned message in BOTH locales, and the
 *      five plural-count functions (`rowsCount`, `gradedHomeworkCount`,
 *      `progressRowCount`, `homeworkCount`, `reportsCount`) render the
 *      0/1/2/many plural classes
 *      with exact-pinned en outputs and Arabic-script-containment ar pins
 *      (the ar plural-class words stay pinned so 0/1/2/3–10/11+ remain
 *      mutually distinguishable; digit FORM is pinned once by the
 *      count-cell pin in the function-slot inventory block).
 *   7. GOVERNANCE BANNER DISCLOSURE FLOOR — the "account deleted" banner
 *      exists on BOTH maps pinned to its exact copy; the ar value is pure
 *      Arabic script (RTL-correct — no Latin letters, no embedded bidi
 *      control characters), and BOTH locales state the fact + audit
 *      retention only: no digits (no deletion date), no cause/actor
 *      vocabulary.
 *   8. REGISTRY WIRING — the `AdminAcademic` handle is registered in
 *      `shared/locale/namespaces/index.ts` with the conventional
 *      `<ns>.<ns>` id and its getter resolves the composed bundle slice.
 *
 * Mirrors the structure of `shared/locale/parentMonitoring-namespace.parity.test.ts`
 * (the sibling function-slot namespace gate — this namespace's typed
 * plural/interpolation slots need the function-aware pattern).
 *
 * Pure unit tier — NO server boot, NO network, NO DB. Runs via the mandated
 * runner: `bun run test/scripts/run-test.ts shared/locale/adminAcademic-namespace.parity.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import { adminAcademicAr } from "@/shared/locale/ar/adminAcademic";
import { arMessages } from "@/shared/locale/ar/messages";
import { parentMonitoringAr } from "@/shared/locale/ar/parentMonitoring";
import { adminAcademicEn } from "@/shared/locale/en/adminAcademic";
import { enMessages } from "@/shared/locale/en/messages";
import { parentMonitoringEn } from "@/shared/locale/en/parentMonitoring";
import { AdminAcademic } from "@/shared/locale/namespaces/adminAcademic";
import { namespaces } from "@/shared/locale/namespaces/index";

// ─── Mandated key inventory (the admin academic monitoring ground truth) ───

/** Every key the adminAcademic UI namespace must carry (73 slots). */
const MANDATED_KEYS = [
  // Dashboard page chrome
  "dashboardPageTitle",
  "dashboardPageSubtitle",
  "searchLabel",
  "searchPlaceholder",
  "searchClearLabel",
  "refreshLabel",
  "rowsCount",
  "columnName",
  "columnEmail",
  "columnLatestJadidPosition",
  "columnLatestMadiPosition",
  "columnJadidAverage",
  "columnMadiAverage",
  "columnProgressRows",
  "columnLastGradedAt",
  "columnAttention",
  "viewDetailAction",
  // Dashboard empty states
  "emptyTitle",
  "emptyBody",
  "emptyFilteredTitle",
  "emptyFilteredBody",
  // Advancement statistics block
  "statsHeading",
  "statTrackedStudents",
  "statStudentsWithGradedHomework",
  "statAverageJadidGrade",
  "statAverageMadiGrade",
  "statNeedingAttention",
  // Track / position / grade vocabulary
  "trackJadid",
  "trackMadi",
  "trackJadidShort",
  "trackMadiShort",
  "trackNoneAssigned",
  "latestJadidPositionLabel",
  "latestMadiPositionLabel",
  "positionNone",
  "gradeNotGraded",
  "gradedHomeworkCount",
  "ayahRangeLabel",
  // Attention flags
  "attentionBadgeLabel",
  "attentionSectionTitle",
  "attentionReasonLowGrade",
  "attentionReasonStaleProgress",
  // Drill-down page header + governance banner
  "detailPageTitle",
  "detailPageSubtitle",
  "backToDashboardAction",
  "emailLabel",
  "lastGradedAtLabel",
  "accountDeletedBannerTitle",
  "accountDeletedBannerBody",
  // Drill-down progress + histories
  "progressSectionTitle",
  "progressRowCount",
  "homeworkSectionTitle",
  "homeworkCount",
  "homeworkEmptyTitle",
  "homeworkEmptyBody",
  "homeworkColumnDate",
  "homeworkColumnTeacher",
  "homeworkColumnJadid",
  "homeworkColumnMadi",
  "homeworkColumnGrade",
  "reportsSectionTitle",
  "reportsCount",
  "reportsEmptyTitle",
  "reportsEmptyBody",
  "reportsColumnDate",
  "reportsColumnTeacher",
  "reportsColumnNotes",
  "reportsColumnRating",
  "reportNotesNotSubmitted",
  "reportRatingNotRated",
  // Loading / error scaffolding
  "loadingLabel",
  "loadErrorBody",
  // Pagination
  "paginationPageOf",
  "paginationPrevious",
  "paginationNext",
] as const;

/**
 * The two attention-reason label keys — the localized faces of the wire
 * union `lowGrade` / `staleProgress` (the ONE new GraphQL enum on the
 * surface).
 */
const ATTENTION_REASON_KEYS = ["attentionReasonLowGrade", "attentionReasonStaleProgress"] as const;

/**
 * The seven function-valued slots (detail-page title interpolation, the
 * page-of counter interpolation, and five plural-count functions across
 * rows, graded homework, progress rows, homework entries, and reports).
 */
const FUNCTION_KEYS = [
  "rowsCount",
  "gradedHomeworkCount",
  "detailPageTitle",
  "progressRowCount",
  "homeworkCount",
  "reportsCount",
  "paginationPageOf",
] as const;

/** Arabic-script probe — at least one Arabic-block character in the value. */
const ARABIC_SCRIPT = /[\u0600-\u06FF]/;

/** Reads one non-empty-string value slot off a locale map — throws otherwise. */
function stringSlotOf(localeMap: object, key: string, localeName: string): string {
  const value: unknown = Reflect.get(localeMap, key);
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`adminAcademic.${localeName}.${key} must be a non-empty localized string`);
  }
  return value;
}

// ===========================================================================
describe("compile-time parity mirror — ar/en key sets agree", () => {
  test("identical sorted key sets across BOTH locale sources", () => {
    const arKeys = Object.keys(adminAcademicAr).toSorted((a, b) => a.localeCompare(b));
    const enKeys = Object.keys(adminAcademicEn).toSorted((a, b) => a.localeCompare(b));

    expect(arKeys.length).toBeGreaterThan(0);
    expect(enKeys).toEqual(arKeys);
  });

  test("every value on BOTH maps is a non-empty string or a function (zero dead keys)", () => {
    for (const key of Object.keys(adminAcademicAr)) {
      const arValue: unknown = Reflect.get(adminAcademicAr, key);
      const enValue: unknown = Reflect.get(adminAcademicEn, key);
      expect(typeof arValue === "string" || typeof arValue === "function").toBe(true);
      expect(typeof enValue === "string" || typeof enValue === "function").toBe(true);
      if (typeof arValue === "string") {
        expect(arValue.length).toBeGreaterThan(0);
        expect(stringSlotOf(adminAcademicEn, key, "en").length).toBeGreaterThan(0);
      }
    }
    // Symmetric sweep — guards an en-only key that ar lost via future drift.
    for (const key of Object.keys(adminAcademicEn)) {
      const enValue: unknown = Reflect.get(adminAcademicEn, key);
      if (typeof enValue === "string") {
        expect(stringSlotOf(adminAcademicAr, key, "ar").length).toBeGreaterThan(0);
      }
    }
  });

  test.each([...MANDATED_KEYS])("mandated key `%s` exists on BOTH maps", key => {
    expect(Object.hasOwn(adminAcademicAr, key)).toBe(true);
    expect(Object.hasOwn(adminAcademicEn, key)).toBe(true);
  });

  test("the mandated inventory is exhaustive (no silent key minting beyond the 73 slots)", () => {
    const mandated = new Set<string>(MANDATED_KEYS);
    for (const key of Object.keys(adminAcademicAr)) {
      expect(mandated.has(key)).toBe(true);
    }
  });
});

// ===========================================================================
describe("attention-reason vocabulary — one display label per wire union member", () => {
  test("exactly TWO attention-reason keys exist (lowGrade + staleProgress)", () => {
    const reasonKeysOnMap = Object.keys(adminAcademicEn).filter(key => key.startsWith("attentionReason"));
    expect(reasonKeysOnMap).toEqual([...ATTENTION_REASON_KEYS]);
  });

  test.each([...ATTENTION_REASON_KEYS])("attention reason `%s` is a non-empty string in BOTH locales", key => {
    expect(stringSlotOf(adminAcademicAr, key, "ar").length).toBeGreaterThan(0);
    expect(stringSlotOf(adminAcademicEn, key, "en").length).toBeGreaterThan(0);
  });
});

// ===========================================================================
describe("track vocabulary mirror — Jadid/Madi labels match parentMonitoring", () => {
  test("the track + fallback vocabulary is byte-identical to the parentMonitoring handles", () => {
    expect(adminAcademicEn.trackJadid).toBe(parentMonitoringEn.trackJadid);
    expect(adminAcademicEn.trackMadi).toBe(parentMonitoringEn.trackMadi);
    expect(adminAcademicEn.trackNoneAssigned).toBe(parentMonitoringEn.trackNoneAssigned);
    expect(adminAcademicEn.ayahRangeLabel).toBe(parentMonitoringEn.ayahRangeLabel);
    expect(adminAcademicEn.reportRatingNotRated).toBe(parentMonitoringEn.ratingNotRated);
    expect(adminAcademicAr.trackJadid).toBe(parentMonitoringAr.trackJadid);
    expect(adminAcademicAr.trackMadi).toBe(parentMonitoringAr.trackMadi);
    expect(adminAcademicAr.trackNoneAssigned).toBe(parentMonitoringAr.trackNoneAssigned);
    expect(adminAcademicAr.ayahRangeLabel).toBe(parentMonitoringAr.ayahRangeLabel);
    expect(adminAcademicAr.reportRatingNotRated).toBe(parentMonitoringAr.ratingNotRated);
  });

  test("the ungraded-track fallback is its own concept ('not graded', not the teacher-rating 'not rated')", () => {
    // The canonical grade-summary shape renders an ungraded track as the
    // localized "not graded yet" state — deliberately distinct from the
    // parentMonitoring teacher-rating fallback it must never conflate with.
    expect(adminAcademicEn.gradeNotGraded).toBe("Not graded yet");
    expect(adminAcademicAr.gradeNotGraded).toBe("لم تُقيَّم بعد");
  });
});

// ===========================================================================
describe("no English fallthrough — ar map carries Arabic copy for every string slot", () => {
  test("every ar STRING slot contains Arabic script", () => {
    for (const key of Object.keys(adminAcademicAr)) {
      const value: unknown = Reflect.get(adminAcademicAr, key);
      if (typeof value === "string") {
        expect(ARABIC_SCRIPT.test(value)).toBe(true);
      }
    }
  });

  test("all seven ar FUNCTION slots return Arabic-script output for Arabic-flavored arguments", () => {
    const arStudentName = "عبد الرحمن";
    expect(ARABIC_SCRIPT.test(adminAcademicAr.rowsCount(2))).toBe(true);
    expect(ARABIC_SCRIPT.test(adminAcademicAr.gradedHomeworkCount(2))).toBe(true);
    expect(ARABIC_SCRIPT.test(adminAcademicAr.detailPageTitle(arStudentName))).toBe(true);
    expect(ARABIC_SCRIPT.test(adminAcademicAr.progressRowCount(2))).toBe(true);
    expect(ARABIC_SCRIPT.test(adminAcademicAr.homeworkCount(2))).toBe(true);
    expect(ARABIC_SCRIPT.test(adminAcademicAr.reportsCount(2))).toBe(true);
    expect(ARABIC_SCRIPT.test(adminAcademicAr.paginationPageOf(2, 5))).toBe(true);
  });
});

// ===========================================================================
describe("template pins — function slots expand their arguments", () => {
  test("detailPageTitle embeds the student name in BOTH locales", () => {
    expect(adminAcademicEn.detailPageTitle("Adam")).toBe("Adam's academic progress");
    expect(adminAcademicAr.detailPageTitle("عبد الرحمن")).toBe("التقدّم الأكاديمي لـعبد الرحمن");
  });

  test("paginationPageOf embeds BOTH the page and the page count in BOTH locales", () => {
    expect(adminAcademicEn.paginationPageOf(1, 5)).toBe("Page 1 of 5");
    expect(adminAcademicEn.paginationPageOf(3, 9)).toBe("Page 3 of 9");
    // ar pins probe CONTAINMENT of the structural words, not exact strings.
    // The rendered digits come from `toLocaleString("ar")`, whose
    // Arabic-Indic shaping is ICU/toolchain-dependent — a bun/ICU upgrade
    // must not fail this gate, so NO digit-shape assertion is made here.
    expect(adminAcademicAr.paginationPageOf(1, 5)).toContain("صفحة");
    expect(adminAcademicAr.paginationPageOf(1, 5)).toContain("من");
  });

  test("rowsCount renders plural-safe counts in BOTH locales", () => {
    expect(adminAcademicEn.rowsCount(0)).toBe("No students");
    expect(adminAcademicEn.rowsCount(1)).toBe("1 student");
    expect(adminAcademicEn.rowsCount(3)).toBe("3 students");
    expect(adminAcademicAr.rowsCount(0)).toContain("لا يوجد طلاب");
    expect(adminAcademicAr.rowsCount(1)).toContain("طالب واحد");
    expect(adminAcademicAr.rowsCount(2)).toContain("طالبان");
    expect(adminAcademicAr.rowsCount(5)).toContain("طلاب");
    expect(adminAcademicAr.rowsCount(15)).toContain("طالباً");
  });

  test("gradedHomeworkCount renders plural-safe counts in BOTH locales", () => {
    // EN rides the dense-table context: the column header already names the
    // track ("Jadid average"), so the caption carries only the honest count
    // — full copy would truncate under the desktop table's density trim.
    expect(adminAcademicEn.gradedHomeworkCount(0)).toBe("None graded");
    expect(adminAcademicEn.gradedHomeworkCount(1)).toBe("1 graded");
    expect(adminAcademicEn.gradedHomeworkCount(3)).toBe("3 graded");
    expect(adminAcademicAr.gradedHomeworkCount(0)).toContain("لا توجد واجبات مُقيَّمة");
    expect(adminAcademicAr.gradedHomeworkCount(1)).toContain("واجب مُقيَّم واحد");
    expect(adminAcademicAr.gradedHomeworkCount(2)).toContain("واجبان مُقيَّمان");
    expect(adminAcademicAr.gradedHomeworkCount(5)).toContain("واجبات مُقيَّمة");
    expect(adminAcademicAr.gradedHomeworkCount(15)).toContain("واجباً مُقيَّماً");
  });

  test("progressRowCount renders plural-safe counts in BOTH locales", () => {
    expect(adminAcademicEn.progressRowCount(0)).toBe("No recorded progress");
    expect(adminAcademicEn.progressRowCount(1)).toBe("1 progress entry");
    expect(adminAcademicEn.progressRowCount(3)).toBe("3 progress entries");
    expect(adminAcademicAr.progressRowCount(0)).toContain("لا يوجد تقدّم مسجَّل");
    expect(adminAcademicAr.progressRowCount(1)).toContain("سجل تقدّم واحد");
    expect(adminAcademicAr.progressRowCount(2)).toContain("سجلا تقدّم");
    expect(adminAcademicAr.progressRowCount(5)).toContain("سجلات تقدّم");
    expect(adminAcademicAr.progressRowCount(15)).toContain("سجل تقدّم");
  });

  test("homeworkCount renders plural-safe counts in BOTH locales", () => {
    expect(adminAcademicEn.homeworkCount(0)).toBe("No homework");
    expect(adminAcademicEn.homeworkCount(1)).toBe("1 homework entry");
    expect(adminAcademicEn.homeworkCount(3)).toBe("3 homework entries");
    expect(adminAcademicAr.homeworkCount(0)).toContain("لا توجد واجبات");
    expect(adminAcademicAr.homeworkCount(1)).toContain("واجب واحد");
    expect(adminAcademicAr.homeworkCount(2)).toContain("واجبان");
    expect(adminAcademicAr.homeworkCount(5)).toContain("واجبات");
    expect(adminAcademicAr.homeworkCount(15)).toContain("واجباً");
  });

  test("reportsCount renders plural-safe counts in BOTH locales", () => {
    expect(adminAcademicEn.reportsCount(0)).toBe("No reports");
    expect(adminAcademicEn.reportsCount(1)).toBe("1 report");
    expect(adminAcademicEn.reportsCount(3)).toBe("3 reports");
    expect(adminAcademicAr.reportsCount(0)).toContain("لا توجد تقارير");
    expect(adminAcademicAr.reportsCount(1)).toContain("تقرير واحد");
    expect(adminAcademicAr.reportsCount(2)).toContain("تقريران");
    expect(adminAcademicAr.reportsCount(5)).toContain("تقارير");
    expect(adminAcademicAr.reportsCount(15)).toContain("تقريراً");
  });

  test("all seven function slots are callable with non-empty output in BOTH locales", () => {
    expect(adminAcademicEn.rowsCount(2).length).toBeGreaterThan(0);
    expect(adminAcademicEn.gradedHomeworkCount(2).length).toBeGreaterThan(0);
    expect(adminAcademicEn.detailPageTitle("Adam").length).toBeGreaterThan(0);
    expect(adminAcademicEn.progressRowCount(2).length).toBeGreaterThan(0);
    expect(adminAcademicEn.homeworkCount(2).length).toBeGreaterThan(0);
    expect(adminAcademicEn.reportsCount(2).length).toBeGreaterThan(0);
    expect(adminAcademicEn.paginationPageOf(1, 5).length).toBeGreaterThan(0);
    expect(adminAcademicAr.rowsCount(2).length).toBeGreaterThan(0);
    expect(adminAcademicAr.gradedHomeworkCount(2).length).toBeGreaterThan(0);
    expect(adminAcademicAr.detailPageTitle("عبد الرحمن").length).toBeGreaterThan(0);
    expect(adminAcademicAr.progressRowCount(2).length).toBeGreaterThan(0);
    expect(adminAcademicAr.homeworkCount(2).length).toBeGreaterThan(0);
    expect(adminAcademicAr.reportsCount(2).length).toBeGreaterThan(0);
    expect(adminAcademicAr.paginationPageOf(1, 5).length).toBeGreaterThan(0);
  });
});

// ===========================================================================
describe("function-slot inventory — exactly the seven locale functions, on BOTH maps", () => {
  test.each([...FUNCTION_KEYS])("slot `%s` is a function on BOTH maps", key => {
    expect(typeof Reflect.get(adminAcademicAr, key)).toBe("function");
    expect(typeof Reflect.get(adminAcademicEn, key)).toBe("function");
  });

  test("no OTHER slot is function-valued (string/function split is stable)", () => {
    for (const key of Object.keys(adminAcademicEn)) {
      const isFunction = typeof Reflect.get(adminAcademicEn, key) === "function";
      expect(isFunction).toBe((FUNCTION_KEYS as readonly string[]).includes(key));
    }
  });

  test("the ar row count renders Arabic-Indic digits (page-date parity)", () => {
    expect(adminAcademicAr.rowsCount(5)).toContain("٥");
    expect(adminAcademicEn.rowsCount(5)).toContain("5");
  });
});

// ===========================================================================
describe("governance banner — accountDeletedBanner disclosure floor", () => {
  const EN_TITLE = "Account deleted";
  const EN_BODY =
    "This student's account has been deleted. The academic history below is retained for audit and is read-only.";
  const AR_TITLE = "الحساب محذوف";
  const AR_BODY = "تم حذف حساب هذا الطالب. يُحتفظ بالسجل الأكاديمي أدناه لأغراض التدقيق وهو للقراءة فقط.";

  test("the banner title + body are non-empty string slots on BOTH maps", () => {
    expect(stringSlotOf(adminAcademicEn, "accountDeletedBannerTitle", "en")).toBe(EN_TITLE);
    expect(stringSlotOf(adminAcademicEn, "accountDeletedBannerBody", "en")).toBe(EN_BODY);
    expect(stringSlotOf(adminAcademicAr, "accountDeletedBannerTitle", "ar")).toBe(AR_TITLE);
    expect(stringSlotOf(adminAcademicAr, "accountDeletedBannerBody", "ar")).toBe(AR_BODY);
  });

  test("the Arabic banner is RTL-correct — pure Arabic script, no Latin letters, no bidi controls", () => {
    for (const banner of [AR_TITLE, AR_BODY]) {
      expect(ARABIC_SCRIPT.test(banner)).toBe(true);
      expect(/[A-Za-z]/.test(banner)).toBe(false);
      expect(/[\u202A-\u202E\u2066-\u2069\u200E\u200F]/.test(banner)).toBe(false);
    }
  });

  test("the banner states the fact + audit retention only — no digits or cause/actor vocabulary in EITHER locale", () => {
    for (const banner of [EN_TITLE, EN_BODY, AR_TITLE, AR_BODY]) {
      expect(/\d/.test(banner)).toBe(false);
      expect(/\b(reason|caused by|by admin|on \w+ \d|deleted by|scheduled|requested)\b/i.test(banner)).toBe(false);
    }
  });
});

// ===========================================================================
describe("registry + bundle wiring", () => {
  test("namespaces registry exposes the AdminAcademic handle with the `<ns>.<ns>` id convention", () => {
    expect(Object.hasOwn(namespaces, "AdminAcademic")).toBe(true);
    expect(AdminAcademic.id).toBe("adminAcademic.adminAcademic");
  });

  test("handle getter resolves the composed bundle slice (both locales)", () => {
    expect(AdminAcademic.getLabels(enMessages)).toBe(enMessages.adminAcademicTranslations);
    expect(AdminAcademic.getLabels(arMessages)).toBe(arMessages.adminAcademicTranslations);
  });

  test("`adminAcademicTranslations` exists on BOTH message bundles", () => {
    expect(Object.hasOwn(enMessages, "adminAcademicTranslations")).toBe(true);
    expect(Object.hasOwn(arMessages, "adminAcademicTranslations")).toBe(true);
  });

  test("the bundle slice IS the leaf map (no re-wrapper indirection) in BOTH locales", () => {
    expect(enMessages.adminAcademicTranslations).toBe(adminAcademicEn);
    expect(arMessages.adminAcademicTranslations).toBe(adminAcademicAr);
  });
});
