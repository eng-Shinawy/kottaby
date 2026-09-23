/**
 * Locale-aware RELATIVE time formatting — the platform's ONE relative-time
 * ladder. Companion to the sibling `format-date` module: `formatApplicantDate`
 * renders the deterministic ABSOLUTE stamp (UTC components, locale digits),
 * while this module renders the scanning-friendly RELATIVE caption ("3 hours
 * ago" / "قبل 3 ساعات").
 *
 * Locale tags resolve through the shared `resolveLocaleTag` fallback rule
 * (only exact `"en"` selects English). The text itself comes from the
 * platform's own `Intl.RelativeTimeFormat` (`numeric: "auto"`), which carries
 * the idiomatic words in BOTH app locales with zero localized copy: "now" /
 * "الآن", "yesterday" / "أمس", "قبل 3 دقائق", … — Arabic-Indic digits under
 * `ar` natively, so the parity inventory gains no leaves.
 *
 * TWO surfaced contracts ride the one core:
 *  - `formatRelativeAuditStamp` — the audit trail's BOUNDED variant (7-day
 *    window): beyond it a relative caption ("3 months ago") is vaguer than
 *    the absolute stamp for an immutable audit record, so the helper returns
 *    `null` and the caller falls back to the absolute stamp alone; a
 *    future-dated stamp renders absolutely too (a relative "in 3 hours"
 *    would lie on an immutable record). The caller renders the two TOGETHER
 *    (relative as the primary line, absolute as the precision caption)
 *    inside its own view code — this module stays string-in/string-out.
 *  - `formatDirectoryRelativeTime` lives in the admin-users directory
 *    helpers and DELEGATES here with an unbounded window (its
 *    `lastActiveAt` stamp renders relatively at any age, the historical
 *    behavior) — one ladder, no duplicated divisions.
 */

import { resolveLocaleTag } from "@/frontend/lib/i18n/format-date";

/**
 * Relative captions render only for entries younger than this window;
 * older entries fall back to the absolute stamp (`null` return).
 */
const RELATIVE_WINDOW_MS = 7 * 86_400_000;

/**
 * Cascading magnitude ladder, largest unit last — each entry stops the
 * promotion once the absolute duration (in the running unit) drops below
 * `amount`. The audit-trail variant is bounded at the day rung (its window
 * contract means weeks/months/years never render relatively); the
 * unbounded directory variant runs the ladder out through years.
 */
const BOUNDED_DIVISIONS: ReadonlyArray<{ readonly amount: number; readonly unit: Intl.RelativeTimeFormatUnit }> = [
  { amount: 60, unit: "second" },
  { amount: 60, unit: "minute" },
  { amount: 24, unit: "hour" },
  { amount: Number.POSITIVE_INFINITY, unit: "day" },
];

/** The full ticking-clock ladder (seconds → minutes → hours → days → weeks → months → years). */
const UNBOUNDED_DIVISIONS: ReadonlyArray<{ readonly amount: number; readonly unit: Intl.RelativeTimeFormatUnit }> = [
  { amount: 60, unit: "second" },
  { amount: 60, unit: "minute" },
  { amount: 24, unit: "hour" },
  { amount: 7, unit: "day" },
  { amount: 4.34524, unit: "week" }, // average weeks per month
  { amount: 12, unit: "month" },
  { amount: Number.POSITIVE_INFINITY, unit: "year" },
];

/** Options of the shared relative-time core. */
interface RelativeTimeOptions {
  /**
   * The bounded window in milliseconds: an instant older than the window
   * (or in the future) resolves to `null`. `null` = unbounded — every
   * instant renders relatively, future ones as "in N units".
   */
  readonly windowMs: number | null;
  /** Epoch milliseconds of the rendering pass (injectable for deterministic QA). */
  readonly now: number;
}

/**
 * The shared relative-time core. Returns the localized relative caption for
 * an ISO-8601 instant, or `null` when the instant is unparseable or — under
 * a bounded window — lies outside the window or in the future.
 *
 * @param iso - ISO-8601 instant.
 * @param locale - app locale ("ar" | "en"; other inputs resolve to "ar").
 * @param options - the window/now contract (see `RelativeTimeOptions`).
 */
function formatRelativeTime(iso: string, locale: string, options: RelativeTimeOptions): string | null {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  const deltaSeconds = (parsed.getTime() - options.now) / 1000;
  if (options.windowMs !== null) {
    // Future-dated or beyond-window instants render absolutely — a relative
    // caption for a clock-skewed future stamp would be a lie on an immutable
    // record ("in 3 hours" suggests the action has not happened yet).
    if (deltaSeconds > 0 || -deltaSeconds > options.windowMs / 1000) return null;
  }
  const formatter = new Intl.RelativeTimeFormat(resolveLocaleTag(locale), { numeric: "auto" });
  const divisions = options.windowMs === null ? UNBOUNDED_DIVISIONS : BOUNDED_DIVISIONS;
  let duration = deltaSeconds;
  for (const division of divisions) {
    if (Math.abs(duration) < division.amount) {
      return formatter.format(Math.round(duration), division.unit);
    }
    duration /= division.amount;
  }
  return formatter.format(Math.round(duration), "day");
}

/**
 * Relative caption for an ISO-8601 instant, or `null` when the instant lies
 * outside the 7-day window (caller falls back to the absolute stamp) or is
 * unparseable.
 *
 * @param iso - ISO-8601 instant (the audit trail's `createdAt` wire value).
 * @param locale - app locale ("ar" | "en"; other inputs resolve to "ar").
 * @param now - epoch milliseconds of the rendering pass (injectable for
 *   deterministic QA); defaults to the wall clock.
 */
export function formatRelativeAuditStamp(iso: string, locale: string, now: number = Date.now()): string | null {
  return formatRelativeTime(iso, locale, { windowMs: RELATIVE_WINDOW_MS, now });
}

/**
 * The directory's unbounded variant (delegated core, unbounded window,
 * injectable now): any age renders relatively — future instants included,
 * the historical contract of the `lastActiveAt` stamp.
 */
export function formatUnboundedRelativeTime(iso: string, locale: string, now: number = Date.now()): string | null {
  return formatRelativeTime(iso, locale, { windowMs: null, now });
}
