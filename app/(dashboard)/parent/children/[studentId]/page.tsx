import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { UserRole } from "@/backend/enum/users/user-role.enum";
import { withPageAuth } from "@/frontend/lib/auth/withPageAuth";
import { ParentChildDetailContainer } from "@/frontend/views/parent/monitoring";
import { getTranslations } from "@/shared/locale/server";
import { getLocaleFromCookie } from "@/shared/locale/server-cookies";

/**
 * `/parent/children/[studentId]` — the per-child parent read-only
 * monitoring portal detail page.
 *
 * Guard-only Server Component shell:
 *  1. `withPageAuth({ roles: [UserRole.Parent], redirectTo: "/parent/children" })`
 *     is the only authorization boundary. Anonymous callers bounce to
 *     `/login?redirect=/parent/children/<id>`; a role-mismatched caller
 *     bounces to its own role dashboard. Non-parent roles never reach
 *     the container.
 *  2. The `studentId` path segment is coerced to a positive safe
 *     integer. A non-numeric, non-positive, or out-of-safe-range value
 *     redirects to the portal root (`/parent/children`) — the same
 *     fail-closed posture the service-layer `requireLinkedChild` gate
 *     enforces for foreign / nonexistent ids (the constant-shape
 *     denial contract). The server performs NO data fetch: the child
 *     row, tab content, and per-session deep-link target all resolve
 *     client-side through Apollo queries re-keyed on `studentId`.
 *  3. The `?tab=` and `?session=` deep-link values are extracted from
 *     `searchParams` and forwarded as plain props. The client container
 *     validates the tab key (unknown values fall back to the default
 *     tab) and parses the session id (a non-numeric value is dropped).
 *
 * The link-gate authorization (the parent IS the student's `parentId`)
 * is enforced by every backing GraphQL resolver — never trusted to the
 * route shell. A probe against a foreign / unlinked id returns the
 * constant FORBIDDEN shape, rendered as `PermissionDeniedFallback` by
 * the container.
 */

/** First value of a possibly repeated search param, or `null` when absent. */
function firstValueOf(params: Record<string, string | string[] | undefined>, key: string): string | null {
  const value = params[key];
  if (value === undefined) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

interface ParentChildDetailPageProps {
  readonly params: Promise<{ readonly studentId: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocaleFromCookie();
  const t = getTranslations(locale).parentMonitoringTranslations;
  return {
    title: t.portalPageTitle,
    description: t.detailPageSubtitle,
  };
}

export default async function ParentChildDetailPage({
  params,
  searchParams,
}: ParentChildDetailPageProps): Promise<React.ReactElement> {
  await withPageAuth({ roles: [UserRole.Parent], redirectTo: "/parent/children" });

  const { studentId: rawId } = await params;
  const parsedId = Number(rawId);
  if (!Number.isSafeInteger(parsedId) || parsedId <= 0) {
    redirect("/parent/children");
  }

  const sp = await searchParams;
  const tab = firstValueOf(sp, "tab");
  const session = firstValueOf(sp, "session");

  return <ParentChildDetailContainer studentId={parsedId} tab={tab} session={session} />;
}
