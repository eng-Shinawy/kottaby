"use client";

import { Alert, DialogContentText, MenuItem, TextField } from "@mui/material";
import { type ReactNode, useState } from "react";
import { DirectoryErrorAlert } from "@/frontend/views/admin/directory-shared/DirectoryErrorAlert";
import {
  SubscriptionDialogActions,
  SubscriptionFormDialog,
} from "@/frontend/views/admin/students/subscriptions/dialogs/subscriptionDialogAtoms";
import type {
  AdminPlanItem,
  SubscriptionRow,
} from "@/frontend/views/admin/students/subscriptions/subscriptionAdmin.helpers";
import { Common, SubscriptionAdmin, useAppTranslation } from "@/shared/locale";

/**
 * ChangeSubscriptionPlanDialog — moves an ACTIVE subscription onto a
 * different active plan in the SAME balance lane.
 *
 * The candidate list arrives PRE-FILTERED from the section (the pure
 * `eligibleChangePlanTargets` helper: active + same lane + not the source
 * plan). While the section's plan-catalog read is still loading the
 * selector renders DISABLED — an empty candidate list is only honest once
 * the catalog has actually landed, so the "no eligible plan" message is
 * reserved for the truly loaded-and-empty state; a settled first-load
 * failure of the catalog read instead renders the directory error-alert
 * recipe (retry wired to the section's plans refetch), and the submit
 * stays disabled without a selection. The body states the cancel-and-reopen
 * semantics up front; the server's localized denials surface in the
 * inline error alert.
 *
 * Presentational: the mutation lives in `useSubscriptionAdminActions`
 * (wired by the section); the dialog forwards only the target plan id.
 * The success copy's proration numbers ride the mutation payload (the
 * hook's job) — the dialog carries no proration math.
 *
 * MUI v9 discipline: `sx`-only styling, theme-palette colors, ≥44px touch
 * targets, keyboard-focusable dialog (`aria-labelledby` + focusable field).
 */

interface ChangeSubscriptionPlanDialogProps {
  /** The subscription being re-planned (drives the testid). */
  readonly subscription: SubscriptionRow;
  /** The eligible target plans (already lane/active/identity filtered). */
  readonly plans: readonly AdminPlanItem[];
  /** True while the section's plan-catalog read is still loading — the
   *  empty-options state is withheld until the catalog has landed. */
  readonly plansLoading: boolean;
  /** True when the plan-catalog read settled with a failure — renders the
   *  directory error-alert recipe instead of the "no eligible plan" copy. */
  readonly plansError: boolean;
  /** The plan-catalog failure's canonical code suffix (`null` unknown). */
  readonly plansErrorCode: string | null;
  /** Re-fetches the section's plan catalog (the error alert's retry). */
  readonly onRetryPlans: () => void;
  readonly open: boolean;
  /** Dismiss intent — ignored while the mutation is in flight. */
  readonly onClose: () => void;
  /** True while the section's plan-change mutation is in flight. */
  readonly loading: boolean;
  /** The server-localized denial (inline alert) — `null` hides the alert. */
  readonly error: string | null;
  /** Submit intent — the selected target plan id. */
  readonly onSubmit: (newPlanId: string) => void;
}

export function ChangeSubscriptionPlanDialog({
  subscription,
  plans,
  plansLoading,
  plansError,
  plansErrorCode,
  onRetryPlans,
  open,
  onClose,
  loading,
  error,
  onSubmit,
}: Readonly<ChangeSubscriptionPlanDialogProps>): ReactNode {
  const t = useAppTranslation(SubscriptionAdmin);
  const tc = useAppTranslation(Common);

  const [newPlanId, setNewPlanId] = useState("");

  const handleSubmit = (event: React.SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (loading || newPlanId === "") {
      return;
    }
    onSubmit(newPlanId);
  };

  const renderPlanSelector = (): ReactNode => {
    if (plansError && !plansLoading) {
      return (
        <DirectoryErrorAlert
          labels={{ ...t.changePlan.errorState, retry: t.errorState.retry }}
          errorCode={plansErrorCode}
          onRetry={onRetryPlans}
        />
      );
    }
    if (!plansLoading && plans.length === 0) {
      return (
        <Alert severity="info" sx={{ width: "100%" }}>
          {t.changePlan.noPlans}
        </Alert>
      );
    }
    return (
      <TextField
        label={t.changePlan.planLabel}
        select
        value={newPlanId}
        onChange={event => {
          setNewPlanId(event.target.value);
        }}
        fullWidth
        required
        disabled={loading || plansLoading}
        data-testid={`change-subscription-plan-select-${subscription.id}`}
      >
        {plans.map(plan => (
          <MenuItem key={plan.id} value={plan.id} sx={{ minHeight: { xs: 44, sm: 36 } }}>
            {plan.title}
          </MenuItem>
        ))}
      </TextField>
    );
  };

  return (
    <SubscriptionFormDialog
      open={open}
      onClose={onClose}
      loading={loading}
      onSubmit={handleSubmit}
      titleId="change-subscription-plan-dialog-title"
      title={t.changePlan.title}
      actions={
        <SubscriptionDialogActions
          onClose={onClose}
          loading={loading}
          dismissLabel={tc.cancel}
          submitLabel={t.actions.changePlan}
          submitTestId={`change-subscription-plan-submit-${subscription.id}`}
          submitDisabled={newPlanId === ""}
        />
      }
    >
      {error && (
        <Alert severity="error" sx={{ width: "100%" }}>
          {error}
        </Alert>
      )}
      <DialogContentText sx={theme => ({ color: theme.palette.text.secondary })}>
        {t.changePlan.message}
      </DialogContentText>
      {renderPlanSelector()}
    </SubscriptionFormDialog>
  );
}
