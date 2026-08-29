"use client";

import { useMutation, useQuery } from "@apollo/client/react";
import { CardMembershipOutlined as EmptyStateIcon, ErrorOutlineOutlined as ErrorStateIcon } from "@mui/icons-material";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Skeleton,
  Snackbar,
  Stack,
  Typography,
} from "@mui/material";
import type { SnackbarCloseReason } from "@mui/material/Snackbar";
import Link from "next/link";
import { type ReactNode, useCallback, useMemo, useRef, useState } from "react";
import type {
  MySubscriptionsQuery_mySubscriptions,
  RequestPlanSubscriptionMutation,
  RequestPlanSubscriptionMutationVariables,
} from "@/frontend/graphql/generated/gql/graphql";
import {
  mySubscriptionsQueryDocument,
  requestPlanSubscriptionMutationDocument,
} from "@/frontend/graphql/sharedDocuments";
import { MySubscriptionCard } from "@/frontend/views/student/subscriptions/MySubscriptionCard";
import { MySubscriptions, useAppLocale, useAppTranslation } from "@/shared/locale";
import type { MySubscriptionsLabels } from "@/shared/locale/types/mySubscriptions";

/**
 * `MySubscriptionsContainer` — the client-owned lifecycle surface mounted
 * by the `/subscriptions` server shell (DEV1-010).
 *
 * Responsibilities:
 *  - DATA: `useQuery(mySubscriptionsQueryDocument)` — the owner-scoped
 *    read (subscriber roles, server-enforced `ctx.user.id` scope): every
 *    subscription of the current user, ANY status, newest first, plan
 *    embedded;
 *  - COPY: `useAppTranslation(MySubscriptions)` — property access ONLY,
 *    no `t("key")` string lookups anywhere on this surface;
 *  - STATES: skeleton cards while in flight → localized empty state with
 *    a browse-plans jump → localized error state with retry → the
 *    overview strip + responsive card grid;
 *  - OVERVIEW STRIP: three count tiles (active / pending / all) derived
 *    from the SAME settled read — server state only, never optimistic
 *    local guessing;
 *  - RENEWAL FLOW: a terminal row (`expired` | `cancelled` |
 *    `suspended`) whose plan is still active and carries NO unresolved
 *    pending request renders a Renew CTA; the CTA opens ONE shared
 *    confirm dialog and submitting fires the REAL
 *    `requestPlanSubscription` mutation (the server re-validates D2 +
 *    the pending fence). Success → toast + dialog close +
 *    `mySubscriptions` refetch (the new PENDING row flips the blocked
 *    postures from refreshed server state). Failure → failure toast, the
 *    dialog stays open for a retry.
 *
 * Server hand-off (`labels` prop): the `/subscriptions` shell resolves
 * `getTranslations(locale).mySubscriptionsTranslations` server-side and
 * passes the STRING-KEYED subset (RSC props are serialized — the
 * namespace's two formatter functions cannot cross the boundary, so the
 * page forwards each label via property access and the full tree —
 * formatters included — comes from the client handle below, which the
 * cards consume in-container). Precedent: the `/plans` storefront merge.
 *
 * MUI v9 discipline: `sx`-only styling through theme-palette tokens,
 * `*Outlined` icons, RTL-safe logical composition (grid + gap), zero
 * hardcoded user-facing strings, zero hardcoded colors.
 */

/**
 * The RSC-serializable slice of {@link MySubscriptionsLabels} the server
 * shell hands down — every member is a plain string; the two formatter
 * keys (`intervalDays`, `renewDialogBody`) are structurally excluded (they
 * cannot cross the server/client boundary and are only consumed
 * client-side).
 */
export type MySubscriptionsStaticLabels = Pick<
  MySubscriptionsLabels,
  | "pageTitle"
  | "pageSubtitle"
  | "loading"
  | "emptyStateTitle"
  | "emptyStateBody"
  | "browsePlansCta"
  | "errorStateTitle"
  | "errorStateBody"
  | "errorStateRetry"
  | "summaryTitle"
  | "summaryActiveLabel"
  | "summaryPendingLabel"
  | "summaryAllLabel"
  | "statusPending"
  | "statusActive"
  | "statusExpired"
  | "statusCancelled"
  | "statusSuspended"
  | "labelStatus"
  | "labelPrice"
  | "labelSessions"
  | "labelInterval"
  | "labelPeriod"
  | "labelStarted"
  | "labelEnds"
  | "labelNotStarted"
  | "labelOpenEnded"
  | "labelPayment"
  | "labelRequestedAt"
  | "renewCta"
  | "renewBlockedPending"
  | "renewUnavailableInactive"
  | "renewDialogTitle"
  | "renewRequestCta"
  | "renewDialogClose"
  | "renewSuccessToast"
  | "renewFailedToast"
>;

export interface MySubscriptionsContainerProps {
  /**
   * Optional server-resolved label subset (property access on
   * `mySubscriptionsTranslations`). When omitted — client-only mounts,
   * tests — the container resolves the FULL tree through
   * `useAppTranslation(MySubscriptions)`.
   */
  readonly labels?: MySubscriptionsStaticLabels;
}

/** Subscription-card loading skeleton — mirrors the real card's outer geometry. */
function SubscriptionCardSkeleton(): ReactNode {
  return (
    <Box
      sx={theme => ({
        borderRadius: 3,
        border: "1px solid",
        borderColor: theme.palette.outlineVariant,
        bgcolor: theme.palette.surfaceContainerLow,
        p: { xs: 2.5, sm: 3 },
        display: "grid",
        gap: 2,
      })}
      aria-busy="true"
    >
      <Skeleton variant="text" width="65%" height={32} />
      <Skeleton variant="text" width="38%" height={40} />
      <Skeleton variant="rounded" height={120} />
      <Skeleton variant="rounded" height={40} />
    </Box>
  );
}

/** One overview-strip count tile — big numeral + caption + accent ring. */
function SummaryTile({
  count,
  caption,
  accentColor,
  testId,
}: Readonly<{
  count: number;
  caption: string;
  accentColor: "success" | "warning" | "neutral";
  testId: string;
}>): ReactNode {
  return (
    <Box
      sx={theme => ({
        borderRadius: 3,
        border: "1px solid",
        borderColor: theme.palette.outlineVariant,
        bgcolor: theme.palette.surfaceContainerLow,
        boxShadow: theme.palette.shadow.card,
        px: { xs: 2, sm: 3 },
        py: { xs: 1.5, sm: 2 },
        display: "grid",
        gap: 0.5,
        justifyItems: "center",
        position: "relative",
        overflow: "hidden",
        "&::before": {
          content: '""',
          position: "absolute",
          insetInlineStart: 0,
          top: 0,
          bottom: 0,
          width: 4,
          bgcolor:
            accentColor === "success"
              ? theme.palette.success.main
              : accentColor === "warning"
                ? theme.palette.warning.main
                : theme.palette.primary.main,
        },
      })}
      data-testid={testId}
    >
      <Typography variant="h4" component="p" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
        {count}
      </Typography>
      <Typography variant="caption" sx={theme => ({ color: theme.palette.text.secondary, fontWeight: 600 })}>
        {caption}
      </Typography>
    </Box>
  );
}

/** Toast state — copy is pre-resolved from the namespace (no live refs). */
interface RenewToast {
  readonly id: number;
  readonly copy: string;
  readonly severity: "success" | "error";
}

/** The dialog's target: the subscription being renewed (plan title rides along). */
type RenewTarget = MySubscriptionsQuery_mySubscriptions;

export function MySubscriptionsContainer({ labels }: Readonly<MySubscriptionsContainerProps>): ReactNode {
  const translated = useAppTranslation(MySubscriptions);
  const locale = useAppLocale();
  const { data, loading, error, refetch } = useQuery(mySubscriptionsQueryDocument);

  // Server hand-off wins where provided (byte-identical copy to the server
  // shell); the client handle supplies every remaining key — including the
  // two formatters the cards + renewal dialog interpolate.
  const t: MySubscriptionsLabels = { ...translated, ...labels };

  // ── Renewal flow state ────────────────────────────────────────────────────
  const [renewTarget, setRenewTarget] = useState<RenewTarget | null>(null);
  const [toast, setToast] = useState<RenewToast | null>(null);
  // Monotonic toast ids — re-opened toasts restart the autohide timer
  // (audit-R4 lesson, mirrored from the storefront container).
  const nextToastIdRef = useRef(0);

  const [submitRenewal, { loading: submitting }] = useMutation<
    RequestPlanSubscriptionMutation,
    RequestPlanSubscriptionMutationVariables
  >(requestPlanSubscriptionMutationDocument, {
    onError: () => {
      // The masking boundary owns unexpected failures; expected domain
      // conflicts (PLAN_INACTIVE, SUBSCRIPTION_REQUEST_EXISTS) surface
      // with localized copy server-side. The toast stays generic +
      // retryable — the dialog remains open so the user can retry in
      // place.
      setToast({ id: ++nextToastIdRef.current, copy: t.renewFailedToast, severity: "error" });
    },
    onCompleted: () => {
      setToast({ id: ++nextToastIdRef.current, copy: t.renewSuccessToast, severity: "success" });
      setRenewTarget(null);
      // Refresh the owner-scoped read — the new PENDING row flips the
      // renew/blocked postures from REAL server state, never optimistic
      // local guessing (a duplicate race is settled by the server's
      // conflict).
      void refetch();
    },
  });

  const openRenewal = useCallback((subscription: RenewTarget) => setRenewTarget(subscription), []);
  const closeRenewal = useCallback(() => {
    if (!submitting) {
      setRenewTarget(null);
    }
  }, [submitting]);
  const confirmRenewal = useCallback(() => {
    if (renewTarget === null || submitting) {
      return;
    }
    void submitRenewal({ variables: { planId: renewTarget.plan.id } });
  }, [renewTarget, submitRenewal, submitting]);
  const dismissToast = useCallback((_event: Event | React.SyntheticEvent, reason: SnackbarCloseReason): void => {
    if (reason === "clickaway") {
      return;
    }
    setToast(null);
  }, []);

  const subscriptions = useMemo(() => data?.mySubscriptions ?? [], [data]);

  // Plan ids with an UNRESOLVED pending request — the renewal fence's
  // client mirror (the server rejects a duplicate pending request).
  const pendingPlanIds = useMemo(
    () =>
      new Set(
        subscriptions
          .filter(subscription => subscription.status === "pending")
          .map(subscription => subscription.plan.id)
      ),
    [subscriptions]
  );

  // Overview counts — derived from the settled read only.
  const activeCount = useMemo(
    () => subscriptions.filter(subscription => subscription.status === "active").length,
    [subscriptions]
  );
  const pendingCount = useMemo(
    () => subscriptions.filter(subscription => subscription.status === "pending").length,
    [subscriptions]
  );

  const canRenew = useCallback(
    (subscription: MySubscriptionsQuery_mySubscriptions): boolean => {
      const terminal =
        subscription.status === "expired" || subscription.status === "cancelled" || subscription.status === "suspended";
      return terminal && subscription.plan.isActive && !pendingPlanIds.has(subscription.plan.id);
    },
    [pendingPlanIds]
  );

  // ── State branches (error → loading → empty → populated) ──────────────────
  let surface: ReactNode;
  if (error) {
    surface = (
      <Stack
        spacing={2}
        sx={{ alignItems: "center", textAlign: "center", py: 8 }}
        role="alert"
        data-testid="my-subscriptions-error"
      >
        <ErrorStateIcon sx={theme => ({ fontSize: 48, color: theme.palette.error.main })} aria-hidden />
        <Typography variant="h6" component="p" sx={{ fontWeight: 700 }}>
          {t.errorStateTitle}
        </Typography>
        <Typography variant="body2" sx={theme => ({ color: theme.palette.text.secondary, maxWidth: 420 })}>
          {t.errorStateBody}
        </Typography>
        <Button variant="outlined" onClick={() => void refetch()} sx={{ borderRadius: 2 }}>
          {t.errorStateRetry}
        </Button>
      </Stack>
    );
  } else if (loading || !data) {
    // `loading || !data` — a settled failure with a cache flush would hand
    // back `data: undefined` alongside `error`; the error branch above has
    // already caught it, so reaching this branch means the read is genuinely
    // without rows to show yet.
    surface = (
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)", lg: "repeat(3, 1fr)" },
          gap: 2.5,
        }}
        aria-busy="true"
        data-testid="my-subscriptions-loading"
      >
        {[0, 1, 2].map(offset => (
          <SubscriptionCardSkeleton key={`skeleton-${offset}`} />
        ))}
        <Typography
          sx={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}
          aria-live="polite"
        >
          {t.loading}
        </Typography>
      </Box>
    );
  } else if (subscriptions.length === 0) {
    surface = (
      <Stack spacing={2} sx={{ alignItems: "center", textAlign: "center", py: 8 }} data-testid="my-subscriptions-empty">
        <EmptyStateIcon sx={theme => ({ fontSize: 48, color: theme.palette.text.secondary })} aria-hidden />
        <Typography variant="h6" component="p" sx={{ fontWeight: 700 }}>
          {t.emptyStateTitle}
        </Typography>
        <Typography variant="body2" sx={theme => ({ color: theme.palette.text.secondary, maxWidth: 420 })}>
          {t.emptyStateBody}
        </Typography>
        <Button
          component={Link}
          href="/plans"
          variant="contained"
          sx={{ borderRadius: 2 }}
          data-testid="my-subscriptions-browse-plans"
        >
          {t.browsePlansCta}
        </Button>
      </Stack>
    );
  } else {
    surface = (
      <Box sx={{ display: "grid", gap: 3 }}>
        {/* Overview strip — three count tiles from the settled read. */}
        <Box sx={{ display: "grid", gap: 1.5 }}>
          <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 700 }}>
            {t.summaryTitle}
          </Typography>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "repeat(3, 1fr)", sm: "repeat(3, minmax(0, 220px))" },
              gap: 1.5,
            }}
          >
            <SummaryTile
              count={activeCount}
              caption={t.summaryActiveLabel}
              accentColor="success"
              testId="my-subscriptions-summary-active"
            />
            <SummaryTile
              count={pendingCount}
              caption={t.summaryPendingLabel}
              accentColor="warning"
              testId="my-subscriptions-summary-pending"
            />
            <SummaryTile
              count={subscriptions.length}
              caption={t.summaryAllLabel}
              accentColor="neutral"
              testId="my-subscriptions-summary-all"
            />
          </Box>
        </Box>

        {/* Lifecycle card grid — newest first (server-ordered). */}
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)", lg: "repeat(3, 1fr)" },
            gap: 2.5,
          }}
          data-testid="my-subscriptions-grid"
        >
          {subscriptions.map(subscription => (
            <MySubscriptionCard
              key={subscription.id}
              subscription={subscription}
              labels={t}
              locale={locale}
              canRenew={canRenew(subscription)}
              planHasPendingRequest={pendingPlanIds.has(subscription.plan.id)}
              onRenew={openRenewal}
            />
          ))}
        </Box>
      </Box>
    );
  }

  return (
    <>
      {surface}
      {/* ONE shared renewal dialog — every card's Renew CTA routes here.
          Kind-prefixed key (audit-CR2): the nonce starts at (and resets to)
          "idle", and bare numeric keys collided across sibling mounts.
          Confirming fires the REAL requestPlanSubscription mutation (the
          server owns the pending fence + D2 re-validation); the dialog is
          submit-locked while the request is in flight. */}
      <Dialog
        key={`renew-${renewTarget?.id ?? "idle"}`}
        open={renewTarget !== null}
        onClose={closeRenewal}
        aria-labelledby="my-subscriptions-renew-title"
        aria-describedby="my-subscriptions-renew-body"
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle id="my-subscriptions-renew-title" sx={{ fontWeight: 700 }}>
          {t.renewDialogTitle}
        </DialogTitle>
        <DialogContent>
          <DialogContentText id="my-subscriptions-renew-body">
            {renewTarget === null ? null : t.renewDialogBody(renewTarget.plan.title)}
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={closeRenewal} disabled={submitting} variant="text" sx={{ borderRadius: 2 }}>
            {t.renewDialogClose}
          </Button>
          <Button
            onClick={confirmRenewal}
            disabled={submitting}
            variant="contained"
            data-testid="my-subscriptions-renew-submit"
            sx={{ borderRadius: 2 }}
            startIcon={submitting ? <CircularProgress size={16} color="inherit" /> : undefined}
          >
            {t.renewRequestCta}
          </Button>
        </DialogActions>
      </Dialog>
      <Snackbar
        key={toast === null ? "toast-idle" : `toast-${toast.id}`}
        open={toast !== null}
        autoHideDuration={6000}
        onClose={dismissToast}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert
          severity={toast?.severity ?? "success"}
          variant="filled"
          data-testid="my-subscriptions-toast"
          sx={theme => ({ borderRadius: 2, boxShadow: theme.palette.shadow.card })}
        >
          {toast?.copy}
        </Alert>
      </Snackbar>
    </>
  );
}
