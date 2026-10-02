/**
 * AdminSessionGovernance namespace labels — the admin session-governance
 * surface (`/admin/session-governance`): the filterable/paginated
 * directory of ALL sessions, the status-summary strip, the read-only detail
 * drawer, and the four governance operations (reschedule, cancel with held
 * funds released, teacher reassignment, join-as-observer).
 *
 * Used by:
 *  - `AdminSessionGovernanceContainer` / `AdminSessionGovernanceChrome` /
 *    `AdminSessionsBody` / `AdminSessionRow` / `AdminSessionRowStatusCell` /
 *    `AdminSessionDetailDrawer` / `RescheduleSessionDialog` /
 *    `CancelSessionDialog` / `ReassignTeacherDialog` /
 *    `JoinObservationAction` — every string on the surface resolves through
 *    `useAppTranslation(AdminSessionGovernance)`.
 *
 * Deliberately NOT duplicated here (single-sourced from their owning
 * namespaces, per reuse-first):
 *  - lifecycle status chip labels — `sessions.statusScheduled` …
 *    `sessions.statusDisputed` (resolved through the shared
 *    `STATUS_LABEL_KEY` table);
 *  - generic row meta — `sessions.intent` / `sessions.fee` /
 *    `sessions.createdAt` / `sessions.participantsLabel` /
 *    `sessions.disputedAtLabel`;
 *  - pager aria labels — `sessions.pagerPreviousLabel` /
 *    `sessions.pagerNextLabel`;
 *  - error copy — `errors.sessionInvalidTransition` /
 *    `errors.sessionNotFound` / `errors.teacherNotCertified` /
 *    `errors.validation` / `errors.forbidden` / `errors.unauthorized` /
 *    `errors.sessionRescheduleWindowInvalid` /
 *    `errors.sessionRescheduleStartInPast`;
 *  - the dialog dismiss button — `common.cancel`.
 *
 * Eligibility hints mirror the backend state matrix exactly
 * (reschedule/cancel ⇒ scheduled|started, reassign ⇒ scheduled only,
 * join ⇒ started only) — the disabled menu items explain WHY with these
 * hints instead of leaving dead affordances.
 *
 * All keys MUST have both `en` and `ar` implementations with EXACT key-set
 * parity (compile-typed on both leaves). Property access only — never
 * call-by-key. The only interpolated values are the honest directory total
 * (`countLine`) and the derived duration minutes (`durationMinutesValue`);
 * no raw server data (ids, reasons, notes) ever flows through these labels.
 */
export interface AdminSessionGovernanceLabels {
  /** Page heading. */
  readonly pageTitle: string;
  /** Honest directory total for the sticky bar (server `totalCount`). */
  readonly countLine: (count: number) => string;
  /** Scope hint under the summary strip — counts describe the LOADED page. */
  readonly summaryScopeHint: string;
  /** Needs-attention badge label (summary card + row badge). */
  readonly needsAttentionLabel: string;

  /** Filter toolbar accessible name. */
  readonly filterBarLabel: string;
  /** Teacher user-id filter field label. */
  readonly filterTeacherIdLabel: string;
  /** Student user-id filter field label. */
  readonly filterStudentIdLabel: string;
  /** Session-type filter select label. */
  readonly filterTypeLabel: string;
  /** Session-status filter select label. */
  readonly filterStatusLabel: string;
  /** Creation-window lower bound label (inclusive UTC day start). */
  readonly filterDateFromLabel: string;
  /** Creation-window upper bound label (EXCLUSIVE UTC bound — half-open). */
  readonly filterDateToLabel: string;
  /** Apply-filters action. */
  readonly filterApply: string;
  /** Reset-filters action. */
  readonly filterReset: string;
  /** Type-select "no filtering" option. */
  readonly filterTypeAll: string;
  /** Status-select "no filtering" option. */
  readonly filterStatusAll: string;
  /** Client validation — participant-id filters must be whole numbers. */
  readonly filterInvalidId: string;
  /** SessionType.StudentSession option label. */
  readonly typeStudentSession: string;
  /** SessionType.TeacherEvaluation option label. */
  readonly typeTeacherEvaluation: string;
  /** SessionType.ReEvaluation option label. */
  readonly typeReEvaluation: string;

  /** SessionIntent.Hifz value label. */
  readonly intentHifz: string;
  /** SessionIntent.Tajweed value label. */
  readonly intentTajweed: string;
  /** SessionIntent.Evaluation value label. */
  readonly intentEvaluation: string;

  /** Directory empty state heading (no rows at all). */
  readonly emptyTitle: string;
  /** Directory empty state body. */
  readonly emptyBody: string;
  /** Filtered empty state heading (filters active, zero matches). */
  readonly filteredEmptyTitle: string;
  /** Filtered empty state body. */
  readonly filteredEmptyBody: string;
  /** Settled query failure without a denial-family code. */
  readonly errorTitle: string;
  /** Retry action on the error state. */
  readonly retryLabel: string;

  /** Row meta — session type. */
  readonly rowTypeLabel: string;
  /** Row meta — derived duration (startedAt→endedAt; D-07: not on the wire). */
  readonly rowDurationLabel: string;
  /** Row meta — scheduled/actual start time. */
  readonly rowStartLabel: string;
  /** Row meta — scheduled/actual end time. */
  readonly rowEndLabel: string;
  /** Row meta — confirmation deadline. */
  readonly rowDeadlineLabel: string;
  /** Kebab menu accessible name. */
  readonly rowActionsAriaLabel: string;
  /** Renders the derived duration in minutes (the "min" unit is locale copy). */
  readonly durationMinutesValue: (minutes: number) => string;

  /** Kebab action — open the detail drawer (always enabled). */
  readonly actionViewDetails: string;
  /** Kebab action — reschedule. */
  readonly actionReschedule: string;
  /** Kebab action — cancel. */
  readonly actionCancel: string;
  /** Kebab action — reassign teacher. */
  readonly actionReassign: string;
  /** Kebab action — open the live session's drawer view (the observe confirm lives inside). */
  readonly actionViewAndObserve: string;
  /** Disabled-action hint — reschedule needs scheduled|started. */
  readonly rescheduleDisabledHint: string;
  /** Disabled-action hint — cancel needs scheduled|started. */
  readonly cancelDisabledHint: string;
  /** Disabled-action hint — reassign needs scheduled only. */
  readonly reassignDisabledHint: string;
  /** Disabled-action hint — join needs started only. */
  readonly joinDisabledHint: string;

  /** Detail drawer heading. */
  readonly detailTitle: string;
  /** Detail drawer close button aria-label. */
  readonly detailCloseAriaLabel: string;
  /** Detail drawer body when `adminSession` resolves `null` (absent row). */
  readonly detailMissingBody: string;
  /** Detail meta — session id. */
  readonly detailSessionIdLabel: string;
  /** Detail meta — booking intent (distinct from the structural type cell). */
  readonly detailIntentLabel: string;
  /** Detail meta — start time. */
  readonly detailStartLabel: string;
  /** Detail meta — end time. */
  readonly detailEndLabel: string;
  /** Detail meta — confirmation deadline. */
  readonly detailDeadlineLabel: string;
  /** Detail meta — student confirmation stamp. */
  readonly detailConfirmedByStudentLabel: string;
  /** Detail meta — teacher confirmation stamp. */
  readonly detailConfirmedByTeacherLabel: string;
  /** Detail meta — cancellation reason. */
  readonly detailCancelReasonLabel: string;
  /** Detail meta — filed dispute reason. */
  readonly detailDisputeReasonLabel: string;
  /** Detail meta — arbitration resolution note. */
  readonly detailResolutionLabel: string;
  /** Detail meta — resolution timestamp. */
  readonly detailResolvedAtLabel: string;

  /** Reschedule dialog heading. */
  readonly rescheduleTitle: string;
  /** Reschedule dialog explanatory body. */
  readonly rescheduleBody: string;
  /** Reschedule new-start field label. */
  readonly rescheduleStartLabel: string;
  /** Reschedule new-end field label. */
  readonly rescheduleEndLabel: string;
  /** Reschedule submit action. */
  readonly rescheduleSubmit: string;
  /** Reschedule success notice. */
  readonly rescheduleSuccess: string;

  /** Cancel dialog heading. */
  readonly cancelTitle: string;
  /** Cancel dialog explanatory body (state flip + released funds + waves). */
  readonly cancelBody: string;
  /** Optional cancel reason field label. */
  readonly cancelReasonLabel: string;
  /** Optional cancel reason placeholder. */
  readonly cancelReasonPlaceholder: string;
  /** Cancel submit action. */
  readonly cancelSubmit: string;
  /** Cancel success notice. */
  readonly cancelSuccess: string;

  /** Reassign dialog heading. */
  readonly reassignTitle: string;
  /** Reassign dialog explanatory body (certification gate + waves). */
  readonly reassignBody: string;
  /** New-teacher user-id field label. */
  readonly reassignTeacherIdLabel: string;
  /** New-teacher user-id placeholder (format hint). */
  readonly reassignTeacherIdPlaceholder: string;
  /** Reassign submit action. */
  readonly reassignSubmit: string;
  /** Reassign success notice. */
  readonly reassignSuccess: string;

  /** Join banner heading (live-session observation). */
  readonly joinBannerTitle: string;
  /** Join banner body (single audit entry, read-only observation). */
  readonly joinBannerBody: string;
  /** Join banner confirm action (single click — no dialog). */
  readonly joinBannerAction: string;
  /** Join success notice. */
  readonly joinSuccess: string;
}
