/**
 * AdminAcademicTrackingRepository tests — 4-Tier coverage against the live
 * PostgreSQL instance inside rolled-back transactions.
 *
 * Per `backend/db/test/AGENTS.md`:
 *  - Every test runs inside `runInRollback`; the transaction is passed to
 *    EVERY repository call, entity-setup helper, and direct Drizzle query.
 *  - Entities are created ONLY via `entity-setup.ts` helpers (plus the
 *    file-local fixture builders below) — never seed data, never
 *    assumed-empty tables (committed baselines are read before every
 *    count/aggregate assertion and the fixture delta is asserted on top).
 *  - No `expect(...).rejects.toThrow()` inside rollback — the one
 *    rejection probe (the corrupt surah/juz guard arm) uses the
 *    `expectRepoError` try/catch helper.
 *
 * Snapshot discipline in fixtures: every windowed call is anchored to ONE
 * fixed snapshot instant (`NOW`), and all fixture stamps are offsets from
 * that instant, so windows land entirely in the past and stay disjoint
 * from live committed data. Cohort pinning: each test names its students
 * with a unique random tag and pins assertions through the `searchPattern`
 * filter (the exact pattern shape the service hands over after escaping
 * and `%…%`-wrapping), so assertions stay exact regardless of committed
 * residue.
 *
 * Coverage map:
 *  - Tier 1 (branch/stmt): every method's full shape and empty-result arm —
 *    directory rows with both lanes filled AND a zero-academic student
 *    (honest nulls + zero counts, dashboard rows carry no `isDeleted`),
 *    offset past the end → empty array, count deltas + filtered zero,
 *    exact statistics (empty-platform zero/null row, then the conditional
 *    aggregation), attention signals for a zero-row student (empty window,
 *    null anchors, zero completed sessions), every `getStudentEchoById`
 *    arm (found, missing id, non-student account, soft-deleted, NULL
 *    deletion marker → `false`), and all arms of the fail-closed surah/juz
 *    vocabulary guard plus the row mapper's LEFT-JOIN-miss coalescing.
 *  - Tier 2 (boundary): zero graded rows (averages null, never 0; positions
 *    fall back to the newest reference; window empty — absence is not
 *    failure); grade bounds 0/100 as exact averages with multi-student
 *    isolation; graded-first position nuance (older graded row beats newer
 *    ungraded reference; graded row without a reference yields a null
 *    position over an older referenced row); page-slice boundaries
 *    (limit/offset walk under deterministic `created_at DESC, id DESC`
 *    ordering); soft-deleted and NULL-marker students excluded from
 *    rows/count/stats/signals yet echoed for the drill-down; the
 *    recent-graded Jadid window (newest-first ordering, single-row
 *    windows, the repository-side bound of 10 out of 12 graded rows);
 *    completed-session eligibility (only `completed` status, `now` cutoff);
 *    homework stamped after the snapshot instant surfaces nowhere;
 *    `lastGradedHomeworkAt` rides graded rows' grade-write stamps only.
 *  - Tier 3 (chaos): all five readers race via `Promise.allSettled` over
 *    the SAME rollback transaction — every read settles fulfilled and the
 *    five results stay mutually consistent (count === listed rows, every
 *    row has a signal, the echo resolves, per-student windows isolated).
 *  - Tier 4 (security — LIKE discipline): the search pattern is bound
 *    VERBATIM (the service owns escaping/wrapping; the repo never
 *    re-escapes): `%` matches as a multi-char wildcard, `_` as a
 *    single-char wildcard, a bare `_` matches only one-character names,
 *    the `\%` escape sequence round-trips (a literal `%` in a name matches
 *    through the escape — proving no double-escaping), and the search
 *    predicate's email OR-arm plus case-insensitivity.
 */

import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { AdminAcademicTrackingRepository } from "@/backend/db/repo";
import {
  mapAcademicStudentRow,
  narrowSurahJuzRef,
  RECENT_GRADED_JADID_WINDOW,
} from "@/backend/db/repo/admin/academic-tracking-query-helpers";
import { progress } from "@/backend/db/schema/classes/progress";
import {
  createTestHomeWork,
  createTestSession,
  createTestStudent,
  createTestTeacherRow,
  createTestUser,
} from "@/backend/db/test/entity-setup";
import { expectRepoError, runInRollback } from "@/backend/db/test/test-utils";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import { SurahJuzRef } from "@/backend/enum/shared/surah-juz-ref.enum";
import type { DBTransaction, UserSelectType } from "@/backend/types";

/** The fixed snapshot instant every windowed call is anchored to (a Wednesday). */
const NOW = new Date("2026-01-07T15:30:00.000Z");

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Id far beyond the identity sequences' reach — guaranteed nonexistent. */
const NONEXISTENT_STUDENT_ID = 2_000_000_000;

/** Instant `ms` relative to the fixed snapshot instant. */
function at(msFromNow: number): Date {
  return new Date(NOW.getTime() + msFromNow);
}

/** A unique cohort tag (hex-safe — never contains LIKE wildcards). */
function cohortTag(): string {
  return randomUUID().replaceAll("-", "").slice(0, 12);
}

/**
 * The `%tag%` search pattern that pins exactly the test's cohort (the
 * shape the service layer produces after escaping + wrapping).
 */
function cohortPattern(tag: string): string {
  return `%${tag}%`;
}

/** Creates a student (users row + students role row) with overrides. */
async function setupStudent(
  tx: DBTransaction,
  tag: string,
  ordinal: number,
  overrides: Partial<UserSelectType> = {}
): Promise<UserSelectType> {
  const user = await createTestUser(tx, {
    fullName: `Stu ${tag} ${ordinal}`,
    createdAt: at(-DAY * (10 - ordinal)),
    ...overrides,
  });
  await createTestStudent(tx, user.id);
  return user;
}

/** Creates a teacher (users row + teacher role row) for session fixtures. */
async function setupTeacher(tx: DBTransaction): Promise<UserSelectType> {
  const user = await createTestUser(tx, { role: "teacher", createdAt: at(-DAY * 30) });
  await createTestTeacherRow(tx, user.id);
  return user;
}

interface HomeworkFixture {
  /** Session stamp (defaults to the snapshot instant). */
  readonly sessionCreatedAt?: Date;
  /** Session status override (defaults to `scheduled`). */
  readonly sessionStatus?: SessionStatus;
  /** The `home_work` row overrides (track columns, grades, stamps). */
  readonly homeWork: Parameters<typeof createTestHomeWork>[2];
}

/**
 * Creates one session+homework pair per fixture entry for one student.
 * Sessions insert in one parallel batch (independent rows), then homework
 * rows in a second batch keyed to their session — no sequential awaits.
 */
async function setupHomeworkBatch(
  tx: DBTransaction,
  teacherId: number,
  studentId: number,
  fixtures: readonly HomeworkFixture[]
): Promise<void> {
  const sessions = await Promise.all(
    fixtures.map(fixture =>
      createTestSession(tx, teacherId, studentId, {
        createdAt: fixture.sessionCreatedAt ?? NOW,
        ...(fixture.sessionStatus ? { status: fixture.sessionStatus } : {}),
      })
    )
  );
  await Promise.all(
    fixtures.map(async (fixture, index) => {
      const created = sessions[index];
      if (!created) {
        throw new Error(`session fixture ${index} missing after parallel insert`);
      }
      await createTestHomeWork(tx, created.id, fixture.homeWork);
    })
  );
}

/**
 * Bulk-inserts `count` progress rows for one student in ONE statement.
 * The `progress` table has no entity-setup helper (skeleton table: only
 * student/lesson/timestamps), so the fixture rides the raw insert.
 */
async function insertProgressRows(tx: DBTransaction, studentId: number, count: number): Promise<void> {
  if (count === 0) {
    return;
  }
  // Stamped inside the snapshot window (the fixed NOW) — the readers close
  // their windows at the captured instant, so a real-clock defaultNow()
  // stamp (long after the snapshot) would be honestly excluded.
  await tx.insert(progress).values(Array.from({ length: count }, () => ({ studentId, createdAt: at(-MINUTE) })));
}

/**
 * Unwraps one `Promise.allSettled` result — a rejected overlapping read
 * fails the test with its reason instead of being silently swallowed.
 */
function unwrapFulfilled<T>(result: PromiseSettledResult<T>, label: string): T {
  if (result.status === "rejected") {
    throw new Error(`${label} read rejected inside the shared transaction: ${String(result.reason)}`);
  }
  return result.value;
}

describe("AdminAcademicTrackingRepository — Tier 1 (branch/stmt coverage)", () => {
  test("listStudentAcademicRows: empty result set for a pattern matching nothing", async () => {
    await runInRollback(async tx => {
      const rows = await AdminAcademicTrackingRepository.listStudentAcademicRows(
        { searchPattern: "%no-such-cohort-zzz%" },
        NOW,
        10,
        0,
        tx
      );
      expect(rows).toEqual([]);
    });
  });

  test("listStudentAcademicRows: full row shape with both lanes graded + zero-academic student null shape", async () => {
    await runInRollback(async tx => {
      const tag = cohortTag();
      const teacher = await setupTeacher(tx);
      // Older student B (zero academic rows) lists after newer student A.
      const studentB = await setupStudent(tx, tag, 0);
      const studentA = await setupStudent(tx, tag, 1);

      await setupHomeworkBatch(tx, teacher.id, studentA.id, [
        {
          sessionCreatedAt: at(-2 * DAY),
          homeWork: {
            currentSurahJuz: SurahJuzRef.SurahAlFatihah,
            currentFromAyah: 1,
            currentToAyah: 7,
            currentGrade: 85,
            revisionSurahJuz: SurahJuzRef.Juz1,
            revisionGrade: 55,
            createdAt: at(-2 * DAY),
            updatedAt: at(-1 * DAY),
          },
        },
        {
          sessionCreatedAt: at(-1 * DAY),
          homeWork: {
            currentSurahJuz: SurahJuzRef.SurahAlBaqarah,
            currentFromAyah: 8,
            currentToAyah: 20,
            currentGrade: 95,
            createdAt: at(-1 * DAY),
            updatedAt: NOW,
          },
        },
      ]);
      await insertProgressRows(tx, studentA.id, 3);

      const rows = await AdminAcademicTrackingRepository.listStudentAcademicRows(
        { searchPattern: cohortPattern(tag) },
        NOW,
        10,
        0,
        tx
      );
      expect(rows).toHaveLength(2);

      const first = rows[0];
      const second = rows[1];
      if (!first || !second) {
        throw new Error("expected exactly two cohort rows");
      }

      // Newest-account-first deterministic ordering (createdAt DESC).
      expect(first.id).toBe(studentA.id);
      expect(second.id).toBe(studentB.id);

      // Jadid lane: newest graded row wins (the newer baqarah assignment).
      expect(first.jadidSurahJuz).toBe(SurahJuzRef.SurahAlBaqarah);
      expect(first.jadidFromAyah).toBe(8);
      expect(first.jadidToAyah).toBe(20);
      expect(first.jadidGradedCount).toBe(2);
      expect(first.jadidAverageGrade).toBe(90); // round(avg(85, 95), 2)

      // Madi lane: the only graded revision row is the older assignment.
      expect(first.madiSurahJuz).toBe(SurahJuzRef.Juz1);
      expect(first.madiFromAyah).toBeNull();
      expect(first.madiToAyah).toBeNull();
      expect(first.madiGradedCount).toBe(1);
      expect(first.madiAverageGrade).toBe(55);

      expect(first.progressRowCount).toBe(3);
      expect(first.lastGradedHomeworkAt).toEqual(NOW);
      expect(first.fullName).toBe(`Stu ${tag} 1`);
      expect(first.email).toBe(studentA.email);

      // The dashboard row carries NO soft-delete marker (echo-only field).
      expect("isDeleted" in first).toBe(false);

      // Zero-academic student: honest nulls and zero counts, still listed.
      expect(second.id).toBe(studentB.id);
      expect(second.jadidSurahJuz).toBeNull();
      expect(second.jadidFromAyah).toBeNull();
      expect(second.jadidToAyah).toBeNull();
      expect(second.jadidGradedCount).toBe(0);
      expect(second.jadidAverageGrade).toBeNull();
      expect(second.madiSurahJuz).toBeNull();
      expect(second.madiGradedCount).toBe(0);
      expect(second.madiAverageGrade).toBeNull();
      expect(second.progressRowCount).toBe(0);
      expect(second.lastGradedHomeworkAt).toBeNull();
    });
  });

  test("listStudentAcademicRows: offset past the end yields an empty window", async () => {
    await runInRollback(async tx => {
      const tag = cohortTag();
      await setupStudent(tx, tag, 0);
      const rows = await AdminAcademicTrackingRepository.listStudentAcademicRows(
        { searchPattern: cohortPattern(tag) },
        NOW,
        10,
        5,
        tx
      );
      expect(rows).toEqual([]);
    });
  });

  test("countStudentAcademicRows: honest total rides the same seal and filter as the list", async () => {
    await runInRollback(async tx => {
      const tag = cohortTag();
      const baseline = await AdminAcademicTrackingRepository.countStudentAcademicRows({}, tx);

      await setupStudent(tx, tag, 0);
      await setupStudent(tx, tag, 1);

      const unfiltered = await AdminAcademicTrackingRepository.countStudentAcademicRows({}, tx);
      expect(unfiltered).toBe(baseline + 2);

      const filtered = await AdminAcademicTrackingRepository.countStudentAcademicRows(
        { searchPattern: cohortPattern(tag) },
        tx
      );
      expect(filtered).toBe(2);

      const noMatch = await AdminAcademicTrackingRepository.countStudentAcademicRows(
        { searchPattern: "%no-such-cohort-zzz%" },
        tx
      );
      expect(noMatch).toBe(0);
    });
  });

  test("getAcademicStats: exact empty-platform row, then exact conditional aggregation", async () => {
    await runInRollback(async tx => {
      const baseline = await AdminAcademicTrackingRepository.getAcademicStats(NOW, tx);
      // Precondition for the exact averages below: no committed graded
      // rows exist (the platform is rollback-empty).
      expect(baseline.studentsWithGradedHomeworkCount).toBe(0);
      expect(baseline.averageJadidGrade).toBeNull();
      expect(baseline.averageMadiGrade).toBeNull();

      const tag = cohortTag();
      const teacher = await setupTeacher(tx);
      await setupStudent(tx, tag, 0);
      const gradedBoth = await setupStudent(tx, tag, 1);
      const gradedJadidOnly = await setupStudent(tx, tag, 2);
      await setupStudent(tx, tag, 3); // tracked, zero academic rows

      await setupHomeworkBatch(tx, teacher.id, gradedBoth.id, [
        {
          homeWork: {
            currentSurahJuz: SurahJuzRef.SurahAlFatihah,
            currentGrade: 85,
            revisionSurahJuz: SurahJuzRef.Juz1,
            revisionGrade: 55,
            createdAt: at(-1 * DAY),
          },
        },
      ]);
      await setupHomeworkBatch(tx, teacher.id, gradedJadidOnly.id, [
        {
          homeWork: { currentSurahJuz: SurahJuzRef.SurahAlBaqarah, currentGrade: 95, createdAt: at(-1 * DAY) },
        },
      ]);

      const stats = await AdminAcademicTrackingRepository.getAcademicStats(NOW, tx);
      expect(stats.trackedStudentCount).toBe(baseline.trackedStudentCount + 4);
      expect(stats.studentsWithGradedHomeworkCount).toBe(2);
      expect(stats.averageJadidGrade).toBe(90); // round(avg(85, 95), 2)
      expect(stats.averageMadiGrade).toBe(55); // single graded revision row
    });
  });

  test("listAttentionSignals: one row per sealed student; zero-row student carries honest empties", async () => {
    await runInRollback(async tx => {
      const tag = cohortTag();
      const baselineSignals = await AdminAcademicTrackingRepository.listAttentionSignals(NOW, tx);
      const student = await setupStudent(tx, tag, 0);

      const signals = await AdminAcademicTrackingRepository.listAttentionSignals(NOW, tx);
      expect(signals).toHaveLength(baselineSignals.length + 1);

      // A student with no academic rows: empty grade window (absence is
      // not failure — flagging is the service's threshold call), both
      // staleness anchors null, zero completed sessions.
      const zeroRowSignal = signals.find(entry => entry.studentId === student.id);
      if (!zeroRowSignal) {
        throw new Error("expected a signal row for the created student");
      }
      expect(zeroRowSignal.recentGradedJadidGrades).toEqual([]);
      expect(zeroRowSignal.lastGradedHomeworkAt).toBeNull();
      expect(zeroRowSignal.lastHomeworkAssignedAt).toBeNull();
      expect(zeroRowSignal.completedSessionCount).toBe(0);
    });
  });

  test("getStudentEchoById: every arm — found, missing id, non-student account, soft-deleted, NULL marker", async () => {
    await runInRollback(async tx => {
      const student = await setupStudent(tx, cohortTag(), 0);

      const found = await AdminAcademicTrackingRepository.getStudentEchoById(student.id, tx);
      expect(found).toEqual({
        id: student.id,
        fullName: student.fullName,
        email: student.email,
        isDeleted: false,
      });

      const missing = await AdminAcademicTrackingRepository.getStudentEchoById(NONEXISTENT_STUDENT_ID, tx);
      expect(missing).toBeNull();

      const teacher = await setupTeacher(tx);
      const nonStudent = await AdminAcademicTrackingRepository.getStudentEchoById(teacher.id, tx);
      expect(nonStudent).toBeNull();

      const deleted = await setupStudent(tx, cohortTag(), 1, { isDeleted: true });
      const deletedEcho = await AdminAcademicTrackingRepository.getStudentEchoById(deleted.id, tx);
      expect(deletedEcho).toEqual({
        id: deleted.id,
        fullName: deleted.fullName,
        email: deleted.email,
        isDeleted: true,
      });

      // A NULL deletion marker reads as not deleted (only `true` banners).
      const nullMarker = await setupStudent(tx, cohortTag(), 2, { isDeleted: null });
      const nullMarkerEcho = await AdminAcademicTrackingRepository.getStudentEchoById(nullMarker.id, tx);
      expect(nullMarkerEcho?.isDeleted).toBe(false);
    });
  });

  test("surah/juz vocabulary guard: null passes through, members narrow, corrupt values throw", async () => {
    await runInRollback(async () => {
      expect(narrowSurahJuzRef(null)).toBeNull();
      expect(narrowSurahJuzRef(SurahJuzRef.Juz3)).toBe(SurahJuzRef.Juz3);

      const corrupt = await expectRepoError(async () => narrowSurahJuzRef("juz_99_not_a_member"));
      expect(corrupt.message).toContain("corrupt surah_juz_ref");

      // The row mapper coalesces a LEFT-JOIN-miss row onto honest zeros.
      const mapped = mapAcademicStudentRow({
        id: 1,
        fullName: "Raw Row",
        email: "raw@test.local",
        jadidSurahJuz: SurahJuzRef.SurahAlMaidah,
        jadidFromAyah: 1,
        jadidToAyah: 5,
        madiSurahJuz: null,
        madiFromAyah: null,
        madiToAyah: null,
        jadidGradedCount: null,
        jadidAverageGrade: null,
        madiGradedCount: null,
        madiAverageGrade: null,
        progressRowCount: null,
        lastGradedHomeworkAt: null,
      });
      expect(mapped.jadidSurahJuz).toBe(SurahJuzRef.SurahAlMaidah);
      expect(mapped.jadidGradedCount).toBe(0);
      expect(mapped.madiGradedCount).toBe(0);
      expect(mapped.progressRowCount).toBe(0);
      expect(mapped.madiAverageGrade).toBeNull();
    });
  });
});

describe("AdminAcademicTrackingRepository — Tier 2 (boundary)", () => {
  test("zero graded rows: averages null (never 0), positions fall back to the newest reference, window empty", async () => {
    await runInRollback(async tx => {
      const tag = cohortTag();
      const teacher = await setupTeacher(tx);
      const student = await setupStudent(tx, tag, 0);

      // Two ungraded Jadid rows carrying references (older fatihah, newer
      // juz_2) and one ungraded Madi reference on the newer row.
      await setupHomeworkBatch(tx, teacher.id, student.id, [
        {
          homeWork: {
            currentSurahJuz: SurahJuzRef.SurahAlFatihah,
            currentFromAyah: 1,
            currentToAyah: 7,
            createdAt: at(-2 * DAY),
          },
        },
        {
          homeWork: {
            currentSurahJuz: SurahJuzRef.Juz2,
            revisionSurahJuz: SurahJuzRef.Juz3,
            createdAt: at(-1 * DAY),
          },
        },
      ]);

      const rows = await AdminAcademicTrackingRepository.listStudentAcademicRows(
        { searchPattern: cohortPattern(tag) },
        NOW,
        10,
        0,
        tx
      );
      const row = rows[0];
      if (!row) {
        throw new Error("expected the cohort row");
      }
      expect(row.jadidSurahJuz).toBe(SurahJuzRef.Juz2); // newest reference stands in
      expect(row.jadidGradedCount).toBe(0);
      expect(row.jadidAverageGrade).toBeNull(); // never a fabricated zero
      expect(row.madiSurahJuz).toBe(SurahJuzRef.Juz3);
      expect(row.madiGradedCount).toBe(0);
      expect(row.madiAverageGrade).toBeNull();
      expect(row.lastGradedHomeworkAt).toBeNull();

      const signals = await AdminAcademicTrackingRepository.listAttentionSignals(NOW, tx);
      const signal = signals.find(entry => entry.studentId === student.id);
      expect(signal?.recentGradedJadidGrades).toEqual([]);
      expect(signal?.lastHomeworkAssignedAt).toEqual(at(-1 * DAY)); // assignment fallback anchor
      expect(signal?.lastGradedHomeworkAt).toBeNull();
    });
  });

  test("graded-first position nuance: graded beats newer ungraded reference; graded without reference yields null", async () => {
    await runInRollback(async tx => {
      const tag = cohortTag();
      const teacher = await setupTeacher(tx);
      const gradedOlder = await setupStudent(tx, tag, 0);
      const gradedNoRef = await setupStudent(tx, tag, 1);

      // Older GRADED fatihah row vs newer UNGRADED baqarah reference.
      await setupHomeworkBatch(tx, teacher.id, gradedOlder.id, [
        {
          homeWork: {
            currentSurahJuz: SurahJuzRef.SurahAlFatihah,
            currentFromAyah: 1,
            currentToAyah: 5,
            currentGrade: 90,
            createdAt: at(-2 * DAY),
          },
        },
        {
          homeWork: {
            currentSurahJuz: SurahJuzRef.SurahAlBaqarah,
            currentFromAyah: 6,
            currentToAyah: 10,
            createdAt: at(-1 * DAY),
          },
        },
      ]);
      // Newest row is GRADED but carries no reference → null position
      // (the fallback never outranks a graded row).
      await setupHomeworkBatch(tx, teacher.id, gradedNoRef.id, [
        {
          homeWork: {
            currentSurahJuz: SurahJuzRef.Juz5,
            currentFromAyah: 1,
            currentToAyah: 2,
            createdAt: at(-2 * DAY),
          },
        },
        {
          homeWork: { currentGrade: 70, createdAt: at(-1 * DAY) },
        },
      ]);

      const rows = await AdminAcademicTrackingRepository.listStudentAcademicRows(
        { searchPattern: cohortPattern(tag) },
        NOW,
        10,
        0,
        tx
      );
      expect(rows).toHaveLength(2);
      const olderFirst = rows.find(row => row.id === gradedOlder.id);
      const noRefRow = rows.find(row => row.id === gradedNoRef.id);
      if (!olderFirst || !noRefRow) {
        throw new Error("expected both cohort rows");
      }
      expect(olderFirst.jadidSurahJuz).toBe(SurahJuzRef.SurahAlFatihah);
      expect(olderFirst.jadidAverageGrade).toBe(90);
      expect(noRefRow.jadidSurahJuz).toBeNull();
      expect(noRefRow.jadidGradedCount).toBe(1);
      expect(noRefRow.jadidAverageGrade).toBe(70);
    });
  });

  test("grade bounds 0/100 hold as exact averages and stay isolated per student", async () => {
    await runInRollback(async tx => {
      const tag = cohortTag();
      const teacher = await setupTeacher(tx);
      const bounded = await setupStudent(tx, tag, 0);
      const neighbor = await setupStudent(tx, tag, 1);

      await setupHomeworkBatch(tx, teacher.id, bounded.id, [
        {
          homeWork: {
            currentSurahJuz: SurahJuzRef.SurahAlFatihah,
            currentGrade: 0,
            revisionSurahJuz: SurahJuzRef.Juz1,
            revisionGrade: 100,
            createdAt: at(-1 * DAY),
          },
        },
      ]);
      await insertProgressRows(tx, bounded.id, 2);
      await setupHomeworkBatch(tx, teacher.id, neighbor.id, [
        {
          homeWork: {
            currentSurahJuz: SurahJuzRef.SurahAlBaqarah,
            currentGrade: 100,
            createdAt: at(-1 * DAY),
          },
        },
      ]);
      await insertProgressRows(tx, neighbor.id, 5);

      const rows = await AdminAcademicTrackingRepository.listStudentAcademicRows(
        { searchPattern: cohortPattern(tag) },
        NOW,
        10,
        0,
        tx
      );
      const boundedRow = rows.find(row => row.id === bounded.id);
      const neighborRow = rows.find(row => row.id === neighbor.id);
      if (!boundedRow || !neighborRow) {
        throw new Error("expected both cohort rows");
      }
      expect(boundedRow.jadidGradedCount).toBe(1);
      expect(boundedRow.jadidAverageGrade).toBe(0); // honest zero average
      expect(boundedRow.madiGradedCount).toBe(1);
      expect(boundedRow.madiAverageGrade).toBe(100);
      expect(boundedRow.progressRowCount).toBe(2);
      // Multi-student isolation: the neighbor's data never leaks across.
      expect(neighborRow.jadidAverageGrade).toBe(100);
      expect(neighborRow.madiGradedCount).toBe(0);
      expect(neighborRow.madiAverageGrade).toBeNull();
      expect(neighborRow.progressRowCount).toBe(5);

      const signals = await AdminAcademicTrackingRepository.listAttentionSignals(NOW, tx);
      const boundedSignal = signals.find(entry => entry.studentId === bounded.id);
      expect(boundedSignal?.recentGradedJadidGrades).toEqual([0]);
    });
  });

  test("page-slice boundaries: deterministic order, limit/offset walk, honest total", async () => {
    await runInRollback(async tx => {
      const tag = cohortTag();
      // Created old → new: expected listing order is newest-first.
      const oldest = await setupStudent(tx, tag, 0);
      const middle = await setupStudent(tx, tag, 1);
      const newest = await setupStudent(tx, tag, 2);

      const total = await AdminAcademicTrackingRepository.countStudentAcademicRows(
        { searchPattern: cohortPattern(tag) },
        tx
      );
      expect(total).toBe(3);

      const pageOne = await AdminAcademicTrackingRepository.listStudentAcademicRows(
        { searchPattern: cohortPattern(tag) },
        NOW,
        2,
        0,
        tx
      );
      expect(pageOne.map(row => row.id)).toEqual([newest.id, middle.id]);

      const pageTwo = await AdminAcademicTrackingRepository.listStudentAcademicRows(
        { searchPattern: cohortPattern(tag) },
        NOW,
        2,
        2,
        tx
      );
      expect(pageTwo.map(row => row.id)).toEqual([oldest.id]);

      const pagePastEnd = await AdminAcademicTrackingRepository.listStudentAcademicRows(
        { searchPattern: cohortPattern(tag) },
        NOW,
        2,
        3,
        tx
      );
      expect(pagePastEnd).toEqual([]);
    });
  });

  test("soft-deleted students: excluded from rows, count, stats, signals — echoed for the drill-down", async () => {
    await runInRollback(async tx => {
      const tag = cohortTag();
      const teacher = await setupTeacher(tx);
      const active = await setupStudent(tx, tag, 0);
      const deleted = await setupStudent(tx, tag, 1, { isDeleted: true });
      const nullMarker = await setupStudent(tx, tag, 2, { isDeleted: null });

      await setupHomeworkBatch(tx, teacher.id, deleted.id, [
        { homeWork: { currentSurahJuz: SurahJuzRef.Juz1, currentGrade: 10, createdAt: at(-1 * DAY) } },
      ]);
      await setupHomeworkBatch(tx, teacher.id, active.id, [
        { homeWork: { currentSurahJuz: SurahJuzRef.Juz2, currentGrade: 80, createdAt: at(-1 * DAY) } },
      ]);

      const rows = await AdminAcademicTrackingRepository.listStudentAcademicRows(
        { searchPattern: cohortPattern(tag) },
        NOW,
        10,
        0,
        tx
      );
      // The strict seal: only explicitly-not-deleted students surface —
      // the soft-deleted AND the NULL-marker accounts are both absent.
      expect(rows.map(row => row.id)).toEqual([active.id]);
      expect(rows[0]?.jadidAverageGrade).toBe(80); // deleted student's grade never mixes in

      const count = await AdminAcademicTrackingRepository.countStudentAcademicRows(
        { searchPattern: cohortPattern(tag) },
        tx
      );
      expect(count).toBe(1);

      const signals = await AdminAcademicTrackingRepository.listAttentionSignals(NOW, tx);
      expect(signals.find(entry => entry.studentId === deleted.id)).toBeUndefined();
      expect(signals.find(entry => entry.studentId === nullMarker.id)).toBeUndefined();

      // The drill-down echo still resolves the soft-deleted account.
      const deletedEcho = await AdminAcademicTrackingRepository.getStudentEchoById(deleted.id, tx);
      expect(deletedEcho?.isDeleted).toBe(true);
    });
  });

  test("attention window: newest-first ordering, single-row windows, and the repository-side bound", async () => {
    await runInRollback(async tx => {
      const tag = cohortTag();
      const teacher = await setupTeacher(tx);
      const threeGrades = await setupStudent(tx, tag, 0);
      const twelveGrades = await setupStudent(tx, tag, 1);

      await setupHomeworkBatch(tx, teacher.id, threeGrades.id, [
        { homeWork: { currentGrade: 50, createdAt: at(-3 * DAY), updatedAt: at(-3 * DAY) } },
        { homeWork: { currentGrade: 60, createdAt: at(-2 * DAY), updatedAt: at(-2 * DAY) } },
        { homeWork: { currentGrade: 70, createdAt: at(-1 * DAY), updatedAt: at(-1 * DAY) } },
      ]);

      // Newest row first (grade 12 at −1h) down to grade 1 at −12h.
      const fixtures = Array.from({ length: 12 }, (_, index) => ({
        homeWork: { currentGrade: 12 - index, createdAt: at(-(index + 1) * HOUR) },
      }));
      await setupHomeworkBatch(tx, teacher.id, twelveGrades.id, fixtures);

      const signals = await AdminAcademicTrackingRepository.listAttentionSignals(NOW, tx);
      const threeSignal = signals.find(entry => entry.studentId === threeGrades.id);
      const twelveSignal = signals.find(entry => entry.studentId === twelveGrades.id);
      expect(threeSignal?.recentGradedJadidGrades).toEqual([70, 60, 50]);
      expect(twelveSignal?.recentGradedJadidGrades).toHaveLength(RECENT_GRADED_JADID_WINDOW);
      expect(twelveSignal?.recentGradedJadidGrades).toEqual([12, 11, 10, 9, 8, 7, 6, 5, 4, 3]);
      expect(RECENT_GRADED_JADID_WINDOW).toBe(10);
    });
  });

  test("completed-session eligibility counts only completed sessions at or before the snapshot", async () => {
    await runInRollback(async tx => {
      const tag = cohortTag();
      const teacher = await setupTeacher(tx);
      const eligible = await setupStudent(tx, tag, 0);
      const notEligible = await setupStudent(tx, tag, 1);

      await setupHomeworkBatch(tx, teacher.id, eligible.id, [
        { sessionStatus: SessionStatus.Completed, homeWork: { currentGrade: 75, createdAt: at(-1 * DAY) } },
      ]);
      await setupHomeworkBatch(tx, teacher.id, notEligible.id, [
        { sessionStatus: SessionStatus.Scheduled, homeWork: { currentGrade: 75, createdAt: at(-1 * DAY) } },
      ]);
      // A completed session stamped after the snapshot instant counts in
      // none of the lanes.
      await createTestSession(tx, teacher.id, eligible.id, {
        status: SessionStatus.Completed,
        createdAt: at(1 * DAY),
      });

      const signals = await AdminAcademicTrackingRepository.listAttentionSignals(NOW, tx);
      const eligibleSignal = signals.find(entry => entry.studentId === eligible.id);
      const notEligibleSignal = signals.find(entry => entry.studentId === notEligible.id);
      expect(eligibleSignal?.completedSessionCount).toBe(1);
      expect(notEligibleSignal?.completedSessionCount).toBe(0);
    });
  });

  test("now cutoff: homework stamped after the snapshot instant surfaces nowhere", async () => {
    await runInRollback(async tx => {
      const tag = cohortTag();
      const teacher = await setupTeacher(tx);
      const student = await setupStudent(tx, tag, 0);

      await setupHomeworkBatch(tx, teacher.id, student.id, [
        { homeWork: { currentSurahJuz: SurahJuzRef.Juz1, currentGrade: 88, createdAt: at(1 * DAY) } },
      ]);

      const rows = await AdminAcademicTrackingRepository.listStudentAcademicRows(
        { searchPattern: cohortPattern(tag) },
        NOW,
        10,
        0,
        tx
      );
      const row = rows[0];
      if (!row) {
        throw new Error("expected the cohort row");
      }
      expect(row.jadidSurahJuz).toBeNull();
      expect(row.jadidGradedCount).toBe(0);
      expect(row.jadidAverageGrade).toBeNull();
      expect(row.lastGradedHomeworkAt).toBeNull();

      const stats = await AdminAcademicTrackingRepository.getAcademicStats(NOW, tx);
      expect(stats.studentsWithGradedHomeworkCount).toBe(0);

      const signals = await AdminAcademicTrackingRepository.listAttentionSignals(NOW, tx);
      const signal = signals.find(entry => entry.studentId === student.id);
      expect(signal?.recentGradedJadidGrades).toEqual([]);
      expect(signal?.lastHomeworkAssignedAt).toBeNull();
    });
  });

  test("lastGradedHomeworkAt rides the newest graded row's grade-write stamp, ignoring ungraded rows", async () => {
    await runInRollback(async tx => {
      const tag = cohortTag();
      const teacher = await setupTeacher(tx);
      const student = await setupStudent(tx, tag, 0);

      await setupHomeworkBatch(tx, teacher.id, student.id, [
        {
          homeWork: {
            currentGrade: 60,
            createdAt: at(-5 * DAY),
            updatedAt: at(-5 * DAY), // graded stamp (the grade write bumps it)
          },
        },
        {
          homeWork: {
            currentSurahJuz: SurahJuzRef.Juz2, // ungraded but touched later
            createdAt: at(-1 * DAY),
            updatedAt: NOW,
          },
        },
      ]);

      const rows = await AdminAcademicTrackingRepository.listStudentAcademicRows(
        { searchPattern: cohortPattern(tag) },
        NOW,
        10,
        0,
        tx
      );
      expect(rows[0]?.lastGradedHomeworkAt).toEqual(at(-5 * DAY));

      const signals = await AdminAcademicTrackingRepository.listAttentionSignals(NOW, tx);
      const signal = signals.find(entry => entry.studentId === student.id);
      expect(signal?.lastGradedHomeworkAt).toEqual(at(-5 * DAY));
      expect(signal?.lastHomeworkAssignedAt).toEqual(at(-1 * DAY));
    });
  });
});

describe("AdminAcademicTrackingRepository — Tier 3 (chaos: overlapping concurrent reads)", () => {
  test("all five readers settle fulfilled over the SAME rollback transaction and stay mutually consistent", async () => {
    await runInRollback(async tx => {
      const tag = cohortTag();
      const teacher = await setupTeacher(tx);
      const alpha = await setupStudent(tx, tag, 0);
      const beta = await setupStudent(tx, tag, 1);

      await setupHomeworkBatch(tx, teacher.id, alpha.id, [
        {
          homeWork: {
            currentSurahJuz: SurahJuzRef.SurahAlFatihah,
            currentGrade: 82,
            revisionSurahJuz: SurahJuzRef.Juz4,
            revisionGrade: 64,
            createdAt: at(-1 * DAY),
          },
        },
      ]);
      await setupHomeworkBatch(tx, teacher.id, beta.id, [
        { homeWork: { currentSurahJuz: SurahJuzRef.SurahAlBaqarah, currentGrade: 91, createdAt: at(-1 * DAY) } },
      ]);
      await insertProgressRows(tx, alpha.id, 4);

      const filters = { searchPattern: cohortPattern(tag) };
      const settled = await Promise.allSettled([
        AdminAcademicTrackingRepository.listStudentAcademicRows(filters, NOW, 10, 0, tx),
        AdminAcademicTrackingRepository.countStudentAcademicRows(filters, tx),
        AdminAcademicTrackingRepository.getAcademicStats(NOW, tx),
        AdminAcademicTrackingRepository.listAttentionSignals(NOW, tx),
        AdminAcademicTrackingRepository.getStudentEchoById(alpha.id, tx),
      ]);

      const rejected = settled.find(result => result.status === "rejected");
      expect(rejected).toBeUndefined();

      const rows = unwrapFulfilled(settled[0], "list");
      const count = unwrapFulfilled(settled[1], "count");
      const stats = unwrapFulfilled(settled[2], "stats");
      const signals = unwrapFulfilled(settled[3], "signals");
      const echo = unwrapFulfilled(settled[4], "echo");

      // Mutually consistent snapshot: the count matches the listed window,
      // every listed row has a signal row, and the echo resolves its row.
      expect(rows).toHaveLength(2);
      expect(count).toBe(2);
      expect(stats.trackedStudentCount).toBeGreaterThanOrEqual(2);
      expect(echo?.id).toBe(alpha.id);
      for (const row of rows) {
        expect(signals.find(entry => entry.studentId === row.id)).toBeDefined();
      }
      expect(signals.find(entry => entry.studentId === alpha.id)?.recentGradedJadidGrades).toEqual([82]);
      expect(signals.find(entry => entry.studentId === beta.id)?.recentGradedJadidGrades).toEqual([91]);
    });
  });
});

describe("AdminAcademicTrackingRepository — Tier 4 (LIKE discipline: the pattern is bound verbatim)", () => {
  test("% and _ act as verbatim wildcards; a bare _ matches only one-character names", async () => {
    await runInRollback(async tx => {
      const tag = cohortTag();
      const alpha = await setupStudent(tx, tag, 0, { fullName: `${tag}alpha` });

      // `%` behaves as a multi-character wildcard (bound verbatim, never
      // escaped by the repository — escaping is the service's duty).
      const prefixMatch = await AdminAcademicTrackingRepository.listStudentAcademicRows(
        { searchPattern: `${tag}%` },
        NOW,
        10,
        0,
        tx
      );
      expect(prefixMatch.map(row => row.id)).toContain(alpha.id);

      // `_` behaves as a single-character wildcard.
      const underscoreMatch = await AdminAcademicTrackingRepository.listStudentAcademicRows(
        { searchPattern: `${tag}_lpha` },
        NOW,
        10,
        0,
        tx
      );
      expect(underscoreMatch.map(row => row.id)).toEqual([alpha.id]);

      // A bare `_` matches exactly one character — the multi-char cohort
      // student is absent (and the statement never errors).
      const bareUnderscore = await AdminAcademicTrackingRepository.listStudentAcademicRows(
        { searchPattern: "_" },
        NOW,
        10,
        0,
        tx
      );
      expect(bareUnderscore.find(row => row.id === alpha.id)).toBeUndefined();
    });
  });

  test("\\% escape round-trips: a literal % matches only through the escape (no double-escaping)", async () => {
    await runInRollback(async tx => {
      const tag = cohortTag();
      const literalPercent = await createTestUser(tx, {
        fullName: `${tag}pct%mark`,
        createdAt: at(-1 * DAY),
      });
      await createTestStudent(tx, literalPercent.id);

      // `\%` is the escaped literal percent — matches the name containing
      // the raw `%` character. A repository-side re-escape would turn the
      // pattern into `\\%` (literal backslash + wildcard), which matches
      // nothing here — so this assertion pins no-double-escaping too.
      const escaped = await AdminAcademicTrackingRepository.listStudentAcademicRows(
        { searchPattern: `${tag}pct\\%mark` },
        NOW,
        10,
        0,
        tx
      );
      expect(escaped.map(row => row.id)).toContain(literalPercent.id);

      // The unescaped `%` in the same position is a wildcard — it matches
      // as well (proving the pattern reaches PostgreSQL unharmed).
      const unescaped = await AdminAcademicTrackingRepository.listStudentAcademicRows(
        { searchPattern: `${tag}pct%mark` },
        NOW,
        10,
        0,
        tx
      );
      expect(unescaped.map(row => row.id)).toContain(literalPercent.id);
    });
  });

  test("search matches the email OR-arm and stays case-insensitive over both columns", async () => {
    await runInRollback(async tx => {
      const tag = cohortTag();
      const emailOnly = await createTestUser(tx, {
        fullName: `Plain Named Student ${tag}`,
        email: `wb-${tag}@test.local`,
        createdAt: at(-1 * DAY),
      });
      await createTestStudent(tx, emailOnly.id);

      const byEmail = await AdminAcademicTrackingRepository.listStudentAcademicRows(
        { searchPattern: `wb-${tag}%` },
        NOW,
        10,
        0,
        tx
      );
      expect(byEmail.map(row => row.id)).toEqual([emailOnly.id]);

      const byNameCaseInsensitive = await AdminAcademicTrackingRepository.listStudentAcademicRows(
        { searchPattern: `%PLAIN NAMED STUDENT ${tag.toUpperCase()}%` },
        NOW,
        10,
        0,
        tx
      );
      expect(byNameCaseInsensitive.map(row => row.id)).toEqual([emailOnly.id]);
    });
  });
});
