"use client";

/**
 * Attached country picker for `PhoneInput` — opens directly under the phone
 * field and shares its width. Lists every phone-enabled country from the
 * generated shared dataset (flag emoji, localized name, calling code) and
 * filters typeahead input against the name (en + ar), the ISO code, the
 * calling code, and a small curated alias table. Presentation only: the
 * selection is delegated to the parent via `onSelectAction`.
 */

import type { AutocompleteProps, FilterOptionsState } from "@mui/material";
import Autocomplete, { type AutocompleteRenderInputParams } from "@mui/material/Autocomplete";
import Box from "@mui/material/Box";
import type { PopperProps } from "@mui/material/Popper";
import TextField from "@mui/material/TextField";
import type * as React from "react";
import { useCallback } from "react";
import { PHONE_COUNTRIES, type PhoneCountry } from "@/shared/lib/phone/countries";
import type { AppLocale } from "@/shared/locale/AppLocale";
import { useAppTranslation } from "@/shared/locale/client";
import { useAppLocale } from "@/shared/locale/localeContext";
import { PhoneInput as PhoneInputNs } from "@/shared/locale/namespaces/phoneInput";

export type PhoneCountryPickerProps = {
  readonly country?: PhoneCountry;
  readonly onSelectAction: (country: PhoneCountry) => void;
};

type PhoneAutocompleteSlotProps = NonNullable<AutocompleteProps<PhoneCountry, false, false, false>["slotProps"]>;

/** Well-known non-ISO spellings typed into the picker, mapped to the code they mean. */
const PHONE_COUNTRY_INPUT_ALIASES: Readonly<Record<string, string>> = {
  usa: "US",
  uae: "AE",
  uk: "GB",
  ksa: "SA",
};

function phoneCountryName(country: PhoneCountry, locale: AppLocale): string {
  return locale === "ar" ? country.nameAr : country.nameEn;
}

function createPhoneCountryFilter() {
  return (options: readonly PhoneCountry[], state: FilterOptionsState<PhoneCountry>): PhoneCountry[] => {
    const input = state.inputValue.trim().toLowerCase();
    if (input === "") {
      return [...options];
    }
    const aliasCode = PHONE_COUNTRY_INPUT_ALIASES[input];
    const digitsOnly = /^\d+$/.test(input);
    return options.filter(
      option =>
        option.nameEn.toLowerCase().includes(input) ||
        option.nameAr.toLowerCase().includes(input) ||
        option.code.toLowerCase().startsWith(input) ||
        (digitsOnly && option.callingCode.startsWith(input)) ||
        option.code === aliasCode
    );
  };
}

type PhonePopperSlotProps = NonNullable<PhoneAutocompleteSlotProps["popper"]>;
type PhonePopperModifier = NonNullable<PopperProps["modifiers"]>[number];

/** Popper modifier pinning the dropdown to the anchor's exact width. */
const sameWidthModifier: PhonePopperModifier = {
  name: "sameWidth",
  enabled: true,
  phase: "beforeWrite",
  requires: ["computeStyles"],
  fn: ({ state }) => {
    const anchor = state.rects.reference;
    if (anchor) {
      state.styles.popper = Object.assign({}, state.styles.popper, {
        width: `${anchor.width}px`,
        minWidth: `${anchor.width}px`,
      });
    }
  },
};

function createAttachedPopperSlotProps(): PhonePopperSlotProps {
  return {
    placement: "bottom-start",
    modifiers: [
      sameWidthModifier,
      {
        name: "offset",
        options: {
          offset: [0, 0],
        },
      },
    ],
    sx: {
      width: "fit-content",
      minWidth: "fit-content",
    },
  };
}

function createAttachedPaperSlotProps(): PhoneAutocompleteSlotProps["paper"] {
  return {
    sx: theme => ({
      mt: 0,
      borderTopLeftRadius: 0,
      borderTopRightRadius: 0,
      borderTopWidth: 0,
      boxShadow: theme.shadows[4],
    }),
  };
}

function renderPickerInput(params: AutocompleteRenderInputParams, selectCountryLabel: string): React.ReactNode {
  return (
    <TextField
      {...params}
      placeholder={selectCountryLabel}
      autoFocus
      slotProps={{
        ...params.slotProps,
        htmlInput: {
          ...params.slotProps.htmlInput,
          autoComplete: "off",
          "aria-label": selectCountryLabel,
        },
      }}
    />
  );
}

export function PhoneCountryPicker({ country, onSelectAction }: Readonly<PhoneCountryPickerProps>): React.ReactNode {
  const t = useAppTranslation(PhoneInputNs);
  const locale = useAppLocale();
  const getOptionLabel = useCallback(
    (option: PhoneCountry) => `${phoneCountryName(option, locale)} (+${option.callingCode})`,
    [locale]
  );

  return (
    <Box
      onMouseDown={event => event.preventDefault()}
      sx={{
        position: "absolute",
        top: "100%",
        insetInlineStart: 0,
        width: "100%",
        zIndex: theme => theme.zIndex.modal,
      }}
    >
      <Autocomplete
        open
        fullWidth
        autoFocus
        autoHighlight
        options={PHONE_COUNTRIES}
        value={country ?? null}
        getOptionLabel={getOptionLabel}
        isOptionEqualToValue={(option, value) => option.code === value.code}
        filterOptions={createPhoneCountryFilter()}
        onChange={(_event, newValue) => {
          if (newValue) {
            onSelectAction(newValue);
          }
        }}
        slotProps={{
          popper: createAttachedPopperSlotProps(),
          paper: createAttachedPaperSlotProps(),
        }}
        sx={{
          "& .MuiAutocomplete-option": { minHeight: 44 },
          "& .MuiOutlinedInput-root": {
            borderTopLeftRadius: 0,
            borderTopRightRadius: 0,
            borderBottomLeftRadius: 0,
            borderBottomRightRadius: 0,
          },
        }}
        renderOption={({ key, ...optionProps }, option) => (
          <li key={key} {...optionProps}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, width: "100%" }}>
              <Box component="span" aria-hidden sx={{ lineHeight: 1, fontSize: "1.15em" }}>
                {option.flag}
              </Box>
              <Box component="span" sx={{ flex: 1, textAlign: "start", overflowWrap: "anywhere" }}>
                {phoneCountryName(option, locale)}
              </Box>
              <Box
                component="span"
                sx={theme => ({ color: theme.palette.text.secondary, flexShrink: 0, direction: "ltr" })}
              >
                +{option.callingCode}
              </Box>
            </Box>
          </li>
        )}
        renderInput={params => renderPickerInput(params, t.selectCountry)}
      />
    </Box>
  );
}
