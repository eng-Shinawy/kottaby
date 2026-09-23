/**
 * Dispute-family Pothos objects — the dispute-case read envelopes (the
 * evidence bundles behind arbitration decisions and their participant
 * mirrors) plus the admin queue/analytics projections.
 *
 * Single Canonical Object Type Pattern (`backend/graphql/AGENTS.md`):
 *  - Backed EXCLUSIVELY by the canonical `*ReturnType` shapes from
 *    `@/backend/types` — no local type definitions here. There is NO
 *    business logic in this module.
 *  - Compound READ envelopes (the sanctioned wrapper exception): they reuse
 *    the existing canonical entity objects — `Session`, `SessionReport`,
 *    `SessionHomeWork`, `SessionRecitation`, and `AdminAuditLogEntry` — by
 *    reference; every member entity keeps exactly one GraphQL object type
 *    and this module registers no duplicate of any of them. The envelopes
 *    themselves are embedded value objects with NO `id` (the normalizable
 *    entities are their members). The shared artifact passthroughs come
 *    from `disputeCaseArtifactFields` (the family's field factory).
 *  - Absent artifacts surface as honest `null`s (`report`, `homework`,
 *    `recitation` are nullable): a session whose report, homework, or
 *    recitation record was never produced renders no fabricated
 *    placeholder.
 *
 * Consumed by the arbitration query resolver module, whose import
 * transitively registers the types through the `gqlSchema.ts` side-effect
 * chain.
 */

import { AdminAuditLogEntryPothosObject } from "@/backend/graphql/pothos/admin/audit-trail.pothos";
import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import { SessionPothosObject } from "@/backend/graphql/pothos/classes/session.pothos";
import { disputeCaseArtifactFields } from "@/backend/graphql/pothos/shared/disputeCaseFieldHelpers";
import type {
  AdminDisputeAnalyticsReturnType,
  AdminDisputeCaseReturnType,
  AdminDisputedSessionPageReturnType,
  AdminDisputedSessionRowReturnType,
  StudentDisputeCaseReturnType,
  TeacherDisputeCaseReturnType,
} from "@/backend/types";

/**
 * The canonical `AdminDisputeCase` GraphQL object. The producer is
 * `SessionArbitrationService.getAdminDisputeCase` (the admin-gated case
 * read); every field is a passthrough of the composed bundle. The
 * session-scoped audit trail is the admin governance surface (newest
 * first, the trail service's largest single page — a session's arbitration
 * history is bounded by its own lifecycle); non-nullable list, an empty
 * trail is the honest empty state.
 */
export const AdminDisputeCasePothosObject = gqlSchemaBuilder
  .objectRef<AdminDisputeCaseReturnType>("AdminDisputeCase")
  .implement({
    fields: t => ({
      ...disputeCaseArtifactFields(t),
      auditTrail: t.field({
        type: [AdminAuditLogEntryPothosObject],
        resolve: parent => [...parent.auditTrail],
      }),
      // The participant display names resolved server-side — honest `null`
      // when the user row is unreachable (the view falls back to the
      // numeric identity).
      studentName: t.field({
        type: "String",
        nullable: true,
        resolve: parent => parent.studentName,
      }),
      teacherName: t.field({
        type: "String",
        nullable: true,
        resolve: parent => parent.teacherName,
      }),
    }),
  });

/**
 * The canonical `TeacherDisputeCase` GraphQL object. The producer is
 * `SessionArbitrationService.getTeacherDisputeCase` (the participant
 * predicate lives service-side); every field is a passthrough of the
 * composed bundle. The audit trail is deliberately ABSENT — the trail is
 * the admin governance surface, so this envelope reuses only the
 * participant-owned entity objects, each still registered exactly once
 * repo-wide. The student display name is resolved server-side.
 */
export const TeacherDisputeCasePothosObject = gqlSchemaBuilder
  .objectRef<TeacherDisputeCaseReturnType>("TeacherDisputeCase")
  .implement({
    fields: t => ({
      ...disputeCaseArtifactFields(t),
      studentName: t.field({
        type: "String",
        nullable: true,
        resolve: parent => parent.studentName,
      }),
    }),
  });

/**
 * The STUDENT mirror of the teacher case bundle — the filing participant's
 * own transparency envelope (`studentDisputeCase`). Same producer shape as
 * the teacher read (`SessionArbitrationService.getStudentDisputeCase`; the
 * participant predicate lives service-side), same honest-null contract,
 * same deliberately-absent admin-only audit trail — with the TEACHER
 * display name resolved server-side instead of the student's. Every
 * member reuses the canonical entity objects (each still registered
 * exactly once repo-wide).
 */
export const StudentDisputeCasePothosObject = gqlSchemaBuilder
  .objectRef<StudentDisputeCaseReturnType>("StudentDisputeCase")
  .implement({
    fields: t => ({
      ...disputeCaseArtifactFields(t),
      teacherName: t.field({
        type: "String",
        nullable: true,
        resolve: parent => parent.teacherName,
      }),
    }),
  });

/**
 * The admin arbitration queue row: the disputed session wrapped with the
 * server-resolved participant display names (honest `null`s fall back to
 * the numeric identity in the view).
 */
const AdminDisputedSessionRowPothosObject = gqlSchemaBuilder
  .objectRef<AdminDisputedSessionRowReturnType>("AdminDisputedSessionRow")
  .implement({
    fields: t => ({
      // The disputed session's full row through the canonical `Session`
      // object — `Session!`.
      session: t.field({
        type: SessionPothosObject,
        resolve: parent => parent.session,
      }),
      studentName: t.field({
        type: "String",
        nullable: true,
        resolve: parent => parent.studentName,
      }),
      teacherName: t.field({
        type: "String",
        nullable: true,
        resolve: parent => parent.teacherName,
      }),
    }),
  });

/**
 * The admin arbitration queue page: one page of
 * `AdminDisputedSessionRow` entries plus the honest pagination tail.
 */
export const AdminDisputedSessionPagePothosObject = gqlSchemaBuilder
  .objectRef<AdminDisputedSessionPageReturnType>("AdminDisputedSessionPage")
  .implement({
    fields: t => ({
      items: t.field({
        type: [AdminDisputedSessionRowPothosObject],
        resolve: parent => [...parent.items],
      }),
      totalCount: t.exposeInt("totalCount"),
      page: t.exposeInt("page"),
      pageSize: t.exposeInt("pageSize"),
    }),
  });

/**
 * The admin dispute-analytics snapshot object: the aggregate dispute
 * counts (open, resolved, per-outcome) as flat non-nullable Int fields —
 * one canonical object for the analytics read, zero derived values (the
 * view computes rates from the honest counts it already holds).
 */
export const AdminDisputeAnalyticsPothosObject = gqlSchemaBuilder
  .objectRef<AdminDisputeAnalyticsReturnType>("AdminDisputeAnalytics")
  .implement({
    fields: t => ({
      openDisputes: t.exposeInt("openDisputes"),
      resolvedDisputes: t.exposeInt("resolvedDisputes"),
      cancelCount: t.exposeInt("cancelCount"),
      completeCount: t.exposeInt("completeCount"),
      refundCount: t.exposeInt("refundCount"),
      partialRefundCount: t.exposeInt("partialRefundCount"),
      upholdCount: t.exposeInt("upholdCount"),
    }),
  });
