"use client";

/**
 * OnboardStudentPaymentSection — the offline payment of the onboarding
 * dialog: a three-segment exclusive `ToggleButtonGroup` over the offline
 * gateway members (`OfflineCash` | `BankTransfer` | `Scholarship`) plus the
 * payment-reference input (extracted into `OnboardStudentReferenceField`
 * beside this file — required for every method, the 1–255 bounds mirrored
 * client-side; the service re-validates). The token space reuses the
 * `PaymentGateway` member strings through `Record` lookups (no enum
 * comparisons).
 */

import {
  AccountBalanceOutlined as BankIcon,
  PaymentsOutlined as CashIcon,
  SchoolOutlined as ScholarshipIcon,
} from "@mui/icons-material";
import { FormHelperText, Stack, ToggleButton, ToggleButtonGroup } from "@mui/material";
import type { SxProps, Theme } from "@mui/material/styles";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import { PaymentGateway } from "@/frontend/graphql/generated/gql/graphql";
import { OnboardStudentReferenceField } from "@/frontend/views/admin/students/onboarding/OnboardStudentReferenceField";
import { OnboardStudentSectionHeading } from "@/frontend/views/admin/students/onboarding/OnboardStudentSectionHeading";
import type {
  OnboardStudentFieldErrors,
  OnboardStudentFormState,
} from "@/frontend/views/admin/students/onboarding/onboardingDialog.types";
import { useAppTranslation } from "@/shared/locale/client";
import { StudentOnboarding } from "@/shared/locale/namespaces/studentOnboarding";
import type { StudentOnboardingLabels } from "@/shared/locale/types/studentOnboarding";

/** Section caption glyph — rides `primary.main` (shared across the four sections). */
const SECTION_CAPTION_ICON_SX: SxProps<Theme> = theme => ({
  fontSize: 18,
  color: theme.palette.primary.main,
});

/** Narrow label-key slice of the offline-method vocabulary. */
type MethodLabelKey = keyof StudentOnboardingLabels["paymentSection"]["methods"];

/** The offline method tokens, in dialog order. */
const METHOD_TOKENS: readonly string[] = [
  PaymentGateway.OfflineCash,
  PaymentGateway.BankTransfer,
  PaymentGateway.Scholarship,
];

/** Token → compile-time label key into `StudentOnboardingLabels`. */
const METHOD_LABEL_KEY_BY_TOKEN: Record<string, MethodLabelKey> = {
  [PaymentGateway.OfflineCash]: "offlineCash",
  [PaymentGateway.BankTransfer]: "bankTransfer",
  [PaymentGateway.Scholarship]: "scholarship",
};

/** Token → the method's outlined glyph (inherits currentColor). */
const METHOD_ICON_BY_TOKEN: Record<string, typeof CashIcon> = {
  [PaymentGateway.OfflineCash]: CashIcon,
  [PaymentGateway.BankTransfer]: BankIcon,
  [PaymentGateway.Scholarship]: ScholarshipIcon,
};

export interface OnboardStudentPaymentSectionProps {
  readonly form: OnboardStudentFormState;
  /** Draft setter owned by the dialog host (threaded through verbatim). */
  readonly setForm: Dispatch<SetStateAction<OnboardStudentFormState>>;
  readonly submitting: boolean;
  readonly fieldErrors: OnboardStudentFieldErrors;
}

export function OnboardStudentPaymentSection({
  form,
  setForm,
  submitting,
  fieldErrors,
}: OnboardStudentPaymentSectionProps): ReactNode {
  const t = useAppTranslation(StudentOnboarding);

  return (
    <Stack sx={{ gap: 1 }}>
      <OnboardStudentSectionHeading
        index={4}
        icon={<CashIcon aria-hidden sx={SECTION_CAPTION_ICON_SX} />}
        title={t.sections.payment}
      />
      <ToggleButtonGroup
        exclusive
        value={form.paymentMethod}
        disabled={submitting}
        onChange={(_event, token) => {
          if (typeof token !== "string") return;
          setForm(prev => ({ ...prev, paymentMethod: token }));
        }}
        sx={{ flexWrap: "wrap" }}
      >
        {METHOD_TOKENS.map(token => {
          const labelKey = METHOD_LABEL_KEY_BY_TOKEN[token];
          const Icon = METHOD_ICON_BY_TOKEN[token];
          return (
            <ToggleButton
              key={token}
              value={token}
              aria-pressed={token === form.paymentMethod}
              sx={{ textTransform: "none" }}
            >
              {/* Flex row rides the document direction — the glyph leads in
                  LTR and trails in RTL without any physical margins. */}
              <Stack direction="row" sx={{ alignItems: "center", gap: 1 }}>
                <Icon sx={{ fontSize: 18 }} />
                {t.paymentSection.methods[labelKey]}
              </Stack>
            </ToggleButton>
          );
        })}
      </ToggleButtonGroup>
      {fieldErrors.paymentMethod ? <FormHelperText error>{fieldErrors.paymentMethod}</FormHelperText> : null}
      <OnboardStudentReferenceField form={form} setForm={setForm} submitting={submitting} fieldErrors={fieldErrors} />
    </Stack>
  );
}
