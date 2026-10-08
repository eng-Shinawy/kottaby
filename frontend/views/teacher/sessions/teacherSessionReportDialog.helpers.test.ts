/**
 * Pure-unit tests for the teacher session-report dialog helpers.
 *
 * Mirrors `session-report.guards.ts` server vocabulary: every guard
 * bound (notes trim/required/2000, 0–5 rating, ayah from≤to, ≥1 block,
 * 0–100 grades). Plus the BOPLA field assertions on `buildSubmitPayload`
 * (grades structurally absent on the assignment block; the
 * `previousGrades` pair always present in payload when both grades set,
 * absent when either is null), the newest-row derivation table, and the
 * ungraded predicate.
 *
 * Pure unit tier — NO server boot, NO network, NO DB. Runs via the
 * mandated runner: `bun run test/scripts/run-test.ts frontend/views/teacher/sessions/teacherSessionReportDialog.helpers.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import { SurahJuzRef as BackendSurahJuzRef } from "@/backend/enum/shared/surah-juz-ref.enum";
import {
  type StudentHomeworkHistoryQuery,
  type StudentHomeworkHistoryQuery_studentHomeworkHistory_items,
  SurahJuzRef,
} from "@/frontend/graphql/generated/gql/graphql";
import {
  buildSubmitPayload,
  type FormGradeFields,
  isNewestRowUngraded,
  resolveNewestRow,
  type SessionReportFormState,
  validateReportForm,
} from "@/frontend/views/teacher/sessions/teacherSessionReportDialog.helpers";
import { sessionsEn } from "@/shared/locale/en/sessions";

const t = sessionsEn;
const VALID_JADID = { fromAyah: 1, toAyah: 7, surahJuz: BackendSurahJuzRef.SurahAlBaqarah };
const VALID_MADI = { fromAyah: 281, toAyah: 286, surahJuz: BackendSurahJuzRef.Juz30 };
const VALID_GRADES: FormGradeFields = { currentGrade: 80, revisionGrade: 90 };

function validForm(overrides: Partial<SessionReportFormState> = {}): SessionReportFormState {
  return {
    teacherNotes: "Steady recitation; the revision plan continues next lesson.",
    studentRatingByTeacher: 4,
    jadid: VALID_JADID,
    madi: VALID_MADI,
    previousGrades: VALID_GRADES,
    ...overrides,
  };
}

describe("buildSubmitPayload — BOPLA field-by-field construction", () => {
  test("builds the four canonical fields from a full form", () => {
    const payload = buildSubmitPayload(validForm());
    expect(payload.teacherNotes).toBe("Steady recitation; the revision plan continues next lesson.");
    expect(payload.studentRatingByTeacher).toBe(4);
    expect(payload.homework).toEqual({ jadid: VALID_JADID, madi: VALID_MADI });
    expect(payload.previousGrades).toEqual({ currentGrade: 80, revisionGrade: 90 });
  });

  test("trims teacherNotes (no leading/trailing whitespace rides to the payload)", () => {
    const payload = buildSubmitPayload(validForm({ teacherNotes: "  trimmed  " }));
    expect(payload.teacherNotes).toBe("trimmed");
  });

  test("previousGrades is ABSENT when EITHER grade is null (first-session skip-grade posture)", () => {
    const onlyJadidGraded = buildSubmitPayload(
      validForm({ previousGrades: { currentGrade: 80, revisionGrade: null } })
    );
    expect(onlyJadidGraded.previousGrades).toBeUndefined();
    const onlyMadiGraded = buildSubmitPayload(validForm({ previousGrades: { currentGrade: null, revisionGrade: 90 } }));
    expect(onlyMadiGraded.previousGrades).toBeUndefined();
    const bothNull = buildSubmitPayload(validForm({ previousGrades: { currentGrade: null, revisionGrade: null } }));
    expect(bothNull.previousGrades).toBeUndefined();
  });

  test("previousGrades is ABSENT when the form carries no previousGrades at all", () => {
    const payload = buildSubmitPayload(validForm({ previousGrades: null }));
    expect(payload.previousGrades).toBeUndefined();
  });

  test("homework is ABSENT when BOTH blocks are null/undefined", () => {
    const payload = buildSubmitPayload(validForm({ jadid: null, madi: null }));
    expect(payload.homework).toBeUndefined();
  });

  test("homework carries only the present block when one is null", () => {
    const onlyJadid = buildSubmitPayload(validForm({ jadid: VALID_JADID, madi: null }));
    expect(onlyJadid.homework).toEqual({ jadid: VALID_JADID });
    expect(onlyJadid.homework).not.toHaveProperty("madi");
  });

  test("rating defaults to 0 when the form carries null (the build-time fallback, server re-validates)", () => {
    const payload = buildSubmitPayload(validForm({ studentRatingByTeacher: null }));
    expect(payload.studentRatingByTeacher).toBe(0);
  });

  test("assignment blocks carry NO grade fields (grades are structurally absent on the assignment payload)", () => {
    const payload = buildSubmitPayload(validForm());
    expect(payload.homework?.jadid).toEqual({ fromAyah: 1, toAyah: 7, surahJuz: BackendSurahJuzRef.SurahAlBaqarah });
    expect(payload.homework?.madi).toEqual({ fromAyah: 281, toAyah: 286, surahJuz: BackendSurahJuzRef.Juz30 });
    // No grade keys on the assignment block — BOPLA: grades belong only to `previousGrades`.
    expect(payload.homework?.jadid).not.toHaveProperty("currentGrade");
    expect(payload.homework?.jadid).not.toHaveProperty("revisionGrade");
    expect(payload.homework?.madi).not.toHaveProperty("currentGrade");
    expect(payload.homework?.madi).not.toHaveProperty("revisionGrade");
  });

  test("no extra keys on the payload (closed whitelist — BOPLA: no spread, no smuggle)", () => {
    const payload = buildSubmitPayload(validForm());
    const keys = Object.keys(payload).toSorted((a, b) => a.localeCompare(b));
    expect(keys).toEqual(["homework", "previousGrades", "studentRatingByTeacher", "teacherNotes"]);
  });
});

describe("validateReportForm — mirrors server vocabulary (every guard bound)", () => {
  test("a valid form returns an EMPTY errors record", () => {
    expect(validateReportForm(validForm(), t)).toEqual({});
  });

  test("notes required (empty string fails)", () => {
    const errors = validateReportForm(validForm({ teacherNotes: "" }), t);
    expect(errors.teacherNotes).toBe(t.reportNotesRequiredMessage);
  });

  test("notes required (whitespace-only string fails — trim happens first)", () => {
    const errors = validateReportForm(validForm({ teacherNotes: "    " }), t);
    expect(errors.teacherNotes).toBe(t.reportNotesRequiredMessage);
  });

  test("notes too long (2001 chars fails — unicode/RTL strings ride the same bound)", () => {
    const errors = validateReportForm(validForm({ teacherNotes: "x".repeat(2001) }), t);
    expect(errors.teacherNotes).toBe(t.reportNotesTooLongMessage);
  });

  test("notes at the 2000-char boundary passes (inclusive upper bound)", () => {
    const errors = validateReportForm(validForm({ teacherNotes: "x".repeat(2000) }), t);
    expect(errors.teacherNotes).toBeUndefined();
  });

  test("rating required (null fails)", () => {
    const errors = validateReportForm(validForm({ studentRatingByTeacher: null }), t);
    expect(errors.studentRatingByTeacher).toBe(t.reportRatingRequiredMessage);
  });

  test("rating below 0 fails", () => {
    const errors = validateReportForm(validForm({ studentRatingByTeacher: -1 }), t);
    expect(errors.studentRatingByTeacher).toBe(t.reportRatingRequiredMessage);
  });

  test("rating above 5 fails", () => {
    const errors = validateReportForm(validForm({ studentRatingByTeacher: 6 }), t);
    expect(errors.studentRatingByTeacher).toBe(t.reportRatingRequiredMessage);
  });

  test("rating at 0 and 5 both pass (inclusive bounds)", () => {
    expect(validateReportForm(validForm({ studentRatingByTeacher: 0 }), t).studentRatingByTeacher).toBeUndefined();
    expect(validateReportForm(validForm({ studentRatingByTeacher: 5 }), t).studentRatingByTeacher).toBeUndefined();
  });

  test("at least one homework block required (both null fails)", () => {
    const errors = validateReportForm(validForm({ jadid: null, madi: null }), t);
    expect(errors.homework).toBe(t.reportBlocksRequiredMessage);
  });

  test("Jadid-only submission passes (the ≥1-block rule)", () => {
    const errors = validateReportForm(validForm({ jadid: VALID_JADID, madi: null }), t);
    expect(errors.homework).toBeUndefined();
    expect(errors.jadid).toBeUndefined();
    expect(errors.madi).toBeUndefined();
  });

  test("grade below 0 fails", () => {
    const errors = validateReportForm(validForm({ previousGrades: { currentGrade: -1, revisionGrade: 90 } }), t);
    expect(errors.previousGradeJadid).toBe(t.reportGradeRangeMessage);
  });

  test("grade above 100 fails", () => {
    const errors = validateReportForm(validForm({ previousGrades: { currentGrade: 80, revisionGrade: 101 } }), t);
    expect(errors.previousGradeMadi).toBe(t.reportGradeRangeMessage);
  });

  test("grades at 0 and 100 both pass (inclusive bounds)", () => {
    const errors = validateReportForm(validForm({ previousGrades: { currentGrade: 0, revisionGrade: 100 } }), t);
    expect(errors.previousGradeJadid).toBeUndefined();
    expect(errors.previousGradeMadi).toBeUndefined();
  });

  test("null grades pass (the grade-previous section is optional per track)", () => {
    const errors = validateReportForm(validForm({ previousGrades: { currentGrade: null, revisionGrade: null } }), t);
    expect(errors.previousGradeJadid).toBeUndefined();
    expect(errors.previousGradeMadi).toBeUndefined();
  });
});

describe("resolveNewestRow + isNewestRowUngraded — history derivation table", () => {
  test("resolveNewestRow returns null when the page is undefined (first-session case)", () => {
    expect(resolveNewestRow(undefined)).toBeNull();
  });

  test("resolveNewestRow returns null when the page is empty (first-session case)", () => {
    expect(resolveNewestRow(makePage([]))).toBeNull();
  });

  test("resolveNewestRow returns items[0] when the page carries rows (newest-first per server)", () => {
    const row1 = makeHistoryRow({ id: "1", currentGrade: 80, revisionGrade: 90 });
    const row2 = makeHistoryRow({ id: "2", currentGrade: null, revisionGrade: null });
    expect(resolveNewestRow(makePage([row1, row2]))?.id).toBe("1");
  });

  test("isNewestRowUngraded returns false for a null row (no row to grade)", () => {
    expect(isNewestRowUngraded(null)).toBe(false);
  });

  test("isNewestRowUngraded returns true when BOTH grade columns are null (the one-shot predicate)", () => {
    const ungradedRow = makeHistoryRow({ id: "1", currentGrade: null, revisionGrade: null });
    expect(isNewestRowUngraded(ungradedRow)).toBe(true);
  });

  test("isNewestRowUngraded returns false when EITHER grade column is set (already-graded posture)", () => {
    const onlyJadid = makeHistoryRow({ id: "1", currentGrade: 80, revisionGrade: null });
    expect(isNewestRowUngraded(onlyJadid)).toBe(false);
    const onlyMadi = makeHistoryRow({ id: "1", currentGrade: null, revisionGrade: 90 });
    expect(isNewestRowUngraded(onlyMadi)).toBe(false);
    const bothGraded = makeHistoryRow({ id: "1", currentGrade: 80, revisionGrade: 90 });
    expect(isNewestRowUngraded(bothGraded)).toBe(false);
  });
});

describe("vocabulary guard — a non-member surahJuz ref never reaches the payload or passes validation", () => {
  // The suite's single deliberate type-erosion point: a REAL typed block
  // with a non-member ref written on via Object.assign (no cast, no any) —
  // the same forge seam the conversions suite documents. The picker sends
  // only enum members, but form state is untrusted input at this boundary.
  function blockWithForgedRef(ref: string): typeof VALID_JADID {
    const block = { ...VALID_JADID };
    Object.assign(block, { surahJuz: ref });
    return block;
  }

  test("normalizeBlock drops the whole block from the submit payload", () => {
    const payload = buildSubmitPayload(validForm({ jadid: blockWithForgedRef("juz_31"), madi: null }));
    expect(payload.homework).toBeUndefined();
  });

  test("validateReportForm flags the block with the picker's required message", () => {
    const errors = validateReportForm(validForm({ jadid: blockWithForgedRef("surah_an_nuh") }), t);
    expect(errors.jadid).toBe(t.reportSurahJuzRequiredMessage);
  });

  test("near-miss spellings never ride the fallback through (case/whitespace stay non-members)", () => {
    for (const nearMiss of ["JUZ_1", " juz_1", "juz_1 ", "SurahAlBaqarah"]) {
      const errors = validateReportForm(validForm({ jadid: blockWithForgedRef(nearMiss) }), t);
      expect(errors.jadid).toBe(t.reportSurahJuzRequiredMessage);
      expect(
        buildSubmitPayload(validForm({ jadid: blockWithForgedRef(nearMiss), madi: null })).homework
      ).toBeUndefined();
    }
  });
});

/** Builds a canonical 12-field homework row with the given id + grade overrides. */
function makeHistoryRow(overrides: {
  id: string;
  currentGrade: number | null;
  revisionGrade: number | null;
}): StudentHomeworkHistoryQuery_studentHomeworkHistory_items {
  return {
    id: overrides.id,
    sessionId: 100,
    currentFromAyah: 1,
    currentToAyah: 7,
    currentGrade: overrides.currentGrade,
    currentSurahJuz: SurahJuzRef.SurahAlBaqarah,
    revisionFromAyah: 281,
    revisionToAyah: 286,
    revisionGrade: overrides.revisionGrade,
    revisionSurahJuz: SurahJuzRef.Juz30,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

/** Builds a history page carrying the given items. */
function makePage(items: StudentHomeworkHistoryQuery_studentHomeworkHistory_items[]): StudentHomeworkHistoryQuery {
  return {
    studentHomeworkHistory: { items, totalCount: items.length, page: 1, pageSize: 25 },
  };
}
