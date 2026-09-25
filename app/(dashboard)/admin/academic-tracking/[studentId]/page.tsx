import type { Metadata } from "next";
import { UserRole } from "@/backend/enum/users/user-role.enum";
import { withPageAuth } from "@/frontend/lib/auth/withPageAuth";
import { AdminStudentAcademicDetailContainer } from "@/frontend/views/admin/academic-tracking/student-academic-detail.container";
import { getTranslations } from "@/shared/locale/server";
import { getLocaleFromCookie } from "@/shared/locale/server-cookies";

/**
 * `/admin/academic-tracking/[studentId]` — the per-student academic
 * drill-down page.
 *
 * Server Component shell:
 *  1. `withPageAuth({ roles: [UserRole.Admin], redirectTo: "/admin/academic-tracking" })`
 *     is the only authorization boundary — the identical posture to the
 *     dashboard shell (anonymous → login with the return path, non-admin →
 *     own role dashboard; no dedicated 403 surface).
 *  2. The `studentId` route param is awaited and coerced into the numeric
 *     id the container's read scope expects. The client container (stateful
 *     Apollo `useQuery` over the drill-down document) owns the echo: a
 *     missing or unknown id surfaces through the container's localized
 *     not-found / error arms, while any cross-role reach stays sealed
 *     server-side by the GraphQL constant `FORBIDDEN` gate — the route id
 *     never widens the read scope. The shell performs ZERO server data
 *     fetching and hands over no data props.
 *  3. The shell metadata stays static on the dashboard-chrome title from
 *     the `adminAcademic` namespace; the student-name title renders inside
 *     the container once the echo resolves.
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocaleFromCookie();
  const t = getTranslations(locale).adminAcademicTranslations;
  return { title: t.dashboardPageTitle };
}

interface AdminStudentAcademicDetailPageProps {
  readonly params: Promise<{ readonly studentId: string }>;
}

export default async function AdminStudentAcademicDetailPage({
  params,
}: AdminStudentAcademicDetailPageProps): Promise<React.ReactElement> {
  await withPageAuth({ roles: [UserRole.Admin], redirectTo: "/admin/academic-tracking" });
  const { studentId } = await params;
  return <AdminStudentAcademicDetailContainer studentId={Number(studentId)} />;
}
