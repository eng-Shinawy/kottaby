import {
  countReportedSessions,
  drainInFlightSessions,
  listAllDemoSessions,
  reportCompletedSessions,
  submitDemoReport,
  walkSequentially,
} from "@/backend/db/seeds/lib";
import { resolveDemoUserId } from "@/backend/db/seeds/users";
import { SubscriptionCreditLane } from "@/backend/enum/billing/subscription-credit-lane.enum";
import { SubscriptionStatus } from "@/backend/enum/billing/subscription-status.enum";
import { SessionIntent } from "@/backend/enum/scheduling/session-intent.enum";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import { ConflictError, ValidationError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import { SessionLifecycleService } from "@/backend/services";
import { PlanCatalogService } from "@/backend/services/billing/plan-catalog.service";
import { SubscriptionActivationService } from "@/backend/services/billing/subscription-activation.service";
import { SubscriptionPurchaseService } from "@/backend/services/billing/subscription-purchase.service";
import { WalletService } from "@/backend/services/billing/wallet.service";
import type { PaymentWebhookEvent } from "@/backend/types";
import type { SubscriptionReturnType } from "@/backend/types/billing/subscription.types";
import type { SessionReturnType } from "@/backend/types/classes/session.types";

/**
 * Result summary for the demo-paid-flow seed step.
 *
 * `confirmationsSettled` counts the demo student's completed hold-marked
 * sessions the step student-confirmed this run (each confirmation credits
 * the teacher's wallet through the production dual-confirmation path).
 * `subscriptionState` reports the demo student's funding posture after the
 * step: `activated` when this run purchased + settled a new subscription,
 * `existing` when one was already active, `recovered` when this run settled
 * a pending pair stranded by an earlier partial run, and `none` when the
 * catalog offers no lane-backed plan or a settlement was quarantined (both
 * soft skips). `paidSessionId` is the subscription-funded booking's id when
 * this run created one, `null` otherwise. `reportedTotal` counts the demo
 * student's completed+reported sessions after reconciliation.
 * `teacherWalletBalance` is the demo teacher's post-reconciliation balance
 * verification read (`null` when the read cannot assemble).
 * `skippedReason` explains a soft skip, never a seed failure.
 */
export interface DemoPaidFlowState {
  confirmationsSettled: number;
  subscriptionState: "activated" | "existing" | "recovered" | "none";
  paidSessionId: number | null;
  paidSessionLane: string | null;
  reportedTotal: number;
  teacherWalletBalance: string | null;
  skippedReason: "no-plan" | "no-funding" | "settlement-quarantined" | null;
}

/** Deterministic idempotency key for the step's subscription purchase — one purchase per demo student, ever. */
function demoPurchaseKey(studentUserId: number): string {
  return `demo-paid-flow-purchase-${studentUserId}`;
}

/** Deterministic idempotency key for the step's subscription-funded booking — one paid booking per demo student, ever. */
function demoPaidBookingKey(studentUserId: number): string {
  return `demo-paid-flow-session-${studentUserId}`;
}

/** Demo marker carried on the simulated gateway settlement so the payment row is traceable. */
const DEMO_PROVIDER_TRANSACTION_ID = "demo-paid-flow-settlement";

/**
 * Session statuses as widened strings — the seeder compares the drizzle
 * row's status union against these, mirroring the services' guard-constant
 * doctrine (no raw enum-to-union comparison).
 */
const COMPLETED_STATUS: string = SessionStatus.Completed;

/** The subscription statuses widened the same way for the owned-subscription scan. */
const ACTIVE_SUBSCRIPTION_STATUS = SubscriptionStatus.Active;
const PENDING_SUBSCRIPTION_STATUS = SubscriptionStatus.Pending;

/**
 * Student-confirms every completed hold-marked demo session that has no
 * student stamp yet. The production confirmation flow is honestly
 * idempotent — an already-confirmed row returns untouched with ZERO
 * financial writes — so the scan's unconfirmed filter is an optimization,
 * not a correctness requirement. Each confirmation credits the teacher's
 * wallet exactly the session's held fee (the dual-confirmation contract).
 */
async function settleConfirmations(studentUserId: number, locale: string): Promise<number> {
  const sessions = await listAllDemoSessions(studentUserId);
  const pending = sessions.filter(
    row => row.status === COMPLETED_STATUS && row.feeHeld === true && row.confirmedByStudentAt === null
  );
  let settled = 0;
  await walkSequentially(pending, async row => {
    await SessionLifecycleService.confirmSessionCompletion(studentUserId, row.id, locale);
    settled += 1;
    logger.info(`Demo confirmation settled: session #${row.id} student-stamped, teacher earning credited`);
  });
  return settled;
}

/**
 * Picks the subscription plan the demo purchase targets: the cheapest
 * active plan backed by the Hifz credit lane (deterministic — price ties
 * break on the lower id). A catalog without a lane-backed plan returns
 * `null` (the purchase arm soft-skips; the plans seed owns the catalog's
 * shape).
 */
async function pickDemoHifzPlan(): Promise<{ id: number; price: string; currency: string } | null> {
  const catalog = await PlanCatalogService.listActiveCatalog();
  const laneBacked = catalog
    .filter(plan => plan.balanceLane === SubscriptionCreditLane.Hifz)
    .toSorted((a, b) => Number(a.price) - Number(b.price) || a.id - b.id);
  const picked = laneBacked.at(0);
  if (picked === undefined) {
    return null;
  }
  return { id: picked.id, price: picked.price, currency: picked.currency };
}

/**
 * Builds the mock gateway's confirmed settlement event for a pending
 * subscription: the stored payment reference echoes back, and the amount
 * re-derives from the plan row the purchase copied it from (the activation
 * service quarantines any disagreement, so the values must match exactly).
 */
async function buildConfirmedSettlement(subscription: SubscriptionReturnType): Promise<PaymentWebhookEvent | null> {
  if (subscription.paymentReference === null) {
    return null;
  }
  const plan = await PlanCatalogService.findById(subscription.planId);
  return {
    reference: subscription.paymentReference,
    outcome: "confirmed",
    amount: plan.price,
    currency: plan.currency,
    providerTransactionId: DEMO_PROVIDER_TRANSACTION_ID,
  };
}

/**
 * Settles ONE pending subscription through the production activation flow
 * (the same entry the webhook route serves). A quarantined settlement
 * (`processed: false`) means the stored ledger disagrees with the rebuilt
 * event — nothing mutated, reported honestly to the caller.
 */
async function settlePendingSubscription(
  pending: SubscriptionReturnType,
  locale: string
): Promise<"settled" | "quarantined"> {
  const event = await buildConfirmedSettlement(pending);
  if (event === null) {
    return "quarantined";
  }
  const result = await SubscriptionActivationService.processWebhookEvent(event, locale);
  return result.processed ? "settled" : "quarantined";
}

/**
 * Guarantees the demo student holds an ACTIVE subscription:
 *  - an active row already present → `existing` (idempotent replay);
 *  - a pending row stranded by a partial earlier run → settled through the
 *    production webhook entry → `recovered`;
 *  - otherwise a fresh purchase through the production purchase flow
 *    (deterministic idempotency key; the built-in mock gateway settles in
 *    development runtimes only, fail-closed everywhere else) followed by
 *    its confirmed settlement → `activated`.
 * `none` means no lane-backed plan exists or a settlement was quarantined —
 * both soft skips, never seed failures.
 */
async function ensureActiveSubscription(
  studentUserId: number,
  locale: string
): Promise<{ state: DemoPaidFlowState["subscriptionState"]; skipped: DemoPaidFlowState["skippedReason"] }> {
  const listOwn = (): Promise<SubscriptionReturnType[]> => SubscriptionPurchaseService.listOwn(studentUserId, locale);

  const existing = await listOwn();
  if (existing.some(row => row.status === ACTIVE_SUBSCRIPTION_STATUS)) {
    return { state: "existing", skipped: null };
  }

  const pending = existing.find(row => row.status === PENDING_SUBSCRIPTION_STATUS);
  if (pending !== undefined) {
    const outcome = await settlePendingSubscription(pending, locale);
    if (outcome === "quarantined") {
      return { state: "none", skipped: "settlement-quarantined" };
    }
    logger.info(`Demo subscription recovered: pending pair ${pending.id} settled through the activation flow`);
    return { state: "recovered", skipped: null };
  }

  const plan = await pickDemoHifzPlan();
  if (plan === null) {
    logger.info("Demo subscription skipped: the active catalog has no Hifz-lane-backed plan");
    return { state: "none", skipped: "no-plan" };
  }

  try {
    await SubscriptionPurchaseService.purchase(
      studentUserId,
      { planId: plan.id },
      demoPurchaseKey(studentUserId),
      locale
    );
  } catch (error) {
    // A concurrent run replaying the same claim key lands here — re-scan;
    // the winner's purchase (or a previously stranded pending pair) is
    // reconciled by the scan below instead of failing the step.
    if (!(error instanceof ConflictError && error.code === "DUPLICATE_REQUEST")) {
      throw error;
    }
    logger.info("Demo subscription purchase replayed concurrently; reconciling the winner's pair instead");
  }

  const after = await listOwn();
  if (after.some(row => row.status === ACTIVE_SUBSCRIPTION_STATUS)) {
    return { state: "existing", skipped: null };
  }
  const stillPending = after.find(row => row.status === PENDING_SUBSCRIPTION_STATUS);
  if (stillPending !== undefined) {
    const outcome = await settlePendingSubscription(stillPending, locale);
    if (outcome === "settled") {
      return { state: "activated", skipped: null };
    }
  }
  return { state: "none", skipped: "settlement-quarantined" };
}

/**
 * Books ONE subscription-funded demo session through the production booking
 * path, then walks the full lifecycle INCLUDING the student's confirmation
 * (the dual-confirmation leg that credits the teacher's wallet) and the
 * report submission with the previous-grades block (it grades the trial
 * session's ungraded homework through the production write-once path; a
 * conflict there retries without grades — the report itself must still
 * land). Soft-skips when the freshly activated lane still cannot cover the
 * hold. A concurrent replay of the deterministic booking key reconciles the
 * winner's lifecycle (drain → confirm → report) instead of failing.
 */
async function bookConfirmAndReportPaidSession(
  studentUserId: number,
  teacherUserId: number,
  locale: string
): Promise<{ sessionId: number | null; lane: string | null; skipped: DemoPaidFlowState["skippedReason"] }> {
  let booked: SessionReturnType;
  try {
    booked = await SessionLifecycleService.createSession(
      studentUserId,
      { teacherId: teacherUserId, intent: SessionIntent.Hifz },
      demoPaidBookingKey(studentUserId),
      locale
    );
  } catch (error) {
    if (error instanceof ValidationError && error.code === "INSUFFICIENT_BALANCE") {
      logger.info("Demo paid booking skipped: the activated subscription lane could not cover the hold");
      return { sessionId: null, lane: null, skipped: "no-funding" };
    }
    if (error instanceof ConflictError && error.code === "DUPLICATE_REQUEST") {
      logger.info("Demo paid booking replayed concurrently; reconciling the winner's lifecycle instead");
      await drainInFlightSessions(studentUserId, teacherUserId, locale);
      await settleConfirmations(studentUserId, locale);
      await reportCompletedSessions(studentUserId, teacherUserId, locale);
      return { sessionId: null, lane: null, skipped: null };
    }
    throw error;
  }

  await SessionLifecycleService.startSession(teacherUserId, booked.id, locale);
  await SessionLifecycleService.completeSession(teacherUserId, booked.id, locale);
  await SessionLifecycleService.confirmSessionCompletion(studentUserId, booked.id, locale);
  await submitDemoReport(teacherUserId, booked.id, locale, true);
  logger.info(`Demo paid session settled: session #${booked.id} confirmed and reported`);
  return { sessionId: booked.id, lane: booked.heldBalanceLane, skipped: null };
}

/**
 * Demo-paid-flow seeder — completes the demo money story for the demo
 * teacher ↔ demo student pair so a freshly seeded sandbox shows REAL
 * financial state out of the box: the teacher's wallet carries a balance
 * with earning ledger rows, the student holds an active subscription, and
 * the parent portal renders a second report (the rating-trend chart gains
 * its second point) with a graded homework row.
 *
 * Reconciliation, in order:
 *  1. Student-confirm every completed hold-marked demo session (the
 *     dual-confirmation leg the plain demo-session-flow step leaves open;
 *     each confirmation credits the teacher's wallet exactly the held fee).
 *  2. Guarantee an ACTIVE Hifz subscription for the demo student —
 *     existing, recovered (settling a pending pair stranded by a partial
 *     run), or freshly purchased + settled through the production purchase
 *     and activation flows.
 *  3. When the pair has fewer than TWO completed+reported sessions, book
 *     one subscription-funded session (the trial lane is 1-session only,
 *     so the debit ladder falls through to the subscription lane), confirm
 *     it as the student, and report it with the previous-grades block.
 *
 * Depends on the demo-session-flow step: the confirm arm reconciles that
 * step's completed trial session, and the booking path denies an
 * uncertified demo teacher — so this step always runs AFTER it in the
 * master controller.
 */
export async function seedOrGet(locale = "en"): Promise<DemoPaidFlowState> {
  const studentUserId = await resolveDemoUserId("student");
  const teacherUserId = await resolveDemoUserId("teacher");

  const confirmationsSettled = await settleConfirmations(studentUserId, locale);

  const subscription = await ensureActiveSubscription(studentUserId, locale);

  let paidSessionId: number | null = null;
  let paidSessionLane: string | null = null;
  let reportedTotal = await countReportedSessions(studentUserId, locale);

  if (subscription.state !== "none" && reportedTotal < 2) {
    const paidArm = await bookConfirmAndReportPaidSession(studentUserId, teacherUserId, locale);
    paidSessionId = paidArm.sessionId;
    paidSessionLane = paidArm.lane;
    reportedTotal = await countReportedSessions(studentUserId, locale);
  }

  let teacherWalletBalance: string | null = null;
  try {
    const walletView = await WalletService.getMyWallet(teacherUserId, locale);
    teacherWalletBalance = walletView.wallet.balance;
  } catch {
    // The demo teacher is certified by the demo-linkage step, so this read
    // cannot miss in a reconciled sandbox; if a partial run ever reaches
    // this step without the teacher profile, the verification read stays
    // null instead of failing the whole seed — the financial arms above
    // already committed what they committed.
    logger.info("Demo paid flow: wallet verification read skipped (teacher wallet not assembled)");
  }

  const bookedLabel = paidSessionId === null ? "none" : String(paidSessionId);
  const laneLabel = paidSessionLane ?? "-";
  const balanceLabel = teacherWalletBalance ?? "-";
  const skippedReason = subscription.skipped;
  const skipLabel = skippedReason === null ? "" : ` skipped=${skippedReason}`;
  logger.info(
    `Demo paid flow: confirmations=${confirmationsSettled} subscription=${subscription.state} paidBooked=${bookedLabel}` +
      ` lane=${laneLabel} reportedTotal=${reportedTotal} teacherBalance=${balanceLabel}${skipLabel}`
  );
  return {
    confirmationsSettled,
    subscriptionState: subscription.state,
    paidSessionId,
    paidSessionLane,
    reportedTotal,
    teacherWalletBalance,
    skippedReason,
  };
}
