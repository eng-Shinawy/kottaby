"use client";

import { usePhoneInput } from "@/frontend/hooks/phoneInput/usePhoneInput";
import type { UsePhoneInputResult } from "@/frontend/hooks/phoneInput/usePhoneInput.types";
import { useAppTranslation } from "@/shared/locale/client";
import { PhoneInput as PhoneInputNs } from "@/shared/locale/namespaces/phoneInput";
import type { PhoneInputLabels } from "@/shared/locale/types/phoneInput";

type UsePhoneInputFieldStateOptions = {
  readonly value: string | null;
  readonly onChangeAction: (e164: string | null) => void;
  readonly defaultRegion?: string;
  readonly disabled?: boolean;
  readonly required?: boolean;
  readonly error?: boolean;
  readonly helperText?: string;
  readonly label?: string;
  readonly hideLabel?: boolean;
};

type PhoneInputFieldState = {
  readonly state: UsePhoneInputResult;
  readonly showError: boolean;
  readonly resolvedLabel: string | undefined;
  readonly resolvedHelperText: string | undefined;
  readonly t: PhoneInputLabels;
};

/**
 * Error-copy priority for the phone field: an unrecognized dial code first,
 * then the required-empty state, then the consumer's own server/helper copy,
 * and only then the live invalid-phone hint.
 */
function resolveHelperText(params: {
  readonly prefixInvalid: boolean;
  readonly showRequiredError: boolean;
  readonly phoneInvalid: boolean;
  readonly helperText: string | undefined;
  readonly t: PhoneInputLabels;
}): string | undefined {
  const { prefixInvalid, showRequiredError, phoneInvalid, helperText, t } = params;
  if (prefixInvalid) {
    return t.invalidPrefix;
  }
  if (showRequiredError) {
    return t.required;
  }
  if (helperText) {
    return helperText;
  }
  if (phoneInvalid) {
    return t.invalidPhone;
  }
  return undefined;
}

/**
 * Component state for `PhoneInput`: the raw two-slot phone state plus the
 * derived error surface (flag, resolved label, resolved helper copy) and the
 * `phoneInput` namespace labels.
 */
export function usePhoneInputFieldState({
  value,
  onChangeAction,
  defaultRegion,
  disabled,
  required,
  error,
  helperText,
  label,
  hideLabel,
}: Readonly<UsePhoneInputFieldStateOptions>): PhoneInputFieldState {
  const t = useAppTranslation(PhoneInputNs);
  const state = usePhoneInput({
    value,
    onChangeAction,
    defaultRegion: defaultRegion ?? "EG",
    disabled,
  });

  const isEmpty = state.prefixDigits.length === 0 && state.nationalDigits.length === 0;
  const showRequiredError = Boolean(required) && isEmpty;
  const showError = Boolean(error) || state.prefixInvalid || showRequiredError || state.phoneInvalid;
  const resolvedHelperText = resolveHelperText({
    prefixInvalid: state.prefixInvalid,
    showRequiredError,
    phoneInvalid: state.phoneInvalid,
    helperText,
    t,
  });
  const resolvedLabel = hideLabel ? undefined : (label ?? t.label);

  return { state, showError, resolvedLabel, resolvedHelperText, t };
}
