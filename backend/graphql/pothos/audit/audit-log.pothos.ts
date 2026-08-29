/**
 * AdminAuditLogPothosObject — the ADMIN audit-trail wire contract
 * (DEV3-020 Phase 1).
 *
 * Three objects, one file — all back service-layer projections exclusively
 * (Single Canonical Object Type Pattern, `backend/graphql/AGENTS.md`):
 *  - `AdminAuditActor` ← `AuditLogActorSummary` (the narrow actor summary:
 *    id / fullName / email — NEVER the full `users` row; the trail
 *    attributes WHO acted, it is not a user directory).
 *  - `AdminAuditLog` ← `AuditLogWithActor` (the repository's INNER-JOIN
 *    projection: audit row + actor summary).
 *  - `AdminAuditLogConnection` ← `AuditTrailPage` (the page envelope:
 *    items + total + the limit/offset that shaped the page, so the client
 *    can render a truthful pagination footer without re-deriving it).
 *
 * Least-privilege posture: the trail exposes the `details` JSON STRING
 * verbatim (it is id-limited machine code by write-contract — the service
 * rejects any payload carrying field values — and rendering it client-side
 * keeps the wire contract stable as the action vocabulary grows). NO
 * mutation surface exists for audit rows: they are append-only by database
 * trigger, and the GraphQL layer mirrors that with query-only exposure.
 *
 * Field map (`AdminAuditLog`):
 *      id          → `ID!` (numeric PK behind the ID scalar)
 *      actionType  → `String!` (the audit_action_type machine code)
 *      entityType  → `String!` (the entity family machine code)
 *      entityId    → `Int`    (nullable — some actions are entity-scoped
 *                    without a single row id)
 *      details     → `String` (nullable — serialized JSON, id-limited)
 *      createdAt   → non-nullable `DateTime`
 *      actor       → `AdminAuditActor!`
 */

import type { AuditLogActorSummary, AuditLogWithActor } from "@/backend/db/repo/audit/audit-log.repository";
import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import { DateTimePothosScalar } from "@/backend/graphql/pothos/shared/datetime.pothos";
import type { AuditTrailPage } from "@/backend/services/audit/audit-log.service";

/** The narrow actor summary embedded in every trail row. */
export const AdminAuditActorPothosObject = gqlSchemaBuilder
  .objectRef<AuditLogActorSummary>("AdminAuditActor")
  .implement({
    fields: t => ({
      // ID! — Apollo cache normalization (`AdminAuditActor:<id>`).
      id: t.exposeID("id"),
      fullName: t.exposeString("fullName"),
      email: t.exposeString("email"),
    }),
  });

/** One immutable audit-trail row with its actor embedded. */
export const AdminAuditLogPothosObject = gqlSchemaBuilder.objectRef<AuditLogWithActor>("AdminAuditLog").implement({
  fields: t => ({
    id: t.exposeID("id"),
    actionType: t.exposeString("actionType"),
    entityType: t.exposeString("entityType"),
    entityId: t.exposeInt("entityId", { nullable: true }),
    details: t.exposeString("details", { nullable: true }),
    createdAt: t.field({
      type: DateTimePothosScalar,
      resolve: parent => parent.createdAt,
    }),
    actor: t.field({
      type: AdminAuditActorPothosObject,
      resolve: parent => parent.actor,
    }),
  }),
});

/** The page envelope behind the admin trail viewer. */
export const AdminAuditLogConnectionPothosObject = gqlSchemaBuilder
  .objectRef<AuditTrailPage>("AdminAuditLogConnection")
  .implement({
    fields: t => ({
      items: t.field({
        type: [AdminAuditLogPothosObject],
        nullable: false,
        resolve: parent => parent.items,
      }),
      total: t.exposeInt("total"),
      limit: t.exposeInt("limit"),
      offset: t.exposeInt("offset"),
    }),
  });
