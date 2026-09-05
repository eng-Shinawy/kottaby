/**
 * userDetailFormatters — locale-bound timestamp formatting helpers for the
 * admin user DETAIL page, extracted from `AdminUserDetailContainer`.
 */

/** Entries fetched for the per-user activity timeline (server clamps 1..50). */
export const ACTIVITY_TIMELINE_LIMIT = 10;

/**
 * Formats an ISO-8601 server timestamp or a `YYYY-MM-DD` calendar string
 * using the bound locale `Intl.DateTimeFormat`. Returns "—" for empty
 * input and the raw string when the input is not a parseable date.
 */
export function formatTimestamp(raw: string | null | undefined, formatter: Intl.DateTimeFormat): string {
  if (!raw) return "—";
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return formatter.format(parsed);
}
