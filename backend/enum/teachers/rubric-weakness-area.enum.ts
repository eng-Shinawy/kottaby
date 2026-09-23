/**
 * RubricWeaknessArea enum — the primary-weakness vocabulary recorded on a
 * rubric evaluation (`evaluations.weakness_area`, pgEnum
 * `rubric_weakness_area` in backend/db/schema/enums.ts). Canonical values:
 * 'tajweed', 'hifz'. A rubric submission carries a weakness area when — and
 * only when — its score is below the pass threshold, and the recorded area
 * determines the re-application cooldown length on a failed verification
 * cycle.
 *
 * This is deliberately NOT the `session_intent` vocabulary: a session's
 * purpose classification ('hifz'/'tajweed'/'evaluation') and an applicant's
 * failure area are different domains that merely share two words.
 */
export enum RubricWeaknessArea {
  Tajweed = "tajweed",
  Hifz = "hifz",
}

/** Pre-allocated lookup set for O(1) membership check without per-call array allocations. */
const RUBRIC_WEAKNESS_AREA_MEMBERS: ReadonlySet<string> = new Set(Object.values(RubricWeaknessArea));

/**
 * Type guard for a runtime weakness-area value (from a transport payload).
 * Returns `true` only for exact member strings — the guard fails closed on
 * any other input (wrong type, case mismatch, whitespace, foreign values)
 * rather than throwing.
 */
export function isRubricWeaknessArea(value: unknown): value is RubricWeaknessArea {
  return typeof value === "string" && RUBRIC_WEAKNESS_AREA_MEMBERS.has(value);
}
