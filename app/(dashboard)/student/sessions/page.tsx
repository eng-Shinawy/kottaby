import type { Metadata } from "next";
import { UserRole } from "@/backend/enum/users/user-role.enum";
import { withPageAuth } from "@/frontend/lib/auth/withPageAuth";
import { StudentSessionsContainer } from "@/frontend/views/student/sessions/StudentSessionsContainer";
import { getTranslations } from "@/shared/locale/server";
import { getLocaleFromCookie } from "@/shared/locale/server-cookies";

/**
 * `/student/sessions` route — server component shell that renders the
 * `StudentSessionsContainer` client component.
 *
 * `createRoleDashboardPage` cannot host a custom view (it renders the shared
 * `DashboardView` only), so this page mirrors the profile-page structure and
 * runs the SAME server guard the dashboard pages use:
 * `withPageAuth({ roles: [UserRole.Student] })` — anonymous callers redirect
 * to `/login?redirect=/student/sessions`; role mismatches bounce to their
 * own role dashboard. The guard is the ONLY authorization boundary; the
 * container performs no role logic (the `myStudentSessions` identity is
 * server-bound per BOPLA hygiene).
 *
 * Metadata is generated dynamically from the active locale (read from the
 * `NEXT_LOCALE` cookie).
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocaleFromCookie();
  const t = getTranslations(locale).sessionsTranslations;
  return {
    title: t.studentPageTitle,
  };
}

export default async function StudentSessionsPage() {
  await withPageAuth({ roles: [UserRole.Student], redirectTo: "/student/sessions" });
  return <StudentSessionsContainer />;
}
