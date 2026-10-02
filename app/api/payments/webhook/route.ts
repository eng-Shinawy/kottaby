/**
 * Payment gateway callback endpoint (`POST /api/payments/webhook`).
 *
 * Server-to-server settlement surface: the active gateway provider calls
 * back after a checkout attempt to report its outcome. The route is a THIN
 * trust-boundary shell — bounding, signature verification, and masking live
 * here; every domain decision belongs to `SubscriptionActivationService`.
 *
 *  - **POST-only** — gateway callbacks arrive as POST; only POST is
 *    exported, so every other verb rides Next.js' own 405.
 *  - **Kill switch fails closed** — unless `PAYMENT_WEBHOOK_ENABLED` is
 *    exactly "true", the surface answers a BARE 404: no envelope, no code,
 *    no requestId. Any structured body would prove THIS path exists and is
 *    special — the existence oracle a disabled deployment must never leak
 *    (a truly unknown path answers no envelope either).
 *  - **Provider dispatch by signature placement** — exactly one receiver
 *    serves every provider, and the delivery's signature location names the
 *    branch: the paymob provider signs EVERY delivery (the server-to-server
 *    processed callback and the customer redirect alike) into the `hmac`
 *    QUERY parameter, while the built-in mock provider signs the
 *    `x-payment-signature` header. A query-signed delivery arriving while
 *    the active provider is not paymob is answered the SAME bare 404 as the
 *    kill switch — the inactive provider's callback surface does not exist,
 *    and no envelope may prove otherwise. The gate runs before a single
 *    body byte is read, and the provider value is re-read per request, so a
 *    mid-flight mode flip is honored on the very next delivery (the mock
 *    branch's own availability is untouched: it keeps its kill-switch
 *    semantics regardless of the paymob gate).
 *  - **Bounded body, read ONCE, bounded THREE ways** — the raw body is
 *    consumed exactly once (the signature is computed over these bytes, so no
 *    re-serialization may occur) and capped at
 *    `MAX_PAYMENT_WEBHOOK_BODY_BYTES` UTF-8 bytes; oversize is rejected
 *    with a masked 400 envelope that never echoes the payload. The size
 *    bound is enforced in two layers: a `Content-Length` header over the cap
 *    is rejected up-front (no body byte is ever buffered), and an
 *    absent/undeclared length is read INCREMENTALLY through the request
 *    stream under a running byte budget that aborts the moment the cap is
 *    crossed — a chunked over-cap delivery can never force a full-body
 *    buffer. Time is bounded at two layers on top: every incremental read
 *    runs under a per-read deadline (`BODY_READ_DEADLINE_MS`, default 30s) —
 *    a delivery that STALLS between chunks has its reader cancelled — and
 *    the ENTIRE read runs under a total delivery deadline
 *    (`BODY_READ_TOTAL_DEADLINE_MS`, default 60s) — a delivery that drips
 *    forever (1 byte per just-under-30s: every gap inside the per-read
 *    budget) is cut off there, so no combination of slow-drip pacing can
 *    hold the connection past the total bound. Both timeouts cancel the
 *    reader and answer the same masked unreadable-body envelope — a slow
 *    POST can never hold the connection for the platform's full request
 *    budget.
 *  - **Signature gates are per-branch** — the mock branch requires the
 *    `x-payment-signature` header to equal the lowercase-hex HMAC-SHA256 of
 *    the raw body under `PAYMENT_WEBHOOK_SECRET`, compared by the
 *    constant-time digest idiom inside `verifyWebhookSignature`. The paymob
 *    branch never passes through that gate: its HMAC-SHA512 verification
 *    (the 20-value query-signed concat, timing-safe compare) lives INSIDE
 *    the active adapter's `parseWebhookEvent`, and the route must neither
 *    bypass nor duplicate it. A missing/empty secret config, a missing
 *    header, and a failed compare all collapse into the SAME masked 401: a
 *    misconfigured deployment is indistinguishable from a forged callback,
 *    and the gate can never be bypassed. The adapter's typed rejections
 *    surface through the shared envelope machinery: a malformed or
 *    hmac-less delivery maps to the masked 400 family, a failed HMAC maps
 *    to the masked 401 (with exactly one correlated domain-error log line —
 *    verification failures are expected rejections, never crash noise), and
 *    an unconfigured gateway maps to the service-unavailable envelope.
 *  - **Envelope** — success `{ data: { processed, replayed? }, requestId }`;
 *    replays ack 200 like first deliveries (gateways retry on non-2xx),
 *    verified-but-unknown references / quarantined mismatches ack
 *    `{ processed: false }` 200, and a verified-but-ignored callback
 *    variant (a delivery type this integration never settles) acks the
 *    same no-op — settlement integrity beats liveness.
 *    Parse rejections, oversize bodies, and a request stream that rejects
 *    mid-read are masked 400-family envelopes; anything thrown is masked
 *    through the shared error machinery with one correlated log line. The
 *    locale is the deployment default ("en") — the
 *    caller is the gateway, not a localized user.
 *
 * NO session context participates: authorization is the signature alone,
 * and only references/outcome enums ever reach logs — never bodies or
 * secrets.
 */

import type { NextRequest } from "next/server";
import { PaymentGateway } from "@/backend/enum/billing/payment-gateway.enum";
import { apiErrorResponse, apiSuccessResponse, resolveRequestId } from "@/backend/lib/api";
import { getPaymentGatewayProvider, getPaymentWebhookSecret, isPaymentWebhookEnabled } from "@/backend/lib/env";
import { DomainError, UnauthorizedError, ValidationError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import { getPaymentGateway, verifyWebhookSignature } from "@/backend/services/billing/payment-gateway";
import { SubscriptionActivationService } from "@/backend/services/billing/subscription-activation.service";

/**
 * The ONE status the error-code taxonomy cannot express: the endpoint-shaped
 * 404 of a disabled callback surface. Deliberately a BARE response (no
 * envelope, no code, no requestId) so a disabled deployment is
 * indistinguishable from any other unknown path.
 */
const ENDPOINT_GONE_STATUS = 404;

/** Hard ceiling for a callback payload, in UTF-8 bytes (not characters). */
const MAX_PAYMENT_WEBHOOK_BODY_BYTES = 64_000;

/**
 * Per-read deadline for the incremental body reader, in milliseconds: a
 * delivery that stalls longer than this between chunks has its reader
 * cancelled and answers the masked unreadable-body envelope — a stalled
 * POST can never hold the connection open indefinitely. Default 30s.
 *
 * This bounds ONE gap between chunks, not the whole delivery — the total
 * time is bounded separately by {@link BODY_READ_TOTAL_DEADLINE_MS} (a
 * compliant drip with every gap inside this budget would otherwise stream
 * forever).
 *
 * Exported as a single-field holder (the canonical test seam): the route
 * suite shortens `current` to exercise the stall path in milliseconds and
 * restores the production default afterwards; no production path writes it.
 */
export const BODY_READ_DEADLINE_MS = { current: 30_000 };

/**
 * Total-delivery deadline for the ENTIRE incremental body read, in
 * milliseconds: the whole bounded read races this timer, so a delivery
 * whose inter-chunk gaps each stay inside the per-read budget but whose
 * TOTAL time is unbounded (the 1-byte-per-29s-forever drip the per-read
 * deadline alone cannot stop) is cut off here — reader cancelled, masked
 * unreadable-body envelope. Must exceed the per-read deadline (it bounds
 * the SUM of many per-read windows plus decode work); default 60s.
 *
 * Exported as a single-field holder (the same canonical test seam as the
 * per-read deadline): the route suite shortens `current` to exercise the
 * total path in milliseconds and restores the production default
 * afterwards; no production path writes it.
 */
export const BODY_READ_TOTAL_DEADLINE_MS = { current: 60_000 };

/** Header the built-in mock provider signs its deliveries with. */
const SIGNATURE_HEADER = "x-payment-signature";

/**
 * Query parameter carrying the paymob callback signature. The provider
 * signs every delivery — the server-to-server processed callback and the
 * customer-facing redirect alike — into the query string, so the
 * parameter's presence is the documented marker that a delivery claims the
 * paymob branch of the provider dispatch; its VALUE is verified only inside
 * the paymob adapter's parser (never here).
 */
const PAYMOB_HMAC_QUERY_PARAM = "hmac";

/** The paymob provider's wire value, held as the plain env string it is compared against. */
const PAYMOB_PROVIDER_VALUE: string = PaymentGateway.Paymob;

/** Locale-free server-to-server surface: envelopes resolve in the deployment default. */
const ENVELOPE_LOCALE = "en";

/**
 * Whether a delivery claims the paymob branch of the dispatch while that
 * provider is not the deployment's active one — the inactive-callback
 * condition the route answers with the endpoint-gone 404: no envelope, no
 * oracle, and not a single body byte read.
 */
function claimsInactivePaymobBranch(query: Record<string, string | undefined>, isPaymobProvider: boolean): boolean {
  return query[PAYMOB_HMAC_QUERY_PARAM] !== undefined && !isPaymobProvider;
}

/**
 * Signature-gate denial — classified to 401 (UNAUTHORIZED family). One
 * shared producer for every deny shape (no secret configured, missing
 * header, failed compare) so the wire never reveals which one fired.
 */
function webhookUnauthorizedError(): DomainError {
  return new DomainError("UNAUTHORIZED", "Invalid payment webhook signature.");
}

/**
 * Oversize-payload rejection — masked 400-class envelope. The code names the
 * transport limit; the message stays generic and never echoes the payload.
 */
function webhookBodyTooLargeError(): DomainError {
  return new ValidationError("PAYMENT_WEBHOOK_BODY_TOO_LARGE", "Webhook payload rejected.");
}

/**
 * Body-read failure — the delivery stream itself rejected mid-read (e.g. the
 * gateway aborted the connection while the body was still streaming).
 * Masked 400-class envelope: the code names the transport failure, the
 * message stays generic, and neither the payload nor the underlying error
 * ever reaches the wire.
 */
function webhookBodyUnreadableError(): DomainError {
  return new ValidationError("PAYMENT_WEBHOOK_BODY_UNREADABLE", "Webhook payload rejected.");
}

/** The stream reader's own read-result type — inferred, never re-declared. */
type BodyChunkRead = Awaited<ReturnType<ReadableStreamDefaultReader<Uint8Array>["read"]>>;

/**
 * One `reader.read()` under the per-read deadline: the read races a timer
 * sized from `BODY_READ_DEADLINE_MS.current`, so a stalled delivery (bytes
 * simply stop arriving) rejects after the deadline instead of hanging on
 * the stream until the platform reaps the request. The timer is a manual
 * `AbortController` + `setTimeout` cleared in `finally` the moment the
 * race settles either way — unlike `AbortSignal.timeout`, whose timer
 * lingers for its full duration after every won read, no handle survives
 * a completed chunk. The reader is cancelled only AFTER the race settled
 * with the rejection — cancelling earlier would resolve the very read
 * being raced (`done: true`) and could let the read leg win with a
 * partial body. From there the deadline rejection propagates to the
 * route's masked unreadable-body envelope (the same F-abort path a
 * mid-stream transport failure rides), with the stalled connection
 * released. `Promise.race` subscribes to both legs immediately, so
 * whichever leg loses is a handled rejection: a deadline firing after an
 * already-won read cannot fire at all (its timer was cleared). A genuine
 * stream rejection is cancelled too (harmless, best-effort) — the
 * connection is released on every failure path.
 */
async function readChunkWithDeadline(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<BodyChunkRead> {
  const abortController = new AbortController();
  const deadline = new Promise<never>((_, reject) => {
    abortController.signal.addEventListener(
      "abort",
      () => reject(new Error("payment webhook body read stalled past the per-read deadline")),
      { once: true }
    );
  });
  const timer = setTimeout(() => abortController.abort(), BODY_READ_DEADLINE_MS.current);
  try {
    return await Promise.race([reader.read(), deadline]);
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    // The timer dies with the race — a won read leaves no lingering handle.
    clearTimeout(timer);
  }
}

/**
 * Reads the request body INCREMENTALLY under the byte cap, the per-read
 * deadline, AND the total-delivery deadline — the DoS-safe counterpart of a
 * plain `request.text()`, which would buffer the whole delivery before any
 * size check could run and hang indefinitely on a delivery that never
 * finishes. Raw chunks accumulate as `Uint8Array`s while a running byte
 * budget aborts the moment the cap is crossed; the abort answer is `null`
 * (indistinguishable to the caller from any other oversize rejection). The
 * aborting read also releases the underlying stream (`reader.cancel()`,
 * best-effort — a cancel rejection, typically the peer already gone, must
 * never mask the oversize denial). The accumulated chunks are joined and
 * UTF-8 decoded ONCE, after the last chunk: no per-chunk string
 * concatenation (an adversarial 1-byte-chunk delivery cannot wedge O(n²)
 * string growth into the reader), and the single decode over the
 * reassembled bytes is exactly the byte-faithful treatment a buffered read
 * applies (multibyte sequences straddling chunk boundaries decode whole). A
 * null stream is an empty body.
 *
 * The read is a sequential pull on a stateful stream reader (each chunk
 * arrives only after the previous read resolves), so it is expressed as the
 * sanctioned recursive helper — one `await` per read step, no loop. Every
 * pull runs through {@link readChunkWithDeadline}: a stalled delivery
 * cannot hold the connection past the per-read deadline. The ENTIRE
 * recursive walk additionally races the total-delivery deadline
 * (`BODY_READ_TOTAL_DEADLINE_MS`): a compliant drip whose every gap is
 * inside the per-read budget would otherwise stream forever, so the whole
 * delivery is bounded too — on timeout the reader is cancelled (the
 * in-flight partial read resolves `done: true` into a race the route has
 * already stopped awaiting) and the rejection propagates to the route's
 * masked unreadable-body envelope. The total timer is a manual
 * `AbortController` + `setTimeout` cleared in `finally` the moment the read
 * settles either way, and a rejection on ANY path (deadline, transport
 * error) cancels the reader best-effort so the connection is released.
 *
 * @returns The decoded body, or `null` when the byte budget was exceeded.
 */
async function readBoundedBody(request: NextRequest): Promise<string | null> {
  const bodyStream = request.body;
  if (bodyStream === null) {
    return "";
  }
  const reader = bodyStream.getReader();

  async function readChunk(chunks: Uint8Array[], totalBytes: number): Promise<string | null> {
    const { done, value } = await readChunkWithDeadline(reader);
    if (done) {
      // The single join + decode releases any multibyte sequence a chunk
      // boundary split.
      return new TextDecoder().decode(joinChunks(chunks, totalBytes));
    }
    const newTotalBytes = totalBytes + value.byteLength;
    if (newTotalBytes > MAX_PAYMENT_WEBHOOK_BODY_BYTES) {
      // Over cap: release the stream so the rejected delivery cannot keep
      // feeding a connection nobody will read. Cancel is best-effort.
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
    return readChunk(chunks, newTotalBytes);
  }

  // The TOTAL delivery deadline: the per-read deadline bounds one gap
  // between chunks, this bounds the SUM. Manual controller + cleared timer
  // (never `AbortSignal.timeout`) so a settled read leaves no lingering
  // handle; the abort listener is `{ once: true }` and the rejection only
  // fires while the race is still pending.
  const totalAbortController = new AbortController();
  const totalDeadline = new Promise<never>((_, reject) => {
    totalAbortController.signal.addEventListener(
      "abort",
      () => reject(new Error("payment webhook body read exceeded the total delivery deadline")),
      { once: true }
    );
  });
  const totalTimer = setTimeout(() => totalAbortController.abort(), BODY_READ_TOTAL_DEADLINE_MS.current);
  try {
    return await Promise.race([readChunk([], 0), totalDeadline]);
  } catch (error) {
    // Deadline or transport failure: release the stream so the rejected
    // delivery cannot keep feeding a connection nobody will finish reading.
    // Cancel is best-effort (an already-cancelled reader resolves).
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    clearTimeout(totalTimer);
  }
}

/** Joins the accumulated raw chunks into ONE buffer — no per-chunk strings. */
function joinChunks(chunks: Uint8Array[], totalBytes: number): Uint8Array {
  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function POST(request: NextRequest): Promise<Response> {
  const requestId = resolveRequestId(request.headers);

  // Kill switch FIRST — a disabled surface is a BARE 404, indistinguishable
  // from any other unknown path (no envelope, no code — see the docblock).
  if (!isPaymentWebhookEnabled()) {
    return new Response(null, { status: ENDPOINT_GONE_STATUS });
  }

  // Provider dispatch — resolved BEFORE the body is read: the delivery's
  // signature placement names the branch. The query record is later handed
  // to the active adapter verbatim; the route itself interprets no payload
  // member beyond this one documented marker. The active provider is a
  // plain env string, so it is compared against the paymob wire value held
  // as the same primitive.
  const query: Record<string, string | undefined> = Object.fromEntries(request.nextUrl.searchParams);
  const isPaymobProvider = getPaymentGatewayProvider() === PAYMOB_PROVIDER_VALUE;

  // Paymob-branch mode gate: a query-signed delivery against a deployment
  // whose active provider is not paymob is a callback surface that does not
  // exist — the SAME bare 404 the kill switch answers, fired before a single
  // body byte is consumed (no oracle, no size-answer, no envelope).
  if (claimsInactivePaymobBranch(query, isPaymobProvider)) {
    return new Response(null, { status: ENDPOINT_GONE_STATUS });
  }

  // The raw body is read EXACTLY once — signatures are computed over these
  // bytes — and bounded BEFORE any crypto work happens: a declared
  // Content-Length over the cap is rejected up-front (no byte buffered),
  // and every other delivery is read incrementally under the byte budget.
  const declaredLength = Number.parseInt(request.headers.get("content-length") ?? "", 10);
  if (Number.isSafeInteger(declaredLength) && declaredLength > MAX_PAYMENT_WEBHOOK_BODY_BYTES) {
    return apiErrorResponse(webhookBodyTooLargeError(), { requestId, locale: ENVELOPE_LOCALE });
  }

  // The bounded read runs under its own mask: a mid-stream transport
  // failure (the gateway aborting the connection) or a deadline breach
  // (per-read stall or total-delivery overrun) rejects the stream read —
  // an expected 400-family rejection, never an uncaught route error. The
  // exact transport breach goes to ONE correlated log line; the envelope
  // carries only the masked denial, never the payload or the raw error.
  let rawBody: string | null;
  try {
    rawBody = await readBoundedBody(request);
  } catch {
    // The raw transport error is deliberately unread — a mid-stream abort's
    // message is untrusted peer/transport material; the correlated log line
    // below carries only the fixed diagnostic + requestId.
    logger.error("Payment webhook body read failed: request stream rejected mid-delivery", {
      code: "PAYMENT_WEBHOOK_BODY_UNREADABLE",
      entity: "payment_webhook",
      requestId,
    });
    return apiErrorResponse(webhookBodyUnreadableError(), { requestId, locale: ENVELOPE_LOCALE });
  }
  if (rawBody === null) {
    return apiErrorResponse(webhookBodyTooLargeError(), { requestId, locale: ENVELOPE_LOCALE });
  }

  // Mock-branch signature gate — fail closed, and ONLY for the mock-style
  // branch: no configured secret, no presented header, and a failed digest
  // compare all land on the same masked 401. A deployment whose active
  // provider is paymob skips this gate entirely — that branch's deliveries
  // are verified by the adapter's parser (the query-signed HMAC), and this
  // route must neither bypass nor duplicate that verification.
  if (!isPaymobProvider) {
    const secret = getPaymentWebhookSecret();
    const presentedSignature = request.headers.get(SIGNATURE_HEADER);
    if (secret === undefined || secret.length === 0 || !verifyWebhookSignature(rawBody, presentedSignature, secret)) {
      return apiErrorResponse(webhookUnauthorizedError(), { requestId, locale: ENVELOPE_LOCALE });
    }
  }

  // Parse through the active gateway port, then delegate settlement. The
  // service never throws for outcome content — unknown references,
  // quarantines, and replays all come back as honest acks — so only true
  // infrastructure failures reach the masked envelope below. A null event
  // is a verified-but-ignored delivery (nothing to settle) — acked like a
  // replay so the provider's retry schedule stops, with zero state change.
  // An unauthorized rejection from the parser gets exactly ONE correlated
  // domain-error log line: a failed verification is an expected rejection
  // (debug-level in test mode, warn in production), never crash noise, and
  // the log carries only the fixed diagnostic and correlation id.
  try {
    const event = getPaymentGateway(ENVELOPE_LOCALE).parseWebhookEvent({ rawBody, query });
    if (event === null) {
      return apiSuccessResponse({ processed: false }, { requestId });
    }
    const result = await SubscriptionActivationService.processWebhookEvent(event, ENVELOPE_LOCALE);
    return apiSuccessResponse(
      { processed: result.processed, ...(result.replayed !== undefined && { replayed: result.replayed }) },
      { requestId }
    );
  } catch (error: unknown) {
    if (error instanceof UnauthorizedError) {
      logger.logDomainError("Payment webhook signature verification failed", {
        code: "PAYMENT_WEBHOOK_SIGNATURE_INVALID",
        entity: "payment_webhook",
        requestId,
      });
    }
    return apiErrorResponse(error, { requestId, locale: ENVELOPE_LOCALE });
  }
}
