/**
 * subscriptionsViewLabels — the localized date formatting for the
 * my-subscriptions rows (the `formatApplicantDate` precedent: fixed UTC
 * options, byte-deterministic across environments, only exact `"en"`
 * selects English — every other input falls back to `"ar-u-nu-latn"`, the
 * Latin-digit Arabic calendar formatting pinned to match the funnel's
 * Western-numeral convention).
 */
const SUBSCRIPTION_DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  timeZone: "UTC",
  year: "numeric",
  month: "short",
  day: "2-digit",
};

/**
 * Formats one ISO-8601 instant into a deterministic, locale-aware date
 * stamp (UTC components; Latin digits in both locales — the app-wide
 * Western-numeral convention).
 *
 * @param iso - ISO-8601 instant (GraphQL exposes subscription timestamps as
 *   nullable ISO-8601 UTC strings — pass only non-null values).
 * @param locale - app locale ("ar" | "en"; other inputs resolve to "ar").
 */
export function formatSubscriptionDate(iso: string, locale: string): string {
  const formatter = new Intl.DateTimeFormat(locale === "en" ? "en" : "ar-u-nu-latn", SUBSCRIPTION_DATE_OPTIONS);
  return formatter.format(new Date(iso));
}
