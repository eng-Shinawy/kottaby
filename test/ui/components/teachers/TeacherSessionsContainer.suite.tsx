/**
 * TeacherSessionsContainer — component suite BODY.
 *
 * NOT a runner target: `bun test` collects `*.test.*` files only, and this
 * file carries the suite implementation on behalf of the sibling bootstrap
 * `TeacherSessionsContainer.test.tsx` (see that file for WHY the suite is
 * split — short version: react-dom must first evaluate with the Happy-DOM
 * document already registered, or React's `isInputEventSupported` flag is
 * computed `false` and controlled `onChange` can never fire).
 *
 * Happy DOM + Apollo `MockedProvider` tier (`test/ui/components/teachers`,
 * mirroring the student sessions suite structure exactly): ONE render case
 * per branch of the teacher sessions visual state matrix, driven across BOTH
 * locales:
 *
 *   loading skeleton · FORBIDDEN fallback · generic error · applicant EMPTY
 *   page (all of them keeping the ALWAYS-ON title + filter-chips chrome
 *   mounted — the 4.BFBS filtered-empty fix) · populated rows (status chips
 *   per key · verbatim fee + currency · formatted deadline/created ·
 *   Start/Complete/Cancel action-visibility matrix — NOTHING on terminal
 *   rows) · per-mutation in-flight disabling · concurrent same-kind starts
 *   (per-row slots: both CTAs disable together, each resolves independently)
 *   · start success (chip flip via cache normalization) · complete success
 *   (terminal) · TEACHER_NOT_CERTIFIED (inline row alert) ·
 *   SESSION_INVALID_TRANSITION (inline row alert, CTA + reused-dialog
 *   submit) · cancel dialog open/dismiss/submit-affordance · filtered-empty
 *   (chips stay mounted + distinct filtered copy) · copy contract pin. The
 *   dialog's typing/success/eviction arms and the container's eviction arm
 *   are the documented environment deferrals (D8/D9 family — see the
 *   test.skip comments; compensated by 4.3.BF).
 *
 * Translation discipline: assertions reference ONLY the PRELOADED label
 * objects resolved through `Sessions.getLabels(getTranslations(locale))`,
 * `Errors.getLabels(...)` and `Common.getLabels(...)` — ZERO hardcoded
 * Arabic/English copy lives here. The one exception class is fixture DATA
 * (ids, enum-valued intents, timestamps) plus the deadline/created stamps,
 * which are recomputed with a local `Intl.DateTimeFormat` clone of the
 * documented option set (byte-consistency technique used by the service-
 * layer suite).
 *
 * Preload parity: the `test:ui:components` preload chain (test-env →
 * happydom → translation-preload → next-dynamic-mock) is owned by the
 * bootstrap entry, which registers the DOM BEFORE this module — and its
 * node_modules dependencies — are evaluated.
 *
 * Static discipline verified alongside (grep):
 *   - `useLazyQuery` appears NOWHERE in the view or its consumers;
 *   - the ONLY `.skip(` markers in this suite are the deliberate
 *     environment deferrals of the D8/D9 family carried over from the
 *     student suite (typing · dialog eviction · dialog SUCCESS submit arm ·
 *     container eviction arm — all cache-surgery/portal combinations under
 *     bun 1.3.14 + React 19 + Happy DOM) — never a `test.only(` or a
 *     silent drop; every deferred flow is compensated by the real-browser
 *     4.3.BF loop.
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
  type MyTeacherSessionsQuery_myTeacherSessions_items,
  SessionIntent,
  SessionStatus,
  SessionType,
} from "@/frontend/graphql/generated/gql/graphql";
import {
  cancelSessionMutationDocument,
  completeSessionMutationDocument,
  myTeacherSessionsQueryDocument,
  openSessionDisputeMutationDocument,
  startSessionMutationDocument,
} from "@/frontend/graphql/sharedDocuments";
import { MAX_CANCEL_REASON_LENGTH } from "@/frontend/views/student/sessions/CancelSessionConfirmDialog";
import { MAX_DISPUTE_REASON_LENGTH } from "@/frontend/views/student/sessions/SessionDisputeConfirmDialog";
import { TeacherSessionsContainer } from "@/frontend/views/teacher/sessions/TeacherSessionsContainer";
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
 * container's and the dialog's cache `update`/eviction arms converge the
 * list WITHOUT refetch.
 */
interface SessionFixture extends MyTeacherSessionsQuery_myTeacherSessions_items {
  readonly __typename: "Session";
}

/** Creation moment shared by every fixture row (deterministic formatting). */
const CREATED_ISO = "2099-02-10T09:15:00.000Z";

/** Confirmation deadline for cancellable rows (different day from created). */
const DEADLINE_ISO = "2099-02-11T18:45:00.000Z";

/** Start-transition moment returned by the startSession success mock. */
const STARTED_ISO = "2099-02-10T10:00:00.000Z";

/** Complete-transition moment returned by the completeSession success mock. */
const ENDED_ISO = "2099-02-10T11:30:00.000Z";

/** Dispute-open moment returned by the openSessionDispute success mock. */
const DISPUTED_ISO = "2099-02-10T12:05:00.000Z";

/** First row id of the populated page (settled-render wait handle). */
const FIRST_POPULATED_ID = "9301";

/** The Scheduled row exercised by the start/cancel flows. */
const ROW_SCHEDULED_A = "9301";

/** The Started row exercised by the complete flows. */
const ROW_STARTED = "9302";

/** Second Scheduled row — proves sibling rows stay live during in-flight. */
const ROW_SCHEDULED_B = "9306";

/** Raw text typed into the dialog in the DEFERRED typing branch (padded). */
const REASON_TYPED = "  Parent requested early finish  ";

/** The trimmed value the dialog sends on the wire (`reason` is optional). */
const REASON_SENT = REASON_TYPED.trim();

/** Raw text typed into the dispute dialog in the DEFERRED typing branch. */
const DISPUTE_REASON_TYPED = "  Teacher never joined the call  ";

/** The trimmed value the dispute dialog sends on the wire (reason REQUIRED). */
const DISPUTE_REASON_SENT = DISPUTE_REASON_TYPED.trim();

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
function sessionFixture(overrides?: Partial<MyTeacherSessionsQuery_myTeacherSessions_items>): SessionFixture {
  return {
    __typename: "Session",
    id: ROW_SCHEDULED_A,
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

/** The Scheduled row exercised by the start/cancel flows (fee pinned by the copy branch). */
const SCHEDULED_ROW = sessionFixture({
  id: ROW_SCHEDULED_A,
  intent: SessionIntent.Hifz,
  fee: "150.50",
  feeHeld: true,
});

/** One populated page: one row per REACHABLE status (incl. Disputed), mixed nullable meta. */
const POPULATED_ROWS: ReadonlyArray<readonly [SessionFixture, StatusChipLabelKey]> = [
  [SCHEDULED_ROW, "statusScheduled"],
  [
    sessionFixture({ id: ROW_STARTED, status: SessionStatus.Started, intent: SessionIntent.Tajweed, fee: "200.00" }),
    "statusStarted",
  ],
  [
    sessionFixture({
      id: "9303",
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
      id: "9304",
      status: SessionStatus.Cancelled,
      intent: null,
      fee: null,
      feeHeld: false,
      confirmationDeadline: null,
    }),
    "statusCancelled",
  ],
  [
    sessionFixture({ id: "9305", status: SessionStatus.Disputed, intent: SessionIntent.Tajweed, fee: "75.00" }),
    "statusDisputed",
  ],
];

/** The transition payloads the success mocks return (same ids, new lifecycle). */
const STARTED_PAYLOAD = sessionFixture({ id: ROW_SCHEDULED_A, status: SessionStatus.Started, startedAt: STARTED_ISO });
const COMPLETED_PAYLOAD = sessionFixture({
  id: ROW_STARTED,
  status: SessionStatus.Completed,
  startedAt: STARTED_ISO,
  endedAt: ENDED_ISO,
  confirmedByTeacherAt: ENDED_ISO,
  feeHeld: false,
});
const CANCELLED_PAYLOAD = sessionFixture({ id: ROW_SCHEDULED_A, status: SessionStatus.Cancelled, feeHeld: false });

/**
 * Lifecycle → expected visible teacher CTAs (Record lookup keyed by the enum
 * member strings — never an enum comparison). DEV3-005 extends the matrix:
 * the dispute affordance joins Start/Cancel on disputable rows, and a
 * DISPUTED row keeps the Cancel CTA VISIBLE but DISABLED (`cancel-disabled`
 * — the state machine forbids cancelling it; the ONLY edge out is admin
 * arbitration). Terminal rows render NOTHING.
 */
type ActionKind = "start" | "complete" | "cancel" | "dispute" | "cancel-disabled";
const ACTIONS: readonly ActionKind[] = ["start", "complete", "cancel", "dispute", "cancel-disabled"];
const EXPECTED_ACTIONS_BY_STATUS: Record<string, readonly ActionKind[]> = {
  [SessionStatus.Scheduled]: ["start", "cancel", "dispute"],
  [SessionStatus.Started]: ["complete", "cancel", "dispute"],
  [SessionStatus.Completed]: [],
  [SessionStatus.Cancelled]: [],
  [SessionStatus.Disputed]: ["cancel-disabled"],
};

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
function teacherListPageMock(items: ReadonlyArray<SessionFixture>): MockLink.MockedResponse {
  return {
    request: { query: myTeacherSessionsQueryDocument, variables: ALL_FILTER_VARIABLES },
    result: {
      data: {
        myTeacherSessions: {
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
function teacherFilteredPageMock(status: SessionStatus, items: ReadonlyArray<SessionFixture>): MockLink.MockedResponse {
  return {
    request: { query: myTeacherSessionsQueryDocument, variables: filteredFilterVariables(status) },
    result: {
      data: {
        myTeacherSessions: {
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
    request: { query: myTeacherSessionsQueryDocument, variables: ALL_FILTER_VARIABLES },
    delay: Infinity,
  };
}

/**
 * Single-operation mock denying the caller at the scope layer. The deny is
 * authored as a raw `result.errors[]` entry exactly where the transport
 * boundary puts `extensions.code`; Apollo's MockedProvider wraps it into a
 * genuine `CombinedGraphQLErrors`, which `extractErrorCode` traverses.
 */
function deniedQueryError(code: string): MockLink.MockedResponse {
  return {
    request: { query: myTeacherSessionsQueryDocument, variables: ALL_FILTER_VARIABLES },
    result: {
      errors: [{ message: `${code} (masked transport surface)`, extensions: { code } }],
    },
  };
}

/** Start-mutation mock resolving the started session payload (no refetch). */
function startSuccessMock(sessionId: string, payload: SessionFixture): MockLink.MockedResponse {
  return {
    request: { query: startSessionMutationDocument, variables: { id: sessionId } },
    result: { data: { startSession: payload } },
  };
}

/** Start-mutation mock failing with a transport-shaped `extensions.code`. */
function startErrorMock(sessionId: string, code: string): MockLink.MockedResponse {
  return {
    request: { query: startSessionMutationDocument, variables: { id: sessionId } },
    result: {
      errors: [{ message: `${code} (masked transport surface)`, extensions: { code } }],
    },
  };
}

/** Permanently in-flight start mutation — the own-row disabled-state probe. */
function pendingStartMock(sessionId: string): MockLink.MockedResponse {
  return {
    request: { query: startSessionMutationDocument, variables: { id: sessionId } },
    delay: Infinity,
  };
}

/** Complete-mutation mock resolving the completed session payload. */
function completeSuccessMock(sessionId: string, payload: SessionFixture): MockLink.MockedResponse {
  return {
    request: { query: completeSessionMutationDocument, variables: { id: sessionId } },
    result: { data: { completeSession: payload } },
  };
}

/** Complete-mutation mock failing with a transport-shaped `extensions.code`. */
function completeErrorMock(sessionId: string, code: string): MockLink.MockedResponse {
  return {
    request: { query: completeSessionMutationDocument, variables: { id: sessionId } },
    result: {
      errors: [{ message: `${code} (masked transport surface)`, extensions: { code } }],
    },
  };
}

/** Cancel-mutation mock resolving the cancelled payload (empty reason → null). */
function teacherCancelSuccessMock(sessionId: string, payload: SessionFixture): MockLink.MockedResponse {
  return {
    request: { query: cancelSessionMutationDocument, variables: { id: sessionId, reason: null } },
    result: { data: { cancelSession: payload } },
  };
}

/** Cancel-mutation mock WITH a reason — used only by the DEFERRED D8 branch. */
function teacherCancelSuccessWithReasonMock(
  sessionId: string,
  reason: string,
  payload: SessionFixture
): MockLink.MockedResponse {
  return {
    request: { query: cancelSessionMutationDocument, variables: { id: sessionId, reason } },
    result: { data: { cancelSession: payload } },
  };
}

/** Cancel-mutation mock failing with a transport-shaped `extensions.code`. */
function teacherCancelErrorMock(sessionId: string, code: string): MockLink.MockedResponse {
  return {
    request: { query: cancelSessionMutationDocument, variables: { id: sessionId, reason: null } },
    result: {
      errors: [{ message: `${code} (masked transport surface)`, extensions: { code } }],
    },
  };
}

/** Dispute-mutation mock resolving the disputed payload (reason persisted). */
function disputeSuccessMock(sessionId: string, payload: SessionFixture): MockLink.MockedResponse {
  return {
    request: { query: openSessionDisputeMutationDocument, variables: { id: sessionId, reason: DISPUTE_REASON_SENT } },
    result: { data: { openSessionDispute: payload } },
  };
}

/** Dispute-mutation mock failing with a transport-shaped `extensions.code`. */
function disputeErrorMock(sessionId: string, code: string): MockLink.MockedResponse {
  return {
    request: { query: openSessionDisputeMutationDocument, variables: { id: sessionId, reason: DISPUTE_REASON_SENT } },
    result: {
      errors: [{ message: `${code} (masked transport surface)`, extensions: { code } }],
    },
  };
}

/** The disputed wire payload the dispute success mock returns (same id). */
const DISPUTED_PAYLOAD = sessionFixture({
  id: ROW_SCHEDULED_A,
  status: SessionStatus.Disputed,
  disputeReason: DISPUTE_REASON_SENT,
  disputedAt: DISPUTED_ISO,
});

// ---------------------------------------------------------------------------
// Render + expectation helpers

/**
 * Lazily-bound `screen` replacement (student-suite pattern): bound through
 * `getQueriesForElement(document.body)` on EVERY property access so it
 * resolves against the live DOM under BOTH runners regardless of import
 * order (RTL binds its singleton `screen` at module-eval time).
 */
const screen: Screen = new Proxy(Object.create(null), {
  get: (_target, property, receiver) => Reflect.get(getQueriesForElement(document.body), property, receiver),
});

/** Renders the container under TestWrapper (LocaleProvider → emotion → theme). */
function renderTeacherSessions(mocks: ReadonlyArray<MockLink.MockedResponse>, locale: AppLocale): RenderResult {
  const mocksCopy = [...mocks];
  return renderWithWrapper(
    <MockedProvider mocks={mocksCopy}>
      <TeacherSessionsContainer />
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
async function openCancelDialog(row: HTMLElement, cancelLabel: string): Promise<HTMLElement> {
  fireEvent.click(within(row).getByRole("button", { name: cancelLabel }));
  return await waitFor(() => screen.getByRole("dialog"));
}

/**
 * Waits for a settled session row and resolves it (the wait-then-fetch
 * prologue every populated branch shares — extracted so the branch bodies
 * carry ONLY their unique assertions).
 */
async function waitForSessionRow(sessionId: string): Promise<HTMLElement> {
  await waitFor(() => {
    expect(screen.getByTestId(`session-row-${sessionId}`)).toBeDefined();
  });
  return screen.getByTestId(`session-row-${sessionId}`);
}

/**
 * Renders the container with `mocks`, waits for `sessionId`'s row to settle
 * and clicks one of its CTAs (label resolved by the caller from the
 * preloaded labels) — the shared prologue of the mutation-flow branches.
 */
async function renderAndClickRowAction(
  mocks: ReadonlyArray<MockLink.MockedResponse>,
  locale: AppLocale,
  sessionId: string,
  actionLabel: string
): Promise<void> {
  renderTeacherSessions(mocks, locale);
  const row = await waitForSessionRow(sessionId);
  fireEvent.click(within(row).getByRole("button", { name: actionLabel }));
}

/**
 * Renders the container, waits for the row, opens the reused cancel dialog
 * and submits its form — the shared prologue of the dialog-outcome branches
 * (submit walks the form's React.SubmitEvent path).
 */
async function renderAndSubmitCancelDialog(
  mocks: ReadonlyArray<MockLink.MockedResponse>,
  locale: AppLocale,
  sessionId: string,
  cancelLabel: string
): Promise<void> {
  renderTeacherSessions(mocks, locale);
  const row = await waitForSessionRow(sessionId);
  await openCancelDialog(row, cancelLabel);
  fireEvent.submit(screen.getByRole("dialog"));
}

/**
 * Asserts the SESSION_NOT_FOUND convergence shared by the (deferred) dialog
 * and container eviction branches: the row has left the list, the localized
 * empty state took over, and the error snackbar carries the not-found copy.
 */
async function expectRowEvictedToEmptyState(sessionId: string, notFoundCopy: string): Promise<void> {
  await waitFor(() => {
    expect(screen.queryByTestId(`session-row-${sessionId}`)).toBeNull();
  });
  expect(screen.getByTestId("teacher-sessions-empty")).toBeDefined();
  await waitFor(() => {
    expect(screen.getByText(notFoundCopy)).toBeDefined();
  });
  expect(snackbarSeverityClass(notFoundCopy)).toContain("MuiAlert-colorError");
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
// executes ONLY that locale's block — the sanctioned OOM relief carried
// over from the student suite. Unset (default) runs BOTH locales exactly
// as before, so no runner changes its behavior.
const STUI_LOCALES: ReadonlyArray<AppLocale> = process.env.STUI_LOCALE
  ? (["ar", "en"] as AppLocale[]).filter(candidate => candidate === process.env.STUI_LOCALE)
  : (["ar", "en"] as AppLocale[]);
for (const locale of STUI_LOCALES) {
  const t = SessionsNs.getLabels(getTranslations(locale));
  const te = ErrorsNs.getLabels(getTranslations(locale));
  const tc = CommonNs.getLabels(getTranslations(locale));

  /** Per-kind CTA labels resolved through the preloaded Sessions labels. */
  const BUTTON_LABEL_BY_ACTION: Record<ActionKind, string> = {
    start: t.startSession,
    complete: t.completeSession,
    cancel: t.cancelSession,
    dispute: t.openDispute,
    // The DISABLED cancel CTA a disputed row keeps visible (DEV3-005).
    "cancel-disabled": t.cancelSession,
  };

  /**
   * One row's ACTION-VISIBILITY MATRIX assertion (module-scope helper so the
   * branch-5 test stays under its cognitive-complexity budget). Start on
   * Scheduled, Complete on Started, Cancel + dispute on both, a DISABLED
   * Cancel on disputed rows, NOTHING on terminal rows. `cancel-disabled`
   * additionally asserts the disabled attribute (the state machine keeps the
   * CTA visible but inert).
   */
  function expectRowActions(row: HTMLElement, session: SessionFixture): void {
    const expectedActions = EXPECTED_ACTIONS_BY_STATUS[session.status] ?? [];
    for (const action of ACTIONS) {
      // `cancel-disabled` resolves through its DEDICATED testid — a role
      // query would collide with the ENABLED cancel CTA (same accessible
      // name) on scheduled/started rows.
      let cta: HTMLElement | null;
      if (action === "cancel-disabled") {
        cta = within(row).queryByTestId(`session-action-${session.id}-cancel-disabled`);
      } else if (action === "cancel" && session.status === SessionStatus.Disputed) {
        // A disputed row keeps the DISABLED cancel CTA whose accessible name
        // COLLIDES with the enabled-cancel role query — resolve the enabled
        // variant through its dedicated action testid instead (absent on
        // disputed rows; the disabled variant is covered by `cancel-disabled`
        // above).
        cta = within(row).queryByTestId(`session-action-${session.id}-cancel`);
      } else {
        cta = within(row).queryByRole("button", { name: BUTTON_LABEL_BY_ACTION[action] });
      }
      if (expectedActions.includes(action)) {
        expect(cta).not.toBeNull();
        if (action === "cancel-disabled") {
          expect(cta?.getAttribute("disabled")).not.toBeNull();
        }
      } else {
        expect(cta).toBeNull();
      }
    }
  }

  describe(`TeacherSessionsContainer (${locale === "ar" ? "RTL/arabic" : "LTR/english"})`, () => {
    test("branch 1 — query in flight renders the busy skeleton list under the always-on chrome", () => {
      const { container } = renderTeacherSessions([pendingListMock()], locale);

      const skeleton = screen.getByTestId("teacher-sessions-loading");
      expect(skeleton.getAttribute("aria-busy")).toBe("true");
      // No settled surface may leak into the skeleton.
      expect(container.querySelector("[data-testid='teacher-sessions-empty']")).toBeNull();
      expect(container.querySelector("[data-testid='teacher-sessions-error']")).toBeNull();
      expect(container.textContent?.includes(t.teacherEmptyTitle)).toBe(false);
      // The chrome NEVER drops — title + filter chips stay mounted even on
      // the skeleton (the pre-fix early return stranded the user without
      // them).
      expect(container.querySelector("[data-testid='teacher-sessions-view']")).not.toBeNull();
      expect(screen.getByText(t.teacherPageTitle)).toBeDefined();
      expect(screen.getByRole("button", { name: t.statusFilterAll }).getAttribute("aria-pressed")).toBe("true");
    });

    test("branch 2 — FORBIDDEN renders the shared permission fallback", async () => {
      const { container } = renderTeacherSessions([deniedQueryError("FORBIDDEN")], locale);

      await waitFor(() => {
        expect(screen.getByText(te.forbiddenRole)).toBeDefined();
        expect(screen.getByText(te.forbidden)).toBeDefined();
      });
      // The deny surface REPLACES the body only — the chrome stays mounted.
      expect(container.querySelector("[data-testid='teacher-sessions-view']")).not.toBeNull();
      expect(container.querySelector("[data-testid='teacher-sessions-loading']")).toBeNull();
      expect(screen.getByText(t.teacherPageTitle)).toBeDefined();
    });

    test("branch 3 — masked INTERNAL_SERVER_ERROR surfaces the generic inline alert", async () => {
      const { container } = renderTeacherSessions([deniedQueryError("INTERNAL_SERVER_ERROR")], locale);

      await waitFor(() => {
        expect(screen.getByTestId("teacher-sessions-error")).toBeDefined();
      });
      expect(screen.getByText(t.genericError)).toBeDefined();
      // The permission fallback must NOT appear for non-deny codes.
      expect(screen.queryByText(te.forbiddenRole)).toBeNull();
      expect(container.querySelector("[data-testid='teacher-sessions-view']")).not.toBeNull();
      expect(screen.getByText(t.teacherPageTitle)).toBeDefined();
    });

    test("branch 4 — applicant teacher (empty all-statuses page, never an error) renders the localized empty state under the chrome", async () => {
      const { container } = renderTeacherSessions([teacherListPageMock([])], locale);

      await waitFor(() => {
        expect(screen.getByTestId("teacher-sessions-empty")).toBeDefined();
      });
      expect(screen.getByText(t.teacherEmptyTitle)).toBeDefined();
      expect(screen.getByText(t.teacherEmptyBody)).toBeDefined();
      // NEVER an error treatment for the applicant teacher.
      expect(container.querySelector("[data-testid='teacher-sessions-error']")).toBeNull();
      expect(container.querySelector("[data-testid='teacher-sessions-loading']")).toBeNull();
      expect(screen.queryByText(te.forbiddenRole)).toBeNull();
      // The chrome stays mounted above the empty state — title + chips.
      expect(container.querySelector("[data-testid='teacher-sessions-view']")).not.toBeNull();
      expect(screen.getByText(t.teacherPageTitle)).toBeDefined();
      expect(screen.getByRole("button", { name: t.statusFilterAll })).toBeDefined();
    });

    test("branch 5 — populated: rows, chips per key, verbatim fee, formatted meta, action-visibility matrix", async () => {
      renderTeacherSessions([teacherListPageMock(POPULATED_ROWS.map(([session]) => session))], locale);

      await waitForSessionRow(FIRST_POPULATED_ID);
      expect(screen.getByText(t.teacherPageTitle)).toBeDefined();

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

        // ACTION-VISIBILITY MATRIX (module-scope helper — see its docblock).
        expectRowActions(row, session);
      }

      // Toolbar: the "all" token is rendered + selected and every lifecycle
      // status chip is offered — INCLUDING Disputed (DEV3-005 made the
      // disputed state reachable on participant surfaces, so its filter
      // chip is offered like any other lifecycle status).
      const allToken = screen.getByRole("button", { name: t.statusFilterAll });
      expect(allToken.getAttribute("aria-pressed")).toBe("true");
      expect(screen.getByRole("button", { name: t.statusScheduled })).toBeDefined();
      expect(screen.getByRole("button", { name: t.statusStarted })).toBeDefined();
      expect(screen.getByRole("button", { name: t.statusCompleted })).toBeDefined();
      expect(screen.getByRole("button", { name: t.statusCancelled })).toBeDefined();
      expect(screen.getByRole("button", { name: t.statusDisputed })).toBeDefined();
    });

    test("branch 6 — in-flight: the START CTA disables on ITS row only (cancel + siblings stay live)", async () => {
      const scheduledRowA = sessionFixture({ id: ROW_SCHEDULED_A });
      const scheduledRowB = sessionFixture({ id: ROW_SCHEDULED_B });
      await renderAndClickRowAction(
        [teacherListPageMock([scheduledRowA, scheduledRowB]), pendingStartMock(ROW_SCHEDULED_A)],
        locale,
        ROW_SCHEDULED_A,
        t.startSession
      );

      // Row A's own Start is disabled while ITS mutation is in flight…
      await waitFor(() => {
        const rowA = screen.getByTestId(`session-row-${ROW_SCHEDULED_A}`);
        expect(within(rowA).getByRole("button", { name: t.startSession }).getAttribute("disabled")).not.toBeNull();
      });
      // …the sibling row's Start stays live…
      const rowB = screen.getByTestId(`session-row-${ROW_SCHEDULED_B}`);
      expect(within(rowB).getByRole("button", { name: t.startSession }).getAttribute("disabled")).toBeNull();
      // …and the row's CANCEL affordance (a DIFFERENT mutation) stays live.
      const rowA = screen.getByTestId(`session-row-${ROW_SCHEDULED_A}`);
      expect(within(rowA).getByRole("button", { name: t.cancelSession }).getAttribute("disabled")).toBeNull();
    });

    test("branch 7 — start success: notice snackbar + chip flips to started via cache normalization", async () => {
      await renderAndClickRowAction(
        [
          teacherListPageMock([sessionFixture({ id: ROW_SCHEDULED_A })]),
          startSuccessMock(ROW_SCHEDULED_A, STARTED_PAYLOAD),
        ],
        locale,
        ROW_SCHEDULED_A,
        t.startSession
      );

      await waitFor(() => {
        expect(screen.getByText(t.sessionStartedNotice)).toBeDefined();
      });
      expect(snackbarSeverityClass(t.sessionStartedNotice)).toContain("MuiAlert-colorSuccess");

      // The row converges via the normalized cache — chip flips to started
      // (same id, NO refetch) and the affordances advance with the lifecycle.
      await waitFor(() => {
        expect(within(screen.getByTestId(`session-row-${ROW_SCHEDULED_A}`)).getByText(t.statusStarted)).toBeDefined();
      });
      const settledRow = screen.getByTestId(`session-row-${ROW_SCHEDULED_A}`);
      expect(within(settledRow).queryByText(t.statusScheduled)).toBeNull();
      expect(within(settledRow).queryByRole("button", { name: t.startSession })).toBeNull();
      expect(within(settledRow).getByRole("button", { name: t.completeSession })).toBeDefined();
      expect(within(settledRow).getByRole("button", { name: t.cancelSession })).toBeDefined();
    });

    test("branch 8 — complete success: notice snackbar + terminal row exposes NO actions", async () => {
      await renderAndClickRowAction(
        [
          teacherListPageMock([sessionFixture({ id: ROW_STARTED, status: SessionStatus.Started })]),
          completeSuccessMock(ROW_STARTED, COMPLETED_PAYLOAD),
        ],
        locale,
        ROW_STARTED,
        t.completeSession
      );

      await waitFor(() => {
        expect(screen.getByText(t.sessionCompletedNotice)).toBeDefined();
      });
      expect(snackbarSeverityClass(t.sessionCompletedNotice)).toContain("MuiAlert-colorSuccess");

      await waitFor(() => {
        expect(within(screen.getByTestId(`session-row-${ROW_STARTED}`)).getByText(t.statusCompleted)).toBeDefined();
      });
      const settledRow = screen.getByTestId(`session-row-${ROW_STARTED}`);
      expect(within(settledRow).queryByText(t.statusStarted)).toBeNull();
      // Terminal — every affordance leaves with the lifecycle.
      expect(within(settledRow).queryByRole("button", { name: t.startSession })).toBeNull();
      expect(within(settledRow).queryByRole("button", { name: t.completeSession })).toBeNull();
      expect(within(settledRow).queryByRole("button", { name: t.cancelSession })).toBeNull();
    });

    test("branch 9 — complete TEACHER_NOT_CERTIFIED: row-scoped inline alert, row unchanged", async () => {
      await renderAndClickRowAction(
        [
          teacherListPageMock([sessionFixture({ id: ROW_STARTED, status: SessionStatus.Started })]),
          completeErrorMock(ROW_STARTED, "TEACHER_NOT_CERTIFIED"),
        ],
        locale,
        ROW_STARTED,
        t.completeSession
      );

      await waitFor(() => {
        expect(
          within(screen.getByTestId(`session-row-${ROW_STARTED}`)).getByText(te.teacherNotCertified)
        ).toBeDefined();
      });
      const alert = screen.getByText(te.teacherNotCertified).closest(".MuiAlert-root");
      expect(alert?.className ?? "").toContain("MuiAlert-colorError");
      // The lifecycle is untouched — chip stays started, no success notice,
      // and the CTA is re-enabled once its mutation settled.
      const settledRow = screen.getByTestId(`session-row-${ROW_STARTED}`);
      expect(within(settledRow).getByText(t.statusStarted)).toBeDefined();
      expect(screen.queryByText(t.sessionCompletedNotice)).toBeNull();
      expect(within(settledRow).getByRole("button", { name: t.completeSession }).getAttribute("disabled")).toBeNull();
    });

    test("branch 10 — start SESSION_INVALID_TRANSITION: row-scoped inline alert, row unchanged", async () => {
      await renderAndClickRowAction(
        [
          teacherListPageMock([sessionFixture({ id: ROW_SCHEDULED_A })]),
          startErrorMock(ROW_SCHEDULED_A, "SESSION_INVALID_TRANSITION"),
        ],
        locale,
        ROW_SCHEDULED_A,
        t.startSession
      );

      await waitFor(() => {
        expect(
          within(screen.getByTestId(`session-row-${ROW_SCHEDULED_A}`)).getByText(te.sessionInvalidTransition)
        ).toBeDefined();
      });
      const alert = screen.getByText(te.sessionInvalidTransition).closest(".MuiAlert-root");
      expect(alert?.className ?? "").toContain("MuiAlert-colorError");
      // The lifecycle is untouched — chip stays scheduled, no success notice.
      const settledRow = screen.getByTestId(`session-row-${ROW_SCHEDULED_A}`);
      expect(within(settledRow).getByText(t.statusScheduled)).toBeDefined();
      expect(screen.queryByText(t.sessionStartedNotice)).toBeNull();
      expect(within(settledRow).getByRole("button", { name: t.startSession }).getAttribute("disabled")).toBeNull();
    });

    test("branch 11 — cancel dialog (reused student dialog): opens, submit affordance pinned, dismisses cleanly", async () => {
      renderTeacherSessions([teacherListPageMock([sessionFixture({ id: ROW_SCHEDULED_A })])], locale);

      // 1. Row cancel CTA → the shared dialog opens.
      const row = await waitForSessionRow(ROW_SCHEDULED_A);
      const dialog = await openCancelDialog(row, t.cancelSession);
      expect(within(dialog).getByText(t.cancelConfirmTitle)).toBeDefined();
      expect(within(dialog).getByText(t.cancelConfirmBody)).toBeDefined();
      // Two actions: the Common-namespace dismiss + the type="submit" CTA
      // that walks the React.SubmitEvent path (its OUTCOME branches are the
      // deferred D8/D9-class branches below — the mutation arms that
      // broadcast cache surgery into the active useQuery observer while the
      // MUI dialog portal is mounted are runner-tier fatal; branch 12 pins
      // the LIVE error-path submit instead).
      expect(within(dialog).getByRole("button", { name: tc.cancel })).toBeDefined();
      const submitButton = within(dialog).getByRole("button", { name: t.cancelSession });
      expect(submitButton.getAttribute("type")).toBe("submit");

      // 2. Dismiss — the dialog closes without firing the mutation.
      fireEvent.click(within(dialog).getByRole("button", { name: tc.cancel }));
      await waitFor(() => {
        expect(screen.queryByRole("dialog")).toBeNull();
      });
      // The row is untouched — still scheduled with every affordance live.
      const settledRow = screen.getByTestId(`session-row-${ROW_SCHEDULED_A}`);
      expect(within(settledRow).getByText(t.statusScheduled)).toBeDefined();
      expect(within(settledRow).getByRole("button", { name: t.cancelSession })).toBeDefined();
    });

    test("branch 12 — cancel submit (error path): SESSION_INVALID_TRANSITION → dialog closes + row-scoped alert", async () => {
      await renderAndSubmitCancelDialog(
        [
          teacherListPageMock([sessionFixture({ id: ROW_SCHEDULED_A })]),
          teacherCancelErrorMock(ROW_SCHEDULED_A, "SESSION_INVALID_TRANSITION"),
        ],
        locale,
        ROW_SCHEDULED_A,
        t.cancelSession
      );

      await waitFor(() => {
        expect(
          within(screen.getByTestId(`session-row-${ROW_SCHEDULED_A}`)).getByText(te.sessionInvalidTransition)
        ).toBeDefined();
      });
      const alert = screen.getByText(te.sessionInvalidTransition).closest(".MuiAlert-root");
      expect(alert?.className ?? "").toContain("MuiAlert-colorError");
      // Dialog closed, lifecycle untouched, no success notice fired.
      expect(screen.queryByRole("dialog")).toBeNull();
      const settledRow = screen.getByTestId(`session-row-${ROW_SCHEDULED_A}`);
      expect(within(settledRow).getByText(t.statusScheduled)).toBeDefined();
      expect(screen.queryByText(t.sessionCancelledNotice)).toBeNull();
    });

    // D8 (deferred-items.md) — this branch is SKIPped in this environment,
    // mirroring the student suite's branch 7: React 19 + Happy DOM do not
    // deliver dispatched input events into the MUI Dialog portal (the
    // controlled textarea's onChange never fires; the native-setter +
    // bubbled input event is also unreachable). The teacher cancel path
    // REUSES that same dialog, so the typing dead-end is identical. The
    // no-typing submit path IS pinned live by branch 12 above.
    // Compensating control: verified end-to-end in the real-browser
    // agent-browser loop (task 4.3.BF — cancel path with optional reason).
    test.skip("branch 13 — cancel flow WITH typed reason: live counter → submit → cancelled chip flip", async () => {
      renderTeacherSessions(
        [
          teacherListPageMock([sessionFixture({ id: ROW_SCHEDULED_A })]),
          teacherCancelSuccessWithReasonMock(ROW_SCHEDULED_A, REASON_SENT, CANCELLED_PAYLOAD),
        ],
        locale
      );

      const row = await waitForSessionRow(ROW_SCHEDULED_A);
      const dialog = await openCancelDialog(row, t.cancelSession);
      expect(within(dialog).getByText(t.cancelConfirmTitle)).toBeDefined();

      // Type the (padded) reason — the live counter counts RAW characters.
      const reasonInput = within(dialog).getByRole("textbox");
      fireEvent.change(reasonInput, { target: { value: REASON_TYPED } });
      expect(within(dialog).getByText(`${REASON_TYPED.length}/${MAX_CANCEL_REASON_LENGTH}`)).toBeDefined();

      // Submit through the dialog's form element (React.SubmitEvent path).
      fireEvent.submit(dialog);

      await waitFor(() => {
        expect(screen.queryByRole("dialog")).toBeNull();
      });
      await waitFor(() => {
        expect(screen.getByText(t.sessionCancelledNotice)).toBeDefined();
      });
      await waitFor(() => {
        expect(within(screen.getByTestId(`session-row-${ROW_SCHEDULED_A}`)).getByText(t.statusCancelled)).toBeDefined();
      });
    });

    // D9 (deferred-items.md) — this branch is SKIPped in this environment,
    // mirroring the student suite's branch 8: the dialog's SESSION_NOT_FOUND
    // cache-eviction arm (`cache.modify` ROOT_QUERY list filter + `evict` +
    // `gc()` broadcast into the active useQuery observer) runs away under
    // bun 1.3.14 + React 19 + Happy DOM — bun balloons to multi-GB RSS and
    // is killed. Deterministic even with the branch run ALONE via `-t`.
    // The teacher cancel path REUSES that dialog (whose arm now filters BOTH
    // role list fields). Compensating control: the real-browser 4.3.BF loop
    // explicitly asserts cache-driven row removal.
    test.skip("branch 14 — cancel SESSION_NOT_FOUND: error snackbar + row evicted from the list", async () => {
      await renderAndSubmitCancelDialog(
        [
          teacherListPageMock([sessionFixture({ id: ROW_SCHEDULED_A })]),
          teacherCancelErrorMock(ROW_SCHEDULED_A, "SESSION_NOT_FOUND"),
        ],
        locale,
        ROW_SCHEDULED_A,
        t.cancelSession
      );

      // Cache eviction + list filtering are the dialog's not-found arm — the
      // row has already left the list (the empty state takes over) here.
      await expectRowEvictedToEmptyState(ROW_SCHEDULED_A, te.sessionNotFound);
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    // D9-class (deferred-items.md D9 family) — SKIPped: the dialog's
    // SUCCESS submit arm (cache NORMALIZE `update` + 14-field payload merge
    // re-rendering the list row while the MUI dialog portal unmounts)
    // triggers the same runner-tier runaway as branch 14 — killed
    // deterministically (exit 137) even with this branch run ALONE via
    // `-t "branch 15"`, with no heap-cap env having any effect. The dialog
    // open/submit affordances ARE pinned live by branches 11–12; the error
    // classification paths are live too. Compensating control: the
    // real-browser 4.3.BF loop (cancel path with optional reason →
    // success notice → chip flip).
    test.skip("branch 15 — cancel submit SUCCESS: dialog closes + cancelled snackbar + terminal chip flip", async () => {
      await renderAndSubmitCancelDialog(
        [
          teacherListPageMock([sessionFixture({ id: ROW_SCHEDULED_A })]),
          teacherCancelSuccessMock(ROW_SCHEDULED_A, CANCELLED_PAYLOAD),
        ],
        locale,
        ROW_SCHEDULED_A,
        t.cancelSession
      );

      // Dialog closes + success snackbar with the teacher cancelled copy.
      await waitFor(() => {
        expect(screen.queryByRole("dialog")).toBeNull();
      });
      await waitFor(() => {
        expect(screen.getByText(t.sessionCancelledNotice)).toBeDefined();
      });
      expect(snackbarSeverityClass(t.sessionCancelledNotice)).toContain("MuiAlert-colorSuccess");

      // Row converges via the normalized cache — chip flips to cancelled
      // and EVERY affordance leaves with the terminal lifecycle.
      await waitFor(() => {
        expect(within(screen.getByTestId(`session-row-${ROW_SCHEDULED_A}`)).getByText(t.statusCancelled)).toBeDefined();
      });
      const settledRow = screen.getByTestId(`session-row-${ROW_SCHEDULED_A}`);
      expect(within(settledRow).queryByText(t.statusScheduled)).toBeNull();
      expect(within(settledRow).queryByRole("button", { name: t.startSession })).toBeNull();
      expect(within(settledRow).queryByRole("button", { name: t.completeSession })).toBeNull();
      expect(within(settledRow).queryByRole("button", { name: t.cancelSession })).toBeNull();
    });

    test("branch 16 — copy contract: rendered copy equals preloaded labels (sample pin)", async () => {
      renderTeacherSessions([teacherListPageMock([sessionFixture({ id: ROW_SCHEDULED_A })])], locale);

      await waitFor(() => {
        expect(screen.getByTestId(`session-row-${ROW_SCHEDULED_A}`)).toBeDefined();
      });

      // The heading and the teacher CTAs are EXACTLY the preloaded label
      // strings.
      expect(screen.getByText(t.teacherPageTitle).textContent).toBe(t.teacherPageTitle);
      expect(screen.getByRole("button", { name: t.startSession }).textContent).toBe(t.startSession);
      expect(screen.getByRole("button", { name: t.cancelSession }).textContent).toBe(t.cancelSession);
      // The fee is verbatim decimal + currency — never reformatted.
      expect(screen.getByText(`${SCHEDULED_ROW.fee} ${SESSION_FEE_CURRENCY}`)).toBeDefined();
      // No raw translation handles or ICU placeholders may leak into the DOM.
      const bodyText = document.body.textContent ?? "";
      expect(bodyText).not.toContain("teacherPageTitle");
      expect(bodyText).not.toContain("sessions.sessions");
      expect(bodyText).not.toContain("{");
      expect(bodyText).not.toContain("}");
    });

    // D9-class (deferred-items.md D9 family) — SKIPped: the container-owned
    // eviction arm (start/complete mutations → `myTeacherSessions` list
    // filter + `evict` + `gc()` broadcast into the active useQuery observer)
    // is the SAME cache-surgery-under-active-observer shape as the dialog's
    // D9 arm — killed/runaway deterministically (exit 124 timeout, multi-GB
    // RSS spiral) even with this branch run ALONE via `-t "branch 17"`.
    // Body INTACT — one-line flip re-enables. Compensating control: the
    // real-browser 4.3.BF loop asserts SESSION_NOT_FOUND row removal.
    test.skip("branch 17 — start SESSION_NOT_FOUND: error snackbar + row evicted from the list", async () => {
      await renderAndClickRowAction(
        [
          teacherListPageMock([sessionFixture({ id: ROW_SCHEDULED_A })]),
          startErrorMock(ROW_SCHEDULED_A, "SESSION_NOT_FOUND"),
        ],
        locale,
        ROW_SCHEDULED_A,
        t.startSession
      );

      // The container's own eviction arm (start/complete mutations): list
      // filtered + entity evicted + gc — the row leaves WITHOUT a refetch
      // and the empty state takes over.
      await expectRowEvictedToEmptyState(ROW_SCHEDULED_A, te.sessionNotFound);
    });

    test("branch 18 — filtered-empty keeps the filter chips mounted and swaps in the distinct filtered copy", async () => {
      // One Scheduled row only — clicking the Cancelled chip re-keys the
      // query variables and the Cancelled page settles EMPTY.
      renderTeacherSessions(
        [
          teacherListPageMock([sessionFixture({ id: ROW_SCHEDULED_A })]),
          teacherFilteredPageMock(SessionStatus.Cancelled, []),
        ],
        locale
      );

      await waitForSessionRow(ROW_SCHEDULED_A);

      fireEvent.click(screen.getByRole("button", { name: t.statusCancelled }));

      // The empty-state testid survives the re-key…
      await waitFor(() => {
        expect(screen.getByTestId("teacher-sessions-empty")).toBeDefined();
      });
      // …the filter chips row is STILL in the DOM with the clicked chip
      // selected (the pre-fix early return dropped the chrome here)…
      expect(screen.getByText(t.teacherPageTitle)).toBeDefined();
      const cancelledChip = screen.getByRole("button", { name: t.statusCancelled });
      expect(cancelledChip.getAttribute("aria-pressed")).toBe("true");
      expect(screen.getByRole("button", { name: t.statusFilterAll })).toBeDefined();
      // …and the DISTINCT filtered-empty copy renders (never the generic).
      expect(screen.getByText(t.filteredEmptyTitle)).toBeDefined();
      expect(screen.getByText(t.filteredEmptyBody)).toBeDefined();
      expect(screen.queryByText(t.teacherEmptyTitle)).toBeNull();
      expect(screen.queryByText(t.teacherEmptyBody)).toBeNull();
    });

    test("branch 19 — concurrent same-kind starts: BOTH rows' CTAs disable together, each slot resolves on its own mutation", async () => {
      const scheduledRowA = sessionFixture({ id: ROW_SCHEDULED_A });
      const scheduledRowB = sessionFixture({ id: ROW_SCHEDULED_B });
      renderTeacherSessions(
        [
          teacherListPageMock([scheduledRowA, scheduledRowB]),
          // A's mutation NEVER settles here — its slot stays open for the
          // whole branch, which is exactly what the pre-D9-bis single-slot
          // bookkeeping lost track of.
          pendingStartMock(ROW_SCHEDULED_A),
          startSuccessMock(
            ROW_SCHEDULED_B,
            sessionFixture({ id: ROW_SCHEDULED_B, status: SessionStatus.Started, startedAt: STARTED_ISO })
          ),
        ],
        locale
      );

      // Start row A — its OWN slot disables its CTA…
      const rowA = await waitForSessionRow(ROW_SCHEDULED_A);
      fireEvent.click(within(rowA).getByRole("button", { name: t.startSession }));
      await waitFor(() => {
        expect(
          within(screen.getByTestId(`session-row-${ROW_SCHEDULED_A}`))
            .getByRole("button", { name: t.startSession })
            .getAttribute("disabled")
        ).not.toBeNull();
      });

      // …then row B WHILE A is mid-flight: B's CTA disables AND A's STAYS
      // disabled (the old per-kind single slot re-enabled A here).
      const rowB = screen.getByTestId(`session-row-${ROW_SCHEDULED_B}`);
      fireEvent.click(within(rowB).getByRole("button", { name: t.startSession }));
      await waitFor(() => {
        expect(
          within(screen.getByTestId(`session-row-${ROW_SCHEDULED_B}`))
            .getByRole("button", { name: t.startSession })
            .getAttribute("disabled")
        ).not.toBeNull();
      });
      expect(
        within(screen.getByTestId(`session-row-${ROW_SCHEDULED_A}`))
          .getByRole("button", { name: t.startSession })
          .getAttribute("disabled")
      ).not.toBeNull();

      // B resolves FIRST and flips ONLY B: chip → started, Complete CTA
      // appears — A's Start remains disabled because A's OWN mutation is
      // still in flight (each slot clears on its own resolution).
      await waitFor(() => {
        expect(within(screen.getByTestId(`session-row-${ROW_SCHEDULED_B}`)).getByText(t.statusStarted)).toBeDefined();
      });
      expect(screen.getByText(t.sessionStartedNotice)).toBeDefined();
      expect(
        within(screen.getByTestId(`session-row-${ROW_SCHEDULED_A}`))
          .getByRole("button", { name: t.startSession })
          .getAttribute("disabled")
      ).not.toBeNull();
      expect(
        within(screen.getByTestId(`session-row-${ROW_SCHEDULED_B}`)).getByRole("button", { name: t.completeSession })
      ).toBeDefined();
    });

    test("branch 20 — dispute dialog (DEV3-005): opens, REQUIRED-reason gate blocks an empty submit, dismisses cleanly", async () => {
      renderTeacherSessions([teacherListPageMock([sessionFixture({ id: ROW_SCHEDULED_A })])], locale);

      // 1. Row dispute CTA → the dispute dialog opens (click events DO work
      //    in the portal — only TYPED input is the D8 dead-end).
      const row = await waitForSessionRow(ROW_SCHEDULED_A);
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
      const settledRow = screen.getByTestId(`session-row-${ROW_SCHEDULED_A}`);
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
    // dispute → chip flips) + the branch-20 empty-submit gate above.
    test.skip("branch 21 — dispute flow typed: live counter → submit → success snackbar + DISPUTED chip flip", async () => {
      renderTeacherSessions(
        [
          teacherListPageMock([sessionFixture({ id: ROW_SCHEDULED_A })]),
          disputeSuccessMock(ROW_SCHEDULED_A, DISPUTED_PAYLOAD),
        ],
        locale
      );

      const row = await waitForSessionRow(ROW_SCHEDULED_A);
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
        expect(within(screen.getByTestId(`session-row-${ROW_SCHEDULED_A}`)).getByText(t.statusDisputed)).toBeDefined();
      });
      const settledRow = screen.getByTestId(`session-row-${ROW_SCHEDULED_A}`);
      expect(within(settledRow).queryByText(t.statusScheduled)).toBeNull();
      expect(within(settledRow).queryByRole("button", { name: t.openDispute })).toBeNull();
      expect(
        within(settledRow).getByTestId(`session-action-${ROW_SCHEDULED_A}-cancel-disabled`).getAttribute("disabled")
      ).not.toBeNull();
    });

    // D8-class (deferred-items.md D8 family) — SKIPped for the same typed-
    // input reason as branch 21: the dispute error arms are only reachable
    // with a valid typed reason. Body INTACT — one-line flip re-enables.
    // Compensating control: the real-browser DEV3-005 4.1 loop drives the
    // error surface (raced/invalid dispute → localized snackbar).
    test.skip("branch 22 — dispute submit error: SESSION_INVALID_TRANSITION → error snackbar, row stays scheduled", async () => {
      renderTeacherSessions(
        [
          teacherListPageMock([sessionFixture({ id: ROW_SCHEDULED_A })]),
          disputeErrorMock(ROW_SCHEDULED_A, "SESSION_INVALID_TRANSITION"),
        ],
        locale
      );

      const row = await waitForSessionRow(ROW_SCHEDULED_A);
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
      const settledRow = screen.getByTestId(`session-row-${ROW_SCHEDULED_A}`);
      expect(within(settledRow).getByText(t.statusScheduled)).toBeDefined();
      expect(within(settledRow).getByRole("button", { name: t.openDispute }).getAttribute("disabled")).toBeNull();
    });

    // DEV3-012 — the teacher surface's confirm-state display (the row is
    // payload-driven, so the shared SessionRow renders it for BOTH roles):
    // a completed hold-marked unstamped row shows the awaiting pill (WHY
    // the wallet credit has not fired) and NEVER a confirm CTA (the
    // teacher's stamp was already written by completeSession), while a
    // student-stamped row shows the confirmation meta cell instead.
    test("branch 23 — DEV3-012 confirm-state display: awaiting pill + stamp meta, never a confirm CTA", async () => {
      const pendingId = "9306";
      const stampedId = "9307";
      const confirmedIso = "2099-02-11T09:15:00.000Z";
      renderTeacherSessions(
        [
          teacherListPageMock([
            sessionFixture({
              id: pendingId,
              status: SessionStatus.Completed,
              fee: "180.00",
              feeHeld: true,
              confirmationDeadline: null,
            }),
            sessionFixture({
              id: stampedId,
              status: SessionStatus.Completed,
              fee: "95.00",
              feeHeld: false,
              confirmedByStudentAt: confirmedIso,
              confirmationDeadline: null,
            }),
          ]),
        ],
        locale
      );

      await waitForSessionRow(pendingId);

      // 1. Pending row: the awaiting pill renders; NO confirm CTA exists on
      //    the teacher surface (no confirm action is ever passed) and the
      //    terminal status renders no cancel/dispute affordances either.
      const pendingRow = screen.getByTestId(`session-row-${pendingId}`);
      expect(within(pendingRow).getByTestId(`session-awaiting-confirmation-${pendingId}`).textContent).toBe(
        t.awaitingStudentConfirmation
      );
      expect(within(pendingRow).queryByRole("button", { name: t.confirmCompletion })).toBeNull();
      expect(within(pendingRow).queryByRole("button", { name: t.startSession })).toBeNull();
      expect(within(pendingRow).queryByRole("button", { name: t.completeSession })).toBeNull();
      expect(within(pendingRow).queryByRole("button", { name: t.cancelSession })).toBeNull();

      // 2. Stamped row: the student-confirmation meta cell replaces the
      //    pill (dual-confirmation visibility for the teacher).
      const stampedRow = screen.getByTestId(`session-row-${stampedId}`);
      expect(within(stampedRow).getByText(t.studentConfirmedAt)).toBeDefined();
      expect(within(stampedRow).getAllByText(expectedStamp(confirmedIso, locale)).length).toBeGreaterThanOrEqual(1);
      expect(within(stampedRow).queryByTestId(`session-awaiting-confirmation-${stampedId}`)).toBeNull();
    });
  });
}
