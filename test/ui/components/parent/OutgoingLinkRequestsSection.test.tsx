/**
 * OutgoingLinkRequestsSection — component suite.
 *
 * Happy DOM + Apollo `MockedProvider` tier (`test/ui/components`): every
 * outcome state of the parent outgoing link-requests section gets ONE render
 * case, driven across BOTH locales:
 *
 *   pending-live row (Cancel CTA enabled + pending chip + formatted expiry
 *   line + masked name) · expired-COMPUTED row (pending stored, past
 *   `expiresAt` → expired chip, CTA ABSENT — REQ-015 read purity) ·
 *   confirmed/rejected rows (chips correct, ZERO affordances) · Cancel CTA →
 *   dialog (`cancelDialogTitle`/`cancelDialogBody`) · dialog dismiss (pure
 *   dismissal, zero wire ops) · dialog submit while the cancel mutation is
 *   in flight → submit disabled (LoadingButton in-flight disable, dialog
 *   stays open) · cancel success → refetch renders the folded `rejected`
 *   chip + localized success toast + dialog closed · deny-wave: mutation
 *   `PARENT_LINK_REQUEST_NOT_FOUND` → localized inline Alert from the
 *   `errors` tree, row stays actionable · zero rows → translated empty
 *   state · cold load → skeleton region with `aria-busy` · query-level
 *   `FORBIDDEN` denial → PermissionDeniedFallback replaces the section.
 *
 * Translation discipline: assertions reference ONLY the PRELOADED label
 * objects resolved through `ParentLink.getLabels(getTranslations(locale))`,
 * `Errors.getLabels(...)` and `Common.getLabels(...)` — ZERO hardcoded
 * Arabic/English copy lives here. The exception class is fixture DATA (the
 * masked student name — DERIVED through the real `maskFullName` helper, and
 * canonical ISO instants, with every formatted stamp DERIVED through the
 * real `formatApplicantDate` helper — not eyeballed) plus technical tokens
 * (operation names, error codes, testids).
 *
 * Network discipline: every render mounts a RECORDING `ApolloLink` in front
 * of the `MockLink`; the refetch proof reads the operation names the wire
 * actually carried (`MyOutgoingParentLinkRequests` → `CancelParentLinkRequest`
 * → `MyOutgoingParentLinkRequests`).
 *
 * The masked-name contract (REQ-020): the parent side renders
 * `studentMaskedName` ONLY — a full-name sentinel asserted absent everywhere.
 *
 * Static discipline verified alongside (grep): `useLazyQuery` appears
 * NOWHERE in the section; no `.skip(`/`.only(` markers exist in this suite.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { ApolloLink } from "@apollo/client";
import { MockLink } from "@apollo/client/testing";
import { MockedProvider } from "@apollo/client/testing/react";
import { cleanup, type RenderResult, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  LinkStatus,
  type MyOutgoingParentLinkRequestsQuery_myOutgoingParentLinkRequests,
} from "@/frontend/graphql/generated/gql/graphql";
import {
  cancelParentLinkRequestMutationDocument,
  myOutgoingParentLinkRequestsQueryDocument,
} from "@/frontend/graphql/sharedDocuments";
import { formatApplicantDate } from "@/frontend/lib/i18n/format-date";
import { OutgoingLinkRequestsSection } from "@/frontend/views/parent/handshake/OutgoingLinkRequestsSection";
import { maskFullName } from "@/shared/lib/mask-full-name";
import type { AppLocale } from "@/shared/locale/AppLocale";
import { Common as CommonNs } from "@/shared/locale/namespaces/common";
import { Errors as ErrorsNs } from "@/shared/locale/namespaces/errors";
import { ParentLink as ParentLinkNs } from "@/shared/locale/namespaces/parentLink";
import { getTranslations } from "@/shared/locale/server";
import { renderWithWrapper } from "@/test/ui/components/TestWrapper";

// ----------------------------------------------------------------------------
// Fixtures — data only, proven through the canonical helpers (never eyeballed)
// ----------------------------------------------------------------------------

/**
 * Student display names — the parent side only ever receives the MASKED
 * form (REQ-020). The raw names exist solely to DERIVE the mask through the
 * real shared helper; a full-name sentinel asserts the masked contract.
 */
const RAW_STUDENT_NAME_A = "Yousef Adel";
const RAW_STUDENT_NAME_B = "Zaid Mahmoud";
const RAW_STUDENT_NAME_C = "Amin Kamal";
const MASKED_STUDENT_A = maskFullName(RAW_STUDENT_NAME_A);
const MASKED_STUDENT_B = maskFullName(RAW_STUDENT_NAME_B);
const MASKED_STUDENT_C = maskFullName(RAW_STUDENT_NAME_C);
/** Never rendered on the parent side (masked-name contract). */
const FULL_NAME_SENTINEL = RAW_STUDENT_NAME_A;

/**
 * Canonical ISO instants. LIVE expiry sits far in the future so the
 * computed-expiry verdict (REQ-015, strict-`>` liveness) can never flip
 * with the wall clock; the EXPIRED expiry sits far in the past.
 */
const CREATED_AT_ISO = "2026-08-20T09:00:00.000Z";
const LIVE_EXPIRES_ISO = "2099-01-07T12:00:00.000Z";
const EXPIRED_EXPIRES_ISO = "2020-01-01T12:00:00.000Z";
const RESPONDED_AT_ISO = "2026-08-21T14:30:00.000Z";

/** Outgoing-row factory — exactly the six canonical selection fields. */
function outgoingRow(
  overrides: Partial<MyOutgoingParentLinkRequestsQuery_myOutgoingParentLinkRequests> = {}
): MyOutgoingParentLinkRequestsQuery_myOutgoingParentLinkRequests {
  return {
    id: "401",
    status: LinkStatus.Pending,
    studentMaskedName: MASKED_STUDENT_A,
    createdAt: CREATED_AT_ISO,
    expiresAt: LIVE_EXPIRES_ISO,
    respondedAt: null,
    ...overrides,
  };
}

/** The single GraphQL query operation this surface may ever issue. */
const QUERY_OPERATION_NAME = "MyOutgoingParentLinkRequests";
/** The cancel-mutation operation name (the refetch proof's middle hop). */
const MUTATION_OPERATION_NAME = "CancelParentLinkRequest";

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

/** Outgoing-list mock — zero-argument query, `variables: {}` on the wire. */
function outgoingListMock(
  rows: ReadonlyArray<MyOutgoingParentLinkRequestsQuery_myOutgoingParentLinkRequests>
): MockLink.MockedResponse {
  return {
    request: { query: myOutgoingParentLinkRequestsQueryDocument, variables: {} },
    result: { data: { myOutgoingParentLinkRequests: [...rows] } },
  };
}

/** Permanently in-flight list mock — pins the skeleton branch. */
function inFlightListMock(): MockLink.MockedResponse {
  return {
    request: { query: myOutgoingParentLinkRequestsQueryDocument, variables: {} },
    delay: Infinity,
  };
}

/** Query failure authored as a raw `result.errors[]` entry (transport shape). */
function listFailureMock(errorCode: string): MockLink.MockedResponse {
  return {
    request: { query: myOutgoingParentLinkRequestsQueryDocument, variables: {} },
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

/** Successful cancel mock — echoes the folded row (canonical selection). */
function cancelMock(
  requestId: string,
  row: MyOutgoingParentLinkRequestsQuery_myOutgoingParentLinkRequests
): MockLink.MockedResponse {
  return {
    request: { query: cancelParentLinkRequestMutationDocument, variables: { requestId } },
    result: { data: { cancelParentLinkRequest: row } },
  };
}

/** Denial-wave cancel mock — `extensions.code` exactly where the wire puts it. */
function cancelFailureMock(requestId: string, errorCode: string): MockLink.MockedResponse {
  return {
    request: { query: cancelParentLinkRequestMutationDocument, variables: { requestId } },
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

/** Permanently in-flight cancel mock — pins the in-flight disable. */
function inFlightCancelMock(requestId: string): MockLink.MockedResponse {
  return {
    request: { query: cancelParentLinkRequestMutationDocument, variables: { requestId } },
    delay: Infinity,
  };
}

// ----------------------------------------------------------------------------
// Render + interaction helpers
// ----------------------------------------------------------------------------

type UserEvent = ReturnType<typeof userEvent.setup>;

/** Renders the section under a RECORDING link + MockLink composition. */
function renderOutgoingSection(
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
      <OutgoingLinkRequestsSection />
    </MockedProvider>,
    { locale }
  );
}

/** Opens the Cancel dialog for the (single) live-pending row. */
async function openCancelDialog(user: UserEvent, cancelLabel: string): Promise<HTMLElement> {
  // The affordance only exists once the list query has SETTLED — wait for
  // the list region before driving the CTA (no race on cold renders).
  await screen.findByTestId("parent-outgoing-list");
  await user.click(screen.getByRole("button", { name: cancelLabel }));
  const dialog = await screen.findByTestId("outgoing-cancel-dialog");
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

  describe(`OutgoingLinkRequestsSection (${locale === "ar" ? "RTL/arabic" : "LTR/english"})`, () => {
    test("pending-live row → Cancel CTA enabled, pending chip, formatted expiry line, masked dir=auto name", async () => {
      const traffic = createNetworkTraffic();
      renderOutgoingSection(traffic, [outgoingListMock([outgoingRow()])], locale);

      // The settled list region gates every synchronous row assertion below.
      expect(await screen.findByTestId("parent-outgoing-list")).toBeDefined();
      expect(screen.getByText(t.outgoingTitle)).toBeDefined();
      // The MASKED student name renders with the bidi-safe direction.
      const nameElement = screen.getByText(MASKED_STUDENT_A);
      expect(nameElement.getAttribute("dir")).toBe("auto");
      // The masked-name contract: a full name never reaches the DOM.
      expect(screen.queryByText(FULL_NAME_SENTINEL)).toBeNull();
      // The derived (never eyeballed) formatted expiry line.
      expect(screen.getByText(t.expiresLine(formatApplicantDate(LIVE_EXPIRES_ISO, locale)))).toBeDefined();
      expect(screen.getByText(`${t.sentAtLabel}: ${formatApplicantDate(CREATED_AT_ISO, locale)}`)).toBeDefined();
      expect(screen.getByText(t.statusPending)).toBeDefined();

      // The Cancel affordance renders enabled for a live-pending row.
      expect(screen.getByRole("button", { name: t.cancelAction }).getAttribute("disabled")).toBeNull();
      // No dialog, no denial alert, no toast on the settled happy path.
      expect(screen.queryByTestId("outgoing-cancel-dialog")).toBeNull();
      expect(screen.queryByTestId("parent-outgoing-denial-alert")).toBeNull();
      expect(screen.queryByTestId("parent-outgoing-success-toast")).toBeNull();

      // Exactly one wire operation — the zero-argument list query.
      expect(traffic.operationNames).toEqual([QUERY_OPERATION_NAME]);
    });

    test("expired-COMPUTED row (pending stored, past expiresAt) → expired chip, CTA ABSENT", async () => {
      const traffic = createNetworkTraffic();
      renderOutgoingSection(traffic, [outgoingListMock([outgoingRow({ expiresAt: EXPIRED_EXPIRES_ISO })])], locale);

      await screen.findByText(MASKED_STUDENT_A);

      // The expired chip is COMPUTED at render time (never a stale write).
      expect(screen.getByText(t.statusExpired)).toBeDefined();
      expect(screen.queryByText(t.statusPending)).toBeNull();
      // A computed-expired row is NOT actionable.
      expect(screen.queryByRole("button", { name: t.cancelAction })).toBeNull();
      expect(traffic.operationNames).toEqual([QUERY_OPERATION_NAME]);
    });

    test("confirmed + rejected rows → chips correct, ZERO affordances", async () => {
      const traffic = createNetworkTraffic();
      renderOutgoingSection(
        traffic,
        [
          outgoingListMock([
            outgoingRow({
              id: "501",
              studentMaskedName: MASKED_STUDENT_B,
              status: LinkStatus.Confirmed,
              respondedAt: RESPONDED_AT_ISO,
            }),
            outgoingRow({
              id: "502",
              studentMaskedName: MASKED_STUDENT_C,
              status: LinkStatus.Rejected,
              respondedAt: RESPONDED_AT_ISO,
            }),
          ]),
        ],
        locale
      );

      await screen.findByText(MASKED_STUDENT_B);
      expect(screen.getByText(MASKED_STUDENT_C)).toBeDefined();
      expect(screen.getByText(t.statusConfirmed)).toBeDefined();
      expect(screen.getByText(t.statusRejected)).toBeDefined();
      expect(screen.queryByText(t.statusPending)).toBeNull();

      // Resolved rows expose NO affordances at all — the whole list region.
      expect(screen.getByTestId("parent-outgoing-list").querySelector("button")).toBeNull();
      expect(traffic.operationNames).toEqual([QUERY_OPERATION_NAME]);
    });

    test("Cancel CTA → dialog carries cancelDialogTitle/cancelDialogBody; dismiss posts nothing", async () => {
      const traffic = createNetworkTraffic();
      renderOutgoingSection(traffic, [outgoingListMock([outgoingRow()])], locale);
      const user = userEvent.setup();

      const dialog = await openCancelDialog(user, t.cancelAction);
      expect(screen.getByText(t.cancelDialogTitle)).toBeDefined();
      expect(screen.getByText(t.cancelDialogBody)).toBeDefined();
      expect(within(dialog).getByRole("button", { name: t.cancelAction })).toBeDefined();
      expect(within(dialog).getByRole("button", { name: tc.cancel })).toBeDefined();

      // The dismiss affordance is the COMMON cancel label; the submit is the
      // PARENTLINK cancelAction (distinct handles, same dialog).
      await user.click(within(dialog).getByRole("button", { name: tc.cancel }));
      await waitFor(() => {
        expect(screen.queryByTestId("outgoing-cancel-dialog")).toBeNull();
      });
      // Dismissal is a pure dismissal — the wire carried ONLY the list query.
      expect(traffic.operationNames).toEqual([QUERY_OPERATION_NAME]);
    });

    test("dialog submit while the cancel mutation is in flight → submit disabled, dialog stays open", async () => {
      const traffic = createNetworkTraffic();
      renderOutgoingSection(traffic, [outgoingListMock([outgoingRow()]), inFlightCancelMock("401")], locale);
      const user = userEvent.setup();

      const dialog = await openCancelDialog(user, t.cancelAction);
      await user.click(within(dialog).getByRole("button", { name: t.cancelAction }));

      // LoadingButton-style in-flight disable: the submit affordance (and the
      // dismiss affordance) are disabled while the mutation runs; the dialog
      // does NOT close prematurely.
      await waitFor(() => {
        expect(
          within(screen.getByTestId("outgoing-cancel-dialog"))
            .getByRole("button", { name: t.cancelAction })
            .getAttribute("disabled")
        ).not.toBeNull();
      });
      expect(
        within(screen.getByTestId("outgoing-cancel-dialog"))
          .getByRole("button", { name: tc.cancel })
          .getAttribute("disabled")
      ).not.toBeNull();
      expect(traffic.operationNames).toEqual([QUERY_OPERATION_NAME, MUTATION_OPERATION_NAME]);
    });

    test("cancel success → refetch folds the row to the rejected chip + localized success toast", async () => {
      const traffic = createNetworkTraffic();
      const withdrawnRow = outgoingRow({ status: LinkStatus.Rejected, respondedAt: RESPONDED_AT_ISO });
      renderOutgoingSection(
        traffic,
        [outgoingListMock([outgoingRow()]), cancelMock("401", withdrawnRow), outgoingListMock([withdrawnRow])],
        locale
      );
      const user = userEvent.setup();

      const dialog = await openCancelDialog(user, t.cancelAction);
      await user.click(within(dialog).getByRole("button", { name: t.cancelAction }));

      // The refetched list restyles the row: rejected chip (the withdrawal
      // fold), Cancel CTA gone.
      await waitFor(() => {
        expect(screen.getByText(t.statusRejected)).toBeDefined();
      });
      expect(screen.queryByText(t.statusPending)).toBeNull();
      expect(screen.queryByTestId("outgoing-cancel-dialog")).toBeNull();
      // The dialog closed; the localized success toast fired.
      expect(screen.getByTestId("parent-outgoing-success-toast")).toBeDefined();
      expect(screen.getByText(t.cancelSuccessToast)).toBeDefined();

      // Wire: query → mutation → refetch (the honest list refresh).
      expect(traffic.operationNames).toEqual([QUERY_OPERATION_NAME, MUTATION_OPERATION_NAME, QUERY_OPERATION_NAME]);
    });

    test("deny-wave: mutation PARENT_LINK_REQUEST_NOT_FOUND → localized inline Alert from the errors tree", async () => {
      const traffic = createNetworkTraffic();
      renderOutgoingSection(
        traffic,
        [outgoingListMock([outgoingRow()]), cancelFailureMock("401", "PARENT_LINK_REQUEST_NOT_FOUND")],
        locale
      );
      const user = userEvent.setup();

      const dialog = await openCancelDialog(user, t.cancelAction);
      await user.click(within(dialog).getByRole("button", { name: t.cancelAction }));

      // The denial surfaces as the localized inline Alert — the copy comes
      // from the ERRORS handle, never a raw code.
      await waitFor(() => {
        expect(screen.getByTestId("parent-outgoing-denial-alert")).toBeDefined();
      });
      expect(screen.getByText(te.parentLinkRequestNotFound)).toBeDefined();
      // The dialog closed; the row itself stays pending-live (retryable).
      expect(screen.queryByTestId("outgoing-cancel-dialog")).toBeNull();
      expect(screen.getByRole("button", { name: t.cancelAction })).toBeDefined();
      expect(screen.getByText(t.statusPending)).toBeDefined();
      expect(traffic.operationNames).toEqual([QUERY_OPERATION_NAME, MUTATION_OPERATION_NAME]);
    });

    test("zero rows → translated empty state (title + body)", async () => {
      const traffic = createNetworkTraffic();
      renderOutgoingSection(traffic, [outgoingListMock([])], locale);

      expect(await screen.findByTestId("parent-outgoing-empty")).toBeDefined();
      expect(screen.getByText(t.outgoingEmptyTitle)).toBeDefined();
      expect(screen.getByText(t.outgoingEmptyBody)).toBeDefined();
      expect(screen.queryByTestId("parent-outgoing-list")).toBeNull();
      expect(traffic.operationNames).toEqual([QUERY_OPERATION_NAME]);
    });

    test("cold load → skeleton region with aria-busy, no settled copy", async () => {
      const traffic = createNetworkTraffic();
      renderOutgoingSection(traffic, [inFlightListMock()], locale);

      const skeleton = screen.getByTestId("parent-outgoing-skeleton");
      expect(skeleton.getAttribute("aria-busy")).toBe("true");
      // No settled row copy may leak into the skeleton.
      expect(screen.queryByTestId("parent-outgoing-list")).toBeNull();
      expect(screen.queryByTestId("parent-outgoing-empty")).toBeNull();
      expect(traffic.operationNames).toEqual([QUERY_OPERATION_NAME]);
    });

    test("query FORBIDDEN denial → PermissionDeniedFallback replaces the section", async () => {
      const traffic = createNetworkTraffic();
      renderOutgoingSection(traffic, [listFailureMock("FORBIDDEN")], locale);

      await waitFor(() => {
        expect(screen.getByText(te.forbiddenRole)).toBeDefined();
      });
      expect(screen.getByText(te.forbidden)).toBeDefined();
      // The denial surface replaces the whole section — no skeleton, no rows.
      expect(screen.queryByTestId("parent-outgoing-skeleton")).toBeNull();
      expect(screen.queryByTestId("parent-outgoing-list")).toBeNull();
    });
  });
}
