/**
 * StudentLinkRequestsContainer — component suite.
 *
 * Happy DOM + Apollo `MockedProvider` tier (`test/ui/components`): every
 * outcome state of the student link-requests container gets ONE render case,
 * driven across BOTH locales:
 *
 *   pending-live row (enabled CTAs + pending chip + formatted expiry line) ·
 *   expired-COMPUTED row (pending stored, past `expiresAt` → expired chip,
 *   CTAs ABSENT — REQ-015 read purity) · confirmed/rejected rows (chips
 *   correct, CTAs absent) · Confirm CTA → dialog interpolating
 *   `confirmDialogBody(parentName)` + cancel dismisses · dialog submit while
 *   the respond mutation is in flight → submit disabled (LoadingButton
 *   in-flight disable, dialog stays open) · success → refetch flips the row
 *   to the confirmed chip + localized success toast + dialog closed +
 *   CTAs gone (wire: query → mutation → refetch) · deny-wave: mutation
 *   `PARENT_LINK_REQUEST_EXPIRED` → localized inline Alert from the
 *   `errors` tree, dialog closed, row stays actionable · zero rows →
 *   translated empty state · cold load → skeleton region with `aria-busy` ·
 *   query-level `FORBIDDEN` denial → PermissionDeniedFallback replaces the
 *   container · query-level `RATE_LIMITED` → RetryableNotice.
 *
 * Translation discipline: assertions reference ONLY the PRELOADED label
 * objects resolved through `ParentLink.getLabels(getTranslations(locale))`,
 * `Errors.getLabels(...)` and `Common.getLabels(...)` — ZERO hardcoded
 * Arabic/English copy lives here. The exception class is fixture DATA (the
 * parent full names — display-only row payload, never an asserted UI copy —
 * and canonical ISO instants, with every formatted stamp DERIVED through the
 * real `formatApplicantDate` helper — not eyeballed) plus technical tokens
 * (operation names, error codes, testids).
 *
 * Network discipline: every render mounts a RECORDING `ApolloLink` in front
 * of the `MockLink`; the refetch proof reads the operation names the wire
 * actually carried (`MyIncomingParentLinkRequests` →
 * `RespondToParentLinkRequest` → `MyIncomingParentLinkRequests`).
 *
 * Anonymous/wrong-role are Server-Component concerns (the `withPageAuth`
 * guard + the wire matrix) — NOT covered by this component tier.
 *
 * Static discipline verified alongside (grep): `useLazyQuery` appears
 * NOWHERE in the container; no `.skip(`/`.only(` markers exist in this suite.
 */

// Apollo Client v4 restructured the testing surface: the component provider
// moved into the nested `testing/react` entrypoint, and the wire-shape types
// were consolidated under the non-deprecated `MockLink` namespace.
import { afterEach, describe, expect, test } from "bun:test";
import { ApolloLink } from "@apollo/client";
import { MockLink } from "@apollo/client/testing";
import { MockedProvider } from "@apollo/client/testing/react";
import { cleanup, type RenderResult, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  LinkStatus,
  type MyIncomingParentLinkRequestsQuery_myIncomingParentLinkRequests,
} from "@/frontend/graphql/generated/gql/graphql";
import {
  myIncomingParentLinkRequestsQueryDocument,
  respondToParentLinkRequestMutationDocument,
} from "@/frontend/graphql/sharedDocuments";
import { formatApplicantDate } from "@/frontend/lib/i18n/format-date";
import { StudentLinkRequestsContainer } from "@/frontend/views/students/link-requests/StudentLinkRequestsContainer";
import type { AppLocale } from "@/shared/locale/AppLocale";
import { Common as CommonNs } from "@/shared/locale/namespaces/common";
import { Errors as ErrorsNs } from "@/shared/locale/namespaces/errors";
import { ParentLink as ParentLinkNs } from "@/shared/locale/namespaces/parentLink";
import { getTranslations } from "@/shared/locale/server";
import { renderWithWrapper } from "@/test/ui/components/TestWrapper";

// ----------------------------------------------------------------------------
// Fixtures — data only, proven through the canonical helpers (never eyeballed)
// ----------------------------------------------------------------------------

/** Requesting parents' display names — the sanctioned full-name disclosure. */
const PARENT_NAME_A = "Sara Abdulrahman";
const PARENT_NAME_B = "Mona Khalid";
const PARENT_NAME_C = "Huda Ammar";

/**
 * Canonical ISO instants. LIVE expiry sits far in the future so the
 * computed-expiry verdict (REQ-015, strict-`>` liveness) can never flip
 * with the wall clock; the EXPIRED expiry sits far in the past. The
 * `respondedAt` stamps are never asserted as copy.
 */
const CREATED_AT_ISO = "2026-08-25T12:00:00.000Z";
const LIVE_EXPIRES_ISO = "2099-01-07T12:00:00.000Z";
const EXPIRED_EXPIRES_ISO = "2020-01-01T12:00:00.000Z";
const RESPONDED_AT_ISO = "2026-08-26T09:30:00.000Z";

/** Incoming-row factory — exactly the six canonical selection fields. */
function incomingRow(
  overrides: Partial<MyIncomingParentLinkRequestsQuery_myIncomingParentLinkRequests> = {}
): MyIncomingParentLinkRequestsQuery_myIncomingParentLinkRequests {
  return {
    id: "101",
    status: LinkStatus.Pending,
    parentFullName: PARENT_NAME_A,
    createdAt: CREATED_AT_ISO,
    expiresAt: LIVE_EXPIRES_ISO,
    respondedAt: null,
    ...overrides,
  };
}

/** The single GraphQL query operation this surface may ever issue. */
const QUERY_OPERATION_NAME = "MyIncomingParentLinkRequests";
/** The respond-mutation operation name (the refetch proof's middle hop). */
const MUTATION_OPERATION_NAME = "RespondToParentLinkRequest";

// ----------------------------------------------------------------------------
// Apollo link traffic recorder + mock builders
// ----------------------------------------------------------------------------

/** Captured network traffic — the refetch + mutation-wiring proofs. */
interface NetworkTraffic {
  readonly operationNames: string[];
}

function createNetworkTraffic(): NetworkTraffic {
  return { operationNames: [] };
}

/** Incoming-list mock — zero-argument query, `variables: {}` on the wire. */
function incomingListMock(
  rows: ReadonlyArray<MyIncomingParentLinkRequestsQuery_myIncomingParentLinkRequests>
): MockLink.MockedResponse {
  return {
    request: { query: myIncomingParentLinkRequestsQueryDocument, variables: {} },
    result: { data: { myIncomingParentLinkRequests: [...rows] } },
  };
}

/** Permanently in-flight list mock — pins the skeleton branch. */
function inFlightListMock(): MockLink.MockedResponse {
  return {
    request: { query: myIncomingParentLinkRequestsQueryDocument, variables: {} },
    delay: Infinity,
  };
}

/** Query failure authored as a raw `result.errors[]` entry (transport shape). */
function listFailureMock(errorCode: string): MockLink.MockedResponse {
  return {
    request: { query: myIncomingParentLinkRequestsQueryDocument, variables: {} },
    result: {
      errors: [
        {
          message: `${errorCode} (masked transport surface)`,
          extensions: { code: errorCode },
        },
      ],
    },
  };
}

/** Successful respond mock — echoes the resolved row (canonical selection). */
function respondMock(
  requestId: string,
  accept: boolean,
  row: MyIncomingParentLinkRequestsQuery_myIncomingParentLinkRequests
): MockLink.MockedResponse {
  return {
    request: { query: respondToParentLinkRequestMutationDocument, variables: { requestId, accept } },
    result: { data: { respondToParentLinkRequest: row } },
  };
}

/** Denial-wave respond mock — `extensions.code` exactly where the wire puts it. */
function respondFailureMock(requestId: string, accept: boolean, errorCode: string): MockLink.MockedResponse {
  return {
    request: { query: respondToParentLinkRequestMutationDocument, variables: { requestId, accept } },
    result: {
      errors: [
        {
          message: `${errorCode} (masked transport surface)`,
          extensions: { code: errorCode },
        },
      ],
    },
  };
}

/** Permanently in-flight respond mock — pins the in-flight disable. */
function inFlightRespondMock(requestId: string, accept: boolean): MockLink.MockedResponse {
  return {
    request: { query: respondToParentLinkRequestMutationDocument, variables: { requestId, accept } },
    delay: Infinity,
  };
}

// ----------------------------------------------------------------------------
// Render + interaction helpers
// ----------------------------------------------------------------------------

type UserEvent = ReturnType<typeof userEvent.setup>;

/** Renders the container under a RECORDING link + MockLink composition. */
function renderLinkRequests(
  traffic: NetworkTraffic,
  mocks: ReadonlyArray<MockLink.MockedResponse>,
  locale: AppLocale
): RenderResult {
  const mockLink = new MockLink([...mocks]);
  const recordingLink = new ApolloLink((operation, forward) => {
    // operationName is optional on the request type; a blank placeholder keeps
    // the recorder total (in practice every operation carries its name).
    traffic.operationNames.push(operation.operationName ?? "");
    return forward(operation);
  });
  return renderWithWrapper(
    <MockedProvider link={ApolloLink.from([recordingLink, mockLink])}>
      <StudentLinkRequestsContainer />
    </MockedProvider>,
    { locale }
  );
}

/** Opens the Confirm decision dialog for the (single) live-pending row. */
async function openConfirmDialog(user: UserEvent, confirmLabel: string): Promise<HTMLElement> {
  // The affordances only exist once the list query has SETTLED — wait for
  // the list region before driving the CTA (no race on cold renders).
  await screen.findByTestId("student-link-requests-list");
  await user.click(screen.getByRole("button", { name: confirmLabel }));
  const dialog = await screen.findByTestId("student-link-requests-dialog");
  return dialog;
}

afterEach(() => {
  cleanup();
});

// ----------------------------------------------------------------------------
// Suite — one block per locale keeps RTL/LTR both exercised over the FULL
// branch matrix while every case stays independently readable.
// ----------------------------------------------------------------------------

for (const locale of ["ar", "en"] as AppLocale[]) {
  const t = ParentLinkNs.getLabels(getTranslations(locale));
  const te = ErrorsNs.getLabels(getTranslations(locale));
  const tc = CommonNs.getLabels(getTranslations(locale));

  describe(`StudentLinkRequestsContainer (${locale === "ar" ? "RTL/arabic" : "LTR/english"})`, () => {
    test("pending-live row → enabled CTAs, pending chip, formatted expiry line, dir=auto name", async () => {
      const traffic = createNetworkTraffic();
      renderLinkRequests(traffic, [incomingListMock([incomingRow()])], locale);

      // The settled list region gates every synchronous row assertion below
      // (the title renders at mount, the rows only after the query settles).
      expect(await screen.findByTestId("student-link-requests-list")).toBeDefined();
      expect(screen.getByText(t.studentPageTitle)).toBeDefined();
      // The FULL parent name renders with the bidi-safe direction.
      const nameElement = screen.getByText(PARENT_NAME_A);
      expect(nameElement.getAttribute("dir")).toBe("auto");
      // The derived (never eyeballed) formatted expiry line.
      expect(screen.getByText(t.expiresLine(formatApplicantDate(LIVE_EXPIRES_ISO, locale)))).toBeDefined();
      expect(screen.getByText(`${t.sentAtLabel}: ${formatApplicantDate(CREATED_AT_ISO, locale)}`)).toBeDefined();
      expect(screen.getByText(t.statusPending)).toBeDefined();

      // Both CTAs render enabled for a live-pending row (the disabled
      // ATTRIBUTE pattern per the notifications-suite convention).
      expect(screen.getByRole("button", { name: t.confirmAction }).getAttribute("disabled")).toBeNull();
      expect(screen.getByRole("button", { name: t.rejectAction }).getAttribute("disabled")).toBeNull();
      // No dialog, no denial alert, no toast on the settled happy path.
      expect(screen.queryByTestId("student-link-requests-dialog")).toBeNull();
      expect(screen.queryByTestId("student-link-requests-denial-alert")).toBeNull();
      expect(screen.queryByTestId("student-link-requests-success-toast")).toBeNull();

      // Exactly one wire operation — the zero-argument list query.
      expect(traffic.operationNames).toEqual([QUERY_OPERATION_NAME]);
    });

    test("expired-COMPUTED row (pending stored, past expiresAt) → expired chip, CTAs ABSENT", async () => {
      const traffic = createNetworkTraffic();
      renderLinkRequests(traffic, [incomingListMock([incomingRow({ expiresAt: EXPIRED_EXPIRES_ISO })])], locale);

      await screen.findByText(PARENT_NAME_A);

      // The expired chip is COMPUTED at render time (never a stale write).
      expect(screen.getByText(t.statusExpired)).toBeDefined();
      expect(screen.queryByText(t.statusPending)).toBeNull();
      // A computed-expired row is NOT actionable.
      expect(screen.queryByRole("button", { name: t.confirmAction })).toBeNull();
      expect(screen.queryByRole("button", { name: t.rejectAction })).toBeNull();
      expect(traffic.operationNames).toEqual([QUERY_OPERATION_NAME]);
    });

    test("confirmed + rejected rows → chips correct, ZERO affordances", async () => {
      const traffic = createNetworkTraffic();
      renderLinkRequests(
        traffic,
        [
          incomingListMock([
            incomingRow({
              id: "201",
              parentFullName: PARENT_NAME_B,
              status: LinkStatus.Confirmed,
              respondedAt: RESPONDED_AT_ISO,
            }),
            incomingRow({
              id: "202",
              parentFullName: PARENT_NAME_C,
              status: LinkStatus.Rejected,
              respondedAt: RESPONDED_AT_ISO,
            }),
          ]),
        ],
        locale
      );

      await screen.findByText(PARENT_NAME_B);
      expect(screen.getByText(PARENT_NAME_C)).toBeDefined();
      expect(screen.getByText(t.statusConfirmed)).toBeDefined();
      expect(screen.getByText(t.statusRejected)).toBeDefined();
      expect(screen.queryByText(t.statusPending)).toBeNull();

      // Resolved rows expose NO affordances at all — the whole list region.
      expect(screen.getByTestId("student-link-requests-list").querySelector("button")).toBeNull();
      expect(traffic.operationNames).toEqual([QUERY_OPERATION_NAME]);
    });

    test("Confirm CTA → dialog interpolates confirmDialogBody(parentName); cancel dismisses without any wire op", async () => {
      const traffic = createNetworkTraffic();
      renderLinkRequests(traffic, [incomingListMock([incomingRow()])], locale);
      const user = userEvent.setup();

      const dialog = await openConfirmDialog(user, t.confirmAction);
      expect(screen.getByText(t.confirmDialogTitle)).toBeDefined();
      // The name is injected through the confirmDialogBody function slot.
      expect(screen.getByText(t.confirmDialogBody(PARENT_NAME_A))).toBeDefined();
      // The submit affordance carries the SAME label the user clicked.
      expect(within(dialog).getByRole("button", { name: t.confirmAction })).toBeDefined();
      expect(within(dialog).getByRole("button", { name: tc.cancel })).toBeDefined();

      await user.click(within(dialog).getByRole("button", { name: tc.cancel }));
      await waitFor(() => {
        expect(screen.queryByTestId("student-link-requests-dialog")).toBeNull();
      });
      // Cancel is a pure dismissal — the wire carried ONLY the list query.
      expect(traffic.operationNames).toEqual([QUERY_OPERATION_NAME]);
    });

    test("dialog submit while the respond mutation is in flight → submit disabled, dialog stays open", async () => {
      const traffic = createNetworkTraffic();
      renderLinkRequests(traffic, [incomingListMock([incomingRow()]), inFlightRespondMock("101", true)], locale);
      const user = userEvent.setup();

      const dialog = await openConfirmDialog(user, t.confirmAction);
      await user.click(within(dialog).getByRole("button", { name: t.confirmAction }));

      // LoadingButton-style in-flight disable: the submit affordance (and the
      // cancel affordance) are disabled while the mutation runs; the dialog
      // does NOT close prematurely.
      await waitFor(() => {
        expect(
          within(screen.getByTestId("student-link-requests-dialog"))
            .getByRole("button", { name: t.confirmAction })
            .getAttribute("disabled")
        ).not.toBeNull();
      });
      expect(
        within(screen.getByTestId("student-link-requests-dialog"))
          .getByRole("button", { name: tc.cancel })
          .getAttribute("disabled")
      ).not.toBeNull();
      expect(traffic.operationNames).toEqual([QUERY_OPERATION_NAME, MUTATION_OPERATION_NAME]);
    });

    test("Confirm submit success → refetch flips the row to the confirmed chip + localized success toast", async () => {
      const traffic = createNetworkTraffic();
      const resolvedRow = incomingRow({ status: LinkStatus.Confirmed, respondedAt: RESPONDED_AT_ISO });
      renderLinkRequests(
        traffic,
        [incomingListMock([incomingRow()]), respondMock("101", true, resolvedRow), incomingListMock([resolvedRow])],
        locale
      );
      const user = userEvent.setup();

      const dialog = await openConfirmDialog(user, t.confirmAction);
      await user.click(within(dialog).getByRole("button", { name: t.confirmAction }));

      // The refetched list restyles the row: confirmed chip, CTAs gone.
      await waitFor(() => {
        expect(screen.getByText(t.statusConfirmed)).toBeDefined();
      });
      expect(screen.queryByText(t.statusPending)).toBeNull();
      expect(screen.queryByRole("button", { name: t.confirmAction })).toBeNull();
      // The dialog closed; the localized success toast fired.
      expect(screen.queryByTestId("student-link-requests-dialog")).toBeNull();
      expect(screen.getByTestId("student-link-requests-success-toast")).toBeDefined();
      expect(screen.getByText(t.confirmSuccessToast)).toBeDefined();

      // Wire: query → mutation → refetch (the honest list refresh).
      expect(traffic.operationNames).toEqual([QUERY_OPERATION_NAME, MUTATION_OPERATION_NAME, QUERY_OPERATION_NAME]);
    });

    test("deny-wave: mutation PARENT_LINK_REQUEST_EXPIRED → localized inline Alert from the errors tree", async () => {
      const traffic = createNetworkTraffic();
      renderLinkRequests(
        traffic,
        [incomingListMock([incomingRow()]), respondFailureMock("101", true, "PARENT_LINK_REQUEST_EXPIRED")],
        locale
      );
      const user = userEvent.setup();

      const dialog = await openConfirmDialog(user, t.confirmAction);
      await user.click(within(dialog).getByRole("button", { name: t.confirmAction }));

      // The denial surfaces as the localized inline Alert — the copy comes
      // from the ERRORS handle, never a hardcoded literal.
      await waitFor(() => {
        expect(screen.getByTestId("student-link-requests-denial-alert")).toBeDefined();
      });
      expect(screen.getByText(te.parentLinkRequestExpired)).toBeDefined();
      // The dialog closed; the row itself stays pending-live (retryable).
      expect(screen.queryByTestId("student-link-requests-dialog")).toBeNull();
      expect(screen.getByRole("button", { name: t.confirmAction })).toBeDefined();
      expect(screen.getByText(t.statusPending)).toBeDefined();
      expect(traffic.operationNames).toEqual([QUERY_OPERATION_NAME, MUTATION_OPERATION_NAME]);
    });

    test("zero rows → translated empty state (title + body)", async () => {
      const traffic = createNetworkTraffic();
      renderLinkRequests(traffic, [incomingListMock([])], locale);

      expect(await screen.findByTestId("student-link-requests-empty")).toBeDefined();
      expect(screen.getByText(t.incomingEmptyTitle)).toBeDefined();
      expect(screen.getByText(t.incomingEmptyBody)).toBeDefined();
      expect(screen.queryByTestId("student-link-requests-list")).toBeNull();
      expect(traffic.operationNames).toEqual([QUERY_OPERATION_NAME]);
    });

    test("cold load → skeleton region with aria-busy, no settled copy", async () => {
      const traffic = createNetworkTraffic();
      renderLinkRequests(traffic, [inFlightListMock()], locale);

      const skeleton = screen.getByTestId("student-link-requests-skeleton");
      expect(skeleton.getAttribute("aria-busy")).toBe("true");
      // No settled row copy may leak into the skeleton.
      expect(screen.queryByTestId("student-link-requests-list")).toBeNull();
      expect(screen.queryByTestId("student-link-requests-empty")).toBeNull();
      expect(traffic.operationNames).toEqual([QUERY_OPERATION_NAME]);
    });

    test("query FORBIDDEN denial → PermissionDeniedFallback replaces the container", async () => {
      const traffic = createNetworkTraffic();
      renderLinkRequests(traffic, [listFailureMock("FORBIDDEN")], locale);

      await waitFor(() => {
        expect(screen.getByText(te.forbiddenRole)).toBeDefined();
      });
      expect(screen.getByText(te.forbidden)).toBeDefined();
      // The denial surface replaces the whole list — no skeleton, no rows.
      expect(screen.queryByTestId("student-link-requests-skeleton")).toBeNull();
      expect(screen.queryByTestId("student-link-requests-list")).toBeNull();
    });

    test("query RATE_LIMITED → RetryableNotice with the localized retry affordance", async () => {
      const traffic = createNetworkTraffic();
      renderLinkRequests(traffic, [listFailureMock("RATE_LIMITED")], locale);

      await waitFor(() => {
        expect(screen.getByText(te.rateLimitExceeded)).toBeDefined();
      });
      expect(screen.getByRole("button", { name: tc.retry })).toBeDefined();
      expect(screen.queryByTestId("student-link-requests-list")).toBeNull();
    });
  });
}
