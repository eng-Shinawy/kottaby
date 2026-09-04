import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { type ReactNode, useEffect } from "react";
import { AuthContext, type AuthContextType } from "@/frontend/context/AuthContext";
import { StoryApolloProvider } from "@/frontend/stories/lib/storyHarness";
import { LandingPage } from "@/frontend/views/landing";

/**
 * Storybook surface for `LandingPage` — the public marketing page rendered by
 * `app/page.tsx` at `/`.
 *
 * The page is a static marketing surface by design: hero, hijri/prayer strip,
 * stats, features, recitations, how-it-works, roles, testimonials, FAQ,
 * newsletter, CTA, footer, plus the floating WhatsApp / cookie-consent /
 * back-to-top affordances. Copy comes from `useAppTranslation` (locale
 * decorator) and theming from the MUI decorator.
 *
 * Two providers the global decorators do NOT supply:
 *  - `AuthContext` — `LandingNav`'s `LocaleSwitcher` calls `useAuth()`, which
 *    throws outside a provider. The story presents the anonymous visitor:
 *    `user: null`, so `LocaleSwitcher` takes its cookie-only path (the
 *    write-through mutation never fires).
 *  - `StoryApolloProvider([])` — `LocaleSwitcher` also calls
 *    `useApolloClient`/`useMutation`; an empty-mock client satisfies the
 *    hooks without any network shape (the mutation only fires for a signed-in
 *    user, never here).
 *  - `/api/health` fetch stub — the footer `ApiStatusIndicator` polls the LB
 *    probe; without a backend, Storybook renders the "offline" pill. The
 *    harness swaps `globalThis.fetch` for a pass-through that answers the
 *    probe with the canonical 200 envelope so the chip shows its
 *    checking → operational transition. The swap runs synchronously during
 *    render (parent bodies execute before child effects, so the chip never
 *    observes the un-stubbed fetch) and restores on unmount.
 */

/** Canonical GET /api/health 200 envelope from the LB probe contract. */
function healthOkResponse(): Response {
  const body = JSON.stringify({
    data: { status: "ok", service: "kottaby", version: "0.1.0", timestamp: "2026-08-27T04:21:05.921Z" },
    requestId: "d45d7fdd-4eee-461d-b9f4-e968efc4c0ac",
  });
  return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
}

/**
 * Answer `/api/health` probes with the canonical 200 envelope; every other
 * fetch is delegated to the original implementation. The swap MUST happen
 * synchronously during the harness render — child effects (the chip's first
 * poll) fire before any parent effect would. Reflect.set keeps the swap
 * assertion-free (oxlint no-unsafe-type-assertion).
 */
let savedFetch: typeof globalThis.fetch | null = null;

function installHealthProbeStub(): void {
  if (savedFetch !== null) return;
  savedFetch = globalThis.fetch;
  const originalFetch = savedFetch;
  const stubbedFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    let url: string;
    if (typeof input === "string") url = input;
    else if (input instanceof URL) url = input.href;
    else url = input.url;
    if (url === "/api/health") return await Promise.resolve(healthOkResponse());
    return await originalFetch(input, init);
  };
  Reflect.set(globalThis, "fetch", stubbedFetch);
}

function restoreHealthProbeStub(): void {
  if (savedFetch === null) return;
  Reflect.set(globalThis, "fetch", savedFetch);
  savedFetch = null;
}

/**
 * Story-only determinism: report `prefers-reduced-motion: reduce` so the
 * landing page's IntersectionObserver reveal (`FadeInBox`) and `AnimatedCounter`
 * render fully immediately — screenshots never catch sections mid-fade, no
 * scroll ritual needed. Restored on unmount alongside the fetch stub.
 */
let savedMatchMedia: typeof window.matchMedia | null = null;

function stubbedMatchMedia(query: string): MediaQueryList {
  const list: MediaQueryList = {
    matches: query === "(prefers-reduced-motion: reduce)",
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  };
  return list;
}

function installReducedMotionStub(): void {
  if (savedMatchMedia !== null) return;
  savedMatchMedia = window.matchMedia.bind(window);
  Reflect.set(window, "matchMedia", stubbedMatchMedia);
}

function restoreReducedMotionStub(): void {
  if (savedMatchMedia === null) return;
  Reflect.set(window, "matchMedia", savedMatchMedia);
  savedMatchMedia = null;
}

/** Anonymous-visitor auth context — mirrors the real logged-out landing page. */
const ANONYMOUS_AUTH: AuthContextType = {
  user: null,
  isAuthenticated: false,
  isLoading: false,
  error: null,
  login: () => Promise.resolve(false),
  logout: () => undefined,
};

/** Harness: anonymous AuthContext + empty-mock Apollo client around the page. */
function LandingHarness(): ReactNode {
  installHealthProbeStub();
  installReducedMotionStub();
  useEffect(
    () => () => {
      restoreHealthProbeStub();
      restoreReducedMotionStub();
    },
    []
  );
  return (
    <AuthContext.Provider value={ANONYMOUS_AUTH}>
      <StoryApolloProvider mocks={[]}>
        <LandingPage />
      </StoryApolloProvider>
    </AuthContext.Provider>
  );
}

const meta = {
  title: "Pages/Landing",
  component: LandingHarness,
  parameters: {
    layout: "fullscreen",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof LandingHarness>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The full landing page exactly as anonymous visitors see it at `/`. */
export const Default: Story = {};
