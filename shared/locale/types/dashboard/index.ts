/**
 * Dashboard namespace labels — sidebar nav + dashboard stat cards + profile
 * page strings.
 *
 * Used by:
 *  - Frontend `DashboardLayout` (`useAppTranslation(Dashboard)` for the
 *    sidebar nav items + app-bar actions).
 *  - Frontend `DashboardView` (`useAppTranslation(Dashboard)` for the welcome
 *    message + placeholder stat cards).
 *  - Frontend `ProfileView` (`useAppTranslation(Dashboard)` for account info,
 *    preferences, account status, change-password form, action buttons).
 *
 * All keys MUST have both `en` and `ar` implementations.
 */
export interface DashboardLabels {
  /** App-bar / sidebar brand title (kept here for layout components that don't need Auth). */
  readonly title: string;
  /** Sidebar nav: Dashboard link (the home/landing nav item) */
  readonly dashboard: string;
  /** Welcome message shown at the top of the dashboard view (interpolated with the user's name). */
  readonly welcome: (userName: string) => string;
  /** Sidebar nav: Sessions link */
  readonly sessions: string;
  /** Sidebar nav: Subscriptions link */
  readonly subscriptions: string;
  /** Sidebar nav: Homework link */
  readonly homework: string;
  /** Sidebar nav: Schedule link */
  readonly schedule: string;
  /** Sidebar nav: Wallet link */
  readonly wallet: string;
  /** Sidebar nav: Users link (admin) */
  readonly users: string;
  /** Sidebar nav: Teachers link (admin) */
  readonly teachers: string;
  /** Sidebar nav: Students link (admin) */
  readonly students: string;
  /** Sidebar nav: Academic Tracking link (admin — the academic monitoring dashboard) */
  readonly academicTracking: string;
  /** Sidebar nav: Plans link (admin) */
  readonly plans: string;
  /** Sidebar nav: Find Teachers link (student — the available-teachers directory browse) */
  readonly findTeachers: string;
  /** Sidebar nav: Lessons link (admin — curriculum management under a plan) */
  readonly lessons: string;
  /** Sidebar nav: Audit link (admin) */
  readonly audit: string;
  /** Sidebar nav: Finances link (admin — the financial auditing console) */
  readonly finances: string;
  /** Sidebar nav: Analytics link (admin — the platform analytics dashboard) */
  readonly analytics: string;
  /** Sidebar nav: Broadcasts link (admin — the broadcast compose surface) */
  readonly broadcasts: string;
  /** Sidebar nav: Disputes link (admin — session arbitration queue) */
  readonly disputes: string;
  /** Sidebar nav: Session Governance link (admin — admin session directory: filter, reschedule, cancel, reassign) */
  readonly sessionGovernance: string;
  /** Sidebar nav: Profile link */
  readonly profile: string;
  /** Sidebar nav: Children link (parent) */
  readonly children: string;
  /** Sidebar nav: Link Requests link (student) */
  readonly linkRequests: string;
  /** Coming-soon placeholder title for unimplemented routes */
  readonly comingSoon: string;
  /** Coming-soon placeholder body — interpolated with the feature name */
  readonly comingSoonBody: (feature: string) => string;
  /** Stat card: Sessions Completed label */
  readonly sessionsCompleted: string;
  /** Stat card: Balance label */
  readonly balance: string;
  /** Stat card: Upcoming label */
  readonly upcoming: string;
  /** Stat card: Notifications label */
  readonly notifications: string;
  /** Stat card (student): Active Subscriptions label */
  readonly activeSubscriptions: string;
  /** Stat card (parent): Linked Children label */
  readonly linkedChildren: string;
  /** Stat card (parent): Total Sessions label (summed across linked children) */
  readonly totalSessions: string;
  /** Stat card (parent): Reports Received label (summed across linked children) */
  readonly reportsReceived: string;
  /** Stat card (admin): Total Users label */
  readonly totalUsers: string;
  /** Stat card (admin): Teachers label (teacher accounts count) */
  readonly totalTeachers: string;
  /** Stat card (admin): Students label (student accounts count) */
  readonly totalStudents: string;
  /** Stat value placeholder rendered while a stat is unavailable (error-degraded). */
  readonly statUnavailable: string;
  /** Accessible status text announced while stat values are loading. */
  readonly statLoading: string;
  /**
   * Student balance-card popover: title of the prepaid-credits breakdown
   * surface (also composed into the interactive card's accessible name as
   * the affordance hint — activation opens the popover this title heads).
   */
  readonly balanceBreakdownTitle: string;
  /** Student balance-card popover: the NOT NULL Trial lane chip label. */
  readonly balanceLaneTrial: string;
  /** Student balance-card popover: the purchased Hifz lane chip label. */
  readonly balanceLaneHifz: string;
  /** Student balance-card popover: the purchased Tajweed lane chip label. */
  readonly balanceLaneTajweed: string;
  /** Student balance-card popover: the purchased Reviews (recitation) lane chip label. */
  readonly balanceLaneReviews: string;
  /**
   * Student balance-card popover: the honest-scope note rendered in every
   * state — these are the caller's OWN prepaid session credits, and
   * subscription-covered sessions are intentionally out of view.
   */
  readonly balanceBreakdownNote: string;
  /** Sign-out button label (app-bar) */
  readonly signOut: string;
  /** Profile page: Account Information card title */
  readonly accountInfo: string;
  /** Profile page: Preferences card title */
  readonly preferences: string;
  /** Profile page: language preference group label (Preferences card) */
  readonly language: string;
  /** Profile page: Recitation reading card title */
  readonly recitationReading: string;
  /** Profile page: Account status card title */
  readonly accountStatus: string;
  /** Profile page: Change password card title */
  readonly changePassword: string;
  /** Profile page: Current password field label */
  readonly currentPassword: string;
  /** Profile page: New password field label */
  readonly newPassword: string;
  /** Profile page: Confirm new password field label */
  readonly confirmPassword: string;
  /** Profile page: Update password button label */
  readonly updatePassword: string;
  /** Profile page: Edit profile button label (placeholder) */
  readonly editProfile: string;
  /** Profile page: Back to dashboard button label */
  readonly backToDashboard: string;
  /** Profile page: full-name row label */
  readonly fullName: string;
  /** Profile page: email row label */
  readonly email: string;
  /** Profile page: phone row label */
  readonly phone: string;
  /** Profile page: role row label */
  readonly role: string;
  /** Profile page: country row label */
  readonly country: string;
  /** Profile page: gender row label */
  readonly gender: string;
  /** Profile page: "Not provided" placeholder for missing optional fields */
  readonly notProvided: string;
  /** Profile page: Account status badge — active (healthy) */
  readonly statusActive: string;
  /** Profile page: Account status badge — deleted */
  readonly statusDeleted: string;
  /** Profile page: Account status badge — suspended */
  readonly statusSuspended: string;
  /** Profile page: Account status badge — blocked */
  readonly statusBlocked: string;
  /** Profile page: change-password feature-not-available notice */
  readonly changePasswordNotice: string;
  /** Profile page: edit-profile feature-not-available notice */
  readonly editProfileNotice: string;
  /** Profile page: language preference — saved-to-account notice (Preferences card) */
  readonly languageNotice: string;
  /** Profile page: language preference — caption naming the persisted account value when it differs from the active UI locale */
  readonly languageSaved: (languageName: string) => string;
  /** Profile page: language preference — update failure message */
  readonly languageUpdateFailed: string;
  /** Sidebar aria-label for screen readers */
  readonly sidebarAriaLabel: string;
  /** App-bar aria-label for the mobile menu toggle */
  readonly menuToggleAriaLabel: string;
  /** App-bar: theme toggle tooltip */
  readonly toggleTheme: string;
  /** App-bar: avatar alt text for the user's initial */
  readonly userAvatarAlt: (userName: string) => string;
  /** Auth-redirect prompt shown when an anonymous user lands on /dashboard */
  readonly signInPromptTitle: string;
  /** Auth-redirect prompt body */
  readonly signInPromptBody: string;
  /**
   * Live-region announcement for the dashboard auth gate's session-restoring
   * state (the `output` live region — implicit `role="status"` — while the
   * refresh-token flow restores the session on a full-page load).
   * Deliberately separate from the sign-in prompt vocabulary above, which is
   * reserved for the resolved-anonymous state — announcing "sign in" while a
   * signed-in session is still restoring would be false.
   */
  readonly authRestoring: string;
  /** Next.js metadata title for `/dashboard` */
  readonly dashboardMetaTitle: string;
  /** Next.js metadata description for `/dashboard` */
  readonly dashboardMetaDescription: string;
  /** Next.js metadata title for `/profile` */
  readonly profileMetaTitle: string;
  /** Next.js metadata description for `/profile` */
  readonly profileMetaDescription: string;
  /** Next.js metadata title for the catch-all "coming soon" page */
  readonly comingSoonMetaTitle: string;
  /** Next.js metadata description for the catch-all "coming soon" page */
  readonly comingSoonMetaDescription: string;
  /** Getting Started section title shown below the stat grid on the dashboard landing */
  readonly gettingStartedTitle: string;
  /** Getting Started section description body */
  readonly gettingStartedBody: string;
  /** Getting Started tips — role-aware bullet copy picked by the authenticated user's role */
  readonly gettingStartedTips: {
    readonly student: DashboardGettingStartedTips;
    readonly teacher: DashboardGettingStartedTips;
    readonly admin: DashboardGettingStartedTips;
    readonly parent: DashboardGettingStartedTips;
  };
  /**
   * Applicant-cooldown lifecycle panel (admin dashboard) — the three
   * tappable lifecycle buckets deep-link into the user directory
   * pre-filtered. The `active`/`expired` labels mirror the directory chip
   * vocabulary (`adminUsers.directoryChips.cooldownActive`/`cooldownExpired`)
   * VERBATIM so the dashboard and the directory read as one system;
   * `expiringSoon` is count-aware (the canonical 7-day window length arrives
   * as the argument) and pluralizes through the shared day-count grammar.
   */
  readonly cooldownLifecycle: DashboardCooldownLifecycleLabels;
  /**
   * Country distribution panel (admin dashboard) — the tappable per-country
   * population rows (share bar + count) deep-linking into the directory's
   * guarded `?country=` contract. The `title` mirrors the directory facet's
   * `adminUsers.countryBreakdown.title` VERBATIM and `unresolved` mirrors
   * `adminUsers.countryBreakdown.unresolved` VERBATIM so the dashboard and
   * the directory read as one system (same discipline as the
   * cooldownLifecycle ↔ directoryChips mirrors).
   */
  readonly countryDistribution: DashboardCountryDistributionLabels;
}

/**
 * Getting Started bullet copy for a single dashboard role. The three keys map
 * to the card's fixed icon slots (sessions, subscriptions, notifications).
 */
interface DashboardGettingStartedTips {
  /** Bullet next to the sessions icon */
  readonly sessions: string;
  /** Bullet next to the subscriptions/plans icon */
  readonly subscriptions: string;
  /** Bullet next to the notifications icon */
  readonly notifications: string;
}

/**
 * Country distribution panel copy (admin dashboard).
 */
interface DashboardCountryDistributionLabels {
  /** Panel headline (mirrors adminUsers.countryBreakdown.title verbatim). */
  readonly title: string;
  /** One-line instruction under the headline. */
  readonly subtitle: string;
  /** Accessible per-row announcement: "<country label>: <count> users". */
  readonly rowAria: (label: string, count: number) => string;
  /** Trailing caption — the honest population the rows cannot represent (mirrors adminUsers.countryBreakdown.unresolved verbatim). */
  readonly unresolved: (count: number) => string;
  /** Trailing action — opens the (unfiltered) user directory. */
  readonly viewAll: string;
  /** Live-region announcement while the breakdown query resolves. */
  readonly loadingLabel: string;
}

/**
 * Applicant-cooldown lifecycle panel copy (admin dashboard).
 */
interface DashboardCooldownLifecycleLabels {
  /** Panel headline (the applicant-cooldown lifecycle). */
  readonly title: string;
  /** One-line instruction under the headline. */
  readonly subtitle: string;
  /** Bucket 1 — cooldowns still in force (mirrors the directory chip verbatim). */
  readonly active: string;
  /** Bucket 2 — the slice expiring within the canonical window; `days` is the window length. */
  readonly expiringSoon: (days: number) => string;
  /** Bucket 3 — cooldowns already past (mirrors the directory chip verbatim). */
  readonly expired: string;
  /** Trailing action — opens the (unfiltered) user directory. */
  readonly viewAll: string;
  /** Accessible per-bucket announcement: "<bucket label>: <count> applicants". */
  readonly bucketAria: (label: string, count: number) => string;
  /** Live-region announcement while the lifecycle query resolves. */
  readonly loadingLabel: string;
}
