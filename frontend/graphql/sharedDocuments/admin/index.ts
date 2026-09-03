/**
 * Admin-domain GraphQL documents barrel — re-exports every document in this
 * sub-directory.
 *
 * Per `frontend/graphql/sharedDocuments/AGENTS.md`:
 *  - Consumed by views via `@apollo/client/react` hooks.
 *  - Wired through the top-level sharedDocuments barrel.
 */
export * from "./admin-users.documents";
export * from "./audit-trail.documents";
