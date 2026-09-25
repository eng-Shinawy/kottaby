/**
 * Admin academic-tracking GraphQL objects — the read projections behind the
 * admin academic monitoring surface: a paginated all-students dashboard
 * (latest memorization/revision positions, per-track grade summaries,
 * aggregate advancement statistics, per-row attention flags) plus a
 * per-student drill-down (full homework history, session-report history,
 * honest progress signal, governance-aware student echo).
 *
 * Every object is backed by a canonical type from
 * `backend/types/admin/admin-academic-tracking.types.ts`:
 *  - `AdminAcademicDashboardPage` ← `AdminAcademicDashboardPageReturnType`
 *  - `AdminAcademicStudentRow` ← `AdminAcademicStudentRowReturnType`
 *  - `AdminAcademicStats` ← `AdminAcademicStatsReturnType`
 *  - `AdminAcademicPosition` ← `AdminAcademicPositionReturnType`
 *  - `AdminAcademicGradeSummary` ← `AdminAcademicGradeSummaryReturnType`
 *  - `AdminAcademicAttentionFlag` ← `AdminAcademicAttentionFlagReturnType`
 *  - `AdminStudentAcademicDetail` ← `AdminStudentAcademicDetailReturnType`
 *  - `AdminAcademicStudentDetailEcho` ← `AdminAcademicStudentDetailEchoReturnType`
 *  - `AdminAcademicHomeworkPage` ← `AdminAcademicHomeworkPageReturnType`
 *  - `AdminAcademicHomeworkEntry` ← `AdminAcademicHomeworkEntryReturnType`
 *  - `AdminAcademicHomeworkTrack` ← `AdminAcademicHomeworkTrackReturnType`
 *  - `AdminAcademicReportPage` ← `AdminAcademicReportPageReturnType`
 *  - `AdminAcademicReportEntry` ← `AdminAcademicReportEntryReturnType`
 *
 * Per `backend/graphql/pothos/AGENTS.md`:
 *  - NO local type definitions — every shape comes from the canonical types
 *    module; the `AdminAcademicTrackingService` is the only producer, so no
 *    field can disclose more than the service computed (closed projections:
 *    no billing, dispute, or session-confirmation state crosses here).
 *  - `id` is the FIRST exposed field on every entity-shaped object
 *    (`t.exposeID` → `ID!`) — Apollo normalization requires a stable entity
 *    key. Page envelopes and the value objects (position, grade summary,
 *    attention flag, homework track) carry no row id and expose their
 *    structural fields directly.
 *  - Enum fields reference the ONCE-registered `SurahJuzRefPothosEnum` from
 *    `shared/enum.pothos.ts` (never re-registered) and the attention-reason
 *    enum registered below; both are pure structural passthroughs of the
 *    canonical enum/union members the service emits — no per-field mapping,
 *    no casts, no inline business logic.
 *  - Timestamps ride the registered `DateTime` scalar (ISO-8601 UTC; the
 *    scalar accepts pre-serialized ISO strings, which is exactly the string
 *    form the service emits at its projection seam). Nullable string stamps
 *    surface as nullable `DateTime`; non-null stamps as `DateTime!`.
 *  - Nullability is EXACT: every nullable TS field is a nullable GraphQL
 *    field, every non-null TS field non-null. Ungraded tracks, missing
 *    positions, absent notes/ratings, and unflagged students stay `null` on
 *    the wire — never a fabricated 0 or empty substitute.
 *  - NO resolve-time data access anywhere: every field is a pure structural
 *    projection of the one service-composed payload (zero N+1, zero
 *    per-field service calls). `isDeleted` is exposed ONLY on the drill-down
 *    student echo (the governance banner input) — never on dashboard rows.
 *
 * Consumed by the admin-only academic-tracking root query fields registered
 * by the query module that imports this file — only the two root payload
 * objects are exported; the child value objects stay module-local (the
 * platform-analytics registration precedent).
 */
import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import { SurahJuzRefPothosEnum } from "@/backend/graphql/pothos/shared/enum.pothos";
import { implementHomeworkTrackObject } from "@/backend/graphql/pothos/shared/homework-track.pothos";
import type {
  AdminAcademicAttentionFlagReturnType,
  AdminAcademicAttentionReason,
  AdminAcademicDashboardPageReturnType,
  AdminAcademicGradeSummaryReturnType,
  AdminAcademicHomeworkEntryReturnType,
  AdminAcademicHomeworkPageReturnType,
  AdminAcademicHomeworkTrackReturnType,
  AdminAcademicPositionReturnType,
  AdminAcademicReportEntryReturnType,
  AdminAcademicReportPageReturnType,
  AdminAcademicStatsReturnType,
  AdminAcademicStudentDetailEchoReturnType,
  AdminAcademicStudentRowReturnType,
  AdminStudentAcademicDetailReturnType,
} from "@/backend/types/admin/admin-academic-tracking.types";

/**
 * GraphQL `AdminAcademicAttentionReason` enum (`lowGrade` | `staleProgress`)
 * — why a student is flagged as needing academic attention. Both reasons may
 * co-occur on one student.
 *
 * The canonical vocabulary is the typed string union
 * `AdminAcademicAttentionReason` in the canonical types module (there is no
 * `backend/enum/` backing enum and no pgEnum column behind it — the flag is
 * a transient per-request derivation, never persisted), so the GraphQL enum
 * is registered ONCE here directly from that union: the map keys are the
 * GraphQL value names on the wire and each `value` binds the key to the
 * identical union member (the `satisfies` clause pins the registration to
 * the canonical union — a member added or renamed in the types module fails
 * this compile until the wire enum follows). `SurahJuzRef` remains the
 * existing shared registration from `shared/enum.pothos.ts`.
 */
const AdminAcademicAttentionReasonPothosEnum = gqlSchemaBuilder.enumType("AdminAcademicAttentionReason", {
  description: "Why a student is flagged as needing academic attention (reasons may co-occur).",
  values: {
    lowGrade: { value: "lowGrade" },
    staleProgress: { value: "staleProgress" },
  } satisfies Record<AdminAcademicAttentionReason, { value: AdminAcademicAttentionReason }>,
});

/**
 * `AdminAcademicPosition` — one curriculum position (surah/juz reference
 * plus ayah span) for a single track. `surahJuz` is non-null by
 * construction: a position is only emitted when the student's newest
 * qualifying homework row carries a reference — the surrounding field is
 * nullable and stays `null` when the lane has no reference at all. The ayah
 * range stays nullable because a row may record a reference without a
 * numeric span. Value object — no row id.
 */
const AdminAcademicPositionPothosObject = gqlSchemaBuilder
  .objectRef<AdminAcademicPositionReturnType>("AdminAcademicPosition")
  .implement({
    fields: t => ({
      // Surah/juz reference — non-null `SurahJuzRef!` by construction.
      surahJuz: t.expose("surahJuz", { type: SurahJuzRefPothosEnum }),
      // From-ayah — nullable `Int` (a reference may exist without a span).
      fromAyah: t.exposeInt("fromAyah", { nullable: true }),
      // To-ayah — nullable `Int` (same rule as `fromAyah`).
      toAyah: t.exposeInt("toAyah", { nullable: true }),
    }),
  });

/**
 * `AdminAcademicGradeSummary` — per-track grade summary over the student's
 * graded homework rows on the [0, 100] scale. `averageGrade` is `null`
 * exactly when `gradedCount` is 0 — an ungraded track renders as a
 * localized "not graded yet" state, never a fabricated zero. Value object —
 * no row id.
 */
const AdminAcademicGradeSummaryPothosObject = gqlSchemaBuilder
  .objectRef<AdminAcademicGradeSummaryReturnType>("AdminAcademicGradeSummary")
  .implement({
    fields: t => ({
      gradedCount: t.exposeInt("gradedCount"),
      averageGrade: t.exposeFloat("averageGrade", { nullable: true }),
    }),
  });

/**
 * `AdminAcademicAttentionFlag` — the attention flag carried by a dashboard
 * row or the drill-down payload: the reasons the student crossed. An empty
 * list means the student is not flagged — the surrounding field is nullable
 * and stays `null` in that case, so no flag object exists for an unflagged
 * student. Value object — no row id.
 */
const AdminAcademicAttentionFlagPothosObject = gqlSchemaBuilder
  .objectRef<AdminAcademicAttentionFlagReturnType>("AdminAcademicAttentionFlag")
  .implement({
    fields: t => ({
      reasons: t.field({
        type: [AdminAcademicAttentionReasonPothosEnum],
        resolve: parent => [...parent.reasons],
      }),
    }),
  });

/**
 * `AdminAcademicStats` — aggregate academic advancement statistics across
 * all tracked students at the captured snapshot instant. The track averages
 * are taken over graded rows only and are `null` when the platform has no
 * graded rows on that track (a zero presented as an average is forbidden);
 * `needingAttentionCount` is composed across the WHOLE attention lane, not
 * the page window. Value object — no row id.
 */
const AdminAcademicStatsPothosObject = gqlSchemaBuilder
  .objectRef<AdminAcademicStatsReturnType>("AdminAcademicStats")
  .implement({
    fields: t => ({
      trackedStudentCount: t.exposeInt("trackedStudentCount"),
      studentsWithGradedHomeworkCount: t.exposeInt("studentsWithGradedHomeworkCount"),
      averageJadidGrade: t.exposeFloat("averageJadidGrade", { nullable: true }),
      averageMadiGrade: t.exposeFloat("averageMadiGrade", { nullable: true }),
      needingAttentionCount: t.exposeInt("needingAttentionCount"),
    }),
  });

/**
 * `AdminAcademicStudentRow` — one all-students dashboard row. The latest
 * position per track is `null` when that lane has no reference at all, and
 * a grade summary is `null` when the lane has zero graded rows; a student
 * without academic rows still appears, with null academic fields.
 * `progressRowCount` is an honest count over the skeleton `progress` table
 * — never a percentage. `lastGradedHomeworkAt` is the student's most recent
 * graded-activity stamp, null when nothing was ever graded.
 */
const AdminAcademicStudentRowPothosObject = gqlSchemaBuilder
  .objectRef<AdminAcademicStudentRowReturnType>("AdminAcademicStudentRow")
  .implement({
    fields: t => ({
      // ID FIRST — Apollo cache normalization requires `id` on every
      // entity-shaped object (identity PK, surfaced as GraphQL `ID!`).
      id: t.exposeID("id"),
      fullName: t.exposeString("fullName"),
      email: t.exposeString("email"),
      // Latest Jadid (new-memorization) position — nullable; null when the
      // lane has no surah/juz reference at all.
      latestJadidPosition: t.field({
        type: AdminAcademicPositionPothosObject,
        nullable: true,
        resolve: parent => parent.latestJadidPosition,
      }),
      // Latest Madi (revision) position — same null rule as the Jadid lane.
      latestMadiPosition: t.field({
        type: AdminAcademicPositionPothosObject,
        nullable: true,
        resolve: parent => parent.latestMadiPosition,
      }),
      // Jadid grade summary — null exactly when the lane has zero graded
      // rows (an ungraded track is never a fabricated zero).
      jadidGradeSummary: t.field({
        type: AdminAcademicGradeSummaryPothosObject,
        nullable: true,
        resolve: parent => parent.jadidGradeSummary,
      }),
      // Madi grade summary — same null rule as the Jadid lane.
      madiGradeSummary: t.field({
        type: AdminAcademicGradeSummaryPothosObject,
        nullable: true,
        resolve: parent => parent.madiGradeSummary,
      }),
      // Honest progress row count — `Int!` over the skeleton `progress`
      // table, never a derived percentage.
      progressRowCount: t.exposeInt("progressRowCount"),
      // Most recent graded-activity stamp — nullable `DateTime` (null when
      // nothing was ever graded).
      lastGradedHomeworkAt: t.expose("lastGradedHomeworkAt", { type: "DateTime", nullable: true }),
      // Attention flag — nullable `AdminAcademicAttentionFlag`; `null` when
      // the student is unflagged (never an empty-flag object).
      needsAttention: t.field({
        type: AdminAcademicAttentionFlagPothosObject,
        nullable: true,
        resolve: parent => parent.needsAttention,
      }),
    }),
  });

/**
 * `AdminAcademicDashboardPage` — the dashboard page envelope: the paged
 * directory rows plus the aggregate statistics block computed over the SAME
 * snapshot (one captured instant — stats and rows can never straddle a
 * mid-flight teacher submission). Embedded wrapper — NO `id` field (the
 * normalizable entities are the rows inside `items`); `page`/`pageSize`
 * echo the effective bounds and `pageCount` is the ceiling division of
 * `total` over `pageSize`; an out-of-range page yields empty `items` next
 * to the honest `total` — never a fabricated window, never an error.
 */
export const AdminAcademicDashboardPagePothosObject = gqlSchemaBuilder
  .objectRef<AdminAcademicDashboardPageReturnType>("AdminAcademicDashboardPage")
  .implement({
    fields: t => ({
      items: t.field({
        type: [AdminAcademicStudentRowPothosObject],
        resolve: parent => parent.items,
      }),
      total: t.exposeInt("total"),
      page: t.exposeInt("page"),
      pageSize: t.exposeInt("pageSize"),
      pageCount: t.exposeInt("pageCount"),
      // Aggregate statistics block — non-null `AdminAcademicStats!` over the
      // same snapshot as the rows.
      stats: t.field({
        type: AdminAcademicStatsPothosObject,
        resolve: parent => parent.stats,
      }),
    }),
  });

/**
 * `AdminAcademicHomeworkTrack` — one homework track (Jadid or Madi)
 * projection for a history entry. Every field is nullable: a fully-null
 * block means "no assignment on this track" — rendered as a localized
 * "none assigned" state, never a fabricated zero grade. The grade is an
 * integer on the [0, 100] scale and stays null until the teacher records
 * it (write-once semantics: once set, a grade never silently changes).
 * Value object — no row id. Fields register through the shared
 * homework-track factory (the exact projection the parent-monitoring
 * surface exposes).
 */
const AdminAcademicHomeworkTrackPothosObject =
  implementHomeworkTrackObject<AdminAcademicHomeworkTrackReturnType>("AdminAcademicHomeworkTrack");

/**
 * `AdminAcademicHomeworkEntry` — one drill-down homework entry: a
 * `home_work` row joined through its owning session for date/teacher
 * context. The two tracks are projected independently and either is `null`
 * when the session carried no assignment on that track (single-track edge
 * case). `sessionStartedAt` is the human-facing session date and is `null`
 * when the session has not started (display falls back to `createdAt`);
 * `teacherName` is the owning teacher's display identity resolved through
 * the session.
 */
const AdminAcademicHomeworkEntryPothosObject = gqlSchemaBuilder
  .objectRef<AdminAcademicHomeworkEntryReturnType>("AdminAcademicHomeworkEntry")
  .implement({
    fields: t => ({
      // ID FIRST — Apollo cache normalization requires `id` on every
      // entity-shaped object (identity PK, surfaced as GraphQL `ID!`).
      id: t.exposeID("id"),
      // The owning session's id — `Int!` (deep-link anchor to the session
      // surface).
      sessionId: t.exposeInt("sessionId"),
      // Owning session's started-at stamp — nullable `DateTime` (null while
      // the session has not started).
      sessionStartedAt: t.expose("sessionStartedAt", { type: "DateTime", nullable: true }),
      // Owning teacher's display identity — `String!` (resolved through the
      // session by the service).
      teacherName: t.exposeString("teacherName"),
      // Jadid (new-memorization) track — nullable; null when the row has no
      // Jadid assignment; a non-null value preserves the track's per-field
      // nullability.
      jadid: t.field({
        type: AdminAcademicHomeworkTrackPothosObject,
        nullable: true,
        resolve: parent => parent.jadid,
      }),
      // Madi (revision) track — same null-collapse rule as `jadid`.
      madi: t.field({
        type: AdminAcademicHomeworkTrackPothosObject,
        nullable: true,
        resolve: parent => parent.madi,
      }),
      // Row creation timestamp — NOT NULL column, non-nullable `DateTime!`.
      createdAt: t.expose("createdAt", { type: "DateTime" }),
    }),
  });

/**
 * `AdminAcademicHomeworkPage` — paginated window over a student's homework
 * history. `page`/`pageSize` echo the effective bounds, `pageCount` is the
 * ceiling division of `total` over `pageSize`, and an out-of-range page
 * yields empty `items` next to the honest `total`. Embedded wrapper — NO
 * `id` field.
 */
const AdminAcademicHomeworkPagePothosObject = gqlSchemaBuilder
  .objectRef<AdminAcademicHomeworkPageReturnType>("AdminAcademicHomeworkPage")
  .implement({
    fields: t => ({
      items: t.field({
        type: [AdminAcademicHomeworkEntryPothosObject],
        resolve: parent => parent.items,
      }),
      total: t.exposeInt("total"),
      page: t.exposeInt("page"),
      pageSize: t.exposeInt("pageSize"),
      pageCount: t.exposeInt("pageCount"),
    }),
  });

/**
 * `AdminAcademicReportEntry` — one drill-down session-report entry: a
 * `reports` row joined through its owning session for date/teacher context.
 * `teacherNotes` and `studentRatingByTeacher` (the 0–5 per-session rating —
 * a DIFFERENT scale from the [0, 100] homework grades; the two never mix in
 * display or aggregation) are both nullable and are never coerced: absent
 * values render as localized "not submitted" / "not rated" states.
 */
const AdminAcademicReportEntryPothosObject = gqlSchemaBuilder
  .objectRef<AdminAcademicReportEntryReturnType>("AdminAcademicReportEntry")
  .implement({
    fields: t => ({
      // ID FIRST — Apollo cache normalization requires `id` on every
      // entity-shaped object (identity PK, surfaced as GraphQL `ID!`).
      id: t.exposeID("id"),
      // The owning session's id — `Int!` (deep-link anchor to the session
      // surface).
      sessionId: t.exposeInt("sessionId"),
      // Owning session's started-at stamp — nullable `DateTime` (null while
      // the session has not started).
      sessionStartedAt: t.expose("sessionStartedAt", { type: "DateTime", nullable: true }),
      // Owning teacher's display identity — `String!` (resolved through the
      // session by the service).
      teacherName: t.exposeString("teacherName"),
      // Teacher-authored notes — nullable `String`. NEVER coerced to the
      // empty string: null stays null on the wire.
      teacherNotes: t.exposeString("teacherNotes", { nullable: true }),
      // Teacher's student rating — nullable `Int` on the [0, 5] scale.
      // NEVER coerced to 0: null stays null on the wire.
      studentRatingByTeacher: t.exposeInt("studentRatingByTeacher", { nullable: true }),
      // Row creation timestamp — NOT NULL column, non-nullable `DateTime!`.
      createdAt: t.expose("createdAt", { type: "DateTime" }),
    }),
  });

/**
 * `AdminAcademicReportPage` — paginated window over a student's
 * session-report history. Mirrors the homework page envelope: echoed
 * effective bounds, ceiling-division `pageCount`, honest `total`, empty
 * `items` for an out-of-range page. Embedded wrapper — NO `id` field.
 */
const AdminAcademicReportPagePothosObject = gqlSchemaBuilder
  .objectRef<AdminAcademicReportPageReturnType>("AdminAcademicReportPage")
  .implement({
    fields: t => ({
      items: t.field({
        type: [AdminAcademicReportEntryPothosObject],
        resolve: parent => parent.items,
      }),
      total: t.exposeInt("total"),
      page: t.exposeInt("page"),
      pageSize: t.exposeInt("pageSize"),
      pageCount: t.exposeInt("pageCount"),
    }),
  });

/**
 * `AdminAcademicStudentDetailEcho` — the drill-down student echo: the
 * identity slice the detail header renders. `isDeleted` is exposed ONLY
 * here (never on dashboard rows): a soft-deleted student's academic history
 * remains viewable for audit and the UI renders a localized governance
 * banner from this marker — the deletion is bannered, never silent, and
 * never an error.
 */
const AdminAcademicStudentDetailEchoPothosObject = gqlSchemaBuilder
  .objectRef<AdminAcademicStudentDetailEchoReturnType>("AdminAcademicStudentDetailEcho")
  .implement({
    fields: t => ({
      // ID FIRST — Apollo cache normalization requires `id` on every
      // entity-shaped object (identity PK, surfaced as GraphQL `ID!`).
      id: t.exposeID("id"),
      fullName: t.exposeString("fullName"),
      email: t.exposeString("email"),
      // Soft-delete marker — `Boolean!`, surfaced ONLY on this echo object
      // (the governance banner input; dashboard rows never carry it).
      isDeleted: t.exposeBoolean("isDeleted"),
    }),
  });

/**
 * `AdminStudentAcademicDetail` — the per-student academic drill-down
 * payload: the student echo (header + governance banner input), the
 * paginated homework and session-report histories, the honest
 * `progressRowCount` over the skeleton `progress` table, and the student's
 * attention flag. All sub-reads share one snapshot so the header and both
 * pages are mutually consistent. A student with zero academic rows yields a
 * well-formed payload with empty pages — localized empty states per
 * section, never an error. Embedded wrapper — NO `id` field of its own
 * (the normalizable entity is the embedded student echo).
 */
export const AdminStudentAcademicDetailPothosObject = gqlSchemaBuilder
  .objectRef<AdminStudentAcademicDetailReturnType>("AdminStudentAcademicDetail")
  .implement({
    fields: t => ({
      // Student echo — non-null `AdminAcademicStudentDetailEcho!` (id first
      // on the embedded entity, so the detail header and the governance
      // banner share one normalized cache entry).
      student: t.field({
        type: AdminAcademicStudentDetailEchoPothosObject,
        resolve: parent => parent.student,
      }),
      // Homework history window — non-null `AdminAcademicHomeworkPage!`
      // (empty `items` when the student has no homework rows).
      homeworkPage: t.field({
        type: AdminAcademicHomeworkPagePothosObject,
        resolve: parent => parent.homeworkPage,
      }),
      // Session-report history window — non-null
      // `AdminAcademicReportPage!` (empty `items` when the student has no
      // report rows).
      reportPage: t.field({
        type: AdminAcademicReportPagePothosObject,
        resolve: parent => parent.reportPage,
      }),
      // Honest progress row count — `Int!` over the skeleton `progress`
      // table, never a derived percentage.
      progressRowCount: t.exposeInt("progressRowCount"),
      // Attention flag — nullable `AdminAcademicAttentionFlag`; `null` when
      // the student is unflagged (never an empty-flag object).
      needsAttention: t.field({
        type: AdminAcademicAttentionFlagPothosObject,
        nullable: true,
        resolve: parent => parent.needsAttention,
      }),
    }),
  });
