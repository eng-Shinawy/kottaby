/**
 * useNotificationRealtime + NotificationRealtimeToastHost — Happy DOM
 * component suite (`test/ui/components` tier, Pattern 2 per
 * test/ui/AGENTS.md: the host consumes the hook itself).
 *
 * The global `WebSocket` is swapped for a recording fake via `Reflect.set`
 * (the assertion-free global-double technique the ApiStatusIndicator suite
 * established), so every lifecycle rule is asserted against REAL Apollo
 * cache + REAL React rendering — no MockedProvider indirection for the
 * merge tier (the suite builds its own `ApolloClient` on `MockLink` +
 * `createApolloCache()` so the production type policies apply).
 *
 * TE matrix (tasks.md 4.2.TE):
 *   connect message → cache merge dedupe by id · duplicate id → no-op ·
 *   reconnect → refetch invoked · close(4401) → no retry ·
 *   unmount → single close(1000) · no listener/toast duplication across
 *   remounts.
 *
 * Chaos tier (tasks.md 5.3, appended describe): a close↔open flicker storm
 * keeps exactly one live connection with zero duplicated toasts (replay
 * dedupe by id, REQ-076); unicode/RTL/control-char payload frames render as
 * literal text — no crash, no script materialization (REQ-028 client half;
 * the storage half lives in notification-engine.chaos.test.ts).
 *
 * Translation discipline: every rendered string resolves through
 * `Notifications.getLabels(getTranslations(locale))` /
 * `Common.getLabels(...)` — ZERO hardcoded UI copy. Fixture titles and ids
 * are technical test data.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ApolloClient } from "@apollo/client";
import { ApolloProvider } from "@apollo/client/react";
import { MockLink } from "@apollo/client/testing";
import { act, cleanup, screen, waitFor } from "@testing-library/react";
import { NotificationRealtimeToastHost } from "@/frontend/components/ui/NotificationRealtimeToastHost";
import {
  type MyNotificationsQuery,
  type MyUnreadNotificationCountQuery,
  NotificationType,
} from "@/frontend/graphql/generated/gql/graphql";
import {
  myNotificationsQueryDocument,
  myUnreadNotificationCountQueryDocument,
} from "@/frontend/graphql/sharedDocuments";
import { getNotificationReconnectDelay } from "@/frontend/hooks/notifications";
import { createApolloCache } from "@/frontend/providers/apollo/apolloCache";
import type { AppLocale } from "@/shared/locale/AppLocale";
import { Common } from "@/shared/locale/namespaces/common/common.namespace";
import { Notifications } from "@/shared/locale/namespaces/notifications";
import { getTranslations } from "@/shared/locale/server";
import { renderWithWrapper } from "@/test/ui/components/TestWrapper";

// ─── Fake WebSocket ────────────────────────────────────────────────────────

const originalWebSocket = globalThis.WebSocket;

/**
 * Recording WebSocket double. Implements exactly the surface the hook uses
 * (`addEventListener`/`removeEventListener`/`close`/`send`); `readyState`
 * guards keep the double faithful to the browser (no events on a closed
 * socket). Test controls are the `simulate*` methods standing in for the
 * sidecar.
 *
 * The hook goes through the REAL `WebSocket` type (this double is installed
 * via `Reflect.set`), so listeners here are typed by the broad socket-event
 * union; the per-event dispatch below constructs the correct concrete event
 * per name (open/error → `Event`, message → `MessageEvent`, close →
 * `CloseEvent`).
 */
type FakeWebSocketEventName = "open" | "message" | "error" | "close";

type FakeWebSocketEvent = Event | MessageEvent | CloseEvent;

type FakeWebSocketListener = (event: FakeWebSocketEvent) => void;

class FakeWebSocket {
  static readonly instances: FakeWebSocket[] = [];

  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;

  readonly url: string;
  readyState = FakeWebSocket.CONNECTING;

  private readonly listeners: Record<FakeWebSocketEventName, FakeWebSocketListener[]> = {
    open: [],
    message: [],
    error: [],
    close: [],
  };

  /** REQ-034 corollary: the client sends NOTHING — asserted via this log. */
  readonly sentFrames: string[] = [];
  readonly closeCalls: { readonly code: number; readonly reason: string }[] = [];

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: FakeWebSocketEventName, listener: FakeWebSocketListener): void {
    this.listeners[type].push(listener);
  }

  removeEventListener(type: FakeWebSocketEventName, listener: FakeWebSocketListener): void {
    this.listeners[type] = this.listeners[type].filter(registered => registered !== listener);
  }

  /** Live listener count per event — the REQ-067 detach assertions. */
  listenerCount(type: FakeWebSocketEventName): number {
    return this.listeners[type].length;
  }

  send(frame: string): void {
    this.sentFrames.push(frame);
  }

  close(code = 1000, reason = ""): void {
    this.closeCalls.push({ code, reason });
    this.readyState = FakeWebSocket.CLOSED;
  }

  private dispatch(type: FakeWebSocketEventName, event: FakeWebSocketEvent): void {
    // `removeEventListener` REPLACES the array, so this iteration holds a
    // stable snapshot reference by construction.
    for (const listener of this.listeners[type]) {
      listener(event);
    }
  }

  simulateOpen(): void {
    if (this.readyState === FakeWebSocket.CLOSED) {
      return;
    }
    this.readyState = FakeWebSocket.OPEN;
    this.dispatch("open", new Event("open"));
  }

  simulateMessage(raw: string): void {
    if (this.readyState !== FakeWebSocket.OPEN) {
      return;
    }
    this.dispatch("message", new MessageEvent("message", { data: raw }));
  }

  simulateClose(code: number): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.dispatch("close", new CloseEvent("close", { code, wasClean: code === 1000 }));
  }
}

beforeEach(() => {
  FakeWebSocket.instances.length = 0;
  Reflect.set(globalThis, "WebSocket", FakeWebSocket);
});

afterEach(() => {
  cleanup();
  // Restore happy-dom's WebSocket so later files in this process are unaffected.
  Reflect.set(globalThis, "WebSocket", originalWebSocket);
});

// ─── Fixtures & helpers ─────────────────────────────────────────────────────

const FIXED_ISO = "2026-08-29T12:00:00.000Z";
const SEED_TITLE = "seed-row";

/** Deterministic REQ-021 wire frame (snake_case payload type, numeric id). */
function makeFrameRaw(id: number, title: string, payloadType = "session_request"): string {
  return JSON.stringify({
    v: 1,
    kind: "notification",
    data: {
      id,
      type: payloadType,
      title,
      body: null,
      relatedEntityType: null,
      relatedEntityId: null,
      createdAt: FIXED_ISO,
    },
  });
}

/** Normalized GraphQL row (wire enum names, string id) for mock results. */
function notificationRow(id: string): Record<string, unknown> {
  return {
    __typename: "Notification",
    id,
    type: NotificationType.SystemBroadcast,
    title: `${SEED_TITLE}-${id}`,
    body: null,
    isRead: false,
    relatedEntityType: null,
    relatedEntityId: null,
    createdAt: FIXED_ISO,
  };
}

function listPageData(ids: readonly string[], totalCount: number): Record<string, unknown> {
  return {
    __typename: "NotificationListPage",
    items: ids.map(id => notificationRow(id)),
    totalCount,
    hasMore: false,
  };
}

/** Full `MyNotificationsFilterInput` shape (codegen type has no optionals). */
const readOnlyFilter = { isRead: true, limit: null, offset: null, type: null } as const;

interface CatchUpPage {
  readonly ids: readonly string[];
  readonly count: number;
}

/** Builds a test client whose MockLink serves the seed page/count FIRST and
 * the catch-up page/count afterwards (reconnect refetch order). */
async function createSeededClient(catchUp?: CatchUpPage): Promise<ApolloClient> {
  const mocks: MockLink.MockedResponse[] = [
    {
      request: { query: myUnreadNotificationCountQueryDocument },
      result: { data: { myUnreadNotificationCount: 1 } },
    },
    {
      request: { query: myNotificationsQueryDocument, variables: { filter: null } },
      result: { data: { myNotifications: listPageData(["500"], 1) } },
    },
  ];
  if (catchUp !== undefined) {
    mocks.push(
      {
        request: { query: myUnreadNotificationCountQueryDocument },
        result: { data: { myUnreadNotificationCount: catchUp.count } },
      },
      {
        request: { query: myNotificationsQueryDocument, variables: { filter: null } },
        result: { data: { myNotifications: listPageData(catchUp.ids, catchUp.ids.length) } },
      }
    );
  }
  const client = new ApolloClient({
    link: new MockLink([...mocks]),
    cache: createApolloCache(),
    defaultOptions: { query: { errorPolicy: "none" } },
  });
  // Seed through real query execution so the cache normalizes exactly the
  // way a production page-load would (entities + ROOT_QUERY variants).
  await client.query({ query: myUnreadNotificationCountQueryDocument });
  await client.query({ query: myNotificationsQueryDocument, variables: { filter: null } });
  return client;
}

function readCachedCount(client: ApolloClient): number | undefined {
  const data = client.cache.readQuery<MyUnreadNotificationCountQuery>({
    query: myUnreadNotificationCountQueryDocument,
  });
  return data?.myUnreadNotificationCount;
}

function readCachedListIds(client: ApolloClient): string[] {
  const data = client.cache.readQuery<MyNotificationsQuery>({
    query: myNotificationsQueryDocument,
    variables: { filter: null },
  });
  return data?.myNotifications.items.map(item => item.id) ?? [];
}

function currentSocket(): FakeWebSocket {
  const socket = FakeWebSocket.instances.at(-1);
  if (socket === undefined) {
    throw new Error("expected the hook to have constructed a WebSocket");
  }
  return socket;
}

function renderHost(client: ApolloClient, locale: AppLocale): ReturnType<typeof renderWithWrapper> {
  return renderWithWrapper(
    <ApolloProvider client={client}>
      <NotificationRealtimeToastHost />
    </ApolloProvider>,
    { locale }
  );
}

/** Wall-clock wait (no fake timers under bun:test). */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

/**
 * Seeded client whose MockLink serves the initial page PLUS one catch-up
 * pair per planned reconnect — every catch-up converges to the SAME server
 * truth (["500"], 1), so any replay the sidecar re-delivers is observably
 * stale: a duplicate toast or a cache drift is the only way it could stick.
 */
async function createFlickerClient(reconnects: number): Promise<ApolloClient> {
  const catchUpPair: MockLink.MockedResponse[] = [
    {
      request: { query: myUnreadNotificationCountQueryDocument },
      result: { data: { myUnreadNotificationCount: 1 } },
    },
    {
      request: { query: myNotificationsQueryDocument, variables: { filter: null } },
      result: { data: { myNotifications: listPageData(["500"], 1) } },
    },
  ];
  const mocks: MockLink.MockedResponse[] = [...catchUpPair];
  for (let reconnect = 0; reconnect < reconnects; reconnect++) {
    mocks.push(...catchUpPair);
  }
  const client = new ApolloClient({
    link: new MockLink([...mocks]),
    cache: createApolloCache(),
    defaultOptions: { query: { errorPolicy: "none" } },
  });
  await client.query({ query: myUnreadNotificationCountQueryDocument });
  await client.query({ query: myNotificationsQueryDocument, variables: { filter: null } });
  return client;
}

// ─── Wire frame handling ────────────────────────────────────────────────────

describe("useNotificationRealtime (Happy DOM, mocked WebSocket)", () => {
  test("en: arrival merges into the cache (list prepend + count bump) and renders ONE localized toast; client sends nothing", async () => {
    const locale: AppLocale = "en";
    const labels = Notifications.getLabels(getTranslations(locale));
    const client = await createSeededClient();

    renderHost(client, locale);
    const socket = currentSocket();
    expect(socket.url).toBe("ws://localhost:3101");

    act(() => {
      socket.simulateOpen();
    });
    act(() => {
      socket.simulateMessage(makeFrameRaw(777, "New session request"));
    });

    // Cache merge: fresh unread row prepended to page 1, count bumped — no refetch.
    expect(readCachedListIds(client)).toEqual(["777", "500"]);
    expect(readCachedCount(client)).toBe(2);

    // Toast: localized (type label + title) exactly once.
    expect(screen.getAllByText(labels.realtimeToast(labels.typeSessionRequest, "New session request"))).toHaveLength(1);

    // REQ-034 corollary: push-only protocol — zero outbound application frames.
    expect(socket.sentFrames).toEqual([]);

    // First connect NEVER triggers the catch-up refetch (mocks exhausted →
    // any query would reject loudly into the log).
    await sleep(300);
    expect(readCachedCount(client)).toBe(2);
  });

  test("en: duplicate id replay is a complete no-op (single toast, cache untouched)", async () => {
    const locale: AppLocale = "en";
    const labels = Notifications.getLabels(getTranslations(locale));
    const client = await createSeededClient();

    renderHost(client, locale);
    const socket = currentSocket();
    act(() => {
      socket.simulateOpen();
    });
    act(() => {
      socket.simulateMessage(makeFrameRaw(777, "Replayed push"));
    });
    act(() => {
      socket.simulateMessage(makeFrameRaw(777, "Replayed push"));
    });

    expect(readCachedListIds(client)).toEqual(["777", "500"]);
    expect(readCachedCount(client)).toBe(2);
    expect(screen.getAllByText(labels.realtimeToast(labels.typeSessionRequest, "Replayed push"))).toHaveLength(1);
  });

  test("en: id the cache already holds is a no-op — no toast, no count bump (REQ-025)", async () => {
    const locale: AppLocale = "en";
    const labels = Notifications.getLabels(getTranslations(locale));
    const client = await createSeededClient();
    // "500" is already a seeded, cached row.

    renderHost(client, locale);
    const socket = currentSocket();
    act(() => {
      socket.simulateOpen();
    });
    act(() => {
      socket.simulateMessage(makeFrameRaw(500, "Already cached row"));
    });

    expect(readCachedListIds(client)).toEqual(["500"]);
    expect(readCachedCount(client)).toBe(1);
    expect(screen.queryByText(labels.realtimeToast(labels.typeSystemBroadcast, "Already cached row"))).toBeNull();
  });

  test("en: read-only filtered variants never gain the unread arrival; matching variants do", async () => {
    const locale: AppLocale = "en";
    const client = new ApolloClient({
      link: new MockLink([
        {
          request: { query: myUnreadNotificationCountQueryDocument },
          result: { data: { myUnreadNotificationCount: 1 } },
        },
        {
          request: { query: myNotificationsQueryDocument, variables: { filter: null } },
          result: { data: { myNotifications: listPageData(["500"], 1) } },
        },
        {
          request: { query: myNotificationsQueryDocument, variables: { filter: readOnlyFilter } },
          result: { data: { myNotifications: listPageData(["500"], 1) } },
        },
      ]),
      cache: createApolloCache(),
      defaultOptions: { query: { errorPolicy: "none" } },
    });
    await client.query({ query: myUnreadNotificationCountQueryDocument });
    await client.query({ query: myNotificationsQueryDocument, variables: { filter: null } });
    await client.query({ query: myNotificationsQueryDocument, variables: { filter: readOnlyFilter } });

    renderHost(client, locale);
    const socket = currentSocket();
    act(() => {
      socket.simulateOpen();
    });
    act(() => {
      socket.simulateMessage(makeFrameRaw(777, "Unread arrival"));
    });

    // Unfiltered page-1 variant gains the row…
    expect(readCachedListIds(client)).toEqual(["777", "500"]);
    // …the read-only variant stays untouched (the arrival is unread).
    const readOnly = client.cache.readQuery<MyNotificationsQuery>({
      query: myNotificationsQueryDocument,
      variables: { filter: readOnlyFilter },
    });
    expect(readOnly?.myNotifications.items.map(item => item.id)).toEqual(["500"]);
    expect(readOnly?.myNotifications.totalCount).toBe(1);
  });

  test("en: malformed and foreign frames are dropped silently", async () => {
    const locale: AppLocale = "en";
    const client = await createSeededClient();

    renderHost(client, locale);
    const socket = currentSocket();
    act(() => {
      socket.simulateOpen();
    });
    for (const raw of [
      "not json at all",
      JSON.stringify({ v: 2, kind: "notification", data: {} }),
      JSON.stringify({ v: 1, kind: "presence", data: {} }),
      JSON.stringify({ v: 1, kind: "notification", data: { id: 1, type: "session_request" } }),
      JSON.stringify({ v: 1, kind: "notification", data: { id: "1", type: 42, title: "t" } }),
    ]) {
      act(() => {
        socket.simulateMessage(raw);
      });
    }

    expect(readCachedListIds(client)).toEqual(["500"]);
    expect(readCachedCount(client)).toBe(1);
    expect(document.body.textContent?.includes("MuiAlert")).toBe(false);
  });

  test("en: unknown notification type is dropped without a toast", async () => {
    const locale: AppLocale = "en";
    const client = await createSeededClient();

    renderHost(client, locale);
    const socket = currentSocket();
    act(() => {
      socket.simulateOpen();
    });
    act(() => {
      socket.simulateMessage(makeFrameRaw(888, "Mystery type", "not_a_real_type"));
    });

    expect(readCachedListIds(client)).toEqual(["500"]);
    expect(readCachedCount(client)).toBe(1);
    expect(document.querySelectorAll(".MuiAlert-root")).toHaveLength(0);
  });

  test("ar: arrival renders the Arabic toast (RTL copy from the notifications namespace)", async () => {
    const locale: AppLocale = "ar";
    const labels = Notifications.getLabels(getTranslations(locale));
    const client = await createSeededClient();

    renderHost(client, locale);
    const socket = currentSocket();
    act(() => {
      socket.simulateOpen();
    });
    act(() => {
      socket.simulateMessage(makeFrameRaw(777, "طلب جلسة جديد"));
    });

    expect(screen.getAllByText(labels.realtimeToast(labels.typeSessionRequest, "طلب جلسة جديد"))).toHaveLength(1);
  });

  test("en: toast affordances — translated close button, auto-hide cadence wired", async () => {
    const locale: AppLocale = "en";
    const commonLabels = Common.getLabels(getTranslations(locale));
    const labels = Notifications.getLabels(getTranslations(locale));
    const client = await createSeededClient();

    renderHost(client, locale);
    const socket = currentSocket();
    act(() => {
      socket.simulateOpen();
    });
    act(() => {
      socket.simulateMessage(makeFrameRaw(777, "Dismissible"));
    });

    const closeButton = screen.getByRole("button", { name: commonLabels.close });
    expect(closeButton).toBeDefined();
    act(() => {
      closeButton.click();
    });
    // Dismissed — the toast surface unmounts entirely.
    expect(screen.queryByText(labels.realtimeToast(labels.typeSessionRequest, "Dismissible"))).toBeNull();
  });

  test("en: toast cap — the 4th concurrent arrival evicts the OLDEST toast", async () => {
    const locale: AppLocale = "en";
    const labels = Notifications.getLabels(getTranslations(locale));
    const client = await createSeededClient();

    renderHost(client, locale);
    const socket = currentSocket();
    act(() => {
      socket.simulateOpen();
    });
    for (const [index, title] of ["First", "Second", "Third", "Fourth"].entries()) {
      act(() => {
        socket.simulateMessage(makeFrameRaw(900 + index, title));
      });
    }

    // Oldest evicted; the newest three remain.
    expect(screen.queryByText(labels.realtimeToast(labels.typeSessionRequest, "First"))).toBeNull();
    for (const title of ["Second", "Third", "Fourth"]) {
      expect(screen.getByText(labels.realtimeToast(labels.typeSessionRequest, title))).toBeDefined();
    }
    expect(document.querySelectorAll(".MuiAlert-root")).toHaveLength(3);
  });
});

// ─── Lifecycle ──────────────────────────────────────────────────────────────

describe("useNotificationRealtime lifecycle", () => {
  test("reconnect after close(1001) fires the catch-up refetch and converges the feed", async () => {
    const locale: AppLocale = "en";
    const client = await createSeededClient({ ids: ["500", "9000"], count: 7 });

    renderHost(client, locale);
    const first = currentSocket();
    act(() => {
      first.simulateOpen();
    });
    // Server shutdown → 1001 → backoff → new socket.
    act(() => {
      first.simulateClose(1001);
    });
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(2), { timeout: 3000 });

    const second = currentSocket();
    act(() => {
      second.simulateOpen();
    });

    // Catch-up refetch (REQ-025): page 1 + unread count re-pulled from the
    // wire — the cache converges to the mocked fresh truth.
    await waitFor(() => expect(readCachedCount(client)).toBe(7), { timeout: 3000 });
    await waitFor(() => expect(readCachedListIds(client)).toEqual(["500", "9000"]), { timeout: 3000 });
  });

  test("close(4401) aborts retrying — no second socket is ever constructed", async () => {
    const locale: AppLocale = "en";
    const client = await createSeededClient();

    renderHost(client, locale);
    const socket = currentSocket();
    act(() => {
      socket.simulateOpen();
    });
    act(() => {
      socket.simulateClose(4401);
    });

    // Beyond the fastest possible first retry (800ms) no socket appears.
    await sleep(1500);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  test("close(4009) (superseded tab) aborts retrying too", async () => {
    const locale: AppLocale = "en";
    const client = await createSeededClient();

    renderHost(client, locale);
    const socket = currentSocket();
    act(() => {
      socket.simulateOpen();
    });
    act(() => {
      socket.simulateClose(4009);
    });

    await sleep(1500);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  test("unmount closes exactly once with 1000 and detaches every listener", async () => {
    const locale: AppLocale = "en";
    const client = await createSeededClient();

    const { unmount } = renderHost(client, locale);
    const socket = currentSocket();
    act(() => {
      socket.simulateOpen();
    });
    unmount();

    expect(socket.closeCalls).toEqual([{ code: 1000, reason: "" }]);
    expect(socket.listenerCount("open")).toBe(0);
    expect(socket.listenerCount("message")).toBe(0);
    expect(socket.listenerCount("error")).toBe(0);
    expect(socket.listenerCount("close")).toBe(0);

    // No reconnect after teardown.
    await sleep(1200);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  test("remount constructs a fresh socket with no listener/toast duplication", async () => {
    const locale: AppLocale = "en";
    const labels = Notifications.getLabels(getTranslations(locale));

    const client = await createSeededClient();
    const firstRender = renderHost(client, locale);
    const first = currentSocket();
    act(() => {
      first.simulateOpen();
    });
    firstRender.unmount();
    expect(first.closeCalls).toHaveLength(1);

    renderHost(client, locale);
    const second = currentSocket();
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(second.listenerCount("message")).toBe(1);

    // The retired socket can never fire again (handlers detached).
    act(() => {
      first.simulateMessage(makeFrameRaw(123, "Ghost frame"));
    });
    // Exactly ONE toast from the live socket's arrival.
    act(() => {
      second.simulateOpen();
      second.simulateMessage(makeFrameRaw(456, "Live frame"));
    });
    expect(screen.getAllByText(labels.realtimeToast(labels.typeSessionRequest, "Live frame"))).toHaveLength(1);
    expect(screen.queryByText(labels.realtimeToast(labels.typeSessionRequest, "Ghost frame"))).toBeNull();
  });

  test("NEXT_PUBLIC_NOTIFICATION_WS_URL override wins over the derived default", async () => {
    const locale: AppLocale = "en";
    const previous = process.env.NEXT_PUBLIC_NOTIFICATION_WS_URL;
    process.env.NEXT_PUBLIC_NOTIFICATION_WS_URL = "ws://sidecar.example.test:9001";
    try {
      const client = await createSeededClient();
      renderHost(client, locale);
      expect(currentSocket().url).toBe("ws://sidecar.example.test:9001");
    } finally {
      if (previous === undefined) {
        delete process.env.NEXT_PUBLIC_NOTIFICATION_WS_URL;
      } else {
        process.env.NEXT_PUBLIC_NOTIFICATION_WS_URL = previous;
      }
    }
  });
});

// ─── Backoff curve (pure) ───────────────────────────────────────────────────

describe("getNotificationReconnectDelay", () => {
  test("base curve doubles from 1s and caps at 30s (midpoint random)", () => {
    expect(getNotificationReconnectDelay(0, () => 0.5)).toBe(1000);
    expect(getNotificationReconnectDelay(1, () => 0.5)).toBe(2000);
    expect(getNotificationReconnectDelay(2, () => 0.5)).toBe(4000);
    expect(getNotificationReconnectDelay(3, () => 0.5)).toBe(8000);
    expect(getNotificationReconnectDelay(4, () => 0.5)).toBe(16000);
    expect(getNotificationReconnectDelay(5, () => 0.5)).toBe(30000);
    expect(getNotificationReconnectDelay(50, () => 0.5)).toBe(30000);
  });

  test("jitter stays within ±20% of the curve value and the cap clamps", () => {
    expect(getNotificationReconnectDelay(0, () => 0)).toBe(800);
    expect(getNotificationReconnectDelay(0, () => 1)).toBe(1200);
    expect(getNotificationReconnectDelay(2, () => 0)).toBe(3200);
    expect(getNotificationReconnectDelay(2, () => 1)).toBe(4800);
    expect(getNotificationReconnectDelay(50, () => 1)).toBe(36000);
  });

  test("negative attempt counts clamp to the first step", () => {
    expect(getNotificationReconnectDelay(-3, () => 0.5)).toBe(1000);
  });
});

// ─── Chaos tier (tasks.md 5.3 — REQ-044/REQ-076 client half) ────────────────

describe("useNotificationRealtime — chaos tier (reconnect flicker + hostile payloads)", () => {
  test("a close↔open flicker storm keeps exactly ONE live connection and zero duplicated toasts (replay dedupe by id)", async () => {
    const locale: AppLocale = "en";
    const labels = Notifications.getLabels(getTranslations(locale));
    const replayTitle = "chaos-flicker-replay";

    // Four flickers keep the whole storm inside the 6s toast auto-hide
    // window, so "exactly one toast" is assertable at every cycle — each
    // reopen re-delivers a BURST of three replayed frames, so the dedupe
    // gate absorbs 13 deliveries of one id in total.
    const FLICKERS = 4;
    const REPLAY_BURST = 3;
    const client = await createFlickerClient(FLICKERS);

    renderHost(client, locale);
    const first = currentSocket();
    act(() => {
      first.simulateOpen();
    });
    // The one legitimate delivery: exactly one toast, one prepend, one bump.
    act(() => {
      first.simulateMessage(makeFrameRaw(777, replayTitle));
    });
    expect(readCachedListIds(client)).toEqual(["777", "500"]);
    expect(readCachedCount(client)).toBe(2);
    expect(screen.getAllByText(labels.realtimeToast(labels.typeSessionRequest, replayTitle))).toHaveLength(1);

    // Index-recursive flicker cycle (the repo's no-await-in-loop pattern —
    // each close↔open cycle depends on the previous one's reconnect timer).
    const flickerOnce = async (cycle: number): Promise<void> => {
      if (cycle > FLICKERS) {
        return;
      }
      // Server restart → close(1001) → backoff → a fresh socket per cycle.
      act(() => {
        currentSocket().simulateClose(1001);
      });
      await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(cycle + 1), { timeout: 3000 });
      const reopened = currentSocket();
      act(() => {
        reopened.simulateOpen();
        // The sidecar replays the recent push at-least-once per reconnect.
        for (let burstIndex = 0; burstIndex < REPLAY_BURST; burstIndex++) {
          reopened.simulateMessage(makeFrameRaw(777, replayTitle));
        }
      });
      // Dedupe by payload id: NEVER a second toast, no matter the cycle.
      expect(screen.getAllByText(labels.realtimeToast(labels.typeSessionRequest, replayTitle))).toHaveLength(1);
      await flickerOnce(cycle + 1);
    };
    await flickerOnce(1);

    // The final reopen's catch-up converges the cache to the mocked server
    // truth — the stale replay never double-bumped anything.
    await waitFor(() => expect(readCachedCount(client)).toBe(1), { timeout: 3000 });
    await waitFor(() => expect(readCachedListIds(client)).toEqual(["500"]), { timeout: 3000 });

    // Exactly-one live connection: 1 + FLICKERS sockets were ever built, one
    // is OPEN, every retired socket is CLOSED, and the push-only protocol
    // held across the whole storm (zero outbound frames anywhere).
    expect(FakeWebSocket.instances).toHaveLength(1 + FLICKERS);
    const liveSockets = FakeWebSocket.instances.filter(socket => socket.readyState === FakeWebSocket.OPEN);
    expect(liveSockets).toHaveLength(1);
    for (const socket of FakeWebSocket.instances) {
      expect(socket.sentFrames).toEqual([]);
      if (!liveSockets.includes(socket)) {
        expect(socket.readyState).toBe(FakeWebSocket.CLOSED);
      }
    }
  });

  test("unicode/RTL/control-char payload frames render as literal text — no crash, no script materialization", async () => {
    const locale: AppLocale = "en";
    const labels = Notifications.getLabels(getTranslations(locale));
    const client = await createSeededClient();

    renderHost(client, locale);
    const socket = currentSocket();
    act(() => {
      socket.simulateOpen();
    });

    // Hostile title: bidi override + RTL/inline marks + zero-width space +
    // control characters (BEL/BS/ESC/US — deliberately none are DOM
    // whitespace, so the default text-matching normalizer cannot collapse
    // them) + astral-plane emoji. Parity with the DB tier's hostile-text
    // storage fixture (notification-engine.chaos.test.ts).
    const hostileTitle = "chaos-\u202E\u200Fعرض\u202C\u200E\u200B\u0007\u0008\u001B\u001F\u{1F680}\u{1D11E}";
    act(() => {
      socket.simulateMessage(makeFrameRaw(777, hostileTitle));
    });

    // Renders byte-exact as a literal text node — exactly one toast, no crash.
    expect(screen.getAllByText(labels.realtimeToast(labels.typeSessionRequest, hostileTitle))).toHaveLength(1);
    expect(document.querySelectorAll(".MuiAlert-root")).toHaveLength(1);

    // Injection-shaped copy renders as text too (REQ-028 client half).
    const injectionTitle = "chaos-<script>alert('xss')</script>";
    act(() => {
      socket.simulateMessage(makeFrameRaw(778, injectionTitle, "system_broadcast"));
    });
    expect(screen.getAllByText(labels.realtimeToast(labels.typeSystemBroadcast, injectionTitle))).toHaveLength(1);
    expect(document.querySelectorAll(".MuiAlert-root")).toHaveLength(2);
    // Payload text never materializes as an executable element.
    expect(document.querySelectorAll("script")).toHaveLength(0);

    // The hostile rows merged into the cache as literal ids, badge bumped twice.
    expect(readCachedListIds(client)).toEqual(["778", "777", "500"]);
    expect(readCachedCount(client)).toBe(3);
  });
});
