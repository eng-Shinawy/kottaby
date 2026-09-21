import type { Metadata } from "next";
import { UserRole } from "@/backend/enum/users/user-role.enum";
import { withPageAuth } from "@/frontend/lib/auth/withPageAuth";
import { HomeworkContainer } from "@/frontend/views/student/homework/HomeworkContainer";
import { getTranslations } from "@/shared/locale/server";
import { getLocaleFromCookie } from "@/shared/locale/server-cookies";

/**
 * `/homework` route — server component shell that renders the
 * `HomeworkContainer` client component (the student's own homework
 * history).
 *
 * This page REPLACES the catch-all `[feature]` "coming soon" placeholder
 * for the `/homework` segment (the student nav has wired `/homework` since
 * the sidebar shipped). It mirrors the teacher schedule page structure and
 * runs the SAME server guard the dashboard pages use:
 * `withPageAuth({ roles: [UserRole.Student] })` — anonymous callers
 * redirect to `/login?redirect=/homework`; role mismatches bounce to
 * their own role dashboard. The guard is the ONLY authorization boundary;
 * the container performs no role logic (the `myHomework` identity is
 * server-bound per BOPLA hygiene).
 *
 * Metadata is generated dynamically from the active locale (read from the
 * `NEXT_LOCALE` cookie).
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocaleFromCookie();
  const t = getTranslations(locale).homeworkTranslations;
  return {
    title: t.pageTitle,
  };
}

export default async function HomeworkPage() {
  await withPageAuth({ roles: [UserRole.Student], redirectTo: "/homework" });
  return <HomeworkContainer />;
}
