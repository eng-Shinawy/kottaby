import type { Metadata } from "next";
import { UserRole } from "@/backend/enum/users/user-role.enum";
import { withPageAuth } from "@/frontend/lib/auth/withPageAuth";
import { StudentLinkRequestsContainer } from "@/frontend/views/students/link-requests";
import { getTranslations } from "@/shared/locale/server";
import { getLocaleFromCookie } from "@/shared/locale/server-cookies";

/**
 * `/student/link-requests` — the student's incoming parent-link request
 * inbox (DEV1-014 task 4.2).
 *
 * Server Component shell:
 *  1. `withPageAuth({ roles: [UserRole.Student], redirectTo: "/student/link-requests" })`
 *     is the ONLY authorization boundary — anonymous callers bounce to
 *     `/login?redirect=/student/link-requests`, any non-student role bounces
 *     to its OWN role dashboard through `roleDashboardPath(ctx.role)` (bare
 *     `/dashboard` is never a browser redirect target — the preview-gateway
 *     loop, see `roleDashboardRoute.ts`).
 *  2. `getTranslations(locale)` (ONE argument, synchronous) resolves the
 *     full `Translations` tree server-side; the chrome copy for the surface
 *     is projected from the `parentLinkTranslations` namespace.
 *  3. Renders the client container, which resolves every label through the
 *     compile-time `ParentLink` namespace handle and owns the Apollo
 *     `useQuery`/`useMutation` data flow (no server-side GraphQL here).
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocaleFromCookie();
  const t = getTranslations(locale).parentLinkTranslations;
  return {
    title: t.studentPageTitle,
    description: t.studentPageSubtitle,
  };
}

export default async function StudentLinkRequestsPage(): Promise<React.ReactElement> {
  await withPageAuth({ roles: [UserRole.Student], redirectTo: "/student/link-requests" });

  return <StudentLinkRequestsContainer />;
}
