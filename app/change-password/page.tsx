import type { Metadata } from "next";
import { CHANGE_PASSWORD_PAGE_PATH } from "@/frontend/lib/auth/changePasswordRoute";
import { withPageAuth } from "@/frontend/lib/auth/withPageAuth";
import { ChangePasswordForm } from "@/frontend/views/auth/change-password";
import { getTranslations } from "@/shared/locale/server";
import { getLocaleFromCookie } from "@/shared/locale/server-cookies";

/**
 * `/change-password` — the forced self-service password-change page.
 *
 * Server Component:
 *  1. `withPageAuth({ allowMustChangePassword: true })` — the ONLY page
 *     allowed to pass that option. Every authenticated role passes (no
 *     role whitelist): a user whose account carries the forced-reset flag
 *     must be able to act here regardless of role, and an un-flagged user
 *     may still change their credential voluntarily. The option also keeps
 *     THIS page out of its own fence — the fence redirects every other
 *     page to `/change-password` while the flag is set, so exempting the
 *     target itself is what prevents the redirect loop (the route sits
 *     OUTSIDE the `(dashboard)` group for the same reason: the client
 *     dashboard redirect targets this path).
 *  2. Renders the client form label-free — the form resolves its own
 *     `Auth` namespace client-side via `useAppTranslation`, mirroring the
 *     login / register pages.
 *
 * Anonymous callers redirect to `/login?redirect=/change-password` so the
 * sign-in flow returns them here.
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocaleFromCookie();
  const t = getTranslations(locale).authTranslations;
  return { title: t.changePassword.title };
}

export default async function ChangePasswordPage(): Promise<React.ReactElement> {
  // `redirectTo` single-sources the route constant (the error-link map and
  // the DashboardLayout mirror resolve the same constant) — no consumer
  // re-spells the path.
  await withPageAuth({ allowMustChangePassword: true, redirectTo: CHANGE_PASSWORD_PAGE_PATH });
  return <ChangePasswordForm />;
}
