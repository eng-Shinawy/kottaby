/**
 * CountrySelector namespace labels — the reusable country picker surface:
 * the input placeholder, the autocomplete empty-state text, and the
 * field label.
 *
 * All keys MUST have both `en` and `ar` implementations with EXACT key-set
 * parity (compile-typed on both leaves + `countrySelector-namespace.parity.test.ts`
 * runtime belt). Property access only — never call-by-key.
 */
export interface CountrySelectorLabels {
  /** Placeholder shown while no country is selected. */
  readonly placeholder: string;
  /** Autocomplete empty-state text when no country matches the search. */
  readonly noOptionsText: string;
  /** Visible/accessible label of the country field. */
  readonly fieldLabel: string;
}
