import { SessionStatus, type SurahJuzRef } from "@/frontend/graphql/generated/gql/graphql";
import type { ParentMonitoringLabels } from "@/shared/locale/types/parentMonitoring";

/**
 * Parent-portal presentation helpers — the pure mapping surface between
 * the read-model GraphQL enum payloads and the localized label slots the
 * parentMonitoring namespace exposes.
 *
 * Extended with status-color and status-icon resolution for the enhanced
 * attendance-row visual treatment (colored left border + status icon).
 * Colors resolve through the MUI theme palette callback so the portal
 * never hardcodes hex values; the helper returns a palette path that the
 * component feeds into the sx prop.
 */

const SESSION_STATUS_LABEL_KEYS: Readonly<Record<SessionStatus, keyof ParentMonitoringLabels>> = {
  [SessionStatus.Completed]: "attendanceStatusAttended",
  [SessionStatus.Cancelled]: "attendanceStatusCancelled",
  [SessionStatus.Disputed]: "attendanceStatusDisputed",
  [SessionStatus.Scheduled]: "attendanceStatusScheduled",
  [SessionStatus.Started]: "attendanceStatusStarted",
};

export function attendanceStatusLabel(status: SessionStatus, labels: ParentMonitoringLabels): string {
  const slotKey = SESSION_STATUS_LABEL_KEYS[status];
  const value = labels[slotKey];
  return typeof value === "string" ? value : "";
}

export interface StatusColorPaths {
  readonly border: string;
  readonly icon: string;
  readonly chip: string;
}

export function attendanceStatusColor(status: SessionStatus): StatusColorPaths {
  switch (status) {
    case SessionStatus.Completed:
      return { border: "success.main", icon: "success.main", chip: "success" };
    case SessionStatus.Started:
      return { border: "info.main", icon: "info.main", chip: "info" };
    case SessionStatus.Scheduled:
      return { border: "warning.main", icon: "warning.main", chip: "warning" };
    case SessionStatus.Cancelled:
    case SessionStatus.Disputed:
      return { border: "error.main", icon: "error.main", chip: "error" };
    default:
      return { border: "divider", icon: "action.active", chip: "default" };
  }
}

export function formatSurahJuzRef(ref: SurahJuzRef): string {
  return ref.replace(/([A-Za-z])([A-Z])/g, REPLACEMENT).replace(/([A-Za-z])(\d)/g, REPLACEMENT);
}

const REPLACEMENT = "$1 $2";

export function childInitial(fullName: string): string {
  const trimmed = fullName.trim();
  if (trimmed.length === 0) {
    return "?";
  }
  return trimmed[0].toUpperCase();
}
