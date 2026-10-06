import type { Metadata } from "next";
import { UserRole } from "@/backend/enum/users/user-role.enum";
import { withPageAuth } from "@/frontend/lib/auth/withPageAuth";
import { TeacherDirectoryContainer } from "@/frontend/views/student/teachers/TeacherDirectoryContainer";
import { getTranslations } from "@/shared/locale/server";
import { getLocaleFromCookie } from "@/shared/locale/server-cookies";

/**
 * `/student/teachers` route — the student-facing teacher directory browse:
 * filter certified teachers by Qira'ah recitation + subject intent and
 * browse the resulting PII-minimal cards (paged).
 *
 * This page mirrors the student plans/sessions pages' structure and runs
 * the SAME server guard the dashboard pages use:
 * `withPageAuth({ roles: [UserRole.Student] })` — anonymous callers redirect
 * to `/login?redirect=/student/teachers`; role mismatches bounce to their own
 * role dashboard. The guard is the ONLY authorization boundary; the
 * container performs no role logic (the `browseAvailableTeachers` read is
 * student-gated server-side and the browsing identity is server-bound per
 * BOLA hygiene — the client sends the filter choices only; session
 * requesting is a separate flow and renders no CTA here).
 *
 * Metadata is generated dynamically from the active locale (read from the
 * `NEXT_LOCALE` cookie).
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocaleFromCookie();
  const t = getTranslations(locale).teacherDirectoryTranslations;
  return {
    title: t.browseTitle,
    description: t.browseSubtitle,
  };
}

export default async function StudentTeachersPage() {
  await withPageAuth({ roles: [UserRole.Student], redirectTo: "/student/teachers" });
  return <TeacherDirectoryContainer />;
}
