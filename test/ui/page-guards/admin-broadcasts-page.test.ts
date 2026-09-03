/**
 * `/admin/broadcasts` SSR guard suite — pins the page-level authorization
 * boundary of the admin broadcast composer.
 *
 * The page's guard is `withPageAuth({ roles: [UserRole.Admin], redirectTo:
 * "/admin/broadcasts" })`; these tests drive the REAL page module against a
 * controlled `getServerUserContext` double and a recording `redirect` double
 * (which throws, mirroring Next.js redirect semantics — a redirected render
 * never returns):
 *
 *   anonymous              → `/login?redirect=/admin/broadcasts`
 *   student/teacher/parent → their OWN role dashboard (the wrapper never
 *                            redirects to the bare `/dashboard` dispatcher —
 *                            the preview-gateway loop fix)
 *   admin                  → renders `BroadcastComposeContainer` (no props —
 *                            the container resolves its own labels) + locale
 *                            derived page metadata
 *
 * Module doubles are registered via `mock.module` BEFORE the page module is
 * dynamically imported, so the real `server-auth` (DB + JWT machinery),
 * `next/navigation`, and `next/headers` never execute — this suite is
 * serverless: no DB, no network, no DOM. The compose container is bound as a
 * component double for the same reason: guard behavior — not compose UX — is
 * the subject here, and the suite must not depend on the container's own
 * module graph (its client hooks are covered by the container's suite).
 *
 * Runner: `bun run test/scripts/run-test.ts test/ui/page-guards/admin-broadcasts-page.test.ts`
 * (isolated process — the module mocks below are intentionally global to it).
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { AppLocale } from "@/shared/locale/AppLocale";
import { getTranslations } from "@/shared/locale/server";

// ----------------------------------------------------------------------------
// Controlled server state (swapped per test)
// ----------------------------------------------------------------------------

/** Shape of the mocked `getServerUserContext` return — all-null = anonymous. */
interface ServerContextState {
  readonly userId: number | null;
  readonly user: Record<string, never> | null;
  readonly role: string | null;
}

const ANONYMOUS: ServerContextState = { userId: null, user: null, role: null };

let serverContext: ServerContextState = ANONYMOUS;
let cookieLocale: AppLocale = "en";

/** Every `redirect()` invocation target, in order. */
const redirectTargets: string[] = [];

// ----------------------------------------------------------------------------
// Module doubles — registered BEFORE the page module import below
// ----------------------------------------------------------------------------

void mock.module("@/backend/lib/auth/server-auth", () => ({
  getServerUserContext: async (): Promise<ServerContextState> => serverContext,
}));

void mock.module("next/navigation", () => ({
  // Faithful to Next.js semantics: redirect() never returns — the thrown
  // error aborts the server render, and the recorded URL is the assertion
  // surface.
  redirect: (url: string): never => {
    redirectTargets.push(url);
    throw new Error(`page redirect: ${url}`);
  },
  notFound: (): never => {
    throw new Error("page not found");
  },
  // Inert client-router stubs — nothing in the imported page tree calls them;
  // they keep any transitive client import resolvable.
  useParams: () => ({}),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({
    push: () => undefined,
    replace: () => undefined,
    back: () => undefined,
    forward: () => undefined,
    prefetch: () => undefined,
    refresh: () => undefined,
  }),
}));

void mock.module("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === "NEXT_LOCALE" ? { value: cookieLocale } : undefined),
  }),
}));

void mock.module("@/frontend/views/admin/broadcasts/BroadcastComposeContainer", () => ({
  BroadcastComposeContainer: () => null,
}));

// The page module is imported AFTER the doubles so its import graph binds to
// them (the container import above reuses the same module instance for the
// identity assertion below).
const { default: adminBroadcastsPage, generateMetadata } = await import("@/app/(dashboard)/admin/broadcasts/page");
const { BroadcastComposeContainer } = await import("@/frontend/views/admin/broadcasts/BroadcastComposeContainer");

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

/** Calls the page, returning the redirect target if the render aborted. */
async function renderPage(): Promise<{ readonly redirectTo: string | null; readonly element: unknown }> {
  redirectTargets.length = 0;
  try {
    const element = await adminBroadcastsPage();
    return { redirectTo: null, element };
  } catch {
    const target = redirectTargets.length > 0 ? (redirectTargets[0] ?? "") : "";
    return { redirectTo: target, element: null };
  }
}

/**
 * Narrows the page's render output to its JSX element shell WITHOUT unsafe
 * type assertions — `in`-based guards give the compiler a provably narrow
 * type, and the thrown branch makes every property access below safe.
 */
function readShellElement(element: unknown): { readonly type: unknown; readonly propKeys: readonly string[] } {
  if (typeof element !== "object" || element === null || !("type" in element) || !("props" in element)) {
    throw new Error("expected the broadcasts page to render a JSX element with props");
  }
  const props = element.props;
  if (typeof props !== "object" || props === null) {
    throw new Error("expected the rendered element to carry a props object");
  }
  return { type: element.type, propKeys: Object.keys(props) };
}

// ----------------------------------------------------------------------------
// Suite
// ----------------------------------------------------------------------------

describe("/admin/broadcasts — withPageAuth SSR guards", () => {
  beforeEach(() => {
    serverContext = ANONYMOUS;
    redirectTargets.length = 0;
  });

  test("anonymous caller → /login?redirect=/admin/broadcasts (page never renders)", async () => {
    const { redirectTo, element } = await renderPage();

    expect(redirectTo).not.toBeNull();
    expect(element).toBeNull();
    // Base-supplied parse: the guard records a RELATIVE location (the
    // private-network-access fix), which the URL parser rejects without one.
    const loginUrl = new URL(redirectTo ?? "", "http://localhost");
    expect(loginUrl.pathname).toBe("/login");
    expect(loginUrl.searchParams.get("redirect")).toBe("/admin/broadcasts");
  });

  test.each([
    ["student", "/student/dashboard"],
    ["teacher", "/teacher/dashboard"],
    ["parent", "/parent/dashboard"],
  ])(
    "role-mismatched caller (%s) → its own role dashboard %s (page never renders)",
    async (role, expectedDashboard) => {
      serverContext = { userId: 11, user: {}, role };

      const { redirectTo, element } = await renderPage();

      expect(redirectTo).toBe(expectedDashboard);
      expect(redirectTo).not.toBe("/dashboard");
      expect(element).toBeNull();
    }
  );

  test("admin caller (en cookie) → renders the compose container with no props + localized metadata", async () => {
    serverContext = { userId: 7, user: {}, role: "admin" };
    cookieLocale = "en";
    const t = getTranslations("en").adminBroadcastsTranslations;

    const { redirectTo, element } = await renderPage();

    expect(redirectTo).toBeNull();
    expect(element).not.toBeNull();
    const shell = readShellElement(element);
    expect(shell.type).toBe(BroadcastComposeContainer);
    // The container resolves its own labels client-side — the page hands it
    // nothing.
    expect(shell.propKeys).toEqual([]);

    const metadata = await generateMetadata();
    expect(metadata.title).toBe(t.pageTitle);
    expect(metadata.description).toBe(t.pageSubtitle);
  });

  test("admin caller (ar cookie) → metadata resolves through the Arabic bundle", async () => {
    serverContext = { userId: 7, user: {}, role: "admin" };
    cookieLocale = "ar";
    const t = getTranslations("ar").adminBroadcastsTranslations;

    const { redirectTo, element } = await renderPage();

    expect(redirectTo).toBeNull();
    const shell = readShellElement(element);
    expect(shell.type).toBe(BroadcastComposeContainer);

    const metadata = await generateMetadata();
    expect(metadata.title).toBe(t.pageTitle);
    expect(metadata.description).toBe(t.pageSubtitle);
    // The Arabic bundle is genuinely different copy (not an en fallback).
    expect(metadata.title).not.toBe(getTranslations("en").adminBroadcastsTranslations.pageTitle);
  });
});
