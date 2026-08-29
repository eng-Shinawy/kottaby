"use client";

import { useQuery } from "@apollo/client/react";
import { AddOutlined as AddIcon, Inventory2Outlined as EmptyStateIcon } from "@mui/icons-material";
import { Alert, Box, Button, Skeleton, Snackbar, Stack, Typography } from "@mui/material";
import type { SnackbarCloseReason } from "@mui/material/Snackbar";
import { type ReactNode, useCallback, useRef, useState } from "react";
import type { AdminPlansQuery_adminPlans } from "@/frontend/graphql/generated/gql/graphql";
import { adminPlansQueryDocument } from "@/frontend/graphql/sharedDocuments";
import { PlanCatalogTable } from "@/frontend/views/admin/plans/PlanCatalogTable";
import { PlanFormDialog } from "@/frontend/views/admin/plans/PlanFormDialog";
import { PlanStatusConfirmDialog } from "@/frontend/views/admin/plans/PlanStatusConfirmDialog";
import { Plans, useAppLocale, useAppTranslation } from "@/shared/locale";
import type { PlansLabels } from "@/shared/locale/types/plans";

/**
 * `PlanCatalogContainer` — the client-owned admin plan catalog (DEV1-005
 * REQ-054/REQ-062, mounted by the Task 4.2 server shell at `/admin/plans`).
 *
 * Responsibilities:
 *  - DATA: `useQuery(adminPlansQueryDocument, { variables: { includeInactive:
 *    true } })` from `@apollo/client/react` — the admin listing (server-enforced
 *    Admin role) including deactivated plans (REQ-064: the lifecycle toggle
 *    needs the full catalog, not just the storefront slice);
 *  - COPY: `useAppTranslation(Plans)` — property access ONLY, no `t("key")`
 *    string lookups anywhere on this surface;
 *  - STATES: skeleton rows while in flight → localized empty state with the
 *    create CTA → localized error state with retry → the catalog table;
 *  - DIALOGS (Task 4.4): create/edit intents open {@link PlanFormDialog}
 *    (create vs edit seeded from the row); row lifecycle intents open
 *    {@link PlanStatusConfirmDialog}. Mutations live INSIDE the dialogs —
 *    their canonical `Plan!` payloads converge the id-normalized cache (the
 *    create mutation additionally appends the new row to the watched
 *    `adminPlans` list via the dialog's cache `update`), so rows/chips update
 *    with NO refetch. Success closes the dialog and raises the localized
 *    Snackbar below (toasts interpolate the canonical row title).
 *
 * Server hand-off (`labels` prop): the Task 4.2 shell resolves
 * `getTranslations(locale).plansTranslations` server-side and passes the
 * STRING-KEYED subset (RSC props are serialized — the namespace's six
 * title-formatter functions cannot cross the server/client boundary, so the
 * page forwards each label via property access and the full tree — formatters
 * included — comes from the client handle below, which the dialogs consume
 * in-container). The 4.4 `columnCreatedAt`/`columnDeactivatedAt` header keys
 * ride the same merge (client handle supplies them; the serialized subset is
 * unchanged). Precedent: `ProfilePage` renders `<ProfileView />` with no
 * serialized labels for the same reason.
 *
 * MUI v9 discipline: `sx`-only styling through theme-palette tokens,
 * `*Outlined` icons, RTL-safe logical composition (flex/grid + gap), zero
 * hardcoded user-facing strings, zero hardcoded colors.
 */

/**
 * The RSC-serializable slice of {@link PlansLabels} the server shell hands
 * down — every member is a plain string; the six title-formatter keys are
 * structurally excluded (they cannot cross the server/client boundary and
 * are only consumed client-side by the dialogs).
 */
export type PlanCatalogStaticLabels = Pick<
  PlansLabels,
  | "createButton"
  | "columnTitle"
  | "columnSessionCount"
  | "columnPrice"
  | "columnIntervalDays"
  | "columnStatus"
  | "columnActions"
  | "actionEdit"
  | "actionActivate"
  | "actionDeactivate"
  | "statusActive"
  | "statusInactive"
  | "loading"
  | "emptyStateTitle"
  | "emptyStateBody"
  | "errorStateTitle"
  | "errorStateBody"
  | "errorStateRetry"
>;

export interface PlanCatalogContainerProps {
  /**
   * Optional server-resolved label subset (property access on
   * `plansTranslations`). When omitted — client-only mounts, tests — the
   * container resolves the FULL tree through `useAppTranslation(Plans)`.
   */
  readonly labels?: PlanCatalogStaticLabels;
}

/** Dialog-state bundle: `mode` + seed row + mount flag + remount nonce. */
interface PlanFormDialogState {
  readonly open: boolean;
  readonly mode: "create" | "edit";
  readonly plan: AdminPlansQuery_adminPlans | null;
  /** Bumped per OPENING — the dialog's React `key` remounts it fresh. */
  readonly nonce: number;
}

const CLOSED_FORM_DIALOG: PlanFormDialogState = { open: false, mode: "create", plan: null, nonce: 0 };

/** Success-snackbar state — copy is pre-interpolated (row title resolved). */
interface CatalogSnackbar {
  readonly id: number;
  readonly copy: string;
}

export function PlanCatalogContainer({ labels }: Readonly<PlanCatalogContainerProps>): ReactNode {
  const translated = useAppTranslation(Plans);
  const locale = useAppLocale();
  const { data, loading, error, refetch } = useQuery(adminPlansQueryDocument, {
    variables: { includeInactive: true },
  });

  // Server hand-off wins where provided (byte-identical copy to the server
  // shell); the client handle supplies every remaining key — including the
  // title formatters and the 4.4 timestamp-header keys the dialogs/table
  // consume in-container.
  const t: PlansLabels = { ...translated, ...labels };

  // ── Dialog + toast state (Task 4.4) ─────────────────────────────────────
  const [formDialog, setFormDialog] = useState<PlanFormDialogState>(CLOSED_FORM_DIALOG);
  const [statusPlan, setStatusPlan] = useState<AdminPlansQuery_adminPlans | null>(null);
  const [statusDialogOpen, setStatusDialogOpen] = useState(false);
  const [statusDialogNonce, setStatusDialogNonce] = useState(0);
  const [snackbar, setSnackbar] = useState<CatalogSnackbar | null>(null);
  // Monotonic ids — dialog remount nonces reset in-dialog form state WITHOUT
  // setState-in-effect (React remounts on `key` change); toast ids make
  // re-opened toasts restart the autohide timer (audit-R4 lesson).
  const nextDialogNonceRef = useRef(0);
  const nextToastIdRef = useRef(0);

  /** Create CTA (page header + empty state) → PlanFormDialog (create mode). */
  const onCreatePlanIntent = useCallback((): void => {
    setFormDialog({ open: true, mode: "create", plan: null, nonce: ++nextDialogNonceRef.current });
  }, []);

  /** Row edit intent → PlanFormDialog (edit mode) seeded with `plan`. */
  const onEditPlanIntent = useCallback((plan: AdminPlansQuery_adminPlans): void => {
    setFormDialog({ open: true, mode: "edit", plan, nonce: ++nextDialogNonceRef.current });
  }, []);

  /** Row lifecycle intent → PlanStatusConfirmDialog for `plan`. */
  const onTogglePlanStatusIntent = useCallback((plan: AdminPlansQuery_adminPlans): void => {
    setStatusPlan(plan);
    setStatusDialogOpen(true);
    setStatusDialogNonce(++nextDialogNonceRef.current);
  }, []);

  const closeFormDialog = useCallback((): void => {
    setFormDialog(CLOSED_FORM_DIALOG);
  }, []);

  const closeStatusDialog = useCallback((): void => {
    setStatusDialogOpen(false);
  }, []);

  /** Create/edit success: close + localized toast (cache already converged). */
  const handlePlanSaved = (saved: AdminPlansQuery_adminPlans): void => {
    setFormDialog(CLOSED_FORM_DIALOG);
    const copy = formDialog.mode === "create" ? t.toastCreated(saved.title) : t.toastUpdated(saved.title);
    setSnackbar({ id: ++nextToastIdRef.current, copy });
  };

  /** Status success: close + localized toast driven by the row's NEW state. */
  const handleStatusChanged = (updated: AdminPlansQuery_adminPlans): void => {
    setStatusDialogOpen(false);
    const copy = updated.isActive ? t.toastActivated(updated.title) : t.toastDeactivated(updated.title);
    setSnackbar({ id: ++nextToastIdRef.current, copy });
  };

  const dismissSnackbar = (_event: Event | React.SyntheticEvent, reason: SnackbarCloseReason): void => {
    if (reason === "clickaway") return;
    setSnackbar(null);
  };

  // Error FIRST: a settled failure arrives as (loading=false, data=undefined,
  // error set) — checking `!data` before `error` would strand the failure on
  // the skeleton branch forever.
  let surface: ReactNode;
  if (error) {
    surface = <PlanCatalogErrorState t={t} onRetry={() => void refetch()} />;
  } else if (loading || !data) {
    // In flight (or the narrow data-or-error guard Apollo settles with):
    // skeleton rows announce busy semantics — no settled copy may leak.
    surface = <PlanCatalogSkeleton loadingLabel={t.loading} />;
  } else {
    const plans = data.adminPlans;
    surface =
      plans.length === 0 ? (
        <PlanCatalogEmptyState t={t} onCreate={onCreatePlanIntent} />
      ) : (
        <Stack spacing={2}>
          {/* Page-header action — localized create CTA (opens PlanFormDialog). */}
          <Box sx={{ display: "flex" }}>
            <Button variant="contained" startIcon={<AddIcon />} onClick={onCreatePlanIntent}>
              {t.createButton}
            </Button>
          </Box>
          <PlanCatalogTable
            plans={plans}
            labels={t}
            locale={locale}
            onEditPlan={onEditPlanIntent}
            onTogglePlanStatus={onTogglePlanStatusIntent}
          />
        </Stack>
      );
  }

  return (
    <>
      {surface}
      {/* Dialogs + success toast mount in EVERY state — the empty-state create
          CTA and the table row actions share the same wiring. */}
      <PlanFormDialog
        key={formDialog.nonce}
        open={formDialog.open}
        plan={formDialog.plan}
        labels={t}
        onClose={closeFormDialog}
        onSaved={handlePlanSaved}
      />
      <PlanStatusConfirmDialog
        key={statusDialogNonce}
        open={statusDialogOpen}
        plan={statusPlan}
        labels={t}
        onClose={closeStatusDialog}
        onStatusChanged={handleStatusChanged}
      />
      <Snackbar
        key={snackbar?.id}
        open={snackbar !== null}
        autoHideDuration={6000}
        onClose={dismissSnackbar}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert
          severity="success"
          variant="filled"
          data-testid="plan-catalog-toast"
          sx={theme => ({ borderRadius: 2, boxShadow: theme.palette.shadow.card })}
        >
          {snackbar?.copy}
        </Alert>
      </Snackbar>
    </>
  );
}

// ----------------------------------------------------------------------------
// State surfaces
// ----------------------------------------------------------------------------

/** Loading skeleton — header line + five table-shaped placeholder rows. */
function PlanCatalogSkeleton({ loadingLabel }: { readonly loadingLabel: string }): ReactNode {
  return (
    <Box
      aria-busy="true"
      data-testid="plan-catalog-loading"
      sx={theme => ({
        display: "grid",
        gap: 2.5,
        p: { xs: 2.5, sm: 3 },
        borderRadius: 3,
        border: "1px solid",
        borderColor: theme.palette.outlineVariant,
        bgcolor: theme.palette.surfaceContainerLow,
        boxShadow: theme.palette.shadow.card,
      })}
    >
      <Typography variant="body2" sx={theme => ({ color: theme.palette.text.secondary })}>
        {loadingLabel}
      </Typography>
      {/* Header strip + five rows — column rhythm echoes the md+ table. */}
      <Skeleton variant="rounded" height={28} />
      {[0, 1, 2, 3, 4].map(row => (
        <Stack key={row} spacing={2} sx={{ flexDirection: "row", alignItems: "center" }}>
          <Skeleton variant="rounded" width="34%" height={32} />
          <Skeleton variant="rounded" width="10%" height={32} />
          <Skeleton variant="rounded" width="16%" height={32} />
          <Skeleton variant="rounded" width="10%" height={32} />
          <Skeleton variant="rounded" width="18%" height={32} />
        </Stack>
      ))}
    </Box>
  );
}

interface EmptyStateProps {
  readonly t: PlansLabels;
  readonly onCreate: () => void;
}

/**
 * Empty catalog — localized copy + icon + create CTA (the same intent
 * handler the page-header button uses; opens the create dialog).
 */
function PlanCatalogEmptyState({ t, onCreate }: Readonly<EmptyStateProps>): ReactNode {
  return (
    <Stack
      spacing={2}
      data-testid="plan-catalog-empty"
      sx={theme => ({
        alignItems: "center",
        py: 8,
        px: 3,
        textAlign: "center",
        borderRadius: 3,
        border: "1px solid",
        borderColor: theme.palette.outlineVariant,
        bgcolor: theme.palette.surfaceContainerLow,
        boxShadow: theme.palette.shadow.card,
      })}
    >
      <EmptyStateIcon sx={theme => ({ fontSize: 48, color: theme.palette.text.secondary })} />
      <Typography variant="h6" component="h2" sx={{ fontWeight: 700 }}>
        {t.emptyStateTitle}
      </Typography>
      <Typography variant="body2" sx={theme => ({ color: theme.palette.text.secondary, maxWidth: 420 })}>
        {t.emptyStateBody}
      </Typography>
      <Button variant="contained" startIcon={<AddIcon />} onClick={onCreate}>
        {t.createButton}
      </Button>
    </Stack>
  );
}

interface ErrorStateProps {
  readonly t: PlansLabels;
  readonly onRetry: () => void;
}

/**
 * Load failure — the namespace's own error copy + retry (the page-level
 * guard already established the admin session; any Apollo failure here is
 * surfaced as recoverable, never as a crash or bare null).
 */
function PlanCatalogErrorState({ t, onRetry }: Readonly<ErrorStateProps>): ReactNode {
  return (
    <Alert
      severity="error"
      variant="outlined"
      data-testid="plan-catalog-error"
      sx={theme => ({ borderRadius: 3, bgcolor: theme.palette.surfaceContainerLow })}
      action={
        <Button color="error" size="small" variant="outlined" onClick={onRetry}>
          {t.errorStateRetry}
        </Button>
      }
    >
      <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
        {t.errorStateTitle}
      </Typography>
      <Typography variant="body2">{t.errorStateBody}</Typography>
    </Alert>
  );
}
