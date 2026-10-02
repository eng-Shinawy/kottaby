/**
 * countryDistributionViews — the row view-model of the admin dashboard's
 * country distribution panel, extracted from
 * `AdminCountryDistributionPanel` (file-size cap): the `CountryRowView`
 * presentation contract and `buildCountryRowViews` (wire buckets + the
 * honest unresolved remainder → row views). Pure data — no rendering, no
 * i18n handles, no locale context; labels arrive already resolved by the
 * caller (the panel resolves them through the shared dataset under the LIVE
 * locale — see `countryDatasetLabel`).
 *
 * Share math (the panel's honesty contract, extended to the bar): the
 * denominator is the WHOLE active population the payload accounts for —
 * every bucket's count PLUS the unresolved remainder — so bars + caption
 * always sum to 100% of the users the server saw. The share is the bar's
 * width driver; `percent` is the rounded whole-number display form.
 */

/** One country row's resolved presentation (identity + share + destination + copy). */
export interface CountryRowView {
  readonly code: string;
  readonly label: string;
  readonly flag: string;
  readonly count: number;
  /** Share of the whole accounted active population (0..1) — the bar's width driver. */
  readonly share: number;
  /** Whole-percent display form of the share (rounded, 0..100). */
  readonly percent: number;
  readonly href: string;
  readonly ariaLabel: string;
}

/** The directory deep-link prefix — the SAME guarded URL contract the directory facet's chips ride (`?country=CODE`). */
const DIRECTORY_COUNTRY_HREF = "/admin/users?country=";

/**
 * Wire buckets + unresolved remainder → row views, PRESERVING the server's
 * bucket order (SQL owns determinism — count-desc/code-asc; the mapper
 * re-sorts nothing, and neither does this builder). The label resolver is
 * injected so the module stays locale-agnostic (the panel resolves through
 * the shared dataset under the LIVE locale; tests can pin the resolution).
 */
export function buildCountryRowViews(args: {
  readonly buckets: ReadonlyArray<{
    readonly code: string;
    readonly label: string;
    readonly flag: string;
    readonly count: number;
  }>;
  readonly unresolvedCount: number;
  readonly labelOf: (bucket: { readonly code: string; readonly label: string }) => string;
  readonly rowAria: (label: string, count: number) => string;
}): readonly CountryRowView[] {
  const { buckets, unresolvedCount, labelOf, rowAria } = args;
  const accounted = buckets.reduce((sum, bucket) => sum + bucket.count, 0) + unresolvedCount;
  return buckets.map(bucket => {
    const share = accounted > 0 ? bucket.count / accounted : 0;
    const label = labelOf(bucket);
    return {
      code: bucket.code,
      label,
      flag: bucket.flag,
      count: bucket.count,
      share,
      percent: Math.round(share * 100),
      href: `${DIRECTORY_COUNTRY_HREF}${encodeURIComponent(bucket.code)}`,
      ariaLabel: rowAria(label, bucket.count),
    };
  });
}
