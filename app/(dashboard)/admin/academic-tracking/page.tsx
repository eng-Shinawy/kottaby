import type { Metadata } from "next";
import { UserRole } from "@/backend/enum/users/user-role.enum";
import { withPageAuth } from "@/frontend/lib/auth/withPageAuth";
import { AdminAcademicTrackingContainer } from "@/frontend/views/admin/academic-tracking/academic-tracking-dashboard.container";
import { getTranslations } from "@/shared/locale/server";
import { getLocaleFromCookie } from "@/shared/locale/server-cookies";

/**
 * `/admin/academic-tracking` — the admin memorization & revision tracking
 * dashboard.
 *
 * Server Component shell:
 *  1. `withPageAuth({ roles: [UserRole.Admin], redirectTo: "/admin/academic-tracking" })`
 *     is the only authorization boundary. Anonymous callers bounce to
 *     `/login?redirect=/admin/academic-tracking`; any non-admin role
 *     soft-navigates to its own role dashboard (never the bare
 *     `/dashboard` dispatcher — see `roleDashboardRoute.ts`). There is no
 *     dedicated 403 surface: the redirect IS the handling, and deep-link
 *     denials stay sealed server-side by the GraphQL `FORBIDDEN` gate.
 *  2. `AdminAcademicTrackingContainer` is a client component (stateful
 *     Apollo `useQuery` over the dashboard document, per the client-read
 *     discipline) imported directly from the view module — no barrel hop.
 *     It resolves every label itself through the `adminAcademic`
 *     namespace, so the page hands it no props. The page performs ZERO
 *     server data fetching: all reads ride the client query only.
 *
 * Page metadata rides the active locale cookie through the synchronous
 * single-argument `getTranslations(locale)` property chain.
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocaleFromCookie();
  const t = getTranslations(locale).adminAcademicTranslations;
  return { title: t.dashboardPageTitle };
}

export default async function AdminAcademicTrackingPage(): Promise<React.ReactElement> {
  await withPageAuth({ roles: [UserRole.Admin], redirectTo: "/admin/academic-tracking" });
  return <AdminAcademicTrackingContainer />;
}
