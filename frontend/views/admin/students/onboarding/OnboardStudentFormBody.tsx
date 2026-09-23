"use client";

/**
 * OnboardStudentFormBody — the form side of the onboarding dialog: the
 * shared `FormDialogShell` chrome hosting the four sections (profile →
 * parent → plan → payment) with every seam forwarded verbatim. The dialog
 * host owns the draft state, the validation, and the submit handler; this
 * body is their presentation (extracted so each function keeps its line
 * budget).
 *
 * Above the sections sit two resilience affordances: the completeness
 * meter (how far the submit-required text fields are filled, with the
 * percentage caption and the autosave stamp) and the draft-restored
 * notice (a persisted draft was rehydrated on open — the credential
 * never rides the draft, so it is never part of either).
 */

import { HistoryOutlined as HistoryIcon } from "@mui/icons-material";
import { Alert, Button } from "@mui/material";
import type {
  AdminUsersQuery_adminUsers_items,
  PlanCatalogQuery_planCatalog,
} from "@/frontend/graphql/generated/gql/graphql";
import { FormDialogShell } from "@/frontend/views/admin/forms/FormDialogShell";
import { OnboardStudentCompletenessMeter } from "@/frontend/views/admin/students/onboarding/OnboardStudentCompletenessMeter";
import { OnboardStudentParentSection } from "@/frontend/views/admin/students/onboarding/OnboardStudentParentSection";
import { OnboardStudentPaymentSection } from "@/frontend/views/admin/students/onboarding/OnboardStudentPaymentSection";
import { OnboardStudentPlanSection } from "@/frontend/views/admin/students/onboarding/OnboardStudentPlanSection";
import { OnboardStudentProfileSection } from "@/frontend/views/admin/students/onboarding/OnboardStudentProfileSection";
import type {
  OnboardStudentFieldErrors,
  OnboardStudentFormState,
} from "@/frontend/views/admin/students/onboarding/onboardingDialog.types";
import { useAppTranslation } from "@/shared/locale/client";
import { StudentOnboarding } from "@/shared/locale/namespaces/studentOnboarding";

export interface OnboardStudentFormBodyProps {
  readonly form: OnboardStudentFormState;
  /** The host's draft setter (each edit clears the dialog's submit-time errors). */
  readonly setForm: React.Dispatch<React.SetStateAction<OnboardStudentFormState>>;
  readonly submitting: boolean;
  readonly fieldErrors: OnboardStudentFieldErrors;
  /** The derived plan pre-binding (the host parses the same token at submit). */
  readonly selectedPlanId: string;
  readonly parentOptions: readonly AdminUsersQuery_adminUsers_items[];
  readonly planOptions: readonly PlanCatalogQuery_planCatalog[];
  readonly plansLoading: boolean;
  readonly parentsLoading: boolean;
  readonly catalogEmpty: boolean;
  readonly globalError?: string | null;
  /** `true` while the draft-restored notice is visible. */
  readonly draftRestored: boolean;
  /** The draft mirror's last persist stamp — feeds the meter's autosave caption. */
  readonly lastSavedAt: number | null;
  /** The notice's clear action — wipes the form AND the persisted slot. */
  readonly onClearDraft: () => void;
  /** The notice's dismiss action — hides the notice, keeps the draft. */
  readonly onDismissDraftNotice: () => void;
  readonly onClose: () => void;
  /** The host's form submit handler (validated + mapped inside the host). */
  readonly onSubmit: (event: React.SyntheticEvent<HTMLFormElement>) => Promise<void>;
}

/** The submit-required text fields the completeness meter tracks (plan binding excluded — it pre-binds). */
const REQUIRED_TEXT_FIELDS = [
  "fullName",
  "email",
  "phone",
  "password",
  "country",
  "paymentMethod",
  "paymentReference",
] as const;

export function OnboardStudentFormBody({
  form,
  setForm,
  submitting,
  fieldErrors,
  selectedPlanId,
  parentOptions,
  planOptions,
  plansLoading,
  parentsLoading,
  catalogEmpty,
  globalError,
  draftRestored,
  lastSavedAt,
  onClearDraft,
  onDismissDraftNotice,
  onClose,
  onSubmit,
}: OnboardStudentFormBodyProps): React.ReactElement {
  const t = useAppTranslation(StudentOnboarding);
  const filledCount = REQUIRED_TEXT_FIELDS.filter(key => form[key].trim().length > 0).length;
  const completeness = Math.round((filledCount / REQUIRED_TEXT_FIELDS.length) * 100);

  return (
    <FormDialogShell
      titleId="onboard-student-dialog-title"
      dialogTitle={t.title}
      labels={{ cancel: t.actions.cancel, save: t.actions.submit, saving: t.actions.saving }}
      loading={submitting}
      submitDisabled={plansLoading || parentsLoading || catalogEmpty}
      submitHint={t.actions.submitHint}
      globalError={globalError}
      onClose={onClose}
      onSubmit={onSubmit}
    >
      <OnboardStudentCompletenessMeter completeness={completeness} lastSavedAt={lastSavedAt} />
      {draftRestored ? (
        <Alert
          severity="info"
          icon={<HistoryIcon fontSize="small" />}
          sx={{ borderRadius: 2, "& .MuiAlert-message": { py: 0.5 } }}
          action={
            <Button color="inherit" size="small" onClick={onClearDraft}>
              {t.draft.clear}
            </Button>
          }
          onClose={onDismissDraftNotice}
        >
          {t.draft.restored}
        </Alert>
      ) : null}
      <OnboardStudentProfileSection form={form} setForm={setForm} submitting={submitting} fieldErrors={fieldErrors} />
      <OnboardStudentParentSection
        form={form}
        setForm={setForm}
        submitting={submitting}
        parentOptions={parentOptions}
        parentsLoading={parentsLoading}
        fieldErrors={fieldErrors}
      />
      <OnboardStudentPlanSection
        selectedPlanId={selectedPlanId}
        planOptions={planOptions}
        plansLoading={plansLoading}
        catalogEmpty={catalogEmpty}
        setForm={setForm}
        submitting={submitting}
        fieldErrors={fieldErrors}
      />
      <OnboardStudentPaymentSection form={form} setForm={setForm} submitting={submitting} fieldErrors={fieldErrors} />
    </FormDialogShell>
  );
}
