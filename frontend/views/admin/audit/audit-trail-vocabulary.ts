/**
 * Audit-trail vocabulary — the audit domain's display vocabularies that the
 * filter bar and BOTH renderers (desktop row, mobile card) share:
 *
 *  - the action vocabulary: the generated `AuditActionType` values paired
 *    with the REUSED `adminUsers.activity.action*` labels (single action
 *    vocabulary across the admin-users domain — the `auditTrail` block mints
 *    no per-action labels of its own);
 *  - the entity-type vocabulary: the canonical wire values the backend
 *    mints, mapped to their `auditTrail.entityTypeLabels` keys, in display
 *    order for the filter bar's quick-pick chips.
 *
 * Split from `audit-trail-filters.ts` (the repo's 150-line view-file
 * convention); the filters module re-exports these members so the existing
 * import surface keeps working.
 */

// The generated module carries the RUNTIME `AuditActionType` enum (the
// `ACTION_VALUES` vocabulary and `actionLabelsOf` keys read its members) in
// one import — the enum is a value here, not a type-only reference.
import { AuditActionType } from "@/frontend/graphql/generated/gql/graphql";
import type { AdminUsersLabels } from "@/shared/locale/types/adminUsers";

/** Generated enum values rendered by the action-type Select and the Action column. */
export const ACTION_VALUES: readonly AuditActionType[] = [
  AuditActionType.Create,
  AuditActionType.Update,
  AuditActionType.Delete,
  AuditActionType.Reactivate,
  AuditActionType.Override,
  AuditActionType.Adjust,
  AuditActionType.Suspend,
];

/** Localized action labels keyed by the generated enum (Record lookup — no enum switch). */
export function actionLabelsOf(activity: AdminUsersLabels["activity"]): Record<AuditActionType, string> {
  return {
    [AuditActionType.Create]: activity.actionCreate,
    [AuditActionType.Update]: activity.actionUpdate,
    [AuditActionType.Delete]: activity.actionDelete,
    [AuditActionType.Reactivate]: activity.actionReactivate,
    [AuditActionType.Override]: activity.actionOverride,
    [AuditActionType.Adjust]: activity.actionAdjust,
    [AuditActionType.Suspend]: activity.actionSuspend,
  };
}

/** Entity-type wire values the backend mints → their `entityTypeLabels` key. */
const ENTITY_TYPE_KEY_BY_WIRE: Record<string, keyof AdminUsersLabels["auditTrail"]["entityTypeLabels"] | undefined> = {
  user: "user",
  teacher: "teacher",
  session: "session",
  subscription: "subscription",
  plan: "plan",
  teacher_transaction: "teacherTransaction",
  parent_link_request: "parentLinkRequest",
  parent_link_request_decision: "parentLinkRequestDecision",
  parent_link_request_expiry: "parentLinkRequestExpiry",
  notification_broadcast: "notificationBroadcast",
};

/**
 * The canonical entity-type wire values, in display order — the filter
 * bar's quick-pick chips render one toggle per value (the chips fill the
 * free-text entity-type DRAFT with the recorded wire string, which the
 * filter matches exactly).
 */
export const ENTITY_TYPE_WIRE_VALUES: readonly string[] = Object.keys(ENTITY_TYPE_KEY_BY_WIRE);

/**
 * Localized display label for an audit entry's raw entity-type wire value.
 * Known values resolve through the `auditTrail.entityTypeLabels`
 * vocabulary; a value outside it (a future feature's new type) renders
 * verbatim — fail-open DISPLAY, while the FILTER keeps matching the raw
 * wire string exactly.
 */
export function entityTypeLabelOf(labels: AdminUsersLabels["auditTrail"], rawType: string): string {
  const key = ENTITY_TYPE_KEY_BY_WIRE[rawType];
  return key === undefined ? rawType : labels.entityTypeLabels[key];
}
