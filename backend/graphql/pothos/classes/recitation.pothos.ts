/**
 * SessionRecitation — the canonical GraphQL object + input for the 1:1
 * recitation record attached to a scheduling session.
 *
 * Single Canonical Object Type Pattern (`backend/graphql/AGENTS.md`):
 *  - Backed EXCLUSIVELY by the canonical `RecitationReturnType` from
 *    `@/backend/types` — no local type definitions here. Every field is a
 *    passthrough of the derived select row; there is NO business logic in
 *    this module.
 *  - `SessionRecitation` exposes `id` FIRST (Apollo cache normalization),
 *    then the owning `sessionId` (already known to every authorized viewer
 *    of the row by construction; it exists for cache identity and
 *    self-rendering only), then the two content columns and the row
 *    timestamps.
 *  - `SessionRecitationInput` is the sanctioned input-type exception: the
 *    closed client whitelist (`name` required, `description` optional)
 *    consumed by the write mutation. Every server-controlled column (row
 *    identity, owning session, timestamps) is structurally absent — it
 *    cannot be submitted, spoofed, or widened.
 *
 * Timestamps use the `DateTime` scalar (registered ONCE in
 * `shared/scalar.pothos.ts`, backed by `DateTimeResolver` from
 * `graphql-scalars`): the source `Date` columns serialize to ISO-8601 UTC
 * on the wire — never hand-serialized via `toISOString()` into String
 * fields. `sessionId` is exposed through the builder's ID shape — the
 * numeric PK is never coerced to an Int at the GraphQL boundary.
 *
 * Consumed by the recitation mutation/query resolver modules, whose imports
 * transitively register the types through the `gqlSchema.ts` side-effect
 * chain.
 */
import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import type { RecitationReturnType } from "@/backend/types";

/**
 * The write-path input: exactly the client-controlled fields of a
 * recitation record. `description` is optional on the wire and normalizes
 * to an explicit `null` (never `undefined`) in the resolver's field-by-field
 * mapping — the service's submission whitelist requires it.
 */
export const SessionRecitationInput = gqlSchemaBuilder.inputType("SessionRecitationInput", {
  fields: t => ({
    name: t.string({ required: true }),
    description: t.string({ required: false }),
  }),
});

/**
 * The canonical `SessionRecitation` GraphQL object. Producers return
 * `RecitationReturnType` (the recitation table's derived select row).
 * Field order: `id` first (Apollo cache normalization), owning session id,
 * content columns, then row timestamps.
 */
export const SessionRecitationPothosObject = gqlSchemaBuilder
  .objectRef<RecitationReturnType>("SessionRecitation")
  .implement({
    fields: t => ({
      // ID FIRST — Apollo cache normalization requires `id` on every
      // entity-shaped object (identity PK, surfaced as GraphQL `ID!`).
      id: t.exposeID("id"),
      // Owning session id — the record's 1:1 companion link, exposed as
      // GraphQL `ID!` (cache identity; never an Int coercion).
      sessionId: t.exposeID("sessionId"),
      // Record label — NOT NULL column, non-nullable `String!`.
      name: t.exposeString("name"),
      // Free-form notes — nullable passthrough of the nullable text column.
      description: t.exposeString("description", { nullable: true }),
      // Row timestamps — NOT NULL columns, non-nullable `DateTime!`
      // (registered scalar; ISO-8601 UTC on the wire).
      createdAt: t.expose("createdAt", { type: "DateTime" }),
      updatedAt: t.expose("updatedAt", { type: "DateTime" }),
    }),
  });
