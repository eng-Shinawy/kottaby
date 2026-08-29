"use client";

import { useMutation, useQuery } from "@apollo/client/react";
import { FactCheckOutlined as EmptyStateIcon, ErrorOutlineOutlined as ErrorStateIcon } from "@mui/icons-material";
import { Alert, Box, Button, Skeleton, Snackbar, Stack, Typography } from "@mui/material";
import type { SnackbarCloseReason } from "@mui/material/Snackbar";
import { type ReactNode, useCallback, useRef, useState } from "react";
import type {
  AdminPendingSubscriptionRequestsQuery_adminPendingSubscriptionRequests,
  VerifySubscriptionPaymentMutation,
  VerifySubscriptionPaymentMutationVariables,
} from "@/frontend/graphql/generated/gql/graphql";
import {
  adminPendingSubscriptionRequestsQueryDocument,
  verifySubscriptionPaymentMutationDocument,
} from "@/frontend/graphql/sharedDocuments";
import { VerificationRequestCard } from "@/frontend/views/admin/verifications/VerificationRequestCard";
import { VerifyPaymentDialog } from "@/frontend/views/admin/verifications/VerifyPaymentDialog";
import { PaymentVerification, useAppLocale, useAppTranslation } from "@/shared/locale";
import type { PaymentVerificationLabels } from "@/shared/locale/types/paymentVerification";

/**
 * `PaymentVerificationContainer` — the client-owned admin verification
 * queue (mounted by the `/admin/verifications` server shell) and the
 * DEV1-006 Phase B payment-confirmation strip.
 *
 * Responsibilities:
 *  - DATA: `useQuery(adminPendingSubscriptionRequestsQueryDocument)` —
 *    the server-enforced admin read (every PENDING request, plan +
 *    purchaser embedded, FIFO);
 *  - COPY: `useAppTranslation(PaymentVerification)` — property access
 *    ONLY, no `t("key")` string lookups anywhere on this surface;
 *  - STATES: skeleton cards while in flight → localized empty state →
 *    localized error state with retry → the responsive card grid;
 *  - VERIFY FLOW (real, Phase B): a card's CTA opens ONE shared
 *    verify-payment dialog (keyed by request id — state resets between
 *    requests); confirming fires the `verifySubscriptionPayment` mutation
 *    (server-side guarded `pending → active` + offline-payment stamps).
 *    Success → toast + dialog close + queue refetch (the verified request
 *    disappears from the read). Failure → failure toast, dialog stays
 *    open for a retry in place.
 *
 * Server hand-off (`labels` prop): the `/admin/verifications` shell
 * resolves `getTranslations(locale).paymentVerificationTranslations`
 * server-side and passes the STRING-KEYED subset (RSC props are
 * serialized — the namespace's single formatter cannot cross the
 * boundary); the full tree comes from the client handle below. Precedent:
 * the storefront `/plans` shell ↔ `StudentPlansContainer` merge.
 *
 * MUI v9 discipline: `sx`-only styling through theme-palette tokens,
 * `*Outlined` icons, RTL-safe logical composition (grid + gap), zero
 * hardcoded user-facing strings, zero hardcoded colors.
 */

/**
 * The RSC-serializable slice of {@link PaymentVerificationLabels} the
 * server shell hands down — every member is a plain string; the single
 * formatter key (`verifyDialogBody`) is structurally excluded (it cannot
 * cross the server/client boundary and is only consumed client-side).
 */
export type PaymentVerificationStaticLabels = Omit<PaymentVerificationLabels, "verifyDialogBody">;

export interface PaymentVerificationContainerProps {
  /**
   * Optional server-resolved label subset (property access on
   * `paymentVerificationTranslations`). When omitted — client-only
   * mounts, tests — the container resolves the FULL tree through
   * `useAppTranslation(PaymentVerification)`.
   */
  readonly labels?: PaymentVerificationStaticLabels;
}

/** Request-card loading skeleton — mirrors the real card's outer geometry. */
function RequestCardSkeleton(): ReactNode {
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
      <Skeleton variant="text" width="35%" height={40} />
      <Skeleton variant="rounded" height={84} />
      <Skeleton variant="rounded" height={40} />
    </Box>
  );
}

/** Toast state — copy is pre-resolved from the namespace (no live refs). */
interface VerifyToast {
  readonly id: number;
  readonly copy: string;
  readonly severity: "success" | "error";
}

export function PaymentVerificationContainer({ labels }: Readonly<PaymentVerificationContainerProps>): ReactNode {
  const translated = useAppTranslation(PaymentVerification);
  const locale = useAppLocale();
  const { data, loading, error, refetch } = useQuery(adminPendingSubscriptionRequestsQueryDocument);

  // Server hand-off wins where provided (byte-identical copy to the server
  // shell); the client handle supplies every remaining key — including the
  // dialog-body formatter the dialog interpolates.
  const t: PaymentVerificationLabels = { ...translated, ...labels };

  // ── Verify-payment flow state ─────────────────────────────────────────────
  const [verifyRequest, setVerifyRequest] =
    useState<AdminPendingSubscriptionRequestsQuery_adminPendingSubscriptionRequests | null>(null);
  const [toast, setToast] = useState<VerifyToast | null>(null);
  // Monotonic toast ids — re-opened toasts restart the autohide timer
  // (audit-R4 lesson, mirrored from the storefront container).
  const nextToastIdRef = useRef(0);

  const [verifyPayment, { loading: submitting }] = useMutation<
    VerifySubscriptionPaymentMutation,
    VerifySubscriptionPaymentMutationVariables
  >(verifySubscriptionPaymentMutationDocument, {
    onError: () => {
      // The masking boundary owns unexpected failures; expected domain
      // conflicts (SUBSCRIPTION_ALREADY_RESOLVED, …) surface with localized
      // copy server-side. The toast stays generic + retryable — the dialog
      // remains open so the admin can retry in place.
      setToast({ id: ++nextToastIdRef.current, copy: t.verifyFailedToast, severity: "error" });
    },
    onCompleted: () => {
      setToast({ id: ++nextToastIdRef.current, copy: t.verifySuccessToast, severity: "success" });
      setVerifyRequest(null);
      // Refresh the admin read — the verified request disappears from the
      // queue from REAL server state, never optimistic local guessing (a
      // concurrent verification race is settled by the server's conflict).
      void refetch();
    },
  });

  const openVerify = useCallback(
    (request: AdminPendingSubscriptionRequestsQuery_adminPendingSubscriptionRequests) => setVerifyRequest(request),
    []
  );
  const closeVerify = useCallback(() => {
    if (!submitting) {
      setVerifyRequest(null);
    }
  }, [submitting]);
  const confirmVerify = useCallback(
    (input: { paymentMethod: string; paymentReference: string }) => {
      if (verifyRequest === null || submitting) {
        return;
      }
      void verifyPayment({
        variables: {
          subscriptionId: verifyRequest.id,
          paymentMethod: input.paymentMethod,
          paymentReference: input.paymentReference,
        },
      });
    },
    [verifyRequest, verifyPayment, submitting]
  );
  const dismissToast = useCallback((_event: Event | React.SyntheticEvent, reason: SnackbarCloseReason): void => {
    if (reason === "clickaway") {
      return;
    }
    setToast(null);
  }, []);

  // ── State branches (error → loading → empty → populated) ──────────────────
  let surface: ReactNode;
  if (error) {
    surface = (
      <Stack
        spacing={2}
        sx={{ alignItems: "center", textAlign: "center", py: 8 }}
        role="alert"
        data-testid="admin-verifications-error"
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
        data-testid="admin-verifications-loading"
      >
        {[0, 1, 2].map(offset => (
          <RequestCardSkeleton key={`skeleton-${offset}`} />
        ))}
        <Typography
          sx={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}
          aria-live="polite"
        >
          {t.loading}
        </Typography>
      </Box>
    );
  } else if (data.adminPendingSubscriptionRequests.length === 0) {
    surface = (
      <Stack
        spacing={2}
        sx={{ alignItems: "center", textAlign: "center", py: 8 }}
        data-testid="admin-verifications-empty"
      >
        {/* Decorative icon inside a tinted circular well — the shared admin
            empty-state composition (token-only colors, RTL-safe). */}
        <Box
          aria-hidden
          sx={theme => ({
            width: 88,
            height: 88,
            borderRadius: "50%",
            display: "grid",
            placeItems: "center",
            bgcolor: theme.palette.surfaceContainerHighest,
          })}
        >
          <EmptyStateIcon sx={theme => ({ fontSize: 48, color: theme.palette.text.secondary })} />
        </Box>
        <Typography variant="h6" component="p" sx={{ fontWeight: 700 }}>
          {t.emptyStateTitle}
        </Typography>
        <Typography variant="body2" sx={theme => ({ color: theme.palette.text.secondary, maxWidth: 420 })}>
          {t.emptyStateBody}
        </Typography>
      </Stack>
    );
  } else {
    surface = (
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)", lg: "repeat(3, 1fr)" },
          gap: 2.5,
        }}
        data-testid="admin-verifications-grid"
      >
        {data.adminPendingSubscriptionRequests.map(request => (
          <VerificationRequestCard
            key={request.id}
            request={request}
            labels={t}
            locale={locale}
            onVerify={openVerify}
          />
        ))}
      </Box>
    );
  }

  return (
    <>
      {surface}
      {/* ONE shared verify dialog — every card CTA routes here. Kind-prefixed
          key (audit-CR2): the nonce starts at (and resets to) "idle", and the
          remount on id change resets the dialog's input state. Confirming
          fires the REAL Phase B mutation; the dialog is submit-locked while
          the verification is in flight and STAYS OPEN on failure. */}
      {verifyRequest === null ? null : (
        <VerifyPaymentDialog
          key={`verify-${verifyRequest.id}`}
          request={verifyRequest}
          labels={t}
          locale={locale}
          submitting={submitting}
          onSubmit={confirmVerify}
          onClose={closeVerify}
        />
      )}
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
          data-testid="admin-verifications-toast"
          sx={theme => ({ borderRadius: 2, boxShadow: theme.palette.shadow.card })}
        >
          {toast?.copy}
        </Alert>
      </Snackbar>
    </>
  );
}
