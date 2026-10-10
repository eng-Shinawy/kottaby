/**
 * Platform-analytics CSV export — the pure client-side serialization of the
 * snapshot the dashboard already holds (no second fetch, no backend change:
 * the export reflects EXACTLY the coherence-stamped snapshot on screen).
 *
 * Module posture — EVERYTHING string-building is pure and synchronous:
 *  - `buildPlatformAnalyticsCsv` turns the snapshot + the caller's
 *    translation handles into one UTF-8 CSV document (BOM-prefixed so
 *    spreadsheet apps open the Arabic labels correctly);
 *  - `platformAnalyticsCsvFilename` derives the download filename from the
 *    snapshot's `generatedAt` stamp (UTC, minute precision).
 *
 * Honesty contract (mirrors the render surface):
 *  - money NEVER parses to float — wire decimal strings flow verbatim into
 *    the cells (grouping is a display-only concern, deliberately absent in
 *    the machine-readable export);
 *  - honest-null rating averages serialize as EMPTY cells (the `—` is a
 *    display affordance, not a value);
 *  - counts serialize raw (locale digit shaping is display-only);
 *  - an EMPTY per-currency revenue table omits the currency block entirely
 *    (never a fabricated zero-currency row);
 *  - an EMPTY revenue-trend series emits only the header (honest emptiness).
 *
 * Content decision — labels are LOCALIZED: row/section/column captions come
 * from the same translation handles the on-screen cards render, so the
 * export reads like the dashboard in the admin's locale. All VALUES stay
 * locale-neutral wire data. The only non-label literals are the field
 * separators (`,`) and the newline (`\n`) — the CSV format itself.
 *
 * Formula-injection posture: every cell is routed through the shared
 * `neutralizeCsvFormulas` guard (CWE-1236) before quoting and joining, so
 * even if user-authored text ever reached a cell, it would export as
 * inert text rather than a live formula.
 */

import type { AdminPlatformAnalyticsQuery_adminPlatformAnalytics } from "@/frontend/graphql/generated/gql/graphql";
import { csvRecord, UTF8_BOM } from "@/frontend/utils/csv-record";
import type { AnalyticsLabels } from "@/shared/locale/types/analytics";

/** The snapshot shape the builder consumes (the extracted query result type). */
type AnalyticsSnapshot = AdminPlatformAnalyticsQuery_adminPlatformAnalytics;

/** One metrics-table row: section title + metric label + raw value. */
function metricRecord(sectionLabel: string, metricLabel: string, value: number | null): string {
  // Honest null → empty cell (the em-dash is a display-only affordance).
  return csvRecord([sectionLabel, metricLabel, value === null ? "" : String(value)]);
}

/** Zero-pads a number to two digits (UTC stamp components of the CSV filename). */
function pad(input: number): string {
  return String(input).padStart(2, "0");
}

/**
 * Builds the full CSV document for the snapshot: the generated-at metadata
 * line, the metrics table (the six numeric sections + the offline
 * activations count), the per-currency revenue table (omitted when empty),
 * and both trend series.
 */
export function buildPlatformAnalyticsCsv(snapshot: AnalyticsSnapshot, labels: AnalyticsLabels): string {
  const { users, sessions, revenue, subscriptions, teachers, ratings, health } = snapshot;

  const lines: string[] = [];

  // Metadata line — the coherence stamp travels with the data.
  lines.push(csvRecord([labels.csvGeneratedAtHeader, snapshot.generatedAt]));

  // ─── Metrics table ────────────────────────────────────────────────────────
  lines.push(csvRecord([labels.csvSectionHeader, labels.csvMetricHeader, labels.csvValueHeader]));

  const metricRows: ReadonlyArray<readonly [string, string, number | null]> = [
    // Users
    [labels.usersSection, labels.usersTotalLabel, users.totalCount],
    [labels.usersSection, labels.usersActiveLabel, users.activeCount],
    [labels.usersSection, labels.usersSuspendedLabel, users.suspendedCount],
    [labels.usersSection, labels.usersBlockedLabel, users.blockedCount],
    [labels.usersSection, labels.usersDeletedLabel, users.deletedCount],
    [labels.usersSection, labels.usersAdminsLabel, users.adminsCount],
    [labels.usersSection, labels.usersTeachersLabel, users.teachersCount],
    [labels.usersSection, labels.usersStudentsLabel, users.studentsCount],
    [labels.usersSection, labels.usersParentsLabel, users.parentsCount],
    [labels.usersSection, labels.usersNewThisWeekLabel, users.newThisWeekCount],
    [labels.usersSection, labels.recentlyActive24hLabel, users.recentlyActive24h],
    // Sessions
    [labels.sessionsSection, labels.sessionsTotalLabel, sessions.total],
    [labels.sessionsSection, labels.sessionsTodayLabel, sessions.today],
    [labels.sessionsSection, labels.sessionsThisWeekLabel, sessions.thisWeek],
    [labels.sessionsSection, labels.sessionsThisMonthLabel, sessions.thisMonth],
    [labels.sessionsSection, labels.sessionsScheduledLabel, sessions.scheduled],
    [labels.sessionsSection, labels.sessionsStartedLabel, sessions.started],
    [labels.sessionsSection, labels.sessionsCompletedLabel, sessions.completed],
    [labels.sessionsSection, labels.sessionsCancelledLabel, sessions.cancelled],
    [labels.sessionsSection, labels.sessionsDisputedLabel, sessions.disputed],
    [labels.sessionsSection, labels.awaitingConfirmationLabel, sessions.awaitingConfirmation],
    // Revenue (the offline count is a metric row; the per-currency money gets its own table below)
    [labels.revenueSection, labels.offlineActivationsLabel, revenue.offlineActivationsCount],
    // Subscriptions
    [labels.subscriptionsSection, labels.subscriptionsTotalLabel, subscriptions.total],
    [labels.subscriptionsSection, labels.subscriptionsActiveLabel, subscriptions.active],
    [labels.subscriptionsSection, labels.subscriptionsPendingLabel, subscriptions.pending],
    [labels.subscriptionsSection, labels.subscriptionsExpiredLabel, subscriptions.expired],
    [labels.subscriptionsSection, labels.subscriptionsCancelledLabel, subscriptions.cancelled],
    [labels.subscriptionsSection, labels.subscriptionsSuspendedLabel, subscriptions.suspended],
    [labels.subscriptionsSection, labels.activeInWindowNowLabel, subscriptions.activeInWindowNow],
    // Teachers
    [labels.teachersSection, labels.teachersCertifiedLabel, teachers.certifiedCount],
    [labels.teachersSection, labels.teachersEvaluatorsLabel, teachers.evaluatorCount],
    [labels.teachersSection, labels.teachersOnlineNowLabel, teachers.onlineNowCount],
    // Ratings (honest-null averages → empty cells)
    [labels.ratingsSection, labels.averageSessionRatingLabel, ratings.averageSessionRating],
    [labels.ratingsSection, labels.sessionRatingsCountLabel, ratings.sessionRatingsCount],
    [labels.ratingsSection, labels.averageEvaluationScoreLabel, ratings.averageEvaluationScore],
    [labels.ratingsSection, labels.evaluationScoresCountLabel, ratings.evaluationScoresCount],
    // Health
    [labels.healthSection, labels.pendingDisputesLabel, health.pendingDisputes],
    [labels.healthSection, labels.pendingWithdrawalsLabel, health.pendingWithdrawals],
  ];
  for (const [sectionLabel, metricLabel, value] of metricRows) {
    lines.push(metricRecord(sectionLabel, metricLabel, value));
  }

  // ─── Per-currency revenue table (omitted entirely when empty) ────────────
  if (revenue.gatewayRevenueByCurrency.length > 0) {
    lines.push("\n");
    lines.push(
      csvRecord([
        labels.currencyHeader,
        labels.totalAmountHeader,
        labels.last30DaysAmountHeader,
        labels.paidPaymentsCountHeader,
      ])
    );
    for (const row of revenue.gatewayRevenueByCurrency) {
      // Exact decimal strings verbatim — never parsed, never grouped.
      lines.push(csvRecord([row.currency, row.totalAmount, row.last30DaysAmount, String(row.paidPaymentsCount)]));
    }
  }

  // ─── Session trend ───────────────────────────────────────────────────────
  lines.push("\n");
  lines.push(csvRecord([labels.trendDateAxisLabel, labels.sessionsSeriesLabel]));
  for (const row of snapshot.sessionTrendDaily) {
    lines.push(csvRecord([row.bucketStart, String(row.sessionCount)]));
  }

  // ─── Revenue trend (per-currency rows, wire shape preserved) ─────────────
  lines.push("\n");
  lines.push(csvRecord([labels.trendDateAxisLabel, labels.currencyHeader, labels.trendAmountAxisLabel]));
  for (const row of snapshot.revenueTrendDaily) {
    lines.push(csvRecord([row.bucketStart, row.currency, row.amount]));
  }

  return `${UTF8_BOM}${lines.join("")}`;
}

/**
 * Derives the download filename from the snapshot's coherence stamp:
 * `platform-analytics-YYYY-MM-DD-HHmm.csv` (UTC, minute precision). An
 * unparseable stamp falls back to the wall-clock date — the filename always
 * carries SOME honest timestamp, never a placeholder string.
 */
export function platformAnalyticsCsvFilename(generatedAt: string, now: Date = new Date()): string {
  const parsed = Date.parse(generatedAt);
  const stampSource = Number.isNaN(parsed) ? now.getTime() : parsed;
  const stamp = new Date(stampSource);
  const year = stamp.getUTCFullYear();
  const month = pad(stamp.getUTCMonth() + 1);
  const day = pad(stamp.getUTCDate());
  const hour = pad(stamp.getUTCHours());
  const minute = pad(stamp.getUTCMinutes());
  return `platform-analytics-${year}-${month}-${day}-${hour}${minute}.csv`;
}
