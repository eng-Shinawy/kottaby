/**
 * GraphQL `DateTime` scalar — ISO-8601 UTC instant, serialized via
 * `Date#toISOString()` (e.g. `"2025-01-15T09:30:00.000Z"`).
 *
 * Gate amendment (DEV1-005 Task 3.1): the Pothos registry previously had NO
 * DateTime scalar anywhere — `teachers/applicant.pothos.ts` documents the
 * old workaround of exposing nullable timestamps as ISO-8601 `String` fields
 * (HealthCheck precedent). REQ-060 mandates the `Plan` contract with real
 * `DateTime` fields (`deactivatedAt: DateTime`, `createdAt: DateTime!`,
 * `updatedAt: DateTime!`), so the scalar is introduced here exactly once,
 * registered on the shared `gqlSchemaBuilder`, and pulled into consumers'
 * side-effect chain by their import of this module.
 *
 * Pothos v4 wiring (no `builder.ts` modification required):
 *  - The project builder's `Scalars` slot resolves through Pothos's
 *    `V3DefaultScalars` table (the builder is instantiated with
 *    `Defaults: "v3"` and no `Scalars` override). The module augmentation
 *    below teaches that table about `DateTime` — `Input: Date | string`
 *    (GraphQL variable coercion delivers JSON strings) and `Output: Date`
 *    (resolver-side, matching the drizzle `timestamp` column mode) — so
 *    both the scalar registration and every field referencing it type-check
 *    with real `Date` shapes instead of `unknown`.
 *  - `scalarType("DateTime", ...)` registers the scalar on the builder and
 *    returns the `ScalarRef` that domain Pothos files pass as their field
 *    type (the same ref-based style as the shared enums).
 *
 * Semantics:
 *  - `serialize` — resolver `Date` → ISO-8601 UTC string; the defensive
 *    `String(value)` branch keeps a stray non-Date emission loud and
 *    inspectable instead of crashing on `toISOString`.
 *  - `parseValue` — variable input (JSON string, or an already-built `Date`)
 *    → validated `Date`; an instant that fails `Date` parsing throws instead
 *    of silently propagating `Invalid Date`.
 *
 * There is intentionally NO business logic here — pure transport coercion.
 */
import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";

declare module "@pothos/core" {
  interface V3DefaultScalars {
    DateTime: {
      Input: Date | string;
      Output: Date;
    };
  }
}

export const DateTimePothosScalar = gqlSchemaBuilder.scalarType("DateTime", {
  serialize: value => (value instanceof Date ? value.toISOString() : String(value)),
  // graphql-js hands variable values over as `unknown` — the declared
  // `Input` shape constrains the RETURN of `parseValue`, not its parameter.
  parseValue: value => {
    if (!(value instanceof Date) && typeof value !== "string") {
      throw new TypeError("DateTime scalar accepts only ISO-8601 date-time strings.");
    }

    const parsed = value instanceof Date ? value : new Date(value);

    if (Number.isNaN(parsed.getTime())) {
      throw new TypeError("DateTime scalar accepts only valid ISO-8601 date-time values.");
    }
    return parsed;
  },
});
