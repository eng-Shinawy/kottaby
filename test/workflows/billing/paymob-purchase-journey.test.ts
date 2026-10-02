/**
 * Cross-actor journey — student purchase through the real Paymob provider
 * branch → verified signed callback → activation workflow.
 *
 * Sequential, actor-attributed steps executed against the REAL services on
 * the REAL test database (later steps observe the shared state earlier
 * steps committed):
 *
 *   1. Student A purchases a plan with the paymob provider active → the
 *      intention is created over the provider's HTTP boundary (the only
 *      mocked hop) and ONE pending pair (subscription + payment) + junction
 *      row + verbatim-keyed claim commit, with the hosted-checkout
 *      descriptor surfaced.
 *   2. The signed settlement callback is delivered through the resolved
 *      callback channel (the factory's development default — no per-test
 *      tunnel logic) into the REAL webhook receiver → payment `paid` with
 *      the provider's transaction reference recorded, subscription
 *      `active` (endDate − startDate = intervalDays exactly), the plan's
 *      balance lane credited the full sessionCount, ONE payment-confirmation
 *      notification persisted, and the receipt published strictly
 *      post-commit — addressed to Student A ONLY.
 *   3. The SAME signed callback is re-delivered (byte-identical replay) →
 *      the receiver acks 200, the guarded transition answers a replay, and
 *      NOTHING moves again: no double credit, no second notification, no
 *      second publish, decided rows untouched.
 *   4. A delivery signed under the wrong secret is masked at the receiver
 *      with 401 BEFORE any parsing — zero state change.
 *   5. A body tampered after signing (flipped `success` flag, stale
 *      signature) is masked with 401 — zero state change.
 *   6. Student A purchases again and the provider fails the payment →
 *      `pending→failed` with the provider reference recorded, subscription
 *      stays pending, zero credit, and the FAILURE notification is
 *      persisted + published to Student A.
 *   7. Student B purchases (own key, own plan) and its own reference is
 *      delivered → B's payment settles and B's lane credits — while
 *      Student A's decided rows stay byte-identical and A's inbox does not
 *      grow (no cross-user fan-out).
 *   8. A verified-signature callback for Student A's pending pair carrying
 *      a DIFFERENT plan's amount is quarantined by the settlement check →
 *      ack `{ processed: false }`, Student A stays pending, zero credit,
 *      one bounded quarantine log.
 *
 * Journey rules honored (`test/workflows/AGENTS.md`):
 * - fixtures COMMITTED in `beforeAll` inside ONE committing transaction;
 *   never `runInRollback` (the services spawn their own top-level
 *   transactions);
 * - honest actors: real `users` rows + real role-child rows via the
 *   actor-context factory; every settlement flows through the REAL
 *   receiver gate and the REAL activation service — nothing monkey-patched;
 * - the provider's outbound HTTP is mocked at the ONE fetch boundary the
 *   gateway transport resolves to in production (the platform fetch the
 *   client's default transport delegates to); every other hop — signature
 *   gate, parse, guarded transition, credit, notification persist — runs
 *   the production code path;
 * - external effects intercepted at the notification boundary: the
 *   post-commit publish seam is SPIED (the activation service publishes
 *   post-commit through this exact namespace-bound seam; it exposes no
 *   injected-transport parameter);
 * - error assertions through typed route envelopes / logged codes — never
 *   `.rejects.toThrow()`;
 * - per-run `jrn_billing_<8hex>` prefix on every fixture name and
 *   idempotency key (the provider echoes the key back as the merchant
 *   order reference, so the prefix also isolates references per run);
 * - cross-actor visibility asserted BOTH directions plus denial probes.
 *
 * Immutable-ledger residue policy: `student_payments` rows are append-only
 * (BEFORE DELETE trigger) and a decided payment can never be edited or
 * removed through the guarded surface — but the rows ARE deletable under
 * the sanctioned teardown suspension (`withImmutabilityTriggersSuspended`),
 * which is exactly what `afterAll` does FIRST, followed by the junction
 * sweep, then the remaining legs via `TrackedFixtures` (reverse
 * registration order). Teardown must leave ZERO residue: every registered
 * row is re-probed after the sweep, and a leaking `afterAll` fails the
 * suite loudly.
 */

import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";
// Value import (NOT type-only): NextRequest is CONSTRUCTED below — the
// type-only form detonates at runtime, as the webhook route suite documents.
import { NextRequest } from "next/server";
import { POST } from "@/app/api/payments/webhook/route";
import { db } from "@/backend/db";
import { plans } from "@/backend/db/schema/billing/plans";
import { studentPayments } from "@/backend/db/schema/billing/student-payments";
import { studentSubscriptions } from "@/backend/db/schema/billing/student-subscriptions";
import { subscriptionPurchaseIdempotency } from "@/backend/db/schema/billing/subscription-purchase-idempotency";
import { subscriptions } from "@/backend/db/schema/billing/subscriptions";
import { notifications } from "@/backend/db/schema/notifications";
import { students } from "@/backend/db/schema/students/students";
import { users } from "@/backend/db/schema/users/users";
import { createTestPlan } from "@/backend/db/test/entity-setup";
import { PaymentGateway } from "@/backend/enum/billing/payment-gateway.enum";
import { PaymentStatus } from "@/backend/enum/billing/payment-status.enum";
import { SubscriptionCreditLane } from "@/backend/enum/billing/subscription-credit-lane.enum";
import { SubscriptionStatus } from "@/backend/enum/billing/subscription-status.enum";
import { NotificationType } from "@/backend/enum/notifications/notification-type.enum";
import { logger } from "@/backend/lib/logger";
import {
  getCallbackChannel,
  resetCallbackChannel,
} from "@/backend/services/billing/payment-gateway/callback-channel/callback-channel.factory";
import { buildSimulatedProcessedCallback } from "@/backend/services/billing/payment-gateway/callback-channel/simulation-callback-channel.channel";
import { resetPaymentGateway } from "@/backend/services/billing/payment-gateway/payment-gateway.factory";
import { SubscriptionPurchaseService } from "@/backend/services/billing/subscription-purchase.service";
import { NotificationEngine } from "@/backend/services/notifications";
import type { DBTransaction, PlanSelectType } from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import { withImmutabilityTriggersSuspended } from "@/test/helpers/db-cleanup";
import { journeyPrefix, provisionStudentActor, TrackedFixtures } from "@/test/workflows/helpers";

// ─── Harness state ───────────────────────────────────────────────────────────

/** Per-run unique prefix — every fixture name, plan title, and idempotency key. */
const PREFIX = journeyPrefix("billing");

/** Notification copy — the confirmation wave composes in the RECIPIENT's persisted locale. */
const NOTIFS_EN = getServerTranslations("en").notificationsTranslations;

/** Milliseconds per day — the activation window arithmetic. */
const MS_PER_DAY = 86_400_000;

/** Session counts / windows of the two journey plans (the credit amounts under test). */
const PLAN_A_SESSION_COUNT = 7;
const PLAN_A_INTERVAL_DAYS = 30;
const PLAN_A_PRICE = "200.00";
const PLAN_B_SESSION_COUNT = 5;
const PLAN_B_INTERVAL_DAYS = 14;
const PLAN_B_PRICE = "150.00";

/** Provider credentials the journey's env fixture installs (test-local, never real). */
const PAYMOB_HMAC_SECRET = `${PREFIX}-paymob-hmac-secret`;
const PAYMOB_SECRET_KEY = `${PREFIX}-paymob-secret-key`;
const PAYMOB_PUBLIC_KEY = `${PREFIX}-paymob-public-key`;
const PAYMOB_API_KEY = `${PREFIX}-paymob-api-key`;

/** The provider's default API host the outbound transport resolves to. */
const PAYMOB_API_BASE = "https://accept.paymob.com";

/** Every env key the journey varies — saved before setup, restored in afterAll. */
const ENV_KEYS = [
  "PAYMENT_WEBHOOK_ENABLED",
  "PAYMENT_GATEWAY_PROVIDER",
  "PAYMOB_SECRET_KEY",
  "PAYMOB_PUBLIC_KEY",
  "PAYMOB_HMAC_SECRET",
  "PAYMOB_API_KEY",
  "PAYMOB_INTEGRATION_ID_CARD",
  "NGROK_PORT",
  "NGROK_AUTHTOKEN",
  "NGROK_DOMAIN",
] as const;

const savedEnv: Record<string, string | undefined> = {};
for (const key of ENV_KEYS) {
  savedEnv[key] = process.env[key];
}

const tracked = new TrackedFixtures();

/** Idempotency keys — one per purchase leg, ≤128 chars, unique per run. */
const KEY_PURCHASE_A = `${PREFIX}-key-purchase-a`;
const KEY_FAILURE_A = `${PREFIX}-key-failure-a`;
const KEY_MISMATCH_A = `${PREFIX}-key-mismatch-a`;
const KEY_PURCHASE_B = `${PREFIX}-key-purchase-b`;

/** Ledger rows created by the services during the journey (teardown worklist). */
const ledgerPaymentIds: number[] = [];
const ledgerSubscriptionIds: number[] = [];

/** One recorded outbound provider request (url + headers + body). */
interface RecordedProviderRequest {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: string;
}

const providerRequests: RecordedProviderRequest[] = [];

/** The original platform fetch — loopback channel deliveries pass through to it. */
const realFetch = globalThis.fetch.bind(globalThis);

/**
 * A recording fetch that satisfies the full platform fetch type — the
 * outbound provider HTTP boundary, the ONE mocked hop. The gateway
 * transport's default production delegate is the platform fetch, so spying
 * `globalThis.fetch` intercepts exactly the provider's intention call; the
 * call body records that request and serves the validated response, while
 * loopback callback-channel deliveries (http://localhost:…) pass through
 * to the real fetch so they traverse a real socket into the REAL receiver.
 * The `preconnect` member delegates to the real fetch — the provider HTTP
 * client never calls it, and the full type keeps the spy a REAL dependency,
 * not a partial double. Restored in `afterAll`.
 */
function recordingFetch(input: string | URL | Request, init?: BunFetchRequestInit): Promise<Response> {
  const url = resolveRequestUrl(input);
  if (url.startsWith(PAYMOB_API_BASE)) {
    const headerBag: Record<string, string> = {};
    const initBag: Record<string, unknown> = { ...init };
    const initHeaders: unknown = initBag.headers;
    if (isPlainJsonObject(initHeaders)) {
      for (const [key, value] of Object.entries(initHeaders)) {
        if (typeof value === "string") {
          headerBag[key] = value;
        }
      }
    }
    const rawBody: unknown = initBag.body;
    const body = typeof rawBody === "string" ? rawBody : "";
    providerRequests.push({ url, headers: headerBag, body });
    return Promise.resolve(
      new Response(JSON.stringify(intentionResponse({ url, headers: headerBag, body })), { status: 201 })
    );
  }
  return realFetch(input, init);
}
recordingFetch.preconnect = (url: string | URL) => globalThis.fetch.preconnect(url);

const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(recordingFetch);

/**
 * A valid intention response body — the members the transport validates.
 * The vendor echoes the merchant's `special_reference` and the intention
 * detail verbatim, so the mocked response carries the recorded request's
 * correlation key and the requested amount/currency (the provider sees the
 * same values the purchase service sends; a divergent echo is the mapper's
 * mismatched-echo rejection, pinned in the adapter suite).
 */
function intentionResponse(request: RecordedProviderRequest): Record<string, unknown> {
  const body: unknown = JSON.parse(request.body);
  const echoed = isPlainJsonObject(body) ? body : {};
  const echoedReference = typeof echoed.special_reference === "string" ? echoed.special_reference : "";
  const echoedAmount = typeof echoed.amount === "number" ? echoed.amount : 0;
  const echoedCurrency = typeof echoed.currency === "string" ? echoed.currency : "";
  return {
    id: `intention-${PREFIX}`,
    intention_order_id: 4242,
    client_secret: `client-secret-${PREFIX}`,
    special_reference: echoedReference,
    status: "unpaid",
    confirmed: false,
    intention_detail: { amount: echoedAmount, currency: echoedCurrency },
    created: "2099-01-01T00:00:00.000000",
    object: "intention.object",
  };
}

/**
 * The in-process callback receiver — answers the channel's readiness probe
 * on its health surface and dispatches every signed POST into the REAL
 * webhook route handler, so a delivered callback traverses the exact wire
 * shape a provider delivery takes (signature in the query, raw body bytes,
 * bounded read) through the production gate → parse → settlement path.
 * Shut down in `afterAll`.
 */
const receiverServer = Bun.serve({
  port: 0,
  fetch: async request => {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/api/health") {
      return new Response(null, { status: 200 });
    }
    if (request.method === "POST" && url.pathname === "/api/payments/webhook") {
      const rawBody = await request.text();
      return POST(
        new NextRequest(request.url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: rawBody,
        })
      );
    }
    return new Response(null, { status: 404 });
  },
});

/** The post-commit publish spy — installed over the engine's publish boundary. */
const publishSpy = spyOn(NotificationEngine, "publishReceipts").mockImplementation(async () => {});

let studentA: JourneyActorRow;
let studentB: JourneyActorRow;
let planA: PlanSelectType;
let planB: PlanSelectType;

/** A journey cast member: the actor bundle plus its committed user row. */
interface JourneyActorRow {
  readonly userId: number;
  readonly email: string;
}

// ─── Read-back oracles ───────────────────────────────────────────────────────

/** Committed pending-set counters for one user (the purchase oracle). */
async function pendingSetCounts(studentUserId: number): Promise<{
  subs: number;
  payments: number;
  junction: number;
  claims: number;
}> {
  const [subs, payments, junction, claims] = await Promise.all([
    db.$count(subscriptions, eq(subscriptions.userId, studentUserId)),
    db.$count(studentPayments, eq(studentPayments.studentId, studentUserId)),
    db.$count(studentSubscriptions, eq(studentSubscriptions.studentId, studentUserId)),
    db.$count(subscriptionPurchaseIdempotency, eq(subscriptionPurchaseIdempotency.userId, studentUserId)),
  ]);
  return { subs, payments, junction, claims };
}

/** Reads one student's live balance lanes. */
async function readBalances(studentUserId: number): Promise<StudentBalance> {
  const rows = await db.select().from(students).where(eq(students.id, studentUserId)).limit(1);
  const row = rows[0];
  if (!row) {
    throw new Error("readBalances: student fixture row vanished");
  }
  return { hifz: row.balanceHifz, tajweed: row.balanceTajweed };
}

/** The student balance lanes this journey asserts on (nullable columns). */
interface StudentBalance {
  readonly hifz: number | null;
  readonly tajweed: number | null;
}

/** Independent read-back oracle — direct Drizzle count on the inbox. */
async function inboxCount(userId: number): Promise<number> {
  return db.$count(notifications, eq(notifications.userId, userId));
}

/** Reads the notifications of one inbox by subscription pointer. */
async function notificationsForSubscription(subscriptionId: number) {
  return db.select().from(notifications).where(eq(notifications.relatedEntityId, subscriptionId));
}

/** Reads one payment ledger row by id, failing when absent. */
async function paymentRow(paymentId: number) {
  const rows = await db.select().from(studentPayments).where(eq(studentPayments.id, paymentId)).limit(1);
  const row = rows[0];
  if (!row) {
    throw new Error(`payment ledger row ${paymentId} vanished`);
  }
  return row;
}

/** Reads one subscription row by id, failing when absent. */
async function subscriptionRow(subscriptionId: number) {
  const rows = await db.select().from(subscriptions).where(eq(subscriptions.id, subscriptionId)).limit(1);
  const row = rows[0];
  if (!row) {
    throw new Error(`subscription row ${subscriptionId} vanished`);
  }
  return row;
}

/** Reads one idempotency claim by key, failing on any other shape. */
async function claimRowsFor(idempotencyKey: string) {
  return db
    .select()
    .from(subscriptionPurchaseIdempotency)
    .where(eq(subscriptionPurchaseIdempotency.idempotencyKey, idempotencyKey));
}

// ─── Callback-channel + receiver harness ─────────────────────────────────────

/** The synthesized signed callback body for one delivery's settlement args. */
function expectedProviderTransactionId(reference: string, amount: string, outcome: "confirmed" | "failed"): string {
  const { body } = buildSimulatedProcessedCallback({ reference, outcome, amount, currency: "EGP" }, PAYMOB_HMAC_SECRET);
  return String(body.obj.id);
}

/** Narrows an unknown parsed body to a plain JSON object. */
function isPlainJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Resolves the URL one fetch input carries, across every input shape. */
function resolveRequestUrl(input: string | URL | Request): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  return input.url;
}

/** Reads and narrows a route response body to its JSON envelope. */
async function readJsonEnvelope(response: Response): Promise<Record<string, unknown>> {
  const parsed: unknown = await response.json();
  if (!isPlainJsonObject(parsed)) {
    throw new Error(`route response was not a JSON object: status ${response.status}`);
  }
  return parsed;
}

/** Narrows one envelope member to a plain object. */
function memberRecord(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  const candidate: unknown = parent[key];
  if (!isPlainJsonObject(candidate)) {
    throw new Error(`envelope member "${key}" was not a JSON object`);
  }
  return candidate;
}

/** Delivers one settlement through the resolved callback channel. */
async function deliverCallback(reference: string, outcome: "confirmed" | "failed", amount: string): Promise<void> {
  const channel = await getCallbackChannel();
  const deliver = channel.deliverTestCallback;
  if (!deliver) {
    throw new Error("expected the resolved callback channel to expose the development delivery surface");
  }
  await deliver.call(channel, { reference, outcome, amount, currency: "EGP" });
}

/** Reads the masked denial code out of a 4xx route envelope. */
function maskedCodeOf(envelope: Record<string, unknown>): string {
  const error = memberRecord(envelope, "error");
  const code: unknown = error.code;
  if (typeof code !== "string") {
    throw new Error("masked denial envelope carried no code");
  }
  return code;
}

// ─── Fixture provisioning ────────────────────────────────────────────────────

/**
 * Provisions one student cast member through the actor-context factory and
 * re-reads the committed row for the billing-identity assertion (the
 * activation composes the notification copy in the RECIPIENT's persisted
 * locale — set explicitly so the copy assertions pin the EN bundle).
 */
async function provisionStudent(tx: DBTransaction): Promise<JourneyActorRow> {
  const actor = await provisionStudentActor(tx, { tracked });
  await tx.update(users).set({ locale: "en" }).where(eq(users.id, actor.userId));
  const rows = await tx.select().from(users).where(eq(users.id, actor.userId)).limit(1);
  const row = rows[0];
  if (!row) {
    throw new Error("journey fixture: student user row vanished inside the provisioning transaction");
  }
  return { userId: actor.userId, email: row.email };
}

beforeAll(async () => {
  // Environment: enabled webhook receiver + the paymob provider active with
  // a full test-local config; tunnel keys deliberately ABSENT so the
  // factory resolves its development-default channel (never a per-test
  // tunnel decision).
  process.env.PAYMENT_WEBHOOK_ENABLED = "true";
  process.env.PAYMENT_GATEWAY_PROVIDER = PaymentGateway.Paymob;
  process.env.PAYMOB_SECRET_KEY = PAYMOB_SECRET_KEY;
  process.env.PAYMOB_PUBLIC_KEY = PAYMOB_PUBLIC_KEY;
  process.env.PAYMOB_HMAC_SECRET = PAYMOB_HMAC_SECRET;
  process.env.PAYMOB_API_KEY = PAYMOB_API_KEY;
  process.env.PAYMOB_INTEGRATION_ID_CARD = "46511";
  delete process.env.NGROK_AUTHTOKEN;
  delete process.env.NGROK_DOMAIN;
  // The dev-server port the channel reads — the in-process receiver's
  // assigned port, so loopback deliveries land on the REAL route handler.
  process.env.NGROK_PORT = String(receiverServer.port);
  // Both factories re-read configuration from scratch.
  resetPaymentGateway();
  resetCallbackChannel();

  // ONE committing transaction: commit-or-nothing fixture provisioning.
  await db.transaction(async tx => {
    studentA = await provisionStudent(tx);
    studentB = await provisionStudent(tx);

    planA = await createTestPlan(tx, {
      title: `${PREFIX} plan a`,
      sessionCount: PLAN_A_SESSION_COUNT,
      price: PLAN_A_PRICE,
      currency: "EGP",
      intervalDays: PLAN_A_INTERVAL_DAYS,
      balanceLane: SubscriptionCreditLane.Hifz,
    });
    tracked.register(plans, planA.id);

    planB = await createTestPlan(tx, {
      title: `${PREFIX} plan b`,
      sessionCount: PLAN_B_SESSION_COUNT,
      price: PLAN_B_PRICE,
      currency: "EGP",
      intervalDays: PLAN_B_INTERVAL_DAYS,
      balanceLane: SubscriptionCreditLane.Tajweed,
    });
    tracked.register(plans, planB.id);
  });

  // The channel resolves ONCE through the factory (its development default
  // against the in-process receiver); the readiness probe proves the
  // loopback delivery path answers before any callback is delivered.
  const channel = await getCallbackChannel();
  expect(channel.kind).toBe("simulation");
  expect(channel.publicBaseUrl).toBe(`http://localhost:${receiverServer.port}`);
  await channel.ensureReady();
});

afterAll(async () => {
  fetchSpy.mockRestore();
  publishSpy.mockRestore();
  receiverServer.stop(true).then(
    () => undefined,
    () => undefined
  );

  // Immutable-ledger teardown leg FIRST: the append-only trigger blocks a
  // plain DELETE, so the sanctioned suspension wraps exactly this leg.
  if (ledgerPaymentIds.length > 0) {
    await withImmutabilityTriggersSuspended(["student_payments"], () =>
      db.delete(studentPayments).where(inArray(studentPayments.id, ledgerPaymentIds))
    );
  }
  // Junction rows (composite PK — no registry entry; swept by subscription
  // id and re-probed here, ahead of the tracked sweep that deletes cast rows).
  if (ledgerSubscriptionIds.length > 0) {
    await db.delete(studentSubscriptions).where(inArray(studentSubscriptions.subscriptionId, ledgerSubscriptionIds));
    const junctionResidue = await db.$count(
      studentSubscriptions,
      inArray(studentSubscriptions.subscriptionId, ledgerSubscriptionIds)
    );
    if (junctionResidue !== 0) {
      throw new Error(`journey teardown: ${junctionResidue} junction row(s) survived deletion`);
    }
  }
  // Reverse-registration-order hard delete + zero-residue re-probes for
  // EVERY tracked row (claims → payments → subscriptions → plans → cast rows).
  await tracked.cleanup();

  for (const key of ENV_KEYS) {
    const value = savedEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  resetPaymentGateway();
  resetCallbackChannel();
});

// ─── The journey ─────────────────────────────────────────────────────────────

describe("cross-actor journey: paymob purchase → verified callback → activation", () => {
  test("step 1 — Student A: paymob purchase commits ONE pending pair + junction + verbatim claim, hosted-checkout descriptor surfaced", async () => {
    const purchasesBefore = await pendingSetCounts(studentA.userId);

    const result = await SubscriptionPurchaseService.purchase(
      studentA.userId,
      { planId: planA.id },
      KEY_PURCHASE_A,
      "en"
    );

    // The intention crossed the provider boundary exactly once, carrying the
    // server-derived billing identity and the correlation key — and NO
    // localhost callback URLs (the development-default channel composes
    // nothing; the vendor falls back to the dashboard configuration).
    expect(providerRequests).toHaveLength(1);
    const intention = providerRequests[0];
    if (!intention) {
      throw new Error("expected the intention creation request to be recorded");
    }
    expect(intention.url).toBe(`${PAYMOB_API_BASE}/v1/intention/`);
    expect(intention.headers.Authorization).toBe(`Token ${PAYMOB_SECRET_KEY}`);
    const intentionBody: unknown = JSON.parse(intention.body);
    if (!isPlainJsonObject(intentionBody)) {
      throw new Error("intention request body was not a JSON object");
    }
    expect(intentionBody.amount).toBe(20_000);
    expect(intentionBody.currency).toBe("EGP");
    expect(intentionBody.special_reference).toBe(KEY_PURCHASE_A);
    const billingData = memberRecord(intentionBody, "billing_data");
    expect(billingData.email).toBe(studentA.email);
    expect("notification_url" in intentionBody).toBe(false);
    expect("redirection_url" in intentionBody).toBe(false);

    // The returned pending pair: subscription pending, the correlation key
    // as the provider reference, verbatim plan money, live checkout URL.
    expect(result.subscription.status).toBe(SubscriptionStatus.Pending);
    expect(result.subscription.userId).toBe(studentA.userId);
    expect(result.subscription.planId).toBe(planA.id);
    expect(result.subscription.paymentReference).toBe(KEY_PURCHASE_A);
    expect(result.checkout.provider).toBe(PaymentGateway.Paymob);
    expect(result.checkout.providerReference).toBe(KEY_PURCHASE_A);
    expect(result.checkout.checkoutUrl).toBe(
      `https://eg.checkout.paymob.com?publicKey=${PAYMOB_PUBLIC_KEY}&clientSecret=client-secret-${PREFIX}`
    );
    expect(result.payment.amount).toBe(PLAN_A_PRICE);
    expect(result.payment.currency).toBe("EGP");
    expect(result.payment.status).toBe(PaymentStatus.Pending);
    expect(result.payment.subscriptionId).toBe(result.subscription.id);

    // Exactly ONE committed pending set for the purchaser.
    const counts = await pendingSetCounts(studentA.userId);
    expect(counts).toEqual({
      subs: purchasesBefore.subs + 1,
      payments: purchasesBefore.payments + 1,
      junction: purchasesBefore.junction + 1,
      claims: purchasesBefore.claims + 1,
    });

    // The junction binds the purchasing student to the new subscription.
    const junctionRows = await db
      .select()
      .from(studentSubscriptions)
      .where(eq(studentSubscriptions.subscriptionId, result.subscription.id));
    expect(junctionRows).toHaveLength(1);
    expect(junctionRows[0]?.studentId).toBe(studentA.userId);

    // The claim is keyed VERBATIM and backfilled with the winning pair.
    const claims = await claimRowsFor(KEY_PURCHASE_A);
    expect(claims).toHaveLength(1);
    expect(claims[0]?.userId).toBe(studentA.userId);
    expect(claims[0]?.subscriptionId).toBe(result.subscription.id);

    // Track every service-created row for teardown.
    tracked.register(subscriptions, result.subscription.id);
    tracked.register(studentPayments, result.payment.id);
    if (claims[0]) {
      tracked.register(subscriptionPurchaseIdempotency, claims[0].id);
    }
    ledgerSubscriptionIds.push(result.subscription.id);
    ledgerPaymentIds.push(result.payment.id);
  });

  test("step 2 — signed callback delivered through the resolved channel → paid + active window + full lane credit + ONE notification to Student A ONLY", async () => {
    const balancesBefore = await readBalances(studentA.userId);
    const purchasesBefore = await pendingSetCounts(studentA.userId);
    const windowStart = Date.now() - 2_000;
    const activeSubscription = await subscriptionRow(ledgerSubscriptionIds[0] ?? 0);
    const reference = activeSubscription.paymentReference;
    if (reference === null) {
      throw new Error("expected the pending subscription to carry the gateway payment reference");
    }

    await deliverCallback(reference, "confirmed", PLAN_A_PRICE);

    // The ledger decision: pending → paid, with the provider's transaction
    // reference recorded inside the guarded statement.
    const paid = await paymentRow(ledgerPaymentIds[0] ?? 0);
    expect(paid.status).toBe(PaymentStatus.Paid);
    expect(paid.providerTransactionId).toBe(expectedProviderTransactionId(reference, PLAN_A_PRICE, "confirmed"));

    // The activation window: startDate ≈ now, verification stamped,
    // endDate − startDate = intervalDays exactly.
    const active = await subscriptionRow(ledgerSubscriptionIds[0] ?? 0);
    expect(active.status).toBe(SubscriptionStatus.Active);
    expect(active.paymentVerifiedAt).not.toBeNull();
    if (active.startDate === null || active.endDate === null) {
      throw new Error("expected the activated subscription to carry its window dates");
    }
    expect(active.startDate.getTime()).toBeGreaterThanOrEqual(windowStart);
    expect(active.endDate.getTime() - active.startDate.getTime()).toBe(PLAN_A_INTERVAL_DAYS * MS_PER_DAY);

    // The lane credit: exactly the plan's full sessionCount on the plan's lane.
    const balancesAfter = await readBalances(studentA.userId);
    expect((balancesAfter.hifz ?? 0) - (balancesBefore.hifz ?? 0)).toBe(PLAN_A_SESSION_COUNT);
    expect(balancesAfter.tajweed).toBe(balancesBefore.tajweed);

    // The purchase set did not grow (activation mutated, never inserted).
    expect(await pendingSetCounts(studentA.userId)).toEqual(purchasesBefore);

    // ONE persisted notification, composed for the purchaser.
    const inbox = await notificationsForSubscription(ledgerSubscriptionIds[0] ?? 0);
    expect(inbox).toHaveLength(1);
    const row = inbox[0];
    if (!row) {
      throw new Error("expected the persisted confirmation notification");
    }
    tracked.register(notifications, row.id);
    expect(row.userId).toBe(studentA.userId);
    expect(row.type).toBe(NotificationType.PaymentConfirmation);
    expect(row.relatedEntityType).toBe("subscription");
    expect(row.relatedEntityId).toBe(ledgerSubscriptionIds[0]);
    expect(row.isRead).toBe(false);
    expect(row.title).toBe(NOTIFS_EN.eventPaymentConfirmedTitle);
    expect(row.body).toBe(NOTIFS_EN.eventPaymentConfirmedBody(planA.title));

    // The receipt published strictly post-commit — to Student A ONLY.
    expect(publishSpy.mock.calls).toHaveLength(1);
    const published: unknown = publishSpy.mock.calls[0]?.[0];
    if (!Array.isArray(published) || published.length !== 1) {
      throw new Error("expected exactly one published delivery receipt");
    }
    const receipt = published[0];
    if (!isPlainJsonObject(receipt) || !Array.isArray(receipt.recipientUserIds)) {
      throw new Error("expected the published receipt to carry its recipient ids");
    }
    expect(receipt.recipientUserIds).toEqual([studentA.userId]);

    // Both directions: no other cast member's inbox exists or grew.
    expect(await inboxCount(studentB.userId)).toBe(0);
  });

  test("step 3 — the SAME signed callback re-delivered → replayed ack, no double credit, no second notification/publish", async () => {
    const balancesBefore = await readBalances(studentA.userId);
    const decidedBefore = await paymentRow(ledgerPaymentIds[0] ?? 0);
    const activeBefore = await subscriptionRow(ledgerSubscriptionIds[0] ?? 0);
    const publishesBefore = publishSpy.mock.calls.length;
    const reference = activeBefore.paymentReference;
    if (reference === null) {
      throw new Error("expected the activated subscription to keep its gateway payment reference");
    }

    // Byte-identical replay: identical settlement args reproduce the
    // identical signed body, and the receiver answers 200 (the channel
    // resolves — a replay ack never rejects the delivery).
    await deliverCallback(reference, "confirmed", PLAN_A_PRICE);

    // No second credit, no second notification, no second publish.
    expect(await readBalances(studentA.userId)).toEqual(balancesBefore);
    expect(await inboxCount(studentA.userId)).toBe(1);
    expect(publishSpy.mock.calls).toHaveLength(publishesBefore);

    // The decided rows are untouched — statuses and timestamps identical.
    const decidedAfter = await paymentRow(ledgerPaymentIds[0] ?? 0);
    expect(decidedAfter.status).toBe(PaymentStatus.Paid);
    expect(decidedAfter.updatedAt.getTime()).toBe(decidedBefore.updatedAt.getTime());
    const activeAfter = await subscriptionRow(ledgerSubscriptionIds[0] ?? 0);
    expect(activeAfter.startDate?.getTime()).toBe(activeBefore.startDate?.getTime());
    expect(activeAfter.endDate?.getTime()).toBe(activeBefore.endDate?.getTime());
    expect(activeAfter.updatedAt.getTime()).toBe(activeBefore.updatedAt.getTime());
  });

  test("step 4 — System: a delivery signed under the wrong secret is masked 401 with zero state change", async () => {
    const balancesBefore = await readBalances(studentA.userId);
    const activeBefore = await subscriptionRow(ledgerSubscriptionIds[0] ?? 0);
    const decidedBefore = await paymentRow(ledgerPaymentIds[0] ?? 0);
    const reference = activeBefore.paymentReference;
    if (reference === null) {
      throw new Error("expected the activated subscription to keep its gateway payment reference");
    }
    const publishesBefore = publishSpy.mock.calls.length;

    // A wrong-secret signature over the same settlement args — the
    // receiver's gate rejects it before a single payload member is trusted.
    const { body, hmac } = buildSimulatedProcessedCallback(
      { reference, outcome: "confirmed", amount: PLAN_A_PRICE, currency: "EGP" },
      `${PAYMOB_HMAC_SECRET}-tampered`
    );
    const response = await POST(
      new NextRequest(`http://localhost:${receiverServer.port}/api/payments/webhook?hmac=${hmac}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
    );

    expect(response.status).toBe(401);
    const envelope = await readJsonEnvelope(response);
    expect(maskedCodeOf(envelope)).toBe("UNAUTHORIZED");

    // Zero state change: statuses, timestamps, balances, inbox, publishes.
    const decidedAfter = await paymentRow(ledgerPaymentIds[0] ?? 0);
    expect(decidedAfter.status).toBe(decidedBefore.status);
    expect(decidedAfter.updatedAt.getTime()).toBe(decidedBefore.updatedAt.getTime());
    const activeAfter = await subscriptionRow(ledgerSubscriptionIds[0] ?? 0);
    expect(activeAfter.updatedAt.getTime()).toBe(activeBefore.updatedAt.getTime());
    expect(await readBalances(studentA.userId)).toEqual(balancesBefore);
    expect(await inboxCount(studentA.userId)).toBe(1);
    expect(publishSpy.mock.calls).toHaveLength(publishesBefore);
  });

  test("step 5 — System: a body tampered after signing (flipped success flag) is masked 401 with zero state change", async () => {
    const balancesBefore = await readBalances(studentA.userId);
    const decidedBefore = await paymentRow(ledgerPaymentIds[0] ?? 0);
    const publishesBefore = publishSpy.mock.calls.length;
    const reference = (await subscriptionRow(ledgerSubscriptionIds[0] ?? 0)).paymentReference;
    if (reference === null) {
      throw new Error("expected the activated subscription to keep its gateway payment reference");
    }

    // The signed confirmed callback, then the `success` flag flipped AFTER
    // signing: the stale signature no longer covers the delivered bytes.
    const { body, hmac } = buildSimulatedProcessedCallback(
      { reference, outcome: "confirmed", amount: PLAN_A_PRICE, currency: "EGP" },
      PAYMOB_HMAC_SECRET
    );
    const tampered = { ...body, obj: { ...body.obj, success: !body.obj.success } };
    const response = await POST(
      new NextRequest(`http://localhost:${receiverServer.port}/api/payments/webhook?hmac=${hmac}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(tampered),
      })
    );

    expect(response.status).toBe(401);
    const envelope = await readJsonEnvelope(response);
    expect(maskedCodeOf(envelope)).toBe("UNAUTHORIZED");

    // Zero state change.
    const decidedAfter = await paymentRow(ledgerPaymentIds[0] ?? 0);
    expect(decidedAfter.status).toBe(PaymentStatus.Paid);
    expect(decidedAfter.updatedAt.getTime()).toBe(decidedBefore.updatedAt.getTime());
    expect(await readBalances(studentA.userId)).toEqual(balancesBefore);
    expect(await inboxCount(studentA.userId)).toBe(1);
    expect(publishSpy.mock.calls).toHaveLength(publishesBefore);
  });

  test("step 6 — Student A: fresh purchase + failed settlement → payment failed, subscription stays pending, failure notification persisted", async () => {
    const balancesBefore = await readBalances(studentA.userId);
    const purchasesBefore = await pendingSetCounts(studentA.userId);

    const result = await SubscriptionPurchaseService.purchase(
      studentA.userId,
      { planId: planB.id },
      KEY_FAILURE_A,
      "en"
    );
    expect(result.subscription.status).toBe(SubscriptionStatus.Pending);
    tracked.register(subscriptions, result.subscription.id);
    tracked.register(studentPayments, result.payment.id);
    const claims = await claimRowsFor(KEY_FAILURE_A);
    expect(claims).toHaveLength(1);
    if (claims[0]) {
      tracked.register(subscriptionPurchaseIdempotency, claims[0].id);
    }
    ledgerSubscriptionIds.push(result.subscription.id);
    ledgerPaymentIds.push(result.payment.id);

    await deliverCallback(KEY_FAILURE_A, "failed", PLAN_B_PRICE);

    // The ledger records the failure WITH the provider reference (the
    // guarded failed writer records it in the same statement); the
    // subscription stays pending for operator follow-up.
    const failed = await paymentRow(result.payment.id);
    expect(failed.status).toBe(PaymentStatus.Failed);
    expect(failed.providerTransactionId).toBe(expectedProviderTransactionId(KEY_FAILURE_A, PLAN_B_PRICE, "failed"));
    const pending = await subscriptionRow(result.subscription.id);
    expect(pending.status).toBe(SubscriptionStatus.Pending);
    expect(pending.startDate).toBeNull();
    expect(pending.endDate).toBeNull();
    expect(pending.paymentVerifiedAt).toBeNull();

    // Zero credit, and the committed pending set grew by exactly the pair.
    expect(await readBalances(studentA.userId)).toEqual(balancesBefore);
    const countsAfter = await pendingSetCounts(studentA.userId);
    expect(countsAfter).toEqual({
      subs: purchasesBefore.subs + 1,
      payments: purchasesBefore.payments + 1,
      junction: purchasesBefore.junction + 1,
      claims: purchasesBefore.claims + 1,
    });

    // The FAILURE notification persisted and published — same kind, the
    // failed copy pair, addressed to the purchaser only.
    const inbox = await notificationsForSubscription(result.subscription.id);
    expect(inbox).toHaveLength(1);
    const row = inbox[0];
    if (!row) {
      throw new Error("expected the persisted failure notification");
    }
    tracked.register(notifications, row.id);
    expect(row.userId).toBe(studentA.userId);
    expect(row.type).toBe(NotificationType.PaymentConfirmation);
    expect(row.title).toBe(NOTIFS_EN.eventPaymentFailedTitle);
    expect(row.body).toBe(NOTIFS_EN.eventPaymentFailedBody(planB.title));
    expect(publishSpy.mock.calls).toHaveLength(2);
    const published: unknown = publishSpy.mock.calls[1]?.[0];
    if (!Array.isArray(published) || published.length !== 1) {
      throw new Error("expected exactly one published delivery receipt for the failure leg");
    }
    const receipt = published[0];
    if (!isPlainJsonObject(receipt) || !Array.isArray(receipt.recipientUserIds)) {
      throw new Error("expected the published receipt to carry its recipient ids");
    }
    expect(receipt.recipientUserIds).toEqual([studentA.userId]);
  });

  test("step 7 — Student B: own purchase settles through its own reference while Student A's rows stay byte-identical", async () => {
    const balancesABefore = await readBalances(studentA.userId);
    const aDecidedBefore = await paymentRow(ledgerPaymentIds[0] ?? 0);
    const aActiveBefore = await subscriptionRow(ledgerSubscriptionIds[0] ?? 0);
    const aInboxBefore = await inboxCount(studentA.userId);
    const balancesBBefore = await readBalances(studentB.userId);

    const result = await SubscriptionPurchaseService.purchase(
      studentB.userId,
      { planId: planB.id },
      KEY_PURCHASE_B,
      "en"
    );
    tracked.register(subscriptions, result.subscription.id);
    tracked.register(studentPayments, result.payment.id);
    const claims = await claimRowsFor(KEY_PURCHASE_B);
    expect(claims).toHaveLength(1);
    if (claims[0]) {
      tracked.register(subscriptionPurchaseIdempotency, claims[0].id);
    }
    ledgerSubscriptionIds.push(result.subscription.id);
    ledgerPaymentIds.push(result.payment.id);

    // B's OWN reference settles B's pair — the reference is the only lookup
    // key, so the delivered callback can never resolve onto A's rows.
    await deliverCallback(KEY_PURCHASE_B, "confirmed", PLAN_B_PRICE);

    // B's settlement: paid + provider reference + active + tajweed credit
    // + ONE notification + one publish.
    const settled = await paymentRow(result.payment.id);
    expect(settled.status).toBe(PaymentStatus.Paid);
    expect(settled.providerTransactionId).toBe(
      expectedProviderTransactionId(KEY_PURCHASE_B, PLAN_B_PRICE, "confirmed")
    );
    const bActive = await subscriptionRow(result.subscription.id);
    expect(bActive.status).toBe(SubscriptionStatus.Active);
    const balancesBAfter = await readBalances(studentB.userId);
    expect((balancesBAfter.tajweed ?? 0) - (balancesBBefore.tajweed ?? 0)).toBe(PLAN_B_SESSION_COUNT);
    const bInbox = await notificationsForSubscription(result.subscription.id);
    expect(bInbox).toHaveLength(1);
    const bNotification = bInbox[0];
    if (!bNotification) {
      throw new Error("expected the persisted confirmation notification for Student B");
    }
    tracked.register(notifications, bNotification.id);
    expect(bNotification.userId).toBe(studentB.userId);
    expect(bNotification.title).toBe(NOTIFS_EN.eventPaymentConfirmedTitle);
    expect(bNotification.body).toBe(NOTIFS_EN.eventPaymentConfirmedBody(planB.title));
    expect(publishSpy.mock.calls).toHaveLength(3);

    // No cross-user fan-out: Student A's decided rows are byte-identical,
    // A's balances and inbox count are untouched.
    const aDecidedAfter = await paymentRow(ledgerPaymentIds[0] ?? 0);
    expect(aDecidedAfter.status).toBe(aDecidedBefore.status);
    expect(aDecidedAfter.updatedAt.getTime()).toBe(aDecidedBefore.updatedAt.getTime());
    const aActiveAfter = await subscriptionRow(ledgerSubscriptionIds[0] ?? 0);
    expect(aActiveAfter.updatedAt.getTime()).toBe(aActiveBefore.updatedAt.getTime());
    expect(await readBalances(studentA.userId)).toEqual(balancesABefore);
    expect(await inboxCount(studentA.userId)).toBe(aInboxBefore);
  });

  test("step 8 — System: a verified-signature callback carrying ANOTHER plan's amount is quarantined — Student A stays pending", async () => {
    const balancesBefore = await readBalances(studentA.userId);
    const purchasesBefore = await pendingSetCounts(studentA.userId);
    const publishesBefore = publishSpy.mock.calls.length;
    const inboxBefore = await inboxCount(studentA.userId);

    // A fresh pending pair for Student A; the delivered callback verifies
    // cleanly (correct secret, real route gate) but carries the OTHER
    // plan's price — the settlement check must refuse the money.
    const result = await SubscriptionPurchaseService.purchase(
      studentA.userId,
      { planId: planA.id },
      KEY_MISMATCH_A,
      "en"
    );
    expect(result.subscription.status).toBe(SubscriptionStatus.Pending);
    tracked.register(subscriptions, result.subscription.id);
    tracked.register(studentPayments, result.payment.id);
    const claims = await claimRowsFor(KEY_MISMATCH_A);
    expect(claims).toHaveLength(1);
    if (claims[0]) {
      tracked.register(subscriptionPurchaseIdempotency, claims[0].id);
    }
    ledgerSubscriptionIds.push(result.subscription.id);
    ledgerPaymentIds.push(result.payment.id);

    const quarantineLogs: string[] = [];
    const errorSpy = spyOn(logger, "error").mockImplementation((message: string) => {
      quarantineLogs.push(message);
    });
    let deliveryThrew: unknown = null;
    try {
      await deliverCallback(KEY_MISMATCH_A, "confirmed", PLAN_B_PRICE);
    } catch (error) {
      deliveryThrew = error;
    } finally {
      errorSpy.mockRestore();
    }
    // The receiver acked the quarantine (never a settlement) — the channel
    // resolves; a rejection here would mean the delivery was not acked 200.
    expect(deliveryThrew).toBeNull();

    // Student A stays pending with zero credit, zero notification, zero
    // publish — and exactly ONE bounded quarantine log.
    const pending = await subscriptionRow(result.subscription.id);
    expect(pending.status).toBe(SubscriptionStatus.Pending);
    expect(pending.paymentVerifiedAt).toBeNull();
    const undecided = await paymentRow(result.payment.id);
    expect(undecided.status).toBe(PaymentStatus.Pending);
    expect(undecided.providerTransactionId).toBeNull();
    expect(await readBalances(studentA.userId)).toEqual(balancesBefore);
    expect(await pendingSetCounts(studentA.userId)).toEqual({
      subs: purchasesBefore.subs + 1,
      payments: purchasesBefore.payments + 1,
      junction: purchasesBefore.junction + 1,
      claims: purchasesBefore.claims + 1,
    });
    expect(await inboxCount(studentA.userId)).toBe(inboxBefore);
    expect(publishSpy.mock.calls).toHaveLength(publishesBefore);
    expect(quarantineLogs).toHaveLength(1);
    expect(quarantineLogs[0]).toContain("quarantined");
  });
});
