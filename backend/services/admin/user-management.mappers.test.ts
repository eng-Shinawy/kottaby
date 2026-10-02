/**
 * Admin user-management mappers tests — the country-breakdown projection
 * seam (`buildCountryBreakdown`): dataset-vocabulary filtering, locale
 * label + flag resolution, the top-N window, and the honest unresolved
 * remainder.
 *
 * Pure unit tier — NO DB, NO server boot, NO disk writes. Every case maps
 * hand-built raw aggregate rows through the mapper and pins the closed
 * output shape. Runs via the mandated runner:
 *   bun run test/scripts/run-test.ts backend/services/admin/user-management.mappers.test.ts
 *
 * Honesty pins: out-of-vocabulary codes NEVER surface as chips (they have
 * no locale label or flag to render) and NEVER consume a top-N slot; the
 * unresolved remainder carries the NULL-code + out-of-vocabulary
 * population instead of silently dropping it; the mapper re-sorts NOTHING
 * (the SQL owns count-desc/code-asc determinism — a mapper-level sort
 * would let a two-layer disagreement pass unnoticed); the remainder is
 * never negative even against a hostile raw row.
 */

import { describe, expect, test } from "bun:test";
import type { AdminUserCountryBreakdownRow } from "@/backend/db/repo/admin/admin-user-row-types";
import { buildCountryBreakdown } from "@/backend/services/admin/user-management.mappers";
import { COUNTRIES } from "@/shared/constants/countries";
import { defaultLocale } from "@/shared/locale/AppLocale";

/** Builds a raw breakdown envelope from terse per-case tuples. */
function makeRow(
  buckets: readonly (readonly [code: string, count: number])[],
  activeTotal: number
): AdminUserCountryBreakdownRow {
  return {
    buckets: buckets.map(([code, count]) => ({ code, count })),
    activeTotal,
  };
}

describe("buildCountryBreakdown — dataset vocabulary", () => {
  test("resolves EN labels + flags from the shared dataset", () => {
    const result = buildCountryBreakdown(
      makeRow(
        [
          ["EG", 12],
          ["US", 4],
        ],
        16
      ),
      "en",
      6
    );
    expect(result.buckets).toHaveLength(2);
    expect(result.buckets[0]).toEqual({ code: "EG", label: COUNTRIES.EG.en, flag: COUNTRIES.EG.flag, count: 12 });
    expect(result.buckets[1]).toEqual({ code: "US", label: COUNTRIES.US.en, flag: COUNTRIES.US.flag, count: 4 });
  });

  test("resolves AR labels under the ar locale (Arabic-script dataset names)", () => {
    const result = buildCountryBreakdown(makeRow([["EG", 3]], 3), "ar", 6);
    expect(result.buckets[0]?.label).toBe(COUNTRIES.EG.ar);
    expect(result.buckets[0]?.label).toMatch(/[\u0600-\u06FF]/);
    expect(result.buckets[0]?.flag).toBe(COUNTRIES.EG.flag);
  });

  test("an unknown locale string falls back to the default locale labels (never undefined)", () => {
    const result = buildCountryBreakdown(makeRow([["EG", 2]], 2), "fr", 6);
    expect(result.buckets[0]?.label).toBe(COUNTRIES.EG[defaultLocale]);
  });
});

describe("buildCountryBreakdown — the honest unresolved remainder", () => {
  test("NULL-code users (denominator above the bucket sum) fold into unresolvedCount", () => {
    // 10 active users, only 7 stamped a resolvable code → 3 unresolved.
    const result = buildCountryBreakdown(
      makeRow(
        [
          ["EG", 5],
          ["US", 2],
        ],
        10
      ),
      "en",
      6
    );
    expect(result.unresolvedCount).toBe(3);
  });

  test("out-of-vocabulary codes NEVER surface as buckets and count as unresolved", () => {
    // "ZZ" is syntactically code-shaped but outside the dataset; the raw
    // SQL would return it, the mapper must drop it from the chips.
    const result = buildCountryBreakdown(
      makeRow(
        [
          ["EG", 4],
          ["ZZ", 2],
        ],
        9
      ),
      "en",
      6
    );
    expect(result.buckets.map(bucket => bucket.code)).toEqual(["EG"]);
    expect(result.unresolvedCount).toBe(5);
  });

  test("a fully-resolved population reports zero unresolved", () => {
    const result = buildCountryBreakdown(
      makeRow(
        [
          ["EG", 7],
          ["SA", 3],
        ],
        10
      ),
      "en",
      6
    );
    expect(result.unresolvedCount).toBe(0);
  });

  test("the remainder is NEVER negative against a hostile raw row", () => {
    // Bucket sum above the denominator is impossible at the SQL layer;
    // the mapper degrades to zero rather than a negative count.
    const result = buildCountryBreakdown(makeRow([["EG", 100]], 5), "en", 6);
    expect(result.unresolvedCount).toBe(0);
  });

  test("an empty directory maps to the closed empty shape", () => {
    const result = buildCountryBreakdown(makeRow([], 0), "en", 6);
    expect(result.buckets).toEqual([]);
    expect(result.unresolvedCount).toBe(0);
  });
});

describe("buildCountryBreakdown — the top-N window", () => {
  test("caps buckets to the limit while unresolved math reads the FULL vocabulary", () => {
    // 12 resolvable codes, limit 6 → 6 chips; unresolved still accounts
    // for ALL resolved users (denominator − full resolvable sum), not
    // just the shown window's sum.
    const buckets: readonly (readonly [string, number])[] = Array.from(
      { length: 12 },
      (_, index) =>
        [["EG", "US", "SA", "AE", "JO", "KW", "QA", "OM", "BH", "MA", "DZ", "TN"][index], 12 - index] as const
    );
    const result = buildCountryBreakdown(makeRow(buckets, 78), "en", 6);
    expect(result.buckets).toHaveLength(6);
    expect(result.buckets[0]?.code).toBe("EG");
    // All 78 active users resolve across the 12 codes — zero remainder.
    expect(result.unresolvedCount).toBe(0);
  });

  test("an unresolvable row never consumes a top-N slot", () => {
    // ZZ sorts FIRST by count in the raw SQL; the mapper must skip it so
    // the window's last slot reaches the next resolvable code.
    const result = buildCountryBreakdown(
      makeRow(
        [
          ["ZZ", 9],
          ["EG", 5],
          ["US", 4],
          ["SA", 3],
          ["AE", 2],
          ["JO", 1],
          ["KW", 1],
        ],
        30
      ),
      "en",
      6
    );
    expect(result.buckets.map(bucket => bucket.code)).toEqual(["EG", "US", "SA", "AE", "JO", "KW"]);
  });
});

describe("buildCountryBreakdown — determinism", () => {
  test("preserves the SQL ordering verbatim (count-desc/code-asc) — the mapper re-sorts nothing", () => {
    // Deliberately NOT sorted by count: the mapper must carry the raw
    // order through untouched (the SQL's ORDER BY owns determinism).
    const result = buildCountryBreakdown(
      makeRow(
        [
          ["US", 1],
          ["EG", 1],
          ["SA", 1],
        ],
        3
      ),
      "en",
      6
    );
    expect(result.buckets.map(bucket => bucket.code)).toEqual(["US", "EG", "SA"]);
  });
});
