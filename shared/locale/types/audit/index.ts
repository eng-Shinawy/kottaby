/**
 * `audit` namespace labels — the ADMIN audit-trail viewer (DEV3-020 Phase 1).
 *
 * Used by:
 *  - `/audit` page header (title + subtitle).
 *  - The filter bar (action type, entity type, actor id, entity id, date
 *    range, apply/clear).
 *  - The trail table (timestamp, actor, action, entity, entity id, details).
 *  - Pagination (prev/next, "{from}-{to} of {total}" range formatter).
 *  - Loading / empty / error states (with retry).
 *
 * All keys MUST have both `en` and `ar` implementations; the parity suite
 * (`shared/locale/audit-namespace.parity.test.ts`) pins the key sets and
 * the range-formatter shape identical across locales.
 *
 * NOTE: the ACTION verbs (`actionCreate` … `actionReactivate`) localize the
 * `audit_action_type` enum values for display; the wire contract stays
 * machine-coded. This namespace deliberately does NOT reuse the
 * `paymentVerification` or `plans` namespaces — the trail is a forensic,
 * read-only surface with its own vocabulary.
 */
export interface AuditLabels {
  // ── Page header ──────────────────────────────────────────────────────────
  /** Audit-trail page title. */
  readonly pageTitle: string;
  /** Audit-trail page subtitle under the title. */
  readonly pageSubtitle: string;

  // ── Async states ─────────────────────────────────────────────────────────
  /** Loading-state copy. */
  readonly loading: string;
  /** Empty-state title (no entries match the current filters). */
  readonly emptyStateTitle: string;
  /** Empty-state body. */
  readonly emptyStateBody: string;
  /** Load-failure state title. */
  readonly errorStateTitle: string;
  /** Load-failure state body. */
  readonly errorStateBody: string;
  /** Load-failure retry CTA. */
  readonly errorStateRetry: string;

  // ── Filter bar ───────────────────────────────────────────────────────────
  /** Action-type filter label. */
  readonly labelActionType: string;
  /** The "all action types" filter option. */
  readonly filterActionAll: string;
  /** Entity-type filter label. */
  readonly labelEntityType: string;
  /** The "all entity types" filter option. */
  readonly filterEntityAll: string;
  /** Actor-id filter label. */
  readonly labelActorId: string;
  /** Entity-id filter label. */
  readonly labelEntityId: string;
  /** Date-range lower-bound label. */
  readonly labelDateFrom: string;
  /** Date-range upper-bound label. */
  readonly labelDateTo: string;
  /** Apply-filters CTA. */
  readonly applyFilters: string;
  /** Clear-filters CTA. */
  readonly clearFilters: string;
  /** Inline error when the date range is inverted (from after to). */
  readonly invalidDateRange: string;

  // ── Table ────────────────────────────────────────────────────────────────
  /** Timestamp column header. */
  readonly colTimestamp: string;
  /** Actor column header. */
  readonly colActor: string;
  /** Action column header. */
  readonly colAction: string;
  /** Entity column header. */
  readonly colEntity: string;
  /** Entity-id column header. */
  readonly colEntityId: string;
  /** Details column header. */
  readonly colDetails: string;
  /** Placeholder for rows whose details column is NULL. */
  readonly detailsEmpty: string;
  /** Accessible name for the icon-only details-expand trigger. */
  readonly detailsExpandAriaLabel: string;
  /** Title of the details popover panel. */
  readonly detailsPopoverTitle: string;

  // ── Action verbs (audit_action_type enum display names) ─────────────────
  /** The `create` action. */
  readonly actionCreate: string;
  /** The `update` action. */
  readonly actionUpdate: string;
  /** The `delete` action. */
  readonly actionDelete: string;
  /** The `override` action. */
  readonly actionOverride: string;
  /** The `adjust` action. */
  readonly actionAdjust: string;
  /** The `suspend` action. */
  readonly actionSuspend: string;
  /** The `reactivate` action. */
  readonly actionReactivate: string;

  // ── Entity families ──────────────────────────────────────────────────────
  /** The `plans` entity family. */
  readonly entityPlans: string;
  /** The `subscriptions` entity family. */
  readonly entitySubscriptions: string;
  /** Fallback for any future entity family (shown as the raw machine code). */
  readonly entityOther: string;

  // ── Pagination ───────────────────────────────────────────────────────────
  /** Previous-page CTA. */
  readonly paginationPrev: string;
  /** Next-page CTA. */
  readonly paginationNext: string;
  /** The "{from}-{to} of {total}" range formatter. */
  readonly pageInfo: (from: number, to: number, total: number) => string;
  /** Screen-reader context for the trail table (sr-only summary). */
  readonly tableSummary: string;
  /** Rows-per-page toolbar label. */
  readonly rowsPerPage: string;
}
