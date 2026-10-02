import type { Metadata } from "next";
import { UserRole } from "@/backend/enum/users/user-role.enum";
import { withPageAuth } from "@/frontend/lib/auth/withPageAuth";
import { AdminFinancesContainer } from "@/frontend/views/admin/finances/AdminFinancesContainer";
import { getTranslations } from "@/shared/locale/server";
import { getLocaleFromCookie } from "@/shared/locale/server-cookies";

/**
 * `/admin/finances` — the admin financial auditing console: the payments
 * audit panel, the withdrawal payout queue, and the teacher wallet
 * inspector.
 *
 * Server Component shell:
 *  1. `withPageAuth({ roles: [UserRole.Admin], redirectTo: "/admin/finances" })`
 *     is the only authorization boundary. Anonymous callers bounce to
 *     `/login?redirect=/admin/finances`; any non-admin role bounces to its
 *     own role dashboard. The container performs no role logic — the admin
 *     identity of every financial operation is server-bound, and the
 *     backend operations fail any non-admin into the canonical FORBIDDEN.
 *  2. `AdminFinancesContainer` is a client component (stateful Apollo
 *     `useQuery`/`useMutation` bindings) imported directly from the view
 *     module — no barrel hop. It resolves every label itself through the
 *     `AdminFinance` namespace handle, so the page hands it no props.
 *
 * The admin sidebar (`navItems.ts`) carries the matching `/admin/finances`
 * nav item (`DashboardLabels.finances`, `AccountBalanceOutlined`).
 *
 * Page metadata rides the active locale cookie through the synchronous
 * single-argument `getTranslations(locale)` property chain.
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocaleFromCookie();
  const t = getTranslations(locale).adminFinanceTranslations;
  return {
    title: t.metaTitle,
    description: t.metaDescription,
  };
}

export default async function AdminFinancesPage(): Promise<React.ReactElement> {
  await withPageAuth({ roles: [UserRole.Admin], redirectTo: "/admin/finances" });
  return <AdminFinancesContainer />;
}
