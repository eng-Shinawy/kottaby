"use client";

/**
 * useChangePasswordForm — state, client validation, and mutation wiring for
 * `ChangePasswordForm` (the body of the top-level `/change-password` page).
 *
 * Owns the `changeMyPassword` mutation and the three-field credential form
 * (current / new / confirm):
 *  - Client-side checks (required, the shared 8-character floor, confirm
 *    match) run BEFORE the round-trip and surface through the same inline
 *    helper-text channels the server field errors use — a typo never costs
 *    a request.
 *  - Server denials are projected through the shared Apollo error-mapping
 *    seam (`frontend/lib/graphql-error-utils.ts`): `extractFieldErrors`
 *    reads the pre-localized `extensions.fields[]` payload so
 *    `CURRENT_PASSWORD_INVALID` lands inline under the current-password
 *    input, `NEW_PASSWORD_SAME_AS_CURRENT` (and the shared policy's
 *    `password`-tagged length/empty denials) under the new-password input;
 *    field-less denials fall back to `extractErrorMessage` in the top-level
 *    Alert — and when NO wire message survives the cause chain at all
 *    (transport-level failure), the neutral `changePassword.genericFailure`
 *    copy renders instead (an expired session additionally trips the
 *    global error-link redirect).
 *  - On success the mutation's returned user (`mustChangePassword: false`
 *    echoing the server-side flag clear) is merged into the AuthProvider
 *    session snapshot via `updateSessionUser` BEFORE the hand-off — the
 *    `DashboardLayout` forced-reset mirror reads that snapshot, and a
 *    stale `true` would bounce the just-changed user straight back to
 *    this page when the role dashboard mounts. The success copy then
 *    renders for a short beat (the same rhythm
 *    the register flow uses) before the user is routed to their
 *    role-specific dashboard via `roleDashboardPath` — never bare
 *    `/dashboard` (the preview-gateway redirect loop). The delayed hand-off
 *    is owned by an effect keyed on the success state so its timer is
 *    always cleaned up (no replace firing after unmount).
 *
 * Presentation stays in `ChangePasswordForm`; this module returns plain
 * state — no JSX.
 */

import { useMutation } from "@apollo/client/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { changeMyPasswordMutationDocument } from "@/frontend/graphql/sharedDocuments/auth/auth.documents";
import { useAuth } from "@/frontend/hooks/auth";
import { roleDashboardPath } from "@/frontend/lib/auth/roleDashboardRoute";
import { extractErrorMessage, extractFieldErrors } from "@/frontend/lib/graphql-error-utils";
import { Auth, useAppTranslation } from "@/shared/locale";

/**
 * Client-side credential floor — mirrors the shared server policy
 * (`MIN_PASSWORD_LENGTH = 8`), so the inline message fires before a doomed
 * request is sent.
 */
const MIN_CREDENTIAL_LENGTH = 8;

/** How long the success copy stays visible before the dashboard hand-off. */
const REDIRECT_DELAY_MS = 1500;

/**
 * The three inputs this form renders. Client validation errors and the
 * normalized server field errors are both keyed by these names so the view
 * can merge the two stores per field.
 */
type ChangePasswordField = "currentPassword" | "newPassword" | "confirmPassword";

/**
 * Renames the server's `extensions.fields[]` entries onto this form's input
 * names. The shared password-policy helper tags length/empty denials with
 * the field name `password` — on this surface that denial always describes
 * the NEW password, so it lands under the new-password input.
 */
function projectServerFieldErrors(raw: Record<string, string>): Partial<Record<ChangePasswordField, string>> {
  const projected: Partial<Record<ChangePasswordField, string>> = {};
  if (raw.currentPassword) projected.currentPassword = raw.currentPassword;
  const newPasswordError = raw.newPassword ?? raw.password;
  if (newPasswordError) projected.newPassword = newPasswordError;
  return projected;
}

/**
 * Client-side pre-flight checks — the same policy the server enforces
 * (required fields, the shared 8-character floor, confirm match). Returns
 * the per-field messages keyed by input name; empty when clean. Extracted
 * to module scope so the hook stays within its line budget.
 */
function collectClientCredentialErrors(
  currentPassword: string,
  newPassword: string,
  confirmPassword: string,
  messages: { readonly required: string; readonly tooShort: string; readonly mismatch: string }
): Partial<Record<ChangePasswordField, string>> {
  const errors: Partial<Record<ChangePasswordField, string>> = {};
  if (currentPassword.trim().length === 0) {
    errors.currentPassword = messages.required;
  }
  if (newPassword.trim().length === 0) {
    errors.newPassword = messages.required;
  } else if (newPassword.length < MIN_CREDENTIAL_LENGTH) {
    errors.newPassword = messages.tooShort;
  }
  if (confirmPassword !== newPassword) {
    errors.confirmPassword = messages.mismatch;
  }
  return errors;
}

export function useChangePasswordForm() {
  const t = useAppTranslation(Auth);
  const router = useRouter();
  const { user, updateSessionUser } = useAuth();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  // Client-side pre-validation messages (same inline channels as the server
  // `fieldErrors`; the two stores merge per field at render time).
  const [validationErrors, setValidationErrors] = useState<Partial<Record<ChangePasswordField, string>>>({});
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<ChangePasswordField, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [succeeded, setSucceeded] = useState(false);
  const [changeMyPassword, { loading }] = useMutation(changeMyPasswordMutationDocument);

  const handleSubmit = useCallback(
    async (event: React.SubmitEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (succeeded) return;
      setFormError(null);

      // Client-side checks first — the same policy the server enforces
      // (required / 8-character floor) plus the confirm-match guard.
      const clientErrors = collectClientCredentialErrors(currentPassword, newPassword, confirmPassword, {
        required: t.passwordRequired,
        tooShort: t.passwordTooShort,
        mismatch: t.changePassword.mismatch,
      });
      if (Object.keys(clientErrors).length > 0) {
        setValidationErrors(clientErrors);
        return;
      }
      setValidationErrors({});

      try {
        const result = await changeMyPassword({ variables: { input: { currentPassword, newPassword } } });
        // Snapshot sync FIRST (before the success beat starts its delayed
        // replace): merge the server-authoritative result —
        // `{ id, email, fullName, role, mustChangePassword: false }` — into
        // the AuthProvider session snapshot, so the DashboardLayout
        // forced-reset mirror sees the cleared flag when the role
        // dashboard mounts instead of bouncing the just-changed user back
        // to this page. Guarded: a missing payload skips the merge.
        const changedUser = result.data?.changeMyPassword;
        if (changedUser) updateSessionUser(changedUser);
        setFieldErrors({});
        setSucceeded(true); // success beat — the delayed replace lives in the effect below
      } catch (err) {
        // Field-targeted denials first — the server messages arrive
        // pre-localized via `extensions.fields`.
        const serverFields = projectServerFieldErrors(extractFieldErrors(err));
        if (Object.keys(serverFields).length > 0) {
          setFieldErrors(serverFields);
          return;
        }
        // Field-less denial (e.g. a transient failure): the wire message is
        // server-localized — surface it in the top-level Alert. When NO
        // message survives anywhere in the cause chain, fall back to THIS
        // surface's neutral failure copy (never the login-specific line).
        // An expired session additionally trips the global error-link
        // redirect.
        setFormError(extractErrorMessage(err) ?? t.changePassword.genericFailure);
      }
    },
    [succeeded, currentPassword, newPassword, confirmPassword, t, changeMyPassword, updateSessionUser]
  );

  // Success hand-off: the delayed `router.replace` lives in this effect (keyed
  // on `succeeded`) so its timer is always cleaned up — never firing against
  // an unmounted form. `replace` keeps the forced gate out of the history
  // stack; the target is the loop-safe role dashboard, never bare `/dashboard`.
  useEffect(() => {
    if (!succeeded) return undefined;
    const timer = setTimeout(() => router.replace(roleDashboardPath(user?.role)), REDIRECT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [succeeded, router, user?.role]);

  return {
    t,
    currentPassword,
    setCurrentPassword,
    newPassword,
    setNewPassword,
    confirmPassword,
    setConfirmPassword,
    showCurrent,
    setShowCurrent,
    showNew,
    setShowNew,
    showConfirm,
    setShowConfirm,
    validationErrors,
    fieldErrors,
    formError,
    succeeded,
    loading,
    handleSubmit,
  };
}
