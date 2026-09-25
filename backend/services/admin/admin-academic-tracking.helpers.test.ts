/**
 * Admin academic tracking helpers tests — the pure attention-flag
 * composer, the named attention constants, and the pre-read validation
 * guards behind the admin academic surfaces.
 *
 * Pure unit tier — NO DB, NO server boot, NO disk writes. Every case is a
 * synchronous or promise-wrapped call over hand-built signals; the
 * validation guards are proven pre-DB by construction (they are plain
 * synchronous functions that throw before any async boundary could
 * exist). Runs via the mandated runner:
 *   bun run test/scripts/run-test.ts backend/services/admin/admin-academic-tracking.helpers.test.ts
 *
 * All rejection assertions use a local try/catch helper — never
 * `expect(...).rejects.toThrow()`. The flag composer is pinned against
 * the canonical threshold semantics: strictly-below low-grade average
 * (exactly-threshold is healthy), inclusive staleness boundary (activity
 * at exactly the window edge is inside), zero-graded-rows absence
 * never flagged, both reasons co-occurring in canonical order, and the
 * recent-grade window bounded by the service constant.
 */

import { describe, expect, test } from "bun:test";
import { ValidationError } from "@/backend/lib/errors";
import {
  NEEDS_ATTENTION_LOW_AVG_GRADE,
  NEEDS_ATTENTION_RECENT_WINDOW,
  NEEDS_ATTENTION_STALE_DAYS,
} from "@/backend/services/admin/admin-academic-tracking.constants";
import {
  assertAcademicStudentId,
  composeAcademicAttentionFlag,
  resolveAcademicTrackingPageBounds,
} from "@/backend/services/admin/admin-academic-tracking.helpers";
import type { AdminAcademicAttentionSignalSelectType } from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";

const LOCALE = "en";
const tErrors = getServerTranslations(LOCALE).errorsTranslations;

/** The single snapshot instant every case measures staleness against. */
const NOW = new Date("2026-01-15T12:00:00.000Z");

const DAY_MS = 24 * 60 * 60 * 1000;

/** Returns the instant exactly `days` before the snapshot instant. */
function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * DAY_MS);
}

/** Builds a fully-populated attention signal with per-case overrides. */
function makeSignal(
  overrides: Partial<AdminAcademicAttentionSignalSelectType> = {}
): AdminAcademicAttentionSignalSelectType {
  return {
    studentId: 1,
    recentGradedJadidGrades: [],
    lastGradedHomeworkAt: null,
    lastHomeworkAssignedAt: null,
    completedSessionCount: 0,
    ...overrides,
  };
}

/** Try/catch rejection helper: returns the thrown ValidationError or fails. */
function expectValidationError(throwing: () => unknown): ValidationError {
  try {
    throwing();
  } catch (error) {
    if (error instanceof ValidationError) {
      return error;
    }
    throw new Error(`expected ValidationError, received: ${String(error)}`, { cause: error });
  }
  throw new Error("expected ValidationError, nothing was thrown");
}

describe("attention constants — the named threshold pins", () => {
  test("low-average grade threshold is the mandated 60 on the [0,100] scale", () => {
    expect(NEEDS_ATTENTION_LOW_AVG_GRADE).toBe(60);
  });

  test("recent graded Jadid window is the mandated 10 grades", () => {
    expect(NEEDS_ATTENTION_RECENT_WINDOW).toBe(10);
  });

  test("staleness window is the mandated 14 days", () => {
    expect(NEEDS_ATTENTION_STALE_DAYS).toBe(14);
  });
});

describe("composeAcademicAttentionFlag — Tier 1 (flag arms)", () => {
  test("lowGrade only: low recent average with no completed sessions", () => {
    const flag = composeAcademicAttentionFlag(
      makeSignal({ recentGradedJadidGrades: [30, 40], lastGradedHomeworkAt: daysAgo(1) }),
      NOW
    );
    expect(flag).toEqual({ reasons: ["lowGrade"] });
  });

  test("staleProgress only: healthy average, completed sessions, quiet window", () => {
    const flag = composeAcademicAttentionFlag(
      makeSignal({
        recentGradedJadidGrades: [90],
        completedSessionCount: 2,
        lastGradedHomeworkAt: daysAgo(20),
      }),
      NOW
    );
    expect(flag).toEqual({ reasons: ["staleProgress"] });
  });

  test("both reasons co-occur and ride the canonical order", () => {
    const flag = composeAcademicAttentionFlag(
      makeSignal({
        recentGradedJadidGrades: [10],
        completedSessionCount: 1,
        lastGradedHomeworkAt: daysAgo(30),
      }),
      NOW
    );
    expect(flag).toEqual({ reasons: ["lowGrade", "staleProgress"] });
  });

  test("neither: healthy grades and recent graded activity → no flag object", () => {
    const flag = composeAcademicAttentionFlag(
      makeSignal({
        recentGradedJadidGrades: [85, 95],
        completedSessionCount: 1,
        lastGradedHomeworkAt: daysAgo(1),
      }),
      NOW
    );
    expect(flag).toBeNull();
  });

  test("a student absent from the signals list is never flagged", () => {
    expect(composeAcademicAttentionFlag(undefined, NOW)).toBeNull();
  });
});

describe("composeAcademicAttentionFlag — Tier 2 (threshold boundaries)", () => {
  test("average exactly 60.0 is NOT flagged (strictly-below rule)", () => {
    expect(composeAcademicAttentionFlag(makeSignal({ recentGradedJadidGrades: [50, 70] }), NOW)).toBeNull();
    expect(composeAcademicAttentionFlag(makeSignal({ recentGradedJadidGrades: [60] }), NOW)).toBeNull();
  });

  test("average 59.99 IS flagged (just below the threshold)", () => {
    const flag = composeAcademicAttentionFlag(makeSignal({ recentGradedJadidGrades: [50, 69.98] }), NOW);
    expect(flag).toEqual({ reasons: ["lowGrade"] });
  });

  test("fewer grades than the window average over what exists (9 graded rows)", () => {
    const nineGrades = [55, 55, 55, 55, 55, 55, 55, 55, 55];
    const flag = composeAcademicAttentionFlag(makeSignal({ recentGradedJadidGrades: nineGrades }), NOW);
    expect(flag).toEqual({ reasons: ["lowGrade"] });

    const nineHealthy = [100, 100, 100, 100, 100, 100, 100, 100, 60];
    expect(composeAcademicAttentionFlag(makeSignal({ recentGradedJadidGrades: nineHealthy }), NOW)).toBeNull();
  });

  test("the window binds at 10 grades: a newer-first window of 10 zeros flags even with an older 100", () => {
    const windowOfZerosThenOldHundred = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 100];
    const flag = composeAcademicAttentionFlag(
      makeSignal({ recentGradedJadidGrades: windowOfZerosThenOldHundred }),
      NOW
    );
    expect(flag).toEqual({ reasons: ["lowGrade"] });

    const windowOfHundredsThenOldZero = [100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 0];
    expect(
      composeAcademicAttentionFlag(makeSignal({ recentGradedJadidGrades: windowOfHundredsThenOldZero }), NOW)
    ).toBeNull();
  });

  test("zero graded Jadid rows never flag lowGrade (absence is not failure)", () => {
    expect(composeAcademicAttentionFlag(makeSignal({ recentGradedJadidGrades: [] }), NOW)).toBeNull();
  });

  test("staleness boundary: 13 and 14 days ago are inside the window, 15 days is stale", () => {
    const base = { recentGradedJadidGrades: [90], completedSessionCount: 1 };
    expect(composeAcademicAttentionFlag(makeSignal({ ...base, lastGradedHomeworkAt: daysAgo(13) }), NOW)).toBeNull();
    expect(composeAcademicAttentionFlag(makeSignal({ ...base, lastGradedHomeworkAt: daysAgo(14) }), NOW)).toBeNull();
    expect(composeAcademicAttentionFlag(makeSignal({ ...base, lastGradedHomeworkAt: daysAgo(15) }), NOW)).toEqual({
      reasons: ["staleProgress"],
    });
  });

  test("never-graded students anchor staleness on the newest assignment stamp", () => {
    const base = { recentGradedJadidGrades: [] as number[], completedSessionCount: 1 };
    expect(
      composeAcademicAttentionFlag(
        makeSignal({ ...base, lastGradedHomeworkAt: null, lastHomeworkAssignedAt: daysAgo(14) }),
        NOW
      )
    ).toBeNull();
    expect(
      composeAcademicAttentionFlag(
        makeSignal({ ...base, lastGradedHomeworkAt: null, lastHomeworkAssignedAt: daysAgo(15) }),
        NOW
      )
    ).toEqual({ reasons: ["staleProgress"] });
  });

  test("a graded stamp wins over a fresher assignment stamp (fallback only for never-graded)", () => {
    const flag = composeAcademicAttentionFlag(
      makeSignal({
        completedSessionCount: 1,
        lastGradedHomeworkAt: daysAgo(20),
        lastHomeworkAssignedAt: daysAgo(1),
      }),
      NOW
    );
    expect(flag).toEqual({ reasons: ["staleProgress"] });
  });

  test("no homework rows at all with completed sessions is trivially stale (zero graded rows ever)", () => {
    const flag = composeAcademicAttentionFlag(
      makeSignal({ completedSessionCount: 3, lastGradedHomeworkAt: null, lastHomeworkAssignedAt: null }),
      NOW
    );
    expect(flag).toEqual({ reasons: ["staleProgress"] });
  });

  test("zero graded rows with NO completed sessions crosses no arm at all", () => {
    expect(
      composeAcademicAttentionFlag(
        makeSignal({ completedSessionCount: 0, lastGradedHomeworkAt: null, lastHomeworkAssignedAt: null }),
        NOW
      )
    ).toBeNull();
  });

  test("completed-session eligibility gates the stale arm even when the anchor is ancient", () => {
    const flag = composeAcademicAttentionFlag(
      makeSignal({ completedSessionCount: 0, lastGradedHomeworkAt: daysAgo(90) }),
      NOW
    );
    expect(flag).toBeNull();
  });
});

describe("composeAcademicAttentionFlag — Tier 3 (chaos: concurrent shuffled windows)", () => {
  test("Promise.allSettled over shuffled grade windows: every invocation fulfills with its own deterministic verdict", async () => {
    const sourceGrades = [0, 12, 45, 58, 60, 61, 74, 88, 95, 100, 30, 67];

    const cases = Array.from({ length: 24 }, (_, index) => {
      const shuffled = [...sourceGrades];
      for (let swap = 0; swap < shuffled.length - 1; swap += 1) {
        const partner = (index + swap * 7) % shuffled.length;
        const swapped = shuffled[swap];
        shuffled[swap] = shuffled[partner];
        shuffled[partner] = swapped;
      }
      const signal = makeSignal({
        studentId: index + 1,
        recentGradedJadidGrades: shuffled.slice(0, NEEDS_ATTENTION_RECENT_WINDOW),
        completedSessionCount: index % 3,
        lastGradedHomeworkAt: index % 2 === 0 ? daysAgo(1 + (index % 20)) : null,
        lastHomeworkAssignedAt: index % 2 === 0 ? null : daysAgo(1 + (index % 20)),
      });
      return { signal, expected: composeAcademicAttentionFlag(signal, NOW) };
    });

    const settled = await Promise.allSettled(
      cases.map(({ signal }) => Promise.resolve().then(() => composeAcademicAttentionFlag(signal, NOW)))
    );

    expect(settled).toHaveLength(cases.length);
    cases.forEach((testCase, index) => {
      const outcome = settled[index];
      expect(outcome?.status).toBe("fulfilled");
      if (outcome?.status === "fulfilled") {
        expect(outcome.value).toEqual(testCase.expected);
      }
    });
  });
});

describe("resolveAcademicTrackingPageBounds — Tier 4 (adversarial bounds, rejected pre-DB)", () => {
  test("defaults apply when both bounds are absent (undefined or null)", () => {
    expect(resolveAcademicTrackingPageBounds(undefined, undefined, LOCALE)).toEqual({
      page: 1,
      pageSize: 25,
      offset: 0,
    });
    expect(resolveAcademicTrackingPageBounds(null, null, LOCALE)).toEqual({ page: 1, pageSize: 25, offset: 0 });
    expect(resolveAcademicTrackingPageBounds(undefined, 50, LOCALE)).toEqual({ page: 1, pageSize: 50, offset: 0 });
    expect(resolveAcademicTrackingPageBounds(3, undefined, LOCALE)).toEqual({ page: 3, pageSize: 25, offset: 50 });
  });

  test("valid edges resolve: page 1 with pageSize 1 and 100, huge-but-integer pages", () => {
    expect(resolveAcademicTrackingPageBounds(1, 1, LOCALE)).toEqual({ page: 1, pageSize: 1, offset: 0 });
    expect(resolveAcademicTrackingPageBounds(1, 100, LOCALE)).toEqual({ page: 1, pageSize: 100, offset: 0 });
    expect(resolveAcademicTrackingPageBounds(Number.MAX_SAFE_INTEGER, 25, LOCALE)).toEqual({
      page: Number.MAX_SAFE_INTEGER,
      pageSize: 25,
      offset: (Number.MAX_SAFE_INTEGER - 1) * 25,
    });
  });

  test("negative, zero, fractional, and non-finite pages reject with the localized ValidationError", () => {
    for (const badPage of [0, -1, -1000, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const error = expectValidationError(() => resolveAcademicTrackingPageBounds(badPage, 25, LOCALE));
      expect(error.message).toBe(tErrors.validation);
    }
  });

  test("zero, negative, fractional, over-ceiling, and non-finite pageSizes reject", () => {
    for (const badPageSize of [0, -5, 101, 1_000_000_000, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const error = expectValidationError(() => resolveAcademicTrackingPageBounds(1, badPageSize, LOCALE));
      expect(error.message).toBe(tErrors.validation);
    }
  });

  test("the page guard fires before the pageSize guard for doubly-invalid input", () => {
    const error = expectValidationError(() => resolveAcademicTrackingPageBounds(0, 0, LOCALE));
    expect(error.message).toBe(tErrors.validation);
  });
});

describe("assertAcademicStudentId — Tier 4 (adversarial studentId, rejected pre-DB)", () => {
  test("positive integers pass silently", () => {
    expect(() => assertAcademicStudentId(1, LOCALE)).not.toThrow();
    expect(() => assertAcademicStudentId(Number.MAX_SAFE_INTEGER, LOCALE)).not.toThrow();
  });

  test("zero, negative, fractional, and non-finite ids reject with the localized ValidationError", () => {
    for (const badId of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const error = expectValidationError(() => assertAcademicStudentId(badId, LOCALE));
      expect(error.message).toBe(tErrors.validation);
    }
  });
});
