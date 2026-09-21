import type { Metadata } from "next";
import { UserRole } from "@/backend/enum/users/user-role.enum";
import { withPageAuth } from "@/frontend/lib/auth/withPageAuth";
import { ParentChildrenRootContainer } from "@/frontend/views/parent/monitoring";
import { getTranslations } from "@/shared/locale/server";
import { getLocaleFromCookie } from "@/shared/locale/server-cookies";

/**
 * `/parent/children` — the parent read-only monitoring portal root.
 *
 * Guard-only Server Component shell:
 *  1. `withPageAuth({ roles: [UserRole.Parent], redirectTo: "/parent/children" })`
 *     is the only authorization boundary. Anonymous callers bounce to
 *     `/login?redirect=/parent/children`; a role-mismatched caller
 *     bounces to its own role dashboard (never the bare `/dashboard`
 *     dispatcher — see `roleDashboardRoute.ts` for the preview-gateway
 *     redirect-loop fix). Non-parent roles never reach the container.
 *  2. The raw `?student=` value is read from `searchParams` and forwarded
 *     to the client container as a plain prop. The server performs NO
 *     data fetch — no `myLinkedChildren` resolution, no first-child
 *     auto-select, no redirect to `/parent/children/<id>`. The client
 *     container resolves a missing `?student=` AFTER
 *     `useQuery(myLinkedChildrenQueryDocument)` resolves (auto-selects
 *     the first linked child via `router.replace`, or renders the
 *     localized empty state when zero children are linked).
 *  3. The raw `?session=` value (the completion-notification deep-link
 *     pointer) is extracted with the same first-value pattern and
 *     forwarded as a plain prop. The server does NOT resolve it and does
 *     NOT redirect: the client container resolves the pointer through the
 *     `parentSessionTarget` read and replaces the URL with the session's
 *     report landing once the linked child is known — a malformed or
 *     denied pointer degrades to the localized notice + auto-select
 *     fallback entirely client-side.
 *
 * Metadata rides the active locale cookie through the synchronous
 * single-argument `getTranslations(locale)` property chain (the
 * `parentMonitoring` namespace owns the portal copy).
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocaleFromCookie();
  const t = getTranslations(locale).parentMonitoringTranslations;
  return {
    title: t.portalPageTitle,
    description: t.portalPageSubtitle,
  };
}

/** First value of a possibly repeated search param, or `null` when absent. */
function firstValueOf(params: Record<string, string | string[] | undefined>, key: string): string | null {
  const value = params[key];
  if (value === undefined) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

interface ParentChildrenPageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ParentChildrenPage({
  searchParams,
}: ParentChildrenPageProps): Promise<React.ReactElement> {
  await withPageAuth({ roles: [UserRole.Parent], redirectTo: "/parent/children" });

  const sp = await searchParams;
  const rawStudent = sp.student;
  // A repeated `?student=1&student=2` is malformed (the deep-link
  // contract is single-valued) — the array form is dropped to `null`,
  // which the client container treats as "no selection".
  const student = typeof rawStudent === "string" ? rawStudent : null;
  const session = firstValueOf(sp, "session");

  return <ParentChildrenRootContainer student={student} session={session} />;
}
