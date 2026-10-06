/**
 * StudentSessionBalancePothosObject — the GraphQL presentation of the
 * caller's own prepaid session-credit lanes.
 *
 * Single Canonical Object Type Pattern (`backend/graphql/AGENTS.md`):
 *  - Backed EXCLUSIVELY by the canonical
 *    {@link StudentSessionBalanceReturnType} from `@/backend/types` — no
 *    local type definitions here. The service
 *    (`StudentBalanceService.getMySessionBalance`) is the only producer of
 *    that closed four-field shape, so no field on this object can disclose
 *    more than the service read (BOPLA: read-only, no identifiers, no
 *    contact fields, no governance state).
 *  - EXACTLY four fields, mapped structurally — one counter per booking
 *    lane, with the honest nullability split of the underlying columns:
 *      balanceTrial   → exposed Int (non-nullable) — `balance_trial` is
 *                       NOT NULL at the schema
 *      balanceHifz    → exposed Int (nullable)     — nullable column
 *      balanceTajweed → exposed Int (nullable)     — nullable column
 *      balanceReviews → exposed Int (nullable)     — nullable column
 *    Every field is a pure column passthrough — never re-computed here. The
 *    counters count pre-purchased session credits per lane; the booking
 *    debit ladder (the trial lane drawn first, then the intent lane) is
 *    booking-flow logic and lives in the session-lifecycle service — this
 *    object exposes stored balances and carries NONE of that ladder.
 *  - NO `id` field BY DESIGN: this is a deliberate embedded value type, not
 *    an entity — the payload carries NO database identity. The caller can
 *    only ever re-obtain their OWN lanes (identity is context-derived in
 *    the owning query), and the shape is a projection of four integer
 *    counters, not a normalizable entity — mirroring the
 *    `HandshakeCodeLookup` embedded-type precedent.
 *  - NO inline business logic — all four fields are structural passthroughs.
 *
 * Consumed by the role-gated student self-read query (`mySessionBalance`),
 * whose import of this module transitively registers the type through the
 * `gqlSchema.ts` side-effect chain — matching the
 * `students/handshake-code.pothos.ts` precedent. Pothos sub-directories
 * carry NO barrel of their own: registration rides the importing query
 * module.
 */
import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import type { StudentSessionBalanceReturnType } from "@/backend/types";

export const StudentSessionBalancePothosObject = gqlSchemaBuilder
  .objectRef<StudentSessionBalanceReturnType>("StudentSessionBalance")
  .implement({
    fields: t => ({
      balanceTrial: t.exposeInt("balanceTrial"),
      balanceHifz: t.exposeInt("balanceHifz", { nullable: true }),
      balanceTajweed: t.exposeInt("balanceTajweed", { nullable: true }),
      balanceReviews: t.exposeInt("balanceReviews", { nullable: true }),
    }),
  });
