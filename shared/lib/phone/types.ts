export type ParsePhoneResult = {
  readonly e164: string | null;
  readonly valid: boolean;
  readonly error?: string;
};

export type CallingCodeMatch = {
  readonly region: string;
  readonly callingCode: string;
  readonly isComplete: boolean;
};
