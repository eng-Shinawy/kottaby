/**
 * lifecycleBucketViews — the bucket view-model of the admin cooldown
 * lifecycle panel, extracted from `AdminCooldownLifecyclePanel` (file-size
 * cap): the `LifecycleBucket` union, the `BucketView` presentation contract,
 * the directory deep-link table (URL contract v1), and `buildBucketViews`
 * (wire stats + resolved copy → rail-ordered row views). Pure data — no
 * rendering, no i18n handles; labels arrive already localized.
 */

/** The three lifecycle buckets in rail order — cooling → ending → ready again. */
export type LifecycleBucket = "active" | "expiringSoon" | "expired";

/** One bucket's resolved presentation (tone + count + destination + copy). */
export interface BucketView {
  readonly bucket: LifecycleBucket;
  readonly label: string;
  readonly count: number;
  readonly href: string;
  readonly ariaLabel: string;
}

/** The directory deep-link for each lifecycle bucket (URL contract v1). */
const BUCKET_HREF: Record<LifecycleBucket, string> = {
  active: "/admin/users?cooldown=active",
  expiringSoon: "/admin/users?cooldown=active&expiring=1",
  expired: "/admin/users?cooldown=expired",
};

/**
 * Wire counts + resolved labels → the three rail-ordered bucket views.
 * Deep-links carry BOTH predicates where meaningful: the expiring-soon
 * bucket links `?cooldown=active&expiring=1` (the state narrow keeps the
 * rendered chips and the rows telling one story). The expiring-soon label's
 * window length arrives ON the wire (`expiringSoonLabel` is pre-rendered by
 * the caller from `expiringSoonWindowDays`), so the copy can never drift
 * from the count.
 */
export function buildBucketViews(args: {
  readonly activeCount: number;
  readonly expiringSoonCount: number;
  readonly expiredCount: number;
  readonly activeLabel: string;
  readonly expiringSoonLabel: string;
  readonly expiredLabel: string;
  readonly bucketAria: (label: string, count: number) => string;
}): readonly BucketView[] {
  return [
    {
      bucket: "active",
      label: args.activeLabel,
      count: args.activeCount,
      href: BUCKET_HREF.active,
      ariaLabel: args.bucketAria(args.activeLabel, args.activeCount),
    },
    {
      bucket: "expiringSoon",
      label: args.expiringSoonLabel,
      count: args.expiringSoonCount,
      href: BUCKET_HREF.expiringSoon,
      ariaLabel: args.bucketAria(args.expiringSoonLabel, args.expiringSoonCount),
    },
    {
      bucket: "expired",
      label: args.expiredLabel,
      count: args.expiredCount,
      href: BUCKET_HREF.expired,
      ariaLabel: args.bucketAria(args.expiredLabel, args.expiredCount),
    },
  ];
}
