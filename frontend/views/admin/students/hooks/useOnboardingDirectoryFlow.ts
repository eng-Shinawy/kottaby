"use client";

/**
 * useOnboardingDirectoryFlow — the students directory's onboarding
 * orchestration, extracted from the container: the dialog open state,
 * the success payload + server-rejection projection, the batch-history
 * recorder, and the lazy option feeds (gated on the dialog being open —
 * browse-only visits issue no option reads).
 *
 * Every completed onboarding re-fetches this directory through its live
 * query variables (the mutation hook's refetch contract) and lands in
 * the versioned recent slot so the success screen can re-offer any
 * recent handoff code. Closing and restarting share ONE outcome reset —
 * a reopened dialog never greets with stale success or rejection state.
 */

import { useState } from "react";
import type {
  AdminOnboardStudentOfflineInput,
  AdminOnboardStudentWithOfflinePaymentMutation_adminOnboardStudentWithOfflinePayment,
  AdminStudentsQueryVariables,
  AdminUsersQuery_adminUsers_items,
  PlanCatalogQuery_planCatalog,
} from "@/frontend/graphql/generated/gql/graphql";
import {
  type RecentOnboardingEntry,
  useOnboardingPlanOptions,
  useOnboardStudentFormFeedback,
  useOnboardStudentMutation,
  useOnboardStudentRecent,
} from "@/frontend/views/admin/students/onboarding/hooks";
import type { OnboardStudentFieldErrors } from "@/frontend/views/admin/students/onboarding/onboardingDialog.types";

/** The container-facing onboarding flow (state + seams, one shape). */
export interface OnboardingDirectoryFlow {
  readonly onboardingOpen: boolean;
  readonly openOnboarding: () => void;
  /** Close seam — also clears the success payload + server feedback. */
  readonly closeOnboarding: () => void;
  /** Restart seam — clears the outcome while the dialog STAYS open. */
  readonly startAnotherOnboarding: () => void;
  readonly onboardSuccess: AdminOnboardStudentWithOfflinePaymentMutation_adminOnboardStudentWithOfflinePayment | null;
  /** The remembered batch history (previous onboardings, newest first). */
  readonly recent: readonly RecentOnboardingEntry[];
  readonly planOptions: readonly PlanCatalogQuery_planCatalog[];
  readonly parentOptions: readonly AdminUsersQuery_adminUsers_items[];
  readonly plansLoading: boolean;
  readonly parentsLoading: boolean;
  /** True while the onboarding mutation (or its awaited refetch) is in flight. */
  readonly submitting: boolean;
  readonly serverFieldErrors: OnboardStudentFieldErrors;
  readonly globalError: string | null;
  readonly onSubmit: (input: AdminOnboardStudentOfflineInput) => Promise<void>;
}

export function useOnboardingDirectoryFlow(directoryVariables: AdminStudentsQueryVariables): OnboardingDirectoryFlow {
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [onboardSuccess, setOnboardSuccess] =
    useState<AdminOnboardStudentWithOfflinePaymentMutation_adminOnboardStudentWithOfflinePayment | null>(null);
  const { planOptions, parentOptions, plansLoading, parentsLoading } = useOnboardingPlanOptions({
    enabled: onboardingOpen,
  });
  const { onboardStudent, submitting } = useOnboardStudentMutation(directoryVariables);
  const { serverFieldErrors, globalError, runWithFeedback, resetFeedback } = useOnboardStudentFormFeedback();
  const { recent, recordOnboarding } = useOnboardStudentRecent();

  const openOnboarding = () => setOnboardingOpen(true);
  const resetOutcome = () => {
    setOnboardSuccess(null);
    resetFeedback();
  };
  const closeOnboarding = () => {
    setOnboardingOpen(false);
    resetOutcome();
  };
  const startAnotherOnboarding = resetOutcome;

  const onSubmit = (input: AdminOnboardStudentOfflineInput) =>
    runWithFeedback(async () => {
      const result = await onboardStudent(input);
      if (result) {
        setOnboardSuccess(result);
        recordOnboarding(result);
      }
    });

  return {
    onboardingOpen,
    openOnboarding,
    closeOnboarding,
    startAnotherOnboarding,
    onboardSuccess,
    recent,
    planOptions,
    parentOptions,
    plansLoading,
    parentsLoading,
    submitting,
    serverFieldErrors,
    globalError,
    onSubmit,
  };
}
