/**
 * NotificationDrawer — the app-bar bell popover component suite
 * (drawer-plan DR-1..DR-8, `ai/plans/sprint_2/dev3-010-real-time-notification-engine-websocket/drawer/plan.md`).
 *
 * Happy DOM + Apollo `MockLink` tier (`test/ui/components`) on a REAL
 * `ApolloClient` with `createApolloCache()` (the badge/feed-suite
 * precedent) so cache-level effects of the shared mark actions are
 * asserted at the source of truth:
 *
 *   populated drawer (rows, unread dots, bold/read posture — BOTH locales,
 *   REQ-066 translation-driven matchers ONLY) · pinned footer "view all"
 *   link to `/notifications` + onClose wiring · empty state · error + retry
 *   recovery · header mark-all sweep (no confirm dialog in the drawer —
 *   the count refetch converges to zero) · row activation (mark-one cache
 *   decrement + onClose) · ZERO WebSocket constructions (REQ-067 — the
 *   tab's single socket belongs to the shell toast host).
 *
 * Fixture titles/ids/timestamps are technical test data, not UI copy.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ApolloClient } from "@apollo/client";
import { ApolloProvider } from "@apollo/client/react";
import { MockLink } from "@apollo/client/testing";
import { cleanup, fireEvent, type RenderResult, screen, waitFor } from "@testing-library/react";
import { NotificationDrawer } from "@/frontend/components/ui/NotificationDrawer";
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
import type { AppLocale } from "@/shared/locale/AppLocale";
import { Common } from "@/shared/locale/namespaces/common";
import { Notifications } from "@/shared/locale/namespaces/notifications";
import { getTranslations } from "@/shared/locale/server";
import { renderWithWrapper } from "@/test/ui/components/TestWrapper";

// ─── WebSocket ownership double ─────────────────────────────────────────────

const originalWebSocket = globalThis.WebSocket;

/** Constructions of `globalThis.WebSocket` while the double is installed. */
let webSocketConstructions = 0;

/** Minimal recording double — the drawer suite asserts ZERO constructions. */
class RecordingWebSocket {
  constructor() {
    webSocketConstructions += 1;
  }

  /** No-op surface member — nothing constructs this double in a passing suite. */
  close(): void {
    // Intentionally empty: the recorder exists only to count constructions.
  }
}

beforeEach(() => {
  webSocketConstructions = 0;
  Reflect.set(globalThis, "WebSocket", RecordingWebSocket);
});

afterEach(() => {
  cleanup();
  // Restore happy-dom's WebSocket so later files in this process are unaffected.
  Reflect.set(globalThis, "WebSocket", originalWebSocket);
});

// ─── Fixtures & helpers ─────────────────────────────────────────────────────

/** Deterministic UTC instant (the feed-suite anchor convention). */
const FIXED_ISO = "2026-08-29T12:00:00.000Z";

const UNREAD_ROW_TITLE = "drawer-row-unread";
const READ_ROW_TITLE = "drawer-row-read";

/**
 * Fixture row type — the codegen row PLUS `__typename` (MockLink passes
 * `result.data` through AS-IS; without the typename the cache cannot
 * normalize rows by id — the 4.2a realtime-suite convention).
 */
type NotificationItemFixture = MyNotificationsQuery_myNotifications_items & {
  readonly __typename: "Notification";
};

/** Deterministic normalized `Notification` row (all eight public fields). */
function drawerRow(overrides?: Partial<NotificationItemFixture>): NotificationItemFixture {
  return {
    __typename: "Notification",
    id: "201",
    type: NotificationType.SessionRequest,
    title: UNREAD_ROW_TITLE,
    body: "drawer-row-body",
    isRead: false,
    relatedEntityType: null,
    relatedEntityId: null,
    createdAt: FIXED_ISO,
    ...overrides,
  };
}

const UNREAD_ROW = drawerRow();
const READ_ROW = drawerRow({ id: "202", title: READ_ROW_TITLE, body: null, isRead: true });

/** The drawer's single inbox window (mirrors `DRAWER_PAGE_SIZE`). */
const DRAWER_WINDOW: MyNotificationsFilterInput = { isRead: null, type: null, limit: 5, offset: 0 };

function drawerPageData(rows: readonly NotificationItemFixture[]): MyNotificationsQuery {
  // The wrapper carries its own `__typename` so the `keyFields:false` value
  // object stores identically to real transport results (feed-suite comment).
  const page: MyNotificationsQuery_myNotifications & { __typename: "NotificationListPage" } = {
    __typename: "NotificationListPage",
    items: [...rows],
    totalCount: rows.length,
    hasMore: false,
  };
  return { myNotifications: page };
}

function listMock(rows: readonly NotificationItemFixture[]): MockLink.MockedResponse {
  return {
    request: { query: myNotificationsQueryDocument, variables: { filter: DRAWER_WINDOW } },
    result: { data: drawerPageData(rows) },
  };
}

function countMock(count: number): MockLink.MockedResponse {
  return {
    request: { query: myUnreadNotificationCountQueryDocument },
    result: { data: { myUnreadNotificationCount: count } },
  };
}

/**
 * Renders the OPEN drawer on a synthetic anchor under a real Apollo client.
 * The popover portals to `document.body`, so assertions use `screen`/
 * document-level queries rather than the render container.
 */
function renderDrawer(
  mocks: ReadonlyArray<MockLink.MockedResponse>,
  locale: AppLocale,
  onClose: () => void = () => undefined
): RenderResult & { client: ApolloClient } {
  const anchor = document.createElement("button");
  const client = new ApolloClient({
    link: new MockLink([...mocks]),
    cache: createApolloCache(),
    defaultOptions: { query: { errorPolicy: "none" } },
  });
  const result = renderWithWrapper(
    <ApolloProvider client={client}>
      <NotificationDrawer anchorEl={anchor} open onClose={onClose} />
    </ApolloProvider>,
    { locale }
  );
  return { ...result, client };
}

/** All unread-dot markers currently rendered inside the drawer popover. */
function unreadDots(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-testid="notification-drawer-unread-dot"]'));
}

// ─── Populated drawer (both locales — REQ-066) ──────────────────────────────

for (const locale of ["ar", "en"] as AppLocale[]) {
  const t = Notifications.getLabels(getTranslations(locale));

  describe(`NotificationDrawer rows (${locale === "ar" ? "RTL/arabic" : "LTR/english"})`, () => {
    test("renders the translated header, latest rows with per-row read-state dots, and the pinned footer link", async () => {
      renderDrawer([countMock(1), listMock([UNREAD_ROW, READ_ROW])], locale);

      await waitFor(() => {
        expect(screen.getByText(UNREAD_ROW_TITLE)).toBeDefined();
        expect(screen.getByText(READ_ROW_TITLE)).toBeDefined();
      });
      // Pinned header (title + mark-all affordance) and pinned footer link to
      // the full page — the page also remains reachable from the sidebar.
      expect(screen.getByRole("heading", { name: t.title })).toBeDefined();
      expect(screen.getByRole("button", { name: t.markAllRead })).toBeDefined();
      const viewAll = screen.getByRole("link", { name: t.viewAllNotifications });
      expect(viewAll.getAttribute("href")).toBe("/notifications");
      // Row anatomy: the unread row carries the dot, the read row does not.
      expect(unreadDots()).toHaveLength(1);
    });
  });
}

// ─── Interactions (single locale — the flows are locale-independent) ────────

describe("NotificationDrawer interactions (Happy DOM, mocked transport)", () => {
  const locale: AppLocale = "en";
  const t = Notifications.getLabels(getTranslations(locale));
  const tc = Common.getLabels(getTranslations(locale));

  test("footer 'view all' click closes the drawer", async () => {
    let closeCalls = 0;
    renderDrawer([countMock(1), listMock([UNREAD_ROW])], locale, () => {
      closeCalls += 1;
    });

    const viewAll = await screen.findByRole("link", { name: t.viewAllNotifications });
    fireEvent.click(viewAll);
    expect(closeCalls).toBe(1);
  });

  test("header mark-all sweeps directly (no confirm dialog) and the refetched zero count disables the action", async () => {
    renderDrawer(
      [
        countMock(1),
        listMock([UNREAD_ROW]),
        {
          request: { query: markAllNotificationsReadMutationDocument, variables: { type: null } },
          result: { data: { markAllNotificationsRead: 1 } },
        },
        // Post-sweep `refetchQueries`: converged page + zero unread count.
        listMock([drawerRow({ isRead: true })]),
        countMock(0),
      ],
      locale
    );

    const markAll = await screen.findByRole("button", { name: t.markAllRead });
    await waitFor(() => {
      expect(screen.getByText(UNREAD_ROW_TITLE)).toBeDefined();
      expect(markAll.getAttribute("disabled")).toBeNull();
    });

    fireEvent.click(markAll);
    await waitFor(() => {
      // The refetched count (0) settles the affordance into its disabled state.
      expect(markAll.getAttribute("disabled")).not.toBeNull();
    });
  });

  test("row activation marks the row read (count decrement in the cache) and closes the drawer", async () => {
    let closeCalls = 0;
    const { client } = renderDrawer(
      [
        countMock(1),
        listMock([UNREAD_ROW]),
        {
          request: { query: markNotificationReadMutationDocument, variables: { id: UNREAD_ROW.id } },
          result: { data: { markNotificationRead: drawerRow({ isRead: true }) } },
        },
      ],
      locale,
      () => {
        closeCalls += 1;
      }
    );

    const row = await waitFor(() => screen.getByText(UNREAD_ROW_TITLE).closest("a"));
    if (row === null) {
      throw new Error("row anchor must render (the row IS a Link to the full page)");
    }
    fireEvent.click(row);

    await waitFor(() => {
      expect(closeCalls).toBe(1);
      // The shared mark-one action decremented the cached unread count.
      expect(client.cache.readQuery({ query: myUnreadNotificationCountQueryDocument })).toEqual({
        myUnreadNotificationCount: 0,
      });
    });
    // The row is a real anchor to the full page (native navigation surface).
    expect(row?.getAttribute("href")).toBe("/notifications");
  });

  test("empty inbox renders the translated empty state", async () => {
    renderDrawer([countMock(0), listMock([])], locale);

    await waitFor(() => {
      expect(screen.getByText(t.emptyTitle)).toBeDefined();
      expect(screen.getByText(t.emptyBody)).toBeDefined();
    });
  });

  test("load failure renders the translated error + retry, and retry recovers", async () => {
    renderDrawer(
      [
        countMock(0),
        {
          request: { query: myNotificationsQueryDocument, variables: { filter: DRAWER_WINDOW } },
          error: new Error("transport failure"),
        },
        listMock([UNREAD_ROW]),
      ],
      locale
    );

    await waitFor(() => {
      expect(screen.getByText(t.loadErrorTitle)).toBeDefined();
      expect(screen.getByText(t.loadErrorBody)).toBeDefined();
    });

    fireEvent.click(screen.getByRole("button", { name: tc.retry }));
    await waitFor(() => {
      expect(screen.getByText(UNREAD_ROW_TITLE)).toBeDefined();
    });
  });

  test("opening the drawer constructs ZERO WebSockets (REQ-067 — the shell toast host owns the tab's socket)", async () => {
    renderDrawer([countMock(1), listMock([UNREAD_ROW])], locale);

    await waitFor(() => {
      expect(screen.getByText(UNREAD_ROW_TITLE)).toBeDefined();
    });
    expect(webSocketConstructions).toBe(0);
  });
});
