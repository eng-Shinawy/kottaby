import type { Metadata } from "next";
import { UserRole } from "@/backend/enum/users/user-role.enum";
import { withPageAuth } from "@/frontend/lib/auth/withPageAuth";
import { PlansCatalogContainer } from "@/frontend/views/student/plans/PlansCatalogContainer";
import { getTranslations } from "@/shared/locale/server";
import { getLocaleFromCookie } from "@/shared/locale/server-cookies";

/**
 * `/student/plans` route — the student plan catalog + checkout initiation:
 * browse active plans and start a purchase (confirm dialog →
 * `purchaseSubscription` → hosted-checkout redirect).
 *
 * This page mirrors the student sessions/wallet pages' structure and runs
 * the SAME server guard the dashboard pages use:
 * `withPageAuth({ roles: [UserRole.Student] })` — anonymous callers redirect
 * to `/login?redirect=/student/plans`; role mismatches bounce to their own
 * role dashboard. The guard is the ONLY authorization boundary; the
 * container performs no role logic (the `planCatalog` read is
 * authenticated server-side and the purchase identity is server-bound per
 * BOPLA hygiene — the client sends the plan id only).
 *
 * Metadata is generated dynamically from the active locale (read from the
 * `NEXT_LOCALE` cookie).
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocaleFromCookie();
  const t = getTranslations(locale).checkoutTranslations;
  return {
    title: t.metaTitle,
    description: t.metaDescription,
  };
}

export default async function StudentPlansPage() {
  await withPageAuth({ roles: [UserRole.Student], redirectTo: "/student/plans" });
  return <PlansCatalogContainer />;
}
