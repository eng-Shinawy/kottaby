import type { Metadata } from "next";
import { UserRole } from "@/backend/enum/users/user-role.enum";
import { withPageAuth } from "@/frontend/lib/auth/withPageAuth";
import { PlanCatalogContainer } from "@/frontend/views/admin/plans";
import { getTranslations } from "@/shared/locale/server";
import { getLocaleFromCookie } from "@/shared/locale/server-cookies";

/**
 * `/admin/plans` route — admin plan-catalog page (DEV1-005 REQ-002/REQ-062).
 *
 * Server Component shell guarded by `withPageAuth({ roles: [UserRole.Admin] })`:
 *  - anonymous callers → `/login?redirect=%2Fadmin%2Fplans` (return path
 *    preserved so login can bounce straight back here);
 *  - non-admin roles → their OWN role-specific dashboard via
 *    `roleDashboardPath` (never the bare `/dashboard` dispatcher — the
 *    preview-gateway 301↔308 redirect loop, see `docs/auth/REDIRECT_LOOP_FIX.md`);
 *  - admins → the shell below renders.
 *
 * The server layer performs ZERO GraphQL data fetching here (4.2.3) — the
 * catalog table is entirely client-owned and mounts as Phase 4.3's
 * `PlanCatalogContainer` (Apollo `adminPlans` read + the billing
 * `sharedDocuments`; the create/edit/status dialogs arrive with Task 4.4,
 * wired inside the container).
 *
 * Translations resolve server-side from the `plans` UI namespace via
 * property access; the STRING-KEYED subset below is handed to the container
 * as its `labels` prop. (RSC props are serialized — the namespace's six
 * title-formatter functions cannot cross the boundary, so the container
 * merges this subset over its own client-side `useAppTranslation(Plans)`
 * handle, which also supplies the formatters 4.4's dialogs interpolate.)
 *
 * Metadata mirrors the established locale-aware dashboard pattern
 * (`app/(dashboard)/profile/page.tsx`): read the `NEXT_LOCALE` cookie, then
 * derive title/description from the same namespace.
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocaleFromCookie();
  const t = getTranslations(locale).plansTranslations;
  return {
    title: t.pageTitle,
    description: t.pageSubtitle,
  };
}

/** This page's own path — the anonymous-caller login return target. */
const ADMIN_PLANS_ROUTE = "/admin/plans";

export default async function AdminPlansPage(): Promise<React.ReactElement> {
  // Security boundary FIRST — redirects abort the render before any other
  // work (REQ-064: admin-only surface).
  await withPageAuth({ roles: [UserRole.Admin], redirectTo: ADMIN_PLANS_ROUTE });

  // Locale-aware labels — single-argument `getTranslations` returns the
  // message tree synchronously (see `app/AGENTS.md` → Translations in
  // Server Components); property access on the `plans` namespace only.
  const locale = await getLocaleFromCookie();
  const t = getTranslations(locale).plansTranslations;

  return (
    <main>
      <h1>{t.pageTitle}</h1>
      <p>{t.pageSubtitle}</p>
      <PlanCatalogContainer
        labels={{
          createButton: t.createButton,
          columnTitle: t.columnTitle,
          columnSessionCount: t.columnSessionCount,
          columnPrice: t.columnPrice,
          columnIntervalDays: t.columnIntervalDays,
          columnStatus: t.columnStatus,
          columnActions: t.columnActions,
          actionEdit: t.actionEdit,
          actionActivate: t.actionActivate,
          actionDeactivate: t.actionDeactivate,
          statusActive: t.statusActive,
          statusInactive: t.statusInactive,
          loading: t.loading,
          emptyStateTitle: t.emptyStateTitle,
          emptyStateBody: t.emptyStateBody,
          errorStateTitle: t.errorStateTitle,
          errorStateBody: t.errorStateBody,
          errorStateRetry: t.errorStateRetry,
        }}
      />
    </main>
  );
}
