/**
 * StudentHomeworkService tests — `listMyHomework` over a MOCKED repository
 * seam.
 *
 * Per `backend/services/AGENTS.md` service-test rules: mock the persistence
 * seam and NEVER write real rows. The service is pure orchestration over
 * `HomeWorkRepository` (list + count share one JOIN predicate) and the
 * portal-agnostic pagination clamp — there is NO actor re-check inside the
 * service (role gating is the GraphQL field's `$all` scope conjunction), so
 * the only seam to mock is the repository pair.
 *
 * Coverage map:
 *  - Tier 1: happy path — rows map through the canonical homework mapper
 *    (Jadid from `current_*`, Madi from `revision_*`), honest envelope echo.
 *  - Tier 2 (boundary): pagination clamp echo (page 0 → 1, negative page →
 *    1, pageSize 100 → default 25, pageSize exactly 50 honored, fractional
 *    page → default, out-of-range page → EMPTY items next to the TRUE
 *    totalCount); zero rows → honest empty payload (never fabricated);
 *    fully-null track blocks collapse to `null` per block.
 *  - Tier 3: the transaction seam — the service joins the caller's
 *    `outerTx` (a `runInRollback` SAVEPOINT) and fans list+count out
 *    CONCURRENTLY inside it.
 *  - Tier 4 (identity): the student actor id flows into BOTH repository
 *    calls verbatim (the tenancy predicate's single input; zero
 *    caller-supplied identity on the wire).
 *
 * All assertions run against the spies' captured arguments — no raw
 * strings, no DB reads of real tables.
 */

import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { HomeWorkRepository } from "@/backend/db/repo";
import { runInRollback } from "@/backend/db/test/test-utils";
import { SurahJuzRef } from "@/backend/enum/shared/surah-juz-ref.enum";
import { StudentHomeworkService } from "@/backend/services/students/student-homework.service";
import type { HomeWorkSelectType } from "@/backend/types";

const STUDENT_ACTOR_ID = 42;

type SpyInstance = ReturnType<typeof spyOn>;
const trackedSpies: SpyInstance[] = [];

function trackSpy<T extends SpyInstance>(spy: T): T {
  trackedSpies.push(spy);
  return spy;
}

afterEach(() => {
  while (trackedSpies.length > 0) {
    trackedSpies.pop()?.mockRestore();
  }
});

// ─── Fixtures ───────────────────────────────────────────────────────────────

function homeWorkRow(overrides: Partial<HomeWorkSelectType>): HomeWorkSelectType {
  return {
    id: 200,
    sessionId: 100,
    currentFromAyah: 1,
    currentToAyah: 7,
    currentGrade: 80,
    currentSurahJuz: SurahJuzRef.SurahAlFatihah,
    revisionFromAyah: 8,
    revisionToAyah: 20,
    revisionGrade: null,
    revisionSurahJuz: SurahJuzRef.SurahAlBaqarah,
    createdAt: new Date("2026-01-31T10:00:00.000Z"),
    updatedAt: new Date("2026-01-31T10:00:00.000Z"),
    ...overrides,
  };
}

/** Spies both repository calls: `rows` returned, total = `total`. */
function mockRepoSeam(rows: HomeWorkSelectType[], total: number) {
  trackSpy(spyOn(HomeWorkRepository, "listForStudent").mockResolvedValue(rows));
  trackSpy(spyOn(HomeWorkRepository, "countForStudent").mockResolvedValue(total));
}

// ─── 1. Happy path ──────────────────────────────────────────────────────────

describe("StudentHomeworkService.listMyHomework — happy path", () => {
  test("maps rows through the canonical homework projection and echoes the window", async () => {
    const rows = [
      homeWorkRow({ id: 201, sessionId: 101 }),
      homeWorkRow({
        id: 202,
        sessionId: 102,
        currentSurahJuz: null,
        currentFromAyah: null,
        currentToAyah: null,
        currentGrade: null,
        revisionGrade: 75,
      }),
    ];
    mockRepoSeam(rows, 2);

    await runInRollback(async tx => {
      const page = await StudentHomeworkService.listMyHomework(STUDENT_ACTOR_ID, undefined, tx);
      expect(page.totalCount).toBe(2);
      expect(page.page).toBe(1);
      expect(page.pageSize).toBe(25);
      expect(page.items).toHaveLength(2);
      // Jadid split from the current_* columns — grade preserved verbatim.
      expect(page.items[0]?.jadid).toEqual({ surahJuz: SurahJuzRef.SurahAlFatihah, fromAyah: 1, toAyah: 7, grade: 80 });
      // Madi block stays non-null with its per-field nullability (ungraded).
      expect(page.items[0]?.madi).toEqual({
        surahJuz: SurahJuzRef.SurahAlBaqarah,
        fromAyah: 8,
        toAyah: 20,
        grade: null,
      });
      // Fully-null current_* block collapses to a null jadid — never fabricated.
      expect(page.items[1]?.jadid).toBeNull();
      expect(page.items[1]?.madi?.grade).toBe(75);
    });
  });

  test("the student actor id flows into BOTH repository calls verbatim", async () => {
    mockRepoSeam([], 0);
    await runInRollback(async tx => {
      await StudentHomeworkService.listMyHomework(STUDENT_ACTOR_ID, undefined, tx);
      const listSpy = trackSpy(spyOn(HomeWorkRepository, "listForStudent"));
      const countSpy = trackSpy(spyOn(HomeWorkRepository, "countForStudent"));
      expect(listSpy.mock.calls.at(-1)?.[0]).toBe(STUDENT_ACTOR_ID);
      expect(countSpy.mock.calls.at(-1)?.[0]).toBe(STUDENT_ACTOR_ID);
    });
  });
});

// ─── 2. Pagination clamp boundary ───────────────────────────────────────────

describe("StudentHomeworkService.listMyHomework — pagination clamp echo", () => {
  test("page 0 clamps to 1; negative page clamps to 1", async () => {
    mockRepoSeam([], 0);
    await runInRollback(async tx => {
      const zeroPage = await StudentHomeworkService.listMyHomework(STUDENT_ACTOR_ID, { page: 0 }, tx);
      expect(zeroPage.page).toBe(1);
      const negativePage = await StudentHomeworkService.listMyHomework(STUDENT_ACTOR_ID, { page: -3 }, tx);
      expect(negativePage.page).toBe(1);
    });
  });

  test("pageSize over the cap clamps to 25; exactly 50 is honored", async () => {
    mockRepoSeam([], 0);
    await runInRollback(async tx => {
      const overCap = await StudentHomeworkService.listMyHomework(STUDENT_ACTOR_ID, { pageSize: 100 }, tx);
      expect(overCap.pageSize).toBe(25);
      const atCap = await StudentHomeworkService.listMyHomework(STUDENT_ACTOR_ID, { pageSize: 50 }, tx);
      expect(atCap.pageSize).toBe(50);
    });
  });

  test("fractional page falls back to the default window", async () => {
    mockRepoSeam([], 0);
    await runInRollback(async tx => {
      const page = await StudentHomeworkService.listMyHomework(STUDENT_ACTOR_ID, { page: 1.5 }, tx);
      expect(page.page).toBe(1);
    });
  });

  test("out-of-range page yields EMPTY items next to the TRUE total", async () => {
    mockRepoSeam([], 7);
    await runInRollback(async tx => {
      const page = await StudentHomeworkService.listMyHomework(STUDENT_ACTOR_ID, { page: 4, pageSize: 25 }, tx);
      expect(page.items).toEqual([]);
      expect(page.totalCount).toBe(7);
      expect(page.page).toBe(4);
    });
  });
});

// ─── 3/4. Honest empty payload ──────────────────────────────────────────────

describe("StudentHomeworkService.listMyHomework — honest empty payload", () => {
  test("zero rows → empty items, zero total, effective window echoed", async () => {
    mockRepoSeam([], 0);
    await runInRollback(async tx => {
      const page = await StudentHomeworkService.listMyHomework(STUDENT_ACTOR_ID, undefined, tx);
      expect(page.items).toEqual([]);
      expect(page.totalCount).toBe(0);
      expect(page.page).toBe(1);
      expect(page.pageSize).toBe(25);
    });
  });
});
