/**
 * PlanFormDialog — Modal dialog for creating and editing subscription plans.
 *
 * Implements REQ-012, REQ-043, REQ-063 (Task 4.4).
 * Handles:
 *  - Unified create/edit flow
 *  - Client & server validation with field-level error messages (PlanFormContent)
 *  - React 19 synthetic form submit handling (usePlanForm)
 *  - Accessible form fields with `aria-invalid` (PlanFormFields)
 *  - In-flight double-submit mitigation
 */

"use client";

import { Dialog } from "@mui/material";
import type { AdminPlansQuery, CreatePlanInput } from "@/frontend/graphql/generated/gql/graphql";
import { PlanFormContent } from "@/frontend/views/admin/plans/forms/PlanFormContent";

type PlanItem = AdminPlansQuery["adminPlans"][number];

export interface PlanFormDialogProps {
  readonly open: boolean;
  readonly plan: PlanItem | null;
  readonly loading: boolean;
  readonly globalError?: string | null;
  readonly serverFieldErrors?: Record<string, string>;
  readonly onClose: () => void;
  readonly onSubmit: (input: CreatePlanInput) => Promise<void>;
}

export function PlanFormDialog({
  open,
  plan,
  loading,
  globalError,
  serverFieldErrors,
  onClose,
  onSubmit,
}: PlanFormDialogProps): React.ReactElement {
  return (
    <Dialog
      open={open}
      onClose={loading ? undefined : onClose}
      maxWidth="sm"
      fullWidth
      aria-labelledby="plan-form-dialog-title"
    >
      {open && (
        <PlanFormContent
          key={plan?.id ?? "new"}
          plan={plan}
          loading={loading}
          globalError={globalError}
          serverFieldErrors={serverFieldErrors}
          onClose={onClose}
          onSubmit={onSubmit}
        />
      )}
    </Dialog>
  );
}
