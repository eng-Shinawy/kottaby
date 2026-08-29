import type { AuditLabels } from "@/shared/locale/types/audit";

/**
 * English labels for the admin audit-trail viewer (`audit` namespace,
 * DEV3-020 Phase 1).
 */
export const auditEn: AuditLabels = {
  // Page header
  pageTitle: "Audit Trail",
  pageSubtitle: "Every administrative action, permanently recorded.",

  // Async states
  loading: "Loading the audit trail…",
  emptyStateTitle: "No audit entries",
  emptyStateBody: "No administrative actions match the current filters.",
  errorStateTitle: "Could not load the audit trail",
  errorStateBody: "Something went wrong while reading the trail. Please try again.",
  errorStateRetry: "Retry",

  // Filter bar
  labelActionType: "Action",
  filterActionAll: "All actions",
  labelEntityType: "Entity",
  filterEntityAll: "All entities",
  labelActorId: "Actor ID",
  labelEntityId: "Entity ID",
  labelDateFrom: "From",
  labelDateTo: "To",
  applyFilters: "Apply filters",
  clearFilters: "Clear filters",
  invalidDateRange: "The From date must not be after the To date.",

  // Table
  colTimestamp: "Timestamp (UTC)",
  colActor: "Actor",
  colAction: "Action",
  colEntity: "Entity",
  colEntityId: "Entity ID",
  colDetails: "Details",
  detailsEmpty: "—",
  detailsExpandAriaLabel: "View action details",
  detailsPopoverTitle: "Action details",

  // Action verbs
  actionCreate: "Create",
  actionUpdate: "Update",
  actionDelete: "Delete",
  actionOverride: "Override",
  actionAdjust: "Adjust",
  actionSuspend: "Suspend",
  actionReactivate: "Reactivate",

  // Entity families
  entityPlans: "Plan",
  entitySubscriptions: "Subscription",
  entityOther: "Other",

  // Pagination
  paginationPrev: "Previous",
  paginationNext: "Next",
  pageInfo: (from, to, total) => `${from}–${to} of ${total}`,
  tableSummary: "Immutable audit trail of administrative actions",
  rowsPerPage: "Rows per page",
};
