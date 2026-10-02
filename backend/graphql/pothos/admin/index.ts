/**
 * Admin-domain Pothos objects barrel — re-exports every object + input type
 * in this sub-directory.
 *
 * Per `backend/graphql/pothos/AGENTS.md`:
 *  - Domain Pothos files are imported directly by the query/mutation files
 *    that consume them; this barrel exists for ergonomic re-export.
 */
export * from "./academic-tracking.pothos";
export * from "./admin-finance.pothos";
export * from "./admin-re-evaluation.pothos";
export * from "./admin-student-onboarding.pothos";
export * from "./admin-students.pothos";
export * from "./admin-teacher-applicants.pothos";
export * from "./admin-teachers.pothos";
export * from "./admin-user.pothos";
export * from "./audit-trail.pothos";
export * from "./platform-analytics.pothos";
