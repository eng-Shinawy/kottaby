"use client";

/**
 * OnboardStudentDialog — the admin's direct student onboarding dialog:
 * ONE dialog hosting the four sections (profile → parent (optional) →
 * plan → offline payment) on the shared `FormDialogShell` chrome (title,
 * cancel/save/saving actions, global error band), plus the post-submit
 * success state (`OnboardStudentSuccessContent`).
 *
 * Seams — the hooks layer owns the data and plugs in through these props:
 *  - `parentOptions` / `planOptions`: the role-filtered directory page and
 *    the active catalog, passed through verbatim (no mapping);
 *  - `plansLoading` / `parentsLoading`: the option feeds' in-flight flags —
 *    they hold the submit unavailable until both have resolved AND surface
 *    as in-flight placeholders in the plan/parent sections (the loaded
 *    catalog being empty keeps the submit unavailable too — no plan to bind);
 *  - `onSubmit`: called with the validated, mapped
 *    `AdminOnboardStudentOfflineInput` (the mutation hook's variables);
 *  - `globalError` / `serverFieldErrors`: pre-mapped server rejections
 *    rendered verbatim (band + inline `helperText`);
 *  - `success`: the mutation payload that swaps the form for the handoff
 *    display until the dialog is closed.
 *
 * Draft resilience — the controlled draft (the credential NEVER persists)
 * mirrors into a versioned localStorage slot through
 * `useOnboardStudentDraft`; an accidental close or a reload restores it on
 * the next open under a dismissible notice (with an explicit clear), and
 * the mirror's persist stamp feeds the meter's autosave caption. The
 * clean-slate seams below ALSO wipe the slot: every close routed through
 * the dialog's own affordances (cancel, esc/backdrop, success dismiss) and
 * the success screen's restart clear the draft, so a deliberate reset
 * still starts an empty onboarding.
 */

import { Dialog } from "@mui/material";
import type { SxProps, Theme } from "@mui/material/styles";
import { useEffect, useState } from "react";
import type {
  AdminOnboardStudentOfflineInput,
  AdminOnboardStudentWithOfflinePaymentMutation_adminOnboardStudentWithOfflinePayment,
  AdminUsersQuery_adminUsers_items,
  PlanCatalogQuery_planCatalog,
} from "@/frontend/graphql/generated/gql/graphql";
import {
  type RecentOnboardingEntry,
  useOnboardingCleanSlate,
  useOnboardStudentDraft,
} from "@/frontend/views/admin/students/onboarding/hooks";
import { OnboardStudentFormBody } from "@/frontend/views/admin/students/onboarding/OnboardStudentFormBody";
import { OnboardStudentSuccessContent } from "@/frontend/views/admin/students/onboarding/OnboardStudentSuccessContent";
import {
  buildOnboardStudentInput,
  type OnboardStudentFieldErrors,
  type OnboardStudentFormState,
  validateOfflinePaymentDraft,
} from "@/frontend/views/admin/students/onboarding/onboardingDialog.types";
import { useAppTranslation } from "@/shared/locale/client";
import { StudentOnboarding } from "@/shared/locale/namespaces/studentOnboarding";

/** Dialog scrim — one step past MUI's 50% scrim plus a subtle blur so the page behind reads as depth, not noise. */
const BACKDROP_SX: SxProps<Theme> = {
  backgroundColor: "color-mix(in srgb, var(--mui-palette-scrim) 60%, transparent)",
  backdropFilter: "blur(2px)",
  WebkitBackdropFilter: "blur(2px)",
};

export interface OnboardStudentDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** Parent-role directory rows for the optional association picker. */
  readonly parentOptions: readonly AdminUsersQuery_adminUsers_items[];
  /** Active catalog plans for the plan picker. */
  readonly planOptions: readonly PlanCatalogQuery_planCatalog[];
  /** True while the plan-catalog read is in flight (submit unavailable). */
  readonly plansLoading: boolean;
  /** True while the parent-directory read is in flight (submit unavailable). */
  readonly parentsLoading: boolean;
  /** True while the onboarding mutation is in flight (disables the form). */
  readonly submitting: boolean;
  /** Top-level server rejection — rendered verbatim in the shell's band. */
  readonly globalError?: string | null;
  /** Per-field server VALIDATION messages keyed by input field name. */
  readonly serverFieldErrors?: OnboardStudentFieldErrors;
  /** Submit seam — receives the validated, mapped onboarding input. */
  readonly onSubmit: (input: AdminOnboardStudentOfflineInput) => Promise<void>;
  /** Mutation payload — non-null swaps the form for the success content. */
  readonly success: AdminOnboardStudentWithOfflinePaymentMutation_adminOnboardStudentWithOfflinePayment | null;
  /** The remembered batch history — the success screen lists previous onboardings. */
  readonly recent: readonly RecentOnboardingEntry[];
  /**
   * Restart seam — the success screen's "onboard another" affordance: the
   * container clears its success payload + server feedback (the dialog
   * clears its own draft) and the empty form returns without a close.
   * An optional plan id asks the dialog to pre-bind that plan onto the
   * fresh draft (the same-plan restart affordance).
   */
  readonly onStartAnother: (planId?: string) => void;
}

export function OnboardStudentDialog({
  open,
  onClose,
  parentOptions,
  planOptions,
  plansLoading,
  parentsLoading,
  submitting,
  globalError,
  serverFieldErrors,
  onSubmit,
  success,
  recent,
  onStartAnother,
}: OnboardStudentDialogProps): React.ReactElement {
  const t = useAppTranslation(StudentOnboarding);
  const { form, draftRestored, lastSavedAt, updateForm, clearDraft, dismissDraftNotice } = useOnboardStudentDraft(open);
  const [clientFieldErrors, setClientFieldErrors] = useState<OnboardStudentFieldErrors>({});
  // The plan bound at the last successful submit — feeds the success
  // screen's receipt chip and its same-plan restart affordance.
  const [lastPlan, setLastPlan] = useState<{ id: string; title: string } | null>(null);

  // Each edit clears the dialog's submit-time errors (server rejections ride the hooks seam).
  const handleFormUpdate: React.Dispatch<React.SetStateAction<OnboardStudentFormState>> = update => {
    updateForm(update);
    setClientFieldErrors({});
  };

  // Stale-option hygiene: a restored draft may bind a plan that has since
  // left the active catalog — unbind it once the catalog resolves so the
  // pre-binding falls back to a live row instead of failing at submit.
  useEffect(() => {
    if (plansLoading || planOptions.length === 0 || !form.planId) return;
    if (!planOptions.some(plan => plan.id === form.planId)) {
      updateForm(prev => ({ ...prev, planId: "" }));
    }
  }, [plansLoading, planOptions, form.planId, updateForm]);

  // Clean-slate seams: close/restart/notice-clear tear the draft down
  // (state + persisted slot + submit-time client errors) first.
  const { handleClose, handleStartAnother, handleClearDraft } = useOnboardingCleanSlate({
    clearDraft,
    updateForm,
    resetClientErrors: () => setClientFieldErrors({}),
    onClose,
    onStartAnother,
  });

  // Plan pre-binding: the first active catalog plan stays selected until the admin picks one.
  const selectedPlanId = form.planId || planOptions[0]?.id || "";
  const fieldErrors: OnboardStudentFieldErrors = { ...serverFieldErrors, ...clientFieldErrors };
  // Submit availability: the plan binds only an ACTIVE row — unavailable while
  // either feed is in flight or the catalog is empty (the hint renders then).
  const catalogEmpty = !plansLoading && planOptions.length === 0;
  const submitUnavailable = plansLoading || parentsLoading || catalogEmpty;

  const handleSubmit = async (event: React.SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();

    // Belt for the disabled save button: no input while the feeds are unresolved.
    if (submitUnavailable) {
      return;
    }

    const clientErrors = validateOfflinePaymentDraft(form, t.errors);
    // The plan id arrives as a GraphQL ID string; the Int input rides the
    // parsed numeric form only when it is a real card id (safe-integer guard).
    const parsedPlanId = Number.parseInt(selectedPlanId, 10);
    const planId = Number.isSafeInteger(parsedPlanId) ? parsedPlanId : null;

    if (Object.keys(clientErrors).length > 0 || planId === null) {
      setClientFieldErrors(clientErrors);
      return;
    }

    // Remember the effective binding while the plan facts are still in
    // hand — the payload itself carries no plan identity.
    const planTitle = planOptions.find(plan => plan.id === selectedPlanId)?.title ?? null;
    setLastPlan(planTitle ? { id: selectedPlanId, title: planTitle } : null);

    await onSubmit(buildOnboardStudentInput(form, planId));
  };

  return (
    <Dialog
      open={open}
      onClose={submitting ? undefined : handleClose}
      maxWidth="sm"
      fullWidth
      aria-labelledby="onboard-student-dialog-title"
      slotProps={{ backdrop: { sx: BACKDROP_SX } }}
    >
      {open &&
        (success ? (
          <OnboardStudentSuccessContent
            result={success}
            recent={recent}
            onClose={handleClose}
            onOnboardAnother={() => handleStartAnother()}
            planTitle={lastPlan?.title ?? null}
            onOnboardAnotherSamePlan={lastPlan ? () => handleStartAnother(lastPlan.id) : undefined}
          />
        ) : (
          <OnboardStudentFormBody
            form={form}
            setForm={handleFormUpdate}
            submitting={submitting}
            fieldErrors={fieldErrors}
            selectedPlanId={selectedPlanId}
            parentOptions={parentOptions}
            planOptions={planOptions}
            plansLoading={plansLoading}
            parentsLoading={parentsLoading}
            catalogEmpty={catalogEmpty}
            globalError={globalError}
            draftRestored={draftRestored}
            lastSavedAt={lastSavedAt}
            onClearDraft={handleClearDraft}
            onDismissDraftNotice={dismissDraftNotice}
            onClose={handleClose}
            onSubmit={handleSubmit}
          />
        ))}
    </Dialog>
  );
}
