/**
 * Admin academic tracking mappers — the projection seam between the
 * repository's select shapes and the surface's closed return shapes.
 *
 * Two seams meet here:
 *
 *  - Serialization: the select shapes carry native `Date` timestamps while
 *    the return shapes carry ISO-8601 strings (the wire DateTime scalar's
 *    string form) — the mapping converts exactly at this boundary and
 *    nowhere else.
 *  - Composition: the repository resolves each lane's newest qualifying
 *    homework row (newest GRADED row first, falling back to the newest
 *    row carrying a surah/juz reference — the parent portal's position
 *    discipline, re-derived inside the repository lanes). This module
 *    composes the closed position objects from the resolved triples: a
 *    position exists only when the lane carries a reference (`surahJuz`
 *    is non-null by construction on the emitted object), an ayah span
 *    stays nullable, and a reference-less lane maps to `null` — never to
 *    a fabricated position.
 *
 * Honesty rules carried through: an ungraded track has NO summary object
 * (the surrounding field stays `null`, never a fabricated zero grade or
 * zero count), `progressRowCount` passes through as the bare honest
 * count, and the attention flag is received pre-composed — attached
 * verbatim, never re-derived here.
 */

import type {
  AdminAcademicAttentionFlagReturnType,
  AdminAcademicGradeSummaryReturnType,
  AdminAcademicPositionReturnType,
  AdminAcademicStatsReturnType,
  AdminAcademicStatsSelectType,
  AdminAcademicStudentDetailEchoReturnType,
  AdminAcademicStudentEchoSelectType,
  AdminAcademicStudentRowReturnType,
  AdminAcademicStudentRowSelectType,
} from "@/backend/types";

/**
 * The page-envelope members shared by every paginated window on this
 * surface (dashboard rows, drill-down homework history, drill-down
 * report history): the echoed effective bounds next to the honest
 * `total`, with `pageCount` as the ceiling division of `total` over
 * `pageSize`.
 */
interface AcademicPageEnvelope<TItem> {
  readonly items: readonly TItem[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly pageCount: number;
}

/**
 * Composes one track's position object from the lane's resolved triple.
 * `null` when the lane carries no surah/juz reference (the curriculum has
 * not reached this track) — the position object never exists without its
 * curriculum locator. The ayah span stays nullable because a row may
 * record a reference without a numeric range.
 */
function composeAcademicPosition(
  surahJuz: AdminAcademicStudentRowSelectType["jadidSurahJuz"],
  fromAyah: AdminAcademicStudentRowSelectType["jadidFromAyah"],
  toAyah: AdminAcademicStudentRowSelectType["jadidToAyah"]
): AdminAcademicPositionReturnType | null {
  if (surahJuz === null) {
    return null;
  }
  return { surahJuz, fromAyah, toAyah };
}

/**
 * Composes one track's grade summary from the lane's graded-row count and
 * average. `null` when the track has zero graded rows — an ungraded track
 * renders as a localized "not graded yet" state, never a fabricated zero
 * count. A present summary carries a non-null average (the repository
 * guarantees the average is null exactly when the count is zero).
 */
function composeAcademicGradeSummary(
  gradedCount: number,
  averageGrade: number | null
): AdminAcademicGradeSummaryReturnType | null {
  if (gradedCount === 0) {
    return null;
  }
  return { gradedCount, averageGrade };
}

/**
 * Maps one dashboard directory row onto its closed return shape: identity
 * verbatim, per-lane position objects composed from the resolved triples
 * (null for reference-less lanes), per-lane grade summaries (null for
 * ungraded tracks), the honest progress count, the grade-activity stamp
 * serialized from native `Date` to its ISO-8601 string form (null stays
 * null — "never graded" is never an epoch), and the pre-composed
 * attention flag attached verbatim.
 *
 * @param row            The repository's resolved directory row.
 * @param needsAttention The student's attention flag from the flag
 *                       composer, or `null` when the student is not
 *                       flagged / carried no signal.
 */
export function mapAcademicStudentRow(
  row: AdminAcademicStudentRowSelectType,
  needsAttention: AdminAcademicAttentionFlagReturnType | null
): AdminAcademicStudentRowReturnType {
  return {
    id: row.id,
    fullName: row.fullName,
    email: row.email,
    latestJadidPosition: composeAcademicPosition(row.jadidSurahJuz, row.jadidFromAyah, row.jadidToAyah),
    latestMadiPosition: composeAcademicPosition(row.madiSurahJuz, row.madiFromAyah, row.madiToAyah),
    jadidGradeSummary: composeAcademicGradeSummary(row.jadidGradedCount, row.jadidAverageGrade),
    madiGradeSummary: composeAcademicGradeSummary(row.madiGradedCount, row.madiAverageGrade),
    progressRowCount: row.progressRowCount,
    lastGradedHomeworkAt: row.lastGradedHomeworkAt === null ? null : row.lastGradedHomeworkAt.toISOString(),
    needsAttention,
  };
}

/**
 * Maps the aggregate advancement-statistics row onto its return shape,
 * attaching the attention count composed at the service from the
 * per-student attention signals (the statistics row deliberately carries
 * only the honestly-aggregatable inputs). Track averages pass through
 * with their null-when-ungraded honesty intact.
 */
export function mapAcademicStats(
  stats: AdminAcademicStatsSelectType,
  needingAttentionCount: number
): AdminAcademicStatsReturnType {
  return {
    trackedStudentCount: stats.trackedStudentCount,
    studentsWithGradedHomeworkCount: stats.studentsWithGradedHomeworkCount,
    averageJadidGrade: stats.averageJadidGrade,
    averageMadiGrade: stats.averageMadiGrade,
    needingAttentionCount,
  };
}

/**
 * Maps the drill-down identity lookup row onto the student echo: a
 * field-by-field projection of id, display identity, and the soft-delete
 * marker (exposed ONLY on this echo — the governance banner input).
 */
export function mapAcademicStudentEcho(
  row: AdminAcademicStudentEchoSelectType
): AdminAcademicStudentDetailEchoReturnType {
  return {
    id: row.id,
    fullName: row.fullName,
    email: row.email,
    isDeleted: row.isDeleted,
  };
}

/**
 * Assembles a paginated page envelope from an already-mapped `items`
 * window and its honest `total`: the effective bounds are echoed and
 * `pageCount` is the ceiling division of `total` over `pageSize` (zero
 * when nothing matches). An out-of-range page is the caller's empty
 * `items` window next to the honest `total` — never clamped, never an
 * error. The items array passes through by reference.
 */
export function composeAcademicPageEnvelope<TItem>(
  items: readonly TItem[],
  total: number,
  page: number,
  pageSize: number
): AcademicPageEnvelope<TItem> {
  return {
    items,
    total,
    page,
    pageSize,
    pageCount: Math.ceil(total / pageSize),
  };
}
