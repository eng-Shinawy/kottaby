/**
 * PhoneInput namespace labels — the reusable phone-number input surface:
 * the field label, the country picker affordances, and the validation
 * messages.
 *
 * All keys MUST have both `en` and `ar` implementations with EXACT key-set
 * parity (compile-typed on both leaves + `phoneInput-namespace.parity.test.ts`
 * runtime belt). Property access only — never call-by-key.
 */
export interface PhoneInputLabels {
  /** Visible/accessible label of the phone field. */
  readonly label: string;
  /** Country selector trigger placeholder. */
  readonly selectCountry: string;
  /** Validation message for an unrecognized dial code. */
  readonly invalidPrefix: string;
  /** Validation message for a malformed phone number. */
  readonly invalidPhone: string;
  /** Validation message for an empty required phone number. */
  readonly required: string;
  /** Accessible label of the dial-code (calling code) sub-field. */
  readonly countryCallingCode: string;
  /** Accessible label of the national phone-number sub-field. */
  readonly phoneNumber: string;
}
