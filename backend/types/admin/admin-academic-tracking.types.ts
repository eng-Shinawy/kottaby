import type { SurahJuzRef } from "@/backend/enum/shared/surah-juz-ref.enum";

/**
 * Admin academic tracking — the closed read projections for the admin-only
 * academic monitoring surface: a paginated all-students dashboard (latest
 * memorization/revision positions, per-track grade summaries, aggregate
 * advancement statistics, per-row attention flags) plus a per-student
 * drill-down (full homework history, session-report history, honest
 * progress signal, governance-aware student echo).
 *
 * Every shape here is a read-time projection over existing committed rows —
 * the `home_work`, `reports`, `session`, `users`, `students`, and `progress`
 * tables as they stand. Nothing is persisted: positions, summaries,
 * statistics, and attention flags are recomputed per request inside one
 * read-only snapshot, and no new table or column backs any of them.
 *
 * Domain vocabulary: Jadid is the new-memorization track (stored in the
 * homework row's `current_*` columns), Madi is the revision track (the
 * `revision_*` columns). The API vocabulary names the tracks `jadid`/`madi`
 * while the storage columns keep `current_*`/`revision_*`; the surah/juz
 * references are members of the canonical `SurahJuzRef` vocabulary consumed
 * exactly as shipped.
 *
 * Honesty rules baked into these shapes: an ungraded track stays `null`
 * (never a fabricated 0), a student without academic rows still appears
 * with null academic fields, `progressRowCount` is a bare row count over
 * the skeleton `progress` table (never a derived percentage), and page
 * envelopes echo the effective pagination next to an honest `total`.
 *
 * Exposure discipline: these are CLOSED projections — only the academic
 * fields the surface demands cross the boundary. No billing, dispute, or
 * session-confirmation state is reachable through any shape here, and the
 * soft-delete marker (`isDeleted`) is exposed ONLY on the drill-down's
 * student echo (where the governance banner is rendered) — never on
 * dashboard rows.
 *
 * Timestamps on the service/API shapes surface as ISO-8601 strings (the
 * wire DateTime scalar's string form); the repo-layer select shapes keep
 * the native `Date` values the database returns and the service
 * serializes them at the projection seam.
 */

/**
 * Why a student is flagged as needing academic attention. Both reasons may
 * co-occur on one student. `lowGrade` marks a low recent average over the
 * student's graded new-memorization (Jadid) homework; `staleProgress` marks
 * a student with completed sessions whose graded homework has gone quiet
 * for longer than the attention window. The numeric thresholds behind both
 * reasons live as named constants in the service layer — never inline — and
 * a flag is a transient per-request derivation: nothing is persisted, and a
 * student with zero graded Jadid rows is never low-grade-flagged (absence
 * of grades is not failure).
 */
export type AdminAcademicAttentionReason = "lowGrade" | "staleProgress";

/**
 * One curriculum position (surah/juz reference plus ayah span) for a single
 * track. `surahJuz` is non-null by construction: a position object is only
 * emitted when the student's newest qualifying homework row carries a
 * surah/juz reference — the surrounding field is nullable and stays `null`
 * when the lane has no reference at all. The ayah range stays nullable
 * because a row may record a reference without a numeric span.
 */
export interface AdminAcademicPositionReturnType {
  readonly surahJuz: SurahJuzRef;
  readonly fromAyah: number | null;
  readonly toAyah: number | null;
}

/**
 * Per-track grade summary over the student's graded homework rows on the
 * [0, 100] homework-grade scale. `averageGrade` is `null` exactly when
 * `gradedCount` is 0 — an ungraded track renders as a localized "not graded
 * yet" state, never a fabricated zero. Averages are taken over graded
 * (non-null) rows only.
 */
export interface AdminAcademicGradeSummaryReturnType {
  readonly gradedCount: number;
  readonly averageGrade: number | null;
}

/**
 * The attention flag carried by a dashboard row or the drill-down payload:
 * the list of threshold reasons the student crossed. An empty list means
 * the student is not flagged — the surrounding field is nullable and stays
 * `null` in that case, so no flag object exists for an unflagged student.
 */
export interface AdminAcademicAttentionFlagReturnType {
  readonly reasons: readonly AdminAcademicAttentionReason[];
}

/**
 * One all-students dashboard row. `id` comes first for Apollo cache
 * normalization. The latest position per track derives from the student's
 * newest graded homework row on that lane (falling back to the newest row
 * carrying a reference when no graded row exists yet — an ungraded
 * assignment is the teacher's intent, not an achieved position) and is
 * `null` when the lane has no reference at all. A student with zero
 * sessions or zero homework rows still appears, with null academic fields.
 * `progressRowCount` is an honest count over the skeleton `progress` table
 * — never a percentage. `lastGradedHomeworkAt` is the ISO timestamp of the
 * student's most recent graded homework activity (the staleness anchor for
 * the attention rules), null when nothing was ever graded.
 */
export interface AdminAcademicStudentRowReturnType {
  readonly id: number;
  readonly fullName: string;
  readonly email: string;
  readonly latestJadidPosition: AdminAcademicPositionReturnType | null;
  readonly latestMadiPosition: AdminAcademicPositionReturnType | null;
  readonly jadidGradeSummary: AdminAcademicGradeSummaryReturnType | null;
  readonly madiGradeSummary: AdminAcademicGradeSummaryReturnType | null;
  readonly progressRowCount: number;
  readonly lastGradedHomeworkAt: string | null;
  readonly needsAttention: AdminAcademicAttentionFlagReturnType | null;
}

/**
 * Aggregate academic advancement statistics across all tracked students,
 * computed over committed homework rows at the snapshot instant.
 * `trackedStudentCount` counts the non-deleted student accounts the
 * dashboard lists; `studentsWithGradedHomeworkCount` counts those with at
 * least one graded homework row; the track averages are taken over graded
 * rows only and are `null` when the platform has no graded rows on that
 * track (a zero presented as an average is forbidden);
 * `needingAttentionCount` counts the students currently flagged.
 */
export interface AdminAcademicStatsReturnType {
  readonly trackedStudentCount: number;
  readonly studentsWithGradedHomeworkCount: number;
  readonly averageJadidGrade: number | null;
  readonly averageMadiGrade: number | null;
  readonly needingAttentionCount: number;
}

/**
 * The admin academic dashboard page envelope: the paged directory rows plus
 * the aggregate statistics block computed over the SAME snapshot (one
 * captured instant — stats and rows can never straddle a mid-flight
 * teacher submission). The envelope is a value object with no `id` of its
 * own; `page`/`pageSize` echo the effective bounds and `pageCount` is the
 * ceiling division of `total` over `pageSize`. An out-of-range page yields
 * an empty `items` array next to the honest `total` — never a fabricated
 * window and never an error.
 */
export interface AdminAcademicDashboardPageReturnType {
  readonly items: readonly AdminAcademicStudentRowReturnType[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly pageCount: number;
  readonly stats: AdminAcademicStatsReturnType;
}

/**
 * One homework track (Jadid or Madi) projection for a history entry. Every
 * field is nullable: a fully-null block means "no assignment on this
 * track" — rendered as a localized "none assigned" state, never a
 * fabricated zero grade. The grade is an integer on the [0, 100] scale and
 * stays null until the teacher records it (write-once semantics: once set,
 * a grade never silently changes). The surah/juz reference is a member of
 * the canonical `SurahJuzRef` vocabulary consumed as shipped.
 */
export interface AdminAcademicHomeworkTrackReturnType {
  readonly surahJuz: SurahJuzRef | null;
  readonly fromAyah: number | null;
  readonly toAyah: number | null;
  readonly grade: number | null;
}

/**
 * One drill-down homework entry: a `home_work` row joined through its
 * owning session for date/teacher context. The two tracks are projected
 * independently and either is `null` when the session carried no assignment
 * on that track (single-track edge case). `sessionStartedAt` is the
 * human-facing session date and is `null` when the session has not started
 * (display falls back to the row's `createdAt`); `teacherName` is the
 * owning teacher's display identity resolved through the session. The
 * reader applies a stable newest-first ordering (newest row first, row id
 * as the tie-break).
 */
export interface AdminAcademicHomeworkEntryReturnType {
  readonly id: number;
  readonly sessionId: number;
  readonly sessionStartedAt: string | null;
  readonly teacherName: string;
  readonly jadid: AdminAcademicHomeworkTrackReturnType | null;
  readonly madi: AdminAcademicHomeworkTrackReturnType | null;
  readonly createdAt: string;
}

/**
 * Paginated window over a student's homework history. `page`/`pageSize`
 * echo the effective bounds, `pageCount` is the ceiling division of
 * `total` over `pageSize`, and an out-of-range page yields empty `items`
 * next to the honest `total`. A value object with no `id` of its own.
 */
export interface AdminAcademicHomeworkPageReturnType {
  readonly items: readonly AdminAcademicHomeworkEntryReturnType[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly pageCount: number;
}

/**
 * One drill-down session-report entry: a `reports` row joined through its
 * owning session for date/teacher context. `teacherNotes` and
 * `studentRatingByTeacher` (the 0–5 per-session rating — a DIFFERENT scale
 * from the [0, 100] homework grades; the two never mix in display or
 * aggregation) are both nullable and are never coerced: absent values
 * render as localized "not submitted" / "not rated" states.
 */
export interface AdminAcademicReportEntryReturnType {
  readonly id: number;
  readonly sessionId: number;
  readonly sessionStartedAt: string | null;
  readonly teacherName: string;
  readonly teacherNotes: string | null;
  readonly studentRatingByTeacher: number | null;
  readonly createdAt: string;
}

/**
 * Paginated window over a student's session-report history. Mirrors the
 * homework page envelope: echoed effective bounds, ceiling-division
 * `pageCount`, honest `total`, empty `items` for an out-of-range page. A
 * value object with no `id` of its own.
 */
export interface AdminAcademicReportPageReturnType {
  readonly items: readonly AdminAcademicReportEntryReturnType[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly pageCount: number;
}

/**
 * The drill-down student echo: the identity slice the detail header
 * renders. `isDeleted` is exposed ONLY here (never on dashboard rows): a
 * soft-deleted student's academic history remains viewable for audit and
 * the UI renders a localized governance banner from this marker — the
 * deletion is bannered, never silent, and never an error.
 */
export interface AdminAcademicStudentDetailEchoReturnType {
  readonly id: number;
  readonly fullName: string;
  readonly email: string;
  readonly isDeleted: boolean;
}

/**
 * The per-student academic drill-down payload: the student echo (header +
 * governance banner input), the paginated homework and session-report
 * histories, the honest `progressRowCount` over the skeleton `progress`
 * table, and the student's attention flag. All sub-reads share one
 * snapshot so the header and both pages are mutually consistent. A student
 * with zero academic rows yields a well-formed payload with empty pages —
 * localized empty states per section, never an error.
 */
export interface AdminStudentAcademicDetailReturnType {
  readonly student: AdminAcademicStudentDetailEchoReturnType;
  readonly homeworkPage: AdminAcademicHomeworkPageReturnType;
  readonly reportPage: AdminAcademicReportPageReturnType;
  readonly progressRowCount: number;
  readonly needsAttention: AdminAcademicAttentionFlagReturnType | null;
}

/**
 * Repo-layer filter shape for the dashboard listing. The service
 * normalizes the transport-shape `AdminAcademicDashboardFiltersSubmitInput`
 * into this structure before any repository call: `searchPattern` is the
 * search substring AFTER LIKE wildcards have been escaped AND wrapped as
 * `%…%`, bound directly to the repo's case-insensitive name/email
 * predicates — the repo never re-escapes or re-wraps (one canonical escape
 * point at the service, one binding point at the repo). Absent or `null`
 * members drop out of the WHERE chain (the unfiltered listing, never an
 * error).
 */
export interface AdminAcademicDashboardFiltersSelectType {
  readonly searchPattern?: string | null;
}

/**
 * Raw DB projection returned by the cross-student directory listing,
 * BEFORE the service maps it to `AdminAcademicStudentRowReturnType`. One
 * flat row per student: the identity columns plus, per track, the newest
 * qualifying homework row's position triple (newest graded row first,
 * falling back to the newest row carrying a reference — the mapper composes
 * the nullable position objects from these), the graded-row count and
 * average over that track's graded rows (`null` average exactly when the
 * count is zero), the honest progress row count, and the newest
 * graded-activity stamp. Timestamps stay native `Date` values; the service
 * serializes at the projection seam.
 */
export interface AdminAcademicStudentRowSelectType {
  readonly id: number;
  readonly fullName: string;
  readonly email: string;
  readonly jadidSurahJuz: SurahJuzRef | null;
  readonly jadidFromAyah: number | null;
  readonly jadidToAyah: number | null;
  readonly madiSurahJuz: SurahJuzRef | null;
  readonly madiFromAyah: number | null;
  readonly madiToAyah: number | null;
  readonly jadidGradedCount: number;
  readonly jadidAverageGrade: number | null;
  readonly madiGradedCount: number;
  readonly madiAverageGrade: number | null;
  readonly progressRowCount: number;
  readonly lastGradedHomeworkAt: Date | null;
}

/**
 * Raw aggregate row for the advancement statistics block, assembled from
 * conditional aggregation over the homework/session/student join. The
 * attention count is NOT part of this row: it is composed at the service
 * from the per-student attention signals, so this shape carries only the
 * honestly-aggregatable inputs. Averages are `null` when no graded rows
 * exist (never a zero-average).
 */
export interface AdminAcademicStatsSelectType {
  readonly trackedStudentCount: number;
  readonly studentsWithGradedHomeworkCount: number;
  readonly averageJadidGrade: number | null;
  readonly averageMadiGrade: number | null;
}

/**
 * Per-student attention-rule inputs from which the service computes the
 * flag. The recent graded Jadid window is bounded by the service's named
 * attention constants (never by client arguments) and carries the graded
 * [0, 100] values newest-first; `lastGradedHomeworkAt` is the newest graded
 * row's grade-write stamp; `lastHomeworkAssignedAt` is the newest row's
 * creation stamp (the fallback anchor when nothing was ever graded);
 * `completedSessionCount` is the honest count of the student's completed
 * sessions (attention eligibility requires at least one). A student absent
 * from this list carries no signal — absence is not a flag.
 */
export interface AdminAcademicAttentionSignalSelectType {
  readonly studentId: number;
  readonly recentGradedJadidGrades: readonly number[];
  readonly lastGradedHomeworkAt: Date | null;
  readonly lastHomeworkAssignedAt: Date | null;
  readonly completedSessionCount: number;
}

/**
 * The drill-down identity lookup row for a single student id: id, display
 * identity, and the soft-delete marker. A soft-deleted student is still
 * returned here (the academic history survives soft delete and the detail
 * header banners it); the caller receives `null` only when the id does not
 * exist at all.
 */
export interface AdminAcademicStudentEchoSelectType {
  readonly id: number;
  readonly fullName: string;
  readonly email: string;
  readonly isDeleted: boolean;
}

/**
 * Client-controlled filter whitelist for the dashboard listing (transport
 * shape, pre-normalization). `search` is a free-text substring matched
 * case-insensitively over the student's full name and email; the service
 * escapes LIKE wildcards and wraps the pattern before it reaches the
 * repository. Absent or `null` drops the filter entirely. No other filter
 * exists: pagination bounds arrive as separate validated arguments, and no
 * filter may widen the read scope beyond the all-students directory.
 */
export interface AdminAcademicDashboardFiltersSubmitInput {
  readonly search?: string | null;
}
