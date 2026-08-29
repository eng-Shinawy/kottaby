import type { Metadata } from "next";
import { UserRole } from "@/backend/enum/users/user-role.enum";
import { withPageAuth } from "@/frontend/lib/auth/withPageAuth";
import { AdminSubscriptionsContainer } from "@/frontend/views/admin/subscriptions";
import { getTranslations } from "@/shared/locale/server";
import { getLocaleFromCookie } from "@/shared/locale/server-cookies";

/**
 * `/admin/subscriptions` route — the admin subscription lifecycle manager
 * (DEV1-009).
 *
 * Server Component shell guarded by `withPageAuth({ roles: [UserRole.Admin] })`:
 *  - anonymous callers → `/login?redirect=%2Fadmin%2Fsubscriptions` (return
 *    path preserved so login can bounce straight back here);
 *  - non-admin roles → their OWN role-specific dashboard via
 *    `roleDashboardPath` (never the bare `/dashboard` dispatcher — the
 *    preview-gateway 301↔308 redirect loop, see `docs/auth/REDIRECT_LOOP_FIX.md`);
 *  - admins → the shell below renders.
 *
 * The server layer performs ZERO GraphQL data fetching here (4.2.3) — the
 * lifecycle list is entirely client-owned and mounts as
 * `AdminSubscriptionsContainer` (Apollo `adminSubscriptions` read + the
 * billing `sharedDocuments`; the cancel dialog is wired inside the
 * container).
 *
 * Translations resolve server-side from the `subscriptionManagement` UI
 * namespace via property access; the STRING-KEYED subset below is handed to
 * the container as its `labels` prop. (RSC props are serialized — the
 * namespace's two formatters `cancelDialogBody` + `pageInfo` cannot cross
 * the boundary, so the container merges this subset over its own
 * client-side `useAppTranslation(SubscriptionManagement)` handle, which
 * also supplies the formatters the dialog and the pagination footer
 * interpolate.) Precedent: the `/admin/verifications` shell ↔
 * `PaymentVerificationContainer` merge.
 *
 * Metadata mirrors the established locale-aware dashboard pattern
 * (`app/(dashboard)/admin/plans/page.tsx`): read the `NEXT_LOCALE` cookie,
 * then derive title/description from the same namespace.
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocaleFromCookie();
  const t = getTranslations(locale).subscriptionManagementTranslations;
  return {
    title: t.pageTitle,
    description: t.pageSubtitle,
  };
}

/** This page's own path — the anonymous-caller login return target. */
const ADMIN_SUBSCRIPTIONS_ROUTE = "/admin/subscriptions";

export default async function AdminSubscriptionsPage(): Promise<React.ReactElement> {
  // Security boundary FIRST — redirects abort the render before any other
  // work (admin-only surface: cancellation is an administrative act).
  await withPageAuth({ roles: [UserRole.Admin], redirectTo: ADMIN_SUBSCRIPTIONS_ROUTE });

  // Locale-aware labels — single-argument `getTranslations` returns the
  // message tree synchronously (see `app/AGENTS.md` → Translations in
  // Server Components); property access on the `subscriptionManagement`
  // namespace only.
  const locale = await getLocaleFromCookie();
  const t = getTranslations(locale).subscriptionManagementTranslations;

  return (
    <main>
      <h1>{t.pageTitle}</h1>
      <p>{t.pageSubtitle}</p>
      <AdminSubscriptionsContainer
        labels={{
          pageTitle: t.pageTitle,
          pageSubtitle: t.pageSubtitle,
          loading: t.loading,
          emptyStateTitle: t.emptyStateTitle,
          emptyStateBody: t.emptyStateBody,
          errorStateTitle: t.errorStateTitle,
          errorStateBody: t.errorStateBody,
          errorStateRetry: t.errorStateRetry,
          filterAll: t.filterAll,
          filterActive: t.filterActive,
          filterPending: t.filterPending,
          filterExpired: t.filterExpired,
          filterCancelled: t.filterCancelled,
          filterSuspended: t.filterSuspended,
          applyFilters: t.applyFilters,
          labelSubscriber: t.labelSubscriber,
          labelPlan: t.labelPlan,
          labelSessions: t.labelSessions,
          labelPrice: t.labelPrice,
          labelStatus: t.labelStatus,
          labelPeriod: t.labelPeriod,
          labelStarted: t.labelStarted,
          labelEnds: t.labelEnds,
          labelNotStarted: t.labelNotStarted,
          labelOpenEnded: t.labelOpenEnded,
          labelPayment: t.labelPayment,
          labelRequestedAt: t.labelRequestedAt,
          cancelCta: t.cancelCta,
          cancelDialogTitle: t.cancelDialogTitle,
          cancelDialogConfirm: t.cancelDialogConfirm,
          cancelDialogDismiss: t.cancelDialogDismiss,
          cancelSuccessToast: t.cancelSuccessToast,
          cancelFailedToast: t.cancelFailedToast,
          rowsPerPage: t.rowsPerPage,
          pagePrev: t.pagePrev,
          pageNext: t.pageNext,
          pagePrevAriaLabel: t.pagePrevAriaLabel,
          pageNextAriaLabel: t.pageNextAriaLabel,
        }}
      />
    </main>
  );
}
