/**
 * StudentSessionsContainer — component suite BODY.
 *
 * NOT a runner target: `bun test` collects `*.test.*` files only, and this
 * file carries the suite implementation on behalf of the sibling bootstrap
 * `StudentSessionsContainer.test.tsx` (see that file for WHY the suite is
 * split — short version: react-dom must first evaluate with the Happy-DOM
 * document already registered, or React's `isInputEventSupported` flag is
 * computed `false` and controlled `onChange` can never fire).
 *
 * Happy DOM + Apollo `MockedProvider` tier (`test/ui/components/student`,
 * mirroring the `ApplicantStatusCard` suite one level up): ONE render case
 * per branch of the student sessions visual state matrix, driven across BOTH
 * locales:
 *
 *   loading skeleton · FORBIDDEN fallback · generic error · empty page (all
 *   of them keeping the ALWAYS-ON title + filter-chips chrome mounted — the
 *   4.BFBS filtered-empty fix) · populated rows (status chips per key ·
 *   verbatim fee + currency · formatted deadline/created · cancel affordance
 *   matrix) · cancel flow (dialog → reason → React.SubmitEvent submit →
 *   hold-released snackbar + cache-driven chip flip) · dispute flow
 *   (DEV3-005: dialog open + REQUIRED-reason gate blocking an empty submit
 *   + clean dismissal; the typed wire arm + its error arm are deferred) ·
 *   confirm-completion flow (DEV3-012: affordance matrix over the three
 *   Completed shapes — pending CTA + awaiting pill, arbitration-settled
 *   none, stamped meta cell — success snackbar + cache-driven stamp/hold
 *   convergence, invalid-transition row alert; the container-owned
 *   SESSION_NOT_FOUND eviction arm is deferred) ·
 *   SESSION_NOT_FOUND (row evicted) · SESSION_INVALID_TRANSITION (inline row
 *   alert) · DUPLICATE_REQUEST (info snackbar — success-equivalent) ·
 *   filtered-empty (chips stay mounted + distinct filtered copy) · copy
 *   contract pin.
 *
 * Translation discipline: assertions reference ONLY the PRELOADED label
 * objects resolved through `Sessions.getLabels(getTranslations(locale))`,
 * `Errors.getLabels(...)` and `Common.getLabels(...)` — ZERO hardcoded
 * Arabic/English copy lives here. The one exception class is fixture DATA
 * (ids, enum-valued intents, an ASCII cancel reason typed into the dialog)
 * plus the deadline/created timestamps, which are recomputed with a local
 * `Intl.DateTimeFormat` clone of the documented option set (byte-consistency
 * technique used by the service-layer suite).
 *
 * Preload parity: the `test:ui:components` preload chain (test-env →
 * happydom → translation-preload → next-dynamic-mock) is owned by the
 * bootstrap entry, which registers the DOM BEFORE this module — and its
 * node_modules dependencies — are evaluated, under the plain single-file
 * runner (`bun run test/scripts/run-test.ts <path>`) and the official
 * `test:ui:components` CLI preloads alike.
 *
 * Typing discipline (React 19 + Happy DOM): the dialog reason field is a
 * controlled MUI multiline TextField; the suite drives it with the canonical
 * `fireEvent.change(input, { target: { value } })` — @testing-library/dom's
 * native-setter + `change` dispatch, which keeps React's internal value
 * tracker observing a real delta. This ONLY works when react-dom evaluated
 * with `isInputEventSupported === true`, which is exactly what the bootstrap
 * split guarantees.
 *
 * Static discipline verified alongside (grep):
 *   - `useLazyQuery` appears NOWHERE in the view or its consumers;
 *   - the ONLY `.skip(` markers in this suite are deliberate environment
 *     deferrals: the cancel-flow typing arm + the cancel SESSION_NOT_FOUND
 *     eviction arm (D8/D9 in deferred-items.md), the DEV3-005 dispute
 *     typed/error arms (D8-family — branches 6c + 6d) and the DEV3-012
 *     confirm SESSION_NOT_FOUND eviction arm (D9-family — branch 6h, the
 *     cache-surgery-under-active-observer shape) — never a `test.only(`
 *     or a silent drop; every deferred flow is compensated by the
 *     real-browser loop (4.2.BF / the DEV3-005 + DEV3-012 4.1 agent-browser
 *     passes).
 */

import { afterEach, describe, expect, test } from "bun:test";
import type { MockLink } from "@apollo/client/testing";
import { MockedProvider } from "@apollo/client/testing/react";
import {
  cleanup,
  fireEvent,
  getQueriesForElement,
  type RenderResult,
  type Screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  type MyStudentSessionsQuery_myStudentSessions_items,
  SessionIntent,
  SessionStatus,
  SessionType,
} from "@/frontend/graphql/generated/gql/graphql";
import {
  cancelSessionMutationDocument,
  confirmSessionCompletionMutationDocument,
  myStudentSessionsQueryDocument,
  openSessionDisputeMutationDocument,
} from "@/frontend/graphql/sharedDocuments";
import { MAX_CANCEL_REASON_LENGTH } from "@/frontend/views/student/sessions/CancelSessionConfirmDialog";
import { MAX_DISPUTE_REASON_LENGTH } from "@/frontend/views/student/sessions/SessionDisputeConfirmDialog";
import { StudentSessionsContainer } from "@/frontend/views/student/sessions/StudentSessionsContainer";
import { SESSION_FEE_CURRENCY } from "@/shared/constants";
import type { AppLocale } from "@/shared/locale/AppLocale";
import { Common as CommonNs } from "@/shared/locale/namespaces/common";
import { Errors as ErrorsNs } from "@/shared/locale/namespaces/errors";
import { Sessions as SessionsNs } from "@/shared/locale/namespaces/sessions";
import { getTranslations } from "@/shared/locale/server";
import type { SessionsLabels } from "@/shared/locale/types/sessions";
import { renderWithWrapper } from "@/test/ui/components/TestWrapper";

// ---------------------------------------------------------------------------
// Fixtures (DATA — never locale copy)

/**
 * All-fields fixture row. `__typename` mirrors what Apollo Server puts on
 * the wire; it is what makes the `Session:<id>` entity normalizable so the
 * dialog's cache `update`/eviction arms converge the list WITHOUT refetch.
 */
interface SessionFixture extends MyStudentSessionsQuery_myStudentSessions_items {
  readonly __typename: "Session";
}

/** Creation moment shared by every fixture row (deterministic formatting). */
const CREATED_ISO = "2099-01-10T08:45:00.000Z";

/** Confirmation deadline for cancellable rows (different day from created). */
const DEADLINE_ISO = "2099-01-11T20:30:00.000Z";

/** The row exercised by every cancel-dialog flow. */
const CANCEL_SESSION_ID = "9201";

/** The Scheduled row exercised by every dispute-dialog flow (DEV3-005). */
const DISPUTE_SESSION_ID = "9205";

/** The Completed row exercised by every confirm flow (DEV3-012). */
const CONFIRM_SESSION_ID = "9207";

/** First row id of the populated page (settled-render wait handle). */
const FIRST_POPULATED_ID = "9101";

/** Raw text typed into the dialog (padded — proves the UI-seam trim). */
const REASON_TYPED = "  Schedule conflict  ";

/** The trimmed value the dialog sends on the wire (`reason` is optional). */
const REASON_SENT = REASON_TYPED.trim();

/** Raw text typed into the dispute dialog (padded — proves the UI-seam trim). */
const DISPUTE_REASON_TYPED = "  Teacher never showed up  ";

/** The trimmed value the dispute dialog sends on the wire (reason REQUIRED). */
const DISPUTE_REASON_SENT = DISPUTE_REASON_TYPED.trim();

/** Student-confirmation moment returned by the confirm success mock (DEV3-012). */
const CONFIRMED_ISO = "2099-01-10T14:05:00.000Z";

/** SessionRow's typographic no-value placeholder (NOT locale copy). */
const EM_DASH = "—";

/** Exact variables the container sends for the unfiltered stateful query. */
const ALL_FILTER_VARIABLES = { filter: null, page: null, pageSize: null };

/**
 * Exact variables the container sends once a status chip is active — the
 * filtered-empty branch clicks a chip and the query re-keys to THESE.
 */
function filteredFilterVariables(status: SessionStatus): {
  filter: { status: SessionStatus };
  page: null;
  pageSize: null;
} {
  return { filter: { status }, page: null, pageSize: null };
}

/** Deterministic payload builder mirroring the closed 14-field wire shape. */
function sessionFixture(overrides?: Partial<MyStudentSessionsQuery_myStudentSessions_items>): SessionFixture {
  return {
    __typename: "Session",
    id: CANCEL_SESSION_ID,
    status: SessionStatus.Scheduled,
    intent: SessionIntent.Hifz,
    sessionType: SessionType.StudentSession,
    fee: "150.50",
    feeHeld: true,
    studentId: "401",
    teacherId: "802",
    startedAt: null,
    endedAt: null,
    confirmationDeadline: DEADLINE_ISO,
    confirmedByStudentAt: null,
    confirmedByTeacherAt: null,
    createdAt: CREATED_ISO,
    updatedAt: CREATED_ISO,
    // DEV3-005 dispute/cancel-audit columns — nullable, defaulted off.
    cancelReason: null,
    disputeReason: null,
    disputedAt: null,
    resolutionNote: null,
    resolvedAt: null,
    ...overrides,
  };
}

/** The Scheduled row exercised by every cancel-dialog flow (fee on hold). */
const CANCELLABLE_SESSION = sessionFixture({ id: CANCEL_SESSION_ID, fee: "150.00" });

/** The cancelled wire payload the success mock returns (same id, fee released). */
const CANCELLED_PAYLOAD = sessionFixture({
  id: CANCEL_SESSION_ID,
  status: SessionStatus.Cancelled,
  fee: "150.00",
  feeHeld: false,
});

/** One populated page: one row per REACHABLE status, mixed nullable meta. */
const POPULATED_ROWS: ReadonlyArray<readonly [SessionFixture, StatusChipLabelKey]> = [
  [
    sessionFixture({ id: FIRST_POPULATED_ID, intent: SessionIntent.Hifz, fee: "150.50", feeHeld: true }),
    "statusScheduled",
  ],
  [
    sessionFixture({ id: "9102", status: SessionStatus.Started, intent: SessionIntent.Tajweed, fee: "200.00" }),
    "statusStarted",
  ],
  [
    sessionFixture({
      id: "9103",
      status: SessionStatus.Completed,
      intent: SessionIntent.Evaluation,
      fee: "125.00",
      feeHeld: false,
      confirmationDeadline: null,
    }),
    "statusCompleted",
  ],
  [
    sessionFixture({
      id: "9104",
      status: SessionStatus.Cancelled,
      intent: null,
      fee: null,
      feeHeld: false,
      confirmationDeadline: null,
    }),
    "statusCancelled",
  ],
];

/** Cancellable-lifecycle tokens (the row's affordance matrix, enum-typed). */
const CANCELLABLE_STATUSES: ReadonlySet<SessionStatus> = new Set([SessionStatus.Scheduled, SessionStatus.Started]);

/**
 * Status-chip label-key union — the NARROW slice of `SessionsLabels` the row
 * chip may render (the namespace also carries template-function labels like
 * `adminDisputesCountLine` that are not valid chip labels).
 */
type StatusChipLabelKey = keyof Pick<
  SessionsLabels,
  "statusScheduled" | "statusStarted" | "statusCompleted" | "statusCancelled" | "statusDisputed"
>;

// ---------------------------------------------------------------------------
// Mock builders

/** Single-operation Apollo mock answering the shared document with a page. */
function listPageMock(items: ReadonlyArray<SessionFixture>): MockLink.MockedResponse {
  return {
    request: { query: myStudentSessionsQueryDocument, variables: ALL_FILTER_VARIABLES },
    result: {
      data: {
        myStudentSessions: {
          items: [...items],
          page: 1,
          pageSize: 25,
          totalCount: items.length,
        },
      },
    },
  };
}

/** Single-operation mock answering the stateful query for an ACTIVE filter. */
function filteredPageMock(status: SessionStatus, items: ReadonlyArray<SessionFixture>): MockLink.MockedResponse {
  return {
    request: { query: myStudentSessionsQueryDocument, variables: filteredFilterVariables(status) },
    result: {
      data: {
        myStudentSessions: {
          items: [...items],
          page: 1,
          pageSize: 25,
          totalCount: items.length,
        },
      },
    },
  };
}

/**
 * Permanently in-flight query (`delay: Infinity` keeps MockLink emitting a
 * never-settling Observable). An EMPTY mock list would NOT leave the query
 * pending — MockLink raises an async unmatched-operation error instead.
 */
function pendingListMock(): MockLink.MockedResponse {
  return {
    request: { query: myStudentSessionsQueryDocument, variables: ALL_FILTER_VARIABLES },
    delay: Infinity,
  };
}

/**
 * Single-operation mock denying the caller at the scope layer. The deny is
 * authored as a raw `result.errors[]` entry exactly where the transport
 * boundary puts `extensions.code`; Apollo's MockedProvider wraps it into a
 * genuine `CombinedGraphQLErrors`, which `extractErrorCode` traverses
 * (`errors[0].extensions.code`) — the same extraction path the production
 * error-link uses under `frontend/providers/apollo/utils.ts`.
 */
function deniedQueryError(code: string): MockLink.MockedResponse {
  return {
    request: { query: myStudentSessionsQueryDocument, variables: ALL_FILTER_VARIABLES },
    result: {
      errors: [{ message: `${code} (masked transport surface)`, extensions: { code } }],
    },
  };
}

/** Mutation mock resolving the cancelled session payload (fee hold released). */
function cancelSuccessMock(): MockLink.MockedResponse {
  return {
    request: {
      query: cancelSessionMutationDocument,
      variables: { id: CANCEL_SESSION_ID, reason: REASON_SENT },
    },
    result: { data: { cancelSession: CANCELLED_PAYLOAD } },
  };
}

/** Mutation mock failing with a transport-shaped `extensions.code` error. */
function cancelErrorMock(code: string): MockLink.MockedResponse {
  return {
    request: {
      query: cancelSessionMutationDocument,
      variables: { id: CANCEL_SESSION_ID, reason: null },
    },
    result: {
      errors: [{ message: `${code} (masked transport surface)`, extensions: { code } }],
    },
  };
}

/** Dispute-open moment returned by the openSessionDispute success mock. */
const DISPUTED_ISO = "2099-01-10T13:20:00.000Z";

/** The disputed wire payload the dispute success mock returns (same id). */
const DISPUTED_PAYLOAD = sessionFixture({
  id: DISPUTE_SESSION_ID,
  status: SessionStatus.Disputed,
  disputeReason: DISPUTE_REASON_SENT,
  disputedAt: DISPUTED_ISO,
});

/** Dispute-mutation mock resolving the disputed payload (reason persisted). */
function disputeSuccessMock(): MockLink.MockedResponse {
  return {
    request: {
      query: openSessionDisputeMutationDocument,
      variables: { id: DISPUTE_SESSION_ID, reason: DISPUTE_REASON_SENT },
    },
    result: { data: { openSessionDispute: DISPUTED_PAYLOAD } },
  };
}

/** Dispute-mutation mock failing with a transport-shaped `extensions.code`. */
function disputeErrorMock(code: string): MockLink.MockedResponse {
  return {
    request: {
      query: openSessionDisputeMutationDocument,
      variables: { id: DISPUTE_SESSION_ID, reason: DISPUTE_REASON_SENT },
    },
    result: {
      errors: [{ message: `${code} (masked transport surface)`, extensions: { code } }],
    },
  };
}

/**
 * The completed hold-marked row (DEV3-012's exactly-once pending shape) the
 * confirm CTAs render on: `Completed` ∧ student stamp unset ∧ `feeHeld`.
 */
const CONFIRM_PENDING_SESSION = sessionFixture({
  id: CONFIRM_SESSION_ID,
  status: SessionStatus.Completed,
  fee: "175.00",
  feeHeld: true,
  confirmationDeadline: null,
});

/** The confirmed wire payload the confirm success mock returns (hold released). */
const CONFIRMED_PAYLOAD = sessionFixture({
  id: CONFIRM_SESSION_ID,
  status: SessionStatus.Completed,
  fee: "175.00",
  feeHeld: false,
  confirmedByStudentAt: CONFIRMED_ISO,
  confirmationDeadline: null,
});

/** Confirm-mutation mock resolving the confirmed payload (student stamp set). */
function confirmSuccessMock(): MockLink.MockedResponse {
  return {
    request: {
      query: confirmSessionCompletionMutationDocument,
      variables: { id: CONFIRM_SESSION_ID },
    },
    result: { data: { confirmSessionCompletion: CONFIRMED_PAYLOAD } },
  };
}

/** Confirm-mutation mock failing with a transport-shaped `extensions.code`. */
function confirmErrorMock(code: string): MockLink.MockedResponse {
  return {
    request: {
      query: confirmSessionCompletionMutationDocument,
      variables: { id: CONFIRM_SESSION_ID },
    },
    result: {
      errors: [{ message: `${code} (masked transport surface)`, extensions: { code } }],
    },
  };
}

// ---------------------------------------------------------------------------
// Render + expectation helpers

/**
 * Lazily-bound `screen` replacement.
 *
 * WHY not `import { screen } from "@testing-library/react"`: RTL binds its
 * `screen` singleton ONCE, at the moment `@testing-library/dom/screen.js` is
 * first evaluated (`typeof document === "undefined" ? throwing-stub :
 * getQueriesForElement(document.body)`). Binding through
 * `getQueriesForElement(document.body)` on EVERY property access resolves
 * against the live DOM under BOTH runners (this file's bootstrap AND the
 * official `test:ui:components` CLI preloads) regardless of import order.
 */
const screen: Screen = new Proxy(Object.create(null), {
  get: (_target, property, receiver) => Reflect.get(getQueriesForElement(document.body), property, receiver),
});

/** Renders the container under TestWrapper (LocaleProvider → emotion → theme). */
function renderSessions(mocks: ReadonlyArray<MockLink.MockedResponse>, locale: AppLocale): RenderResult {
  const mocksCopy = [...mocks];
  return renderWithWrapper(
    <MockedProvider mocks={mocksCopy}>
      <StudentSessionsContainer />
    </MockedProvider>,
    { locale }
  );
}

/**
 * Recomputes the deadline/created stamp independently of the implementation
 * (byte-consistent clone of `formatApplicantDate`'s documented option set).
 */
function expectedStamp(iso: string, locale: AppLocale): string {
  const formatter = new Intl.DateTimeFormat(locale === "en" ? "en" : "ar", {
    timeZone: "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return formatter.format(new Date(iso));
}

/** Clicks a row's cancel affordance and resolves once the dialog is open. */
async function openCancelDialog(cancelLabel: string): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole("button", { name: cancelLabel }));
  return await waitFor(() => screen.getByRole("dialog"));
}

/**
 * Resolves the MUI severity class of the snackbar Alert currently showing
 * `text` (`MuiAlert-colorSuccess` / `colorError` / `colorInfo` families).
 */
function snackbarSeverityClass(text: string): string {
  return screen.getByText(text).closest(".MuiAlert-root")?.className ?? "";
}

afterEach(cleanup);

// One block per locale keeps RTL/LTR both exercised over the FULL branch
// matrix while every case stays independently readable.
//
// STUI_LOCALE split-run guard: when set ("ar" | "en"), one bun invocation
// executes ONLY that locale's block — the sanctioned OOM relief for this
// suite (bun exit 137 mid-suite with both locale blocks resident; see D8
// in deferred-items.md + outcome/4.2-outcome.md). Unset (default) runs
// BOTH locales exactly as before, so no runner changes its behavior.
const STUI_LOCALES: ReadonlyArray<AppLocale> = process.env.STUI_LOCALE
  ? (["ar", "en"] as AppLocale[]).filter(candidate => candidate === process.env.STUI_LOCALE)
  : (["ar", "en"] as AppLocale[]);
for (const locale of STUI_LOCALES) {
  const t = SessionsNs.getLabels(getTranslations(locale));
  const te = ErrorsNs.getLabels(getTranslations(locale));
  const tc = CommonNs.getLabels(getTranslations(locale));

  describe(`StudentSessionsContainer (${locale === "ar" ? "RTL/arabic" : "LTR/english"})`, () => {
    test("branch 1 — query in flight renders the busy skeleton list under the always-on chrome", () => {
      const { container } = renderSessions([pendingListMock()], locale);

      const skeleton = screen.getByTestId("student-sessions-loading");
      expect(skeleton.getAttribute("aria-busy")).toBe("true");
      // No settled surface may leak into the skeleton.
      expect(container.querySelector("[data-testid='student-sessions-empty']")).toBeNull();
      expect(container.querySelector("[data-testid='student-sessions-error']")).toBeNull();
      expect(container.textContent?.includes(t.studentEmptyTitle)).toBe(false);
      // The chrome NEVER drops — title + filter chips stay mounted even on
      // the skeleton (the pre-fix early return stranded the user without
      // them).
      expect(container.querySelector("[data-testid='student-sessions-view']")).not.toBeNull();
      expect(screen.getByText(t.studentPageTitle)).toBeDefined();
      expect(screen.getByRole("button", { name: t.statusFilterAll }).getAttribute("aria-pressed")).toBe("true");
    });

    test("branch 2 — FORBIDDEN renders the shared permission fallback", async () => {
      const { container } = renderSessions([deniedQueryError("FORBIDDEN")], locale);

      await waitFor(() => {
        expect(screen.getByText(te.forbiddenRole)).toBeDefined();
        expect(screen.getByText(te.forbidden)).toBeDefined();
      });
      // The deny surface REPLACES the body only — the chrome stays mounted.
      expect(container.querySelector("[data-testid='student-sessions-view']")).not.toBeNull();
      expect(container.querySelector("[data-testid='student-sessions-loading']")).toBeNull();
      expect(screen.getByText(t.studentPageTitle)).toBeDefined();
    });

    test("branch 3 — masked INTERNAL_SERVER_ERROR surfaces the generic inline alert", async () => {
      const { container } = renderSessions([deniedQueryError("INTERNAL_SERVER_ERROR")], locale);

      await waitFor(() => {
        expect(screen.getByTestId("student-sessions-error")).toBeDefined();
      });
      expect(screen.getByText(t.genericError)).toBeDefined();
      // The permission fallback must NOT appear for non-deny codes.
      expect(screen.queryByText(te.forbiddenRole)).toBeNull();
      expect(container.querySelector("[data-testid='student-sessions-view']")).not.toBeNull();
      expect(screen.getByText(t.studentPageTitle)).toBeDefined();
    });

    test("branch 4 — empty page (all-statuses view) renders the localized empty state under the chrome", async () => {
      const { container } = renderSessions([listPageMock([])], locale);

      await waitFor(() => {
        expect(screen.getByTestId("student-sessions-empty")).toBeDefined();
      });
      expect(screen.getByText(t.studentEmptyTitle)).toBeDefined();
      expect(screen.getByText(t.studentEmptyBody)).toBeDefined();
      expect(container.querySelector("[data-testid='student-sessions-loading']")).toBeNull();
      // The chrome stays mounted above the empty state — title + chips.
      expect(container.querySelector("[data-testid='student-sessions-view']")).not.toBeNull();
      expect(screen.getByText(t.studentPageTitle)).toBeDefined();
      expect(screen.getByRole("button", { name: t.statusFilterAll })).toBeDefined();
    });

    test("branch 5 — populated: rows, status chips per key, verbatim fee, formatted meta", async () => {
      renderSessions([listPageMock(POPULATED_ROWS.map(([session]) => session))], locale);

      await waitFor(() => {
        expect(screen.getByTestId(`session-row-${FIRST_POPULATED_ID}`)).toBeDefined();
      });
      expect(screen.getByText(t.studentPageTitle)).toBeDefined();

      for (const [session, labelKey] of POPULATED_ROWS) {
        const row = screen.getByTestId(`session-row-${session.id}`);
        // Status chip label resolves through the per-status vocabulary key.
        expect(within(row).getByText(t[labelKey])).toBeDefined();
        // Fee renders VERBATIM (never parsed) followed by the currency label.
        const feeText = session.fee === null ? EM_DASH : `${session.fee} ${SESSION_FEE_CURRENCY}`;
        expect(within(row).getAllByText(feeText).length).toBeGreaterThanOrEqual(1);
        expect(within(row).getByText(t.fee)).toBeDefined();
        // Deadline + created expand through the locale date formatter.
        const deadlineText =
          session.confirmationDeadline === null ? EM_DASH : expectedStamp(session.confirmationDeadline, locale);
        expect(within(row).getAllByText(deadlineText).length).toBeGreaterThanOrEqual(1);
        expect(within(row).getAllByText(expectedStamp(session.createdAt, locale)).length).toBeGreaterThanOrEqual(1);
        expect(within(row).getByText(t.deadline)).toBeDefined();
        expect(within(row).getByText(t.createdAt)).toBeDefined();
        // Booking intent renders verbatim from the payload (server-owned value).
        const intentText = session.intent ?? EM_DASH;
        expect(within(row).getAllByText(intentText).length).toBeGreaterThanOrEqual(1);
        expect(within(row).getByText(t.intent)).toBeDefined();
      }
    });

    test("branch 6 — populated: cancel affordance matrix + filter chip toolbar", async () => {
      renderSessions([listPageMock(POPULATED_ROWS.map(([session]) => session))], locale);

      await waitFor(() => {
        expect(screen.getByTestId(`session-row-${FIRST_POPULATED_ID}`)).toBeDefined();
      });

      // The Cancel CTA renders ONLY for Scheduled/Started rows.
      for (const [session] of POPULATED_ROWS) {
        const row = screen.getByTestId(`session-row-${session.id}`);
        const cancelCta = within(row).queryByRole("button", { name: t.cancelSession });
        if (CANCELLABLE_STATUSES.has(session.status)) {
          expect(cancelCta).toBeDefined();
        } else {
          expect(cancelCta).toBeNull();
        }
      }

      // Toolbar: the "all" token is rendered + selected, every reachable
      // status chip is offered — including Disputed (DEV3-005 made the
      // disputed state reachable on participant surfaces, so its chip is
      // offered like any other lifecycle status).
      const allToken = screen.getByRole("button", { name: t.statusFilterAll });
      expect(allToken.getAttribute("aria-pressed")).toBe("true");
      expect(screen.getByRole("button", { name: t.statusScheduled })).toBeDefined();
      expect(screen.getByRole("button", { name: t.statusStarted })).toBeDefined();
      expect(screen.getByRole("button", { name: t.statusCompleted })).toBeDefined();
      expect(screen.getByRole("button", { name: t.statusCancelled })).toBeDefined();
      expect(screen.getByRole("button", { name: t.statusDisputed })).toBeDefined();
    });

    // DEV3-005 (R-110) — branch 6b is the dispute dialog's runner-safe
    // surface: click + submit events DO cross the MUI Dialog portal (only
    // TYPED input is the D8 dead-end), so open → REQUIRED-gate → dismiss
    // runs ACTIVE. No mutation mock is chained: the REQUIRED gate must keep
    // the empty submit off the wire (a leaked call would surface as an
    // unmatched MockLink operation and fail the branch).
    test("branch 6b — dispute dialog (DEV3-005): opens, REQUIRED-reason gate blocks an empty submit, dismisses cleanly", async () => {
      renderSessions([listPageMock([sessionFixture({ id: DISPUTE_SESSION_ID })])], locale);

      await waitFor(() => {
        expect(screen.getByTestId(`session-row-${DISPUTE_SESSION_ID}`)).toBeDefined();
      });

      // 1. Row dispute CTA → the dispute dialog opens (the row holds its
      //    `dispute` in-flight slot while the modal owns the mutation).
      const row = screen.getByTestId(`session-row-${DISPUTE_SESSION_ID}`);
      fireEvent.click(within(row).getByRole("button", { name: t.openDispute }));
      const dialog = await waitFor(() => screen.getByRole("dialog"));
      expect(within(dialog).getByText(t.disputeConfirmTitle)).toBeDefined();
      expect(within(dialog).getByText(t.disputeConfirmBody)).toBeDefined();
      expect(within(dialog).getByRole("button", { name: tc.cancel })).toBeDefined();
      const submitButton = within(dialog).getByRole("button", { name: t.openDispute });
      expect(submitButton.getAttribute("type")).toBe("submit");
      // The counter renders the INITIAL raw-character count.
      expect(within(dialog).getByText(`0/${MAX_DISPUTE_REASON_LENGTH}`)).toBeDefined();

      // 2. Empty submit — the UI-seam REQUIRED gate blocks the wire call:
      //    aria-invalid raises, the localized error helper swaps in for the
      //    counter, and the dialog STAYS OPEN.
      fireEvent.submit(dialog);
      const reasonInput = within(dialog).getByRole("textbox");
      expect(reasonInput.getAttribute("aria-invalid")).toBe("true");
      expect(within(dialog).getByText(t.disputeReasonRequired)).toBeDefined();
      expect(screen.getByRole("dialog")).toBeDefined();

      // 3. Dismissing closes without a mutation (the row's dispute slot
      //    releases with the dialog).
      fireEvent.click(within(dialog).getByRole("button", { name: tc.cancel }));
      await waitFor(() => {
        expect(screen.queryByRole("dialog")).toBeNull();
      });
      // The row is untouched — still scheduled with every affordance live
      // (the dispute slot released with the dialog).
      const settledRow = screen.getByTestId(`session-row-${DISPUTE_SESSION_ID}`);
      expect(within(settledRow).getByText(t.statusScheduled)).toBeDefined();
      expect(within(settledRow).getByRole("button", { name: t.openDispute }).getAttribute("disabled")).toBeNull();
    });

    // D8-class (deferred-items.md D8 family) — SKIPped: the dispute reason
    // is REQUIRED (R-110), so every wire-reaching dispute arm needs TYPED
    // input into the MUI Dialog portal textarea — exactly the input
    // delivery React 19 + Happy DOM do not support (the controlled
    // onChange never fires; the native-setter + bubbled input event is also
    // unreachable). Body INTACT — one-line flip re-enables. Compensating
    // controls: the real-browser DEV3-005 4.1 agent-browser loop (open
    // dispute → chip flips) + the branch-6b empty-submit gate above.
    test.skip("branch 6c — dispute flow typed: live counter → submit → success snackbar + DISPUTED chip flip", async () => {
      renderSessions([listPageMock([sessionFixture({ id: DISPUTE_SESSION_ID })]), disputeSuccessMock()], locale);

      await waitFor(() => {
        expect(screen.getByTestId(`session-row-${DISPUTE_SESSION_ID}`)).toBeDefined();
      });
      const row = screen.getByTestId(`session-row-${DISPUTE_SESSION_ID}`);
      fireEvent.click(within(row).getByRole("button", { name: t.openDispute }));
      const dialog = await waitFor(() => screen.getByRole("dialog"));

      // Type the (padded) reason — the live counter counts RAW characters.
      const reasonInput = within(dialog).getByRole("textbox");
      fireEvent.change(reasonInput, { target: { value: DISPUTE_REASON_TYPED } });
      expect(within(dialog).getByText(`${DISPUTE_REASON_TYPED.length}/${MAX_DISPUTE_REASON_LENGTH}`)).toBeDefined();

      // Submit through the dialog's form element (React.SubmitEvent path).
      fireEvent.submit(dialog);

      // Dialog closes + success snackbar with the dispute-opened copy.
      await waitFor(() => {
        expect(screen.queryByRole("dialog")).toBeNull();
      });
      await waitFor(() => {
        expect(screen.getByText(t.disputeOpenedNotice)).toBeDefined();
      });
      expect(snackbarSeverityClass(t.disputeOpenedNotice)).toContain("MuiAlert-colorSuccess");

      // Row converges via the normalized cache — chip flips to DISPUTED
      // (same id, no refetch); the Cancel CTA stays VISIBLE but DISABLED
      // (the state machine forbids cancelling a disputed session) and the
      // dispute affordance leaves with the lifecycle.
      await waitFor(() => {
        expect(
          within(screen.getByTestId(`session-row-${DISPUTE_SESSION_ID}`)).getByText(t.statusDisputed)
        ).toBeDefined();
      });
      const settledRow = screen.getByTestId(`session-row-${DISPUTE_SESSION_ID}`);
      expect(within(settledRow).queryByText(t.statusScheduled)).toBeNull();
      expect(within(settledRow).queryByRole("button", { name: t.openDispute })).toBeNull();
      expect(
        within(settledRow).getByTestId(`session-action-${DISPUTE_SESSION_ID}-cancel-disabled`).getAttribute("disabled")
      ).not.toBeNull();
    });

    // D8-class (deferred-items.md D8 family) — SKIPped for the same typed-
    // input reason as branch 6c: the dispute error arms are only reachable
    // with a valid typed reason. Body INTACT — one-line flip re-enables.
    // Compensating control: the real-browser DEV3-005 4.1 loop drives the
    // error surface (raced/invalid dispute → localized snackbar).
    test.skip("branch 6d — dispute submit error: SESSION_INVALID_TRANSITION → error snackbar, row stays scheduled", async () => {
      renderSessions(
        [listPageMock([sessionFixture({ id: DISPUTE_SESSION_ID })]), disputeErrorMock("SESSION_INVALID_TRANSITION")],
        locale
      );

      await waitFor(() => {
        expect(screen.getByTestId(`session-row-${DISPUTE_SESSION_ID}`)).toBeDefined();
      });
      const row = screen.getByTestId(`session-row-${DISPUTE_SESSION_ID}`);
      fireEvent.click(within(row).getByRole("button", { name: t.openDispute }));
      const dialog = await waitFor(() => screen.getByRole("dialog"));

      const reasonInput = within(dialog).getByRole("textbox");
      fireEvent.change(reasonInput, { target: { value: DISPUTE_REASON_TYPED } });
      fireEvent.submit(dialog);

      // Error snackbar (the dispute vocabulary is snackbar-mapped, NOT the
      // cancel flow's row-scoped inline alert); the row stays scheduled.
      await waitFor(() => {
        expect(screen.getByText(te.sessionInvalidTransition)).toBeDefined();
      });
      expect(snackbarSeverityClass(te.sessionInvalidTransition)).toContain("MuiAlert-colorError");
      expect(screen.queryByRole("dialog")).toBeNull();
      const settledRow = screen.getByTestId(`session-row-${DISPUTE_SESSION_ID}`);
      expect(within(settledRow).getByText(t.statusScheduled)).toBeDefined();
      expect(within(settledRow).getByRole("button", { name: t.openDispute }).getAttribute("disabled")).toBeNull();
    });

    // DEV3-012 (R-201/R-202) — the confirm affordance matrix. Three
    // Completed shapes on ONE page: the exactly-once pending shape (hold
    // marked + stamp unset → Confirm CTA + awaiting pill), the
    // arbitration-settled shape (hold already consumed → NO affordance —
    // the idempotent mutation would return the row untouched), and the
    // student-stamped shape (the confirm meta cell renders instead).
    test("branch 6e — confirm affordance matrix (DEV3-012): pending vs arbitration-settled vs stamped", async () => {
      const settledId = "9208";
      const stampedId = "9209";
      renderSessions(
        [
          listPageMock([
            CONFIRM_PENDING_SESSION,
            sessionFixture({
              id: settledId,
              status: SessionStatus.Completed,
              fee: "90.00",
              feeHeld: false,
              confirmationDeadline: null,
            }),
            sessionFixture({
              id: stampedId,
              status: SessionStatus.Completed,
              fee: "60.00",
              feeHeld: false,
              confirmedByStudentAt: CONFIRMED_ISO,
              confirmationDeadline: null,
            }),
          ]),
        ],
        locale
      );

      await waitFor(() => {
        expect(screen.getByTestId(`session-row-${CONFIRM_SESSION_ID}`)).toBeDefined();
      });

      // 1. Pending row: Confirm CTA (enabled) + awaiting pill; the terminal
      //    status renders NO cancel (visible-disabled or otherwise) and NO
      //    dispute affordance.
      const pendingRow = screen.getByTestId(`session-row-${CONFIRM_SESSION_ID}`);
      const confirmCta = within(pendingRow).getByRole("button", { name: t.confirmCompletion });
      expect(confirmCta.getAttribute("disabled")).toBeNull();
      expect(within(pendingRow).getByTestId(`session-action-${CONFIRM_SESSION_ID}-confirm`)).toBeDefined();
      expect(within(pendingRow).getByTestId(`session-awaiting-confirmation-${CONFIRM_SESSION_ID}`).textContent).toBe(
        t.awaitingStudentConfirmation
      );
      expect(within(pendingRow).queryByRole("button", { name: t.cancelSession })).toBeNull();
      expect(within(pendingRow).queryByTestId(`session-action-${CONFIRM_SESSION_ID}-cancel-disabled`)).toBeNull();
      expect(within(pendingRow).queryByRole("button", { name: t.openDispute })).toBeNull();
      // The stamp meta cell is absent until the mutation sets it.
      expect(within(pendingRow).queryByText(t.studentConfirmedAt)).toBeNull();

      // 2. Arbitration-settled row (hold consumed, stamp unset): the honest
      //    matrix renders NOTHING to confirm.
      const settledRow = screen.getByTestId(`session-row-${settledId}`);
      expect(within(settledRow).queryByRole("button", { name: t.confirmCompletion })).toBeNull();
      expect(within(settledRow).queryByTestId(`session-awaiting-confirmation-${settledId}`)).toBeNull();

      // 3. Student-stamped row: the confirmation meta cell replaces every
      //    confirm affordance.
      const stampedRow = screen.getByTestId(`session-row-${stampedId}`);
      expect(within(stampedRow).queryByRole("button", { name: t.confirmCompletion })).toBeNull();
      expect(within(stampedRow).queryByTestId(`session-awaiting-confirmation-${stampedId}`)).toBeNull();
      expect(within(stampedRow).getByText(t.studentConfirmedAt)).toBeDefined();
      expect(within(stampedRow).getAllByText(expectedStamp(CONFIRMED_ISO, locale)).length).toBeGreaterThanOrEqual(1);
    });

    // DEV3-012 — the confirm SUCCESS arm runs ACTIVE: no dialog, no typed
    // input — the exact direct-mutation shape the teacher suite proves
    // runner-safe (its branches 7/8).
    test("branch 6f — confirm success: notice snackbar + stamp meta appears + affordances leave via cache", async () => {
      renderSessions([listPageMock([CONFIRM_PENDING_SESSION]), confirmSuccessMock()], locale);

      await waitFor(() => {
        expect(screen.getByTestId(`session-row-${CONFIRM_SESSION_ID}`)).toBeDefined();
      });
      fireEvent.click(
        within(screen.getByTestId(`session-row-${CONFIRM_SESSION_ID}`)).getByRole("button", {
          name: t.confirmCompletion,
        })
      );

      // Success snackbar with the confirmed copy.
      await waitFor(() => {
        expect(screen.getByText(t.sessionConfirmedNotice)).toBeDefined();
      });
      expect(snackbarSeverityClass(t.sessionConfirmedNotice)).toContain("MuiAlert-colorSuccess");

      // The row converges via the normalized cache (same id, NO refetch):
      // the student-stamp meta cell appears, the pending pill + Confirm CTA
      // leave, and the completed chip holds.
      await waitFor(() => {
        expect(
          within(screen.getByTestId(`session-row-${CONFIRM_SESSION_ID}`)).getByText(t.studentConfirmedAt)
        ).toBeDefined();
      });
      const settledRow = screen.getByTestId(`session-row-${CONFIRM_SESSION_ID}`);
      expect(within(settledRow).getAllByText(expectedStamp(CONFIRMED_ISO, locale)).length).toBeGreaterThanOrEqual(1);
      expect(within(settledRow).queryByRole("button", { name: t.confirmCompletion })).toBeNull();
      expect(within(settledRow).queryByTestId(`session-awaiting-confirmation-${CONFIRM_SESSION_ID}`)).toBeNull();
      expect(within(settledRow).getByText(t.statusCompleted)).toBeDefined();
      // The in-flight slot released with no eviction side effect.
      expect(screen.queryByText(te.sessionNotFound)).toBeNull();
    });

    // DEV3-012 — the confirm rejection arm mirrors the teacher lifecycle
    // matrix: SESSION_INVALID_TRANSITION → row-scoped inline alert, row
    // unchanged, CTA re-enabled once the mutation settled.
    test("branch 6g — confirm SESSION_INVALID_TRANSITION: row-scoped inline alert, row unchanged", async () => {
      renderSessions([listPageMock([CONFIRM_PENDING_SESSION]), confirmErrorMock("SESSION_INVALID_TRANSITION")], locale);

      await waitFor(() => {
        expect(screen.getByTestId(`session-row-${CONFIRM_SESSION_ID}`)).toBeDefined();
      });
      fireEvent.click(
        within(screen.getByTestId(`session-row-${CONFIRM_SESSION_ID}`)).getByRole("button", {
          name: t.confirmCompletion,
        })
      );

      await waitFor(() => {
        expect(
          within(screen.getByTestId(`session-row-${CONFIRM_SESSION_ID}`)).getByText(te.sessionInvalidTransition)
        ).toBeDefined();
      });
      const alert = screen.getByText(te.sessionInvalidTransition).closest(".MuiAlert-root");
      expect(alert?.className ?? "").toContain("MuiAlert-colorError");
      // The lifecycle is untouched — chip stays completed, the pending pill
      // holds, no success notice, and the CTA is re-enabled.
      const settledRow = screen.getByTestId(`session-row-${CONFIRM_SESSION_ID}`);
      expect(within(settledRow).getByText(t.statusCompleted)).toBeDefined();
      expect(within(settledRow).getByTestId(`session-awaiting-confirmation-${CONFIRM_SESSION_ID}`)).toBeDefined();
      expect(screen.queryByText(t.sessionConfirmedNotice)).toBeNull();
      expect(within(settledRow).getByRole("button", { name: t.confirmCompletion }).getAttribute("disabled")).toBeNull();
    });

    // D9-class (deferred-items.md D9 family) — SKIPped: the container-owned
    // eviction arm (confirm mutation → `myStudentSessions` list filter +
    // `evict` + `gc()` broadcast into the active useQuery observer) is the
    // SAME cache-surgery-under-active-observer shape the teacher suite
    // documents as killed/runaway deterministically under Happy DOM (its
    // branch 17, exit 124 timeout + multi-GB RSS spiral even run alone).
    // Body INTACT — one-line flip re-enables. Compensating control: the
    // real-browser DEV3-012 4.1 agent-browser loop drives the confirm
    // surface end-to-end (the arm itself is a byte-pattern copy of the
    // teacher container's proven production wiring).
    test.skip("branch 6h — confirm SESSION_NOT_FOUND: error snackbar + row evicted from the list", async () => {
      renderSessions([listPageMock([CONFIRM_PENDING_SESSION]), confirmErrorMock("SESSION_NOT_FOUND")], locale);

      await waitFor(() => {
        expect(screen.getByTestId(`session-row-${CONFIRM_SESSION_ID}`)).toBeDefined();
      });
      fireEvent.click(
        within(screen.getByTestId(`session-row-${CONFIRM_SESSION_ID}`)).getByRole("button", {
          name: t.confirmCompletion,
        })
      );

      // The container's eviction arm: list filtered + entity evicted + gc —
      // the row leaves WITHOUT a refetch and the empty state takes over.
      await waitFor(() => {
        expect(screen.getByText(te.sessionNotFound)).toBeDefined();
      });
      expect(snackbarSeverityClass(te.sessionNotFound)).toContain("MuiAlert-colorError");
      await waitFor(() => {
        expect(screen.queryByTestId(`session-row-${CONFIRM_SESSION_ID}`)).toBeNull();
      });
      expect(screen.getByTestId("student-sessions-empty")).toBeDefined();
    });

    // D8 (deferred-items.md) — branch 7 is SKIPPed in this environment:
    // React 19 + Happy DOM do not deliver dispatched input events into the
    // MUI Dialog portal (the controlled textarea's onChange never fires; the
    // native-setter + bubbled input event is also unreachable), and the bun
    // process OOM-kills mid-suite (exit 137). Compensating control: verified
    // end-to-end in the real-browser agent-browser loop (task 4.2.BF).
    test.skip("branch 7 — cancel flow: dialog → reason → submit → hold-released snackbar + chip flip", async () => {
      renderSessions([listPageMock([CANCELLABLE_SESSION]), cancelSuccessMock()], locale);

      await waitFor(() => {
        expect(screen.getByTestId(`session-row-${CANCEL_SESSION_ID}`)).toBeDefined();
      });

      // 1. Row intent → dialog opens (single Scheduled row → unique CTA).
      const dialog = await openCancelDialog(t.cancelSession);
      expect(within(dialog).getByText(t.cancelConfirmTitle)).toBeDefined();
      expect(within(dialog).getByText(t.cancelConfirmBody)).toBeDefined();
      // Two actions: the Common-namespace dismiss + the type="submit" CTA
      // whose activation walks the React.SubmitEvent path.
      expect(within(dialog).getByRole("button", { name: tc.cancel })).toBeDefined();
      const submitButton = within(dialog).getByRole("button", { name: t.cancelSession });
      expect(submitButton.getAttribute("type")).toBe("submit");

      // 2. Type the (padded) reason — the live counter counts RAW characters.
      const reasonInput = within(dialog).getByRole("textbox");
      fireEvent.change(reasonInput, { target: { value: REASON_TYPED } });
      expect(within(dialog).getByText(`${REASON_TYPED.length}/${MAX_CANCEL_REASON_LENGTH}`)).toBeDefined();

      // 3. Submit through the dialog's form element (React.SubmitEvent).
      fireEvent.submit(dialog);

      // 4. Dialog closes + success snackbar with the hold-release copy.
      await waitFor(() => {
        expect(screen.queryByRole("dialog")).toBeNull();
      });
      await waitFor(() => {
        expect(screen.getByText(t.holdReleasedNotice)).toBeDefined();
      });
      expect(snackbarSeverityClass(t.holdReleasedNotice)).toContain("MuiAlert-colorSuccess");

      // 5. Row converges via the normalized cache — chip flips to cancelled
      //    (same id, no refetch) and the CTA leaves with the lifecycle.
      await waitFor(() => {
        const settledRow = screen.getByTestId(`session-row-${CANCEL_SESSION_ID}`);
        expect(within(settledRow).getByText(t.statusCancelled)).toBeDefined();
      });
      const settledRow = screen.getByTestId(`session-row-${CANCEL_SESSION_ID}`);
      expect(within(settledRow).queryByText(t.statusScheduled)).toBeNull();
      expect(within(settledRow).queryByRole("button", { name: t.cancelSession })).toBeNull();
    });

    // D9 (deferred-items.md) — branch 8 is SKIPPed in this environment: the
    // dialog's SESSION_NOT_FOUND cache-eviction arm (`cache.modify` + `evict`
    // + `gc()` broadcast into the active useQuery observer) runs away under
    // bun 1.3.14 + React 19 + Happy DOM — bun balloons to ~3.5GB RSS and is
    // OOM-killed (exit 137) deterministically, even with branch 8 run ALONE
    // via `-t` (branches 1-6/9-11 green; allocator + JSC heap caps don't
    // help). Real-browser compensating control: task 4.2.BF explicitly
    // asserts cache-driven row removal on SESSION_NOT_FOUND in Chromium.
    test.skip("branch 8 — SESSION_NOT_FOUND: error snackbar + row evicted from the list", async () => {
      renderSessions([listPageMock([CANCELLABLE_SESSION]), cancelErrorMock("SESSION_NOT_FOUND")], locale);

      await waitFor(() => {
        expect(screen.getByTestId(`session-row-${CANCEL_SESSION_ID}`)).toBeDefined();
      });

      await openCancelDialog(t.cancelSession);
      fireEvent.submit(screen.getByRole("dialog"));

      // Cache eviction + list filtering are the dialog's not-found arm — the
      // row has already left the list (the empty state takes over) here.
      await waitFor(() => {
        expect(screen.queryByTestId(`session-row-${CANCEL_SESSION_ID}`)).toBeNull();
      });
      expect(screen.getByTestId("student-sessions-empty")).toBeDefined();
      await waitFor(() => {
        expect(screen.getByText(te.sessionNotFound)).toBeDefined();
      });
      expect(snackbarSeverityClass(te.sessionNotFound)).toContain("MuiAlert-colorError");
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    test("branch 9 — SESSION_INVALID_TRANSITION: row-scoped inline alert, row stays", async () => {
      renderSessions([listPageMock([CANCELLABLE_SESSION]), cancelErrorMock("SESSION_INVALID_TRANSITION")], locale);

      await waitFor(() => {
        expect(screen.getByTestId(`session-row-${CANCEL_SESSION_ID}`)).toBeDefined();
      });

      await openCancelDialog(t.cancelSession);
      fireEvent.submit(screen.getByRole("dialog"));

      await waitFor(() => {
        const row = screen.getByTestId(`session-row-${CANCEL_SESSION_ID}`);
        expect(within(row).getByText(te.sessionInvalidTransition)).toBeDefined();
      });
      const alert = screen.getByText(te.sessionInvalidTransition).closest(".MuiAlert-root");
      expect((alert?.className ?? "").includes("MuiAlert-colorError")).toBe(true);
      // The lifecycle is untouched — chip stays scheduled, no snackbar fired.
      const row = screen.getByTestId(`session-row-${CANCEL_SESSION_ID}`);
      expect(within(row).getByText(t.statusScheduled)).toBeDefined();
      expect(screen.queryByText(t.holdReleasedNotice)).toBeNull();
      expect(screen.queryByText(te.sessionNotFound)).toBeNull();
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    test("branch 10 — DUPLICATE_REQUEST: informational snackbar, never an error treatment", async () => {
      renderSessions([listPageMock([CANCELLABLE_SESSION]), cancelErrorMock("DUPLICATE_REQUEST")], locale);

      await waitFor(() => {
        expect(screen.getByTestId(`session-row-${CANCEL_SESSION_ID}`)).toBeDefined();
      });

      await openCancelDialog(t.cancelSession);
      fireEvent.submit(screen.getByRole("dialog"));

      await waitFor(() => {
        expect(screen.getByText(t.duplicateBookingInfo)).toBeDefined();
      });
      expect(snackbarSeverityClass(t.duplicateBookingInfo)).toContain("MuiAlert-colorInfo");
      // Success-equivalent: row intact, no inline alert, dialog closed.
      const row = screen.getByTestId(`session-row-${CANCEL_SESSION_ID}`);
      expect(within(row).getByText(t.statusScheduled)).toBeDefined();
      expect(within(row).queryByText(te.sessionInvalidTransition)).toBeNull();
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    test("branch 11 — copy contract: rendered copy equals preloaded labels (sample pin)", async () => {
      renderSessions([listPageMock([CANCELLABLE_SESSION])], locale);

      await waitFor(() => {
        expect(screen.getByTestId(`session-row-${CANCEL_SESSION_ID}`)).toBeDefined();
      });

      // The heading and the row CTA are EXACTLY the preloaded label strings.
      expect(screen.getByText(t.studentPageTitle).textContent).toBe(t.studentPageTitle);
      expect(screen.getByRole("button", { name: t.cancelSession }).textContent).toBe(t.cancelSession);
      // The fee is verbatim decimal + currency — never reformatted.
      expect(screen.getByText(`${CANCELLABLE_SESSION.fee} ${SESSION_FEE_CURRENCY}`)).toBeDefined();
      // No raw translation handles or ICU placeholders may leak into the DOM.
      const bodyText = document.body.textContent ?? "";
      expect(bodyText).not.toContain("studentPageTitle");
      expect(bodyText).not.toContain("sessions.sessions");
      expect(bodyText).not.toContain("{");
      expect(bodyText).not.toContain("}");
    });

    test("branch 12 — filtered-empty keeps the filter chips mounted and swaps in the distinct filtered copy", async () => {
      // One Scheduled row only — clicking the Cancelled chip re-keys the
      // query variables and the Cancelled page settles EMPTY.
      renderSessions(
        [listPageMock([sessionFixture({ id: FIRST_POPULATED_ID })]), filteredPageMock(SessionStatus.Cancelled, [])],
        locale
      );

      await waitFor(() => {
        expect(screen.getByTestId(`session-row-${FIRST_POPULATED_ID}`)).toBeDefined();
      });

      fireEvent.click(screen.getByRole("button", { name: t.statusCancelled }));

      // The empty-state testid survives the re-key…
      await waitFor(() => {
        expect(screen.getByTestId("student-sessions-empty")).toBeDefined();
      });
      // …the filter chips row is STILL in the DOM with the clicked chip
      // selected (the pre-fix early return dropped the chrome here)…
      expect(screen.getByText(t.studentPageTitle)).toBeDefined();
      const cancelledChip = screen.getByRole("button", { name: t.statusCancelled });
      expect(cancelledChip.getAttribute("aria-pressed")).toBe("true");
      expect(screen.getByRole("button", { name: t.statusFilterAll })).toBeDefined();
      // …and the DISTINCT filtered-empty copy renders (never the generic).
      expect(screen.getByText(t.filteredEmptyTitle)).toBeDefined();
      expect(screen.getByText(t.filteredEmptyBody)).toBeDefined();
      expect(screen.queryByText(t.studentEmptyTitle)).toBeNull();
      expect(screen.queryByText(t.studentEmptyBody)).toBeNull();
    });
  });
}
