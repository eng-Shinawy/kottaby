/**
 * Errors namespace labels — machine-code → human-message map for GraphQL
 * `extensions.code` values. Used by the GraphQL `formatError` response
 * formatter + frontend error display.
 *
 * Keys are lowercase camelCase of the SCREAMING_SNAKE_CASE codes.
 */
export interface PlanCatalogErrorsLabels {
  readonly planNotFound: string;
  readonly planAlreadyInactive: string;
  readonly planAlreadyActive: string;
  readonly planTitleRequired: string;
  readonly planTitleTooLong: string;
  readonly planSessionCountInvalid: string;
  readonly planPriceInvalid: string;
  readonly planCurrencyInvalid: string;
  readonly planIntervalDaysInvalid: string;
  readonly planPatchEmpty: string;
}

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
  readonly planCatalog: PlanCatalogErrorsLabels;
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
   * Admin-user-management domain failures surfaced to operators through the
   * `errors` namespace. Each leaf is a self-contained sentence (no key echo)
   * consumed by admin services via property access on the localized bundle:
   * `errorsTranslations.adminUsers.<key>`. Admin-authored identifiers (email,
   * user id, role values) MUST NOT appear in these strings — only generic,
   * user-facing copy.
   */
  readonly adminUsers: {
    /** Lookup miss for a user id that does not resolve to a `users` row. */
    readonly userNotFound: string;
    /** Conflict when soft-deleting an account that is already soft-deleted. */
    readonly userAlreadyDeleted: string;
    /** Conflict when reactivating an account that is not currently soft-deleted. */
    readonly userNotDeleted: string;
    /** Self-protection deny: an admin attempted to soft-delete their own account. */
    readonly userSelfDeactivationForbidden: string;
    /** Creation deny: an admin attempted to provision an `admin` role through this surface. */
    readonly adminRoleCreationForbidden: string;
    /** Validation deny: a profile patch carried no whitelisted field. */
    readonly userPatchEmpty: string;
    /**
     * Near-unreachable deny: server-generated `handshake_code` retry budget
     * exhausted on consecutive unique-violation collisions. Surfaced as
     * `ConflictError("HANDSHAKE_EXHAUSTED", …)`; admin-authored identifiers
     * MUST NOT appear in the message — only generic copy.
     */
    readonly handshakeExhausted: string;
  };
  /** Fail-closed deny when a stored notifications.type value is not a known NotificationType member. */
  readonly notificationTypeCorrupt: string;
  /** Fail-closed deny when a stored users.locale value is not a known AppLocale member. */
  readonly userLocaleCorrupt: string;
  /** "The notification was not found." — self-scope notification lookup miss → NotFoundError("NOTIFICATION"). */
  readonly notificationNotFound: string;
  /** "Handshake codes look like KSB-XXXXXXXX (8 hexadecimal characters)." — malformed handshake-code reject → ValidationError (VALIDATION). */
  readonly handshakeCodeInvalid: string;
  /** "Student record not found." — caller has no students row → NotFoundError("STUDENT"). */
  readonly studentHandshakeNotFound: string;
  /** "The free trial credit has already been granted for this student." — re-grant attempt on a student whose trial_granted_at marker is non-null. */
  readonly trialAlreadyGranted: string;
  /** "This teacher is already certified." — certification attempt on an approved teachers row → ConflictError("TEACHER_ALREADY_CERTIFIED", …). */
  readonly teacherAlreadyCertified: string;
  /** "This user is not a teacher." — certification attempt on a non-``teacher`` account → ConflictError("TEACHER_ROLE_REQUIRED", …). */
  readonly teacherRoleRequired: string;
  /** "This account has been deleted, blocked, or suspended." — certification attempt on a governed account → ConflictError("TEACHER_ACCOUNT_GOVERNED", …). */
  readonly teacherAccountGoverned: string;
  /** "This student is already linked to a parent account." — link-request deny when the target student already has a linked parent. */
  readonly parentLinkTargetAlreadyLinked: string;
  /** "A link request to this student is already pending." — duplicate-pending deny while a previous request is still awaiting a response. */
  readonly parentLinkAlreadyPending: string;
  /** "This link request has expired." — respond/cancel deny once the request is past its expiry moment. */
  readonly parentLinkRequestExpired: string;
  /** "This link request has already been handled." — transition deny when the request was already confirmed or rejected. */
  readonly parentLinkRequestAlreadyResolved: string;
  /** "The link request was not found." — self-scope link-request lookup miss → NotFoundError("PARENT_LINK_REQUEST"). */
  readonly parentLinkRequestNotFound: string;
  /** "Broadcast title must be between 1 and 255 characters." — compose-copy reject → ValidationError("BROADCAST_TITLE_INVALID"). */
  readonly broadcastTitleInvalid: string;
  /** Audience-selector coherence reject → ValidationError("BROADCAST_AUDIENCE_INVALID"): unknown audience kind, missing/extra companion field, or malformed companion value. */
  readonly broadcastAudienceInvalid: string;
  /** "No recipients match the selected broadcast audience." — empty-cohort reject → ValidationError("BROADCAST_AUDIENCE_EMPTY"). */
  readonly broadcastAudienceEmpty: string;
  /** Oversized-cohort reject → ValidationError("BROADCAST_AUDIENCE_TOO_LARGE"): resolved cohort exceeds the fail-closed recipient cap. */
  readonly broadcastAudienceTooLarge: string;
  /** "The requested session was not found." — session lookup or ownership miss on any session surface. */
  readonly sessionNotFound: string;
  /** Lifecycle-transition reject — the requested action does not apply to the session's current status. */
  readonly sessionInvalidTransition: string;
  /** Certification-gate reject — the targeted teacher account is not yet approved to host sessions. */
  readonly teacherNotCertified: string;
  /** "The selected teacher was not found." — teacher lookup miss on booking (dedicated key, not the generic `notFound`). */
  readonly teacherNotFound: string;
  /** Balance reject — the caller's lane balances cannot cover the booking fee. */
  readonly insufficientBalance: string;
  /** Missing `X-Idempotency-Key` header on an idempotent write surface. */
  readonly idempotencyKeyRequired: string;
  /** Pre-DB intent validation reject — the requested intent is not bookable on this surface. */
  readonly invalidSessionIntent: string;
  /**
   * Pre-DB withdrawal-amount reject — the requested payout amount failed
   * the decimal-string validation matrix (shape or non-positive value).
   */
  readonly walletInvalidAmount: string;
  /** Fail-closed deny when a stored sessions.intent value is not a known SessionIntent member. */
  readonly sessionIntentCorrupt: string;
}

export type ErrorMessageKey = {
  [K in keyof ErrorsLabels]: ErrorsLabels[K] extends string ? K : never;
}[keyof ErrorsLabels];
