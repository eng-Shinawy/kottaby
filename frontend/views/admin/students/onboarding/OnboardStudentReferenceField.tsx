"use client";

/**
 * OnboardStudentReferenceField — the payment-reference input of the
 * onboarding dialog: REQUIRED for every offline method, bounded 1–255
 * client-side (the service re-validates), carrying the two data-quality
 * affordances:
 *  - the scholarship leg's quick-generator (the documented `SCH-` shape,
 *    crypto-random over a zero-ambiguity alphabet — uniqueness still
 *    arbitrated server-side by the partial unique index);
 *  - paste hygiene (`useReferencePasteNormalization`): a pasted token is
 *    normalized once at the selection and the helper line honestly says so
 *    (success tint) instead of silently rewriting the field.
 */

import { AutoFixHighOutlined as GenerateIcon } from "@mui/icons-material";
import { IconButton, InputAdornment, TextField } from "@mui/material";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import { PaymentGateway } from "@/frontend/graphql/generated/gql/graphql";
import { useReferencePasteNormalization } from "@/frontend/views/admin/students/onboarding/hooks";
import type {
  OnboardStudentFieldErrors,
  OnboardStudentFormState,
} from "@/frontend/views/admin/students/onboarding/onboardingDialog.types";
import { useAppTranslation } from "@/shared/locale/client";
import { StudentOnboarding } from "@/shared/locale/namespaces/studentOnboarding";
import type { StudentOnboardingLabels } from "@/shared/locale/types/studentOnboarding";

/** Single-token lookup for the scholarship member (the repo's no-enum-comparisons discipline). */
const IS_SCHOLARSHIP_TOKEN: Record<string, true> = {
  [PaymentGateway.Scholarship]: true,
};

/**
 * Builds a scholarship payment reference — the documented convention for
 * the scholarship leg (`SCH-` + 8 unambiguous crypto-random characters).
 * A data-entry accelerator only: uniqueness is still arbitrated server-
 * side by the partial unique index on `payment_reference`.
 */
function generateScholarshipReference(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let token = "";
  for (const byte of bytes) {
    token += alphabet[byte % alphabet.length];
  }
  return `SCH-${token}`;
}

/** Helper-line resolver with early returns: error → cleaned notice → static helper. */
function resolveReferenceHelperText(
  error: string | undefined,
  cleaned: boolean,
  copy: StudentOnboardingLabels["paymentSection"]
): string {
  if (error !== undefined) return error;
  if (cleaned) return copy.referenceCleaned;
  return copy.referenceHelper;
}

interface OnboardStudentReferenceFieldProps {
  readonly form: OnboardStudentFormState;
  /** Draft setter owned by the dialog host (threaded through verbatim). */
  readonly setForm: Dispatch<SetStateAction<OnboardStudentFormState>>;
  readonly submitting: boolean;
  readonly fieldErrors: OnboardStudentFieldErrors;
}

export function OnboardStudentReferenceField({
  form,
  setForm,
  submitting,
  fieldErrors,
}: OnboardStudentReferenceFieldProps): ReactNode {
  const t = useAppTranslation(StudentOnboarding);
  const { cleaned, onPaste } = useReferencePasteNormalization(
    () => form.paymentReference,
    next => setForm(prev => ({ ...prev, paymentReference: next }))
  );
  const helper = resolveReferenceHelperText(fieldErrors.paymentReference, cleaned, t.paymentSection);

  return (
    <TextField
      label={t.paymentSection.reference}
      value={form.paymentReference}
      onChange={event => setForm(prev => ({ ...prev, paymentReference: event.target.value }))}
      onPaste={onPaste}
      required
      fullWidth
      disabled={submitting}
      error={Boolean(fieldErrors.paymentReference)}
      helperText={helper}
      aria-invalid={Boolean(fieldErrors.paymentReference)}
      slotProps={{
        formHelperText: {
          sx: theme => ({
            color: cleaned && fieldErrors.paymentReference === undefined ? theme.palette.success.main : undefined,
          }),
        },
        htmlInput: { dir: "ltr" },
        input: {
          endAdornment: Object.hasOwn(IS_SCHOLARSHIP_TOKEN, form.paymentMethod) ? (
            // The scholarship leg's quick-generator — a desk admin no
            // longer invents the unique reference by hand; the token is
            // the documented `SCH-` shape, server uniqueness still holds.
            <InputAdornment position="end">
              <IconButton
                size="small"
                aria-label={t.paymentSection.generateReference}
                title={t.paymentSection.generateReference}
                disabled={submitting}
                onClick={() => setForm(prev => ({ ...prev, paymentReference: generateScholarshipReference() }))}
                sx={theme => ({ color: theme.palette.primary.main })}
              >
                <GenerateIcon sx={{ fontSize: 20 }} />
              </IconButton>
            </InputAdornment>
          ) : undefined,
        },
      }}
    />
  );
}
