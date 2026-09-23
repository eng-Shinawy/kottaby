/**
 * `adminStudents` namespace labels — the read-only admin student directory
 * (`/students`): page chrome, table headers, session-balance badges,
 * parent/languages cells, filter bar, pagination, and empty/error/loading
 * states.
 *
 * Used by:
 *  - `app/(dashboard)/students/page.tsx` (`generateMetadata`) for the page
 *    title.
 *  - Frontend `AdminStudentsDirectoryContainer` (`useAppTranslation(AdminStudents)`)
 *    for every visible string on the directory surface.
 *
 * Scope: chrome copy only — admin-authored DATA (student names, email
 * addresses, language names, dates) is rendered verbatim and is NEVER
 * translated. No ICU placeholders are used because no localized string
 * interpolates admin-authored or system-supplied values; interpolated rows
 * are produced by composing label + verbatim data inside the component.
 *
 * All keys MUST have both `en` and `ar` implementations with EXACT key-set
 * parity (compile-typed on both leaves — the primary parity gate is the
 * `Translations` interface where both leaf consts are typed
 * `AdminStudentsLabels`; the runtime parity suite walks grouped sub-block
 * leaves depth-first so the zero-dead-key discipline stays enforced for
 * nested blocks). Property access only — never call-by-key.
 */
export interface AdminStudentsLabels {
  /** Directory page heading shown in the page header band. */
  readonly title: string;
  /** Directory page subtitle line under the heading. */
  readonly subtitle: string;

  // NOTE: the `export`/`fields`/`drawer` blocks below extend the directory
  // with the CSV export affordance and the per-row detail drawer.

  /** Table column headers shown in the student directory table. */
  readonly headers: {
    /** Identity column (avatar + name + email). */
    readonly name: string;
    /** Session-balance column (four compact badges). */
    readonly balances: string;
    /** Parent column (parent identity or the independent marker). */
    readonly parent: string;
    /** Languages column (primary + another chips). */
    readonly languages: string;
    /** Free-trial column (granted badge + timestamp, or the em-dash). */
    readonly trial: string;
    /** Member-since column (localized timestamp). */
    readonly joined: string;
  };

  /**
   * Session-balance badge labels — composed with the verbatim count inside
   * the component (`${label} ${count}`). The four badges render in the
   * backend's canonical lane order (hifz, reviews, tajweed, trial).
   */
  readonly balances: {
    /** Hifz session-lane balance. */
    readonly hifz: string;
    /** Reviews session-lane balance. */
    readonly reviews: string;
    /** Tajweed session-lane balance. */
    readonly tajweed: string;
    /** Trial session-lane balance. */
    readonly trial: string;
  };

  /** Parent-link labels — the select options and the independent marker. */
  readonly parentLabels: {
    /** Student linked to a parent (filter option). */
    readonly withParent: string;
    /** Student with no parent link — marker chip in the parent column. */
    readonly noParent: string;
  };

  /** Filter bar control labels and the search input placeholder. */
  readonly filters: {
    /** Accessible label for the search input. */
    readonly search: string;
    /** Placeholder shown inside an empty search input. */
    readonly searchPlaceholder: string;
    /** Accessible label for the clear-search button inside the search input. */
    readonly searchClearLabel: string;
    /** Label for the parent-link filter select. */
    readonly hasParent: string;
    /** Label for the language filter input (exact-match, applied on Enter). */
    readonly language: string;
    /** Apply button for the language filter input. */
    readonly apply: string;
    /** "Clear filters" button — restores the directory to its unfiltered state. */
    readonly clear: string;
    /** Refresh button — re-fetches the current page. */
    readonly refresh: string;
    /** Toolbar toggle — dims rows/cards NOT in the device's recent onboardings. */
    readonly highlightRecent: string;
    /** Tooltip for the highlight toggle (honest device-scoped wording). */
    readonly highlightRecentHint: string;
  };

  /** Shared/derived filter option labels not covered by the parent labels. */
  readonly filterOptions: {
    /** Empty-option label ("no filter") shared by every filter select. */
    readonly all: string;
  };

  /** Trial chip label shown above the granted timestamp in the trial column. */
  readonly trialBadge: string;
  /** The "recently onboarded" flag chip on directory rows (localStorage match). */
  readonly recentlyOnboarded: {
    /** The compact chip label beside the row name. */
    readonly chip: string;
    /** Tooltip pointing at the onboarding dialog's handoff-code history. */
    readonly tooltip: string;
  };
  /** The onboarding-history dialog (device-scoped cohort memory). */
  readonly history: {
    /** Toolbar button tooltip / accessible name. */
    readonly open: string;
    /** Dialog title. */
    readonly title: string;
    /** Empty state (no onboardings recorded yet). */
    readonly empty: string;
    /** Per-row copy affordance tooltip. */
    readonly copyCode: string;
    /** Post-copy tooltip state. */
    readonly copied: string;
    /** Footer caption — the honest privacy contract. */
    readonly deviceNote: string;
  };

  /** Accessible label for the floating scroll-back-to-top affordance. */
  readonly scrollBackToTop: string;

  /** Empty-state copy rendered inside the table body when no rows match. */
  readonly emptyState: {
    /** Empty-state heading line — shown when no students exist at all. */
    readonly title: string;
    /** Empty-state body line explaining why no rows are visible (zero students). */
    readonly message: string;
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

  /**
   * Accessible label announced for the loading skeleton region (table body
   * rowgroup while the first page is in flight; mobile skeleton stack).
   */
  readonly loading: string;

  /**
   * Clipboard + navigation affordances shared by the directory rows and the
   * detail drawer (copy-email quick action + feedback; the full-profile
   * link routes to the admin user-detail page where governance actions
   * live).
   */
  readonly quickActions: {
    /** Tooltip for the copy-email icon button. */
    readonly copyEmail: string;
    /** Snackbar shown after the email is copied to the clipboard. */
    readonly emailCopied: string;
    /** Full-profile link — routes to the admin user-detail page. */
    readonly viewProfile: string;
    /** Toolbar action — copies the CURRENT shareable view URL (filters,
     * search, tab and page mirrored in the query string). */
    readonly copyLink: string;
    /** Snackbar shown after the view URL is copied to the clipboard. */
    readonly linkCopied: string;
  };

  /**
   * Export affordance — runs the server-side EXPORT-ALL query with the
   * current filter state (the backend caps the dump at its own EXPORT_MAX_ROWS
   * and reports `truncated`) and serializes the returned rows to a UTF-8
   * CSV download.
   */
  readonly export: {
    /** Button label + accessible name for the export action. */
    readonly exportCsv: string;
    /** Tooltip shown on the DISABLED export (nothing to export yet). */
    readonly exportCsvEmpty: string;
    /**
     * Success snackbar — the exported row count. ICU template with exactly
     * one `{count}` placeholder, expanded by the consumer (placeholder-name
     * parity is pinned by the namespace parity suite).
     */
    readonly exportedRows: string;
    /**
     * Warning snackbar shown when the backend reported `truncated` — the
     * dump was capped at its first EXPORT_MAX_ROWS (1000) rows; the file
     * still downloads.
     */
    readonly exportTruncated: string;
    /** Error snackbar shown when the export query fails (no download). */
    readonly exportCsvFailed: string;
    /**
     * CSV caption for the trial-session-BALANCE column (export column 9).
     * Minted EXPORT-SCOPED because the shared `balances.trial` and
     * `headers.trial` handles both resolve to "Trial" (EN) — reusing either
     * emitted the caption twice in the exported header record (and the AR
     * "التجربة" reads muddy for a count column).
     */
    readonly columnTrialBalance: string;
    /**
     * CSV caption for the trial-GRANTED-AT timestamp column (export column
     * 10) — export-scoped for the same header de-duplication reason as
     * `columnTrialBalance`; the on-screen table keeps reusing the shared
     * `headers.trial` handle (single vocabulary where no collision exists).
     */
    readonly columnTrialGrantedAt: string;
  };

  /**
   * Field captions for concepts the directory chrome never needed before
   * the CSV export / detail drawer (contact + placement identity). Concepts
   * that already have a header key (name, balances, trial, parent, joined)
   * REUSE those keys — no near-duplicates.
   */
  readonly fields: {
    /** Record identifier caption (CSV column + drawer record section). */
    readonly id: string;
    /** Email address caption. */
    readonly email: string;
    /** Phone number caption. */
    readonly phone: string;
    /** Country caption. */
    readonly country: string;
    /** Primary-language caption (drawer row + CSV column). */
    readonly primaryLanguage: string;
    /** Second-language caption (drawer row + CSV column). */
    readonly anotherLanguage: string;
    /** Parent email caption (drawer mailto row + CSV column). */
    readonly parentEmail: string;
  };

  /**
   * Detail-drawer chrome — opened by clicking a row/card or through the
   * per-row view-details quick action. The drawer renders only fields the
   * directory item already carries (presentational; no extra queries).
   */
  readonly drawer: {
    /** Drawer window title. */
    readonly detailsTitle: string;
    /** Accessible name of the drawer close button. */
    readonly close: string;
    /** Accessible name of the per-row view-details quick action. */
    readonly viewDetails: string;
    /** Identity section header (avatar + contact rows). */
    readonly sectionIdentity: string;
    /** Session-balances section header (stat tiles). */
    readonly sectionBalances: string;
    /** Parent-placement section header (parent identity / independent). */
    readonly sectionPlacement: string;
    /** Languages section header. */
    readonly sectionLanguages: string;
    /** Free-trial section header. */
    readonly sectionTrial: string;
    /** Record section header (identifier). */
    readonly sectionRecord: string;
  };

  /**
   * Pagination control labels — the block mirrors the shared
   * `DirectoryPagination` contract consumed from the admin-users directory
   * (the same keys, structurally typed).
   */
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
}
