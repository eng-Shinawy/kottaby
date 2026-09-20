/**
 * Analytics-cache convergence helpers for the dispute arbitration flow —
 * the focused sibling of `useResolveSessionDispute.ts` (the max-lines
 * split pattern of the repo's views).
 *
 * ONE responsibility: converge the cached `adminDisputeAnalytics`
 * snapshot (the `/disputes` glance card — open disputes, resolved total,
 * per-outcome chips) with ONE resolved arbitration. Without this arm the
 * glance card keeps the pre-arbitration numbers until an unrelated
 * refetch — the stale-stats drift observed in browser QA.
 *
 * Pure functions over the Apollo cache's stored field values (unknown in,
 * unknown out; the same idempotence contract as the queue filter in the
 * hook — a modifier that returns a fresh object on EVERY invocation
 * re-broadcasts forever, so a no-op MUST return the SAME reference).
 */
import { DisputeResolution } from "@/frontend/graphql/generated/gql/graphql";

/** The all-time aggregate snapshot field that must converge on arbitration. */
export const ADMIN_DISPUTE_ANALYTICS_FIELD = "adminDisputeAnalytics";

/** Field-keyed per-outcome counters of the analytics snapshot. */
type OutcomeCountField = "cancelCount" | "completeCount" | "refundCount" | "partialRefundCount" | "upholdCount";

/**
 * The exhaustive `DisputeResolution` → counter-field map. The `Record` over
 * the enum vocabulary forces every outcome to name its counter — an added
 * resolution fails the compile until mapped here.
 */
const OUTCOME_COUNT_FIELD: Readonly<Record<DisputeResolution, OutcomeCountField>> = {
  [DisputeResolution.Cancel]: "cancelCount",
  [DisputeResolution.Complete]: "completeCount",
  [DisputeResolution.Refund]: "refundCount",
  [DisputeResolution.PartialRefund]: "partialRefundCount",
  [DisputeResolution.Uphold]: "upholdCount",
};

/** Maps a `DisputeResolution` wire value onto the snapshot's counter field. */
function outcomeCountFieldOf(outcome: DisputeResolution): OutcomeCountField {
  return OUTCOME_COUNT_FIELD[outcome];
}

/**
 * The stored `adminDisputeAnalytics` snapshot shape — every field stays
 * `unknown` (cache storage is untrusted); the guard below proves presence,
 * the caller proves the numeric contract field by field.
 */
interface AnalyticsSnapshotShape {
  readonly openDisputes: unknown;
  readonly resolvedDisputes: unknown;
  readonly cancelCount: unknown;
  readonly completeCount: unknown;
  readonly refundCount: unknown;
  readonly partialRefundCount: unknown;
  readonly upholdCount: unknown;
}

/** The keys the convergence math needs, verified present before access. */
const SNAPSHOT_KEYS: readonly (keyof AnalyticsSnapshotShape)[] = [
  "openDisputes",
  "resolvedDisputes",
  "cancelCount",
  "completeCount",
  "refundCount",
  "partialRefundCount",
  "upholdCount",
];

/** Type guard: every analytics key is present on the stored snapshot. */
function isAnalyticsSnapshot(value: object): value is AnalyticsSnapshotShape {
  return SNAPSHOT_KEYS.every(key => key in value);
}

/**
 * Converges the stored `adminDisputeAnalytics` snapshot with ONE resolved
 * arbitration: the open count drops (clamped at zero), the resolved total
 * rises, and the chosen outcome's counter rises.
 *
 * NO-OP arms (SAME reference handed back):
 *  - the stored snapshot is absent or not an object;
 *  - any expected counter is missing or non-numeric (malformed storage);
 *  - `openDisputes` is already zero — a raced concurrent arbitration
 *    converged the snapshot first; rewriting would double-count the
 *    resolved total.
 */
export function applyResolutionToAnalytics(existing: unknown, outcome: DisputeResolution): unknown {
  const countField = outcomeCountFieldOf(outcome);
  // Runtime-validated storage (the repo's unknown-cache-storage convention):
  // the type guard proves the keys, the caller proves the numeric contract —
  // no assertions, and a malformed snapshot is a same-reference no-op.
  if (typeof existing !== "object" || existing === null || !isAnalyticsSnapshot(existing)) {
    return existing;
  }
  const open = existing.openDisputes;
  const resolved = existing.resolvedDisputes;
  const outcomeCount = existing[countField];
  if (typeof open !== "number" || typeof resolved !== "number" || typeof outcomeCount !== "number" || open === 0) {
    return existing;
  }
  return {
    ...existing,
    openDisputes: Math.max(0, open - 1),
    resolvedDisputes: resolved + 1,
    [countField]: outcomeCount + 1,
  };
}
