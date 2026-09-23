import type { evaluations } from "@/backend/db/schema/teachers/evaluations";
import type { ApplicantStatus } from "@/backend/enum/teachers/applicant-status.enum";
import type { RubricWeaknessArea } from "@/backend/enum/teachers/rubric-weakness-area.enum";

export type EvaluationSelectType = typeof evaluations.$inferSelect;

export type EvaluationInsertType = typeof evaluations.$inferInsert;

/**
 * GraphQL-facing read shape for an evaluation row. The soft-delete
 * internals (`isDeleted`/`deletedAt`), the free-text `notes` column, the
 * rubric-only `weaknessArea` column, and the server-managed `updatedAt`
 * stamp stay server-side — consumers see only the rated subject, the
 * rater, the optional session join, the score, and the creation instant.
 */
export type EvaluationReturnType = Omit<
  EvaluationSelectType,
  "isDeleted" | "deletedAt" | "notes" | "weaknessArea" | "updatedAt"
>;

/**
 * Single-row aggregate over one teacher's live student-rating family:
 * `averageScore` is the 0-100-scale mean (or null when no live rating
 * rows exist — never a fabricated value), `ratingCount` the live sample
 * size behind it.
 */
export interface EvaluationRatingAggregateType {
  readonly averageScore: number | null;
  readonly ratingCount: number;
}

/**
 * Student's star input. The server converts `rating` (1..5) to the
 * persisted `score` (20..100) — conversion is the service's job, never the
 * client's.
 */
export interface EvaluationSubmitInput {
  readonly rating: number;
}

/**
 * The evaluator's rubric submission for one completed evaluation session.
 * `weaknessArea` is required when — and only when — `score` is below the
 * pass threshold (`RUBRIC_PASS_THRESHOLD`); every member is validated
 * before any database work.
 */
export interface RubricEvaluationSubmitInput {
  /** Integer 0..100 — the database check constraint is the last-resort backstop, never the gate. */
  readonly score: number;
  /** Qualitative observations — non-empty after trimming, at most `RUBRIC_NOTES_MAX_LENGTH` characters. */
  readonly notes: string;
  /** Failure area when the score fails the threshold, null when it passes; the fail-closed `isRubricWeaknessArea` guard rejects foreign values. */
  readonly weaknessArea: RubricWeaknessArea | null;
}

/**
 * Sealed insert payload the service assembles — never spread from client
 * input. `evaluatedId` resolves from the gated session's student and
 * `evaluatorId` from the authenticated caller, both server-side.
 */
export interface RubricSubmissionInsertInput {
  /** The evaluated subject — always the gated session's student, never client-supplied. */
  readonly evaluatedId: number;
  /** The submitting evaluator — always the authenticated caller. */
  readonly evaluatorId: number;
  /** The completed evaluation session this submission scores. */
  readonly sessionId: number;
  /** Integer 0..100. */
  readonly score: number;
  /** Qualitative observations (bounded, non-empty). */
  readonly notes: string;
  /** Failure area when failing; null when passing. */
  readonly weaknessArea: RubricWeaknessArea | null;
}

/** One quorum-read row: a scored rubric submission of the applicant's current cycle. */
export interface RubricCycleSubmissionRow {
  readonly id: number;
  readonly sessionId: number;
  readonly evaluatorId: number;
  readonly score: number;
  readonly weaknessArea: RubricWeaknessArea | null;
  readonly createdAt: Date;
}

/**
 * Rubric read-model backing the evaluation-submission GraphQL object.
 * `notes` stays server-side: evaluator observations are never part of any
 * transport shape — their visibility beyond the writing evaluator is owned
 * by a future administrative surface.
 */
export interface RubricEvaluationReturnType {
  readonly id: number;
  readonly sessionId: number | null;
  readonly evaluatedId: number;
  readonly evaluatorId: number;
  readonly score: number | null;
  readonly weaknessArea: RubricWeaknessArea | null;
  readonly createdAt: Date;
  /**
   * Applicant status read after this submission's write — 'passed'/'failed'
   * when THIS submission finalized the cycle, 'in_evaluation' while the
   * quorum is still pending. Lets the evaluator's surface observe
   * finalization on the final submit without any new applicant read
   * surface.
   */
  readonly applicantStatus: ApplicantStatus;
}
