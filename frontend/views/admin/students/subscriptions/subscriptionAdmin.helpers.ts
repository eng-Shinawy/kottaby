/**
 * Pure view helpers of the admin student drawer's subscription-management
 * section. Extracted so the per-status action matrix, the status-lens math
 * (counts + filtering + the next-expiry scan), the extend-days
 * validation, the cancel-reason normalization, the change-plan eligibility
 * filter, and the newest-first ordering stay testable without rendering
 * (the rateTeacherMutationError test precedent: pure logic tier).
 *
 * Enum discipline: status/direction comparisons flow from VALUE
 * imports of the generated enums through exhaustive Record lookup tables —
 * never runtime string literals, never switch statements on enum values.
 *
 * The server stays the authority: client validation only gates the
 * "days > 0" rule, the protocol's int4 wire limit (a transport
 * constraint, not business authority), and the 200-character
 * cancel-reason seam cap; everything else degrades to the server's
 * localized denial surfaced inside the dialog.
 */
import {
  type AdminPlansQuery,
  type AdminStudentSubscriptionsQuery,
  SubscriptionStatus,
} from "@/frontend/graphql/generated/gql/graphql";
import type { DirectoryTone } from "@/frontend/views/admin/users/utils";
import { groupDecimalDigits } from "@/shared/lib/group-decimal-digits";

/** One subscription row as the drawer section consumes it (query shape). */
export type SubscriptionRow = AdminStudentSubscriptionsQuery["adminStudentSubscriptions"][number];

/** One admin catalog plan as the change-plan selector consumes it. */
export type AdminPlanItem = AdminPlansQuery["adminPlans"][number];

/** UI-seam cap for the optional cancel reason (mirrors the backend boundary). */
export const MAX_CANCEL_REASON_LENGTH = 200;

// ---------------------------------------------------------------------------
// Ordering — the drawer renders newest-first

/**
 * Rows ordered newest-first by creation stamp. The server already orders
 * the list; this client-side sort keeps the drawer honest when rows from
 * different refetch generations merge in the cache.
 */
export function sortNewestFirst(rows: readonly SubscriptionRow[]): SubscriptionRow[] {
  return [...rows].toSorted((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

// ---------------------------------------------------------------------------
// Status presentation

/** Status → directory tone lane (M3 container pairs from the shared lookup). */
export const STATUS_TONE: Record<SubscriptionStatus, DirectoryTone> = {
  [SubscriptionStatus.Active]: "success",
  [SubscriptionStatus.Expired]: "error",
  [SubscriptionStatus.Pending]: "warning",
  [SubscriptionStatus.Cancelled]: "neutral",
  [SubscriptionStatus.Suspended]: "secondary",
};

// ---------------------------------------------------------------------------
// Status filter lens — the chip row's pure math

/** The chip row's selection: the unfiltered lens or one lifecycle status. */
export type SubscriptionStatusFilter = "all" | SubscriptionStatus;

/**
 * Per-status tallies of the fetched rows, keyed by the wire enum (the
 * suspended member always tallies 0 here — the enum-exhaustive record keeps
 * the shape honest even though governance surfaces own that status).
 */
export function countByStatus(rows: readonly SubscriptionRow[]): Record<SubscriptionStatus, number> {
  const counts: Record<SubscriptionStatus, number> = {
    [SubscriptionStatus.Active]: 0,
    [SubscriptionStatus.Expired]: 0,
    [SubscriptionStatus.Pending]: 0,
    [SubscriptionStatus.Cancelled]: 0,
    [SubscriptionStatus.Suspended]: 0,
  };
  for (const row of rows) {
    counts[row.status] += 1;
  }
  return counts;
}

/** The rows passing the selected lens (the unfiltered lens passes everything). */
export function filterByStatus(rows: readonly SubscriptionRow[], filter: SubscriptionStatusFilter): SubscriptionRow[] {
  if (filter === "all") {
    return [...rows];
  }
  return rows.filter(row => row.status === filter);
}

/**
 * The soonest period bound among the ACTIVE rows — the summary strip's
 * "next expiry" value — or `null` when no active row carries a bound
 * (pending rows never count: they have no open window to end). The wire
 * format flows through verbatim; the badge/banner day math parses it.
 */
export function nextExpiryBound(rows: readonly SubscriptionRow[]): string | null {
  const bounds: string[] = [];
  for (const row of rows) {
    if (row.status === SubscriptionStatus.Active && row.endDate !== null) {
      bounds.push(row.endDate);
    }
  }
  if (bounds.length === 0) {
    return null;
  }
  return bounds.toSorted((a, b) => new Date(a).getTime() - new Date(b).getTime())[0];
}

// ---------------------------------------------------------------------------
// Expiry-window badge — relative day math for the row cards

/** One day in milliseconds (the badge's calendar-day unit). */
const MS_PER_DAY = 86_400_000;

/**
 * Whole calendar days from `now` until the period bound — positive while
 * the window is open, 0 on the final day, negative once elapsed. The
 * fractional-day remainder floors away, so "ends in 30 days" stays stable
 * across the day.
 */
export function daysUntil(date: string, now: Date = new Date()): number {
  return Math.floor((new Date(date).getTime() - now.getTime()) / MS_PER_DAY);
}

/** Which copy arm the relative-window badge renders: the open window or the elapsed one. */
export type ExpiryBadgeKind = "upcoming" | "past";

/**
 * Resolves the badge arm for a period bound: the final day (0) still reads
 * as the upcoming "ends today" arm — only a strictly negative count is
 * past.
 */
export function expiryBadgeKind(date: string, now: Date = new Date()): ExpiryBadgeKind {
  return daysUntil(date, now) < 0 ? "past" : "upcoming";
}

// ---------------------------------------------------------------------------
// Per-status action matrix

/** Which lifecycle actions a row's status affords. */
export interface SubscriptionRowActions {
  /** Extend the active window (active rows only). */
  readonly extend: boolean;
  /** Renew into a fresh period (expired rows only). */
  readonly renew: boolean;
  /** Cancel balance-preserving (active rows only). */
  readonly cancel: boolean;
  /** Change plan within the lane (active rows only). */
  readonly changePlan: boolean;
}

const NO_ACTIONS: SubscriptionRowActions = {
  extend: false,
  renew: false,
  cancel: false,
  changePlan: false,
};

const ACTIVE_ACTIONS: SubscriptionRowActions = {
  extend: true,
  renew: false,
  cancel: true,
  changePlan: true,
};

const EXPIRED_ACTIONS: SubscriptionRowActions = {
  extend: false,
  renew: true,
  cancel: false,
  changePlan: false,
};

/**
 * The exhaustive per-status action matrix — active → extend/cancel/
 * change plan; expired → renew; pending/cancelled (and the
 * governance-owned `suspended`) → none.
 */
const ACTIONS_BY_STATUS: Record<SubscriptionStatus, SubscriptionRowActions> = {
  [SubscriptionStatus.Active]: ACTIVE_ACTIONS,
  [SubscriptionStatus.Expired]: EXPIRED_ACTIONS,
  [SubscriptionStatus.Pending]: NO_ACTIONS,
  [SubscriptionStatus.Cancelled]: NO_ACTIONS,
  [SubscriptionStatus.Suspended]: NO_ACTIONS,
};

/** Resolves the action availability for one row's lifecycle status. */
export function actionsForStatus(status: SubscriptionStatus): SubscriptionRowActions {
  return ACTIONS_BY_STATUS[status];
}

// ---------------------------------------------------------------------------
// Plan-facts caption — the row card's plan summary line

/**
 * The plan-facts price display for one row: the exact-decimal wire amount
 * grouped through the shared money formatter (a character-level grouping —
 * the value is never a number, so it stays byte-exact and float-free)
 * followed by the wire currency code verbatim. The counted session/cycle
 * fragments ride the namespace's `planFacts` forms; only the money pair
 * needs this composed seam.
 */
export function planPriceDisplay(price: string, currency: string): string {
  return `${groupDecimalDigits(price)} ${currency}`;
}

// ---------------------------------------------------------------------------
// Extend dialog — days validation (whole days > 0, client-side)

/**
 * The protocol's integer wire limit (the int4 bound the transport layer
 * enforces). A day count above it can never reach the server — the
 * request would die with a protocol-layer English error surfaced inside
 * the dialog instead of the server's localized denial. This is the
 * TRANSPORT bound only: the server's window-ceiling authority is
 * untouched.
 */
const MAX_WIRE_INT32 = 2_147_483_647;

/**
 * Parses the extend-days input into a positive whole day count, or `null`
 * when the input is not a strictly positive integer (0, negatives,
 * decimals, and non-numeric garbage all fail), or when it exceeds the
 * protocol's int4 wire limit (the value could not travel the transport;
 * the server keeps the window-ceiling authority).
 */
export function parseExtendDays(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }
  const days = Number.parseInt(trimmed, 10);
  if (!Number.isSafeInteger(days) || days <= 0 || days > MAX_WIRE_INT32) {
    return null;
  }
  return days;
}

// ---------------------------------------------------------------------------
// Cancel dialog — optional bounded reason

/**
 * Normalizes the optional cancel reason: blank (or whitespace-only)
 * resolves to `null`, otherwise the trimmed value is clamped to the
 * backend's 200-character audit boundary.
 */
export function normalizeCancelReason(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return null;
  }
  return trimmed.slice(0, MAX_CANCEL_REASON_LENGTH);
}

// ---------------------------------------------------------------------------
// Change-plan dialog — same-lane eligibility

/**
 * The change-plan target candidates: ACTIVE plans crediting the SAME
 * balance lane as the source subscription's plan, excluding the source
 * plan itself. Cross-lane migration is out of scope server-side — the
 * selector simply never offers an ineligible plan.
 */
export function eligibleChangePlanTargets(
  plans: readonly AdminPlanItem[],
  sourcePlanId: number,
  sourceLane: AdminPlanItem["balanceLane"]
): AdminPlanItem[] {
  return plans.filter(
    plan =>
      plan.isActive && plan.id !== String(sourcePlanId) && plan.balanceLane !== null && plan.balanceLane === sourceLane
  );
}

// ---------------------------------------------------------------------------
// Copy digest + proration copy — split to the digest module (re-exported so
// the module's import surface, including its test file, stays stable).

export {
  buildSubscriptionDigest,
  prorationCopyKind,
  subscriptionDigestRowLine,
} from "./subscriptionAdmin.helpers.digest";
