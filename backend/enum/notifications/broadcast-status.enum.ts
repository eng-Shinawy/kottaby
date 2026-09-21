/**
 * BroadcastStatus — the one-way lifecycle state of a first-class broadcast
 * header row. A broadcast is born `active` when its send transaction commits
 * and may transition exactly once to `stopped` (the stop retracts the
 * broadcast's notification rows); `stopped` is terminal — no reactivate path
 * exists.
 *
 * The enum is the runtime source of truth for the lifecycle: the stop path's
 * compare-and-swap predicate and any consumer that reads a header row's
 * status use these members. It mirrors the `broadcast_status` pgEnum
 * byte-for-byte, which persists the status column on the `broadcasts` table.
 */
export enum BroadcastStatus {
  Active = "active",
  Stopped = "stopped",
}

/**
 * Type guard for a runtime broadcast-status value (from a transport payload
 * or a persisted row read-back). Returns `true` only for exact member
 * strings — the guard fails closed on any other input (wrong type, case
 * mismatch, whitespace, foreign values) rather than throwing.
 */
export function isBroadcastStatus(value: unknown): value is BroadcastStatus {
  return typeof value === "string" && (Object.values(BroadcastStatus) as string[]).includes(value);
}
