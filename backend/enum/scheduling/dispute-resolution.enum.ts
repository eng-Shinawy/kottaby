/**
 * DisputeResolution enum — the admin arbitration vocabulary for exiting the
 * `disputed` lifecycle state. Values are canonical and wire-identical (the
 * GraphQL enum member name and its runtime value are the same string).
 * There is NO pgEnum backing this vocabulary — it is a pure transition
 * selector carried on the arbitration mutation, never stored as a column
 * value (the outcome it selects is recorded in `session.status`).
 *
 * Domain contract: `disputed` is NOT terminal — every disputed session is
 * resolved by an admin to exactly one terminal state:
 *  - `Cancel`   → the session becomes `cancelled`; a held fee is refunded
 *                 to its recorded provenance lane inside the arbitration
 *                 transaction (the same-lane primitive the participant
 *                 cancel uses).
 *  - `Complete` → the session becomes `completed`; the held fee is
 *                 consumed (`fee_held = false`, no wallet credit). A
 *                 disputed session that never started cannot complete.
 */
export enum DisputeResolution {
  Cancel = "Cancel",
  Complete = "Complete",
}

/**
 * Type guard for a runtime dispute-resolution value (from a transport
 * payload that may have skipped the GraphQL enum boundary). Returns `true`
 * only for exact member strings — the guard fails closed on any other
 * input (wrong type, case mismatch, whitespace, foreign values) rather
 * than throwing.
 */
export function isDisputeResolution(value: unknown): value is DisputeResolution {
  return typeof value === "string" && (Object.values(DisputeResolution) as string[]).includes(value);
}
