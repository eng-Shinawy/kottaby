/**
 * AdminAcademicTrackingRepository — read-only cross-student aggregation
 * projections for the admin academic monitoring dashboard: the paged
 * all-students academic directory, its honest total, the aggregate
 * advancement statistics, the per-student attention-rule inputs, and the
 * drill-down student echo.
 *
 * Every method is a set-oriented, single-statement SELECT (no writes, no
 * per-row hydration loop, no N+1): per-student lanes ride LEFT JOIN
 * LATERAL subqueries over a page-slice derived table, so the lateral
 * lookups run only for the rows of the requested window and each join can
 * never fan out beyond one row per student per lane. Conditional
 * aggregation (count/avg with `filter (where ...)`) follows the
 * `sql<number>` + `.mapWith(Number)` convention — the null-safe result
 * mapper keeps an SQL NULL a JS `null` (an ungraded track is "not graded
 * yet", never a fabricated zero).
 *
 * Conventions per `backend/db/repo/AGENTS.md`:
 *  - Every method takes the caller's transaction as its LAST parameter and
 *    runs on it (the composing service opens ONE read-only snapshot
 *    transaction per request, so rows and statistics can never straddle a
 *    mid-flight submission). There is no bare-pool fallback branch.
 *  - No prepared statements: these are dynamic reads (window bounds, the
 *    search pattern, and the snapshot instant bind per call), so module
 *    level `sql.placeholder` candidacy does not apply. No `inArray`.
 *  - The `search` filter is the ONLY injection-sensitive surface: the
 *    service layer escapes LIKE wildcards (`escapeLikeWildcards`) AND
 *    wraps the escaped substring as `%…%` BEFORE the repo sees it; the
 *    repo binds that final pattern verbatim to its `ilike` predicates —
 *    never re-escaping or re-wrapping (one canonical escape point at the
 *    service, one binding point here). Every other value rides a bound
 *    parameter or an `eq(...)` / `sql` fragment bind; no string is ever
 *    interpolated into SQL text.
 *  - The dashboard's student lane is hard-sealed to `role = student` AND
 *    `is_deleted = false` (soft-deleted accounts never appear in dashboard
 *    rows, counts, statistics, or signals); the drill-down echo is the one
 *    reader that returns soft-deleted students (the detail header banners
 *    the deletion) and it still resolves ONLY student-lane accounts.
 *
 * Snapshot discipline:
 *  - The caller captures ONE `now` instant and threads it to every
 *    windowed method. A homework, session, or progress row stamped after
 *    that instant counts in none of the aggregates and surfaces in none of
 *    the lanes (statement-level visibility of the captured `now`), so a
 *    snapshot can never disagree with itself across methods. Grade state
 *    reads as committed (grades are write-once and monotonic — once set a
 *    grade never changes), and per-row staleness anchors use the graded
 *    rows' `updated_at` (the grade write bumps it), falling back to
 *    `created_at` for never-graded rows.
 *  - Position honesty per track: the newest GRADED homework row carries
 *    the achieved position; when no graded row exists yet, the newest row
 *    carrying a surah/juz reference stands in (an ungraded assignment is
 *    the teacher's plan, not an achieved position). A graded row without a
 *    reference wins over an older referenced row and yields a null
 *    position — the fallback never outranks a graded row.
 *
 * Honesty contracts:
 *  - Track averages are taken over graded (non-null) rows only and are
 *    `null` when the scope has zero graded rows — never a zero presented
 *    as an average.
 *  - `progressRowCount` is a bare count over the skeleton `progress`
 *    table — never a derived percentage.
 *  - A student with zero sessions or zero homework rows still appears in
 *    the directory with null academic fields — absence of data never
 *    omits the student.
 *  - The statistics row is a single aggregate statement and always yields
 *    exactly one row (zeros / nulls on an empty platform).
 *
 * File layout (size-budget split, zero behavior change):
 *  - `./academic-tracking-query-helpers` — the LATERAL lane builders
 *    (latest-position lanes per track, the two-track grade-summary lane,
 *    the progress-count lane, the three attention-signal lanes), the
 *    repository-side recent graded Jadid window constant, the
 *    fail-closed surah/juz vocabulary guard, and the raw-row mapper. The
 *    public methods below compose those lanes; signatures and behavior
 *    are unchanged and every method still issues exactly one statement.
 */
import { and, desc, eq, ilike, lte, or, type SQL, sql } from "drizzle-orm";
import {
  buildAttentionAnchorLane,
  buildCompletedSessionLane,
  buildGradedJadidWindowLane,
  buildJadidPositionLane,
  buildLaneGradeSummary,
  buildMadiPositionLane,
  buildProgressLane,
  mapAcademicStudentRow,
} from "@/backend/db/repo/admin/academic-tracking-query-helpers";
import { homeWork } from "@/backend/db/schema/classes/home-work";
import { session } from "@/backend/db/schema/classes/session";
import { users } from "@/backend/db/schema/users/users";
import { UserRole } from "@/backend/enum/users/user-role.enum";
import type {
  AdminAcademicAttentionSignalSelectType,
  AdminAcademicDashboardFiltersSelectType,
  AdminAcademicStatsSelectType,
  AdminAcademicStudentEchoSelectType,
  AdminAcademicStudentRowSelectType,
  DBTransaction,
} from "@/backend/types";

/**
 * Builds the ANDed WHERE predicate shared by the dashboard listing and its
 * count companion (one extract so the page window and the honest total can
 * never drift), and by the statistics block (empty filters — statistics
 * are platform-wide and ignore the search filter).
 *
 * Base seal (always applied): the student role lane AND not soft-deleted.
 * The `searchPattern`, when present, is bound verbatim to two `ilike`
 * predicates — one over the full name, one over the email — joined by OR
 * (a single search term matches either column). It arrives already escaped
 * AND `%…%`-wrapped from the service layer; an absent/null/empty pattern
 * drops out (the unfiltered listing, never an error).
 */
function buildDashboardPredicate(filters: AdminAcademicDashboardFiltersSelectType): SQL {
  const conditions: SQL[] = [eq(users.role, UserRole.Student), eq(users.isDeleted, false)];
  if (filters.searchPattern) {
    conditions.push(
      or(ilike(users.fullName, filters.searchPattern), ilike(users.email, filters.searchPattern)) ?? sql`false`
    );
  }
  return and(...conditions) ?? sql`true`;
}

export namespace AdminAcademicTrackingRepository {
  /**
   * Lists one paged window of the all-students academic directory: one row
   * per non-deleted student (ordered newest-account-first, `created_at
   * DESC, id DESC` — deterministic across pages), each carrying the
   * student's latest per-track position triples, per-track graded counts
   * and averages, the honest progress row count, and the newest
   * graded-activity stamp.
   *
   * The page slice is computed FIRST (filter + order + limit/offset over
   * the sealed student lane) and the per-student lanes are LEFT JOIN
   * LATERAL subqueries against that slice — the lateral lookups run only
   * for the page's rows, never for the whole student body, and each lane
   * yields at most one row per student (position picks are LIMIT 1; the
   * aggregate lanes are single-row conditional aggregations over that
   * student's own homework rows joined through their sessions).
   *
   * An offset past the end yields an empty array next to the companion
   * count's honest total (never an error, never clamped results).
   *
   * @param filters Service-normalized filters (the search pattern is
   *                pre-escaped and pre-wrapped — bound verbatim).
   * @param now     The snapshot instant the academic lanes close at.
   * @param limit   Page size (bounds are the service layer's duty).
   * @param offset  Page offset (0-based).
   * @param tx      The caller's transaction (REQUIRED, last).
   */
  export async function listStudentAcademicRows(
    filters: AdminAcademicDashboardFiltersSelectType,
    now: Date,
    limit: number,
    offset: number,
    tx: DBTransaction
  ): Promise<AdminAcademicStudentRowSelectType[]> {
    const pageSlice = tx
      .select({
        id: users.id,
        fullName: users.fullName,
        email: users.email,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(buildDashboardPredicate(filters))
      .orderBy(desc(users.createdAt), desc(users.id))
      .limit(limit)
      .offset(offset)
      .as("academic_page_slice");

    const jadidPositionLane = buildJadidPositionLane(tx, pageSlice.id, now);
    const madiPositionLane = buildMadiPositionLane(tx, pageSlice.id, now);
    const laneGradeSummary = buildLaneGradeSummary(tx, pageSlice.id, now);
    const progressLane = buildProgressLane(tx, pageSlice.id, now);

    const rows = await tx
      .select({
        id: pageSlice.id,
        fullName: pageSlice.fullName,
        email: pageSlice.email,
        jadidSurahJuz: jadidPositionLane.surahJuz,
        jadidFromAyah: jadidPositionLane.fromAyah,
        jadidToAyah: jadidPositionLane.toAyah,
        madiSurahJuz: madiPositionLane.surahJuz,
        madiFromAyah: madiPositionLane.fromAyah,
        madiToAyah: madiPositionLane.toAyah,
        jadidGradedCount: laneGradeSummary.jadidGradedCount,
        jadidAverageGrade: laneGradeSummary.jadidAverageGrade,
        madiGradedCount: laneGradeSummary.madiGradedCount,
        madiAverageGrade: laneGradeSummary.madiAverageGrade,
        progressRowCount: progressLane.rowCount,
        lastGradedHomeworkAt: laneGradeSummary.lastGradedHomeworkAt,
      })
      .from(pageSlice)
      .leftJoinLateral(jadidPositionLane, sql`true`)
      .leftJoinLateral(madiPositionLane, sql`true`)
      .leftJoinLateral(laneGradeSummary, sql`true`)
      .leftJoinLateral(progressLane, sql`true`)
      .orderBy(desc(pageSlice.createdAt), desc(pageSlice.id));

    return rows.map(mapAcademicStudentRow);
  }

  /**
   * Counts the dashboard's student lane under the SAME predicate set as
   * `listStudentAcademicRows` (one shared extract — the honest total and
   * the page window can never drift). An out-of-range page reads this
   * count unchanged next to empty page items.
   *
   * @param filters Service-normalized filters (bound verbatim — see the
   *                shared predicate extract).
   * @param tx      The caller's transaction (REQUIRED, last).
   */
  export async function countStudentAcademicRows(
    filters: AdminAcademicDashboardFiltersSelectType,
    tx: DBTransaction
  ): Promise<number> {
    const rows = await tx
      .select({ total: sql<number>`count(*)::int`.mapWith(Number).as("total") })
      .from(users)
      .where(buildDashboardPredicate(filters));
    return rows[0]?.total ?? 0;
  }

  /**
   * Resolves the aggregate advancement statistics in ONE conditional
   * aggregation over the homework ⨝ session ⨝ users join (always exactly
   * one row — zeros and null averages on an empty platform). The student
   * lane is the same hard seal as the directory (student role, not
   * soft-deleted); the search filter does NOT apply — statistics are
   * platform-wide at the snapshot instant.
   *
   * `trackedStudentCount` counts every non-deleted student (LEFT JOIN
   * keeps students with zero sessions); `studentsWithGradedHomeworkCount`
   * counts those with at least one graded homework row on either track;
   * the track averages run over graded rows only (`null` when none exist).
   * Rows stamped after the captured `now` count in none of the members.
   * The needing-attention counter is deliberately absent — the service
   * composes it from `listAttentionSignals` so the flag has one source of
   * truth.
   *
   * @param now The snapshot instant the statistics close at.
   * @param tx  The caller's transaction (REQUIRED, last).
   */
  export async function getAcademicStats(now: Date, tx: DBTransaction): Promise<AdminAcademicStatsSelectType> {
    const rows = await tx
      .select({
        trackedStudentCount: sql<number>`count(distinct ${users.id})::int`.mapWith(Number).as("tracked_student_count"),
        studentsWithGradedHomeworkCount:
          sql<number>`count(distinct ${users.id}) filter (where ${homeWork.currentGrade} is not null or ${homeWork.revisionGrade} is not null)::int`
            .mapWith(Number)
            .as("students_with_graded_homework_count"),
        averageJadidGrade: sql<number | null>`round(avg(${homeWork.currentGrade})::numeric, 2)::float8`.as(
          "average_jadid_grade"
        ),
        averageMadiGrade: sql<number | null>`round(avg(${homeWork.revisionGrade})::numeric, 2)::float8`.as(
          "average_madi_grade"
        ),
      })
      .from(users)
      .leftJoin(session, eq(session.studentId, users.id))
      .leftJoin(homeWork, and(eq(homeWork.sessionId, session.id), lte(homeWork.createdAt, now)))
      .where(buildDashboardPredicate({}));
    const row = rows[0];
    return {
      trackedStudentCount: row?.trackedStudentCount ?? 0,
      studentsWithGradedHomeworkCount: row?.studentsWithGradedHomeworkCount ?? 0,
      averageJadidGrade: row?.averageJadidGrade ?? null,
      averageMadiGrade: row?.averageMadiGrade ?? null,
    };
  }

  /**
   * Resolves the per-student attention-rule inputs for the WHOLE sealed
   * student lane (one row per non-deleted student, stable
   * newest-account-first ordering): the newest-first window of the
   * student's graded Jadid grades (bounded by the repository-side window
   * constant — never by caller arguments), the two staleness anchors (the
   * newest graded row's grade-write stamp and the newest assignment's
   * creation stamp), and the honest completed-session count (attention
   * eligibility requires at least one).
   *
   * Each lane is a LEFT JOIN LATERAL single-row aggregate over that
   * student's own rows — no fan-out, no per-row subquery loop. A student
   * with no graded rows carries an EMPTY grade window (absence of grades
   * is not failure — flagging is the service's threshold call); rows
   * stamped after the captured `now` count in none of the lanes.
   *
   * @param now The snapshot instant the signal lanes close at.
   * @param tx  The caller's transaction (REQUIRED, last).
   */
  export async function listAttentionSignals(
    now: Date,
    tx: DBTransaction
  ): Promise<AdminAcademicAttentionSignalSelectType[]> {
    const jadidGradeWindowLane = buildGradedJadidWindowLane(tx, users.id, now);
    const attentionAnchorLane = buildAttentionAnchorLane(tx, users.id, now);
    const completedSessionLane = buildCompletedSessionLane(tx, users.id, now);

    const rows = await tx
      .select({
        studentId: users.id,
        recentGradedJadidGrades: jadidGradeWindowLane.grades,
        lastGradedHomeworkAt: attentionAnchorLane.lastGradedHomeworkAt,
        lastHomeworkAssignedAt: attentionAnchorLane.lastHomeworkAssignedAt,
        completedSessionCount: completedSessionLane.completedSessionCount,
      })
      .from(users)
      .leftJoinLateral(jadidGradeWindowLane, sql`true`)
      .leftJoinLateral(attentionAnchorLane, sql`true`)
      .leftJoinLateral(completedSessionLane, sql`true`)
      .where(buildDashboardPredicate({}))
      .orderBy(desc(users.createdAt), desc(users.id));

    return rows.map(row => ({
      studentId: row.studentId,
      recentGradedJadidGrades: row.recentGradedJadidGrades ?? [],
      lastGradedHomeworkAt: row.lastGradedHomeworkAt,
      lastHomeworkAssignedAt: row.lastHomeworkAssignedAt,
      completedSessionCount: row.completedSessionCount ?? 0,
    }));
  }

  /**
   * Resolves the drill-down student echo for one student id: the identity
   * slice (id, full name, email, soft-delete marker) the detail header
   * renders. Soft-deleted students are RETURNED here (the academic history
   * survives soft delete and the header banners it); a NULL deletion
   * marker reads as not deleted (only an explicit `true` banners). Only
   * student-lane accounts resolve — any other id (nonexistent, or a
   * non-student account) returns `null` for the service to classify as a
   * not-found miss.
   *
   * @param studentId The student id to resolve (validated by the service).
   * @param tx        The caller's transaction (REQUIRED, last).
   */
  export async function getStudentEchoById(
    studentId: number,
    tx: DBTransaction
  ): Promise<AdminAcademicStudentEchoSelectType | null> {
    const rows = await tx
      .select({
        id: users.id,
        fullName: users.fullName,
        email: users.email,
        isDeleted: users.isDeleted,
      })
      .from(users)
      .where(and(eq(users.id, studentId), eq(users.role, UserRole.Student)))
      .limit(1);
    const row = rows[0];
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      fullName: row.fullName,
      email: row.email,
      isDeleted: row.isDeleted ?? false,
    };
  }
}
