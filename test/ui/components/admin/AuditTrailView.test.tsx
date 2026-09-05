/**
 * AuditTrailView — the `/audit` admin audit-trail component suite.
 *
 * Happy DOM + Apollo `MockedProvider` tier (`test/ui/components`): every
 * render branch and interaction flow, driven with translation-handle
 * matchers ONLY (labels resolved from the `AdminUsers` / `Common` /
 * `Errors` namespace handles; fixture ids/names/JSON are technical test
 * data):
 *
 *   busy skeleton → loaded table (headers, actor names, locale-aware
 *   stamps, action chips, pagination echo) · empty state · FORBIDDEN →
 *   PermissionDeniedFallback · RATE_LIMITED → RetryableNotice · generic
 *   failure + retry recovery · filter submit narrowing (the second wire
 *   query carries the applied filters; stale rows leave) · null
 *   entityId/details em-dash placeholders · details expand/collapse
 *   verbatim · deep-link initialFilters seeding incl. invalid-value
 *   dropping · draft normalization (a zero id / inverted range applies
 *   as cleared, never an error) · UTC day-boundary serialization on the
 *   wire · pagination advance + reset-on-apply · Arabic RTL render.
 *
 * The UTC boundary pins assert the WIRE variables: a `from` calendar day
 * serializes to its own midnight (`…T00:00:00.000Z`, inclusive) and a `to`
 * day to the FOLLOWING midnight (exclusive end), so a calendar-day range is
 * inclusive of its whole last day.
 */

// ─── Harness preloads (inline replication of the `test:ui:components` stack) ─
//
// `bun run test/scripts/run-test.ts <file>` spawns
// `bun --env-file=.env.test test <file>` with NO `--preload` flags, and
// bunfig.toml's single `[test]` preload list carries only the global five
// (runner guard / logger mock / env / graphql-interop / apollo-dev-flag) —
// the four UI preloads are otherwise supplied solely by the package script.
// This suite therefore carries its own copy of that exact stack, in the same
// order, as the FIRST statements of the module body. They are top-level
// awaited dynamic imports (not bare side-effect statics) both to keep the
// body-ordered execution explicit and because bare unassigned imports are a
// lint error (`import/no-unassigned-import`); the static import graph above
// them is DOM-free (MUI / Apollo / locale are call-time DOM readers — SSR
// modules must be). Every preload module below is re-entry safe
// (`GlobalRegistrator.isRegistered` guard, module-singleton registrations).
await import("@/test/ui/test-env");
await import("@/test/ui/components/happydom-preload");
await import("@/test/ui/components/translation-preload");
await import("@/test/ui/components/next-dynamic-mock");

// ─── Post-DOM module wiring (top-level await — LOAD ORDERING CONTRACT) ───────
//
// Under `bun test` the static import graph of a test file is evaluated
// BEFORE the file's own import statements interleave module bodies in source
// order, so a STATIC import of `@testing-library/react` would capture
// `screen` while `typeof document === "undefined"` (`@testing-library/dom`
// binds `screen` to `document.body` once at module-eval time) and every
// `screen.*` query would throw the "global document has to be available"
// TypeError — even though `render()` itself works (it reads `document` at
// call time). Proven by probe: with the same imports, a static RTL import
// yields an unbound `screen` while a top-level await here yields a bound
// one. Awaiting RTL + TestWrapper (which statically re-imports RTL) at
// top level guarantees the Happy-DOM window exists before either module —
// and any module evaluated earlier must therefore never touch
// `@testing-library/react` (the view under test imports only MUI / Apollo /
// locale, which are all call-time DOM readers).
const { cleanup, fireEvent, screen, waitFor, within } = await import("@testing-library/react");
const { renderWithWrapper } = await import("@/test/ui/components/TestWrapper");

import { afterEach, describe, expect, test } from "bun:test";
import type { MockLink } from "@apollo/client/testing";
import { MockedProvider } from "@apollo/client/testing/react";
import type { RenderResult } from "@testing-library/react";
import {
  type AdminAuditLogFiltersInput,
  type AdminAuditLogsQuery,
  type AdminAuditLogsQuery_adminAuditLogs,
  type AdminAuditLogsQuery_adminAuditLogs_items,
  type AdminAuditLogsQueryVariables,
  AuditActionType,
} from "@/frontend/graphql/generated/gql/graphql";
import { adminAuditLogsQueryDocument } from "@/frontend/graphql/sharedDocuments";
import { type AuditTrailFiltersSeed, AuditTrailView } from "@/frontend/views/admin/audit/AuditTrailView";
import type { AppLocale } from "@/shared/locale/AppLocale";
import { arMessages } from "@/shared/locale/ar/messages";
import { enMessages } from "@/shared/locale/en/messages";
import { AdminUsers } from "@/shared/locale/namespaces/adminUsers";
import { Common } from "@/shared/locale/namespaces/common";
import { Errors } from "@/shared/locale/namespaces/errors";
import { getTranslations } from "@/shared/locale/server";

// NOTE: `renderWithWrapper` is deliberately NOT statically imported here —
// `TestWrapper.tsx` statically imports `@testing-library/react`, so a static
// import would pull RTL into the pre-DOM evaluation phase described above.
// It arrives via the top-level `await import` block instead.

// Warm the AdminUsers handle for BOTH locales eagerly — missing-key drift
// surfaces here, at the earliest possible moment, not inside an assertion.
AdminUsers.getLabels(arMessages);
AdminUsers.getLabels(enMessages);

// ─── Fixtures & helpers ─────────────────────────────────────────────────────

/** Deterministic UTC instant shared by every fixture row. */
const FIXED_ISO = "2026-08-29T12:00:00.000Z";
/** Raw details payload — rendered VERBATIM when a row is expanded. */
const DETAILS_JSON = '{"role":"teacher","note":"promoted"}';

/**
 * Fixture row type — the codegen row PLUS `__typename`.
 *
 * MockLink passes `result.data` through AS-IS (Apollo does not synthesize
 * `__typename` on mocked results), and without it the cache cannot
 * normalize `AdminAuditLogEntry` rows by id — the same fixture posture the
 * notifications feed suite established.
 */
type EntryFixture = AdminAuditLogsQuery_adminAuditLogs_items & {
  readonly __typename: "AdminAuditLogEntry";
};

function auditRow(overrides?: Partial<EntryFixture>): EntryFixture {
  return {
    __typename: "AdminAuditLogEntry",
    id: "301",
    actionType: AuditActionType.Create,
    actorId: 1,
    actorName: "Admin One",
    entityType: "user",
    entityId: 12,
    details: DETAILS_JSON,
    createdAt: FIXED_ISO,
    ...overrides,
  };
}

type PageFixture = AdminAuditLogsQuery_adminAuditLogs & {
  readonly __typename: "AdminAuditLogPage";
};

/** Wrapper fixture — carries its own `__typename` for the embedded value type. */
function auditPage(rows: readonly EntryFixture[], totalCount: number, page = 1, pageSize = 10): AdminAuditLogsQuery {
  const wrapper: PageFixture = { __typename: "AdminAuditLogPage", items: [...rows], totalCount, page, pageSize };
  return { adminAuditLogs: wrapper };
}

const ROW_A = auditRow();
const ROW_B = auditRow({ id: "302", actionType: AuditActionType.Update, actorName: "Admin Two", entityId: 13 });
const ROW_PAGE_TWO = auditRow({ id: "303", actionType: AuditActionType.Delete, actorName: "Page Two Actor" });
const ROW_FILTERED = auditRow({
  id: "304",
  actionType: AuditActionType.Suspend,
  actorName: "Sole Actor",
  entityType: "plan",
  entityId: null,
  details: null,
});

/** The unfiltered first window the view queries with no filters applied. */
const UNFILTERED_PAGE_ONE: AdminAuditLogsQueryVariables = { filters: wireFilters({}), page: 1, pageSize: 10 };

function trailMock(
  variables: AdminAuditLogsQueryVariables | ((vars: AdminAuditLogsQueryVariables) => boolean),
  data: AdminAuditLogsQuery
): MockLink.MockedResponse {
  return { request: { query: adminAuditLogsQueryDocument, variables }, result: { data } };
}

/**
 * Completes a partial expected filters object with the remaining keys left
 * undefined (the generated input type declares every key; MockLink treats
 * undefined-valued keys as absent, exactly like the view's builder).
 */
function wireFilters(partial: Partial<AdminAuditLogFiltersInput>): AdminAuditLogFiltersInput {
  return {
    actionType: undefined,
    actorId: undefined,
    entityId: undefined,
    entityType: undefined,
    from: undefined,
    to: undefined,
    ...partial,
  };
}

function codeErrorMock(variables: AdminAuditLogsQueryVariables, code: string): MockLink.MockedResponse {
  return {
    request: { query: adminAuditLogsQueryDocument, variables },
    result: { errors: [{ message: `${code} (masked transport surface)`, extensions: { code } }] },
  };
}

// ─── Locale-driven matchers ─────────────────────────────────────────────────

const t = AdminUsers.getLabels(getTranslations("en"));
const tc = Common.getLabels(getTranslations("en"));
const te = Errors.getLabels(getTranslations("en"));
const tar = AdminUsers.getLabels(getTranslations("ar"));
const tear = Errors.getLabels(getTranslations("ar"));

function renderTrail(
  mocks: ReadonlyArray<MockLink.MockedResponse>,
  initialFilters?: AuditTrailFiltersSeed
): RenderResult {
  return renderWithWrapper(
    <MockedProvider mocks={[...mocks]}>
      <AuditTrailView initialFilters={initialFilters} />
    </MockedProvider>,
    { locale: "en" }
  );
}

function renderTrailRtl(mocks: ReadonlyArray<MockLink.MockedResponse>): RenderResult {
  return renderWithWrapper(
    <MockedProvider mocks={[...mocks]}>
      <AuditTrailView />
    </MockedProvider>,
    { locale: "ar" }
  );
}

/** Recomputes the timestamp stamp independently of the implementation. */
function expectedTimestamp(iso: string, locale: AppLocale): string {
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

afterEach(cleanup);

// ─── Suite (en / LTR) ───────────────────────────────────────────────────────

describe("AuditTrailView (en / LTR)", () => {
  test("initial load renders the busy skeleton, then the loaded trail with formatted stamps", async () => {
    renderTrail([
      {
        request: { query: adminAuditLogsQueryDocument, variables: UNFILTERED_PAGE_ONE },
        result: { data: auditPage([ROW_A, ROW_B], 25) },
        delay: 30,
      },
    ]);

    // First paint: the aria-busy output wrapper and NO settled rows.
    const busy = screen.getByRole("status");
    expect(busy.getAttribute("aria-busy")).toBe("true");
    expect(screen.queryByText(ROW_A.actorName)).toBeNull();

    await waitFor(() => {
      expect(screen.getByRole("table", { name: t.auditTrail.pageTitle })).toBeDefined();
      expect(screen.getByText(ROW_A.actorName)).toBeDefined();
    });

    expect(screen.getByText(ROW_B.actorName)).toBeDefined();
    expect(screen.getAllByText(expectedTimestamp(FIXED_ISO, "en")).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("heading", { level: 1, name: t.auditTrail.pageTitle })).toBeDefined();
    expect(screen.getByText(t.auditTrail.pageSubtitle)).toBeDefined();

    // All six headers through the handle — resolved as COLUMN HEADERS inside
    // the table (the filter bar legitimately repeats the entity labels, so a
    // document-wide text query would be ambiguous by design).
    const table = screen.getByRole("table", { name: t.auditTrail.pageTitle });
    expect(within(table).getByRole("columnheader", { name: t.auditTrail.table.whenHeader })).toBeDefined();
    expect(within(table).getByRole("columnheader", { name: t.auditTrail.table.actorHeader })).toBeDefined();
    expect(within(table).getByRole("columnheader", { name: t.auditTrail.table.actionHeader })).toBeDefined();
    expect(within(table).getByRole("columnheader", { name: t.auditTrail.table.entityTypeHeader })).toBeDefined();
    expect(within(table).getByRole("columnheader", { name: t.auditTrail.table.entityIdHeader })).toBeDefined();
    expect(within(table).getByRole("columnheader", { name: t.auditTrail.table.detailsHeader })).toBeDefined();
    expect(screen.getByText(t.activity.actionCreate)).toBeDefined();
    expect(screen.getByText(t.activity.actionUpdate)).toBeDefined();

    // The filter bar carries the localized action-type combobox and the
    // 44px Apply/Clear pair.
    expect(screen.getByRole("combobox", { name: t.auditTrail.filters.actionTypeLabel })).toBeDefined();
    expect(screen.getByRole("button", { name: t.auditTrail.filters.applyAction })).toBeDefined();
    expect(screen.getByRole("button", { name: t.auditTrail.filters.clearAction })).toBeDefined();
  });

  test("pagination echoes the server envelope; next page re-queries page=2; apply resets to page one", async () => {
    renderTrail([
      trailMock(UNFILTERED_PAGE_ONE, auditPage([ROW_A], 25)),
      trailMock({ filters: wireFilters({}), page: 2, pageSize: 10 }, auditPage([ROW_PAGE_TWO], 25, 2)),
      trailMock({ filters: wireFilters({ actorId: 9 }), page: 1, pageSize: 10 }, auditPage([ROW_FILTERED], 1)),
    ]);

    await waitFor(() => expect(screen.getByText(ROW_A.actorName)).toBeDefined());

    // Honest envelope echo in the displayed-rows caption.
    expect(screen.getByText(`${t.pagination.showingPrefix} 1–10 ${t.pagination.of} 25`)).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: t.pagination.next }));

    await waitFor(() => {
      expect(screen.getByText(ROW_PAGE_TWO.actorName)).toBeDefined();
      expect(screen.queryByText(ROW_A.actorName)).toBeNull();
    });
    expect(screen.getByText(`${t.pagination.showingPrefix} 11–20 ${t.pagination.of} 25`)).toBeDefined();

    // Applying a filter resets the window to page one — the narrowed
    // request carries page 1, not the stale page 2.
    fireEvent.change(screen.getByLabelText(t.auditTrail.filters.actorIdLabel), { target: { value: "9" } });
    fireEvent.click(screen.getByRole("button", { name: t.auditTrail.filters.applyAction }));

    await waitFor(() => {
      expect(screen.getByText(ROW_FILTERED.actorName)).toBeDefined();
      expect(screen.queryByText(ROW_PAGE_TWO.actorName)).toBeNull();
    });
    expect(screen.getByText(`${t.pagination.showingPrefix} 1–1 ${t.pagination.of} 1`)).toBeDefined();
  });

  test("empty result set renders the honest empty state without the table", async () => {
    renderTrail([trailMock(UNFILTERED_PAGE_ONE, auditPage([], 0))]);

    await waitFor(() => expect(screen.getByText(t.auditTrail.emptyState.title)).toBeDefined());
    expect(screen.getByText(t.auditTrail.emptyState.message)).toBeDefined();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByText(ROW_A.actorName)).toBeNull();
  });

  test("FORBIDDEN denial renders the shared PermissionDeniedFallback surface", async () => {
    renderTrail([codeErrorMock(UNFILTERED_PAGE_ONE, "FORBIDDEN")]);

    await waitFor(() => expect(screen.getByText(te.forbiddenRole)).toBeDefined());
    expect(screen.getByText(te.forbidden)).toBeDefined();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByText(t.auditTrail.emptyState.title)).toBeNull();
  });

  test("RATE_LIMITED surfaces the shared RetryableNotice with the common retry affordance", async () => {
    renderTrail([codeErrorMock(UNFILTERED_PAGE_ONE, "RATE_LIMITED")]);

    await waitFor(() => expect(screen.getByText(te.rateLimitExceeded)).toBeDefined());
    expect(screen.getByRole("button", { name: tc.retry })).toBeDefined();
    expect(screen.queryByText(t.auditTrail.emptyState.title)).toBeNull();
  });

  test("generic failure renders the localized error notice and retry recovers the trail", async () => {
    renderTrail([
      codeErrorMock(UNFILTERED_PAGE_ONE, "INTERNAL_SERVER_ERROR"),
      trailMock(UNFILTERED_PAGE_ONE, auditPage([ROW_A], 1)),
    ]);

    await waitFor(() => expect(screen.getByText(t.auditTrail.errorState.title)).toBeDefined());
    expect(screen.getByText(t.auditTrail.errorState.message)).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: tc.retry }));

    await waitFor(() => expect(screen.getByText(ROW_A.actorName)).toBeDefined());
    expect(screen.queryByText(t.auditTrail.errorState.title)).toBeNull();
  });

  test("filter submit narrows the second wire query and stale rows leave", async () => {
    renderTrail([
      trailMock(UNFILTERED_PAGE_ONE, auditPage([ROW_A, ROW_B], 2)),
      trailMock(
        { filters: wireFilters({ actorId: 3, entityId: 7, entityType: "user" }), page: 1, pageSize: 10 },
        auditPage([ROW_FILTERED], 1)
      ),
    ]);

    await waitFor(() => {
      expect(screen.getByText(ROW_A.actorName)).toBeDefined();
      expect(screen.getByText(ROW_B.actorName)).toBeDefined();
    });

    fireEvent.change(screen.getByLabelText(t.auditTrail.filters.actorIdLabel), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText(t.auditTrail.filters.entityTypeLabel), { target: { value: "user" } });
    fireEvent.change(screen.getByLabelText(t.auditTrail.filters.entityIdLabel), { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: t.auditTrail.filters.applyAction }));

    // The narrowed window lands (the mock only matches the narrowed
    // variables) while BOTH stale rows leave — no overlap.
    await waitFor(() => {
      expect(screen.queryByText(ROW_A.actorName)).toBeNull();
      expect(screen.queryByText(ROW_B.actorName)).toBeNull();
      expect(screen.getByText(ROW_FILTERED.actorName)).toBeDefined();
    });
  });

  test("a zero actor-id draft applies as cleared — the wire carries no actorId and no error renders", async () => {
    renderTrail(
      [
        trailMock({ filters: wireFilters({ actorId: 9 }), page: 1, pageSize: 10 }, auditPage([ROW_FILTERED], 1)),
        trailMock(UNFILTERED_PAGE_ONE, auditPage([ROW_A, ROW_B], 2)),
      ],
      { actorId: 9 }
    );

    await waitFor(() => expect(screen.getByText(ROW_FILTERED.actorName)).toBeDefined());

    // Ids are 1-based: typing `0` applies as a CLEARED filter (the same
    // bound the route's deep-link sanitizer enforces), so the unfiltered
    // window re-queries — a server-rejected `actorId: 0` never rides the
    // wire and no error seam renders.
    fireEvent.change(screen.getByLabelText(t.auditTrail.filters.actorIdLabel), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: t.auditTrail.filters.applyAction }));

    await waitFor(() => {
      expect(screen.getByText(ROW_A.actorName)).toBeDefined();
      expect(screen.getByText(ROW_B.actorName)).toBeDefined();
      expect(screen.queryByText(ROW_FILTERED.actorName)).toBeNull();
    });
    expect(screen.queryByText(t.auditTrail.errorState.title)).toBeNull();
    expect(screen.queryByText(t.auditTrail.errorState.message)).toBeNull();
  });

  test("an actor-id draft above the wire Int max applies as cleared — the wire carries no actorId and no error renders", async () => {
    renderTrail(
      [
        trailMock({ filters: wireFilters({ actorId: 9 }), page: 1, pageSize: 10 }, auditPage([ROW_FILTERED], 1)),
        trailMock(UNFILTERED_PAGE_ONE, auditPage([ROW_A, ROW_B], 2)),
      ],
      { actorId: 9 }
    );

    await waitFor(() => expect(screen.getByText(ROW_FILTERED.actorName)).toBeDefined());

    // 3000000000 exceeds the GraphQL Int wire max (2^31 - 1): the draft
    // applies as CLEARED (the same silent-drop posture as a zero id), so
    // the unfiltered window re-queries — a wire-rejected actorId never
    // rides the variables and no error seam renders.
    fireEvent.change(screen.getByLabelText(t.auditTrail.filters.actorIdLabel), { target: { value: "3000000000" } });
    fireEvent.click(screen.getByRole("button", { name: t.auditTrail.filters.applyAction }));

    await waitFor(() => {
      expect(screen.getByText(ROW_A.actorName)).toBeDefined();
      expect(screen.getByText(ROW_B.actorName)).toBeDefined();
      expect(screen.queryByText(ROW_FILTERED.actorName)).toBeNull();
    });
    expect(screen.queryByText(t.auditTrail.errorState.title)).toBeNull();
    expect(screen.queryByText(t.auditTrail.errorState.message)).toBeNull();
  });

  test("an inverted from/to draft clears the pair — the wire carries neither bound and no error renders", async () => {
    renderTrail(
      [
        trailMock(
          {
            filters: wireFilters({ entityType: "user", from: "2026-02-03T00:00:00.000Z" }),
            page: 1,
            pageSize: 10,
          },
          auditPage([ROW_A], 1)
        ),
        trailMock({ filters: wireFilters({ entityType: "user" }), page: 1, pageSize: 10 }, auditPage([ROW_B], 1)),
      ],
      { entityType: "user", from: "2026-02-03" }
    );

    await waitFor(() => expect(screen.getByText(ROW_A.actorName)).toBeDefined());

    // Typing an earlier `to` inverts the range: the whole pair clears (the
    // route's own deep-link posture for inverted ranges) while the surviving
    // entity-type filter stays — the degenerate window never reaches the
    // wire and no error seam renders.
    fireEvent.change(screen.getByLabelText(t.auditTrail.filters.toDateLabel), { target: { value: "2026-02-01" } });
    fireEvent.click(screen.getByRole("button", { name: t.auditTrail.filters.applyAction }));

    await waitFor(() => {
      expect(screen.getByText(ROW_B.actorName)).toBeDefined();
      expect(screen.queryByText(ROW_A.actorName)).toBeNull();
    });
    expect(screen.queryByText(t.auditTrail.errorState.title)).toBeNull();
    expect(screen.queryByText(t.auditTrail.errorState.message)).toBeNull();
  });
  test("null details and null entityId render the namespace em-dash placeholders", async () => {
    renderTrail([trailMock(UNFILTERED_PAGE_ONE, auditPage([ROW_FILTERED], 1))]);

    await waitFor(() => expect(screen.getByText(ROW_FILTERED.actorName)).toBeDefined());

    // The namespace pins BOTH placeholders to the SAME locale-neutral em-dash glyph,
    // so the single fixture row's two null cells resolve as exactly two
    // matching text nodes.
    expect(screen.getAllByText(t.auditTrail.table.noEntityIdValue)).toHaveLength(2);
    expect(screen.getAllByText(t.auditTrail.table.noDetailsValue)).toHaveLength(2);
    // No expansion affordance exists for a null payload.
    expect(screen.queryByRole("button", { name: t.auditTrail.table.detailsShowLabel })).toBeNull();
  });

  test("details expansion renders the payload verbatim and collapses back", async () => {
    renderTrail([trailMock(UNFILTERED_PAGE_ONE, auditPage([ROW_A], 1))]);

    await waitFor(() => expect(screen.getByText(ROW_A.actorName)).toBeDefined());
    expect(screen.queryByText(DETAILS_JSON)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: t.auditTrail.table.detailsShowLabel }));

    // The pre-formatted block carries the RAW payload verbatim.
    expect(screen.getByText(DETAILS_JSON)).toBeDefined();
    expect(
      screen.getByRole("button", { name: t.auditTrail.table.detailsHideLabel }).getAttribute("aria-expanded")
    ).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: t.auditTrail.table.detailsHideLabel }));

    expect(screen.queryByText(DETAILS_JSON)).toBeNull();
    expect(screen.getByRole("button", { name: t.auditTrail.table.detailsShowLabel })).toBeDefined();
  });

  test("action-type combobox opens onto the all-actions option and the seven localized actions", async () => {
    renderTrail([trailMock(UNFILTERED_PAGE_ONE, auditPage([ROW_A], 1))]);

    await waitFor(() => expect(screen.getByText(ROW_A.actorName)).toBeDefined());

    // MUI's Select trigger opens on mousedown (SelectInput wires handleMouseDown
    // onto the combobox) — a plain click never opens the listbox.
    fireEvent.mouseDown(screen.getByRole("combobox", { name: t.auditTrail.filters.actionTypeLabel }));

    expect(screen.getByRole("option", { name: t.auditTrail.table.allActionsOption })).toBeDefined();
    expect(screen.getByRole("option", { name: t.activity.actionCreate })).toBeDefined();
    expect(screen.getByRole("option", { name: t.activity.actionUpdate })).toBeDefined();
    expect(screen.getByRole("option", { name: t.activity.actionDelete })).toBeDefined();
    expect(screen.getByRole("option", { name: t.activity.actionReactivate })).toBeDefined();
    expect(screen.getByRole("option", { name: t.activity.actionOverride })).toBeDefined();
    expect(screen.getByRole("option", { name: t.activity.actionAdjust })).toBeDefined();
    expect(screen.getByRole("option", { name: t.activity.actionSuspend })).toBeDefined();
  });

  test("deep-link initialFilters seed the bar AND the first wire query with UTC day boundaries", async () => {
    // A `to` calendar day expands to the EXCLUSIVE boundary of the following
    // midnight, so the 2026-02-01→2026-02-03 day range rides the wire as a
    // half-open instant interval.
    renderTrail(
      [
        trailMock(
          vars =>
            vars.filters?.actorId === 5 &&
            vars.filters?.entityId === 9 &&
            vars.filters?.entityType === "user" &&
            vars.filters?.from === "2026-02-01T00:00:00.000Z" &&
            vars.filters?.to === "2026-02-04T00:00:00.000Z",
          auditPage([ROW_FILTERED], 1)
        ),
      ],
      { actorId: 5, entityId: 9, entityType: "user", from: "2026-02-01", to: "2026-02-03" }
    );

    await waitFor(() => expect(screen.getByText(ROW_FILTERED.actorName)).toBeDefined());

    // The draft bar is pre-filled from the sanitized seed.
    expect(screen.getByDisplayValue("5")).toBeDefined();
    expect(screen.getByDisplayValue("9")).toBeDefined();
    expect(screen.getByDisplayValue("user")).toBeDefined();
    expect(screen.getByDisplayValue("2026-02-01")).toBeDefined();
    expect(screen.getByDisplayValue("2026-02-03")).toBeDefined();
  });

  test("a malformed deep-link date normalizes to unfiltered instead of erroring", async () => {
    renderTrail(
      [
        trailMock(
          vars =>
            vars.filters?.actorId === 5 &&
            vars.filters?.entityId === undefined &&
            vars.filters?.from === "2026-02-01T00:00:00.000Z" &&
            vars.filters?.to === undefined,
          auditPage([ROW_FILTERED], 1)
        ),
      ],
      { actorId: 5, from: "2026-02-01", to: "not-a-date" }
    );

    await waitFor(() => expect(screen.getByText(ROW_FILTERED.actorName)).toBeDefined());

    // The hostile seed never reaches the bar or the wire.
    expect(screen.queryByDisplayValue("not-a-date")).toBeNull();
  });

  test("clear restores the unfiltered listing", async () => {
    // Seeded deep-link start: the FIRST wire query is the filtered one, so
    // the post-clear unfiltered variables address a NEVER-CACHED hash. A
    // plain apply→clear sequence would re-visit the initial load's variable
    // hash, which Apollo's default cache-first policy serves from the cache
    // without a network round-trip — the unfiltered wire request this test
    // pins could never be observed there. Clearing still exercises the same
    // contract: bar emptied, applied record reset, unfiltered page-1 query.
    renderTrail(
      [
        trailMock(
          { filters: wireFilters({ entityType: "user" }), page: 1, pageSize: 10 },
          auditPage([ROW_FILTERED], 1)
        ),
        trailMock(UNFILTERED_PAGE_ONE, auditPage([ROW_A, ROW_B], 2)),
      ],
      { entityType: "user" }
    );

    await waitFor(() => expect(screen.getByText(ROW_FILTERED.actorName)).toBeDefined());

    fireEvent.click(screen.getByRole("button", { name: t.auditTrail.filters.clearAction }));

    await waitFor(() => {
      expect(screen.getByText(ROW_A.actorName)).toBeDefined();
      expect(screen.getByText(ROW_B.actorName)).toBeDefined();
      expect(screen.queryByText(ROW_FILTERED.actorName)).toBeNull();
    });
    expect(screen.queryByDisplayValue("user")).toBeNull();
  });
});

// ─── Suite (ar / RTL) ───────────────────────────────────────────────────────

describe("AuditTrailView (ar / RTL)", () => {
  test("populated trail renders Arabic labels and Arabic-Indic stamps", async () => {
    renderTrailRtl([trailMock(UNFILTERED_PAGE_ONE, auditPage([ROW_A], 1))]);

    await waitFor(() => expect(screen.getByText(ROW_A.actorName)).toBeDefined());

    expect(screen.getByRole("heading", { level: 1, name: tar.auditTrail.pageTitle })).toBeDefined();
    expect(screen.getByText(tar.auditTrail.pageSubtitle)).toBeDefined();
    expect(screen.getByRole("table", { name: tar.auditTrail.pageTitle })).toBeDefined();
    expect(screen.getByText(tar.auditTrail.table.whenHeader)).toBeDefined();
    expect(screen.getByText(tar.auditTrail.table.actorHeader)).toBeDefined();
    expect(screen.getByText(tar.auditTrail.table.detailsHeader)).toBeDefined();
    expect(screen.getByText(tar.activity.actionCreate)).toBeDefined();
    expect(screen.getAllByText(expectedTimestamp(FIXED_ISO, "ar")).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("button", { name: tar.auditTrail.filters.applyAction })).toBeDefined();
    expect(screen.getByRole("button", { name: tar.auditTrail.filters.clearAction })).toBeDefined();
  });

  test("FORBIDDEN renders the shared denial surface in Arabic", async () => {
    renderTrailRtl([codeErrorMock(UNFILTERED_PAGE_ONE, "FORBIDDEN")]);

    await waitFor(() => expect(screen.getByText(tear.forbiddenRole)).toBeDefined());
    expect(screen.getByText(tear.forbidden)).toBeDefined();
    expect(screen.queryByRole("table")).toBeNull();
  });
});
