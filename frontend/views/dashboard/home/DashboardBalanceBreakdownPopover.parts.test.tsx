/**
 * DashboardBalanceBreakdownSurface component tests (colocated, bun:test).
 *
 * The repo has no DOM component-test layer (no happy-dom/jsdom, no DOM
 * testing utilities), so the surface renders to static markup with
 * react-dom/server — the REAL component, no doubles: the surface is pure
 * presentational (no hooks, no portal — the MUI Popover chrome that hosts
 * it is not renderable server-side, so the anchor/dismissal contract is
 * covered by the live QA round-trip exactly like the other popover in the
 * repo, the notification drawer).
 *
 * Pinned here: the resolved arm (FOUR outlined lane chips in display
 * order — trial first — each composed as "<localized label> <count>" and
 * carrying its `dashboard-balance-chip-<lane>` testid, under the
 * `dashboard-balance-breakdown` surface testid and the title id the
 * wrapper's `aria-labelledby` points at), the loading arm (four skeleton
 * chips with the SAME testids, no labels), the failed arm (the chips
 * replaced by the dashboard namespace's muted `statUnavailable` marker),
 * the honest-scope note rendering in EVERY state, and the LIVE-locale
 * label resolution (the stale-cache regression class — same payload,
 * both locales, different labels).
 *
 * RUNS VIA (in-sandbox): bun run test/scripts/run-test.ts
 * frontend/views/dashboard/home/DashboardBalanceBreakdownPopover.parts.test.tsx —
 * pure unit tier, no server boot, no DB.
 */

import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DashboardBalanceBreakdownSurface } from "@/frontend/views/dashboard/home/DashboardBalanceBreakdownPopover.parts";
import type { SessionCreditLanes } from "@/frontend/views/dashboard/home/useDashboardStats.helpers";
import { getTranslations } from "@/shared/locale/server";

const en = getTranslations("en");
const ar = getTranslations("ar");

const enLabels = en.dashboardTranslations;
const arLabels = ar.dashboardTranslations;

/** The wrapper pins the title element id — one stable value for the labelledby contract. */
const TITLE_ID = "balance-breakdown-title";

/** Fixture lane payload — technical test data (the DEMO database's shape: a nonzero hifz lane, zeroed rest). */
const RESOLVED_LANES: SessionCreditLanes = { trial: 1, hifz: 3, tajweed: 0, reviews: 0 };

function renderSurface(locale: "en" | "ar", lanes: SessionCreditLanes | null | undefined): string {
  return renderToStaticMarkup(
    <DashboardBalanceBreakdownSurface lanes={lanes} labels={locale === "en" ? enLabels : arLabels} titleId={TITLE_ID} />
  );
}

// ---------------------------------------------------------------------------
// Resolved arm

test("resolved lanes render the four outlined chips in display order under the surface testid + title id", () => {
  const markup = renderSurface("en", RESOLVED_LANES);
  expect(markup).toContain('data-testid="dashboard-balance-breakdown"');
  expect(markup).toContain(`id="${TITLE_ID}"`);
  expect(markup).toContain(enLabels.balanceBreakdownTitle);
  // Trial first, then the purchased lanes; each chip composes "<label> <count>".
  expect(markup.indexOf(`${enLabels.balanceLaneTrial} 1`)).toBeGreaterThan(-1);
  expect(markup).toContain(`${enLabels.balanceLaneHifz} 3`);
  expect(markup).toContain(`${enLabels.balanceLaneTajweed} 0`);
  expect(markup).toContain(`${enLabels.balanceLaneReviews} 0`);
  expect(markup.indexOf("dashboard-balance-chip-trial")).toBeLessThan(markup.indexOf("dashboard-balance-chip-hifz"));
  // A resolved zero lane is an honest 0 chip, never the unavailable marker.
  expect(markup).not.toContain(enLabels.statUnavailable);
});

test("the LIVE-locale pin: the SAME wire payload labels differently per active locale", () => {
  const enMarkup = renderSurface("en", RESOLVED_LANES);
  const arMarkup = renderSurface("ar", RESOLVED_LANES);
  expect(enMarkup).toContain(`${enLabels.balanceLaneTrial} 1`);
  expect(arMarkup).toContain(`${arLabels.balanceLaneTrial} 1`);
  expect(enMarkup).not.toContain(arLabels.balanceLaneTrial);
  expect(arMarkup).toContain(arLabels.balanceBreakdownTitle);
});

// ---------------------------------------------------------------------------
// Degraded arms (the honest-scope note persists in EVERY state)

test("loading renders four skeleton chips carrying the lane testids and NO labels", () => {
  const markup = renderSurface("en", undefined);
  for (const lane of ["trial", "hifz", "tajweed", "reviews"] as const) {
    expect(markup).toContain(`data-testid="dashboard-balance-chip-${lane}"`);
  }
  expect(markup).not.toContain(enLabels.balanceLaneTrial);
  expect(markup).not.toContain(enLabels.balanceLaneHifz);
  expect(markup).toContain(enLabels.balanceBreakdownNote);
});

test("a failed balance read replaces the chips with the muted unavailable marker (note still honest)", () => {
  const enMarkup = renderSurface("en", null);
  expect(enMarkup).toContain(enLabels.statUnavailable);
  expect(enMarkup).not.toContain('data-testid="dashboard-balance-chip-trial"');
  expect(enMarkup).toContain(enLabels.balanceBreakdownNote);
  const arMarkup = renderSurface("ar", null);
  expect(arMarkup).toContain(arLabels.statUnavailable);
  expect(arMarkup).toContain(arLabels.balanceBreakdownNote);
});
