import type { AdminSessionGovernanceLabels } from "@/shared/locale/types/adminSessionGovernance";

export const adminSessionGovernanceEn: AdminSessionGovernanceLabels = {
  pageTitle: "Session governance",
  countLine: (count: number) => {
    if (count === 0) return "No sessions";
    if (count === 1) return "1 session";
    return `${count} sessions`;
  },
  summaryScopeHint: "Counts reflect the loaded page only.",
  needsAttentionLabel: "Needs attention",

  filterBarLabel: "Directory filters",
  filterTeacherIdLabel: "Teacher user id",
  filterStudentIdLabel: "Student user id",
  filterTypeLabel: "Type",
  filterStatusLabel: "Status",
  filterDateFromLabel: "Created from",
  filterDateToLabel: "Created before",
  filterApply: "Apply filters",
  filterReset: "Reset filters",
  filterTypeAll: "All types",
  filterStatusAll: "All statuses",
  filterInvalidId: "User ids must be whole numbers.",
  typeStudentSession: "Student session",
  typeTeacherEvaluation: "Teacher evaluation",
  typeReEvaluation: "Re-evaluation",
  intentHifz: "Hifz",
  intentTajweed: "Tajweed",
  intentEvaluation: "Evaluation",

  emptyTitle: "No sessions found",
  emptyBody: "Sessions across the platform will appear here as participants create them.",
  filteredEmptyTitle: "No sessions match these filters",
  filteredEmptyBody: "Adjust or reset the filters to widen the search.",
  errorTitle: "Couldn't load the session directory",
  retryLabel: "Retry",

  rowTypeLabel: "Type",
  rowDurationLabel: "Duration",
  rowStartLabel: "Start time",
  rowEndLabel: "End time",
  rowDeadlineLabel: "Confirmation deadline",
  rowActionsAriaLabel: "Session actions",
  durationMinutesValue: (minutes: number) => `${minutes} min`,

  actionViewDetails: "View details",
  actionReschedule: "Reschedule",
  actionCancel: "Cancel session",
  actionReassign: "Reassign teacher",
  actionViewAndObserve: "View & observe",
  rescheduleDisabledHint: "Only scheduled or started sessions can be rescheduled.",
  cancelDisabledHint: "Only scheduled or started sessions can be cancelled.",
  reassignDisabledHint: "Only scheduled sessions can be reassigned.",
  joinDisabledHint: "Only live (started) sessions can be joined.",

  detailTitle: "Session details",
  detailCloseAriaLabel: "Close session details",
  detailMissingBody: "This session does not exist or is no longer available.",
  detailSessionIdLabel: "Session id",
  detailIntentLabel: "Intent",
  detailStartLabel: "Start time",
  detailEndLabel: "End time",
  detailDeadlineLabel: "Confirmation deadline",
  detailConfirmedByStudentLabel: "Student confirmed",
  detailConfirmedByTeacherLabel: "Teacher confirmed",
  detailCancelReasonLabel: "Cancellation reason",
  detailDisputeReasonLabel: "Dispute reason",
  detailResolutionLabel: "Resolution note",
  detailResolvedAtLabel: "Resolved at",

  rescheduleTitle: "Reschedule session",
  rescheduleBody: "Set a new start and end time. The change applies immediately and both participants are notified.",
  rescheduleStartLabel: "New start time",
  rescheduleEndLabel: "New end time",
  rescheduleSubmit: "Save new schedule",
  rescheduleSuccess: "Session rescheduled.",

  cancelTitle: "Cancel session",
  cancelBody:
    "Cancelling ends this session, releases any held funds back to their original lane, and notifies both participants.",
  cancelReasonLabel: "Reason (optional)",
  cancelReasonPlaceholder: "Why is this session being cancelled?",
  cancelSubmit: "Cancel session",
  cancelSuccess: "Session cancelled.",

  reassignTitle: "Reassign teacher",
  reassignBody:
    "Assign a different certified teacher to this scheduled session. The student and both teachers are notified.",
  reassignTeacherIdLabel: "New teacher user id",
  reassignTeacherIdPlaceholder: "The user id of the target teacher",
  reassignSubmit: "Reassign",
  reassignSuccess: "Teacher reassigned.",

  joinBannerTitle: "This session is live",
  joinBannerBody: "Joining records a single audit entry and opens the session for you as a read-only observer.",
  joinBannerAction: "Join as observer",
  joinSuccess: "Joined as observer.",
};
