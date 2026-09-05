/**
 * SessionPothosObject + SessionPagePothosObject — the single canonical
 * GraphQL object types for a scheduling session and its pagination wrapper.
 *
 * Single Canonical Object Type Pattern (`backend/graphql/AGENTS.md`):
 *  - Backed EXCLUSIVELY by the canonical `SessionReturnType` /
 *    `SessionPageReturnType` from `@/backend/types` — no local type
 *    definitions here. Every field is a structural map or passthrough;
 *    there is NO business logic in this module.
 *  - `Session` exposes `id` FIRST (Apollo cache normalization), then the
 *    participant ids `teacherId`/`studentId` — deliberately exposed per
 *    REQ-060 (both are already known to every authorized viewer of a row by
 *    construction; they exist for cache identity and self-rendering only).
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
import { SessionIntent } from "@/backend/enum/scheduling/session-intent.enum";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import { SessionType } from "@/backend/enum/scheduling/session-type.enum";
import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import {
  SessionIntentPothosEnum,
  SessionStatusPothosEnum,
  SessionTypePothosEnum,
} from "@/backend/graphql/pothos/shared/enum.pothos";
import type { SessionPageReturnType, SessionReturnType } from "@/backend/types";

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
 * The canonical `Session` GraphQL object. Producers return
 * `SessionReturnType` (the session table's derived select row). Field order
 * mirrors plan §3.1: `id` first, participant ids, lifecycle enums, fee
 * surface, then lifecycle timestamps.
 */
export const SessionPothosObject = gqlSchemaBuilder.objectRef<SessionReturnType>("Session").implement({
  fields: t => ({
    // ID FIRST — Apollo cache normalization requires `id` on every
    // entity-shaped object (identity PK, surfaced as GraphQL `ID!`).
    id: t.exposeID("id"),
    // Participant ids — deliberately exposed per REQ-060 (both are already
    // known to every authorized viewer of the row by construction).
    teacherId: t.exposeID("teacherId"),
    studentId: t.exposeID("studentId"),
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
    resolvedAt: t.expose("resolvedAt", { type: "DateTime", nullable: true }),
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
