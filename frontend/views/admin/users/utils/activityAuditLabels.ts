/**
 * activityAuditLabels — audit-entry label logic for the per-user activity
 * timeline on the admin user DETAIL page, extracted from
 * `RecentActivityCard.tsx` (which remains the sole consumer surface; the
 * timeline rendering itself lives in `activityTimeline.tsx`).
 */

import { type AdminUserActivityQuery, AuditActionType } from "@/frontend/graphql/generated/gql/graphql";
import type { AdminUsersLabels } from "@/shared/locale/types/adminUsers";

export type ActivityEntry = AdminUserActivityQuery["adminUserActivity"][number];

export type ActivityLabels = Pick<
  AdminUsersLabels,
  "activity" | "errorState" | "headers" | "createDialog" | "editDialog"
>;

/** Localized action label for an audit entry (Record lookup — no enum switch). */
export function actionLabel(action: AuditActionType, labels: ActivityLabels): string {
  const labelsByAction: Record<AuditActionType, string> = {
    [AuditActionType.Create]: labels.activity.actionCreate,
    [AuditActionType.Update]: labels.activity.actionUpdate,
    [AuditActionType.Delete]: labels.activity.actionDelete,
    [AuditActionType.Reactivate]: labels.activity.actionReactivate,
    [AuditActionType.Suspend]: labels.activity.actionSuspend,
    [AuditActionType.Override]: labels.activity.actionOverride,
    [AuditActionType.Adjust]: labels.activity.actionAdjust,
  };
  return labelsByAction[action];
}

/**
 * Localizes a raw audit `changedFields` column name (e.g. `"fullName"`)
 * using the existing label blocks; unknown names fall back to the raw
 * string (future fields render honestly instead of blanking out).
 */
export function localizeAuditFieldName(field: string, labels: ActivityLabels): string {
  switch (field) {
    case "fullName":
      return labels.headers.name;
    case "email":
      return labels.headers.email;
    case "phone":
      return labels.createDialog.phone;
    case "country":
      return labels.headers.country;
    case "gender":
      return labels.createDialog.gender;
    case "dateOfBirth":
      return labels.editDialog.dateOfBirth;
    case "role":
      return labels.headers.role;
    default:
      return field;
  }
}
