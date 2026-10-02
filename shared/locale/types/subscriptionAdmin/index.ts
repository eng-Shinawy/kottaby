/**
 * `subscriptionAdmin` namespace labels — the admin student drawer's
 * subscription-management section: the subscriptions list (query-driven
 * rows), the per-status lifecycle actions (active → extend/cancel/
 * change plan; expired → renew; pending/cancelled → none), and the four
 * action dialogs (extend, renew, cancel, change plan).
 *
 * Used by:
 *  - `SubscriptionAdminSection` + the four `subscriptions/dialogs/*Dialog`
 *    components + `useSubscriptionAdminActions` — every visible string on
 *    the surface resolves through `useAppTranslation(SubscriptionAdmin)`.
 *
 * Deliberately NOT duplicated here (single-sourced from their owning
 * namespaces, per reuse-first):
 *  - the dialog dismiss button — `common.cancel`;
 *  - server-denial copy — the wire error messages arrive already
 *    localized by the backend (`errorsTranslations.subscriptionAdmin.*`);
 *    dialogs render the server-localized message verbatim and fall back
 *    to `genericError` only when no message can be extracted.
 *
 * Scope: chrome copy only — plan titles render verbatim; dates render
 * through the shared locale-aware formatter. The interpolated values are
 * the client-computed action copy (added days, carried/forfeited session
 * counts from the mutation payload, relative expiry-window days); no raw
 * server identifiers ever flow through these labels.
 *
 * All keys MUST have both `en` and `ar` implementations with EXACT key-set
 * parity (compile-typed on both leaves — the primary parity gate is the
 * `Translations` interface where both leaf consts are typed
 * `SubscriptionAdminLabels`; the runtime parity suite walks grouped
 * sub-block leaves depth-first so the zero-dead-key discipline stays
 * enforced for nested blocks). Property access only — never call-by-key.
 */
export interface SubscriptionAdminLabels {
  /** Section card title inside the student detail drawer. */
  readonly title: string;

  /** Zero-rows copy (the section's empty state). */
  readonly emptyState: {
    /** Bolded headline. */
    readonly title: string;
    /** Supporting body line. */
    readonly message: string;
  };

  /** Per-row field captions. */
  readonly fields: {
    /** Plan snapshot title caption. */
    readonly plan: string;
    /** Lifecycle status caption. */
    readonly status: string;
    /** Period start caption (rendered through the locale date formatter). */
    readonly start: string;
    /** Period end caption (rendered through the locale date formatter). */
    readonly end: string;
    /** Last-audit-action caption (the row's trail teaser line; hidden while the peek is null). */
    readonly lastAction: string;
  };

  /**
   * The per-row plan-facts caption — the counted fragments the card joins
   * (with the composed price display) into the plan snapshot's summary
   * line under the header. Two single-count leaves so each locale owns
   * its CLDR counted form; the card owns the joiner and the order of the
   * value fragments (a caption, not a sentence).
   */
  readonly planFacts: {
    /** The plan's credited session count ("1 session" / "n sessions"). */
    readonly sessions: (sessions: number) => string;
    /** The plan's renewal cycle length ("1-day cycle" / "n-day cycle"). */
    readonly cycle: (days: number) => string;
  };

  /**
   * Lifecycle status chip labels — one slot per wire enum member (the
   * view resolves them through an exhaustive `Record<SubscriptionStatus,
   * string>` table; the `suspended` member exists but governance surfaces
   * own it, so this section only ever renders it honestly if it appears).
   */
  readonly status: {
    readonly active: string;
    readonly expired: string;
    readonly pending: string;
    readonly cancelled: string;
    readonly suspended: string;
  };

  /** Per-row action buttons (per-status availability is the view helper's job). */
  readonly actions: {
    /** Extend the active window (active rows). */
    readonly extend: string;
    /** Renew into a fresh period (expired rows). */
    readonly renew: string;
    /** Cancel balance-preserving (active rows). */
    readonly cancel: string;
    /** Change plan within the lane (active rows). */
    readonly changePlan: string;
  };

  /** The status filter-chip row's copy (the per-status labels reuse `status`). */
  readonly filter: {
    /** The unfiltered lens chip (carries the total count). */
    readonly all: string;
    /** The filtered lens matched zero rows while rows exist. */
    readonly empty: string;
  };

  /**
   * The summary strip's copy (the mini-cards above the chip row — the
   * per-status counts reuse the `status` slots; the value line of the
   * next-expiry card reuses the `expiryBadge` counted forms).
   */
  readonly summary: {
    /** The next-expiry card's caption. */
    readonly nextExpiry: string;
    /** The next-expiry card's value when no active row carries a bound. */
    readonly nextExpiryNone: string;
  };

  /**
   * The per-row relative expiry-window badge — the counted CLDR day forms
   * (the final day reads as the zero arm of `upcoming`); `past` only ever
   * receives a strictly positive elapsed count.
   */
  readonly expiryBadge: {
    /** The open-window arm ("ends in n days"; n = 0 renders the today form). */
    readonly upcoming: (days: number) => string;
    /** The elapsed arm ("expired n days ago"). */
    readonly past: (days: number) => string;
  };

  /** The per-row copy-id quick action (tooltip/aria + the copied state). */
  readonly copyId: {
    /** The copy tooltip/aria label. */
    readonly copy: string;
    /** The transient post-copy tooltip label. */
    readonly copied: string;
  };

  /** The per-row deep link into the admin audit trail (the row's entries). */
  readonly auditLink: string;

  /**
   * The audit deep link's trail-depth badge — the counted CLDR entry
   * forms for the row's audit-trail history (the read's
   * `auditEntriesCount`), rendered beside the link label.
   */
  readonly auditLinkCount: (count: number) => string;

  /**
   * The section-level copy-digest quick action (the header's icon button
   * that copies a plain-text digest of the visible subscriptions).
   */
  readonly digest: {
    /** The copy tooltip/aria label. */
    readonly copy: string;
    /** The transient post-copy tooltip label. */
    readonly copied: string;
  };

  readonly extend: {
    /** Dialog title. */
    readonly title: string;
    /** Days input label. */
    readonly daysLabel: string;
    /** Helper line under the days input. */
    readonly daysHelper: string;
    /** Client-side validation failure (whole days must be > 0). */
    readonly daysInvalid: string;
  };

  readonly renew: {
    /** Dialog title. */
    readonly title: string;
    /** Confirm-body copy (what a renewal opens + credits). */
    readonly message: string;
  };

  readonly cancel: {
    /** Dialog title. */
    readonly title: string;
    /** Confirm-body copy (balance-preserving semantics). */
    readonly message: string;
    /** Optional reason input label. */
    readonly reasonLabel: string;
    /**
     * Helper line under the reason input — the live character counter plus
     * the bounded-free-text note, composed HERE so the counter format never
     * drifts between locales (`count` = current raw length, `max` = the
     * UI-seam cap the dialog enforces).
     */
    readonly reasonCounter: (count: number, max: number) => string;
  };

  readonly changePlan: {
    /** Dialog title. */
    readonly title: string;
    /** Confirm-body copy (same-lane re-plan semantics). */
    readonly message: string;
    /** Target-plan select label. */
    readonly planLabel: string;
    /** Empty-options copy — no other active plan credits the same lane. */
    readonly noPlans: string;
    /**
     * Plan-catalog read failure inside the dialog — the directory
     * error-alert recipe's title/message pair; the retry label is reused
     * from the section-level `errorState.retry`.
     */
    readonly errorState: {
      readonly title: string;
      readonly message: string;
    };
  };

  /** Success toasts handed to the section's feedback snackbar. */
  readonly success: {
    /** Extend landed (added days from the submitted input). */
    readonly extend: (days: number) => string;
    /** Renew landed. */
    readonly renew: string;
    /** Cancel landed. */
    readonly cancel: string;
    /**
     * Plan change landed with nothing to report — the zero arm (a chosen
     * arm whose count is 0, e.g. the idempotent replay that moved nothing)
     * suppresses the counted clause and renders this plain line.
     */
    readonly planChange: string;
    /** Plan change landed on the upgrade arm (carried sessions from the payload). */
    readonly planChangeCarried: (carry: number) => string;
    /** Plan change landed on the downgrade arm (forfeited sessions from the payload). */
    readonly planChangeForfeited: (forfeit: number) => string;
  };

  /** Query-failure alert (title/message/retry — the directory error recipe). */
  readonly errorState: {
    readonly title: string;
    readonly message: string;
    readonly retry: string;
  };

  /** Dialog fallback when no server message can be extracted from a failure. */
  readonly genericError: string;
}
