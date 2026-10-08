import type * as React from "react";
import type { PhoneCountry } from "@/shared/lib/phone/countries";

export type PhoneInputSlot = "prefix" | "national";

export type UsePhoneInputOptions = {
  readonly value: string | null;
  readonly onChangeAction: (e164: string | null) => void;
  readonly defaultRegion?: string;
  readonly disabled?: boolean;
};

export type UsePhoneInputResult = {
  readonly country: PhoneCountry | undefined;
  readonly prefixDigits: string;
  readonly nationalDigits: string;
  readonly nationalDisplay: string;
  readonly activeSlot: PhoneInputSlot;
  readonly prefixInvalid: boolean;
  readonly phoneInvalid: boolean;
  readonly isValid: boolean;
  readonly setActiveSlot: (slot: PhoneInputSlot) => void;
  readonly selectCountry: (country: PhoneCountry) => void;
  readonly handlePrefixKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  readonly handleNationalKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  readonly handleNationalSelect: (event: React.SyntheticEvent<HTMLInputElement>) => void;
  readonly resetPrefixDisplay: (event: React.SyntheticEvent<HTMLInputElement>) => void;
  readonly resetNationalDisplay: (event: React.SyntheticEvent<HTMLInputElement>) => void;
  readonly onNationalInput: (event: React.SyntheticEvent<HTMLInputElement>) => void;
  readonly handleNationalChange: (filledValue: string) => void;
  readonly prefixInputRef: React.RefObject<HTMLInputElement | null>;
  readonly nationalInputRef: React.RefObject<HTMLInputElement | null>;
  readonly maxPrefixDisplayLength: number;
  readonly countryPickerOpen: boolean;
  readonly openCountryPicker: (event: React.MouseEvent<HTMLElement>) => void;
  readonly closeCountryPicker: () => void;
  readonly handleCountrySelect: (country: PhoneCountry) => void;
};

export type PrefixKeyDownState = {
  readonly prefixDigits: string;
  readonly nationalDigits: string;
};

export type NationalKeyDownState = {
  readonly prefixDigits: string;
  readonly nationalDigits: string;
  readonly region: string | null;
  readonly defaultRegion: string;
  readonly nationalDisplay: string;
};

export type PhoneInputState = {
  readonly prefixInputRef: React.RefObject<HTMLInputElement | null>;
  readonly nationalInputRef: React.RefObject<HTMLInputElement | null>;
  readonly lastEmittedRef: React.RefObject<string | null | undefined>;
  readonly activeSlot: PhoneInputSlot;
  readonly setActiveSlot: (slot: PhoneInputSlot) => void;
  readonly region: string | null;
  readonly setRegion: (region: string | null) => void;
  readonly prefixDigits: string;
  readonly setPrefixDigits: (digits: string) => void;
  readonly nationalDigits: string;
  readonly setNationalDigits: (digits: string) => void;
};

export type PhoneInputHandlers = Pick<
  UsePhoneInputResult,
  | "selectCountry"
  | "handlePrefixKeyDown"
  | "handleNationalKeyDown"
  | "handleNationalSelect"
  | "resetPrefixDisplay"
  | "resetNationalDisplay"
  | "onNationalInput"
  | "handleNationalChange"
>;

export type NationalChangeDeps = {
  readonly defaultRegion: string;
  readonly emitChange: (prefixDigits: string, nationalDigits: string) => void;
  readonly state: PhoneInputState;
};

export type NationalInputDeps = {
  readonly nationalDisplay: string;
  readonly handleNationalChange: (filledValue: string) => void;
  readonly resetNationalDisplay: (event: React.SyntheticEvent<HTMLInputElement>) => void;
};
