import type { ApplicantLabels } from "@/shared/locale/types/applicant";

export const applicantEn: ApplicantLabels = {
  statusPending: "Pending evaluation",
  statusInEvaluation: "In evaluation",
  statusFailed: "Failed",
  statusPassed: "Passed",
  statusCardTitle: "Application Status",
  pendingPrompt:
    "Your application is registered. Purchase your verification sessions whenever you are ready to begin the evaluation.",
  attemptCountLabel: "Verification attempts",
  cooldownExpiryLine: "You can re-apply after {cooldownUntil}.",
  eligibleToReapply: "Your waiting period has ended — you are now eligible to re-apply for teacher verification.",
  reapplyCta: "Re-apply",
  certifiedSummary: "Your teacher verification is complete. You are certified to teach Qur'an recitation.",
  certifiedSurfacesHint: "All teaching surfaces are now open for you in the dashboard menu.",
  inEvaluationHint: "Your evaluation covers five recitation sessions before a decision is made.",
  coldStartCertifiedTitle: "Your Teacher Certification Is Complete",
  coldStartCertifiedBody:
    "Congratulations — you are now a certified Qur'an teacher. All teaching surfaces are now open for you in the dashboard.",
  purchaseCta: "Purchase verification plan",
  purchaseDialogTitle: "Purchase Verification Plan",
  purchasePlanLine: "{title} — {price} {currency} / {sessions} sessions / {days} days",
  purchaseConfirmCta: "Confirm purchase",
  purchaseCancelCta: "Cancel",
  purchaseSuccess: "Your purchase request was sent successfully.",
  purchaseGenericError: "We could not complete your purchase. Please try again.",
  evaluationProgressLine: (booked: number, completed: number, remaining: number, total: number) =>
    `${booked} of ${total} booked · ${completed} completed · ${remaining} left`,
  bookEvaluationCta: "Book an evaluation session",
  availableEvaluatorsEmpty: "No eligible evaluators — all certified evaluators are already used in this cycle.",
  evaluationBookingSuccess: "Evaluation session booked.",
  evaluationBookingCancelCta: "Cancel",
  evaluationBookingConfirmCta: "Confirm booking",
  evaluationBookingDialogTitle: "Choose an evaluator",
  evaluationZoneTitle: "Your evaluation loop",
  // Cycle provenance caption under the progress line — the view composes
  // the deterministic absolute stamp beside this label (no ICU slot; the
  // date formatting stays client-side like every other stamp).
  evaluationCycleStartCaption: "Cycle started",
  evaluationPassedTitle: "You are a certified teacher",
  evaluationPassedBody: "You passed all 5 evaluation sessions. Your teacher record is active.",
  evaluationFailedTitle: "Evaluation result",
  evaluationFailedBody: "You can re-apply after {cooldownUntil}.",
};
