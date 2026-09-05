/**
 * `/parent/handshake` SSR guard suite — pins the page-level authorization
 * boundary of the parent discovery page.
 *
 * The page's guard is `withPageAuth({ roles: [UserRole.Parent], redirectTo:
 * "/parent/handshake" })`; these tests drive the REAL page module against a
 * controlled `getServerUserContext` double and a recording `redirect` double
 * (which throws, mirroring Next.js redirect semantics — a redirected render
 * never returns):
 *
 *   anonymous            → `/login?redirect=/parent/handshake`
 *   student/teacher/admin → their OWN role dashboard (the wrapper never
 *                            redirects to the bare `/dashboard` dispatcher —
 *                          the preview-gateway loop fix)
 *   parent               → renders `HandshakeDiscoveryContainer` with
 *                            server-translated shell labels (both locales,
 *                            threaded through the `NEXT_LOCALE` cookie) +
 *                            locale-derived page metadata
 *
 * Module doubles are registered via `mock.module` BEFORE the page module is
 * dynamically imported, so the real `server-auth` (DB + JWT machinery),
 * `next/navigation`, and `next/headers` never execute — this suite is
 * serverless: no DB, no network, no DOM.
 *
 * Runner: `bun run test/scripts/run-test.ts test/ui/page-guards/parent-handshake-page.test.ts`
 * (isolated process — the module mocks below are intentionally global to it).
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { AppLocale } from "@/shared/locale/AppLocale";
import { HandshakeCode as HandshakeCodeNs } from "@/shared/locale/namespaces/handshakeCode";
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

// The page module is imported AFTER the doubles so its import graph binds to
// them (the barrel import reuses the same module instances for the identity
// assertion below).
const { default: parentHandshakePage, generateMetadata } = await import("@/app/(dashboard)/parent/handshake/page");
const { HandshakeDiscoveryContainer } = await import("@/frontend/views/parent/handshake");

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

/** Calls the page, returning the redirect target if the render aborted. */
async function renderPage(): Promise<{ readonly redirectTo: string | null; readonly element: unknown }> {
  redirectTargets.length = 0;
  try {
    const element = await parentHandshakePage();
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
function readShellElement(element: unknown): {
  readonly type: unknown;
  readonly pageTitle: unknown;
  readonly pageDescription: unknown;
} {
  if (typeof element !== "object" || element === null || !("type" in element) || !("props" in element)) {
    throw new Error("expected the parent page to render a JSX element with props");
  }
  const props = element.props;
  if (typeof props !== "object" || props === null || !("pageTitle" in props) || !("pageDescription" in props)) {
    throw new Error("expected the rendered element to carry the translated shell labels");
  }
  return { type: element.type, pageTitle: props.pageTitle, pageDescription: props.pageDescription };
}

// ----------------------------------------------------------------------------
// Suite
// ----------------------------------------------------------------------------

describe("/parent/handshake — withPageAuth SSR guards", () => {
  beforeEach(() => {
    serverContext = ANONYMOUS;
    redirectTargets.length = 0;
  });

  test("anonymous caller → /login?redirect=/parent/handshake (page never renders)", async () => {
    const { redirectTo, element } = await renderPage();

    expect(redirectTo).not.toBeNull();
    expect(element).toBeNull();
    const loginUrl = new URL(redirectTo ?? "");
    expect(loginUrl.pathname).toBe("/login");
    expect(loginUrl.searchParams.get("redirect")).toBe("/parent/handshake");
  });

  test.each([
    ["student", "/student/dashboard"],
    ["teacher", "/teacher/dashboard"],
    ["admin", "/admin/dashboard"],
  ])(
    "role-mismatched caller (%s) → its own role dashboard %s (page never renders)",
    async (role, expectedDashboard) => {
      serverContext = { userId: 11, user: {}, role };

      const { redirectTo, element } = await renderPage();

      expect(redirectTo).toBe(expectedDashboard);
      expect(element).toBeNull();
    }
  );

  test("parent caller (en cookie) → renders the container with server-translated shell labels + metadata", async () => {
    serverContext = { userId: 7, user: {}, role: "parent" };
    cookieLocale = "en";
    const labels = HandshakeCodeNs.getLabels(getTranslations("en"));

    const { redirectTo, element } = await renderPage();

    expect(redirectTo).toBeNull();
    expect(element).not.toBeNull();
    const shell = readShellElement(element);
    expect(shell.type).toBe(HandshakeDiscoveryContainer);
    expect(shell.pageTitle).toBe(labels.pageTitle);
    expect(shell.pageDescription).toBe(labels.pageDescription);

    const metadata = await generateMetadata();
    expect(metadata.title).toBe(labels.pageTitle);
    expect(metadata.description).toBe(labels.pageDescription);
  });

  test("parent caller (ar cookie) → shell labels resolve through the Arabic bundle", async () => {
    serverContext = { userId: 7, user: {}, role: "parent" };
    cookieLocale = "ar";
    const labels = HandshakeCodeNs.getLabels(getTranslations("ar"));

    const { redirectTo, element } = await renderPage();

    expect(redirectTo).toBeNull();
    const shell = readShellElement(element);
    expect(shell.pageTitle).toBe(labels.pageTitle);
    expect(shell.pageDescription).toBe(labels.pageDescription);
    // The Arabic bundle is genuinely different copy (not an en fallback).
    expect(shell.pageTitle).not.toBe(HandshakeCodeNs.getLabels(getTranslations("en")).pageTitle);
  });
});
