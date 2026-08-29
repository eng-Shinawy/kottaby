/**
 * PlanStatusConfirmDialog — component suite (DEV1-005 4.4).
 *
 * Happy DOM + Apollo `MockedProvider` tier (`test/ui/components`), harness
 * per 4.3's PlanCatalogContainer suite. Covered cells:
 *
 *  - deactivate flow (BOTH locales): localized title/body/confirm copy
 *    (interpolated with the plan title ONCE) + `setPlanActiveStatus(id,
 *    isActive:false)` variables + onStatusChanged hand-off;
 *  - activate flow (BOTH locales): the mirror copy + `isActive:true`;
 *  - (c) `PLAN_ALREADY_INACTIVE` — localized inline Alert INSIDE the dialog;
 *  - `PLAN_NOT_FOUND` — localized inline Alert;
 *  - FORBIDDEN — NOTHING surfaces locally (global errorLink posture owns it;
 *    proven by the dialog staying copy-intact and error-free);
 *  - confirm disabled while pending — rapid double-click issues exactly ONE
 *    mutation (REQ-043).
 *
 * Translation discipline (mirrors 4.3): assertions reference ONLY label
 * objects resolved through `Plans.getLabels(getTranslations(locale))` and
 * `Errors.getLabels(...)` — zero hardcoded Arabic/English UI copy.
 */

import { afterEach, describe, expect, mock, test } from "bun:test";
import type { MockLink } from "@apollo/client/testing";
import { MockedProvider } from "@apollo/client/testing/react";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import type {
  AdminPlansQuery_adminPlans,
  SetPlanActiveStatusMutationVariables,
} from "@/frontend/graphql/generated/gql/graphql";
import { setPlanActiveStatusMutationDocument } from "@/frontend/graphql/sharedDocuments";
import { PlanStatusConfirmDialog } from "@/frontend/views/admin/plans";
import type { AppLocale } from "@/shared/locale/AppLocale";
import { Errors as ErrorsNs } from "@/shared/locale/namespaces/errors";
import { Plans as PlansNs } from "@/shared/locale/namespaces/plans";
import { getTranslations } from "@/shared/locale/server";
import { renderWithWrapper } from "@/test/ui/components/TestWrapper";

// ----------------------------------------------------------------------------
// Fixtures + mocks
// ----------------------------------------------------------------------------

function planFixture(overrides?: Partial<AdminPlansQuery_adminPlans>): AdminPlansQuery_adminPlans {
  return {
    id: "12",
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

const ACTIVE_ROW = planFixture();
const INACTIVE_ROW = planFixture({
  isActive: false,
  deactivatedAt: "2026-02-01T12:30:00.000Z",
});
const DEACTIVATED_ROW = planFixture({ isActive: false, deactivatedAt: "2026-03-01T09:00:00.000Z" });
const REACTIVATED_ROW = planFixture({ isActive: true, deactivatedAt: null });

function renderDialog(props: {
  readonly locale: AppLocale;
  readonly plan: AdminPlansQuery_adminPlans;
  readonly mocks: MockLink.MockedResponse[];
  readonly onStatusChanged: ReturnType<typeof mock>;
}): void {
  renderWithWrapper(
    <MockedProvider mocks={[...props.mocks]}>
      <PlanStatusConfirmDialog
        open
        plan={props.plan}
        labels={PlansNs.getLabels(getTranslations(props.locale))}
        onClose={mock(() => undefined)}
        onStatusChanged={props.onStatusChanged}
      />
    </MockedProvider>,
    { locale: props.locale }
  );
}

function confirmButton(t: ReturnType<typeof PlansNs.getLabels>): HTMLButtonElement {
  const button = screen.getByRole("button", { name: t.confirm });
  if (!(button instanceof HTMLButtonElement)) throw new Error("confirm control must be a button");
  return button;
}

afterEach(cleanup);

// ============================================================================
// Both flows, both locales (Arabic RTL first — the app's default)
// ============================================================================

for (const locale of ["ar", "en"] as AppLocale[]) {
  const t = PlansNs.getLabels(getTranslations(locale));
  const errorsT = ErrorsNs.getLabels(getTranslations(locale));

  describe(`PlanStatusConfirmDialog (${locale === "ar" ? "RTL/arabic" : "LTR/english"})`, () => {
    test("deactivate flow — localized copy + setPlanActiveStatus(id, isActive:false)", async () => {
      const onStatusChanged = mock((_plan: AdminPlansQuery_adminPlans) => undefined);
      const deactivateMock: MockLink.MockedResponse = {
        request: {
          query: setPlanActiveStatusMutationDocument,
          variables: { id: ACTIVE_ROW.id, isActive: false } satisfies SetPlanActiveStatusMutationVariables,
        },
        result: { data: { setPlanActiveStatus: DEACTIVATED_ROW } },
      };
      renderDialog({ locale, plan: ACTIVE_ROW, mocks: [deactivateMock], onStatusChanged });

      expect(screen.getByText(t.deactivateConfirmTitle)).toBeDefined();
      expect(screen.getByText(t.deactivateConfirmBody(ACTIVE_ROW.title))).toBeDefined();

      fireEvent.click(confirmButton(t));

      await waitFor(() => {
        expect(onStatusChanged).toHaveBeenCalledTimes(1);
      });
      expect(onStatusChanged).toHaveBeenCalledWith(DEACTIVATED_ROW);
      expect(screen.queryByTestId("plan-status-alert")).toBeNull();
      // The idempotent-reject copy must NOT appear on the happy path.
      expect(screen.queryByText(errorsT.planAlreadyInactive)).toBeNull();
    });

    test("activate flow — localized copy + setPlanActiveStatus(id, isActive:true)", async () => {
      const onStatusChanged = mock((_plan: AdminPlansQuery_adminPlans) => undefined);
      const activateMock: MockLink.MockedResponse = {
        request: {
          query: setPlanActiveStatusMutationDocument,
          variables: { id: INACTIVE_ROW.id, isActive: true } satisfies SetPlanActiveStatusMutationVariables,
        },
        result: { data: { setPlanActiveStatus: REACTIVATED_ROW } },
      };
      renderDialog({ locale, plan: INACTIVE_ROW, mocks: [activateMock], onStatusChanged });

      expect(screen.getByText(t.activateConfirmTitle)).toBeDefined();
      expect(screen.getByText(t.activateConfirmBody(INACTIVE_ROW.title))).toBeDefined();

      fireEvent.click(confirmButton(t));

      await waitFor(() => {
        expect(onStatusChanged).toHaveBeenCalledTimes(1);
      });
      expect(onStatusChanged).toHaveBeenCalledWith(REACTIVATED_ROW);
    });

    test("(c) PLAN_ALREADY_INACTIVE — localized inline alert inside the dialog", async () => {
      const onStatusChanged = mock((_plan: AdminPlansQuery_adminPlans) => undefined);
      const alreadyInactiveMock: MockLink.MockedResponse = {
        request: {
          query: setPlanActiveStatusMutationDocument,
          variables: { id: ACTIVE_ROW.id, isActive: false } satisfies SetPlanActiveStatusMutationVariables,
        },
        result: {
          errors: [
            {
              message: "PLAN_ALREADY_INACTIVE (masked transport surface)",
              extensions: { code: "PLAN_ALREADY_INACTIVE" },
            },
          ],
        },
      };
      renderDialog({ locale, plan: ACTIVE_ROW, mocks: [alreadyInactiveMock], onStatusChanged });

      fireEvent.click(confirmButton(t));

      await waitFor(() => {
        expect(screen.getByTestId("plan-status-alert")).toBeDefined();
      });
      expect(screen.getByText(errorsT.planAlreadyInactive)).toBeDefined();
      // The failure never reaches the success hand-off.
      expect(onStatusChanged).toHaveBeenCalledTimes(0);
    });
  });
}

// ============================================================================
// Error-class + flight mechanics (english locale)
// ============================================================================

describe("PlanStatusConfirmDialog — error classes + flight guard", () => {
  const t = PlansNs.getLabels(getTranslations("en"));
  const errorsT = ErrorsNs.getLabels(getTranslations("en"));

  test("PLAN_NOT_FOUND — localized inline alert inside the dialog", async () => {
    const onStatusChanged = mock((_plan: AdminPlansQuery_adminPlans) => undefined);
    const notFoundMock: MockLink.MockedResponse = {
      request: {
        query: setPlanActiveStatusMutationDocument,
        variables: { id: ACTIVE_ROW.id, isActive: false } satisfies SetPlanActiveStatusMutationVariables,
      },
      result: {
        errors: [{ message: "PLAN_NOT_FOUND (masked)", extensions: { code: "PLAN_NOT_FOUND" } }],
      },
    };
    renderDialog({ locale: "en", plan: ACTIVE_ROW, mocks: [notFoundMock], onStatusChanged });

    fireEvent.click(confirmButton(t));

    await waitFor(() => {
      expect(screen.getByText(errorsT.planNotFound)).toBeDefined();
    });
    expect(onStatusChanged).toHaveBeenCalledTimes(0);
  });

  test("FORBIDDEN surfaces NOTHING locally — the global errorLink posture owns it", async () => {
    const onStatusChanged = mock((_plan: AdminPlansQuery_adminPlans) => undefined);
    const forbiddenMock: MockLink.MockedResponse = {
      request: {
        query: setPlanActiveStatusMutationDocument,
        variables: { id: ACTIVE_ROW.id, isActive: false } satisfies SetPlanActiveStatusMutationVariables,
      },
      result: {
        errors: [{ message: "FORBIDDEN (masked transport surface)", extensions: { code: "FORBIDDEN" } }],
      },
    };
    renderDialog({ locale: "en", plan: ACTIVE_ROW, mocks: [forbiddenMock], onStatusChanged });

    fireEvent.click(confirmButton(t));

    // Give the (locally-unhandled) failure a beat to settle, then prove the
    // dialog stayed clean: no inline alert, no success hand-off.
    await new Promise(resolve => setTimeout(resolve, 25));
    expect(screen.queryByTestId("plan-status-alert")).toBeNull();
    expect(screen.queryByText(errorsT.planAlreadyInactive)).toBeNull();
    expect(onStatusChanged).toHaveBeenCalledTimes(0);
  });

  test("confirm disabled while pending — rapid double-click issues exactly ONE mutation", async () => {
    const onStatusChanged = mock((_plan: AdminPlansQuery_adminPlans) => undefined);
    let mutationCalls = 0;
    const pendingMock: MockLink.MockedResponse = {
      request: {
        query: setPlanActiveStatusMutationDocument,
        variables: { id: ACTIVE_ROW.id, isActive: false } satisfies SetPlanActiveStatusMutationVariables,
      },
      result: () => {
        mutationCalls += 1;
        return { data: { setPlanActiveStatus: DEACTIVATED_ROW } };
      },
      delay: 20,
    };
    renderDialog({ locale: "en", plan: ACTIVE_ROW, mocks: [pendingMock], onStatusChanged });

    const button = confirmButton(t);
    expect(button.getAttribute("disabled")).toBeNull();

    fireEvent.click(button);
    expect(button.getAttribute("disabled")).not.toBeNull();

    // The rapid second click lands on the DISABLED button — no second call.
    fireEvent.click(button);

    await waitFor(() => {
      expect(onStatusChanged).toHaveBeenCalledTimes(1);
    });
    expect(mutationCalls).toBe(1);
  });
});
