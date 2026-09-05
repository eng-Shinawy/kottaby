/**
 * Pothos scalar registry — single canonical registration of every custom
 * GraphQL scalar exposed through the schema.
 *
 * Same discipline as `shared/enum.pothos.ts`:
 *  - Each scalar is registered ONCE here via `addScalarType` — re-registering
 *    the same name is a runtime error ("has already been declared").
 *  - Domain Pothos files reference the scalar by NAME (`type: "DateTime"`);
 *    the backing TypeScript types come from the `Scalars` slot on
 *    `gqlSchemaBuilder` (`backend/graphql/pothos/builder.ts`).
 *  - Registered scalars MUST keep their two sides in sync: the runtime
 *    registration HERE and the `Scalars` typing on the builder.
 *
 * Registered scalars:
 *  - `DateTime` — `DateTimeResolver` from `graphql-scalars`. Serializes
 *    `Date` to an ISO-8601 UTC string; wire format is identical to the old
 *    manual `toISOString()` convention, so existing String consumers are
 *    unaffected. Frontend codegen maps it to `string` (codegen.ts).
 *
 * After registering a new scalar here, update the builder's `Scalars` type,
 * then run `bun run generate:gqlSchema` and `bun codegen` to refresh the SDL
 * + frontend codegen.
 */
import { DateTimeResolver } from "graphql-scalars";
import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";

/** ISO-8601 UTC date-time scalar (serializes `Date`; accepts ISO strings pass-through). */
export const DateTimeScalar = gqlSchemaBuilder.addScalarType("DateTime", DateTimeResolver, {});
