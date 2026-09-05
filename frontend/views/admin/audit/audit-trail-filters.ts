/**
 * Audit-trail filter contract + pure filter plumbing (JSX-free).
 *
 * Owns the boundary between the three filter representations the view
 * juggles:
 *
 *  1. `AuditTrailFiltersSeed` — the deep-link/draft shape the
 *     server route passes in (already sanitized) and the filter bar submits:
 *     calendar-day `YYYY-MM-DD` strings and optional numeric ids;
 *  2. `FilterDrafts` — the controlled draft inputs of the filter bar;
 *  3. `AppliedAuditTrailFilters` — the applied record the query variables
 *     are built from. Dates are parsed to UTC-day boundaries client-side:
 *     `from` maps to UTC midnight (inclusive) and `to` expands to the
 *     EXCLUSIVE midnight AFTER the selected calendar day, so an inclusive
 *     calendar-day range rides the wire as a half-open instant interval.
 *     Malformed drafts normalize to "unfiltered" instead of erroring.
 *
 * Also carries the action vocabulary: the generated `AuditActionType` values
 * paired with the REUSED `adminUsers.activity.action*` labels (single action
 * vocabulary across the admin-users domain — the `auditTrail` block mints no
 * per-action labels of its own).
 */

// The generated module carries BOTH the wire `AdminAuditLogFiltersInput` type
// and the RUNTIME `AuditActionType` enum (the `ACTION_VALUES` vocabulary and
// `actionLabelsOf` keys read its members) in one import — the enum is a value
// here, not a type-only reference.
import { type AdminAuditLogFiltersInput, AuditActionType } from "@/frontend/graphql/generated/gql/graphql";
import type { AdminUsersLabels } from "@/shared/locale/types/adminUsers";

/**
 * Deep-link filter seed passed by the server route after its sanitize step
 * (query-string values that fail to parse are dropped server-side; the view
 * additionally normalizes empties/malformed values to "unfiltered" on its
 * side). Dates are calendar-day strings (`YYYY-MM-DD`, the native date-input
 * wire format); the view constructs the UTC-day boundaries client-side.
 */
export interface AuditTrailFiltersSeed {
  /** Filter on the recorded action type (an exact generated-enum value). */
  readonly actionType?: AuditActionType;
  /** Acting-admin id filter (already a number, or dropped upstream). */
  readonly actorId?: number;
  /** Entity-id filter (already a number, or dropped upstream). */
  readonly entityId?: number;
  /** Entity-type filter, free text. */
  readonly entityType?: string;
  /** Inclusive range start as a `YYYY-MM-DD` calendar day. */
  readonly from?: string;
  /** Inclusive range end as a `YYYY-MM-DD` calendar day. */
  readonly to?: string;
}

/** Controlled draft inputs of the filter bar (string shape; `""` = unset). */
export interface FilterDrafts {
  readonly actionType: AuditActionType | "";
  readonly actorId: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly from: string;
  readonly to: string;
}

/** The applied-filter record the query variables are built from. */
export interface AppliedAuditTrailFilters {
  readonly actionType: AuditActionType | null;
  readonly actorId: number | null;
  readonly entityType: string | null;
  readonly entityId: number | null;
  /** Inclusive range start at UTC midnight. */
  readonly from: Date | null;
  /** Exclusive range end (the midnight AFTER the selected calendar day). */
  readonly to: Date | null;
}

export const NO_FILTERS: AppliedAuditTrailFilters = {
  actionType: null,
  actorId: null,
  entityType: null,
  entityId: null,
  from: null,
  to: null,
};

const DAY_MS = 86_400_000;
const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const ID_PATTERN = /^\d+$/;

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

/**
 * Parses a `YYYY-MM-DD` date-input value into UTC midnight. Malformed or
 * impossible calendar values (an out-of-range month/day component would
 * silently roll over under `Date.UTC`) normalize to `null` — an unparseable
 * draft never constrains the query.
 */
export function parseUtcDayStart(value: string): Date | null {
  const match = DAY_PATTERN.exec(value);
  if (match === null) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return date;
}

/**
 * The exclusive wire boundary for the `to` calendar day: the midnight AFTER
 * the selected day (UTC has no DST, so a 24h offset is exact).
 */
export function parseUtcDayEndExclusive(value: string): Date | null {
  const start = parseUtcDayStart(value);
  return start === null ? null : new Date(start.getTime() + DAY_MS);
}

/** Non-negative integer parse for the id inputs; absent/malformed → `null`. */
export function parseIdInput(value: string): number | null {
  return ID_PATTERN.test(value) ? Number(value) : null;
}

/**
 * Keeps a deep-link date draft only when it parses as a real calendar day —
 * mirroring the server route's drop-invalid posture so a malformed seed can
 * never reach the bar or the wire.
 */
function sanitizeDateDraft(value: string): string {
  return parseUtcDayStart(value) === null ? "" : value;
}

/** Seeds the bar's draft state from the sanitized deep-link values. */
export function draftsFromSubmitInput(initialFilters: AuditTrailFiltersSeed | undefined): FilterDrafts {
  if (initialFilters === undefined) {
    return { actionType: "", actorId: "", entityType: "", entityId: "", from: "", to: "" };
  }
  return {
    actionType: initialFilters.actionType ?? "",
    actorId: initialFilters.actorId === undefined ? "" : String(initialFilters.actorId),
    entityType: initialFilters.entityType ?? "",
    entityId: initialFilters.entityId === undefined ? "" : String(initialFilters.entityId),
    from: initialFilters.from === undefined ? "" : sanitizeDateDraft(initialFilters.from),
    to: initialFilters.to === undefined ? "" : sanitizeDateDraft(initialFilters.to),
  };
}

export function appliedFiltersFromSubmitInput(
  initialFilters: AuditTrailFiltersSeed | undefined
): AppliedAuditTrailFilters {
  if (initialFilters === undefined) return NO_FILTERS;
  return {
    actionType: initialFilters.actionType ?? null,
    actorId: initialFilters.actorId ?? null,
    entityType: (initialFilters.entityType ?? "").trim() || null,
    entityId: initialFilters.entityId ?? null,
    from: initialFilters.from === undefined ? null : parseUtcDayStart(initialFilters.from),
    to: initialFilters.to === undefined ? null : parseUtcDayEndExclusive(initialFilters.to),
  };
}

/** Lowest accepted id-filter value — ids are 1-based positive safe integers. */
const MIN_ID = 1;

/** Highest accepted id-filter value — the GraphQL `Int` wire max (2^31 - 1). */
const MAX_ID = 2147483647;

/**
 * Normalizes the interactive drafts into the applied record. Malformed
 * drafts normalize to "unfiltered" instead of erroring: a typed `0` id is
 * treated as cleared (ids are 1-based — the same bound the route's
 * deep-link sanitizer enforces), an id above the GraphQL `Int` wire max
 * (2^31 - 1) is cleared the same way — it could never survive wire
 * coercion, so it drops instead of surfacing an error — an unparseable
 * calendar day narrows to a one-sided window, and an inverted calendar-day
 * pair (start AFTER end) clears BOTH bounds — the route's own deep-link
 * posture — because such a pair could only produce an empty query window
 * the service would reject.
 */
export function appliedFiltersFromDrafts(drafts: FilterDrafts): AppliedAuditTrailFilters {
  const actorId = parseIdInput(drafts.actorId);
  const entityId = parseIdInput(drafts.entityId);
  const fromDay = drafts.from === "" ? null : parseUtcDayStart(drafts.from);
  const toDay = drafts.to === "" ? null : parseUtcDayStart(drafts.to);
  const inverted = fromDay !== null && toDay !== null && fromDay.getTime() > toDay.getTime();
  return {
    actionType: drafts.actionType === "" ? null : drafts.actionType,
    actorId: actorId !== null && actorId >= MIN_ID && actorId <= MAX_ID ? actorId : null,
    entityType: drafts.entityType.trim() || null,
    entityId: entityId !== null && entityId >= MIN_ID && entityId <= MAX_ID ? entityId : null,
    from: inverted ? null : fromDay,
    to: inverted || toDay === null ? null : parseUtcDayEndExclusive(drafts.to),
  };
}

/**
 * Builds the GraphQL filters variable carrying ONLY the non-empty values.
 * The applied Date boundaries serialize to their ISO-8601 UTC instants —
 * the wire shape the generated `AdminAuditLogFiltersInput` declares for the
 * `DateTime` scalar (`from` at midnight of the start day, `to` at midnight
 * AFTER the end day, i.e. an inclusive calendar-day range rides the wire as
 * a half-open instant interval).
 */
export function buildFiltersInput(applied: AppliedAuditTrailFilters): AdminAuditLogFiltersInput {
  // All six keys start undefined (dropped from the JSON payload entirely) and
  // only the non-empty applied values are assigned — the wire filters object
  // never carries nulls or empty strings.
  const filters: AdminAuditLogFiltersInput = {
    actionType: undefined,
    actorId: undefined,
    entityId: undefined,
    entityType: undefined,
    from: undefined,
    to: undefined,
  };
  if (applied.actionType !== null) filters.actionType = applied.actionType;
  if (applied.actorId !== null) filters.actorId = applied.actorId;
  if (applied.entityType !== null) filters.entityType = applied.entityType;
  if (applied.entityId !== null) filters.entityId = applied.entityId;
  if (applied.from !== null) filters.from = applied.from.toISOString();
  if (applied.to !== null) filters.to = applied.to.toISOString();
  return filters;
}
