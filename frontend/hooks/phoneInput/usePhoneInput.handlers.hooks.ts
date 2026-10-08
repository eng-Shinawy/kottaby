"use client";

import type * as React from "react";
import { useCallback } from "react";
import { countDigitsUpTo } from "@/frontend/hooks/phoneInput/usePhoneInput.helpers";
import type {
  NationalChangeDeps,
  NationalInputDeps,
  NationalKeyDownState,
  PrefixKeyDownState,
} from "@/frontend/hooks/phoneInput/usePhoneInput.types";
import {
  canAppendCallingCodeDigit,
  isCallingCodeComplete,
  matchCallingCodeFromDigits,
} from "@/shared/lib/phone/calling-code";
import type { PhoneCountry } from "@/shared/lib/phone/countries";
import { clampSelectionToDigits, getNextFormatChar } from "@/shared/lib/phone/national-format";
import { splitPhoneValueToParts } from "@/shared/lib/phone/parse";

export function usePrefixUpdate(
  region: string | null,
  nationalDigits: string,
  defaultRegion: string,
  setPrefixDigits: (digits: string) => void,
  setRegion: (region: string | null) => void,
  emitChange: (prefixDigits: string, nationalDigits: string) => void
): (nextPrefix: string) => void {
  return useCallback(
    (nextPrefix: string) => {
      setPrefixDigits(nextPrefix);
      if (!nextPrefix) {
        setRegion(null);
        emitChange(nextPrefix, nationalDigits);
        return;
      }
      const match = matchCallingCodeFromDigits(nextPrefix, region ?? defaultRegion);
      if (match) {
        setRegion(match.region);
      }
      emitChange(nextPrefix, nationalDigits);
    },
    [region, nationalDigits, defaultRegion, setPrefixDigits, setRegion, emitChange]
  );
}

export function usePrefixKeyDown(
  state: PrefixKeyDownState,
  updateFromPrefix: (nextPrefix: string) => void,
  setNationalDigits: (digits: string) => void,
  emitChange: (prefixDigits: string, nationalDigits: string) => void,
  focusNational: () => void
): (event: React.KeyboardEvent<HTMLInputElement>) => void {
  const { prefixDigits, nationalDigits } = state;
  return useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Backspace") {
        event.preventDefault();
        if (prefixDigits.length === 0) {
          return;
        }
        updateFromPrefix(prefixDigits.slice(0, -1));
        return;
      }

      if (event.key === "ArrowRight" && isCallingCodeComplete(prefixDigits)) {
        event.preventDefault();
        focusNational();
        return;
      }

      if (/^\d$/.test(event.key)) {
        event.preventDefault();
        if (!canAppendCallingCodeDigit(prefixDigits, event.key)) {
          // The calling code is already complete — carry the extra digit into the
          // national slot instead of swallowing the keystroke.
          if (isCallingCodeComplete(prefixDigits)) {
            const nextNational = `${nationalDigits}${event.key}`;
            setNationalDigits(nextNational);
            emitChange(prefixDigits, nextNational);
            focusNational();
          }
          return;
        }
        updateFromPrefix(`${prefixDigits}${event.key}`);
      }
    },
    [prefixDigits, nationalDigits, updateFromPrefix, setNationalDigits, emitChange, focusNational]
  );
}

export function useNationalKeyDown(
  state: NationalKeyDownState,
  setNationalDigits: (digits: string) => void,
  emitChange: (prefixDigits: string, nationalDigits: string) => void,
  focusPrefix: () => void
): (event: React.KeyboardEvent<HTMLInputElement>) => void {
  const { prefixDigits, nationalDigits, region, defaultRegion, nationalDisplay } = state;
  return useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Backspace") {
        const input = event.currentTarget;
        const selectionStart = input.selectionStart ?? 0;
        const selectionEnd = input.selectionEnd ?? 0;
        event.preventDefault();
        if (selectionStart < selectionEnd) {
          // Backspace over a selection deletes exactly the digits it spans (select-all
          // clears the whole number); focus stays, so the next Backspace hops to the prefix.
          const nextNational =
            nationalDigits.slice(0, countDigitsUpTo(nationalDisplay, selectionStart)) +
            nationalDigits.slice(countDigitsUpTo(nationalDisplay, selectionEnd));
          if (nextNational !== nationalDigits) {
            setNationalDigits(nextNational);
            emitChange(prefixDigits, nextNational);
          }
          return;
        }
        if (nationalDigits.length > 0) {
          const nextNational = nationalDigits.slice(0, -1);
          setNationalDigits(nextNational);
          emitChange(prefixDigits, nextNational);
          return;
        }
        focusPrefix();
        return;
      }

      if (event.key === "ArrowLeft" && nationalDigits.length === 0) {
        event.preventDefault();
        focusPrefix();
        return;
      }

      const nextFormatChar = getNextFormatChar(nationalDisplay, nationalDigits, region ?? defaultRegion);
      if (nextFormatChar && event.key === nextFormatChar) {
        event.preventDefault();
        return;
      }

      if (/^\d$/.test(event.key)) {
        event.preventDefault();
        const nextNational = `${nationalDigits}${event.key}`;
        setNationalDigits(nextNational);
        emitChange(prefixDigits, nextNational);
      }
    },
    [prefixDigits, nationalDigits, region, defaultRegion, nationalDisplay, setNationalDigits, emitChange, focusPrefix]
  );
}

export function useSelectCountry(
  nationalDigits: string,
  setRegion: (region: string | null) => void,
  setPrefixDigits: (digits: string) => void,
  emitChange: (prefixDigits: string, nationalDigits: string) => void,
  focusPrefix: () => void
): (nextCountry: PhoneCountry) => void {
  return useCallback(
    (nextCountry: PhoneCountry) => {
      const nextPrefix = nextCountry.callingCode;
      setRegion(nextCountry.code);
      setPrefixDigits(nextPrefix);
      emitChange(nextPrefix, nationalDigits);
      focusPrefix();
    },
    [nationalDigits, setRegion, setPrefixDigits, emitChange, focusPrefix]
  );
}

export function useNationalSelect(nationalDisplay: string): (event: React.SyntheticEvent<HTMLInputElement>) => void {
  return useCallback(
    (event: React.SyntheticEvent<HTMLInputElement>) => {
      const input = event.currentTarget;
      const start = input.selectionStart ?? 0;
      const end = input.selectionEnd ?? 0;
      if (start === end) {
        return;
      }
      const clamped = clampSelectionToDigits(nationalDisplay, start, end);
      input.setSelectionRange(clamped.start, clamped.end);
    },
    [nationalDisplay]
  );
}

export function useResetHandlers(
  prefixDigits: string,
  nationalDisplay: string
): {
  readonly resetPrefixDisplay: (event: React.SyntheticEvent<HTMLInputElement>) => void;
  readonly resetNationalDisplay: (event: React.SyntheticEvent<HTMLInputElement>) => void;
} {
  const resetPrefixDisplay = useCallback(
    (event: React.SyntheticEvent<HTMLInputElement>) => {
      event.currentTarget.value = `+${prefixDigits}`;
    },
    [prefixDigits]
  );

  const resetNationalDisplay = useCallback(
    (event: React.SyntheticEvent<HTMLInputElement>) => {
      event.currentTarget.value = nationalDisplay;
    },
    [nationalDisplay]
  );

  return { resetPrefixDisplay, resetNationalDisplay };
}

export function useNationalChange({ defaultRegion, emitChange, state }: NationalChangeDeps) {
  return useCallback(
    (filledValue: string) => {
      const trimmed = filledValue.trim();
      if (!trimmed) {
        state.setPrefixDigits("");
        state.setNationalDigits("");
        state.setRegion(defaultRegion);
        emitChange("", "");
        return;
      }
      const parts = splitPhoneValueToParts(trimmed, defaultRegion);
      state.setPrefixDigits(parts.prefixDigits);
      state.setNationalDigits(parts.nationalDigits);
      if (parts.region) {
        state.setRegion(parts.region);
      }
      emitChange(parts.prefixDigits, parts.nationalDigits);
    },
    [defaultRegion, emitChange, state]
  );
}

export function useNationalInput({ nationalDisplay, handleNationalChange, resetNationalDisplay }: NationalInputDeps) {
  return useCallback(
    (event: React.SyntheticEvent<HTMLInputElement>) => {
      const target = event.currentTarget;
      const newValue = target.value;
      const nativeEvent = event.nativeEvent;
      const inputType = nativeEvent instanceof InputEvent ? nativeEvent.inputType : undefined;

      // Detect programmatic fill (Playwright .fill()) vs normal keystroke.
      // A single keystroke changes length by at most 1 and uses insertText.
      // A fill inserts multiple chars and has no inputType (or insertFromPaste).
      const isProgrammaticFill =
        Math.abs(newValue.length - nationalDisplay.length) > 1 || inputType === "insertFromPaste";

      if (isProgrammaticFill && newValue !== nationalDisplay) {
        handleNationalChange(newValue);
        return;
      }

      resetNationalDisplay(event);
    },
    [handleNationalChange, nationalDisplay, resetNationalDisplay]
  );
}
