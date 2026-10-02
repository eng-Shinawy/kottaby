import type { Metadata } from "next";
import { UserRole } from "@/backend/enum/users/user-role.enum";
import { withPageAuth } from "@/frontend/lib/auth/withPageAuth";
import { MySubscriptionsContainer } from "@/frontend/views/student/subscriptions/MySubscriptionsContainer";
import { getTranslations } from "@/shared/locale/server";
import { getLocaleFromCookie } from "@/shared/locale/server-cookies";

/**
 * `/subscriptions` route — the student's own subscription list, replacing
 * the catch-all ComingSoon stub the student nav entry used to resolve to.
 *
 * This page mirrors the sessions/wallet pages' structure and runs the SAME
 * server guard the dashboard pages use:
 * `withPageAuth({ roles: [UserRole.Student] })` — anonymous callers
 * redirect to `/login?redirect=/subscriptions`; role mismatches bounce to
 * their own role dashboard. The guard is the ONLY authorization boundary;
 * the container performs no role logic (the `mySubscriptions` read scope IS
 * the verified caller identity server-side — identity never derives from
 * the wire, so no cross-user affordance can exist).
 *
 * Metadata is generated dynamically from the active locale (read from the
 * `NEXT_LOCALE` cookie).
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocaleFromCookie();
  const t = getTranslations(locale).checkoutTranslations;
  return {
    title: t.subscriptionsMetaTitle,
  };
}

export default async function SubscriptionsPage() {
  await withPageAuth({ roles: [UserRole.Student], redirectTo: "/subscriptions" });
  return <MySubscriptionsContainer />;
}
