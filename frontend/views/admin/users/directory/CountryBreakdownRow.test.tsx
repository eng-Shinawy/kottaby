/**
 * CountryBreakdownRow component tests (colocated, bun:test).
 *
 * The repo has no DOM component-test layer (no happy-dom/jsdom, no DOM
 * testing utilities), so the facet renders to static markup with
 * react-dom/server — the REAL component (no MUI doubles needed: the chip
 * row is plain render output, and sx theme-callbacks are inert under
 * static rendering exactly as in the CountrySelector suite).
 *
 * The click-through contract is covered at the integration level (the
 * admin country-filter E2E suite drives the SAME `setCountryFilter`
 * setter through the URL round-trip); these tests pin the RENDER-side
 * contract: translation-backed chrome in both locales, the flag + label +
 * count chip anatomy, the aria-pressed selected state (case-insensitive
 * against the wire code), the honest unresolved caption, and the
 * render-nothing-while-empty discipline.
 *
 * RUNS VIA (in-sandbox): bun run test/scripts/run-test.ts
 * frontend/views/admin/users/directory/CountryBreakdownRow.test.tsx —
 * pure unit tier, no server boot, no DB.
 */

import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { AdminUserCountryBreakdownQuery_adminUserCountryBreakdown_buckets as CountryBucket } from "@/frontend/graphql/generated/gql/graphql";
import { LocaleProvider } from "@/frontend/providers/LocaleProvider";
import { CountryBreakdownRow } from "@/frontend/views/admin/users/directory/CountryBreakdownRow";
import { getTranslations } from "@/shared/locale/server";

// ---------------------------------------------------------------------------
// Translation-backed expectations (never hardcoded copy)

const en = getTranslations("en");
const ar = getTranslations("ar");

const enFacet = en.adminUsersTranslations.countryBreakdown;
const arFacet = ar.adminUsersTranslations.countryBreakdown;

// ---------------------------------------------------------------------------
// Helpers

function makeBucket(code: string, label: string, flag: string, count: number): CountryBucket {
  return { code, label, flag, count };
}

interface RenderProps {
  readonly buckets: readonly CountryBucket[];
  readonly unresolvedCount?: number;
  readonly activeCountry?: string;
}

function renderFacet(locale: "en" | "ar", props: RenderProps): string {
  const labels = locale === "en" ? en : ar;
  return renderToStaticMarkup(
    <LocaleProvider locale={locale}>
      <CountryBreakdownRow
        labels={labels.adminUsersTranslations}
        buckets={props.buckets}
        unresolvedCount={props.unresolvedCount ?? 0}
        activeCountry={props.activeCountry ?? ""}
        onSelect={() => {}}
      />
    </LocaleProvider>
  );
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

// ---------------------------------------------------------------------------
// Render discipline

test("renders NOTHING while the aggregate is empty (fresh directories stay clean)", () => {
  expect(renderFacet("en", { buckets: [] })).toBe("");
  expect(renderFacet("ar", { buckets: [], unresolvedCount: 4 })).toBe("");
});

test("renders the overline title as a section heading (translation-backed, both locales)", () => {
  const enMarkup = renderFacet("en", { buckets: [makeBucket("EG", "Egypt", "🇪🇬", 5)] });
  expect(enMarkup).toContain(enFacet.title);
  const arMarkup = renderFacet("ar", { buckets: [makeBucket("EG", "مصر", "🇪🇬", 5)] });
  expect(arMarkup).toContain(arFacet.title);
});

// ---------------------------------------------------------------------------
// Chip anatomy + accessibility

test("renders one chip per bucket with the flag, the locale label, and the count", () => {
  const markup = renderFacet("en", {
    buckets: [makeBucket("EG", "Egypt", "🇪🇬", 12), makeBucket("US", "United States", "🇺🇸", 4)],
  });
  expect(countOccurrences(markup, "🇪🇬")).toBe(1);
  expect(countOccurrences(markup, "🇺🇸")).toBe(1);
  expect(markup).toContain("Egypt");
  expect(markup).toContain("United States");
  expect(markup).toContain(">12<");
  expect(markup).toContain(">4<");
});

test("chip accessible names come from the facet labels ({label} interpolated), not the visible label alone", () => {
  const markup = renderFacet("en", { buckets: [makeBucket("EG", "Egypt", "🇪🇬", 12)] });
  expect(markup).toContain(enFacet.chipAriaLabel.replace("{label}", "Egypt"));
  const arMarkup = renderFacet("ar", { buckets: [makeBucket("EG", "مصر", "🇪🇬", 12)] });
  expect(arMarkup).toContain(arFacet.chipAriaLabel.replace("{label}", "مصر"));
});

test("the chip matching the active country is aria-pressed (case-insensitive against the wire code)", () => {
  const markup = renderFacet("en", {
    buckets: [makeBucket("EG", "Egypt", "🇪🇬", 12), makeBucket("US", "United States", "🇺🇸", 4)],
    activeCountry: "eg", // the URL may carry any case; the match normalizes
  });
  expect(countOccurrences(markup, 'aria-pressed="true"')).toBe(1);
  expect(countOccurrences(markup, 'aria-pressed="false"')).toBe(1);
});

// ---------------------------------------------------------------------------
// The honest unresolved remainder

test("the unresolved caption renders ONLY when the remainder is above zero", () => {
  const withRemainder = renderFacet("en", {
    buckets: [makeBucket("EG", "Egypt", "🇪🇬", 5)],
    unresolvedCount: 3,
  });
  expect(withRemainder).toContain(enFacet.unresolved.replace("{count}", "3"));
  const withoutRemainder = renderFacet("en", {
    buckets: [makeBucket("EG", "Egypt", "🇪🇬", 5)],
    unresolvedCount: 0,
  });
  expect(withoutRemainder).not.toContain(enFacet.unresolved.replace("{count}", "0"));
});

test("the AR unresolved caption carries Arabic script and the interpolated count", () => {
  const markup = renderFacet("ar", {
    buckets: [makeBucket("EG", "مصر", "🇪🇬", 5)],
    unresolvedCount: 7,
  });
  const caption = arFacet.unresolved.replace("{count}", "7");
  expect(markup).toContain(caption);
  expect(caption).toMatch(/[\u0600-\u06FF]/);
});

// ---------------------------------------------------------------------------
// Honesty pins (static contract, mirror of the backend pins)

test("buckets render in the ARRIVAL order — the component re-sorts nothing", () => {
  const markup = renderFacet("en", {
    buckets: [makeBucket("US", "United States", "🇺🇸", 1), makeBucket("EG", "Egypt", "🇪🇬", 9)],
  });
  expect(markup.indexOf("United States")).toBeLessThan(markup.indexOf("Egypt"));
});

test("the facet is a labelled section, not an unlabeled div (a11y landmark)", () => {
  const markup = renderFacet("en", { buckets: [makeBucket("EG", "Egypt", "🇪🇬", 5)] });
  expect(markup).toContain("<section");
  expect(markup).toContain(`aria-label="${enFacet.title}"`);
});

// ---------------------------------------------------------------------------
// Locale contract (the live-locale label resolution)

test("the LIVE locale resolves the chip label — a stale AR-cached server label renders as EN under the en locale", () => {
  // Simulates the Apollo-cache staleness after a locale toggle: the cached
  // bucket still carries the AR server label, but the live locale is en.
  const markup = renderFacet("en", { buckets: [makeBucket("EG", "مصر", "🇪🇬", 5)] });
  expect(markup).toContain("Egypt");
  expect(markup).not.toContain("مصر");
});

test("the mirrored case: an EN-cached server label renders as AR under the ar locale", () => {
  const markup = renderFacet("ar", { buckets: [makeBucket("EG", "Egypt", "🇪🇬", 5)] });
  expect(markup).toContain("مصر");
  expect(markup).not.toContain(">Egypt<");
});

test("an out-of-vocabulary code falls back to the server-composed label (never blank)", () => {
  const markup = renderFacet("en", { buckets: [makeBucket("ZZ", "Legacy Text", "🏳️", 2)] });
  expect(markup).toContain("Legacy Text");
});
