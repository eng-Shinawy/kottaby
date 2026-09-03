/**
 * Top-level services barrel — re-exports every domain service.
 *
 * Per `backend/services/AGENTS.md`:
 *   - Domain-driven architecture (one namespace per domain).
 *   - No monolithic services.
 *   - All user-facing error messages resolve through `getServerTranslations`.
 */
export * from "./admin";
export * from "./auth";
export * from "./billing";
export * from "./classes";
export * from "./shared";
export * from "./students";
export * from "./teachers";
