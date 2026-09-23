"use client";

import { useQuery } from "@apollo/client/react";
import { Alert, Button, CircularProgress, Stack, Typography } from "@mui/material";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { PermissionDeniedFallback } from "@/frontend/components/ui/PermissionDeniedFallback";
import type { MySubscriptionsQuery_mySubscriptions } from "@/frontend/graphql/generated/gql/graphql";
import { mySubscriptionsQueryDocument } from "@/frontend/graphql/sharedDocuments";
import { extractErrorCode } from "@/frontend/lib/graphql-error-utils";
import { mapGraphQLErrorByCode, normalizeGraphQLErrorCode } from "@/frontend/providers/apollo/error-link.map";
import { ResultArmBody } from "@/frontend/views/student/checkout/result/ResultArmBody";
import {
  hintsIndicateDecline,
  type PaymentResultArm,
  resolveResultArm,
} from "@/frontend/views/student/checkout/result/resultPresentation";
import {
  STUDENT_PLANS_ROUTE,
  STUDENT_SUBSCRIPTIONS_ROUTE,
} from "@/frontend/views/student/checkout/result/resultRoutes";
import {
  PAYMENT_RESULT_ERROR_TEST_ID,
  PAYMENT_RESULT_LOADING_TEST_ID,
  PAYMENT_RESULT_TEST_ID,
} from "@/frontend/views/student/checkout/result/resultViewIds";
import { Checkout, useAppTranslation } from "@/shared/locale";
import type { CheckoutLabels } from "@/shared/locale/types/checkout";

/**
 * The untrusted display-hint record handed over by the server page. It is
 * consumed ONLY by `hintsIndicateDecline` — the negative-zone display
 * refinement that can downgrade a pending display to the failed arm's
 * guidance copy. It can NEVER produce the success arm: a forged or genuine
 * redirect hint reaches nothing positive, because the success branch is
 * gated exclusively on the authoritative re-query returning an ACTIVE row.
 */
type PaymentResultHintParams = Readonly<Record<string, string | string[] | undefined>>;

interface PaymentResultContainerProps {
  /** The raw gateway GET-redirect query params — display hints ONLY. */
  readonly hintParams: PaymentResultHintParams;
}

/**
 * PaymentResultContainer — the client orchestrator behind
 * `/student/checkout/result`.
 *
 * ZERO TRUST IN QUERY PARAMS (the result-page security contract): the
 * gateway's flat GET-redirect parameters (`success`, `pending`, `order`, …)
 * are client-spoofable display hints. The container renders NOTHING positive
 * from them — the authoritative state is the STATEFUL `mySubscriptions`
 * re-query (student-scoped server-side; identity never derives from the
 * wire). The success arm is gated EXCLUSIVELY on the re-query returning an
 * ACTIVE subscription row; a forged `?success=true` with no server truth
 * renders the pending arm (never success). The hint record's ONLY
 * consumption is the negative-zone display refinement
 * (`hintsIndicateDecline`): inside the pending row's negative zone a decline
 * redirect (`success=false`) downgrades the display to the failed arm's
 * guidance copy — a downgrade the hints can never invert into anything
 * positive.
 *
 * Stateful composition ONLY: `useQuery(mySubscriptionsQueryDocument)` runs
 * statefully (Apollo refetch semantics; `useLazyQuery` is banned per
 * `sharedDocuments/AGENTS.md`) with `fetchPolicy: "cache-and-network"` so a
 * cached list still revalidates against the server on every mount — the
 * redirect-returning student always gets the post-settlement truth.
 *
 * Render branches — the arm decision lives in `resolveResultArm`: server
 * truth (the subscription row's lifecycle status) decides the success arm
 * and the negative zone; the display-only hints refine the negative zone
 * only (a decline redirect shows the failed guidance; a pending redirect or
 * no hints keep the still-processing arm). A settled failure renders the
 * denial fallback or the localized generic alert (the sessions-view error
 * table); zero rows or an unresolved lifecycle render pending.
 *
 * | # | Condition | Body |
 * |---|-----------|------|
 * | 1 | re-query in flight (no settled payload) | checking arm (`resultChecking*` copy, `aria-busy`) |
 * | 2 | query error — denial family | shared `PermissionDeniedFallback` |
 * | 3 | any other query error | inline `Alert` with `checkout.genericError` |
 * | 4a | server truth = active subscription | success arm (`resultSuccess*`) |
 * | 4b | server truth = payment failed | failed arm (`resultFailed*`) + retry CTA |
 * | 4c | server truth = pending (incl. zero rows) | pending arm (`resultPending*`) |
 *
 * Money rendering stays OUT of this surface: the row's amount is not part of
 * the subscription selection set, and the localized-EGP amount display is
 * owned by the subscriptions list — the summary renders plan/status/period
 * values straight from the server row.
 *
 * MUI v9 discipline: `sx`-only styling, colors exclusively through
 * `theme.palette.*` callbacks, `*Outlined` icons only, reduced-motion
 * honored (no transition is ever mounted — static arms only).
 */
export function PaymentResultContainer(props: Readonly<PaymentResultContainerProps>): ReactNode {
  // Zero-trust posture: the hint record's ONLY consumption is the
  // negative-zone display refinement below (`hintsIndicateDecline`) — it can
  // never reach the success branch, which is gated on the re-query's ACTIVE
  // row alone. The container destructures the props object exactly once so
  // the untrusted record reaches the refinement without a server-side
  // interpretation layer.
  const { hintParams } = props;
  const t = useAppTranslation(Checkout);
  const router = useRouter();

  // Authoritative re-query — student-scoped server-side, zero arguments.
  // `cache-and-network` keeps the redirect-return fresh: cache-first paint,
  // network revalidation on every mount.
  const { data, loading, error, refetch } = useQuery(mySubscriptionsQueryDocument, {
    fetchPolicy: "cache-and-network",
  });

  const subscriptions: readonly MySubscriptionsQuery_mySubscriptions[] = data?.mySubscriptions ?? [];
  const newest = subscriptions[0];
  const arm: PaymentResultArm | null =
    loading && data === undefined ? null : resolveResultArm(newest?.status, hintsIndicateDecline(hintParams));

  if (error !== undefined) {
    const rawCode = extractErrorCode(error);
    const code = rawCode === null ? "" : normalizeGraphQLErrorCode(rawCode);
    const action = mapGraphQLErrorByCode(code, { contextKind: "query", hasForm: false });
    if (action?.kind === "permission-fallback" || action?.kind === "auth-recovery") {
      return <PermissionDeniedFallback />;
    }
    return (
      <Stack
        data-testid={PAYMENT_RESULT_TEST_ID}
        sx={{ alignItems: "center", justifyContent: "center", gap: 2, minHeight: "calc(100dvh - 32px)" }}
      >
        <Alert
          data-testid={PAYMENT_RESULT_ERROR_TEST_ID}
          severity="error"
          variant="outlined"
          sx={{ width: "100%", maxWidth: 360 }}
        >
          {t.genericError}
        </Alert>
        <Button
          variant="outlined"
          color="error"
          onClick={() => void refetch()}
          sx={{ width: "100%", maxWidth: 360, minHeight: 44 }}
        >
          {t.retryButton}
        </Button>
      </Stack>
    );
  }

  return (
    <Stack
      data-testid={PAYMENT_RESULT_TEST_ID}
      sx={{
        alignItems: "center",
        justifyContent: "center",
        gap: 3,
        minHeight: "calc(100dvh - 32px)",
        py: { xs: 2, sm: 4 },
        px: 1,
      }}
    >
      {arm === null ? (
        <CheckingArm t={t} />
      ) : (
        <ResultArmBody
          arm={arm}
          newest={newest}
          t={t}
          onRetry={() => router.push(STUDENT_PLANS_ROUTE)}
          onView={() => router.push(STUDENT_SUBSCRIPTIONS_ROUTE)}
        />
      )}{" "}
    </Stack>
  );
}

/**
 * The checking arm — announced busy while the authoritative re-query runs.
 * A cache-hit mount (arm resolved with settled data) never flashes this.
 */
function CheckingArm({ t }: Readonly<{ t: CheckoutLabels }>): ReactNode {
  return (
    <Stack
      data-testid={PAYMENT_RESULT_LOADING_TEST_ID}
      component="output"
      aria-busy
      sx={{ alignItems: "center", gap: 2 }}
    >
      <CircularProgress size={32} />
      <Typography variant="h6" component="p" sx={{ textAlign: "center" }}>
        {t.resultCheckingTitle}
      </Typography>
      <Typography variant="body2" component="p" sx={{ textAlign: "center", maxWidth: 300 }}>
        {t.resultCheckingBody}
      </Typography>
    </Stack>
  );
}
