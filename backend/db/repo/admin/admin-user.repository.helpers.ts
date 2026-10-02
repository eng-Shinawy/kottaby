/**
 * AdminUserRepository aggregate helpers — the two single-round-trip KPI
 * aggregates behind `AdminUserRepository.getStats` and
 * `AdminUserRepository.getCooldownLifecycleStats`, extracted verbatim from
 * `admin-user.repository.ts` (size-budget split, zero behavior change:
 * same statements, same JS-computed parameterized cutoffs, same
 * null-coalesced rows).
 *
 * Both run on `(tx ?? db)` — a supplied transaction executes the aggregate
 * on the caller's executor; absent one, the global handle serves the
 * standalone read — mirroring the repository's executor-choice convention.
 */
import { and, asc, desc, eq, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db } from "@/backend/db";
import { COOLDOWN_EXPIRING_SOON_DAYS } from "@/backend/db/repo/admin/admin-user-query-helpers";
import type {
  AdminCooldownLifecycleRow,
  AdminUserCountryBreakdownRow,
  AdminUserStatsRow,
} from "@/backend/db/repo/admin/admin-user-row-types";
import { applicants } from "@/backend/db/schema/teachers/applicants";
import { users } from "@/backend/db/schema/users/users";
import type { DBTransaction } from "@/backend/types";

/**
 * Resolves the directory-wide aggregate counters for the admin overview
 * strip in a SINGLE round-trip — one `SELECT count(*) + FILTERED count(*)`
 * aggregate over `users` (no JOINs, no GROUP BY, no pagination).
 *
 * `newThisWeekCount` filters on `created_at > cutoff` where the cutoff
 * (now minus 7 days) is computed in JS and bound as a Drizzle parameter —
 * never SQL `now() - interval` so the statement stays engine-portable
 * (PostgreSQL + SQLite both bind the parameterized timestamp natively).
 *
 * @returns The aggregate row (members are `::int`-cast counts; the
 *          empty-table edge case still yields one row of zeros because
 *          bare aggregates always return exactly one row).
 */
export async function getStatsAggregate(tx?: DBTransaction): Promise<AdminUserStatsRow> {
  const newThisWeekCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const rows = await (tx ?? db)
    .select({
      totalCount: sql<number>`count(*)::int`.as("total_count"),
      activeCount: sql<number>`count(*) filter (
          where coalesce(${users.isDeleted}, false) = false
            and coalesce(${users.suspended}, false) = false
            and coalesce(${users.isBlocked}, false) = false
        )::int`.as("active_count"),
      suspendedCount: sql<number>`count(*) filter (where ${users.suspended} = true)::int`.as("suspended_count"),
      blockedCount: sql<number>`count(*) filter (where ${users.isBlocked} = true)::int`.as("blocked_count"),
      deletedCount: sql<number>`count(*) filter (where ${users.isDeleted} = true)::int`.as("deleted_count"),
      adminsCount: sql<number>`count(*) filter (where ${users.role} = 'admin')::int`.as("admins_count"),
      teachersCount: sql<number>`count(*) filter (where ${users.role} = 'teacher')::int`.as("teachers_count"),
      studentsCount: sql<number>`count(*) filter (where ${users.role} = 'student')::int`.as("students_count"),
      parentsCount: sql<number>`count(*) filter (where ${users.role} = 'parent')::int`.as("parents_count"),
      newThisWeekCount: sql<number>`count(*) filter (where ${users.createdAt} > ${newThisWeekCutoff})::int`.as(
        "new_this_week_count"
      ),
    })
    .from(users);
  const row = rows[0];
  return {
    totalCount: row?.totalCount ?? 0,
    activeCount: row?.activeCount ?? 0,
    suspendedCount: row?.suspendedCount ?? 0,
    blockedCount: row?.blockedCount ?? 0,
    deletedCount: row?.deletedCount ?? 0,
    adminsCount: row?.adminsCount ?? 0,
    teachersCount: row?.teachersCount ?? 0,
    studentsCount: row?.studentsCount ?? 0,
    parentsCount: row?.parentsCount ?? 0,
    newThisWeekCount: row?.newThisWeekCount ?? 0,
  };
}

/**
 * Resolves the applicant-cooldown LIFECYCLE counters for the admin
 * dashboard panel in a SINGLE round-trip — one filtered-count aggregate
 * over `applicants INNER JOIN users` (shared-PK 1:1; the join carries
 * ONLY the directory's deleted-flag base predicate —
 * `coalesce(is_deleted, false) = false` — so a soft-deleted account's
 * applicant row can never inflate a bucket the deep-linked directory
 * would not list).
 *
 * All instants (now + the window cutoff) are computed in JS and bound
 * as Drizzle parameters — never SQL `now()` / `interval` — so the
 * statement stays engine-portable per the repository header. ONE
 * captured `now` feeds every arm; the three buckets stay mutually
 * exclusive within the snapshot.
 *
 * @returns The aggregate row (members are `::int`-cast counts; the
 *          empty-table edge case still yields one row of zeros because
 *          bare aggregates always return exactly one row).
 */
export async function getCooldownLifecycleStatsAggregate(tx?: DBTransaction): Promise<AdminCooldownLifecycleRow> {
  const now = new Date();
  const soonCutoff = new Date(now.getTime() + COOLDOWN_EXPIRING_SOON_DAYS * 24 * 60 * 60 * 1000);
  const rows = await (tx ?? db)
    .select({
      activeCount: sql<number>`count(*) filter (where ${applicants.cooldownUntil} > ${now})::int`.as(
        "cooldown_active_count"
      ),
      expiringSoonCount: sql<number>`count(*) filter (
            where ${applicants.cooldownUntil} > ${now}
              and ${applicants.cooldownUntil} <= ${soonCutoff}
          )::int`.as("cooldown_expiring_soon_count"),
      expiredCount: sql<number>`count(*) filter (where ${applicants.cooldownUntil} <= ${now})::int`.as(
        "cooldown_expired_count"
      ),
    })
    .from(applicants)
    .innerJoin(users, eq(users.id, applicants.id))
    .where(or(eq(users.isDeleted, false), isNull(users.isDeleted)) ?? sql`false`);
  const row = rows[0];
  return {
    activeCount: row?.activeCount ?? 0,
    expiringSoonCount: row?.expiringSoonCount ?? 0,
    expiredCount: row?.expiredCount ?? 0,
    // Echoed verbatim from the SAME constant the window predicate used —
    // the wire carries the window the count was measured with.
    expiringSoonWindowDays: COOLDOWN_EXPIRING_SOON_DAYS,
  };
}

/**
 * Resolves the "users by country" distribution for the admin directory
 * facet — TWO aggregate round-trips over `users` (no JOINs):
 *
 *  1. a GROUP BY over the stamped `country_code` for every NON-DELETED
 *     user whose code is stamped, ordered `count`-desc then code-asc
 *     (count ties break alphabetically — the ordering is deterministic,
 *     so repeated reads cannot shuffle the facet's chips);
 *  2. a scalar count of every NON-DELETED user (the denominator).
 *
 * The service layer owns the dataset logic: codes outside the shared
 * dataset vocabulary and the NULL-code population are jointly reported as
 * `unresolvedCount` = denominator − Σ(resolvable buckets) — the honest
 * remainder the facet renders as a muted caption. The repository returns
 * raw truth only (every stamped code, even an unresolvable one, plus the
 * active-population denominator), keeping the SQL free of dataset
 * coupling.
 *
 * The deleted-flag base predicate mirrors the directory listing and the
 * cooldown aggregate (`coalesce(is_deleted, false) = false`) — a
 * soft-deleted account can never inflate a bucket the deep-linked
 * directory would not list.
 *
 * @returns The raw envelope (counts are `::int`-cast; the empty-table
 *          edge case yields no GROUP BY rows and a zero denominator).
 */
export async function getCountryBreakdownAggregate(tx?: DBTransaction): Promise<AdminUserCountryBreakdownRow> {
  const bucketRows = await (tx ?? db)
    .select({
      code: users.countryCode,
      count: sql<number>`count(*)::int`.as("country_user_count"),
    })
    .from(users)
    .where(
      and(or(eq(users.isDeleted, false), isNull(users.isDeleted)) ?? sql`false`, isNotNull(users.countryCode)) ??
        sql`false`
    )
    .groupBy(users.countryCode)
    .orderBy(desc(sql`count(*)`), asc(users.countryCode));
  const activeTotalRows = await (tx ?? db)
    .select({ activeTotal: sql<number>`count(*)::int`.as("active_total") })
    .from(users)
    .where(or(eq(users.isDeleted, false), isNull(users.isDeleted)) ?? sql`false`);
  return {
    buckets: bucketRows.flatMap(row => (row.code === null ? [] : [{ code: row.code, count: row.count ?? 0 }])),
    activeTotal: activeTotalRows[0]?.activeTotal ?? 0,
  };
}
