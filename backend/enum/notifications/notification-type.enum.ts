/**
 * NotificationType enum — mirrors the `notification_type` pgEnum in
 * `backend/db/schema/enums.ts`. Values are canonical.
 *
 * `SessionDisputeOpened` / `SessionDisputeResolved` are emitted only by the
 * post-confirmation dispute flow; pre-completion (held-escrow) disputes
 * stay notification-silent per the shipped session-lifecycle ruling.
 *
 * `ApplicantOutcome` is emitted only by the admin override of an applicant's
 * evaluation result (`ApplicantLifecycleService.overrideApplicantEvaluation`)
 * — one kind for all three override directions; the title/body copy carries
 * the direction (certified / rejected + re-apply window / re-evaluation
 * granted), mirroring how `parent_link_request` covers both decision copies.
 */
export enum NotificationType {
  SessionRequest = "session_request",
  SessionCompletion = "session_completion",
  SessionCancellation = "session_cancellation",
  ParentLinkRequest = "parent_link_request",
  SystemBroadcast = "system_broadcast",
  PaymentConfirmation = "payment_confirmation",
  EvaluationResult = "evaluation_result",
  SessionDisputeOpened = "session_dispute_opened",
  SessionDisputeResolved = "session_dispute_resolved",
  ApplicantOutcome = "applicant_outcome",
}

/** Pre-allocated lookup set for O(1) membership check without per-call array allocations. */
const NOTIFICATION_TYPE_MEMBERS: ReadonlySet<string> = new Set(Object.values(NotificationType));

/**
 * Type guard for a runtime notification-type value (from a `notification_type`
 * row column or a transport payload). Returns `true` only for exact member
 * strings — the guard fails closed on any other input (wrong type, case
 * mismatch, whitespace, foreign values) rather than throwing.
 */
export function isNotificationType(value: unknown): value is NotificationType {
  return typeof value === "string" && NOTIFICATION_TYPE_MEMBERS.has(value);
}
