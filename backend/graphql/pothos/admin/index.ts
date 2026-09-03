/**
 * Admin-domain Pothos objects barrel — re-exports every object + input type
 * in this sub-directory.
 *
 * Per `backend/graphql/pothos/AGENTS.md`:
 *  - Domain Pothos files are imported directly by the query/mutation files
 *    that consume them; this barrel exists for ergonomic re-export.
 */
export * from "./admin-user.pothos";
export * from "./audit-trail.pothos";
