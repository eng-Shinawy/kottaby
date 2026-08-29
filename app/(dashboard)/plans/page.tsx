import type { Metadata } from "next";
import { UserRole } from "@/backend/enum/users/user-role.enum";
import { withPageAuth } from "@/frontend/lib/auth/withPageAuth";
import { StudentPlansContainer } from "@/frontend/views/student/plans";
import { getTranslations } from "@/shared/locale/server";
import { getLocaleFromCookie } from "@/shared/locale/server-cookies";

/**
 * `/plans` route — the consumer subscription-plans storefront.
 *
 * Server Component shell guarded by
 * `withPageAuth({ roles: [UserRole.Student, UserRole.Parent, UserRole.Teacher] })`:
 *  - anonymous callers → `/login?redirect=%2Fplans` (return path preserved
 *    so login can bounce straight back here);
 *  - admins → their OWN role-specific dashboard via `roleDashboardPath` —
 *    admins browse the catalog through the management-geared `/admin/plans`
 *    surface instead;
 *  - students, parents AND teachers → the shell below renders. Teachers
 *    need the storefront to acquire the New Teacher Verification &
 *    Evaluation plan (the ApplicantStatusCard pending/re-apply CTAs link
 *    here directly).
 *
 * The server layer performs ZERO GraphQL data fetching — the storefront is
 * entirely client-owned and mounts as `StudentPlansContainer` (Apollo
 * `planCatalog` read through the billing `sharedDocuments`; the ACTIVE-only
 * slice is enforced server-side by the service predicate).
 *
 * This specific route takes precedence over the `app/(dashboard)/[feature]`
 * catch-all (which previously rendered the ComingSoonView for `/plans`) per
 * Next.js route resolution.
 *
 * Translations resolve server-side from the `studentPlans` UI namespace via
 * property access; the STRING-KEYED subset below is handed to the container
 * as its `labels` prop (RSC props are serialized — the namespace's two
 * formatter functions cannot cross the boundary, so the container merges
 * this subset over its own client-side `useAppTranslation(StudentPlans)`
 * handle, which also supplies the formatters the cards + notice dialog
 * interpolate).
 *
 * Metadata mirrors the established locale-aware dashboard pattern: read the
 * `NEXT_LOCALE` cookie, then derive title/description from the same
 * namespace.
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocaleFromCookie();
  const t = getTranslations(locale).studentPlansTranslations;
  return {
    title: t.pageTitle,
    description: t.pageSubtitle,
  };
}

/** This page's own path — the anonymous-caller login return target. */
const STUDENT_PLANS_ROUTE = "/plans";

export default async function StudentPlansPage(): Promise<React.ReactElement> {
  // Security boundary FIRST — redirects abort the render before any other
  // work (consumer storefront: students, their parents, and teacher
  // applicants acquiring the verification plan).
  await withPageAuth({
    roles: [UserRole.Student, UserRole.Parent, UserRole.Teacher],
    redirectTo: STUDENT_PLANS_ROUTE,
  });

  // Locale-aware labels — single-argument `getTranslations` returns the
  // message tree synchronously (see `app/AGENTS.md` → Translations in
  // Server Components); property access on the `studentPlans` namespace only.
  const locale = await getLocaleFromCookie();
  const t = getTranslations(locale).studentPlansTranslations;

  return (
    <main>
      <h1>{t.pageTitle}</h1>
      <p>{t.pageSubtitle}</p>
      <StudentPlansContainer
        labels={{
          pageTitle: t.pageTitle,
          pageSubtitle: t.pageSubtitle,
          loading: t.loading,
          emptyStateTitle: t.emptyStateTitle,
          emptyStateBody: t.emptyStateBody,
          errorStateTitle: t.errorStateTitle,
          errorStateBody: t.errorStateBody,
          errorStateRetry: t.errorStateRetry,
          labelSessions: t.labelSessions,
          labelInterval: t.labelInterval,
          subscribeCta: t.subscribeCta,
          activeChip: t.activeChip,
          renewCta: t.renewCta,
          purchasePendingCta: t.purchasePendingCta,
          purchaseDialogTitle: t.purchaseDialogTitle,
          purchaseRequestCta: t.purchaseRequestCta,
          purchaseDialogClose: t.purchaseDialogClose,
          purchaseRequestSuccessToast: t.purchaseRequestSuccessToast,
          purchaseRequestFailedToast: t.purchaseRequestFailedToast,
        }}
      />
    </main>
  );
}
