/**
 * Evaluation-booking read shapes — the applicant-facing surfaces of the
 * five-session evaluation loop: the CURRENT-cycle status blob rendered by
 * the teacher-dashboard evaluation zone and the PII-free evaluator picker
 * page. Booking-side only — the rubric-scoring evaluation types stay in the
 * sibling `evaluation.types.ts` (type-only separation of the two domains).
 */

/** Application-side status blob of the applicant's CURRENT evaluation cycle. */
export interface EvaluationLoopStatusReturnType {
  /** sessions created in the current cycle (non-cancelled) */
  readonly bookedCount: number;
  /** sessions completed in the current cycle */
  readonly completedCount: number;
  /** remaining evaluation credits: VERIFICATION_PLAN_SESSION_COUNT - bookedCount */
  readonly remainingCredits: number;
  /** startDate of the CURRENT active verification subscription; null when none (loop closed) */
  readonly cycleStartDate: Date | null;
}

/** Minimal, PII-free evaluator option surface for the applicant picker. */
export interface EvaluationEvaluatorOptionType {
  /** users.id of the evaluator */
  readonly id: number;
  readonly fullName: string;
  readonly isOnline: boolean;
  /** decimal-as-string per drizzle decimal projection */
  readonly averageRating: string | null;
  readonly subjects: string | null;
}

/** Paged evaluator-picker read result — `page`/`pageSize` echo the request honestly. */
export interface EvaluationEvaluatorOptionPageReturnType {
  readonly items: readonly EvaluationEvaluatorOptionType[];
  readonly totalCount: number;
  readonly page: number;
  readonly pageSize: number;
}
