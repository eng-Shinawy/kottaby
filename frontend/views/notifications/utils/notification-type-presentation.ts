import {
  CampaignOutlined,
  CancelOutlined,
  CheckCircleOutlined,
  FamilyRestroomOutlined,
  GradeOutlined,
  PaymentsOutlined,
  ScheduleOutlined,
  type SvgIconComponent,
} from "@mui/icons-material";
import { NotificationType } from "@/frontend/graphql/generated/gql/graphql";
import type { NotificationsLabels } from "@/shared/locale/types/notifications";

/**
 * Codegen `NotificationType` (GraphQL wire names) → localized display-label
 * accessor.
 *
 * Enum-keyed `Record` lookup (the sanctioned `no-unsafe-enum-comparison`
 * pattern from `frontend/AGENTS.md`) — every accessor is a property access on
 * the `notifications` namespace labels handle, never call-by-key. Covers all
 * seven notification-type values; exhaustiveness is compiler-enforced by the
 * `Record<NotificationType, …>` key type.
 */
export const NOTIFICATION_TYPE_LABEL_ACCESSORS: Readonly<
  Record<NotificationType, (labels: NotificationsLabels) => string>
> = {
  [NotificationType.SessionRequest]: labels => labels.typeSessionRequest,
  [NotificationType.SessionCompletion]: labels => labels.typeSessionCompletion,
  [NotificationType.SessionCancellation]: labels => labels.typeSessionCancellation,
  [NotificationType.ParentLinkRequest]: labels => labels.typeParentLinkRequest,
  [NotificationType.SystemBroadcast]: labels => labels.typeSystemBroadcast,
  [NotificationType.PaymentConfirmation]: labels => labels.typePaymentConfirmation,
  [NotificationType.EvaluationResult]: labels => labels.typeEvaluationResult,
};

/**
 * Codegen `NotificationType` → semantically-matching `*Outlined` icon for the
 * row leading slot and the filter chips.
 */
export const NOTIFICATION_TYPE_ICONS: Readonly<Record<NotificationType, SvgIconComponent>> = {
  [NotificationType.SessionRequest]: ScheduleOutlined,
  [NotificationType.SessionCompletion]: CheckCircleOutlined,
  [NotificationType.SessionCancellation]: CancelOutlined,
  [NotificationType.ParentLinkRequest]: FamilyRestroomOutlined,
  [NotificationType.SystemBroadcast]: CampaignOutlined,
  [NotificationType.PaymentConfirmation]: PaymentsOutlined,
  [NotificationType.EvaluationResult]: GradeOutlined,
};

/**
 * Chip presentation order for the type filter — mirrors the canonical
 * notification-type listing order (session events → parent link → broadcast →
 * payment → evaluation).
 */
export const NOTIFICATION_TYPE_CHIP_ORDER: readonly NotificationType[] = [
  NotificationType.SessionRequest,
  NotificationType.SessionCompletion,
  NotificationType.SessionCancellation,
  NotificationType.ParentLinkRequest,
  NotificationType.SystemBroadcast,
  NotificationType.PaymentConfirmation,
  NotificationType.EvaluationResult,
];
