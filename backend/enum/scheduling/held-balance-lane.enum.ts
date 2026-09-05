/**
 * HeldBalanceLane enum — canonical provenance vocabulary for the held-fee
 * lane recorded on a session (`session.held_balance_lane`, varchar(20)).
 * Canonical values: 'trial', 'hifz', 'tajweed'. There is NO pgEnum backing
 * this column — this TS enum plus its guard are the sole runtime authority.
 *
 * Domain contract: when a session booking places a hold on a student balance
 * lane, the lane that funded the hold is recorded here, and a cancellation
 * refund is always returned to that same recorded lane. The column is
 * nullable — NULL only while no fee has ever been held; once a hold is
 * placed the recorded lane is PERMANENT provenance and is never nulled:
 * release and consumption flip the session's `fee_held` marker only, and
 * the lane survives as the refund driver every later same-lane release
 * reads. The `students` reviews lane is deliberately NOT part of this
 * vocabulary: it never funds held session fees.
 */
export enum HeldBalanceLane {
  Trial = "trial",
  Hifz = "hifz",
  Tajweed = "tajweed",
}

/**
 * Type guard for a runtime held-balance-lane value (from a varchar row or a
 * transport payload). Returns `true` only for exact member strings — the
 * guard fails closed on any other input (wrong type, case mismatch,
 * whitespace, foreign values) rather than throwing.
 */
export function isHeldBalanceLane(value: unknown): value is HeldBalanceLane {
  return typeof value === "string" && (Object.values(HeldBalanceLane) as string[]).includes(value);
}
