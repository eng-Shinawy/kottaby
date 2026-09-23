/**
 * StudentRepository exact lane-value write — the admin plan-change
 * settlement write, extracted from `student.repository.ts` following the
 * file's sibling-helper convention (the credit-lane and zero-lane
 * modules). The public surface stays the `StudentRepository` namespace:
 * `student.repository.ts` backs its `setLaneBalanceValue` method with a
 * one-to-one delegation to this module. Nothing here is part of the
 * public API.
 *
 * Conventions per `backend/db/repo/AGENTS.md`:
 *  - the write takes `tx?: DBTransaction` as its LAST parameter and runs
 *    inside the caller's transaction when supplied, or standalone against
 *    the global handle otherwise;
 *  - no business logic, no permission checks, no i18n or logging — the
 *    caller decides what a `null` return (vanished student row) or a
 *    raised CHECK violation means.
 */

import { eq, sql } from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";
import { db } from "@/backend/db";
import { students } from "@/backend/db/schema/students/students";
import { SubscriptionCreditLane } from "@/backend/enum/billing/subscription-credit-lane.enum";
import type { DBTransaction, StudentSelectType } from "@/backend/types";

/**
 * Frozen subscription-credit-lane → `students` balance SET-clause builder
 * map for EXACT-value writes.
 *
 * Keys are the `SubscriptionCreditLane` enum members themselves — never
 * caller strings — so a settlement statement can only ever target one of
 * the real balance columns (`Object.freeze` blocks runtime mutation; the
 * `Record<SubscriptionCreditLane, ...>` annotation makes a missing enum
 * member a compile error). Each value builds the SET fragment setting its
 * lane's column to the caller-supplied exact value.
 *
 * Deliberately separate from `CREDIT_LANE_BALANCE_SETTERS`
 * (student.repository.credit-lane.helpers.ts): that map builds RELATIVE
 * `COALESCE(...) + amount` increments for activation crediting, while a
 * plan-change settlement must land ONE prepared exact total — overwriting
 * the old lane's remaining contribution with the new plan's entitlement
 * (plus a computed carry on the upgrade leg) is the documented
 * cancel-and-reset semantics, and a relative increment could not express
 * it. The `balance_* >= 0` CHECK constraints stay the DB-layer backstop:
 * the value is computed server-side and never negative, so a violation
 * can only mean a broken caller contract and surfaces as the raw 23514
 * for the service tier to translate.
 */
const LANE_BALANCE_VALUE_SETTERS: Readonly<
  Record<SubscriptionCreditLane, (value: number) => PgUpdateSetSource<typeof students>>
> = Object.freeze({
  [SubscriptionCreditLane.Hifz]: value => ({ balanceHifz: value }),
  [SubscriptionCreditLane.Tajweed]: value => ({ balanceTajweed: value }),
  [SubscriptionCreditLane.Reviews]: value => ({ balanceReviews: value }),
});

/**
 * Sets ONE student balance lane to an EXACT value in a single guarded
 * UPDATE (`SET balance_<lane> = <value>, updated_at = now() WHERE id = ?
 * RETURNING`) — the atomic swap the plan-change settlement relies on:
 * concurrent booking debits that landed between the caller's read and
 * this write are superseded by the prepared total instead of racing a
 * relative increment. The lane column is resolved exclusively through the
 * frozen `LANE_BALANCE_VALUE_SETTERS` map keyed by `SubscriptionCreditLane`
 * enum members; caller strings can never select a column. `updated_at` is
 * stamped explicitly (the same raw-stamp idiom as the credit/debit
 * statements).
 *
 * @returns The updated student row, or null when the student does not
 *   exist (the caller decides what the miss means — the repository raises
 *   nothing). A value below zero raises the raw `balance_* >= 0` CHECK
 *   violation (23514) untranslated.
 */
export async function setLaneBalanceValue(
  studentId: number,
  lane: SubscriptionCreditLane,
  newValue: number,
  tx?: DBTransaction
): Promise<StudentSelectType | null> {
  const [row] = await (tx ?? db)
    .update(students)
    .set({ ...LANE_BALANCE_VALUE_SETTERS[lane](newValue), updatedAt: sql`now()` })
    .where(eq(students.id, studentId))
    .returning();
  return row ?? null;
}
