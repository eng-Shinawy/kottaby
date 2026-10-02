import type { Palette } from "@mui/material/styles";
import {
  type AdminBroadcastFiltersInput,
  type AdminBroadcastsQuery_adminBroadcasts_items,
  BroadcastAudienceType,
  BroadcastStatus,
} from "@/frontend/graphql/generated/gql/graphql";
import {
  audienceKindLabel,
  roleOptionLabel,
  trimmedOrNullable,
} from "@/frontend/views/admin/broadcasts/broadcast-compose.helpers";
import { COUNTRIES } from "@/shared/constants/countries";
import { countrySeedToCode } from "@/shared/lib/country-code";
import type { AppLocale } from "@/shared/locale/AppLocale";
import type { AdminBroadcastsLabels } from "@/shared/locale/types/adminBroadcasts";
import type { AdminUsersLabels } from "@/shared/locale/types/adminUsers";

/**
 * Shared vocabulary of the broadcast history surface (`/admin/broadcasts`,
 * History tab): the filter draft shape, the notice slot the stop flow
 * surfaces through the shared snackbar, the 1-based page clamp, the
 * row-id → `Int!` wire bridge, and the status-chip tone tables. Every
 * consumer (the data/stop hooks, the filter bar / table / pager / section
 * components, and the container that wires them) imports from HERE so the
 * contracts stay single-sourced.
 */

/** Page size — the backend's own default/clamp midpoint (default 25, max 100). */
export const BROADCAST_HISTORY_PAGE_SIZE = 25;

/** Typographic placeholder for nullable payload values (NOT locale copy). */
export const HISTORY_NO_VALUE_PLACEHOLDER = "—";

/** One history row — the shared `AdminBroadcastEntryFields` fragment shape. */
export type BroadcastHistoryRow = AdminBroadcastsQuery_adminBroadcasts_items;

/** The filter bar's editable draft (selects commit instantly; search commits on submit). */
export interface BroadcastHistoryFilterDraft {
  /** Title-search token — a raw typing field; trimmed when applied. */
  readonly titleSearch: string;
  /** Lifecycle status filter, or `null` for the unfiltered arm. */
  readonly status: BroadcastStatus | null;
  /** Audience-kind filter, or `null` for the unfiltered arm. */
  readonly audienceType: BroadcastAudienceType | null;
}

/** Wire-shaped unfiltered state — every member explicitly null. */
export const EMPTY_HISTORY_FILTER_DRAFT: BroadcastHistoryFilterDraft = {
  titleSearch: "",
  status: null,
  audienceType: null,
};

/** One transient history-surface notice rendered in the shared snackbar slot. */
export interface BroadcastHistoryNotice {
  readonly message: string;
  readonly severity: "success" | "info" | "error";
}

/** Clamps a 1-based page into `1..totalPages` (never renders a ghost page). */
export function clampPage(page: number, totalPages: number): number {
  return Math.min(Math.max(1, page), Math.max(1, totalPages));
}

/** All valid `BroadcastStatus` members (the filter select's option set). */
export const BROADCAST_STATUS_OPTIONS: readonly BroadcastStatus[] = [BroadcastStatus.Active, BroadcastStatus.Stopped];

const BROADCAST_STATUS_VALUES: ReadonlySet<string> = new Set<string>(BROADCAST_STATUS_OPTIONS);

/** Type-guard for select `onChange` payloads (never an unsafe cast). */
export function isBroadcastStatusValue(value: string): value is BroadcastStatus {
  return BROADCAST_STATUS_VALUES.has(value);
}

/**
 * Row id (`ID!`, stringified on the entry) → the `Int!` wire argument the
 * detail read and the stop mutation take. `null` for a malformed id — the
 * caller keeps its state instead of firing a doomed request.
 */
export function broadcastNumericId(entryId: string): number | null {
  const parsed = Number.parseInt(entryId, 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/** Commits a draft into the wire-shaped filter (trimmed search token). */
export function buildAppliedHistoryFilter(draft: BroadcastHistoryFilterDraft): AdminBroadcastFiltersInput {
  return {
    audienceType: draft.audienceType,
    status: draft.status,
    titleSearch: trimmedOrNullable(draft.titleSearch),
  };
}

/** Visual tone family driving the status chip's container/on-container pair. */
export type BroadcastHistoryStatusTone = "success" | "warning";

/** Tone per lifecycle status — Active is live, Stopped is terminal-retracted. */
const BROADCAST_STATUS_TONE: Readonly<Record<string, BroadcastHistoryStatusTone>> = {
  [BroadcastStatus.Active]: "success",
  [BroadcastStatus.Stopped]: "warning",
};

/** Tone → Material 3 container/on-container pair. */
export const BROADCAST_TONE_COLORS: Readonly<
  Record<string, { readonly bg: (palette: Palette) => string; readonly fg: (palette: Palette) => string }>
> = {
  success: { bg: palette => palette.successContainer, fg: palette => palette.onSuccessContainer },
  warning: { bg: palette => palette.warningContainer, fg: palette => palette.onWarningContainer },
};

/** Defensive tone resolver — a corrupt status renders in the muted warning pair. */
export function broadcastStatusTone(status: BroadcastStatus): BroadcastHistoryStatusTone {
  return BROADCAST_STATUS_TONE[status] ?? "warning";
}

/** Chip label key per lifecycle status — corrupt statuses render the stopped vocabulary. */
export function broadcastStatusLabelKey(status: BroadcastStatus): "statusActive" | "statusStopped" {
  return status === BroadcastStatus.Active ? "statusActive" : "statusStopped";
}

/**
 * The audience column's display text: the audience-kind label
 * (`audienceAll` / `audienceRole` / `audienceCountry` / `audiencePlan`)
 * qualified with the cohort detail the entry snapshot carries — the role
 * label for role cohorts (admin directory `roleLabels`), and for country
 * cohorts the snapshot text resolved through the shared seed bridge: a
 * resolvable value (ISO code or legacy display text) renders as the flag
 * emoji + the LOCALE's dataset name (the directory filter chip's grammar);
 * unresolvable free text renders verbatim. Plan cohorts render the kind
 * label alone (the snapshot stores the plan ID, not its name). A `null`
 * audience type (backfill-tolerance arm) renders the typographic
 * placeholder.
 */
export function broadcastAudienceText(
  entry: BroadcastHistoryRow,
  t: AdminBroadcastsLabels,
  roleLabels: AdminUsersLabels["roleLabels"],
  locale: AppLocale
): string {
  if (entry.audienceType === null) {
    return HISTORY_NO_VALUE_PLACEHOLDER;
  }
  const kindLabel = audienceKindLabel(entry.audienceType, t);
  if (entry.audienceType === BroadcastAudienceType.Role && entry.audienceRole !== null) {
    return `${kindLabel}: ${roleOptionLabel(entry.audienceRole, roleLabels)}`;
  }
  if (entry.audienceType === BroadcastAudienceType.Country && entry.audienceCountry !== null) {
    const code = countrySeedToCode(entry.audienceCountry);
    if (code !== "") {
      return `${kindLabel}: ${COUNTRIES[code].flag} ${COUNTRIES[code][locale]}`;
    }
    return `${kindLabel}: ${entry.audienceCountry}`;
  }
  return kindLabel;
}
