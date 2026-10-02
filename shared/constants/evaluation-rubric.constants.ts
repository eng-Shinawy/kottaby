/**
 * Evaluation rubric scoring constants — the numeric contract of the evaluator
 * rubric flow for teacher-applicant verification.
 *
 * `RUBRIC_PASS_THRESHOLD` is a per-evaluation minimum: every one of the five
 * cycle submissions must reach it for the applicant to pass; any single
 * submission below it fails the cycle (80 passes, 79 fails — it is not a
 * mean). `TAJWEED_COOLDOWN_DAYS` and `HIFZ_COOLDOWN_DAYS` are the
 * re-application cooldown lengths derived from the primary failure area of a
 * failed cycle, pinned to day counts. `RUBRIC_NOTES_MAX_LENGTH` bounds the
 * qualitative-observations field of a submission.
 *
 * Shared-layer isolation: this module imports nothing from the backend,
 * frontend, or app layers. It is safe to import from any layer.
 */

/** Minimum score per evaluation session for the submission to pass (per-evaluation minimum, not a mean). */
export const RUBRIC_PASS_THRESHOLD = 80 as const;

/** Re-application cooldown in days when the primary failure area is tajweed (day-count form). */
export const TAJWEED_COOLDOWN_DAYS = 30 as const;

/** Re-application cooldown in days when the primary failure area is hifz (day-count form). */
export const HIFZ_COOLDOWN_DAYS = 90 as const;

/** Maximum length of a rubric submission's qualitative-observations field. */
export const RUBRIC_NOTES_MAX_LENGTH = 2000 as const;
