"use client";

import type * as React from "react";
import { useCallback, useState } from "react";
import {
  useNationalChange,
  useNationalInput,
  useNationalKeyDown,
  useNationalSelect,
  usePrefixKeyDown,
  usePrefixUpdate,
  useResetHandlers,
  useSelectCountry,
} from "@/frontend/hooks/phoneInput/usePhoneInput.handlers.hooks";
import {
  useDerivedPhoneState,
  useEmitChange,
  useFocusSlot,
  usePhoneInputState,
  usePhoneStateSync,
} from "@/frontend/hooks/phoneInput/usePhoneInput.hooks";
import type {
  PhoneInputHandlers,
  PhoneInputState,
  UsePhoneInputOptions,
  UsePhoneInputResult,
} from "@/frontend/hooks/phoneInput/usePhoneInput.types";
import { getMaxCallingCodeLength } from "@/shared/lib/phone/calling-code";
import type { PhoneCountry } from "@/shared/lib/phone/countries";

export type { UsePhoneInputOptions, UsePhoneInputResult } from "@/frontend/hooks/phoneInput/usePhoneInput.types";

function usePhoneInputHandlers(
  state: PhoneInputState,
  derived: { readonly nationalDisplay: string },
  defaultRegion: string,
  onChangeAction: (e164: string | null) => void
): PhoneInputHandlers {
  const { region, prefixDigits, nationalDigits } = state;
  const { nationalDisplay } = derived;
  const emitChange = useEmitChange(onChangeAction, state.lastEmittedRef);

  const { focusPrefix, focusNational } = useFocusSlot(
    state.prefixInputRef,
    state.nationalInputRef,
    state.setActiveSlot
  );
  const updateFromPrefix = usePrefixUpdate(
    region,
    nationalDigits,
    defaultRegion,
    state.setPrefixDigits,
    state.setRegion,
    emitChange
  );
  const selectCountry = useSelectCountry(
    nationalDigits,
    state.setRegion,
    state.setPrefixDigits,
    emitChange,
    focusPrefix
  );
  const handlePrefixKeyDown = usePrefixKeyDown(
    { prefixDigits, nationalDigits },
    updateFromPrefix,
    state.setNationalDigits,
    emitChange,
    focusNational
  );
  const handleNationalKeyDown = useNationalKeyDown(
    { prefixDigits, nationalDigits, region, defaultRegion, nationalDisplay },
    state.setNationalDigits,
    emitChange,
    focusPrefix
  );
  const handleNationalSelect = useNationalSelect(nationalDisplay);
  const { resetPrefixDisplay, resetNationalDisplay } = useResetHandlers(prefixDigits, nationalDisplay);
  const handleNationalChange = useNationalChange({ defaultRegion, emitChange, state });
  const onNationalInput = useNationalInput({ nationalDisplay, handleNationalChange, resetNationalDisplay });

  return {
    selectCountry,
    handlePrefixKeyDown,
    handleNationalKeyDown,
    handleNationalSelect,
    resetPrefixDisplay,
    resetNationalDisplay,
    onNationalInput,
    handleNationalChange,
  };
}

export function usePhoneInput({
  value,
  onChangeAction,
  defaultRegion = "EG",
  disabled = false,
}: UsePhoneInputOptions): UsePhoneInputResult {
  const state = usePhoneInputState(value, defaultRegion);
  const { prefixDigits, nationalDigits, region, activeSlot } = state;

  usePhoneStateSync(
    value,
    defaultRegion,
    state.lastEmittedRef,
    state.setRegion,
    state.setPrefixDigits,
    state.setNationalDigits
  );

  const { country, nationalDisplay, prefixInvalid, phoneInvalid, isValid } = useDerivedPhoneState(
    region,
    prefixDigits,
    nationalDigits,
    defaultRegion
  );

  const handlers = usePhoneInputHandlers(state, { nationalDisplay }, defaultRegion, onChangeAction);

  const [countryPickerOpen, setCountryPickerOpen] = useState(false);

  const openCountryPicker = useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      event.stopPropagation();
      if (disabled) {
        return;
      }
      setCountryPickerOpen(current => !current);
    },
    [disabled]
  );

  const closeCountryPicker = useCallback(() => {
    setCountryPickerOpen(false);
  }, []);

  const handleCountrySelect = useCallback(
    (nextCountry: PhoneCountry) => {
      handlers.selectCountry(nextCountry);
      closeCountryPicker();
    },
    [closeCountryPicker, handlers]
  );

  return {
    country,
    prefixDigits,
    nationalDigits,
    nationalDisplay,
    activeSlot,
    prefixInvalid,
    phoneInvalid,
    isValid,
    setActiveSlot: state.setActiveSlot,
    ...handlers,
    prefixInputRef: state.prefixInputRef,
    nationalInputRef: state.nationalInputRef,
    maxPrefixDisplayLength: getMaxCallingCodeLength() + 1,
    countryPickerOpen,
    openCountryPicker,
    closeCountryPicker,
    handleCountrySelect,
  };
}
