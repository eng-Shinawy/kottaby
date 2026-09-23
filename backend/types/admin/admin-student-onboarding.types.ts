import type { PaymentGateway } from "@/backend/enum/billing/payment-gateway.enum";
import type { SubscriptionCreditLane } from "@/backend/enum/billing/subscription-credit-lane.enum";
import type { Gender } from "@/backend/enum/users/gender.enum";
import type { AdminUserDetailReturnType } from "@/backend/types/admin/admin-user.types";
import type { SubscriptionReturnType } from "@/backend/types/billing/subscription.types";

/**
 * `AdminOnboardStudentSubmitInput` — closed whitelist for the admin
 * direct-onboarding surface: one call creates the student identity and
 * activates a plan subscription with offline payment evidence. Exactly
 * these ten keys are accepted; any transport-tampered extra field is
 * ignored by explicit field-by-field mapping at the service boundary
 * (BOPLA) — no spread of this shape may ever reach a write path.
 *
 * `role` is deliberately ABSENT: the onboarding flow only ever creates
 * students, so the service hard-codes the student role when it maps this
 * input onto the user-provisioning seam — a client payload structurally
 * cannot mint an admin or teacher through this surface.
 *
 * `gender` is optional; absence means "unset" (mirrors the admin user
 * creation input). `parentId` is optional-and-nullable: omitted or `null`
 * means "onboard unlinked" — a supplied parent id is linked to the new
 * student in the same transaction.
 *
 * `paymentMethod` is typed as the canonical `PaymentGateway` enum so
 * non-enum values die at the boundary; the service further restricts the
 * acceptable members to the offline subset (offline cash, bank transfer,
 * scholarship) — online gateway members are invalid for a flow that never
 * touches a gateway round-trip.
 *
 * `paymentReference` is REQUIRED for every accepted method (trimmed,
 * 1..255 chars): it is the human idempotency token for the offline
 * collection, enforced unique by the partial unique index on
 * `subscriptions.payment_reference` — a second activation reusing the
 * same reference conflicts instead of double-billing.
 */
export interface AdminOnboardStudentSubmitInput {
  readonly fullName: string;
  readonly email: string;
  readonly phone: string;
  readonly password: string;
  readonly gender?: Gender;
  readonly country: string;
  readonly parentId?: number | null;
  readonly planId: number;
  readonly paymentMethod: PaymentGateway;
  readonly paymentReference: string;
}

/**
 * `AdminOnboardStudentReturnType` — what a successful direct onboarding
 * hands back: the freshly provisioned student, the activated offline
 * subscription, and the exact balance credit it settled.
 *
 * Composition-only: `student` and `subscription` reuse the EXISTING
 * canonical read shapes rather than re-declaring them — the student slot
 * is the full admin user detail (with its student snapshot), and the
 * subscription row carries the recorded offline evidence columns
 * (`paymentMethod`, `paymentReference`, `paymentVerifiedAt` are always
 * populated by this flow even though the canonical shape keeps them
 * nullable for gateway-driven rows that exist before payment).
 *
 * `creditedLane`/`creditedSessions` report the plan-lane balance credit
 * applied inside the onboarding transaction (exactly one session count,
 * never prorated), and `handshakeCode` echoes the freshly minted unique
 * handshake code — the same value already embedded in the returned
 * student detail's student snapshot, surfaced flat so the confirming UI
 * does not have to dig through the nested projection.
 */
export interface AdminOnboardStudentReturnType {
  readonly student: AdminUserDetailReturnType;
  readonly subscription: SubscriptionReturnType;
  readonly creditedLane: SubscriptionCreditLane;
  readonly creditedSessions: number;
  readonly handshakeCode: string;
}
