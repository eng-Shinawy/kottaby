import type { Metadata } from "next";
import { UserRole } from "@/backend/enum/users/user-role.enum";
import { withPageAuth } from "@/frontend/lib/auth/withPageAuth";
import { PaymentVerificationContainer } from "@/frontend/views/admin/verifications";
import { getTranslations } from "@/shared/locale/server";
import { getLocaleFromCookie } from "@/shared/locale/server-cookies";

/**
 * `/admin/verifications` route — admin payment-verification queue
 * (DEV1-006 Phase B).
 *
 * Server Component shell guarded by `withPageAuth({ roles: [UserRole.Admin] })`:
 *  - anonymous callers → `/login?redirect=%2Fadmin%2Fverifications` (return
 *    path preserved so login can bounce straight back here);
 *  - non-admin roles → their OWN role-specific dashboard via
 *    `roleDashboardPath` (never the bare `/dashboard` dispatcher — the
 *    preview-gateway 301↔308 redirect loop, see `docs/auth/REDIRECT_LOOP_FIX.md`);
 *  - admins → the shell below renders.
 *
 * The server layer performs ZERO GraphQL data fetching here (4.2.3) — the
 * verification queue is entirely client-owned and mounts as
 * `PaymentVerificationContainer` (Apollo `adminPendingSubscriptionRequests`
 * read + the billing `sharedDocuments`; the verify dialog is wired inside
 * the container).
 *
 * Translations resolve server-side from the `paymentVerification` UI
 * namespace via property access; the STRING-KEYED subset below is handed to
 * the container as its `labels` prop. (RSC props are serialized — the
 * namespace's `verifyDialogBody` formatter cannot cross the boundary, so
 * the container merges this subset over its own client-side
 * `useAppTranslation(PaymentVerification)` handle, which also supplies the
 * formatter the dialog interpolates.) Precedent: the `/plans` shell ↔
 * `StudentPlansContainer` merge.
 *
 * Metadata mirrors the established locale-aware dashboard pattern
 * (`app/(dashboard)/admin/plans/page.tsx`): read the `NEXT_LOCALE` cookie,
 * then derive title/description from the same namespace.
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocaleFromCookie();
  const t = getTranslations(locale).paymentVerificationTranslations;
  return {
    title: t.pageTitle,
    description: t.pageSubtitle,
  };
}

/** This page's own path — the anonymous-caller login return target. */
const ADMIN_VERIFICATIONS_ROUTE = "/admin/verifications";

export default async function AdminVerificationsPage(): Promise<React.ReactElement> {
  // Security boundary FIRST — redirects abort the render before any other
  // work (admin-only surface: verification is an administrative act).
  await withPageAuth({ roles: [UserRole.Admin], redirectTo: ADMIN_VERIFICATIONS_ROUTE });

  // Locale-aware labels — single-argument `getTranslations` returns the
  // message tree synchronously (see `app/AGENTS.md` → Translations in
  // Server Components); property access on the `paymentVerification`
  // namespace only.
  const locale = await getLocaleFromCookie();
  const t = getTranslations(locale).paymentVerificationTranslations;

  return (
    <main>
      <h1>{t.pageTitle}</h1>
      <p>{t.pageSubtitle}</p>
      <PaymentVerificationContainer
        labels={{
          pageTitle: t.pageTitle,
          pageSubtitle: t.pageSubtitle,
          loading: t.loading,
          emptyStateTitle: t.emptyStateTitle,
          emptyStateBody: t.emptyStateBody,
          errorStateTitle: t.errorStateTitle,
          errorStateBody: t.errorStateBody,
          errorStateRetry: t.errorStateRetry,
          labelRequestedBy: t.labelRequestedBy,
          labelPlan: t.labelPlan,
          labelSessions: t.labelSessions,
          labelPrice: t.labelPrice,
          labelRequestedAt: t.labelRequestedAt,
          verifyCta: t.verifyCta,
          verifyDialogTitle: t.verifyDialogTitle,
          labelPaymentMethod: t.labelPaymentMethod,
          methodOfflineCash: t.methodOfflineCash,
          methodBankTransfer: t.methodBankTransfer,
          labelPaymentReference: t.labelPaymentReference,
          paymentReferencePlaceholder: t.paymentReferencePlaceholder,
          verifyDialogConfirm: t.verifyDialogConfirm,
          verifyDialogCancel: t.verifyDialogCancel,
          verifySuccessToast: t.verifySuccessToast,
          verifyFailedToast: t.verifyFailedToast,
        }}
      />
    </main>
  );
}
