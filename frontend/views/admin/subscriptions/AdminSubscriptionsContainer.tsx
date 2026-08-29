"use client";

import { useMutation, useQuery } from "@apollo/client/react";
import { CardMembershipOutlined as EmptyStateIcon, ErrorOutlineOutlined as ErrorStateIcon } from "@mui/icons-material";
import {
  Alert,
  Box,
  Button,
  Skeleton,
  Snackbar,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import type { SnackbarCloseReason } from "@mui/material/Snackbar";
import { type ReactNode, useCallback, useMemo, useRef, useState } from "react";
import type {
  AdminCancelSubscriptionMutation,
  AdminCancelSubscriptionMutationVariables,
  AdminSubscriptionsQuery_adminSubscriptions_items,
  AdminSubscriptionsQueryVariables,
} from "@/frontend/graphql/generated/gql/graphql";
import {
  adminCancelSubscriptionMutationDocument,
  adminSubscriptionsQueryDocument,
} from "@/frontend/graphql/sharedDocuments";
import { AdminSubscriptionCard } from "@/frontend/views/admin/subscriptions/AdminSubscriptionCard";
import { CancelSubscriptionDialog } from "@/frontend/views/admin/subscriptions/CancelSubscriptionDialog";
import { SubscriptionManagement, useAppLocale, useAppTranslation } from "@/shared/locale";
import type { SubscriptionManagementLabels } from "@/shared/locale/types/subscriptionManagement";

/**
 * `AdminSubscriptionsContainer` — the client-owned admin subscription
 * lifecycle manager (mounted by the `/admin/subscriptions` server shell)
 * and the DEV1-009 management surface.
 *
 * Responsibilities:
 *  - DATA: `useQuery(adminSubscriptionsQueryDocument, { variables })` —
 *    the server-enforced admin read (every subscription across all
 *    statuses, newest first, bounded pagination). The variables come from
 *    the APPLIED filter state, never the draft (mirrors the audit trail's
 *    discipline: a half-chosen filter cannot reshape the read until the
 *    admin commits it);
 *  - COPY: `useAppTranslation(SubscriptionManagement)` — property access
 *    ONLY, no `t("key")` string lookups anywhere on this surface;
 *  - FILTERING: status chips (All + the five lifecycle statuses) own a
 *    DRAFT; Apply commits it to the query — a commit ALWAYS resets the
 *    offset to 0 (a new filter starts at page 1). "All" strips the status
 *    argument to `undefined` on the wire;
 *  - PAGINATION: offset stepping by the fixed page size, prev/next derived
 *    from the SERVER's `total` — never from local row counts;
 *    `previousData` keeps the last good page on the wire (no empty flash
 *    between pages);
 *  - CANCEL FLOW (real, DEV1-009): a cancellable card's CTA opens ONE
 *    shared cancel dialog (keyed by subscription id — state resets between
 *    subscriptions); confirming fires the `adminCancelSubscription`
 *    mutation (server-side guarded `active|pending → cancelled`, terminal
 *    fence). Success → toast + dialog close + refetch (the cancelled row
 *    flips to `cancelled` from REAL server state, never optimistic local
 *    guessing). Failure → failure toast, dialog stays open for a retry in
 *    place.
 *  - STATES: skeleton cards while in flight → localized empty state →
 *    localized error state with retry → the responsive card grid.
 *
 * Server hand-off (`labels` prop): the `/admin/subscriptions` shell
 * resolves `getTranslations(locale).subscriptionManagementTranslations`
 * server-side and passes the STRING-KEYED subset (RSC props are
 * serialized — the namespace's two formatters `cancelDialogBody` +
 * `pageInfo` cannot cross the boundary); the full tree comes from the
 * client handle below. Precedent: the `/admin/verifications` shell ↔
 * `PaymentVerificationContainer` merge.
 *
 * MUI v9 discipline: `sx`-only styling through theme-palette tokens,
 * `*Outlined` icons, RTL-safe logical composition (grid + gap), zero
 * hardcoded user-facing strings, zero hardcoded colors.
 */

/** Fixed page size — the lifecycle grid never offers a size selector. */
const PAGE_SIZE = 10;

/** The draft filter value meaning "all statuses" (strips the wire arg). */
const FILTER_ALL = "";

/**
 * The status filter values the chips offer — mirrors the backend's
 * `SUBSCRIPTION_STATUSES` set (the service owns the authoritative
 * narrowing; these only ever produce sanctioned values anyway).
 */
const STATUS_FILTERS = ["active", "pending", "expired", "cancelled", "suspended"] as const;

/**
 * Localized label for a status-filter chip — property access ONLY (never a
 * string-keyed lookup; unknown codes degrade to the raw value).
 */
function filterLabelFor(status: string, labels: SubscriptionManagementLabels): string {
  switch (status) {
    case "active":
      return labels.filterActive;
    case "pending":
      return labels.filterPending;
    case "expired":
      return labels.filterExpired;
    case "cancelled":
      return labels.filterCancelled;
    case "suspended":
      return labels.filterSuspended;
    default:
      return status;
  }
}

/**
 * The RSC-serializable slice of {@link SubscriptionManagementLabels} the
 * server shell hands down — plain strings. The two formatter members are
 * structurally excluded (they cannot cross the server/client boundary and
 * are only consumed client-side): `cancelDialogBody` (the dialog body the
 * dialog interpolates) and `pageInfo` (the pagination-range formatter).
 */
export type SubscriptionManagementStaticLabels = Omit<SubscriptionManagementLabels, "cancelDialogBody" | "pageInfo">;

export interface AdminSubscriptionsContainerProps {
  /**
   * Optional server-resolved label subset (property access on
   * `subscriptionManagementTranslations`). When omitted — client-only
   * mounts, tests — the container resolves the FULL tree through
   * `useAppTranslation(SubscriptionManagement)`.
   */
  readonly labels?: SubscriptionManagementStaticLabels;
}

/** Subscription-card loading skeleton — mirrors the real card's geometry. */
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
      <Skeleton variant="text" width="35%" height={40} />
      <Skeleton variant="rounded" height={84} />
      <Skeleton variant="rounded" height={40} />
    </Box>
  );
}

/** Toast state — copy is pre-resolved from the namespace (no live refs). */
interface CancelToast {
  readonly id: number;
  readonly copy: string;
  readonly severity: "success" | "error";
}

export function AdminSubscriptionsContainer({ labels }: Readonly<AdminSubscriptionsContainerProps>): ReactNode {
  const translated = useAppTranslation(SubscriptionManagement);
  const locale = useAppLocale();

  // Server hand-off wins where provided (byte-identical copy to the server
  // shell); the client handle supplies every remaining key — including the
  // two formatters (dialog body + pagination range).
  const t: SubscriptionManagementLabels = { ...translated, ...labels };

  // ── Filter state: draft (chips) vs applied (query) ────────────────────────
  const [draft, setDraft] = useState<string>(FILTER_ALL);
  const [applied, setApplied] = useState<string>(FILTER_ALL);
  const [offset, setOffset] = useState(0);

  const variables = useMemo<AdminSubscriptionsQueryVariables>(
    () => ({
      status: applied === FILTER_ALL ? undefined : applied,
      limit: PAGE_SIZE,
      offset,
    }),
    [applied, offset]
  );
  const { data, loading, error, refetch, previousData } = useQuery(adminSubscriptionsQueryDocument, { variables });

  const patchDraft = useCallback((status: string) => setDraft(status), []);

  const applyFilters = useCallback(() => {
    setApplied(draft);
    // New filters start at page 1 — the offset of the OLD filter set has no
    // meaning for the new result window.
    setOffset(0);
  }, [draft]);

  const goPrev = useCallback(() => setOffset(previous => Math.max(previous - PAGE_SIZE, 0)), []);
  const goNext = useCallback(() => setOffset(previous => previous + PAGE_SIZE), []);

  // ── Cancel flow state ─────────────────────────────────────────────────────
  const [cancelTarget, setCancelTarget] = useState<AdminSubscriptionsQuery_adminSubscriptions_items | null>(null);
  const [toast, setToast] = useState<CancelToast | null>(null);
  // Monotonic toast ids — re-opened toasts restart the autohide timer
  // (audit-R4 lesson, mirrored from the verification queue).
  const nextToastIdRef = useRef(0);

  const [cancelSubscription, { loading: submitting }] = useMutation<
    AdminCancelSubscriptionMutation,
    AdminCancelSubscriptionMutationVariables
  >(adminCancelSubscriptionMutationDocument, {
    onError: () => {
      // The masking boundary owns unexpected failures; expected domain
      // conflicts (SUBSCRIPTION_ALREADY_RESOLVED, …) surface with localized
      // copy server-side. The toast stays generic + retryable — the dialog
      // remains open so the admin can retry in place.
      setToast({ id: ++nextToastIdRef.current, copy: t.cancelFailedToast, severity: "error" });
    },
    onCompleted: () => {
      setToast({ id: ++nextToastIdRef.current, copy: t.cancelSuccessToast, severity: "success" });
      setCancelTarget(null);
      // Refresh the admin read — the row flips to `cancelled` from REAL
      // server state, never optimistic local guessing (a concurrent cancel
      // race is settled by the server's conflict).
      void refetch();
    },
  });

  const openCancel = useCallback(
    (subscription: AdminSubscriptionsQuery_adminSubscriptions_items) => setCancelTarget(subscription),
    []
  );
  const closeCancel = useCallback(() => {
    if (!submitting) {
      setCancelTarget(null);
    }
  }, [submitting]);
  const confirmCancel = useCallback(() => {
    if (cancelTarget === null || submitting) {
      return;
    }
    void cancelSubscription({ variables: { subscriptionId: cancelTarget.id } });
  }, [cancelTarget, cancelSubscription, submitting]);

  const dismissToast = useCallback((_event: Event | React.SyntheticEvent, reason: SnackbarCloseReason): void => {
    if (reason === "clickaway") {
      return;
    }
    setToast(null);
  }, []);

  // ── State branches (error → loading → empty → populated) ──────────────────
  // `previousData` keeps the last good page on the wire during a refetch —
  // the grid never flashes empty between pages.
  const page = data ?? previousData;

  let surface: ReactNode;
  if (error) {
    surface = (
      <Stack
        spacing={2}
        sx={{ alignItems: "center", textAlign: "center", py: 8 }}
        role="alert"
        data-testid="admin-subscriptions-error"
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
  } else if (loading && page === undefined) {
    // `loading && !page` — a settled failure with a cache flush would hand
    // back `data: undefined` alongside `error`; the error branch above has
    // already caught it, and `previousData` keeps an in-flight pagination
    // refetch from collapsing back into skeletons.
    surface = (
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)", lg: "repeat(3, 1fr)" },
          gap: 2.5,
        }}
        aria-busy="true"
        data-testid="admin-subscriptions-loading"
      >
        {[0, 1, 2].map(skeletonOffset => (
          <SubscriptionCardSkeleton key={`skeleton-${skeletonOffset}`} />
        ))}
        <Typography
          sx={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}
          aria-live="polite"
        >
          {t.loading}
        </Typography>
      </Box>
    );
  } else if (page === undefined || page.adminSubscriptions.items.length === 0) {
    surface = (
      <Stack
        spacing={2}
        sx={{ alignItems: "center", textAlign: "center", py: 8 }}
        data-testid="admin-subscriptions-empty"
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
        data-testid="admin-subscriptions-grid"
      >
        {page.adminSubscriptions.items.map(subscription => (
          <AdminSubscriptionCard
            key={subscription.id}
            subscription={subscription}
            labels={t}
            locale={locale}
            onCancel={openCancel}
          />
        ))}
      </Box>
    );
  }

  // ── Pagination arithmetic — the truthful 1-based window into the SERVER
  // total (never local row counts).
  const total = page?.adminSubscriptions.total ?? 0;
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + PAGE_SIZE, total);
  const hasPrev = offset > 0;
  const hasNext = offset + PAGE_SIZE < total;

  return (
    <Stack spacing={2.5} data-testid="admin-subscriptions-view">
      {/* Status filter — the chips own the DRAFT; Apply commits it (a commit
          always re-pages to offset 0). "All" strips the status argument to
          `undefined` on the wire. */}
      <Stack
        spacing={1.5}
        sx={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 1.5,
          flexWrap: "wrap",
        }}
        data-testid="admin-subscriptions-filters"
      >
        <ToggleButtonGroup
          exclusive
          value={draft}
          onChange={(_event, value: string | null) => {
            if (value !== null) {
              patchDraft(value);
            }
          }}
          size="small"
          aria-label={t.labelStatus}
          sx={{ flexWrap: "wrap" }}
        >
          <ToggleButton value={FILTER_ALL} aria-label={t.filterAll}>
            {t.filterAll}
          </ToggleButton>
          {STATUS_FILTERS.map(status => (
            <ToggleButton key={status} value={status} aria-label={filterLabelFor(status, t)}>
              {filterLabelFor(status, t)}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
        <Button
          variant="contained"
          size="small"
          onClick={applyFilters}
          sx={{ borderRadius: 2 }}
          data-testid="admin-subscriptions-apply"
        >
          {t.applyFilters}
        </Button>
      </Stack>

      {surface}

      {/* Pagination — prev/next derived from the SERVER total; the window
          text interpolates the pageInfo formatter (client-side only). */}
      <Stack
        spacing={1}
        sx={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: 1.5,
          flexWrap: "wrap",
        }}
        data-testid="admin-subscriptions-pagination"
      >
        <Typography variant="caption" sx={theme => ({ color: theme.palette.text.secondary })}>
          {`${t.rowsPerPage}: ${PAGE_SIZE}`}
        </Typography>
        <Typography variant="body2" sx={theme => ({ color: theme.palette.text.secondary })} aria-live="polite">
          {t.pageInfo(from, to, total)}
        </Typography>
        <Button
          size="small"
          variant="outlined"
          disabled={!hasPrev || loading}
          onClick={goPrev}
          aria-label={t.pagePrevAriaLabel}
          sx={{ borderRadius: 2 }}
          data-testid="admin-subscriptions-prev"
        >
          {t.pagePrev}
        </Button>
        <Button
          size="small"
          variant="outlined"
          disabled={!hasNext || loading}
          onClick={goNext}
          aria-label={t.pageNextAriaLabel}
          sx={{ borderRadius: 2 }}
          data-testid="admin-subscriptions-next"
        >
          {t.pageNext}
        </Button>
      </Stack>

      {/* ONE shared cancel dialog — every card CTA routes here. Kind-prefixed
          key (audit-CR2): the nonce starts at (and resets to) "idle", and the
          remount on id change resets the dialog state. Confirming fires the
          REAL DEV1-009 mutation; the dialog is submit-locked while the
          cancellation is in flight and STAYS OPEN on failure. */}
      {cancelTarget === null ? null : (
        <CancelSubscriptionDialog
          key={`cancel-${cancelTarget.id}`}
          subscription={cancelTarget}
          labels={t}
          submitting={submitting}
          onConfirm={confirmCancel}
          onClose={closeCancel}
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
          data-testid="admin-subscriptions-toast"
          sx={theme => ({ borderRadius: 2, boxShadow: theme.palette.shadow.card })}
        >
          {toast?.copy}
        </Alert>
      </Snackbar>
    </Stack>
  );
}
