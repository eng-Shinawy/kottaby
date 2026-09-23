"use client";

/**
 * SubscriptionActionDialogs — the four lifecycle dialogs' host. Renders
 * exactly the dialog the section's controller says is open (mounted
 * per-row via `key`, so every open starts from clean form state), fed by
 * the section's mutation wiring (`useSubscriptionAdminActions`) and the
 * admin plan catalog for the change-plan selector's same-lane candidates.
 *
 * Presentational: every submit flows through the controller's
 * `runAction` pipeline — `null` resolves the dialog (the mutation hook
 * already refetched + toasted), a string pins the server-localized denial
 * onto the open dialog's inline alert.
 */
import type { ReactNode } from "react";
import { CancelSubscriptionDialog } from "@/frontend/views/admin/students/subscriptions/dialogs/CancelSubscriptionDialog";
import { ChangeSubscriptionPlanDialog } from "@/frontend/views/admin/students/subscriptions/dialogs/ChangeSubscriptionPlanDialog";
import { ExtendSubscriptionDialog } from "@/frontend/views/admin/students/subscriptions/dialogs/ExtendSubscriptionDialog";
import { RenewSubscriptionDialog } from "@/frontend/views/admin/students/subscriptions/dialogs/RenewSubscriptionDialog";
import type { UseSubscriptionAdminActionsResult } from "@/frontend/views/admin/students/subscriptions/hooks/useSubscriptionAdminActions";
import type { SubscriptionDialogController } from "@/frontend/views/admin/students/subscriptions/hooks/useSubscriptionDialogController";
import {
  type AdminPlanItem,
  eligibleChangePlanTargets,
} from "@/frontend/views/admin/students/subscriptions/subscriptionAdmin.helpers";

interface SubscriptionActionDialogsProps {
  /** The dialog controller (open dialog + shared submit pipeline). */
  readonly controller: SubscriptionDialogController;
  /** The section's lifecycle mutations (loading flags + submit intents). */
  readonly actions: UseSubscriptionAdminActionsResult;
  /** The admin plan catalog (the change-plan selector's raw candidates). */
  readonly plans: readonly AdminPlanItem[];
  /** True while the section's plan catalog read is still loading. */
  readonly plansLoading: boolean;
  /** True when the plan-catalog read settled with a failure — the
   *  change-plan dialog renders the directory error alert (retry) instead
   *  of the "no eligible plan" empty copy. */
  readonly plansError: boolean;
  /** The plan-catalog failure's canonical code suffix (`null` unknown). */
  readonly plansErrorCode: string | null;
  /** Re-fetches the section's plan catalog. */
  readonly onRetryPlans: () => void;
}

export function SubscriptionActionDialogs({
  controller,
  actions,
  plans,
  plansLoading,
  plansError,
  plansErrorCode,
  onRetryPlans,
}: SubscriptionActionDialogsProps): ReactNode {
  const { openDialog, actionError, closeDialog, runAction } = controller;
  if (openDialog === null) {
    return null;
  }
  const { row } = openDialog;

  if (openDialog.kind === "extend") {
    return (
      <ExtendSubscriptionDialog
        key={`extend-${row.id}`}
        open
        subscription={row}
        loading={actions.loading.extend}
        error={actionError}
        onClose={closeDialog}
        onSubmit={days => {
          void runAction(() => actions.extend(row.id, days));
        }}
      />
    );
  }
  if (openDialog.kind === "renew") {
    return (
      <RenewSubscriptionDialog
        key={`renew-${row.id}`}
        open
        subscription={row}
        loading={actions.loading.renew}
        error={actionError}
        onClose={closeDialog}
        onSubmit={() => {
          void runAction(() => actions.renew(row.id));
        }}
      />
    );
  }
  if (openDialog.kind === "cancel") {
    return (
      <CancelSubscriptionDialog
        key={`cancel-${row.id}`}
        open
        subscription={row}
        loading={actions.loading.cancel}
        error={actionError}
        onClose={closeDialog}
        onSubmit={reason => {
          void runAction(() => actions.cancel(row.id, reason));
        }}
      />
    );
  }
  return (
    <ChangeSubscriptionPlanDialog
      key={`changePlan-${row.id}`}
      open
      subscription={row}
      plans={eligibleChangePlanTargets(plans, row.planId, row.plan.balanceLane)}
      plansLoading={plansLoading}
      plansError={plansError}
      plansErrorCode={plansErrorCode}
      onRetryPlans={onRetryPlans}
      loading={actions.loading.changePlan}
      error={actionError}
      onClose={closeDialog}
      onSubmit={newPlanId => {
        void runAction(() => actions.changePlan(row.id, newPlanId));
      }}
    />
  );
}
