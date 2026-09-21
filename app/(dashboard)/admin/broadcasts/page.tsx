import type { Metadata } from "next";
import { UserRole } from "@/backend/enum/users/user-role.enum";
import { withPageAuth } from "@/frontend/lib/auth/withPageAuth";
import { AdminBroadcastsContainer } from "@/frontend/views/admin/broadcasts/AdminBroadcastsContainer";
import { getTranslations } from "@/shared/locale/server";
import { getLocaleFromCookie } from "@/shared/locale/server-cookies";

/**
 * `/admin/broadcasts` — the admin broadcast surface: the History tab (the
 * sent-broadcast directory with the read-only detail drawer and the
 * stop/retraction flow) plus the Compose tab, in one container.
 *
 * Server Component shell:
 *  1. `withPageAuth({ roles: [UserRole.Admin], redirectTo: "/admin/broadcasts" })`
 *     is the only authorization boundary. Anonymous callers bounce to
 *     `/login?redirect=/admin/broadcasts`; any non-admin role bounces to its
 *     own role dashboard (never the bare `/dashboard` dispatcher — see
 *     `roleDashboardRoute.ts` for the preview-gateway redirect-loop fix).
 *  2. `AdminBroadcastsContainer` is a client component (Apollo
 *     `useQuery`/`useMutation` bindings) imported directly from the view
 *     module — no barrel hop. It resolves every label itself through the
 *     `AdminBroadcasts` namespace handle, so the page hands it no props.
 *
 * Page metadata rides the active locale cookie through the synchronous
 * single-argument `getTranslations(locale)` property chain.
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocaleFromCookie();
  const t = getTranslations(locale).adminBroadcastsTranslations;
  return {
    title: t.pageTitle,
    description: t.pageSubtitle,
  };
}

export default async function AdminBroadcastsPage(): Promise<React.ReactElement> {
  await withPageAuth({ roles: [UserRole.Admin], redirectTo: "/admin/broadcasts" });
  return <AdminBroadcastsContainer />;
}
