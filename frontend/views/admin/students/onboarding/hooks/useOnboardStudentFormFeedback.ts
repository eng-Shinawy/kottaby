"use client";

/**
 * useOnboardStudentFormFeedback — server-rejection feedback for the
 * onboarding dialog, projected onto the dialog's two error props.
 *
 * The caller's submit action MUST let rejections propagate — never
 * swallowed by a try/catch at the call site — and `runWithFeedback`
 * catches them once and projects:
 *   • GraphQL VALIDATION field payloads (`extensions.fields[]`) →
 *     `serverFieldErrors`, keyed by the form field name so each message
 *     renders inline as `helperText` under its input;
 *   • any field-less rejection → `globalError` (the dialog shell's
 *     top-level alert band, so a duplicate-email CONFLICT or an unknown
 *     plan never leaves the dialog open with zero feedback).
 *
 * Server messages are rendered VERBATIM — no client-side re-translation;
 * the backend localizes through the same i18n catalogs this client uses.
 *
 * State resets on every submit attempt; `resetFeedback` additionally
 * clears both stores without a submit (the dialog close affordance uses
 * it so a reopened dialog never greets with a stale rejection).
 */

import { useState } from "react";
import { extractErrorMessage, extractFieldErrors } from "@/frontend/lib/graphql-error-utils";
import type { OnboardStudentFieldErrors } from "@/frontend/views/admin/students/onboarding/onboardingDialog.types";

export interface OnboardStudentFormFeedback {
  /** Per-field server VALIDATION messages keyed by the form field name. */
  readonly serverFieldErrors: OnboardStudentFieldErrors;
  /** Top-level alert-band text for rejections WITHOUT a field payload. */
  readonly globalError: string | null;
  /** Runs an async submit action and projects any rejection into the stores. */
  readonly runWithFeedback: (action: () => Promise<void>) => Promise<void>;
  /** Clears both stores without a submit (dialog close/reset affordance). */
  readonly resetFeedback: () => void;
}

export function useOnboardStudentFormFeedback(): OnboardStudentFormFeedback {
  const [serverFieldErrors, setServerFieldErrors] = useState<OnboardStudentFieldErrors>({});
  // Top-level fallback for rejections WITHOUT a field payload — without it
  // the dialog would stay open with zero feedback and the admin would be
  // left guessing why nothing happened.
  const [globalError, setGlobalError] = useState<string | null>(null);

  const runWithFeedback = async (action: () => Promise<void>): Promise<void> => {
    setServerFieldErrors({});
    setGlobalError(null);
    try {
      await action();
    } catch (err) {
      // `err` is `unknown` in a catch block (strict mode) — the extractor
      // helpers accept it directly, no cast needed.
      const errors = extractFieldErrors(err);
      if (Object.keys(errors).length > 0) {
        setServerFieldErrors(errors);
      } else {
        setGlobalError(extractErrorMessage(err));
      }
    }
  };

  const resetFeedback = () => {
    setServerFieldErrors({});
    setGlobalError(null);
  };

  return { serverFieldErrors, globalError, runWithFeedback, resetFeedback };
}
