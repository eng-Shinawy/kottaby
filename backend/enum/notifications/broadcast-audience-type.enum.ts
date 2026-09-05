/**
 * BroadcastAudienceType — the closed vocabulary of cohort kinds an admin
 * broadcast can target. Every broadcast resolves its recipients through
 * exactly one of these four kinds: the whole governed user base (`all`),
 * a single user role (`role`), a single country (`country`), or the active
 * subscribers of a plan (`plan`).
 *
 * The enum types the audience selector that arrives with a compose request;
 * it is never persisted as a column type — individual notification rows
 * record the resolved recipient, not the cohort — so it has no `pgEnum`
 * counterpart.
 */
export enum BroadcastAudienceType {
  All = "all",
  Role = "role",
  Country = "country",
  Plan = "plan",
}

/**
 * Type guard for a runtime audience-kind value (from a compose input or a
 * transport payload). Returns `true` only for exact member strings — the
 * guard fails closed on any other input (wrong type, case mismatch,
 * whitespace, foreign values) rather than throwing.
 */
export function isBroadcastAudienceType(value: unknown): value is BroadcastAudienceType {
  return typeof value === "string" && (Object.values(BroadcastAudienceType) as string[]).includes(value);
}
