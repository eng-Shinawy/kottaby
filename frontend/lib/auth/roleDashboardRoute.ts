/**
 * Role → dashboard-route resolution for BROWSER-FACING navigations.
 *
 * Paired with the server-side `ROLE_DASHBOARD_ROUTE` map in
 * `app/(dashboard)/dashboard/page.tsx` (the `/dashboard` dispatcher) and
 * with `getNavItemsForRole` in `frontend/views/dashboard/nav/navItems.ts`.
 *
 * ## Why this exists — the preview-gateway trailing-slash loop
 *
 * The `/dashboard` dispatcher works on a direct deployment, but behind the
 * z.ai preview gateway the bare path `/dashboard` is 301-redirected to
 * `/dashboard/` (gateway canonicalization), while Next.js (default
 * `trailingSlash: false`) 308-redirects `/dashboard/` back to `/dashboard`.
 * A browser sent to bare `/dashboard` therefore ping-pongs between the two
 * until Chromium gives up with `ERR_TOO_MANY_REDIRECTS`
 * ("redirected you too many times").
 *
 * Rule that falls out of this (see `docs/auth/REDIRECT_LOOP_FIX.md`):
 * **never navigate the browser to bare `/dashboard`.** Client links, auth
 * bounces, and server-guard fallbacks go straight to the caller's
 * role-specific dashboard — one hop faster than the dispatcher detour and
 * immune to the gateway loop. The `/dashboard` route itself stays online
 * as a server-side deep-link entry point.
 *
 * All values are compared lower-cased on purpose: the backend
 * `UserRole` enum (`@/backend/enum/users/user-role.enum`) carries lowercase
 * string values (`"teacher"`) while the GraphQL codegen `UserRole` enum is
 * capitalized (`"Teacher"`). Normalizing keeps a single helper usable from
 * both client components (codegen enum) and server guards (backend enum).
 */
import { UserRole } from "@/frontend/graphql/generated/gql/graphql";
import { isSafeRedirect } from "@/frontend/lib/safeRedirect";

/** Role-keyed dashboard routes — mirrors the server-side dispatcher map. */
const ROLE_DASHBOARD_ROUTE: Record<UserRole, string> = {
  [UserRole.Admin]: "/admin/dashboard",
  [UserRole.Teacher]: "/teacher/dashboard",
  [UserRole.Student]: "/student/dashboard",
  [UserRole.Parent]: "/parent/dashboard",
};

/**
 * Resolve the role-specific dashboard route for `role`.
 *
 * Accepts either `UserRole` flavor (backend lowercase values or codegen
 * capitalized values) or any raw role string; unknown / null / undefined
 * roles fall back to the student dashboard — the same
 * "smallest common denominator" fallback precedent as
 * `getNavItemsForRole` in `navItems.ts` (least-privileged, always
 * renderable, and never the loop-prone bare `/dashboard`).
 */
export function roleDashboardPath(role: string | UserRole | null | undefined): string {
  switch (role?.toLowerCase()) {
    case UserRole.Admin.toLowerCase():
      return ROLE_DASHBOARD_ROUTE[UserRole.Admin];
    case UserRole.Teacher.toLowerCase():
      return ROLE_DASHBOARD_ROUTE[UserRole.Teacher];
    case UserRole.Student.toLowerCase():
      return ROLE_DASHBOARD_ROUTE[UserRole.Student];
    case UserRole.Parent.toLowerCase():
      return ROLE_DASHBOARD_ROUTE[UserRole.Parent];
    default:
      return ROLE_DASHBOARD_ROUTE[UserRole.Student];
  }
}

/**
 * True when `redirectParam` lands on the bare `/dashboard` dispatcher in ANY
 * of the variants `isSafeRedirect` accepts — `/dashboard`, `/dashboard/`,
 * `/dashboard?from=login`, `/dashboard#section`. Every variant resolves to
 * the same dispatcher pathname the preview gateway ping-pongs (301 ↔ 308,
 * see the module doc), so the comparison must run on the parsed pathname —
 * a literal string check only catches the exact `/dashboard` spelling.
 *
 * Comparison strips trailing slashes and stays case-sensitive (RFC 3986):
 * look-alikes such as `/dashboardx` or `/dashboard/admin` are NOT the
 * dispatcher and remain legitimate redirect targets. Caller contract: run
 * `isSafeRedirect` first — this predicate only classifies, it does not
 * re-validate origin/scheme.
 */
export function isDashboardDispatcherRedirect(redirectParam: string): boolean {
  let pathname: string;
  try {
    // Same-origin safety was already established by `isSafeRedirect`;
    // parsing here only extracts the pathname. A hostile absolute URL would
    // classify by ITS pathname — rejection stays the fail-safe direction.
    pathname = new URL(redirectParam, "http://localhost").pathname;
  } catch {
    return false;
  }
  // Strip trailing slashes without a regex — the anchored-quantifier
  // `/\/+$/` form trips `sonarjs/super-linear-regex`.
  while (pathname.length > 1 && pathname.endsWith("/")) {
    pathname = pathname.slice(0, -1);
  }
  return pathname === "/dashboard";
}

/**
 * Resolve the post-authentication navigation target.
 *
 * Precedence:
 *  1. `redirectParam` when it is a safe same-origin path (per
 *     `isSafeRedirect`) **and** not the `/dashboard` dispatcher path in any
 *     variant (per `isDashboardDispatcherRedirect`) — legacy bookmarks /
 *     old errorLink URLs can still carry `?redirect=%2Fdashboard` (or a
 *     trailing-slash / query / hash decorated form), and navigating there
 *     re-enters the gateway loop above.
 *  2. Otherwise the caller's role-specific dashboard via
 *     `roleDashboardPath`.
 */
export function resolvePostAuthTarget(
  redirectParam: string | null | undefined,
  role: string | UserRole | null | undefined
): string {
  if (redirectParam && isSafeRedirect(redirectParam) && !isDashboardDispatcherRedirect(redirectParam)) {
    return redirectParam;
  }
  return roleDashboardPath(role);
}
