"use client";

import { TextField } from "@mui/material";
import { useForkRef } from "@mui/material/utils";
import * as React from "react";

/** Props of the shared phone field (see `PhoneInput`). */
export interface PhoneInputProps {
  /** Floating MUI label — optional: admin/onboarding surfaces render their own field label above the input. */
  label?: string;
  /** Controlled value; admin create/edit dialogs and onboarding bind it to their own form state. */
  value?: string;
  /** Change handler — accepts MUI's `TextField` handler shape and React Hook Form's `register(...)` spread. */
  onChange?: React.ChangeEventHandler<HTMLInputElement | HTMLTextAreaElement>;
  /** Blur handler — accepts MUI's `TextField` handler shape and React Hook Form's `register(...)` spread. */
  onBlur?: React.FocusEventHandler<HTMLInputElement | HTMLTextAreaElement>;
  /** Leading adornment rendered inside the field (e.g. the register form's phone icon). */
  startAdornment?: React.ReactNode;
  /** Form field name. */
  name?: string;
  /** Marks the field required (MUI asterisk + native input attribute). */
  required?: boolean;
  /** Stretches the field to its container width (default `true`). */
  fullWidth?: boolean;
  /** Error state — drives MUI error styling and the input's own `aria-invalid`. */
  error?: boolean;
  /** Helper/validation text; `undefined` reserves an empty helper line so error copy never shifts layout. */
  helperText?: React.ReactNode;
  /** Autofill hint (default `"tel"`). */
  autoComplete?: string;
  /** Disables the field. */
  disabled?: boolean;
  /** Input id — pair it with an externally rendered label's `htmlFor`. */
  id?: string;
  /** Overrides the invalid flag exposed to assistive technology. */
  "aria-invalid"?: boolean | "false" | "true" | "grammar" | "spelling";
  /** Direct ref to the underlying `<input>` for controlled callers. */
  inputRef?: React.Ref<HTMLInputElement>;
}

/**
 * Shared phone-number field for every surface that collects a phone
 * (register, admin create/edit dialogs, student onboarding). It centralizes
 * the tel semantics (`type`/`inputMode`/`autoComplete`), keeps the value laid
 * out left-to-right even inside RTL (Arabic) layouts, and reserves the helper
 * line while announcing validation copy as a polite live region.
 *
 * Presentation only — it owns NO validation rules. Callers decide validity (a
 * client predicate or the server round-trip) and project it through `error` /
 * `helperText` / `aria-invalid`; that shape is exactly what
 * `textFieldErrorProps()` emits for projected server field errors, so the
 * projection spreads in unchanged.
 *
 * Two usage modes:
 *  - Uncontrolled + React Hook Form: `{...register("phone")}` — the spread
 *    delivers name/onChange/onBlur, and its ref arrives through React's
 *    forwarding slot.
 *  - Controlled: `value` + `onChange` driven by the caller's own form state.
 *
 * Both ref entry points (the forwarded ref and the explicit `inputRef` prop)
 * land on the underlying `<input>` element.
 */
export const PhoneInput = React.forwardRef<HTMLInputElement, PhoneInputProps>(function PhoneInput(
  props: Readonly<PhoneInputProps>,
  ref
) {
  const {
    label,
    value,
    onChange,
    onBlur,
    startAdornment,
    name,
    required,
    fullWidth = true,
    error,
    helperText,
    autoComplete = "tel",
    disabled,
    id,
    "aria-invalid": ariaInvalid,
    inputRef,
  } = props;

  // Merge the two ref entry points: `{...register("phone")}` hands its ref
  // through React's forwarding slot while controlled callers pass `inputRef`
  // explicitly — both must reach the same underlying `<input>`.
  const setRef = useForkRef(ref, inputRef);

  return (
    <TextField
      inputRef={setRef}
      label={label}
      type="tel"
      inputMode="tel"
      value={value}
      onChange={onChange}
      onBlur={onBlur}
      name={name}
      required={required}
      fullWidth={fullWidth}
      error={error}
      helperText={helperText ?? " "}
      autoComplete={autoComplete}
      disabled={disabled}
      id={id}
      aria-invalid={ariaInvalid ?? undefined}
      // Bidi safety: the phone value stays left-to-right even on RTL (ar) pages.
      slotProps={{
        input: { startAdornment },
        htmlInput: { dir: "ltr" },
        formHelperText: { "aria-live": "polite" },
      }}
    />
  );
});

PhoneInput.displayName = "PhoneInput";
