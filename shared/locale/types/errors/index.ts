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
}
