import type { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import type { SurahJuzRef } from "@/backend/enum/shared/surah-juz-ref.enum";

/**
 * Shared pagination input accepted by every parent-scoped list query.
 *
 * Both members are optional and bounded by the service layer before
 * reaching any repository: `page` is normalized to a positive integer
 * and `pageSize` is clamped to a sane maximum. The effective values
 * used by the service are echoed honestly by the matching
 * `Parent*PageReturnType` shape — an out-of-range page yields an empty
 * `items` array next to the true `totalCount`, never a fabricated
 * window.
 */
export interface ParentPageInput {
  readonly page?: number;
  readonly pageSize?: number;
}

/**
 * One confirmed-linked child row for the portal list.
 *
 * The grant IS the student row — its `parentId` foreign key — and only
 * students whose account is not soft-deleted are surfaced. A confirmed
 * child's full name is shown to its own parent unmasked; name masking
 * applies only to discovery and link-request surfaces (before the link
 * is in force).
 */
export interface ParentLinkedChildReturnType {
  readonly id: number;
  readonly fullName: string;
  readonly createdAt: Date;
}

/**
 * One attendance entry derived from a `session` row.
 *
 * There is no dedicated attendance table — attendance history is the
 * child's session lifecycle viewed through `status` plus the
 * started/ended timestamps. The UI classifies each row from
 * `status`: `completed` renders as attended, `cancelled` as cancelled,
 * `disputed` is surfaced (not hidden), and `scheduled`/`started` as
 * upcoming/in-progress.
 */
export interface ParentAttendanceEntryReturnType {
  readonly id: number;
  readonly status: SessionStatus;
  readonly startedAt: Date | null;
  readonly endedAt: Date | null;
  readonly createdAt: Date;
}

/**
 * Paginated window over a child's attendance entries.
 *
 * `page` and `pageSize` echo the effective values used by the service
 * layer; an out-of-range page yields empty `items` next to the true
 * `totalCount` — never a fabricated window. Mirrors the
 * `SessionPageReturnType` shape convention used by the participant
 * session read.
 */
export interface ParentAttendancePageReturnType {
  readonly items: readonly ParentAttendanceEntryReturnType[];
  readonly totalCount: number;
  readonly page: number;
  readonly pageSize: number;
}

/**
 * One parent-facing report entry: a `reports` row joined to its owning
 * session for status/timestamp context.
 *
 * The teacher's per-session evaluation of the child lives here —
 * `studentRatingByTeacher` (0–5) and `teacherNotes` — not in the
 * sheikh→teacher-candidate `evaluations` table (which is unrelated to
 * child monitoring). Both rating and notes are nullable and are NEVER
 * coerced: an absent rating renders as a localized "not rated yet"
 * state rather than a fabricated 0, and absent teacher notes render as
 * a localized "not submitted yet" state.
 */
export interface ParentReportEntryReturnType {
  readonly id: number;
  readonly sessionId: number;
  readonly sessionStatus: SessionStatus;
  readonly sessionStartedAt: Date | null;
  readonly teacherNotes: string | null;
  readonly studentRatingByTeacher: number | null;
  readonly createdAt: Date;
}

/**
 * Paginated window over a child's session reports. Mirrors the
 * `ParentAttendancePageReturnType` shape convention: honest total +
 * page window.
 */
export interface ParentReportPageReturnType {
  readonly items: readonly ParentReportEntryReturnType[];
  readonly totalCount: number;
  readonly page: number;
  readonly pageSize: number;
}

/**
 * One homework track (Jadid or Madi) projection.
 *
 * Every field is nullable: a fully-null block means "no assignment on
 * this track" — never fabricated zeros. The grade lives on its
 * [0, 100] scale and stays null until the teacher records it. The
 * surah/juz reference is a member of the canonical `SurahJuzRef`
 * vocabulary.
 */
export interface ParentHomeworkTrackReturnType {
  readonly surahJuz: SurahJuzRef | null;
  readonly fromAyah: number | null;
  readonly toAyah: number | null;
  readonly grade: number | null;
}

/**
 * One homework entry: a `home_work` row joined to its owning session.
 *
 * The two tracks — Jadid (new memorization) and Madi (revision) — are
 * projected independently. Either block is null when that track has no
 * assignment on the row; a non-null block carries its own per-field
 * nullability for ungraded or partially-recorded assignments.
 */
export interface ParentHomeworkEntryReturnType {
  readonly id: number;
  readonly sessionId: number;
  readonly jadid: ParentHomeworkTrackReturnType | null;
  readonly madi: ParentHomeworkTrackReturnType | null;
  readonly createdAt: Date;
}

/**
 * Paginated window over a child's homework entries. Mirrors the
 * `ParentAttendancePageReturnType` shape convention: honest total +
 * page window.
 */
export interface ParentHomeworkPageReturnType {
  readonly items: readonly ParentHomeworkEntryReturnType[];
  readonly totalCount: number;
  readonly page: number;
  readonly pageSize: number;
}

/**
 * Tajweed curriculum position slot, derived from the newest homework
 * row for a single track.
 *
 * `surahJuz` is non-null here by construction — a position is only
 * emitted when a homework row carries one. The ayah range stays
 * nullable because a track may record a surah/juz reference without a
 * numeric range.
 */
export interface ParentHomeworkPositionReturnType {
  readonly surahJuz: SurahJuzRef;
  readonly fromAyah: number | null;
  readonly toAyah: number | null;
}

/**
 * Progress summary for a child.
 *
 * Combines the gated child echo (so the detail header and the progress
 * tab are served by one payload — fewer authorization seams) with an
 * honest progress row count and the latest homework position per
 * track. The row count is an honest signal over the `progress` table:
 * `0` means "no recorded progress yet" and renders as a localized
 * empty state, never a fabricated percentage. The latest position per
 * track is null when the child has no homework row carrying a
 * surah/juz reference on that track.
 */
export interface ParentChildProgressReturnType {
  readonly child: ParentLinkedChildReturnType;
  readonly progressRowCount: number;
  readonly latestJadidPosition: ParentHomeworkPositionReturnType | null;
  readonly latestMadiPosition: ParentHomeworkPositionReturnType | null;
}

/**
 * The closed two-field resolution of a completion notification's session
 * pointer: the session id the row carried plus the linked child who owns
 * it. A value object with no row id — the portal builds the deep-link
 * landing URL from the pair alone, and nothing else about the session is
 * disclosed through it.
 */
export interface ParentSessionTargetReturnType {
  readonly sessionId: number;
  readonly studentId: number;
}

/**
 * One upcoming-session glance row for a linked child — the slim
 * projection the parent dashboard's "What's next" card renders per row.
 *
 * A value object keyed by the owning session id (no row id of its own):
 * `fee` passes through verbatim (the platform-set decimal rendered as the
 * wire string — the money discipline: no arithmetic, no re-formatting at
 * any layer) and `createdAt` is the booking stamp the row renders. The
 * lifecycle state is fixed by the read itself (only `scheduled` rows are
 * projected), so no status column crosses this boundary.
 */
export interface ParentChildUpcomingSessionReturnType {
  readonly sessionId: number;
  readonly fee: string | null;
  readonly createdAt: Date;
}

/**
 * One per-child block of the parent dashboard's upcoming-sessions glance
 * read: the confirmed-linked child echo plus that child's glance window
 * of scheduled sessions and the HONEST total of their scheduled set.
 *
 * `upcomingSessions` is capped to the service's glance window (the first
 * rows of the child's scheduled set, newest-booked first) while
 * `scheduledTotalCount` is the true count over the same filter — the
 * card derives its "N more" tail from the difference, never from a
 * fabricated estimate. A child with zero scheduled sessions yields an
 * empty window next to the honest `0` total (never a dropped block).
 */
export interface ParentChildUpcomingBlockReturnType {
  readonly child: ParentLinkedChildReturnType;
  readonly upcomingSessions: readonly ParentChildUpcomingSessionReturnType[];
  readonly scheduledTotalCount: number;
}
