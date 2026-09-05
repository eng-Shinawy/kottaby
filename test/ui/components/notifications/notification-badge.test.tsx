/**
 * NotificationUnreadBadge + notifications navigation — the app-bar bell /
 * unread-badge and per-role sidebar-entry component suite (tasks.md 4.4.TE).
 *
 * Happy DOM + Apollo tier (`test/ui/components`): the badge renders through a
 * REAL `ApolloClient` on `MockLink` + `createApolloCache()` (production type
 * policies — the 4.2a realtime-suite precedent), with a counting `ApolloLink`
 * ahead of the mock so query-deduplication and cache-driven re-renders are
 * asserted at the LINK level:
 *
 *   badge rendering + pluralization (0 / 1 / N / 99+ overflow, en + ar —
 *   accessible name + visible count) · app-bar integration (the bell mounts
 *   in the authenticated shell chrome) · zero WebSocket construction
 *   (REQ-067 — the tab's socket belongs to the shell toast host) ·
 *   simultaneous observers coalesce into ONE network query ·
 *   unmount → remount serves the cached count without a re-fetch ·
 *   hook-maintained cache bumps re-render the badge WITHOUT a refetch
 *   (plan D11 co-maintenance) · per-role sidebar "Notifications" link ·
 *   nav-config declaration per role (all four UserRoles — the five REQ-065
 *   audiences: teacher-applicant and teacher-certified share UserRole.Teacher,
 *   super admin is UserRole.Admin).
 *
 * Translation discipline: every rendered string resolves through
 * `Notifications.getLabels(getTranslations(locale))` /
 * `Dashboard.getLabels(getTranslations(locale))` — ZERO hardcoded UI copy.
 * Fixture names/emails and the MUI-computed `99+` overflow display are
 * technical test data.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ApolloClient, ApolloLink } from "@apollo/client";
import { ApolloProvider } from "@apollo/client/react";
import { MockLink } from "@apollo/client/testing";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { NotificationUnreadBadge } from "@/frontend/components/ui/NotificationUnreadBadge";
import { AuthContext, type AuthContextType, type AuthUser } from "@/frontend/context/AuthContext";
import { ThemeContext, type ThemeContextType } from "@/frontend/context/ThemeContext";
import { UserRole } from "@/frontend/graphql/generated/gql/graphql";
import {
  myNotificationsQueryDocument,
  myUnreadNotificationCountQueryDocument,
} from "@/frontend/graphql/sharedDocuments";
import { createApolloCache } from "@/frontend/providers/apollo/apolloCache";
import { DashboardAppBar } from "@/frontend/views/dashboard/layout";
import {
  type DashboardNavItem,
  DashboardSidebar,
  getNavItemsForRole,
  NotificationsIcon,
  resolveNavItemLabel,
} from "@/frontend/views/dashboard/nav";
import type { AppLocale } from "@/shared/locale/AppLocale";
import { Dashboard } from "@/shared/locale/namespaces/dashboard";
import { HandshakeCode } from "@/shared/locale/namespaces/handshakeCode";
import { Notifications } from "@/shared/locale/namespaces/notifications";
import { getTranslations } from "@/shared/locale/server";
import { renderWithWrapper } from "@/test/ui/components/TestWrapper";

// ─── WebSocket ownership double ─────────────────────────────────────────────

const originalWebSocket = globalThis.WebSocket;

/** Constructions of `globalThis.WebSocket` while the double is installed. */
let webSocketConstructions = 0;

/** Minimal recording double — the badge suite asserts ZERO constructions. */
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

/**
 * Builds a test client whose counting link fronts a single unread-count
 * mock — the link-level counter is the dedupe / cache-observation seam —
 * plus an EMPTY drawer-window list mock: the bell now hosts
 * `NotificationDrawer` (drawer-plan DR-1), so click-toggle assertions must
 * not die on an unmocked `myNotifications` operation.
 */
function createBadgeClient(count: number): { client: ApolloClient; requestCount: () => number } {
  let requests = 0;
  const counter = new ApolloLink((operation, forward) => {
    requests += 1;
    return forward(operation);
  });
  const client = new ApolloClient({
    link: ApolloLink.from([
      counter,
      new MockLink([
        {
          request: { query: myUnreadNotificationCountQueryDocument },
          result: { data: { myUnreadNotificationCount: count } },
        },
        {
          request: {
            query: myNotificationsQueryDocument,
            variables: { filter: { isRead: null, type: null, limit: 5, offset: 0 } },
          },
          result: {
            data: {
              myNotifications: { __typename: "NotificationListPage", items: [], totalCount: 0, hasMore: false },
            },
          },
        },
      ]),
    ]),
    cache: createApolloCache(),
    defaultOptions: { query: { errorPolicy: "none" } },
  });
  return { client, requestCount: () => requests };
}

/** Renders the badge under the real Apollo client + the shared TestWrapper. */
function renderBadge(client: ApolloClient, locale: AppLocale): ReturnType<typeof renderWithWrapper> {
  return renderWithWrapper(
    <ApolloProvider client={client}>
      <NotificationUnreadBadge />
    </ApolloProvider>,
    { locale }
  );
}

/** The visible badge-count element (MUI badge span), if rendered. */
function badgeElement(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>(".MuiBadge-badge");
}

/** Deterministic authed user fixture carrying the given role. */
function authUser(role: UserRole): AuthUser {
  return {
    id: 1,
    email: "fixture-user@example.test",
    fullName: "Fixture User",
    phone: null,
    country: null,
    gender: null,
    // The `me` selection gained `locale` (R2-users-locale-b); unset for the
    // badge fixtures — the bell never reads it.
    locale: null,
    role,
    preferredRecitation: null,
    isDeleted: false,
    suspended: false,
    isBlocked: false,
  };
}

/** AuthContext value factory for an authenticated user with the given role. */
function makeAuthContext(role: UserRole): AuthContextType {
  return {
    user: authUser(role),
    isAuthenticated: true,
    isLoading: false,
    error: null,
    login: async () => false,
    logout: () => undefined,
  };
}

/**
 * Module-level context values per role (stable references — the Context
 * `value` prop must never be constructed inline per oxlint
 * `react/jsx-no-constructed-context-values`).
 */
const AUTH_CONTEXTS: Record<UserRole, AuthContextType> = {
  [UserRole.Student]: makeAuthContext(UserRole.Student),
  [UserRole.Teacher]: makeAuthContext(UserRole.Teacher),
  [UserRole.Parent]: makeAuthContext(UserRole.Parent),
  [UserRole.Admin]: makeAuthContext(UserRole.Admin),
};

/** ThemeContext value — the app-bar's theme toggle reads mode/toggleTheme. */
const themeContextValue: ThemeContextType = {
  mode: "dark",
  toggleTheme: () => undefined,
  isThemeChanging: false,
  setIsThemeChanging: () => undefined,
};

/** Renders the app-bar shell (badge mounted inside) for one role/locale. */
function renderAppBar(role: UserRole, locale: AppLocale): ReturnType<typeof renderWithWrapper> {
  const { client } = createBadgeClient(7);
  return renderWithWrapper(
    <ApolloProvider client={client}>
      <ThemeContext.Provider value={themeContextValue}>
        <AuthContext.Provider value={AUTH_CONTEXTS[role]}>
          <DashboardAppBar onMenuClick={() => undefined} showMenuButton={false} />
        </AuthContext.Provider>
      </ThemeContext.Provider>
    </ApolloProvider>,
    { locale }
  );
}

/** Renders the sidebar for one role/locale (nav entries render as links). */
function renderSidebar(role: UserRole, locale: AppLocale): ReturnType<typeof renderWithWrapper> {
  return renderWithWrapper(
    <AuthContext.Provider value={AUTH_CONTEXTS[role]}>
      <DashboardSidebar mobileOpen={false} onMobileClose={() => undefined} />
    </AuthContext.Provider>,
    { locale }
  );
}

// ─── Badge rendering + pluralization (REQ-063c/066) ─────────────────────────

for (const locale of ["ar", "en"] as AppLocale[]) {
  const t = Notifications.getLabels(getTranslations(locale));

  describe(`NotificationUnreadBadge (${locale === "ar" ? "RTL/arabic" : "LTR/english"})`, () => {
    test("plural unread count: bell button with composed accessible name and visible count toggles the drawer (DR-1)", async () => {
      const { container } = renderBadge(createBadgeClient(7).client, locale);

      const bell = await waitFor(() => {
        const button = screen.getByRole("button", { name: `${t.badgeAriaLabel} — ${t.unreadCount(7)}` });
        expect(button).toBeDefined();
        return button;
      });
      // The bell is a drawer toggle now — NOT a navigation anchor.
      expect(bell.getAttribute("aria-haspopup")).toBe("dialog");
      expect(bell.getAttribute("aria-expanded")).toBe("false");
      expect(bell.getAttribute("href")).toBeNull();
      expect(badgeElement(container)?.textContent).toBe("7");

      // Open: the popover surfaces its pinned footer link to the full page.
      fireEvent.click(bell);
      await waitFor(() => {
        expect(bell.getAttribute("aria-expanded")).toBe("true");
      });
      const viewAll = await screen.findByRole("link", { name: t.viewAllNotifications });
      expect(viewAll.getAttribute("href")).toBe("/notifications");

      // A second click closes the drawer again.
      fireEvent.click(bell);
      await waitFor(() => {
        expect(bell.getAttribute("aria-expanded")).toBe("false");
      });
    });

    test("singular unread count: accessible name uses the singular pluralization branch", async () => {
      const { container } = renderBadge(createBadgeClient(1).client, locale);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: `${t.badgeAriaLabel} — ${t.unreadCount(1)}` })).toBeDefined();
      });
      expect(badgeElement(container)?.textContent).toBe("1");
    });

    test("zero unread count: badge content hidden while the accessible name announces the zero branch", async () => {
      const { container } = renderBadge(createBadgeClient(0).client, locale);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: `${t.badgeAriaLabel} — ${t.unreadCount(0)}` })).toBeDefined();
      });
      // MUI hides the badge span for a zero count (showZero stays false).
      expect(badgeElement(container)?.className.includes("MuiBadge-invisible")).toBe(true);
    });

    test("99+ overflow: visible badge caps at the display maximum while the accessible name keeps the true count", async () => {
      const { container } = renderBadge(createBadgeClient(150).client, locale);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: `${t.badgeAriaLabel} — ${t.unreadCount(150)}` })).toBeDefined();
      });
      // "99+" is MUI's computed overflow display (max prop), not copy.
      expect(badgeElement(container)?.textContent).toBe("99+");
    });
  });
}

// ─── Socket ownership + query lifecycle (REQ-064/067, plan D11) ─────────────

describe("NotificationUnreadBadge lifecycle (Happy DOM, mocked WebSocket)", () => {
  const locale: AppLocale = "en";
  const t = Notifications.getLabels(getTranslations(locale));

  test("app-bar shell mount constructs ZERO WebSockets (the tab's socket belongs to the toast host)", async () => {
    renderAppBar(UserRole.Student, locale);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: `${t.badgeAriaLabel} — ${t.unreadCount(7)}` })).toBeDefined();
    });
    expect(webSocketConstructions).toBe(0);
  });

  test("simultaneous observers coalesce into ONE network query (Apollo query deduplication)", async () => {
    const { client, requestCount } = createBadgeClient(5);

    renderWithWrapper(
      <ApolloProvider client={client}>
        <NotificationUnreadBadge />
        <NotificationUnreadBadge />
      </ApolloProvider>,
      { locale }
    );

    // BOTH badges render the same count from the ONE in-flight query.
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: `${t.badgeAriaLabel} — ${t.unreadCount(5)}` })).toHaveLength(2);
    });
    expect(requestCount()).toBe(1);
  });

  test("unmount → remount serves the cached count without a second network query", async () => {
    const { client, requestCount } = createBadgeClient(5);

    const first = renderBadge(client, locale);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: `${t.badgeAriaLabel} — ${t.unreadCount(5)}` })).toBeDefined();
    });
    expect(requestCount()).toBe(1);

    first.unmount();
    // Remount: cache-first observation — the cached count renders and the
    // link is never re-executed (no duplicate query, no duplicate listener).
    renderBadge(client, locale);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: `${t.badgeAriaLabel} — ${t.unreadCount(5)}` })).toBeDefined();
    });
    expect(requestCount()).toBe(1);
  });

  test("hook-maintained cache bump re-renders the badge WITHOUT a refetch (plan D11 co-maintenance)", async () => {
    const { client, requestCount } = createBadgeClient(3);

    const { container } = renderBadge(client, locale);
    await waitFor(() => {
      expect(badgeElement(container)?.textContent).toBe("3");
    });

    // The exact ROOT_QUERY modifier the realtime hook applies per arrival.
    act(() => {
      client.cache.modify({
        id: "ROOT_QUERY",
        fields: {
          myUnreadNotificationCount: (count: unknown) => (typeof count === "number" ? count + 1 : count),
        },
      });
    });

    await waitFor(() => {
      expect(badgeElement(container)?.textContent).toBe("4");
    });
    expect(requestCount()).toBe(1);
  });
});

// ─── App-bar integration (REQ-063c/065) ─────────────────────────────────────

for (const locale of ["ar", "en"] as AppLocale[]) {
  const t = Notifications.getLabels(getTranslations(locale));

  test(`DashboardAppBar mounts the bell badge in the authenticated shell chrome (${locale})`, async () => {
    const { container } = renderAppBar(UserRole.Student, locale);

    const bell = await waitFor(() => {
      const button = screen.getByRole("button", { name: `${t.badgeAriaLabel} — ${t.unreadCount(7)}` });
      expect(button).toBeDefined();
      return button;
    });
    // The bell hosts the drawer (no direct navigation) — the full page stays
    // reachable via the sidebar entry and the drawer's footer link.
    expect(bell.getAttribute("aria-haspopup")).toBe("dialog");
    expect(badgeElement(container)?.textContent).toBe("7");
  });
}

// ─── Sidebar nav entry per role (REQ-065) ───────────────────────────────────

/** The five REQ-065 audiences collapse onto the four `UserRole` nav shells. */
const ROLE_SHELLS: ReadonlyArray<{ readonly role: UserRole; readonly audiences: string }> = [
  { role: UserRole.Student, audiences: "student" },
  // teacher-applicant and teacher-certified share the Teacher nav shell.
  { role: UserRole.Teacher, audiences: "teacher-applicant + teacher-certified" },
  { role: UserRole.Parent, audiences: "parent" },
  { role: UserRole.Admin, audiences: "super admin" },
];

/** The `/notifications` nav entry for a role — fails loudly when missing. */
function notificationsEntryFor(role: UserRole): DashboardNavItem {
  const entry = getNavItemsForRole(role).find(item => item.route === "/notifications");
  if (entry === undefined) {
    throw new Error(`notifications nav entry missing for role ${role}`);
  }
  return entry;
}

for (const locale of ["ar", "en"] as AppLocale[]) {
  const td = Dashboard.getLabels(getTranslations(locale));

  describe(`DashboardSidebar notifications entry (${locale === "ar" ? "RTL/arabic" : "LTR/english"})`, () => {
    test("every role shell renders the translated Notifications link to /notifications", () => {
      for (const shell of ROLE_SHELLS) {
        cleanup();
        const { container } = renderSidebar(shell.role, locale);

        // Direct anchor query (the markReadButtons container-query convention):
        // under Happy DOM the sidebar Drawers resolve as media-query-hidden
        // for role queries (permanent drawer's `lg+` display rule never
        // matches; the closed temporary Drawer is Modal-hidden), so the
        // nav anchors are asserted through their href + rendered label text.
        const links = Array.from(container.querySelectorAll("a")).filter(
          anchor => anchor.getAttribute("href") === "/notifications"
        );
        expect(links.length).toBeGreaterThanOrEqual(1);
        for (const link of links) {
          expect(link.textContent).toBe(td.notifications);
        }
      }
    });
  });
}

// ─── Sidebar list semantics (axe `list` rule, audit R2) ─────────────────────

for (const locale of ["ar", "en"] as AppLocale[]) {
  describe(`DashboardSidebar list semantics (${locale === "ar" ? "RTL/arabic" : "LTR/english"})`, () => {
    test("nav renders valid ul > li > a — every list child is an li whose direct child is the nav anchor", () => {
      for (const shell of ROLE_SHELLS) {
        cleanup();
        const { container } = renderSidebar(shell.role, locale);
        const expectedRoutes = getNavItemsForRole(shell.role).map(item => item.route);

        // Both drawers (temporary + permanent) mount the same nav list —
        // assert EVERY rendered ul, not just the first.
        const lists = Array.from(container.querySelectorAll("nav ul"));
        expect(lists.length).toBeGreaterThanOrEqual(1);
        for (const list of lists) {
          const children = Array.from(list.children);
          expect(children.map(child => child.tagName)).toEqual(expectedRoutes.map(() => "LI"));
          expect(children.map(child => child.children[0]?.getAttribute("href"))).toEqual(expectedRoutes);
          // The anchor is a DIRECT li child (ul > li > a), not a descendant.
          for (const child of children) {
            expect(child.children[0]?.tagName).toBe("A");
          }
        }
      }
    });
  });
}

// ─── Nav config declaration (REQ-065, plan §5.2) ────────────────────────────

describe("navItems config declares the Notifications entry per role", () => {
  test("all four UserRole shells (five audiences) declare the entry after the dashboard item with the NotificationsOutlined icon", () => {
    for (const shell of ROLE_SHELLS) {
      const items = getNavItemsForRole(shell.role);
      const index = items.findIndex(item => item.route === "/notifications");
      expect(index).toBe(1); // plan §5.2: directly after the dashboard/home entry
      const entry = items[index];
      expect(entry?.labelKey).toBe("notifications");
      expect(entry?.Icon).toBe(NotificationsIcon);
    }

    // The least-privilege fallback shell (null/unknown role) carries it too.
    expect(getNavItemsForRole(null).some(item => item.route === "/notifications")).toBe(true);

    // The label resolves through the translation system in BOTH locales.
    for (const locale of ["ar", "en"] as AppLocale[]) {
      const td = Dashboard.getLabels(getTranslations(locale));
      const th = HandshakeCode.getLabels(getTranslations(locale));
      expect(resolveNavItemLabel(notificationsEntryFor(UserRole.Parent), td, th)).toBe(td.notifications);
    }
  });
});
