import type { Metadata } from "next";
import { UserRole } from "@/backend/enum/users/user-role.enum";
import { withPageAuth } from "@/frontend/lib/auth/withPageAuth";
import { TeacherSessionsContainer } from "@/frontend/views/teacher/sessions/TeacherSessionsContainer";
import { getTranslations } from "@/shared/locale/server";
import { getLocaleFromCookie } from "@/shared/locale/server-cookies";

/**
 * `/teacher/sessions` route — server component shell that renders the
 * `TeacherSessionsContainer` client component.
 *
 * `createRoleDashboardPage` cannot host a custom view (it renders the shared
 * `DashboardView` only), so this page mirrors the student sessions page
 * structure and runs the SAME server guard the dashboard pages use:
 * `withPageAuth({ roles: [UserRole.Teacher] })` — anonymous callers redirect
 * to `/login?redirect=/teacher/sessions`; role mismatches bounce to their
 * own role dashboard. The guard is the ONLY authorization boundary; the
 * container performs no role logic (the `myTeacherSessions` identity is
 * server-bound per BOPLA hygiene).
 *
 * Metadata is generated dynamically from the active locale (read from the
 * `NEXT_LOCALE` cookie).
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocaleFromCookie();
  const t = getTranslations(locale).sessionsTranslations;
  return {
    title: t.teacherPageTitle,
  };
}

export default async function TeacherSessionsPage() {
  await withPageAuth({ roles: [UserRole.Teacher], redirectTo: "/teacher/sessions" });
  return <TeacherSessionsContainer />;
}
