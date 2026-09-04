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
  /** Sidebar nav: Plans link (admin) */
  readonly plans: string;
  /** Sidebar nav: Audit link (admin) */
  readonly audit: string;
  /** Sidebar nav: Broadcasts link (admin — the broadcast compose surface) */
  readonly broadcasts: string;
  /** Sidebar nav: Disputes link (admin — session arbitration queue) */
  readonly disputes: string;
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
}

/**
 * Getting Started bullet copy for a single dashboard role. The three keys map
 * to the card's fixed icon slots (sessions, subscriptions, notifications).
 */
export interface DashboardGettingStartedTips {
  /** Bullet next to the sessions icon */
  readonly sessions: string;
  /** Bullet next to the subscriptions/plans icon */
  readonly subscriptions: string;
  /** Bullet next to the notifications icon */
  readonly notifications: string;
}
