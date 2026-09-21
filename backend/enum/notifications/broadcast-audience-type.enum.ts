/**
 * BroadcastAudienceType — the closed vocabulary of cohort kinds an admin
 * broadcast can target. Every broadcast resolves its recipients through
 * exactly one of these four kinds: the whole governed user base (`all`),
 * a single user role (`role`), a single country (`country`), or the active
 * subscribers of a plan (`plan`).
 *
 * The enum types the runtime audience selector that arrives with a compose
 * request — individual notification rows record the resolved recipient, not
 * the cohort, so the selector itself is never persisted as a column type.
 * The matching `broadcast_audience_type` pgEnum persists the header table's
 * audience snapshot instead (one row per send records the targeted cohort),
 * while this enum remains the runtime source of truth for cohort resolution.
 */
export enum BroadcastAudienceType {
  All = "all",
  Role = "role",
  Country = "country",
  Plan = "plan",
}

/** Pre-allocated lookup set for O(1) membership check without per-call array allocations. */
const BROADCAST_AUDIENCE_TYPE_MEMBERS: ReadonlySet<string> = new Set(Object.values(BroadcastAudienceType));

/**
 * Type guard for a runtime audience-kind value (from a compose input or a
 * transport payload). Returns `true` only for exact member strings — the
 * guard fails closed on any other input (wrong type, case mismatch,
 * whitespace, foreign values) rather than throwing.
 */
export function isBroadcastAudienceType(value: unknown): value is BroadcastAudienceType {
  return typeof value === "string" && BROADCAST_AUDIENCE_TYPE_MEMBERS.has(value);
}
