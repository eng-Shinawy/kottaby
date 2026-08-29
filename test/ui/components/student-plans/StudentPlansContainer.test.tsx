/**
 * StudentPlansContainer + StudentPlanCard — component suite (consumer /plans
 * storefront, DEV1-006 Phase A round).
 *
 * Happy DOM + Apollo `MockedProvider` tier (`test/ui/components`): the
 * container's settled-state matrix is rendered across BOTH locales (Arabic
 * RTL first — the app's default), with the catalog data supplied by
 * `planCatalog` mocks carrying NO variables exactly as the container issues
 * them, and the owner-scoped `mySubscriptions` read mocked alongside every
 * catalog response (the pending-request state derives from it):
 *
 *   skeleton (in flight) · populated card grid · empty catalog ·
 *   load failure + retry
 *
 * DEV1-006 Phase A purchase-flow cells:
 *  - REQUEST HAPPY PATH — open dialog → submit → mutation mock resolves →
 *    success toast + dialog closes + `mySubscriptions` refetch (second
 *    ordered mock carries the new pending row) → the card flips to its
 *    pending posture (disabled CTA + pending chip);
 *  - REQUEST FAILURE — mutation rejects → failure toast, dialog stays open;
 *  - PENDING POSTURE — a pre-existing PENDING row disables that plan's CTA
 *    and renders the chip; an ACTIVE row does not (renewals stay free).
 *
 * Plus two single-tier cells:
 *  - CARD delegation tier — `StudentPlanCard` rendered directly with a
 *    spied callback: the subscribe CTA forwards the EXACT plan object to
 *    `onSubscribe` (the container's request-dialog boundary); the pending
 *    prop disables the CTA and drops the delegation;
 *  - SERVER HAND-OFF tier — the container's `labels` prop (the RSC-safe
 *    string subset the `/plans` page passes) overrides the client-side
 *    `useAppTranslation(StudentPlans)` handle.
 *
 * Translation discipline (mirrors `PlanCatalogContainer.test.tsx`):
 * assertions reference ONLY label objects resolved through
 * `StudentPlans.getLabels(getTranslations(locale))` — zero hardcoded
 * Arabic/English UI copy. Fixture data (ASCII plan titles, price strings,
 * ISO stamps) is test-owned payload, not UI copy; interval values are
 * recomputed through the SAME namespace formatter the card renders.
 */

import { afterEach, describe, expect, mock, test } from "bun:test";
import type { MockLink } from "@apollo/client/testing";
import { MockedProvider } from "@apollo/client/testing/react";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import type {
  MySubscriptionsQuery_mySubscriptions,
  PlanCatalogQuery_planCatalog,
} from "@/frontend/graphql/generated/gql/graphql";
import {
  mySubscriptionsQueryDocument,
  planCatalogQueryDocument,
  requestPlanSubscriptionMutationDocument,
} from "@/frontend/graphql/sharedDocuments";
import { StudentPlanCard, StudentPlansContainer } from "@/frontend/views/student/plans";
import type { AppLocale } from "@/shared/locale/AppLocale";
import { StudentPlans as StudentPlansNs } from "@/shared/locale/namespaces/studentPlans";
import { getTranslations } from "@/shared/locale/server";
import { renderWithWrapper } from "@/test/ui/components/TestWrapper";

// ----------------------------------------------------------------------------
// Fixtures + mocks
// ----------------------------------------------------------------------------

/** Deterministic ten-field plan row builder mirroring the REQ-060 shape. */
function planFixture(overrides?: Partial<PlanCatalogQuery_planCatalog>): PlanCatalogQuery_planCatalog {
  return {
    id: "1",
    title: "Hifz Jadid — Full Memorization Plan",
    sessionCount: 8,
    price: "250.00",
    currency: "EGP",
    intervalDays: 30,
    isActive: true,
    deactivatedAt: null,
    createdAt: "2026-01-15T10:00:00.000Z",
    updatedAt: "2026-01-15T10:00:00.000Z",
    ...overrides,
  };
}

/** Deterministic owner-scoped subscription row builder (DEV1-006 shape). */
function subscriptionFixture(
  overrides?: Partial<MySubscriptionsQuery_mySubscriptions>
): MySubscriptionsQuery_mySubscriptions {
  return {
    id: "701",
    status: "pending",
    plan: planFixture(),
    startDate: null,
    endDate: null,
    paymentMethod: null,
    paymentReference: null,
    paymentVerifiedAt: null,
    createdAt: "2026-02-01T09:00:00.000Z",
    updatedAt: "2026-02-01T09:00:00.000Z",
    ...overrides,
  };
}

const FIRST_ROW = planFixture();
const SECOND_ROW = planFixture({
  id: "2",
  title: "Tajweed Mastery",
  sessionCount: 4,
  price: "150.00",
  intervalDays: 14,
});

/** `planCatalog` mock answering with the exact no-variables request. */
function planCatalogMock(rows: PlanCatalogQuery_planCatalog[]): MockLink.MockedResponse {
  return {
    request: { query: planCatalogQueryDocument },
    result: { data: { planCatalog: rows } },
  };
}

/** `mySubscriptions` mock — one answer per identical request, in order. */
function mySubscriptionsMock(rows: MySubscriptionsQuery_mySubscriptions[]): MockLink.MockedResponse {
  return {
    request: { query: mySubscriptionsQueryDocument },
    result: { data: { mySubscriptions: rows } },
  };
}

/** Convenience alias — identical to the base mock, kept for call-site readability. */
function mySubscriptionsOnce(rows: MySubscriptionsQuery_mySubscriptions[]): MockLink.MockedResponse {
  return mySubscriptionsMock(rows);
}

/** `requestPlanSubscription` mock resolving with the created pending row. */
function requestSubscriptionMock(planId: string, createdId: string): MockLink.MockedResponse {
  return {
    request: { query: requestPlanSubscriptionMutationDocument, variables: { planId } },
    result: {
      data: {
        requestPlanSubscription: subscriptionFixture({ id: createdId, plan: FIRST_ROW }),
      },
    },
  };
}

/** `requestPlanSubscription` mock rejecting with a localized domain conflict. */
function deniedRequestSubscriptionMock(planId: string): MockLink.MockedResponse {
  return {
    request: { query: requestPlanSubscriptionMutationDocument, variables: { planId } },
    result: {
      errors: [{ message: "PLAN_INACTIVE (localized transport surface)", extensions: { code: "PLAN_INACTIVE" } }],
    },
  };
}

/** Permanently in-flight mock (MockLink never settles `delay: Infinity`). */
function pendingPlanCatalogMock(): MockLink.MockedResponse {
  return { request: { query: planCatalogQueryDocument }, delay: Infinity };
}

/** Scoped-deny mock authored exactly where the transport puts `extensions.code`. */
function deniedPlanCatalogMock(): MockLink.MockedResponse {
  return {
    request: { query: planCatalogQueryDocument },
    result: {
      errors: [{ message: "FORBIDDEN (masked transport surface)", extensions: { code: "FORBIDDEN" } }],
    },
  };
}

function renderContainer(mocks: MockLink.MockedResponse[], locale: AppLocale): void {
  renderWithWrapper(
    <MockedProvider mocks={[...mocks]}>
      <StudentPlansContainer />
    </MockedProvider>,
    { locale }
  );
}

afterEach(cleanup);

// One block per locale keeps RTL/LTR both exercised over the settled-state
// matrix while every case stays independently readable.
for (const locale of ["ar", "en"] as AppLocale[]) {
  const t = StudentPlansNs.getLabels(getTranslations(locale));

  describe(`StudentPlansContainer (${locale === "ar" ? "RTL/arabic" : "LTR/english"})`, () => {
    test("query in flight renders the busy skeleton — no settled copy leaks", () => {
      renderContainer([pendingPlanCatalogMock()], locale);

      const skeleton = screen.getByTestId("student-plans-loading");
      expect(skeleton.getAttribute("aria-busy")).toBe("true");
      expect(screen.getByText(t.loading)).toBeDefined();
      // No settled-state copy may appear while the query is in flight.
      expect(screen.queryByTestId("student-plans-grid")).toBeNull();
      expect(screen.queryByTestId("student-plans-empty")).toBeNull();
      expect(screen.queryByTestId("student-plans-error")).toBeNull();
    });

    test("populated storefront renders one card per active plan with verbatim commerce fields", async () => {
      renderContainer([planCatalogMock([FIRST_ROW, SECOND_ROW]), mySubscriptionsOnce([])], locale);

      await waitFor(() => {
        expect(screen.getByTestId("student-plans-grid")).toBeDefined();
      });
      // Card titles render from the payload.
      expect(screen.getByText(FIRST_ROW.title)).toBeDefined();
      expect(screen.getByText(SECOND_ROW.title)).toBeDefined();
      // Price: decimal STRING + currency rendered verbatim on EVERY card
      // (hero — no coercion / no toFixed anywhere) — both fixtures share
      // the EGP currency, so assert the multiplicity explicitly.
      expect(screen.getAllByText(FIRST_ROW.currency)).toHaveLength(2);
      // Sessions render as-is.
      expect(screen.getByText(String(FIRST_ROW.sessionCount))).toBeDefined();
      // Interval goes through the namespace formatter — recomputed here via
      // the SAME formatter (no hardcoded day copy in the assertion).
      expect(screen.getByText(t.intervalDays(FIRST_ROW.intervalDays))).toBeDefined();
      expect(screen.getByText(t.intervalDays(SECOND_ROW.intervalDays))).toBeDefined();
      // One subscribe CTA per plan, disambiguated by the per-plan aria-label.
      expect(screen.getAllByRole("button", { name: `${t.subscribeCta} — ${FIRST_ROW.title}` })).toHaveLength(1);
      expect(screen.getAllByRole("button", { name: `${t.subscribeCta} — ${SECOND_ROW.title}` })).toHaveLength(1);
      // No settled side state may accompany the grid.
      expect(screen.queryByTestId("student-plans-empty")).toBeNull();
      expect(screen.queryByTestId("student-plans-error")).toBeNull();
    });

    test("subscribe CTA opens the purchase-request dialog with the plan title interpolated once", async () => {
      renderContainer([planCatalogMock([FIRST_ROW]), mySubscriptionsOnce([])], locale);

      await waitFor(() => {
        expect(screen.getByTestId("student-plans-grid")).toBeDefined();
      });
      fireEvent.click(screen.getByRole("button", { name: `${t.subscribeCta} — ${FIRST_ROW.title}` }));

      const dialog = await waitFor(() => {
        const el = screen.getByText(t.purchaseDialogTitle);
        expect(el).toBeDefined();
        return el;
      });
      expect(dialog.getAttribute("id")).toBe("student-plans-request-title");
      // Body interpolates the plan title exactly once through the formatter.
      const expectedBody = t.purchaseDialogBody(FIRST_ROW.title);
      expect(screen.getByText(expectedBody)).toBeDefined();
      expect(expectedBody.split(FIRST_ROW.title).length - 1).toBe(1);
      // Submit + dismiss actions are present.
      expect(screen.getByRole("button", { name: t.purchaseRequestCta })).toBeDefined();
      // Dismiss returns the storefront to its steady state.
      fireEvent.click(screen.getByRole("button", { name: t.purchaseDialogClose }));
      await waitFor(() => {
        expect(screen.queryByText(t.purchaseDialogTitle)).toBeNull();
      });
    });

    test("request happy path: submit fires the mutation, success toast shows, card flips to pending", async () => {
      renderContainer(
        [
          planCatalogMock([FIRST_ROW, SECOND_ROW]),
          // Ordered owner-scoped answers: first read = no requests; the
          // post-success refetch = the new PENDING row.
          mySubscriptionsOnce([]),
          mySubscriptionsOnce([subscriptionFixture({ id: "901", plan: FIRST_ROW })]),
          // The mutation itself.
          requestSubscriptionMock(FIRST_ROW.id, "901"),
        ],
        locale
      );

      await waitFor(() => {
        expect(screen.getByTestId("student-plans-grid")).toBeDefined();
      });
      fireEvent.click(screen.getByRole("button", { name: `${t.subscribeCta} — ${FIRST_ROW.title}` }));
      fireEvent.click(await screen.findByRole("button", { name: t.purchaseRequestCta }));

      // Success toast — the pre-interpolated namespace copy.
      const toast = await screen.findByTestId("student-plans-toast");
      expect(toast.textContent).toContain(t.purchaseRequestSuccessToast);
      // Dialog closed after success.
      await waitFor(() => {
        expect(screen.queryByText(t.purchaseDialogTitle)).toBeNull();
      });
      // Refetched owner read flips the card: disabled CTA + pending chip.
      await waitFor(() => {
        expect(screen.getByTestId(`student-plan-pending-chip-${FIRST_ROW.id}`)).toBeDefined();
      });
      const pendingCta = screen.getByRole("button", {
        name: `${t.purchasePendingCta} — ${FIRST_ROW.title}`,
      });
      expect(pendingCta.hasAttribute("disabled")).toBe(true);
      // The untouched plan keeps its live subscribe CTA.
      expect(screen.getAllByRole("button", { name: `${t.subscribeCta} — ${SECOND_ROW.title}` })).toHaveLength(1);
    });

    test("request failure: mutation reject shows the failure toast and keeps the dialog open", async () => {
      renderContainer(
        [planCatalogMock([FIRST_ROW]), mySubscriptionsOnce([]), deniedRequestSubscriptionMock(FIRST_ROW.id)],
        locale
      );

      await waitFor(() => {
        expect(screen.getByTestId("student-plans-grid")).toBeDefined();
      });
      fireEvent.click(screen.getByRole("button", { name: `${t.subscribeCta} — ${FIRST_ROW.title}` }));
      fireEvent.click(await screen.findByRole("button", { name: t.purchaseRequestCta }));

      await screen.findByTestId("student-plans-toast");
      expect(screen.getByText(t.purchaseRequestFailedToast)).toBeDefined();
      // Dialog stays open for an in-place retry.
      expect(screen.getByText(t.purchaseDialogTitle)).toBeDefined();
      // The storefront never flipped to the pending posture.
      expect(screen.queryByTestId(`student-plan-pending-chip-${FIRST_ROW.id}`)).toBeNull();
    });

    test("pre-existing PENDING request disables that plan's CTA; ACTIVE history does not", async () => {
      renderContainer(
        [
          planCatalogMock([FIRST_ROW, SECOND_ROW]),
          mySubscriptionsOnce([
            subscriptionFixture({ id: "701", plan: FIRST_ROW, status: "pending" }),
            subscriptionFixture({ id: "702", plan: SECOND_ROW, status: "active" }),
          ]),
        ],
        locale
      );

      await waitFor(() => {
        expect(screen.getByTestId("student-plans-grid")).toBeDefined();
      });
      // Pending plan: chip + disabled relabeled CTA; no live subscribe CTA.
      // findBy* — the owner-scoped read settles independently of the catalog
      // read, so the pending posture may land a tick after the grid mounts.
      const pendingCta = await screen.findByRole("button", {
        name: `${t.purchasePendingCta} — ${FIRST_ROW.title}`,
      });
      expect(await screen.findByTestId(`student-plan-pending-chip-${FIRST_ROW.id}`)).toBeDefined();
      expect(pendingCta.hasAttribute("disabled")).toBe(true);
      expect(screen.queryByRole("button", { name: `${t.subscribeCta} — ${FIRST_ROW.title}` })).toBeNull();
      // Active-history plan: NOT pending — renewals stay open until the
      // payment phase owns them.
      expect(screen.queryByTestId(`student-plan-pending-chip-${SECOND_ROW.id}`)).toBeNull();
      expect(screen.getAllByRole("button", { name: `${t.subscribeCta} — ${SECOND_ROW.title}` })).toHaveLength(1);
    });

    test("empty catalog renders the localized empty state", async () => {
      renderContainer([planCatalogMock([]), mySubscriptionsOnce([])], locale);

      await waitFor(() => {
        expect(screen.getByTestId("student-plans-empty")).toBeDefined();
      });
      expect(screen.getByText(t.emptyStateTitle)).toBeDefined();
      expect(screen.getByText(t.emptyStateBody)).toBeDefined();
      // No grid/skeleton/error may accompany the empty state.
      expect(screen.queryByTestId("student-plans-grid")).toBeNull();
      expect(screen.queryByTestId("student-plans-loading")).toBeNull();
      expect(screen.queryByTestId("student-plans-error")).toBeNull();
    });

    test("load failure renders the localized error state with retry", async () => {
      renderContainer([deniedPlanCatalogMock()], locale);

      await waitFor(() => {
        expect(screen.getByTestId("student-plans-error")).toBeDefined();
      });
      expect(screen.getByText(t.errorStateTitle)).toBeDefined();
      expect(screen.getByText(t.errorStateBody)).toBeDefined();
      expect(screen.getByRole("button", { name: t.errorStateRetry })).toBeDefined();
      // A failure never renders storefront cards or the empty-state note.
      expect(screen.queryByTestId("student-plans-grid")).toBeNull();
      expect(screen.queryByTestId("student-plans-empty")).toBeNull();
    });
  });
}

// ============================================================================
// CARD delegation tier — the container's subscribe boundary
// ============================================================================

describe("StudentPlanCard — subscribe CTA delegates the exact plan to the callback", () => {
  test("CTA forwards the clicked plan object", () => {
    const t = StudentPlansNs.getLabels(getTranslations("en"));
    const onSubscribe = mock((_plan: PlanCatalogQuery_planCatalog) => undefined);

    renderWithWrapper(
      <StudentPlanCard plan={FIRST_ROW} labels={t} hasPendingRequest={false} onSubscribe={onSubscribe} />,
      { locale: "en" }
    );

    expect(screen.getByText(FIRST_ROW.title)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: `${t.subscribeCta} — ${FIRST_ROW.title}` }));
    expect(onSubscribe).toHaveBeenCalledTimes(1);
    expect(onSubscribe).toHaveBeenCalledWith(FIRST_ROW);
  });

  test("pending posture: CTA disabled with the pending relabel and NO delegation", () => {
    const t = StudentPlansNs.getLabels(getTranslations("en"));
    const onSubscribe = mock((_plan: PlanCatalogQuery_planCatalog) => undefined);

    renderWithWrapper(
      <StudentPlanCard plan={FIRST_ROW} labels={t} hasPendingRequest={true} onSubscribe={onSubscribe} />,
      { locale: "en" }
    );

    expect(screen.getByTestId(`student-plan-pending-chip-${FIRST_ROW.id}`)).toBeDefined();
    const pendingCta = screen.getByRole("button", { name: `${t.purchasePendingCta} — ${FIRST_ROW.title}` });
    expect(pendingCta.hasAttribute("disabled")).toBe(true);
    fireEvent.click(pendingCta);
    expect(onSubscribe).not.toHaveBeenCalled();
  });
});

// ============================================================================
// SERVER HAND-OFF tier — the /plans page's RSC-serializable label subset
// ============================================================================

describe("StudentPlansContainer — labels prop overrides the client handle", () => {
  test("server-resolved strings win over the client-side namespace", async () => {
    const t = StudentPlansNs.getLabels(getTranslations("en"));
    renderWithWrapper(
      <MockedProvider mocks={[planCatalogMock([]), mySubscriptionsOnce([])]}>
        <StudentPlansContainer labels={{ ...t, emptyStateTitle: "SERVER EMPTY TITLE", subscribeCta: "SERVER CTA" }} />
      </MockedProvider>,
      { locale: "en" }
    );

    await waitFor(() => {
      expect(screen.getByTestId("student-plans-empty")).toBeDefined();
    });
    // Overridden members render from the prop...
    expect(screen.getByText("SERVER EMPTY TITLE")).toBeDefined();
    // ...and the client-handle copy they replace must NOT leak through.
    expect(screen.queryByText(t.emptyStateTitle)).toBeNull();
    // NOTE: the two formatter keys are structurally absent from the
    // serialized subset — the merge semantics they ride are pinned by the
    // populated-cards tier (interval values come from the client handle).
  });
});
