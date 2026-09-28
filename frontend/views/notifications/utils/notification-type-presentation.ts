import {
  CampaignOutlined,
  CancelOutlined,
  CheckCircleOutlined,
  FamilyRestroomOutlined,
  GavelOutlined,
  GradeOutlined,
  PaymentsOutlined,
  ScheduleOutlined,
  type SvgIconComponent,
  VerifiedOutlined,
} from "@mui/icons-material";
import { NotificationType } from "@/frontend/graphql/generated/gql/graphql";
import type { NotificationsLabels } from "@/shared/locale/types/notifications";

/**
 * Semantic avatar tones — the Material-You container-palette roles a
 * notification row's leading type disc can carry. The tone is decided PER
 * TYPE from the kind's fixed polarity (never from the row's copy), so the
 * disc always communicates the same category no matter which emitter fired.
 */
export type NotificationTypeTone = "primary" | "info" | "success" | "warning" | "error";

/**
 * Codegen `NotificationType` → the leading type-disc's semantic tone.
 *
 * Tone semantics (fixed polarity per kind):
 *  - `success` — an outcome the recipient wants (a session happened, a
 *    payment landed);
 *  - `error` — an outcome the recipient did NOT want (a session fell
 *    through);
 *  - `warning` — attention/decision is being demanded (a dispute opened);
 *  - `info` — neutral informative waves (requests, arbitrations decided,
 *    evaluation decisions, application outcomes);
 *  - `primary` — platform-voice announcements stay brand-neutral.
 *
 * Enum-keyed `Record` lookup — exhaustive, compiler-enforced.
 */
export const NOTIFICATION_TYPE_TONES: Readonly<Record<NotificationType, NotificationTypeTone>> = {
  [NotificationType.SessionRequest]: "info",
  [NotificationType.SessionCompletion]: "success",
  [NotificationType.SessionCancellation]: "error",
  [NotificationType.SessionDisputeOpened]: "warning",
  [NotificationType.SessionDisputeResolved]: "info",
  [NotificationType.ParentLinkRequest]: "info",
  [NotificationType.SystemBroadcast]: "primary",
  [NotificationType.PaymentConfirmation]: "success",
  [NotificationType.EvaluationResult]: "info",
  [NotificationType.ApplicantOutcome]: "info",
};

/**
 * Codegen `NotificationType` → localized display-label
 * accessor.
 *
 * Enum-keyed `Record` lookup (the sanctioned `no-unsafe-enum-comparison`
 * pattern from `frontend/AGENTS.md`) — every accessor is a property access on
 * the `notifications` namespace labels handle, never call-by-key. Covers all
 * ten notification-type values; exhaustiveness is compiler-enforced by the
 * `Record<NotificationType, …>` key type.
 */
export const NOTIFICATION_TYPE_LABEL_ACCESSORS: Readonly<
  Record<NotificationType, (labels: NotificationsLabels) => string>
> = {
  [NotificationType.SessionRequest]: labels => labels.typeSessionRequest,
  [NotificationType.SessionCompletion]: labels => labels.typeSessionCompletion,
  [NotificationType.SessionCancellation]: labels => labels.typeSessionCancellation,
  [NotificationType.SessionDisputeOpened]: labels => labels.typeSessionDisputeOpened,
  [NotificationType.SessionDisputeResolved]: labels => labels.typeSessionDisputeResolved,
  [NotificationType.ParentLinkRequest]: labels => labels.typeParentLinkRequest,
  [NotificationType.SystemBroadcast]: labels => labels.typeSystemBroadcast,
  [NotificationType.PaymentConfirmation]: labels => labels.typePaymentConfirmation,
  [NotificationType.EvaluationResult]: labels => labels.typeEvaluationResult,
  [NotificationType.ApplicantOutcome]: labels => labels.typeApplicantOutcome,
};

/**
 * Codegen `NotificationType` → semantically-matching `*Outlined` icon for the
 * row leading slot and the filter chips.
 */
export const NOTIFICATION_TYPE_ICONS: Readonly<Record<NotificationType, SvgIconComponent>> = {
  [NotificationType.SessionRequest]: ScheduleOutlined,
  [NotificationType.SessionCompletion]: CheckCircleOutlined,
  [NotificationType.SessionCancellation]: CancelOutlined,
  [NotificationType.SessionDisputeOpened]: GavelOutlined,
  [NotificationType.SessionDisputeResolved]: GavelOutlined,
  [NotificationType.ParentLinkRequest]: FamilyRestroomOutlined,
  [NotificationType.SystemBroadcast]: CampaignOutlined,
  [NotificationType.PaymentConfirmation]: PaymentsOutlined,
  [NotificationType.EvaluationResult]: GradeOutlined,
  [NotificationType.ApplicantOutcome]: VerifiedOutlined,
};

/**
 * Chip presentation order for the type filter — mirrors the canonical
 * notification-type listing order (session events → parent link → broadcast →
 * payment → evaluation → application outcome).
 */
export const NOTIFICATION_TYPE_CHIP_ORDER: readonly NotificationType[] = [
  NotificationType.SessionRequest,
  NotificationType.SessionCompletion,
  NotificationType.SessionCancellation,
  NotificationType.SessionDisputeOpened,
  NotificationType.SessionDisputeResolved,
  NotificationType.ParentLinkRequest,
  NotificationType.SystemBroadcast,
  NotificationType.PaymentConfirmation,
  NotificationType.EvaluationResult,
  NotificationType.ApplicantOutcome,
];
