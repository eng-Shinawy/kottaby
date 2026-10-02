"use client";

/**
 * useOnboardingCleanSlate — the onboarding dialog's reset seams in ONE
 * shape: every exit path (close, restart, notice-clear) tears the draft
 * down (state + persisted slot + submit-time client errors) before the
 * caller's own seam runs. The restart seam is plan-seed capable — an id
 * pre-binds the same plan onto the fresh draft (a deliberate seed the
 * draft mirror persists; the dialog's stale-option hygiene still guards
 * a plan that has since left the active catalog).
 */

import type { OnboardStudentFormState } from "@/frontend/views/admin/students/onboarding/onboardingDialog.types";

/** The dialog-owned seams the clean slate composes over. */
export interface OnboardingCleanSlateOptions {
  /** The draft hook's wipe (form + persisted slot + restore notice). */
  readonly clearDraft: () => void;
  /** The draft hook's controlled setter (seeds the same-plan restart). */
  readonly updateForm: (update: React.SetStateAction<OnboardStudentFormState>) => void;
  /** Drops the dialog's submit-time client errors. */
  readonly resetClientErrors: () => void;
  /** The dialog's close seam. */
  readonly onClose: () => void;
  /** The container's outcome reset (the dialog stays up). */
  readonly onStartAnother: (planId?: string) => void;
}

/** The unified reset seams (stable names, fresh closures per render — plain composition). */
export interface OnboardingCleanSlate {
  /** Close seam — wipe, then close. */
  readonly handleClose: () => void;
  /** Restart seam — wipe, optionally seed the plan, keep the dialog up. */
  readonly handleStartAnother: (planId?: string) => void;
  /** The notice's clear action — wipe everything except the dialog stays up. */
  readonly handleClearDraft: () => void;
}

export function useOnboardingCleanSlate({
  clearDraft,
  updateForm,
  resetClientErrors,
  onClose,
  onStartAnother,
}: OnboardingCleanSlateOptions): OnboardingCleanSlate {
  const withFreshDraft = (seam: () => void) => {
    clearDraft();
    resetClientErrors();
    seam();
  };
  return {
    handleClose: () => withFreshDraft(onClose),
    handleStartAnother: (planId?: string) =>
      withFreshDraft(() => {
        if (planId) updateForm(prev => ({ ...prev, planId }));
        onStartAnother(planId);
      }),
    handleClearDraft: () => withFreshDraft(() => undefined),
  };
}
