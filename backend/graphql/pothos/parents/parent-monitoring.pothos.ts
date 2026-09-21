/**
 * ParentMonitoringPothosObjects — the eleven GraphQL presentations backing
 * the parent portal read surfaces.
 *
 * Single Canonical Object Type Pattern (`backend/graphql/AGENTS.md`):
 *  - Backed EXCLUSIVELY by the canonical parent-monitoring return types from
 *    `@/backend/types/parents` — NO local type definitions here. The
 *    `ParentMonitoringService` is the only producer of those closed,
 *    readonly shapes, so no field on any object can disclose more than the
 *    service computed: every exposed column is parent-consumable by
 *    construction, and the billing/dispute/confirmation/internal-audit
 *    columns stay on the underlying tables and never cross this boundary
 *    (BOPLA: read-only, zero overlap with any mutation input or any
 *    participant surface).
 *  - `id` is the FIRST exposed field on every entity-shaped object and
 *    non-nullable (`t.exposeID` → `ID!`) — Apollo normalization requires a
 *    stable entity key at the first field. The three page wrapper objects
 *    and the value objects (`ParentHomeworkTrack`, `ParentHomeworkPosition`,
 *    `ParentChildProgress`, `ParentSessionTarget`) carry no row id and
 *    expose their structural fields directly.
 *  - Enum fields reference the ONCE-registered `SessionStatusPothosEnum`
 *    and `SurahJuzRefPothosEnum` from `shared/enum.pothos.ts`. Domain
 *    files MUST NOT re-register these enums — the parent-monitoring
 *    return types already carry the canonical TS enum members (not raw
 *    pgEnum strings), so each enum field is a pure structural
 *    `t.expose(..., { type })` passthrough — no per-field mapping helper,
 *    no `as` cast, no inline business logic.
 *  - Timestamps are the raw `Date` fields exposed through the registered
 *    `DateTime` scalar (ISO-8601 UTC serialization —
 *    `shared/scalar.pothos.ts`) — NO hand-rolled `toISOString()` String
 *    columns. Nullable `Date | null` columns surface as nullable `DateTime`
 *    GraphQL fields exactly; non-null `Date` columns surface as `DateTime!`.
 *  - Nullability is EXACT: every nullable TS field becomes a nullable
 *    GraphQL field, every non-null TS field becomes a non-null GraphQL
 *    field. Absent teacher notes, absent ratings, fully-null homework
 *    track blocks, and missing latest positions stay null on the wire —
 *    the UI renders each as a localized "not yet" state, never a
 *    fabricated 0/empty substitute.
 *  - NO inline business logic — every field is a pure structural
 *    passthrough. Liveness, pagination clamp, and projection mapping are
 *    decided by the service, never re-derived by clients.
 *
 * Consumed by the parent-only root query fields registered in
 * `backend/graphql/query/parents/parent-monitoring.query.ts`, whose
 * import transitively registers these types through the `gqlSchema.ts`
 * side-effect chain — matching the `parent-link-request.pothos.ts`
 * precedent.
 */
import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import { SessionStatusPothosEnum, SurahJuzRefPothosEnum } from "@/backend/graphql/pothos/shared/enum.pothos";
import type {
  ParentAttendanceEntryReturnType,
  ParentAttendancePageReturnType,
  ParentChildProgressReturnType,
  ParentChildUpcomingBlockReturnType,
  ParentChildUpcomingSessionReturnType,
  ParentHomeworkEntryReturnType,
  ParentHomeworkPageReturnType,
  ParentHomeworkPositionReturnType,
  ParentHomeworkTrackReturnType,
  ParentLinkedChildReturnType,
  ParentReportEntryReturnType,
  ParentReportPageReturnType,
  ParentSessionTargetReturnType,
} from "@/backend/types/parents";

/**
 * The canonical `ParentLinkedChild` GraphQL object — one confirmed-linked
 * child row for the portal list. Producers return
 * `ParentLinkedChildReturnType` (the gated student row joined to its user
 * row). `id` first; `createdAt` is the student row's creation timestamp.
 */
export const ParentLinkedChildPothosObject = gqlSchemaBuilder
  .objectRef<ParentLinkedChildReturnType>("ParentLinkedChild")
  .implement({
    fields: t => ({
      // ID FIRST — Apollo cache normalization requires `id` on every
      // entity-shaped object (identity PK, surfaced as GraphQL `ID!`).
      id: t.exposeID("id"),
      // The confirmed child's full name — unmasked. Name masking applies
      // only to discovery and link-request surfaces (before the link is
      // in force); a confirmed child's name is shown to its own parent.
      fullName: t.exposeString("fullName"),
      // Row creation timestamp — NOT NULL column, non-nullable `DateTime!`.
      createdAt: t.expose("createdAt", { type: "DateTime" }),
    }),
  });

/**
 * The canonical `ParentAttendanceEntry` GraphQL object — one attendance
 * entry derived from a `session` row. There is no dedicated attendance
 * table: attendance history is the child's session lifecycle viewed
 * through `status` plus the started/ended timestamps. `startedAt` and
 * `endedAt` are nullable (a scheduled-but-not-started session carries
 * null on both).
 */
export const ParentAttendanceEntryPothosObject = gqlSchemaBuilder
  .objectRef<ParentAttendanceEntryReturnType>("ParentAttendanceEntry")
  .implement({
    fields: t => ({
      // ID FIRST — Apollo cache normalization requires `id` on every
      // entity-shaped object (identity PK, surfaced as GraphQL `ID!`).
      id: t.exposeID("id"),
      // Lifecycle status — non-null `SessionStatus!` (the service narrows
      // the raw pgEnum string fail-closed onto the TS enum before this
      // row is produced; the GraphQL enum value is a pure passthrough).
      status: t.expose("status", { type: SessionStatusPothosEnum }),
      // Started-at stamp — nullable `DateTime` (NULL for scheduled rows
      // that have not started yet).
      startedAt: t.expose("startedAt", { type: "DateTime", nullable: true }),
      // Ended-at stamp — nullable `DateTime` (NULL for in-progress rows).
      endedAt: t.expose("endedAt", { type: "DateTime", nullable: true }),
      // Row creation timestamp — NOT NULL column, non-nullable `DateTime!`.
      createdAt: t.expose("createdAt", { type: "DateTime" }),
    }),
  });

/**
 * The canonical `ParentAttendancePage` GraphQL object — the paginated
 * list-wrapper for attendance entries. The service echoes `page` /
 * `pageSize` honestly; an out-of-range page yields empty `items` next to
 * the true `totalCount`, never a fabricated window.
 */
export const ParentAttendancePagePothosObject = gqlSchemaBuilder
  .objectRef<ParentAttendancePageReturnType>("ParentAttendancePage")
  .implement({
    fields: t => ({
      items: t.field({
        type: [ParentAttendanceEntryPothosObject],
        resolve: parent => parent.items,
      }),
      totalCount: t.exposeInt("totalCount"),
      page: t.exposeInt("page"),
      pageSize: t.exposeInt("pageSize"),
    }),
  });

/**
 * The canonical `ParentReportEntry` GraphQL object — one parent-facing
 * report row joined to its owning session for status/timestamp context.
 * The teacher's per-session evaluation of the child lives here:
 * `studentRatingByTeacher` (0–5) and `teacherNotes`. Both are nullable
 * and NEVER coerced — an absent rating renders as a localized "not rated
 * yet" state rather than a fabricated 0, and absent teacher notes render
 * as a localized "not submitted yet" state.
 */
export const ParentReportEntryPothosObject = gqlSchemaBuilder
  .objectRef<ParentReportEntryReturnType>("ParentReportEntry")
  .implement({
    fields: t => ({
      // ID FIRST — Apollo cache normalization requires `id` on every
      // entity-shaped object (identity PK, surfaced as GraphQL `ID!`).
      id: t.exposeID("id"),
      // The owning session's id — `Int!` (deep-link anchor to the
      // participant session surface, where the parent's view is
      // indistinguishable from any other non-participant viewer).
      sessionId: t.exposeInt("sessionId"),
      // The owning session's status — non-null `SessionStatus!` (same
      // fail-closed narrowing discipline as the attendance entry).
      sessionStatus: t.expose("sessionStatus", { type: SessionStatusPothosEnum }),
      // The owning session's started-at stamp — nullable `DateTime`.
      sessionStartedAt: t.expose("sessionStartedAt", { type: "DateTime", nullable: true }),
      // Teacher-authored notes — nullable `String`. NEVER coerced to the
      // empty string: null stays null on the wire (the UI renders the
      // localized "not submitted yet" state).
      teacherNotes: t.exposeString("teacherNotes", { nullable: true }),
      // Teacher's student rating — nullable `Int` on the [0, 5] scale.
      // NEVER coerced to 0: null stays null on the wire (the UI renders
      // the localized "not rated yet" state).
      studentRatingByTeacher: t.exposeInt("studentRatingByTeacher", { nullable: true }),
      // Row creation timestamp — NOT NULL column, non-nullable `DateTime!`.
      createdAt: t.expose("createdAt", { type: "DateTime" }),
    }),
  });

/**
 * The canonical `ParentReportPage` GraphQL object — the paginated
 * list-wrapper for report entries. Mirrors the attendance page shape:
 * honest total + page window.
 */
export const ParentReportPagePothosObject = gqlSchemaBuilder
  .objectRef<ParentReportPageReturnType>("ParentReportPage")
  .implement({
    fields: t => ({
      items: t.field({
        type: [ParentReportEntryPothosObject],
        resolve: parent => parent.items,
      }),
      totalCount: t.exposeInt("totalCount"),
      page: t.exposeInt("page"),
      pageSize: t.exposeInt("pageSize"),
    }),
  });

/**
 * The canonical `ParentHomeworkTrack` GraphQL object — one homework
 * track (Jadid or Madi) projection. Every field is nullable: a fully-null
 * block means "no assignment on this track" — never fabricated zeros. The
 * surah/juz reference is a member of the canonical `SurahJuzRef`
 * vocabulary; the grade lives on its [0, 100] scale and stays null until
 * the teacher records it.
 */
export const ParentHomeworkTrackPothosObject = gqlSchemaBuilder
  .objectRef<ParentHomeworkTrackReturnType>("ParentHomeworkTrack")
  .implement({
    fields: t => ({
      // Surah/juz reference — nullable `SurahJuzRef`. Null when the track
      // has no assignment recorded (the whole block is null in that case,
      // but per-field nullability is preserved when only some legs are
      // unset).
      surahJuz: t.expose("surahJuz", { type: SurahJuzRefPothosEnum, nullable: true }),
      // From-ayah — nullable `Int`. Null when the track records a surah/juz
      // reference without a numeric range.
      fromAyah: t.exposeInt("fromAyah", { nullable: true }),
      // To-ayah — nullable `Int` (same nullability rule as `fromAyah`).
      toAyah: t.exposeInt("toAyah", { nullable: true }),
      // Recorded grade — nullable `Int` on the [0, 100] scale. Stays null
      // until the teacher records it (NEVER fabricated to 0).
      grade: t.exposeInt("grade", { nullable: true }),
    }),
  });

/**
 * The canonical `ParentHomeworkEntry` GraphQL object — one homework row
 * joined to its owning session. The two tracks — Jadid (new memorization)
 * and Madi (revision) — are projected independently. Either block is null
 * when that track has no assignment on the row; a non-null block carries
 * its own per-field nullability for ungraded or partially-recorded
 * assignments.
 */
export const ParentHomeworkEntryPothosObject = gqlSchemaBuilder
  .objectRef<ParentHomeworkEntryReturnType>("ParentHomeworkEntry")
  .implement({
    fields: t => ({
      // ID FIRST — Apollo cache normalization requires `id` on every
      // entity-shaped object (identity PK, surfaced as GraphQL `ID!`).
      id: t.exposeID("id"),
      // The owning session's id — `Int!`.
      sessionId: t.exposeInt("sessionId"),
      // Jadid (new-memorization) track — nullable `ParentHomeworkTrack`.
      // Null when the row has no Jadid assignment; a non-null value
      // preserves the track's per-field nullability.
      jadid: t.field({
        type: ParentHomeworkTrackPothosObject,
        nullable: true,
        resolve: parent => parent.jadid,
      }),
      // Madi (revision) track — nullable `ParentHomeworkTrack`. Same
      // null-collapse rule as `jadid`.
      madi: t.field({
        type: ParentHomeworkTrackPothosObject,
        nullable: true,
        resolve: parent => parent.madi,
      }),
      // Row creation timestamp — NOT NULL column, non-nullable `DateTime!`.
      createdAt: t.expose("createdAt", { type: "DateTime" }),
    }),
  });

/**
 * The canonical `ParentHomeworkPage` GraphQL object — the paginated
 * list-wrapper for homework entries. Mirrors the attendance/report page
 * shape: honest total + page window.
 */
export const ParentHomeworkPagePothosObject = gqlSchemaBuilder
  .objectRef<ParentHomeworkPageReturnType>("ParentHomeworkPage")
  .implement({
    fields: t => ({
      items: t.field({
        type: [ParentHomeworkEntryPothosObject],
        resolve: parent => parent.items,
      }),
      totalCount: t.exposeInt("totalCount"),
      page: t.exposeInt("page"),
      pageSize: t.exposeInt("pageSize"),
    }),
  });

/**
 * The canonical `ParentHomeworkPosition` GraphQL object — a Tajweed
 * curriculum position slot, derived from the newest homework row for a
 * single track. `surahJuz` is non-null here by construction: a position
 * is only emitted when a homework row carries one. The ayah range stays
 * nullable because a track may record a surah/juz reference without a
 * numeric range.
 */
export const ParentHomeworkPositionPothosObject = gqlSchemaBuilder
  .objectRef<ParentHomeworkPositionReturnType>("ParentHomeworkPosition")
  .implement({
    fields: t => ({
      // Surah/juz reference — non-null `SurahJuzRef!` by construction (the
      // service emits a position only when the latest homework row carries
      // one on this track).
      surahJuz: t.expose("surahJuz", { type: SurahJuzRefPothosEnum }),
      // From-ayah — nullable `Int` (a track may record a surah/juz
      // reference without a numeric range).
      fromAyah: t.exposeInt("fromAyah", { nullable: true }),
      // To-ayah — nullable `Int` (same nullability rule as `fromAyah`).
      toAyah: t.exposeInt("toAyah", { nullable: true }),
    }),
  });

/**
 * The canonical `ParentChildProgress` GraphQL object — the composite
 * progress summary for a child. Combines the gated child echo (so the
 * detail header and the progress tab are served by one payload — fewer
 * authorization seams) with an honest progress row count and the latest
 * homework position per track. The row count is an honest signal over
 * the `progress` table: `0` means "no recorded progress yet" and renders
 * as a localized empty state, never a fabricated percentage. The latest
 * position per track is null when the child has no homework row carrying
 * a surah/juz reference on that track.
 */
export const ParentChildProgressPothosObject = gqlSchemaBuilder
  .objectRef<ParentChildProgressReturnType>("ParentChildProgress")
  .implement({
    fields: t => ({
      // Gated child echo — non-null `ParentLinkedChild!` (the gate's
      // verified student row joined to its user row for the full name).
      child: t.field({
        type: ParentLinkedChildPothosObject,
        resolve: parent => parent.child,
      }),
      // Honest progress row count — non-null `Int!`. Zero means "no
      // recorded progress yet" (NEVER a fabricated percentage).
      progressRowCount: t.exposeInt("progressRowCount"),
      // Latest Jadid position — nullable `ParentHomeworkPosition`. Null
      // when the child has no homework row carrying a current surah/juz
      // reference.
      latestJadidPosition: t.field({
        type: ParentHomeworkPositionPothosObject,
        nullable: true,
        resolve: parent => parent.latestJadidPosition,
      }),
      // Latest Madi position — nullable `ParentHomeworkPosition`. Null
      // when the child has no homework row carrying a revision surah/juz
      // reference.
      latestMadiPosition: t.field({
        type: ParentHomeworkPositionPothosObject,
        nullable: true,
        resolve: parent => parent.latestMadiPosition,
      }),
    }),
  });

/**
 * The canonical `ParentSessionTarget` GraphQL object — the closed
 * two-field resolution of a completion notification's session pointer:
 * the session id plus the linked child who owns it. A value object with
 * no row id — the portal root builds the deep-link landing URL from the
 * pair alone, and nothing else about the session crosses the boundary.
 */
export const ParentSessionTargetPothosObject = gqlSchemaBuilder
  .objectRef<ParentSessionTargetReturnType>("ParentSessionTarget")
  .implement({
    fields: t => ({
      // The resolved session id — `Int!` (the pointer value the parent
      // followed from the completion notification row).
      sessionId: t.exposeInt("sessionId"),
      // The linked child who owns the session — `Int!` (the landing
      // route's student segment).
      studentId: t.exposeInt("studentId"),
    }),
  });

/**
 * The canonical `ParentChildUpcomingSession` GraphQL object — one
 * upcoming-session glance row for a linked child (the parent dashboard's
 * "What's next" card row). A value object keyed by the owning session id
 * with no `id` field of its own (the `ParentSessionTarget` precedent) —
 * registered with `keyFields: false` in `apolloCache.ts` and read back
 * embedded under its block. `fee` passes through verbatim (nullable —
 * the money discipline: no arithmetic, no re-formatting); `createdAt`
 * is the booking stamp the row renders. Only `scheduled` rows are ever
 * projected, so no status column crosses this boundary.
 */
export const ParentChildUpcomingSessionPothosObject = gqlSchemaBuilder
  .objectRef<ParentChildUpcomingSessionReturnType>("ParentChildUpcomingSession")
  .implement({
    fields: t => ({
      // The owning session's id — `Int!` (the glance row's stable key
      // for the list rendering).
      sessionId: t.exposeInt("sessionId"),
      // The platform-set session fee — nullable `String` (the decimal's
      // wire string form). NEVER coerced: a session booked without a fee
      // stays null (the UI renders the honest dash).
      fee: t.exposeString("fee", { nullable: true }),
      // Row creation (booking) timestamp — NOT NULL column, non-nullable
      // `DateTime!`.
      createdAt: t.expose("createdAt", { type: "DateTime" }),
    }),
  });

/**
 * The canonical `ParentChildUpcomingBlock` GraphQL object — one per-child
 * block of the parent dashboard's upcoming-sessions glance read: the
 * confirmed-linked child echo plus that child's glance window of
 * scheduled sessions and the honest scheduled total. A composite value
 * object with no row id (`keyFields: false` — the normalizable entity is
 * the embedded `ParentLinkedChild`), replaced wholesale on refetch.
 */
export const ParentChildUpcomingBlockPothosObject = gqlSchemaBuilder
  .objectRef<ParentChildUpcomingBlockReturnType>("ParentChildUpcomingBlock")
  .implement({
    fields: t => ({
      // The confirmed-linked child echo — non-null `ParentLinkedChild!`
      // (id first on the embedded entity, so the block group's hop target
      // and the children surface share one normalized cache entry).
      child: t.field({
        type: ParentLinkedChildPothosObject,
        resolve: parent => parent.child,
      }),
      // The child's glance window of scheduled sessions — the service
      // caps it; the card derives its tail from the count difference.
      upcomingSessions: t.field({
        type: [ParentChildUpcomingSessionPothosObject],
        resolve: parent => parent.upcomingSessions,
      }),
      // The child's TRUE scheduled-session count under the same filter
      // the window was read with — non-null `Int!` (the honest tail's
      // source; never a fabricated estimate).
      scheduledTotalCount: t.exposeInt("scheduledTotalCount"),
    }),
  });
