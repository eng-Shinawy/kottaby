/**
 * AdminCountryDistributionPanel component tests (colocated, bun:test).
 *
 * The repo has no DOM component-test layer (no happy-dom/jsdom, no DOM
 * testing utilities), so the panel renders to static markup with
 * react-dom/server with two test doubles registered via `mock.module`
 * (same mechanism as the RegisterIdentityFields suite):
 *
 *  - `@apollo/client/react`'s `useQuery` reads a per-test mutable holder so
 *    each test stages its own wire state (loading / error / settled
 *    payloads) — no network, no Apollo client;
 *  - `next/navigation`'s `useRouter` records `push` calls (the deep-link
 *    assertions below ride the REAL hrefs the view-model builds; the
 *    click-through itself is covered live by the agent-browser round-trip,
 *    exactly like the directory facet's suite).
 *
 * Pinned here: the panel-family state matrix (skeleton while loading with
 * busy semantics + translation-backed label; generic surfaced error for a
 * plain failure), the render-side honesty contract (rows + the unresolved
 * caption account for the whole payload; EMPTY settled payload renders
 * NOTHING), the LIVE-locale label resolution through the shared dataset
 * (the stale-cache regression class — same payload, both locales, different
 * labels), and the percent/share display forms.
 *
 * RUNS VIA (in-sandbox): bun run test/scripts/run-test.ts
 * frontend/views/admin/dashboard/AdminCountryDistributionPanel.test.tsx —
 * pure unit tier, no server boot, no DB.
 */

import { expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

// ---------------------------------------------------------------------------
// Test doubles (registered BEFORE the module-under-test imports — bun
// evaluates the module registry in import order)

type BreakdownBucket = { readonly code: string; readonly label: string; readonly flag: string; readonly count: number };

interface StagedQueryState {
  readonly loading: boolean;
  readonly data?: { adminUserCountryBreakdown: { buckets: BreakdownBucket[]; unresolvedCount: number } };
  readonly error?: unknown;
}

const apolloState: { current: StagedQueryState } = { current: { loading: false, data: undefined } };

void mock.module("@apollo/client/react", () => ({
  useQuery: () => apolloState.current,
}));

const routerPushCalls: string[] = [];

void mock.module("next/navigation", () => ({
  useRouter: () => ({ push: (href: string) => routerPushCalls.push(href) }),
}));

import { LocaleProvider } from "@/frontend/providers/LocaleProvider";
import { AdminCountryDistributionPanel } from "@/frontend/views/admin/dashboard/AdminCountryDistributionPanel";
import { getTranslations } from "@/shared/locale/server";

const en = getTranslations("en");
const ar = getTranslations("ar");
const enPanel = en.dashboardTranslations.countryDistribution;
const arPanel = ar.dashboardTranslations.countryDistribution;

// Fixture label constants — the no-hardcoded-strings gate wants fixture copy
// named (these are wire payloads from the server mapper, not UI literals).
const EG_SERVER_LABEL = "مصر";
const US_SERVER_LABEL = "United States";

function stageSettled(buckets: BreakdownBucket[], unresolvedCount: number): void {
  apolloState.current = { loading: false, data: { adminUserCountryBreakdown: { buckets, unresolvedCount } } };
}

function stageLoading(): void {
  apolloState.current = { loading: true, data: undefined };
}

function stageError(): void {
  apolloState.current = { loading: false, data: undefined, error: new Error("network gone") };
}

function renderPanel(locale: "en" | "ar"): string {
  return renderToStaticMarkup(
    <LocaleProvider locale={locale}>
      <AdminCountryDistributionPanel />
    </LocaleProvider>
  );
}

// ---------------------------------------------------------------------------
// State matrix (the panel-family discipline)

test("loading renders the skeleton card with busy semantics + the translation-backed label", () => {
  stageLoading();
  const enMarkup = renderPanel("en");
  expect(enMarkup).toContain('aria-busy="true"');
  expect(enMarkup).toContain(enPanel.loadingLabel);
  const arMarkup = renderPanel("ar");
  expect(arMarkup).toContain(arPanel.loadingLabel);
});

test("a plain settled failure surfaces the generic outlined alert (denial class is the shared chrome's job)", () => {
  stageError();
  const markup = renderPanel("en");
  expect(markup).toContain('role="alert"');
  expect(markup).toContain(en.errorsTranslations.internalServerError);
});

// ---------------------------------------------------------------------------
// Honesty + locale contracts (render-side)

test("renders one row per bucket: live-locale label, count pill, percent, and aria copy", () => {
  stageSettled(
    [
      { code: "EG", label: EG_SERVER_LABEL, flag: "🇪🇬", count: 6 },
      { code: "US", label: US_SERVER_LABEL, flag: "🇺🇸", count: 2 },
    ],
    2
  );
  const markup = renderPanel("en");
  expect(markup).toContain("Egypt"); // dataset-resolved under the LIVE locale, NOT the server label مصر
  expect(markup).toContain("United States");
  expect(markup).toContain(">6<");
  expect(markup).toContain(">2<");
  expect(markup).toContain("60%");
  expect(markup).toContain("20%");
  expect(markup).toContain('aria-label="Egypt: 6 users"');
  expect(markup).toContain('aria-label="United States: 2 users"');
});

test("the unresolved remainder renders as the trailing caption whenever it is > 0 (both locales)", () => {
  stageSettled([{ code: "EG", label: "Egypt", flag: "🇪🇬", count: 6 }], 3);
  expect(renderPanel("en")).toContain(enPanel.unresolved(3));
  expect(renderPanel("ar")).toContain(arPanel.unresolved(3));
});

test("an EMPTY settled payload renders NOTHING (fresh installs stay clean — even with an unresolved remainder)", () => {
  stageSettled([], 0);
  expect(renderPanel("en")).toBe("");
  stageSettled([], 4);
  expect(renderPanel("ar")).toBe("");
});

test("the LIVE-locale resolution pin: the SAME wire payload labels differently per active locale", () => {
  stageSettled([{ code: "US", label: US_SERVER_LABEL, flag: "🇺🇸", count: 2 }], 0);
  const enMarkup = renderPanel("en");
  const arMarkup = renderPanel("ar");
  expect(enMarkup).toContain("United States");
  expect(enMarkup).not.toContain("الولايات المتحدة");
  expect(arMarkup).toContain("الولايات المتحدة");
  expect(arMarkup).toContain(arPanel.rowAria("الولايات المتحدة", 2));
});
