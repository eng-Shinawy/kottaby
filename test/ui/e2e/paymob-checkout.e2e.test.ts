/**
 * LIVE Paymob checkout — the student purchase funnel end-to-end in a REAL
 * browser, through the REAL vendor hosted checkout, settled by the REAL
 * webhook delivered over the REAL ngrok tunnel.
 *
 * `PAYMOB_LIVE_TESTS=1` + live sandbox credentials + the reserved tunnel
 * domain are required (the dedicated runner `test:ui:e2e:paymob` supplies
 * all three via `.env.paymob.test`); the suite skips otherwise.
 *
 * The funnel:
 *   1. A per-run student registers and signs in over the real GraphQL API;
 *      a per-run plan is created as a fixture (the shared test database's
 *      catalog is impure — journey leftovers — so the funnel targets the
 *      plan this run owns, located by its unique title).
 *   2. The student buys the plan from `/student/plans` → confirm dialog →
 *      `purchaseSubscription` rides the wire EXACTLY once with its
 *      `x-idempotency-key` header → the browser redirects to the hosted
 *      checkout at `eg.checkout.paymob.com`.
 *   3. The sandbox test card pays on the hosted checkout. Paymob's WAF
 *      blocks the default headless-Chromium user agent with a bare 403
 *      (`awselb` bot rule), so the context presents a regular desktop
 *      Chrome UA — the only non-production-behavior concession, identical
 *      to what a real customer's browser sends.
 *   4. The 3DS/processing step resolves, and the vendor redirects the
 *      browser to the result page THROUGH the tunnel's public domain (the
 *      `redirection_url` the intention carried); the processed webhook
 *      lands through the same tunnel on `POST /api/payments/webhook` and
 *      the activation workflow settles the pending pair.
 *   5. The result page renders the success branch, and the authoritative
 *      `mySubscriptions` read shows the subscription ACTIVE — polled, so
 *      the assertion tolerates the webhook arriving after the redirect.
 *
 * Every user-facing string is read from the compile-time translation
 * bundle (`getDefaultTranslations()`) per `test/ui/AGENTS.md` — no
 * hardcoded copy. Screenshots of each stage are archived under the plan
 * bundle's `outcome/e2e-screenshots/` directory.
 */

import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { eq, inArray } from "drizzle-orm";
import { type Browser, type BrowserContext, chromium } from "playwright";
import { db } from "@/backend/db";
import { plans } from "@/backend/db/schema/billing/plans";
import { studentPayments } from "@/backend/db/schema/billing/student-payments";
import { studentSubscriptions } from "@/backend/db/schema/billing/student-subscriptions";
import { notifications } from "@/backend/db/schema/notifications";
import { createTestPlan } from "@/backend/db/test/entity-setup";
import { SubscriptionCreditLane } from "@/backend/enum/billing/subscription-credit-lane.enum";
import { getDefaultTranslations } from "@/shared/locale/server";
import { countUsersByIds, deleteUsersByIds, withImmutabilityTriggersSuspended } from "@/test/helpers/db-cleanup";
import { arePaymobLiveTestsEnabled, resolveNgrokTunnelConfig } from "@/test/helpers/paymob-live-env";

const PORT = process.env.TEST_SERVER_PORT ?? "3066";
const BASE = `http://localhost:${PORT}`;
const SHOT_DIR = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "ai",
  "plans",
  "milestone_1_core_domain_mvp",
  "paymob-gateway-integration",
  "outcome",
  "e2e-screenshots"
);

const live = arePaymobLiveTestsEnabled() && resolveNgrokTunnelConfig() !== null;

/** Per-run fixture identity. */
const RUN = `pym-e2e-${Date.now().toString(36)}`;
const STUDENT_EMAIL = `${RUN}@test.local`;
/** The per-run fixture credential — never a real account's secret. */
const STUDENT_PASSWORD = `${RUN}-P@ssw0rd!`;
const PLAN_TITLE = `${RUN} plan`;
const PLAN_PRICE = "200.00";
const PLAN_SESSION_COUNT = 7;
const PLAN_INTERVAL_DAYS = 30;

/**
 * The sandbox test card. Paymob's 3DS challenge in test mode accepts the
 * fixed OTP `123456` when the card's issuer challenge appears (the
 * runbook's wallet OTP; the sandbox card issuer answers identically).
 */
const CARD = {
  number: process.env.PAYMOB_E2E_CARD ?? "5123456789012346",
  holder: "Test Account",
  expiry: "01/39",
  cvv: "123",
  otp: "123456",
};

/**
 * Paymob's AWS WAF answers the default headless-Chromium UA with a bare
 * 403 (bot rule) — the checkout context presents the regular desktop
 * Chrome UA a real customer's browser sends instead.
 */
const DESKTOP_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36";

const CHECKOUT = getDefaultTranslations().checkoutTranslations;

/** Teardown worklist for rows the flow's services created. */
let studentUserId = 0;
let planId = 0;
const subscriptionIds: number[] = [];

let browser: Browser;

beforeAll(async () => {
  if (!live) {
    return;
  }
  // The TEST process must resolve the simulation channel like the spawned
  // server: the env file carries the real tunnel keys (needed for the
  // live gate), and the ngrok free tier 502s every non-browser user agent,
  // so an in-process tunnel resolution would spawn a dead agent. Delete
  // the keys, then reset BOTH factories (the module-scope live gate already
  // cached the env snapshot with the keys in it); restored by the runner's
  // per-process env reload.
  delete process.env.NGROK_AUTHTOKEN;
  delete process.env.NGROK_DOMAIN;
  // The test process loads .env.test (NGROK_PORT=3000 — the dev default),
  // while the E2E server this flow drives runs on the dedicated port. Pin
  // the simulation channel's local base to the E2E server so its delivery
  // lands on the REAL webhook receiver this run owns (never a foreign
  // localhost server on the dev port).
  process.env.NGROK_PORT = PORT;
  const { resetCallbackChannel } = await import(
    "@/backend/services/billing/payment-gateway/callback-channel/callback-channel.factory"
  );
  resetCallbackChannel();
  browser = await chromium.launch({ headless: true });
  mkdirSync(SHOT_DIR, { recursive: true });

  // The plan the funnel buys — committed via the entity-setup helper inside
  // a committing transaction (the E2E process owns the same test database);
  // the student is created through the real API below.
  await db.transaction(async tx => {
    const plan = await createTestPlan(tx, {
      title: PLAN_TITLE,
      sessionCount: PLAN_SESSION_COUNT,
      price: PLAN_PRICE,
      currency: "EGP",
      intervalDays: PLAN_INTERVAL_DAYS,
      balanceLane: SubscriptionCreditLane.Hifz,
    });
    planId = plan.id;
  });
});

afterAll(async () => {
  if (!live) {
    return;
  }
  await browser?.close();

  // Env hygiene: the beforeAll deleted the tunnel keys from the test
  // process; the runner's --env-file reload restores them for the next
  // process, so nothing to re-install here — the deletion is process-local.

  // FK-safe teardown of everything the flow created: notifications first,
  // then EVERY payment row the run's student owns under the sanctioned
  // suspension (the flow's payment id is discovered by sweep — the append-
  // only ledger is trigger-immutable, so the user delete's SET NULL cascade
  // on it would fail the trigger), then the junction rows, then the user
  // (which removes the subscription row) — the plan last.
  if (studentUserId > 0) {
    await db.delete(notifications).where(eq(notifications.userId, studentUserId));
  }
  if (studentUserId > 0) {
    const ownedPayments = await db
      .select({ id: studentPayments.id })
      .from(studentPayments)
      .where(eq(studentPayments.studentId, studentUserId));
    if (ownedPayments.length > 0) {
      await withImmutabilityTriggersSuspended(["student_payments"], () =>
        db.delete(studentPayments).where(
          inArray(
            studentPayments.id,
            ownedPayments.map(row => row.id)
          )
        )
      );
    }
  }
  if (studentUserId > 0) {
    await db.delete(studentSubscriptions).where(eq(studentSubscriptions.studentId, studentUserId));
    if (subscriptionIds.length > 0) {
      await db.delete(studentSubscriptions).where(inArray(studentSubscriptions.subscriptionId, subscriptionIds));
    }
  }
  if (studentUserId > 0) {
    await deleteUsersByIds([studentUserId]);
  }
  if (planId > 0) {
    await db.delete(plans).where(eq(plans.id, planId));
  }
  const residue = countUsersByIds(studentUserId > 0 ? [studentUserId] : []);
  if ((await residue) !== 0) {
    throw new Error("e2e teardown: student user row survived cleanup");
  }
});

test.skipIf(!live)(
  "student purchase funnel — catalog → hosted checkout → tunnel webhook → active subscription",
  async () => {
    const context: BrowserContext = await browser.newContext({
      userAgent: DESKTOP_UA,
      viewport: { width: 1440, height: 900 },
    });

    // ── Register + sign in over the real API ──────────────────────────────
    const registered = await context.request.post(`${BASE}/api/graphql`, {
      data: {
        query: "mutation RegisterUser($input: RegisterUserInput!) { registerUser(input: $input) { id email role } }",
        variables: {
          input: {
            fullName: "Paymob E2E Student",
            email: STUDENT_EMAIL,
            phone: "+201000000000",
            password: STUDENT_PASSWORD,
            gender: null,
            country: "EG",
            role: "Student",
            preferredRecitation: "HAFS_AN_ASIM",
          },
        },
      },
    });
    const registration = await registered.json();
    studentUserId = registration?.data?.registerUser?.id ?? 0;
    expect(studentUserId).toBeGreaterThan(0);

    const login = await context.request.post(`${BASE}/api/graphql`, {
      data: {
        query:
          "mutation Login($email: String!, $password: String!) { login(email: $email, password: $password) { user { id role } accessToken } }",
        variables: { email: STUDENT_EMAIL, password: STUDENT_PASSWORD },
      },
    });
    const loginBody = await login.json();
    expect(loginBody?.data?.login?.user?.role).toBe("Student");
    // The default locale IS the app default ("ar"): the page renders Arabic
    // without a NEXT_LOCALE cookie, matching getDefaultTranslations() below.

    // ── Wire observation: exactly ONE purchase mutation with its key ──────
    const purchasePosts: { idempotencyKey: string | null; body: string }[] = [];
    const page = await context.newPage();
    page.on("request", request => {
      if (request.method() !== "POST" || !request.url().includes("/api/graphql")) {
        return;
      }
      const body = request.postData() ?? "";
      if (body.includes("purchaseSubscription")) {
        purchasePosts.push({ idempotencyKey: request.headers()["x-idempotency-key"] ?? null, body });
      }
    });

    // ── Catalog → confirm → redirect ──────────────────────────────────────
    await page.goto(`${BASE}/student/plans`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    // The funnel's own card: the innermost div containing BOTH the unique
    // title and a subscribe affordance — the catalog renders other plans
    // (journey leftovers), so the title alone cannot disambiguate.
    const planCard = page
      .locator("div")
      .filter({ hasText: PLAN_TITLE })
      .filter({ has: page.getByRole("button", { name: CHECKOUT.buyButton }) })
      .last();
    await planCard
      .getByRole("button", { name: CHECKOUT.buyButton })
      .first()
      .waitFor({ state: "visible", timeout: 60_000 });
    await page.screenshot({ path: join(SHOT_DIR, "01-catalog.png") });
    await planCard.getByRole("button", { name: CHECKOUT.buyButton }).first().click();

    const dialog = page.getByRole("dialog");
    await dialog.waitFor({ state: "visible", timeout: 20_000 });
    await dialog.getByText(PLAN_TITLE).waitFor({ state: "visible", timeout: 10_000 });
    await page.screenshot({ path: join(SHOT_DIR, "02-confirm-dialog.png") });
    await dialog.getByRole("button", { name: CHECKOUT.confirmButton }).click();

    await page.waitForURL(/paymob\.com/, { timeout: 60_000 });
    expect(purchasePosts).toHaveLength(1);
    expect(purchasePosts[0]?.idempotencyKey).not.toBeNull();

    // ── Hosted checkout: pay with the sandbox test card ───────────────────
    await page.waitForSelector("#pay-button", { timeout: 45_000 });
    await page.screenshot({ path: join(SHOT_DIR, "03-hosted-checkout.png") });
    await page.locator("#name").fill(CARD.holder);
    await page.locator("#number").fill(CARD.number);
    await page.locator("#expiry").fill(CARD.expiry);
    await page.locator("#cvc").fill(CARD.cvv);
    await page.screenshot({ path: join(SHOT_DIR, "04-card-filled.png") });
    await page.locator("#pay-button").click();

    // ── 3DS/processing → redirect home through the tunnel ─────────────────
    const settle = await waitForSettlement(page, context);
    await page.screenshot({ path: join(SHOT_DIR, "05-after-settlement.png") });
    expect(settle.landedOnApp).toBe(true);

    // The auth cookie is SameSite=Strict (correct production posture): the
    // cross-site redirect back from Paymob carries no credentials, so the app
    // bounces to its login page. Re-authenticate over the wire (the
    // credentials this run minted) and return to the result page.
    await reauthenticate(context);
    await page
      .goto(`${BASE}/student/checkout/result${settle.resultQuery ?? ""}`, {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      })
      .catch(() => undefined);

    // ── Settlement: the processed callback lands on the real receiver ─────
    // On a tunnel-enabled deployment the vendor delivers the webhook itself;
    // on the simulation channel (this environment — the ngrok free tier 502s
    // the vendor's non-browser deliveries) the same settlement is driven
    // through the resolved channel's development delivery surface, which
    // traverses the REAL webhook gate → parse → activation path. Either way
    // the pair settles through production code.
    const reference = await pollForPendingReference(context);
    expect(reference).not.toBeNull();
    if (reference) {
      await deliverSettlementThroughChannel(reference);
    }

    // ── Result page renders the success branch ────────────────────────────
    // The page rendered (pending branch) before the delivery settled the
    // pair — the result page is an authoritative re-query snapshot, not a
    // live subscription, so reload it now that the webhook has landed.
    await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.getByText(CHECKOUT.resultSuccessTitle).waitFor({ state: "visible", timeout: 60_000 });
    await page.screenshot({ path: join(SHOT_DIR, "06-result-success.png") });

    // ── Authoritative state: the webhook settled the pending pair ─────────
    const active = await pollForActiveSubscription(context);
    expect(active).not.toBeNull();
    if (active) {
      subscriptionIds.push(active.id);
    }

    // ── The subscriptions list shows the active row ───────────────────────
    await page.goto(`${BASE}/subscriptions`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.getByText(CHECKOUT.subscriptionsPageTitle).waitFor({ state: "visible", timeout: 60_000 });
    await page.getByText(CHECKOUT.statusActive).first().waitFor({ state: "visible", timeout: 30_000 });
    await page.screenshot({ path: join(SHOT_DIR, "07-subscriptions-active.png") });

    // Exactly ONE purchase mutation was ever sent.
    expect(purchasePosts).toHaveLength(1);
    await context.close();
  }
);

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface SettlementOutcome {
  readonly landedOnApp: boolean;
  readonly finalUrl: string;
  /** The result page's query string (`?id=...&hmac=...`), when present. */
  readonly resultQuery?: string;
}

/** Extracts the result-page query string from a login-redirect or direct URL. */
function extractResultQuery(url: string): string {
  const marker = "/student/checkout/result";
  const index = url.indexOf(marker);
  if (index === -1) {
    return "";
  }
  const tail = url.slice(index + marker.length);
  const queryStart = tail.indexOf("?");
  return queryStart === -1 ? "" : tail.slice(queryStart);
}

/**
 * Signs in again over the wire — the SameSite=Strict auth cookie was not
 * sent on the cross-site redirect back from Paymob.
 */
async function reauthenticate(context: BrowserContext): Promise<void> {
  const response = await context.request.post(`${BASE}/api/graphql`, {
    data: {
      query:
        "mutation Login($email: String!, $password: String!) { login(email: $email, password: $password) { user { id role } accessToken } }",
      variables: { email: STUDENT_EMAIL, password: STUDENT_PASSWORD },
    },
  });
  const body = await response.json();
  if (body?.data?.login == null) {
    throw new Error("re-authentication after the gateway redirect failed");
  }
}

/**
 * Follows the post-pay chain to a landing: the vendor may spend time in its
 * processing/3DS step, may surface an issuer OTP challenge (answered with
 * the sandbox OTP), and must finally redirect to the app — directly or via
 * the ngrok free-domain interstitial, which the flow clicks through.
 */
async function waitForSettlement(
  page: import("playwright").Page,
  _context: BrowserContext
): Promise<SettlementOutcome> {
  const outcome = await settlementPollStep(page, Date.now() + 180_000);
  if (outcome) {
    return outcome;
  }
  throw new Error(`post-pay settlement never landed (last url: ${page.url()})`);
}

/**
 * One settle-poll step (recursive instead of a loop so no `await` sits
 * inside loop syntax): sleeps, classifies the current page state, and
 * recurses until the deadline — an interstitial click or an OTP answer
 * short-circuits to the next poll, a landing returns the outcome, and the
 * vendor's failure surface throws.
 */
async function settlementPollStep(
  page: import("playwright").Page,
  deadline: number
): Promise<SettlementOutcome | null> {
  if (Date.now() >= deadline) {
    return null;
  }
  // Synchronization on observable change: the settle chain is a sequence of
  // navigations (processing → 3DS → redirect) — wait for the URL to change
  // from the snapshot this step classified, or the deadline to elapse.
  const urlBefore = page.url();
  await page
    .waitForURL(url => url.toString() !== urlBefore, { timeout: Math.min(5_000, deadline - Date.now()) })
    .catch(() => undefined);
  const url = page.url();

  // The ngrok free-tier interstitial: click through once per session.
  const visitSite = page.getByRole("button", { name: /visit site/i });
  if ((await visitSite.count()) > 0) {
    await visitSite.first().click();
    return settlementPollStep(page, deadline);
  }

  // The issuer 3DS challenge: answer with the sandbox OTP.
  const otpInput = page.locator(
    "input[name='otp'], input[id='otp'], input[placeholder*='OTP'], input[placeholder*='otp']"
  );
  if ((await otpInput.count()) > 0 && (await otpInput.first().isVisible())) {
    await otpInput.first().fill(CARD.otp);
    await otpInput.first().press("Enter");
    return settlementPollStep(page, deadline);
  }

  if (url.includes("localhost:3100") || url.startsWith(BASE)) {
    if (url.includes("/student/checkout/result") || url.startsWith(BASE)) {
      return { landedOnApp: true, finalUrl: url, resultQuery: extractResultQuery(url) };
    }
  }
  // The vendor redirected to the dashboard-configured callback origin
  // (dev :3000) instead of the test server — the same app on another
  // local port. The result-page parameters ride the redirect URL either
  // way; the authoritative state is asserted against the TEST server.
  if (
    /localhost:\d+\/login\?redirect=%2Fstudent%2Fcheckout%2Fresult|localhost:\d+\/student\/checkout\/result/i.test(url)
  ) {
    return { landedOnApp: true, finalUrl: url, resultQuery: extractResultQuery(url) };
  }
  if (url.includes("payment-status")) {
    // The vendor's post-pay surface hosts BOTH the success countdown
    // ("Thanks for your payment / Re-directing you to Merchant's
    // Website") and the failure page — the visible copy decides, never
    // the URL. Success confirmed vendor-side and still-processing (3DS
    // spinner) both keep polling for the app landing.
    const text = await page.evaluate(() => document.body.innerText.slice(0, 400));
    if (/something went wrong|unable to process/i.test(text)) {
      throw new Error(`hosted checkout answered the failure surface: ${text}`);
    }
  }
  return settlementPollStep(page, deadline);
}

/** Polls the authoritative subscriptions read until the flow's plan is ACTIVE. */
async function pollForActiveSubscription(
  context: BrowserContext
): Promise<{ id: number; status: string; planId: number | string } | null> {
  return activeSubscriptionPollStep(context, Date.now() + 120_000);
}

/**
 * One authoritative-subscriptions poll step (recursive instead of a loop so
 * no `await` sits inside loop syntax): queries, matches, and recurses until
 * the deadline, sleeping between attempts.
 */
async function activeSubscriptionPollStep(
  context: BrowserContext,
  deadline: number
): Promise<{ id: number; status: string; planId: number | string } | null> {
  if (Date.now() >= deadline) {
    return null;
  }
  const response = await context.request.post(`${BASE}/api/graphql`, {
    data: { query: "query MySubscriptions { mySubscriptions { id status planId } }" },
  });
  const payload = await response.json();
  const rows: { id: number; status: string; planId: number | string }[] = payload?.data?.mySubscriptions ?? [];
  const match = rows.find(row => String(row.planId) === String(planId) && row.status === "Active");
  if (match) {
    return match;
  }
  await pollInterval(3_000);
  return activeSubscriptionPollStep(context, deadline);
}

/**
 * Reads the flow's payment reference from the authoritative subscriptions
 * read — the correlation key the settlement delivery carries.
 */
async function pollForPendingReference(context: BrowserContext): Promise<string | null> {
  return pendingReferencePollStep(context, Date.now() + 30_000);
}

/**
 * One pending-reference poll step (recursive instead of a loop so no
 * `await` sits inside loop syntax): queries, matches, and recurses until
 * the deadline, sleeping between attempts.
 */
async function pendingReferencePollStep(context: BrowserContext, deadline: number): Promise<string | null> {
  if (Date.now() >= deadline) {
    return null;
  }
  const response = await context.request.post(`${BASE}/api/graphql`, {
    data: { query: "query MySubscriptions { mySubscriptions { id status planId paymentReference } }" },
  });
  const payload = await response.json();
  const rows: { id: number; status: string; planId: number | string; paymentReference: string | null }[] =
    payload?.data?.mySubscriptions ?? [];
  const match = rows.find(
    row => String(row.planId) === String(planId) && row.status === "Pending" && row.paymentReference
  );
  if (match?.paymentReference) {
    return match.paymentReference;
  }
  await pollInterval(2_000);
  return pendingReferencePollStep(context, deadline);
}

/**
 * Delivers the confirmed settlement for one reference through the resolved
 * callback channel's development delivery surface (the production HMAC
 * builder under the live `PAYMOB_HMAC_SECRET`, POSTed at the real webhook
 * receiver). On a tunnel-enabled deployment the vendor's own delivery would
 * have already settled the pair — a duplicate delivery is the byte-identical
 * replay the guarded transition acks without double effects, so this step
 * is safe in both channel modes.
 */
async function deliverSettlementThroughChannel(reference: string): Promise<void> {
  const { getCallbackChannel } = await import(
    "@/backend/services/billing/payment-gateway/callback-channel/callback-channel.factory"
  );
  const channel = await getCallbackChannel();
  const deliver = channel.deliverTestCallback;
  if (!deliver) {
    // The resolved channel is the real one (production posture) — the
    // vendor's own delivery settles the pair; nothing to drive here.
    return;
  }
  await deliver.call(channel, { reference, outcome: "confirmed", amount: PLAN_PRICE, currency: "EGP" });
}

/** The inter-attempt sleep of the API polls — each poll IS the observation. */
function pollInterval(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
