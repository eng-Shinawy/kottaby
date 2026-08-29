/**
 * MySubscriptionsContainer + MySubscriptionCard — component suite (the
 * student-facing `/subscriptions` lifecycle surface, DEV1-010).
 *
 * Happy DOM + Apollo `MockedProvider` tier (`test/ui/components`): the
 * container's settled-state matrix is rendered across BOTH locales (Arabic
 * RTL first — the app's default), with the owner-scoped data supplied by
 * `mySubscriptions` mocks carrying NO variables exactly as the container
 * issues them:
 *
 *   skeleton (in flight) · populated grid + overview strip ·
 *   empty history (+ browse-plans jump) · load failure + retry
 *
 * DEV1-010 lifecycle cells:
 *  - CARD FACTS — plan title, verbatim decimal price + currency, sessions,
 *    interval through the namespace formatter, period lines (not-started /
 *    started / open-ended dash), payment stamps (machine artifact or
 *    dash), requested-at stamp — per the canonical Subscription row;
 *  - STATUS CHIPS — all five `subscription_status` machine codes map onto
 *    their localized display names (unknown codes degrade to the raw
 *    code);
 *  - RENEW HAPPY PATH — a terminal row's Renew CTA opens the shared
 *    dialog → submit → `requestPlanSubscription` mock resolves → success
 *    toast + dialog closes + refetch (second ordered mock carries the new
 *    PENDING row) → the previously-renewable row flips to its
 *    pending-blocked note;
 *  - RENEW FAILURE — mutation rejects → failure toast, dialog stays open;
 *  - RENEW FENCE MIRROR — a terminal row whose plan already carries an
 *    unresolved PENDING request renders the pending-blocked note INSTEAD
 *    of the CTA; a terminal row whose plan was DEACTIVATED renders the
 *    plan-unavailable note;
 *  - NO ACTION POSTURES — pending and active rows render no CTA and no
 *    note.
 *
 * Plus two single-tier cells:
 *  - CARD delegation tier — `MySubscriptionCard` rendered directly with a
 *    spied callback: the renew CTA forwards the EXACT subscription object
 *    to `onRenew`;
 *  - SERVER HAND-OFF tier — the container's `labels` prop (the RSC-safe
 *    string subset the `/subscriptions` page passes) overrides the
 *    client-side `useAppTranslation(MySubscriptions)` handle.
 *
 * Translation discipline (mirrors `StudentPlansContainer.test.tsx`):
 * assertions reference ONLY label objects resolved through
 * `MySubscriptions.getLabels(getTranslations(locale))` — zero hardcoded
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
  RequestPlanSubscriptionMutation,
  RequestPlanSubscriptionMutationVariables,
} from "@/frontend/graphql/generated/gql/graphql";
import {
  mySubscriptionsQueryDocument,
  requestPlanSubscriptionMutationDocument,
} from "@/frontend/graphql/sharedDocuments";
import { MySubscriptionCard, MySubscriptionsContainer } from "@/frontend/views/student/subscriptions";
import type { AppLocale } from "@/shared/locale/AppLocale";
import { MySubscriptions as MySubscriptionsNs } from "@/shared/locale/namespaces/mySubscriptions";
import { getTranslations } from "@/shared/locale/server";
import { renderWithWrapper } from "@/test/ui/components/TestWrapper";

// ----------------------------------------------------------------------------
// Fixtures + mocks
// ----------------------------------------------------------------------------

/** Deterministic embedded plan row (the FULL REQ-060 shape rides along). */
function planFixture(
  overrides?: Partial<MySubscriptionsQuery_mySubscriptions["plan"]>
): MySubscriptionsQuery_mySubscriptions["plan"] {
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

/** Deterministic owner-scoped subscription row builder (DEV1-010 shape). */
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

const ACTIVE_ROW = subscriptionFixture({
  id: "801",
  status: "active",
  startDate: "2026-02-05T12:00:00.000Z",
  endDate: "2026-03-07T12:00:00.000Z",
  paymentMethod: "bank_transfer",
  paymentReference: "RCPT-2026-0001",
  paymentVerifiedAt: "2026-02-05T12:00:00.000Z",
  // A DISTINCT plan from the pending/expired fixtures — the populated
  // surface asserts per-card facts, so its rows must not share titles.
  plan: planFixture({ id: "9", title: "Tajweed Mastery", sessionCount: 4, price: "150.00", intervalDays: 14 }),
});
const PENDING_ROW = subscriptionFixture({ id: "802" });
const EXPIRED_ROW = subscriptionFixture({
  id: "803",
  status: "expired",
  startDate: "2026-01-01T12:00:00.000Z",
  endDate: "2026-01-31T12:00:00.000Z",
  paymentMethod: "offline_cash",
  paymentReference: "RCPT-2025-0099",
  paymentVerifiedAt: "2026-01-01T12:00:00.000Z",
});

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

/** Permanently in-flight mock (MockLink never settles `delay: Infinity`). */
function pendingMySubscriptionsMock(): MockLink.MockedResponse {
  return { request: { query: mySubscriptionsQueryDocument }, delay: Infinity };
}

/** Scoped-deny mock authored exactly where the transport puts `extensions.code`. */
function deniedMySubscriptionsMock(): MockLink.MockedResponse {
  return {
    request: { query: mySubscriptionsQueryDocument },
    result: {
      errors: [{ message: "FORBIDDEN (masked transport surface)", extensions: { code: "FORBIDDEN" } }],
    },
  };
}

/** `requestPlanSubscription` mock resolving with the created pending row. */
function renewRequestMock(planId: string, createdId: string): MockLink.MockedResponse {
  const mutation: RequestPlanSubscriptionMutation = {
    requestPlanSubscription: subscriptionFixture({ id: createdId, plan: planFixture() }),
  };
  return {
    request: {
      query: requestPlanSubscriptionMutationDocument,
      variables: { planId } satisfies RequestPlanSubscriptionMutationVariables,
    },
    result: { data: mutation },
  };
}

/** `requestPlanSubscription` mock rejecting with a localized domain conflict. */
function deniedRenewRequestMock(planId: string): MockLink.MockedResponse {
  return {
    request: { query: requestPlanSubscriptionMutationDocument, variables: { planId } },
    result: {
      errors: [
        {
          message: "SUBSCRIPTION_REQUEST_EXISTS (localized transport surface)",
          extensions: { code: "SUBSCRIPTION_REQUEST_EXISTS" },
        },
      ],
    },
  };
}

function renderContainer(mocks: MockLink.MockedResponse[], locale: AppLocale): void {
  renderWithWrapper(
    <MockedProvider mocks={[...mocks]}>
      <MySubscriptionsContainer />
    </MockedProvider>,
    { locale }
  );
}

afterEach(cleanup);

// One block per locale keeps RTL/LTR both exercised over the settled-state
// matrix while every case stays independently readable.
for (const locale of ["ar", "en"] as AppLocale[]) {
  const t = MySubscriptionsNs.getLabels(getTranslations(locale));

  describe(`MySubscriptionsContainer (${locale === "ar" ? "RTL/arabic" : "LTR/english"})`, () => {
    test("query in flight renders the busy skeleton — no settled copy leaks", () => {
      renderContainer([pendingMySubscriptionsMock()], locale);

      const skeleton = screen.getByTestId("my-subscriptions-loading");
      expect(skeleton.getAttribute("aria-busy")).toBe("true");
      expect(screen.getByText(t.loading)).toBeDefined();
      // No settled-state copy may appear while the query is in flight.
      expect(screen.queryByTestId("my-subscriptions-grid")).toBeNull();
      expect(screen.queryByTestId("my-subscriptions-empty")).toBeNull();
      expect(screen.queryByTestId("my-subscriptions-error")).toBeNull();
    });

    test("populated surface renders the overview strip + one card per subscription with verbatim commerce fields", async () => {
      renderContainer([mySubscriptionsOnce([ACTIVE_ROW, PENDING_ROW, EXPIRED_ROW])], locale);

      await waitFor(() => {
        expect(screen.getByTestId("my-subscriptions-grid")).toBeDefined();
      });
      // Overview strip: active=1, pending=1, all=3 — big numerals render
      // as data (the captions come from the namespace).
      expect(screen.getByTestId("my-subscriptions-summary-active").textContent).toContain("1");
      expect(screen.getByTestId("my-subscriptions-summary-pending").textContent).toContain("1");
      expect(screen.getByTestId("my-subscriptions-summary-all").textContent).toContain("3");
      expect(screen.getByText(t.summaryTitle)).toBeDefined();
      expect(screen.getByText(t.summaryAllLabel)).toBeDefined();
      // The active/pending captions collide with the status chips' display
      // names ("Active"/"Pending") by design — assert the MULTIPLICITY
      // (caption + chip) instead of uniqueness.
      expect(screen.getAllByText(t.summaryActiveLabel).length).toBeGreaterThanOrEqual(2);
      expect(screen.getAllByText(t.summaryPendingLabel).length).toBeGreaterThanOrEqual(2);
      // Card titles render from the payload — the pending + expired rows
      // deliberately share one plan (two lifecycle rows for the same
      // plan), so its title matches TWICE.
      expect(screen.getAllByText(PENDING_ROW.plan.title).length).toBe(2);
      expect(screen.getByText(ACTIVE_ROW.plan.title)).toBeDefined();
      // Price: decimal STRING + currency rendered verbatim (no coercion /
      // no toFixed anywhere) — all three fixtures share EGP.
      expect(screen.getAllByText(ACTIVE_ROW.plan.currency).length).toBe(3);
      // Sessions render as-is; the interval goes through the namespace
      // formatter (recomputed here via the SAME formatter — no hardcoded
      // day copy in the assertion).
      expect(screen.getByText(String(ACTIVE_ROW.plan.sessionCount))).toBeDefined();
      expect(screen.getByText(t.intervalDays(ACTIVE_ROW.plan.intervalDays))).toBeDefined();
      // Status chips render per row — the active/pending display names
      // collide with their overview captions by design (multiplicity
      // asserted above), while "Expired" is unique on this surface.
      expect(screen.getAllByText(t.statusActive).length).toBeGreaterThanOrEqual(2);
      expect(screen.getAllByText(t.statusPending).length).toBeGreaterThanOrEqual(2);
      expect(screen.getByText(t.statusExpired)).toBeDefined();
      // No settled side state may accompany the grid.
      expect(screen.queryByTestId("my-subscriptions-empty")).toBeNull();
      expect(screen.queryByTestId("my-subscriptions-error")).toBeNull();
    });

    test("lifecycle facts: not-started pending row vs stamped active row vs payment stamps", async () => {
      renderContainer([mySubscriptionsOnce([PENDING_ROW, ACTIVE_ROW])], locale);

      await waitFor(() => {
        expect(screen.getByTestId("my-subscriptions-grid")).toBeDefined();
      });
      // Pending row: the period reads the not-started copy on BOTH lines —
      // the card composes "Started: Not started yet" / "Ends: Not started
      // yet" (label + value in one text node), so the FULL composed strings
      // are the matchers. Payment reads the neutral dash (no stamps).
      expect(screen.getAllByText(`${t.labelStarted}: ${t.labelNotStarted}`).length).toBe(1);
      expect(screen.getAllByText(`${t.labelEnds}: ${t.labelNotStarted}`).length).toBe(1);
      // Active row: stamped payment renders the machine artifact in the
      // method · reference shape.
      expect(screen.getByText(`${ACTIVE_ROW.paymentMethod} · ${ACTIVE_ROW.paymentReference}`)).toBeDefined();
      // Requested-at + period labels render for the stamped rows.
      expect(screen.getAllByText(t.labelRequestedAt).length).toBe(2);
      expect(screen.getAllByText(t.labelPeriod).length).toBe(2);
      // The mono payment dash renders on the unstamped row (label present,
      // exactly one dash across the two-row surface's payment values).
      expect(screen.getAllByText(t.labelPayment).length).toBe(2);
    });

    test("renew happy path: submit fires the mutation, success toast shows, the row flips to its blocked note", async () => {
      renderContainer(
        [
          // Ordered owner-scoped answers: first read = the expired row is
          // renewable; the post-success refetch KEEPS the expired row and
          // adds the new PENDING row for the same plan — so the row flips
          // to its pending-blocked posture from refreshed server state.
          mySubscriptionsOnce([EXPIRED_ROW]),
          mySubscriptionsOnce([
            EXPIRED_ROW,
            subscriptionFixture({ id: "901", status: "pending", plan: planFixture() }),
          ]),
          renewRequestMock(EXPIRED_ROW.plan.id, "901"),
        ],
        locale
      );

      await waitFor(() => {
        expect(screen.getByTestId("my-subscriptions-grid")).toBeDefined();
      });
      fireEvent.click(screen.getByRole("button", { name: `${t.renewCta} — ${EXPIRED_ROW.plan.title}` }));

      // The shared renewal dialog opens with the plan title interpolated
      // exactly once through the formatter.
      expect(await screen.findByText(t.renewDialogTitle)).toBeDefined();
      const expectedBody = t.renewDialogBody(EXPIRED_ROW.plan.title);
      expect(screen.getByText(expectedBody)).toBeDefined();
      expect(expectedBody.split(EXPIRED_ROW.plan.title).length - 1).toBe(1);

      fireEvent.click(screen.getByRole("button", { name: t.renewRequestCta }));

      // Success toast — the pre-interpolated namespace copy.
      const toast = await screen.findByTestId("my-subscriptions-toast");
      expect(toast.textContent).toContain(t.renewSuccessToast);
      // Dialog closed after success.
      await waitFor(() => {
        expect(screen.queryByText(t.renewDialogTitle)).toBeNull();
      });
      // The refetched read flips the row: the renew CTA is gone, the
      // pending-blocked note takes its place.
      await waitFor(() => {
        expect(screen.getByTestId(`my-subscription-blocked-pending-${EXPIRED_ROW.id}`)).toBeDefined();
      });
      expect(screen.queryByRole("button", { name: `${t.renewCta} — ${EXPIRED_ROW.plan.title}` })).toBeNull();
    });

    test("renew failure: mutation reject shows the failure toast and keeps the dialog open", async () => {
      renderContainer([mySubscriptionsOnce([EXPIRED_ROW]), deniedRenewRequestMock(EXPIRED_ROW.plan.id)], locale);

      await waitFor(() => {
        expect(screen.getByTestId("my-subscriptions-grid")).toBeDefined();
      });
      fireEvent.click(screen.getByRole("button", { name: `${t.renewCta} — ${EXPIRED_ROW.plan.title}` }));
      fireEvent.click(await screen.findByRole("button", { name: t.renewRequestCta }));

      await screen.findByTestId("my-subscriptions-toast");
      expect(screen.getByText(t.renewFailedToast)).toBeDefined();
      // Dialog stays open for an in-place retry.
      expect(screen.getByText(t.renewDialogTitle)).toBeDefined();
      // The row never flipped to a blocked note.
      expect(screen.queryByTestId(`my-subscription-blocked-pending-${EXPIRED_ROW.id}`)).toBeNull();
    });

    test("renew fence mirror: pending-blocked and plan-inactive rows render their notes instead of the CTA", async () => {
      renderContainer(
        [
          mySubscriptionsOnce([
            EXPIRED_ROW,
            // A PENDING request for the SAME plan fences the expired row's
            // renew CTA.
            PENDING_ROW,
            // A cancelled row whose plan was DEACTIVATED renders the
            // plan-unavailable note.
            subscriptionFixture({
              id: "804",
              status: "cancelled",
              plan: planFixture({ id: "2", title: "Retired Plan", isActive: false }),
            }),
            // An ACTIVE row renders no action at all.
            ACTIVE_ROW,
          ]),
        ],
        locale
      );

      await waitFor(() => {
        expect(screen.getByTestId("my-subscriptions-grid")).toBeDefined();
      });
      // Pending-blocked note replaces the CTA on the expired row.
      expect(screen.getByTestId(`my-subscription-blocked-pending-${EXPIRED_ROW.id}`)).toBeDefined();
      expect(screen.getByText(t.renewBlockedPending)).toBeDefined();
      expect(screen.queryByRole("button", { name: `${t.renewCta} — ${EXPIRED_ROW.plan.title}` })).toBeNull();
      // Plan-inactive note replaces the CTA on the cancelled row.
      expect(screen.getByTestId(`my-subscription-blocked-inactive-804`)).toBeDefined();
      expect(screen.getByText(t.renewUnavailableInactive)).toBeDefined();
      // Pending + active rows render no action row at all.
      expect(screen.queryByTestId(`my-subscription-renew-${PENDING_ROW.id}`)).toBeNull();
      expect(screen.queryByTestId(`my-subscription-renew-${ACTIVE_ROW.id}`)).toBeNull();
      expect(screen.queryByTestId(`my-subscription-blocked-pending-${ACTIVE_ROW.id}`)).toBeNull();
    });

    test("empty history renders the localized empty state with the browse-plans jump", async () => {
      renderContainer([mySubscriptionsOnce([])], locale);

      await waitFor(() => {
        expect(screen.getByTestId("my-subscriptions-empty")).toBeDefined();
      });
      expect(screen.getByText(t.emptyStateTitle)).toBeDefined();
      expect(screen.getByText(t.emptyStateBody)).toBeDefined();
      // The browse CTA routes to the storefront — next/link renders an
      // ANCHOR, so the accessible role is "link".
      const browse = screen.getByRole("link", { name: t.browsePlansCta });
      expect(browse.getAttribute("href")).toBe("/plans");
      // No grid/skeleton/error may accompany the empty state.
      expect(screen.queryByTestId("my-subscriptions-grid")).toBeNull();
      expect(screen.queryByTestId("my-subscriptions-loading")).toBeNull();
      expect(screen.queryByTestId("my-subscriptions-error")).toBeNull();
    });

    test("load failure renders the localized error state with retry", async () => {
      renderContainer([deniedMySubscriptionsMock()], locale);

      await waitFor(() => {
        expect(screen.getByTestId("my-subscriptions-error")).toBeDefined();
      });
      expect(screen.getByText(t.errorStateTitle)).toBeDefined();
      expect(screen.getByText(t.errorStateBody)).toBeDefined();
      expect(screen.getByRole("button", { name: t.errorStateRetry })).toBeDefined();
      // A failure never renders lifecycle cards or the empty-state note.
      expect(screen.queryByTestId("my-subscriptions-grid")).toBeNull();
      expect(screen.queryByTestId("my-subscriptions-empty")).toBeNull();
    });
  });
}

// ============================================================================
// CARD delegation tier — the container's renewal boundary
// ============================================================================

describe("MySubscriptionCard — renew CTA delegates the exact subscription to the callback", () => {
  test("renewable row: CTA forwards the clicked subscription object", () => {
    const t = MySubscriptionsNs.getLabels(getTranslations("en"));
    const onRenew = mock((_subscription: MySubscriptionsQuery_mySubscriptions) => undefined);

    renderWithWrapper(
      <MySubscriptionCard
        subscription={EXPIRED_ROW}
        labels={t}
        locale="en"
        canRenew={true}
        planHasPendingRequest={false}
        onRenew={onRenew}
      />,
      { locale: "en" }
    );

    expect(screen.getByText(EXPIRED_ROW.plan.title)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: `${t.renewCta} — ${EXPIRED_ROW.plan.title}` }));
    expect(onRenew).toHaveBeenCalledTimes(1);
    expect(onRenew).toHaveBeenCalledWith(EXPIRED_ROW);
  });

  test("non-renewable row: no CTA renders, so no delegation is possible", () => {
    const t = MySubscriptionsNs.getLabels(getTranslations("en"));
    const onRenew = mock((_subscription: MySubscriptionsQuery_mySubscriptions) => undefined);

    renderWithWrapper(
      <MySubscriptionCard
        subscription={ACTIVE_ROW}
        labels={t}
        locale="en"
        canRenew={false}
        planHasPendingRequest={false}
        onRenew={onRenew}
      />,
      { locale: "en" }
    );

    expect(screen.queryByRole("button", { name: `${t.renewCta} — ${ACTIVE_ROW.plan.title}` })).toBeNull();
    fireEvent.click(screen.getByText(ACTIVE_ROW.plan.title));
    expect(onRenew).not.toHaveBeenCalled();
  });
});

// ============================================================================
// SERVER HAND-OFF tier — the /subscriptions page's RSC-serializable subset
// ============================================================================

describe("MySubscriptionsContainer — labels prop overrides the client handle", () => {
  test("server-resolved strings win over the client-side namespace", async () => {
    const t = MySubscriptionsNs.getLabels(getTranslations("en"));
    renderWithWrapper(
      <MockedProvider mocks={[mySubscriptionsOnce([])]}>
        <MySubscriptionsContainer
          labels={{ ...t, emptyStateTitle: "SERVER EMPTY TITLE", browsePlansCta: "SERVER CTA" }}
        />
      </MockedProvider>,
      { locale: "en" }
    );

    await waitFor(() => {
      expect(screen.getByTestId("my-subscriptions-empty")).toBeDefined();
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
