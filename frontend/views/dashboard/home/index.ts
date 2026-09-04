export * from "./DashboardGettingStartedCard";
export * from "./DashboardStatCard";
export * from "./DashboardView";
// NOTE: `RoleDashboardPage` (server-only — it uses `next/headers` via
// `withPageAuth`) is deliberately NOT exported here. This barrel is imported
// by client components (e.g. `DashboardView`), and re-exporting a
// server-only module from it would pull `next/headers` and the pg driver
// into the client bundle. Server pages import it from "./server" instead.
