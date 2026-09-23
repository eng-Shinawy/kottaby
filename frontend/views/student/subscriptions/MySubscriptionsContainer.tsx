"use client";

import { useQuery } from "@apollo/client/react";
import { Alert, Button, Stack, Typography } from "@mui/material";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { PermissionDeniedFallback } from "@/frontend/components/ui/PermissionDeniedFallback";
import type { MySubscriptionsQuery_mySubscriptions } from "@/frontend/graphql/generated/gql/graphql";
import { mySubscriptionsQueryDocument } from "@/frontend/graphql/sharedDocuments";
import { extractErrorCode } from "@/frontend/lib/graphql-error-utils";
import { mapGraphQLErrorByCode, normalizeGraphQLErrorCode } from "@/frontend/providers/apollo/error-link.map";
import { STUDENT_PLANS_ROUTE } from "@/frontend/views/student/checkout/result/resultRoutes";
import { SubscriptionCard } from "@/frontend/views/student/subscriptions/SubscriptionCard";
import { SubscriptionsEmptyState } from "@/frontend/views/student/subscriptions/SubscriptionsEmptyState";
import { SubscriptionsSkeleton } from "@/frontend/views/student/subscriptions/SubscriptionsSkeleton";
import {
  SUBSCRIPTIONS_ERROR_TEST_ID,
  SUBSCRIPTIONS_VIEW_TEST_ID,
} from "@/frontend/views/student/subscriptions/subscriptionsViewIds";
import { Checkout, useAppLocale, useAppTranslation } from "@/shared/locale";
import type { CheckoutLabels } from "@/shared/locale/types/checkout";

/**
 * MySubscriptionsContainer — the client orchestrator behind
 * `/subscriptions` (the student's own subscription list).
 *
 * Page-level authorization is owned by the server guard (`withPageAuth`) —
 * this container performs no role logic (the `mySubscriptions` read scope
 * IS the verified caller identity server-side; identity never derives from
 * the wire, so no cross-user affordance can exist).
 *
 * Stateful composition ONLY: `useQuery(mySubscriptionsQueryDocument)` runs
 * statefully (Apollo refetch semantics; `useLazyQuery` is banned per
 * `sharedDocuments/AGENTS.md`) with `fetchPolicy: "cache-and-network"` so a
 * cached list still revalidates against the server on every mount.
 *
 * Render branches (visual state matrix) — the chrome (page title +
 * subtitle) renders in EVERY branch; only the body below it swaps
 * (`SubscriptionsBody`):
 *
 * | # | Condition | Body (below the always-on chrome) |
 * |---|-----------|-----------------------------------|
 * | 1 | query in flight (no settled payload yet) | skeleton rows (`aria-busy`) |
 * | 2 | query error, denial family (`permission-fallback` / `auth-recovery`) | shared `PermissionDeniedFallback` |
 * | 3 | any other query error (masked 500 …) | inline `Alert` with `checkout.genericError` |
 * | 4 | zero rows | empty state (`subscriptionsEmptyTitle` / `subscriptionsEmptyBody`) + browse-plans CTA |
 * | 5 | rows present | subscription cards — lifecycle chip per row, the derived `Payment failed` chip + failed-guidance copy on failed-payment rows |
 *
 * Query-context errors classify through the SINGLE `mapGraphQLErrorByCode`
 * table (`frontend/providers/apollo/error-link.map.ts`) — never the server
 * `message`. All copy resolves through the compile-time `Checkout` handle
 * (property access only).
 */
export function MySubscriptionsContainer(): ReactNode {
  const t = useAppTranslation(Checkout);
  const locale = useAppLocale();
  const router = useRouter();

  // Authoritative read — student-scoped server-side, zero arguments.
  // `cache-and-network` revalidates the cached list on every mount.
  const { data, loading, error, refetch } = useQuery(mySubscriptionsQueryDocument, {
    fetchPolicy: "cache-and-network",
  });

  const subscriptions: readonly MySubscriptionsQuery_mySubscriptions[] = data?.mySubscriptions ?? [];
  const settled = data !== undefined;

  return (
    <Stack data-testid={SUBSCRIPTIONS_VIEW_TEST_ID} sx={{ gap: 3, width: "100%", maxWidth: 960, mx: "auto" }}>
      <Stack sx={{ gap: 1 }}>
        <Typography variant="h4" component="h1" sx={{ fontWeight: 700 }}>
          {t.subscriptionsPageTitle}
        </Typography>
        <Typography variant="body1" sx={theme => ({ color: theme.palette.text.secondary, textWrap: "balance" })}>
          {t.subscriptionsPageSubtitle}
        </Typography>
      </Stack>
      <SubscriptionsBody
        loading={loading}
        queryError={error}
        rows={subscriptions}
        t={t}
        locale={locale}
        settled={settled}
        onRetry={() => router.push(STUDENT_PLANS_ROUTE)}
        onRefetch={() => {
          void refetch();
        }}
      />
    </Stack>
  );
}

interface SubscriptionsBodyProps {
  readonly loading: boolean;
  readonly queryError: unknown;
  readonly rows: readonly MySubscriptionsQuery_mySubscriptions[];
  readonly t: CheckoutLabels;
  readonly locale: string;
  readonly settled: boolean;
  readonly onRetry: () => void;
  readonly onRefetch: () => void;
}

/**
 * The swapping body below the always-on chrome — skeleton / denial
 * fallback / error alert / empty state / subscription rows. The chrome
 * never drops (the user never loses the page context).
 */
function SubscriptionsBody({
  loading,
  queryError,
  rows,
  t,
  locale,
  settled,
  onRetry,
  onRefetch,
}: Readonly<SubscriptionsBodyProps>): ReactNode {
  if (loading && !settled) {
    return <SubscriptionsSkeleton />;
  }
  if (queryError !== undefined && queryError !== null) {
    const rawCode = extractErrorCode(queryError);
    const code = rawCode === null ? "" : normalizeGraphQLErrorCode(rawCode);
    const action = mapGraphQLErrorByCode(code, { contextKind: "query", hasForm: false });
    if (action?.kind === "permission-fallback" || action?.kind === "auth-recovery") {
      return <PermissionDeniedFallback />;
    }
    return (
      <Stack
        data-testid={SUBSCRIPTIONS_ERROR_TEST_ID}
        sx={{ alignItems: "center", justifyContent: "center", gap: 2, minHeight: "calc(100dvh - 240px)" }}
      >
        <Alert severity="error" variant="outlined" sx={{ width: "100%", maxWidth: 360 }}>
          {t.genericError}
        </Alert>
        <Button
          variant="outlined"
          color="error"
          onClick={onRefetch}
          sx={{ width: "100%", maxWidth: 360, minHeight: 44 }}
        >
          {t.retryButton}
        </Button>
      </Stack>
    );
  }
  if (rows.length === 0) {
    return (
      <Stack
        sx={{
          minHeight: "calc(100dvh - 240px)",
          justifyContent: "center",
          alignItems: "stretch",
        }}
      >
        <SubscriptionsEmptyState />
      </Stack>
    );
  }
  return (
    <Stack sx={{ gap: 2, width: "100%" }}>
      {rows.map(row => (
        <SubscriptionCard key={row.id} row={row} t={t} locale={locale} onRetry={onRetry} />
      ))}
    </Stack>
  );
}
