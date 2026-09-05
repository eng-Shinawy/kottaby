import type { Metadata } from "next";
import { withPageAuth } from "@/frontend/lib/auth/withPageAuth";
import { NotificationsFeedContainer } from "@/frontend/views/notifications";
import { getTranslations } from "@/shared/locale/server";
import { getLocaleFromCookie } from "@/shared/locale/server-cookies";

/**
 * `/notifications` — the in-app notification inbox feed.
 *
 * Server Component shell (REQ-063a): an AUTH-ONLY guard (`withPageAuth` with
 * no role whitelist — every role has an inbox, REQ-065) that redirects
 * anonymous callers to `/login?redirect=/notifications`, then delegates the
 * entire surface to the client `NotificationsFeedContainer`
 * (`frontend/views/notifications/`), which pulls its labels through the
 * compile-time `notifications` namespace handle (`useAppTranslation`).
 *
 * The `(dashboard)` route group layout (`DashboardLayout`) still wraps this
 * page with the AppBar + Sidebar shell AND owns the tab's single realtime
 * notification socket (`NotificationRealtimeToastHost`, REQ-067) — the feed
 * consumes the Apollo cache that hook maintains and never mounts its own
 * socket.
 *
 * Metadata is generated from the active locale (`NEXT_LOCALE` cookie) through
 * the shared document-title template.
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocaleFromCookie();
  const t = getTranslations(locale);
  return {
    title: t.commonTranslations.documentTitleTemplate(t.notificationsTranslations.title),
  };
}

export default async function NotificationsPage() {
  await withPageAuth({ redirectTo: "/notifications" });
  return <NotificationsFeedContainer />;
}
