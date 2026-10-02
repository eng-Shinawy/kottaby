/**
 * Single-source route literal for the top-level `/change-password` page —
 * the forced-reset gate target (outside the `(dashboard)` route group).
 *
 * Leaf module on purpose (the `roleDashboardRoute.ts` pattern): it must stay
 * importable from BOTH server-only guards (`withPageAuth`) and client
 * components (`DashboardLayout`, the Apollo error-mapping seam), so it pulls
 * in no server-only or framework module — just the constant. Every consumer
 * redirects here; none re-spells the literal.
 */
export const CHANGE_PASSWORD_PAGE_PATH = "/change-password";
