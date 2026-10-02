/**
 * Schedule namespace labels — the teacher weekly-planner surface
 * (`/schedule`): the week-navigation toolbar, the week summary strip,
 * the seven day columns and their anchored session chips.
 *
 * Used by:
 *  - `frontend/views/teacher/schedule/ScheduleContainer.tsx`
 *    (`useAppTranslation(Schedule)` with property access).
 *  - Server Components rendering the page via
 *    `await getTranslations(locale)` → property access.
 *
 * Session lifecycle status copy is deliberately NOT duplicated here — the
 * planner reuses the `sessions` namespace through the shared
 * `STATUS_LABEL_KEY` presentation table so the chip vocabulary can never
 * fork between the list and the grid.
 *
 * Week/weekday names and clock times are NOT locale COPY either — they
 * expand through deterministic `Intl.DateTimeFormat` formatters (UTC
 * components, locale digits) so the grid stays byte-consistent between
 * server and client renders.
 *
 * All keys MUST have both `en` and `ar` implementations with EXACT key-set
 * parity (compile-typed on both leaves + `schedule-namespace.parity.test.ts`
 * runtime belt). Property access only — never call-by-key.
 */
export interface ScheduleLabels {
  /** Schedule page <title>/header. */
  readonly pageTitle: string;
  /** Week-nav toolbar — previous-week icon button aria-label. */
  readonly previousWeekLabel: string;
  /** Week-nav toolbar — next-week icon button aria-label. */
  readonly nextWeekLabel: string;
  /** Week-nav toolbar — the reset-to-current-week button label. */
  readonly thisWeekLabel: string;
  /**
   * Week range heading — `{from}`/`{to}` interpolate the two locale-formatted
   * day/month stamps of the visible week (argument order is ALWAYS
   * chronological: earlier date first, later date second, independent of the
   * document direction).
   */
  readonly weekRangeLabel: (from: string, to: string) => string;
  /** Summary strip card — sessions anchored to the visible week (all statuses). */
  readonly weekSessionsLabel: string;
  /** Summary strip card — scheduled + started (still in flight) sessions. */
  readonly weekActiveLabel: string;
  /** Summary strip card — completed sessions. */
  readonly weekCompletedLabel: string;
  /** Summary strip card — cancelled sessions. */
  readonly weekCancelledLabel: string;
  /** Today marker chip on the matching day column. */
  readonly todayChip: string;
  /** Day column aria-label — `{day}` weekday name, `{date}` locale day stamp. */
  readonly dayColumnAria: (day: string, date: string) => string;
  /** Per-day session count line — localized plural handled per locale. */
  readonly dayCountLine: (count: number) => string;
  /** Session chip aria-label — `{status}` lifecycle copy, `{time}` clock stamp. */
  readonly sessionChipAria: (status: string, time: string) => string;
  /** Empty-state heading — the visible week has no sessions at all. */
  readonly emptyWeekTitle: string;
  /** Empty-state body — what the grid anchors and how to see data. */
  readonly emptyWeekBody: string;
  /** Error-state heading (query failure). */
  readonly errorTitle: string;
  /** Error-state body. */
  readonly errorBody: string;
  /** Loading region aria-label (skeleton state). */
  readonly loadingLabel: string;
  /** Footer CTA — navigate to the teacher sessions management list. */
  readonly manageSessionsCta: string;
}
