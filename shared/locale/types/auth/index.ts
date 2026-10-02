/**
 * Auth namespace labels — registration form + auth error messages.
 *
 * Used by:
 *  - Frontend register form (`useAppTranslation(Auth)` for labels)
 *  - Backend service (`getServerTranslations(locale).authTranslations` for
 *    validation/conflict messages)
 *
 * All keys MUST have both `en` and `ar` implementations. Interpolation uses
 * ICU `{var}` format (consumed by shared/locale/format.ts when available).
 */
export interface AuthLabels {
  /** Form labels */
  readonly registerTitle: string;
  readonly registerSubtitle: string;
  readonly fullName: string;
  readonly email: string;
  readonly phone: string;
  readonly password: string;
  readonly gender: string;
  readonly country: string;
  readonly role: string;
  readonly roleStudent: string;
  readonly roleTeacher: string;
  readonly roleParent: string;
  readonly roleStudentHelper: string;
  readonly roleTeacherHelper: string;
  readonly roleParentHelper: string;
  readonly submit: string;
  readonly haveAccount: string;
  readonly loginLink: string;
  /** Validation errors */
  readonly nameRequired: string;
  readonly emailRequired: string;
  readonly emailInvalid: string;
  readonly phoneRequired: string;
  readonly phoneInvalid: string;
  readonly passwordRequired: string;
  readonly passwordTooShort: string;
  readonly countryRequired: string;
  /** Country selector validation (ISO 3166-1 alpha-2 codes) */
  readonly countryCodeRequired: string;
  readonly countryCodeInvalid: string;
  readonly roleRequired: string;
  readonly roleForbidden: string;
  /** Conflict / server errors */
  readonly emailAlreadyExists: string;
  readonly registrationFailed: string;
  readonly rateLimitExceeded: string;
  /** Login flow labels + messages */
  readonly loginTitle: string;
  readonly loginSubtitle: string;
  readonly loginEmail: string;
  readonly loginPassword: string;
  readonly loginSubmit: string;
  readonly loginError: string;
  readonly noAccount: string;
  readonly registerLink: string;
  readonly invalidCredentials: string;
  readonly accountBlocked: string;
  readonly logout: string;
  readonly welcomeBack: string;
  /** Gender options (translated) */
  readonly genderMale: string;
  readonly genderFemale: string;
  readonly genderOther: string;
  /** Password visibility toggle */
  readonly showPassword: string;
  readonly hidePassword: string;
  /** Registration success message */
  readonly registrationSuccess: string;
  /** Locale switcher */
  readonly switchToEnglish: string;
  readonly switchToArabic: string;
  /** Brand tagline for auth pages */
  readonly brandTagline: string;
  /** Register form section labels (2-column split layout) */
  readonly accountInfoSection: string;
  readonly preferencesSection: string;
  /** Auth layout brand-panel pitch + trust badges (DASHBOARD-1). */
  readonly brandPitchTitle: string;
  readonly brandPitchBody: string;
  readonly trustVerifiedShuyukh: string;
  readonly trustQiraat: string;
  readonly trustSecurePrivate: string;
  /** Password strength meter */
  readonly passwordStrengthWeak: string;
  readonly passwordStrengthFair: string;
  readonly passwordStrengthGood: string;
  readonly passwordStrengthStrong: string;
  /** Forgot password */
  readonly forgotPassword: string;
  /** Remember me */
  readonly rememberMe: string;
  /** Document titles for auth route metadata (generateMetadata) */
  readonly loginMetaTitle: string;
  readonly registerMetaTitle: string;
  /**
   * Forced self-service change-password page (`/change-password`) — the
   * only surface a flagged user can act on, also reachable voluntarily.
   * Rendered through the `Auth` namespace handle (the login form's
   * namespace); server denials arrive via `errorsTranslations` keys.
   */
  readonly changePassword: {
    /** Page title for the change-password page. */
    readonly title: string;
    /** Description line under the title explaining why the page is shown. */
    readonly description: string;
    /** Field label for the current-password input. */
    readonly currentPasswordLabel: string;
    /** Field label for the new-password input. */
    readonly newPasswordLabel: string;
    /** Field label for the confirm-new-password input. */
    readonly confirmPasswordLabel: string;
    /** Submit button label for the change-password form. */
    readonly submit: string;
    /** Inline validation error when new and confirm passwords disagree. */
    readonly mismatch: string;
    /** Success message shown after the password change commits. */
    readonly success: string;
    /** Notice explaining that a temporary password was issued to the user. */
    readonly temporaryPasswordNotice: string;
    /**
     * Neutral form-level fallback for a field-less denial whose wire
     * message is unusable (transport-level failure with no GraphQL message
     * in the cause chain) — deliberately NOT the login-specific copy.
     */
    readonly genericFailure: string;
  };
}
