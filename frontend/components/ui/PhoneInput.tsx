"use client";

/**
 * Phone-number field with a two-slot layout: a country-picker flag button plus
 * a borderless calling-code prefix input in the start adornment, and the
 * national number as the main input. Digits are the only state — the display
 * re-formats As-You-Type while keystroke handling clamps selections to digit
 * ranges, carries overflow prefix digits into the national slot, and detects
 * programmatic fills (Playwright `.fill()`). The value contract is E.164:
 * full `+{callingCode}{national}` when valid, a partial `+{prefix}{national}`
 * while typing, and `null` when fully empty. The field always lays itself out
 * left-to-right so the flag, prefix, and number read correctly inside RTL pages.
 */

import Box from "@mui/material/Box";
import ClickAwayListener from "@mui/material/ClickAwayListener";
import FormHelperText from "@mui/material/FormHelperText";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import { type SxProps, styled, type Theme } from "@mui/material/styles";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import type * as React from "react";
import { PhoneCountryPicker } from "@/frontend/components/ui/PhoneCountryPicker";
import { usePhoneInputFieldState } from "@/frontend/hooks/phoneInput/usePhoneInputFieldState";

export type PhoneInputProps = {
  /** Controlled value: full E.164, a partial `+{prefix}`, or `null` when empty. */
  readonly value: string | null;
  /** Emits `null` when fully empty, partial `+{prefix}{national}` while typing, full E.164 when valid. */
  readonly onChangeAction: (e164: string | null) => void;
  readonly onBlurAction?: () => void;
  /** ISO alpha-2 region used to resolve bare national input — default `"EG"`. */
  readonly defaultRegion?: string;
  /** Floating MUI label — falls back to the namespace default; hidden when `hideLabel`. */
  readonly label?: string;
  readonly placeholder?: string;
  readonly required?: boolean;
  readonly disabled?: boolean;
  /** Stretches the field to its container width — default `true`. */
  readonly fullWidth?: boolean;
  /** Consumer/server error flag folded into the field's error state. */
  readonly error?: boolean;
  /** Consumer/server copy — shown over the live invalid-phone hint, but under prefix/required errors. */
  readonly helperText?: string;
  readonly hideLabel?: boolean;
  /** Stable id forwarded to the national-number input (label association). */
  readonly id?: string;
  /** Form field name forwarded to the national-number input. */
  readonly name?: string;
};

const SLOT_INPUT_SX = {
  border: "none",
  outline: "none",
  background: "transparent",
  font: "inherit",
  color: "inherit",
  padding: 0,
  margin: 0,
  minWidth: 0,
} as const;

const StyledPrefixInput = styled("input", { name: "PhoneInputPrefixInput" })();

type PrefixInputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  readonly sx?: SxProps<Theme>;
  readonly ref?: React.Ref<HTMLInputElement>;
};

/** Borderless bare `<input>` rendering the `+{callingCode}` prefix slot. */
const PrefixInput = ({ sx, ref, ...props }: Readonly<PrefixInputProps>): React.ReactNode => (
  <StyledPrefixInput ref={ref} sx={sx} {...props} />
);

type CountryAdornmentProps = {
  readonly countryFlag: string | undefined;
  readonly prefixDigits: string;
  readonly prefixInvalid: boolean;
  readonly disabled: boolean | undefined;
  readonly countryPickerOpen: boolean;
  readonly activeSlotIsPrefix: boolean;
  readonly maxPrefixDisplayLength: number;
  readonly prefixInputRef: React.Ref<HTMLInputElement>;
  readonly onOpenCountryPicker: (event: React.MouseEvent<HTMLElement>) => void;
  readonly onPrefixFocus: () => void;
  readonly onPrefixKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  readonly onPrefixInput: (event: React.SyntheticEvent<HTMLInputElement>) => void;
  readonly selectCountryLabel: string;
  readonly countryCallingCodeLabel: string;
};

const CountryAdornment = ({
  countryFlag,
  prefixDigits,
  prefixInvalid,
  disabled,
  countryPickerOpen,
  activeSlotIsPrefix,
  maxPrefixDisplayLength,
  prefixInputRef,
  onOpenCountryPicker,
  onPrefixFocus,
  onPrefixKeyDown,
  onPrefixInput,
  selectCountryLabel,
  countryCallingCodeLabel,
}: Readonly<CountryAdornmentProps>): React.ReactNode => {
  const countrySelectorButton = (
    <IconButton
      aria-label={selectCountryLabel}
      aria-haspopup="listbox"
      aria-expanded={countryPickerOpen}
      onClick={onOpenCountryPicker}
      disabled={disabled}
      size="small"
      sx={{ p: 0.25, flexShrink: 0, paddingInlineEnd: 0.5, marginInlineEnd: 0 }}
    >
      <Box component="span" aria-hidden sx={{ lineHeight: 1, fontSize: "1.15em" }}>
        {countryFlag ?? "\u{1F310}"}
      </Box>
    </IconButton>
  );

  return (
    <InputAdornment
      position="start"
      sx={{ display: "flex", alignItems: "center", gap: 0.25, marginInlineEnd: 0.5, maxHeight: "unset" }}
    >
      <Tooltip title={selectCountryLabel}>
        {disabled ? (
          <Box component="span" aria-disabled sx={{ display: "inline-flex" }}>
            {countrySelectorButton}
          </Box>
        ) : (
          countrySelectorButton
        )}
      </Tooltip>
      <PrefixInput
        ref={prefixInputRef}
        value={`+${prefixDigits}`}
        maxLength={maxPrefixDisplayLength}
        disabled={disabled}
        onFocus={onPrefixFocus}
        onKeyDown={onPrefixKeyDown}
        onInput={onPrefixInput}
        aria-invalid={prefixInvalid}
        aria-label={countryCallingCodeLabel}
        sx={theme => ({
          ...SLOT_INPUT_SX,
          // `ch` measures only the normal-weight "0" advance — the bold active
          // slot and the wider "+" glyph need more room, otherwise the last
          // digit clips by a few px.
          width: `calc(${Math.max(prefixDigits.length + 1, 2)}ch + 0.5em)`,
          flexShrink: 0,
          paddingInlineEnd: 0.25,
          color: prefixInvalid ? theme.palette.error.main : "inherit",
          fontWeight: activeSlotIsPrefix ? 600 : 400,
        })}
      />
    </InputAdornment>
  );
};

type PhoneTextFieldProps = {
  readonly id: string | undefined;
  readonly name: string | undefined;
  readonly fullWidth: boolean;
  readonly required: boolean | undefined;
  readonly disabled: boolean | undefined;
  readonly showError: boolean;
  readonly resolvedLabel: string | undefined;
  readonly placeholder: string | undefined;
  readonly nationalDisplay: string;
  readonly phoneNumberLabel: string;
  readonly onBlurAction: (() => void) | undefined;
  readonly nationalInputRef: React.Ref<HTMLInputElement>;
  readonly activeSlotIsNational: boolean;
  readonly countryPickerOpen: boolean;
  readonly onNationalKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  readonly onNationalFocus: () => void;
  readonly onNationalInput: (event: React.SyntheticEvent<HTMLInputElement>) => void;
  readonly onNationalSelect: (event: React.SyntheticEvent<HTMLInputElement>) => void;
  readonly startAdornment: React.ReactNode;
};

const PhoneTextField = ({
  id,
  name,
  fullWidth,
  required,
  disabled,
  showError,
  resolvedLabel,
  placeholder,
  nationalDisplay,
  phoneNumberLabel,
  onBlurAction,
  nationalInputRef,
  activeSlotIsNational,
  countryPickerOpen,
  onNationalKeyDown,
  onNationalFocus,
  onNationalInput,
  onNationalSelect,
  startAdornment,
}: Readonly<PhoneTextFieldProps>): React.ReactNode => (
  <TextField
    id={id}
    fullWidth={fullWidth}
    required={required}
    disabled={disabled}
    error={showError}
    label={resolvedLabel}
    placeholder={placeholder}
    value={nationalDisplay}
    onChange={() => {}}
    onBlur={onBlurAction}
    inputRef={nationalInputRef}
    sx={{
      "& .MuiInputBase-input": {
        fontWeight: activeSlotIsNational ? 600 : 400,
        paddingInlineStart: 0,
      },
      ...(countryPickerOpen && {
        "& .MuiOutlinedInput-root": {
          borderBottomStartRadius: 0,
          borderBottomEndRadius: 0,
        },
      }),
    }}
    slotProps={{
      inputLabel: { shrink: true },
      input: { startAdornment },
      htmlInput: {
        name,
        // onKeyDown/onFocus must live on the native input: attached at the
        // TextField root they also catch bubbled events from the prefix input
        // and the flag button.
        onKeyDown: onNationalKeyDown,
        onFocus: onNationalFocus,
        onInput: onNationalInput,
        onSelect: onNationalSelect,
        autoComplete: "tel",
        inputMode: "tel",
        "aria-label": phoneNumberLabel,
        "aria-invalid": showError,
      },
    }}
  />
);

export function PhoneInput({
  value,
  onChangeAction,
  onBlurAction,
  defaultRegion,
  label,
  placeholder,
  required,
  disabled,
  fullWidth = true,
  error,
  helperText,
  hideLabel,
  id,
  name,
}: Readonly<PhoneInputProps>): React.ReactNode {
  const { state, showError, resolvedLabel, resolvedHelperText, t } = usePhoneInputFieldState({
    value,
    onChangeAction,
    defaultRegion,
    disabled,
    required,
    error,
    helperText,
    label,
    hideLabel,
  });

  const startAdornment = (
    <CountryAdornment
      countryFlag={state.country?.flag}
      prefixDigits={state.prefixDigits}
      prefixInvalid={state.prefixInvalid}
      disabled={disabled}
      countryPickerOpen={state.countryPickerOpen}
      activeSlotIsPrefix={state.activeSlot === "prefix"}
      maxPrefixDisplayLength={state.maxPrefixDisplayLength}
      prefixInputRef={state.prefixInputRef}
      onOpenCountryPicker={state.openCountryPicker}
      onPrefixFocus={() => state.setActiveSlot("prefix")}
      onPrefixKeyDown={state.handlePrefixKeyDown}
      onPrefixInput={state.resetPrefixDisplay}
      selectCountryLabel={t.selectCountry}
      countryCallingCodeLabel={t.countryCallingCode}
    />
  );

  return (
    <ClickAwayListener onClickAway={state.closeCountryPicker}>
      <Box sx={{ width: fullWidth ? "100%" : undefined }}>
        <Box sx={{ position: "relative" }}>
          <Box dir="ltr">
            <PhoneTextField
              id={id}
              name={name}
              fullWidth={fullWidth}
              required={required}
              disabled={disabled}
              showError={showError}
              resolvedLabel={resolvedLabel}
              placeholder={placeholder}
              nationalDisplay={state.nationalDisplay}
              phoneNumberLabel={t.phoneNumber}
              onBlurAction={onBlurAction}
              nationalInputRef={state.nationalInputRef}
              activeSlotIsNational={state.activeSlot === "national"}
              countryPickerOpen={state.countryPickerOpen}
              onNationalKeyDown={state.handleNationalKeyDown}
              onNationalFocus={() => {
                state.closeCountryPicker();
                state.setActiveSlot("national");
              }}
              onNationalInput={state.onNationalInput}
              onNationalSelect={state.handleNationalSelect}
              startAdornment={startAdornment}
            />
          </Box>
          {state.countryPickerOpen ? (
            <PhoneCountryPicker country={state.country} onSelectAction={state.handleCountrySelect} />
          ) : null}
        </Box>
        {!state.countryPickerOpen && resolvedHelperText ? (
          <FormHelperText error={showError}>{resolvedHelperText}</FormHelperText>
        ) : null}
      </Box>
    </ClickAwayListener>
  );
}
