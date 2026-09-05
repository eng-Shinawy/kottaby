/**
 * Admin Subscription Plans Page — `/admin/plans`
 *
 * Implements REQ-002, REQ-062, REQ-064 (Task 4.2).
 * Server Component with SSR guard:
 *  - Anonymous -> redirects to `/login?redirect=/admin/plans`
 *  - Non-admin -> redirects to `/dashboard`
 *  - Admin -> renders PlanCatalogContainer
 */

import type { Metadata } from "next";
import { UserRole } from "@/backend/enum";
import { withPageAuth } from "@/frontend/lib/auth/withPageAuth";
import { PlanCatalogContainer } from "@/frontend/views/admin/plans";
import { getTranslations } from "@/shared/locale/server";
import { getLocaleFromCookie } from "@/shared/locale/server-cookies";

/**
 * REQ-062: the page exposes LOCALIZED link/preview metadata resolved per
 * request from the caller's locale cookie (static `metadata` would pin one
 * language for both ar/en).
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocaleFromCookie();
  const t = getTranslations(locale).plansTranslations;
  return {
    title: t.metaTitle,
    description: t.metaDescription,
  };
}

export default async function AdminPlansPage(): Promise<React.ReactElement> {
  await withPageAuth({ roles: [UserRole.Admin], redirectTo: "/admin/plans" });
  return <PlanCatalogContainer />;
}
