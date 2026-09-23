/**
 * StudentRepository subscription credit-lane write — the activation-time
 * balance crediting for a purchased subscription, extracted from
 * `student.repository.ts` (behavior-identical max-lines extraction: same
 * single UPDATE statement, same COALESCE semantics, same explicit
 * `updated_at = now()` stamp; only the emission path changed — query
 * builder instead of raw `execute()` — see the statement-shape note on
 * `creditLaneBalance` for the provider-divergence rationale). The public
 * surface stays the `StudentRepository` namespace in `student.repository.ts`:
 * this module backs the namespace's `creditLaneBalance` method as a
 * one-to-one delegation target. Nothing in this module is part of the
 * public API.
 *
 * Conventions carried over unchanged (per `backend/db/repo/AGENTS.md`):
 *  - the write takes `tx?: DBTransaction` as its LAST parameter and runs
 *    inside the caller's transaction when supplied, or standalone against
 *    the global handle otherwise;
 *  - no business logic, no permission checks, no i18n or logging — the
 *    caller decides what a `null` return means.
 */

import { eq, sql } from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";
import { db } from "@/backend/db";
import { students } from "@/backend/db/schema/students/students";
import { SubscriptionCreditLane } from "@/backend/enum/billing/subscription-credit-lane.enum";
import type { DBTransaction, StudentSelectType } from "@/backend/types";

/**
 * Frozen subscription-credit-lane → `students` balance SET-clause builder map.
 *
 * Keys are the `SubscriptionCreditLane` enum members themselves — never
 * caller strings — so a credit statement can only ever target one of the
 * three real balance columns. The `Record<SubscriptionCreditLane, ...>`
 * annotation makes a missing enum member a compile error, and
 * `Object.freeze` blocks any runtime mutation of the resolution table.
 * Each value builds the `SET` fragment for its lane: a RELATIVE
 * `COALESCE(balance_x, 0) + amount` increment against that lane's own
 * column (the same expression the raw-SQL form emitted), inlined into the
 * query-builder `.set({ ... })` spread.
 *
 * Deliberately separate from `LANE_BALANCE_COLUMNS` (student.repository.ts):
 * that map encodes which lanes may FUND a held session (the reviews lane
 * never does), while activation crediting tops up whichever lane the
 * purchased plan names — reviews included. Folding the two vocabularies
 * together would let a held-fee debit drain the review lane, so the credit
 * map carries its own exhaustive three-lane key set.
 */
const CREDIT_LANE_BALANCE_SETTERS: Readonly<
  Record<SubscriptionCreditLane, (amount: number) => PgUpdateSetSource<typeof students>>
> = Object.freeze({
  [SubscriptionCreditLane.Hifz]: amount => ({
    balanceHifz: sql`COALESCE(${students.balanceHifz}, 0) + ${amount}`,
  }),
  [SubscriptionCreditLane.Tajweed]: amount => ({
    balanceTajweed: sql`COALESCE(${students.balanceTajweed}, 0) + ${amount}`,
  }),
  [SubscriptionCreditLane.Reviews]: amount => ({
    balanceReviews: sql`COALESCE(${students.balanceReviews}, 0) + ${amount}`,
  }),
});

/**
 * Credits `amount` session units to ONE student balance lane — the
 * activation-time write for a purchased subscription.
 *
 * ONE unguarded UPDATE (`SET balance_<lane> = balance_<lane> + amount
 * WHERE id = ? RETURNING`), mirroring `incrementLane`: crediting only ever
 * adds, so there is no balance predicate to race on, and the
 * `balance_* >= 0` CHECK constraints remain the DB-layer backstop (an
 * increment can only violate them via a negative amount, which the
 * purchase flow never produces). The lane column is resolved exclusively
 * through the frozen `CREDIT_LANE_BALANCE_SETTERS` map keyed by
 * `SubscriptionCreditLane` enum members; caller strings can never select
 * a column.
 *
 * Statement shape — the UPDATE is emitted through the Drizzle query
 * builder (`update().set().where().returning()`), NOT through raw
 * `executor.execute()`. Both forms compile to the identical SQL, but the
 * raw `execute()` path is NOT provider-agnostic for timestamp columns:
 * drizzle-orm 1.0.0-rc.4's node-postgres session passes a noop type parser
 * for TIMESTAMP/TIMESTAMPTZ/DATE to every `client.query()`, so a raw
 * `RETURNING updated_at` comes back as a STRING on real PostgreSQL, while
 * the PGlite shim (which drops that `types` override) parses it into a
 * `Date` — violating the `StudentSelectType` contract on exactly one
 * provider. The query builder decodes RETURNING values through drizzle's
 * column codecs on BOTH providers, so the returned row always carries real
 * `Date` timestamps with zero provider branching and zero manual parsing.
 *
 * NULL-lane convention — a NULL lane credits from ZERO: the SET coalesces
 * the target column (`COALESCE(balance_x, 0) + amount`), so a
 * legacy/degenerate NULL lane is seeded with the credited amount instead
 * of the NULL-arithmetic no-op that would return the row untouched and
 * commit a paid activation with a still-NULL balance. Columns default to
 * 0 at registration — NULL is legacy-only — and the `>= 0` CHECK
 * constraints remain the DB-layer backstop (an increment can only violate
 * them via a negative amount, which the purchase flow never produces).
 *
 * `updated_at` is stamped explicitly (`SET updated_at = now()`) because
 * the credit targets a lane column and must not rely on the query
 * builder's `$onUpdate` hook firing order (same explicit stamp the
 * debit/refund raw statements use).
 *
 * @returns The updated student row, or null when the student does not
 *   exist (the caller decides what the miss means — the repository raises
 *   nothing).
 */
export async function creditLaneBalance(
  studentId: number,
  lane: SubscriptionCreditLane,
  amount: number,
  tx?: DBTransaction
): Promise<StudentSelectType | null> {
  const [row] = await (tx ?? db)
    .update(students)
    .set({ ...CREDIT_LANE_BALANCE_SETTERS[lane](amount), updatedAt: sql`now()` })
    .where(eq(students.id, studentId))
    .returning();
  return row ?? null;
}
