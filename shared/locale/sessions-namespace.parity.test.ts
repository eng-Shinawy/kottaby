/**
 * `sessions`-namespace + session error-key locale verification
 * · ar+en parity gates over the NEW `sessions` UI namespace and the SEVEN
 *   session-lifecycle keys added to the `errors` namespace, plus synchronous
 *   resolution checks through `getTranslations(locale)`.
 *
 * WHAT THIS LOCKS
 *   1. ERRORS REGISTRY PIN — every session-lifecycle error key
 *      (`sessionNotFound`, `sessionInvalidTransition`, `teacherNotCertified`,
 *      `teacherNotFound`, `insufficientBalance`, `idempotencyKeyRequired`,
 *      `invalidSessionIntent`) exists as a NON-EMPTY string in BOTH locale
 *      maps of the `errors` namespace. `teacherNotFound` is a DEDICATED key —
 *      it must stay distinct from the generic `notFound` (different copy).
 *   2. SESSIONS PARITY BELT — the ar/en `sessions` leaf maps expose IDENTICAL
 *      key sets with non-empty string values (belt #2: the PRIMARY parity
 *      gate is compile-time typing where BOTH leaf consts are typed
 *      `SessionsLabels`; any missing key fails `bun tsgo`. This suite keeps
 *      the guarantee enforced even if someone loosens that typing later).
 *      Every mandated registry key is asserted present on BOTH maps; ICU
 *      placeholder-name sets agree across locales per key (no locale-local
 *      drift). The registry includes the post-confirmation arbitration
 *      inventory (escrow-class chips, consumed-escrow outcome labels/helpers,
 *      the partial-refund amount field, and the case-review dialog's
 *      section/empty-state copy).
 *   3. REGISTRY WIRING — the `Sessions` handle is registered in
 *      `shared/locale/namespaces/index.ts` with the conventional `<ns>.<ns>`
 *      id and its getter resolves to the composed bundle slice; both message
 *      bundles carry `sessionsTranslations`.
 *   4. SYNC RESOLUTION — `getTranslations(locale)` (pure, in-memory, never
 *      suspends) resolves a sample of the new keys in BOTH locales, warming
 *      the namespace the way component suites warm it before rendering.
 *   5. ARABIC-SCRIPT SANITY — sampled Arabic values actually contain Arabic
 *      script (guards a copy paste of English into the `ar` leaf).
 *   6. RUBRIC DIALOG PINS — the ten rubric-submission dialog keys resolve in
 *      BOTH locales as flat, interpolation-free copy, and the two
 *      weakness-area options stay distinct per locale.
 *
 * Mirrors the structure of `shared/locale/applicant-namespace.parity.test.ts`
 * (the closest sibling: new keys on `errors` + a brand-new namespace).
 *
 * Pure unit tier — NO server boot, NO network, NO DB. Runs via the mandated
 * runner: `bun run test/scripts/run-test.ts shared/locale/sessions-namespace.parity.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import { errorsAr } from "@/shared/locale/ar/errors";
import { arMessages } from "@/shared/locale/ar/messages";
import { sessionsAr } from "@/shared/locale/ar/sessions";
import { errorsEn } from "@/shared/locale/en/errors";
import { enMessages } from "@/shared/locale/en/messages";
import { sessionsEn } from "@/shared/locale/en/sessions";
import { namespaces } from "@/shared/locale/namespaces/index";
import { Sessions } from "@/shared/locale/namespaces/sessions";
import { getTranslations } from "@/shared/locale/server";

// ─── Mandated registries ─────────────────────────────────────────────────────

/** The SEVEN session-lifecycle keys mandated on the flat `ErrorsLabels` interface. */
const SESSION_ERROR_KEYS = [
  "sessionNotFound",
  "sessionInvalidTransition",
  "teacherNotCertified",
  "teacherNotFound",
  "insufficientBalance",
  "idempotencyKeyRequired",
  "invalidSessionIntent",
] as const;

/** The full key registry mandated for the `sessions` UI namespace. */
const MANDATED_SESSIONS_KEYS = [
  "studentPageTitle",
  "teacherPageTitle",
  "statusFilterAll",
  "status",
  "intent",
  "fee",
  "deadline",
  "createdAt",
  "studentEmptyTitle",
  "studentEmptyBody",
  "teacherEmptyTitle",
  "teacherEmptyBody",
  "statusScheduled",
  "statusStarted",
  "statusCompleted",
  "statusCancelled",
  "statusDisputed",
  "startSession",
  "completeSession",
  "cancelSession",
  "cancelConfirmTitle",
  "cancelConfirmBody",
  "cancelReasonLabel",
  "cancelReasonPlaceholder",
  "openDispute",
  "disputeConfirmTitle",
  "disputeConfirmBody",
  "disputeReasonLabel",
  "disputeReasonPlaceholder",
  "disputeReasonRequired",
  "disputeOpenedNotice",
  "cancelDisabledDisputed",
  "cancelReasonLine",
  "disputeReasonLine",
  "arbitrationOutcomeLine",
  "sessionStartedNotice",
  "sessionCompletedNotice",
  "sessionCancelledNotice",
  "holdReleasedNotice",
  "duplicateBookingInfo",
  "genericError",
  "adminDisputesPageTitle",
  "adminDisputesCountLine",
  "adminDisputesEmptyTitle",
  "adminDisputesEmptyBody",
  "disputeReasonMeta",
  "disputedAtLabel",
  "participantsLabel",
  "resolveDispute",
  "resolveDisputeTitle",
  "resolveDisputeBody",
  "resolutionCancelLabel",
  "resolutionCancelHelper",
  "resolutionCompleteLabel",
  "resolutionCompleteHelper",
  "resolutionNoteLabel",
  "resolutionNotePlaceholder",
  "resolveDisputeSubmit",
  "disputeResolvedNotice",
  "disputeReasonExpand",
  "disputeReasonCollapse",
  "pagerPreviousLabel",
  "pagerNextLabel",
  "rateTeacher",
  "rateTeacherTooltip",
  "rateTeacherDialogTitle",
  "rateTeacherDialogSubmit",
  "rateTeacherDialogCancel",
  "rateTeacherSuccess",
  "teacherRatedChip",
  "ratingEmptyLabelText",
  "escrowHeldChip",
  "escrowConsumedChip",
  "resolutionRefundLabel",
  "resolutionRefundHelper",
  "resolutionPartialRefundLabel",
  "resolutionPartialRefundHelper",
  "resolutionUpholdLabel",
  "resolutionUpholdHelper",
  "partialAmountLabel",
  "partialAmountPlaceholder",
  "reviewCase",
  "caseReviewTitle",
  "caseReviewReportTitle",
  "caseReviewHomeworkTitle",
  "caseReviewRecitationTitle",
  "caseReviewAuditTitle",
  "caseReviewRatingLabel",
  "caseReviewHomeworkCurrentLabel",
  "caseReviewHomeworkRevisionLabel",
  "caseReviewEmptyReport",
  "caseReviewEmptyHomework",
  "caseReviewEmptyRecitation",
  "caseReviewEmptyAudit",
  "teacherCaseCta",
  "teacherCaseTitle",
  "teacherCaseStudentLabel",
  "teacherCaseResolutionTitle",
  "teacherCasePendingLine",
  "teacherCaseReportTitle",
  "teacherCaseRatingLabel",
  "teacherCaseResolvedAtLabel",
  "adminDisputeAnalyticsTitle",
  "adminDisputeAnalyticsOpen",
  "adminDisputeAnalyticsResolved",
  "adminDisputeAnalyticsOutcomes",
  // ─── Session Report Submission (Jadid & Madi) — the new plan's vocabulary.
  "sessionReportAction",
  "viewHomeworkAction",
  "reportDialogPrepareTitle",
  "reportDialogSubmitTitle",
  "reportDialogReviewTitle",
  "reportNotesLabel",
  "reportNotesPlaceholder",
  "reportNotesRequiredMessage",
  "reportNotesTooLongMessage",
  "reportRatingLabel",
  "reportRatingRequiredMessage",
  "reportSubmitLabel",
  "reportCancelLabel",
  "reportSubmitSuccessNotice",
  "reportAlreadySubmittedNotice",
  "reportBlocksRequiredMessage",
  "reportAyahRangeMessage",
  "reportGradeRangeMessage",
  "reportSurahJuzRequiredMessage",
  "jadidSectionTitle",
  "madiSectionTitle",
  "fromAyahLabel",
  "toAyahLabel",
  "surahJuzPickerLabel",
  "gradePreviousSectionTitle",
  "reportFirstSessionHint",
  "reportAlreadyGradedLabel",
  "reportGradeJadidLabel",
  "reportGradeMadiLabel",
  "reportTrackEmptyLabel",
  "reportHistorySectionTitle",
  "reportHistoryEmptyMessage",
  "reportSessionDateLabel",
  "reportReviewedNotesLabel",
  "reportReviewedRatingLabel",
  // ─── Rubric Evaluation Submission (evaluator dialog) — the new plan's vocabulary.
  "submitEvaluationAction",
  "awaitingEvaluation",
  "rubricDialogTitle",
  "rubricScoreLabel",
  "rubricScoreBandPassing",
  "rubricScoreBandFailing",
  "rubricNotesLabel",
  "rubricWeaknessLabel",
  "rubricWeaknessTajweed",
  "rubricWeaknessHifz",
  "rubricWeaknessHelper",
  "rubricSubmitCta",
  "rubricSubmittedSuccess",
  "rubricImpactPass",
  "rubricImpactFail",
  "rubricDraftRestoredNotice",
  "rubricDraftDiscardCta",
  "rubricDraftSavedAtLabel",
  "rubricDraftParkedChip",
  "rubricDraftsPrunedLine",
  // ─── Pending-rubric banner (teacher sessions surface) — the new vocabulary.
  "pendingRubricCountLine",
  "pendingRubricFilterCta",
  "pendingRubricFilterActiveCta",
] as const;

/**
 * Keys whose values are TEMPLATE FUNCTIONS (the `DashboardLabels.welcome`
 * precedent) instead of plain strings — the arbitration count line
 * interpolates the honest total, the per-star rating aria label
 * interpolates the star position, the Surah/Juz label resolves a
 * `SurahJuzRef` enum member value to its localized display name, and the
 * grade-chip aria label composes the locale-controlled grade copy.
 */
const FUNCTION_LABEL_KEYS: ReadonlySet<string> = new Set([
  "adminDisputesCountLine",
  "ratingStarAriaLabel",
  "surahJuzLabel",
  "reportGradeAriaLabel",
  "pendingRubricCountLine",
  "rubricDraftsPrunedLine",
]);

/** Keys resolved through `getTranslations(locale)` in the sync-resolution tier. */
const SYNC_SAMPLE_ERROR_KEYS = ["sessionNotFound", "teacherNotFound", "insufficientBalance"] as const;
const SYNC_SAMPLE_SESSIONS_KEYS = [
  "studentPageTitle",
  "statusScheduled",
  "statusDisputed",
  "disputeOpenedNotice",
  "adminDisputesPageTitle",
  "duplicateBookingInfo",
  "genericError",
  "escrowConsumedChip",
  "resolutionPartialRefundLabel",
  "caseReviewTitle",
  "rubricSubmittedSuccess",
] as const;

/** Keys probed for Arabic-script content in the `ar` leaf. */
const ARABIC_SCRIPT_SAMPLE_KEYS = [
  "studentEmptyBody",
  "cancelConfirmBody",
  "disputeConfirmBody",
  "statusScheduled",
  "statusDisputed",
  "duplicateBookingInfo",
  "adminDisputesEmptyBody",
  "resolutionRefundHelper",
  "caseReviewEmptyReport",
  "rubricWeaknessHelper",
  "rubricWeaknessTajweed",
  "pendingRubricFilterCta",
  "pendingRubricFilterActiveCta",
  "rubricDraftRestoredNotice",
  "rubricDraftDiscardCta",
  "rubricDraftSavedAtLabel",
  "rubricDraftParkedChip",
] as const;

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

/** Reads one non-empty-string value slot off a locale map — throws otherwise. */
function nonEmptyLabelOf(localeMap: object, key: string, localeName: string): string {
  const value: unknown = Reflect.get(localeMap, key);
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${localeName}.${key} must be a non-empty localized string`);
  }
  return value;
}

/**
 * Flattens a (possibly nested) locale map to its DOTTED string-leaf paths —
 * grouped blocks (e.g. `planCatalog.planNotFound`) collapse into single
 * dotted paths so parity walks never crash on nested objects.
 */
function leafPathsOf(node: object, prefix = ""): string[] {
  return Object.entries(node).flatMap(([key, value]) => {
    const path = prefix.length === 0 ? key : `${prefix}.${key}`;
    return typeof value === "object" && value !== null ? leafPathsOf(value, path) : [path];
  });
}

/**
 * Reads one non-empty-string leaf off a locale map at a DOTTED path —
 * traverses nested blocks segment by segment, throwing on non-block nodes
 * or non-string leaves.
 */
function stringLeafOf(localeMap: object, path: string, localeName: string): string {
  let node: unknown = localeMap;
  for (const segment of path.split(".")) {
    if (node === null || typeof node !== "object") {
      throw new Error(`errors.${localeName}.${path} traverses a non-block node`);
    }
    node = Reflect.get(node, segment);
  }
  if (typeof node !== "string" || node.length === 0) {
    throw new Error(`errors.${localeName}.${path} must be a non-empty localized string`);
  }
  return node;
}

/** Sample arguments per function-label family (see {@link FUNCTION_LABEL_KEYS}). */
function sampleArgsFor(key: string): unknown[] {
  if (key === "surahJuzLabel") return ["juz_2"];
  if (key === "reportGradeAriaLabel") return ["Jadid grade", 92];
  return [2];
}

/**
 * Reads one label slot accepting BOTH value shapes: plain-string keys read
 * directly; template-function keys (see {@link FUNCTION_LABEL_KEYS}) resolve
 * by invocation with a sample argument. Throws on anything that does not
 * produce a non-empty string.
 */
function resolvedLabelOf(localeMap: object, key: string, localeName: string): string {
  if (FUNCTION_LABEL_KEYS.has(key)) {
    const fn: unknown = Reflect.get(localeMap, key);
    if (typeof fn !== "function") {
      throw new Error(`${localeName}.${key} must be a template function`);
    }
    // Sample arguments per function-label family: the Surah/Juz label takes
    // a string ref; the grade-chip aria label takes (gradeLabel, grade);
    // the numeric-key family (count line, star aria) takes one number.
    const value: unknown = Reflect.apply(fn, undefined, sampleArgsFor(key));
    if (typeof value !== "string" || value.length === 0) {
      throw new Error(`${localeName}.${key} must resolve to a non-empty localized string`);
    }
    return value;
  }
  return nonEmptyLabelOf(localeMap, key, localeName);
}

// ===========================================================================
describe("errors registry — the seven session-lifecycle keys in BOTH locales", () => {
  test.each([...SESSION_ERROR_KEYS])("errors key `%s` resolves as a non-empty string in BOTH locales", key => {
    expect(nonEmptyLabelOf(errorsAr, key, "ar").length).toBeGreaterThan(0);
    expect(nonEmptyLabelOf(errorsEn, key, "en").length).toBeGreaterThan(0);
    // Key must be part of the COMPILE-TIME schema too — Reflect-only
    // additions (untyped holes) are prohibited by the ErrorsLabels contract.
    expect(Object.hasOwn(errorsEn, key)).toBe(true);
    expect(Object.hasOwn(errorsAr, key)).toBe(true);
  });

  test("`teacherNotFound` stays a DEDICATED key — copy differs from the generic `notFound`", () => {
    expect(nonEmptyLabelOf(errorsEn, "teacherNotFound", "en")).not.toBe(nonEmptyLabelOf(errorsEn, "notFound", "en"));
    expect(nonEmptyLabelOf(errorsAr, "teacherNotFound", "ar")).not.toBe(nonEmptyLabelOf(errorsAr, "notFound", "ar"));
  });

  test("placeholder-name sets agree across ar/en for EVERY errors key (no locale-local drift)", () => {
    // Grouped blocks (e.g. `planCatalog.planNotFound`) are flattened to their
    // dotted leaf paths ({@link leafPathsOf}) — every STRING leaf must agree
    // with the other map's placeholder set at the SAME path (a flat key loop
    // crashed on nested blocks: nonEmptyLabelOf saw an object where it
    // demanded a string). Leaf reads go through {@link stringLeafOf}, which
    // tolerates the nested blocks. The loop walks the UNION of both
    // leaf-path sets: an en-only leaf would otherwise bypass placeholder
    // comparison entirely (an ar-only leaf already failed via the missing
    // en read). The explicit not.toThrow presence probes turn a
    // one-side-only path into a readable parity failure before the
    // placeholder comparison runs.
    const unionPaths = [...new Set([...leafPathsOf(errorsAr), ...leafPathsOf(errorsEn)])];
    for (const path of unionPaths) {
      expect(() => stringLeafOf(errorsAr, path, "ar")).not.toThrow();
      expect(() => stringLeafOf(errorsEn, path, "en")).not.toThrow();
      const arNames = icuPlaceholdersOf(stringLeafOf(errorsAr, path, "ar"));
      const enNames = icuPlaceholdersOf(stringLeafOf(errorsEn, path, "en"));
      expect(enNames).toEqual(arNames);
    }
  });
});

// ===========================================================================
describe("sessions namespace — compile-time parity mirror", () => {
  test("identical sorted key sets across BOTH locale sources", () => {
    const arKeys = Object.keys(sessionsAr).toSorted((a, b) => a.localeCompare(b));
    const enKeys = Object.keys(sessionsEn).toSorted((a, b) => a.localeCompare(b));

    expect(arKeys.length).toBeGreaterThan(0);
    expect(enKeys).toEqual(arKeys);
  });

  test("every mandated registry key exists on BOTH maps", () => {
    for (const key of MANDATED_SESSIONS_KEYS) {
      expect(Object.hasOwn(sessionsEn, key)).toBe(true);
      expect(Object.hasOwn(sessionsAr, key)).toBe(true);
    }
  });

  test("every value on BOTH maps is a non-empty localized string (zero dead keys)", () => {
    for (const key of Object.keys(sessionsAr)) {
      expect(resolvedLabelOf(sessionsAr, key, "ar").length).toBeGreaterThan(0);
      expect(resolvedLabelOf(sessionsEn, key, "en").length).toBeGreaterThan(0);
    }
    // Symmetric sweep — guards an en-only key that ar lost via future drift.
    for (const key of Object.keys(sessionsEn)) {
      expect(resolvedLabelOf(sessionsAr, key, "ar").length).toBeGreaterThan(0);
    }
  });

  test("placeholder-name sets agree across ar/en for EVERY sessions key (no locale-local drift)", () => {
    for (const key of Object.keys(sessionsAr)) {
      // Template-function keys interpolate through arguments (no ICU braces);
      // the invocation above still yields comparable resolved strings.
      const arNames = icuPlaceholdersOf(resolvedLabelOf(sessionsAr, key, "ar"));
      const enNames = icuPlaceholdersOf(resolvedLabelOf(sessionsEn, key, "en"));
      expect(enNames).toEqual(arNames);
    }
  });

  test("sampled Arabic values carry Arabic script (guards an English paste into the ar leaf)", () => {
    const arabicLetter = /[\u0600-\u06FF]/;
    for (const key of ARABIC_SCRIPT_SAMPLE_KEYS) {
      expect(arabicLetter.test(nonEmptyLabelOf(sessionsAr, key, "ar"))).toBe(true);
    }
  });
});

// ===========================================================================
describe("rubric evaluation dialog keys — pinned in BOTH locales", () => {
  /** The ten dialog keys minted for the evaluator's rubric submission surface. */
  const RUBRIC_DIALOG_KEYS = [
    "submitEvaluationAction",
    "awaitingEvaluation",
    "rubricDialogTitle",
    "rubricScoreLabel",
    "rubricNotesLabel",
    "rubricWeaknessLabel",
    "rubricWeaknessTajweed",
    "rubricWeaknessHifz",
    "rubricWeaknessHelper",
    "rubricSubmitCta",
    "rubricSubmittedSuccess",
    "rubricImpactPass",
    "rubricImpactFail",
    "rubricDraftRestoredNotice",
    "rubricDraftDiscardCta",
    "rubricDraftSavedAtLabel",
    "rubricDraftParkedChip",
  ] as const;

  test.each([...RUBRIC_DIALOG_KEYS])("rubric dialog key `%s` resolves as a non-empty string in BOTH locales", key => {
    expect(nonEmptyLabelOf(sessionsAr, key, "ar").length).toBeGreaterThan(0);
    expect(nonEmptyLabelOf(sessionsEn, key, "en").length).toBeGreaterThan(0);
    // Key must be part of the COMPILE-TIME schema too — Reflect-only
    // additions (untyped holes) are prohibited by the SessionsLabels contract.
    expect(Object.hasOwn(sessionsEn, key)).toBe(true);
    expect(Object.hasOwn(sessionsAr, key)).toBe(true);
  });

  test("every rubric dialog key carries ZERO ICU placeholders in BOTH locales (flat dialog copy)", () => {
    for (const key of RUBRIC_DIALOG_KEYS) {
      expect(icuPlaceholdersOf(nonEmptyLabelOf(sessionsAr, key, "ar"))).toEqual([]);
      expect(icuPlaceholdersOf(nonEmptyLabelOf(sessionsEn, key, "en"))).toEqual([]);
    }
  });

  test("the two weakness-area options stay DISTINCT copy in BOTH locales (no collapsed options)", () => {
    expect(nonEmptyLabelOf(sessionsEn, "rubricWeaknessTajweed", "en")).not.toBe(
      nonEmptyLabelOf(sessionsEn, "rubricWeaknessHifz", "en")
    );
    expect(nonEmptyLabelOf(sessionsAr, "rubricWeaknessTajweed", "ar")).not.toBe(
      nonEmptyLabelOf(sessionsAr, "rubricWeaknessHifz", "ar")
    );
  });
});

// ===========================================================================
describe("sessions registry + bundle wiring", () => {
  test("namespaces registry exposes the Sessions handle with the `<ns>.<ns>` id convention", () => {
    expect(Object.hasOwn(namespaces, "Sessions")).toBe(true);
    expect(Sessions.id).toBe("sessions.sessions");
  });

  test("handle getter resolves the composed bundle slice (both locales)", () => {
    expect(Sessions.getLabels(enMessages)).toBe(enMessages.sessionsTranslations);
    expect(Sessions.getLabels(arMessages)).toBe(arMessages.sessionsTranslations);
  });

  test("`sessionsTranslations` exists on BOTH message bundles", () => {
    expect(Object.hasOwn(enMessages, "sessionsTranslations")).toBe(true);
    expect(Object.hasOwn(arMessages, "sessionsTranslations")).toBe(true);
  });
});

// ===========================================================================
describe("sync resolution — getTranslations(locale) resolves the new keys", () => {
  test("sampled error keys resolve synchronously in BOTH locales", () => {
    for (const locale of ["en", "ar"] as const) {
      const translations = getTranslations(locale);
      for (const key of SYNC_SAMPLE_ERROR_KEYS) {
        const value = translations.errorsTranslations[key];
        expect(typeof value).toBe("string");
        expect(value.length).toBeGreaterThan(0);
      }
    }
  });

  test("sampled sessions keys resolve synchronously in BOTH locales", () => {
    for (const locale of ["en", "ar"] as const) {
      const translations = getTranslations(locale);
      for (const key of SYNC_SAMPLE_SESSIONS_KEYS) {
        const value = translations.sessionsTranslations[key];
        expect(typeof value).toBe("string");
        expect(value.length).toBeGreaterThan(0);
      }
    }
  });

  test("unknown locale falls back to the default bundle without throwing", () => {
    const translations = getTranslations("xx");
    expect(typeof translations.sessionsTranslations.studentPageTitle).toBe("string");
  });
});

// ===========================================================================
describe("surahJuzLabel — exhaustive 35-member vocabulary (Jadid & Madi)", () => {
  /** The full `SurahJuzRef` enum vocabulary — 5 surahs + 30 juz. */
  const SURAH_JUZ_REFS = [
    "surah_al_fatihah",
    "surah_al_baqarah",
    "surah_aal_imran",
    "surah_an_nisa",
    "surah_al_maidah",
    ...Array.from({ length: 30 }, (_, index) => `juz_${index + 1}`),
  ] as const;

  test("every ref in the 35-value vocabulary resolves to a non-empty string in BOTH locales", () => {
    for (const ref of SURAH_JUZ_REFS) {
      expect(typeof sessionsEn.surahJuzLabel(ref)).toBe("string");
      expect(sessionsEn.surahJuzLabel(ref).length).toBeGreaterThan(0);
      expect(typeof sessionsAr.surahJuzLabel(ref)).toBe("string");
      expect(sessionsAr.surahJuzLabel(ref).length).toBeGreaterThan(0);
    }
  });

  test("ar values carry Arabic script (guards an English-copy/paste drift into the ar leaf)", () => {
    // Arabic-letters block range (U+0600..U+06FF) plus the Arabic-Indic digits
    // (U+0660..U+0669) the ar leaf uses for juz numbering.
    const arabicScript = /[\u0600-\u06FF]/;
    for (const ref of SURAH_JUZ_REFS) {
      const arValue = sessionsAr.surahJuzLabel(ref);
      expect(arValue).toMatch(arabicScript);
    }
  });

  test("en values carry Latin script (guards an Arabic-copy/paste drift into the en leaf)", () => {
    const latinScript = /[A-Za-z]/;
    for (const ref of SURAH_JUZ_REFS) {
      const enValue = sessionsEn.surahJuzLabel(ref);
      expect(enValue).toMatch(latinScript);
    }
  });

  test("unknown ref rides the raw value verbatim (fail-closed — never throws, never empty)", () => {
    expect(sessionsEn.surahJuzLabel("unknown_ref_xyz")).toBe("unknown_ref_xyz");
    expect(sessionsAr.surahJuzLabel("unknown_ref_xyz")).toBe("unknown_ref_xyz");
    // Empty string input rides as the raw empty string (the function never throws).
    expect(sessionsEn.surahJuzLabel("")).toBe("");
    expect(sessionsAr.surahJuzLabel("")).toBe("");
  });

  test("the surah names start with the localized 'Surah' / 'سورة' word and juz names start with 'Juz' / 'الجزء'", () => {
    for (const ref of SURAH_JUZ_REFS.slice(0, 5)) {
      expect(sessionsEn.surahJuzLabel(ref).startsWith("Surah ")).toBe(true);
      expect(sessionsAr.surahJuzLabel(ref).startsWith("سورة ")).toBe(true);
    }
    for (const ref of SURAH_JUZ_REFS.slice(5)) {
      expect(sessionsEn.surahJuzLabel(ref).startsWith("Juz ")).toBe(true);
      expect(sessionsAr.surahJuzLabel(ref).startsWith("الجزء ")).toBe(true);
    }
  });

  test("the function is registered in the function-keys set (parity belt invokes it correctly)", () => {
    expect(FUNCTION_LABEL_KEYS.has("surahJuzLabel")).toBe(true);
  });
});
