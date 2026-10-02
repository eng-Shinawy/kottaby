# Requirements & Specification: Paymob Gateway Integration — Real Subscription Payments

**Plan directory:** `ai/plans/milestone_1_core_domain_mvp/paymob-gateway-integration/`
**Specs path:** `ai/plans/milestone_1_core_domain_mvp/paymob-gateway-integration/specs.md`
**Deferred-items ledger:** `ai/plans/milestone_1_core_domain_mvp/paymob-gateway-integration/deferred-items.md`
**Outcome directory:** `ai/plans/milestone_1_core_domain_mvp/paymob-gateway-integration/outcome/`

## Document Information

- **Feature Name**: Paymob Gateway Integration — real subscription purchase payments + purchase funnel
- **Ticket Reference**: `docs/planning/MILESTONE_PLAN.md:161` (Milestone-1 risk row: "Mock payment service for development; integrate real gateway in Milestone 2") + the subscription-purchase plan's forward contract at `ai/plans/milestone_1_core_domain_mvp/subscription-purchase-payment-gateway/deferred-items.md:45` ("Real payment gateway adapter (Paymob/Stripe) + purchase UI funnel — Milestone-2 gateway ticket"). No `docs/planning/TICKETS.md` entry exists for this work (grep `paymob` → zero hits, verified 2026-09-07); the directory therefore carries NO invented ticket id.
- **Target Directory**: `ai/plans/milestone_1_core_domain_mvp/paymob-gateway-integration/`
- **Outcome Directory**: `ai/plans/milestone_1_core_domain_mvp/paymob-gateway-integration/outcome/`
- **Companion Plan**: `ai/plans/milestone_1_core_domain_mvp/paymob-gateway-integration/plan.md`
- **Companion Tasks**: `ai/plans/milestone_1_core_domain_mvp/paymob-gateway-integration/tasks.md`
- **Blocked By**: nothing in-repo — the subscription-purchase backend (`ai/plans/milestone_1_core_domain_mvp/subscription-purchase-payment-gateway/`) has LANDED: `PaymentGatewayPort` + mock adapter + factory (`backend/services/billing/payment-gateway/`), purchase/activation services, `purchaseSubscription`/`mySubscriptions` GraphQL operations, the provider-ack-exempt webhook route (`app/api/payments/webhook/route.ts`), and the canonical contract `docs/billing/subscription-purchase.md` (**Active**). This plan EXTENDS those existing seams (amendments A1–A5 in `deferred-items.md`) and MUST NOT fork them.
- **Version**: 1.0 · **Date**: 2026-09-07 · **Author**: Spec Plan Generator (research-swarm assisted)
- **Stakeholders**: Dev 1 stream (billing owner), students (paying audience), academy admins (revenue observability), Paymob account owner (dashboard + credentials)

## Introduction

### Feature Summary

Kottaby's subscription purchase flow (the subscription-purchase plan) plans a provider-agnostic `PaymentGatewayPort` with a mock adapter: `purchaseSubscription` mints a pending subscription + pending payment, and activation happens only through the port's webhook-event contract. This plan lands the first REAL adapter on that port — Paymob (Egypt-first gateway: cards with 3DS, mobile wallets incl. Vodafone Cash) — plus everything only a real gateway needs (HMAC-verified callback receiver, checkout redirect URL construction, credential/env configuration, a stuck-pending reconciliation sweep) and the student purchase funnel UI that the subscription-purchase plan explicitly deferred to this ticket (the subscription-purchase plan REQ-064).

### Business Value

- Students can pay real money (EGP) for subscriptions via cards (3DS) and mobile wallets — the marketplace revenue switch.
- Egypt-first method mix (Vodafone Cash, Orange Cash, e& money…) matches the academy audience; Unified Checkout keeps PCI scope outside our servers (no PAN ever touches Kottaby).
- HMAC-verified server-to-server fulfillment plus a reconciliation backstop means paid money always becomes an active subscription, even when a callback is lost.

### Scope

**IN:**

1. Paymob adapter implementing the subscription-purchase plan's planned `PaymentGatewayPort` (intention creation + checkout descriptor + webhook-event parsing/verification).
2. HMAC-SHA512 callback verification module (transaction callbacks, POST-nested + GET-flat key variants; safe no-op handling of TOKEN / refund / void callback shapes).
3. The single provider-dispatched webhook receiver at the EXISTING `app/api/payments/webhook/route.ts` (Paymob branch extension), incl. route-registration verification.
4. `PAYMOB_*` + optional `NGROK_*` env/config registration via the real `backend/lib/env.ts` mechanism + `.env.example` placeholder entries for ALL new keys + CI-safe test defaults (`backend/lib/test-ci-env.ts`).
5. Webhook fulfillment wiring into the subscription-purchase plan's activation surface + `payment_confirmation` notification emission + replay/idempotency semantics.
6. Schema delta: `student_payments.provider_transaction_id` + immutability-trigger allowance (migration + SQLite pair).
7. Reconciliation sweep: cron route + transaction-inquiry backstop for payments stuck `pending` (active only when `PAYMOB_API_KEY` is set).
8. Student purchase funnel UI: plan catalog page, checkout initiation + redirect, payment result page, my-subscriptions page; new i18n namespace; Storybook stories.
9. Callback channel factory (D14, REQ-090..094): single-source `getCallbackChannel()` resolving `real` / `ngrok` / `simulation`; FULL simulation implementation (signed synthetic callbacks against the local webhook); optional ngrok channel gated on `NGROK_AUTHTOKEN` + `NGROK_DOMAIN` + reachability probe.

**OUT:**

- Paymob-native subscription module (`api/acceptance/subscription-plans` et al.) — Kottaby subscriptions are one-time plan purchases, not gateway-side recurring debits.
- Saved cards / CIT / MIT (`token`, `card_tokens`, Moto) — not needed for one-time purchases.
- Refund / Void / Capture execution — forward item for the admin lane (the admin refund-lane ticket family); callbacks for them are still safely ignored (REQ-026).
- BNPL / installments, Apple Pay, Pixel embedded checkout (Unified Checkout redirect is the chosen experience), payouts, non-EGY regions.
- the subscription-purchase plan-owned machinery: `PaymentGatewayPort` types, factory, mock adapter, `SubscriptionRepository`/`StudentPaymentRepository`, purchase service, GraphQL `purchaseSubscription`/`mySubscriptions` resolvers, claim table. This plan EXTENDS a SUBSET of those seams (see §2 REQs) and MUST NOT fork them.
- Admin refund/plan-management UI; teacher wallet flows (untouched).

---

## 1. Executive Summary & Problem Statement

**Problem.** The gateway port, purchase service, and webhook receiver now exist in code (mock-adapter shape — ground-truth table below), but only the mock provider is wired behind them: no real adapter exists, so money cannot actually move, and the purchase funnel UI is still absent (the deferred REQ-064 forward item). A real adapter + HMAC-verified callback branch + funnel are required, and Paymob's contract (intention API, HMAC, callback cadence) imposes precise, non-obvious requirements (20-key HMAC order, integer cents, `special_reference` correlation) that this plan pins down so implementation is mechanical.

**Approach (summary of `plan.md`).** Paymob adapter behind the subscription-purchase plan's port; single provider-dispatched webhook route with verify-before-trust; fulfillment via the subscription-purchase plan's activation service; configurable checkout host (live docs moved it — see D-notes); student funnel screens per the subscription-purchase plan's prototype states.

**Ground-truth verification table** (row = substrate this plan consumes; verified 2026-09-07):

| Substrate | State | Evidence |
|---|---|---|
| `PaymentGatewayPort` / `PaymentCheckoutInput` / `PaymentCheckoutSession` / `PaymentWebhookEvent` | **EXIST** (mock-shaped: input is `{studentId, planId, amount, currency}`; parse takes `rawBody` only — amendments A1–A3) | `backend/types/billing/payment-gateway.types.ts:12-17,26-30,41-46,55-58` |
| Mock adapter + `getPaymentGateway()` factory | **EXIST** | `backend/services/billing/payment-gateway/mock-payment-gateway.adapter.ts`, `payment-gateway.factory.ts`; env registration in `backend/lib/env.ts` (`PAYMENT_GATEWAY_PROVIDER` default `mock`, `PAYMENT_WEBHOOK_SECRET`, `PAYMENT_WEBHOOK_ENABLED`, ~:229-278 with getters ~:416+) |
| Purchase service / `purchaseSubscription` mutation / `mySubscriptions` query | **EXIST** | `backend/services/billing/subscription-purchase.service.ts`, `backend/graphql/mutation/subscription-purchase.mutation.ts`, `backend/graphql/query/subscription.query.ts`; canonical contract `docs/billing/subscription-purchase.md` (Active) |
| Webhook route | **EXISTS** (kill switch → bare 404; 64 KiB bounded body; mock-branch HMAC-SHA256 `x-payment-signature` header; delegates to `SubscriptionActivationService.processWebhookEvent`) | `app/api/payments/webhook/route.ts`; registered `{ path: "/api/payments/webhook", classification: "provider-ack-exempt" }` at `backend/lib/gateway/route-inventory.ts:65` |
| `student_payments` table | **EXISTS** | `backend/db/schema/billing/student-payments.ts:23-48` (append-only via trigger `prevent_student_payments_update`, `backend/db/migration/3-immutability-triggers.sql:59-77`) |
| `subscriptions.payment_reference varchar(255)` | **EXISTS** | `backend/db/schema/billing/subscriptions.ts:33` |
| `PaymentGateway.Paymob = "paymob"` | **EXISTS** | `backend/enum/billing/payment-gateway.enum.ts:10`; pgEnum `backend/db/schema/enums.ts:35-44` |
| `PaymentStatus` (`pending/paid/failed/refunded`) | **EXISTS** | `backend/enum/billing/payment-status.enum.ts:5-10` |
| Notification engine + `payment_confirmation` type | **EXISTS** | `backend/services/notifications/notification-engine.service.ts:42,79,116`; `backend/enum/notifications/notification-type.enum.ts:11` |
| `provider-ack-exempt` route classification slot | **EXISTS (unused)** | `backend/lib/gateway/route-inventory.ts:33` |
| Timing-safe bearer precedent for external callers | **EXISTS** | `app/api/cron/sweep-sessions/route.ts:66-73` |
| Env-config mechanism (`backend/lib/env.ts`) | **EXISTS** | interface `:196`, `readEnvironment()` `:233`, typed getters `:322+`, `resetEnvironmentCache()` `:279`, `getEnv/optionalEnv/requireEnv` `:286/293/303` |
| `users.phone varchar(20)` | **EXISTS** | `backend/db/schema/users/users.ts:17` |
| Student nav `/subscriptions` link | **EXISTS (dead — catch-all)** | `frontend/views/dashboard/nav/navItems.ts:112` |
| `planCatalog` query | **EXISTS** | `backend/graphql/query/plan-catalog.query.ts:18` |
| Paymob vendor docs mirror + cheatsheet | **EXISTS** | `.agents/skills/paymob-payments/references/` (119 pages on disk as of 2026-09-07, mirrored from live docs 2026-06-11) |
| the subscription-purchase plan prototype screens (funnel states) | **EXIST** | `ai/plans/milestone_1_core_domain_mvp/subscription-purchase-payment-gateway/prototype/` (12 screens) |

---

## 2. Requirements (EARS)

### 2.0 Execution Protocol & Engineering Discipline

- **REQ-001 (Baseline & Outcome Protocol)**: BEFORE any task, the executor SHALL read every file in `ai/plans/milestone_1_core_domain_mvp/paymob-gateway-integration/outcome/` (six `research-*` digests exist at authoring time), record the tsgo/biome/lint baseline counts, and after each task write `outcome/<task-id>-outcome.md`.
- **REQ-002 (Per-File Quality Loop)**: AFTER editing ANY file, the executor SHALL run `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` and reach exit 0 before touching the next file.
- **REQ-003 (i18n)**: All user-facing strings SHALL come from the compile-time locale system in `shared/locale/` (new `checkout` namespace, REQ-066); server copy via `getTranslations(locale)` / `getServerTranslations(locale)` (`shared/locale/server-graphql.ts:1-5`); zero hardcoded UI strings. Namespace registration also touches `shared/locale/types/message.ts` (`Translations`) + `shared/locale/{en,ar}/messages.ts` (REQ-066).
- **REQ-004 (Test-Runner Discipline)**: DB/service tests SHALL run via `bun run test/scripts/run-test.ts <path>`; journey tests under `test/workflows/` per `docs/testing/workflow-journey-tests.md`; NEVER raw `bun test` for DB tests.
- **REQ-005 (Enum Discipline)**: `PaymentGateway.Paymob` / `PaymentStatus.*` SHALL be value imports from `@/backend/enum/billing/…` (`payment-gateway.enum.ts:10`); string literals for enum values are prohibited.

### 2.1 Paymob Intention & Checkout (adapter core)

- **REQ-010 (Intention Creation)**: WHEN the purchase flow invokes `createCheckout` and the active provider is paymob THEN the adapter SHALL `POST {PAYMOB_API_BASE_URL}/v1/intention/` with header `Authorization: Token <PAYMOB_SECRET_KEY>` and a JSON body per `.agents/skills/paymob-payments/references/docs/intention-apis/create-intention.md` (`amount`, `currency`, `payment_methods`, `items`, `billing_data`, `special_reference`).
- **REQ-011 (Integer Cents)**: The adapter SHALL convert the plan price (decimal, 2dp) to integer cents (`amount`, `items[].amount`); IF the sum of `items[].amount` ≠ `amount` or the price has >2dp THEN the adapter SHALL throw a `ValidationError` before any network call (Paymob rejects mismatches per mirror §1).
- **REQ-012 (Billing Data Server-Side)**: `billing_data` SHALL be built server-side only from the user record: `first_name`/`last_name`/`email` (all Paymob-required) and `phone_number` (treat as required — mirror error list) from `users.phone` (`backend/db/schema/users/users.ts:17`); unfilled optional address fields SHALL use the `"NA"` placeholder convention evidenced in Paymob round-trip samples; a user with no phone on record SHALL yield placeholder `"NA"` (final behavior verified in sandbox QA — assumed tolerance, Constraints §6).
- **REQ-013 (Payment Methods)**: `payment_methods` SHALL be the configured integration IDs as INTEGERS: always `PAYMOB_INTEGRATION_ID_CARD`, plus `PAYMOB_INTEGRATION_ID_WALLET` when configured; intention `currency` SHALL equal the integration IDs' currency (EGP) — Paymob rule, mirror §1/§7.
- **REQ-014 (Correlation Key)**: The adapter SHALL send `special_reference` = the purchase-claim reference minted by the subscription-purchase plan's purchase flow, unique per intention (Paymob rejects reuse; echoed back as `merchant_order_id`). `PaymentCheckoutInput` gains a required `specialReference: string` — cross-plan amendment to the subscription-purchase plan's planned type (recorded in `deferred-items.md`).
- **REQ-015 (Response Validation)**: IF the intention response lacks `id` or `client_secret` THEN the adapter SHALL throw a domain provider error, log the sanitized upstream status, and NOT leak the upstream body to the client.
- **REQ-016 (Checkout URL)**: The adapter SHALL build `checkoutUrl = {PAYMOB_CHECKOUT_BASE_URL}?publicKey={PAYMOB_PUBLIC_KEY}&clientSecret={client_secret}`; ONLY these two params are documented (mirror §2; NO locale/theme params exist). `PAYMOB_CHECKOUT_BASE_URL` is a full host(+path) prefix: default `https://eg.checkout.paymob.com` per the live-docs host migration (docs-MCP page updated 2026-07-22 — research-02 §3 row 1; rests solely on the live-doc finding, not the mirror); the mirror-documented legacy value `https://accept.paymob.com/unifiedcheckout/` remains a valid operator-configurable fallback.
- **REQ-017 (Checkout Descriptor Contract)**: `createCheckout` SHALL return `{ provider: PaymentGateway.Paymob, providerReference: <the claim reference also sent as special_reference>, checkoutUrl }` — conforming to the subscription-purchase plan REQ-017's descriptor (`ai/plans/milestone_1_core_domain_mvp/subscription-purchase-payment-gateway/specs.md`). Rationale: the subscription-purchase plan's activation looks the purchase up by `reference == providerReference` (its `findByPaymentReference`), so `providerReference` MUST equal the value callbacks echo as `merchant_order_id`; the Paymob intention id (`pi_…`) remains recoverable via transaction inquiry and is NOT stored in the descriptor. The purchase service SHALL store `providerReference` in `subscriptions.payment_reference` per the subscription-purchase plan's flow.

### 2.2 Webhook Receiver, HMAC & Fulfillment

- **REQ-020 (Single Provider-Dispatched Receiver)**: There SHALL be exactly ONE webhook receiver at `app/api/payments/webhook/route.ts` — the route EXISTS (kill switch, bounded body, mock branch, registered `provider-ack-exempt` at `backend/lib/gateway/route-inventory.ts:65`); this plan EXTENDS it with the paymob branch (HMAC-over-query-param verification via amendment A3) and verifies the `docs/graphql/error-handling-contract.md` §Exemptions row still matches the branch behavior.
- **REQ-021 (Raw Body + Size Cap)**: The route SHALL read the raw request body as text with a dedicated bounded drain capped at `MAX_PAYMENT_WEBHOOK_BODY_BYTES = 64_000` (the subscription-purchase plan reservation); oversized bodies SHALL be rejected 413 with no processing. The gateway's `guardTransport`/`MAX_GRAPHQL_BODY_BYTES` SHALL NOT be reused (gateway-only rule).
- **REQ-022 (HMAC Before Trust)**: The route SHALL verify the `hmac` QUERY param as HMAC-SHA512 over the concatenated VALUES of the 20 documented keys in exact documented order (`references/docs/webhook-callbacks-and-hmac/hmac/hmac-transaction-callback.md`): `amount_cents, created_at, currency, error_occured, has_parent_transaction, obj.id|id, integration_id, is_3d_secure, is_auth, is_capture, is_refunded, is_standalone_payment, is_voided, order.id|order_id, owner, pending, source_data.pan, source_data.sub_type, source_data.type, success` — POST reads nested `obj.*` paths; GET (response callback) reads flat params; booleans serialize lowercase `true`/`false`; missing/null values concatenate as empty string. Comparison SHALL be timing-safe (e.g. compare SHA-256 digests of both hex strings, per `app/api/cron/sweep-sessions/route.ts:66-73` precedent) and length-agnostic.
- **REQ-023 (Fulfillment Predicate)**: Fulfillment SHALL proceed to the subscription-purchase plan's activation surface ONLY when ALL hold: (a) HMAC valid; (b) `obj.success == true` AND `obj.pending == false`; (c) `merchant_order_id` resolves to one of the caller's stored pending payments; (d) `amount_cents` == stored amount in cents AND `currency` == stored currency. IF (d) mismatches THEN the payment SHALL NOT be fulfilled and SHALL stay `pending` (reconciliation surface), with a `logDomainError` alert — never auto-mark paid on mismatched money.
- **REQ-024 (Failure & Rejection Outcomes)**: WHEN a verified callback says `success == false` THEN the payment SHALL transition `pending → failed` and a failure notification SHALL be emitted. WHEN HMAC verification fails THEN the route SHALL respond 401, change NOTHING, and log via `logDomainError` with correlation id. WHEN `merchant_order_id` is unknown THEN the route SHALL respond 200 with no-op (no oracle) and log.
- **REQ-025 (Idempotent Replay)**: WHEN a callback arrives for an already-`paid` payment THEN the route SHALL respond 200 with zero state change; the guarded `pending→paid` transition (the subscription-purchase plan's mark-once guard) is the mechanism — a second delivery is a no-op by construction.
- **REQ-029 (Auto Callback Retrial Resilience)**: The Paymob dashboard offers an **"Auto Callback Retrial"** toggle: when active, a FAILED callback delivery (non-2xx response or unreachable endpoint) is retried up to 15 times with a doubling interval (dashboard copy, verbatim: *"Failed callbacks will retry up to 15 times, with the interval doubling after each attempt. Ensure your system handles duplicate callbacks to avoid recording multiple transactions."* — NOT in the 2026-06-11 mirror; newer dashboard feature). The plan SHALL treat this as enabled-by-default guidance (see plan.md §10 provisioning): (a) EVERY replay/duplicate SHALL ack 200 with zero state change (guarded transition — REQ-025; no "recording" exists apart from the settlement decision itself, so duplicates cannot record multiple transactions); (b) 400/401/413/404 responses SHALL stay as specified but are acknowledged as retrial triggers — an operator who flips `PAYMENT_GATEWAY_PROVIDER` away from paymob without disabling the integration's callbacks gets 15× noise, not a correctness issue; (c) a verified callback that hits a genuine 500 (transient infra/DB failure) SHALL be relied on to arrive again via retrial — this is now a REAL resilience path, and the reconciliation sweep (REQ-035) becomes the POST-retrial backstop rather than the only one.
- **REQ-026 (Known Callback Variants Are Safe No-Ops)**: WHEN the payload is a card-token callback (`type: "TOKEN"`, distinct HMAC key list per `hmac-for-card-tokens.md`) or a refund/void action callback (expected shape `is_refund`/`is_void` true with `has_parent_transaction` true — the mirror confirms action callbacks fire and the fields exist; the exact flag combination is validated in sandbox QA per `deferred-items.md`) THEN the route SHALL verify per-variant where applicable, respond 200, change nothing, and log a domain line. Unknown/absent `type` values SHALL also be 200 no-op (never a 5xx that invites retries).
- **REQ-027 (Response Callback Is Display-Only)**: The GET redirect (flat params incl. `order`/`order_id` — mirror discrepancy noted) SHALL NEVER trigger state changes; the result page treats it as hints only and derives truth from re-querying `mySubscriptions` (REQ-063).
- **REQ-028 (Payment Confirmation Notification)**: On fulfillment success or failure the receiver SHALL emit `NotificationType.PaymentConfirmation` (`backend/enum/notifications/notification-type.enum.ts:11`) via `NotificationEngine.emitForUser` (`notification-engine.service.ts:42`) with persist-first in the SAME transaction and `publishReceipts` (`:116`) AFTER commit (realtime engine contract), idempotency key `payment:<paymobTransactionId>:confirmation`.

### 2.3 Concurrency, Integrity & Reconciliation

- **REQ-030 (Single Activation Transaction)**: Fulfillment SHALL execute inside the subscription-purchase plan's activation transaction surface (subscription activation + lane crediting + payment status + notification persist in ONE tx); this plan SHALL NOT re-implement or bypass it.
- **REQ-031 (Provider Transaction Reference)**: `student_payments` SHALL gain a nullable `provider_transaction_id varchar(64)` column, and the immutability trigger SHALL be amended (NEW migration `5-student-payments-provider-transaction.sql` + SQLite pair, layered on the subscription-purchase plan's planned `4-student-payments-status-transition.sql`) to permit setting `provider_transaction_id` ONLY as NULL→value in the same guarded `pending→paid|failed` transition; all other columns remain frozen. The fulfillment update SHALL write it from the verified callback's transaction id (`obj.id`), which mandates the additive extension `PaymentWebhookEvent.providerTransactionId?: string` (cross-plan amendment — recorded in `deferred-items.md`).
- **REQ-032 (Network Outside Transactions)**: The intention-creation HTTP call SHALL happen OUTSIDE any DB transaction (the subscription-purchase plan plan §4.1 pattern); webhook fulfillment SHALL NOT call Paymob APIs.
- **REQ-033 (No Mutable Module State)**: The adapter, HMAC module, route, and sweep SHALL hold NO module-level mutable state; Paymob `api/auth/tokens` tokens SHALL NOT be cached across reconciliation runs (1-hour token TTL per mirror §6 makes caching pointless complexity).
- **REQ-034 (Duplicate-Delivery Race)**: Concurrent callbacks for the same payment SHALL resolve through the single guarded transition; the racing loser observes zero-row guard and returns 200 no-op.
- **REQ-035 (Reconciliation Sweep)**: WHEN `PAYMENT_GATEWAY_PROVIDER=paymob` AND `PAYMOB_API_KEY` is set THEN a NEW cron route `app/api/cron/reconcile-paymob-payments/route.ts` (bearer-secret gated per `sweep-sessions` precedent; ROUTE_INVENTORY registration) SHALL sweep `student_payments` stuck `pending` beyond a threshold (default 30 min), per payment: mint auth token (`POST api/auth/tokens`), query `POST api/ecommerce/orders/transaction_inquiry` by `merchant_order_id`, and funnel PAID/UNPAID outcomes through the SAME fulfillment/failure path as the webhook (REQ-023/024).
- **REQ-036 (Sweep Discipline)**: The sweep SHALL process a bounded batch (cap 50/run), SHALL log each outcome, SHALL skip (with log) when the API key or provider is absent (not an error), and SHALL be independently idempotent (guarded transitions only).

### 2.3a Callback Channel (dev delivery single source of truth)

- **REQ-090 (Callback Channel Factory)**: There SHALL be exactly ONE source of truth for "how a callback reaches the receiver" outside production: `CallbackChannelPort` (`backend/types/billing/callback-channel.types.ts`) + a lazy `getCallbackChannel()` factory (`backend/services/billing/payment-gateway/callback-channel/callback-channel.factory.ts`, mirroring the `getPaymentGateway()` shape). Consumers — intention URL composition, dev tooling, workflow/journey tests — SHALL consult ONLY the factory; direct `process.env.NGROK_*` reads or per-file tunnel logic are PROHIBITED.
- **REQ-091 (Channel Resolution)**: The factory SHALL resolve `real` when `NODE_ENV` is production or `PAYMENT_GATEWAY_PROVIDER ≠ paymob`; `ngrok` ONLY when running in development AND BOTH `NGROK_AUTHTOKEN` and `NGROK_DOMAIN` are set AND the channel's reachability probe succeeds; `simulation` in every other development case, with ONE structured info log naming the fallback reason. The ngrok channel is optional operator configuration — absent envs are NOT an error and never block the dev flow.
- **REQ-092 (Ngrok Channel)**: WHEN selected, the ngrok channel SHALL spawn the ngrok agent CLI with `ngrok http --url="https://<NGROK_DOMAIN>" <NGROK_PORT>` (`--url`, not the deprecated `--domain`, per ngrok 3.39), VERIFY reachability by probing the PUBLIC `https://<NGROK_DOMAIN>` URL (never the local agent API, which may already be used by another agent on the host), expose `publicBaseUrl = https://<NGROK_DOMAIN>`, and the intention mapper SHALL use `https://<NGROK_DOMAIN>/api/payments/webhook` as the dev per-intention `notification_url`. Any probe failure SHALL fall back to `simulation` (not a hard error). `NGROK_PORT` defaults to `3000`.
- **REQ-093 (Simulation Channel — fully implemented default)**: The simulation channel SHALL be a complete implementation, not a stub: it SHALL synthesize a Paymob-shaped processed callback (nested `obj` with the 20 HMAC-key values), sign it with the PRODUCTION HMAC builder (**`paymob.hmac.ts`** — no parallel signer) using the configured `PAYMOB_HMAC_SECRET`, and POST it with `?hmac=<digest>` to the local webhook surface (`http://localhost:<dev-port>/api/payments/webhook`). It SHALL support confirm/fail/replay and cross-user scenarios end-to-end, SHALL be selectable ONLY in development (`NODE_ENV !== "production"`; a fail-closed guard inside the channel throws if invoked in production), and SHALL pass the SAME verification/fulfillment pipeline as a real Paymob callback (no shortcuts).
- **REQ-094 (Tests Through The Factory)**: Workflow/journey and any channel-dependent tests SHALL resolve the channel via `getCallbackChannel()`: when the factory resolves `ngrok`, tests exercise REAL Paymob delivery through the tunnel; when it resolves `simulation`, the same scenarios run against simulated callbacks. Test files and services SHALL NOT contain their own ngrok env checks.

### 2.4 Security, Authorization & Tenancy

- **REQ-040 (Server-Side Secret Hygiene)**: `PAYMOB_SECRET_KEY`, `PAYMOB_HMAC_SECRET`, `PAYMOB_API_KEY` SHALL exist only server-side and never reach the client bundle; only `PAYMOB_PUBLIC_KEY` is client-visible (inside the checkout URL — Paymob-documented client-safe). Secret material SHALL flow through the typed config in `backend/lib/env.ts` with masked error surfaces.
- **REQ-041 (Webhook Route Gating)**: The webhook receiver SHALL require NO session and NO bearer (HMAC is its authentication). Gating is PER-BRANCH: WHEN the paymob branch is hit while `PAYMENT_GATEWAY_PROVIDER ≠ paymob` THEN the route SHALL return bare 404 (no envelope — cron `ENDPOINT_GONE_STATUS` precedent); the route's overall availability follows the ACTIVE provider's own gate (the mock branch keeps the subscription-purchase plan's `PAYMENT_WEBHOOK_ENABLED` semantics), so the single receiver never locks out the mock flow.
- **REQ-042 (Fail-Closed Provider Config)**: IF `PAYMENT_GATEWAY_PROVIDER=paymob` and any of `PAYMOB_SECRET_KEY`/`PAYMOB_PUBLIC_KEY`/`PAYMOB_HMAC_SECRET`/`PAYMOB_INTEGRATION_ID_CARD` is missing or empty THEN adapter routes SHALL fail with a clear `SERVICE_UNAVAILABLE`-class domain error at request time (never silently fall back to mock in production) and the invariant SHALL be covered by unit tests.
- **REQ-043 (Log Redaction & Correlation)**: Webhook + adapter logs SHALL pass through the redacting logger (`@/backend/lib/logger`); every inbound call SHALL be correlated via `resolveRequestId(request.headers)` (`backend/lib/api/api-response.ts`); Paymob callback bodies SHALL be logged summarized (ids/status, never full payload).
- **REQ-044 (BOPLA — Client Sends Plan Only)**: The purchase interaction SHALL accept only the plan id from the client; amount, currency, billing data, and narration SHALL be derived server-side from the plan catalog row + the user record (the subscription-purchase plan contract preserved).
- **REQ-045 (BFLA & Tenancy Unchanged)**: Purchase, result, and my-subscriptions surfaces SHALL remain student-scoped (`authScopes` role student on the GraphQL side per the subscription-purchase plan; `withPageAuth({ roles: [UserRole.Student] })` on pages); identity SHALL derive from session context, never from input (the subscription-purchase plan contract preserved).

### 2.5 Validation, Errors & Localization

- **REQ-050 (Upstream Error Mapping)**: Paymob API failures SHALL map to domain errors: 404 integration-id / 400 validation → config/validation domain error logged verbatim server-side, client receives a generic localized "payment unavailable, try again later"; network/5xx responses SHALL pass through `retryTransient` with bounded attempts.
- **REQ-051 (Idempotent Intention Retry)**: Retry of `create-intention` SHALL be permitted ONLY when no response was received, and SHALL reuse the SAME `special_reference` (Paymob's uniqueness rule makes the retry safe); after a response of unknown application state, the flow SHALL stop and rely on the reconciliation sweep rather than blind POSTs.
- **REQ-052 (Localized Funnel Copy)**: All funnel/result/subscription strings SHALL come from the new `checkout` namespace (REQ-066) + the existing `errors` namespace for transport errors; parity test SHALL assert key parity across `en`/`ar`.
- **REQ-053 (Webhook Response Contract)**: The receiver SHALL respond `200` for processed / ignored / replayed / unknown-merchant-reference outcomes (ack semantics), `400` for malformed JSON or missing `hmac`, `401` for invalid HMAC, `404` when the paymob provider is inactive, `413` when over the body cap, `500` otherwise; response bodies follow the provider-ack exemption (minimal ack JSON, not the GraphQL envelope).
- **REQ-054 (Money Display)**: UI SHALL render amounts as localized EGP strings (Intl/`toLocaleString` with the active locale) from server-provided minor/major units — no client-side float math on money.

### 2.6 UX, Navigation & GraphQL Consumption

- **REQ-060 (Student Plan Catalog Page)**: A student-facing plan catalog SHALL exist at `app/(dashboard)/student/plans/page.tsx` with a matching view under `frontend/views/student/plans/`, consuming the existing `planCatalog` query (`backend/graphql/query/plan-catalog.query.ts:18`), with grid/table per device tier and a Buy CTA per plan (prototype: `student-plan-catalog-default-{mobile,desktop}.png`).
- **REQ-061 (Checkout Initiation)**: Buy SHALL trigger a confirmation dialog → `purchaseSubscription` mutation (the subscription-purchase plan-owned; consumed via generated types after codegen) → on `checkoutUrl` non-null SHALL redirect via `globalThis.window.location.href` (auth-recovery idiom precedent); on the mock provider (`checkoutUrl: null`) the UI SHALL instead refetch and show the activated state.
- **REQ-062 (Purchase Idempotency UX)**: Each checkout attempt SHALL mint `randomUUID()` into a ref and send it as `x-idempotency-key` context header, rotating ONLY on success (failing submits keep the key) — pattern precedent `frontend/views/admin/broadcasts/useBroadcastComposeSend.ts:35-63`.
- **REQ-063 (Payment Result Page)**: `app/(dashboard)/student/checkout/result/page.tsx` SHALL render success/failure/pending branches; flat Paymob GET params are display hints ONLY; the authoritative status SHALL come from re-querying `mySubscriptions`; a retry CTA SHALL return to the catalog.
- **REQ-064 (My Subscriptions Page)**: `app/(dashboard)/subscriptions/page.tsx` SHALL make the existing nav link live, listing the student's subscriptions with status chips (active/pending/failed + failed-payment guidance) per prototype states `my-subscriptions-{active,pending,failed,empty}-*.png`.
- **REQ-065 (UI Standards)**: All new views SHALL comply with MUI v9 rules (sx-only styling), theme-token colors (no hardcoded hex), reduced-motion honoring, mobile/desktop tiers via `ViewportContext`, and SHALL NOT import `PageContainer`/`StatusBadge`/`AppDataGrid` (not present in-tree — research-05 §0); Storybook stories SHALL cover default/loading/empty/failed/pending arms per page.
- **REQ-066 (`checkout` i18n Namespace)**: A new namespace SHALL follow the live convention — `shared/locale/types/checkout/index.ts` labels interface, `shared/locale/en/checkout/index.ts` + `shared/locale/ar/checkout/index.ts`, `defineNamespace` registration, registration of `checkoutTranslations` in `shared/locale/types/message.ts` (`Translations`) + `shared/locale/{en,ar}/messages.ts`, plus `shared/locale/checkout-namespace.parity.test.ts` (wallet namespace as template); consumed client-side via `useAppTranslation(Checkout)` and server-side via `getTranslations(locale).checkoutTranslations`.

### 2.7 Testing Obligations

- **REQ-070 (HMAC Golden Vectors)**: The HMAC module SHALL have fixture-driven tests covering: valid POST success / POST declined / GET redirect, flipped `success`, altered `amount_cents`, a missing documented key, wrong secret, the GET `order` vs `order_id` fallback, and the card-token key list — each asserting accept/reject.
- **REQ-071 (Webhook Route Suite)**: Route-level tests SHALL cover the full REQ-053 status matrix, replay idempotency, TOKEN/refund no-ops, oversized body, and the disabled-provider 404 — with a test-secret HMAC and synthetic fixtures only (no network).
- **REQ-072 (Adapter Test Isolation)**: Adapter tests SHALL inject/mock the HTTP boundary (fetch), asserting the intention request body field-by-field, descriptor mapping, cents conversion, retry/error mapping, and the fail-closed config guard; NO live Paymob calls in CI (test credentials are for documented manual QA only).
- **REQ-073 (DB Layer)**: The schema delta SHALL be covered by `runInRollback` repository tests (provider-transaction-id set-on-transition allowed / second update frozen) per `backend/db/test` rules.
- **REQ-074 (Purchase Journey)**: A journey test under `test/workflows/` SHALL drive purchase → intention create (mocked HTTP) → synthetic verified callback → activation + lane crediting + notification persisted, on a real DB with committed fixtures and `afterAll` cleanup.
- **REQ-075 (Codegen)**: After backend GraphQL lands, `bun run generate:gqlSchema && bun codegen` SHALL be run for the funnel documents.

### 2.8 Knowledge Propagation & Spec Hygiene

- **REQ-080 (Canonical Doc)**: On completion, a canonical reference `docs/billing/paymob-gateway.md` SHALL be created (endpoints, HMAC, env keys, flows, troubleshooting, test credentials usage).
- **REQ-081 (AGENTS.md Propagation)**: Root `AGENTS.md` Important References SHALL gain a one-line pointer to the new doc; `backend/services/AGENTS.md` SHALL gain the minimal adapter rule line(s) (1–2 lines + doc reference; no implementation details).
- **REQ-082 (Ledger & Outcome Discipline)**: All deferrals SHALL land in `deferred-items.md` at identification time; the final gate SHALL verify the ledger table has zero ❌/⚠️ entries (scoped `awk … | grep -c` command in `deferred-items.md` §Enforcement) and full REQ→task traceability.

---

## 3. Cross-Actor Workflow Scenarios (Journeys)

### Journey 1 — Student purchases a plan via Paymob (happy path)

**Actor Table**

| Actor | Role / surface | Can | Cannot |
|---|---|---|---|
| STUDENT | authenticated UI + GraphQL | browse plans, start checkout, view own result/subscriptions | set amount/currency/billing fields (server-derived), view other users' payments |
| PAYMOB | external provider | receive intention, collect payment, POST processed callback, GET-redirect customer | reach our DB or services directly |
| WEBHOOK RECEIVER | `app/api/payments/webhook` (unauthenticated, HMAC-authentic) | verify + dispatch fulfillment | fulfill without valid HMAC + amount/currency match |
| ACTIVATION SURFACE (the subscription-purchase plan) | service+tx | mark paid, activate, credit lanes, persist notification | activate without verified event |
| NOTIFICATION ENGINE | `NotificationEngine` | persist + push `payment_confirmation` | translate copy (emitter's job) |
| ADMIN | — | (observability only) see revenue aggregates | no new admin surface in this plan |

**Ordered Step List**

1. STUDENT → `purchaseSubscription(planId, idempotencyKey)` → SHARED STATE: pending subscription + pending payment rows in one tx; checkout descriptor `{paymob, pi_…, URL}` returned.
2. STUDENT → browser redirected to Paymob Unified Checkout → pays (3DS card or wallet).
3. PAYMOB → POST processed callback to the webhook (source of truth) AND GET-redirects the student to the result page (hint only).
4. WEBHOOK RECEIVER → verifies HMAC → amount/currency/merchant-order checks pass → SHARED STATE: in ONE tx — payment `pending→paid`, `provider_transaction_id` set, subscription activated, lanes credited, notification row persisted; receipts published post-commit.
5. STUDENT (observer) → result page re-queries `mySubscriptions` and shows ACTIVE; payment-confirmation notification visible in the drawer.

**Cross-Actor EARS (observer perspective)**

- WHEN the processed callback verifies clean THEN the student's `mySubscriptions` SHALL show the subscription active and a `payment_confirmation` notification SHALL exist for that student.
- WHEN a forged callback (invalid HMAC) arrives THEN the payment SHALL remain `pending` and the student SHALL see NO activation and NO success notification.
- WHEN the customer abandons checkout (no callback) THEN the payment SHALL stay `pending` and the result page SHALL offer retry, and the reconciliation sweep MAY later resolve it.

**Denial / Probe Steps**

| Probe | Expectation |
|---|---|
| PARENT/TEACHER calls `purchaseSubscription` | rejected by authScopes (role) |
| Tampered `hmac` or flipped `success` flag | 401, zero state change |
| Replay of a valid paid callback | 200, no double credit (guard) |
| Forged GET redirect `success=true` with no callback | NO activation; page re-query shows pending |
| Callback amount ≠ stored amount | stays pending, domain-error log, alert |
| Direct POST without `hmac` param | 400 |
| Student opens another user's result/subscription URL | tenancy denied / empty set |

### Journey 2 — Payment fails at the gateway

1–2 as Journey 1; 3. PAYMOB POSTs processed callback with `success=false` (declined); 4. receiver verifies → SHARED STATE: `pending→failed`, subscription NOT activated, failure notification persisted+pushed; 5. STUDENT (observer) sees the failed state on the result page with a retry CTA, and `mySubscriptions` shows the failed attempt (retry produces a NEW claim/payment row — never reuses the failed one).

---

## 4. UX/Navigation Requirements

**New Routes** (no `[locale]` segment exists — locale flows from the `NEXT_LOCALE` cookie; `app/AGENTS.md` + `app/(dashboard)/wallet/page.tsx` precedent):

| Route | Page file | Purpose | Access |
|---|---|---|---|
| `/student/plans` | `app/(dashboard)/student/plans/page.tsx` | plan catalog + Buy CTA | STUDENT |
| `/student/checkout/result` | `app/(dashboard)/student/checkout/result/page.tsx` | post-payment display of status (truth from re-query) | STUDENT |
| `/subscriptions` | `app/(dashboard)/subscriptions/page.tsx` | my subscriptions list w/ statuses | STUDENT |
| `/api/payments/webhook` | `app/api/payments/webhook/route.ts` | Paymob processed-callback receiver | public, HMAC-authentic, mode-gated 404 |
| `/api/cron/reconcile-paymob-payments` | `app/api/cron/reconcile-paymob-payments/route.ts` | pending-payment reconciliation | bearer `CRON_SECRET` |

**Sidebar/Nav integration:** activate the existing student `/subscriptions` entry (`frontend/views/dashboard/nav/navItems.ts:112`); ADD a student `Plans` entry pointing at `/student/plans` following the same `labelKey` conventions (new key in the `checkout` namespace, collision-guarded per navItems typing at `:53-74`).

**Role-Based Access Matrix:** SUPER_ADMIN / ACADEMY_ADMIN / SUPERVISOR / TEACHER / PARENT → no new surfaces (denied with role redirect by `withPageAuth`); STUDENT → the three pages above; GUEST → none (login redirect).

**Per-Audience Rendering:** result page has success / failed / pending branches; my-subscriptions has active / pending / failed / empty states (prototype anchors listed in §1 table); catalog is identical content-wise on mobile/desktop with tier-appropriate containers.

## 5. Non-Functional Requirements

- **Performance**: webhook handler ack target < 2s end-to-end (fulfillment tx is small); intention creation API timeout ≤ 10s with abort signal; reconciliation batch bounded (REQ-036).
- **Security**: HMAC verify-before-parse-trust; secrets confined server-side (REQ-040); redacted logging (REQ-043); no PAN/PCI surface (Unified Checkout hosted by Paymob).
- **Reliability**: fulfill-once by construction (REQ-025/034); lost callbacks healed by sweep (REQ-035); no module-level mutable state (REQ-033); cold-start friendly (lazy env getters only).
- **Localization/Usability**: full ar/en coverage incl. RTL layout health on the funnel; money formatted via locale-aware helpers; reduced-motion honored.

## 6. Constraints & Assumptions

**Technical constraints**

1. Bun runtime `fetch` for Paymob HTTP (no official server-side TS SDK — vendor surface is REST; no dependency added).
2. No shared HTTP body-cap/rate-limit helper exists for non-GraphQL routes — the webhook owns its bounded read (REQ-021).
3. the constraints above assume the landed subscription-purchase backend; where this plan amends EXISTING contracts (`PaymentCheckoutInput.specialReference`, webhook parse signature accepting query params), the amendments are recorded in `deferred-items.md` as cross-plan amendments (A-set).
4. Codegen gate: funnel Apollo types only exist after the subscription-purchase plan's resolvers land + `bun run generate:gqlSchema && bun codegen`.

**Business / environment assumptions**

1. A Paymob Egypt merchant account with test+live key pairs, card (online 3DS) and wallet integration IDs, and dashboard callback URL access exists (obtained out-of-band; Credentials section in the canonical doc). Local development resolves callback delivery through the `getCallbackChannel()` factory (REQ-090..094): an ngrok tunnel (needs the OPTIONAL `NGROK_AUTHTOKEN` + `NGROK_DOMAIN` env pair) when reachable, otherwise the fully-implemented simulation channel — the response callback MAY stay on localhost regardless (browser redirect; details in plan.md §10.1).
2. Test/live alignment is operator-enforced: test integration IDs are used ONLY with `sk_test_*`, live IDs with `sk_live_*` (classic 404 cause — mirror §7).
3. Paymob test credentials (cards/wallet, mirror §7) are for manual QA; CI never touches Paymob.
4. `users.phone` may be empty for some accounts; `"NA"` placeholder tolerance is assumed per Paymob sample payloads and MUST be validated in sandbox QA before live rollout (noted in ledger).

---

## 7. Success Criteria

### Definition of Done

- [ ] Paymob adapter passes all checks with live `specs.md` REQs traceable to tasks (`grep` loop in final gate shows zero MISSING).
- [ ] HMAC suite: all golden + tamper vectors green (REQ-070); webhook route matrix green (REQ-071).
- [ ] Purchase journey test green end-to-end with mocked HTTP (REQ-074).
- [ ] Funnel pages live: catalog → checkout → redirect → result → my-subscriptions; Storybook arms render (REQ-060..065); zero hardcoded strings (REQ-003/066).
- [ ] `bun quality-gate` green; per-file sub-loop exit 0 on every touched file (REQ-002).
- [ ] `deferred-items.md` has no ❌/⚠️ entries (REQ-082); every outcome file written per task (REQ-001).
- [ ] Manual QA script executed on Paymob test keys: card success, card decline, wallet success, abandoned checkout, replayed callback, tampered HMAC — observed states match §3 journeys.

### Acceptance Metrics

- Purchase → activation median < 5s from processed callback receipt (webhook ack < 2s).
- Zero double-credit events across replay/duplicate storm scenarios in tests.
- 100% of touched files pass `sub-loop.ts --lifecycle duplicates` with exit 0.

---

## 8. Glossary

| Term | Meaning |
|---|---|
| **Intention** | A Paymob payment-session object created server-side (`POST v1/intention/`); carries amount/methods and yields `client_secret`. |
| **client_secret** | Paymob string that binds one intention to one hosted checkout; embedded in the Unified Checkout URL. |
| **Integration ID** | Per-method/per-currency Paymob dashboard identifier; test and live IDs are distinct sets and must match the key mode. |
| **Unified Checkout** | Paymob-hosted payment page (redirect target composed from `publicKey` + `clientSecret`). |
| **Processed callback** | Paymob's server-to-server POST with the full transaction object — the ONLY fulfillment signal. |
| **Response callback** | The customer-facing GET redirect after payment — display hints only, never authoritative. |
| **HMAC secret** | Dashboard-issued secret used to verify callback integrity (HMAC-SHA512 over the 20 documented keys). |
| **special_reference / merchant_order_id** | Our correlation key: sent at intention creation, echoed back in callbacks as `merchant_order_id`; unique per purchase attempt. |
| **Fulfillment** | The guarded transaction that marks a payment paid, activates the subscription, credits lanes, and emits the notification. |
| **Claim** | The the subscription-purchase plan purchase-intent record that makes purchase retries idempotent and anchors `special_reference`. |
| **Reconciliation sweep** | The cron backstop that resolves payments stuck `pending` via Paymob transaction inquiry. |
| **Provider-ack-exempt** | The route classification (`provider-ack-exempt`) exempting webhook ack bodies from the API envelope contract. |
| **Mock adapter** | the subscription-purchase plan's no-network adapter (provider `mock`, `checkoutUrl: null`) — default outside explicitly configured Paymob environments. |
| **Mirror** | The offline Paymob docs copy at `.agents/skills/paymob-payments/references/` (+ docs-MCP live cross-checks). |
| **Auto Callback Retrial** | Paymob dashboard per-integration toggle: failed callback deliveries retry up to 15× with doubling intervals; our receiver is exactly-once so duplicates are 200 no-ops (REQ-029). |
