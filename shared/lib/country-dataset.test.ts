/**
 * Country dataset label resolution tests (colocated, bun:test).
 *
 * LOCKS the single-resolution-point contract of `countryDatasetLabel`:
 *  - a dataset code resolves to the LIVE-locale label from `COUNTRIES`
 *    (the client-side resolution that survives the Apollo cache across a
 *    LocaleSwitcher toggle — the stale-مصر-after-EN-toggle regression class);
 *  - the two locales resolve DIFFERENT labels for the same code (the lookup
 *    is locale-keyed, not a passthrough);
 *  - an out-of-vocabulary code degrades to the caller's fallback (the
 *    server-composed label) — never empty, never dropped;
 *  - the lookup is EXACT (case-sensitive) — matching the facet's pinned
 *    behavior; wire codes arrive from the dataset-vocabulary-filtered
 *    mapper, so they are already canonical uppercase.
 *
 * RUNS VIA (in-sandbox): bun run test/scripts/run-test.ts
 * shared/lib/country-dataset.test.ts — pure unit tier, no server boot, no DB.
 */

import { describe, expect, test } from "bun:test";
import { countryDatasetLabel } from "@/shared/lib/country-dataset";

describe("countryDatasetLabel — dataset-vocabulary codes", () => {
  test("resolves the EN label for a dataset code under the live EN locale", () => {
    expect(countryDatasetLabel("EG", "whatever", "en")).toBe("Egypt");
    expect(countryDatasetLabel("US", "whatever", "en")).toBe("United States");
  });

  test("resolves the AR label for the same code under the live AR locale (locale-keyed lookup)", () => {
    expect(countryDatasetLabel("EG", "whatever", "ar")).toBe("مصر");
    expect(countryDatasetLabel("US", "whatever", "ar")).not.toBe(countryDatasetLabel("US", "whatever", "en"));
  });

  test("resolves non-ASCII dataset names exactly (Curaçao / Türkiye class)", () => {
    expect(countryDatasetLabel("CW", "server fallback", "en")).toBe("Curaçao");
    expect(countryDatasetLabel("TR", "server fallback", "en")).toBe("Türkiye");
  });
});

describe("countryDatasetLabel — out-of-vocabulary codes", () => {
  test("degrades to the caller's fallback label (never empty, never dropped)", () => {
    expect(countryDatasetLabel("ZZ", "Legacy label", "en")).toBe("Legacy label");
    expect(countryDatasetLabel("ZZ", "تاريخي", "ar")).toBe("تاريخي");
  });

  test("is EXACT (case-sensitive): a lowercase code is out of vocabulary", () => {
    expect(countryDatasetLabel("eg", "server fallback", "en")).toBe("server fallback");
  });

  test("handles the empty code gracefully (fallback, no crash)", () => {
    expect(countryDatasetLabel("", "server fallback", "en")).toBe("server fallback");
  });
});
