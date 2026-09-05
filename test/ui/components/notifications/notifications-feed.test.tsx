/**
 * NotificationsFeedContainer — the `/notifications` feed component suite
 * (tasks.md 4.3.TE).
 *
 * Happy DOM + Apollo `MockedProvider` tier (`test/ui/components`): every
 * render branch and interaction flow of the feed gets a case, driven across
 * BOTH locales (REQ-066 — translation-driven matchers ONLY, zero hardcoded
 * UI copy; fixture titles/ids/timestamps are technical test data):
 *
 *   populated feed (rows, chips, pluralized summary, aria wiring, stamps) ·
 *   empty state · unread filter chip over the wire · type filter chip ·
 *   mark-one (row restyle + count decrement, no refetch) ·
 *   mark-all confirm flow (dialog → sweep → affected-count snackbar) ·
 *   loading skeletons (aria-busy) · FORBIDDEN / RATE_LIMITED / generic
 *   error surfaces · retry recovery · offset pagination ·
 *   realtime cache-merge consumption (the hook-maintained cache path — the
 *   feed NEVER mounts its own socket, plan D11).
 *
 * The companion static-scan suite (`notifications-static-scan.test.ts`)
 * enforces the REQ-028 `dangerouslySetInnerHTML` prohibition over
 * `frontend/views/notifications/**`.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { ApolloClient } from "@apollo/client";
import { ApolloProvider } from "@apollo/client/react";
import { MockLink } from "@apollo/client/testing";
import { MockedProvider } from "@apollo/client/testing/react";
import { act, cleanup, fireEvent, type RenderResult, screen, waitFor, within } from "@testing-library/react";
import {
  type MyNotificationsFilterInput,
  type MyNotificationsQuery,
  type MyNotificationsQuery_myNotifications,
  type MyNotificationsQuery_myNotifications_items,
  NotificationType,
} from "@/frontend/graphql/generated/gql/graphql";
import {
  markAllNotificationsReadMutationDocument,
  markNotificationReadMutationDocument,
  myNotificationsQueryDocument,
  myUnreadNotificationCountQueryDocument,
} from "@/frontend/graphql/sharedDocuments";
import { createApolloCache } from "@/frontend/providers/apollo/apolloCache";
import { NotificationsFeedContainer } from "@/frontend/views/notifications";
import type { AppLocale } from "@/shared/locale/AppLocale";
import { Common } from "@/shared/locale/namespaces/common";
import { Errors } from "@/shared/locale/namespaces/errors";
import { Notifications } from "@/shared/locale/namespaces/notifications";
import { getTranslations } from "@/shared/locale/server";
import { renderWithWrapper } from "@/test/ui/components/TestWrapper";

// ─── Fixtures & helpers ─────────────────────────────────────────────────────

/** Deterministic UTC instant (same anchor as the realtime-hook suite). */
const FIXED_ISO = "2026-08-29T12:00:00.000Z";

const ROW_A_TITLE = "feed-row-a";
const ROW_B_TITLE = "feed-row-b";
const ROW_C_TITLE = "feed-row-c";
const PAGE_TWO_ROW_TITLE = "feed-page-two-row";
const REALTIME_ARRIVAL_TITLE = "realtime-arrival-row";

/**
 * Fixture row type — the codegen row PLUS `__typename`.
 *
 * MockLink passes `result.data` through AS-IS (Apollo v4 does not synthesize
 * `__typename` on mocked results), and without it the cache cannot normalize
 * rows by id — mutation write-backs would never reach the list and manual
 * `writeQuery` merges would not re-render. The 4.2a realtime suite established
 * this exact fixture shape.
 */
type NotificationItemFixture = MyNotificationsQuery_myNotifications_items & {
  readonly __typename: "Notification";
};

/** Deterministic normalized `Notification` row (all eight public fields). */
function feedRow(overrides?: Partial<NotificationItemFixture>): NotificationItemFixture {
  return {
    __typename: "Notification",
    id: "101",
    type: NotificationType.SessionRequest,
    title: ROW_A_TITLE,
    body: "feed-row-a-body",
    isRead: false,
    relatedEntityType: null,
    relatedEntityId: null,
    createdAt: FIXED_ISO,
    ...overrides,
  };
}

const ROW_A = feedRow();
const ROW_B = feedRow({
  id: "102",
  type: NotificationType.SystemBroadcast,
  title: ROW_B_TITLE,
  body: null,
  isRead: true,
});
const ROW_C = feedRow({
  id: "103",
  type: NotificationType.SystemBroadcast,
  title: ROW_C_TITLE,
  body: null,
  isRead: false,
});

/** Feed page sizes mirror the container's own window (page size 20). */
const ALL_PAGE_ONE: MyNotificationsFilterInput = { isRead: null, type: null, limit: 20, offset: 0 };
const UNREAD_PAGE_ONE: MyNotificationsFilterInput = { isRead: false, type: null, limit: 20, offset: 0 };
const BROADCAST_PAGE_ONE: MyNotificationsFilterInput = {
  isRead: null,
  type: NotificationType.SystemBroadcast,
  limit: 20,
  offset: 0,
};
const ALL_PAGE_TWO: MyNotificationsFilterInput = { isRead: null, type: null, limit: 20, offset: 20 };

function feedPageData(
  rows: readonly NotificationItemFixture[],
  totalCount: number,
  hasMore: boolean
): MyNotificationsQuery {
  // The wrapper carries its own `__typename` so the embedded `keyFields:false`
  // value object stores identically to real transport results.
  const page: MyNotificationsQuery_myNotifications & { __typename: "NotificationListPage" } = {
    __typename: "NotificationListPage",
    items: [...rows],
    totalCount,
    hasMore,
  };
  return { myNotifications: page };
}

function listMock(filter: MyNotificationsFilterInput, data: MyNotificationsQuery): MockLink.MockedResponse {
  return {
    request: { query: myNotificationsQueryDocument, variables: { filter } },
    result: { data },
  };
}

function countMock(count: number): MockLink.MockedResponse {
  return {
    request: { query: myUnreadNotificationCountQueryDocument },
    result: { data: { myUnreadNotificationCount: count } },
  };
}

function graphqlErrorMock(code: string): MockLink.MockedResponse {
  return {
    request: { query: myNotificationsQueryDocument, variables: { filter: ALL_PAGE_ONE } },
    result: {
      errors: [
        {
          message: `${code} (masked transport surface)`,
          extensions: { code },
        },
      ],
    },
  };
}

/** Renders the feed under MockedProvider + the shared TestWrapper. */
function renderFeed(mocks: ReadonlyArray<MockLink.MockedResponse>, locale: AppLocale): RenderResult {
  const mocksCopy = [...mocks];
  return renderWithWrapper(
    <MockedProvider mocks={mocksCopy}>
      <NotificationsFeedContainer />
    </MockedProvider>,
    { locale }
  );
}

/** All mark-read buttons carrying the given translated row-context label. */
function markReadButtons(container: HTMLElement, label: string): HTMLElement[] {
  return Array.from(container.querySelectorAll("button")).filter(button => button.getAttribute("aria-label") === label);
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

// ─── Suite ──────────────────────────────────────────────────────────────────

for (const locale of ["ar", "en"] as AppLocale[]) {
  const t = Notifications.getLabels(getTranslations(locale));
  const tc = Common.getLabels(getTranslations(locale));
  const te = Errors.getLabels(getTranslations(locale));

  describe(`NotificationsFeedContainer (${locale === "ar" ? "RTL/arabic" : "LTR/english"})`, () => {
    test("populated feed renders rows, filter rail, pluralized summary, mark-all and aria wiring", async () => {
      const { container } = renderFeed(
        [countMock(1), listMock(ALL_PAGE_ONE, feedPageData([ROW_A, ROW_B], 2, false))],
        locale
      );

      // Header + pluralized unread summary — wait for the LIST row AND the
      // count together (MockLink resolves the two queries in one batch, but
      // either may land first; waiting on both keeps the follow-up sync
      // assertions race-free).
      await waitFor(() => {
        expect(screen.getByText(ROW_A_TITLE)).toBeDefined();
        expect(screen.getByText(t.unreadCount(1))).toBeDefined();
      });

      expect(screen.getByRole("heading", { level: 1, name: t.title })).toBeDefined();

      // Rows render as text nodes with locale-aware timestamps (both fixture
      // rows share the deterministic instant — the stamp appears once per row).
      expect(screen.getByText(ROW_A_TITLE)).toBeDefined();
      expect(screen.getByText(ROW_B_TITLE)).toBeDefined();
      expect(screen.getAllByText(expectedTimestamp(FIXED_ISO, locale)).length).toBeGreaterThanOrEqual(1);

      // Row type labels render (filter-rail chips are the BUTTON variants).
      expect(screen.getAllByText(t.typeSessionRequest).length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText(t.typeSystemBroadcast).length).toBeGreaterThanOrEqual(1);

      // Filter rail: read toggle + all seven type chips, translated.
      expect(screen.getByRole("button", { name: t.filterAll })).toBeDefined();
      expect(screen.getByRole("button", { name: t.filterUnread })).toBeDefined();
      expect(screen.getByRole("button", { name: t.typeSessionRequest })).toBeDefined();
      expect(screen.getByRole("button", { name: t.typeSessionCompletion })).toBeDefined();
      expect(screen.getByRole("button", { name: t.typeSessionCancellation })).toBeDefined();
      expect(screen.getByRole("button", { name: t.typeParentLinkRequest })).toBeDefined();
      expect(screen.getByRole("button", { name: t.typeSystemBroadcast })).toBeDefined();
      expect(screen.getByRole("button", { name: t.typePaymentConfirmation })).toBeDefined();
      expect(screen.getByRole("button", { name: t.typeEvaluationResult })).toBeDefined();

      // List region semantics + mark-all affordance.
      const list = screen.getByTestId("notifications-list");
      expect(list.getAttribute("aria-label")).toBe(t.title);
      expect(list.getAttribute("aria-busy")).toBe("false");
      expect(screen.getByRole("button", { name: t.markAllRead })).toBeDefined();

      // Unread row offers the translated row-context mark-read action; the
      // read row does not.
      expect(markReadButtons(container, t.markReadAriaLabel(ROW_A_TITLE)).length).toBeGreaterThanOrEqual(1);
      expect(markReadButtons(container, t.markReadAriaLabel(ROW_B_TITLE))).toHaveLength(0);

      // RTL mirroring input: every row keeps the icon → content → action
      // DOM order (visual mirroring is the theme's RTL plugin).
      const firstRow = container.querySelector("li");
      expect(firstRow).not.toBeNull();
      const rowChildren = firstRow?.children ?? [];
      expect(rowChildren.length).toBeGreaterThanOrEqual(2);
      expect(rowChildren[0]?.getAttribute("aria-hidden")).toBe("true");

      // The unread row (ROW_A) additionally carries the visually-hidden
      // unread-flag text — REAL content for screen readers. Scoped to the
      // row so the identically named filter-rail chip can't satisfy the
      // translation-driven matcher (Wave C R2 F2 pin). The instanceof guard
      // narrows without an unsafe type assertion.
      if (!(firstRow instanceof HTMLElement)) {
        throw new Error("expected the first feed row to be an HTMLElement");
      }
      expect(within(firstRow).getByText(t.filterUnread)).toBeDefined();
    });

    test("empty inbox renders the localized empty state and disables the sweep", async () => {
      renderFeed([countMock(0), listMock(ALL_PAGE_ONE, feedPageData([], 0, false))], locale);

      await waitFor(() => {
        expect(screen.getByTestId("notifications-empty")).toBeDefined();
      });
      expect(screen.getByText(t.emptyTitle)).toBeDefined();
      expect(screen.getByText(t.emptyBody)).toBeDefined();
      expect(screen.queryByTestId("notifications-list")).toBeNull();
      expect(screen.queryByText(ROW_A_TITLE)).toBeNull();
      // The sweep affordance is disabled while the inbox is empty (the
      // `disabled` attribute pattern per ApplicantStatusCard conventions —
      // no element-type cast needed).
      expect(screen.getByRole("button", { name: t.markAllRead }).getAttribute("disabled")).not.toBeNull();
    });

    test("unread filter chip re-queries over the wire with isRead=false", async () => {
      renderFeed(
        [
          countMock(2),
          listMock(ALL_PAGE_ONE, feedPageData([ROW_A, ROW_B, ROW_C], 3, false)),
          listMock(UNREAD_PAGE_ONE, feedPageData([ROW_A, ROW_C], 2, false)),
        ],
        locale
      );

      await waitFor(() => {
        expect(screen.getByText(ROW_B_TITLE)).toBeDefined();
      });

      const unreadChip = screen.getByRole("button", { name: t.filterUnread });
      expect(unreadChip.getAttribute("aria-pressed")).toBe("false");
      fireEvent.click(unreadChip);

      // The read row leaves while BOTH unread rows settle in — one combined
      // waitFor avoids the loading-skeleton transition satisfying the negative
      // assertion before the narrowed window's data lands.
      await waitFor(() => {
        expect(screen.queryByText(ROW_B_TITLE)).toBeNull();
        expect(screen.getByText(ROW_A_TITLE)).toBeDefined();
        expect(screen.getByText(ROW_C_TITLE)).toBeDefined();
      });
      expect(screen.getByRole("button", { name: t.filterUnread }).getAttribute("aria-pressed")).toBe("true");
    });

    test("type filter chip narrows the wire query to that NotificationType", async () => {
      renderFeed(
        [
          countMock(2),
          listMock(ALL_PAGE_ONE, feedPageData([ROW_A, ROW_B], 2, false)),
          listMock(BROADCAST_PAGE_ONE, feedPageData([ROW_B], 1, false)),
        ],
        locale
      );

      await waitFor(() => {
        expect(screen.getByText(ROW_A_TITLE)).toBeDefined();
      });

      const broadcastChip = screen.getByRole("button", { name: t.typeSystemBroadcast });
      fireEvent.click(broadcastChip);

      // Same combined-waitFor rationale as the unread-filter case.
      await waitFor(() => {
        expect(screen.queryByText(ROW_A_TITLE)).toBeNull();
        expect(screen.getByText(ROW_B_TITLE)).toBeDefined();
      });
      expect(screen.getByRole("button", { name: t.typeSystemBroadcast }).getAttribute("aria-pressed")).toBe("true");
    });

    test("All chip is the true reset — a category press deselects it, activating it clears the type filter", async () => {
      renderFeed(
        [
          countMock(2),
          listMock(ALL_PAGE_ONE, feedPageData([ROW_A, ROW_B], 2, false)),
          listMock(BROADCAST_PAGE_ONE, feedPageData([ROW_B], 1, false)),
          // Spare page-one mock: a wire re-serve of the reset window gets
          // answered; a cache-first serve simply leaves it unused.
          listMock(ALL_PAGE_ONE, feedPageData([ROW_A, ROW_B], 2, false)),
        ],
        locale
      );

      await waitFor(() => {
        expect(screen.getByText(ROW_A_TITLE)).toBeDefined();
        expect(screen.getByText(ROW_B_TITLE)).toBeDefined();
      });

      // Unfiltered baseline: "All" is the pressed chip.
      expect(screen.getByRole("button", { name: t.filterAll }).getAttribute("aria-pressed")).toBe("true");

      // Activating a category chip deselects "All" (single-select
      // semantics, QA round 2) while narrowing the list to that type.
      fireEvent.click(screen.getByRole("button", { name: t.typeSystemBroadcast }));
      await waitFor(() => {
        expect(screen.queryByText(ROW_A_TITLE)).toBeNull();
        expect(screen.getByText(ROW_B_TITLE)).toBeDefined();
      });
      expect(screen.getByRole("button", { name: t.filterAll }).getAttribute("aria-pressed")).toBe("false");
      expect(screen.getByRole("button", { name: t.typeSystemBroadcast }).getAttribute("aria-pressed")).toBe("true");

      // Activating "All" clears the category filter — the list is
      // unfiltered again and the rail reads All pressed, category released
      // (the read-filter handler drops the type filter on the "all"
      // transition, so the two can never read pressed together).
      fireEvent.click(screen.getByRole("button", { name: t.filterAll }));
      await waitFor(() => {
        expect(screen.getByText(ROW_A_TITLE)).toBeDefined();
        expect(screen.getByText(ROW_B_TITLE)).toBeDefined();
      });
      expect(screen.getByRole("button", { name: t.filterAll }).getAttribute("aria-pressed")).toBe("true");
      expect(screen.getByRole("button", { name: t.typeSystemBroadcast }).getAttribute("aria-pressed")).toBe("false");
    });

    test("mark-one restyles the row without a refetch and decrements the pluralized summary", async () => {
      const { container } = renderFeed(
        [
          countMock(1),
          listMock(ALL_PAGE_ONE, feedPageData([ROW_A, ROW_B], 2, false)),
          {
            request: { query: markNotificationReadMutationDocument, variables: { id: "101" } },
            result: { data: { markNotificationRead: feedRow({ isRead: true }) } },
          },
        ],
        locale
      );

      await waitFor(() => {
        expect(screen.getByText(ROW_A_TITLE)).toBeDefined();
        expect(screen.getByText(t.unreadCount(1))).toBeDefined();
      });

      const buttons = markReadButtons(container, t.markReadAriaLabel(ROW_A_TITLE));
      expect(buttons.length).toBeGreaterThanOrEqual(1);
      fireEvent.click(buttons[0]);

      // Row restyles to read: the action disappears, the row stays, and the
      // badge-equivalent summary recomputes from the Apollo cache — one
      // waitFor (cache-broadcast flush cadence, not sync).
      await waitFor(() => {
        expect(markReadButtons(container, t.markReadAriaLabel(ROW_A_TITLE))).toHaveLength(0);
        expect(screen.getByText(ROW_A_TITLE)).toBeDefined();
        expect(screen.getByText(t.unreadCount(0))).toBeDefined();
      });
    });

    test("mark-one drops the cached unread window — the next Unread switch refetches over the wire", async () => {
      const { container } = renderFeed(
        [
          countMock(1),
          listMock(ALL_PAGE_ONE, feedPageData([ROW_A, ROW_B], 2, false)),
          // First Unread visit — caches the PRE-mark-read snapshot ([ROW_A]).
          listMock(UNREAD_PAGE_ONE, feedPageData([ROW_A], 1, false)),
          {
            request: { query: markNotificationReadMutationDocument, variables: { id: "101" } },
            result: { data: { markNotificationRead: feedRow({ isRead: true }) } },
          },
          // Post-drop refetch of the unread window: the flipped row no longer
          // matches isRead=false — the fresh response comes back EMPTY.
          listMock(UNREAD_PAGE_ONE, feedPageData([], 0, false)),
          // Spare All-window mock (a cache-first serve leaves it unused).
          listMock(ALL_PAGE_ONE, feedPageData([ROW_A, ROW_B], 2, false)),
        ],
        locale
      );

      await waitFor(() => {
        expect(screen.getByText(ROW_A_TITLE)).toBeDefined();
        expect(screen.getByText(t.unreadCount(1))).toBeDefined();
      });

      // Visit the Unread window so its pre-mark snapshot lands in the cache.
      fireEvent.click(screen.getByRole("button", { name: t.filterUnread }));
      await waitFor(() => {
        expect(screen.queryByText(ROW_B_TITLE)).toBeNull();
        expect(screen.getByText(ROW_A_TITLE)).toBeDefined();
      });

      // Back to the All window, then flip ROW_A read in place (no refetch —
      // the mark-one contract asserted by the sibling test above).
      fireEvent.click(screen.getByRole("button", { name: t.filterAll }));
      await waitFor(() => {
        expect(screen.getByText(ROW_B_TITLE)).toBeDefined();
      });

      const buttons = markReadButtons(container, t.markReadAriaLabel(ROW_A_TITLE));
      expect(buttons.length).toBeGreaterThanOrEqual(1);
      fireEvent.click(buttons[0]);

      await waitFor(() => {
        expect(markReadButtons(container, t.markReadAriaLabel(ROW_A_TITLE))).toHaveLength(0);
        expect(screen.getByText(t.unreadCount(0))).toBeDefined();
      });

      // The mark-one cache-drop evicted the stale unread window (the
      // mark-all `dropStaleInboxWindows` pattern, applied per-row): switching
      // to Unread MUST miss the cache and refetch over the wire — the fresh
      // EMPTY response renders the empty state, where the stale snapshot
      // would keep listing the already-read row's title.
      fireEvent.click(screen.getByRole("button", { name: t.filterUnread }));
      await waitFor(() => {
        expect(screen.queryByText(ROW_A_TITLE)).toBeNull();
        expect(screen.getByTestId("notifications-empty")).toBeDefined();
      });
      expect(screen.getByRole("button", { name: t.filterUnread }).getAttribute("aria-pressed")).toBe("true");
    });

    test("mark-all confirm flow sweeps, refetches and surfaces the affected-count snackbar", async () => {
      const { container } = renderFeed(
        [
          countMock(2),
          listMock(ALL_PAGE_ONE, feedPageData([ROW_A, ROW_C], 2, false)),
          {
            request: { query: markAllNotificationsReadMutationDocument, variables: { type: null } },
            result: { data: { markAllNotificationsRead: 2 } },
          },
          countMock(0),
          listMock(
            ALL_PAGE_ONE,
            feedPageData([feedRow({ isRead: true }), feedRow({ ...ROW_C, isRead: true })], 2, false)
          ),
        ],
        locale
      );

      await waitFor(() => {
        expect(screen.getByText(ROW_A_TITLE)).toBeDefined();
        expect(screen.getByText(t.unreadCount(2))).toBeDefined();
      });

      fireEvent.click(screen.getByRole("button", { name: t.markAllRead }));

      // Confirmation dialog with the localized copy + cancel affordance.
      const dialog = await waitFor(() => screen.getByRole("dialog"));
      expect(within(dialog).getByText(t.markAllConfirmTitle)).toBeDefined();
      expect(within(dialog).getByText(t.markAllConfirmBody)).toBeDefined();
      expect(within(dialog).getByRole("button", { name: tc.cancel })).toBeDefined();

      fireEvent.click(within(dialog).getByRole("button", { name: t.markAllRead }));

      // Affected-count snackbar (pluralized) + converged feed state — one
      // waitFor over snackbar + count + restyled rows (the refetch + cache
      // broadcast flush at React's cadence under both direction caches).
      await waitFor(() => {
        expect(screen.getByText(t.markAllResult(2))).toBeDefined();
        expect(screen.getByText(t.unreadCount(0))).toBeDefined();
        expect(markReadButtons(container, t.markReadAriaLabel(ROW_A_TITLE))).toHaveLength(0);
        expect(markReadButtons(container, t.markReadAriaLabel(ROW_C_TITLE))).toHaveLength(0);
      });
    });

    test("initial load renders skeleton rows with busy semantics and inert filters", () => {
      const { container } = renderFeed(
        [
          countMock(1),
          { request: { query: myNotificationsQueryDocument, variables: { filter: ALL_PAGE_ONE } }, delay: Infinity },
        ],
        locale
      );

      const skeleton = screen.getByTestId("notifications-skeleton");
      expect(skeleton.getAttribute("aria-busy")).toBe("true");
      expect(container.querySelector("[data-testid='notifications-list']")).toBeNull();
      // Filters stay visible but inert while the first page loads. MUI chips
      // are div[role=button] — the disabled state surfaces as aria-disabled.
      expect(screen.getByRole("button", { name: t.filterUnread }).getAttribute("aria-disabled")).toBe("true");
      // No settled copy may leak into the skeleton.
      expect(container.textContent?.includes(ROW_A_TITLE)).toBe(false);
    });

    test("FORBIDDEN denial renders the shared PermissionDeniedFallback surface", async () => {
      renderFeed([countMock(0), graphqlErrorMock("FORBIDDEN")], locale);

      await waitFor(() => {
        expect(screen.getByText(te.forbiddenRole)).toBeDefined();
      });
      expect(screen.getByText(te.forbidden)).toBeDefined();
      expect(screen.queryByTestId("notifications-list")).toBeNull();
    });

    test("RATE_LIMITED surfaces the shared RetryableNotice", async () => {
      renderFeed([countMock(0), graphqlErrorMock("RATE_LIMITED")], locale);

      await waitFor(() => {
        expect(screen.getByText(te.rateLimitExceeded)).toBeDefined();
      });
      expect(screen.getByRole("button", { name: tc.retry })).toBeDefined();
      expect(screen.queryByText(t.emptyTitle)).toBeNull();
    });

    test("generic failure renders the localized load-error notice and retry recovers", async () => {
      renderFeed(
        [
          countMock(0),
          graphqlErrorMock("INTERNAL_SERVER_ERROR"),
          listMock(ALL_PAGE_ONE, feedPageData([ROW_A], 1, false)),
        ],
        locale
      );

      await waitFor(() => {
        expect(screen.getByText(t.loadErrorTitle)).toBeDefined();
      });
      expect(screen.getByText(t.loadErrorBody)).toBeDefined();

      fireEvent.click(screen.getByRole("button", { name: tc.retry }));

      await waitFor(() => {
        expect(screen.getByText(ROW_A_TITLE)).toBeDefined();
      });
      expect(screen.queryByText(t.loadErrorTitle)).toBeNull();
    });

    test("offset pagination walks pages and resets to page one on filter change", async () => {
      renderFeed(
        [
          countMock(25),
          listMock(ALL_PAGE_ONE, feedPageData([ROW_A], 25, true)),
          listMock(ALL_PAGE_TWO, feedPageData([feedRow({ id: "201", title: PAGE_TWO_ROW_TITLE })], 25, false)),
          listMock(UNREAD_PAGE_ONE, feedPageData([ROW_A], 25, true)),
        ],
        locale
      );

      await waitFor(() => {
        expect(screen.getByText(ROW_A_TITLE)).toBeDefined();
      });

      // Page one: previous disabled, indicator "1 / 2".
      const previous = screen.getByRole("button", { name: tc.previousPage });
      expect(previous.getAttribute("disabled")).not.toBeNull();
      expect(screen.getByText("1 / 2")).toBeDefined();

      fireEvent.click(screen.getByRole("button", { name: tc.nextPage }));

      await waitFor(() => {
        expect(screen.getByText(PAGE_TWO_ROW_TITLE)).toBeDefined();
      });
      expect(screen.queryByText(ROW_A_TITLE)).toBeNull();
      expect(screen.getByText("2 / 2")).toBeDefined();
      expect(screen.getByRole("button", { name: tc.previousPage }).getAttribute("disabled")).toBeNull();

      // Filter change resets the window to offset 0 (unread variant).
      fireEvent.click(screen.getByRole("button", { name: t.filterUnread }));
      await waitFor(() => {
        expect(screen.getByText(ROW_A_TITLE)).toBeDefined();
      });
      expect(screen.queryByText(PAGE_TWO_ROW_TITLE)).toBeNull();
      expect(screen.getByText("1 / 2")).toBeDefined();
    });

    test("realtime cache merge reaches the feed without a refetch (hook-maintained cache path)", async () => {
      // Real client on MockLink + the production cache policies — the feed's
      // `useQuery` variants are the SAME ones the shell-mounted realtime hook
      // merges into (the feed never mounts a socket itself).
      const client = new ApolloClient({
        link: new MockLink([countMock(1), listMock(ALL_PAGE_ONE, feedPageData([ROW_A], 1, false))]),
        cache: createApolloCache(),
        defaultOptions: { query: { errorPolicy: "none" } },
      });
      renderWithWrapper(
        <ApolloProvider client={client}>
          <NotificationsFeedContainer />
        </ApolloProvider>,
        { locale }
      );

      // Wait for the LIST row AND the count summary: the simulated merge must
      // land AFTER both seeded cache fields exist — otherwise the still
      // in-flight list response would overwrite the write AND the count
      // modifier would no-op on a missing field (the hook only ever merges
      // into an already-populated cache).
      await waitFor(() => {
        expect(screen.getByText(ROW_A_TITLE)).toBeDefined();
        expect(screen.getByText(t.unreadCount(1))).toBeDefined();
      });

      // Simulate the realtime hook's arrival merge: prepend the fresh row to
      // the page-1 variant + bump the cached unread count (cache-only — no
      // network operation exists for this in the mock list).
      act(() => {
        client.cache.writeQuery({
          query: myNotificationsQueryDocument,
          variables: { filter: ALL_PAGE_ONE },
          data: feedPageData([feedRow({ id: "777", title: REALTIME_ARRIVAL_TITLE }), ROW_A], 2, false),
        });
        client.cache.modify({
          id: "ROOT_QUERY",
          fields: {
            myUnreadNotificationCount: (count: unknown) => (typeof count === "number" ? count + 1 : count),
          },
        });
      });

      // The cache-only merge re-renders through Apollo's cache broadcast —
      // waitFor (not a sync assert) so the flush cadence under BOTH emotion
      // direction caches stays race-free.
      await waitFor(() => {
        expect(screen.getByText(REALTIME_ARRIVAL_TITLE)).toBeDefined();
        expect(screen.getByText(t.unreadCount(2))).toBeDefined();
      });
      // No error surface may appear (an unmatched network request would have
      // failed the query loudly).
      expect(screen.queryByText(t.loadErrorTitle)).toBeNull();
    });
  });
}
