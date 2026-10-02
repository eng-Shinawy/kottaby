import type { Metadata } from "next";
import { UserRole } from "@/backend/enum/users/user-role.enum";
import { withPageAuth } from "@/frontend/lib/auth/withPageAuth";
import { AdminSessionGovernanceContainer } from "@/frontend/views/admin/session-governance/AdminSessionGovernanceContainer";
import { getTranslations } from "@/shared/locale/server";
import { getLocaleFromCookie } from "@/shared/locale/server-cookies";

/**
 * `/admin/session-governance` — the admin session-governance directory:
 * the filterable/paginated directory over ALL sessions plus
 * the four governance operations (reschedule, cancel, teacher reassignment,
 * join-as-observer).
 *
 * Server Component shell:
 *  1. `withPageAuth({ roles: [UserRole.Admin], redirectTo: "/admin/session-governance" })`
 *     is the only authorization boundary. Anonymous callers bounce to
 *     `/login?redirect=/admin/session-governance`; any non-admin role bounces
 *     to its own role dashboard (never the bare `/dashboard` dispatcher — see
 *     `roleDashboardRoute.ts` for the preview-gateway redirect-loop fix). The
 *     container performs no role logic — the admin identity of every
 *     governance operation is server-bound per BOPLA hygiene, and the backend
 *     operations fail any non-admin into the canonical FORBIDDEN.
 *  2. `AdminSessionGovernanceContainer` is a client component (stateful
 *     Apollo `useQuery`/`useMutation` bindings) imported directly from the
 *     view module — no barrel hop. It resolves every label itself through
 *     the `AdminSessionGovernance` namespace handle, so the page hands it
 *     no props.
 *
 * The admin sidebar (`navItems.ts`) carries the matching
 * `/admin/session-governance` nav item (`DashboardLabels.sessionGovernance`,
 * `EventNoteOutlined`).
 *
 * Page metadata rides the active locale cookie through the synchronous
 * single-argument `getTranslations(locale)` property chain.
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocaleFromCookie();
  const t = getTranslations(locale).adminSessionGovernanceTranslations;
  return {
    title: t.pageTitle,
  };
}

export default async function AdminSessionGovernancePage(): Promise<React.ReactElement> {
  await withPageAuth({ roles: [UserRole.Admin], redirectTo: "/admin/session-governance" });
  return <AdminSessionGovernanceContainer />;
}
