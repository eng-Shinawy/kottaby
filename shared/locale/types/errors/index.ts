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
  /** "The free trial credit has already been granted for this student." — re-grant attempt on a student whose trial_granted_at marker is non-null. */
  readonly trialAlreadyGranted: string;
}
