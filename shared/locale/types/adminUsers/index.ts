/**
 * `adminUsers` namespace labels — admin user-management directory, detail
 * surface, and create/edit/delete/reactivate dialog chrome copy.
 *
 * Used by:
 *  - Frontend `AdminUsersDirectoryContainer` (`useAppTranslation(AdminUsers)`)
 *    for the directory page heading, table headers, status/role chips, filter
 *    bar labels, empty/error states, and the create/edit/delete/reactivate
 *    dialog copy.
 *  - Frontend `AdminUserDetailContainer` (`useAppTranslation(AdminUsers)`) for
 *    the detail page heading, role-child section headings, and the
 *    not-found section rendered when the targeted id has no row.
 *
 * Scope: chrome copy only — admin-authored DATA (full names, email addresses,
 * phone numbers, country names, dates) is rendered verbatim and is NEVER
 * translated. No ICU placeholders are used because no localized string
 * interpolates admin-authored or system-supplied values; interpolated rows
 * are produced by composing label + verbatim data inside the component.
 *
 * All keys MUST have both `en` and `ar` implementations with EXACT key-set
 * parity (compile-typed on both leaves — the primary parity gate is the
 * `Translations` interface where both leaf consts are typed
 * `AdminUsersLabels`; the runtime parity suites walk grouped sub-block leaves
 * depth-first so the zero-dead-key discipline stays enforced for nested
 * blocks). Property access only — never call-by-key.
 */
export interface AdminUsersLabels {
  /** Directory page heading shown in the page header band. */
  readonly title: string;
  /** Detail page heading shown in the page header band. */
  readonly detailTitle: string;

  /** Table column headers shown in the admin user directory table. */
  readonly headers: {
    /** Header cell for the user's full name column. */
    readonly name: string;
    /** Header cell for the user's email column. */
    readonly email: string;
    /** Header cell for the user's phone-number column. */
    readonly phone: string;
    /** Header cell for the user's role column. */
    readonly role: string;
    /** Header cell for the user's country column. */
    readonly country: string;
    /** Header cell for the governance status column. */
    readonly status: string;
    /** Header cell for the combined status/details column (governance badge + role-child chips). */
    readonly statusDetails: string;
    /** Header cell for the governance windows column. */
    readonly governance: string;
    /** Header cell for the last-active timestamp column. */
    readonly lastActive: string;
    /** Header cell for the account-creation timestamp column. */
    readonly createdAt: string;
    /** Header cell for the row actions column (edit / delete / reactivate). */
    readonly actions: string;
  };

  /** Governance status badge labels rendered next to each directory row. */
  readonly statusBadges: {
    /** Badge for an active (non-deleted, non-suspended, non-blocked) account. */
    readonly active: string;
    /** Badge for a suspended account. */
    readonly suspended: string;
    /** Badge for a blocked account. */
    readonly blocked: string;
    /** Badge for a soft-deleted account. */
    readonly deleted: string;
  };

  /**
   * Overview stat-card labels for the clickable stats strip above the
   * directory table. Each governance card toggles the matching governance
   * filter; the total card clears it.
   */
  readonly stats: {
    /** Stat-card label for the total-user counter (click clears the governance filter). */
    readonly total: string;
    /** Stat-card label for the active-user counter. */
    readonly active: string;
    /** Stat-card label for the suspended-user counter. */
    readonly suspended: string;
    /** Stat-card label for the blocked-user counter. */
    readonly blocked: string;
    /** Stat-card label for the soft-deleted-user counter. */
    readonly deleted: string;
    /** Caption for the trailing-7-day signups badge (composed with the count in the component). */
    readonly newThisWeek: string;
    /** Caption prefix for the role-distribution line under the stat cards. */
    readonly roleDistribution: string;
  };

  /**
   * Clipboard + navigation affordances shared by the directory rows and the
   * detail-page header (view-profile links, copy-email button, feedback).
   */
  readonly quickActions: {
    /** Accessible label for the directory name link pointing at the detail page. */
    readonly viewProfile: string;
    /** Tooltip for the copy-email icon button. */
    readonly copyEmail: string;
    /** Snackbar shown after the email is copied to the clipboard. */
    readonly emailCopied: string;
  };

  /**
   * Chip labels rendered inside the combined Status/Details column of the
   * directory table — role-child verification, certification, and
   * parent-link chips plus the unrelated fallback for pure admin rows.
   */
  readonly directoryChips: {
    /** Italic fallback line for admin rows with no role-child details. */
    readonly systemUser: string;
    /** Chip shown when the underlying account is verified. */
    readonly verified: string;
    /** Chip shown when the teacher account is certified. */
    readonly certified: string;
    /** Chip shown when the student account is linked to a parent. */
    readonly parentLinked: string;
    /** Caption unit composed after a linked-children count (`${count} ${childrenLabel}` in the component). */
    readonly childrenLabel: string;
    /** Chip shown when a teacher application is awaiting review. */
    readonly pendingReview: string;
  };

  /** Role labels rendered as chips inside the role column. */
  readonly roleLabels: {
    /** Role chip for a super-admin account. */
    readonly admin: string;
    /** Role chip for a teacher account. */
    readonly teacher: string;
    /** Role chip for a student account. */
    readonly student: string;
    /** Role chip for a parent account. */
    readonly parent: string;
  };

  /** Filter bar control labels and the search input placeholder. */
  readonly filters: {
    /** Label for the role filter select. */
    readonly role: string;
    /** Label for the governance filter select. */
    readonly governance: string;
    /** Label for the country filter select. */
    readonly country: string;
    /** Accessible label for the search input. */
    readonly search: string;
    /** Placeholder shown inside an empty search input. */
    readonly searchPlaceholder: string;
    /** "Clear filters" button — restores the directory to its unfiltered state. */
    readonly clear: string;
    /** First quick-filter chip on mobile — clears the role filter to show every role. */
    readonly chipsAll: string;
  };

  /** Empty-state copy rendered inside the table body when no rows match. */
  readonly emptyState: {
    /** Empty-state heading line — shown when no users exist at all. */
    readonly title: string;
    /** Empty-state body line explaining why no rows are visible (zero users). */
    readonly message: string;
    /** Call-to-action button label for the empty state. */
    readonly cta: string;
    /** Empty-state heading line — shown when filters returned zero matches. */
    readonly filteredTitle: string;
    /** Empty-state body explaining filters narrowed the result set to zero. */
    readonly filteredMessage: string;
  };

  /** Error-state copy rendered when the directory query fails. */
  readonly errorState: {
    /** Error-state heading line. */
    readonly title: string;
    /** Error-state body line explaining the failure. */
    readonly message: string;
    /** Retry button label for the error state. */
    readonly retry: string;
  };

  /** Gender option labels shared by the create/edit dialog gender select. */
  readonly genderOptions: {
    /** Select-option label for the empty (unspecified) gender entry. */
    readonly unspecified: string;
    /** Select-option label for the `Male` gender enum value. */
    readonly male: string;
    /** Select-option label for the `Female` gender enum value. */
    readonly female: string;
    /** Select-option label for the `Other` gender enum value. */
    readonly other: string;
  };

  /** Create-user dialog field labels, button labels, and dialog title. */
  readonly createDialog: {
    /** Dialog title for the create-user dialog. */
    readonly title: string;
    /** Subtitle line under the title — sets expectations about what creation does NOT attach. */
    readonly subtitle: string;
    /** Field label for the full name input. */
    readonly fullName: string;
    /** Placeholder shown inside an empty full-name input. */
    readonly fullNamePlaceholder: string;
    /** Field label for the email input. */
    readonly email: string;
    /** Field label for the phone input. */
    readonly phone: string;
    /** Field label for the initial password input. */
    readonly password: string;
    /** Helper text under the initial-password input. */
    readonly passwordHelper: string;
    /** Field label for the gender select. */
    readonly gender: string;
    /** Field label for the country select. */
    readonly country: string;
    /** Field label for the role select. */
    readonly role: string;
    /** Role segment-labels for the role selector; student/parent reuse `roleLabels` instead. */
    readonly roleSegments: {
      /** Segment label for creating a teacher-applicant account. */
      readonly teacherApplicant: string;
    };
    /** Info callout at the bottom of the create dialog — applicant status and admin restriction. */
    readonly callout: string;
    /** Submit button label for the create dialog. */
    readonly submit: string;
    /** Cancel button label for the create dialog. */
    readonly cancel: string;
  };

  /** Edit-user dialog field labels, button labels, and dialog title. */
  readonly editDialog: {
    /** Dialog title for the edit-user dialog. */
    readonly title: string;
    /** Subtitle line under the title — states the dialog only edits profile details. */
    readonly subtitle: string;
    /** Field label for the full name input. */
    readonly fullName: string;
    /** Field label for the phone input. */
    readonly phone: string;
    /** Field label for the country select. */
    readonly country: string;
    /** Field label for the gender select. */
    readonly gender: string;
    /** Field label for the date-of-birth input. */
    readonly dateOfBirth: string;
    /** Submit button label for the edit dialog. */
    readonly submit: string;
    /** Cancel button label for the edit dialog. */
    readonly cancel: string;
  };

  /** Soft-delete confirm dialog copy (deactivate semantics — the account is soft-deleted). */
  readonly deleteConfirm: {
    /** Dialog title for the soft-delete confirm dialog. */
    readonly title: string;
    /** Body copy explaining the action being confirmed. */
    readonly message: string;
    /** Secondary consequences line listing what survives the soft-delete. */
    readonly consequences: string;
    /** Info-callout line under the body; the role chip is rendered separately by the component. */
    readonly roleNote: string;
    /** Confirm button label for the soft-delete dialog. */
    readonly confirm: string;
    /** Cancel button label for the soft-delete dialog. */
    readonly cancel: string;
  };

  /** Reactivate confirm dialog copy. */
  readonly reactivateConfirm: {
    /** Dialog title for the reactivate confirm dialog. */
    readonly title: string;
    /** Body copy explaining the action being confirmed. */
    readonly message: string;
    /** Confirm button label for the reactivate dialog. */
    readonly confirm: string;
    /** Cancel button label for the reactivate dialog. */
    readonly cancel: string;
  };

  /** Detail page section headings and navigation affordances. */
  readonly detail: {
    /** Section heading for the profile card (full name, email, phone, etc.). */
    readonly profile: string;
    /** Section heading for the governance card (status, suspension/block dates). */
    readonly governance: string;
    /** Section heading for the applicant role-child snapshot card. */
    readonly applicant: string;
    /** Section heading for the teacher role-child snapshot card. */
    readonly teacher: string;
    /** Section heading for the student role-child snapshot card. */
    readonly student: string;
    /** Section heading for the parent role-child snapshot card. */
    readonly parent: string;
    /** Back-to-directory button label on the detail page. */
    readonly backToDirectory: string;
    /** Not-found section title rendered when the targeted id has no row. */
    readonly notFoundTitle: string;
    /** Not-found section body explaining the row is gone or never existed. */
    readonly notFoundMessage: string;
    /** Inline edit action button on the detail page header. */
    readonly editAction: string;
    /** Inline soft-delete action button on the detail page header. */
    readonly deleteAction: string;
    /** Inline reactivate action button on the detail page header. */
    readonly reactivateAction: string;
    /** Field label for the soft-deletion timestamp on the governance card. */
    readonly deletedAt: string;
    /** Field label for the suspension timestamp on the governance card. */
    readonly suspendedAt: string;
    /** Field label for the block timestamp on the governance card. */
    readonly blockedAt: string;
    /** Field label for the account-creation timestamp on the profile card. */
    readonly memberSince: string;
    /** Field label for the last-active timestamp on the profile card. */
    readonly lastActiveLabel: string;
    /** Info strip at the bottom of the profile card — email/role are system-managed. */
    readonly profileReadonlyNote: string;
    /** Info strip at the bottom of the governance card — windows live in the Governance module. */
    readonly governanceNote: string;
    /**
     * Teacher-application progress card on the detail page — application
     * stats, review stepper, and the read-only certification note.
     */
    readonly teacherApplication: {
      /** Subtitle under the card title. */
      readonly subtitle: string;
      /** "of" word joining the completed/total stats counters (`0 of 3`). */
      readonly statsOf: string;
      /** Label for the submitted-at stat in the stats panel. */
      readonly submitted: string;
      /** Stepper step 1 label — application submitted. */
      readonly stepSubmitted: string;
      /** Stepper step 2 label — application under review. */
      readonly stepUnderReview: string;
      /** Stepper step 3 label — teacher certified. */
      readonly stepCertified: string;
      /** Read-only note under the stepper — certification is managed elsewhere. */
      readonly note: string;
    };
    /** Student trial-status block inside the student role-child card. */
    readonly studentStatus: {
      /** Row label for the trial status. */
      readonly trialStatus: string;
      /** Amber chip shown while the student is in the trial window. */
      readonly trialChip: string;
      /** Caption unit composed after the trial balance (`${count} ${creditsLabel}` in the component). */
      readonly creditsLabel: string;
    };
    /** Field labels for the applicant role-child snapshot card. */
    readonly applicantFields: {
      readonly status: string;
      readonly verificationAttempts: string;
      readonly lastAttempt: string;
      readonly cooldownUntil: string;
      readonly cooldownActive: string;
      readonly canPurchaseVerification: string;
    };
    /** Localized display values for the `ApplicantStatus` enum. */
    readonly applicantStatus: {
      readonly pending: string;
      readonly inEvaluation: string;
      readonly passed: string;
      readonly failed: string;
    };
    /** Field labels for the teacher role-child snapshot card. */
    readonly teacherFields: {
      readonly approved: string;
      readonly evaluator: string;
      readonly online: string;
      readonly averageRating: string;
    };
    /** Field labels for the student role-child snapshot card. */
    readonly studentFields: {
      readonly handshakeCode: string;
      readonly hasParentLink: string;
      readonly parentId: string;
      readonly hasActiveSubscription: string;
      readonly balanceHifz: string;
      readonly balanceTajweed: string;
      readonly balanceReviews: string;
      readonly trialGrantedAt: string;
    };
    /** Field labels for the parent role-child snapshot card. */
    readonly parentFields: {
      readonly linkedChildrenCount: string;
    };
    /** Localized Yes/No labels for boolean field display. */
    readonly booleanValues: {
      readonly yes: string;
      readonly no: string;
    };
  };

  /**
   * Self-deactivation alert rendered inside the soft-delete confirm dialog
   * when the admin targets their own account. The operation is rejected
   * before any write; this alert explains why the confirm button is disabled.
   */
  readonly selfDeactivationAlert: {
    /** Alert title for the self-deactivation guard. */
    readonly title: string;
    /** Alert body explaining the rule. */
    readonly message: string;
  };

  /** Mutation-success snackbar copy rendered after a successful write. */
  readonly snackbars: {
    /** Snackbar copy rendered after a successful create. */
    readonly created: string;
    /** Snackbar copy rendered after a successful update. */
    readonly updated: string;
    /** Snackbar copy rendered after a successful soft-delete. */
    readonly deleted: string;
    /** Snackbar copy rendered after a successful reactivation. */
    readonly reactivated: string;
  };

  /**
   * Per-user "recent activity" timeline card on the admin detail page —
   * scoped `audit_logs` read-back (actions recorded ABOUT this user,
   * newest-first, acting admin + timestamp + changed-field names).
   */
  readonly activity: {
    /** Card title for the recent-activity timeline. */
    readonly title: string;
    /** Empty-state copy when the user has no recorded audit entries. */
    readonly empty: string;
    /** Accessibility label for the per-entry action chip. */
    readonly entryActionLabel: string;
    /** Trailing text link in the card header — navigates to the full audit view. */
    readonly viewAll: string;
    /** Full-width outlined footer button — navigates to the complete audit log. */
    readonly viewFullAuditLog: string;
    /** Caption prefix before the changed-field names list. */
    readonly changedFields: string;
    /** sr-only suffix identifying the acting admin on each entry. */
    readonly byActor: string;
    /** Action chip label — account created. */
    readonly actionCreate: string;
    /** Action chip label — profile updated. */
    readonly actionUpdate: string;
    /** Action chip label — account soft-deleted. */
    readonly actionDelete: string;
    /** Action chip label — account reactivated. */
    readonly actionReactivate: string;
    /** Action chip label — governance override (reserved for DEV3-017/020). */
    readonly actionOverride: string;
    /** Action chip label — balance adjustment (reserved for future lanes). */
    readonly actionAdjust: string;
    /** Action chip label — suspension (reserved for DEV3-017). */
    readonly actionSuspend: string;
  };

  /** Pagination control labels and counters. */
  readonly pagination: {
    /** "Page" word in the page-of-total counter. */
    readonly page: string;
    /**
     * Leading word of the range caption, composed as
     * `${showingPrefix} ${from}–${to} ${of} ${total}` in the component.
     */
    readonly showingPrefix: string;
    /** "of" word in the page-of-total counter. */
    readonly of: string;
    /** "Total" word on the total-count row. */
    readonly total: string;
    /** Next-page button label. */
    readonly next: string;
    /** Previous-page button label. */
    readonly previous: string;
    /** Page-size selector label. */
    readonly pageSize: string;
  };

  /**
   * Audit-trail read surface — the full admin audit-log view over the
   * immutable `audit_logs` record (page chrome, filter bar, table headers,
   * details expansion, empty/error states).
   *
   * Action chip values are rendered through the REUSED `activity.action*`
   * vocabulary above — this block intentionally carries NO per-action labels
   * (single action vocabulary across the admin users domain).
   */
  readonly auditTrail: {
    /** Page heading shown in the page header band. */
    readonly pageTitle: string;
    /** Subtitle line under the page heading. */
    readonly pageSubtitle: string;

    /** Filter bar control labels for the audit-trail query. */
    readonly filters: {
      /** Label for the acting-admin id filter input. */
      readonly actorIdLabel: string;
      /** Label for the entity-type filter select. */
      readonly entityTypeLabel: string;
      /** Label for the entity-id filter input. */
      readonly entityIdLabel: string;
      /** Label for the action-type filter select. */
      readonly actionTypeLabel: string;
      /** Label for the inclusive range-start date input. */
      readonly fromDateLabel: string;
      /** Label for the inclusive range-end date input. */
      readonly toDateLabel: string;
      /** Apply-filters button label. */
      readonly applyAction: string;
      /** Clear-filters button label — restores the unfiltered trail. */
      readonly clearAction: string;
    };

    /** Table column headers and details-expansion affordances. */
    readonly table: {
      /** Header cell for the recorded-at timestamp column. */
      readonly whenHeader: string;
      /** Header cell for the acting-admin column. */
      readonly actorHeader: string;
      /** Header cell for the action column (chip rendered from `activity.action*`). */
      readonly actionHeader: string;
      /** Header cell for the entity-type column. */
      readonly entityTypeHeader: string;
      /** Header cell for the entity-id column. */
      readonly entityIdHeader: string;
      /** Header cell for the raw-details column. */
      readonly detailsHeader: string;
      /** Expand control label for the raw-JSON details cell. */
      readonly detailsShowLabel: string;
      /** Collapse control label for the expanded details cell. */
      readonly detailsHideLabel: string;
      /** Null placeholder shown when an entry carries no details payload. */
      readonly noDetailsValue: string;
      /** Null placeholder shown when an entry has no entity id. */
      readonly noEntityIdValue: string;
      /** Select-option label for the unfiltered (every-action) action-type entry. */
      readonly allActionsOption: string;
    };

    /** Empty-state copy rendered when no audit entries match the filters. */
    readonly emptyState: {
      /** Empty-state heading line. */
      readonly title: string;
      /** Empty-state body line explaining why no rows are visible. */
      readonly message: string;
    };

    /** Error-state copy rendered when the audit-trail query fails. */
    readonly errorState: {
      /** Error-state heading line. */
      readonly title: string;
      /** Error-state body line explaining the failure. */
      readonly message: string;
    };
  };
}
