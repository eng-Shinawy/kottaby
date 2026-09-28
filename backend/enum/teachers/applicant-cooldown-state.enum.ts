/**
 * ApplicantCooldownState enum — the derived cooldown read-model vocabulary
 * for the applicant lifecycle domain. The state is computed server-side at
 * read time from `applicants.cooldown_until` against a single captured
 * "now" instant; it is NEVER persisted and NO pgEnum backs it — this TS
 * enum plus its guard are the sole runtime authority. Canonical values:
 * 'none' (no cooldown stamped), 'active' (cooldown still in force),
 * 'expired' (cooldown window has passed).
 *
 * Boundary contract (see docs/teachers/applicant-lifecycle.md §2.1): the
 * active predicate is a strict `cooldown_until > now` — a cooldown expiring
 * exactly at the captured instant is already 'expired' and no longer gates.
 */
export enum ApplicantCooldownState {
  None = "none",
  Active = "active",
  Expired = "expired",
}

/** Pre-allocated lookup set for O(1) membership check without per-call array allocations. */
const APPLICANT_COOLDOWN_STATE_MEMBERS: ReadonlySet<string> = new Set(Object.values(ApplicantCooldownState));

/**
 * Type guard for a runtime cooldown-state value (from a transport payload).
 * Returns `true` only for exact member strings — the guard fails closed on
 * any other input (wrong type, case mismatch, whitespace, foreign values)
 * rather than throwing.
 */
export function isApplicantCooldownState(value: unknown): value is ApplicantCooldownState {
  return typeof value === "string" && APPLICANT_COOLDOWN_STATE_MEMBERS.has(value);
}
