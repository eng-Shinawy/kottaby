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

/**
 * Outcome of a marker-gated in-session lock release.
 *
 * While a teacher holds one or more `started` sessions, their availability
 * (`is_online`) is forced offline and the availability intent in force at
 * lock acquisition is persisted in the `was_online_before_lock` marker
 * (`NULL` = no lock held). When a session reaches a terminal state, the
 * release writer attempts to restore that intent exactly once — on the last
 * started exit — and classifies the attempt into exactly one of:
 *
 * - `"released"` — the teacher held the lock (marker set) and no other
 *   `started` session remains: the pre-lock availability intent has been
 *   restored into `is_online` and the marker cleared. The only
 *   state-changing outcome.
 * - `"no_lock_held"` — the marker is `NULL`: the teacher holds no in-session
 *   lock (the lock was never acquired, was already restored by an earlier
 *   terminal exit, or the row predates lock tracking). A benign no-op —
 *   nothing is written.
 * - `"active_sessions_remain"` — the marker is still set, but at least one
 *   other `started` session keeps the lock open, so the restore is deferred
 *   until that session's own terminal exit. The row is returned unchanged.
 */
export type TeacherInSessionLockReleaseOutcomeType =
  | "released" // marker restored into is_online, marker cleared
  | "no_lock_held" // marker was NULL — benign no-op (never-started / polluted / double release)
  | "active_sessions_remain"; // another started session defers the restore

/**
 * The classified result of attempting to release a teacher's in-session
 * lock: which outcome materialized, plus the teacher row as it stands after
 * the attempt (post-restore when the outcome is `"released"`, unchanged
 * otherwise). Callers branch on `outcome` rather than comparing rows, so a
 * redundant release attempt stays a safe, side-effect-free no-op whenever
 * the outcome is not `"released"`.
 */
export interface TeacherInSessionLockReleaseResultType {
  readonly outcome: TeacherInSessionLockReleaseOutcomeType;
  readonly teacher: TeacherSelectType; // the current row (post-update on "released")
}

/** Honest-counts result of the inactivity sweep — identities never cross the cron boundary. */
export interface TeacherInactivitySweepReturnType {
  readonly offlined: number;
}
