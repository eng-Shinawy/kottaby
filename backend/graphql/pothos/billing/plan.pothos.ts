/**
 * PlanPothosObject — the single canonical GraphQL object type for the
 * billing plan catalog (REQ-060 SDL contract, byte-for-byte).
 *
 * Single Canonical Object Type Pattern (`backend/graphql/AGENTS.md`):
 *  - Backed EXCLUSIVELY by the canonical {@link PlanReturnType} from
 *    `@/backend/types` (a deepened read-only view of the drizzle `plans`
 *    select shape) — zero resolver-local type definitions here.
 *  - Exactly the ten contract fields, mapped structurally in REQ-060 order:
 *      id / sessionCount / intervalDays   → `ID!` / `Int!` / `Int!`
 *      title / price / currency           → `String!`
 *      isActive                           → `Boolean!`
 *      deactivatedAt                      → nullable `DateTime`
 *      createdAt / updatedAt              → non-nullable `DateTime`
 *  - NO field-level business logic — every field is a pure structural
 *    exposure or passthrough; the service layer owns all derivations.
 *
 * Rationale for the two contract-critical exposures:
 *  - `id: t.exposeID("id")` — `ID!`, NOT `exposeInt`: the numeric primary
 *    key rides the `ID` scalar so Apollo clients normalize `Plan` entities
 *    by id in their cache (AGENTS.md: "Ensure `id` fields are always exposed
 *    on GraphQL objects so the Apollo client can auto-update its cache").
 *  - `price: t.exposeString("price")` — the drizzle `decimal` column already
 *    maps to `string` at the type boundary; exposing it as `String!`
 *    preserves exact decimal semantics end-to-end. NO `Float` anywhere in
 *    this contract (REQ-060) — binary floats would corrupt monetary values.
 *  - Timestamps ride the `DateTime` scalar registered ONCE in
 *    `shared/datetime.pothos.ts` (DEV1-005 gate amendment — the registry
 *    previously had no DateTime scalar; see that file for the wiring and
 *    the ISO-8601 UTC serialization contract).
 *
 * Least-privilege payload (REQ-033): this object exposes ONLY the ten
 * catalog fields above — no user, subscription, financial, or governance
 * joins. Consumers (Task 3.2/3.3 query/mutation resolvers) import this
 * module, which transitively registers the type through the `gqlSchema.ts`
 * side-effect chain.
 */
import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import { DateTimePothosScalar } from "@/backend/graphql/pothos/shared/datetime.pothos";
import type { PlanReturnType } from "@/backend/types";

export const PlanPothosObject = gqlSchemaBuilder.objectRef<PlanReturnType>("Plan").implement({
  fields: t => ({
    // ID! (numeric PK behind the ID scalar) — Apollo cache normalization.
    id: t.exposeID("id"),
    title: t.exposeString("title"),
    sessionCount: t.exposeInt("sessionCount"),
    // Decimal string — exact decimal semantics; Float is prohibited (REQ-060).
    price: t.exposeString("price"),
    currency: t.exposeString("currency"),
    intervalDays: t.exposeInt("intervalDays"),
    isActive: t.exposeBoolean("isActive"),
    // Nullable lifecycle timestamp (source is `Date | null`).
    deactivatedAt: t.field({
      type: DateTimePothosScalar,
      nullable: true,
      resolve: parent => parent.deactivatedAt,
    }),
    createdAt: t.field({
      type: DateTimePothosScalar,
      resolve: parent => parent.createdAt,
    }),
    updatedAt: t.field({
      type: DateTimePothosScalar,
      resolve: parent => parent.updatedAt,
    }),
  }),
});
