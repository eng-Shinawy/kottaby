/**
 * SubscriptionActivationService — the webhook-facing activation flow for
 * subscription purchases.
 *
 * The route layer (transport) hands this service an ALREADY-VERIFIED
 * `PaymentWebhookEvent` (signature + size + parse happen upstream); the
 * service owns the settlement decision and every side effect. The flow is a
 * fixed sequence of fail-closed stages:
 *
 *   1. reference correlation — a non-transactional read finds the
 *      subscription by its gateway `paymentReference`. An unknown reference
 *      mutates NOTHING, logs one bounded warning (never an error storm) and
 *      answers `{ processed: false }` so the gateway can stop retrying;
 *   2. settlement quarantine — the stored payment row's amount/currency are
 *      compared with the event's claimed values. Any disagreement mutates
 *      NOTHING and logs one `logger.error` carrying correlation ids only
 *      (never raw payloads, never financial values): settlement integrity
 *      beats liveness;
 *   3. `confirmed` — ONE transaction decides: the payment row's status is
 *      read first for PATH SELECTION ONLY (every state change below is
 *      decided by a guarded UPDATE that re-verifies the predicate itself —
 *      the guards are the arbiter, never the pre-read). `failed` → the
 *      delivery is REJECTED and logged (a decided payment is terminal — no
 *      silent upgrade); `paid` → idempotent replay; `pending` → the
 *      activation sequence: the plan row is re-read in-transaction (a NULL
 *      balance lane QUARANTINES the delivery — an admin can clear a plan's
 *      lane after the purchase commits — nothing mutated, one correlated
 *      error log, `{ processed: false }`), `activatePendingOnce` flips the
 *      subscription (zero rows ⇒ replay: NO credit, NO second
 *      notification), `markPaidOnce` decides the payment — recording the
 *      event's provider transaction reference in the SAME guarded
 *      statement when one is present (the one-time NULL → value allowance
 *      the immutability trigger admits, so the auditable provider link is
 *      written exactly when the decision is) — and the credit follows the
 *      purchaser's owner row: a `students` row is credited the full
 *      `sessionCount` on the plan's lane, an `applicants` row (a
 *      verification purchase) skips the lane credit intentionally — the
 *      purchased session grant is enforced by the booking flow off the
 *      active subscription — and neither row fails the unit closed, before
 *      the `payment_confirmation` notification is persisted in the SAME
 *      transaction — its copy composed in the RECIPIENT's persisted locale
 *      (the users row's `locale`, falling back to `defaultLocale` when the
 *      user never chose one — the session-request-notification convention).
 *      The realtime fan-out publishes strictly AFTER the
 *      transaction commits — a publish failure never rolls back the
 *      committed activation (the persisted inbox row remains authoritative);
 *      a legacy plan row past the interval-days activation ceiling
 *      (`MAX_INTERVAL_DAYS`) or past the session-count credit ceiling
 *      (`MAX_SESSION_COUNT`) quarantines identically to the NULL lane —
 *      the Date window arithmetic must never run on an out-of-range value,
 *      and an over-ceiling credit would overflow the lane's int4 balance.
 *   4. `failed` — ONE transaction decides: the guarded `markFailedOnce`
 *      write (with the same one-time provider-reference recording when the
 *      event carries one) and, when it decided the payment, the FAILURE
 *      notification is persisted in the SAME transaction — the same
 *      `payment_confirmation` kind, subscription pointer, recipient-locale
 *      composition, and idempotency-key treatment as the confirmed copy;
 *      only the title/body copy differs (the failure copy names the
 *      attempted plan and the not-activated outcome). The subscription row
 *      is untouched (it stays `pending` for operator follow-up) and no
 *      credit runs. Zero rows ⇒ the payment was already decided — an
 *      idempotent replay ack with NO second notification.
 *
 * Notification copy is composed in the RECIPIENT's persisted locale, not
 * the caller-supplied one: the webhook is server-to-server (no session, no
 * per-request locale), so the per-recipient resolution is this flow's own
 * obligation — the in-transaction users read supplies the recipient's
 * stored `locale`, falling back to `defaultLocale` when the user row
 * carries none (the session-request-notification convention). The
 * caller-supplied locale remains the log/error attribution locale. The
 * emit carries the idempotency key `payment:<providerTransactionId>:confirmation`
 * whenever the verified event carries a provider transaction reference —
 * a belt-and-braces dedupe layered on the PRIMARY arbiter, which stays the
 * guarded transition itself: the zero-row guard guarantees the emit (and
 * the credit) run exactly once per payment. Events without a provider
 * reference (the mock adapter's deliveries) stay keyless — the guard
 * alone owns their dedupe.
 *
 * `outerTx` is the canonical test-path seam (a caller-owned transaction runs
 * the flow as a SAVEPOINT on it); production callers omit it and the flow
 * opens its own transaction. When supplied, it ALSO carries the two
 * pre-transaction reads and the failed-path decision write, so the whole
 * delivery participates in the caller's transaction instead of escaping to
 * the pool.
 *
 * `options` (optional) overrides the notification-engine call options for
 * BOTH the in-transaction emit and the post-commit publish. The production
 * default resolves the process-shared idempotency claim cache from the
 * configured environment; with no cache configured the engine degrades
 * fail-open (one structured warn per keyed emission) — a keyed domain
 * event is never blocked on cache health, and the guarded transition
 * remains the exactly-once arbiter either way.
 */

import { PlanRepository, StudentPaymentRepository, SubscriptionRepository, UserRepository } from "@/backend/db/repo";
import { PaymentStatus } from "@/backend/enum/billing/payment-status.enum";
import { NotificationType } from "@/backend/enum/notifications/notification-type.enum";
import { withTransaction } from "@/backend/lib/db/with-transaction";
import { ConflictError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import { MAX_INTERVAL_DAYS, MAX_SESSION_COUNT } from "@/backend/services/billing/plan-catalog.helpers";
import { applyActivationCredit } from "@/backend/services/billing/subscription-activation-credit.helpers";
import { NotificationEngine, type NotificationEngineCallOptions } from "@/backend/services/notifications";
import { resolveBroadcastClaimCache } from "@/backend/services/notifications/redis-claim-cache";
import type {
  DBTransaction,
  NotificationDeliveryReceipt,
  NotificationEmitInput,
  PaymentWebhookEvent,
  PlanSelectType,
  StudentPaymentSelectType,
  SubscriptionSelectType,
} from "@/backend/types";
import { defaultLocale } from "@/shared/locale/AppLocale";
import { getServerTranslations } from "@/shared/locale/server-graphql";

/** Milliseconds per day — the activation window arithmetic (`intervalDays`). */
const MS_PER_DAY = 86_400_000;

/**
 * Client-safe copy for the activation flow's internal-invariant conflicts.
 * These conflicts are unreachable through the write guards; the DIAGNOSTIC
 * detail belongs to the adjacent correlated log line — never to the webhook
 * caller's error envelope, which the gateway (not an operator) reads.
 */
const PAYMENT_PROCESSING_CONFLICT_MESSAGE = "Payment could not be processed.";

/**
 * Fail-closed abort for an unreachable mid-activation state — one bounded
 * diagnostic log (the exact breach, correlated ids only) plus the client-safe
 * conflict copy. Throwing from here rolls the whole activation unit back.
 */
function abortActivation(detail: string, context: Record<string, unknown>): never {
  logger.error(`Subscription activation aborted: ${detail} — unit rolled back`, context);
  throw new ConflictError(PAYMENT_PROCESSING_CONFLICT_MESSAGE);
}

/**
 * Reads the plan row that feeds BOTH the activation window (`intervalDays`)
 * and the credit (`balanceLane`, `sessionCount`). The FK restrict guarantees
 * the row exists — a vanished row fails the unit closed — and a catalog
 * deactivation after a settled payment does not void the activation. Two
 * REACHABLE row states QUARANTINE the delivery with the identical posture —
 * one correlated `logger.error`, nothing mutated, and a `null` return that
 * tells the caller to end the unit with `{ processed: false }` (the gateway
 * stops retrying; operator follow-up owns the settled charge):
 *
 *  - a NULL balance lane (an admin can clear a plan's lane after the
 *    purchase commits — a lane is never guessed from plan copy);
 *  - an `intervalDays` past the activation-window ceiling
 *    (`MAX_INTERVAL_DAYS` — catalog writes are capped there, but the DB
 *    check only enforces `> 0`, so a legacy/non-app row maintained past the
 *    ceiling is insertable and would overflow the Date window arithmetic
 *    into an Invalid Date: a non-domain error and a 500 retry storm);
 *  - a `sessionCount` past the credit ceiling (`MAX_SESSION_COUNT` — the
 *    catalog caps its writes at the same constant, but the DB check only
 *    enforces `> 0`, so an over-ceiling row would credit an amount the
 *    lane's int4 balance column cannot safely absorb at this step).
 *
 * @returns The lane-configured, in-range plan row, or `null` when the plan's
 *     balance lane is unconfigured, its interval exceeds the activation
 *     window ceiling, or its session count exceeds the credit ceiling — and
 *     the delivery must quarantine.
 */
async function readActivationPlan(
  subscription: SubscriptionSelectType,
  reference: string,
  tx: DBTransaction
): Promise<(PlanSelectType & { balanceLane: Exclude<PlanSelectType["balanceLane"], null> }) | null> {
  const plan = await PlanRepository.findById(subscription.planId, tx);
  if (plan === null) {
    abortActivation("plan row vanished mid-activation", {
      reference,
      subscriptionId: subscription.id,
      planId: subscription.planId,
    });
  }
  if (plan.balanceLane === null) {
    logger.error("Payment webhook quarantined: plan balance lane is not configured — nothing mutated", {
      reference,
      subscriptionId: subscription.id,
      planId: subscription.planId,
    });
    return null;
  }
  // The interval-days ceiling re-guard — BEFORE the caller's Date window
  // arithmetic (see the docblock for why a legacy row can sit past the
  // catalog ceiling). Same quarantine posture as the NULL lane above.
  if (plan.intervalDays > MAX_INTERVAL_DAYS) {
    logger.error(
      "Payment webhook quarantined: plan interval days exceeds the activation-window ceiling — nothing mutated",
      {
        reference,
        subscriptionId: subscription.id,
        planId: subscription.planId,
        intervalDays: plan.intervalDays,
      }
    );
    return null;
  }
  // The session-count ceiling re-guard — the credit step multiplies nothing
  // but still adds the full sessionCount onto the lane's int4 balance, so an
  // over-ceiling legacy row (the DB check only enforces `> 0`) must be
  // refused BEFORE any write. Same quarantine posture as the siblings above.
  if (plan.sessionCount > MAX_SESSION_COUNT) {
    logger.error("Payment webhook quarantined: plan session count exceeds the credit ceiling — nothing mutated", {
      reference,
      subscriptionId: subscription.id,
      planId: subscription.planId,
      sessionCount: plan.sessionCount,
    });
    return null;
  }
  // The spread re-asserts the narrowed lane on the returned row shape.
  return { ...plan, balanceLane: plan.balanceLane };
}

/**
 * The payment-status vocabulary, widened to plain strings: the stored row's
 * `status` is the raw pg-enum string union, so the path-selection comparisons
 * test the enum member's string identity — the vocabulary still flows from
 * the enum, never from a bare literal.
 */
const PAYMENT_PAID: string = PaymentStatus.Paid;
const PAYMENT_FAILED: string = PaymentStatus.Failed;

/**
 * What a decision-path transaction resolved to: a terminal non-processing
 * answer, an idempotent replay ack, or the unpublished delivery receipt of a
 * freshly committed decision (confirmed activation or failed decision).
 */
type SettlementTxOutcome =
  | { readonly processed: false }
  | { readonly processed: true; readonly replayed: true }
  | { readonly receipt: NotificationDeliveryReceipt };

/**
 * The payment-event notification idempotency key —
 * `payment:<providerTransactionId>:confirmation`, composed from the
 * verified event's provider transaction reference. An event without one
 * yields `undefined`: that emit stays keyless and the guarded transition
 * alone owns the dedupe. One key shape serves BOTH outcomes — a payment is
 * decided exactly once, so the confirmation and failure notifications for
 * the same provider transaction can never collide.
 */
function paymentConfirmationKeyOf(providerTransactionId: string | undefined): string | undefined {
  return providerTransactionId === undefined ? undefined : `payment:${providerTransactionId}:confirmation`;
}

/** One outcome's payment-event copy pair (title + body). */
type PaymentCopyPair = { readonly title: string; readonly body: string };

/**
 * Diagnostic for the unreachable engine receipt-contract breach — the
 * client-safe conflict copy the abort throws is the sibling constant above.
 */
const ENGINE_RECEIPT_BREACH_DETAIL =
  "notification engine returned a row where the caller-tx receipt contract requires a receipt";

/**
 * The shared persist-first notification emitter for BOTH decision paths:
 * resolves the RECIPIENT's persisted locale in-transaction (the webhook is
 * server-to-server, so the per-recipient resolution is this flow's own
 * obligation — stored locale or the default), composes the outcome's copy
 * pair in it (the confirmed and the failed copy differ; the notification
 * kind, the subscription pointer, the recipient, and the idempotency-key
 * treatment are identical), and emits on the caller's transaction. The emit
 * carries the `payment:<providerTransactionId>:confirmation` idempotency
 * key whenever the verified event carried a provider reference — a
 * belt-and-braces dedupe layered on the PRIMARY arbiter (the zero-row guard
 * guarantees one emit and one credit per payment). The engine's caller-tx
 * contract always returns the receipt; a bare row would be an engine
 * breach.
 */
async function emitPaymentNotificationForRecipient(
  subscription: SubscriptionSelectType,
  planTitle: string,
  event: PaymentWebhookEvent,
  tx: DBTransaction,
  options?: NotificationEngineCallOptions
): Promise<NotificationDeliveryReceipt> {
  const recipientLocale = (await UserRepository.findById(subscription.userId, tx))?.locale ?? defaultLocale;
  const t = getServerTranslations(recipientLocale).notificationsTranslations;
  const copy: PaymentCopyPair =
    event.outcome === "confirmed"
      ? { title: t.eventPaymentConfirmedTitle, body: t.eventPaymentConfirmedBody(planTitle) }
      : { title: t.eventPaymentFailedTitle, body: t.eventPaymentFailedBody(planTitle) };
  const emitInput: NotificationEmitInput = {
    userId: subscription.userId,
    type: NotificationType.PaymentConfirmation,
    title: copy.title,
    body: copy.body,
    relatedEntityType: "subscription",
    relatedEntityId: subscription.id,
    idempotencyKey: paymentConfirmationKeyOf(event.providerTransactionId),
  };

  const emitted = await NotificationEngine.emitForUser(emitInput, recipientLocale, tx, options);
  if (!("notifications" in emitted)) {
    abortActivation(ENGINE_RECEIPT_BREACH_DETAIL, { subscriptionId: subscription.id, userId: subscription.userId });
  }
  return emitted;
}

/**
 * The confirmed-delivery transaction body — fixed write order
 * (path-selection read → plan read + lane quarantine → guarded activation →
 * guarded payment decision (with the provider-reference recording) →
 * purchaser-owner credit decision → in-tx notification persist), executed
 * on the caller's transaction. Any failure rolls the whole unit back: the
 * subscription stays pending and the gateway's retry re-classifies against
 * the settled state. The unconfigured-lane quarantine is the one
 * mutation-free early exit: no write precedes the plan read, so the unit
 * ends with `{ processed: false }` and nothing committed.
 */
async function settleConfirmedDelivery(
  subscription: SubscriptionSelectType,
  payment: StudentPaymentSelectType,
  event: PaymentWebhookEvent,
  locale: string,
  tx: DBTransaction,
  options?: NotificationEngineCallOptions
): Promise<SettlementTxOutcome> {
  // Path selection ONLY — this read decides which guarded path MAY run;
  // the guarded updates below re-verify the state server-side, so a
  // concurrent decision writer can never be overridden by a stale read.
  const current = await StudentPaymentRepository.findBySubscriptionId(subscription.id, tx);
  if (current === null) {
    // The append-only ledger makes a vanished row unreachable — fail
    // closed rather than act on a broken contract.
    abortActivation("subscription has no payment ledger row mid-activation", {
      reference: event.reference,
      subscriptionId: subscription.id,
    });
  }
  if (current.status === PAYMENT_FAILED) {
    // Late `confirmed` after `failed` — replay-incompatible, no silent
    // upgrade: the failed decision is terminal, so the delivery is
    // rejected with zero mutations and one bounded log.
    logger.logDomainError("Payment webhook rejected: confirmed delivery arrived after the payment failed", {
      code: "PAYMENT_REPLAY_INCOMPATIBLE",
      entity: "student_payments",
      entityId: payment.id,
      reference: event.reference,
      outcome: "confirmed",
      locale,
    });
    return { processed: false };
  }
  if (current.status === PAYMENT_PAID) {
    // Already decided paid — the earlier delivery won: idempotent replay.
    return { processed: true, replayed: true };
  }

  // The plan row feeds BOTH the activation window and the credit — the
  // dedicated read-and-guard helper fails closed on the unreachable
  // states and quarantines (`null`) on the reachable ones: an unconfigured
  // lane, or a legacy row past the interval-days activation ceiling.
  const plan = await readActivationPlan(subscription, event.reference, tx);
  if (plan === null) {
    // The quarantine: zero writes have run in this unit (the two reads
    // above are its only statements), so returning here commits nothing —
    // the transaction ends mutation-free (the sibling quarantine posture)
    // and the gateway receives the honest `{ processed: false }` ack while
    // operator follow-up owns the settled charge until the plan row is
    // repaired (lane re-configured / interval corrected).
    return { processed: false };
  }

  // The atomic pending → active transition — the guarded UPDATE is the
  // arbiter. Zero rows ⇒ an already-activated replay under today's writer
  // set (the activation predicate is this status's only writer so far):
  // NO credit, NO second notification. When a non-activation status
  // writer (suspension/cancellation/expiry) lands, revisit this branch to
  // distinguish replay from terminal-state suppression.
  const now = new Date();
  const activated = await SubscriptionRepository.activatePendingOnce(
    subscription.id,
    {
      startDate: now,
      // The read helper's MAX_INTERVAL_DAYS guard keeps this window
      // arithmetic inside Date's valid range (catalog writes are capped
      // at the same ceiling); out-of-range legacy rows never reach it.
      endDate: new Date(now.getTime() + plan.intervalDays * MS_PER_DAY),
      paymentVerifiedAt: now,
    },
    tx
  );
  if (activated === null) {
    return { processed: true, replayed: true };
  }

  // The payment decision — same transaction, same guard discipline. The
  // verified event's provider transaction reference rides the SAME guarded
  // statement (the immutability trigger's one-time NULL → value
  // allowance), so the auditable provider link is recorded exactly when
  // the decision is and never after the fact. Zero rows here would mean
  // the subscription flipped while its pending decision disappeared;
  // rolling back keeps the pair consistent (never active without paid)
  // and the retry re-classifies.
  const decided = await StudentPaymentRepository.markPaidOnce(subscription.id, tx, event.providerTransactionId);
  if (decided === null) {
    // Zero rows here means the pair state broke mid-flight — fail closed.
    abortActivation("pending payment decision wrote zero rows mid-activation", {
      reference: event.reference,
      subscriptionId: subscription.id,
    });
  }

  // The purchaser-owner credit decision — classified by the PERSISTED
  // payment owner (the ledger row's student_id): the student owner is
  // credited, the verification purchase (NULL owner) skips the credit, and
  // a corrupted pair fails closed.
  await applyActivationCredit(subscription, payment, plan, event.reference, tx);

  // Persist-first notification — the row commits with the activation; the
  // copy is the confirmed pair composed in the recipient's locale.
  return { receipt: await emitPaymentNotificationForRecipient(subscription, plan.title, event, tx, options) };
}

/**
 * The confirmed-delivery path — runs the settlement body inside ONE
 * transaction and publishes the receipt strictly post-commit: a publish
 * failure never rolls back the committed activation (the persisted inbox
 * row remains authoritative).
 */
async function confirmPayment(
  subscription: SubscriptionSelectType,
  payment: StudentPaymentSelectType,
  event: PaymentWebhookEvent,
  locale: string,
  outerTx?: DBTransaction,
  options?: NotificationEngineCallOptions
): Promise<{ processed: boolean; replayed?: boolean }> {
  const composed: SettlementTxOutcome = await withTransaction(outerTx, tx =>
    settleConfirmedDelivery(subscription, payment, event, locale, tx, options)
  );

  if ("receipt" in composed) {
    await NotificationEngine.publishReceipts([composed.receipt], locale, options);
    return { processed: true };
  }
  return composed;
}

/**
 * The failed-delivery path — one transaction decides: the guarded
 * `markFailedOnce` write (recording the verified event's provider
 * transaction reference in the same statement when one is present — the
 * same one-time NULL → value allowance as the paid writer) and, when the
 * write decided the payment, the FAILURE notification is persisted in the
 * SAME transaction (the recipient's persisted locale, the same
 * subscription pointer, the same idempotency-key treatment as the
 * confirmed copy; only the title/body copy differs). The subscription row
 * is untouched (it stays pending for operator follow-up) and no credit
 * runs. Zero rows ⇒ the payment was already decided — an idempotent replay
 * ack with no second notification.
 */
async function failPayment(
  subscription: SubscriptionSelectType,
  event: PaymentWebhookEvent,
  locale: string,
  outerTx?: DBTransaction,
  options?: NotificationEngineCallOptions
): Promise<{ processed: boolean; replayed?: boolean }> {
  const composed: SettlementTxOutcome = await withTransaction(outerTx, async tx => {
    const decided = await StudentPaymentRepository.markFailedOnce(subscription.id, tx, event.providerTransactionId);
    if (decided === null) {
      // Zero rows ⇒ the payment was already decided (replay or late
      // delivery): ack as replay so the gateway stops retrying a settled
      // outcome — no second notification.
      return { processed: true, replayed: true };
    }

    // The plan title feeds the failure copy. The FK restrict guarantees
    // the row exists — a vanished row fails the unit closed (the sibling
    // confirmed-path posture); the lane/ceiling guards are NOT re-run here:
    // no activation, no credit, and no Date arithmetic depends on them.
    const plan = await PlanRepository.findById(subscription.planId, tx);
    if (plan === null) {
      abortActivation("plan row vanished before the failure notification", {
        reference: event.reference,
        subscriptionId: subscription.id,
        planId: subscription.planId,
      });
    }

    // Persist-first failure notification — the copy is the failed pair
    // composed in the recipient's persisted locale.
    return { receipt: await emitPaymentNotificationForRecipient(subscription, plan.title, event, tx, options) };
  });

  if ("receipt" in composed) {
    // The unit committed — now (and only now) push, exactly like the
    // confirmed path: a publish failure degrades to one structured log
    // while the persisted inbox row (and the failed decision) stay
    // authoritative.
    await NotificationEngine.publishReceipts([composed.receipt], locale, options);
    return { processed: true };
  }
  return composed;
}

export namespace SubscriptionActivationService {
  /**
   * Processes one ALREADY-VERIFIED payment webhook event and classifies the
   * delivery. Never throws for gateway-outcome content: unknown references,
   * settlement quarantines, replay-incompatible deliveries, an unconfigured
   * plan balance lane, or a legacy plan row past the interval-days activation
   * ceiling answer `{ processed: false }` with zero mutations.
   *
   * The NULL-lane path is REACHABLE — unlike the vanished-row breaches, no
   * write guard prevents an admin from clearing a plan's balance lane after
   * the purchase has committed — so it does NOT throw: it rides the same
   * quarantine channel as the settlement mismatches. The quarantine
   * channel: nothing is mutated (no write precedes the plan read, so the
   * transaction unit ends empty), ONE `logger.error` carries the
   * correlation ids (reference, subscriptionId, planId — never financial
   * values), and the honest `{ processed: false }` ack lets the gateway
   * stop retrying while operator follow-up owns the settled charge until
   * the lane is re-configured. Only true infrastructural invariant breaches
   * (rows the FK restrict makes unremovable) surface as errors and roll the
   * activation unit back.
   *
   * Return contract:
   *  - `{ processed: true }` — the delivery was applied: confirmed ⇒ the
   *    activation committed (credit + notification persisted, publish
   *    post-commit); failed ⇒ the payment decision committed (+ failure
   *    notification persisted, publish post-commit).
   *  - `{ processed: true, replayed: true }` — the delivery was ALREADY
   *    applied by an earlier delivery: zero new rows, zero double credit,
   *    no second notification (either outcome).
   *  - `{ processed: false }` — the delivery was NOT applied and mutated
   *    nothing: unknown reference, settlement quarantine, an unconfigured
   *    plan balance lane at activation time, a legacy plan row whose
   *    `intervalDays` exceeds the activation-window ceiling or whose
   *    `sessionCount` exceeds the credit ceiling, or a `confirmed`
   *    arriving after the payment failed (replay-incompatible).
   *
   * @param event  The verified gateway event (the transport already checked
   *     signature, size, and envelope — the service trusts the payload
   *     shape). A carried `providerTransactionId` is recorded on the payment
   *     row inside the guarded decision and keys the payment notification.
   * @param locale  Active locale for the error-message attribution and the
   *     post-commit publish; the notification COPY is composed in the
   *     recipient's persisted locale (resolved in-transaction).
   * @param outerTx  Optional caller-owned transaction (test path): the flow
   *     runs as a SAVEPOINT on it. Production callers omit it.
   * @param options  Optional notification-engine call override (the claim
   *     cache / fanout transport seam). Production callers omit it and the
   *     environment-resolved claim cache is used; the engine degrades
   *     fail-open when none is configured.
   */
  export async function processWebhookEvent(
    event: PaymentWebhookEvent,
    locale: string,
    outerTx?: DBTransaction,
    options?: NotificationEngineCallOptions
  ): Promise<{ processed: boolean; replayed?: boolean }> {
    // The notification-engine options for this delivery — an explicit
    // override (the caller's seam), else the environment-resolved claim
    // cache (fail-open degradation when none is configured).
    const engineOptions = options ?? { cache: resolveBroadcastClaimCache() };

    // Stage 1 — reference correlation: the gateway reference is the only
    // lookup key; an unknown one mutates nothing. (Production: a bare
    // pool read. Test path: the caller's transaction.)
    const subscription = await SubscriptionRepository.findByPaymentReference(event.reference, outerTx);
    if (subscription === null) {
      logger.logDomainError("Payment webhook: unknown payment reference — nothing mutated", {
        code: "PAYMENT_REFERENCE_UNKNOWN",
        entity: "subscriptions",
        reference: event.reference,
        outcome: event.outcome,
        locale,
      });
      return { processed: false };
    }

    // Stage 2 — settlement quarantine: the stored ledger row is the source
    // of truth for what was purchased. A missing row, or an amount/currency
    // disagreement with the event, mutates NOTHING and logs correlation ids
    // only (never raw payloads, never financial values).
    const payment = await StudentPaymentRepository.findBySubscriptionId(subscription.id, outerTx);
    if (payment === null) {
      logger.error("Payment webhook quarantined: subscription has no payment ledger row — nothing mutated", {
        reference: event.reference,
        outcome: event.outcome,
        subscriptionId: subscription.id,
      });
      return { processed: false };
    }
    if (payment.amount !== event.amount || payment.currency !== event.currency) {
      logger.error("Payment webhook quarantined: settlement data disagrees with the stored payment — nothing mutated", {
        reference: event.reference,
        outcome: event.outcome,
        subscriptionId: subscription.id,
        paymentId: payment.id,
      });
      return { processed: false };
    }

    if (event.outcome === "confirmed") {
      return confirmPayment(subscription, payment, event, locale, outerTx, engineOptions);
    }
    return failPayment(subscription, event, locale, outerTx, engineOptions);
  }
}
