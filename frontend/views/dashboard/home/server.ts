/**
 * Server-only entry for the dashboard home barrel.
 *
 * `RoleDashboardPage` depends on `withPageAuth` → `next/headers` and the
 * repository layer (pg), so it must never be re-exported from the
 * client-reachable `./index.ts` barrel. Server Component pages import
 * `createRoleDashboardPage` / `roleDashboardMetadata` from this module.
 */
export * from "./RoleDashboardPage";
