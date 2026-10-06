import type { teacher } from "@/backend/db/schema/teachers/teacher";

export type TeacherSelectType = typeof teacher.$inferSelect;

export interface TeacherColdStartCertificationInput {
  readonly userId: number;
  readonly makeEvaluator: boolean;
}

/**
 * The availability-toggle projection — the closed answer the availability
 * read and mutation both return.
 *
 * Deliberately minimal: the teacher id (stable identity for Apollo cache
 * normalization), the toggle flag (`is_online`, coerced to a total boolean
 * because the column is nullable), and the certification flag (`is_approved`,
 * coerced to a total boolean — the column is nullable, so a stored `null` is
 * reported as `false` = "not certified"). No added/updated stamps, no
 * applicant-lifecycle fields, no subjects/rating — BOPLA read-side whitelist.
 *
 * Excludability is expressed ONLY via `isOnline: false`; no parallel
 * `inSession` flag exists on this projection.
 */
export interface TeacherAvailabilityReturnType {
  readonly id: number;
  readonly isOnline: boolean;
  readonly isApproved: boolean;
}

/** Honest-counts result of the inactivity sweep — identities never cross the cron boundary. */
export interface TeacherInactivitySweepReturnType {
  readonly offlined: number;
}
