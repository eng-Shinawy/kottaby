/**
 * Audit-trail GraphQL objects + filter input — the global admin read surface
 * over the append-only `audit_logs` table.
 *
 * Every shape is backed by a canonical type from `backend/types/audit/`:
 *  - `AdminAuditLogEntry` ← `AdminAuditLogEntryReturnType` (one rendered row)
 *  - `AdminAuditLogPage` ← `AdminAuditLogPageReturnType` (embedded envelope)
 *  - `AdminAuditLogFiltersInput` — closed six-member filter whitelist whose
 *    members map 1:1 onto `AdminAuditTrailFiltersSubmitInput` (the resolver
 *    copies them field-by-field; nothing else crosses the boundary).
 *
 * Per `backend/graphql/pothos/AGENTS.md`:
 *  - NO local type definitions — all shapes come from `@/backend/types`.
 *  - `id` is exposed FIRST (as a GraphQL `ID!` over the integer primary key)
 *    so Apollo cache normalization keys consistently; the page wrapper is a
 *    deliberate embedded value object with NO `id` (the normalizable
 *    entities are the rows inside `items`).
 *  - The `AuditActionType` enum is imported from the shared enum registry —
 *    never re-registered here.
 *  - Timestamps ride the shared `DateTime` scalar (ISO-8601 UTC
 *    serialization) — no hand-rolled `toISOString()` presentation layer.
 */
import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import { AuditActionTypePothosEnum } from "@/backend/graphql/pothos/shared/enum.pothos";
import type { AdminAuditLogEntryReturnType, AdminAuditLogPageReturnType } from "@/backend/types";

/**
 * `AdminAuditLogEntry` — one row of the global trail. `entityId`/`details`
 * are nullable by design (system actions and anonymous actors carry neither);
 * `actorName` is the actor's CURRENT display name (documented live
 * projection, not a snapshot).
 */
export const AdminAuditLogEntryPothosObject = gqlSchemaBuilder
  .objectRef<AdminAuditLogEntryReturnType>("AdminAuditLogEntry")
  .implement({
    fields: t => ({
      // Integer primary key exposed as a GraphQL ID — FIRST for Apollo cache
      // normalization.
      id: t.exposeID("id"),
      actionType: t.expose("actionType", { type: AuditActionTypePothosEnum }),
      actorId: t.exposeInt("actorId"),
      actorName: t.exposeString("actorName"),
      entityType: t.exposeString("entityType"),
      entityId: t.exposeInt("entityId", { nullable: true }),
      details: t.exposeString("details", { nullable: true }),
      createdAt: t.expose("createdAt", { type: "DateTime" }),
    }),
  });

/**
 * `AdminAuditLogPage` — paginated trail envelope. Echoes `page` + `pageSize`
 * so callers can normalize client-side pagination state; an out-of-range
 * page yields an empty `items` array with the honest `totalCount` (never
 * clamped, never an error). Embedded wrapper — NO `id` field.
 */
export const AdminAuditLogPagePothosObject = gqlSchemaBuilder
  .objectRef<AdminAuditLogPageReturnType>("AdminAuditLogPage")
  .implement({
    fields: t => ({
      items: t.field({
        type: [AdminAuditLogEntryPothosObject],
        resolve: parent => parent.items,
      }),
      totalCount: t.exposeInt("totalCount"),
      page: t.exposeInt("page"),
      pageSize: t.exposeInt("pageSize"),
    }),
  });

/**
 * `AdminAuditLogFiltersInput` — independent ANDed filters for the trail
 * listing, all optional (absent or `null` members drop out at the service
 * layer). Closed whitelist: any field beyond the six members dies as a
 * GraphQL validation failure before a resolver ever runs — identity
 * authority and write paths are structurally unreachable through this
 * shape. `from`/`to` ride the shared `DateTime` scalar (wire ISO-8601,
 * resolved to `Date` before the service sees them).
 */
export const AdminAuditLogFiltersInput = gqlSchemaBuilder.inputType("AdminAuditLogFiltersInput", {
  fields: t => ({
    actorId: t.int({ required: false }),
    actionType: t.field({ type: AuditActionTypePothosEnum, required: false }),
    entityType: t.string({ required: false }),
    entityId: t.int({ required: false }),
    from: t.field({ type: "DateTime", required: false }),
    to: t.field({ type: "DateTime", required: false }),
  }),
});
