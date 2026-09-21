/**
 * AdminBroadcasts namespace labels — the Super-Admin broadcast surface
 * (`/admin/broadcasts`): title/body composition, audience selection
 * (all users / role cohort / country cohort / subscription-plan cohort),
 * the send confirmation dialog, the pluralized success toast, the generic
 * send-failure state, PLUS the broadcast history & lifecycle surface
 * (History/Compose tabs, the history list with its filters/columns/pager,
 * the detail drawer with delivery counts and retraction note, and the
 * stop-confirmation dialog with its pluralized copy).
 *
 * Used by:
 *  - Frontend `BroadcastComposeContainer` (`useAppTranslation(AdminBroadcasts)`
 *    for every compose-form label, placeholder, validation message, audience
 *    option, confirm/cancel/send affordance, and the pluralized success toast
 *    carrying the server-returned recipient count).
 *  - Frontend `AdminBroadcastsContainer` + the history-section components
 *    (tabs, filter bar, table + status chips, pager, detail drawer, and the
 *    stop dialog — every history/lifecycle label and the pluralized
 *    stop-flow copy carrying the already-reached recipient count).
 *
 * Audience rules mirrored by the key set:
 *  - `audienceAll` — system-wide (`audience.type = all`).
 *  - `audienceRole` + `roleLabel` — role cohort (teacher/student/parent).
 *  - `audienceCountry` + `countryLabel`/`countryPlaceholder`/`countryHelperText`
 *    — exact-equality country cohort (trimmed, ≤ 100 characters).
 *  - `audiencePlan` + `planLabel`/`planLoading` — active-subscription plan
 *    cohort fed by the existing `adminPlansQueryDocument`.
 *
 * There is deliberately NO recipient-count preview label:
 * `previewDisclaimer` pins the oracle-hygiene posture (recipients are resolved
 * at send time) and the count only ever appears in server-resolved AFTER-the-
 * write copy. Count-bearing keys are FUNCTIONS (`successToast`,
 * `stopConfirmBody`, `stopSuccessToast`) and the numeric count is the ONLY
 * interpolated value in this namespace; no raw server data (copy, ids,
 * recipient lists) ever flows through these labels.
 *
 * All keys MUST have both `en` and `ar` implementations with EXACT key-set
 * parity (compile-typed on both leaves + `adminBroadcasts-namespace.parity.test.ts`
 * runtime belt). Property access only — never call-by-key.
 */
export interface AdminBroadcastsLabels {
  /** Compose-page heading. */
  readonly pageTitle: string;
  /** Compose-page subtitle — what the surface does. */
  readonly pageSubtitle: string;
  /** Broadcast title field label. */
  readonly titleLabel: string;
  /** Broadcast title field placeholder. */
  readonly titlePlaceholder: string;
  /** Inline validation message — empty broadcast title. */
  readonly titleRequired: string;
  /** Broadcast body/message field label. */
  readonly bodyLabel: string;
  /** Broadcast body/message field placeholder. */
  readonly bodyPlaceholder: string;
  /** Audience-type selector label. */
  readonly audienceLabel: string;
  /** Audience option — system-wide (all users). */
  readonly audienceAll: string;
  /** Audience option — a role cohort (teachers/students/parents). */
  readonly audienceRole: string;
  /** Audience option — an exact-match country cohort. */
  readonly audienceCountry: string;
  /** Audience option — an active-subscription plan cohort. */
  readonly audiencePlan: string;
  /** Companion role field label (audienceRole branch). */
  readonly roleLabel: string;
  /** Companion country field label (audienceCountry branch). */
  readonly countryLabel: string;
  /** Companion country field placeholder (audienceCountry branch). */
  readonly countryPlaceholder: string;
  /** Country field helper copy — exact-match + length contract. */
  readonly countryHelperText: string;
  /** Companion plan field label (audiencePlan branch). */
  readonly planLabel: string;
  /** Plan-select loading copy (plans query in flight). */
  readonly planLoading: string;
  /**
   * Oracle-hygiene disclaimer under the form — recipients are resolved at
   * send time; no recipient-count preview exists by design.
   */
  readonly previewDisclaimer: string;
  /** Confirmation-dialog title. */
  readonly confirmTitle: string;
  /** Confirmation-dialog body (static audience summary — no interpolation). */
  readonly confirmBody: string;
  /** Confirmation-dialog primary action. */
  readonly confirmAction: string;
  /** Confirmation-dialog dismiss action (also the form's cancel affordance). */
  readonly cancelAction: string;
  /** Compose-form submit action. */
  readonly sendAction: string;
  /** Submit action while the mutation is in flight (aria-busy state). */
  readonly sendingAction: string;
  /**
   * Success toast carrying the server-returned recipient count — pluralized
   * per locale rules (Arabic zero/singular/dual/few/plural branches). The
   * numeric count is the ONLY interpolated value in this namespace.
   */
  readonly successToast: (count: number) => string;
  /** Generic send-failure title (non-field errors are owned by the global toast host). */
  readonly errorTitle: string;

  // ─── History & lifecycle surface (tabs / list / detail / stop flow) ───────

  /** Tab label — the broadcast history panel (the page's default tab). */
  readonly historyTab: string;
  /** Tab label — the compose panel hosting the existing compose form. */
  readonly composeTab: string;
  /** History-panel heading. */
  readonly historyTitle: string;
  /** History-panel subtitle — what the list shows. */
  readonly historySubtitle: string;
  /** Filter field label — free-text broadcast-title search. */
  readonly filterSearchLabel: string;
  /** Filter field label — lifecycle status selector. */
  readonly filterStatusLabel: string;
  /** Filter field label — audience-type selector (its kind options reuse the compose audience keys). */
  readonly filterAudienceLabel: string;
  /** Generic "no filter applied" option shared by the status and audience-type selectors. */
  readonly filterAllLabel: string;
  /** Filter-bar APPLY action — commits the draft search (form submit). */
  readonly filterApply: string;
  /** Filter-bar RESET action — clears the draft + applied filters back to all. */
  readonly filterReset: string;
  /** Table column header — broadcast title. */
  readonly columnTitle: string;
  /** Table column header — audience cohort. */
  readonly columnAudience: string;
  /** Table column header — resolved recipient count. */
  readonly columnRecipientCount: string;
  /** Table column header — lifecycle status. */
  readonly columnStatus: string;
  /** Table column header — send timestamp. */
  readonly columnSentAt: string;
  /** Table column header — the administrator who sent the broadcast. */
  readonly columnSentBy: string;
  /** Table column header — row actions (view details / stop). */
  readonly columnActions: string;
  /** Status chip — the broadcast is still active. */
  readonly statusActive: string;
  /** Status chip — the broadcast was stopped (its notification retracted). */
  readonly statusStopped: string;
  /** Row action — open the broadcast detail drawer. */
  readonly viewDetails: string;
  /** Row action — open the stop-confirmation dialog. */
  readonly stopAction: string;
  /** Detail drawer heading. */
  readonly detailTitle: string;
  /** Detail field — audience cohort. */
  readonly detailAudience: string;
  /** Detail field — resolved recipient count. */
  readonly detailRecipients: string;
  /** Detail field — delivered-notification count. */
  readonly detailDelivered: string;
  /** Detail field — read-notification count. */
  readonly detailRead: string;
  /** Detail field — unread-notification count. */
  readonly detailUnread: string;
  /** Detail field — send timestamp. */
  readonly detailSentAt: string;
  /** Detail field — stop timestamp (shown for stopped broadcasts only). */
  readonly detailStoppedAt: string;
  /** Detail field — the administrator who stopped the broadcast (shown for stopped broadcasts only). */
  readonly detailStoppedBy: string;
  /** Detail note — retraction explanation rendered for stopped broadcasts. */
  readonly detailRetractedNote: string;
  /** Stop-confirmation dialog title. */
  readonly stopConfirmTitle: string;
  /**
   * Stop-confirmation dialog body carrying the recipients-already-reached
   * count — pluralized per locale rules (Arabic zero/singular/dual/few/
   * plural branches). The numeric count is the ONLY interpolated value.
   */
  readonly stopConfirmBody: (count: number) => string;
  /** Stop-confirmation dialog primary action. */
  readonly stopConfirmAction: string;
  /** Stop-confirmation dialog dismiss action. */
  readonly stopConfirmCancel: string;
  /**
   * Success toast for the stop mutation carrying the recipients-already-
   * reached count — pluralized per locale rules (Arabic zero/singular/dual/
   * few/plural branches). The numeric count is the ONLY interpolated value.
   */
  readonly stopSuccessToast: (count: number) => string;
  /** Empty-state heading — no broadcasts match (or none exist yet). */
  readonly emptyTitle: string;
  /** Empty-state body — where sent broadcasts appear. */
  readonly emptyBody: string;
  /** Pager affordance — previous page. */
  readonly pagerPrev: string;
  /** Pager affordance — next page. */
  readonly pagerNext: string;
}
