import type { Metadata } from "next";
import { UserRole } from "@/backend/enum/users/user-role.enum";
import { withPageAuth } from "@/frontend/lib/auth/withPageAuth";
import { MySubscriptionsContainer } from "@/frontend/views/student/subscriptions";
import { getTranslations } from "@/shared/locale/server";
import { getLocaleFromCookie } from "@/shared/locale/server-cookies";

/**
 * `/subscriptions` route — the student-facing "My Subscriptions" lifecycle
 * surface (DEV1-010).
 *
 * Server Component shell guarded by
 * `withPageAuth({ roles: [UserRole.Student, UserRole.Parent, UserRole.Teacher] })`:
 *  - anonymous callers → `/login?redirect=%2Fsubscriptions` (return path
 *    preserved so login can bounce straight back here);
 *  - admins → their OWN role-specific dashboard via `roleDashboardPath` —
 *    admins audit subscriptions through the management-geared
 *    `/admin/subscriptions` surface instead;
 *  - students, parents AND teachers → the shell below renders (all three
 *    roles can hold subscriptions).
 *
 * The server layer performs ZERO GraphQL data fetching — the surface is
 * entirely client-owned and mounts as `MySubscriptionsContainer` (Apollo
 * `mySubscriptions` read through the billing `sharedDocuments`; the
 * owner-scoped slice is enforced server-side by `ctx.user.id`).
 *
 * This specific route takes precedence over the `app/(dashboard)/[feature]`
 * catch-all (which previously rendered the ComingSoonView for
 * `/subscriptions`) per Next.js route resolution.
 *
 * Translations resolve server-side from the `mySubscriptions` UI namespace
 * via property access; the STRING-KEYED subset below is handed to the
 * container as its `labels` prop (RSC props are serialized — the
 * namespace's two formatter functions cannot cross the boundary, so the
 * container merges this subset over its own client-side
 * `useAppTranslation(MySubscriptions)` handle, which also supplies the
 * formatters the cards + renewal dialog interpolate).
 *
 * Metadata mirrors the established locale-aware dashboard pattern: read the
 * `NEXT_LOCALE` cookie, then derive title/description from the same
 * namespace.
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocaleFromCookie();
  const t = getTranslations(locale).mySubscriptionsTranslations;
  return {
    title: t.pageTitle,
    description: t.pageSubtitle,
  };
}

/** This page's own path — the anonymous-caller login return target. */
const MY_SUBSCRIPTIONS_ROUTE = "/subscriptions";

export default async function MySubscriptionsPage(): Promise<React.ReactElement> {
  // Security boundary FIRST — redirects abort the render before any other
  // work (subscriber lifecycle surface: students, their parents, teachers).
  await withPageAuth({
    roles: [UserRole.Student, UserRole.Parent, UserRole.Teacher],
    redirectTo: MY_SUBSCRIPTIONS_ROUTE,
  });

  // Locale-aware labels — single-argument `getTranslations` returns the
  // message tree synchronously (see `app/AGENTS.md` → Translations in
  // Server Components); property access on the `mySubscriptions` namespace
  // only.
  const locale = await getLocaleFromCookie();
  const t = getTranslations(locale).mySubscriptionsTranslations;

  return (
    <main>
      <h1>{t.pageTitle}</h1>
      <p>{t.pageSubtitle}</p>
      <MySubscriptionsContainer
        labels={{
          pageTitle: t.pageTitle,
          pageSubtitle: t.pageSubtitle,
          loading: t.loading,
          emptyStateTitle: t.emptyStateTitle,
          emptyStateBody: t.emptyStateBody,
          browsePlansCta: t.browsePlansCta,
          errorStateTitle: t.errorStateTitle,
          errorStateBody: t.errorStateBody,
          errorStateRetry: t.errorStateRetry,
          summaryTitle: t.summaryTitle,
          summaryActiveLabel: t.summaryActiveLabel,
          summaryPendingLabel: t.summaryPendingLabel,
          summaryAllLabel: t.summaryAllLabel,
          statusPending: t.statusPending,
          statusActive: t.statusActive,
          statusExpired: t.statusExpired,
          statusCancelled: t.statusCancelled,
          statusSuspended: t.statusSuspended,
          labelStatus: t.labelStatus,
          labelPrice: t.labelPrice,
          labelSessions: t.labelSessions,
          labelInterval: t.labelInterval,
          labelPeriod: t.labelPeriod,
          labelStarted: t.labelStarted,
          labelEnds: t.labelEnds,
          labelNotStarted: t.labelNotStarted,
          labelOpenEnded: t.labelOpenEnded,
          labelPayment: t.labelPayment,
          labelRequestedAt: t.labelRequestedAt,
          renewCta: t.renewCta,
          renewBlockedPending: t.renewBlockedPending,
          renewUnavailableInactive: t.renewUnavailableInactive,
          renewDialogTitle: t.renewDialogTitle,
          renewRequestCta: t.renewRequestCta,
          renewDialogClose: t.renewDialogClose,
          renewSuccessToast: t.renewSuccessToast,
          renewFailedToast: t.renewFailedToast,
        }}
      />
    </main>
  );
}
