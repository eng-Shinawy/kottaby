/**
 * Pure-unit tests for the teacher preparation dialog helpers — the
 * progress fold's honesty rule, the homework span shaping, the "+N more"
 * arithmetic, and the Prepare-affordance gate.
 *
 * Pure unit tier — NO server boot, NO network, NO DB. Runs via the
 * mandated runner:
 * `bun run test/scripts/run-test.ts frontend/views/teacher/sessions/teacherPrepDialog.helpers.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import {
  type MyTeacherSessionsQuery_myTeacherSessions_items,
  SessionIntent,
  SessionStatus,
  SessionType,
  type StudentHomeworkHistoryQuery_studentHomeworkHistory_items,
  type StudentProgressQuery_studentProgress,
  SurahJuzRef,
} from "@/frontend/graphql/generated/gql/graphql";
import {
  formatPrepAyahRun,
  PREP_SESSION_INTENTS,
  resolveHiddenHomeworkCount,
  resolvePrepHomeworkRows,
  resolvePrepSection,
  shouldOfferPrep,
} from "@/frontend/views/teacher/sessions/teacherPrepDialog.helpers";

/** A canonical positioned payload — lesson 2 of 3, 33% (the mid-plan glance). */
const POSITIONED_PROGRESS: StudentProgressQuery_studentProgress = {
  hasProgress: true,
  studentId: 7,
  planId: 3,
  planTitle: "Plan 3",
  totalLessons: 3,
  currentLessonId: 12,
  currentLessonTitle: "Lesson 2",
  currentLessonPosition: 2,
  lessonsCompleted: 1,
  completionPercent: 33,
  isOnFinalLesson: false,
};

/** The honest zero payload the server composes for a student with no settled pointer row. */
const FIRST_SESSION_PROGRESS: StudentProgressQuery_studentProgress = {
  hasProgress: false,
  studentId: 7,
  planId: null,
  planTitle: null,
  totalLessons: 0,
  currentLessonId: null,
  currentLessonTitle: null,
  currentLessonPosition: null,
  lessonsCompleted: 0,
  completionPercent: 0,
  isOnFinalLesson: false,
};

/**
 * Hostile-payload builder: the wire can never produce these field shapes
 * (the codegen contract forbids them), so the legs deliberately break one
 * field at a time and pin the honest fold — the helper must never crash
 * and never invent a replacement value.
 */
function progressWith(
  overrides: Partial<Record<keyof StudentProgressQuery_studentProgress, unknown>>
): StudentProgressQuery_studentProgress {
  return Object.assign({}, POSITIONED_PROGRESS, overrides);
}

/** Builds a canonical history row (both tracks assigned + graded) with overrides. */
function makeHistoryRow(
  overrides: Partial<StudentHomeworkHistoryQuery_studentHomeworkHistory_items> = {}
): StudentHomeworkHistoryQuery_studentHomeworkHistory_items {
  return {
    id: "hw-1",
    sessionId: 100,
    currentFromAyah: 1,
    currentToAyah: 7,
    currentGrade: 80,
    currentSurahJuz: SurahJuzRef.SurahAlBaqarah,
    revisionFromAyah: 281,
    revisionToAyah: 286,
    revisionGrade: 90,
    revisionSurahJuz: SurahJuzRef.Juz30,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/** Builds a canonical scheduled tajweed session row with overrides. */
function makeSessionRow(
  overrides: Partial<MyTeacherSessionsQuery_myTeacherSessions_items> = {}
): MyTeacherSessionsQuery_myTeacherSessions_items {
  return {
    id: "session-1",
    status: SessionStatus.Scheduled,
    intent: SessionIntent.Tajweed,
    sessionType: SessionType.StudentSession,
    fee: null,
    feeHeld: false,
    studentId: "7",
    teacherId: "5",
    // The counterpart identity bands are nullable on the wire (the teacher
    // lister batch-enriches ONLY the student side); these fixtures don't
    // exercise the band, so both legs stay honestly null.
    student: null,
    teacher: null,
    startedAt: null,
    endedAt: null,
    confirmationDeadline: null,
    confirmedByStudentAt: null,
    confirmedByTeacherAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    cancelReason: null,
    disputeReason: null,
    disputedAt: null,
    resolutionNote: null,
    resolutionOutcome: null,
    resolvedAt: null,
    ...overrides,
  };
}

describe("resolvePrepSection — the hasProgress honesty rule", () => {
  test("hasProgress false yields the first-session state — and ONLY that state", () => {
    const section = resolvePrepSection(FIRST_SESSION_PROGRESS);
    expect(section.kind).toBe("firstSession");
    expect(section).toEqual({ kind: "firstSession" });
    expect(Object.keys(section)).toEqual(["kind"]);
  });

  test("hasProgress false with populated lesson fields STILL yields first-session (the honesty rule wins)", () => {
    // A payload claiming no progress while carrying a full curriculum
    // position is broken; the fold must stay on the honest side.
    const section = resolvePrepSection(progressWith({ hasProgress: false }));
    expect(section).toEqual({ kind: "firstSession" });
  });

  test("an active plan without a pointer row (plan fields set, flag false) stays first-session", () => {
    const section = resolvePrepSection(
      progressWith({ hasProgress: false, planId: 3, planTitle: "Plan 3", totalLessons: 3 })
    );
    expect(section).toEqual({ kind: "firstSession" });
  });

  test("totalLessons 0 with hasProgress false stays first-session (no lesson count to show)", () => {
    const section = resolvePrepSection(progressWith({ hasProgress: false, totalLessons: 0 }));
    expect(section).toEqual({ kind: "firstSession" });
  });

  test("hasProgress true yields the positioned card with every field verbatim", () => {
    expect(resolvePrepSection(POSITIONED_PROGRESS)).toEqual({
      kind: "positioned",
      lessonTitle: "Lesson 2",
      position: 2,
      totalLessons: 3,
      completionPercent: 33,
      planTitle: "Plan 3",
      isOnFinalLesson: false,
    });
  });

  test("isOnFinalLesson true renders the positioned end-state (position equals the total)", () => {
    const section = resolvePrepSection(
      progressWith({
        isOnFinalLesson: true,
        currentLessonPosition: 3,
        lessonsCompleted: 3,
        completionPercent: 100,
      })
    );
    expect(section.kind).toBe("positioned");
    if (section.kind === "positioned") {
      expect(section.isOnFinalLesson).toBe(true);
      expect(section.position).toBe(3);
      expect(section.totalLessons).toBe(3);
      expect(section.completionPercent).toBe(100);
    }
  });

  test("a null planTitle rides the positioned card (plan identity is nullable, not fabricated)", () => {
    const section = resolvePrepSection(progressWith({ planTitle: null }));
    expect(section.kind).toBe("positioned");
    if (section.kind === "positioned") {
      expect(section.planTitle).toBeNull();
    }
  });

  test("a hostile undefined planTitle folds to null on the positioned card (the omitted-line state)", () => {
    const section = resolvePrepSection(progressWith({ planTitle: undefined }));
    expect(section.kind).toBe("positioned");
    if (section.kind === "positioned") {
      expect(section.planTitle).toBeNull();
    }
  });

  test("a null position with the flag true (the re-anchor shape) folds to first-session — no position is invented", () => {
    expect(resolvePrepSection(progressWith({ currentLessonPosition: null }))).toEqual({
      kind: "firstSession",
    });
  });
});

describe("resolvePrepSection — hostile payload folds (never crash, never fabricate)", () => {
  test("an undefined honesty flag folds to first-session", () => {
    expect(resolvePrepSection(progressWith({ hasProgress: undefined }))).toEqual({ kind: "firstSession" });
  });

  test("an undefined lesson title folds to first-session", () => {
    expect(resolvePrepSection(progressWith({ currentLessonTitle: undefined }))).toEqual({
      kind: "firstSession",
    });
  });

  test("an empty-string lesson title folds to first-session", () => {
    // A blank lesson name is a curriculum pointer that names nothing —
    // the honest presentation is the diagnostic first-session state.
    expect(resolvePrepSection(progressWith({ currentLessonTitle: "" }))).toEqual({
      kind: "firstSession",
    });
  });

  test("a NaN position folds to first-session", () => {
    expect(resolvePrepSection(progressWith({ currentLessonPosition: Number.NaN }))).toEqual({
      kind: "firstSession",
    });
  });

  test("a position below the 1-based band folds to first-session", () => {
    expect(resolvePrepSection(progressWith({ currentLessonPosition: 0 }))).toEqual({ kind: "firstSession" });
  });

  test("a missing or zero lesson total folds to first-session", () => {
    expect(resolvePrepSection(progressWith({ totalLessons: undefined }))).toEqual({ kind: "firstSession" });
    expect(resolvePrepSection(progressWith({ totalLessons: 0 }))).toEqual({ kind: "firstSession" });
  });

  test("a broken completion percent folds to first-session (non-numeric or outside 0–100)", () => {
    expect(resolvePrepSection(progressWith({ completionPercent: Number.NaN }))).toEqual({
      kind: "firstSession",
    });
    expect(resolvePrepSection(progressWith({ completionPercent: 101 }))).toEqual({ kind: "firstSession" });
    expect(resolvePrepSection(progressWith({ completionPercent: -1 }))).toEqual({ kind: "firstSession" });
  });

  test("a missing final-lesson flag folds to first-session", () => {
    expect(resolvePrepSection(progressWith({ isOnFinalLesson: undefined }))).toEqual({
      kind: "firstSession",
    });
  });
});

describe("resolvePrepHomeworkRows — jadid/madi span shaping", () => {
  test("maps current to the jadid span and revision to the madi span (session id as the display string)", () => {
    const [row] = resolvePrepHomeworkRows([makeHistoryRow()]);
    expect(row).toEqual({
      id: "hw-1",
      sessionId: "100",
      jadid: { surahJuz: SurahJuzRef.SurahAlBaqarah, fromAyah: 1, toAyah: 7, grade: 80 },
      madi: { surahJuz: SurahJuzRef.Juz30, fromAyah: 281, toAyah: 286, grade: 90 },
    });
  });

  test("preserves a null grade on one track (assigned but not yet graded — never a fabricated zero)", () => {
    const [row] = resolvePrepHomeworkRows([makeHistoryRow({ currentGrade: null })]);
    expect(row?.jadid).toEqual({ surahJuz: SurahJuzRef.SurahAlBaqarah, fromAyah: 1, toAyah: 7, grade: null });
    expect(row?.madi).toEqual({ surahJuz: SurahJuzRef.Juz30, fromAyah: 281, toAyah: 286, grade: 90 });
  });

  test("keeps a row with BOTH spans null (the no-assignment state renders, the row is not dropped)", () => {
    const bothAbsent = makeHistoryRow({
      currentFromAyah: null,
      currentToAyah: null,
      currentGrade: null,
      currentSurahJuz: null,
      revisionFromAyah: null,
      revisionToAyah: null,
      revisionGrade: null,
      revisionSurahJuz: null,
    });
    const rows = resolvePrepHomeworkRows([bothAbsent]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.jadid).toBeNull();
    expect(rows[0]?.madi).toBeNull();
    expect(rows[0]?.id).toBe("hw-1");
  });

  test("a one-track row folds the absent track to null and keeps the present one", () => {
    const [row] = resolvePrepHomeworkRows([
      makeHistoryRow({
        revisionFromAyah: null,
        revisionToAyah: null,
        revisionGrade: null,
        revisionSurahJuz: null,
      }),
    ]);
    expect(row?.jadid).not.toBeNull();
    expect(row?.madi).toBeNull();
  });

  test("a grade without a span still folds to a present span (no data dropped on a broken track)", () => {
    const [row] = resolvePrepHomeworkRows([
      makeHistoryRow({
        currentFromAyah: null,
        currentToAyah: null,
        currentSurahJuz: null,
      }),
    ]);
    expect(row?.jadid).toEqual({ surahJuz: null, fromAyah: null, toAyah: null, grade: 80 });
  });

  test("empty history folds to an empty row list", () => {
    expect(resolvePrepHomeworkRows([])).toEqual([]);
  });

  test("the server's newest-first order rides untouched", () => {
    const rows = resolvePrepHomeworkRows([makeHistoryRow({ id: "hw-2" }), makeHistoryRow({ id: "hw-1" })]);
    expect(rows.map(row => row.id)).toEqual(["hw-2", "hw-1"]);
  });
});

describe("formatPrepAyahRun — the ayah-run shaping (one-sided hostile spans degrade, never a dangling dash)", () => {
  test("both legs present renders the full range — byte-identical to the interpolation it replaces", () => {
    expect(formatPrepAyahRun(1, 7)).toBe("1–7");
    expect(formatPrepAyahRun(281, 286)).toBe("281–286");
  });

  test("fromAyah present with toAyah null renders that leg alone — no dangling dash", () => {
    expect(formatPrepAyahRun(1, null)).toBe("1");
  });

  test("toAyah present with fromAyah null renders that leg alone", () => {
    expect(formatPrepAyahRun(null, 7)).toBe("7");
  });

  test("neither leg present renders the per-track placeholder (the grade-only span shape)", () => {
    expect(formatPrepAyahRun(null, null)).toBe("—");
  });

  test("a non-finite leg is a broken leg — folds to the one-sided or placeholder shape", () => {
    expect(formatPrepAyahRun(Number.NaN, 7)).toBe("7");
    expect(formatPrepAyahRun(1, Number.NaN)).toBe("1");
    expect(formatPrepAyahRun(Number.NaN, Number.NaN)).toBe("—");
  });
});

describe("resolveHiddenHomeworkCount — the +N more arithmetic", () => {
  test("an empty history hides nothing (totalCount 0)", () => {
    expect(resolveHiddenHomeworkCount(0, 5)).toBe(0);
  });

  test("a full first page hides nothing (totalCount 5, shown 5)", () => {
    expect(resolveHiddenHomeworkCount(5, 5)).toBe(0);
  });

  test("deeper history surfaces the remainder (totalCount 12, shown 5 → 7)", () => {
    expect(resolveHiddenHomeworkCount(12, 5)).toBe(7);
  });

  test("a shown count exceeding the total floors at zero", () => {
    expect(resolveHiddenHomeworkCount(5, 7)).toBe(0);
  });

  test("a broken envelope folds to zero — never a NaN more-line", () => {
    expect(resolveHiddenHomeworkCount(Number.NaN, 5)).toBe(0);
    expect(resolveHiddenHomeworkCount(12, Number.NaN)).toBe(0);
  });
});

describe("shouldOfferPrep — the Prepare-affordance gate", () => {
  test("a scheduled tajweed row offers Prepare", () => {
    expect(shouldOfferPrep(makeSessionRow())).toBe(true);
  });

  test("scheduled non-tajweed intents do not (hifz, evaluation)", () => {
    expect(shouldOfferPrep(makeSessionRow({ intent: SessionIntent.Hifz }))).toBe(false);
    expect(shouldOfferPrep(makeSessionRow({ intent: SessionIntent.Evaluation }))).toBe(false);
  });

  test("a scheduled row with a null intent does not (the null-guard precedes the record lookup)", () => {
    expect(shouldOfferPrep(makeSessionRow({ intent: null }))).toBe(false);
  });

  test("no other status offers Prepare — even with the tajweed intent", () => {
    expect(shouldOfferPrep(makeSessionRow({ status: SessionStatus.Started }))).toBe(false);
    expect(shouldOfferPrep(makeSessionRow({ status: SessionStatus.Completed }))).toBe(false);
    expect(shouldOfferPrep(makeSessionRow({ status: SessionStatus.Cancelled }))).toBe(false);
    expect(shouldOfferPrep(makeSessionRow({ status: SessionStatus.Disputed }))).toBe(false);
  });

  test("the intent gate record admits ONLY tajweed", () => {
    expect(PREP_SESSION_INTENTS).toEqual({
      [SessionIntent.Tajweed]: true,
      [SessionIntent.Hifz]: false,
      [SessionIntent.Evaluation]: false,
    });
  });
});
