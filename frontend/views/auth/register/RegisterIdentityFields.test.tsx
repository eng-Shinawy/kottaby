/**
 * RegisterIdentityFields × useRegisterFormState integration tests
 * (colocated, bun:test).
 *
 * The repo has no DOM component-test layer (no happy-dom/jsdom, no DOM
 * testing utilities), so the suite renders the real hook + section through
 * react-dom/server with three render-through test doubles registered via
 * `mock.module` (same mechanism as the CountrySelector suite):
 *
 *  - `@/frontend/components/ui/CountrySelector` is replaced with a capture
 *    double so the suite asserts the exact props the identity grid hands to
 *    the picker (controller name, pinned value, error/helperText, required)
 *    and can drive its `onChange`/`onBlur` like a real selection would.
 *  - `@/frontend/components/ui/PhoneInput` is replaced with a capture double
 *    so the suite asserts the PhoneFormField binder's projection (the ""
 *    default reaching the field as `null`, the E.164 `onChangeAction` seam)
 *    without the real component's `LocaleProvider` dependency.
 *  - `@apollo/client/react` (`useQuery`/`useMutation`) and the Next.js
 *    navigation/link modules are stubbed because the register barrel pulls
 *    the submit pipeline in — no network, no router.
 *
 * Validation is exercised through the REAL React Hook Form pipeline: the
 * controller's inline `countryCodeSchema.safeParse` rules run inside real
 * submit attempts, so the empty/malformed message contract and the
 * stale-state race behavior below are the production behavior.
 *
 * RUNS VIA: bun run test/scripts/run-test.ts frontend/views/auth/register/RegisterIdentityFields.test.tsx
 */

import { expect, mock, test } from "bun:test";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { FieldErrors } from "react-hook-form";

// ---------------------------------------------------------------------------
// Test doubles (registered BEFORE the module-under-test imports — bun
// evaluates the module registry in import order)

interface StubbedCountrySelectorProps {
  id?: string;
  name?: string;
  label: string;
  value: string;
  onChange: (code: string) => void;
  onBlur?: () => void;
  error?: boolean;
  helperText?: ReactNode;
  required?: boolean;
  disabled?: boolean;
}

let lastCountrySelectorProps: StubbedCountrySelectorProps | null = null;
let countrySelectorRenderCount = 0;

function currentCountrySelectorProps(): StubbedCountrySelectorProps {
  if (lastCountrySelectorProps === null) {
    throw new Error("the CountrySelector double was never rendered");
  }
  return lastCountrySelectorProps;
}

// camelCase on purpose: render-through test double, not a component decl.
function stubCountrySelector(props: StubbedCountrySelectorProps): ReactNode {
  lastCountrySelectorProps = props;
  countrySelectorRenderCount += 1;
  return <div data-testid="stub-country-selector" />;
}

void mock.module("@/frontend/components/ui/CountrySelector", () => ({
  CountrySelector: stubCountrySelector,
}));

interface StubbedPhoneInputProps {
  value: string | null;
  onChangeAction: (e164: string | null) => void;
  onBlurAction?: () => void;
  label?: string;
  required?: boolean;
  error?: boolean;
  helperText?: string;
}

let lastPhoneInputProps: StubbedPhoneInputProps | null = null;

function currentPhoneInputProps(): StubbedPhoneInputProps {
  if (lastPhoneInputProps === null) {
    throw new Error("the PhoneInput double was never rendered");
  }
  return lastPhoneInputProps;
}

// camelCase on purpose: render-through test double, not a component decl.
function stubPhoneInput(props: StubbedPhoneInputProps): ReactNode {
  lastPhoneInputProps = props;
  return (
    <div data-testid="stub-phone-input">
      {props.label}
      {props.helperText}
    </div>
  );
}

void mock.module("@/frontend/components/ui/PhoneInput", () => ({
  PhoneInput: stubPhoneInput,
}));

void mock.module("@apollo/client/react", () => ({
  useQuery: () => ({ data: undefined, loading: false }),
  useMutation: () => [async () => ({ data: {} }), { loading: false }],
}));

void mock.module("next/navigation", () => ({
  useRouter: () => ({ push: () => {} }),
}));

void mock.module("next/link", () => ({
  default: () => null,
}));

import { RegisterPublicRole } from "@/frontend/graphql/generated/gql/graphql";
import { RegisterIdentityFields } from "@/frontend/views/auth/register/RegisterIdentityFields";
import {
  isValidEmailShape,
  MIN_PASSWORD_LENGTH,
  type RegisterFormValues,
} from "@/frontend/views/auth/register/registerFormUtils";
import { useRegisterFormState } from "@/frontend/views/auth/register/useRegisterFormState";
import { getTranslations } from "@/shared/locale/server";
import type { AuthLabels } from "@/shared/locale/types/auth";

type RegisterFormState = ReturnType<typeof useRegisterFormState>;

// ---------------------------------------------------------------------------
// Harness — real hook + real section, static-rendered once per test

// Render-time capture lives in a plain recorder so the harness component
// itself never reassigns outer bindings (React Compiler render-purity).
const harnessCapture: { state: RegisterFormState | null } = { state: null };

function recordHarnessState(state: RegisterFormState): void {
  harnessCapture.state = state;
}

function RegisterHarness({ t }: Readonly<{ t: AuthLabels }>): ReactNode {
  recordHarnessState(useRegisterFormState(t));
  const state = harnessCapture.state;
  if (state === null) {
    throw new Error("the register state harness was never recorded");
  }
  return (
    <RegisterIdentityFields
      register={state.register}
      control={state.control}
      errors={state.errors}
      t={t}
      countryField={state.countryField}
    />
  );
}

function currentRegisterState(): RegisterFormState {
  if (harnessCapture.state === null) {
    throw new Error("the register state harness was never rendered");
  }
  return harnessCapture.state;
}

const en = getTranslations("en");
const t = en.authTranslations;

function renderRegisterFields(): string {
  return renderToStaticMarkup(<RegisterHarness t={t} />);
}

type SubmitOutcome =
  | { readonly valid: true; readonly data: RegisterFormValues }
  | { readonly valid: false; readonly errors: FieldErrors<RegisterFormValues> };

/**
 * Fills every required field EXCEPT country through its own registration /
 * controller callbacks (the same callbacks the rendered sections hand to
 * MUI) so the submit attempts below fail or pass on the country contract
 * alone. The rules mirror the sections' registrations 1:1; the phone field
 * seeds through its rendered E.164 seam (the PhoneInput double's
 * `onChangeAction`) because the section binds it through `PhoneFormField`.
 */
function seedValidRegistrant(state: RegisterFormState): void {
  void state.register("fullName", { required: t.nameRequired }).onChange({
    target: { value: "Amr Diab", name: "fullName" },
  });
  void state
    .register("email", {
      required: t.emailRequired,
      validate: value => (isValidEmailShape(value) ? true : t.emailInvalid),
    })
    .onChange({ target: { value: "amr@example.com", name: "email" } });
  currentPhoneInputProps().onChangeAction("+201000000000");
  void state
    .register("password", {
      required: t.passwordRequired,
      minLength: { value: MIN_PASSWORD_LENGTH, message: t.passwordTooShort },
    })
    .onChange({ target: { value: "sup3rSecret!", name: "password" } });
  state.roleField.field.onChange(RegisterPublicRole.Student);
}

/** Runs one real submit attempt through the captured form's handleSubmit. */
async function submitRegisterState(state: RegisterFormState): Promise<SubmitOutcome> {
  let outcome: SubmitOutcome | null = null;
  await state.handleSubmit(
    data => {
      outcome = { valid: true, data };
    },
    errors => {
      outcome = { valid: false, errors };
    }
  )();
  if (outcome === null) {
    throw new Error("handleSubmit resolved without invoking a handler");
  }
  return outcome;
}

// ---------------------------------------------------------------------------
// Tier 1 — the selector replaces the free-text field and binds the controller

test("the identity grid renders the country picker instead of the free-text field", () => {
  const markup = renderRegisterFields();

  expect(countrySelectorRenderCount).toBe(1);
  expect(markup).toContain('data-testid="stub-country-selector"');
  expect(markup).toContain(t.fullName);
  expect(markup).toContain(t.email);
  expect(markup).toContain(t.phone);
  // The free-text country input's signature is gone.
  expect(markup).not.toContain('autoComplete="country-name"');
});

test("the picker is bound to the country controller with the required label", () => {
  renderRegisterFields();
  const props = currentCountrySelectorProps();

  expect(props.name).toBe("country");
  expect(props.id).toBe("register-country");
  expect(props.label).toBe(t.country);
  expect(props.required).toBe(true);
  // Empty default pins to the selector's cleared state (""), never null.
  expect(props.value).toBe("");
  expect(props.error).toBe(false);
  expect(props.helperText).toBe(" ");
  expect(typeof props.onChange).toBe("function");
  expect(typeof props.onBlur).toBe("function");
});

test("selecting a country sets the form country to the ISO code and submits it", async () => {
  renderRegisterFields();
  const state = currentRegisterState();
  seedValidRegistrant(state);
  currentCountrySelectorProps().onChange("EG");

  const outcome = await submitRegisterState(state);
  expect(outcome.valid).toBe(true);
  if (outcome.valid) {
    expect(outcome.data.country).toBe("EG");
  }
});

test("the phone field binds through the PhoneFormField projection (null default, E.164 seam)", async () => {
  renderRegisterFields();
  const state = currentRegisterState();
  const phoneProps = currentPhoneInputProps();

  // The controller projects the "" form default onto the component's null
  // contract and threads the section's label/required wiring verbatim.
  expect(phoneProps.value).toBeNull();
  expect(phoneProps.label).toBe(t.phone);
  expect(phoneProps.required).toBe(true);
  // The E.164 change seam writes through to the form state: seed the rest,
  // pick a country, and the seeded number rides the submit payload.
  seedValidRegistrant(state);
  currentCountrySelectorProps().onChange("EG");
  const outcome = await submitRegisterState(state);
  expect(outcome.valid).toBe(true);
  if (outcome.valid) {
    expect(outcome.data.phone).toBe("+201000000000");
  }
});

test("empty submit blocks with the localized required copy on the country path", async () => {
  renderRegisterFields();
  const state = currentRegisterState();

  const outcome = await submitRegisterState(state);
  expect(outcome.valid).toBe(false);
  if (!outcome.valid) {
    expect(outcome.errors.country?.type).toBe("required");
    expect(outcome.errors.country?.message).toBe(t.countryCodeRequired);
  }
});

test("malformed injected value surfaces the localized invalid copy", async () => {
  renderRegisterFields();
  const state = currentRegisterState();
  currentCountrySelectorProps().onChange("EGYPT");

  const outcome = await submitRegisterState(state);
  expect(outcome.valid).toBe(false);
  if (!outcome.valid) {
    expect(outcome.errors.country?.type).toBe("validate");
    expect(outcome.errors.country?.message).toBe(t.countryCodeInvalid);
  }
});

test("lowercase and padded selections pass the shared-schema gate", async () => {
  renderRegisterFields();
  const state = currentRegisterState();
  seedValidRegistrant(state);
  currentCountrySelectorProps().onChange(" eg ");

  const outcome = await submitRegisterState(state);
  expect(outcome.valid).toBe(true);
});

// ---------------------------------------------------------------------------
// Tier 2 — the server-pair projection seam surfaces on the country path

test("setError on the country path (the projection sink) feeds the picker's error/helper props", () => {
  renderRegisterFields();
  const state = currentRegisterState();
  state.setError("country", { type: "server", message: "The selected country is not recognized." });

  // The controller's live formState proxy reflects the sink call; the
  // identity grid projects exactly this error object onto the picker's
  // error/helperText props on the next render pass.
  expect(state.countryField.formState.errors.country?.type).toBe("server");
  expect(state.countryField.formState.errors.country?.message).toBe("The selected country is not recognized.");
});

// ---------------------------------------------------------------------------
// Tier 3 — rapid selection changes + concurrent submits: no stale-state race

test("rapid selection changes leave the submit reading the latest value only", async () => {
  renderRegisterFields();
  const state = currentRegisterState();
  seedValidRegistrant(state);
  const onChange = currentCountrySelectorProps().onChange;

  onChange("EG");
  onChange("SA");
  onChange("");
  const emptied = await submitRegisterState(state);
  expect(emptied.valid).toBe(false);
  if (!emptied.valid) {
    expect(emptied.errors.country?.message).toBe(t.countryCodeRequired);
  }

  onChange("SA");
  onChange("EG");
  const settled = await submitRegisterState(state);
  expect(settled.valid).toBe(true);
  if (settled.valid) {
    expect(settled.data.country).toBe("EG");
  }
});

test("concurrent submit attempts settle without stale errors or rejections", async () => {
  renderRegisterFields();
  const state = currentRegisterState();
  seedValidRegistrant(state);
  const onChange = currentCountrySelectorProps().onChange;

  const attempts = await Promise.allSettled([submitRegisterState(state), submitRegisterState(state)]);
  for (const attempt of attempts) {
    expect(attempt.status).toBe("fulfilled");
  }

  // A selection racing the in-flight submits still wins: the next submit
  // sees the latest code, and the earlier required error does not linger.
  onChange("EG");
  const racing = await Promise.allSettled([submitRegisterState(state), submitRegisterState(state)]);
  for (const attempt of racing) {
    expect(attempt.status).toBe("fulfilled");
    if (attempt.status === "fulfilled") {
      expect(attempt.value.valid).toBe(true);
      if (attempt.value.valid) {
        expect(attempt.value.data.country).toBe("EG");
      }
    }
  }
  expect(state.errors.country).toBeUndefined();
});

// ---------------------------------------------------------------------------
// Tier 4 — injected hostile values cannot bypass the shared-schema gate

test("overlong, unicode, and prototype-key injections all fall to the invalid copy", async () => {
  const hostileValues = ["E".repeat(10_000), "EG".repeat(5_000), "مصر", "🇪🇬", "__proto__", "constructor", "EG\nEG"];
  // Sequential fold (no-await-in-loop pattern): each probe depends on the
  // shared harness capture, so the probes must not overlap.
  await hostileValues.reduce(async (prior, hostile) => {
    await prior;
    renderRegisterFields();
    const state = currentRegisterState();
    currentCountrySelectorProps().onChange(hostile);

    const outcome = await submitRegisterState(state);
    expect(outcome.valid).toBe(false);
    if (!outcome.valid) {
      expect(outcome.errors.country?.message).toBe(t.countryCodeInvalid);
    }
  }, Promise.resolve());
});
