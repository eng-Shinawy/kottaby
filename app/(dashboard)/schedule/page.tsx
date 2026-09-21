import type { Metadata } from "next";
import { UserRole } from "@/backend/enum/users/user-role.enum";
import { withPageAuth } from "@/frontend/lib/auth/withPageAuth";
import { ScheduleContainer } from "@/frontend/views/teacher/schedule/ScheduleContainer";
import { getTranslations } from "@/shared/locale/server";
import { getLocaleFromCookie } from "@/shared/locale/server-cookies";

/**
 * `/schedule` route — server component shell that renders the
 * `ScheduleContainer` client component (the teacher weekly planner).
 *
 * This page REPLACES the catch-all `[feature]` "coming soon" placeholder
 * for the `/schedule` segment. It mirrors the teacher sessions page
 * structure and runs the SAME server guard the dashboard pages use:
 * `withPageAuth({ roles: [UserRole.Teacher] })` — anonymous callers
 * redirect to `/login?redirect=/schedule`; role mismatches bounce to
 * their own role dashboard. The guard is the ONLY authorization boundary;
 * the container performs no role logic (the `myTeacherSessions` identity
 * is server-bound per BOPLA hygiene).
 *
 * Metadata is generated dynamically from the active locale (read from the
 * `NEXT_LOCALE` cookie).
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocaleFromCookie();
  const t = getTranslations(locale).scheduleTranslations;
  return {
    title: t.pageTitle,
  };
}

export default async function SchedulePage() {
  await withPageAuth({ roles: [UserRole.Teacher], redirectTo: "/schedule" });
  return <ScheduleContainer />;
}
