/**
 * Admin domain services barrel — re-exports every admin-domain service.
 *
 * Per `backend/services/AGENTS.md`:
 *  - Domain-driven architecture (one namespace per domain).
 *  - No monolithic services.
 *  - All user-facing error messages resolve through `getServerTranslations`.
 */
export * from "./admin-gate.helpers";
export * from "./audit.service";
export * from "./audit-trail.service";
export * from "./cold-start-certification.service";
export * from "./user-management.service";
