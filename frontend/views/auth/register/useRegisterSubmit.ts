"use client";

import { useMutation } from "@apollo/client/react";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import type { UseFormSetError } from "react-hook-form";
import { registerUserMutationDocument } from "@/frontend/graphql/sharedDocuments/auth/auth.documents";
import { extractErrorCode, extractErrorMessage } from "@/frontend/lib/graphql-error-utils";
import { applyProjectedFieldErrors, projectMutationFieldErrors } from "@/frontend/lib/mutationFieldErrors";
import { isRegisterFieldPath, type RegisterFormValues } from "@/frontend/views/auth/register";
import type { AuthLabels } from "@/shared/locale/types/auth";

/**
 * Owns the RegisterForm's submit pipeline: the `registerUser` mutation, the
 * banner-message state, and the `onSubmit` handler. On failure the raw Apollo
 * error runs through `projectMutationFieldErrors` (the client mapping table
 * re-entered with `hasForm:true`); returned `extensions.fields[]` pairs are
 * whitelisted through {@link isRegisterFieldPath} and applied via
 * `applyProjectedFieldErrors`. When pairs were applied the global alert stays
 * suppressed — per-field mapping REPLACES the fallback copy; otherwise the
 * pre-existing code branches render unchanged (CONFLICT → `emailAlreadyExists`,
 * VALIDATION → localized wire message, else → `registrationFailed`).
 *
 * On success the form shows `registrationSuccess`, then redirects to `/login`
 * (registration does NOT issue a token — the user must sign in to
 * authenticate).
 */
export function useRegisterSubmit(setError: UseFormSetError<RegisterFormValues>, t: AuthLabels) {
  const router = useRouter();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [registerMutation, { loading }] = useMutation(registerUserMutationDocument);

  const onSubmit = useCallback(
    async (data: RegisterFormValues) => {
      setErrorMessage(null);

      // Unreachable while the required role rule holds; keeps `data.role`
      // narrowed to the `RegisterPublicRole` union for the variables below.
      if (!data.role) return;

      try {
        await registerMutation({
          variables: {
            input: {
              fullName: data.fullName.trim(),
              email: data.email.trim(),
              phone: data.phone.trim(),
              password: data.password,
              gender: data.gender,
              country: data.country.trim(),
              role: data.role,
              // Pass the optional preferredRecitation (null when no selection).
              // Guardrail: NOT persisted to `recitation` — contract metadata only.
              preferredRecitation: data.preferredRecitation,
            },
          },
        });
        // Show a brief success message before redirecting to /login.
        setSuccessMessage(t.registrationSuccess);
        setTimeout(() => router.push("/login"), 1500);
      } catch (err) {
        // Server tier FIRST: project extensions.fields[] into RHF pairs via
        // the client mapping (hasForm:true direct call — the app-scope
        // listener seam is left untouched). Unknown wire paths skipped.
        const projected = projectMutationFieldErrors(err);
        const applied = applyProjectedFieldErrors(projected, isRegisterFieldPath, (field, errorOptions) =>
          setError(field, { type: "server", message: errorOptions.message })
        );
        if (applied > 0) return; // per-field mapping REPLACES the global fallback

        const code = extractErrorCode(err);
        if (code === "CONFLICT") {
          setErrorMessage(t.emailAlreadyExists);
        } else if (code === "VALIDATION") {
          // Surface the server-side validation message (already localized
          // by `getServerTranslations(locale).authTranslations` on the backend).
          const msg = extractErrorMessage(err);
          setErrorMessage(msg ?? t.registrationFailed);
        } else {
          setErrorMessage(t.registrationFailed);
        }
      }
    },
    [registerMutation, router, setError, t]
  );

  return { onSubmit, loading, errorMessage, successMessage };
}
