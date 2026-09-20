/**
 * Errors namespace labels — machine-code → human-message map for GraphQL
 * `extensions.code` values. Used by the GraphQL `formatError` response
 * formatter + frontend error display.
 *
 * Keys are lowercase camelCase of the SCREAMING_SNAKE_CASE codes.
 */
/**
 * Lesson-catalog domain failures surfaced to admins through the `errors`
 * namespace. Each leaf is a self-contained sentence (no key echo) consumed by
 * lesson services via property access on the localized bundle:
 * `errorsTranslations.lessonCatalog.<key>`. Admin-authored identifiers (lesson
 * id, plan id) MUST NOT appear in these strings — only generic, user-facing
 * copy.
 */
interface LessonCatalogErrorsLabels {
  readonly lessonNotFound: string;
  readonly lessonTitleRequired: string;
  readonly lessonTitleTooLong: string;
  readonly lessonPlanNotFound: string;
  readonly lessonPatchEmpty: string;
}

interface PlanCatalogErrorsLabels {
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

/**
 * Subscription-purchase domain failures surfaced to students through the
 * `errors` namespace. Each leaf is a self-contained sentence (no key echo)
 * consumed via property access on the localized bundle:
 * `errorsTranslations.subscriptionPurchase.<key>`. Plan identifiers and
 * gateway references MUST NOT appear in these strings — only generic,
 * user-facing copy.
 */
interface SubscriptionPurchaseErrorsLabels {
  /** Purchase reject: the plan id does not resolve to an ACTIVE plan row → NotFoundError("PLAN"). */
  readonly planNotPurchasable: string;
  /** Fail-closed purchase reject: the plan's balance lane was never configured → ValidationError("PLAN_LANE_UNCONFIGURED"). */
  readonly planLaneUnconfigured: string;
  /** Missing `X-Idempotency-Key` header on the purchase mutation → ValidationError (VALIDATION). */
  readonly idempotencyKeyRequired: string;
  /** The gateway payment reference already identifies another subscription → ConflictError (CONFLICT). */
  readonly paymentReferenceConflict: string;
  /** Settlement quarantine: the provider's claimed amount/currency did not match the stored payment (no write applied). */
  readonly paymentAmountMismatch: string;
  /** Purchase reject: the plan price is not a non-negative decimal amount with at most two fraction digits → ValidationError (VALIDATION, gateway cents guard). */
  readonly planPriceShapeInvalid: string;
  /** Purchase reject: the plan price's cent value exceeds the supported amount range → ValidationError (VALIDATION, gateway cents guard). */
  readonly planPriceOutOfRange: string;
}

/**
 * Admin subscription-lifecycle failures surfaced to operators through the
 * `errors` namespace. Each leaf is a self-contained sentence (no key echo)
 * consumed by the admin services via property access on the localized
 * bundle: `errorsTranslations.subscriptionAdmin.<key>`. Subscription ids,
 * plan ids, and other admin-authored identifiers MUST NOT appear in these
 * strings — only generic, user-facing copy.
 */
interface SubscriptionAdminErrorsLabels {
  /** Active-only deny: extend, cancel, or plan change targeted a subscription whose status is not `active`. */
  readonly notActive: string;
  /** Expired-only deny: renewal targeted a subscription whose status is not `expired`. */
  readonly notExpired: string;
  /** Plan-change reject: the target plan credits a different balance lane than the source plan (cross-lane migration unsupported). */
  readonly incompatibleLane: string;
  /** Plan-change reject: the target plan row is inactive. */
  readonly inactivePlan: string;
  /** Plan-change reject: the target plan is the subscription's current plan. */
  readonly samePlan: string;
  /** Validation reject: the requested extension or the resulting validity window exceeds the maximum allowed interval, or the resulting/target plan's session count exceeds the maximum session ceiling — the window/interval bound and the session-count ceiling (renew + plan-change) share this key. */
  readonly prorationOverflow: string;
  /** Replay conflict: this subscription was already renewed — the original result is replayed. */
  readonly alreadyRenewed: string;
  /** Replay conflict: this subscription's plan was already changed — the original result is replayed. */
  readonly alreadyPlanChanged: string;
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
  /** Lesson-catalog domain failures (lookup miss, title validation, plan gating, empty patch). */
  readonly lessonCatalog: LessonCatalogErrorsLabels;
  /** Subscription-purchase domain failures (plan gating, lane gating, idempotency, reference conflicts, settlement mismatch). */
  readonly subscriptionPurchase: SubscriptionPurchaseErrorsLabels;
  /** Admin subscription-lifecycle failures (state denials, plan-change guards, proration bounds, replay conflicts). */
  readonly subscriptionAdmin: SubscriptionAdminErrorsLabels;
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
   * Terminal purchase deny for `ValidationError("APPLICANT_ALREADY_CERTIFIED", …)`.
   * Certification (`passed`) closes the verification-purchase surface for the
   * account — generic copy only; no identifiers may enter this message.
   */
  readonly applicantAlreadyCertified: string;
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
    /** Conflict when suspending an account that is already suspended. */
    readonly userAlreadySuspended: string;
    /** Conflict when blocking an account that is already blocked. */
    readonly userAlreadyBlocked: string;
    /** Conflict when unsuspending an account that is not currently suspended. */
    readonly userNotSuspended: string;
    /** Conflict when unblocking an account that is not currently blocked. */
    readonly userNotBlocked: string;
    /** Self-protection deny: an admin attempted to suspend their own account. */
    readonly userSelfSuspensionForbidden: string;
    /** Self-protection deny: an admin attempted to block their own account. */
    readonly userSelfBlockForbidden: string;
    /** Validation reject: suspension periodDays must be a whole number between 1 and 3650. */
    readonly suspensionPeriodInvalid: string;
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
  /** Homework-timing reject — homework creation attempted for a session whose teacher report has not been submitted (INV-S8 gate). */
  readonly homeworkRequiresReport: string;
  /** Availability-gate reject — the teacher is currently in a started session and cannot be toggled available (INV-S6 seam gate; no session id disclosed). */
  readonly teacherInActiveSession: string;
  /** "The selected teacher was not found." — teacher lookup miss on booking (dedicated key, not the generic `notFound`). */
  readonly teacherNotFound: string;
  /** Expiry reject — the caller's subscription validity window has ended, so the booking cannot be funded by it. */
  readonly subscriptionExpired: string;
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
  /**
   * Wallet unavailable — the caller has no teacher profile row yet (their
   * teaching application is still pending), so no wallet exists to read
   * or debit. The honest typed deny instead of a raw FK failure.
   */
  readonly walletTeacherProfileMissing: string;
  /** Fail-closed deny when a stored sessions.intent value is not a known SessionIntent member. */
  readonly sessionIntentCorrupt: string;
  /** "A recitation record already exists for this session." — write-once reject when a recitation row is already stored for the session → ConflictError("RECITATION_ALREADY_EXISTS", …). */
  readonly recitationAlreadyExists: string;
  /** Writeability reject — the session's current status does not admit a recitation record (only started-or-later sessions do) → ConflictError("RECITATION_SESSION_NOT_WRITEABLE", …). */
  readonly recitationSessionNotWriteable: string;
  /** "The start time must be before the end time." — admin reschedule reject: the submitted timing pair is inverted. */
  readonly sessionRescheduleWindowInvalid: string;
  /** "The start time cannot be more than 5 minutes in the past." — admin reschedule reject: the submitted start lies outside the start-time grace window. */
  readonly sessionRescheduleStartInPast: string;
  /** "A session report has already been submitted for this session." — unique-constraint loser on the one-report-per-session rule → ConflictError("SESSION_REPORT_ALREADY_EXISTS", …). */
  readonly sessionReportAlreadyExists: string;
  /** "This homework has already been graded." — one-shot grade-window reject on an already-graded homework row → ConflictError. */
  readonly homeworkAlreadyGraded: string;
  /** Validation reject — session-report notes are required and cannot be empty after trimming. */
  readonly sessionReportNotesRequired: string;
  /** Validation reject — session-report notes exceed the 2000-character bound. */
  readonly sessionReportNotesTooLong: string;
  /** Validation reject — the session rating is not an integer within 0..5. */
  readonly sessionRatingRange: string;
  /** Validation reject — a homework grade is not an integer within 0..100. */
  readonly homeworkGradeRange: string;
  /** Validation reject — a homework ayah range is malformed: non-positive, non-integer, or from > to. */
  readonly homeworkAyahRangeInvalid: string;
  /** Validation reject — a homework surah/juz reference is not a member of the shipped SurahJuzRef vocabulary. */
  readonly homeworkSurahJuzInvalid: string;
  /** Validation reject — a homework assignment carries neither the current nor the revision block. */
  readonly homeworkAssignmentBlocksRequired: string;
  /** Classification reject — the submitted dispute resolution does not apply to the session's escrow generation (held escrow admits only Cancel/Complete; consumed escrow only Refund/PartialRefund/Uphold). */
  readonly disputeResolutionMismatch: string;
  /** Validation reject — a partial-refund amount is missing, malformed (not a decimal string with up to 2 fractions), non-positive, or not strictly below the session fee. */
  readonly partialRefundAmountInvalid: string;
  /** "The requested withdrawal was not found." — admin settlement lookup miss on a teacher_transaction id → NotFoundError. */
  readonly withdrawalRequestNotFound: string;
  /** "This withdrawal request is no longer pending." — settlement reject once the row was already approved or rejected → ConflictError. */
  readonly withdrawalNotPending: string;
  /** "Enter a valid adjustment amount (a positive value with up to 2 decimal places)." — pre-DB manual wallet-adjustment amount reject → ValidationError. */
  readonly invalidAdjustmentAmount: string;
  /** "An adjustment reason is required and cannot be empty." — pre-DB manual wallet-adjustment reason reject → ValidationError. */
  readonly adjustmentReasonRequired: string;
  /** "The adjustment direction must be either credit or debit." — fail-closed manual wallet-adjustment direction reject (a non-GraphQL caller passing a non-member direction) → ValidationError. */
  readonly invalidAdjustmentDirection: string;
  /** Rating-gate reject — the session cannot receive a teacher rating yet (not completed, or missing a participant's completion stamp) → ConflictError("EVALUATION_SESSION_NOT_COMPLETED", …). */
  readonly evaluationSessionNotCompleted: string;
  /** Write-once reject — the caller already rated the teacher for this session (unique-constraint loser) → ConflictError("EVALUATION_ALREADY_SUBMITTED", …). */
  readonly evaluationAlreadySubmitted: string;
  /** Validation reject — the submitted teacher rating is not an integer within 1..5. */
  readonly teacherRatingInvalid: string;
  /** Loop-complete reject — every evaluation credit of the current cycle is already consumed by completed bookings → ConflictError. */
  readonly evaluationLoopComplete: string;
  /** Capacity reject — the current cycle has no remaining evaluation credits (the five-credit ceiling is reached) → ConflictError. */
  readonly noEvaluationCreditsRemaining: string;
  /** Distinctness reject — the chosen evaluator is already booked (non-cancelled) in the current cycle → ConflictError. */
  readonly evaluatorAlreadyUsed: string;
  /** Governance reject — the caller's application is not in the in_evaluation lifecycle stage → ConflictError. */
  readonly applicantNotInEvaluation: string;
  /** Cycle reject — no ACTIVE verification subscription opens an evaluation cycle (the purchase is not completed) → ConflictError. */
  readonly verificationSubscriptionNotActive: string;
}

export type ErrorMessageKey = {
  [K in keyof ErrorsLabels]: ErrorsLabels[K] extends string ? K : never;
}[keyof ErrorsLabels];
