import { type MyTeacherSessionsQuery, SessionStatus } from "@/frontend/graphql/generated/gql/graphql";
import type { AppLocale } from "@/shared/locale/AppLocale";

/**
 * Pure week-calendar math + deterministic formatters behind the teacher
 * weekly-planner surface (`/schedule`).
 *
 * TIME DISCIPLINE — mirrors `frontend/lib/i18n/format-date.ts`: every
 * calendar bucket, weekday name and clock stamp is computed in UTC with
 * fixed `Intl` option sets, so a render is byte-identical between server
 * and client (host TZ cannot drift into the grid). "The day a session
 * belongs to" is the UTC day of its START moment, falling back to its
 * BOOKING moment when the session never started (`startedAt` is nullable;
 * `createdAt` is not).
 *
 * MONEY DISCIPLINE — deliberately NO fee aggregation here (or anywhere):
 * fees are decimal STRINGS carried verbatim end-to-end (see
 * `shared/constants/session-fees.constants.ts`), so the week summary strip
 * reports honest COUNTS only.
 *
 * WEEK VOCABULARY — the Egyptian week opens on SATURDAY under `ar`
 * (weekend Friday + Saturday, the local school rhythm); the English grid
 * keeps the international Sunday-open convention (weekend Saturday +
 * Sunday). Both tables are keyed by the app locale — never inferred from
 * the host.
 *
 * Leaf module: NO React, NO Apollo, NO MUI — pure functions over the
 * generated query item shape, safe to unit-test without a DOM.
 */

/** One `myTeacherSessions` item (the full session read the planner consumes). */
export type ScheduleSession = MyTeacherSessionsQuery["myTeacherSessions"]["items"][number];

/** One day bucket of the visible week (UTC midnight boundaries). */
export interface ScheduleDay {
  /** The day's UTC-midnight instant (the bucket identity). */
  readonly startsAt: Date;
  /** Sessions anchored to this day, chronologically ascending. */
  readonly sessions: readonly ScheduleSession[];
}

/** Week-start weekday per locale (UTC day-of-week; 0 = Sunday, 6 = Saturday). */
export const WEEK_STARTS_ON: Record<AppLocale, number> = { en: 0, ar: 6 };

/** Weekend weekdays per locale (UTC day-of-week set) — drives the day tint. */
const WEEKEND_DAYS: Record<AppLocale, readonly number[]> = { en: [0, 6], ar: [5, 6] };

/**
 * The week summary strip's honest counts. `disputed` sessions surface in
 * `total` only — they are neither active nor cleanly terminal, and the
 * strip never reclassifies a lifecycle state.
 */
export interface WeekStats {
  readonly total: number;
  readonly active: number;
  readonly completed: number;
  readonly cancelled: number;
}

// ─── UTC calendar primitives ────────────────────────────────────────────────

/** The day's UTC-midnight instant (no host-TZ involvement). */
export function utcMidnight(day: Date): Date {
  return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()));
}

/** A UTC-midnight instant shifted by whole days (DST-free by construction). */
export function addUtcDays(day: Date, days: number): Date {
  const midnight = utcMidnight(day);
  return new Date(Date.UTC(midnight.getUTCFullYear(), midnight.getUTCMonth(), midnight.getUTCDate() + days));
}

/** Strict same-UTC-day comparison (the today-ring / bucket identity check). */
export function isSameUtcDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

/**
 * The UTC-midnight instant of the week's OPENING day for the given
 * `weekStartsOn` weekday. Normalizes any mid-week day onto its week's
 * first column.
 */
export function startOfWeekUtc(day: Date, weekStartsOn: number): Date {
  const midnight = utcMidnight(day);
  const shift = (midnight.getUTCDay() - weekStartsOn + 7) % 7;
  return addUtcDays(midnight, -shift);
}

/** The session's anchor instant: the start moment, else the booking moment. */
export function sessionAnchorIso(session: ScheduleSession): string {
  return session.startedAt ?? session.createdAt;
}

// ─── Week assembly ──────────────────────────────────────────────────────────

/**
 * Buckets the teacher's sessions into the SEVEN day columns of the week
 * opening at `weekStart`. Sessions anchored outside the window are dropped
 * (the week navigator owns reachability), and each bucket stays
 * chronologically ascending regardless of the query's ordering.
 */
export function groupSessionsByWeekDay(sessions: readonly ScheduleSession[], weekStart: Date): ScheduleDay[] {
  const dayStarts: Date[] = [];
  for (let index = 0; index < 7; index += 1) {
    dayStarts.push(addUtcDays(weekStart, index));
  }
  const buckets: ScheduleSession[][] = dayStarts.map(() => []);
  for (const session of sessions) {
    const anchor = utcMidnight(new Date(sessionAnchorIso(session)));
    const index = dayStarts.findIndex(dayStart => isSameUtcDay(dayStart, anchor));
    if (index >= 0) {
      buckets[index].push(session);
    }
  }
  return dayStarts.map((startsAt, index) => ({
    startsAt,
    sessions: buckets[index].toSorted(
      (a, b) => new Date(sessionAnchorIso(a)).getTime() - new Date(sessionAnchorIso(b)).getTime()
    ),
  }));
}

/**
 * The week summary counts — an honest PARTITION-OF-THE-WHOLE read:
 * `total` counts every anchored session, `active` = Scheduled + Started,
 * `completed` = Completed, `cancelled` = Cancelled, and a DISPUTED session
 * contributes to `total` only (never silently reclassified).
 */
export function weekStats(days: readonly ScheduleDay[]): WeekStats {
  const all = days.flatMap(day => day.sessions);
  const inStatus = (statuses: readonly string[]): number =>
    all.filter(session => statuses.includes(session.status)).length;
  return {
    total: all.length,
    active: inStatus([SessionStatus.Scheduled, SessionStatus.Started]),
    completed: inStatus([SessionStatus.Completed]),
    cancelled: inStatus([SessionStatus.Cancelled]),
  };
}

/** Whether a day bucket is a WEEKEND column under the locale's weekend set. */
export function isWeekendDay(day: Date, locale: AppLocale): boolean {
  return WEEKEND_DAYS[locale].includes(day.getUTCDay());
}

// ─── Deterministic formatters (UTC components, locale digits) ───────────────

type FormatterFactory = (tag: "en" | "ar") => Intl.DateTimeFormat;

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function cachedFormatter(kind: string, locale: AppLocale, factory: FormatterFactory): Intl.DateTimeFormat {
  const key = `${kind}:${locale}`;
  const existing = formatterCache.get(key);
  if (existing) {
    return existing;
  }
  const created = factory(resolveLocaleTag(locale));
  formatterCache.set(key, created);
  return created;
}

function resolveLocaleTag(locale: AppLocale): "en" | "ar" {
  return locale === "en" ? "en" : "ar";
}

/** The weekday's long name (`Saturday` / `السبت`). */
export function weekdayName(day: Date, locale: AppLocale): string {
  return cachedFormatter(
    "weekday",
    locale,
    tag =>
      new Intl.DateTimeFormat(tag, {
        timeZone: "UTC",
        weekday: "long",
      })
  ).format(day);
}

/** The short day stamp for column headers and the range label (`13 Sep` / `١٣ سبتمبر`). */
export function dayMonthStamp(day: Date, locale: AppLocale): string {
  return cachedFormatter(
    "dayMonth",
    locale,
    tag =>
      new Intl.DateTimeFormat(tag, {
        timeZone: "UTC",
        day: "numeric",
        month: "short",
      })
  ).format(day);
}

/** The full range stamp including the year (`13 Sep 2026`). */
export function dayMonthYearStamp(day: Date, locale: AppLocale): string {
  return cachedFormatter(
    "dayMonthYear",
    locale,
    tag =>
      new Intl.DateTimeFormat(tag, {
        timeZone: "UTC",
        day: "numeric",
        month: "short",
        year: "numeric",
      })
  ).format(day);
}

/**
 * The 24h clock stamp for session chips (`14:00` / `١٤:٠٠`). `hourCycle:
 * "h23"` pins midnight to `00:00` — `hour12: false` selects the locale's
 * DEFAULT h24 pattern, which some ICU locale datasets define as h24
 * (rendering UTC midnight as `24:00`).
 */
export function clockStamp(iso: string, locale: AppLocale): string {
  return cachedFormatter(
    "clock",
    locale,
    tag =>
      new Intl.DateTimeFormat(tag, {
        timeZone: "UTC",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      })
  ).format(new Date(iso));
}
