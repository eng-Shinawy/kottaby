/**
 * paymentFilterDates — the date-draft boundary helpers of the payments
 * audit filter bar (`/admin/finances`, payments tab): native `date` input
 * values committed as inclusive from-midnight / exclusive to-midnight UTC
 * instants. The canonical `YYYY-MM-DD` → UTC-midnight parser lives ONCE in
 * the audit trail's filter plumbing
 * ({@link ./audit-trail-filters.parseUtcDayStart}) and is REUSED here — the
 * finances block mints no second copy. Malformed or impossible calendar
 * values normalize to `null` (the `Date.UTC` rollover guard — an
 * unparseable draft never constrains the query).
 */

import { parseUtcDayStart } from "@/frontend/views/admin/audit/audit-trail-filters";

const DAY_MS = 86_400_000;

/** The exclusive wire boundary for the `to` calendar day (UTC has no DST). */
export function parseUtcDayEndExclusive(value: string): Date | null {
  const start = parseUtcDayStart(value);
  return start === null ? null : new Date(start.getTime() + DAY_MS);
}
