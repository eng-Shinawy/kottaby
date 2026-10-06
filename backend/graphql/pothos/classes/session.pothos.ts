/**
 * SessionPothosObject + SessionParticipantPothosObject +
 * SessionPagePothosObject — the canonical GraphQL object types for a
 * scheduling session, its enriched participant identity band, and the
 * pagination wrapper.
 *
 * Single Canonical Object Type Pattern (`backend/graphql/AGENTS.md`):
 *  - Backed EXCLUSIVELY by the canonical `SessionListItemType` (the
 *    `SessionReturnType` select row plus the OPTIONAL display-name
 *    enrichments the participant listers batch on) and
 *    `SessionPageReturnType` from `@/backend/types` — no local type
 *    definitions here. Every field is a structural map or passthrough;
 *    there is NO business logic in this module. The enrichment members are
 *    OPTIONAL on the canonical shape, so every existing producer returning
 *    plain `SessionReturnType` rows keeps compiling unchanged.
 *  - `Session` exposes `id` FIRST (Apollo cache normalization), then the
 *    participant ids `teacherId`/`studentId` — deliberately exposed per
 *    REQ-060 (both are already known to every authorized viewer of a row by
 *    construction; they exist for cache identity and self-rendering only).
 *  - `student`/`teacher` resolve the participant IDENTITY band
 *    (`SessionParticipant`: id + display name) and are NULLABLE BY
 *    CONTRACT: they are populated ONLY by the participant list reads
 *    (`myStudentSessions`/`myTeacherSessions`), which batch-enrich the page
 *    rows; all other Session producers leave the names unset and the fields
 *    resolve null — the nullability is honest, not lazy. Every authorized
 *    viewer of a row already knows both participant ids, and the lists are
 *    owner-scoped service reads, so the band discloses nothing new.
 *  - `heldBalanceLane` is DELIBERATELY ABSENT from the SDL: internal escrow
 *    provenance, never client-consumed (its presence would invite clients to
 *    trust a raceable value). It stays on `SessionReturnType` for the
 *    service layer and never reaches a field here.
 *  - `SessionPage` is the sanctioned list-wrapper exception (paginated
 *    result shape): `items` plus the honest `totalCount`/`page`/`pageSize`
 *    echo produced by the service.
 *
 * Enum fields map the pgEnum string unions carried by the canonical select
 * row onto the Pothos enums registered ONCE in `shared/enum.pothos.ts`
 * through exhaustive, type-safe mapping helpers — never `as` casts. Each
 * helper's switch is exhaustive over the pgEnum vocabulary (no `default`);
 * an unrecognized value cannot pass through silently — it fails the
 * helper's compile-time `never` guard and surfaces as a resolver error at
 * runtime. Timestamps use the `DateTime` scalar (registered in
 * `shared/scalar.pothos.ts`, backed by `DateTimeResolver` from
 * `graphql-scalars`): `Date | null` on the canonical shape, ISO-8601 UTC on
 * the wire.
 *
 * Consumed by the session query/mutation resolver modules, whose imports
 * transitively register the types through the `gqlSchema.ts` side-effect
 * chain.
 */

import { DisputeResolution } from "@/backend/enum/scheduling/dispute-resolution.enum";
import { SessionIntent } from "@/backend/enum/scheduling/session-intent.enum";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import { SessionType } from "@/backend/enum/scheduling/session-type.enum";
import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import {
  DisputeResolutionPothosEnum,
  SessionIntentPothosEnum,
  SessionStatusPothosEnum,
  SessionTypePothosEnum,
} from "@/backend/graphql/pothos/shared/enum.pothos";
import type { SessionListItemType, SessionPageReturnType, SessionReturnType } from "@/backend/types";

/**
 * Maps the `session_status` pgEnum value carried by the canonical
 * `SessionReturnType` row onto the `SessionStatus` TS enum.
 *
 * EXHAUSTIVE over the pgEnum vocabulary — one case per member, NO
 * `default`: the scrutinee is the canonical row column's literal union, so
 * a future `session_status` pgEnum member added to `backend/db/schema/enums.ts`
 * WITHOUT a matching case here fails the trailing `never` assignment at
 * compile time (the silent `default → null` escape hatch is deliberately
 * absent). The trailing throw is the fail-closed fallback for that
 * impossible branch: unreachable while the switch stays exhaustive, it
 * still guards a runtime-only drift (a DB enum ahead of the TS schema) by
 * surfacing a resolver error instead of passing an unmapped value through.
 */
function toSessionStatus(status: SessionReturnType["status"]): SessionStatus {
  switch (status) {
    case "scheduled":
      return SessionStatus.Scheduled;
    case "started":
      return SessionStatus.Started;
    case "completed":
      return SessionStatus.Completed;
    case "cancelled":
      return SessionStatus.Cancelled;
    case "disputed":
      return SessionStatus.Disputed;
  }
  // Exhaustiveness guard — the pgEnum union above guarantees this is
  // unreachable (the registration.service.ts fail-closed idiom, without a
  // `default` clause).
  const exhaustive: never = status;
  throw new Error(`Unexpected session status: ${String(exhaustive)}`);
}

/**
 * Maps the `session_type` pgEnum value carried by the canonical
 * `SessionReturnType` row onto the `SessionType` TS enum — exhaustive
 * switch (one case per member, no `default`) with the same fail-closed
 * never-guard fallback as {@link toSessionStatus}.
 */
function toSessionType(sessionType: SessionReturnType["sessionType"]): SessionType {
  switch (sessionType) {
    case "student_session":
      return SessionType.StudentSession;
    case "teacher_evaluation":
      return SessionType.TeacherEvaluation;
    case "re_evaluation":
      return SessionType.ReEvaluation;
  }
  // Exhaustiveness guard — the pgEnum union above guarantees this is
  // unreachable (the registration.service.ts fail-closed idiom, without a
  // `default` clause).
  const exhaustive: never = sessionType;
  throw new Error(`Unexpected session type: ${String(exhaustive)}`);
}

/**
 * Maps the `session_intent` pgEnum value carried by the canonical
 * `SessionReturnType` row onto the `SessionIntent` TS enum — exhaustive
 * switch (one case per member, no `default`) with the same fail-closed
 * never-guard fallback as {@link toSessionStatus}. The column's `null`
 * (a legitimate stored value) is resolved by the `intent` field before
 * this mapper is reached.
 */
function toSessionIntent(intent: NonNullable<SessionReturnType["intent"]>): SessionIntent {
  switch (intent) {
    case "hifz":
      return SessionIntent.Hifz;
    case "tajweed":
      return SessionIntent.Tajweed;
    case "evaluation":
      return SessionIntent.Evaluation;
  }
  // Exhaustiveness guard — the pgEnum union above guarantees this is
  // unreachable (the registration.service.ts fail-closed idiom, without a
  // `default` clause).
  const exhaustive: never = intent;
  throw new Error(`Unexpected session intent: ${String(exhaustive)}`);
}

/**
 * Maps the `dispute_resolution` pgEnum value carried by the canonical
 * `SessionReturnType` row onto the `DisputeResolution` TS enum — exhaustive
 * switch (one case per member, no `default`) with the same fail-closed
 * never-guard fallback as {@link toSessionStatus}. The wire vocabulary is
 * value-identical to the storage vocabulary (both spell the PascalCase
 * members), so this mapper is pure re-typing, never re-spelling.
 */
function toDisputeResolution(outcome: NonNullable<SessionReturnType["resolutionOutcome"]>): DisputeResolution {
  switch (outcome) {
    case "Cancel":
      return DisputeResolution.Cancel;
    case "Complete":
      return DisputeResolution.Complete;
    case "Refund":
      return DisputeResolution.Refund;
    case "PartialRefund":
      return DisputeResolution.PartialRefund;
    case "Uphold":
      return DisputeResolution.Uphold;
  }
  // Exhaustiveness guard — the pgEnum union above guarantees this is
  // unreachable (the registration.service.ts fail-closed idiom, without a
  // `default` clause).
  const exhaustive: never = outcome;
  throw new Error(`Unexpected dispute resolution outcome: ${String(exhaustive)}`);
}

/**
 * The participant identity band: one session participant's `id` + display
 * name. `id` FIRST (Apollo cache normalization). Both fields are non-null —
 * `users.full_name` is `.notNull()` at the schema and the enrichment read
 * only ever projects resolved user rows. The object exists ONLY as the
 * `Session.student`/`Session.teacher` field payload: there is no root field
 * returning it and no other producer.
 */
const SessionParticipantPothosObject = gqlSchemaBuilder
  .objectRef<{ id: number; fullName: string }>("SessionParticipant")
  .implement({
    fields: t => ({
      // ID FIRST — Apollo cache normalization requires `id` on every
      // entity-shaped object (identity PK, surfaced as GraphQL `ID!`).
      id: t.exposeID("id"),
      // The display name — NOT NULL at the schema, exposed verbatim.
      fullName: t.exposeString("fullName"),
    }),
  });

/**
 * The canonical `Session` GraphQL object. Producers return
 * `SessionReturnType` (the session table's derived select row); the
 * participant list reads return the name-enriched `SessionListItemType` —
 * both satisfy the ref's structural shape (the enrichment members are
 * optional). Field order mirrors plan §3.1: `id` first, participant ids,
 * the nullable identity band, lifecycle enums, fee surface, then lifecycle
 * timestamps.
 */
export const SessionPothosObject = gqlSchemaBuilder.objectRef<SessionListItemType>("Session").implement({
  fields: t => ({
    // ID FIRST — Apollo cache normalization requires `id` on every
    // entity-shaped object (identity PK, surfaced as GraphQL `ID!`).
    id: t.exposeID("id"),
    // Participant ids — deliberately exposed per REQ-060 (both are already
    // known to every authorized viewer of the row by construction).
    teacherId: t.exposeID("teacherId"),
    studentId: t.exposeID("studentId"),
    // Participant identity bands — NULLABLE BY CONTRACT (see the module
    // docblock): populated ONLY by the participant list reads
    // (myStudentSessions/myTeacherSessions), which batch-enrich the page
    // rows; every other producer leaves the name unset and the field
    // resolves null — the nullability is honest, not lazy. The structural
    // probe keeps the resolution cast-free (`?: … | null` members read as
    // `string | null | undefined`).
    student: t.field({
      type: SessionParticipantPothosObject,
      nullable: true,
      resolve: parent => {
        if (parent.studentName == null) {
          return null;
        }
        return { id: parent.studentId, fullName: parent.studentName };
      },
    }),
    teacher: t.field({
      type: SessionParticipantPothosObject,
      nullable: true,
      resolve: parent => {
        if (parent.teacherName == null) {
          return null;
        }
        return { id: parent.teacherId, fullName: parent.teacherName };
      },
    }),
    // Lifecycle status — mapped exhaustively onto the registered
    // `SessionStatus` enum (the `disputed` member is produced by the
    // participant dispute transition and consumed by the admin
    // arbitration); an unmapped value fails the mapper's compile-time
    // exhaustiveness guard and throws fail-closed at runtime.
    status: t.field({
      type: SessionStatusPothosEnum,
      resolve: parent => toSessionStatus(parent.status),
    }),
    // Session type — mapped exhaustively onto the registered `SessionType`
    // enum.
    sessionType: t.field({
      type: SessionTypePothosEnum,
      resolve: parent => toSessionType(parent.sessionType),
    }),
    // Booking intent — nullable: optional on the table (evaluation sessions
    // carry it; student bookings pin Hifz/Tajweed).
    intent: t.field({
      type: SessionIntentPothosEnum,
      nullable: true,
      resolve: parent => {
        if (parent.intent === null) return null;
        return toSessionIntent(parent.intent);
      },
    }),
    // Platform-set fee — nullable at the DB level (decimal → string on the
    // canonical shape, rendered verbatim on the wire).
    fee: t.exposeString("fee", { nullable: true }),
    // Hold marker — non-nullable `Boolean!` per plan §3.1: the DB column is
    // nullable (defaults false), so null resolves to false at the GraphQL
    // layer (mirrors the governance-boolean precedent on the User object).
    feeHeld: t.boolean({
      resolve: parent => parent.feeHeld ?? false,
    }),
    // Lifecycle stamps — nullable `DateTime` scalars where the column is
    // nullable (source `Date | null`, serialized to ISO-8601 UTC).
    startedAt: t.expose("startedAt", { type: "DateTime", nullable: true }),
    endedAt: t.expose("endedAt", { type: "DateTime", nullable: true }),
    confirmedByTeacherAt: t.expose("confirmedByTeacherAt", { type: "DateTime", nullable: true }),
    confirmedByStudentAt: t.expose("confirmedByStudentAt", { type: "DateTime", nullable: true }),
    confirmationDeadline: t.expose("confirmationDeadline", { type: "DateTime", nullable: true }),
    // Dispute + reason surface — nullable passthroughs: `cancelReason`
    // persists a participant's trimmed cancellation text (NULL for rows
    // cancelled without one or before the column existed);
    // `disputeReason`/`disputedAt` record the arbitration request and
    // `resolutionNote`/`resolvedAt` the admin outcome. Free-text members
    // are nullable strings; the stamps are nullable `DateTime` scalars.
    cancelReason: t.exposeString("cancelReason", { nullable: true }),
    disputeReason: t.exposeString("disputeReason", { nullable: true }),
    disputedAt: t.expose("disputedAt", { type: "DateTime", nullable: true }),
    resolutionNote: t.exposeString("resolutionNote", { nullable: true }),
    // The formal arbitration decision (CR-5) — the storage mirror of the
    // `DisputeResolution` wire enum. NULL for rows never disputed or
    // resolved before the column shipped (the note alone never carried
    // the decision: admins may resolve without writing one).
    resolutionOutcome: t.field({
      type: DisputeResolutionPothosEnum,
      nullable: true,
      resolve: parent => {
        if (parent.resolutionOutcome === null) return null;
        return toDisputeResolution(parent.resolutionOutcome);
      },
    }),
    resolvedAt: t.expose("resolvedAt", { type: "DateTime", nullable: true }),
    // Server-derived admin attention badge — computed by the admin
    // directory read per row (a disputed row, or a scheduled row whose
    // confirmation deadline has lapsed) and carried on that read's row
    // projection. Producers that return plain session rows (the
    // participant reads and every mutation) never populate the projection,
    // so the field resolves to `false` there; a viewer who can see a row
    // can already derive the same boolean from the exposed
    // `status`/`confirmationDeadline` fields, so nothing new is disclosed.
    // Non-nullable `Boolean!` mirroring the `feeHeld` governance-boolean
    // precedent (absent projection member → false); the badge is
    // presentation-only styling input and never an authorization signal —
    // this module surfaces the value, it never recomputes it.
    needsAttention: t.boolean({
      resolve: parent => {
        // The admin directory's row projection is the ONLY producer that
        // carries the badge member; the structural probe keeps every other
        // producer cast-free and absent→false.
        if (!("needsAttention" in parent)) {
          return false;
        }
        const badge: unknown = parent.needsAttention;
        return typeof badge === "boolean" ? badge : false;
      },
    }),
    // Row timestamps — NOT NULL columns, non-nullable `DateTime!`.
    createdAt: t.expose("createdAt", { type: "DateTime" }),
    updatedAt: t.expose("updatedAt", { type: "DateTime" }),
  }),
});

/**
 * The canonical `SessionPage` GraphQL object — the sanctioned list-wrapper
 * exception (paginated result shape). The service is the only producer of
 * `SessionPageReturnType` and echoes `page`/`pageSize` honestly.
 */
export const SessionPagePothosObject = gqlSchemaBuilder.objectRef<SessionPageReturnType>("SessionPage").implement({
  fields: t => ({
    items: t.field({
      type: [SessionPothosObject],
      resolve: parent => parent.items,
    }),
    totalCount: t.exposeInt("totalCount"),
    page: t.exposeInt("page"),
    pageSize: t.exposeInt("pageSize"),
  }),
});
