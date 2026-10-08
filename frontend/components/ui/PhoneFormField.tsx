"use client";

import type * as React from "react";
import { type Control, Controller, type FieldPath, type FieldValues, type RegisterOptions } from "react-hook-form";
import { PhoneInput, type PhoneInputProps } from "@/frontend/components/ui/PhoneInput";

export type PhoneFormFieldProps<T extends FieldValues, TName extends FieldPath<T> = FieldPath<T>> = Omit<
  PhoneInputProps,
  "value" | "onChangeAction" | "onBlurAction"
> & {
  readonly name: TName;
  readonly control: Control<T>;
  /** RHF rules (required/validate/…) registered through the controller. */
  readonly rules?: RegisterOptions<T, TName>;
};

/**
 * React Hook Form binder for `PhoneInput` — the controller projects RHF's
 * string field onto the component's `value: string | null` contract (empty
 * string ↔ `null`) and folds `fieldState.error` into the consumer's own
 * `error`/`helperText` when those are absent.
 */
export function PhoneFormField<T extends FieldValues, TName extends FieldPath<T> = FieldPath<T>>({
  name,
  control,
  rules,
  error,
  helperText,
  ...phoneInputProps
}: Readonly<PhoneFormFieldProps<T, TName>>): React.ReactNode {
  return (
    <Controller
      name={name}
      control={control}
      rules={rules}
      render={({ field, fieldState }) => (
        <PhoneInput
          {...phoneInputProps}
          value={field.value || null}
          onChangeAction={value => {
            field.onChange(value ?? "");
          }}
          onBlurAction={field.onBlur}
          error={error ?? Boolean(fieldState.error)}
          helperText={helperText ?? fieldState.error?.message}
        />
      )}
    />
  );
}
