/**
 * Errors namespace labels — machine-code → human-message map for GraphQL
 * `extensions.code` values. Used by the GraphQL `formatError` response
 * formatter + frontend error display.
 *
 * Keys are lowercase camelCase of the SCREAMING_SNAKE_CASE codes.
 */
export interface ErrorsLabels {
  readonly unauthorized: string;
  readonly forbidden: string;
  readonly validation: string;
  readonly conflict: string;
  /** "This value is already in use." — unique-constraint duplicate reject. */
  readonly duplicateRequest: string;
  readonly rateLimitExceeded: string;
  readonly notFound: string;
  readonly internalServerError: string;
  readonly badRequest: string;
  readonly serviceUnavailable: string;
  readonly invalidLocale: string;
  readonly invalidOrigin: string;
  readonly failedToSetLocale: string;
  /** "This account has been deleted." — login governance deny. */
  readonly accountDeleted: string;
  /** "This account has been blocked." — login governance deny. */
  readonly accountBlocked: string;
  /** "This account is suspended." — login governance deny. */
  readonly accountSuspended: string;
  /** "Your session has expired. Please sign in again." — token-expired banner. */
  readonly tokenExpired: string;
  /** "You do not have permission to access this page." — role-mismatch deny. */
  readonly forbiddenRole: string;
  /** "Teacher application not found." — self-applicants lookup miss → NotFoundError("APPLICANT"). */
  readonly applicantNotFound: string;
  /**
   * Cooldown reject for `ValidationError("APPLICANT_COOLDOWN_ACTIVE", …)`.
   * Interpolates ONLY the re-application expiry moment
   * via the single ICU placeholder `{cooldownUntil}` plus generic copy — no
   * other user data may enter this message. The placeholder NAME is
   * pinned identical across both locales by the parity tests.
   */
  readonly applicantCooldownActive: string;
  /** Fail-closed deny when an applicants row status cannot be interpreted as a known ApplicantStatus. */
  readonly applicantStatusCorrupt: string;
  /**
   * Plan-catalog domain errors — the flat `plan*` key family covering plan
   * lifecycle rejects (lookup miss, idempotent activate/deactivate) and
   * create/update field validation. Flat camelCase-of-code keys keep
   * transport emitters on the `errorsTranslations.<key>` access convention.
   */
  /** "The requested plan was not found." — plan lookup miss. */
  readonly planNotFound: string;
  /** "This plan is already inactive." — idempotent deactivate reject. */
  readonly planAlreadyInactive: string;
  /** "This plan is already active." — idempotent reactivate reject. */
  readonly planAlreadyActive: string;
  /** "Please enter a plan title." — required title validation. */
  readonly planTitleRequired: string;
  /** "The plan title is too long." — title length validation. */
  readonly planTitleTooLong: string;
  /** "The session count must be a positive number." */
  readonly planSessionCountInvalid: string;
  /** "The plan price must be a valid positive amount." */
  readonly planPriceInvalid: string;
  /** "The selected currency is not supported." */
  readonly planCurrencyInvalid: string;
  /** "The interval must be a positive number of days." */
  readonly planIntervalDaysInvalid: string;
  /** "No changes were provided." — empty update payload reject. */
  readonly planPatchEmpty: string;
  /**
   * "This plan is no longer available for subscription." — purchase-time
   * re-validation reject (decision D2): the plan is missing or deactivated
   * at checkout. Deliberately indistinguishable outcomes — one copy.
   */
  readonly planInactive: string;
  /**
   * "You already have a pending request for this plan." — unresolved
   * duplicate subscription-request reject (same user + same plan, status
   * still pending).
   */
  readonly subscriptionRequestExists: string;

  // ── Subscription payment-verification domain errors (DEV1-006 Phase B) ──
  /**
   * "The requested subscription request was not found." — the verification
   * mutation's id references no row (or a non-positive integer — the same
   * "cannot reference the entity" posture as `planNotFound`).
   */
  readonly subscriptionNotFound: string;
  /**
   * "This subscription request has already been resolved." — the row is no
   * longer pending (already verified, cancelled, …) or another admin's
   * verification won the guarded-write race.
   */
  readonly subscriptionAlreadyResolved: string;
  /**
   * "The selected payment method is not supported." — the method is outside
   * the offline verification set (offline_cash / bank_transfer).
   */
  readonly paymentMethodInvalid: string;
  /**
   * "Please enter the payment reference (1-255 characters)." — the offline
   * receipt reference failed the trim/length validation.
   */
  readonly paymentReferenceInvalid: string;
  /**
   * "The selected action filter is not supported." — the audit-trail
   * viewer's action filter narrowed to nothing in the sanctioned enum set.
   */
  readonly auditActionTypeInvalid: string;
}
