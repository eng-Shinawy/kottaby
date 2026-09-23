/**
 * StudentOnboarding flow helpers — the pure builders and pre-write guards
 * behind the admin direct-onboarding service.
 *
 * Runtime code only, ZERO database access: every function is a pure
 * mapping or a validation that throws a typed, localized error so the
 * service can run the full denial ladder BEFORE any transaction opens
 * (zero writes on any denial). Types live in `backend/types/` per the
 * service-layer rules — no `.types.ts` beside this file.
 */

import { PaymentGateway } from "@/backend/enum/billing/payment-gateway.enum";
import type { SubscriptionCreditLane } from "@/backend/enum/billing/subscription-credit-lane.enum";
import { SubscriptionStatus } from "@/backend/enum/billing/subscription-status.enum";
import { toUserRole, UserRole } from "@/backend/enum/users/user-role.enum";
import { ValidationError } from "@/backend/lib/errors";
import { MS_PER_DAY } from "@/backend/services/billing/subscription-admin.helpers";
import type {
  AdminCreateUserSubmitInput,
  AdminOnboardStudentSubmitInput,
  PlanSelectType,
  SubscriptionInsertType,
  UserSelectType,
} from "@/backend/types";
import type { StudentOnboardingLabels } from "@/shared/locale/types/studentOnboarding";

/**
 * The offline payment methods a direct onboarding may record. Mirrors the
 * offline activation subset of the `payment_gateway` pgEnum: gateway-driven
 * members (stripe, paypal, paymob, fawry) belong to the checkout lifecycle
 * and can never settle a direct onboarding, because this flow records an
 * already-collected payment instead of driving a gateway round-trip.
 */
const OFFLINE_PAYMENT_GATEWAYS: ReadonlySet<PaymentGateway> = new Set<PaymentGateway>([
  PaymentGateway.OfflineCash,
  PaymentGateway.BankTransfer,
  PaymentGateway.Scholarship,
]);

/** The `payment_reference` column is `varchar(255)` — the accepted ceiling. */
const PAYMENT_REFERENCE_MAX_LENGTH = 255;

/**
 * Rejects any payment method outside the offline set. The `paymentMethod`
 * arrives typed as the canonical `PaymentGateway` enum, so only the
 * gateway-lifecycle members can reach this guard — a `paymob` (or stripe/
 * paypal/fawry) value is a caller bug the flow refuses pre-write.
 */
export function assertOfflinePaymentMethod(method: PaymentGateway, t: StudentOnboardingLabels["errors"]): void {
  if (!OFFLINE_PAYMENT_GATEWAYS.has(method)) {
    throw new ValidationError(t.methodNotOffline);
  }
}

/**
 * Normalizes the admin-supplied payment reference: trimmed, then rejected
 * when empty or past the column ceiling. The reference is REQUIRED for
 * every accepted method — it is the human idempotency token the partial
 * unique index arbitrates on.
 *
 * @returns The trimmed reference, ready for the subscription insert.
 */
export function normalizePaymentReference(raw: string, t: StudentOnboardingLabels["errors"]): string {
  const reference = raw.trim();
  if (reference.length === 0 || reference.length > PAYMENT_REFERENCE_MAX_LENGTH) {
    throw new ValidationError(t.referenceInvalid);
  }
  return reference;
}

/**
 * A plan row whose lane is verified configured — the narrowing
 * `assertOnboardablePlan` produces, shared with the service so the
 * guarded plan reads type against ONE declaration.
 */
export type OnboardablePlan = PlanSelectType & { balanceLane: Exclude<PlanSelectType["balanceLane"], null> };

/**
 * Validates that a plan row (already resolved — a missing row is the
 * caller's not-found denial) is bindable for a direct onboarding: it must
 * be catalog-active and carry a configured balance lane. A lane-less plan
 * fails closed — the flow never guesses which student balance lane a
 * plan's session count belongs to. The assertion narrows the lane so the
 * caller can resolve the credit-lane enum member without a second check.
 */
export function assertOnboardablePlan(
  plan: PlanSelectType,
  t: StudentOnboardingLabels["errors"]
): asserts plan is OnboardablePlan {
  if (!plan.isActive) {
    throw new ValidationError(t.planInactive);
  }
  if (plan.balanceLane === null) {
    throw new ValidationError(t.planLaneUnconfigured);
  }
}

/**
 * Validates the optional parent association target: the referenced user
 * must carry the parent role and own the `parents` role-child row the
 * link writes against. A parent-role user without the role-child row is
 * corrupt state the flow refuses rather than half-links. A missing user
 * row is the caller's not-found denial, checked before this guard runs.
 */
export function assertLinkableParent(
  parentUser: Pick<UserSelectType, "role">,
  parentsRow: unknown,
  t: StudentOnboardingLabels["errors"]
): void {
  if (toUserRole(parentUser.role) !== UserRole.Parent) {
    throw new ValidationError(t.parentRoleInvalid);
  }
  if (!parentsRow) {
    throw new ValidationError(t.parentsRowMissing);
  }
}

/**
 * Maps the onboarding whitelist onto the shared user-creation input,
 * field-by-field (never a spread): the onboarding surface can only mint a
 * student, so the role is hard-coded here and is structurally unreachable
 * from the caller payload.
 */
export function mapToCreateUserInput(input: AdminOnboardStudentSubmitInput): AdminCreateUserSubmitInput {
  return {
    fullName: input.fullName,
    email: input.email,
    phone: input.phone,
    password: input.password,
    gender: input.gender,
    country: input.country,
    role: UserRole.Student,
  };
}

/**
 * Builds the offline-twin subscription insert: one captured instant
 * governs the window (start = the onboarding moment, end = start + the
 * plan snapshot's interval), the lifecycle state opens `active` (the
 * admin already collected the payment), and the three offline evidence
 * columns carry the admin-recorded payment. Unlike the admin lifecycle
 * settlement insert — which leaves the payment columns null — this flow
 * always records them.
 */
export function buildOnboardSubscriptionInsert(
  studentUserId: number,
  plan: Pick<PlanSelectType, "id" | "intervalDays"> & { balanceLane: SubscriptionCreditLane },
  payment: Pick<AdminOnboardStudentSubmitInput, "paymentMethod" | "paymentReference">,
  now: Date
): SubscriptionInsertType {
  return {
    userId: studentUserId,
    planId: plan.id,
    status: SubscriptionStatus.Active,
    startDate: now,
    endDate: new Date(now.getTime() + plan.intervalDays * MS_PER_DAY),
    paymentMethod: payment.paymentMethod,
    paymentReference: payment.paymentReference,
    paymentVerifiedAt: now,
  };
}

/**
 * Builds the subscription audit row's details payload: ids, enum members,
 * and counts only. The payment reference is the admin-authored evidence
 * token the audit trail exists to preserve; contact fields (email, name,
 * phone) and the initial credential are structurally absent.
 */
export function buildOnboardAuditDetails(input: {
  studentUserId: number;
  planId: number;
  parentId: number | null;
  paymentMethod: PaymentGateway;
  paymentReference: string;
  creditedLane: SubscriptionCreditLane;
  creditedSessions: number;
}): Record<string, unknown> {
  return {
    studentUserId: input.studentUserId,
    planId: input.planId,
    parentId: input.parentId,
    paymentMethod: input.paymentMethod,
    paymentReference: input.paymentReference,
    creditedLane: input.creditedLane,
    creditedSessions: input.creditedSessions,
  };
}
