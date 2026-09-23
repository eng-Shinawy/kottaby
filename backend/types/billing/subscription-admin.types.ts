import type { AuditActionType } from "@/backend/enum/audit/audit-action-type.enum";
import type { ProrationDirection } from "@/backend/enum/billing/proration-direction.enum";
import type { SubscriptionReturnType } from "@/backend/types/billing/subscription.types";

/**
 * The most recent audit-trail entry for ONE subscription — the admin
 * drawer's per-row trail teaser. `actionType` is the canonical
 * `AuditActionType` member (fail-closed certified from the raw column
 * — an uncertifiable literal surfaces as `null` from the read, never a
 * junk value on the wire) and `at` is the entry's creation instant.
 * A subscription with no recorded history has NO peek (the GraphQL field
 * resolves `null` — the honest empty arm, mirroring the zero count).
 */
export interface SubscriptionAuditTrailPeek {
  readonly actionType: AuditActionType;
  readonly at: Date;
}

/**
 * Result of one admin plan change: the NEW active subscription row plus
 * the proration settlement the change applied. The proration fields feed
 * the response payload's "carried X sessions, forfeited Y" copy without a
 * refetch; `direction` carries the canonical `ProrationDirection` member.
 */
export interface ChangeSubscriptionPlanResult {
  readonly subscription: SubscriptionReturnType;
  readonly direction: ProrationDirection;
  readonly carrySessions: number;
  readonly forfeitedSessions: number;
}

/**
 * Admin extend input: lengthens an active subscription's validity window
 * by a whole number of days. The client supplies only the subscription id
 * and the day count — the new window is computed server-side from the
 * row's stored `endDate`, never from a client-provided target date.
 */
export interface ExtendSubscriptionSubmitInput {
  readonly subscriptionId: number;
  readonly days: number;
}

/**
 * Admin renew input: re-issues an expired subscription into a fresh
 * active period. The new period's plan, interval, and lane credit are
 * all resolved server-side from the source row — the payload carries no
 * plan or scheduling fields by design.
 */
export interface RenewSubscriptionSubmitInput {
  readonly subscriptionId: number;
}

/**
 * Admin cancel input: terminates an active subscription while leaving
 * the student's balance lanes untouched (balance-preserving deny path).
 * The optional reason is free text bounded and trimmed by the service
 * before it reaches the audit trail.
 */
export interface CancelSubscriptionSubmitInput {
  readonly subscriptionId: number;
  readonly reason?: string;
}

/**
 * Admin plan-change input: moves an active subscription onto a different
 * plan in the same balance lane. The prorated carry-over between the two
 * plans' unit values is derived server-side; the payload cannot claim a
 * direction or a session amount.
 */
export interface ChangeSubscriptionPlanSubmitInput {
  readonly subscriptionId: number;
  readonly newPlanId: number;
}

/**
 * Result of converting the student's remaining lane value between the
 * old and new plan's per-session unit prices during a plan change.
 *
 * `direction` is derived server-side from the unit-price comparison and
 * carries the canonical `ProrationDirection` member. An upgrade carries the
 * converted remainder on top of the new plan's full session count; a
 * downgrade credits only the new plan's full session count and reports
 * the discarded remainder as `forfeitedSessions`.
 */
export interface ProrationComputation {
  readonly direction: ProrationDirection;
  readonly carrySessions: number;
  readonly forfeitedSessions: number;
}
