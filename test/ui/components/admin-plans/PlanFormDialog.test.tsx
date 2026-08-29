/**
 * PlanFormDialog — component suite (DEV1-005 4.4, REQ-012/043/050/063).
 *
 * Happy DOM + Apollo `MockedProvider` tier (`test/ui/components`), harness
 * per 4.3's PlanCatalogContainer suite. Covered cells:
 *
 *  (a) create happy path — valid submit issues `createPlan` with the exact
 *      `CreatePlanInput` variables and hands the canonical row to `onSaved`
 *      (both locales);
 *  (b) server VALIDATION + `extensions.fields[]` — localized per-field
 *      errors land under the CORRECT TextFields with `aria-invalid`
 *      (MUI InputBase mirrors `error` onto `aria-invalid`), others clean
 *      (both locales);
 *  (d) submit disabled during flight — rapid double-click issues EXACTLY
 *      ONE mutation (REQ-043);
 *  (e) `React.SubmitEvent` typing proven behaviorally — submission through
 *      the form's `requestSubmit()` (native SubmitEvent → onSubmit);
 *  (f) edit-mode partial patch — variables carry ONLY changed keys: the
 *      captured wire variables' JSON (undefined keys dropped) contains
 *      exactly the price field (the avoidOptionals codegen nuance);
 *  + edit-mode no-change guard — untouched form ⇒ submit disabled.
 *
 * Translation discipline (mirrors 4.3): assertions reference ONLY label
 * objects resolved through `Plans.getLabels(getTranslations(locale))` and
 * `Errors.getLabels(...)` — zero hardcoded Arabic/English UI copy. Fixture
 * data is test-owned payload, not UI copy.
 */

import { afterEach, describe, expect, mock, test } from "bun:test";
import type { MockLink } from "@apollo/client/testing";
import { MockedProvider } from "@apollo/client/testing/react";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import type {
  AdminPlansQuery_adminPlans,
  CreatePlanMutationVariables,
  UpdatePlanMutationVariables,
} from "@/frontend/graphql/generated/gql/graphql";
import { createPlanMutationDocument, updatePlanMutationDocument } from "@/frontend/graphql/sharedDocuments";
import { PlanFormDialog } from "@/frontend/views/admin/plans";
import type { AppLocale } from "@/shared/locale/AppLocale";
import { Errors as ErrorsNs } from "@/shared/locale/namespaces/errors";
import { Plans as PlansNs } from "@/shared/locale/namespaces/plans";
import { getTranslations } from "@/shared/locale/server";
import { renderWithWrapper } from "@/test/ui/components/TestWrapper";

// ----------------------------------------------------------------------------
// Fixtures + mocks
// ----------------------------------------------------------------------------

/** Deterministic canonical ten-field row (the seed for edit mode). */
function planFixture(overrides?: Partial<AdminPlansQuery_adminPlans>): AdminPlansQuery_adminPlans {
  return {
    id: "7",
    title: "Hifz Jadid — Full Memorization Plan",
    sessionCount: 8,
    price: "250.00",
    currency: "USD",
    intervalDays: 30,
    isActive: true,
    deactivatedAt: null,
    createdAt: "2026-01-15T10:00:00.000Z",
    updatedAt: "2026-01-15T10:00:00.000Z",
    ...overrides,
  };
}

const EDIT_SEED = planFixture();

/** Canonical RETURNING row the create mutation answers with. */
const CREATED_ROW = planFixture({ id: "99", title: "Browser Smoke Plan", price: "19.99", currency: "EGP" });

/** Canonical RETURNING row the partial update answers with. */
const UPDATED_ROW = planFixture({ price: "9.99", updatedAt: "2026-03-01T09:00:00.000Z" });

function renderDialog(props: {
  readonly locale: AppLocale;
  readonly plan: AdminPlansQuery_adminPlans | null;
  readonly mocks: MockLink.MockedResponse[];
  readonly onSaved: ReturnType<typeof mock>;
  readonly onClose?: ReturnType<typeof mock>;
}): void {
  renderWithWrapper(
    <MockedProvider mocks={[...props.mocks]}>
      <PlanFormDialog
        open
        plan={props.plan}
        labels={PlansNs.getLabels(getTranslations(props.locale))}
        onClose={props.onClose ?? mock(() => undefined)}
        onSaved={props.onSaved}
      />
    </MockedProvider>,
    { locale: props.locale }
  );
}

function fillField(label: string, value: string): void {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

/** The dialog's single <form> (MUI Dialog portals to body). */
function dialogForm(): HTMLFormElement {
  const form = document.querySelector("form");
  if (!(form instanceof HTMLFormElement)) throw new Error("PlanFormDialog must render a form element");
  return form;
}

/** Assertion-free input read: getByLabelText narrowed via instanceof guard. */
function inputValueOf(label: string): string {
  const element = screen.getByLabelText(label);
  if (!(element instanceof HTMLInputElement)) throw new Error(`"${label}" must render an input`);
  return element.value;
}

/** Narrowing guard for mutation variables captured through a mock result fn. */
function isUpdateVars(value: unknown): value is UpdatePlanMutationVariables {
  return typeof value === "object" && value !== null && "id" in value && "input" in value;
}

function submitButton(t: ReturnType<typeof PlansNs.getLabels>): HTMLButtonElement {
  const button = screen.getByRole("button", { name: t.save });
  if (!(button instanceof HTMLButtonElement)) throw new Error("save control must be a button");
  return button;
}

afterEach(cleanup);

// ============================================================================
// (a) + (b) — both locales (Arabic RTL first — the app's default)
// ============================================================================

for (const locale of ["ar", "en"] as AppLocale[]) {
  const t = PlansNs.getLabels(getTranslations(locale));
  const errorsT = ErrorsNs.getLabels(getTranslations(locale));

  describe(`PlanFormDialog (${locale === "ar" ? "RTL/arabic" : "LTR/english"})`, () => {
    test("(a) create happy path — exact CreatePlanInput variables + onSaved hand-off", async () => {
      const onSaved = mock((_plan: AdminPlansQuery_adminPlans) => undefined);
      const input = {
        title: "Browser Smoke Plan",
        sessionCount: 3,
        price: "19.99",
        currency: "EGP",
        intervalDays: 30,
      };
      const createMock: MockLink.MockedResponse = {
        request: { query: createPlanMutationDocument, variables: { input } satisfies CreatePlanMutationVariables },
        result: { data: { createPlan: CREATED_ROW } },
      };
      renderDialog({ locale, plan: null, mocks: [createMock], onSaved });

      fillField(t.fieldTitle, input.title);
      fillField(t.fieldSessionCount, "3");
      fillField(t.fieldPrice, "19.99");
      fillField(t.fieldCurrency, "EGP");
      fillField(t.fieldIntervalDays, "30");

      fireEvent.submit(dialogForm());

      await waitFor(() => {
        expect(onSaved).toHaveBeenCalledTimes(1);
      });
      expect(onSaved).toHaveBeenCalledWith(CREATED_ROW);
      // No field errors, no inline alert on the happy path.
      expect(screen.queryByTestId("plan-form-alert")).toBeNull();
    });

    test("(b) VALIDATION + fields[] — localized per-field errors under the correct fields", async () => {
      const onSaved = mock((_plan: AdminPlansQuery_adminPlans) => undefined);
      const input = {
        title: "سومة خاطئة",
        sessionCount: 3,
        price: "19.999",
        currency: "egp",
        intervalDays: 30,
      };
      const validationMock: MockLink.MockedResponse = {
        request: { query: createPlanMutationDocument, variables: { input } satisfies CreatePlanMutationVariables },
        result: {
          errors: [
            {
              message: "validation (masked top level)",
              extensions: {
                code: "VALIDATION",
                fields: [
                  { field: "price", code: "PLAN_PRICE_INVALID", message: errorsT.planPriceInvalid },
                  { field: "currency", code: "PLAN_CURRENCY_INVALID", message: errorsT.planCurrencyInvalid },
                ],
              },
            },
          ],
        },
      };
      renderDialog({ locale, plan: null, mocks: [validationMock], onSaved });

      fillField(t.fieldTitle, input.title);
      fillField(t.fieldSessionCount, "3");
      fillField(t.fieldPrice, "19.999");
      fillField(t.fieldCurrency, "egp");
      fillField(t.fieldIntervalDays, "30");

      fireEvent.submit(dialogForm());

      // The offending fields carry the server-localized messages…
      await waitFor(() => {
        expect(screen.getByText(errorsT.planPriceInvalid)).toBeDefined();
      });
      expect(screen.getByText(errorsT.planCurrencyInvalid)).toBeDefined();
      // …with aria-invalid=true exactly on them (MUI mirrors `error`).
      const priceInput = screen.getByLabelText(t.fieldPrice);
      const currencyInput = screen.getByLabelText(t.fieldCurrency);
      expect(priceInput.getAttribute("aria-invalid")).toBe("true");
      expect(currencyInput.getAttribute("aria-invalid")).toBe("true");
      // Untouched fields stay clean — no error state, no alert.
      expect(screen.getByLabelText(t.fieldTitle).getAttribute("aria-invalid")).not.toBe("true");
      expect(screen.getByLabelText(t.fieldSessionCount).getAttribute("aria-invalid")).not.toBe("true");
      expect(screen.getByLabelText(t.fieldIntervalDays).getAttribute("aria-invalid")).not.toBe("true");
      expect(screen.queryByTestId("plan-form-alert")).toBeNull();
      // The failure never reaches onSaved.
      expect(onSaved).toHaveBeenCalledTimes(0);
    });
  });
}

// ============================================================================
// (d) + (e) + (f) — flight/dispatch/patch mechanics (english locale)
// ============================================================================

describe("PlanFormDialog — flight, dispatch, and partial-patch mechanics", () => {
  const t = PlansNs.getLabels(getTranslations("en"));

  test("(d) submit disabled while pending — rapid double-click issues exactly ONE mutation", async () => {
    const onSaved = mock((_plan: AdminPlansQuery_adminPlans) => undefined);
    let mutationCalls = 0;
    const input = {
      title: "Browser Smoke Plan",
      sessionCount: 3,
      price: "19.99",
      currency: "EGP",
      intervalDays: 30,
    };
    const createMock: MockLink.MockedResponse = {
      request: { query: createPlanMutationDocument, variables: { input } satisfies CreatePlanMutationVariables },
      result: () => {
        mutationCalls += 1;
        return { data: { createPlan: CREATED_ROW } };
      },
      delay: 20,
    };
    renderDialog({ locale: "en", plan: null, mocks: [createMock], onSaved });

    fillField(t.fieldTitle, input.title);
    fillField(t.fieldSessionCount, "3");
    fillField(t.fieldPrice, "19.99");
    fillField(t.fieldCurrency, "EGP");
    fillField(t.fieldIntervalDays, "30");

    const button = submitButton(t);
    expect(button.getAttribute("disabled")).toBeNull();

    fireEvent.click(button);
    // In flight: native disabled + the localized submitting label + spinner.
    expect(button.getAttribute("disabled")).not.toBeNull();
    expect(screen.getByRole("button", { name: t.submitting })).toBeDefined();

    // The rapid second click lands on the DISABLED button — no second
    // submission (a second mutation would exhaust the mock and reject into
    // the dialog's error path, surfacing the inline alert).
    fireEvent.click(button);

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledTimes(1);
    });
    expect(mutationCalls).toBe(1);
    expect(screen.queryByTestId("plan-form-alert")).toBeNull();
  });

  test("(e) React.SubmitEvent typing proven behaviorally — requestSubmit dispatches onSubmit", async () => {
    const onSaved = mock((_plan: AdminPlansQuery_adminPlans) => undefined);
    const input = {
      title: "Browser Smoke Plan",
      sessionCount: 3,
      price: "19.99",
      currency: "EGP",
      intervalDays: 30,
    };
    const createMock: MockLink.MockedResponse = {
      request: { query: createPlanMutationDocument, variables: { input } satisfies CreatePlanMutationVariables },
      result: { data: { createPlan: CREATED_ROW } },
      delay: 10,
    };
    renderDialog({ locale: "en", plan: null, mocks: [createMock], onSaved });

    fillField(t.fieldTitle, input.title);
    fillField(t.fieldSessionCount, "3");
    fillField(t.fieldPrice, "19.99");
    fillField(t.fieldCurrency, "EGP");
    fillField(t.fieldIntervalDays, "30");

    // Native form submission (SubmitEvent) — NOT a button click — proving the
    // `React.SubmitEvent<HTMLFormElement>` onSubmit path end to end.
    dialogForm().requestSubmit();

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledTimes(1);
    });
  });

  test("(f) edit mode partial patch — captured wire variables carry ONLY the changed key", async () => {
    const onSaved = mock((_plan: AdminPlansQuery_adminPlans) => undefined);
    let captured: UpdatePlanMutationVariables | undefined;
    const updateMock: MockLink.MockedResponse = {
      request: {
        query: updatePlanMutationDocument,
        variables: { id: EDIT_SEED.id, input: { price: "9.99" } },
      },
      result: variables => {
        if (isUpdateVars(variables)) captured = variables;
        return { data: { updatePlan: UPDATED_ROW } };
      },
    };
    renderDialog({ locale: "en", plan: EDIT_SEED, mocks: [updateMock], onSaved });

    // Edit mode prefills the canonical row…
    expect(inputValueOf(t.fieldTitle)).toBe(EDIT_SEED.title);
    expect(inputValueOf(t.fieldPrice)).toBe(EDIT_SEED.price);
    // …and the user changes ONLY the price.
    fillField(t.fieldPrice, "9.99");

    fireEvent.submit(dialogForm());

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledTimes(1);
    });
    expect(onSaved).toHaveBeenCalledWith(UPDATED_ROW);

    // The avoidOptionals nuance, proven on the captured variables: undefined
    // keys are JSON-dropped ⇒ the wire patch carries ONLY the changed field.
    if (captured === undefined) throw new Error("mutation must have captured variables");
    const wireInput: Record<string, unknown> = JSON.parse(JSON.stringify(captured.input));
    expect(Object.keys(wireInput).toSorted((a, b) => a.localeCompare(b))).toEqual(["price"]);
    expect(wireInput.price).toBe("9.99");
    expect(captured.id).toBe(EDIT_SEED.id);
  });

  test("edit mode with zero effective changes disables submit (documented no-change UX)", () => {
    const onSaved = mock((_plan: AdminPlansQuery_adminPlans) => undefined);
    renderDialog({ locale: "en", plan: EDIT_SEED, mocks: [], onSaved });

    const button = submitButton(t);
    expect(button.getAttribute("disabled")).not.toBeNull();

    // The disabled state is live: a real change re-enables the submit, and
    // reverting disables it again.
    fillField(t.fieldPrice, "9.99");
    expect(button.getAttribute("disabled")).toBeNull();
    fillField(t.fieldPrice, EDIT_SEED.price);
    expect(button.getAttribute("disabled")).not.toBeNull();
  });
});
