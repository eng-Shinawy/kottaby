import type { Metadata } from "next";
import { UserRole } from "@/backend/enum/users/user-role.enum";
import { withPageAuth } from "@/frontend/lib/auth/withPageAuth";
import { BroadcastComposeContainer } from "@/frontend/views/admin/broadcasts/BroadcastComposeContainer";
import { getTranslations } from "@/shared/locale/server";
import { getLocaleFromCookie } from "@/shared/locale/server-cookies";

/**
 * `/admin/broadcasts` — the admin broadcast composer.
 *
 * Server Component shell:
 *  1. `withPageAuth({ roles: [UserRole.Admin], redirectTo: "/admin/broadcasts" })`
 *     is the only authorization boundary. Anonymous callers bounce to
 *     `/login?redirect=/admin/broadcasts`; any non-admin role bounces to its
 *     own role dashboard (never the bare `/dashboard` dispatcher — see
 *     `roleDashboardRoute.ts` for the preview-gateway redirect-loop fix).
 *  2. `BroadcastComposeContainer` is a client component (Apollo `useMutation`
 *     send flow + live compose state) imported directly from the view module —
 *     no barrel hop. It resolves every compose label itself through the
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
  return <BroadcastComposeContainer />;
}
