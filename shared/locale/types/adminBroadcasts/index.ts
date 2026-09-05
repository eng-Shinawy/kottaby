/**
 * AdminBroadcasts namespace labels — the Super-Admin broadcast compose
 * surface (`/admin/broadcasts`): title/body composition, audience selection
 * (all users / role cohort / country cohort / subscription-plan cohort),
 * the confirmation dialog, the pluralized success toast, and the generic
 * send-failure state.
 *
 * Used by:
 *  - Frontend `BroadcastComposeContainer` (`useAppTranslation(AdminBroadcasts)`
 *    for every compose-form label, placeholder, validation message, audience
 *    option, confirm/cancel/send affordance, and the pluralized success toast
 *    carrying the server-returned recipient count).
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
 * at send time) and `successToast(count)` is the ONLY carrier of the recipient
 * count — resolved from the server response AFTER the write. The count is the
 * sole interpolated value in this namespace; no raw server data (copy, ids,
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
}
