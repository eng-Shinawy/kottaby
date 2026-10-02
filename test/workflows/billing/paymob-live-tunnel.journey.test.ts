/**
 * LIVE tunnel journey — student purchase through the REAL Paymob API with
 * the operator's REAL sandbox credentials, settled through the REAL ngrok
 * tunnel (`PAYMOB_LIVE_TESTS=1` + live credentials + reserved domain
 * required; the suite skips otherwise).
 *
 * This is the live twin of `paymob-purchase-journey.test.ts`: the flagship
 * proves the workflow against a recorded provider boundary and the
 * simulation channel; THIS journey proves the SAME workflow with nothing
 * recorded and no simulated transport —
 *
 *   1. Student purchases a plan → the intention crosses the REAL vendor API
 *      (pass-through-recorded fetch, never mocked) carrying the tunnel's
 *      PUBLIC notification/redirection URLs and the real secret key.
 *   2. The signed settlement callback is delivered through the REAL ngrok
 *      tunnel — public reserved domain → agent → in-process receiver →
 *      REAL webhook route (production HMAC builder under the REAL
 *      `PAYMOB_HMAC_SECRET`) → REAL activation service → payment paid,
 *      subscription active, lane credited, ONE notification.
 *   3. The byte-identical replay traverses the tunnel again → replayed ack,
 *      zero double effects.
 *   4. A body tampered after signing is posted straight at the PUBLIC
 *      webhook URL → the real gate masks 401 through the tunnel, zero state
 *      change.
 *   5. A fresh purchase settles through a failed outcome → payment failed,
 *      subscription stays pending, failure notification persisted.
 *
 * Journey rules honored (`test/workflows/AGENTS.md`): committed fixtures in
 * ONE `db.transaction` in `beforeAll` + zero-residue tracked teardown in
 * `afterAll`; honest actors via the actor-context factory; the ONLY fetch
 * interception is a pass-through recorder at the provider boundary (every
 * request reaches the vendor); the notification publish seam is SPIED;
 * error assertions through route envelopes — never `.rejects.toThrow()`.
 * The fetch/publish spies and the receiver server are installed ONLY under
 * the live gates (inside the guarded `beforeAll`) and restored
 * unconditionally in `afterAll`, so an ungated run leaks no harness state.
 *
 * Teardown kills the spawned ngrok agent explicitly (the channel's cleanup
 * registration seam is captured at construction) so the reserved domain is
 * released for the next live run.
 */

import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
// Value import (NOT type-only): NextRequest is CONSTRUCTED below.
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
import {
  configureCallbackChannelTestDelivery,
  getCallbackChannel,
  resetCallbackChannel,
} from "@/backend/services/billing/payment-gateway/callback-channel/callback-channel.factory";
import { buildSimulatedProcessedCallback } from "@/backend/services/billing/payment-gateway/callback-channel/simulation-callback-channel.channel";
import { resetPaymentGateway } from "@/backend/services/billing/payment-gateway/payment-gateway.factory";
import { SubscriptionPurchaseService } from "@/backend/services/billing/subscription-purchase.service";
import { NotificationEngine } from "@/backend/services/notifications";
import type { DBTransaction, PlanSelectType } from "@/backend/types";
import { withImmutabilityTriggersSuspended } from "@/test/helpers/db-cleanup";
import {
  arePaymobLiveTunnelTestsEnabled,
  installPaymobLiveEnvFixture,
  resolveNgrokTunnelConfig,
  resolvePaymobLiveCredentials,
} from "@/test/helpers/paymob-live-env";
import { journeyPrefix, provisionStudentActor, TrackedFixtures } from "@/test/workflows/helpers";

// ─── Live gates (module scope — the suite skips without them) ────────────────

const liveCreds = resolvePaymobLiveCredentials();
const tunnel = resolveNgrokTunnelConfig();
const live = arePaymobLiveTunnelTestsEnabled();

/** The public reserved domain the REAL tunnel serves (null when ungated). */
const PUBLIC_BASE_URL = tunnel === null ? null : `https://${tunnel.domain}`;

// ─── Harness state ───────────────────────────────────────────────────────────

/** Per-run unique prefix — every fixture name, plan title, and idempotency key. */
const PREFIX = journeyPrefix("billing");

/** Milliseconds per day — the activation window arithmetic. */
const MS_PER_DAY = 86_400_000;

/** The journey plan: one hifz-lane plan at a sandbox-safe price. */
const PLAN_SESSION_COUNT = 7;
const PLAN_INTERVAL_DAYS = 30;
const PLAN_PRICE = "200.00";

/** The provider's default API host the pass-through recorder watches. */
const PAYMOB_API_BASE = "https://accept.paymob.com";

/** Every env key the journey varies — saved before setup, restored in afterAll. */
const ENV_KEYS = [
  "PAYMENT_WEBHOOK_ENABLED",
  "PAYMENT_GATEWAY_PROVIDER",
  "NGROK_PORT",
  "NGROK_AUTHTOKEN",
  "NGROK_DOMAIN",
] as const;

const savedEnv: Record<string, string | undefined> = {};
for (const key of ENV_KEYS) {
  savedEnv[key] = process.env[key];
}

const tracked = new TrackedFixtures();

/** Idempotency keys — one per purchase leg, unique per run. */
const KEY_PURCHASE = `${PREFIX}-key-purchase`;
const KEY_FAILURE = `${PREFIX}-key-failure`;

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

/** The original platform fetch — everything the recorder sees passes through. */
const realFetch = globalThis.fetch.bind(globalThis);

/**
 * A PASS-THROUGH recording fetch: the provider's intention call is recorded
 * and forwarded to the REAL vendor API — nothing is mocked. Loopback and
 * tunnel traffic passes through untouched. Restored in `afterAll`.
 */
function recordingPassthroughFetch(input: string | URL | Request, init?: BunFetchRequestInit): Promise<Response> {
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
  }
  return realFetch(input, init);
}
recordingPassthroughFetch.preconnect = (url: string | URL) => globalThis.fetch.preconnect(url);

/**
 * Live-gated harness — installed ONLY inside the live-guarded `beforeAll`
 * and restored unconditionally in `afterAll` (before the `!live` early
 * return), so an ungated run never leaks a proxied global fetch, a silenced
 * notification-publish seam, or a bound listener into the rest of the suite.
 */

/** Installs the pass-through fetch recorder over the global fetch boundary. */
function installFetchRecorder() {
  return spyOn(globalThis, "fetch").mockImplementation(recordingPassthroughFetch);
}

/** Installs the post-commit publish no-op over the engine's publish boundary. */
function installPublishNoop() {
  return spyOn(NotificationEngine, "publishReceipts").mockImplementation(async () => {});
}

/** The installed global fetch spy (null until the live-guarded setup). */
let fetchSpy: ReturnType<typeof installFetchRecorder> | null = null;

/** The in-process callback receiver serving the REAL webhook route handler. */
let receiverServer: ReturnType<typeof Bun.serve> | null = null;

/** The post-commit publish spy (null until the live-guarded setup). */
let publishSpy: ReturnType<typeof installPublishNoop> | null = null;

/** Reads the publish spy's recorded calls, failing when it is not installed. */
function publishCalls() {
  if (publishSpy === null) {
    throw new Error("expected the publish spy to be installed under the live gates");
  }
  return publishSpy.mock.calls;
}

/** Captured channel agent terminator — the tunnel must not outlive the suite. */
let terminateTunnelAgent: (() => void) | null = null;

/** The live credential fixture's restore function (installed in `beforeAll`). */
let restoreLiveCredsFixture: (() => void) | null = null;

let student: JourneyActorRow;
let plan: PlanSelectType;

/** A journey cast member: the actor bundle plus its committed user row. */
interface JourneyActorRow {
  readonly userId: number;
  readonly email: string;
}

// ─── Read-back oracles ───────────────────────────────────────────────────────

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

/** Reads the notifications bound to one subscription. */
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

/** Reads one idempotency claim by key. */
async function claimRowsFor(idempotencyKey: string) {
  return db
    .select()
    .from(subscriptionPurchaseIdempotency)
    .where(eq(subscriptionPurchaseIdempotency.idempotencyKey, idempotencyKey));
}

// ─── Callback + wire helpers ─────────────────────────────────────────────────

/** The synthesized signed callback body for one delivery's settlement args. */
function expectedProviderTransactionId(reference: string, amount: string, outcome: "confirmed" | "failed"): string {
  const { body } = buildSimulatedProcessedCallback(
    { reference, outcome, amount, currency: "EGP" },
    liveCreds?.hmacSecret ?? ""
  );
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

/** Reads the masked denial code out of a 4xx route envelope. */
function maskedCodeOf(envelope: Record<string, unknown>): string {
  const error = memberRecord(envelope, "error");
  const code: unknown = error.code;
  if (typeof code !== "string") {
    throw new Error("masked denial envelope carried no code");
  }
  return code;
}

/** Narrows a nullable wire value to a string, failing when absent. */
function requiredString(value: string | null): string {
  if (typeof value !== "string") {
    throw new Error("expected a non-null string value");
  }
  return value;
}

/** Delivers one settlement through the REAL resolved tunnel channel. */
async function deliverThroughTunnel(reference: string, outcome: "confirmed" | "failed", amount: string): Promise<void> {
  const channel = await getCallbackChannel();
  const deliver = channel.deliverTestCallback;
  if (!deliver) {
    throw new Error("expected the resolved callback channel to expose the development delivery surface");
  }
  await deliver.call(channel, { reference, outcome, amount, currency: "EGP" });
}

// ─── Fixture provisioning ────────────────────────────────────────────────────

/**
 * Provisions the student cast member through the actor-context factory and
 * re-reads the committed row for the billing-identity assertion.
 */
async function provisionStudent(tx: DBTransaction): Promise<JourneyActorRow> {
  const actor = await provisionStudentActor(tx, { tracked });
  const rows = await tx.select().from(users).where(eq(users.id, actor.userId)).limit(1);
  const row = rows[0];
  if (!row) {
    throw new Error("journey fixture: student user row vanished inside the provisioning transaction");
  }
  return { userId: actor.userId, email: row.email };
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

beforeAll(async () => {
  if (!live || liveCreds === null || tunnel === null || PUBLIC_BASE_URL === null) {
    return;
  }

  // Harness FIRST: the pass-through fetch recorder, the in-process receiver,
  // and the publish spy. Everything below assumes them installed; `afterAll`
  // restores them unconditionally so an ungated run stays untouched.
  fetchSpy = installFetchRecorder();
  const receiver = Bun.serve({
    // Loopback-only bind: the ngrok agent forwards public traffic to this
    // server over localhost, and the listener must never reach other
    // interfaces.
    port: 0,
    hostname: "localhost",
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
  receiverServer = receiver;
  publishSpy = installPublishNoop();

  // A stray agent from a killed run holds the reserved domain, and a new
  // agent's bind then fails silently (its deliveries 404 at the edge). The
  // journey owns the tunnel lifecycle: sweep stray agents for THIS domain
  // before the channel resolves. `pkill -f` treats its pattern as an ERE —
  // the reserved domain must be regex-escaped so metacharacters (a literal
  // `.` in every real domain) cannot widen the match onto unrelated local
  // processes.
  const domainPattern = tunnel.domain.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  await Bun.spawn(["pkill", "-f", `ngrok http --url=https://${domainPattern}`]).exited;

  // Environment: enabled webhook receiver + the paymob provider active with
  // the REAL credential fixture, and the REAL tunnel pointed at the
  // in-process receiver's port.
  process.env.PAYMENT_WEBHOOK_ENABLED = "true";
  process.env.PAYMENT_GATEWAY_PROVIDER = PaymentGateway.Paymob;
  process.env.NGROK_AUTHTOKEN = tunnel.authtoken;
  process.env.NGROK_DOMAIN = tunnel.domain;
  process.env.NGROK_PORT = String(receiver.port);
  restoreLiveCredsFixture = installPaymobLiveEnvFixture(liveCreds);
  resetPaymentGateway();
  resetCallbackChannel();

  // Capture the tunnel agent's terminator at channel construction so
  // `afterAll` can release the reserved domain explicitly.
  configureCallbackChannelTestDelivery({
    registerCleanup: terminate => {
      terminateTunnelAgent = terminate;
      process.once("exit", terminate);
    },
  });

  // ONE committing transaction: commit-or-nothing fixture provisioning.
  await db.transaction(async tx => {
    student = await provisionStudent(tx);
    plan = await createTestPlan(tx, {
      title: `${PREFIX} live tunnel plan`,
      sessionCount: PLAN_SESSION_COUNT,
      price: PLAN_PRICE,
      currency: "EGP",
      intervalDays: PLAN_INTERVAL_DAYS,
      balanceLane: SubscriptionCreditLane.Hifz,
    });
    tracked.register(plans, plan.id);
  });

  // The channel resolves ONCE through the factory — and MUST be the REAL
  // tunnel channel: the agent spawns against the REAL authtoken/domain and
  // the public probe proves the whole acquisition end-to-end.
  const channel = await getCallbackChannel();
  expect(channel.kind).toBe("ngrok");
  expect(channel.publicBaseUrl).toBe(PUBLIC_BASE_URL);
  await channel.ensureReady();
});

afterAll(async () => {
  // Harness teardown is UNCONDITIONAL and runs BEFORE the live gate: the
  // spies/receiver are installed only under the gates, so the null guards
  // no-op on an ungated run — but the restore must never be reachable only
  // when `live`, or an ungated run would leak the harness into the suite.
  fetchSpy?.mockRestore();
  publishSpy?.mockRestore();
  terminateTunnelAgent?.();
  if (receiverServer !== null) {
    await receiverServer.stop(true).then(
      () => undefined,
      () => undefined
    );
  }

  if (!live) {
    return;
  }

  // Immutable-ledger teardown leg FIRST: the append-only trigger blocks a
  // plain DELETE, so the sanctioned suspension wraps exactly this leg.
  if (ledgerPaymentIds.length > 0) {
    await withImmutabilityTriggersSuspended(["student_payments"], () =>
      db.delete(studentPayments).where(inArray(studentPayments.id, ledgerPaymentIds))
    );
  }
  // Junction rows (composite PK — no registry entry; swept by subscription id).
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
  // Reverse-registration-order hard delete + zero-residue re-probes.
  await tracked.cleanup();

  // Env restore: live credential fixture first, then the saved scalar keys.
  restoreLiveCredsFixture?.();
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

describe.skipIf(!live)("LIVE journey: paymob purchase → real tunnel callback → activation", () => {
  test("step 1 — purchase creates a REAL intention carrying the tunnel's public callback URLs, pending pair committed", async () => {
    const result = await SubscriptionPurchaseService.purchase(student.userId, { planId: plan.id }, KEY_PURCHASE, "en");

    // The intention crossed the REAL vendor boundary exactly once, carrying
    // the real secret key, the tunnel's PUBLIC callback URLs, and the
    // correlation key.
    expect(providerRequests).toHaveLength(1);
    const intention = providerRequests[0];
    if (!intention) {
      throw new Error("expected the intention creation request to be recorded");
    }
    expect(intention.url).toBe(`${PAYMOB_API_BASE}/v1/intention/`);
    // The Authorization header is asserted through SHA-256 digests — the raw
    // secret key must never ride an assertion argument (Bun prints both
    // sides of a failing toBe into the captured run logs).
    const expectedAuthDigest = createHash("sha256")
      .update(`Token ${liveCreds?.secretKey ?? ""}`)
      .digest("hex");
    const actualAuthDigest = createHash("sha256")
      .update(intention.headers.Authorization ?? "")
      .digest("hex");
    expect(actualAuthDigest).toBe(expectedAuthDigest);
    const intentionBody: unknown = JSON.parse(intention.body);
    if (!isPlainJsonObject(intentionBody)) {
      throw new Error("intention request body was not a JSON object");
    }
    expect(intentionBody.amount).toBe(20_000);
    expect(intentionBody.currency).toBe("EGP");
    expect(intentionBody.special_reference).toBe(KEY_PURCHASE);
    const billingData = memberRecord(intentionBody, "billing_data");
    expect(billingData.email).toBe(student.email);
    expect(intentionBody.notification_url).toBe(`${PUBLIC_BASE_URL}/api/payments/webhook`);
    expect(intentionBody.redirection_url).toBe(`${PUBLIC_BASE_URL}/student/checkout/result`);
    expect(intentionBody.payment_methods).toEqual([liveCreds?.integrationIdCard]);

    // The returned pending pair + live hosted-checkout descriptor.
    expect(result.subscription.status).toBe(SubscriptionStatus.Pending);
    expect(result.subscription.paymentReference).toBe(KEY_PURCHASE);
    expect(result.checkout.provider).toBe(PaymentGateway.Paymob);
    expect(result.checkout.providerReference).toBe(KEY_PURCHASE);
    const checkoutUrl = new URL(requiredString(result.checkout.checkoutUrl));
    expect(checkoutUrl.searchParams.get("publicKey")).toBe(liveCreds?.publicKey ?? null);
    expect(requiredString(checkoutUrl.searchParams.get("clientSecret")).length).toBeGreaterThan(10);
    expect(result.payment.amount).toBe(PLAN_PRICE);
    expect(result.payment.status).toBe(PaymentStatus.Pending);

    // The claim is keyed VERBATIM and backfilled with the winning pair.
    const claims = await claimRowsFor(KEY_PURCHASE);
    expect(claims).toHaveLength(1);
    if (claims[0]) {
      tracked.register(subscriptionPurchaseIdempotency, claims[0].id);
    }
    tracked.register(subscriptions, result.subscription.id);
    tracked.register(studentPayments, result.payment.id);
    ledgerSubscriptionIds.push(result.subscription.id);
    ledgerPaymentIds.push(result.payment.id);
  });

  test("step 2 — signed callback delivered through the REAL tunnel → paid + active window + full lane credit + ONE notification", async () => {
    const balancesBefore = await readBalances(student.userId);
    const windowStart = Date.now() - 2_000;
    const reference = (await subscriptionRow(ledgerSubscriptionIds[0] ?? 0)).paymentReference;
    if (reference === null) {
      throw new Error("expected the pending subscription to carry the gateway payment reference");
    }

    // The delivery traverses the REAL tunnel: public reserved domain →
    // ngrok agent → in-process receiver → REAL webhook route.
    await deliverThroughTunnel(reference, "confirmed", PLAN_PRICE);

    const paid = await paymentRow(ledgerPaymentIds[0] ?? 0);
    expect(paid.status).toBe(PaymentStatus.Paid);
    expect(paid.providerTransactionId).toBe(expectedProviderTransactionId(reference, PLAN_PRICE, "confirmed"));

    const active = await subscriptionRow(ledgerSubscriptionIds[0] ?? 0);
    expect(active.status).toBe(SubscriptionStatus.Active);
    expect(active.paymentVerifiedAt).not.toBeNull();
    if (active.startDate === null || active.endDate === null) {
      throw new Error("expected the activated subscription to carry its window dates");
    }
    expect(active.startDate.getTime()).toBeGreaterThanOrEqual(windowStart);
    expect(active.endDate.getTime() - active.startDate.getTime()).toBe(PLAN_INTERVAL_DAYS * MS_PER_DAY);

    const balancesAfter = await readBalances(student.userId);
    expect((balancesAfter.hifz ?? 0) - (balancesBefore.hifz ?? 0)).toBe(PLAN_SESSION_COUNT);
    expect(balancesAfter.tajweed).toBe(balancesBefore.tajweed);

    // ONE persisted notification, addressed to the purchaser.
    const inbox = await notificationsForSubscription(ledgerSubscriptionIds[0] ?? 0);
    expect(inbox).toHaveLength(1);
    const row = inbox[0];
    if (!row) {
      throw new Error("expected the persisted confirmation notification");
    }
    tracked.register(notifications, row.id);
    expect(row.userId).toBe(student.userId);
    expect(row.type).toBe(NotificationType.PaymentConfirmation);
    expect(row.relatedEntityType).toBe("subscription");

    // The receipt published strictly post-commit — to the purchaser ONLY.
    expect(publishCalls()).toHaveLength(1);
    const published: unknown = publishCalls()[0]?.[0];
    if (!Array.isArray(published) || published.length !== 1) {
      throw new Error("expected exactly one published delivery receipt");
    }
    const receipt = published[0];
    if (!isPlainJsonObject(receipt) || !Array.isArray(receipt.recipientUserIds)) {
      throw new Error("expected the published receipt to carry its recipient ids");
    }
    expect(receipt.recipientUserIds).toEqual([student.userId]);
  });

  test("step 3 — the SAME signed callback re-delivered through the tunnel → replayed ack, no double credit", async () => {
    const balancesBefore = await readBalances(student.userId);
    const decidedBefore = await paymentRow(ledgerPaymentIds[0] ?? 0);
    const activeBefore = await subscriptionRow(ledgerSubscriptionIds[0] ?? 0);
    const publishesBefore = publishCalls().length;
    const reference = activeBefore.paymentReference;
    if (reference === null) {
      throw new Error("expected the activated subscription to keep its gateway payment reference");
    }

    await deliverThroughTunnel(reference, "confirmed", PLAN_PRICE);

    expect(await readBalances(student.userId)).toEqual(balancesBefore);
    expect(await notificationsForSubscription(ledgerSubscriptionIds[0] ?? 0)).toHaveLength(1);
    expect(publishCalls()).toHaveLength(publishesBefore);
    const decidedAfter = await paymentRow(ledgerPaymentIds[0] ?? 0);
    expect(decidedAfter.status).toBe(PaymentStatus.Paid);
    expect(decidedAfter.updatedAt.getTime()).toBe(decidedBefore.updatedAt.getTime());
    const activeAfter = await subscriptionRow(ledgerSubscriptionIds[0] ?? 0);
    expect(activeAfter.updatedAt.getTime()).toBe(activeBefore.updatedAt.getTime());
  });

  test("step 4 — a body tampered after signing posted at the PUBLIC webhook URL is masked 401 through the tunnel", async () => {
    const balancesBefore = await readBalances(student.userId);
    const decidedBefore = await paymentRow(ledgerPaymentIds[0] ?? 0);
    const publishesBefore = publishCalls().length;
    const reference = (await subscriptionRow(ledgerSubscriptionIds[0] ?? 0)).paymentReference;
    if (reference === null) {
      throw new Error("expected the activated subscription to keep its gateway payment reference");
    }

    // A validly signed body whose `success` flag is flipped AFTER signing —
    // posted straight at the PUBLIC webhook surface (the exact URL a real
    // attacker would need).
    const { body, hmac } = buildSimulatedProcessedCallback(
      { reference, outcome: "confirmed", amount: PLAN_PRICE, currency: "EGP" },
      liveCreds?.hmacSecret ?? ""
    );
    const tampered = { ...body, obj: { ...body.obj, success: !body.obj.success } };
    const response = await realFetch(`${PUBLIC_BASE_URL ?? ""}/api/payments/webhook?hmac=${hmac}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(tampered),
    });

    expect(response.status).toBe(401);
    const envelope = await readJsonEnvelope(response);
    expect(maskedCodeOf(envelope)).toBe("UNAUTHORIZED");

    // Zero state change.
    const decidedAfter = await paymentRow(ledgerPaymentIds[0] ?? 0);
    expect(decidedAfter.updatedAt.getTime()).toBe(decidedBefore.updatedAt.getTime());
    expect(await readBalances(student.userId)).toEqual(balancesBefore);
    expect(await notificationsForSubscription(ledgerSubscriptionIds[0] ?? 0)).toHaveLength(1);
    expect(publishCalls()).toHaveLength(publishesBefore);
  });

  test("step 5 — fresh purchase settles a failed outcome through the tunnel → payment failed, subscription stays pending", async () => {
    const balancesBefore = await readBalances(student.userId);

    const result = await SubscriptionPurchaseService.purchase(student.userId, { planId: plan.id }, KEY_FAILURE, "en");
    expect(result.subscription.status).toBe(SubscriptionStatus.Pending);
    const claims = await claimRowsFor(KEY_FAILURE);
    expect(claims).toHaveLength(1);
    if (claims[0]) {
      tracked.register(subscriptionPurchaseIdempotency, claims[0].id);
    }
    tracked.register(subscriptions, result.subscription.id);
    tracked.register(studentPayments, result.payment.id);
    ledgerSubscriptionIds.push(result.subscription.id);
    ledgerPaymentIds.push(result.payment.id);

    await deliverThroughTunnel(KEY_FAILURE, "failed", PLAN_PRICE);

    const failed = await paymentRow(result.payment.id);
    expect(failed.status).toBe(PaymentStatus.Failed);
    expect(failed.providerTransactionId).toBe(expectedProviderTransactionId(KEY_FAILURE, PLAN_PRICE, "failed"));
    const pending = await subscriptionRow(result.subscription.id);
    expect(pending.status).toBe(SubscriptionStatus.Pending);
    expect(pending.startDate).toBeNull();
    expect(pending.paymentVerifiedAt).toBeNull();

    // Zero credit; the FAILURE notification persisted for the purchaser.
    expect(await readBalances(student.userId)).toEqual(balancesBefore);
    const inbox = await notificationsForSubscription(result.subscription.id);
    expect(inbox).toHaveLength(1);
    const row = inbox[0];
    if (!row) {
      throw new Error("expected the persisted failure notification");
    }
    tracked.register(notifications, row.id);
    expect(row.userId).toBe(student.userId);
  });
});
