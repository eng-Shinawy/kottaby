/**
 * PlanFormContent — Dialog body (title, fields, actions) for plan create/edit.
 *
 * Extracted from PlanFormDialog (Task 4.4).
 *  - Unified create/edit flow (state initialized from `plan` via the `key` prop)
 *  - In-flight double-submit mitigation via the `loading` prop
 *  - Client & server validation with field-level error messages
 */

"use client";

import type { AdminPlansQuery, CreatePlanInput } from "@/frontend/graphql/generated/gql/graphql";
import { FormDialogShell } from "@/frontend/views/admin/forms/FormDialogShell";
import { PlanFormFields } from "@/frontend/views/admin/plans/forms/PlanFormFields";
import { usePlanForm } from "@/frontend/views/admin/plans/hooks/usePlanForm";
import { useAppTranslation } from "@/shared/locale/client";
import { Plans } from "@/shared/locale/namespaces/plans";

type PlanItem = AdminPlansQuery["adminPlans"][number];

export interface PlanFormContentProps {
  readonly plan: PlanItem | null;
  readonly loading: boolean;
  readonly globalError?: string | null;
  readonly serverFieldErrors?: Record<string, string>;
  readonly onClose: () => void;
  readonly onSubmit: (input: CreatePlanInput) => Promise<void>;
}

export function PlanFormContent({
  plan,
  loading,
  globalError,
  serverFieldErrors,
  onClose,
  onSubmit,
}: PlanFormContentProps): React.ReactElement {
  const t = useAppTranslation(Plans);
  const { form, dialogTitle, handleChange, handleSubmit, fieldError } = usePlanForm({
    plan,
    serverFieldErrors,
    onSubmit,
  });

  return (
    <FormDialogShell
      titleId="plan-form-dialog-title"
      dialogTitle={dialogTitle}
      labels={{ cancel: t.cancelButton, save: t.saveButton, saving: t.savingButton }}
      loading={loading}
      globalError={globalError}
      onClose={onClose}
      onSubmit={handleSubmit}
    >
      <PlanFormFields form={form} loading={loading} onFieldChange={handleChange} fieldError={fieldError} />
    </FormDialogShell>
  );
}
