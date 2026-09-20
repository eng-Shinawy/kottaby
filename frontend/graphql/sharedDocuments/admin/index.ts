/**
 * Admin-domain GraphQL documents barrel — re-exports every document in this
 * sub-directory.
 *
 * Per `frontend/graphql/sharedDocuments/AGENTS.md`:
 *  - Consumed by views via `@apollo/client/react` hooks.
 *  - Wired through the top-level sharedDocuments barrel.
 */
export * from "./admin-finance.documents";
export * from "./admin-session-governance.documents";
export * from "./admin-students.documents";
export * from "./admin-subscriptions.documents";
export * from "./admin-teacher-applicants.documents";
export * from "./admin-teachers.documents";
export * from "./admin-users.documents";
export * from "./audit-trail.documents";
export * from "./platform-analytics.documents";
export * from "./teacher-certification.documents";
