/**
 * `/admin/plans` page — GUARD-BEHAVIOR suite (injected-fake tier, DEV1-005
 * 4.2.TE / REQ-062 / REQ-064).
 *
 * Harness choice (mirrors `app/api/graphql/test/graphql-route.pipeline-order.test.ts`
 * — the repo's established app-layer page-unit pattern): Bun's module mock
 * registry swaps the SSR auth source and the redirect primitive BEFORE the
 * page module loads, then the page is imported dynamically (ordering is
 * load-bearing — the mock registry swap persists for the process lifetime,
 * so static imports are limited to bun-test-safe modules).
 *
 * Swapped modules (specifiers mirror the production imports verbatim):
 *  - `@/backend/lib/auth/server-auth` → `getServerUserContext` returns a
 *    mutable fixture context (the REAL one would need `next/headers`
 *    cookies + DB); a call counter doubles as the registry-shadow canary;
 *  - `next/navigation` → `redirect` throws a `RedirectSignal` carrying the
 *    target URL (mirrors Next's own control-flow-by-throw semantics —
 *    `withPageAuth` never returns after redirecting);
 *  - `@/shared/locale/server-cookies` → `getLocaleFromCookie` returns the
 *    app's `defaultLocale` (no request scope in a unit process; pinned to
 *    the DEFAULT — not a specific locale — so the expected copy below can
 *    come from `getDefaultTranslations()` without a locale-switch test).
 *
 * Proven cells (REQ-064 admin-only surface):
 *  - anonymous → bounced to `/login` with `?redirect=%2Fadmin%2Fplans`
 *    (return path preserved — asserted on the PARSED URL so the assertion
 *    is independent of `NEXT_PUBLIC_BASE_URL`);
 *  - student / parent / teacher → each bounced to THEIR role-specific
 *    dashboard via `roleDashboardPath` (never the bare `/dashboard`
 *    dispatcher — REDIRECT_LOOP_FIX rule);
 *  - admin → NO redirect, the shell renders via `renderToStaticMarkup`
 *    with copy taken from `plansTranslations` (no hardcoded UI strings —
 *    expected labels come from `getDefaultTranslations()`, the same
 *    server-side translation source the page reads);
 *  - metadata derives from the same namespace;
 *  - static import-hygiene: the page has ZERO GraphQL imports (4.2.3) and
 *    keeps the `withPageAuth` admin guard in place.
 *
 * Runs via `bun run test/scripts/run-test.ts "app/(dashboard)/admin/plans/test/admin-plans-page.guard.test.ts"`.
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { defaultLocale } from "@/shared/locale/AppLocale";
import { getDefaultTranslations } from "@/shared/locale/server";

// ─── Instrumented fakes (the spies) ─────────────────────────────────────────

/** Thrown by the mocked `redirect` — carries the exact target URL. */
class RedirectSignal extends Error {
  readonly url: string;
  constructor(url: string) {
    super(`NEXT_REDIRECT: ${url}`);
    this.name = "RedirectSignal";
    this.url = url;
  }
}

/** Minimal structural shape of `ServerUserContext` — role stays a raw string. */
interface FakeServerUserContext {
  readonly userId: number | null;
  readonly user: Record<string, unknown> | null;
  readonly role: string | null;
}

let contextConstructions = 0;
let ctxFixture: FakeServerUserContext = { userId: null, user: null, role: null };

const ANONYMOUS: FakeServerUserContext = { userId: null, user: null, role: null };
const ADMIN: FakeServerUserContext = {
  userId: 7,
  user: { id: 7, email: "admin-fixture@example.com", role: "admin" },
  role: "admin",
};
const STUDENT: FakeServerUserContext = {
  userId: 8,
  user: { id: 8, email: "student-fixture@example.com", role: "student" },
  role: "student",
};
const PARENT: FakeServerUserContext = {
  userId: 9,
  user: { id: 9, email: "parent-fixture@example.com", role: "parent" },
  role: "parent",
};
const TEACHER: FakeServerUserContext = {
  userId: 10,
  user: { id: 10, email: "teacher-fixture@example.com", role: "teacher" },
  role: "teacher",
};

// ─── Registry swap FIRST (before any import of the page) ────────────────────

void mock.module("@/backend/lib/auth/server-auth", () => ({
  getServerUserContext: async (): Promise<FakeServerUserContext> => {
    contextConstructions += 1;
    return ctxFixture;
  },
}));

void mock.module("next/navigation", () => ({
  redirect: (url: string): never => {
    throw new RedirectSignal(url);
  },
}));

void mock.module("@/shared/locale/server-cookies", () => ({
  getLocaleFromCookie: async (): Promise<string> => defaultLocale,
}));

const { default: AdminPlansPage, generateMetadata } = await import("../page");
const { renderToStaticMarkup } = await import("react-dom/server");

// Expected copy — from the SAME translation source the page reads (never
// hardcoded UI strings in assertions).
const T = getDefaultTranslations().plansTranslations;

/** Runs the page, capturing a thrown redirect instead of failing the cell. */
async function renderOrRedirect(): Promise<{ html: string | null; signal: RedirectSignal | null }> {
  try {
    const element = await AdminPlansPage();
    return { html: renderToStaticMarkup(element), signal: null };
  } catch (error) {
    if (error instanceof RedirectSignal) {
      return { html: null, signal: error };
    }
    throw error;
  }
}

beforeEach(() => {
  ctxFixture = ANONYMOUS;
  contextConstructions = 0;
});

// ─── Guard cells ─────────────────────────────────────────────────────────────

describe("/admin/plans withPageAuth guard — redirect behavior", () => {
  test("CANARY: the mocked auth factory actually shadows the page's import", async () => {
    // Registry-miss drift guard: if the swap ever stops shadowing, the REAL
    // getServerUserContext would run (cookies() outside request scope throws
    // → caught → anonymous) and every cell below would silently assert the
    // anonymous path. This fires first with a crisp count instead.
    ctxFixture = ADMIN;
    await renderOrRedirect();
    expect(contextConstructions).toBe(1);
  });

  test("anonymous → /login with the return path preserved (?redirect=%2Fadmin%2Fplans)", async () => {
    ctxFixture = ANONYMOUS;
    const { html, signal } = await renderOrRedirect();
    expect(html).toBeNull();
    expect(signal).not.toBeNull();
    const target = new URL(signal?.url ?? "");
    expect(target.pathname).toBe("/login");
    expect(target.searchParams.get("redirect")).toBe("/admin/plans");
  });

  test("student → bounced to /student/dashboard (never bare /dashboard)", async () => {
    ctxFixture = STUDENT;
    const { html, signal } = await renderOrRedirect();
    expect(html).toBeNull();
    expect(signal?.url).toBe("/student/dashboard");
  });

  test("parent → bounced to /parent/dashboard (never bare /dashboard)", async () => {
    ctxFixture = PARENT;
    const { html, signal } = await renderOrRedirect();
    expect(html).toBeNull();
    expect(signal?.url).toBe("/parent/dashboard");
  });

  test("teacher → bounced to /teacher/dashboard (never bare /dashboard)", async () => {
    ctxFixture = TEACHER;
    const { html, signal } = await renderOrRedirect();
    expect(html).toBeNull();
    expect(signal?.url).toBe("/teacher/dashboard");
  });
});

describe("/admin/plans admin render — shell + translations", () => {
  test("admin renders the shell with plansTranslations copy — no redirect", async () => {
    ctxFixture = ADMIN;
    const { html, signal } = await renderOrRedirect();
    expect(signal).toBeNull();
    expect(html).toContain(T.pageTitle);
    expect(html).toContain(T.pageSubtitle);
  });

  test("metadata derives from the plans namespace (title + description)", async () => {
    const metadata = await generateMetadata();
    expect(metadata.title).toBe(T.pageTitle);
    expect(metadata.description).toBe(T.pageSubtitle);
  });
});

// ─── Static import-hygiene (4.2.3) ──────────────────────────────────────────

describe("/admin/plans page source — import boundaries", () => {
  test("zero GraphQL imports + admin guard present (source scan)", async () => {
    const source = await Bun.file(new URL("../page.tsx", import.meta.url)).text();
    expect(source.includes("@/frontend/graphql")).toBeFalse();
    expect(source.includes("UserRole.Admin")).toBeTrue();
    expect(source.includes('"/admin/plans"')).toBeTrue();
    expect(source.includes("withPageAuth")).toBeTrue();
  });
});
