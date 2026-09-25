/**
 * Admin academic tracking query helpers — the extracted LATERAL lane
 * builders, the surah/juz vocabulary guard, and the directory-row mapper
 * for `./academic-tracking.repository.ts`.
 *
 * Contains the per-student LATERAL subquery builders (latest-position lane
 * per track, the two-track grade-summary lane, the progress-row-count
 * lane, and the three attention-signal lanes), the repository-side recent
 * graded Jadid window constant, the fail-closed `surah_juz_ref`
 * vocabulary guard, and the raw-row → select-shape mapper. Extracted for
 * file-size budget; behavior is byte-identical to the pre-extraction
 * definitions — every builder returns the same Drizzle subquery the
 * repository composed inline, so each public repository method still
 * issues exactly ONE statement.
 *
 * Correlation discipline: every lane builder receives the student-id
 * column the lateral scope correlates on (the page-slice's `id` for the
 * directory lanes, the outer `users.id` for the attention-signal lanes),
 * so the subqueries stay lateral-scoped to exactly one student per outer
 * row and can never fan out cross-student.
 */
import { and, desc, eq, isNotNull, lte, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { homeWork } from "@/backend/db/schema/classes/home-work";
import { progress } from "@/backend/db/schema/classes/progress";
import { session } from "@/backend/db/schema/classes/session";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import { isSurahJuzRef, type SurahJuzRef } from "@/backend/enum/shared/surah-juz-ref.enum";
import type { AdminAcademicStudentRowSelectType, DBTransaction } from "@/backend/types";

/**
 * Repository-side bound of the per-student recent graded Jadid window
 * returned by `listAttentionSignals` (newest-first grade list). Sized to
 * cover the service layer's recent-graded attention window; the window is
 * NEVER bounded by caller arguments — there are no client-controlled
 * bounds on any method in this repository.
 */
export const RECENT_GRADED_JADID_WINDOW = 10;

/**
 * Null-safe timestamp decoder for raw SQL aggregate fragments (`max(...)`,
 * `min(...)`): the pg driver surfaces raw-fragment timestamps as strings, so
 * the mapper re-hydrates them onto native `Date` values while an SQL NULL
 * stays a JS `null` (a missing stamp is "never", never an epoch).
 */
function decodeNullableTimestamp(value: string | Date | null): Date | null {
  if (value === null) {
    return null;
  }
  return value instanceof Date ? value : new Date(value);
}

/**
 * The per-lane column quadruple a position lane reads (grade-write recency
 * discriminator, surah/juz reference, ayah span). Parameterized so one
 * builder serves both tracks without duplicating the ordering chain.
 */
interface AcademicPositionLaneColumns {
  readonly grade: AnyPgColumn;
  readonly surahJuz: AnyPgColumn;
  readonly fromAyah: AnyPgColumn;
  readonly toAyah: AnyPgColumn;
}

/** Jadid (new-memorization) lane columns — the `current_*` storage lane. */
const JADID_POSITION_LANE_COLUMNS: AcademicPositionLaneColumns = {
  grade: homeWork.currentGrade,
  surahJuz: homeWork.currentSurahJuz,
  fromAyah: homeWork.currentFromAyah,
  toAyah: homeWork.currentToAyah,
};

/** Madi (revision) lane columns — the `revision_*` storage lane. */
const MADI_POSITION_LANE_COLUMNS: AcademicPositionLaneColumns = {
  grade: homeWork.revisionGrade,
  surahJuz: homeWork.revisionSurahJuz,
  fromAyah: homeWork.revisionFromAyah,
  toAyah: homeWork.revisionToAyah,
};

/**
 * Builds one latest-position LATERAL lane over the student's own homework
 * rows joined through their sessions: the newest GRADED row wins, then the
 * newest row carrying a surah/juz reference, then `created_at DESC, id
 * DESC` as the deterministic tiebreak — LIMIT 1, so the lane yields at
 * most one row per student.
 *
 * @param tx           The caller's transaction the subquery executes on.
 * @param studentIdRef The correlated student-id column (lateral scope).
 * @param now          The snapshot instant the lane closes at.
 * @param columns      The track's column quadruple.
 * @param alias        Unique derived-table alias for the lane.
 */
function buildPositionLane(
  tx: DBTransaction,
  studentIdRef: AnyPgColumn,
  now: Date,
  columns: AcademicPositionLaneColumns,
  alias: string
) {
  return tx
    .select({
      surahJuz: sql<string | null>`${columns.surahJuz}`.as("surah_juz"),
      fromAyah: sql<number | null>`${columns.fromAyah}`.as("from_ayah"),
      toAyah: sql<number | null>`${columns.toAyah}`.as("to_ayah"),
    })
    .from(homeWork)
    .innerJoin(session, eq(session.id, homeWork.sessionId))
    .where(and(eq(session.studentId, studentIdRef), lte(homeWork.createdAt, now)))
    .orderBy(
      sql`${columns.grade} is not null desc`,
      sql`${columns.surahJuz} is not null desc`,
      desc(homeWork.createdAt),
      desc(homeWork.id)
    )
    .limit(1)
    .as(alias);
}

/**
 * The Jadid latest-position lane (newest graded `current_*` row, falling
 * back to the newest row carrying a `current_surah_juz` reference).
 */
export function buildJadidPositionLane(tx: DBTransaction, studentIdRef: AnyPgColumn, now: Date) {
  return buildPositionLane(tx, studentIdRef, now, JADID_POSITION_LANE_COLUMNS, "jadid_position_lane");
}

/**
 * The Madi latest-position lane (newest graded `revision_*` row, falling
 * back to the newest row carrying a `revision_surah_juz` reference).
 */
export function buildMadiPositionLane(tx: DBTransaction, studentIdRef: AnyPgColumn, now: Date) {
  return buildPositionLane(tx, studentIdRef, now, MADI_POSITION_LANE_COLUMNS, "madi_position_lane");
}

/**
 * Builds the two-track grade-summary LATERAL lane: ONE single-row
 * conditional aggregation over the student's own homework rows — the
 * graded-row counts and rounded averages per track (averages are SQL NULL
 * over zero graded rows) plus the newest graded-activity stamp (a graded
 * row's grade-write `updated_at`, null when nothing was ever graded).
 */
export function buildLaneGradeSummary(tx: DBTransaction, studentIdRef: AnyPgColumn, now: Date) {
  return tx
    .select({
      jadidGradedCount: sql<number>`count(${homeWork.currentGrade})::int`.mapWith(Number).as("jadid_graded_count"),
      jadidAverageGrade: sql<number | null>`round(avg(${homeWork.currentGrade})::numeric, 2)::float8`.as(
        "jadid_average_grade"
      ),
      madiGradedCount: sql<number>`count(${homeWork.revisionGrade})::int`.mapWith(Number).as("madi_graded_count"),
      madiAverageGrade: sql<number | null>`round(avg(${homeWork.revisionGrade})::numeric, 2)::float8`.as(
        "madi_average_grade"
      ),
      lastGradedHomeworkAt:
        sql<Date | null>`max(${homeWork.updatedAt}) filter (where ${homeWork.currentGrade} is not null or ${homeWork.revisionGrade} is not null)`
          .mapWith(decodeNullableTimestamp)
          .as("last_graded_homework_at"),
    })
    .from(homeWork)
    .innerJoin(session, eq(session.id, homeWork.sessionId))
    .where(and(eq(session.studentId, studentIdRef), lte(homeWork.createdAt, now)))
    .as("lane_grade_summary");
}

/**
 * Builds the honest progress-row-count LATERAL lane: a bare count over the
 * student's own `progress` rows at the snapshot instant — never a derived
 * percentage.
 */
export function buildProgressLane(tx: DBTransaction, studentIdRef: AnyPgColumn, now: Date) {
  return tx
    .select({ rowCount: sql<number>`count(*)::int`.mapWith(Number).as("row_count") })
    .from(progress)
    .where(and(eq(progress.studentId, studentIdRef), lte(progress.createdAt, now)))
    .as("progress_lane");
}

/**
 * Builds the recent graded Jadid grade-window LATERAL lane: the student's
 * newest graded `current_grade` values aggregated newest-first into one
 * array (bounded by `RECENT_GRADED_JADID_WINDOW`), empty when the student
 * has no graded Jadid rows — absence of grades is not failure.
 */
export function buildGradedJadidWindowLane(tx: DBTransaction, studentIdRef: AnyPgColumn, now: Date) {
  const recentJadidWindow = tx
    .select({
      grade: homeWork.currentGrade,
      createdAt: homeWork.createdAt,
      id: homeWork.id,
    })
    .from(homeWork)
    .innerJoin(session, eq(session.id, homeWork.sessionId))
    .where(and(eq(session.studentId, studentIdRef), lte(homeWork.createdAt, now), isNotNull(homeWork.currentGrade)))
    .orderBy(desc(homeWork.createdAt), desc(homeWork.id))
    .limit(RECENT_GRADED_JADID_WINDOW)
    .as("recent_jadid_window");

  return tx
    .select({
      grades: sql<
        number[]
      >`coalesce(array_agg(${recentJadidWindow.grade} order by ${recentJadidWindow.createdAt} desc, ${recentJadidWindow.id} desc), '{}')::int[]`.as(
        "grades"
      ),
    })
    .from(recentJadidWindow)
    .as("jadid_grade_window_lane");
}

/**
 * Builds the attention staleness-anchor LATERAL lane over the student's
 * own homework rows: the newest graded row's grade-write stamp (the
 * staleness anchor) and the newest assignment's creation stamp (the
 * fallback anchor for never-graded students) — both null when the student
 * has no homework rows at all.
 */
export function buildAttentionAnchorLane(tx: DBTransaction, studentIdRef: AnyPgColumn, now: Date) {
  return tx
    .select({
      lastGradedHomeworkAt:
        sql<Date | null>`max(${homeWork.updatedAt}) filter (where ${homeWork.currentGrade} is not null or ${homeWork.revisionGrade} is not null)`
          .mapWith(decodeNullableTimestamp)
          .as("last_graded_homework_at"),
      lastHomeworkAssignedAt: sql<Date | null>`max(${homeWork.createdAt})`
        .mapWith(decodeNullableTimestamp)
        .as("last_homework_assigned_at"),
    })
    .from(homeWork)
    .innerJoin(session, eq(session.id, homeWork.sessionId))
    .where(and(eq(session.studentId, studentIdRef), lte(homeWork.createdAt, now)))
    .as("attention_anchor_lane");
}

/**
 * Builds the completed-session-count LATERAL lane: the honest count of the
 * student's own `completed` sessions at the snapshot instant (attention
 * eligibility requires at least one).
 */
export function buildCompletedSessionLane(tx: DBTransaction, studentIdRef: AnyPgColumn, now: Date) {
  return tx
    .select({ completedSessionCount: sql<number>`count(*)::int`.mapWith(Number).as("completed_session_count") })
    .from(session)
    .where(
      and(eq(session.studentId, studentIdRef), lte(session.createdAt, now), eq(session.status, SessionStatus.Completed))
    )
    .as("completed_session_lane");
}

/**
 * Raw (pre-projection) directory row as the LATERAL join resolves it: raw
 * stored surah/juz values (nullable), nullable lateral counts (a LEFT JOIN
 * miss reads all-NULL), and the native grade-activity stamp. The mapper
 * narrows/coalesces onto the select shape.
 */
export interface AcademicStudentRowRaw {
  readonly id: number;
  readonly fullName: string;
  readonly email: string;
  readonly jadidSurahJuz: string | null;
  readonly jadidFromAyah: number | null;
  readonly jadidToAyah: number | null;
  readonly madiSurahJuz: string | null;
  readonly madiFromAyah: number | null;
  readonly madiToAyah: number | null;
  readonly jadidGradedCount: number | null;
  readonly jadidAverageGrade: number | null;
  readonly madiGradedCount: number | null;
  readonly madiAverageGrade: number | null;
  readonly progressRowCount: number | null;
  readonly lastGradedHomeworkAt: Date | null;
}

/**
 * Narrows a raw stored `surah_juz_ref` pgEnum value onto the canonical
 * `SurahJuzRef` vocabulary via the fail-closed total-over-vocabulary guard
 * (`isSurahJuzRef`): the null arm passes through untouched so each caller
 * preserves the schema's per-field nullability, and a value outside the
 * shipped vocabulary (unreachable through the pgEnum — a corruption signal
 * only) throws instead of carrying an unvalidated string onward.
 */
export function narrowSurahJuzRef(raw: string | null): SurahJuzRef | null {
  if (raw === null) {
    return null;
  }
  if (isSurahJuzRef(raw)) {
    return raw;
  }
  throw new Error("AdminAcademicTrackingRepository: corrupt surah_juz_ref value");
}

/**
 * Maps one raw directory row onto the closed select shape: stored
 * surah/juz values narrowed through the vocabulary guard, lateral count
 * misses coalesced to honest zeros (a student with no academic rows reads
 * zero counts, null averages), and every other member carried verbatim.
 */
export function mapAcademicStudentRow(row: AcademicStudentRowRaw): AdminAcademicStudentRowSelectType {
  return {
    id: row.id,
    fullName: row.fullName,
    email: row.email,
    jadidSurahJuz: narrowSurahJuzRef(row.jadidSurahJuz),
    jadidFromAyah: row.jadidFromAyah,
    jadidToAyah: row.jadidToAyah,
    madiSurahJuz: narrowSurahJuzRef(row.madiSurahJuz),
    madiFromAyah: row.madiFromAyah,
    madiToAyah: row.madiToAyah,
    jadidGradedCount: row.jadidGradedCount ?? 0,
    jadidAverageGrade: row.jadidAverageGrade,
    madiGradedCount: row.madiGradedCount ?? 0,
    madiAverageGrade: row.madiAverageGrade,
    progressRowCount: row.progressRowCount ?? 0,
    lastGradedHomeworkAt: row.lastGradedHomeworkAt,
  };
}
