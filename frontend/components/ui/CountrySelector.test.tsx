/**
 * CountrySelector component tests (colocated, bun:test).
 *
 * The repo has no DOM component-test layer (no happy-dom/jsdom, no DOM
 * testing utilities, no vitest story runner), so the MUI Autocomplete
 * boundary is replaced with a render-through test double via `mock.module`
 * (same mechanism as rateTeacherMutationError.test.ts) and the component is
 * rendered to static markup with react-dom/server — the double forwards the
 * component's own options/getOptionLabel/renderOption/renderInput output so
 * the assertions below exercise the real component code paths.
 *
 * RUNS VIA (in-sandbox): bun run test/scripts/run-test.ts
 * frontend/components/ui/CountrySelector.test.tsx — pure unit tier, no
 * server boot, no DB (static-markup render via react-dom/server).
 */

import { expect, mock, test } from "bun:test";
import { TextField } from "@mui/material";
import { type HTMLAttributes, isValidElement, type Key, type ReactNode, type Ref } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LocaleProvider } from "@/frontend/providers/LocaleProvider";
import { COUNTRIES, COUNTRY_CODES, type CountryCode } from "@/shared/constants/countries";
import { getTranslations } from "@/shared/locale/server";

// ---------------------------------------------------------------------------
// Test double: a render-through stand-in for MUI's Autocomplete

interface StubRenderInputParams {
  id: string;
  disabled: boolean;
  fullWidth: boolean;
  size: "small" | undefined;
  slotProps: {
    inputLabel: { id: string; htmlFor: string };
    input: {
      ref: { current: null };
      className: string;
      startAdornment: ReactNode;
      endAdornment: ReactNode;
      onMouseDown: () => void;
    };
    htmlInput: {
      id: string;
      value: string;
      role: string;
      "aria-expanded": boolean;
      autoComplete: string;
      onBlur: (event: unknown) => void;
      onChange: (event: unknown) => void;
    };
  };
}

interface CapturedAutocompleteProps {
  id?: string;
  disabled?: boolean;
  options: readonly CountryCode[];
  value: CountryCode | null;
  // Captured `string` (MUI only ever passes real options at runtime) so the
  // Tier 4 hostile-key probes below can call it without unsafe casts.
  getOptionLabel: (option: string) => string;
  renderOption: (
    props: HTMLAttributes<HTMLLIElement> & { key: Key },
    option: CountryCode,
    state: { selected: boolean; index: number; inputValue: string }
  ) => ReactNode;
  renderInput: (params: StubRenderInputParams) => ReactNode;
  onChange: (event: unknown, value: CountryCode | null, reason?: unknown, details?: unknown) => void;
  noOptionsText?: ReactNode;
  filterOptions: (options: readonly CountryCode[], state: { inputValue: string }) => CountryCode[];
}

interface CapturedTextFieldProps {
  label?: ReactNode;
  slotProps?: {
    htmlInput?: { onBlur?: (event: unknown) => void } & Record<string, unknown>;
    input?: { endAdornment?: ReactNode; startAdornment?: ReactNode } & Record<string, unknown>;
    inputLabel?: Record<string, unknown>;
    formHelperText?: Record<string, unknown>;
  };
}

let lastStubProps: CapturedAutocompleteProps | null = null;
let lastRenderInputParams: StubRenderInputParams | null = null;
let lastTextFieldProps: CapturedTextFieldProps | null = null;
let stubMuiBlurCount = 0;
let stubEndAdornment: ReactNode = null;

function currentStubProps(): CapturedAutocompleteProps {
  if (lastStubProps === null) {
    throw new Error("the Autocomplete double was never rendered");
  }
  return lastStubProps;
}

// camelCase on purpose: this is a render-through test double, not a React
// component, so the react(globals) module-capture rule must not treat its
// module-level capture variables as component state.
function stubAutocomplete(stubProps: CapturedAutocompleteProps): ReactNode {
  lastStubProps = stubProps;
  const {
    id = "country-selector-stub",
    disabled = false,
    value,
    options,
    getOptionLabel,
    renderOption,
    renderInput,
  } = stubProps;
  const inputValue = value === null ? "" : getOptionLabel(value);
  const params: StubRenderInputParams = {
    id,
    disabled,
    fullWidth: true,
    size: undefined,
    slotProps: {
      inputLabel: { id: `${id}-label`, htmlFor: id },
      input: {
        ref: { current: null },
        className: "stub-input-root",
        startAdornment: null,
        endAdornment: <span data-testid="stub-end-adornment" />,
        onMouseDown: () => {},
      },
      htmlInput: {
        id: `${id}-input`,
        value: inputValue,
        role: "combobox",
        "aria-expanded": false,
        autoComplete: "off",
        onBlur: () => {
          stubMuiBlurCount += 1;
        },
        onChange: () => {},
      },
    },
  };
  stubEndAdornment = params.slotProps.input.endAdornment;
  lastRenderInputParams = params;
  const inputElement = renderInput(params);
  if (!isValidElement<CapturedTextFieldProps>(inputElement)) {
    throw new Error("renderInput must return a single React element");
  }
  lastTextFieldProps = inputElement.props;
  const optionRows = options.map((option, index) =>
    renderOption({ key: option, role: "option", "aria-selected": option === value }, option, {
      selected: option === value,
      index,
      inputValue,
    })
  );
  return (
    <div data-testid="stub-autocomplete-root">
      {inputElement}
      <div data-testid="stub-listbox">{optionRows}</div>
    </div>
  );
}

// The module-under-test import MUST trail its mock.module registration (bun
// evaluates the module registry in import order — the same ordering contract
// rateTeacherMutationError.test.ts documents).
void mock.module("@mui/material", () => ({
  Autocomplete: stubAutocomplete,
  TextField,
}));

import { CountrySelector, type CountrySelectorProps } from "@/frontend/components/ui/CountrySelector";

// ---------------------------------------------------------------------------
// Translation-backed expectations (never hardcoded copy)

const en = getTranslations("en");
const ar = getTranslations("ar");

const enSelector = en.countrySelectorTranslations;
const arSelector = ar.countrySelectorTranslations;
// The admin directory's filter-voiced placeholder (translation-backed — the
// same copy DirectoryToolbarFilters passes as the override).
const enFilters = en.adminUsersTranslations.filters;

// ---------------------------------------------------------------------------
// Helpers

function renderCountrySelector(locale: "en" | "ar", props: CountrySelectorProps): string {
  return renderToStaticMarkup(
    <LocaleProvider locale={locale}>
      <CountrySelector {...props} />
    </LocaleProvider>
  );
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** React's text-node escaping for static-markup comparisons (names contain `&`). */
function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function currentTextFieldSlots(): CapturedTextFieldProps {
  if (lastTextFieldProps === null) {
    throw new Error("renderInput output was never captured");
  }
  return lastTextFieldProps;
}

function currentRenderInputParams(): StubRenderInputParams {
  if (lastRenderInputParams === null) {
    throw new Error("renderInput params were never captured");
  }
  return lastRenderInputParams;
}

// ---------------------------------------------------------------------------
// Tier 1 — render, option surface, selection contract

test("renders the country field with namespace label and placeholder", () => {
  const markup = renderCountrySelector("en", { label: enSelector.fieldLabel, value: "", onChange: () => {} });
  expect(markup).toContain(enSelector.fieldLabel);
  expect(markup).toContain(enSelector.placeholder);
  expect(markup).toContain("stub-listbox");
});

test("hideLabel keeps the accessible name while dropping the floating label", () => {
  renderCountrySelector("en", {
    label: enSelector.fieldLabel,
    value: "",
    onChange: () => {},
    hideLabel: true,
  });
  // The visible MUI label is dropped; the accessible name survives via the
  // htmlInput aria-label (hosts draw their own visible label above).
  expect(currentTextFieldSlots().label).toBeUndefined();
  const htmlInput = currentTextFieldSlots().slotProps?.htmlInput;
  expect(htmlInput?.["aria-label"]).toBe(enSelector.fieldLabel);

  // Default behavior keeps the floating label for register-style hosts.
  renderCountrySelector("en", { label: enSelector.fieldLabel, value: "", onChange: () => {} });
  expect(currentTextFieldSlots().label).toBe(enSelector.fieldLabel);
});

test("shrinkLabel pins the label into the notch while the default leaves MUI's own float", () => {
  renderCountrySelector("en", {
    label: enSelector.fieldLabel,
    value: "",
    onChange: () => {},
    shrinkLabel: true,
  });
  // The toolbar grammar: inputLabel gains shrink=true, MUI's id/htmlFor
  // wiring from the autocomplete params stays merged (not replaced).
  const pinned = currentTextFieldSlots().slotProps?.inputLabel;
  expect(pinned?.shrink).toBe(true);
  expect(pinned?.htmlFor).toBe("country-selector-stub");

  // Without the prop the label slot is untouched — no shrink key leaks.
  renderCountrySelector("en", { label: enSelector.fieldLabel, value: "", onChange: () => {} });
  const floating = currentTextFieldSlots().slotProps?.inputLabel;
  expect(floating?.shrink).toBeUndefined();
  expect(floating?.htmlFor).toBe("country-selector-stub");
});

test("placeholder override swaps the namespace prompt for host-voiced copy", () => {
  // Toolbar hosts speak filter grammar, not the first-person form prompt;
  // the override copy is the adminUsers filter translation, never hardcoded.
  const overridden = renderCountrySelector("en", {
    label: enSelector.fieldLabel,
    value: "",
    onChange: () => {},
    placeholder: enFilters.countryPlaceholder,
  });
  expect(overridden).toContain(enFilters.countryPlaceholder);
  expect(overridden).not.toContain(enSelector.placeholder);

  // Absent prop keeps the shared namespace prompt (register-style hosts).
  const defaulted = renderCountrySelector("en", { label: enSelector.fieldLabel, value: "", onChange: () => {} });
  expect(defaulted).toContain(enSelector.placeholder);
  expect(defaulted).not.toContain(enFilters.countryPlaceholder);
});

test("dropdown surface lists every COUNTRY_CODES entry with localized name and flag", () => {
  const markup = renderCountrySelector("en", { label: enSelector.fieldLabel, value: "", onChange: () => {} });
  expect(currentStubProps().options).toEqual(COUNTRY_CODES);
  expect(countOccurrences(markup, 'role="option"')).toBe(COUNTRY_CODES.length);
  expect(countOccurrences(markup, 'data-testid="stub-listbox"')).toBe(1);
  for (const code of COUNTRY_CODES) {
    expect(markup).toContain(escapeHtml(COUNTRIES[code].en));
    expect(markup).toContain(COUNTRIES[code].flag);
  }
  expect(markup).toContain("Egypt");
  expect(markup).toContain("Saudi Arabia");
});

test("selection fires onChange with the ISO code and clearing emits an empty string", () => {
  const onChange = mock((_code: string) => {});
  renderCountrySelector("en", { label: enSelector.fieldLabel, value: "", onChange });
  const autocompleteOnChange = currentStubProps().onChange;
  autocompleteOnChange({}, "EG");
  autocompleteOnChange({}, "SA");
  autocompleteOnChange({}, null);
  expect(onChange.mock.calls.map(call => call[0])).toEqual(["EG", "SA", ""]);
});

test("the controlled ISO value maps to the localized display name in the input", () => {
  renderCountrySelector("en", { label: enSelector.fieldLabel, value: "EG", onChange: () => {} });
  expect(currentStubProps().value).toBe("EG");
  expect(currentRenderInputParams().slotProps.htmlInput.value).toBe(COUNTRIES.EG.en);
  expect(
    countOccurrences(
      renderCountrySelector("en", { label: enSelector.fieldLabel, value: "EG", onChange: () => {} }),
      'aria-selected="true"'
    )
  ).toBe(1);
});

test("the selected option renders exactly one trailing checkmark at the inline end (RTL-safe)", () => {
  const empty = renderCountrySelector("en", { label: enSelector.fieldLabel, value: "", onChange: () => {} });
  const selected = renderCountrySelector("en", { label: enSelector.fieldLabel, value: "EG", onChange: () => {} });
  // The check rides the inline END (margin-inline-start:auto) so the logical
  // property flips sides under RTL; emotion serializes without spaces. The
  // empty render carries no auto logical margin — the check exists only on
  // the selected row (the adornments use margin-inline-end, not start).
  expect(countOccurrences(selected, "margin-inline-start:auto")).toBe(1);
  expect(empty).not.toContain("margin-inline-start:auto");
  // RTL: the same logical property renders, never a physical side.
  const rtl = renderToStaticMarkup(
    <div dir="rtl">
      <LocaleProvider locale="ar">
        <CountrySelector label={arSelector.fieldLabel} value="EG" onChange={() => {}} />
      </LocaleProvider>
    </div>
  );
  expect(countOccurrences(rtl, "margin-inline-start:auto")).toBe(1);
  expect(rtl).not.toContain("margin-inline-end:auto");
});

test("code-aware filterOptions: ISO-code typing reaches the entry, name grammar unchanged", () => {
  renderCountrySelector("en", { label: enSelector.fieldLabel, value: "", onChange: () => {} });
  const filter = currentStubProps().filterOptions;
  const all: CountryCode[] = [...COUNTRY_CODES];

  // Empty input keeps the full list.
  expect(filter(all, { inputValue: "" })).toEqual(all);

  // Arm 2 — the code starts with the input: "us" → US.
  expect(filter(all, { inputValue: "us" })).toContain("US");
  // Arm 3 — curated aliases: the famous non-ISO spellings.
  expect(filter(all, { inputValue: "usa" })).toContain("US");
  expect(filter(all, { inputValue: "uae" })).toContain("AE");
  expect(filter(all, { inputValue: "uae" })).not.toContain("UA"); // no prefix misresolution
  expect(filter(all, { inputValue: "uk" })).toContain("GB");
  expect(filter(all, { inputValue: "ksa" })).toContain("SA");
  // Arm 1 — localized-name matching is unchanged ("eg" also code-matches).
  expect(filter(all, { inputValue: "eg" })).toContain("EG");
  // The name arm speaks the RENDER LOCALE's dataset name: Arabic input
  // matches in an AR render (the EN render's names are Latin).
  renderCountrySelector("ar", { label: arSelector.fieldLabel, value: "", onChange: () => {} });
  const filterAr = currentStubProps().filterOptions;
  expect(filterAr(all, { inputValue: "مصر" })).toContain("EG");
  expect(filterAr(all, { inputValue: "مصر" })).not.toContain("US");
  // The code/alias arms are locale-independent.
  expect(filterAr(all, { inputValue: "usa" })).toContain("US");
  // The removed prefix arm stays gone: an input that merely begins with a
  // code no longer drags that code in ("south" keeps only name matches).
  expect(filter(all, { inputValue: "south" })).not.toContain("SO");
  expect(filter(all, { inputValue: "south" })).toContain("ZA"); // South Africa, name arm
  // Nothing matches → empty list (MUI then renders noOptionsText).
  expect(filter(all, { inputValue: "zzzz" })).toEqual([]);
});

// ---------------------------------------------------------------------------
// Tier 2 — boundaries: placeholder, error/aria, RTL, disabled

test("empty value keeps the placeholder and no selected option", () => {
  const markup = renderCountrySelector("en", { label: enSelector.fieldLabel, value: "", onChange: () => {} });
  expect(currentRenderInputParams().slotProps.htmlInput.value).toBe("");
  expect(markup).not.toContain('aria-selected="true"');
  expect(currentStubProps().value).toBeNull();
});

test("error and helperText render with aria-invalid and a polite live region", () => {
  const markup = renderCountrySelector("en", {
    label: enSelector.fieldLabel,
    value: "",
    onChange: () => {},
    error: true,
    helperText: en.authTranslations.countryCodeRequired,
  });
  expect(markup).toContain('aria-invalid="true"');
  expect(markup).toContain(en.authTranslations.countryCodeRequired);
  expect(markup).toContain('aria-live="polite"');
  expect(currentTextFieldSlots().slotProps?.formHelperText?.["aria-live"]).toBe("polite");
});

test("merged slotProps keep MUI's endAdornment and wire label/name without replacing slots", () => {
  renderCountrySelector("en", {
    label: enSelector.fieldLabel,
    value: "EG",
    name: "country",
    onChange: () => {},
  });
  const textFieldSlots = currentTextFieldSlots().slotProps;
  expect(textFieldSlots?.input?.endAdornment).toBe(stubEndAdornment);
  expect(textFieldSlots?.input?.startAdornment).toBeDefined();
  expect(textFieldSlots?.htmlInput?.["aria-label"]).toBe(enSelector.fieldLabel);
  expect(textFieldSlots?.htmlInput?.name).toBe("country");
});

test("a provided inputRef is forwarded to the Input slot for native-input focus binding", () => {
  const inputRef: Ref<HTMLInputElement> = { current: null };
  renderCountrySelector("en", {
    label: enSelector.fieldLabel,
    value: "",
    onChange: () => {},
    inputRef,
  });
  const inputSlot = currentTextFieldSlots().slotProps?.input;
  expect(inputSlot?.inputRef).toBe(inputRef);
  // The autocomplete's own slot content survives the merge untouched.
  expect(inputSlot?.endAdornment).toBe(stubEndAdornment);
});

test("without a consumer inputRef the Input slot carries no stray inputRef key", () => {
  const markup = renderCountrySelector("en", { label: enSelector.fieldLabel, value: "", onChange: () => {} });
  expect(currentTextFieldSlots().slotProps?.input?.inputRef).toBeUndefined();
  // No ref plumbing may leak onto the rendered <input> as an attribute.
  expect(markup).not.toContain("inputref=");
});

test("consumer onBlur is chained after MUI's own blur handler", () => {
  const onBlur = mock(() => {});
  renderCountrySelector("en", { label: enSelector.fieldLabel, value: "", onChange: () => {}, onBlur });
  const mergedOnBlur = currentTextFieldSlots().slotProps?.htmlInput?.onBlur;
  if (typeof mergedOnBlur !== "function") {
    throw new Error("merged htmlInput onBlur must be a function");
  }
  const callsBefore = stubMuiBlurCount;
  mergedOnBlur({});
  expect(stubMuiBlurCount).toBe(callsBefore + 1);
  expect(onBlur).toHaveBeenCalledTimes(1);
});

test("without a consumer onBlur, MUI's htmlInput blur handler passes through untouched", () => {
  renderCountrySelector("en", { label: enSelector.fieldLabel, value: "", onChange: () => {} });
  const mergedOnBlur = currentTextFieldSlots().slotProps?.htmlInput?.onBlur;
  const paramsOnBlur = currentRenderInputParams().slotProps.htmlInput.onBlur;
  expect(mergedOnBlur).toBe(paramsOnBlur);
});

test("RTL (ar) renders Arabic copy, logical text alignment, and no physical positioning", () => {
  const markup = renderToStaticMarkup(
    <div dir="rtl">
      <LocaleProvider locale="ar">
        <CountrySelector label={arSelector.fieldLabel} value="EG" onChange={() => {}} />
      </LocaleProvider>
    </div>
  );
  expect(markup).toContain('dir="rtl"');
  expect(markup).toContain(arSelector.fieldLabel);
  expect(markup).toContain(arSelector.placeholder);
  expect(markup).toContain(COUNTRIES.EG.ar);
  expect(markup).toContain(COUNTRIES.EG.flag);
  for (const code of COUNTRY_CODES) {
    expect(markup).toContain(escapeHtml(COUNTRIES[code].ar));
  }
  expect(markup).toContain("text-align:start");
  expect(markup).toContain("margin-inline-end");
  expect(markup).not.toContain("text-align:right");
});

test("disabled renders a non-interactive field", () => {
  const markup = renderCountrySelector("en", {
    label: enSelector.fieldLabel,
    value: "",
    onChange: () => {},
    disabled: true,
  });
  expect(currentStubProps().disabled).toBe(true);
  expect(currentRenderInputParams().disabled).toBe(true);
  expect(markup).toContain("disabled");
});

// ---------------------------------------------------------------------------
// Tier 3 — rapid re-renders + concurrent selection emissions never crash

test("seeded rapid re-render and concurrent onChange fuzz stays crash-free", async () => {
  let seed = 42;
  const nextRandom = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const emitted: string[] = [];
  const onChange = mock((code: string) => {
    emitted.push(code);
  });
  const rounds = Array.from({ length: 200 }, () => async () => {
    const randomCode = COUNTRY_CODES[Math.floor(nextRandom() * COUNTRY_CODES.length)];
    const value: CountryCode | "" = nextRandom() < 0.5 ? randomCode : "";
    renderCountrySelector("en", { label: enSelector.fieldLabel, value, onChange });
    const autocompleteOnChange = currentStubProps().onChange;
    autocompleteOnChange({}, nextRandom() < 0.5 ? randomCode : null);
  });
  const outcomes = await Promise.allSettled(rounds.map(round => round()));
  expect(outcomes.every(outcome => outcome.status === "fulfilled")).toBe(true);
  const datasetMembers = new Set<string>(COUNTRY_CODES);
  for (const code of emitted) {
    expect(code === "" || datasetMembers.has(code)).toBe(true);
  }
  expect(emitted).toHaveLength(200);
});

// ---------------------------------------------------------------------------
// Tier 4 — XSS-safe label rendering and prototype-key injection immunity

test("hostile label and helper text render React-escaped, never as raw HTML", () => {
  const hostile = "<img src=x onerror=alert(1)>";
  const markup = renderCountrySelector("en", {
    label: enSelector.fieldLabel,
    value: "",
    onChange: () => {},
    helperText: hostile,
  });
  // The payload survives only as React-escaped text — scanning the rendered
  // output itself (never the component source) keeps the probe free of
  // worktree/filesystem coupling.
  expect(markup).toContain(escapeHtml(hostile));
  expect(markup).not.toContain("<img");
  expect(markup).not.toContain("dangerouslySetInnerHTML");
  // The label path must be equally inert.
  const hostileLabelMarkup = renderCountrySelector("en", { label: hostile, value: "", onChange: () => {} });
  expect(hostileLabelMarkup).toContain(escapeHtml(hostile));
  expect(hostileLabelMarkup).not.toContain("<img");
});

test("options are exactly the dataset — no prototype-key injection surface", () => {
  renderCountrySelector("en", { label: enSelector.fieldLabel, value: "", onChange: () => {} });
  const options = currentStubProps().options;
  const datasetMembers = new Set<string>(COUNTRY_CODES);
  for (const hostileKey of ["__proto__", "constructor", "prototype", "toString", "hasOwnProperty"]) {
    expect(datasetMembers.has(hostileKey)).toBe(false);
  }
  expect(options).toHaveLength(COUNTRY_CODES.length);
  for (const option of options) {
    expect(datasetMembers.has(option)).toBe(true);
  }
  const getOptionLabel = currentStubProps().getOptionLabel;
  expect(getOptionLabel("__proto__")).toBeUndefined();
  expect(getOptionLabel("constructor")).toBeUndefined();
  expect(() => getOptionLabel("__proto__")).not.toThrow();
});
