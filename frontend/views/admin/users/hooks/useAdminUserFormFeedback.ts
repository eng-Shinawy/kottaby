"use client";

/**
 * useAdminUserFormFeedback — shared form-submit feedback state for the
 * admin user-management mutation dialogs (create + edit).
 *
 * Both dialogs run the SAME error-projection contract (documented in
 * AdminUserDialogs): the caller's `onSubmit` MUST let rejections propagate —
 * never swallowed by a try/catch at the call site — and this hook's
 * `runWithFeedback` wrapper catches them once and projects:
 *   • GraphQL VALIDATION field errors → `fieldErrors` (inline `helperText`
 *     under the offending input, via `extractFieldErrors` on
 *     `extensions.fields`);
 *   • any other rejection → `formError` (the dialog's top-level Alert, so a
 *     field-less failure like a duplicate-email CONFLICT never leaves the
 *     dialog open with zero feedback).
 *
 * State resets on every submit attempt (`runWithFeedback` clears both stores
 * before invoking the action).
 */

import { useState } from "react";
import { extractErrorMessage, extractFieldErrors } from "@/frontend/lib/graphql-error-utils";

export interface AdminUserFormFeedback {
  /** Per-field error strings keyed by form field name (VALIDATION errors). */
  readonly fieldErrors: Record<string, string>;
  /** Top-level dialog error for rejections WITHOUT a field payload. */
  readonly formError: string | null;
  /** Runs an async submit action and projects any rejection into the stores. */
  readonly runWithFeedback: (action: () => Promise<void>) => Promise<void>;
}

export function useAdminUserFormFeedback(): AdminUserFormFeedback {
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  // Top-level fallback for rejections WITHOUT a field payload (e.g. a
  // duplicate-email CONFLICT on create, USER_NOT_FOUND on a stale row on
  // edit) — without it the dialog would stay open with zero feedback,
  // leaving the admin to guess why nothing happened.
  const [formError, setFormError] = useState<string | null>(null);

  const runWithFeedback = async (action: () => Promise<void>): Promise<void> => {
    setFieldErrors({});
    setFormError(null);
    try {
      await action();
    } catch (err) {
      // `err` is `unknown` in a catch block (strict mode) — no `as unknown`
      // cast needed before passing to the error extractor helpers.
      const errors = extractFieldErrors(err);
      if (Object.keys(errors).length > 0) {
        setFieldErrors(errors);
      } else {
        setFormError(extractErrorMessage(err));
      }
    }
  };

  return { fieldErrors, formError, runWithFeedback };
}
