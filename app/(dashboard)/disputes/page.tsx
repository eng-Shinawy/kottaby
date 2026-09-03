import type { Metadata } from "next";
import { UserRole } from "@/backend/enum/users/user-role.enum";
import { withPageAuth } from "@/frontend/lib/auth/withPageAuth";
import { AdminDisputesContainer } from "@/frontend/views/admin/disputes/AdminDisputesContainer";
import { getTranslations } from "@/shared/locale/server";
import { getLocaleFromCookie } from "@/shared/locale/server-cookies";

/**
 * `/disputes` route (DEV3-005 R-111) — server component shell that renders
 * the `AdminDisputesContainer` arbitration queue.
 *
 * Mirrors the `/student/sessions` page structure: `createRoleDashboardPage`
 * cannot host a custom view (it renders the shared `DashboardView` only), so
 * this page runs the SAME server guard the role dashboards use —
 * `withPageAuth({ roles: [UserRole.Admin] })` — anonymous callers redirect
 * to `/login?redirect=/disputes`; role mismatches bounce to their own role
 * dashboard (via `roleDashboardPath` — never the bare `/dashboard`
 * dispatcher, the preview-gateway loop fix). The guard is the ONLY
 * authorization boundary; the container performs no role logic (the
 * `adminDisputedSessions` admin identity is server-bound per BOPLA hygiene,
 * and the backend query fails any non-admin into the canonical FORBIDDEN).
 *
 * The admin sidebar (`navItems.ts`) carries the matching `/disputes` nav
 * item (`DashboardLabels.disputes`, `GavelOutlined`).
 *
 * Metadata is generated dynamically from the active locale (read from the
 * `NEXT_LOCALE` cookie).
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocaleFromCookie();
  const t = getTranslations(locale).sessionsTranslations;
  return {
    title: t.adminDisputesPageTitle,
  };
}

export default async function AdminDisputesPage() {
  await withPageAuth({ roles: [UserRole.Admin], redirectTo: "/disputes" });
  return <AdminDisputesContainer />;
}
