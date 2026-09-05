/**
 * Notifications-domain Pothos barrel — re-exports the domain's canonical
 * object definitions, the inbox query's input type, and the admin-broadcast
 * compose inputs.
 *
 * The top-level `backend/graphql/pothos/index.ts` re-exports this module, and
 * `gqlSchema.ts` side-effect-imports that top-level barrel so these object
 * types are registered on `gqlSchemaBuilder` BEFORE `toSchema()` finalizes
 * the SDL. Resolvers import the objects directly from the leaf modules
 * (e.g. `@/backend/graphql/pothos/notifications/notification.pothos`),
 * matching the existing domain conventions.
 */
export * from "./admin-broadcast.pothos";
export * from "./notification.pothos";
export * from "./notification-filter-input.pothos";
export * from "./notification-list-page.pothos";
