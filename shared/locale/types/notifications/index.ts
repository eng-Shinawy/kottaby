/**
 * Notifications namespace labels — the real-time in-app notification feed
 * surface (bell badge, feed page, filters, mark-read actions, realtime toast,
 * and quiet reconnect affordances).
 *
 * Used by:
 *  - Frontend notification feed views (`useAppTranslation(Notifications)` for
 *    the feed title, empty/error states, filter chips, per-type display
 *    labels, mark-read/mark-all affordances, and the realtime toast).
 *  - Frontend app-bar bell badge (`useAppTranslation(Notifications)` for the
 *    badge accessible name + the pluralized unread-count announcement).
 *  - Frontend app-bar bell drawer (`NotificationDrawer` — the header title,
 *    mark-all action, loading/empty/error branches, and the view-all footer).
 *  - The notifications server page shell (`getTranslations(locale)` →
 *    `notificationsTranslations` slice).
 *
 * The per-type display labels cover exactly the ten notification-type
 * values (`session_request`, `session_completion`, `session_cancellation`,
 * `session_dispute_opened`, `session_dispute_resolved`,
 * `parent_link_request`, `system_broadcast`, `payment_confirmation`,
 * `evaluation_result`, `applicant_outcome`) — one label key per value.
 *
 * All keys MUST have both `en` and `ar` implementations with EXACT key-set
 * parity (compile-typed on both leaves + `notifications-namespace.parity.test.ts`
 * runtime belt). Property access only — never call-by-key.
 */
export interface NotificationsLabels {
  /** Feed page title. */
  readonly title: string;
  /** Empty-inbox state title (no notifications to show). */
  readonly emptyTitle: string;
  /** Empty-inbox state body — where new notifications will appear. */
  readonly emptyBody: string;
  /** Feed load-failure state title. */
  readonly loadErrorTitle: string;
  /** Feed load-failure state body (paired with the retry affordance). */
  readonly loadErrorBody: string;
  /** Filter chip label — all notifications (no read-state filter). */
  readonly filterAll: string;
  /** Filter chip label — unread notifications only. */
  readonly filterUnread: string;
  /** Type display label — session_request (a new session was requested). */
  readonly typeSessionRequest: string;
  /** Type display label — session_completion (a session was completed). */
  readonly typeSessionCompletion: string;
  /** Type display label — session_cancellation (a session was cancelled). */
  readonly typeSessionCancellation: string;
  /** Type display label — session_dispute_opened (a post-confirmation dispute was opened). */
  readonly typeSessionDisputeOpened: string;
  /** Type display label — session_dispute_resolved (a dispute arbitration was decided). */
  readonly typeSessionDisputeResolved: string;
  /** Type display label — parent_link_request (a parent asked to link an account). */
  readonly typeParentLinkRequest: string;
  /** Type display label — system_broadcast (platform-wide announcement). */
  readonly typeSystemBroadcast: string;
  /** Type display label — payment_confirmation (a payment was confirmed). */
  readonly typePaymentConfirmation: string;
  /** Type display label — evaluation_result (an evaluation decision arrived). */
  readonly typeEvaluationResult: string;
  /** Type display label — applicant_outcome (an admin override decision about an application arrived). */
  readonly typeApplicantOutcome: string;
  /** Per-row "mark this notification as read" action label. */
  readonly markRead: string;
  /**
   * Per-row mark-read button accessible label carrying the notification
   * title as context (screen readers announce which row the action targets).
   */
  readonly markReadAriaLabel: (notificationTitle: string) => string;
  /** "Mark every displayed notification as read" action label. */
  readonly markAllRead: string;
  /** Mark-all confirmation dialog title. */
  readonly markAllConfirmTitle: string;
  /** Mark-all confirmation dialog body (what the action will do). */
  readonly markAllConfirmBody: string;
  /**
   * Mark-all success announcement carrying the affected count — pluralized
   * per locale rules (Arabic zero/singular/dual/few/plural branches).
   */
  readonly markAllResult: (count: number) => string;
  /** Bell-button accessible name that opens the notifications surface. */
  readonly badgeAriaLabel: string;
  /**
   * Pluralized unread-count announcement for the bell badge (used as the
   * badge's accessible label / tooltip) — Arabic follows the zero/singular/
   * dual/3–10-plural/11+-counted branch rules.
   */
  readonly unreadCount: (count: number) => string;
  /**
   * Bell-drawer footer action — navigates from the floating drawer to the
   * full notifications page (`/notifications`).
   */
  readonly viewAllNotifications: string;
  /**
   * Realtime-arrival toast template — receives the localized type display
   * label and the notification title; output is the full toast message.
   */
  readonly realtimeToast: (typeLabel: string, notificationTitle: string) => string;
  /** Quiet reconnect affordance — realtime stream is reconnecting. */
  readonly reconnecting: string;
  /** Quiet reconnect affordance — realtime stream silently recovered. */
  readonly reconnectedQuietly: string;
  /** Teacher-wave title — a new session request arrived. */
  readonly eventSessionRequestTitle: string;
  /** Student outcome title — the teacher accepted the request. */
  readonly eventSessionAcceptedTitle: string;
  /** Student outcome title — the teacher declined the request. */
  readonly eventSessionDeclinedTitle: string;
  /** Student outcome title — the request was auto-rejected (reject preference). */
  readonly eventSessionAutoRejectedTitle: string;
  /** Student outcome title — the request was queued (queue preference). */
  readonly eventSessionQueuedTitle: string;
  /** Student outcome title — alternative teachers were offered (offer_alternatives preference). */
  readonly eventSessionAlternativesOfferedTitle: string;
  /**
   * Teacher-wave body — interpolates ONLY the requesting student's name
   * and the localized intent label (sanctioned matching context).
   */
  readonly eventSessionRequestBody: (studentName: string, intentLabel: string) => string;
  /** Student outcome body — interpolates ONLY the accepting teacher's name. */
  readonly eventSessionAcceptedBody: (teacherName: string) => string;
  /** Student outcome body — interpolates ONLY the declining teacher's name. */
  readonly eventSessionDeclinedBody: (teacherName: string) => string;
  /** Student outcome body — interpolates ONLY the teacher's name (auto-reject). */
  readonly eventSessionAutoRejectedBody: (teacherName: string) => string;
  /** Student outcome body — interpolates ONLY the teacher's name (queued). */
  readonly eventSessionQueuedBody: (teacherName: string) => string;
  /** Student outcome body — interpolates ONLY the teacher's name (alternatives offered). */
  readonly eventSessionAlternativesOfferedBody: (teacherName: string) => string;
  /** Intent display label — hifz (memorization) session. */
  readonly intentHifz: string;
  /** Intent display label — tajweed (recitation refinement) session. */
  readonly intentTajweed: string;
  /** Intent display label — evaluation session. */
  readonly intentEvaluation: string;
  // ─── Session completion-handshake event copy ───────────────────────────────
  /** Student title — the teacher marked the session complete; the student's confirmation is awaited. */
  readonly eventSessionCompletionPromptTitle: string;
  /**
   * Student body for the completion prompt — interpolates ONLY the
   * teacher's already-assembled display name.
   */
  readonly eventSessionCompletionPromptBody: (teacherName: string) => string;
  /** Student title — the session was auto-cancelled once the confirmation window lapsed. */
  readonly eventSessionAutoCancelledTitle: string;
  /**
   * Student body for the auto-cancel notice — interpolates ONLY the
   * teacher's already-assembled display name.
   */
  readonly eventSessionAutoCancelledBody: (teacherName: string) => string;
  // ─── Parent-link lifecycle event copy ─────────────────────────────────────
  /** Notification title — a parent sent the student a link request. */
  readonly eventParentLinkRequestTitle: string;
  /**
   * Notification body for a new link request — interpolates ONLY the
   * requesting parent's already-assembled display name.
   */
  readonly eventParentLinkRequestBody: (parentName: string) => string;
  /** Notification title — the student confirmed the parent's link request. */
  readonly eventParentLinkAcceptedTitle: string;
  /**
   * Notification body for a confirmed link request — interpolates ONLY the
   * student's already-assembled display name.
   */
  readonly eventParentLinkAcceptedBody: (studentName: string) => string;
  /** Notification title — the student rejected the parent's link request. */
  readonly eventParentLinkRejectedTitle: string;
  /**
   * Notification body for a rejected link request — interpolates ONLY the
   * student's already-assembled display name.
   */
  readonly eventParentLinkRejectedBody: (studentName: string) => string;
  /** Notification title — a parent's pending link request is nearing expiry (D1 reminder). */
  readonly eventParentLinkExpiringTitle: string;
  /**
   * Notification body for the expiry reminder — interpolates ONLY the
   * student's already-MASKED display name (R9: pre-decision parent-bound
   * copy never carries the full name), bidi-isolated by the sender
   * (`isolateBidi`) before interpolation so the stored body renders
   * correctly in mixed-direction feeds without a presentation wrapper.
   */
  readonly eventParentLinkExpiringBody: (studentName: string) => string;
  // ─── Payment-confirmation event copy ───────────────────────────────────────
  /** Notification title — the student's plan payment was confirmed. */
  readonly eventPaymentConfirmedTitle: string;
  /**
   * Notification body for a confirmed payment — interpolates ONLY the
   * purchased plan's catalog title (the copy the student bought).
   */
  readonly eventPaymentConfirmedBody: (planTitle: string) => string;
  /** Notification title — the student's plan payment was declined at the gateway. */
  readonly eventPaymentFailedTitle: string;
  /**
   * Notification body for a failed payment — interpolates ONLY the
   * attempted plan's catalog title. The copy stays free of amounts,
   * currencies, and provider references (the result page and the
   * subscriptions list own the actionable retry surface).
   */
  readonly eventPaymentFailedBody: (planTitle: string) => string;
  // ─── Session-report-ready event copy ───────────────────────────────────────
  /** Notification title — the session's report was submitted and is ready to view. */
  readonly eventSessionReportReadyTitle: string;
  /**
   * Student body — the session's teacher submitted the report; interpolates
   * ONLY the teacher's already-assembled full name. The copy MUST stay free
   * of grades, note content, and identifiers (the body is a link invite,
   * not a content mirror), and names are bidi-isolated by the sender before
   * interpolation so mixed-direction feeds render correctly.
   */
  readonly eventSessionReportReadyBody: (teacherName: string) => string;
  /**
   * Parent body — interpolates ONLY the student's and the teacher's
   * already-assembled full names; same privacy constraint as the student
   * body: no grades, no note content, no identifiers.
   */
  readonly eventSessionReportReadyParentBody: (studentName: string, teacherName: string) => string;
  // ─── Admin session-governance event copy ──────────────────────────────────
  /** Notification title — an administrator rescheduled the session. */
  readonly eventSessionGovernanceRescheduledTitle: string;
  /**
   * Notification body for a governance reschedule — plain factual copy
   * (no participant names, no timing values; the inbox links back to the
   * session where the new schedule is rendered).
   */
  readonly eventSessionGovernanceRescheduledBody: string;
  /** Notification title — an administrator cancelled the session. */
  readonly eventSessionGovernanceCancelledTitle: string;
  /** Notification body for a governance cancel — plain factual copy, no refund promises. */
  readonly eventSessionGovernanceCancelledBody: string;
  /** Notification title — an administrator changed the session's teacher. */
  readonly eventSessionGovernanceTeacherReassignedTitle: string;
  /** Notification body for a governance teacher reassignment — plain factual copy, no participant names. */
  readonly eventSessionGovernanceTeacherReassignedBody: string;
  // ─── Session dispute-wave event copy (consumed-generation arbitration) ─────
  /** Admin title — a post-confirmation dispute was opened on a session. */
  readonly eventSessionDisputeOpenedTitle: string;
  /**
   * Admin body for the dispute-opened wave — plain factual copy (no
   * participant names, no reason content; the disputes console renders the
   * case).
   */
  readonly eventSessionDisputeOpenedBody: string;
  /** Participant title — the session's dispute arbitration was decided. */
  readonly eventSessionDisputeResolvedTitle: string;
  /** Participant body — the full-refund arbitration outcome. */
  readonly eventSessionDisputeResolvedRefundBody: string;
  /** Participant body — the partial-refund arbitration outcome. */
  readonly eventSessionDisputeResolvedPartialRefundBody: string;
  /** Participant body — the uphold arbitration outcome. */
  readonly eventSessionDisputeResolvedUpholdBody: string;
  // ─── Admin applicant-override event copy ──────────────────────────────────
  /** Applicant title — an administrator certified the application (terminal pass). */
  readonly eventApplicantOverrideCertifiedTitle: string;
  /**
   * Applicant body for the certification outcome — plain factual copy (no
   * admin identity, no evaluation scores; the application surface owns any
   * detailed review path).
   */
  readonly eventApplicantOverrideCertifiedBody: string;
  /** Applicant title — an administrator rejected the application (a re-apply window applies). */
  readonly eventApplicantOverrideRejectedTitle: string;
  /**
   * Applicant body for the rejected outcome — interpolates ONLY the
   * re-apply window length in whole days (the locale's day-count grammar).
   * No admin identity and no reason content (the body is an invite to the
   * application surface, not a verdict mirror).
   */
  readonly eventApplicantOverrideRejectedBody: (days: number) => string;
  /** Applicant title — an administrator granted a re-evaluation (the waiting period was cleared). */
  readonly eventApplicantOverrideReEvaluationTitle: string;
  /**
   * Applicant body for the granted re-evaluation — plain factual copy (no
   * admin identity; the booking surface owns the actionable next step).
   */
  readonly eventApplicantOverrideReEvaluationBody: string;
}
