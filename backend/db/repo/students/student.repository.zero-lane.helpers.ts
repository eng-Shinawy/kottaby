/**
 * StudentRepository subscription-lane zeroing write — the expiry-sweep
 * balance zeroing for an expired subscription's credited lane, extracted
 * from `student.repository.ts` following the sibling
 * `student.repository.credit-lane.helpers.ts` extraction convention: the
 * public surface stays the `StudentRepository` namespace in
 * `student.repository.ts` (this module backs the namespace's
 * `zeroLaneIfNoCoveringSubscription` method as a one-to-one delegation
 * target). Nothing in this module is part of the public API.
 *
 * Conventions carried over unchanged (per `backend/db/repo/AGENTS.md`):
 *  - the write takes `tx?: DBTransaction` as its LAST parameter and runs
 *    inside the caller's transaction when supplied, or standalone against
 *    the global handle otherwise;
 *  - no business logic, no permission checks, no i18n or logging — the
 *    caller decides what a `false` return means.
 */

import { sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { db } from "@/backend/db";
import { plans } from "@/backend/db/schema/billing/plans";
import { subscriptions } from "@/backend/db/schema/billing/subscriptions";
import { students } from "@/backend/db/schema/students/students";
import { SubscriptionCreditLane } from "@/backend/enum/billing/subscription-credit-lane.enum";
import { SubscriptionStatus } from "@/backend/enum/billing/subscription-status.enum";
import type { DBTransaction } from "@/backend/types";

/**
 * Frozen subscription-credit-lane → `students` balance-column resolution map
 * for the expiry zeroing write.
 *
 * Keys are the `SubscriptionCreditLane` enum members themselves — never
 * caller strings — so a zeroing statement can only ever target one of the
 * three subscription-credited balance columns. The
 * `Record<SubscriptionCreditLane, AnyPgColumn>` annotation makes a missing
 * enum member a compile error, and `Object.freeze` blocks any runtime
 * mutation of the resolution table.
 *
 * Deliberately separate from `LANE_BALANCE_COLUMNS` (student.repository.ts):
 * that map encodes which lanes may FUND a held session (trial included),
 * while expiry zeroing retires exactly the lanes a plan can credit. It is
 * also deliberately separate from `CREDIT_LANE_BALANCE_SETTERS`
 * (student.repository.credit-lane.helpers.ts): crediting tops a lane up,
 * zeroing burns it down — folding the two vocabularies together would let
 * either write reach for the other's semantics.
 *
 * `balance_trial` has no member here and can never gain one: the trial lane
 * is not subscription-bound and never expires, and the map is keyed by
 * `SubscriptionCreditLane` — a vocabulary with no trial member — so the
 * trial balance is structurally unreachable from this write.
 */
const ZERO_LANE_BALANCE_COLUMNS: Readonly<Record<SubscriptionCreditLane, AnyPgColumn>> = Object.freeze({
  [SubscriptionCreditLane.Hifz]: students.balanceHifz,
  [SubscriptionCreditLane.Tajweed]: students.balanceTajweed,
  [SubscriptionCreditLane.Reviews]: students.balanceReviews,
});

/**
 * Zeroes ONE student subscription-credit lane when no subscription still
 * covers that lane — the expiry-sweep write that retires an expired
 * subscription's credited period balance.
 *
 * ONE guarded conditional UPDATE per call: the row-identity predicate
 * (`students.id = $1`), the lane-positivity predicate
 * (`COALESCE(balance_<lane>, 0) > 0`) and the no-covering-subscription
 * anti-join (`NOT EXISTS` — no `active` or `pending` subscription of the
 * SAME user credits the SAME lane through its plan) share a single
 * statement with the zeroing write, so predicate evaluation and column
 * mutation occur under PostgreSQL's row lock with zero TOCTOU window. A
 * concurrent crediting/booking of the same row serializes behind that lock
 * and re-evaluates the predicate against the post-commit value — the same
 * guarded doctrine as `decrementLaneIfAvailable`. A zero-row result is the
 * caller's no-op signal: unknown student, lane already zero, or lane still
 * covered — the caller counts honestly and disambiguates the reason.
 *
 * The lane column is resolved exclusively through the frozen
 * `ZERO_LANE_BALANCE_COLUMNS` map keyed by `SubscriptionCreditLane` enum
 * members; caller strings can never select a column, and `balance_trial`
 * has no map member (structural trial exemption — see the map docblock).
 *
 * Enum members are bound as parameters (`p.balance_lane = $lane`,
 * `s.status IN ($active, $pending)`) — never string literals, never
 * interpolated SQL text — and the statement carries no inline comments.
 *
 * `updated_at` is stamped explicitly (`SET updated_at = now()`) because the
 * raw-SQL statement bypasses the query-builder's `$onUpdate` hook (same
 * explicit stamp the debit/refund/credit lane statements use).
 *
 * @returns `true` iff the row matched (the lane was positive and uncovered)
 *   and was zeroed; `false` when the student is unknown, the lane is
 *   already zero, or a covering subscription exists. The repository raises
 *   nothing.
 */
export async function zeroLaneIfNoCoveringSubscription(
  studentId: number,
  lane: SubscriptionCreditLane,
  tx?: DBTransaction
): Promise<boolean> {
  const balanceColumn = ZERO_LANE_BALANCE_COLUMNS[lane];
  const executor = tx ?? db;
  const result = await executor.execute<{ id: number }>(sql`
    UPDATE ${students}
    SET ${sql.identifier(balanceColumn.name)} = 0,
        ${sql.identifier(students.updatedAt.name)} = now()
    WHERE ${students.id} = ${studentId}
      AND COALESCE(${balanceColumn}, 0) > 0
      AND NOT EXISTS (
        SELECT 1
        FROM ${subscriptions} s
        JOIN ${plans} p ON p.id = s.plan_id
        WHERE s.user_id = ${studentId}
          AND p.balance_lane = ${lane}
          AND s.status IN (${SubscriptionStatus.Active}, ${SubscriptionStatus.Pending})
      )
    RETURNING ${students.id}
  `);
  return result.rows.length > 0;
}
