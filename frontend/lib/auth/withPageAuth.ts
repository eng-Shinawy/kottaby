/**
 * `withPageAuth` — SSR page guard for Server Components.
 *
 * Verifies the caller is authenticated (via `getServerUserContext`, which
 * reads the httpOnly `access_token` cookie — the redirect-loop fix), and
 * optionally checks the caller's role against a whitelist. Redirects to
 * `/login?redirect=<currentPath>` for anonymous callers, or the caller's
 * ROLE-SPECIFIC dashboard for role-mismatched callers. Unless the page
 * opts out via `allowMustChangePassword`, a caller flagged for a forced
 * password reset is fenced to `/change-password` before the role check.
 *
 * Usage in a Server Component page:
 * ```ts
 * import { withPageAuth } from "@/frontend/lib/auth/withPageAuth";
 * import { UserRole } from "@/backend/enum/users/user-role.enum";
 *
 * export default async function StudentDashboardPage() {
 *   const { user, role } = await withPageAuth({ roles: [UserRole.Student] });
 *   return <StudentDashboardView user={user} />;
 * }
 * ```
 *
 * The redirect target for anonymous callers defaults to the current path
 * (passed via the `redirectTo` option or auto-detected from the caller).
 * The login form reads `?redirect=` and navigates there on success.
 *
 * @see docs/auth/REDIRECT_LOOP_FIX.md — the redirect-loop root cause + fix.
 */
import { redirect } from "next/navigation";
import type { UserRole } from "@/backend/enum/users/user-role.enum";
import { getServerUserContext } from "@/backend/lib/auth/server-auth";
import type { RegistrationReturnType } from "@/backend/types";
import { CHANGE_PASSWORD_PAGE_PATH } from "@/frontend/lib/auth/changePasswordRoute";
import { roleDashboardPath } from "@/frontend/lib/auth/roleDashboardRoute";

/** Options for `withPageAuth`. */
export interface WithPageAuthOptions {
  /**
   * Optional role whitelist — if supplied, the caller's `ctx.role` must be
   * in the list (OR semantics). A role mismatch redirects to the caller's
   * role-specific dashboard (see `roleDashboardRoute.ts` — bare
   * `/dashboard` is never used as a browser redirect target).
   */
  readonly roles?: readonly UserRole[];
  /**
   * The path to redirect back to after a successful login. Defaults to the
   * current path. Pass `""` to omit the `?redirect=` param entirely.
   */
  readonly redirectTo?: string;
  /**
   * Forced-reset exemption — reserved for the top-level `/change-password`
   * page itself. When `true`, a caller whose account row carries the
   * forced password-change flag is NOT redirected (the page IS the fence
   * target); every other page keeps the default `false`, which fences a
   * flagged user into `/change-password` after the authentication check and
   * before the role check.
   */
  readonly allowMustChangePassword?: boolean;
}

/** Result of a successful `withPageAuth` check — the verified user context. */
export interface WithPageAuthResult {
  /** Verified user id (non-null after a successful check). */
  readonly userId: number;
  /** Authenticated user (password-stripped). */
  readonly user: RegistrationReturnType;
  /** Verified role. */
  readonly role: UserRole;
}

/**
 * Pure decision for the forced-reset page redirect — true when an
 * authenticated caller is flagged for a password change and the page has not
 * opted out via `allowMustChangePassword`. Extracted so the fence branch is
 * unit-testable without the SSR harness; `withPageAuth` consumes it verbatim.
 */
export function shouldRedirectToChangePassword(
  user: Pick<RegistrationReturnType, "mustChangePassword"> | null | undefined,
  allowMustChangePassword: boolean | undefined
): boolean {
  if (allowMustChangePassword === true) {
    return false;
  }
  return user?.mustChangePassword === true;
}

/**
 * SSR page guard — verifies authentication + forced-reset fence + optional
 * role fit.
 *
 * @returns `{ user, role, userId }` for authenticated callers (or
 *     role-matched if `roles` is supplied). Redirects to
 *     `/login?redirect=<path>` for anonymous callers, to `/change-password`
 *     for flagged callers (unless `allowMustChangePassword` is set), or to
 *     the caller's role-specific dashboard for role-mismatched callers.
 */
export async function withPageAuth(options?: WithPageAuthOptions): Promise<WithPageAuthResult> {
  const ctx = await getServerUserContext();

  if (!ctx.user || !ctx.role || !ctx.userId) {
    // Anonymous — redirect to /login with the return path.
    //
    // Use a RELATIVE path here, never an absolute URL built off
    // `http://localhost:3000`. Building `new URL(path, "http://localhost:3000")`
    // emits a `Location: http://localhost:3000/login?redirect=...` header — when
    // the page is served via the public HTTPS preview gateway (Caddy on a
    // `*.space-z.ai` host), the browser treats this as a public-to-private
    // network navigation and Chrome's Private Network Access (PNA) feature
    // blocks it ("The connection is blocked because it was initiated by a
    // public page to connect to devices or servers on your local network").
    // Next.js's `redirect()` resolves a relative path against the actual
    // request origin (respecting `X-Forwarded-Host` / `X-Forwarded-Proto`),
    // so the redirect stays on the same origin the browser used to reach us.
    const redirectTo = options?.redirectTo ?? "";
    const loginPath = redirectTo ? `/login?redirect=${encodeURIComponent(redirectTo)}` : "/login";
    redirect(loginPath);
  }

  // Forced-reset fence — AFTER authentication, BEFORE the role check, so a
  // flagged caller is fenced into /change-password regardless of role. The
  // flag rides the SAME cached `getServerUserContext()` row the anonymous
  // check just read (react.cache dedupes per request — no extra DB
  // round-trip), and it is DB truth, not a token claim, so an admin-set
  // flag takes effect on the very next navigation.
  if (shouldRedirectToChangePassword(ctx.user, options?.allowMustChangePassword)) {
    redirect(CHANGE_PASSWORD_PAGE_PATH);
  }

  // Role check — OR semantics over the supplied role set.
  if (options?.roles && ctx.role && !options.roles.includes(ctx.role)) {
    // Wrong role — bounce to THEIR role dashboard directly. Bare
    // "/dashboard" works on a direct deployment but is 301'd to
    // "/dashboard/" by the preview gateway (Next 308s it back) — a browser
    // redirect loop (see `roleDashboardRoute.ts`).
    redirect(roleDashboardPath(ctx.role));
  }

  // After the guards above, ctx.user / ctx.role / ctx.userId are all
  // non-null. The non-null assertions are safe here.
  return {
    userId: ctx.userId,
    user: ctx.user,
    role: ctx.role,
  };
}
