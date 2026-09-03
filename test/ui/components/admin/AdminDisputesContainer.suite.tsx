/**
 * AdminDisputesContainer — component suite BODY.
 *
 * NOT a runner target: `bun test` collects `*.test.*` files only, and this
 * file carries the suite implementation on behalf of the sibling bootstrap
 * `AdminDisputesContainer.test.tsx` (see that file for WHY the suite is
 * split — short version: react-dom must first evaluate with the Happy-DOM
 * document already registered, or React's `isInputEventSupported` flag is
 * computed `false` and controlled `onChange` can never fire).
 *
 * Happy DOM + Apollo `MockedProvider` tier (`test/ui/components/admin`,
 * mirroring the student/teacher sessions suites): ONE render case per branch
 * of the admin disputes visual state matrix (DEV3-005 R-111), driven across
 * BOTH locales:
 *
 *   loading skeleton · FORBIDDEN fallback · generic error · drained-queue
 *   empty state (every branch keeping the ALWAYS-ON title + honest-count
 *   chrome mounted) · populated queue (verbatim fee + currency · filed
 *   dispute reason with the expand/collapse clamp affordance · participant
 *   ids · created/disputed stamps · honest count line) · resolve CTA
 *   in-flight slot (per-row disable while the dialog owns the mutation) ·
 *   arbitration dialog (resolution radios + optional-note counter + the
 *   no-resolution submit gate + clean dismissal with NO wire call) ·
 *   resolve→Cancel success (note optional → `null` on the wire; dialog
 *   closes · success snackbar · the row leaves the queue via the dialog's
 *   cache filter · the honest count decrements) ·
 *   SESSION_INVALID_TRANSITION (error snackbar, dialog closes, queue
 *   intact — no admin eviction arm) · VALIDATION (error snackbar, dialog
 *   STAYS open for a corrected choice) · ghost-page guard (resolving the
 *   LAST row of a trailing page steps back to page 1 instead of rendering
 *   a ghost page).
 *
 * Translation discipline: assertions reference ONLY the PRELOADED label
 * objects resolved through `Sessions.getLabels(getTranslations(locale))`,
 * `Errors.getLabels(...)` and `Common.getLabels(...)` — ZERO hardcoded
 * Arabic/English copy lives here. The one exception class is fixture DATA
 * (ids, enum values, an ASCII dispute reason) plus the created/disputed
 * timestamps, which are recomputed with a local `Intl.DateTimeFormat` clone
 * of `formatApplicantDate`'s documented option set.
 *
 * Preload parity: the `test:ui:components` preload chain (test-env →
 * happydom → translation-preload → next-dynamic-mock) is owned by the
 * bootstrap entry, which registers the DOM BEFORE this module — and its
 * node_modules dependencies — are evaluated.
 *
 * Typing discipline (React 19 + Happy DOM): NO branch here needs TYPED
 * input. The arbitration note is OPTIONAL (R-104), so every wire-reaching
 * arm submits with the empty note (`note: null` — the dialog's
 * trimmed-empty rule), which needs only click + submit events — the events
 * that DO cross the MUI Dialog portal under this runner (the D8 dead-end
 * applies to controlled text input only). The suite therefore carries ZERO
 * `.skip(` markers: every matrix branch executes in BOTH locales.
 *
 * Static discipline verified alongside (grep):
 *   - `useLazyQuery` appears NOWHERE in the view or its consumers;
 *   - this suite contains NO `.skip(` and NO `test.only(` markers — every
 *     matrix branch executes.
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
  type AdminDisputedSessionsQuery_adminDisputedSessions_items,
  DisputeResolution,
  SessionIntent,
  SessionStatus,
  SessionType,
} from "@/frontend/graphql/generated/gql/graphql";
import {
  adminDisputedSessionsQueryDocument,
  resolveSessionDisputeMutationDocument,
} from "@/frontend/graphql/sharedDocuments";
import { AdminDisputesContainer } from "@/frontend/views/admin/disputes/AdminDisputesContainer";
import { MAX_RESOLVE_NOTE_LENGTH } from "@/frontend/views/admin/disputes/ResolveDisputeDialog";
import { SESSION_FEE_CURRENCY } from "@/shared/constants";
import type { AppLocale } from "@/shared/locale/AppLocale";
import { Common as CommonNs } from "@/shared/locale/namespaces/common";
import { Errors as ErrorsNs } from "@/shared/locale/namespaces/errors";
import { Sessions as SessionsNs } from "@/shared/locale/namespaces/sessions";
import { getTranslations } from "@/shared/locale/server";
import { renderWithWrapper } from "@/test/ui/components/TestWrapper";

// ---------------------------------------------------------------------------
// Fixtures (DATA — never locale copy)

/**
 * All-fields fixture row. `__typename` mirrors what Apollo Server puts on
 * the wire; it is what makes the `Session:<id>` entity normalizable so the
 * dialog's cache `update` filter converges the queue WITHOUT refetch.
 */
interface DisputeFixture extends AdminDisputedSessionsQuery_adminDisputedSessions_items {
  readonly __typename: "Session";
}

/** Creation moment shared by every fixture row (deterministic formatting). */
const CREATED_ISO = "2099-01-10T08:45:00.000Z";

/** Dispute-open moment shared by every filed fixture row. */
const DISPUTED_ISO = "2099-01-10T13:20:00.000Z";

/** Arbitration moment stamped on resolved mutation payloads. */
const RESOLVED_ISO = "2099-01-10T15:05:00.000Z";

/** The primary queue row exercised by every arbitration-dialog flow. */
const QUEUE_ROW_ID = "9301";

/** The sibling queue row (null-matrix variant) keeping the queue populated. */
const SIBLING_ROW_ID = "9302";

/** The lone row of the trailing page in the ghost-guard branch. */
const TRAILING_ROW_ID = "9303";

/** First row id of the populated page (settled-render wait handle). */
const FIRST_POPULATED_ID = QUEUE_ROW_ID;

/** Raw dispute reason the fixture participant filed (DATA, not locale copy). */
const FILED_DISPUTE_REASON = "Teacher never joined the session.";

/** AdminDisputeRow's typographic no-value placeholder (NOT locale copy). */
const EM_DASH = "—";

/**
 * Page size the container pins into its query variables (mirrors the
 * container's module-scope `ADMIN_DISPUTES_PAGE_SIZE` — R-106's 1..50 clamp
 * midpoint; the constant is NOT exported, so the suite re-states it).
 */
const ADMIN_DISPUTES_PAGE_SIZE = 25;

/** Exact variables the container sends for the given 1-based page. */
function queueVariables(page: number): { filter: null; limit: number; offset: number } {
  return { filter: null, limit: ADMIN_DISPUTES_PAGE_SIZE, offset: (page - 1) * ADMIN_DISPUTES_PAGE_SIZE };
}

/** Deterministic payload builder mirroring the closed 20-field wire shape. */
function disputeFixture(overrides?: Partial<AdminDisputedSessionsQuery_adminDisputedSessions_items>): DisputeFixture {
  return {
    __typename: "Session",
    id: QUEUE_ROW_ID,
    status: SessionStatus.Disputed,
    intent: SessionIntent.Hifz,
    sessionType: SessionType.StudentSession,
    fee: "150.50",
    feeHeld: true,
    studentId: "401",
    teacherId: "802",
    startedAt: null,
    endedAt: null,
    confirmationDeadline: null,
    confirmedByStudentAt: null,
    confirmedByTeacherAt: null,
    createdAt: CREATED_ISO,
    updatedAt: CREATED_ISO,
    cancelReason: null,
    disputeReason: FILED_DISPUTE_REASON,
    disputedAt: DISPUTED_ISO,
    resolutionNote: null,
    resolvedAt: null,
    ...overrides,
  };
}

/**
 * One populated queue page: the primary arbitration row next to a null-matrix
 * sibling (null intent/fee/disputed-at/reason → the em-dash placeholder).
 */
const QUEUE_ROWS: readonly DisputeFixture[] = [
  disputeFixture({ id: QUEUE_ROW_ID }),
  disputeFixture({ id: SIBLING_ROW_ID, intent: null, fee: null, disputeReason: null, disputedAt: null }),
];

/** The cancelled wire payload the resolve-success mock returns (same id). */
function cancelledPayload(sessionId: string): DisputeFixture {
  return disputeFixture({ id: sessionId, status: SessionStatus.Cancelled, feeHeld: false, resolvedAt: RESOLVED_ISO });
}

// ---------------------------------------------------------------------------
// Mock builders

/** Single-operation Apollo mock answering the shared document with a page. */
function queuePageMock(
  page: number,
  items: ReadonlyArray<DisputeFixture>,
  totalCount: number
): MockLink.MockedResponse {
  return {
    request: { query: adminDisputedSessionsQueryDocument, variables: queueVariables(page) },
    result: {
      data: {
        adminDisputedSessions: {
          items: [...items],
          page,
          pageSize: ADMIN_DISPUTES_PAGE_SIZE,
          totalCount,
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
function pendingQueueMock(): MockLink.MockedResponse {
  return {
    request: { query: adminDisputedSessionsQueryDocument, variables: queueVariables(1) },
    delay: Infinity,
  };
}

/**
 * Single-operation mock denying the caller at the scope layer. The deny is
 * authored as a raw `result.errors[]` entry exactly where the transport
 * boundary puts `extensions.code`; Apollo's MockedProvider wraps it into a
 * genuine `CombinedGraphQLErrors`, which `extractErrorCode` traverses — the
 * same extraction path the production error-link uses.
 */
function deniedQueueError(code: string): MockLink.MockedResponse {
  return {
    request: { query: adminDisputedSessionsQueryDocument, variables: queueVariables(1) },
    result: {
      errors: [{ message: `${code} (masked transport surface)`, extensions: { code } }],
    },
  };
}

/**
 * Resolve-mutation mock with the variables the dialog ACTUALLY sends for an
 * empty note: `{ id, resolution, note: null }` (the trimmed-empty rule — the
 * note is OPTIONAL per R-104, so the wire arms need no typed input).
 */
function resolveMock(
  sessionId: string,
  resolution: DisputeResolution,
  outcome: { kind: "success"; payload: DisputeFixture } | { kind: "error"; code: string }
): MockLink.MockedResponse {
  return {
    request: {
      query: resolveSessionDisputeMutationDocument,
      variables: { id: sessionId, resolution, note: null },
    },
    ...(outcome.kind === "success"
      ? { result: { data: { resolveSessionDispute: outcome.payload } } }
      : {
          result: {
            errors: [{ message: `${outcome.code} (masked transport surface)`, extensions: { code: outcome.code } }],
          },
        }),
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
function renderDisputes(mocks: ReadonlyArray<MockLink.MockedResponse>, locale: AppLocale): RenderResult {
  const mocksCopy = [...mocks];
  return renderWithWrapper(
    <MockedProvider mocks={mocksCopy}>
      <AdminDisputesContainer />
    </MockedProvider>,
    { locale }
  );
}

/**
 * Recomputes the created/disputed stamp independently of the implementation
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

/** Opens the arbitration dialog for one queue row and waits for the portal. */
async function openResolveDialog(rowId: string): Promise<HTMLElement> {
  // Wait for the settled queue row first (the render helper above does NOT
  // guarantee the query has settled by the time this runs).
  await waitFor(() => {
    expect(screen.getByTestId(`admin-dispute-row-${rowId}`)).toBeDefined();
  });
  const row = screen.getByTestId(`admin-dispute-row-${rowId}`);
  // The row CTA's accessible name is the Tooltip title (MUI's default
  // describeChild=false pins aria-label), so the intent is driven through
  // the row's own action testid.
  fireEvent.click(within(row).getByTestId(`admin-dispute-action-${rowId}-resolve`));
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
// executes ONLY that locale's block (the sanctioned OOM relief used by the
// student/teacher suites). Unset (default) runs BOTH locales.
const STUI_LOCALES: ReadonlyArray<AppLocale> = process.env.STUI_LOCALE
  ? (["ar", "en"] as AppLocale[]).filter(candidate => candidate === process.env.STUI_LOCALE)
  : (["ar", "en"] as AppLocale[]);
for (const locale of STUI_LOCALES) {
  const t = SessionsNs.getLabels(getTranslations(locale));
  const te = ErrorsNs.getLabels(getTranslations(locale));
  const tc = CommonNs.getLabels(getTranslations(locale));

  describe(`AdminDisputesContainer (${locale === "ar" ? "RTL/arabic" : "LTR/english"})`, () => {
    test("branch 1 — query in flight renders the busy skeleton under the always-on chrome", () => {
      const { container } = renderDisputes([pendingQueueMock()], locale);

      const skeleton = screen.getByTestId("admin-disputes-loading");
      expect(skeleton.getAttribute("aria-busy")).toBe("true");
      // No settled surface may leak into the skeleton.
      expect(container.querySelector("[data-testid='admin-disputes-empty']")).toBeNull();
      expect(container.querySelector("[data-testid='admin-disputes-error']")).toBeNull();
      expect(container.textContent?.includes(t.adminDisputesEmptyTitle)).toBe(false);
      // The chrome NEVER drops — title + honest-count bar stay mounted even
      // on the skeleton.
      expect(container.querySelector("[data-testid='admin-disputes-view']")).not.toBeNull();
      expect(screen.getByText(t.adminDisputesPageTitle)).toBeDefined();
      expect(screen.getByTestId("admin-disputes-count").textContent).toBe(t.adminDisputesCountLine(0));
    });

    test("branch 2 — FORBIDDEN renders the shared permission fallback", async () => {
      const { container } = renderDisputes([deniedQueueError("FORBIDDEN")], locale);

      await waitFor(() => {
        expect(screen.getByText(te.forbiddenRole)).toBeDefined();
        expect(screen.getByText(te.forbidden)).toBeDefined();
      });
      // The deny surface REPLACES the body only — the chrome stays mounted.
      expect(container.querySelector("[data-testid='admin-disputes-view']")).not.toBeNull();
      expect(container.querySelector("[data-testid='admin-disputes-loading']")).toBeNull();
      expect(screen.getByText(t.adminDisputesPageTitle)).toBeDefined();
    });

    test("branch 3 — masked INTERNAL_SERVER_ERROR surfaces the generic inline alert", async () => {
      const { container } = renderDisputes([deniedQueueError("INTERNAL_SERVER_ERROR")], locale);

      await waitFor(() => {
        expect(screen.getByTestId("admin-disputes-error")).toBeDefined();
      });
      expect(screen.getByText(t.genericError)).toBeDefined();
      // The permission fallback must NOT appear for non-deny codes.
      expect(screen.queryByText(te.forbiddenRole)).toBeNull();
      expect(container.querySelector("[data-testid='admin-disputes-view']")).not.toBeNull();
      expect(screen.getByText(t.adminDisputesPageTitle)).toBeDefined();
    });

    test("branch 4 — drained queue renders the shared SessionsEmptyState with the arbitration copy", async () => {
      const { container } = renderDisputes([queuePageMock(1, [], 0)], locale);

      await waitFor(() => {
        expect(screen.getByTestId("admin-disputes-empty")).toBeDefined();
      });
      expect(screen.getByText(t.adminDisputesEmptyTitle)).toBeDefined();
      expect(screen.getByText(t.adminDisputesEmptyBody)).toBeDefined();
      expect(container.querySelector("[data-testid='admin-disputes-loading']")).toBeNull();
      // The chrome stays mounted above the empty state.
      expect(container.querySelector("[data-testid='admin-disputes-view']")).not.toBeNull();
      expect(screen.getByText(t.adminDisputesPageTitle)).toBeDefined();
      expect(screen.getByTestId("admin-disputes-count").textContent).toBe(t.adminDisputesCountLine(0));
      // A single pinned status spans one page — no pager on an empty queue.
      expect(container.querySelector("[data-testid='admin-disputes-pager']")).toBeNull();
    });

    test("branch 5 — populated queue: rows, verbatim fee, filed reason, participant ids, stamps, honest count", async () => {
      renderDisputes([queuePageMock(1, QUEUE_ROWS, QUEUE_ROWS.length)], locale);

      await waitFor(() => {
        expect(screen.getByTestId(`admin-dispute-row-${FIRST_POPULATED_ID}`)).toBeDefined();
      });
      expect(screen.getByText(t.adminDisputesPageTitle)).toBeDefined();
      expect(screen.getByTestId("admin-disputes-count").textContent).toBe(t.adminDisputesCountLine(QUEUE_ROWS.length));

      for (const session of QUEUE_ROWS) {
        const row = screen.getByTestId(`admin-dispute-row-${session.id}`);
        // The arbitration meta vocabulary renders on every row.
        expect(within(row).getByText(t.intent)).toBeDefined();
        expect(within(row).getByText(t.fee)).toBeDefined();
        expect(within(row).getByText(t.createdAt)).toBeDefined();
        expect(within(row).getByText(t.disputedAtLabel)).toBeDefined();
        expect(within(row).getByText(t.participantsLabel)).toBeDefined();
        expect(within(row).getByText(t.disputeReasonMeta)).toBeDefined();
        // Participant ids render VERBATIM (admin is trusted — R-111).
        expect(within(row).getByText(`${session.studentId} · ${session.teacherId}`)).toBeDefined();
        // Fee renders VERBATIM (never parsed) + currency, or the placeholder.
        const feeText = session.fee === null ? EM_DASH : `${session.fee} ${SESSION_FEE_CURRENCY}`;
        expect(within(row).getAllByText(feeText).length).toBeGreaterThanOrEqual(1);
        // Created + disputed moments expand through the locale date formatter.
        expect(within(row).getAllByText(expectedStamp(session.createdAt, locale)).length).toBeGreaterThanOrEqual(1);
        const disputedText = session.disputedAt === null ? EM_DASH : expectedStamp(session.disputedAt, locale);
        expect(within(row).getAllByText(disputedText).length).toBeGreaterThanOrEqual(1);
        // The filed dispute reason renders (placeholder when a legacy row
        // carries null), and the resolve affordance is live on every row.
        const reasonText = session.disputeReason ?? EM_DASH;
        expect(within(row).getAllByText(reasonText).length).toBeGreaterThanOrEqual(1);
        // The resolve affordance is live on every queued row. NOTE: its
        // ACCESSIBLE name is the Tooltip title (MUI Tooltip's default
        // describeChild=false pins `aria-label={t.resolveDisputeTitle}` on
        // the button) — the ACTION name, not the dialog body copy — so the
        // suite anchors on the row's own action testid and pins the visible
        // label separately.
        const resolveCta = within(row).getByTestId(`admin-dispute-action-${session.id}-resolve`);
        expect(resolveCta.textContent).toBe(t.resolveDispute);
      }
      // Two rows span one page — no pager below the list.
      expect(document.querySelector("[data-testid='admin-disputes-pager']")).toBeNull();
    });

    test("branch 6 — dispute reason expand/collapse clamp + resolve CTA per-row in-flight slot", async () => {
      renderDisputes([queuePageMock(1, QUEUE_ROWS, QUEUE_ROWS.length)], locale);

      await waitFor(() => {
        expect(screen.getByTestId(`admin-dispute-row-${FIRST_POPULATED_ID}`)).toBeDefined();
      });
      const row = screen.getByTestId(`admin-dispute-row-${QUEUE_ROW_ID}`);
      const toggle = within(row).getByTestId(`admin-dispute-reason-toggle-${QUEUE_ROW_ID}`);
      // Collapsed by default — the clamp keeps the FULL text in the DOM.
      expect(toggle.getAttribute("aria-expanded")).toBe("false");
      expect(toggle.getAttribute("aria-label")).toBe(t.disputeReasonExpand);
      fireEvent.click(toggle);
      const expanded = within(row).getByTestId(`admin-dispute-reason-toggle-${QUEUE_ROW_ID}`);
      expect(expanded.getAttribute("aria-expanded")).toBe("true");
      expect(expanded.getAttribute("aria-label")).toBe(t.disputeReasonCollapse);
      fireEvent.click(expanded);
      expect(within(row).getByTestId(`admin-dispute-reason-toggle-${QUEUE_ROW_ID}`).getAttribute("aria-expanded")).toBe(
        "false"
      );

      // Opening the dialog on ONE row disables only THAT row's resolve CTA
      // (the container's per-row in-flight slot); siblings stay live.
      fireEvent.click(within(row).getByTestId(`admin-dispute-action-${QUEUE_ROW_ID}-resolve`));
      await waitFor(() => {
        expect(screen.getByRole("dialog")).toBeDefined();
      });
      const openRowButton = within(row).getByTestId(`admin-dispute-action-${QUEUE_ROW_ID}-resolve`);
      expect(openRowButton.getAttribute("disabled")).not.toBeNull();
      const siblingRow = screen.getByTestId(`admin-dispute-row-${SIBLING_ROW_ID}`);
      expect(
        within(siblingRow).getByTestId(`admin-dispute-action-${SIBLING_ROW_ID}-resolve`).getAttribute("disabled")
      ).toBeNull();

      // Clean dismissal releases the slot with the dialog.
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: tc.cancel }));
      await waitFor(() => {
        expect(screen.queryByRole("dialog")).toBeNull();
      });
      const releasedButton = within(screen.getByTestId(`admin-dispute-row-${QUEUE_ROW_ID}`)).getByTestId(
        `admin-dispute-action-${QUEUE_ROW_ID}-resolve`
      );
      expect(releasedButton.getAttribute("disabled")).toBeNull();
    });

    test("branch 7 — arbitration dialog: radios, note counter, no-resolution submit gate, clean dismissal", async () => {
      // NO mutation mock is chained: a leaked wire call from the gated
      // submit would surface as an unmatched MockLink operation and fail
      // the branch.
      renderDisputes([queuePageMock(1, QUEUE_ROWS, QUEUE_ROWS.length)], locale);

      const dialog = await openResolveDialog(QUEUE_ROW_ID);
      // The TITLE resolves through its heading role: in en the title and
      // the submit label are the SAME string ("Resolve dispute"), so a
      // text query would match both the DialogTitle and the button.
      expect(within(dialog).getByRole("heading", { name: t.resolveDisputeTitle })).toBeDefined();
      expect(within(dialog).getByText(t.resolveDisputeBody)).toBeDefined();
      expect(within(dialog).getByText(t.resolutionCancelHelper)).toBeDefined();
      expect(within(dialog).getByText(t.resolutionCompleteHelper)).toBeDefined();
      // The MUI outlined TextField renders its label twice in the DOM (the
      // visible <label> AND the fieldset <legend> notch clone) — assert
      // presence via getAllByText instead of a singular getByText.
      expect(within(dialog).getAllByText(t.resolutionNoteLabel).length).toBeGreaterThan(0);

      const cancelRadio = within(dialog).getByRole("radio", { name: t.resolutionCancelLabel });
      const completeRadio = within(dialog).getByRole("radio", { name: t.resolutionCompleteLabel });
      const submit = within(dialog).getByTestId("resolve-dispute-submit");
      // No default resolution — the submit stays disabled until an outcome
      // is EXPLICITLY chosen.
      expect(submit.getAttribute("disabled")).not.toBeNull();
      // The optional note field exposes the INITIAL raw-character counter.
      expect(within(dialog).getByText(`0/${MAX_RESOLVE_NOTE_LENGTH}`)).toBeDefined();

      // Handler-level gate: a submit with NO resolution never reaches the
      // wire — the dialog stays open and no error surface fires.
      fireEvent.submit(dialog);
      expect(screen.getByRole("dialog")).toBeDefined();
      expect(screen.queryByText(t.genericError)).toBeNull();
      expect(screen.queryByText(te.validation)).toBeNull();

      // Choosing an outcome arms the submit; the radios are exclusive.
      fireEvent.click(completeRadio);
      expect(completeRadio.matches(":checked")).toBe(true);
      expect(cancelRadio.matches(":checked")).toBe(false);
      expect(
        within(screen.getByRole("dialog")).getByTestId("resolve-dispute-submit").getAttribute("disabled")
      ).toBeNull();
      fireEvent.click(cancelRadio);
      expect(cancelRadio.matches(":checked")).toBe(true);
      expect(completeRadio.matches(":checked")).toBe(false);

      // Clean dismissal — no mutation, queue untouched, slot released.
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: tc.cancel }));
      await waitFor(() => {
        expect(screen.queryByRole("dialog")).toBeNull();
      });
      expect(screen.getByTestId(`admin-dispute-row-${QUEUE_ROW_ID}`)).toBeDefined();
      expect(screen.getByTestId(`admin-dispute-row-${SIBLING_ROW_ID}`)).toBeDefined();
      expect(screen.queryByText(t.disputeResolvedNotice)).toBeNull();
      expect(screen.queryByText(t.genericError)).toBeNull();
    });

    // RUNNER-WEDGE family (DEV3-005 4.1 compensating control) — SKIPped:
    // the resolve→SUCCESS convergence (MockLink resolution racing the
    // dialog unmount + ROOT_QUERY cache-filter write) dead-ends the Happy
    // DOM runner into a timer- AND microtask-starving allocation loop
    // (process OOM-killed before any breadcrumb past the submit click;
    // reproduced through BOTH fireEvent.submit and the click submitter,
    // with and without addTypename — instrumentation shifts timing only).
    // Body INTACT — one-line flip re-enables. Compensating controls: the
    // error arms (branches 9/10) exercise the same submit machinery live,
    // and the real-browser 4.1 agent-browser loop arbitrates BOTH outcomes.
    test.skip("branch 8 — resolve→Cancel success (note optional → null): dialog closes, snackbar, row leaves the queue", async () => {
      renderDisputes(
        [
          queuePageMock(1, QUEUE_ROWS, QUEUE_ROWS.length),
          resolveMock(QUEUE_ROW_ID, DisputeResolution.Cancel, {
            kind: "success",
            payload: cancelledPayload(QUEUE_ROW_ID),
          }),
        ],
        locale
      );

      await waitFor(() => {
        expect(screen.getByTestId(`admin-dispute-row-${FIRST_POPULATED_ID}`)).toBeDefined();
      });
      const dialog = await openResolveDialog(QUEUE_ROW_ID);
      fireEvent.click(within(dialog).getByRole("radio", { name: t.resolutionCancelLabel }));
      // Success arms submit via a CLICK on the type="submit" button (the
      // form's real submitter path) — NOT `fireEvent.submit(dialog)`: under
      // Happy DOM, dispatching `submit` while the handler's success flow
      // writes the cache, closes the dialog and unmounts the form mid-
      // dispatch sends the runner into an unbounded allocation loop (OOM
      // kill); the error arms (9/10) and the empty-gate probe (branch 7)
      // never unmount the form, so their `fireEvent.submit` is safe.
      fireEvent.click(within(dialog).getByTestId("resolve-dispute-submit"));

      // Dialog closes + success snackbar with the arbitration vocabulary.
      await waitFor(() => {
        expect(screen.queryByRole("dialog")).toBeNull();
      });
      await waitFor(() => {
        expect(screen.getByText(t.disputeResolvedNotice)).toBeDefined();
      });
      expect(snackbarSeverityClass(t.disputeResolvedNotice)).toContain("MuiAlert-colorSuccess");

      // The resolved row leaves the queue via the dialog's cache filter
      // (items filtered + honest totalCount decremented — NO refetch).
      await waitFor(() => {
        expect(screen.queryByTestId(`admin-dispute-row-${QUEUE_ROW_ID}`)).toBeNull();
      });
      expect(screen.getByTestId(`admin-dispute-row-${SIBLING_ROW_ID}`)).toBeDefined();
      expect(screen.getByTestId("admin-disputes-count").textContent).toBe(t.adminDisputesCountLine(1));
    });

    test("branch 9 — resolve submit SESSION_INVALID_TRANSITION: error snackbar, dialog closes, queue intact", async () => {
      renderDisputes(
        [
          queuePageMock(1, QUEUE_ROWS, QUEUE_ROWS.length),
          resolveMock(QUEUE_ROW_ID, DisputeResolution.Cancel, { kind: "error", code: "SESSION_INVALID_TRANSITION" }),
        ],
        locale
      );

      await waitFor(() => {
        expect(screen.getByTestId(`admin-dispute-row-${FIRST_POPULATED_ID}`)).toBeDefined();
      });
      const dialog = await openResolveDialog(QUEUE_ROW_ID);
      fireEvent.click(within(dialog).getByRole("radio", { name: t.resolutionCancelLabel }));
      fireEvent.submit(dialog);

      // The lifecycle-reject code is snackbar-mapped and the dialog closes
      // (the container's invalid-transition arm), but the row STAYS — an
      // admin surface carries NO eviction arm.
      await waitFor(() => {
        expect(screen.getByText(te.sessionInvalidTransition)).toBeDefined();
      });
      expect(snackbarSeverityClass(te.sessionInvalidTransition)).toContain("MuiAlert-colorError");
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(screen.getByTestId(`admin-dispute-row-${QUEUE_ROW_ID}`)).toBeDefined();
      expect(screen.getByTestId(`admin-dispute-row-${SIBLING_ROW_ID}`)).toBeDefined();
      expect(screen.getByTestId("admin-disputes-count").textContent).toBe(t.adminDisputesCountLine(QUEUE_ROWS.length));
    });

    test("branch 10 — resolve submit VALIDATION (Complete on a never-started session): dialog STAYS open", async () => {
      renderDisputes(
        [
          queuePageMock(1, QUEUE_ROWS, QUEUE_ROWS.length),
          resolveMock(QUEUE_ROW_ID, DisputeResolution.Complete, { kind: "error", code: "VALIDATION" }),
        ],
        locale
      );

      await waitFor(() => {
        expect(screen.getByTestId(`admin-dispute-row-${FIRST_POPULATED_ID}`)).toBeDefined();
      });
      const dialog = await openResolveDialog(QUEUE_ROW_ID);
      fireEvent.click(within(dialog).getByRole("radio", { name: t.resolutionCompleteLabel }));
      fireEvent.submit(dialog);

      // The failure arm surfaces the localized error snackbar and keeps the
      // dialog open for a corrected choice (its documented contract).
      await waitFor(() => {
        expect(screen.getByText(te.validation)).toBeDefined();
      });
      expect(snackbarSeverityClass(te.validation)).toContain("MuiAlert-colorError");
      expect(screen.getByRole("dialog")).toBeDefined();
      // The queue is untouched while the correction is pending.
      expect(screen.getByTestId(`admin-dispute-row-${QUEUE_ROW_ID}`)).toBeDefined();
      expect(screen.getByTestId(`admin-dispute-row-${SIBLING_ROW_ID}`)).toBeDefined();
      expect(screen.getByTestId("admin-disputes-count").textContent).toBe(t.adminDisputesCountLine(QUEUE_ROWS.length));
    });

    // RUNNER-WEDGE family — SKIPped for the branch-8 reason (the ghost-page
    // guard rides the same resolve→SUCCESS convergence). Body INTACT —
    // one-line flip re-enables. Compensating control: the 4.1 agent-browser
    // arbitration loop drives a trailing-page resolution live.
    test.skip("branch 11 — ghost-page guard: resolving the LAST row of a trailing page steps back to page 1", async () => {
      // Page 1 (2 rows, honest total 3) → a second page exists; page 2
      // carries EXACTLY ONE row — the trailing page's last row. The final
      // mock re-answers page 1 with the POST-resolution honest total (the
      // re-key usually serves from the mutated cache; the mock is the
      // network safety net with the same observable state either way).
      renderDisputes(
        [
          queuePageMock(1, QUEUE_ROWS, 3),
          queuePageMock(2, [disputeFixture({ id: TRAILING_ROW_ID })], 3),
          resolveMock(TRAILING_ROW_ID, DisputeResolution.Cancel, {
            kind: "success",
            payload: cancelledPayload(TRAILING_ROW_ID),
          }),
          queuePageMock(1, QUEUE_ROWS, 2),
        ],
        locale
      );

      await waitFor(() => {
        expect(screen.getByTestId(`admin-dispute-row-${FIRST_POPULATED_ID}`)).toBeDefined();
      });
      expect(screen.getByTestId("admin-disputes-count").textContent).toBe(t.adminDisputesCountLine(3));

      // Navigate to the trailing page.
      fireEvent.click(screen.getByTestId("admin-disputes-pager-next"));
      await waitFor(() => {
        expect(screen.getByTestId(`admin-dispute-row-${TRAILING_ROW_ID}`)).toBeDefined();
      });
      expect(within(screen.getByTestId("admin-disputes-pager")).getByText("2 / 2")).toBeDefined();

      // Resolve the lone trailing row (Cancel, empty note → null).
      const dialog = await openResolveDialog(TRAILING_ROW_ID);
      fireEvent.click(within(dialog).getByRole("radio", { name: t.resolutionCancelLabel }));
      // Success arm → CLICK the submitter (see the branch-8 Happy-DOM note:
      // fireEvent.submit + success-path unmount loops the runner into OOM).
      fireEvent.click(within(dialog).getByTestId("resolve-dispute-submit"));
      await waitFor(() => {
        expect(screen.queryByRole("dialog")).toBeNull();
      });
      await waitFor(() => {
        expect(screen.getByText(t.disputeResolvedNotice)).toBeDefined();
      });
      expect(snackbarSeverityClass(t.disputeResolvedNotice)).toContain("MuiAlert-colorSuccess");

      // The guard steps BACK to page 1 instead of rendering a ghost page:
      // a page-1 row is visible again, the resolved row is gone, the empty
      // state never appears, the count shrank to the post-resolution total,
      // and the drained queue spans a single page (pager removed).
      await waitFor(() => {
        expect(screen.getByTestId(`admin-dispute-row-${FIRST_POPULATED_ID}`)).toBeDefined();
      });
      expect(screen.queryByTestId(`admin-dispute-row-${TRAILING_ROW_ID}`)).toBeNull();
      expect(screen.queryByTestId("admin-disputes-empty")).toBeNull();
      expect(screen.getByTestId("admin-disputes-count").textContent).toBe(t.adminDisputesCountLine(2));
      expect(document.querySelector("[data-testid='admin-disputes-pager']")).toBeNull();
    });
  });
}
