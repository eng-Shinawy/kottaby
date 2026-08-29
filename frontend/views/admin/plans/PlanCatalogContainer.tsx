"use client";

import { useQuery } from "@apollo/client/react";
import { AddOutlined as AddIcon, Inventory2Outlined as EmptyStateIcon } from "@mui/icons-material";
import { Alert, Box, Button, Skeleton, Stack, Typography } from "@mui/material";
import { type ReactNode, useCallback } from "react";
import type { AdminPlansQuery_adminPlans } from "@/frontend/graphql/generated/gql/graphql";
import { adminPlansQueryDocument } from "@/frontend/graphql/sharedDocuments";
import { PlanCatalogTable } from "@/frontend/views/admin/plans/PlanCatalogTable";
import { Plans, useAppLocale, useAppTranslation } from "@/shared/locale";
import type { PlansLabels } from "@/shared/locale/types/plans";

/**
 * `PlanCatalogContainer` — the client-owned admin plan catalog (DEV1-005
 * REQ-054/REQ-062, mounted by the Task 4.2 server shell at `/admin/plans`).
 *
 * Responsibilities (deliberately FINAL for Task 4.4):
 *  - DATA: `useQuery(adminPlansQueryDocument, { variables: { includeInactive:
 *    true } })` from `@apollo/client/react` — the admin listing (server-enforced
 *    Admin role) including deactivated plans (REQ-064: the lifecycle toggle
 *    needs the full catalog, not just the storefront slice);
 *  - COPY: `useAppTranslation(Plans)` — property access ONLY, no `t("key")`
 *    string lookups anywhere on this surface;
 *  - STATES: skeleton rows while in flight → localized empty state with the
 *    create CTA → localized error state with retry → the catalog table;
 *  - INTENTS: `onEditPlan(plan)` / `onTogglePlanStatus(plan)` /
 *    create-CTA handlers are STABLE, clearly-marked placeholders. Task 4.4
 *    replaces their bodies with PlanFormDialog / PlanStatusConfirmDialog
 *    state wiring — the data layer above stays untouched.
 *
 * Server hand-off (`labels` prop): the Task 4.2 shell resolves
 * `getTranslations(locale).plansTranslations` server-side and passes the
 * STRING-KEYED subset (RSC props are serialized — the namespace's six
 * title-formatter functions cannot cross the server/client boundary, so the
 * page forwards each label via property access and the full tree — formatters
 * included — comes from the client handle below, which 4.4's dialogs consume
 * in-container). Precedent: `ProfilePage` renders `<ProfileView />` with no
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
 * are only consumed client-side by Task 4.4's dialogs).
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

export function PlanCatalogContainer({ labels }: Readonly<PlanCatalogContainerProps>): ReactNode {
  const translated = useAppTranslation(Plans);
  const locale = useAppLocale();
  const { data, loading, error, refetch } = useQuery(adminPlansQueryDocument, {
    variables: { includeInactive: true },
  });

  // Server hand-off wins where provided (byte-identical copy to the server
  // shell); the client handle supplies every remaining key — including the
  // title formatters 4.4's dialogs will interpolate in-container.
  const t: PlansLabels = { ...translated, ...labels };

  // ── Task 4.4 boundary — stable placeholder intent handlers ──────────────
  // These three callbacks are the ONLY touchpoints the table/dialog layer
  // needs. 4.4 swaps the empty bodies for dialog state (which plan is being
  // edited / confirmed) + mutation composition; the useQuery above and the
  // render tree below stay exactly as landed in 4.3.

  /** Create CTA (page header + empty state). 4.4: open PlanFormDialog (create mode). */
  const onCreatePlanIntent = useCallback((): void => {
    // Placeholder — Task 4.4 wires create-dialog state here.
  }, []);

  /** Row edit intent. 4.4: open PlanFormDialog (edit mode) seeded with `plan`. */
  const onEditPlanIntent = useCallback((_plan: AdminPlansQuery_adminPlans): void => {
    // Placeholder — Task 4.4 wires edit-dialog state here.
  }, []);

  /** Row lifecycle intent. 4.4: open PlanStatusConfirmDialog for `plan`. */
  const onTogglePlanStatusIntent = useCallback((_plan: AdminPlansQuery_adminPlans): void => {
    // Placeholder — Task 4.4 wires confirm-dialog state here.
  }, []);

  // Error FIRST: a settled failure arrives as (loading=false, data=undefined,
  // error set) — checking `!data` before `error` would strand the failure on
  // the skeleton branch forever.
  if (error) {
    return <PlanCatalogErrorState t={t} onRetry={() => void refetch()} />;
  }

  // In flight (or the narrow data-or-error guard Apollo settles with):
  // skeleton rows announce busy semantics — no settled copy may leak.
  if (loading || !data) {
    return <PlanCatalogSkeleton loadingLabel={t.loading} />;
  }

  const plans = data.adminPlans;

  if (plans.length === 0) {
    return <PlanCatalogEmptyState t={t} onCreate={onCreatePlanIntent} />;
  }

  return (
    <Stack spacing={2}>
      {/* Page-header action — localized create CTA (dialog lands in 4.4). */}
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
 * handler the page-header button uses; 4.4 opens the create dialog).
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
