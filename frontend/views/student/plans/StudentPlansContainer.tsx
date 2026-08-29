"use client";

import { useMutation, useQuery } from "@apollo/client/react";
import { Inventory2Outlined as EmptyStateIcon, ErrorOutlineOutlined as ErrorStateIcon } from "@mui/icons-material";
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
import { type ReactNode, useCallback, useRef, useState } from "react";
import type {
  PlanCatalogQuery_planCatalog,
  RequestPlanSubscriptionMutation,
  RequestPlanSubscriptionMutationVariables,
} from "@/frontend/graphql/generated/gql/graphql";
import {
  mySubscriptionsQueryDocument,
  planCatalogQueryDocument,
  requestPlanSubscriptionMutationDocument,
} from "@/frontend/graphql/sharedDocuments";
import { StudentPlanCard } from "@/frontend/views/student/plans/StudentPlanCard";
import { StudentPlans, useAppTranslation } from "@/shared/locale";
import type { StudentPlansLabels } from "@/shared/locale/types/studentPlans";

/**
 * `StudentPlansContainer` — the client-owned consumer storefront (mounted by
 * the `/plans` server shell) and the DEV1-006 Phase A purchase-flow landing
 * strip.
 *
 * Responsibilities:
 *  - DATA: `useQuery(planCatalogQueryDocument)` (server-enforced consumer
 *    read: ANY subscriber role, ACTIVE slice only) PLUS
 *    `useQuery(mySubscriptionsQueryDocument)` — the owner-scoped read whose
 *    PENDING rows derive the per-plan requested state;
 *  - COPY: `useAppTranslation(StudentPlans)` — property access ONLY, no
 *    `t("key")` string lookups anywhere on this surface;
 *  - STATES: skeleton cards while in flight → localized empty state →
 *    localized error state with retry → the responsive card grid;
 *  - SUBSCRIBE FLOW (real, Phase A): card CTAs open ONE shared
 *    purchase-request dialog; submitting fires the
 *    `requestPlanSubscription` mutation (server-side D2 re-validation +
 *    PENDING insert). Success → toast + dialog close + `mySubscriptions`
 *    refetch (the card flips to its pending posture from the refreshed
 *    owner-scoped read). Failure → failure toast, dialog stays open for a
 *    retry. The pending CTA posture lives in the card (chip + disabled
 *    button), derived here and handed down as `hasPendingRequest`.
 *
 * Server hand-off (`labels` prop): the `/plans` shell resolves
 * `getTranslations(locale).studentPlansTranslations` server-side and passes
 * the STRING-KEYED subset (RSC props are serialized — the namespace's two
 * formatter functions cannot cross the boundary, so the page forwards each
 * label via property access and the full tree — formatters included — comes
 * from the client handle below, which the cards consume in-container).
 * Precedent: the admin `/admin/plans` shell ↔ `PlanCatalogContainer` merge.
 *
 * MUI v9 discipline: `sx`-only styling through theme-palette tokens,
 * `*Outlined` icons, RTL-safe logical composition (grid + gap), zero
 * hardcoded user-facing strings, zero hardcoded colors.
 */

/**
 * The RSC-serializable slice of {@link StudentPlansLabels} the server shell
 * hands down — every member is a plain string; the two formatter keys
 * (`intervalDays`, `purchaseDialogBody`) are structurally excluded (they
 * cannot cross the server/client boundary and are only consumed client-side).
 */
export type StudentPlansStaticLabels = Pick<
  StudentPlansLabels,
  | "pageTitle"
  | "pageSubtitle"
  | "loading"
  | "emptyStateTitle"
  | "emptyStateBody"
  | "errorStateTitle"
  | "errorStateBody"
  | "errorStateRetry"
  | "labelSessions"
  | "labelInterval"
  | "subscribeCta"
  | "purchasePendingCta"
  | "purchaseDialogTitle"
  | "purchaseRequestCta"
  | "purchaseDialogClose"
  | "purchaseRequestSuccessToast"
  | "purchaseRequestFailedToast"
>;

export interface StudentPlansContainerProps {
  /**
   * Optional server-resolved label subset (property access on
   * `studentPlansTranslations`). When omitted — client-only mounts, tests —
   * the container resolves the FULL tree through
   * `useAppTranslation(StudentPlans)`.
   */
  readonly labels?: StudentPlansStaticLabels;
}

/** Plan-card loading skeleton — mirrors the real card's outer geometry. */
function PlanCardSkeleton(): ReactNode {
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
      <Skeleton variant="text" width="70%" height={32} />
      <Skeleton variant="text" width="40%" height={40} />
      <Skeleton variant="rounded" height={52} />
      <Skeleton variant="rounded" height={40} />
    </Box>
  );
}

/** Toast state — copy is pre-resolved from the namespace (no live refs). */
interface RequestToast {
  readonly id: number;
  readonly copy: string;
  readonly severity: "success" | "error";
}

export function StudentPlansContainer({ labels }: Readonly<StudentPlansContainerProps>): ReactNode {
  const translated = useAppTranslation(StudentPlans);
  const { data, loading, error, refetch } = useQuery(planCatalogQueryDocument);
  const { data: mySubscriptionsData, refetch: refetchMySubscriptions } = useQuery(mySubscriptionsQueryDocument);

  // Server hand-off wins where provided (byte-identical copy to the server
  // shell); the client handle supplies every remaining key — including the
  // two formatters the cards + request dialog interpolate.
  const t: StudentPlansLabels = { ...translated, ...labels };

  // ── Subscribe-request flow state ──────────────────────────────────────────
  const [requestPlan, setRequestPlan] = useState<PlanCatalogQuery_planCatalog | null>(null);
  const [toast, setToast] = useState<RequestToast | null>(null);
  // Monotonic toast ids — re-opened toasts restart the autohide timer
  // (audit-R4 lesson, mirrored from the admin catalog container).
  const nextToastIdRef = useRef(0);

  const [submitRequest, { loading: submitting }] = useMutation<
    RequestPlanSubscriptionMutation,
    RequestPlanSubscriptionVariablesAlias
  >(requestPlanSubscriptionMutationDocument, {
    onError: () => {
      // The masking boundary owns unexpected failures; expected domain
      // conflicts (PLAN_INACTIVE, SUBSCRIPTION_REQUEST_EXISTS) surface with
      // localized copy server-side. The toast stays generic + retryable —
      // the dialog remains open so the user can retry in place.
      setToast({ id: ++nextToastIdRef.current, copy: t.purchaseRequestFailedToast, severity: "error" });
    },
    onCompleted: () => {
      setToast({ id: ++nextToastIdRef.current, copy: t.purchaseRequestSuccessToast, severity: "success" });
      setRequestPlan(null);
      // Refresh the owner-scoped read — the requested plan's card flips to
      // its pending posture from REAL server state, never optimistic local
      // guessing (a duplicate race is settled by the server's conflict).
      void refetchMySubscriptions();
    },
  });

  const openRequest = useCallback((plan: PlanCatalogQuery_planCatalog) => setRequestPlan(plan), []);
  const closeRequest = useCallback(() => {
    if (!submitting) {
      setRequestPlan(null);
    }
  }, [submitting]);
  const confirmRequest = useCallback(() => {
    if (requestPlan === null || submitting) {
      return;
    }
    void submitRequest({ variables: { planId: requestPlan.id } });
  }, [requestPlan, submitRequest, submitting]);
  const dismissToast = useCallback((_event: Event | React.SyntheticEvent, reason: SnackbarCloseReason): void => {
    if (reason === "clickaway") {
      return;
    }
    setToast(null);
  }, []);

  // Pending-request plan ids — the set of plan ids with an UNRESOLVED
  // pending subscription from the current user. Apollo normalizes both
  // reads' plan rows onto `Plan:<id>`, so the plain string id comparison
  // is the correct join key.
  const pendingPlanIds = new Set(
    (mySubscriptionsData?.mySubscriptions ?? [])
      .filter(subscription => subscription.status === "pending")
      .map(subscription => subscription.plan.id)
  );

  // ── State branches (error → loading → empty → populated) ──────────────────
  let surface: ReactNode;
  if (error) {
    surface = (
      <Stack
        spacing={2}
        sx={{ alignItems: "center", textAlign: "center", py: 8 }}
        role="alert"
        data-testid="student-plans-error"
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
        data-testid="student-plans-loading"
      >
        {[0, 1, 2].map(offset => (
          <PlanCardSkeleton key={`skeleton-${offset}`} />
        ))}
        <Typography
          sx={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}
          aria-live="polite"
        >
          {t.loading}
        </Typography>
      </Box>
    );
  } else if (data.planCatalog.length === 0) {
    surface = (
      <Stack spacing={2} sx={{ alignItems: "center", textAlign: "center", py: 8 }} data-testid="student-plans-empty">
        <EmptyStateIcon sx={theme => ({ fontSize: 48, color: theme.palette.text.secondary })} aria-hidden />
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
        data-testid="student-plans-grid"
      >
        {data.planCatalog.map(plan => (
          <StudentPlanCard
            key={plan.id}
            plan={plan}
            labels={t}
            hasPendingRequest={pendingPlanIds.has(plan.id)}
            onSubscribe={openRequest}
          />
        ))}
      </Box>
    );
  }

  return (
    <>
      {surface}
      {/* ONE shared purchase-request dialog — every card CTA routes here.
          Kind-prefixed key (audit-CR2): the nonce starts at (and resets to)
          "idle", and bare numeric keys collided across sibling mounts.
          Confirming fires the REAL Phase A mutation; the dialog is
          submit-locked while the request is in flight. */}
      <Dialog
        key={`request-${requestPlan?.id ?? "idle"}`}
        open={requestPlan !== null}
        onClose={closeRequest}
        aria-labelledby="student-plans-request-title"
        aria-describedby="student-plans-request-body"
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle id="student-plans-request-title" sx={{ fontWeight: 700 }}>
          {t.purchaseDialogTitle}
        </DialogTitle>
        <DialogContent>
          <DialogContentText id="student-plans-request-body">
            {requestPlan === null ? null : t.purchaseDialogBody(requestPlan.title)}
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={closeRequest} disabled={submitting} variant="text" sx={{ borderRadius: 2 }}>
            {t.purchaseDialogClose}
          </Button>
          <Button
            onClick={confirmRequest}
            disabled={submitting}
            variant="contained"
            data-testid="student-plans-request-submit"
            sx={{ borderRadius: 2 }}
            startIcon={submitting ? <CircularProgress size={16} color="inherit" /> : undefined}
          >
            {t.purchaseRequestCta}
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
          data-testid="student-plans-toast"
          sx={theme => ({ borderRadius: 2, boxShadow: theme.palette.shadow.card })}
        >
          {toast?.copy}
        </Alert>
      </Snackbar>
    </>
  );
}

/**
 * Local alias for the mutation variables shape — keeps the useMutation
 * generic readable without importing the codegen variables type twice.
 */
type RequestPlanSubscriptionVariablesAlias = RequestPlanSubscriptionMutationVariables;
