/**
 * Parents-domain Pothos barrel — re-exports the domain's canonical object
 * definitions (and evaluates them, registering the types on
 * `gqlSchemaBuilder`).
 *
 * The root-field modules in `backend/graphql/query/parents/` +
 * `backend/graphql/mutation/parents/` import the objects directly from the
 * leaf module (`@/backend/graphql/pothos/parents/parent-link-request.pothos`),
 * so these types register through the `gqlSchema.ts` side-effect chain
 * BEFORE `toSchema()` finalizes the SDL — matching the notifications-domain
 * convention. The re-export exists as the import surface for tests and
 * future consumers.
 */
import "./parent-link-request.pothos";

export * from "./parent-link-request.pothos";
