"use client";

/**
 * CountrySelector — a reusable ISO 3166-1 alpha-2 country picker built on the
 * MUI Autocomplete.
 *
 * Options come from the generated shared country dataset (localized ar/en
 * names plus a regional-indicator flag emoji per code); the picker's own UI
 * copy (placeholder, empty-state text) comes from the `countrySelector`
 * locale namespace. Presentation only: the consumer owns validation, error
 * copy, and form wiring, so the component holds no view-specific logic.
 */

import { Check, PublicOutlined } from "@mui/icons-material";
import { Autocomplete, Box, type FilterOptionsState, TextField } from "@mui/material";
import type { FocusEvent, ReactNode, Ref } from "react";
import { COUNTRIES, COUNTRY_CODES, type CountryCode } from "@/shared/constants/countries";
import type { AppLocale } from "@/shared/locale/AppLocale";
import { useAppTranslation } from "@/shared/locale/client";
import { useAppLocale } from "@/shared/locale/localeContext";
import { CountrySelector as CountrySelectorNs } from "@/shared/locale/namespaces/countrySelector";

export interface CountrySelectorProps {
  /** Stable id forwarded to the input (label association, RHF binding). */
  id?: string;
  /** Stable form name forwarded to the input element. */
  name?: string;
  /** Visible/accessible label of the country field. */
  label: string;
  /** Controlled value: an ISO 3166-1 alpha-2 code, or "" when cleared. */
  value: CountryCode | "";
  /** Called with the selected ISO code, or "" when the selection is cleared. */
  onChange: (code: CountryCode | "") => void;
  /** Called when the field loses focus (form blur hooks). */
  onBlur?: () => void;
  /** Ref to the underlying input element (RHF submit-failure focus binding). */
  inputRef?: Ref<HTMLInputElement>;
  /** Mirrors the input's error state onto the field and `aria-invalid`. */
  error?: boolean;
  /** Helper / validation text rendered under the field. */
  helperText?: ReactNode;
  /** Marks the field visually and semantically required. */
  required?: boolean;
  /** Disables the whole picker. */
  disabled?: boolean;
  /**
   * Hides the floating MUI label while keeping the accessible name —
   * for hosts that draw their own visible label above the field
   * (admin dialog grid pattern) instead of the floating one.
   */
  hideLabel?: boolean;
  /**
   * Overrides the namespace placeholder ("Select your country") for
   * hosts whose context reads differently — the toolbar filter says
   * "Filter by country", not a first-person form prompt. Absent keeps
   * the shared default so existing surfaces are untouched.
   */
  placeholder?: string;
  /**
   * Pins the floating label into the persistent notch position (always
   * shrunk) — the toolbar grammar where every filter control keeps its
   * label visible in the outline notch, so an empty selector reads like
   * the selects beside it instead of mixing placeholder-style labels.
   */
  shrinkLabel?: boolean;
}

/**
 * The flag emoji of the selected country (or a neutral globe icon while
 * nothing is selected), rendered as a bare input adornment — MUI's logical
 * `start` slot flips sides automatically under RTL.
 */
function FlagAdornment({ code }: Readonly<{ code: CountryCode | null }>): ReactNode {
  if (code === null) {
    return <PublicOutlined fontSize="small" sx={{ marginInlineEnd: 1, color: "var(--mui-palette-action-active)" }} />;
  }
  return (
    <Box component="span" aria-hidden sx={{ marginInlineEnd: 1, lineHeight: 1, fontSize: "1.15em" }}>
      {COUNTRIES[code].flag}
    </Box>
  );
}

/**
 * Well-known non-ISO spellings people type into the picker, mapped onto the
 * ISO code they mean. Deliberately tiny and curated: only aliases a large
 * share of users actually type — everything else rides the name/code arms.
 * (The alternative — matching any input that merely BEGINS with a code —
 * misresolves: "uae" would surface Ukraine (UA) instead of the Emirates.)
 */
const COUNTRY_INPUT_ALIASES: Readonly<Record<string, CountryCode>> = {
  usa: "US",
  uae: "AE",
  uk: "GB",
  ksa: "SA",
};

/**
 * Factory for the Autocomplete's code-aware `filterOptions` — the arms are
 * documented on the JSX usage site. Module-level so the component body stays
 * under the function-length ceiling; a new closure per render is exactly what
 * the inline arrow was.
 */
function createCountryFilter(locale: AppLocale) {
  return (options: CountryCode[], state: FilterOptionsState<CountryCode>): CountryCode[] => {
    const input = state.inputValue.trim().toLowerCase();
    if (input === "") {
      return options;
    }
    const aliasCode = COUNTRY_INPUT_ALIASES[input];
    return options.filter(
      code =>
        COUNTRIES[code][locale].toLowerCase().includes(input) ||
        code.toLowerCase().startsWith(input) ||
        code === aliasCode
    );
  };
}

export function CountrySelector({
  id,
  name,
  label,
  value,
  onChange,
  onBlur,
  inputRef,
  error = false,
  helperText,
  required = false,
  disabled = false,
  hideLabel = false,
  shrinkLabel = false,
  placeholder,
}: Readonly<CountrySelectorProps>): ReactNode {
  const t = useAppTranslation(CountrySelectorNs);
  const locale = useAppLocale();
  const selectedCode = value === "" ? null : value;

  return (
    <Autocomplete
      id={id}
      fullWidth
      disabled={disabled}
      options={COUNTRY_CODES}
      value={selectedCode}
      getOptionLabel={code => COUNTRIES[code][locale]}
      onChange={(_event, selected) => {
        onChange(selected ?? "");
      }}
      noOptionsText={t.noOptionsText}
      // Code-aware typeahead: the default label-contains filter alone means
      // typing a country's ISO code ("us") or a famous alias ("usa", "uae")
      // matches nothing — the picker reads as broken exactly for the users
      // who know the code. The arms:
      //   1. localized-name contains the input (the default grammar),
      //   2. the code STARTS WITH the input ("us" → US),
      //   3. the input is a curated alias ("usa" → US, "uae" → AE,
      //      "uk" → GB, "ksa" → SA) — the exact-match table avoids the
      //      prefix-matching misresolution ("uae" → Ukraine) outright.
      filterOptions={createCountryFilter(locale)}
      // Keep every option row at a comfortable touch height on mobile.
      sx={{ "& .MuiAutocomplete-option": { minHeight: 44 } }}
      renderOption={({ key, ...optionProps }, option, { selected }) => (
        <li key={key} {...optionProps}>
          {/* The flag is decorative; the localized name is the option's
              accessible content. Logical margin keeps the row spacing
              correct in both directions. */}
          <Box component="span" aria-hidden sx={{ marginInlineEnd: 1, lineHeight: 1, fontSize: "1.15em" }}>
            {COUNTRIES[option].flag}
          </Box>
          <Box component="span" sx={{ textAlign: "start", overflowWrap: "anywhere" }}>
            {COUNTRIES[option][locale]}
          </Box>
          {/* Trailing check on the selected row: MUI highlights the row, but
              among 249 options the explicit marker is what survives a glance
              or a color-vision deficiency. The auto logical margin pushes it
              to the inline end, flipping sides under RTL for free. */}
          {selected && (
            <Check
              aria-hidden
              sx={theme => ({
                marginInlineStart: "auto",
                fontSize: "1.1em",
                color: theme.palette.primary.main,
              })}
            />
          )}
        </li>
      )}
      renderInput={params => (
        <TextField
          {...params}
          name={name}
          // Hosts drawing their own visible label pass `hideLabel`; the
          // accessible name still comes from the htmlInput aria-label.
          label={hideLabel ? undefined : label}
          placeholder={placeholder ?? t.placeholder}
          required={required}
          error={error}
          helperText={helperText}
          aria-invalid={error}
          slotProps={{
            // Merge (not replace) params.slotProps — the autocomplete's
            // endAdornment (popup chevron + clear affordance) lives there;
            // a bare slotProps prop would silently drop it.
            ...params.slotProps,
            htmlInput: {
              ...params.slotProps?.htmlInput,
              name,
              "aria-label": label,
              // Chain the consumer's blur handler AFTER MUI's own (which
              // closes the popup / commits auto-select) instead of
              // replacing it.
              ...(onBlur && {
                onBlur: (event: FocusEvent<HTMLInputElement>) => {
                  params.slotProps?.htmlInput?.onBlur?.(event);
                  onBlur();
                },
              }),
            },
            input: {
              ...params.slotProps?.input,
              startAdornment: <FlagAdornment code={selectedCode} />,
              // The consumer's ref rides the Input slot: MUI binds that
              // `inputRef` to the native <input>, so form submit-failure
              // focus can reach this field — and the autocomplete's own
              // htmlInput ref stays untouched (merge, not replace).
              ...(inputRef && { inputRef }),
            },
            inputLabel: {
              ...params.slotProps?.inputLabel,
              ...(shrinkLabel && { shrink: true }),
            },
            // Validation text arrives without moving focus, so the helper
            // node itself must be a polite live region for SR announcement.
            formHelperText: { "aria-live": "polite" },
          }}
        />
      )}
    />
  );
}
