/**
 * Colocated unit tests for `platform-analytics-csv.ts` — the pure
 * client-side serialization of the analytics snapshot.
 *
 * Focus: the formula-injection payload row — a hostile cell must export
 * as inert text (CWE-1236 defused), never as a live formula, and benign
 * snapshots must stay byte-identical to the pre-guard contract.
 *
 * Fixture discipline: label values come from the real `analyticsEn`
 * fixture-free namespace object (owned by shared/locale) and are NOT
 * asserted verbatim — the assertions pin STRUCTURE (defused cells, BOM,
 * record joins) against those values.
 */
import { describe, expect, test } from "bun:test";
import type { AdminPlatformAnalyticsQuery_adminPlatformAnalytics } from "@/frontend/graphql/generated/gql/graphql";
import { buildPlatformAnalyticsCsv } from "@/frontend/views/admin/analytics/platform-analytics-csv";
import { analyticsEn } from "@/shared/locale/en/analytics";

function snapshot(): AdminPlatformAnalyticsQuery_adminPlatformAnalytics {
  return {
    generatedAt: "2026-01-01T00:00:00Z",
    users: {
      totalCount: 10,
      activeCount: 9,
      suspendedCount: 1,
      blockedCount: 0,
      deletedCount: 0,
      adminsCount: 1,
      teachersCount: 2,
      studentsCount: 5,
      parentsCount: 2,
      newThisWeekCount: 3,
      recentlyActive24h: 4,
    },
    sessions: {
      total: 20,
      today: 2,
      thisWeek: 5,
      thisMonth: 8,
      scheduled: 3,
      started: 6,
      completed: 4,
      cancelled: 1,
      disputed: 0,
      awaitingConfirmation: 1,
    },
    revenue: {
      offlineActivationsCount: 7,
      gatewayRevenueByCurrency: [
        { currency: "EGP", totalAmount: "100.00", last30DaysAmount: "40.00", paidPaymentsCount: 3 },
      ],
    },
    subscriptions: { total: 12, active: 8, pending: 2, expired: 1, cancelled: 1, suspended: 0, activeInWindowNow: 8 },
    teachers: { certifiedCount: 2, evaluatorCount: 1, onlineNowCount: 1 },
    ratings: {
      averageSessionRating: 4.5,
      sessionRatingsCount: 10,
      averageEvaluationScore: null,
      evaluationScoresCount: 0,
    },
    health: { pendingDisputes: 0, pendingWithdrawals: 1 },
    sessionTrendDaily: [{ bucketStart: "2026-01-01T00:00:00Z", sessionCount: 5 }],
    revenueTrendDaily: [{ bucketStart: "2026-01-01T00:00:00Z", currency: "EGP", amount: "25.00" }],
  };
}

describe("buildPlatformAnalyticsCsv — formula-payload row", () => {
  test("a hostile section label exports as inert text (CWE-1236 defused)", () => {
    const labels = { ...analyticsEn, usersSection: "=cmd|'/C calc'!A0" };
    const csv = buildPlatformAnalyticsCsv(snapshot(), labels);
    // The first metrics row leads with the defused label — unquoted (no
    // delimiter/quote/newline in the defused value).
    expect(csv).toContain(`'=cmd|'/C calc'!A0,${analyticsEn.usersTotalLabel},10\n`);
  });

  test("a hostile trend bucket exports as inert text", () => {
    const hostile = snapshot();
    hostile.sessionTrendDaily = [{ bucketStart: '=HYPERLINK("http://evil")', sessionCount: 1 }];
    const csv = buildPlatformAnalyticsCsv(hostile, analyticsEn);
    // The defused value embeds a quote → the conditional-quote recipe engages
    // and doubles it.
    expect(csv).toContain('"\'=HYPERLINK(""http://evil"")",1\n');
  });

  test("a benign snapshot stays byte-identical to the pre-guard contract", () => {
    const csv = buildPlatformAnalyticsCsv(snapshot(), analyticsEn);
    // BOM + generated-at meta + metrics header, exactly as before the guard.
    expect(csv.startsWith(`\uFEFF${analyticsEn.csvGeneratedAtHeader},2026-01-01T00:00:00Z\n`)).toBeTrue();
    expect(csv).toContain(
      `${analyticsEn.csvSectionHeader},${analyticsEn.csvMetricHeader},${analyticsEn.csvValueHeader}\n`
    );
    expect(csv).toContain(`${analyticsEn.usersSection},${analyticsEn.usersTotalLabel},10\n`);
    // Revenue table, session trend, and revenue trend records verbatim.
    expect(csv).toContain(
      `${analyticsEn.currencyHeader},${analyticsEn.totalAmountHeader},${analyticsEn.last30DaysAmountHeader},${analyticsEn.paidPaymentsCountHeader}\n`
    );
    expect(csv).toContain(`EGP,100.00,40.00,3\n`);
    expect(csv).toContain(
      `${analyticsEn.trendDateAxisLabel},${analyticsEn.sessionsSeriesLabel}\n2026-01-01T00:00:00Z,5\n`
    );
    expect(csv).toContain(`2026-01-01T00:00:00Z,EGP,25.00\n`);
    // Honest-null averages stay empty cells.
    expect(csv).toContain(`${analyticsEn.ratingsSection},${analyticsEn.averageEvaluationScoreLabel},\n`);
  });
});
