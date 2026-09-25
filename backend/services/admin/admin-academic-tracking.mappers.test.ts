/**
 * Admin academic tracking mappers tests — the select-shape → return-shape
 * projection seam (identity, per-lane position composition, per-lane
 * grade summaries, the Date→ISO-8601 serialization boundary, stats
 * assembly, the drill-down echo, and the page envelope).
 *
 * Pure unit tier — NO DB, NO server boot, NO disk writes. Every case maps
 * hand-built select rows through the mappers and pins the closed output
 * shape. Runs via the mandated runner:
 *   bun run test/scripts/run-test.ts backend/services/admin/admin-academic-tracking.mappers.test.ts
 *
 * Honesty pins: a reference-less lane maps to a null position (never a
 * fabricated locator), a zero-graded track maps to a null summary (never
 * a fabricated zero count/average), a null grade-activity stamp stays
 * null (never an epoch), and the attention flag passes through verbatim —
 * the mapper never re-derives it.
 */

import { describe, expect, test } from "bun:test";
import { SurahJuzRef } from "@/backend/enum/shared/surah-juz-ref.enum";
import {
  composeAcademicPageEnvelope,
  mapAcademicStats,
  mapAcademicStudentEcho,
  mapAcademicStudentRow,
} from "@/backend/services/admin/admin-academic-tracking.mappers";
import type {
  AdminAcademicAttentionFlagReturnType,
  AdminAcademicStatsSelectType,
  AdminAcademicStudentEchoSelectType,
  AdminAcademicStudentRowSelectType,
} from "@/backend/types";

const GRADED_AT = new Date("2026-01-02T15:30:00.000Z");

/** Builds a fully-populated directory row with per-case overrides. */
function makeRow(overrides: Partial<AdminAcademicStudentRowSelectType> = {}): AdminAcademicStudentRowSelectType {
  return {
    id: 7,
    fullName: "Ahmed Hafiz",
    email: "ahmed@example.com",
    jadidSurahJuz: SurahJuzRef.Juz1,
    jadidFromAyah: 1,
    jadidToAyah: 20,
    madiSurahJuz: null,
    madiFromAyah: null,
    madiToAyah: null,
    jadidGradedCount: 3,
    jadidAverageGrade: 74.33,
    madiGradedCount: 0,
    madiAverageGrade: null,
    progressRowCount: 2,
    lastGradedHomeworkAt: GRADED_AT,
    ...overrides,
  };
}

describe("mapAcademicStudentRow — Tier 1 (full projection)", () => {
  test("maps the complete row: identity, positions, summaries, count, ISO stamp, flag", () => {
    const needsAttention: AdminAcademicAttentionFlagReturnType = { reasons: ["lowGrade"] };
    const mapped = mapAcademicStudentRow(makeRow(), needsAttention);
    expect(mapped).toEqual({
      id: 7,
      fullName: "Ahmed Hafiz",
      email: "ahmed@example.com",
      latestJadidPosition: { surahJuz: SurahJuzRef.Juz1, fromAyah: 1, toAyah: 20 },
      latestMadiPosition: null,
      jadidGradeSummary: { gradedCount: 3, averageGrade: 74.33 },
      madiGradeSummary: null,
      progressRowCount: 2,
      lastGradedHomeworkAt: "2026-01-02T15:30:00.000Z",
      needsAttention: { reasons: ["lowGrade"] },
    });
  });

  test("the Date→ISO seam serializes exactly once (native Date in, ISO string out)", () => {
    const mapped = mapAcademicStudentRow(makeRow(), null);
    expect(typeof mapped.lastGradedHomeworkAt).toBe("string");
    expect(mapped.lastGradedHomeworkAt).toBe("2026-01-02T15:30:00.000Z");
  });

  test("a null grade-activity stamp stays null (never graded is never an epoch)", () => {
    const mapped = mapAcademicStudentRow(makeRow({ lastGradedHomeworkAt: null }), null);
    expect(mapped.lastGradedHomeworkAt).toBeNull();
  });

  test("the attention flag passes through verbatim and may be null", () => {
    const flag: AdminAcademicAttentionFlagReturnType = { reasons: ["lowGrade", "staleProgress"] };
    expect(mapAcademicStudentRow(makeRow(), flag).needsAttention).toEqual({ reasons: ["lowGrade", "staleProgress"] });
    expect(mapAcademicStudentRow(makeRow(), null).needsAttention).toBeNull();
  });
});

describe("mapAcademicStudentRow — Tier 2 (null-position and null-summary boundaries)", () => {
  test("a reference-less lane maps to a null position even when ayah numbers exist", () => {
    const mapped = mapAcademicStudentRow(makeRow({ jadidSurahJuz: null, jadidFromAyah: 5, jadidToAyah: 10 }), null);
    expect(mapped.latestJadidPosition).toBeNull();
  });

  test("a reference without an ayah span keeps the span nullable inside a present position", () => {
    const mapped = mapAcademicStudentRow(
      makeRow({ jadidSurahJuz: SurahJuzRef.SurahAlFatihah, jadidFromAyah: null, jadidToAyah: null }),
      null
    );
    expect(mapped.latestJadidPosition).toEqual({ surahJuz: SurahJuzRef.SurahAlFatihah, fromAyah: null, toAyah: null });
  });

  test("both lanes may carry positions independently", () => {
    const mapped = mapAcademicStudentRow(
      makeRow({ madiSurahJuz: SurahJuzRef.Juz30, madiFromAyah: 1, madiToAyah: 10 }),
      null
    );
    expect(mapped.latestJadidPosition).toEqual({ surahJuz: SurahJuzRef.Juz1, fromAyah: 1, toAyah: 20 });
    expect(mapped.latestMadiPosition).toEqual({ surahJuz: SurahJuzRef.Juz30, fromAyah: 1, toAyah: 10 });
  });

  test("zero graded rows map to a null summary on that track (never a fabricated zero)", () => {
    const mapped = mapAcademicStudentRow(makeRow({ jadidGradedCount: 0, jadidAverageGrade: null }), null);
    expect(mapped.jadidGradeSummary).toBeNull();
    expect(mapped.madiGradeSummary).toBeNull();
  });

  test("a fully academic-less student still maps to a well-formed row", () => {
    const mapped = mapAcademicStudentRow(
      makeRow({
        jadidSurahJuz: null,
        jadidFromAyah: null,
        jadidToAyah: null,
        jadidGradedCount: 0,
        jadidAverageGrade: null,
        progressRowCount: 0,
        lastGradedHomeworkAt: null,
      }),
      null
    );
    expect(mapped.latestJadidPosition).toBeNull();
    expect(mapped.latestMadiPosition).toBeNull();
    expect(mapped.jadidGradeSummary).toBeNull();
    expect(mapped.madiGradeSummary).toBeNull();
    expect(mapped.progressRowCount).toBe(0);
    expect(mapped.lastGradedHomeworkAt).toBeNull();
  });
});

describe("mapAcademicStudentRow — Tier 3 (chaos: concurrent shuffled rows)", () => {
  test("Promise.allSettled over shuffled row batches: every mapping fulfills identically to its sequential twin", async () => {
    const rows = Array.from({ length: 20 }, (_, index) =>
      makeRow({
        id: index + 1,
        jadidSurahJuz: index % 2 === 0 ? SurahJuzRef.Juz1 : null,
        jadidGradedCount: index % 4,
        jadidAverageGrade: index % 4 === 0 ? null : 50 + index,
        lastGradedHomeworkAt: index % 3 === 0 ? null : new Date(GRADED_AT.getTime() + index * 1_000),
      })
    );
    const expected = rows.map(row => mapAcademicStudentRow(row, null));
    const shuffled = rows.toReversed();

    const settled = await Promise.allSettled(
      shuffled.map(row => Promise.resolve().then(() => mapAcademicStudentRow(row, null)))
    );

    expect(settled).toHaveLength(rows.length);
    shuffled.forEach((row, index) => {
      const outcome = settled[index];
      expect(outcome?.status).toBe("fulfilled");
      if (outcome?.status === "fulfilled") {
        expect(outcome.value).toEqual(expected[rows.indexOf(row)]);
      }
    });
  });
});

describe("mapAcademicStats", () => {
  test("attaches the composed attention count to the aggregate inputs", () => {
    const stats: AdminAcademicStatsSelectType = {
      trackedStudentCount: 9,
      studentsWithGradedHomeworkCount: 5,
      averageJadidGrade: 71.2,
      averageMadiGrade: 66.5,
    };
    expect(mapAcademicStats(stats, 2)).toEqual({
      trackedStudentCount: 9,
      studentsWithGradedHomeworkCount: 5,
      averageJadidGrade: 71.2,
      averageMadiGrade: 66.5,
      needingAttentionCount: 2,
    });
  });

  test("ungraded-platform honesty: null averages survive, zero attention count attaches", () => {
    const stats: AdminAcademicStatsSelectType = {
      trackedStudentCount: 4,
      studentsWithGradedHomeworkCount: 0,
      averageJadidGrade: null,
      averageMadiGrade: null,
    };
    expect(mapAcademicStats(stats, 0)).toEqual({
      trackedStudentCount: 4,
      studentsWithGradedHomeworkCount: 0,
      averageJadidGrade: null,
      averageMadiGrade: null,
      needingAttentionCount: 0,
    });
  });
});

describe("mapAcademicStudentEcho", () => {
  test("projects the identity slice field-by-field with the soft-delete marker", () => {
    const echo: AdminAcademicStudentEchoSelectType = {
      id: 12,
      fullName: "Soft Deleted Student",
      email: "gone@example.com",
      isDeleted: true,
    };
    expect(mapAcademicStudentEcho(echo)).toEqual({
      id: 12,
      fullName: "Soft Deleted Student",
      email: "gone@example.com",
      isDeleted: true,
    });
  });

  test("a live student carries isDeleted false", () => {
    const echo: AdminAcademicStudentEchoSelectType = {
      id: 3,
      fullName: "Live Student",
      email: "live@example.com",
      isDeleted: false,
    };
    expect(mapAcademicStudentEcho(echo).isDeleted).toBe(false);
  });
});

describe("composeAcademicPageEnvelope — Tier 2 (pageCount boundaries)", () => {
  test("pageCount is the ceiling division of total over pageSize", () => {
    const items = [{ id: 1 }];
    const envelope = composeAcademicPageEnvelope(items, 101, 1, 100);
    expect(envelope).toEqual({ items, total: 101, page: 1, pageSize: 100, pageCount: 2 });
    expect(composeAcademicPageEnvelope(items, 200, 2, 100).pageCount).toBe(2);
    expect(composeAcademicPageEnvelope(items, 201, 3, 100).pageCount).toBe(3);
    expect(composeAcademicPageEnvelope([], 1, 5, 25).pageCount).toBe(1);
  });

  test("an empty honest window: zero total yields zero pages and empty items", () => {
    const envelope = composeAcademicPageEnvelope([], 0, 1, 25);
    expect(envelope).toEqual({ items: [], total: 0, page: 1, pageSize: 25, pageCount: 0 });
  });

  test("an out-of-range page is the caller's empty window next to the honest total (never clamped)", () => {
    const envelope = composeAcademicPageEnvelope([], 42, 9, 25);
    expect(envelope).toEqual({ items: [], total: 42, page: 9, pageSize: 25, pageCount: 2 });
  });

  test("items pass through by reference (no defensive copying)", () => {
    const items = [{ id: 1 }];
    expect(composeAcademicPageEnvelope(items, 1, 1, 25).items).toBe(items);
  });
});
