/**
 * AdminSubscriptionsContainer + AdminSubscriptionCard + CancelSubscriptionDialog
 * — component suite (admin /admin/subscriptions lifecycle manager, DEV1-009).
 *
 * Happy DOM + Apollo `MockedProvider` tier (`test/ui/components`): the
 * container's settled-state matrix is rendered across BOTH locales (Arabic
 * RTL first — the app's default), with the lifecycle data supplied by
 * `adminSubscriptions` mocks carrying FUNCTION variable matchers exactly as
 * the container issues them (the container ALWAYS sends the full variable
 * set; undefined-valued keys must not gate the match):
 *
 *   skeleton (in flight) · populated grid · empty list · load failure + retry
 *
 * DEV1-009 cancel-flow cells (single locale — the settled matrix already
 * covers both):
 *  - CANCEL HAPPY PATH — CTA (active row only) → dialog interpolates BOTH
 *    body arguments (subscriber + plan title) → confirm fires the mutation →
 *    success toast + dialog closes + refetch (ordered mocks carry the
 *    post-cancellation state) → the row flips to cancelled FROM THE SERVER
 *    READ and its CTA disappears;
 *  - CANCEL FAILURE — mutation rejects → failure toast, dialog stays open
 *    for a retry in place.
 *
 * Filter + pagination cells (draft→applied→variables discipline, mirroring
 * the audit trail suite):
 *  - a draft chip select does NOTHING until Apply — then the follow-up
 *    query fires with `status` + `offset: 0`; "All" strips the status to
 *    `undefined`;
 *  - pagination derives from the SERVER total: 12 rows at page size 10 →
 *    page 2 shows items 11–12 and Next disables at the end page.
 *
 * Translation discipline (mirrors `PaymentVerificationContainer.test.tsx`):
 * assertions reference ONLY label objects resolved through
 * `SubscriptionManagement.getLabels(getTranslations(locale))` — zero
 * hardcoded Arabic/English UI copy. Fixture data (ASCII names/emails,
 * price strings, ISO stamps, machine codes) is test-owned payload, not UI
 * copy.
 */

import { afterEach, describe, expect, test } from "bun:test";
import type { MockLink } from "@apollo/client/testing";
import { MockedProvider } from "@apollo/client/testing/react";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import type { AdminSubscriptionsQuery_adminSubscriptions_items } from "@/frontend/graphql/generated/gql/graphql";
import {
  adminCancelSubscriptionMutationDocument,
  adminSubscriptionsQueryDocument,
} from "@/frontend/graphql/sharedDocuments";
import { AdminSubscriptionsContainer } from "@/frontend/views/admin/subscriptions";
import type { AppLocale } from "@/shared/locale/AppLocale";
import { SubscriptionManagement as SubscriptionManagementNs } from "@/shared/locale/namespaces/subscriptionManagement";
import { getTranslations } from "@/shared/locale/server";
import { renderWithWrapper } from "@/test/ui/components/TestWrapper";

// ----------------------------------------------------------------------------
// Fixtures + mocks
// ----------------------------------------------------------------------------

/** Fixed page size — mirrors the container's own constant (not exported). */
const PAGE_SIZE = 10;

/** Deterministic lifecycle-row builder mirroring the wire selection. */
function subscriptionFixture(
  overrides?: Partial<AdminSubscriptionsQuery_adminSubscriptions_items>
): AdminSubscriptionsQuery_adminSubscriptions_items {
  return {
    id: "701",
    status: "active",
    plan: {
      id: "1",
      title: "Hifz Jadid — Full Memorization Plan",
      sessionCount: 8,
      price: "250.00",
      currency: "EGP",
      intervalDays: 30,
      isActive: true,
    },
    user: {
      id: "77",
      fullName: "Yusuf Buyer",
      email: "yusuf.buyer@test.local",
    },
    startDate: "2026-02-10T12:00:00.000Z",
    endDate: "2026-03-12T12:00:00.000Z",
    paymentMethod: "offline_cash",
    paymentReference: "RCPT-001",
    paymentVerifiedAt: "2026-02-10T12:00:00.000Z",
    createdAt: "2026-02-01T09:00:00.000Z",
    updatedAt: "2026-02-10T12:00:00.000Z",
    ...overrides,
  };
}

const ACTIVE_ROW = subscriptionFixture();
const CANCELLED_ROW = subscriptionFixture({
  id: "702",
  status: "cancelled",
  plan: {
    id: "2",
    title: "Tajweed Mastery",
    sessionCount: 4,
    price: "150.00",
    currency: "EGP",
    intervalDays: 14,
    isActive: true,
  },
  user: { id: "78", fullName: "Ibrahim Applicant", email: "ibrahim@test.local" },
  startDate: null,
  endDate: null,
  paymentMethod: null,
  paymentReference: null,
  paymentVerifiedAt: null,
});
const PENDING_ROW = subscriptionFixture({
  id: "703",
  status: "pending",
  plan: {
    id: "3",
    title: "Muraja'ah Review Plan",
    sessionCount: 6,
    price: "180.00",
    currency: "EGP",
    intervalDays: 30,
    isActive: true,
  },
  user: { id: "79", fullName: "Salma Requester", email: "salma@test.local" },
  startDate: null,
  endDate: null,
  paymentMethod: null,
  paymentReference: null,
  paymentVerifiedAt: null,
});

/**
 * `adminSubscriptions` mock answering with the page envelope for the given
 * totals. The variable matcher matches on the pagination/filter envelope
 * only — the container always sends the full variable set with
 * undefined-valued optional keys, and a value-equality match would gate on
 * those keys.
 */
function pageMock(
  items: AdminSubscriptionsQuery_adminSubscriptions_items[],
  total: number,
  variables: { status?: string; offset: number } = { offset: 0 }
): MockLink.MockedResponse {
  return {
    request: {
      query: adminSubscriptionsQueryDocument,
      variables: vars =>
        (vars.status ?? undefined) === variables.status &&
        (vars.limit ?? undefined) === PAGE_SIZE &&
        (vars.offset ?? undefined) === variables.offset,
    },
    result: {
      data: {
        adminSubscriptions: {
          items,
          total,
          limit: PAGE_SIZE,
          offset: variables.offset,
          __typename: "AdminSubscriptionConnection",
        },
      },
    },
  };
}

/** Permanently in-flight mock (MockLink never settles `delay: Infinity`). */
function pendingPageMock(): MockLink.MockedResponse {
  return { request: { query: adminSubscriptionsQueryDocument }, delay: Infinity };
}

/** Scoped-deny mock — matches ANY variable envelope, authored exactly where
 * the transport puts `extensions.code`. The function matcher is required:
 * the container sends the FULL variable set (undefined-valued optional
 * filters included), which value-equality against `{}` would reject. */
function deniedPageMock(): MockLink.MockedResponse {
  return {
    request: { query: adminSubscriptionsQueryDocument, variables: () => true },
    result: {
      errors: [{ message: "FORBIDDEN (masked transport surface)", extensions: { code: "FORBIDDEN" } }],
    },
  };
}

/** `adminCancelSubscription` mock resolving with the CANCELLED row
 * (payment stamps PRESERVED — no history rewrite). */
function cancelMock(
  subscriptionId: string,
  cancelled: AdminSubscriptionsQuery_adminSubscriptions_items
): MockLink.MockedResponse {
  return {
    request: { query: adminCancelSubscriptionMutationDocument, variables: { subscriptionId } },
    result: { data: { adminCancelSubscription: cancelled } },
  };
}

/** `adminCancelSubscription` mock rejecting with a localized domain conflict. */
function deniedCancelMock(subscriptionId: string): MockLink.MockedResponse {
  return {
    request: { query: adminCancelSubscriptionMutationDocument, variables: { subscriptionId } },
    result: {
      errors: [
        {
          message: "SUBSCRIPTION_ALREADY_RESOLVED (localized transport surface)",
          extensions: { code: "SUBSCRIPTION_ALREADY_RESOLVED" },
        },
      ],
    },
  };
}

function renderContainer(mocks: MockLink.MockedResponse[], locale: AppLocale): void {
  renderWithWrapper(
    <MockedProvider mocks={[...mocks]}>
      <AdminSubscriptionsContainer />
    </MockedProvider>,
    { locale }
  );
}

afterEach(cleanup);

// One block per locale keeps RTL/LTR both exercised over the settled-state
// matrix while every case stays independently readable.
for (const locale of ["ar", "en"] as AppLocale[]) {
  const t = SubscriptionManagementNs.getLabels(getTranslations(locale));

  describe(`AdminSubscriptionsContainer — settled states (${locale === "ar" ? "RTL/arabic" : "LTR/english"})`, () => {
    test("query in flight renders the busy skeleton — no settled copy leaks", () => {
      renderContainer([pendingPageMock()], locale);

      const skeleton = screen.getByTestId("admin-subscriptions-loading");
      expect(skeleton.getAttribute("aria-busy")).toBe("true");
      expect(screen.getByText(t.loading)).toBeDefined();
      expect(screen.queryByTestId("admin-subscriptions-grid")).toBeNull();
      expect(screen.queryByTestId("admin-subscriptions-empty")).toBeNull();
      expect(screen.queryByTestId("admin-subscriptions-error")).toBeNull();
    });

    test("populated grid renders subscriber DATA rows, verbatim price, localized chips, and CTAs only on cancellable rows", async () => {
      renderContainer([pageMock([ACTIVE_ROW, CANCELLED_ROW], 2)], locale);

      await waitFor(() => {
        expect(screen.getByTestId("admin-subscriptions-grid")).toBeDefined();
      });
      // Subscriber identity is DATA (name + email), never interpolated copy.
      expect(screen.getByText(ACTIVE_ROW.user.fullName)).toBeDefined();
      expect(screen.getByText(ACTIVE_ROW.user.email)).toBeDefined();
      // Decimal STRING verbatim — no numeric coercion.
      expect(screen.getByText(ACTIVE_ROW.plan.price)).toBeDefined();
      // The plan titles ride the card headers.
      expect(screen.getByText(ACTIVE_ROW.plan.title)).toBeDefined();
      expect(screen.getByText(CANCELLED_ROW.plan.title)).toBeDefined();
      // Status chips localize the machine code (filter keys double as the
      // chip display vocabulary).
      expect(screen.getByTestId(`admin-subscription-status-${ACTIVE_ROW.id}`).textContent).toBe(t.filterActive);
      expect(screen.getByTestId(`admin-subscription-status-${CANCELLED_ROW.id}`).textContent).toBe(t.filterCancelled);
      // The cancel CTA exists ONLY on the cancellable (active) row — the
      // terminal (cancelled) row renders none at all.
      expect(screen.getByTestId(`admin-subscription-cancel-${ACTIVE_ROW.id}`)).toBeDefined();
      expect(screen.queryByTestId(`admin-subscription-cancel-${CANCELLED_ROW.id}`)).toBeNull();
      // The truthful pagination window: 1–2 of 2.
      expect(screen.getByText(t.pageInfo(1, 2, 2))).toBeDefined();
    });

    test("empty list renders the localized empty state", async () => {
      renderContainer([pageMock([], 0)], locale);

      await waitFor(() => {
        expect(screen.getByTestId("admin-subscriptions-empty")).toBeDefined();
      });
      expect(screen.getByText(t.emptyStateTitle)).toBeDefined();
      expect(screen.getByText(t.emptyStateBody)).toBeDefined();
      expect(screen.queryByTestId("admin-subscriptions-grid")).toBeNull();
    });

    test("load failure renders the localized error state and retry refetches", async () => {
      renderContainer([deniedPageMock(), pageMock([ACTIVE_ROW], 1)], locale);

      await waitFor(() => {
        expect(screen.getByTestId("admin-subscriptions-error")).toBeDefined();
      });
      expect(screen.getByText(t.errorStateTitle)).toBeDefined();

      fireEvent.click(screen.getByText(t.errorStateRetry));
      await waitFor(() => {
        expect(screen.getByTestId("admin-subscriptions-grid")).toBeDefined();
      });
    });
  });
}

// ----------------------------------------------------------------------------
// Cancel flow (en) — dialog interpolation + mutation + toasts + refetch
// ----------------------------------------------------------------------------

describe("AdminSubscriptionsContainer — cancel flow (en)", () => {
  const t = SubscriptionManagementNs.getLabels(getTranslations("en"));

  test("happy path: dialog interpolates BOTH arguments → confirm → success toast + dialog closes + refetch flips the row", async () => {
    const cancelledActive = { ...ACTIVE_ROW, status: "cancelled" };
    renderContainer(
      [
        pageMock([ACTIVE_ROW, CANCELLED_ROW], 2),
        cancelMock(ACTIVE_ROW.id, cancelledActive),
        // The refetch — the row flips to cancelled from REAL server state.
        pageMock([cancelledActive, CANCELLED_ROW], 2),
      ],
      "en"
    );

    await waitFor(() => {
      expect(screen.getByTestId(`admin-subscription-cancel-${ACTIVE_ROW.id}`)).toBeDefined();
    });

    fireEvent.click(screen.getByTestId(`admin-subscription-cancel-${ACTIVE_ROW.id}`));

    // Dialog up: the interpolated body carries BOTH sentinels — subscriber
    // name AND plan title (the parity-locked two-argument formatter).
    await waitFor(() => {
      expect(screen.getByTestId("admin-cancel-body")).toBeDefined();
    });
    expect(screen.getByText(t.cancelDialogBody(ACTIVE_ROW.user.fullName, ACTIVE_ROW.plan.title))).toBeDefined();
    expect(screen.getByText(t.cancelDialogTitle)).toBeDefined();

    fireEvent.click(screen.getByTestId("admin-cancel-confirm"));

    // Success toast + dialog closed.
    await waitFor(() => {
      expect(screen.getByTestId("admin-subscriptions-toast").textContent).toBe(t.cancelSuccessToast);
    });
    await waitFor(() => {
      expect(screen.queryByTestId("admin-cancel-body")).toBeNull();
    });
    // The REFETCHED row: same card, cancelled chip, NO cancel CTA anymore.
    await waitFor(() => {
      expect(screen.getByTestId(`admin-subscription-status-${ACTIVE_ROW.id}`).textContent).toBe(t.filterCancelled);
    });
    expect(screen.queryByTestId(`admin-subscription-cancel-${ACTIVE_ROW.id}`)).toBeNull();
  });

  test("cancel failure: rejection toasts the failure copy and keeps the dialog open for retry", async () => {
    renderContainer([pageMock([ACTIVE_ROW], 1), deniedCancelMock(ACTIVE_ROW.id)], "en");

    await waitFor(() => {
      expect(screen.getByTestId(`admin-subscription-cancel-${ACTIVE_ROW.id}`)).toBeDefined();
    });
    fireEvent.click(screen.getByTestId(`admin-subscription-cancel-${ACTIVE_ROW.id}`));
    await waitFor(() => {
      expect(screen.getByTestId("admin-cancel-body")).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("admin-cancel-confirm"));

    await waitFor(() => {
      expect(screen.getByTestId("admin-subscriptions-toast").textContent).toBe(t.cancelFailedToast);
    });
    // Dialog stays OPEN — the admin retries in place.
    expect(screen.getByTestId("admin-cancel-body")).toBeDefined();
    expect(screen.getByText(t.cancelDialogBody(ACTIVE_ROW.user.fullName, ACTIVE_ROW.plan.title))).toBeDefined();
  });

  test("dismiss keeps the subscription and closes the dialog without firing the mutation", async () => {
    renderContainer([pageMock([ACTIVE_ROW], 1)], "en");

    await waitFor(() => {
      expect(screen.getByTestId(`admin-subscription-cancel-${ACTIVE_ROW.id}`)).toBeDefined();
    });
    fireEvent.click(screen.getByTestId(`admin-subscription-cancel-${ACTIVE_ROW.id}`));
    await waitFor(() => {
      expect(screen.getByTestId("admin-cancel-body")).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("admin-cancel-dismiss"));
    await waitFor(() => {
      expect(screen.queryByTestId("admin-cancel-body")).toBeNull();
    });
    // The card is still there, still active, and NO toast fired (dismiss
    // never mutates — the suite ships no cancel mock for this render).
    expect(screen.getByTestId(`admin-subscription-card-${ACTIVE_ROW.id}`)).toBeDefined();
    expect(screen.getByTestId(`admin-subscription-status-${ACTIVE_ROW.id}`).textContent).toBe(t.filterActive);
    expect(screen.queryByTestId("admin-subscriptions-toast")).toBeNull();
  });
});

// ----------------------------------------------------------------------------
// Filter flow (draft → applied → variables) + pagination (en)
// ----------------------------------------------------------------------------

describe("AdminSubscriptionsContainer — filter + pagination (en)", () => {
  const t = SubscriptionManagementNs.getLabels(getTranslations("en"));

  test("a draft chip select stays draft until Apply — then the query fires with the status and a reset offset", async () => {
    renderContainer(
      [
        pageMock([ACTIVE_ROW, CANCELLED_ROW], 2),
        pageMock([PENDING_ROW], 1, { status: "pending", offset: 0 }),
        pageMock([ACTIVE_ROW, CANCELLED_ROW], 2),
      ],
      "en"
    );

    await waitFor(() => {
      expect(screen.getByTestId("admin-subscriptions-grid")).toBeDefined();
    });

    // Draft only — selecting the Pending chip fires NO query (the only
    // pending mock is still unconsumed; a premature query would surface it).
    fireEvent.click(screen.getByRole("button", { name: t.filterPending }));
    expect(screen.getByText(ACTIVE_ROW.user.fullName)).toBeDefined();

    // Apply commits the draft — the filtered page replaces the grid.
    fireEvent.click(screen.getByTestId("admin-subscriptions-apply"));
    await waitFor(() => {
      expect(screen.getByText(PENDING_ROW.user.fullName)).toBeDefined();
    });
    expect(screen.queryByText(ACTIVE_ROW.user.fullName)).toBeNull();

    // "All" resets the status to undefined — the third mock answers.
    fireEvent.click(screen.getByRole("button", { name: t.filterAll }));
    fireEvent.click(screen.getByTestId("admin-subscriptions-apply"));
    await waitFor(() => {
      expect(screen.getByText(ACTIVE_ROW.user.fullName)).toBeDefined();
    });
    expect(screen.getByText(CANCELLED_ROW.user.fullName)).toBeDefined();
  });

  test("pagination derives from the SERVER total — page 2 shows items 11–12 and Next disables at the end", async () => {
    const pageOne = Array.from({ length: PAGE_SIZE }, (_, index) =>
      subscriptionFixture({
        id: String(800 + index),
        user: {
          id: String(900 + index),
          fullName: `Subscriber ${index + 1}`,
          email: `subscriber${index + 1}@test.local`,
        },
      })
    );
    const pageTwo = [
      subscriptionFixture({
        id: "810",
        user: { id: "910", fullName: "Subscriber 11", email: "subscriber11@test.local" },
      }),
      subscriptionFixture({
        id: "811",
        user: { id: "911", fullName: "Subscriber 12", email: "subscriber12@test.local" },
      }),
    ];
    renderContainer([pageMock(pageOne, 12), pageMock(pageTwo, 12, { offset: PAGE_SIZE })], "en");

    await waitFor(() => {
      expect(screen.getByTestId("admin-subscriptions-grid")).toBeDefined();
    });
    expect(screen.getByText(t.pageInfo(1, PAGE_SIZE, 12))).toBeDefined();
    expect(screen.getByText("Subscriber 1")).toBeDefined();

    const next = screen.getByTestId("admin-subscriptions-next");
    const prev = screen.getByTestId("admin-subscriptions-prev");
    expect((next as HTMLButtonElement).disabled).toBe(false);
    expect((prev as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(next);

    await waitFor(() => {
      expect(screen.getByText(t.pageInfo(11, 12, 12))).toBeDefined();
    });
    expect(screen.getByText("Subscriber 11")).toBeDefined();
    expect(screen.getByText("Subscriber 12")).toBeDefined();
    expect((screen.getByTestId("admin-subscriptions-next") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("admin-subscriptions-prev") as HTMLButtonElement).disabled).toBe(false);
  });
});
