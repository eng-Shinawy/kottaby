import {
  CancelOutlined as CancelledIcon,
  CheckCircleOutlined as CompletedIcon,
  ReportProblemOutlined as DisputedIcon,
  ScheduleOutlined as ScheduledIcon,
  PlayCircleOutlined as StartedIcon,
  type SvgIconComponent,
} from "@mui/icons-material";
import type { Palette } from "@mui/material/styles";
import { SessionStatus } from "@/frontend/graphql/generated/gql/graphql";
import type { SessionsLabels } from "@/shared/locale/types/sessions";

/**
 * Shared presentation tables for the session list row parts
 * (`SessionRow` + its extracted siblings in this folder).
 *
 * Every table is keyed by the server enum member STRINGS through
 * `Record<string, …>` lookups — oxlint `no-unsafe-enum-comparison` bans
 * `switch` over enum members and direct enum comparisons, so the lifecycle
 * vocabulary travels exclusively through these token tables.
 */

/** Typographic placeholder for nullable payload values (NOT locale copy). */
export const NO_VALUE_PLACEHOLDER = "—";

/**
 * Status-chip label-key union — the NARROW slice of `SessionsLabels` the
 * lifecycle chip may render. The namespace also carries template-function
 * labels (e.g. `adminDisputesCountLine`) that are NOT renderable as a chip
 * label, so the lookup table is keyed by this Pick-union, never the full
 * `keyof SessionsLabels`.
 */
export type StatusChipLabelKey = keyof Pick<
  SessionsLabels,
  "statusScheduled" | "statusStarted" | "statusCompleted" | "statusCancelled" | "statusDisputed"
>;

/** Chip label key per lifecycle status (vocabulary-stability pin includes `Disputed`). */
export const STATUS_LABEL_KEY: Record<string, StatusChipLabelKey> = {
  [SessionStatus.Scheduled]: "statusScheduled",
  [SessionStatus.Started]: "statusStarted",
  [SessionStatus.Completed]: "statusCompleted",
  [SessionStatus.Cancelled]: "statusCancelled",
  [SessionStatus.Disputed]: "statusDisputed",
};

/** Visual tone family driving the chip's container/on-container pair. */
export type StatusTone = "info" | "primary" | "success" | "error" | "warning";

/** Tone per lifecycle status (Scheduled=info, Started=primary, terminal pairs). */
export const STATUS_TONE: Record<string, StatusTone> = {
  [SessionStatus.Scheduled]: "info",
  [SessionStatus.Started]: "primary",
  [SessionStatus.Completed]: "success",
  [SessionStatus.Cancelled]: "error",
  [SessionStatus.Disputed]: "warning",
};

/** Tone → Material 3 container/on-container pair (ProfileView pattern). */
export const TONE_COLORS: Record<
  string,
  { readonly bg: (palette: Palette) => string; readonly fg: (palette: Palette) => string }
> = {
  info: { bg: p => p.infoContainer, fg: p => p.onInfoContainer },
  primary: { bg: p => p.primaryContainer, fg: p => p.onPrimaryContainer },
  success: { bg: p => p.successContainer, fg: p => p.onSuccessContainer },
  error: { bg: p => p.errorContainer, fg: p => p.onErrorContainer },
  warning: { bg: p => p.warningContainer, fg: p => p.onWarningContainer },
};

/** Semantically-matching outlined chip icon per lifecycle status. */
export const STATUS_ICON: Record<string, SvgIconComponent> = {
  [SessionStatus.Scheduled]: ScheduledIcon,
  [SessionStatus.Started]: StartedIcon,
  [SessionStatus.Completed]: CompletedIcon,
  [SessionStatus.Cancelled]: CancelledIcon,
  [SessionStatus.Disputed]: DisputedIcon,
};

/**
 * Cancellable-lifecycle lookup — the Cancel CTA renders ENABLED only for
 * these statuses (Record lookup, never an enum comparison). Disputed rows
 * render the CTA DISABLED (the state machine forbids cancelling a disputed
 * session — R-110).
 */
export const CANCELLABLE_STATUSES: Record<string, true> = {
  [SessionStatus.Scheduled]: true,
  [SessionStatus.Started]: true,
};

/**
 * Confirm-pending lookup (DEV3-012) — the student's confirm affordance and
 * the "awaiting student confirmation" hint key off this status via Record
 * lookup (never an enum comparison). The row additionally requires the
 * student stamp to be unset and the hold still marked.
 */
export const CONFIRM_PENDING_STATUSES: Record<string, true> = {
  [SessionStatus.Completed]: true,
};

/** Disputed token (Record lookup — the disabled-Cancel state). */
export const DISPUTED_STATUS: Record<string, true> = {
  [SessionStatus.Disputed]: true,
};

/**
 * Disputable-lifecycle lookup — the dispute CTA renders ONLY for these
 * statuses (R-110: disputes open from `scheduled` or `started`).
 */
export const DISPUTABLE_STATUSES: Record<string, true> = {
  [SessionStatus.Scheduled]: true,
  [SessionStatus.Started]: true,
};
