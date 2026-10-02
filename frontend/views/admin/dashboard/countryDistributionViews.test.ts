/**
 * countryDistributionViews tests (colocated, bun:test) — the view-model
 * math of the admin dashboard's country distribution panel.
 *
 * LOCKS:
 *  - the HONEST denominator: shares are computed over the WHOLE accounted
 *    active population (Σ buckets + unresolved remainder), so bars + the
 *    unresolved caption always describe 100% of what the server saw;
 *  - the display form: `percent` is the ROUNDED whole-number form of the
 *    share (the bar width drives off the unrounded `share`);
 *  - ORDER PRESERVATION: the builder re-sorts NOTHING — the server's
 *    count-desc/code-asc order is the rendered order (SQL owns determinism);
 *  - the deep-link contract: every row href rides the directory's guarded
 *    `?country=` URL with the code URI-encoded (defense-in-depth — the
 *    server mapper only emits dataset-vocabulary codes, the encoding pins
 *    the contract anyway);
 *  - label + aria copy arrive from the INJECTED resolver (locale-agnostic
 *    module — the LIVE-locale resolution lives in the panel).
 *
 * RUNS VIA (in-sandbox): bun run test/scripts/run-test.ts
 * frontend/views/admin/dashboard/countryDistributionViews.test.ts —
 * pure unit tier, no server boot, no DB.
 */

import { describe, expect, test } from "bun:test";
import { buildCountryRowViews } from "@/frontend/views/admin/dashboard/countryDistributionViews";

const labelOf = (bucket: { readonly code: string; readonly label: string }) => `L:${bucket.code}:${bucket.label}`;
const rowAria = (label: string, count: number) => `${label} has ${count}`;

// Fixture label constants — the no-hardcoded-strings gate wants fixture copy
// named (these are wire payloads from the server mapper, not UI literals).
const EG_LABEL = "Egypt";
const US_LABEL = "United States";
const SA_LABEL = "Saudi Arabia";

function build(
  buckets: ReadonlyArray<{ code: string; label: string; flag: string; count: number }>,
  unresolvedCount = 0
) {
  return buildCountryRowViews({ buckets, unresolvedCount, labelOf, rowAria });
}

describe("buildCountryRowViews — share math (the honesty contract)", () => {
  test("single bucket with zero unresolved = 100% share", () => {
    const views = build([{ code: "EG", label: EG_LABEL, flag: "🇪🇬", count: 4 }]);
    expect(views).toHaveLength(1);
    expect(views[0].share).toBe(1);
    expect(views[0].percent).toBe(100);
  });

  test("shares are computed over Σ buckets + the UNRESOLVED remainder", () => {
    // 6 EG + 2 US + 2 unresolved = 10 accounted → EG 60%, US 20% (the remainder is the missing 20%).
    const views = build(
      [
        { code: "EG", label: EG_LABEL, flag: "🇪🇬", count: 6 },
        { code: "US", label: US_LABEL, flag: "🇺🇸", count: 2 },
      ],
      2
    );
    expect(views[0].share).toBeCloseTo(0.6, 10);
    expect(views[1].share).toBeCloseTo(0.2, 10);
    expect(views[0].percent).toBe(60);
    expect(views[1].percent).toBe(20);
  });

  test("percent ROUNDS (the bar drives off the unrounded share)", () => {
    // 1 of 3 → 0.3333… → displays 33 while the bar width is the exact third.
    const views = build([{ code: "EG", label: EG_LABEL, flag: "🇪🇬", count: 1 }], 2);
    expect(views[0].share).toBeCloseTo(1 / 3, 10);
    expect(views[0].percent).toBe(33);
  });

  test("degenerate all-empty payload degrades to zero shares (never NaN)", () => {
    const views = build([], 0);
    expect(views).toHaveLength(0);
    const sole = build([{ code: "EG", label: EG_LABEL, flag: "🇪🇬", count: 0 }], 0);
    expect(sole[0].share).toBe(0);
    expect(sole[0].percent).toBe(0);
  });
});

describe("buildCountryRowViews — order, links, and copy", () => {
  test("PRESERVES the server's bucket order (SQL owns determinism)", () => {
    const views = build([
      { code: "SA", label: SA_LABEL, flag: "🇸🇦", count: 9 },
      { code: "EG", label: EG_LABEL, flag: "🇪🇬", count: 4 },
      { code: "US", label: US_LABEL, flag: "🇺🇸", count: 1 },
    ]);
    expect(views.map(view => view.code)).toEqual(["SA", "EG", "US"]);
  });

  test("every row deep-links the directory's guarded ?country= contract, URI-encoded", () => {
    const views = build([{ code: "EG", label: EG_LABEL, flag: "🇪🇬", count: 4 }]);
    expect(views[0].href).toBe("/admin/users?country=EG");
    // Defense-in-depth: even a hypothetical non-canonical code arrives encoded.
    const odd = build([{ code: "X/Y", label: "Odd", flag: "🏳️", count: 1 }]);
    expect(odd[0].href).toBe("/admin/users?country=X%2FY");
  });

  test("labels + aria copy come from the injected resolvers (locale-agnostic module)", () => {
    const views = build([{ code: "EG", label: EG_LABEL, flag: "🇪🇬", count: 4 }]);
    expect(views[0].label).toBe("L:EG:Egypt");
    expect(views[0].ariaLabel).toBe("L:EG:Egypt has 4");
  });

  test("identity fields pass through untouched (flag + count)", () => {
    const views = build([{ code: "US", label: US_LABEL, flag: "🇺🇸", count: 2 }]);
    expect(views[0].flag).toBe("🇺🇸");
    expect(views[0].count).toBe(2);
  });
});
