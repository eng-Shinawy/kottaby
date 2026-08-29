import type { Metadata } from "next";
import { UserRole } from "@/backend/enum/users/user-role.enum";
import { withPageAuth } from "@/frontend/lib/auth/withPageAuth";
import { AuditLogContainer } from "@/frontend/views/admin/audit";
import { getTranslations } from "@/shared/locale/server";
import { getLocaleFromCookie } from "@/shared/locale/server-cookies";

/**
 * `/audit` route — the admin audit-trail viewer (DEV3-020 Phase 1).
 *
 * Server Component shell guarded by `withPageAuth({ roles: [UserRole.Admin] })`:
 *  - anonymous callers → `/login?redirect=%2Faudit` (return path preserved
 *    so login can bounce straight back here);
 *  - non-admin roles → their OWN role-specific dashboard via
 *    `roleDashboardPath` (never the bare `/dashboard` dispatcher — the
 *    preview-gateway 301↔308 redirect loop, see `docs/auth/REDIRECT_LOOP_FIX.md`);
 *  - admins → the shell below renders.
 *
 * The server layer performs ZERO GraphQL data fetching here (4.2.3) — the
 * trail is entirely client-owned and mounts as `AuditLogContainer` (Apollo
 * `adminAuditLogs` read + filter state + pagination; all wiring inside the
 * container).
 *
 * Translations resolve server-side from the `audit` UI namespace via
 * property access; the STRING-KEYED subset below is handed to the container
 * as its `labels` prop. (RSC props are serialized — the namespace's
 * `pageInfo` formatter cannot cross the boundary, so the container merges
 * this subset over its own client-side `useAppTranslation(Audit)` handle,
 * which also supplies the formatter the pagination footer interpolates.)
 * Precedent: the `/admin/verifications` shell ↔ `PaymentVerificationContainer`
 * merge.
 *
 * Metadata mirrors the established locale-aware dashboard pattern
 * (`app/(dashboard)/admin/plans/page.tsx`): read the `NEXT_LOCALE` cookie,
 * then derive title/description from the same namespace.
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocaleFromCookie();
  const t = getTranslations(locale).auditTranslations;
  return {
    title: t.pageTitle,
    description: t.pageSubtitle,
  };
}

/** This page's own path — the anonymous-caller login return target. */
const AUDIT_ROUTE = "/audit";

export default async function AuditLogPage(): Promise<React.ReactElement> {
  // Security boundary FIRST — redirects abort the render before any other
  // work (admin-only surface: the trail is a forensic administrative read).
  await withPageAuth({ roles: [UserRole.Admin], redirectTo: AUDIT_ROUTE });

  // Locale-aware labels — single-argument `getTranslations` returns the
  // message tree synchronously (see `app/AGENTS.md` → Translations in
  // Server Components); property access on the `audit` namespace only.
  const locale = await getLocaleFromCookie();
  const t = getTranslations(locale).auditTranslations;

  return (
    <main>
      <h1>{t.pageTitle}</h1>
      <p>{t.pageSubtitle}</p>
      <AuditLogContainer
        labels={{
          pageTitle: t.pageTitle,
          pageSubtitle: t.pageSubtitle,
          loading: t.loading,
          emptyStateTitle: t.emptyStateTitle,
          emptyStateBody: t.emptyStateBody,
          errorStateTitle: t.errorStateTitle,
          errorStateBody: t.errorStateBody,
          errorStateRetry: t.errorStateRetry,
          labelActionType: t.labelActionType,
          filterActionAll: t.filterActionAll,
          labelEntityType: t.labelEntityType,
          filterEntityAll: t.filterEntityAll,
          labelActorId: t.labelActorId,
          labelEntityId: t.labelEntityId,
          labelDateFrom: t.labelDateFrom,
          labelDateTo: t.labelDateTo,
          applyFilters: t.applyFilters,
          clearFilters: t.clearFilters,
          invalidDateRange: t.invalidDateRange,
          colTimestamp: t.colTimestamp,
          colActor: t.colActor,
          colAction: t.colAction,
          colEntity: t.colEntity,
          colEntityId: t.colEntityId,
          colDetails: t.colDetails,
          detailsEmpty: t.detailsEmpty,
          actionCreate: t.actionCreate,
          actionUpdate: t.actionUpdate,
          actionDelete: t.actionDelete,
          actionOverride: t.actionOverride,
          actionAdjust: t.actionAdjust,
          actionSuspend: t.actionSuspend,
          actionReactivate: t.actionReactivate,
          entityPlans: t.entityPlans,
          entitySubscriptions: t.entitySubscriptions,
          entityOther: t.entityOther,
          paginationPrev: t.paginationPrev,
          paginationNext: t.paginationNext,
          tableSummary: t.tableSummary,
          rowsPerPage: t.rowsPerPage,
        }}
      />
    </main>
  );
}
