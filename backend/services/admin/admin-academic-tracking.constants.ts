/**
 * Admin academic tracking — the named attention-rule constants behind the
 * "students needing attention" flags on the admin academic dashboard.
 *
 * The rules are pure per-request derivations over committed homework rows:
 * nothing here is persisted, nothing is client-configurable, and the
 * numeric literals exist ONLY in this file — the flag composer reads them
 * by name so the thresholds stay greppable and reviewable in one place.
 *
 * Semantics (canonical definitions for tests, services, and docs):
 *
 *  - `lowGrade`: the average of the student's most recent graded Jadid
 *    (new-memorization) homework grades is STRICTLY BELOW
 *    {@linkcode NEEDS_ATTENTION_LOW_AVG_GRADE} on the [0, 100] homework
 *    grade scale. An average of exactly the threshold is healthy. Fewer
 *    grades than the window averages over what exists; a student with
 *    ZERO graded Jadid rows is never flagged (absence of grades is not
 *    failure).
 *  - `staleProgress`: the student has at least one completed session AND
 *    zero graded homework rows inside the last
 *    {@linkcode NEEDS_ATTENTION_STALE_DAYS} days. Staleness anchors on the
 *    graded rows' grade-write timestamps, falling back to the newest
 *    assignment's creation stamp for never-graded students; "now" is the
 *    single captured transaction timestamp so every student on one
 *    dashboard snapshot is measured against the same instant. The
 *    boundary is inclusive: activity at exactly N days ago still counts
 *    as inside the window.
 */

/**
 * The low-average grade threshold on the [0, 100] homework grade scale:
 * `lowGrade` flags a student whose recent graded Jadid average is strictly
 * below this value (the threshold itself is healthy).
 */
export const NEEDS_ATTENTION_LOW_AVG_GRADE = 60;

/**
 * The recent-graded Jadid window size: the `lowGrade` average is taken
 * over the student's NEWEST graded Jadid grades up to this many rows
 * (newest first), averaging over fewer when the student has graded less.
 */
export const NEEDS_ATTENTION_RECENT_WINDOW = 10;

/**
 * The staleness window in days: `staleProgress` flags a student with at
 * least one completed session and zero graded homework rows in the last
 * this-many days (activity at exactly the boundary is inside the window).
 */
export const NEEDS_ATTENTION_STALE_DAYS = 14;
