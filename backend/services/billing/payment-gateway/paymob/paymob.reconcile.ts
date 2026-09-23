/**
 * Paymob pending-payment reconciliation sweep — the cron-driven backstop
 * that resolves `student_payments` rows stuck `pending` when the callback
 * channel never delivered a settlement. The webhook receiver remains the
 * primary settlement path (including the provider's own callback
 * retrial); this sweep only heals what retrial could not.
 *
 * Gating: the sweep is active only when the active gateway provider is
 * `paymob` AND the server-to-server API key is configured. Anything else
 * is a skip-with-log — never an error — answering a zero-count result: an
 * unconfigured deployment is a normal state, not a fault.
 *
 * Per run: the stale-pending batch is pulled through the repository's
 * gateway finder (pending + this gateway + older than the configured
 * window, oldest first, batch-capped). Each row is resolved
 * independently: a fresh auth token is minted and the order's last
 * transaction is fetched by the row's stored payment reference — the
 * merchant-order key the checkout sent as the intention's special
 * reference. Rows whose transaction is still in flight, or whose last
 * transaction is a reversal/child variant this integration never
 * settles, stay pending for a later sweep — the backstop never
 * terminates an in-flight purchase. A terminal transaction is mapped to
 * the SAME verified-event shape the webhook parser produces and handed
 * to the activation service's webhook entry point, so the guarded
 * decision, lane crediting, provider-reference recording, and
 * notification emission are identical to the callback path — a payment
 * settled by the sweep is indistinguishable from one settled by a
 * delivered callback, replays and quarantines included.
 *
 * Discipline:
 *  - The batch is bounded (hard ceiling per run) and each row's outcome
 *    is logged with its correlation ids only — never the minted token,
 *    the API key, or any upstream payload.
 *  - Auth tokens are minted per inquiry and never cached: the vendor
 *    expires them hourly, so retention would be stale shared state.
 *  - The module holds no state between runs — configuration is
 *    re-resolved per sweep, so a provider or key flip takes effect on
 *    the next run without a restart.
 *  - The inquiry network call happens OUTSIDE any database transaction;
 *    the activation surface opens (and commits) its own settlement
 *    transaction per row. An inquiry unavailability skips its row (the
 *    transport already logged exactly one sanitized line for it) and the
 *    run continues; an error thrown by the activation surface is an
 *    infrastructure breach that aborts the run — the cron caller reports
 *    it and the next run retries from the top of the stale batch.
 */

import { type StalePendingPaymentWithReferenceRow, StudentPaymentRepository } from "@/backend/db/repo";
import { PaymentGateway } from "@/backend/enum/billing/payment-gateway.enum";
import { getPaymentGatewayProvider, getPaymobConfig } from "@/backend/lib/env";
import { logger } from "@/backend/lib/logger";
import {
  type PaymobFetch,
  PaymobHttpClient,
  PaymobUpstreamError,
} from "@/backend/services/billing/payment-gateway/paymob/paymob.http";
import { SubscriptionActivationService } from "@/backend/services/billing/subscription-activation.service";
import type { PaymentWebhookEvent, PaymobResolvedConfig, PaymobTransactionInquiryResult } from "@/backend/types";

/** Hard per-run batch ceiling: one sweep never processes more rows than this. */
const MAX_BATCH_ROWS = 50;

/**
 * Locale handed to the activation surface — the same deployment default
 * the webhook receiver passes, keeping the sweep's handoff identical to
 * the callback path (the notification copy itself is composed in the
 * recipient's persisted locale inside the settlement transaction).
 */
const HANDOFF_LOCALE = "en";

/** One minute in milliseconds — the stale-window unit. */
const MINUTE_MS = 60_000;

/**
 * The provider selector as a plain string — the env getter answers the
 * raw (trimmed, lowercased) string, and widening the enum member keeps
 * the comparison string-to-string.
 */
const PAYMOB_PROVIDER_VALUE: string = PaymentGateway.Paymob;

/** Per-run sweep tally — every checked row lands in exactly one bucket. */
export interface PaymobReconcileResult {
  /** Rows pulled into this run's bounded batch. */
  readonly checked: number;
  /** Rows whose terminal inquiry said paid AND whose handoff applied. */
  readonly confirmed: number;
  /** Rows whose terminal inquiry said unpaid AND whose handoff applied. */
  readonly failed: number;
  /**
   * Every other row: no stored payment reference, inquiry unavailable,
   * transaction still in flight, reversal/child variant, or an activation
   * surface that refused the handoff (it mutated nothing; its own log
   * lines carry the reason). The payment stays pending for a later run.
   */
  readonly skipped: number;
}

/** Sweep invocation inputs: the clock, an optional batch bound, and the transport seam. */
export interface PaymobReconcileDeps {
  /** The instant the stale window is computed against. */
  readonly now: Date;
  /**
   * Row cap for this run. Defaults to the per-run ceiling and is clamped
   * to it, so one invocation can never widen the batch beyond the bound.
   */
  readonly batchLimit?: number;
  /** Fetch-like transport seam (tests inject a recorder); production rides the platform fetch. */
  readonly fetch?: PaymobFetch;
}

/** One row's disposition: applied (either outcome) or left pending for a later run. */
type ReconcileRowOutcome = "confirmed" | "failed" | "skipped";

/**
 * Runs one bounded reconciliation sweep over the stale pending payments.
 * Never throws for provider unavailability or gateway-outcome content —
 * those are per-row skips or the zero-count gate; only an infrastructure
 * breach inside the activation surface propagates (see the module
 * docblock).
 */
export async function reconcilePendingPaymobPayments(deps: PaymobReconcileDeps): Promise<PaymobReconcileResult> {
  const config = getPaymobConfig();
  if (getPaymentGatewayProvider() !== PAYMOB_PROVIDER_VALUE || config.apiKey === null) {
    // Unconfigured is a normal state, not a fault: one informational
    // line, zero work, zero counts.
    logger.info("Paymob reconciliation sweep skipped: gateway not configured", {
      provider: getPaymentGatewayProvider(),
      apiKeyConfigured: config.apiKey !== null,
    });
    return { checked: 0, confirmed: 0, failed: 0, skipped: 0 };
  }

  const client = new PaymobHttpClient({ config: resolveInquiryConfig(config, config.apiKey), fetch: deps.fetch });
  const olderThan = new Date(deps.now.getTime() - config.reconcilePendingMinutes * MINUTE_MS);
  const batchLimit = Math.max(0, Math.min(deps.batchLimit ?? MAX_BATCH_ROWS, MAX_BATCH_ROWS));
  const rows = await StudentPaymentRepository.findStalePendingByGateway(PaymentGateway.Paymob, olderThan, batchLimit);

  const tally = await reconcileRowsSequentially(rows, client, 0);
  logger.info("Paymob reconciliation sweep completed", { ...tally });
  return tally;
}

/**
 * Walks the bounded batch head-first — the sequential-by-design shape the
 * codebase's other sweeps use: one row settles completely before the next
 * is touched, so a mid-batch abort leaves a clean processed prefix.
 */
async function reconcileRowsSequentially(
  rows: readonly StalePendingPaymentWithReferenceRow[],
  client: PaymobHttpClient,
  index: number
): Promise<PaymobReconcileResult> {
  if (index >= rows.length) {
    return { checked: rows.length, confirmed: 0, failed: 0, skipped: 0 };
  }
  const outcome = await reconcileOneRow(rows[index], client);
  const rest = await reconcileRowsSequentially(rows, client, index + 1);
  return {
    checked: rows.length,
    confirmed: rest.confirmed + (outcome === "confirmed" ? 1 : 0),
    failed: rest.failed + (outcome === "failed" ? 1 : 0),
    skipped: rest.skipped + (outcome === "skipped" ? 1 : 0),
  };
}

/**
 * Resolves one stale row. Terminal transactions are handed to the
 * activation surface's webhook entry point; everything else stays pending
 * with the reason logged. A provider-unavailability rejection skips ONLY
 * its own row — any other error is an infrastructure breach that
 * propagates and aborts the run.
 */
async function reconcileOneRow(
  row: StalePendingPaymentWithReferenceRow,
  client: PaymobHttpClient
): Promise<ReconcileRowOutcome> {
  if (row.paymentReference === null) {
    // No merchant-order key on record to inquire by — the row stays
    // pending; operator follow-up owns the correlation.
    logRowOutcome(row, "skipped", "no payment reference on record");
    return "skipped";
  }

  let inquiry: PaymobTransactionInquiryResult;
  try {
    inquiry = await client.transactionInquiryByMerchantRef(row.paymentReference);
  } catch (error) {
    if (!(error instanceof PaymobUpstreamError)) {
      throw error;
    }
    // The transport already logged exactly one sanitized line (endpoint +
    // status) for this failure. The row stays pending — the next sweep
    // retries the inquiry — and the rest of the batch is unaffected.
    logRowOutcome(row, "skipped", "inquiry unavailable");
    return "skipped";
  }

  if (inquiry.is_refund || inquiry.is_void || inquiry.has_parent_transaction) {
    // The order's last transaction is a reversal (or a child of one) —
    // the same verified-then-ignored variants the webhook dispatch never
    // settles. The sweep must not terminate a purchase on a variant it
    // cannot arbitrate.
    logRowOutcome(row, "skipped", "reversal or child transaction variant");
    return "skipped";
  }
  if (inquiry.pending) {
    // Still in flight at the provider — the sweep is a backstop, not an
    // early terminator; a retried callback or a later sweep settles it.
    logRowOutcome(row, "skipped", "transaction still in flight");
    return "skipped";
  }

  const event = inquiryResultToEvent(row.paymentReference, inquiry);
  const handoff = await SubscriptionActivationService.processWebhookEvent(event, HANDOFF_LOCALE);
  if (!handoff.processed) {
    // The activation surface refused the handoff (unknown reference,
    // settlement quarantine, …) and mutated nothing — its own log lines
    // carry the reason; the row stays pending.
    logRowOutcome(row, "skipped", "activation surface refused the handoff");
    return "skipped";
  }
  logRowOutcome(row, event.outcome, handoff.replayed === true ? "replay of an earlier delivery" : undefined);
  return event.outcome;
}

/**
 * Maps one terminal inquiry result to the verified-event shape the
 * webhook parser produces — the handoff is identity-preserving, so the
 * activation surface cannot tell a sweep-resolved payment from a
 * callback-resolved one. The reference is the ROW's stored payment
 * reference (the key the inquiry was addressed by), never the vendor's
 * echo of it; the amount is the provider's cents as a two-fraction-digit
 * decimal string; the transaction id rides as its string form and is
 * recorded on the payment row inside the guarded decision.
 */
function inquiryResultToEvent(paymentReference: string, inquiry: PaymobTransactionInquiryResult): PaymentWebhookEvent {
  return {
    reference: paymentReference,
    outcome: inquiry.success ? "confirmed" : "failed",
    amount: (inquiry.amount_cents / 100).toFixed(2),
    currency: inquiry.currency,
    providerTransactionId: String(inquiry.id),
  };
}

/**
 * One per-row outcome line: correlation ids and disposition only — the
 * minted token, the API key, and upstream payload material never appear.
 */
function logRowOutcome(row: StalePendingPaymentWithReferenceRow, outcome: ReconcileRowOutcome, detail?: string): void {
  logger.info("Paymob reconciliation row", {
    paymentId: row.id,
    reference: row.paymentReference,
    outcome,
    ...(detail !== undefined && { detail }),
  });
}

/**
 * Narrows the typed environment snapshot into the inquiry client's
 * resolved configuration. The reconciliation path consumes exactly three
 * members — the API key (token minting), the API base host, and the
 * per-attempt timeout — and its gate is the API key ALONE, not the full
 * checkout configuration: a deployment may legitimately run the sweep
 * while checkout credentials are still being provisioned. The
 * checkout-only members therefore ride as resolved-or-inert values the
 * inquiry path never reads — the transport sends only the API key on
 * this path, pinned by the suite's wire assertions.
 */
function resolveInquiryConfig(snapshot: ReturnType<typeof getPaymobConfig>, apiKey: string): PaymobResolvedConfig {
  return {
    apiKey,
    apiBaseUrl: snapshot.apiBaseUrl,
    checkoutBaseUrl: snapshot.checkoutBaseUrl,
    httpTimeoutMs: snapshot.httpTimeoutMs,
    secretKey: snapshot.secretKey ?? "",
    publicKey: snapshot.publicKey ?? "",
    hmacSecret: snapshot.hmacSecret ?? "",
    integrationIdCard: snapshot.integrationIdCard ?? 0,
    integrationIdWallet: snapshot.integrationIdWallet,
  };
}
