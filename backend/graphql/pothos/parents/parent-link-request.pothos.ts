/**
 * ParentLinkRequestPothosObjects — the GraphQL presentations of the two
 * parent-child link request shapes.
 *
 * Single Canonical Object Type Pattern (`backend/graphql/AGENTS.md`):
 *  - Backed EXCLUSIVELY by the canonical return types from
 *    `@/backend/types/parents` — no local type definitions here. The service
 *    (`ParentLinkRequestService`) is the only producer of those closed,
 *    readonly shapes, so no field on either object can disclose more than
 *    the service computed: the counterparty appears ONLY through
 *    `studentMaskedName` (the deterministic `maskFullName` output) /
 *    `parentFullName` (an already-assembled display name); raw FKs,
 *    governance columns, and every internal field never cross this
 *    boundary (BOPLA: read-only, zero overlap with any mutation input).
 *  - `id` is the FIRST exposed field on both objects and non-nullable
 *    (`t.exposeID` → `ID!`) — Apollo normalization requires a stable
 *    entity key at the first field.
 *  - `status` maps through the ONCE-registered `LinkStatusPothosEnum`
 *    (enum-object form — `shared/enum.pothos.ts`); the canonical TS enum
 *    KEYS (`Pending|Confirmed|Rejected|Expired`) are the GraphQL value
 *    names on the wire per the Pothos contract.
 *  - Timestamps are the raw `Date` fields exposed through the registered
 *    `DateTime` scalar (ISO-8601 UTC serialization — `shared/scalar.pothos.ts`)
 *    — NO hand-rolled `toISOString()` String columns. `respondedAt` is the
 *    only nullable field (stays null until the request is resolved).
 *  - NO inline business logic — every field is a pure structural
 *    passthrough; liveness/computed-expiry is decided by the service,
 *    never re-derived by clients.
 *
 * Consumed by the role-gated root fields in `backend/graphql/query/parents/`
 * + `backend/graphql/mutation/parents/`, whose imports transitively
 * register these types through the `gqlSchema.ts` side-effect chain —
 * matching the `teachers/applicant.pothos.ts` precedent.
 */
import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import { LinkStatusPothosEnum } from "@/backend/graphql/pothos/shared/enum.pothos";
import type { IncomingParentLinkRequestReturnType, OutgoingParentLinkRequestReturnType } from "@/backend/types/parents";

/** The parent-side wire shape: creation, withdrawal, and outgoing-list rows. */
export const OutgoingParentLinkRequestPothosObject = gqlSchemaBuilder
  .objectRef<OutgoingParentLinkRequestReturnType>("OutgoingParentLinkRequest")
  .implement({
    fields: t => ({
      id: t.exposeID("id"),
      status: t.expose("status", { type: LinkStatusPothosEnum }),
      studentMaskedName: t.exposeString("studentMaskedName"),
      createdAt: t.expose("createdAt", { type: "DateTime" }),
      expiresAt: t.expose("expiresAt", { type: "DateTime" }),
      respondedAt: t.expose("respondedAt", { type: "DateTime", nullable: true }),
    }),
  });

/** The student-side wire shape: incoming-list rows and the respond result. */
export const IncomingParentLinkRequestPothosObject = gqlSchemaBuilder
  .objectRef<IncomingParentLinkRequestReturnType>("IncomingParentLinkRequest")
  .implement({
    fields: t => ({
      id: t.exposeID("id"),
      status: t.expose("status", { type: LinkStatusPothosEnum }),
      parentFullName: t.exposeString("parentFullName"),
      createdAt: t.expose("createdAt", { type: "DateTime" }),
      expiresAt: t.expose("expiresAt", { type: "DateTime" }),
      respondedAt: t.expose("respondedAt", { type: "DateTime", nullable: true }),
    }),
  });
