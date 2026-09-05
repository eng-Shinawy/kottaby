/**
 * HandshakeCodeLookupPothosObject — the GraphQL presentation of a parent-side
 * handshake-code discovery lookup.
 *
 * Single Canonical Object Type Pattern (`backend/graphql/AGENTS.md`):
 *  - Backed EXCLUSIVELY by the canonical {@link HandshakeCodeLookupReturnType}
 *    from `@/backend/types` — no local type definitions here. The service
 *    (`StudentHandshakeService.findStudentByHandshakeCode`) is the only
 *    producer of that closed two-field shape, so no field on this object can
 *    disclose more than the service computed (BOPLA: read-only, no database
 *    identity, no contact fields, no governance state).
 *  - EXACTLY two fields, mapped structurally:
 *      maskedName → exposed String (non-nullable) — the masked full name
 *      linkable   → exposed Boolean (non-nullable) — `parentId === null`
 *    computed server-side by the service; never re-computed here.
 *  - NO `id` field BY DESIGN: this is a deliberate embedded value type, not an
 *    entity — the payload must carry NO database identity (the frontend Apollo
 *    cache registers it with `keyFields: false`, mirroring the `HealthCheck`
 *    embedded-type precedent). A client can only re-obtain this payload by
 *    re-submitting the handshake code itself (capability-by-code).
 *  - NO inline business logic — both fields are pure structural passthroughs.
 *
 * Consumed by the role-gated parent discovery query
 * (`findStudentByHandshakeCode`), whose import of this module transitively
 * registers the type through the `gqlSchema.ts` side-effect chain — matching
 * the `teachers/applicant.pothos.ts` precedent. Pothos sub-directories carry
 * NO barrel of their own: registration rides the importing query module.
 */
import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import type { HandshakeCodeLookupReturnType } from "@/backend/types";

export const HandshakeCodeLookupPothosObject = gqlSchemaBuilder
  .objectRef<HandshakeCodeLookupReturnType>("HandshakeCodeLookup")
  .implement({
    fields: t => ({
      maskedName: t.exposeString("maskedName"),
      linkable: t.exposeBoolean("linkable"),
    }),
  });
