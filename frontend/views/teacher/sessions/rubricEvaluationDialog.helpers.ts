/**
 * Pure draft resolution for the rubric dialog — the client MIRROR of the
 * wire validation (the server stays the authority):
 *
 *  - `parseRubricScore` folds the raw score text into a wire-legal verdict
 *    number (whole number inside the 0..100 band) or null.
 *  - `resolveRubricDraft` validates one draft snapshot and either reports
 *    the per-field error flags (empty/out-of-band score, empty notes,
 *    missing weakness below the threshold) or seals the submit payload —
 *    the locator-excluded `{score, notes, weaknessArea}` members ONLY,
 *    with the weakness area forced to null outside the below-threshold
 *    band so an above-threshold submit can never carry one.
 */

import type { RubricEvaluationSubmitInput, RubricWeaknessArea } from "@/frontend/graphql/generated/gql/graphql";
import { formatApplicantDate } from "@/frontend/lib/i18n/format-date";
import { formatRelativeAuditStamp } from "@/frontend/lib/i18n/relative-time";

/** One draft snapshot of the rubric dialog. */
export interface RubricDraft {
  /** The raw score text as typed. */
  readonly scoreText: string;
  /** The raw notes text as typed (trimmed for the wire). */
  readonly notes: string;
  /** The picked weakness area, or null while nothing is chosen. */
  readonly weaknessArea: RubricWeaknessArea | null;
  /** Whether the draft's legal score sits below the pass threshold. */
  readonly weaknessRequired: boolean;
}

/** Per-field error flags for one invalid draft. */
interface RubricDraftErrorFlags {
  readonly score: boolean;
  readonly notes: boolean;
  readonly weakness: boolean;
}

/** Either the sealed submit payload or the error flags blocking it. */
export interface RubricDraftResolution {
  readonly errors: RubricDraftErrorFlags;
  readonly input: RubricEvaluationSubmitInput | null;
}

/**
 * Strict decimal-integer grammar for the score draft — one to three ASCII
 * digits, nothing else. The JS `Number()` spellings (hex `0x10`, exponent
 * `1e2`, signed and decimal-point forms) are rejected so the client mirror
 * stays as strict as the server's 0..100 band.
 */
const RUBRIC_SCORE_TEXT_PATTERN = /^\d{1,3}$/;

/**
 * Parses the score draft into a wire-legal verdict number — a whole number
 * inside the 0..100 band — or null when the draft is empty, not a strict
 * decimal-integer spelling (fractional, hex, exponent, or signed forms),
 * or out of range.
 */
export function parseRubricScore(scoreText: string): number | null {
  const trimmed = scoreText.trim();
  if (trimmed === "") return null;
  if (!RUBRIC_SCORE_TEXT_PATTERN.test(trimmed)) return null;
  const score = Number(trimmed);
  if (score < 0 || score > 100) return null;
  return score;
}

/** The all-clear flags (fresh draft state). */
const NO_DRAFT_ERRORS: RubricDraftErrorFlags = { score: false, notes: false, weakness: false };

/**
 * The restored draft's saved-at provenance pair — the audit-trail When-cell's
 * two-line composition as ONE pure value: a RELATIVE "saved ago" glance
 * through the shared bounded ladder (null beyond the 7-day window or for a
 * future-dated stamp) and the deterministic ABSOLUTE stamp beside it. The
 * dialog renders the relative caption in the glance line's value slot and
 * the absolute as the precision line beneath (out-of-window drafts read
 * absolutely on the glance line alone); `now` is injectable so the suite
 * pins the window boundary without a ticking clock.
 */
export interface RubricSavedAtStamps {
  /** The bounded relative glance, or null outside the window / in the future. */
  readonly relative: string | null;
  /** The deterministic UTC absolute stamp (locale digits). */
  readonly absolute: string;
}

/** Resolves the saved-at stamp pair for one parked-draft provenance stamp. */
export function rubricSavedAtStamps(savedAtMs: number, locale: string, now: number = Date.now()): RubricSavedAtStamps {
  const iso = new Date(savedAtMs).toISOString();
  return {
    relative: formatRelativeAuditStamp(iso, locale, now),
    absolute: formatApplicantDate(iso, locale),
  };
}

/** Validates one draft snapshot and seals the payload, or reports the flags. */
export function resolveRubricDraft(draft: RubricDraft): RubricDraftResolution {
  const score = parseRubricScore(draft.scoreText);
  const notesError = draft.notes.trim() === "";
  const weaknessError = draft.weaknessRequired && draft.weaknessArea === null;
  if (score === null || notesError || weaknessError) {
    return { errors: { score: score === null, notes: notesError, weakness: weaknessError }, input: null };
  }
  return {
    errors: NO_DRAFT_ERRORS,
    input: {
      score,
      notes: draft.notes.trim(),
      weaknessArea: draft.weaknessRequired ? draft.weaknessArea : null,
    },
  };
}
