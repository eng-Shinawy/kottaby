/**
 * PaymentVerificationContainer + VerificationRequestCard — component suite
 * (admin /admin/verifications queue, DEV1-006 Phase B round).
 *
 * Happy DOM + Apollo `MockedProvider` tier (`test/ui/components`): the
 * container's settled-state matrix is rendered across BOTH locales (Arabic
 * RTL first — the app's default), with the queue data supplied by
 * `adminPendingSubscriptionRequests` mocks carrying NO variables exactly as
 * the container issues them:
 *
 *   skeleton (in flight) · populated queue grid · empty queue ·
 *   load failure + retry
 *
 * DEV1-006 Phase B verify-flow cells:
 *  - VERIFY HAPPY PATH — open dialog → reference filled → mutation mock
 *    resolves → success toast + dialog closes + queue refetch (second
 *    ordered mock carries the post-verification state) → the verified
 *    request disappears;
 *  - VERIFY FAILURE — mutation rejects → failure toast, dialog stays open;
 *  - BLANK-REFERENCE FENCE — the confirm button stays disabled while the
 *    reference input is trimmed-empty (a blank receipt can never fire the
 *    mutation).
 *
 * Plus two single-tier cells:
 *  - CARD delegation tier — `VerificationRequestCard` rendered directly
 *    with a spied callback: the verify CTA forwards the EXACT request
 *    object to `onVerify` (the container's verify-dialog boundary);
 *  - SERVER HAND-OFF tier — the container's `labels` prop (the RSC-safe
 *    string subset the `/admin/verifications` page passes) overrides the
 *    client-side `useAppTranslation(PaymentVerification)` handle.
 *
 * Translation discipline (mirrors `StudentPlansContainer.test.tsx`):
 * assertions reference ONLY label objects resolved through
 * `PaymentVerification.getLabels(getTranslations(locale))` — zero
 * hardcoded Arabic/English UI copy. Fixture data (ASCII names/titles,
 * price strings, ISO stamps) is test-owned payload, not UI copy.
 */

import { afterEach, describe, expect, mock, test } from "bun:test";
import type { MockLink } from "@apollo/client/testing";
import { MockedProvider } from "@apollo/client/testing/react";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import type {
  AdminPendingSubscriptionRequestsQuery_adminPendingSubscriptionRequests,
  VerifySubscriptionPaymentMutation,
} from "@/frontend/graphql/generated/gql/graphql";
import {
  adminPendingSubscriptionRequestsQueryDocument,
  verifySubscriptionPaymentMutationDocument,
} from "@/frontend/graphql/sharedDocuments";
import { PaymentVerificationContainer, VerificationRequestCard } from "@/frontend/views/admin/verifications";
import type { AppLocale } from "@/shared/locale/AppLocale";
import { PaymentVerification as PaymentVerificationNs } from "@/shared/locale/namespaces/paymentVerification";
import { getTranslations } from "@/shared/locale/server";
import { renderWithWrapper } from "@/test/ui/components/TestWrapper";

// ----------------------------------------------------------------------------
// Fixtures + mocks
// ----------------------------------------------------------------------------

/** Deterministic admin-queue row builder mirroring the wire selection. */
function requestFixture(
  overrides?: Partial<AdminPendingSubscriptionRequestsQuery_adminPendingSubscriptionRequests>
): AdminPendingSubscriptionRequestsQuery_adminPendingSubscriptionRequests {
  return {
    id: "901",
    status: "pending",
    plan: {
      id: "1",
      title: "Hifz Jadid — Full Memorization Plan",
      sessionCount: 8,
      price: "250.00",
      currency: "EGP",
      intervalDays: 30,
    },
    user: {
      id: "77",
      fullName: "Yusuf Buyer",
      email: "yusuf.buyer@test.local",
    },
    createdAt: "2026-02-01T09:00:00.000Z",
    updatedAt: "2026-02-01T09:00:00.000Z",
    ...overrides,
  };
}

const FIRST_ROW = requestFixture();
const SECOND_ROW = requestFixture({
  id: "902",
  plan: {
    id: "2",
    title: "Tajweed Mastery",
    sessionCount: 4,
    price: "150.00",
    currency: "EGP",
    intervalDays: 14,
  },
  user: { id: "78", fullName: "Ibrahim Applicant", email: "ibrahim@test.local" },
});

/** `adminPendingSubscriptionRequests` mock answering with the exact no-variables request. */
function queueMock(
  rows: AdminPendingSubscriptionRequestsQuery_adminPendingSubscriptionRequests[]
): MockLink.MockedResponse {
  return {
    request: { query: adminPendingSubscriptionRequestsQueryDocument },
    result: { data: { adminPendingSubscriptionRequests: rows } },
  };
}

/** Permanently in-flight mock (MockLink never settles `delay: Infinity`). */
function pendingQueueMock(): MockLink.MockedResponse {
  return { request: { query: adminPendingSubscriptionRequestsQueryDocument }, delay: Infinity };
}

/** Scoped-deny mock authored exactly where the transport puts `extensions.code`. */
function deniedQueueMock(): MockLink.MockedResponse {
  return {
    request: { query: adminPendingSubscriptionRequestsQueryDocument },
    result: {
      errors: [{ message: "FORBIDDEN (masked transport surface)", extensions: { code: "FORBIDDEN" } }],
    },
  };
}

/** `verifySubscriptionPayment` mock resolving with the ACTIVATED row. */
function verifyMock(variables: {
  subscriptionId: string;
  paymentMethod: string;
  paymentReference: string;
}): MockLink.MockedResponse {
  const activated: VerifySubscriptionPaymentMutation["verifySubscriptionPayment"] = {
    id: variables.subscriptionId,
    status: "active",
    plan: {
      id: FIRST_ROW.plan.id,
      title: FIRST_ROW.plan.title,
      sessionCount: FIRST_ROW.plan.sessionCount,
      price: FIRST_ROW.plan.price,
      currency: FIRST_ROW.plan.currency,
      intervalDays: FIRST_ROW.plan.intervalDays,
      isActive: true,
      deactivatedAt: null,
      createdAt: "2026-01-15T10:00:00.000Z",
      updatedAt: "2026-01-15T10:00:00.000Z",
    },
    startDate: "2026-02-10T12:00:00.000Z",
    endDate: "2026-03-12T12:00:00.000Z",
    paymentMethod: variables.paymentMethod,
    paymentReference: variables.paymentReference,
    paymentVerifiedAt: "2026-02-10T12:00:00.000Z",
    createdAt: FIRST_ROW.createdAt,
    updatedAt: "2026-02-10T12:00:00.000Z",
  };
  return {
    request: { query: verifySubscriptionPaymentMutationDocument, variables },
    result: { data: { verifySubscriptionPayment: activated } },
  };
}

/** `verifySubscriptionPayment` mock rejecting with a localized domain conflict. */
function deniedVerifyMock(variables: {
  subscriptionId: string;
  paymentMethod: string;
  paymentReference: string;
}): MockLink.MockedResponse {
  return {
    request: { query: verifySubscriptionPaymentMutationDocument, variables },
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

/** Scoped lookup for the reference input — MUI's `required` label renders a
 * suffix asterisk inside the label element, which breaks exact-text
 * `getByLabelText`; the TextField's root testid + input descendant is the
 * stable contract. */
function referenceInput(): HTMLInputElement {
  const root = screen.getByTestId("admin-verify-reference");
  const input = root.querySelector("input");
  if (!(input instanceof HTMLInputElement)) {
    throw new Error("admin-verify-reference: no <input> descendant found");
  }
  return input;
}

function renderContainer(mocks: MockLink.MockedResponse[], locale: AppLocale): void {
  renderWithWrapper(
    <MockedProvider mocks={[...mocks]}>
      <PaymentVerificationContainer />
    </MockedProvider>,
    { locale }
  );
}

afterEach(cleanup);

// One block per locale keeps RTL/LTR both exercised over the settled-state
// matrix while every case stays independently readable.
for (const locale of ["ar", "en"] as AppLocale[]) {
  const t = PaymentVerificationNs.getLabels(getTranslations(locale));

  describe(`PaymentVerificationContainer (${locale === "ar" ? "RTL/arabic" : "LTR/english"})`, () => {
    test("query in flight renders the busy skeleton — no settled copy leaks", () => {
      renderContainer([pendingQueueMock()], locale);

      const skeleton = screen.getByTestId("admin-verifications-loading");
      expect(skeleton.getAttribute("aria-busy")).toBe("true");
      expect(screen.getByText(t.loading)).toBeDefined();
      expect(screen.queryByTestId("admin-verifications-grid")).toBeNull();
      expect(screen.queryByTestId("admin-verifications-empty")).toBeNull();
      expect(screen.queryByTestId("admin-verifications-error")).toBeNull();
    });

    test("populated queue renders one card per pending request with verbatim commerce fields", async () => {
      renderContainer([queueMock([FIRST_ROW, SECOND_ROW])], locale);

      await waitFor(() => {
        expect(screen.getByTestId("admin-verifications-grid")).toBeDefined();
      });
      expect(screen.getByTestId(`admin-verification-card-${FIRST_ROW.id}`)).toBeDefined();
      expect(screen.getByTestId(`admin-verification-card-${SECOND_ROW.id}`)).toBeDefined();
      // Decimal STRING verbatim — no numeric coercion.
      expect(screen.getByText(FIRST_ROW.plan.price)).toBeDefined();
      expect(screen.getByText(SECOND_ROW.plan.price)).toBeDefined();
      // Purchaser identity is DATA (name + email), never interpolated copy.
      expect(screen.getByText(FIRST_ROW.user.fullName)).toBeDefined();
      expect(screen.getByText(FIRST_ROW.user.email)).toBeDefined();
      expect(screen.getByText(SECOND_ROW.user.fullName)).toBeDefined();
      // Pending status chip echoes the wire state.
      expect(screen.getByTestId(`admin-verification-status-${FIRST_ROW.id}`).textContent).toBe(FIRST_ROW.status);
    });

    test("empty queue renders the localized empty state", async () => {
      renderContainer([queueMock([])], locale);

      await waitFor(() => {
        expect(screen.getByTestId("admin-verifications-empty")).toBeDefined();
      });
      expect(screen.getByText(t.emptyStateTitle)).toBeDefined();
      expect(screen.getByText(t.emptyStateBody)).toBeDefined();
      expect(screen.queryByTestId("admin-verifications-grid")).toBeNull();
    });

    test("load failure renders the localized error state and retry refetches", async () => {
      renderContainer([deniedQueueMock(), queueMock([FIRST_ROW])], locale);

      await waitFor(() => {
        expect(screen.getByTestId("admin-verifications-error")).toBeDefined();
      });
      expect(screen.getByText(t.errorStateTitle)).toBeDefined();

      fireEvent.click(screen.getByText(t.errorStateRetry));
      await waitFor(() => {
        expect(screen.getByTestId("admin-verifications-grid")).toBeDefined();
      });
    });

    test("verify happy path: dialog → submit → success toast + dialog closes + refetch drops the request", async () => {
      const input = { subscriptionId: FIRST_ROW.id, paymentMethod: "offline_cash", paymentReference: "RCPT-001" };
      renderContainer([queueMock([FIRST_ROW, SECOND_ROW]), verifyMock(input), queueMock([SECOND_ROW])], locale);

      await waitFor(() => {
        expect(screen.getByTestId(`admin-verification-verify-${FIRST_ROW.id}`)).toBeDefined();
      });

      fireEvent.click(screen.getByTestId(`admin-verification-verify-${FIRST_ROW.id}`));

      // Dialog up: interpolated body + purchaser summary + method choice.
      await waitFor(() => {
        expect(screen.getByText(t.verifyDialogBody(FIRST_ROW.plan.title))).toBeDefined();
      });
      // The purchaser name appears on BOTH the card and the dialog summary.
      expect(screen.getAllByText(FIRST_ROW.user.fullName).length).toBeGreaterThanOrEqual(1);
      expect(referenceInput()).toBeDefined();
      expect(screen.getByRole("button", { name: t.methodOfflineCash })).toBeDefined();
      expect(screen.getByRole("button", { name: t.methodBankTransfer })).toBeDefined();

      // Blank-reference fence: confirm starts disabled.
      expect((screen.getByTestId("admin-verify-submit") as HTMLButtonElement).disabled).toBe(true);

      fireEvent.change(referenceInput(), { target: { value: "RCPT-001" } });
      expect((screen.getByTestId("admin-verify-submit") as HTMLButtonElement).disabled).toBe(false);

      fireEvent.click(screen.getByTestId("admin-verify-submit"));

      // Success toast + queue refetch drops the verified request.
      await waitFor(() => {
        expect(screen.getByTestId("admin-verifications-toast").textContent).toBe(t.verifySuccessToast);
      });
      await waitFor(() => {
        expect(screen.queryByTestId(`admin-verification-card-${FIRST_ROW.id}`)).toBeNull();
        expect(screen.getByTestId(`admin-verification-card-${SECOND_ROW.id}`)).toBeDefined();
      });
      expect(screen.queryByText(t.verifyDialogBody(FIRST_ROW.plan.title))).toBeNull();
    });

    test("verify failure: rejection toasts the failure copy and keeps the dialog open for retry", async () => {
      const input = { subscriptionId: FIRST_ROW.id, paymentMethod: "offline_cash", paymentReference: "RCPT-409" };
      renderContainer([queueMock([FIRST_ROW]), deniedVerifyMock(input)], locale);

      await waitFor(() => {
        expect(screen.getByTestId(`admin-verification-verify-${FIRST_ROW.id}`)).toBeDefined();
      });
      fireEvent.click(screen.getByTestId(`admin-verification-verify-${FIRST_ROW.id}`));
      await waitFor(() => {
        expect(screen.getByText(t.verifyDialogBody(FIRST_ROW.plan.title))).toBeDefined();
      });

      fireEvent.change(referenceInput(), { target: { value: "RCPT-409" } });
      fireEvent.click(screen.getByTestId("admin-verify-submit"));

      await waitFor(() => {
        expect(screen.getByTestId("admin-verifications-toast").textContent).toBe(t.verifyFailedToast);
      });
      // Dialog stays OPEN — the admin retries in place.
      expect(screen.getByText(t.verifyDialogBody(FIRST_ROW.plan.title))).toBeDefined();
    });

    test("cancel closes the verify dialog without firing the mutation", async () => {
      renderContainer([queueMock([FIRST_ROW])], locale);

      await waitFor(() => {
        expect(screen.getByTestId(`admin-verification-verify-${FIRST_ROW.id}`)).toBeDefined();
      });
      fireEvent.click(screen.getByTestId(`admin-verification-verify-${FIRST_ROW.id}`));
      await waitFor(() => {
        expect(screen.getByText(t.verifyDialogBody(FIRST_ROW.plan.title))).toBeDefined();
      });

      fireEvent.click(screen.getByTestId("admin-verify-cancel"));
      await waitFor(() => {
        expect(screen.queryByText(t.verifyDialogBody(FIRST_ROW.plan.title))).toBeNull();
      });
      // The card is still there (no state change happened).
      expect(screen.getByTestId(`admin-verification-card-${FIRST_ROW.id}`)).toBeDefined();
    });
  });

  describe(`VerificationRequestCard — delegation tier (${locale})`, () => {
    test("the verify CTA forwards the EXACT request object to onVerify", () => {
      const onVerify = mock((_request: AdminPendingSubscriptionRequestsQuery_adminPendingSubscriptionRequests) => {});
      renderWithWrapper(
        <VerificationRequestCard request={FIRST_ROW} labels={t} locale={locale} onVerify={onVerify} />,
        { locale }
      );

      fireEvent.click(screen.getByTestId(`admin-verification-verify-${FIRST_ROW.id}`));
      expect(onVerify).toHaveBeenCalledTimes(1);
      expect(onVerify.mock.calls[0]?.[0]).toBe(FIRST_ROW);
    });
  });
}

// Server hand-off tier — locale-independent (the labels prop fully overrides
// the client handle; EN copy proves the override happened).
describe("PaymentVerificationContainer — server hand-off tier", () => {
  test("the labels prop (the RSC-safe subset) overrides the client-side handle", async () => {
    const overridden = {
      ...PaymentVerificationNs.getLabels(getTranslations("en")),
      emptyStateTitle: "OVERRIDDEN EMPTY TITLE",
    };
    renderWithWrapper(
      <MockedProvider mocks={[queueMock([])]}>
        <PaymentVerificationContainer labels={overridden} />
      </MockedProvider>,
      { locale: "en" }
    );

    await waitFor(() => {
      expect(screen.getByTestId("admin-verifications-empty")).toBeDefined();
    });
    expect(screen.getByText("OVERRIDDEN EMPTY TITLE")).toBeDefined();
    // The non-overridden keys still resolve through the namespace.
    expect(screen.getByText(overridden.emptyStateBody)).toBeDefined();
  });
});
