/**
 * SubscriptionExpiryService — the system-scope expiry sweep that retires
 * past-window subscription cohorts and settles their credited balances.
 *
 * The scheduled caller (a fail-closed cron route) delegates here; the sweep
 * is ONE transaction for the whole cohort:
 *
 *   1. ONE captured `now` — a single clock reading governs every window
 *      comparison and every settlement decision in the sweep;
 *   2. the guarded batch flip — `SubscriptionRepository.expireDueActive`
 *      moves every `active` row whose validity window has closed to
 *      `expired` and reports the flipped rows' `{ id, userId, planId }`
 *      projections; a zero-row result is the replay/no-op branch, so a
 *      repeated or overlapping sweep converges on the same terminal state;
 *   3. plan-lane resolution — ONE batched read of the expired rows' plan
 *      ids resolves each plan's credited balance lane on the same
 *      transaction (one `inArray` round-trip, never per-row reads);
 *   4. conditional lane zeroing — each DISTINCT (owner, lane) pair is
 *      zeroed at most once through
 *      `StudentRepository.zeroLaneIfNoCoveringSubscription`, the guarded
 *      statement that skips lanes still covered by another `active` or
 *      `pending` subscription and leaves the trial balance structurally
 *      unreachable. Every zeroing runs on the sweep's transaction, so a
 *      flip and its zeroings commit together or not at all.
 *
 * Configuration gaps fail safe, not silent: a plan row whose credited lane
 * was never configured (NULL `balance_lane`) is skipped with one correlated
 * warning — its subscription is still flipped, only the zeroing is
 * withheld. An out-of-vocabulary stored lane (unreachable through the pg
 * enum — code/vocabulary drift) or a vanished plan row (the FK restrict
 * makes it unreachable while a subscription references the plan) aborts the
 * whole cohort closed: the transaction rolls back, nothing is half-swept.
 *
 * The return is counts-only (`{ expired, lanesZeroed }`): honest counts
 * produced by the guarded statements, no row identities — the scheduled
 * envelope carries it verbatim, and a replayed sweep honestly reports
 * `{ expired: 0, lanesZeroed: 0 }`. There is deliberately NO notification
 * fan-out and NO audit write: the sweep is system-scope and actor-less, so
 * no notification recipient and no audit actor exists — observability is
 * the structured log lines (ids and counts only, never payloads) plus the
 * returned counts.
 *
 * `outerTx` is the canonical test-path seam (a caller-owned transaction
 * runs the sweep as a SAVEPOINT on it); production callers omit it and the
 * sweep opens its own transaction. With a caller-owned transaction, an
 * induced mid-cohort failure rolls back only the savepoint — the outer
 * transaction stays usable, which is what the atomicity probe asserts.
 */

import { PlanRepository, StudentRepository, SubscriptionRepository } from "@/backend/db/repo";
import { SubscriptionCreditLane } from "@/backend/enum/billing/subscription-credit-lane.enum";
import { withTransaction } from "@/backend/lib/db/with-transaction";
import { logger } from "@/backend/lib/logger";
import type { DBTransaction, PlanSelectType, SubscriptionExpirySweepReturnType } from "@/backend/types";

/**
 * Client-safe copy for the sweep's internal-invariant aborts. These aborts
 * are unreachable through the guarded statements; the DIAGNOSTIC detail
 * belongs to the adjacent correlated log line — never to the scheduled
 * caller's error envelope.
 */
const SWEEP_ABORTED_MESSAGE = "Subscription expiry could not be completed.";

/**
 * Fail-closed abort for an unreachable mid-sweep state — one bounded
 * diagnostic log (the exact breach, correlated ids only) plus the
 * client-safe copy. Throwing from inside the sweep transaction rolls the
 * whole cohort back. The thrown value is deliberately a NON-domain `Error`
 * (sibling precedent: the raw-throw aborts in
 * `session-lifecycle.transitions.ts`): the scheduled caller masks every
 * thrown failure to a generic 500 `INTERNAL_SERVER_ERROR` envelope — a
 * domain class would instead pass its own code through `apiErrorResponse`.
 */
function abortSweep(detail: string, context: Record<string, unknown>): never {
  logger.error(`Subscription expiry sweep aborted: ${detail} — cohort rolled back`, context);
  throw new Error(SWEEP_ABORTED_MESSAGE);
}

/**
 * The lane vocabulary, widened to plain strings for the stored-union
 * comparison treatment (enum-member derived, never a bare literal).
 */
const LANE_HIFZ: string = SubscriptionCreditLane.Hifz;
const LANE_TAJWEED: string = SubscriptionCreditLane.Tajweed;
const LANE_REVIEWS: string = SubscriptionCreditLane.Reviews;

/**
 * Maps a plan row's stored balance-lane value onto the strongly-typed enum
 * the zeroing primitive requires — FAIL-CLOSED over the closed pg-enum
 * vocabulary. Every writable member is mapped explicitly (hifz, tajweed,
 * reviews — never a cast), and the default is an unreachable invariant
 * breach (vocabulary drift between the DB enum and this code) that aborts
 * the whole sweep closed instead of zeroing a DIFFERENT lane than the plan
 * designated (loud over silent-wrong).
 */
function subscriptionCreditLaneOf(
  lane: PlanSelectType["balanceLane"] & string,
  correlation: { readonly subscriptionId: number; readonly userId: number; readonly planId: number }
): SubscriptionCreditLane {
  switch (lane) {
    case LANE_HIFZ:
      return SubscriptionCreditLane.Hifz;
    case LANE_TAJWEED:
      return SubscriptionCreditLane.Tajweed;
    case LANE_REVIEWS:
      return SubscriptionCreditLane.Reviews;
    default:
      return abortSweep("stored plan balance lane is not a member of the closed credit-lane vocabulary", {
        ...correlation,
        storedLane: lane,
      });
  }
}

/**
 * One settlement target: a distinct (owner, lane) pair derived from the
 * expired cohort. The owner is the subscription row's `user_id` — the same
 * shared key the students table's PK carries — and the lane is the
 * plan-resolved `SubscriptionCreditLane` member.
 */
interface ZeroingPair {
  readonly studentId: number;
  readonly lane: SubscriptionCreditLane;
}

/**
 * Walks the settlement pairs SEQUENTIALLY — one guarded zeroing statement
 * per pair on the sweep transaction, head-first, before the next pair is
 * touched (the same shape as the session sweeper's refund walk). Each
 * await yields and unwinds the stack, so the recursion only happens ACROSS
 * awaits, and a failure leaves the walk's partial writes to the
 * transaction's own rollback. The count is honest: only pairs whose
 * guarded statement matched (lane positive and uncovered) increment it.
 */
async function zeroPairsSequentially(pairs: readonly ZeroingPair[], index: number, tx: DBTransaction): Promise<number> {
  const pair = pairs.at(index);
  if (pair === undefined) {
    return 0;
  }
  const zeroedHere = (await StudentRepository.zeroLaneIfNoCoveringSubscription(pair.studentId, pair.lane, tx)) ? 1 : 0;
  return zeroedHere + (await zeroPairsSequentially(pairs, index + 1, tx));
}

export namespace SubscriptionExpiryService {
  /**
   * Sweeps every past-window `active` subscription to `expired` and
   * conditionally zeroes the credited balance lanes, all inside ONE
   * transaction.
   *
   * The `now` comparison instant is captured exactly once, inside the
   * transaction, before the batch flip — one clock reading governs the
   * whole cohort. The plan-lane resolution is ONE batched read on the same
   * transaction; the zeroing walk is sequential by design (one pair at a
   * time, each a single guarded statement), so a failure lands on a
   * well-defined row boundary and the transaction-wide rollback leaves no
   * half-swept cohort.
   *
   * @param outerTx  Optional outer transaction. When provided (test path),
   *     the sweep runs inside a SAVEPOINT on it; production callers omit
   *     it and the sweep opens its own transaction.
   * @returns Honest counts — how many subscriptions were flipped to
   *     `expired` by this run and how many (owner, lane) pairs were
   *     actually zeroed. A replay (or an overlapping sweep that loses the
   *     race) reports zeroes, never re-applied effects.
   */
  export async function expireDue(outerTx?: DBTransaction): Promise<SubscriptionExpirySweepReturnType> {
    return withTransaction(outerTx, async tx => {
      const now = new Date();
      const due = await SubscriptionRepository.expireDueActive(now, tx);
      if (due.length === 0) {
        logger.debug("Subscription expiry sweep matched no due rows — nothing to settle");
        return { expired: 0, lanesZeroed: 0 };
      }

      // ONE batched plan read for the whole cohort — the repository-layer
      // `inArray` read on the sweep's transaction (never per-row reads,
      // never a prepared statement: the pg protocol cannot expand arrays).
      const planRows = await PlanRepository.findBalanceLanesByIds([...new Set(due.map(row => row.planId))], tx);
      const storedLaneByPlanId = new Map<number, PlanSelectType["balanceLane"]>(
        planRows.map(row => [row.id, row.balanceLane])
      );

      // Resolve the settlement pairs. NULL-lane plans are a configuration
      // gap: the flip stands, the zeroing is skipped with one correlated
      // warning (fail-safe, not fail-silent). A missing plan row is an
      // invariant breach and aborts the cohort closed.
      const zeroingPairs = new Map<string, ZeroingPair>();
      for (const row of due) {
        const correlation = { subscriptionId: row.id, userId: row.userId, planId: row.planId };
        const storedLane = storedLaneByPlanId.get(row.planId);
        if (storedLane === undefined) {
          abortSweep("expired subscription's plan row is missing", correlation);
        }
        if (storedLane === null) {
          logger.warn("Subscription expiry skipped balance zeroing: plan has no credited lane configured", {
            ...correlation,
          });
          continue;
        }
        const lane = subscriptionCreditLaneOf(storedLane, correlation);
        const pairKey = `${row.userId}:${lane}`;
        if (!zeroingPairs.has(pairKey)) {
          zeroingPairs.set(pairKey, { studentId: row.userId, lane });
        }
      }

      // The zeroing walk — sequential, same transaction (see
      // `zeroPairsSequentially`). A `true` return means the guarded
      // statement matched (lane positive and uncovered); `false` covers
      // already-zero and still-covered lanes, both honest no-ops that
      // count as nothing.
      const lanesZeroed = await zeroPairsSequentially([...zeroingPairs.values()], 0, tx);

      return { expired: due.length, lanesZeroed };
    });
  }
}
