import { describe, expect, it } from "bun:test";
import {
  filterHomeworkRows,
  filterReportRows,
  type SearchFilterState,
} from "@/frontend/views/parent/monitoring/SearchFilterBar.helpers";

function countingDateMatcher() {
  let calls = 0;
  const matcher = () => {
    calls++;
    return false;
  };
  return { matcher, getCalls: () => calls };
}

describe("SearchFilterBar.helpers", () => {
  it("filters report rows by query and skips dateMatcher when notes already match", () => {
    const { matcher, getCalls } = countingDateMatcher();
    const rows = [
      {
        teacherNotes: "excellent progress in recitation",
        studentRatingByTeacher: 5,
        sessionStartedAt: "2026-01-01T10:00:00Z",
        createdAt: "2026-01-01T10:00:00Z",
      },
      {
        teacherNotes: "needs practice",
        studentRatingByTeacher: 3,
        sessionStartedAt: "2026-01-02T10:00:00Z",
        createdAt: "2026-01-02T10:00:00Z",
      },
    ];

    const state: SearchFilterState = {
      query: "excellent",
      ratingFilter: null,
      sort: "dateDesc",
    };

    const result = filterReportRows(rows, state, matcher);
    expect(result).toHaveLength(1);
    expect(result[0].teacherNotes).toBe("excellent progress in recitation");
    expect(getCalls()).toBe(1);
  });

  it("filters homework rows by surah and skips dateMatcher when passage text already matches", () => {
    const { matcher, getCalls } = countingDateMatcher();
    const rows = [
      {
        createdAt: "2026-01-01T10:00:00Z",
        jadid: { surahJuz: "Al-Baqarah", fromAyah: 1, toAyah: 10, grade: 5 },
        madi: null,
      },
      {
        createdAt: "2026-01-02T10:00:00Z",
        jadid: null,
        madi: { surahJuz: "Al-Imran", fromAyah: 1, toAyah: 20, grade: 4 },
      },
    ];

    const state: SearchFilterState = {
      query: "Baqarah",
      ratingFilter: null,
      sort: "ratingDesc",
    };

    const result = filterHomeworkRows(rows, state, matcher);
    expect(result).toHaveLength(1);
    expect(result[0].jadid?.surahJuz).toBe("Al-Baqarah");
    expect(getCalls()).toBe(1);
  });

  it("sorts report rows by rating and date", () => {
    const rows = [
      {
        teacherNotes: "note A",
        studentRatingByTeacher: 3,
        sessionStartedAt: "2026-01-01T10:00:00Z",
        createdAt: "2026-01-01T10:00:00Z",
      },
      {
        teacherNotes: "note B",
        studentRatingByTeacher: 5,
        sessionStartedAt: "2026-01-03T10:00:00Z",
        createdAt: "2026-01-03T10:00:00Z",
      },
      {
        teacherNotes: "note C",
        studentRatingByTeacher: 4,
        sessionStartedAt: "2026-01-02T10:00:00Z",
        createdAt: "2026-01-02T10:00:00Z",
      },
    ];

    const byRating = filterReportRows(rows, { query: "", ratingFilter: null, sort: "ratingDesc" }, () => false);
    expect(byRating.map(r => r.studentRatingByTeacher)).toEqual([5, 4, 3]);

    const byDate = filterReportRows(rows, { query: "", ratingFilter: null, sort: "dateAsc" }, () => false);
    expect(byDate.map(r => r.teacherNotes)).toEqual(["note A", "note C", "note B"]);
  });
});
