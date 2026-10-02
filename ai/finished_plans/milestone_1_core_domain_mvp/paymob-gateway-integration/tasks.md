# `tasks.md` — Paymob Gateway Integration (Real Subscription Payments)

**Plan directory:** `ai/plans/milestone_1_core_domain_mvp/paymob-gateway-integration/`
**Specs:** `specs.md` · **Plan:** `plan.md` · **Ledger:** `deferred-items.md` · **Outcomes:** `outcome/`

> **Source of truth:** `specs.md` (REQ-001..REQ-082 bands) + `plan.md` (D1..D13, amendments A1..A5).
> **Blocking dependency:** none in-repo — the subscription-purchase backend is implemented (port, factory, purchase/activation services, repos, resolvers, webhook route; canonical doc `docs/billing/subscription-purchase.md` is Active). This plan EXTENDS those existing seams; the A1–A5 amendments (against EXISTING types/repos) are tracked in `deferred-items.md`.

## Document Information

- **Feature**: Paymob gateway integration + student purchase funnel wire-up
- **Ticket**: none in `docs/planning/TICKETS.md` (anchor: `docs/planning/MILESTONE_PLAN.md:161` + the subscription-purchase plan forward contract)
- **Version**: 1.0 · **Date**: 2026-09-07

### Numbering & Traceability Conventions

- Task ids `X.Y` follow phases; every implementation task carries the pipeline: `.QL` (quality loop `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates`, exit 0), `.TE` (4-tier tests), `.SEC` (BOLA/BOPLA/BFLA audit), `.SR` (semantic review), `.IV` (instruction verification — `sub-loop.ts` auto-discovers applicable AGENTS.md/`.agents/instructions/` files; read ALL printed).
- Outcome files: `outcome/<task-id>-outcome.md` per task (MANDATORY).
- `_Requirements:` lines list REQ ids EXPANDED (no ranges) — grep-verifiable.
- DB/service/route tests run via `bun run test/scripts/run-test.ts`; journeys under `test/workflows/` per `docs/testing/workflow-journey-tests.md` (exists).

## Non-Negotiable Execution Protocol

1. **Read `outcome/` first** — before ANY task, read every existing file in this plan's `outcome/` (six `research-*` digests ship with the plan).
2. **Per-file loop** — after each file edit, `sub-loop.ts <file> --lifecycle duplicates` must exit 0 before the next file.
3. **Semantic review before `[x]`** — race conditions, env getters registered, zero dead code, zero cross-layer imports, enum value imports, deferred items logged.
4. **No plan-meta in code** — comments/JSDoc never reference REQ ids, task ids, or plan paths.
5. **Evidence or it didn't happen** — `[x]` only with an outcome file.

---

## Phase 0: Pre-Implementation Baseline (MANDATORY)

- [x] 0.1 Record tsgo/biome/lint baselines (counts in `outcome/0.1-outcome.md`); confirm the landed subscription-purchase seams' shapes in the working tree (port signatures, factory, route, repos — amendments A1–A5 key off them); re-confirm every `path:line` cited in `specs.md` §1 still resolves.
  - _Requirements: REQ-001_

## Phase 1.5: Plan Review Gate (MANDATORY — executed at authoring time)

- [x] 1.1 Plan review gate executed; verdict recorded in `outcome/plan-review-R1.md`.

---

## Phase 2: Configuration, Schema & Type Foundations

- [x] 2.1 Paymob env configuration
  - EXTEND `backend/lib/env.ts`: `EnvironmentConfig.paymob` object + parsing in `readEnvironment()` + `getPaymobConfig()` getter (plan §4.1 — 10 keys incl. defaults for `PAYMOB_API_BASE_URL`/`PAYMOB_CHECKOUT_BASE_URL`/timeout/sweep window).
  - EXTEND `.env.example` with ALL 13 new keys — the 10 PAYMOB_* (`PAYMOB_SECRET_KEY`, `PAYMOB_PUBLIC_KEY`, `PAYMOB_HMAC_SECRET`, `PAYMOB_API_KEY`, `PAYMOB_INTEGRATION_ID_CARD`, `PAYMOB_INTEGRATION_ID_WALLET`, `PAYMOB_API_BASE_URL`, `PAYMOB_CHECKOUT_BASE_URL`, `PAYMOB_HTTP_TIMEOUT_MS`, `PAYMOB_RECONCILE_PENDING_MINUTES`) + the 3 optional `NGROK_*` (`NGROK_AUTHTOKEN`, `NGROK_DOMAIN`, `NGROK_PORT`) — using `<your-…-here>`/comment-only placeholders; EXTEND `backend/lib/test-ci-env.ts` with harmless test-mode defaults (NGROK_* absent there — CI exercises the simulation channel).
  - [x] 2.1.QL · [x] 2.1.TE — unit tests: defaults applied, integer coercion for integration IDs, empty-string secret rejected, cache reset parity · [x] 2.1.SEC — secrets only parsed server-side; nothing logged · [x] 2.1.SR · [x] 2.1.IV
  - _Requirements: REQ-002, REQ-040, REQ-042_
- [x] 2.2 Schema delta + migration 5
  - EXTEND `backend/db/schema/billing/student-payments.ts` (+`providerTransactionId`); CREATE `backend/db/migration/5-student-payments-provider-transaction.sql` + `-sqlite.sql` pair (trigger allowance for NULL→value during the guarded transition; schema via push, trigger via migration — same convention as the landed `4-student-payments-status-transition{,-sqlite}.sql` pair + its Drizzle mirror dir `backend/drizzle/*_custom_4-student-payments-status-transition/`); EXTEND `backend/db/repo/billing/student-payment.repository.ts` with `findStalePendingByGateway(gateway, olderThan, limit)` (amendment A4 — the repository exists; this ADDS the method).
  - [x] 2.2.QL · [x] 2.2.TE — EXTEND `backend/db/test/logic/billing/student-payment.repository.test.ts` (the subscription-purchase plan's planned suite location, `tasks.md:87`): `runInRollback` + `tx` everywhere; allow set-on-transition; forbid second update; forbid financial-column mutation · [x] 2.2.SEC — freeze proofs · [x] 2.2.SR · [x] 2.2.IV
  - _Requirements: REQ-004, REQ-031, REQ-073_
- [x] 2.3 Canonical vendor types + port amendments
  - CREATE `backend/types/billing/paymob.types.ts` (vendor DTOs per plan §2.3); EXTEND `backend/types/billing/payment-gateway.types.ts` per amendments A1–A3 (coordinate with the subscription-purchase plan executor if concurrent — ledger A-set).
  - [x] 2.3.QL · [x] 2.3.TE — type-level assertions compile; enum value imports · [x] 2.3.SEC · [x] 2.3.SR — types-only file (no runtime in types dir) · [x] 2.3.IV
  - _Requirements: REQ-005, REQ-014, REQ-017, REQ-031_

---

## Phase 3: Paymob Port Implementation

- [x] 3.1 HMAC verification module
  - CREATE `backend/services/billing/payment-gateway/paymob/paymob.constants.ts` (POST/GET/token key lists verbatim from mirror `hmac/hmac-transaction-callback.md:27-48` + `hmac/hmac-for-card-tokens.md:23-32`) and `paymob.hmac.ts` (builders + `verifyPaymobHmac` with digest-based `timingSafeEqual`).
  - [x] 3.1.QL · [x] 3.1.TE — golden vectors (valid POST success/declined, valid GET) + tamper vectors (flipped `success`, altered `amount_cents`, missing key, wrong secret, GET `order` vs `order_id` fallback, token-list vector) in colocated `__tests__/paymob.hmac.test.ts` · [x] 3.1.SEC — constant-time behavior · [x] 3.1.SR · [x] 3.1.IV
  - _Requirements: REQ-004, REQ-022, REQ-070_

- [x] 3.2 Paymob mappers
  - CREATE `backend/services/billing/payment-gateway/paymob/paymob.mapper.ts`: `buildIntentionRequest` (cents conversion w/ 2dp guard, billing placeholders, integer method IDs, `special_reference`), `toCheckoutDescriptor` (validates `id`/`client_secret`; URL assembly from config), `mapCallbackToEvent` (incl. `providerTransactionId`, cents→decimal string).
  - [x] 3.2.QL · [x] 3.2.TE — field-by-field request body assertions; boundary cents cases; descriptor URL assembly; callback mapping incl. declined/PENDING flags · [x] 3.2.SEC — no client-derived money fields · [x] 3.2.SR · [x] 3.2.IV
  - _Requirements: REQ-011, REQ-012, REQ-013, REQ-014, REQ-015, REQ-016, REQ-017, REQ-044_
- [x] 3.3 HTTP client + adapter
  - CREATE `…/paymob/paymob.http.ts` (injectable `fetch` boundary; `AbortSignal.timeout`; `retryTransient` only on transport/5xx; typed minimal validation) and `…/paymob/paymob.adapter.ts` — `class PaymobPaymentGateway implements PaymentGatewayPort` with `requirePaymobConfig()` fail-closed guard, `createCheckout`, `parseWebhookEvent(input)` (returns `null` for verified-but-ignored variants; throws typed errors the route maps to 400/401).
  - [x] 3.3.QL · [x] 3.3.TE — mocked-fetch suite incl. no-retry-on-unknown-state, timeout aborts, 404/400 upstream mapping, config guard throws · [x] 3.3.SEC — no upstream body leaks to caller · [x] 3.3.SR — zero module-level mutable state · [x] 3.3.IV
  - _Requirements: REQ-004, REQ-010, REQ-013, REQ-015, REQ-032, REQ-033, REQ-040, REQ-042, REQ-050, REQ-051, REQ-072_

---

## Phase 4: Webhook Receiver

- [x] 4.1 Provider-dispatched webhook route
  - EXTEND the EXISTING `app/api/payments/webhook/route.ts` with the paymob branch: keep the kill switch (`PAYMENT_WEBHOOK_ENABLED` → bare 404), the 64 KiB bounded body read, quarantine/replay ack semantics, and masked envelopes; paymob-branch 404 gate when `PAYMENT_GATEWAY_PROVIDER ≠ paymob` → parse+verify via the paymob HMAC path (query-param `?hmac=`, SHA-512 20-key concat — amendment A3 gives the port the query) → dispatch `PaymentWebhookEvent` to the EXISTING `SubscriptionActivationService.processWebhookEvent` → 200 ack per plan §3.4 matrix.
  - VERIFY registration: `{ path: "/api/payments/webhook", classification: "provider-ack-exempt" }` already exists (`backend/lib/gateway/route-inventory.ts:65`) — confirm no new row needed; if the paymob branch changes the exemption surface, update the row + `docs/graphql/error-handling-contract.md` §Exemptions accordingly.
  - [x] 4.1.QL · [x] 4.1.TE — full REQ-053 status matrix; replay — including an N≥5 burst of the SAME signed callback in quick succession (Auto Callback Retrial shape, REQ-029: exactly one settlement, the rest 200 no-ops); TOKEN/refund/void no-ops; unknown `merchant_order_id` 200; oversized 413 (landed as the shared masked 400 `PAYMENT_WEBHOOK_BODY_TOO_LARGE` — deviation ruled + logged in `deferred-items.md`); paymob-branch 404 when `PAYMENT_GATEWAY_PROVIDER ≠ paymob` · [x] 4.1.SEC — forged/malformed probes green; logs redacted + minimal · [x] 4.1.SR · [x] 4.1.IV
  - _Requirements: REQ-004, REQ-020, REQ-021, REQ-022, REQ-023, REQ-024, REQ-025, REQ-026, REQ-041, REQ-043, REQ-053, REQ-071_
- [x] 4.2 Fulfillment integration (activation + notification)
  - Verify/wire the subscription-purchase plan's `SubscriptionActivationService.processWebhookEvent`: guarded transition resolves reference→pending pair, applies `providerTransactionId` when present (REQ-031 amendment), credits lanes, and emits `payment_confirmation` via `NotificationEngine.emitForUser` in-tx with `publishReceipts` post-commit; idempotency key `payment:<providerTransactionId>:confirmation`.
  - [x] 4.2.QL · [x] 4.2.TE — duplicate-event no-op; failure-path emission; notification persists-before-publish · [x] 4.2.SEC — cross-student reference cannot reach another student's subscription · [x] 4.2.SR · [x] 4.2.IV
  - _Requirements: REQ-023, REQ-028, REQ-030, REQ-034_

---

## Phase 5: Reconciliation Backstop

- [x] 5.1 Reconcile service
  - CREATE `backend/services/billing/payment-gateway/paymob/paymob.reconcile.ts` — `reconcilePendingPaymobPayments({ now, batchLimit })`: provider/API-key gating; stale-pending query via A4 repo method; per row: `mintAuthToken` → `transactionInquiryByMerchantRef`; PAID/UNPAID outcomes funneled through `SubscriptionActivationService.processWebhookEvent` (no bespoke update); bounded batch; per-row summary log.
  - [x] 5.1.QL · [x] 5.1.TE — gating (returns zero-count when unconfigured), inquiry mapping, handoff identity with webhook path, batch cap honored · [x] 5.1.SEC — inquiry token never logged · [x] 5.1.SR — no token caching (D7) · [x] 5.1.IV
  - _Requirements: REQ-004, REQ-033, REQ-035, REQ-036_
- [x] 5.2 Cron route
  - CREATE `app/api/cron/reconcile-paymob-payments/route.ts` following `app/api/cron/sweep-sessions/route.ts` (GET-only, `CRON_SECRET` timing-safe compare, 404 when inactive, `apiSuccessResponse`/`apiErrorResponse`, `resolveRequestId`); register in `ROUTE_INVENTORY` (A4 assertion green).
  - [x] 5.2.QL · [x] 5.2.TE — bearer ok/missing/wrong; mode gate; happy path delegates · [x] 5.2.SEC · [x] 5.2.SR · [x] 5.2.IV
  - _Requirements: REQ-041, REQ-043, REQ-035_
- [x] 5.4 Callback channel factory + simulation channel (the fully-implemented dev default)
  - CREATE `backend/types/billing/callback-channel.types.ts` (`CallbackChannelKind`, `CallbackChannelPort`), `backend/services/billing/payment-gateway/callback-channel/callback-channel.factory.ts` (`getCallbackChannel()` — `real` in production / provider≠paymob, `ngrok` only when BOTH `NGROK_AUTHTOKEN` + `NGROK_DOMAIN` set AND probe passes, else `simulation` + one structured log), and `…/callback-channel/simulation-callback-channel.channel.ts` (synthesizes Paymob-shaped processed callbacks signed via the PRODUCTION `paymob.hmac.ts` builder with `PAYMOB_HMAC_SECRET`, POSTs `?hmac=<digest>` to the local webhook; supports confirm/fail/replay/cross-user; fail-closed guard in production). No consumer reads `NGROK_*` directly.
  - [x] 5.4.QL · [x] 5.4.TE — factory resolution matrix (real/ngrok/simulation incl. missing-env and failed-probe fallbacks); simulation callback passes the real route's HMAC gate and fulfills end-to-end; production guard throws · [x] 5.4.SEC — simulation unreachable in production; signer reuse (no drift) · [x] 5.4.SR — NO per-file ngrok checks anywhere · [x] 5.4.IV
  - _Requirements: REQ-090, REQ-091, REQ-093_
- [x] 5.5 Ngrok channel + intention URL wiring
  - CREATE `…/callback-channel/ngrok-callback-channel.channel.ts` (spawn `ngrok http --url="https://<NGROK_DOMAIN>" <NGROK_PORT>`; probe the PUBLIC domain URL — local agent API off-limits; `publicBaseUrl = https://<NGROK_DOMAIN>`); EXTEND the intention URL composition to use the channel's `publicBaseUrl` for the dev `notification_url`; EXTEND `backend/lib/env.ts` (+`.env.example`, `backend/lib/test-ci-env.ts`) with the three optional `NGROK_AUTHTOKEN` / `NGROK_DOMAIN` / `NGROK_PORT` (default 3000) keys.
  - [x] 5.5.QL · [x] 5.5.TE — probe success/failure matrix; notification_url composition per channel; env parsing · [x] 5.5.SEC — authtoken never logged; dev-only selection · [x] 5.5.SR · [x] 5.5.IV
  - _Requirements: REQ-090, REQ-091, REQ-092_
- [x] 5.6 Mid-point backend review gate (Phase 2.5 pattern)
  - Dispatch backend-scoped review over Phase 2–5 outputs (types/repo/service/route files); aggregate + fix findings per file with sub-loop re-verification; repeat until zero backend-specific findings; write `outcome/midpoint-review-R1.md`.
  - _Requirements: REQ-002, REQ-082_

---

## Phase 6: i18n

- [x] 6.1 `checkout` locale namespace
  - CREATE `shared/locale/types/checkout/index.ts`, `shared/locale/en/checkout/index.ts`, `shared/locale/ar/checkout/index.ts`, `shared/locale/namespaces/checkout/checkout.namespace.ts`; register `checkoutTranslations` in `shared/locale/types/message.ts` (`Translations`) + `shared/locale/{en,ar}/messages.ts` + the namespace barrel; CREATE `shared/locale/checkout-namespace.parity.test.ts` (wallet/plans namespaces as templates).
  - [x] 6.1.QL · [x] 6.1.TE — parity + interpolation-type tests · [x] 6.1.SEC · [x] 6.1.SR · [x] 6.1.IV
  - _Requirements: REQ-003, REQ-052, REQ-066_

---

## Phase 7: Student Purchase Funnel

- [x] 7.1 GraphQL documents + codegen
  - CREATE `frontend/graphql/sharedDocuments/billing/subscription-purchase.documents.ts` (`purchaseSubscriptionMutationDocument`, `mySubscriptionsQueryDocument`; `TypedDocumentNode`; `id` in every selection set); export through `frontend/graphql/sharedDocuments/billing/index.ts`; run `bun run generate:gqlSchema && bun codegen` (the `purchaseSubscription`/`mySubscriptions` resolvers are already landed).
  - [x] 7.1.QL · [x] 7.1.TE — document snapshot/type compile checks · [x] 7.1.SEC · [x] 7.1.SR · [x] 7.1.IV
  - _Requirements: REQ-060, REQ-075_

- [x] 7.2 Student plan catalog + checkout initiation
  - CREATE `app/(dashboard)/student/plans/page.tsx` + `frontend/views/student/plans/` (`PlansCatalogContainer`, card/table tiers, `PlanPurchaseConfirmDialog`, `usePurchaseSubscription` with idempotency-key ref + redirect per plan §5); nav entry per navItems conventions; Storybook arm set.
  - [x] 7.2.QL · [x] 7.2.TE — buy CTA → mutation vars; redirect on `checkoutUrl`; mock-provider branch refetches; dialog cancel keeps key · [x] 7.2.SEC — no plan price sent from client; student-only page guard · [x] 7.2.SR · [x] 7.2.IV
  - _Requirements: REQ-003, REQ-044, REQ-045, REQ-054, REQ-060, REQ-061, REQ-062, REQ-065_
- [x] 7.3 Payment result page
  - CREATE `app/(dashboard)/student/checkout/result/page.tsx` + `frontend/views/student/checkout/result/PaymentResultContainer.tsx` (searchParams hints; authoritative `mySubscriptions` re-query; success/failed/pending branches; retry CTA); stories.
  - [x] 7.3.QL · [x] 7.3.TE — forged `success=true` query renders nothing positive without server truth · [x] 7.3.SEC — student-scoped; no param trust · [x] 7.3.SR · [x] 7.3.IV
  - _Requirements: REQ-027, REQ-045, REQ-054, REQ-063, REQ-065_
- [x] 7.4 My subscriptions page
  - CREATE `app/(dashboard)/subscriptions/page.tsx` + `frontend/views/student/subscriptions/MySubscriptionsContainer.tsx` (status chips active/pending/failed, empty state, failed-guidance copy); the existing `/subscriptions` nav link goes live.
  - [x] 7.4.QL · [x] 7.4.TE — all four state arms · [x] 7.4.SEC — tenancy: only own rows · [x] 7.4.SR · [x] 7.4.IV
  - _Requirements: REQ-045, REQ-054, REQ-064, REQ-065_

---

## Phase 8: Journey Validation

- [x] 8.1 Purchase→webhook→activation journey
  - CREATE `test/workflows/billing/paymob-purchase-journey.test.ts` per `docs/testing/workflow-journey-tests.md`: real services + real DB; Paymob HTTP mocked at the injected fetch boundary; callback delivery resolved through `getCallbackChannel()` (ngrok when reachable, simulation otherwise — REQ-094; NO per-test ngrok logic); drives purchase → verified callback → asserts activation + lane credit + persisted notification; replay + tamper + failure + cross-user journeys green.
  - [x] 8.1.QL · [x] 8.1.TE · [x] 8.1.SEC — denial probes from specs §3 · [x] 8.1.SR · [x] 8.1.IV
  - _Requirements: REQ-004, REQ-023, REQ-025, REQ-028, REQ-034, REQ-074_

---

## Phase 9: Final Gate & Knowledge Propagation

- [x] 9.1 Final quality gate
  - `bun quality-gate` green; baseline counts vs `outcome/0.1-outcome.md`; ledger gate `awk '/^## Ledger Table/,/^## Status Values/' deferred-items.md | grep -c "❌\|⚠️"` == 0; traceability loop (`for r in $(grep -oE 'REQ-[0-9]+' specs.md | sort -u); do grep -q "$r" tasks.md || echo MISSING: $r; done`) zero misses; `outcome/9.1-outcome.md` written.
  - _Requirements: REQ-001, REQ-002, REQ-082_
- [x] 9.2 Knowledge propagation
  - CREATE `docs/billing/paymob-gateway.md` (endpoints, HMAC, env matrix, flows, dashboard setup, test-credential runbook, troubleshooting); root `AGENTS.md` Important References one-liner; `backend/services/AGENTS.md` minimal rule line(s) + doc pointer; mark cross-plan amendments A1–A5 consumed/orphaned in the subscription-purchase plan's ledger coordination.
  - [x] 9.2.QL · [x] 9.2.SR · [x] 9.2.IV
  - _Requirements: REQ-080, REQ-081_

---

## Traceability Map (REQ → tasks)

| REQ | Tasks |
|---|---|
| REQ-001 | 0.1, 9.1 |
| REQ-002 | 2.1 (pattern applied to all), 5.6, 9.1 |
| REQ-003 | 6.1, 7.2 |
| REQ-004 | 2.2, 3.1, 3.3, 4.1, 5.1, 7.5, 8.1 |
| REQ-005 | 2.3 |
| REQ-010 | 3.3 |
| REQ-011 | 3.2 |
| REQ-012 | 3.2 |
| REQ-013 | 3.2, 3.3 |
| REQ-014 | 2.3, 3.2 |
| REQ-015 | 3.2, 3.3 |
| REQ-016 | 3.2 |
| REQ-017 | 2.3, 3.2 |
| REQ-020 | 4.1 |
| REQ-021 | 4.1 |
| REQ-022 | 3.1, 4.1 |
| REQ-023 | 4.1, 4.2, 8.1 |
| REQ-024 | 4.1 |
| REQ-025 | 4.1, 8.1 |
| REQ-029 | 4.1, 9.2 |
| REQ-026 | 4.1 |
| REQ-027 | 7.3 |
| REQ-028 | 4.2, 8.1 |
| REQ-030 | 4.2 |
| REQ-031 | 2.2, 2.3 |
| REQ-032 | 3.3 |
| REQ-033 | 3.3, 5.1 |
| REQ-034 | 4.2, 8.1 |
| REQ-035 | 5.1, 5.2 |
| REQ-036 | 5.1 |
| REQ-040 | 2.1, 3.3 |
| REQ-041 | 4.1, 5.2 |
| REQ-042 | 2.1, 3.3 |
| REQ-043 | 4.1, 5.2 |
| REQ-044 | 3.2, 7.2 |
| REQ-045 | 7.2, 7.3, 7.4 |
| REQ-050 | 3.3 |
| REQ-051 | 3.3 |
| REQ-052 | 6.1 |
| REQ-053 | 4.1 |
| REQ-054 | 7.2, 7.3, 7.4 |
| REQ-060 | 7.1, 7.2 |
| REQ-061, REQ-062 | 7.2 |
| REQ-063 | 7.3 |
| REQ-064 | 7.4 |
| REQ-065 | 7.2, 7.3, 7.4 |
| REQ-066 | 6.1 |
| REQ-070 | 3.1 |
| REQ-071 | 4.1 |
| REQ-072 | 3.3 |
| REQ-073 | 2.2 |
| REQ-074 | 8.1 |
| REQ-075 | 7.1, 7.5 |
| REQ-080, REQ-081 | 9.2 |
| REQ-082 | 5.6, 9.1 |
| REQ-090 | 5.4, 5.5 |
| REQ-091 | 5.4, 5.5 |
| REQ-092 | 5.5 |
| REQ-093 | 5.4 |
| REQ-094 | 8.1 |
