import type { SessionsLabels } from "@/shared/locale/types/sessions";

export const sessionsEn: SessionsLabels = {
  studentPageTitle: "My Sessions",
  teacherPageTitle: "Teaching Sessions",
  statusFilterAll: "All statuses",
  status: "Status",
  intent: "Type",
  intentHifz: "Hifz",
  intentTajweed: "Tajweed",
  intentEvaluation: "Evaluation",
  withTeacherCaption: "With teacher",
  withStudentCaption: "With student",
  fee: "Fee",
  deadline: "Deadline",
  createdAt: "Created",
  teacherConfirmedAt: "Teacher confirmed",
  studentConfirmedAt: "Student confirmed",
  studentEmptyTitle: "No sessions yet",
  studentEmptyBody: "When you book a session with a teacher, it will appear here.",
  teacherEmptyTitle: "No sessions yet",
  teacherEmptyBody: "When students book sessions with you, they will appear here.",
  filteredEmptyTitle: "No sessions match this filter",
  filteredEmptyBody: "Try a different status to see more of your sessions.",
  statusScheduled: "Scheduled",
  statusStarted: "In progress",
  statusCompleted: "Completed",
  statusCancelled: "Cancelled",
  statusDisputed: "Disputed",
  startSession: "Start session",
  completeSession: "Complete session",
  confirmCompletion: "Confirm completion",
  confirmCompletionTooltip: "Confirming releases the held fee to your teacher's wallet and finalizes this session.",
  awaitingStudentConfirmation: "Awaiting student confirmation",
  cancelSession: "Cancel session",
  cancelConfirmTitle: "Cancel this session?",
  cancelConfirmBody: "The session will be cancelled and the held fee will be returned to your balance.",
  cancelReasonLabel: "Reason (optional)",
  cancelReasonPlaceholder: "Describe why you are cancelling (optional)",
  openDispute: "Open dispute",
  disputeConfirmTitle: "Dispute this session?",
  disputeConfirmBody:
    "The session will be flagged for admin arbitration. Describe the problem so an administrator can review it.",
  disputeReasonLabel: "Reason (required)",
  disputeReasonPlaceholder: "Describe the problem with this session",
  disputeReasonRequired: "Please describe the reason for the dispute.",
  disputeOpenedNotice: "The dispute was opened. An administrator will review it.",
  cancelDisabledDisputed: "A disputed session awaits admin arbitration and can no longer be cancelled.",
  cancelReasonLine: "Cancellation reason",
  disputeReasonLine: "Dispute reason",
  arbitrationOutcomeLine: "Arbitration outcome",
  outcomeCancel: "Cancelled — fee refunded",
  outcomeComplete: "Completed as taught",
  outcomeRefund: "Refunded in full",
  outcomePartialRefund: "Partially refunded",
  outcomeUphold: "Upheld in the teacher's favor",
  outcomeUnrecorded: "Resolved",
  sessionStartedNotice: "Session started.",
  sessionCompletedNotice: "Session completed.",
  sessionConfirmedNotice: "Completion confirmed. The held fee was released to the teacher.",
  sessionCancelledNotice: "Session cancelled.",
  holdReleasedNotice: "The held fee has been returned to your balance.",
  duplicateBookingInfo: "This booking request was already submitted. Nothing was duplicated.",
  genericError: "Something went wrong. Please try again.",
  adminDisputesPageTitle: "Session disputes",
  adminDisputesCountLine: (count: number) =>
    count === 1 ? "1 session awaiting arbitration" : `${count} sessions awaiting arbitration`,
  adminDisputesEmptyTitle: "No disputed sessions",
  adminDisputesEmptyBody: "Sessions that participants open disputes on will appear here for arbitration.",
  disputeReasonMeta: "Dispute reason",
  disputedAtLabel: "Disputed",
  participantsLabel: "Participants",
  resolveDispute: "Resolve",
  resolveDisputeTitle: "Resolve dispute",
  resolveDisputeBody: "Choose exactly one terminal outcome for this disputed session.",
  resolutionCancelLabel: "Cancel session (refund)",
  resolutionCancelHelper: "The session is cancelled and any held fee is refunded to its original balance lane.",
  resolutionCompleteLabel: "Mark completed",
  resolutionCompleteHelper:
    "The session is completed and its fee hold is consumed. Only sessions that actually started can be completed.",
  resolutionNoteLabel: "Note (optional)",
  resolutionNotePlaceholder: "Add an arbitration note for the record (optional)",
  resolveDisputeSubmit: "Resolve dispute",
  disputeResolvedNotice: "The dispute was resolved.",
  disputeReasonExpand: "Show full reason",
  disputeReasonCollapse: "Show less",
  pagerPreviousLabel: "Previous page",
  pagerNextLabel: "Next page",
  ratingStarAriaLabel: (position: number) => `Star ${position} of 5`,
  rateTeacher: "Rate teacher",
  rateTeacherTooltip: "Rate your teacher for this session. A session can be rated only once.",
  rateTeacherDialogTitle: "Rate your teacher",
  rateTeacherDialogSubmit: "Submit rating",
  rateTeacherDialogCancel: "Cancel",
  rateTeacherSuccess: "Your teacher rating was submitted.",
  teacherRatedChip: "Rated",
  ratingEmptyLabelText: "Empty",
  escrowHeldChip: "Fee held",
  escrowConsumedChip: "Fee consumed",
  resolutionRefundLabel: "Refund the student",
  resolutionRefundHelper:
    "The completed session is refunded in full: the fee returns to the student and the teacher's wallet is debited.",
  resolutionPartialRefundLabel: "Partial refund",
  resolutionPartialRefundHelper:
    "A chosen slice of the fee returns to the student and the rest stays with the teacher. The amount is decided below.",
  resolutionUpholdLabel: "Uphold the completion",
  resolutionUpholdHelper: "The completed session stands and no money moves.",
  partialAmountLabel: "Refund amount",
  partialAmountPlaceholder: "e.g. 12.50",
  partialAmountFeeReference: "Session fee: {fee} {currency}",
  reviewCase: "Review case",
  caseReviewTitle: "Dispute case review",
  caseReviewReportTitle: "Session report",
  caseReviewHomeworkTitle: "Session homework",
  caseReviewRecitationTitle: "Session recitation",
  caseReviewAuditTitle: "Audit trail",
  caseReviewRatingLabel: "Student rating by teacher",
  caseReviewHomeworkCurrentLabel: "Current homework",
  caseReviewHomeworkRevisionLabel: "Revision homework",
  caseReviewEmptyReport: "No report has been submitted for this session.",
  caseReviewEmptyHomework: "No homework was recorded for this session.",
  caseReviewEmptyRecitation: "No recitation record exists for this session.",
  caseReviewEmptyAudit: "No audit entries have been recorded for this session.",
  teacherCaseCta: "Case details",
  teacherCaseTitle: "Dispute case",
  teacherCaseStudentLabel: "Student",
  teacherCaseResolutionTitle: "Arbitration decision",
  teacherCasePendingLine: "Awaiting arbitration — an admin will review this dispute and issue the decision.",
  teacherCaseReportTitle: "Your session report",
  teacherCaseRatingLabel: "Your rating of the student",
  teacherCaseResolvedAtLabel: "Decided on",
  studentCaseTeacherLabel: "Teacher",
  studentCaseReportTitle: "The session report",
  studentCaseRatingLabel: "The teacher's rating",
  adminDisputeAnalyticsTitle: "Arbitration at a glance",
  adminDisputeAnalyticsOpen: "Awaiting arbitration",
  adminDisputeAnalyticsResolved: "Resolved total",
  adminDisputeAnalyticsOutcomes: "Outcomes",

  // ─── Session Report Submission (Jadid & Madi) ───────────────────────────────
  sessionReportAction: "Session report",
  viewHomeworkAction: "Homework",
  reportDialogPrepareTitle: "Review prior homework",
  reportDialogSubmitTitle: "Submit session report",
  reportDialogReviewTitle: "Session report",
  reportNotesLabel: "Notes",
  reportNotesPlaceholder: "Record performance notes for this session (required, up to 2000 characters).",
  reportNotesRequiredMessage: "Notes are required.",
  reportNotesTooLongMessage: "Notes must be 2000 characters or fewer.",
  reportRatingLabel: "Student rating",
  reportRatingRequiredMessage: "A rating is required.",
  reportSubmitLabel: "Submit report",
  reportCancelLabel: "Cancel",
  reportSubmitSuccessNotice: "Session report submitted.",
  reportAlreadySubmittedNotice: "A report has already been submitted for this session.",
  reportBlocksRequiredMessage: "At least one homework block (Jadid or Madi) is required.",
  reportAyahRangeMessage: "From ayah must be less than or equal to to ayah.",
  reportGradeRangeMessage: "Grades must be between 0 and 100.",
  reportSurahJuzRequiredMessage: "Surah / Juz is required for a non-empty block.",
  jadidSectionTitle: "New memorization (Jadid)",
  madiSectionTitle: "Revision (Madi)",
  fromAyahLabel: "From ayah",
  toAyahLabel: "To ayah",
  surahJuzPickerLabel: "Surah / Juz",
  gradePreviousSectionTitle: "Grade previous homework",
  reportFirstSessionHint: "This is the student's first session — there is no prior homework to grade.",
  reportAlreadyGradedLabel: "Already graded",
  reportGradeJadidLabel: "Jadid grade",
  reportGradeMadiLabel: "Madi grade",
  reportGradeAriaLabel: (gradeLabel, grade) => `${gradeLabel}: ${grade}`,
  reportTrackEmptyLabel: "No assignment for this track.",
  reportHistorySectionTitle: "Homework history",
  reportHistoryEmptyMessage: "This student has no prior homework yet.",
  reportSessionDateLabel: "Session date",
  reportReviewedNotesLabel: "Teacher notes",
  reportReviewedRatingLabel: "Student rating",
  surahJuzLabel: (ref: string): string => {
    // Five surah legs as equality-guard early returns (the function-size
    // lint ceiling forbids 35 two-line cases in one switch body); the juz
    // legs ride a switch below. The trailing default is the fail-closed
    // fallback for an unknown ref.
    if (ref === "surah_al_fatihah") return "Surah Al-Fātihah";
    if (ref === "surah_al_baqarah") return "Surah Al-Baqarah";
    if (ref === "surah_aal_imran") return "Surah Āl ʿImrān";
    if (ref === "surah_an_nisa") return "Surah An-Nisāʾ";
    if (ref === "surah_al_maidah") return "Surah Al-Māʾidah";
    switch (ref) {
      case "juz_1":
        return "Juz 1";
      case "juz_2":
        return "Juz 2";
      case "juz_3":
        return "Juz 3";
      case "juz_4":
        return "Juz 4";
      case "juz_5":
        return "Juz 5";
      case "juz_6":
        return "Juz 6";
      case "juz_7":
        return "Juz 7";
      case "juz_8":
        return "Juz 8";
      case "juz_9":
        return "Juz 9";
      case "juz_10":
        return "Juz 10";
      case "juz_11":
        return "Juz 11";
      case "juz_12":
        return "Juz 12";
      case "juz_13":
        return "Juz 13";
      case "juz_14":
        return "Juz 14";
      case "juz_15":
        return "Juz 15";
      case "juz_16":
        return "Juz 16";
      case "juz_17":
        return "Juz 17";
      case "juz_18":
        return "Juz 18";
      case "juz_19":
        return "Juz 19";
      case "juz_20":
        return "Juz 20";
      case "juz_21":
        return "Juz 21";
      case "juz_22":
        return "Juz 22";
      case "juz_23":
        return "Juz 23";
      case "juz_24":
        return "Juz 24";
      case "juz_25":
        return "Juz 25";
      case "juz_26":
        return "Juz 26";
      case "juz_27":
        return "Juz 27";
      case "juz_28":
        return "Juz 28";
      case "juz_29":
        return "Juz 29";
      case "juz_30":
        return "Juz 30";
      default:
        // Fail-closed: an unknown ref rides the raw value verbatim so the
        // UI never renders an empty string and the bug surfaces visibly.
        return ref;
    }
  },

  // ─── Rubric Evaluation Submission (evaluator dialog) ────────────────────────
  submitEvaluationAction: "Submit evaluation",
  awaitingEvaluation: "Awaiting your evaluation",
  rubricDialogTitle: "Evaluation rubric",
  rubricScoreLabel: "Score (0-100)",
  rubricScoreBandPassing: "Passing — at or above the threshold",
  rubricScoreBandFailing: "Needs a weakness area",
  rubricNotesLabel: "Observations",
  rubricWeaknessLabel: "Primary weakness area",
  rubricWeaknessTajweed: "Tajweed",
  rubricWeaknessHifz: "Hifz",
  rubricWeaknessHelper: "Shown for scores below 80 — the area drives the re-apply cooldown.",
  rubricSubmitCta: "Submit evaluation",
  rubricSubmittedSuccess: "Evaluation submitted.",
  rubricImpactPass: "Filing this rubric advances the applicant one step in the evaluation pipeline.",
  rubricImpactFail:
    "Filing below the threshold places the applicant in the weakness-driven waiting period before a re-evaluation.",
  rubricDraftRestoredNotice: "Unsubmitted draft restored from this device.",
  rubricDraftDiscardCta: "Discard draft",
  // Saved-at provenance caption under the restored notice — the relative
  // "when" itself comes from the platform's Intl.RelativeTimeFormat ladder.
  rubricDraftSavedAtLabel: "Draft saved",
  // Parked-draft row chip — the pending row's "a restorable draft is parked
  // for this session" marker (the list-level membership read decides per
  // row; the dialog's restore flow owns the actual values).
  rubricDraftParkedChip: "Unsubmitted draft",
  // Hygiene diagnostics — the parked-draft prune sweep names how many stale
  // drafts it cleaned (template-function precedent; the locale owns its
  // plural rules).
  rubricDraftsPrunedLine: (count: number) =>
    count === 1 ? "1 stale draft cleaned up" : `${count} stale drafts cleaned up`,

  // ─── Pending-rubric banner (teacher sessions surface) ───────────────────────
  pendingRubricCountLine: (count: number) =>
    count === 1 ? "1 evaluation awaiting your submission" : `${count} evaluations awaiting your submission`,
  pendingRubricFilterCta: "Show only these",
  pendingRubricFilterActiveCta: "Showing only these — show all",

  // ─── Teacher Preparation dialog (pre-session readiness view) ────────────────
  prepAction: "Prepare",
  prepDialogTitle: "Prepare for the session",
  prepCurrentLessonLabel: "Current lesson",
  prepLessonPositionLabel: (position: number, total: number) => `Lesson ${position} of ${total}`,
  prepCompletionLabel: "Completion",
  prepPlanLabel: "Learning plan",
  prepFirstSessionTitle: "First session — diagnostic",
  prepFirstSessionBody:
    "This is the student's first session, so no curriculum position is recorded yet. Use it to assess their recitation level and set the right starting point.",
  prepPreviousHomeworkHeading: "Previous homework",
  prepHomeworkEmptyTitle: "No previous homework",
  prepHomeworkEmptyBody: "Assignments from this student's earlier sessions will appear here.",
  prepMoreHomeworkLine: (count: number) => `+${count} more in history`,
  prepReadonlyHint: "This view is read-only — progress advances automatically after each confirmed session.",
  prepStudentLabel: "Student",
  prepLoadingLabel: "Loading preparation details…",

  // ─── Session details dialog (read-only, both participant lists) ─────────────
  sessionDetailsTooltip: "Session details",
  sessionDetailsDialogTitle: "Session details",
  sessionDetailsFeeHeld: "Fee held",
  sessionDetailsFeeNotHeld: "Not held",
  sessionDetailsTimelineTitle: "Timeline",
  sessionDetailsStartedAt: "Started",
  sessionDetailsEndedAt: "Ended",
  sessionDetailsResolvedAt: "Resolved",
  sessionDetailsUnavailable: "This session can't be displayed.",
};
