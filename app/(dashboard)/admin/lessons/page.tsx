/**
 * Admin Curriculum Lessons Page — `/admin/lessons`
 *
 * Implements REQ-060, REQ-061 (Task 4.3).
 * Server Component with SSR guard:
 *  - Anonymous -> redirects to `/login?redirect=/admin/lessons`
 *  - Non-admin -> redirects to `/dashboard`
 *  - Admin -> renders LessonsCatalogContainer
 */

import type { Metadata } from "next";
import { UserRole } from "@/backend/enum";
import { withPageAuth } from "@/frontend/lib/auth/withPageAuth";
import { LessonsCatalogContainer } from "@/frontend/views/admin/lessons";
import { getTranslations } from "@/shared/locale/server";
import { getLocaleFromCookie } from "@/shared/locale/server-cookies";

/**
 * REQ-061: the page exposes LOCALIZED link/preview metadata resolved per
 * request from the caller's locale cookie (static `metadata` would pin one
 * language for both ar/en).
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocaleFromCookie();
  const t = getTranslations(locale).lessonsTranslations;
  return {
    title: t.metaTitle,
    description: t.metaDescription,
  };
}

export default async function AdminLessonsPage(): Promise<React.ReactElement> {
  await withPageAuth({ roles: [UserRole.Admin], redirectTo: "/admin/lessons" });
  return <LessonsCatalogContainer />;
}
