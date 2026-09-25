/**
 * Admin domain services barrel — re-exports every admin-domain service.
 *
 * Per `backend/services/AGENTS.md`:
 *  - Domain-driven architecture (one namespace per domain).
 *  - No monolithic services.
 *  - All user-facing error messages resolve through `getServerTranslations`.
 */

export * from "./admin-academic-tracking.service";
export * from "./admin-gate.helpers";
export * from "./audit.service";
export * from "./audit-trail.service";
export * from "./cold-start-certification.service";
export * from "./platform-analytics.service";
export * from "./student-directory.service";
export * from "./student-onboarding.service";
export * from "./teacher-applicant-directory.service";
export * from "./teacher-directory.service";
export * from "./user-management.service";
