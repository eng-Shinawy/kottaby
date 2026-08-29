import type { ApplicantLabels } from "@/shared/locale/types/applicant";

export const applicantEn: ApplicantLabels = {
  statusPending: "Pending evaluation",
  statusInEvaluation: "In evaluation",
  statusFailed: "Failed",
  statusPassed: "Passed",
  statusCardTitle: "Application Status",
  pendingPrompt:
    "Your application is registered. Purchase your verification sessions whenever you are ready to begin the evaluation.",
  pendingPlansCta: "Browse subscription plans",
  attemptCountLabel: "Verification attempts",
  cooldownExpiryLine: "You can re-apply after {cooldownUntil}.",
  eligibleToReapply: "Your waiting period has ended — you are now eligible to re-apply for teacher verification.",
  reapplyCta: "Re-apply",
  certifiedSummary: "Your teacher verification is complete. You are certified to teach Qur'an recitation.",
  certifiedSurfacesHint: "All teaching surfaces are now open for you in the dashboard menu.",
  inEvaluationHint: "Your evaluation covers five recitation sessions before a decision is made.",
};
