/**
 * PlanFormContent — Dialog body (title, fields, actions) for plan create/edit.
 *
 * Extracted from PlanFormDialog (Task 4.4).
 *  - Unified create/edit flow (state initialized from `plan` via the `key` prop)
 *  - In-flight double-submit mitigation via the `loading` prop
 *  - Client & server validation with field-level error messages
 */

"use client";

import { Alert, Button, CircularProgress, DialogActions, DialogContent, DialogTitle, Stack } from "@mui/material";
import type { AdminPlansQuery, CreatePlanInput } from "@/frontend/graphql/generated/gql/graphql";
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
    <form onSubmit={handleSubmit} noValidate>
      <DialogTitle id="plan-form-dialog-title" sx={{ fontWeight: 600 }}>
        {dialogTitle}
      </DialogTitle>
      <DialogContent>
        <Stack sx={{ gap: 2.5, mt: 1 }}>
          {globalError && (
            <Alert severity="error" sx={{ width: "100%" }}>
              {globalError}
            </Alert>
          )}

          <PlanFormFields form={form} loading={loading} onFieldChange={handleChange} fieldError={fieldError} />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose} disabled={loading} color="inherit">
          {t.cancelButton}
        </Button>
        <Button
          type="submit"
          disabled={loading}
          variant="contained"
          color="primary"
          startIcon={loading ? <CircularProgress size={16} color="inherit" /> : null}
        >
          {loading ? t.savingButton : t.saveButton}
        </Button>
      </DialogActions>
    </form>
  );
}
