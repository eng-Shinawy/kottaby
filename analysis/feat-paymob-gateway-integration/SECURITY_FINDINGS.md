# Security Findings — feat/paymob-gateway-integration

> Target: branch `feat/paymob-gateway-integration` vs `main` (worktree
> `/home/ahmed/Projects/kottaby.worktrees/kottaby_2`).
> Method: two scoped `security-auditor` subagents (payment path;
> authorization/data-exposure/test-env), `bun audit` dependency CVE pass, and
> **orchestrator verification of every reported finding against the cited
> code** before inclusion below.
> Date: 2026-09-14. Second hardening pass — an earlier review the same day
> landed all its fixes in `67fb06d5`; this pass re-audits the tree at/after
> that commit adversarially. **Note: a further commit landed during this
> pass (55711dd8, dependency-CVE remediation + CI osv-scanner gate)** — see
> the dependency section; code findings were re-verified still accurate at
> the current HEAD touchpoints.

## Severity scorecard

| Severity | Count | Details |
|---|---|---|
| Critical | **0** | — |
| High | **0** | — |
| Medium | **1** | Capture-state not asserted on settlement (SEC-01) |
| Low | **1** | Latent raw-SQL `LIMIT`/`OFFSET` interpolation (SEC-02) |
| Info | **2** | `TEST_CI` literal shape (SEC-03); local-env hygiene advisory (SEC-04) |

Dependency CVEs are tracked separately in the table below (2 critical /
6 high advisories — **all dev/build-toolchain only, none reachable from the
deployed runtime**; not counted in the scorecard since none affect the
branch's production surface).

## Manually verified controls (this pass, orchestrator-checked)

| Control | Evidence | Verdict |
|---|---|---|
| HMAC verify-before-trust (CWE-345/347) | `paymob.hmac.ts:16-21` timing-safe compare via SHA-256 digest indirection, fail-`false` everywhere; `paymob.adapter.ts:267,284,300` verification is the first statement of every settle helper; flat redirect verified-then-ignored | SECURE |
| Webhook trust-boundary ordering | `app/api/payments/webhook/route.ts:341-360` kill switch + inactive-branch bare-404 before any body read; `:366-393` bounded read (content-length pre-reject, per-read + total deadlines); `:419-428` parse→activation ordering | SECURE |
| Mock gateway unreachable in production | `mock-payment-gateway.adapter.ts:74,91,108` + `payment-gateway.factory.ts:90` (`assertMockDevelopmentRuntime`); callback channels fail closed in prod (`callback-channel.factory.ts:184-197`, per-channel `:316-323`/`:291-298` guards); ngrok authtoken via env, never argv | SECURE |
| Admin finance authorization | `$all: { authenticated, role: [Admin] }` on every field (`admin-finance.query.ts:66,105,138`; `admin-finance.mutation.ts:62-118`); `assertActorAdmin` re-asserted **inside** every tx (service read helpers `:144,195,264`; mutations `:189,276,367`); BOLA-proof by construction (actor = `ctx.user.id` only); settlement writes are guarded single UPDATEs | SECURE |
| Student purchase funnel | Role-gated mutation; amount/currency from the plan row server-side only; `assertPlanUnchangedSinceCheckout` in-tx (purchase service `:431`); idempotency replays throw with oracle-safe FK probe (`:212-222`); checkout redirect `https:`-enforced (`usePurchaseSubscription.ts:73-77`) | SECURE |
| Payment row write-once discipline | `student-payments.ts:72` CHECK (`status <> 'pending' OR provider_transaction_id IS NULL`); guarded single-statement transitions (`markPaidOnce`/`markFailedOnce`/`activatePendingOnce`); strict amount/currency quarantine (`subscription-activation.service.ts:652-660`) | SECURE |
| Committed secrets | `git ls-files` env surface = `.env.example` (placeholders) + `.env.test.ci` (one deliberate test fixture key, `DATABASE_ENCRYPTION_KEY=cafe••••`); no real credentials tracked | SECURE |
| Live-test key hygiene | `test/helpers/paymob-live-env.ts:119-121` refuses `sk_live_` without `PAYMOB_ALLOW_PROD_KEYS=1`; tunnel harness restores fetch/publish/receiver unconditionally before the `!live` return (`paymob-live-tunnel.journey.test.ts:451-503`); secret assertions use SHA-256 digests (`:523-529`); suite triple-gated | SECURE |
| Zero-lane expiry write | `student.repository.zero-lane.helpers.ts:52-56` — column map frozen and enum-keyed, caller passes the student id internally; no user-input path | SECURE |
| Env config hardening | `backend/lib/env.ts:142-153` enforces `https:` on provider URLs; `:233-243` discards wildcard origins; fail-closed malformed integration IDs; `.env` override only against missing/blank placeholder DATABASE_URL (`:40-58`) | SECURE |

## Findings

### SEC-01 — Settlement does not assert the capture state (skip step 1: only
patch when the merchant account is one-step, see below)

| Field | Value |
|---|---|
| CWE | CWE-345 / CWE-840 (insufficient verification; business logic) |
| Severity | **Medium** |
| Location | `backend/services/billing/payment-gateway/paymob/paymob.mapper.ts:235-245` (`mapCallbackToEvent`); mirrored at `backend/services/billing/payment-gateway/paymob/paymob.reconcile.ts:198-224` |
| Verified | YES — mapper settles on `!pending && success` only; neither it nor reconcile checks `is_capture` / `is_standalone_payment` / `is_auth` / `captured_amount` |
| Scenario | If the Paymob merchant account is ever switched to (or misconfigured into) **two-step / manual capture**, an authorization hold arrives as `success=true, pending=false, is_auth=true, is_capture=false`. Both settlement paths treat it as a confirmed payment: subscription activates, credit lane tops up — while the card is never captured. Free subscription merch via merchant-config misstep, not attacker action. |
| Fix | In both the mapper and `reconcileOneRow`, only emit/hand off a `confirmed` outcome when the transaction is a completed capture (e.g. `is_standalone_payment === true \|\| is_capture === true`, or compare `captured_amount` to `amount_cents`); an auth-only state maps to *still-in-flight* (webhook → `null`, reconcile → `skipped`) with one correlated log line. Add `is_capture`/`is_standalone_payment` to the signed-callback type and the live-tunnel/intention e2e assertions. |
| Status | **OPEN — recommended before merge** if two-step capture is conceivable for this merchant account; acceptable as a documented follow-up otherwise. |

### SEC-02 — Latent raw-SQL `LIMIT`/`OFFSET` interpolation

| Field | Value |
|---|---|
| CWE | CWE-89 (SQL injection, latent) |
| Severity | **Low** |
| Location | `backend/db/repo/billing/student-payment.repository.ts:431-439` (raw branch of `listForAdminAudit`) |
| Verified | YES — WHERE clause parameterized; `LIMIT ${limit} OFFSET ${offset}` interpolated. Unreachable today: the only production caller (`admin-financial-auditing.service.read.helpers.ts:161`) always passes a transaction (Drizzle branch), and `resolvePageBounds` (`user-management.helpers.ts:298-313`) validates inputs to bounded safe integers. The bare-executor branch is exercised only by a committed-fixture test. |
| Scenario | A future caller reaching the raw branch with unvalidated numbers hands an attacker a SQL-injection primitive against the payments ledger. |
| Fix | Parameterize (`LIMIT $n OFFSET $m` with pushed params) or `Number.isSafeInteger`-assert both at the repository boundary. |
| Status | OPEN — trivial hardening, not merge-blocking. |

### SEC-03 — `TEST_CI` literal shape drift (info)

| Field | Value |
|---|---|
| CWE | CWE-1188 (insecure default / gate drift) |
| Severity | **Info** |
| Location | `backend/lib/test-ci-env.ts:5` (`=== "true"`) vs `test/scripts/gen-paymob-test-env.ts:180` (emits `TEST_CI=1`) |
| Verified | YES — and largely already absorbed: `test/ui/test-env.ts:27-31` normalizes `"1"` → `"true"`; remaining consumer `run-parallel-tests.ts:277,423` only chooses TTY formatting, so a miss is cosmetic and fail-safe. No payment/live pathway reads `isTestCi()`. |
| Fix (optional) | Normalize inside `test-ci-env.ts` itself (`=== "true" \|\| === "1"`) so no consumer can drift again. |

### SEC-04 — Local untracked env files contain real-looking sandbox keys (info)

| Field | Value |
|---|---|
| CWE | CWE-538 (sensitive-data hygiene) |
| Severity | **Info** |
| Location | Untracked `.env`, `.env.test`, `.env.paymob.test` in this worktree — **not committed** (`git ls-files` confirms only `.env.example` + `.env.test.ci` are tracked) |
| Detail | Real-looking Paymob **sandbox** secret keys and an ngrok authtoken live on disk (normal developer state; masked here: `egy_••••`, 76-char). No repo exposure. |
| Recommendation | Rotate the sandbox keys / ngrok token **if** this machine or worktree was ever shared, imaged, or packaged. No repo action required. |

`SECRETS.local.md` was **not** created: no hardcoded credential exists in any
tracked file; recording local machine state in the analysis dir adds exposure,
not safety.

Scoped to the code findings for this branch. The dependency fleet was
audited on the original HEAD with `bun audit`: 18 advisories (2 critical,
6 high, 10 moderate) — **all in dev/build toolchains** (`to-ico`'s
`request`/`jimp` chain, babel/emotion `cosmiconfig`, `minimist`, `js-yaml`,
`yaml`…). This was superseded mid-pass by commit `55711dd8`
("fix(security): dependency-vuln scan in CI + remediate 21 lockfile CVEs"),
which removed the `to-ico` chain wholesale, added package.json overrides
(`js-yaml ^4.3.2`, `minimist ^1.2.8`, `qs ^6.16.0`, `valibot ^1.4.2`,
`yaml ^2.8.3`), and gated CI on osv-scanner (v2.6.0, SHA-pinned) scanning
`bun.lock`. Re-audit at that commit: **`bun audit` — no vulnerabilities
found (1278 packages)**. Dependabot/pinning posture is now enforced in CI;
no further dependency action required of this branch.

## Weaknesses summary (CWE)

| CWE | Where | State |
|---|---|---|
| CWE-345/840 | Settlement capture-state assumption (SEC-01) | OPEN — Medium |
| CWE-89 | Latent LIMIT/OFFSET interpolation (SEC-02) | OPEN — Low |
| CWE-1188 | TEST_CI literal drift (SEC-03) | Effectively absorbed; cosmetic residual |
| CWE-538 | Local sandbox keys (SEC-04) | Environmental advisory only |
| CWE-345/347, CWE-404-family, CWE-862/285, CWE-200, CWE-79, CWE-601 | All hunts this pass | Not present (see verified-controls table) |

## Long-term recommendations

1. **Settle on capture, not success** (SEC-01 fix) — the one substantive
   follow-up. It converts a merchant-config footgun into a fail-closed rule,
   and the reconciliation sweep should adopt the same predicate so both
   settlement paths stay identical.
2. **Parameterize or assert pagination at every raw-SQL seam** (SEC-02) —
   small, mechanical; add a repo-layer lint note or eslint custom rule
   banning `\${` immediately following `LIMIT`/`OFFSET` in query strings.
3. **Centralize boolean env semantics** (SEC-03) — one canonical parser in
   `test-ci-env.ts` accepting `1`/`true`.
4. **Rotate sandbox credentials if this workstation state ever leaves the
   machine** (SEC-04).
5. **Dependency hygiene cadence** — none of the 18 advisories touch the
   runtime, but schedule a periodic `bun audit fix` pass so the dev-tool
   pile doesn't compound.

## Remediation log

No Critical or High findings in tracked code → **no remediation patches were
drafted** (pipeline scope limits patch artifacts to Critical/High; the Medium
and Low above are presented as code-level fix recipes, and SEC-01 is
merge-relevant only if two-step capture is in range for this merchant
account). Prior-pass fixes (commit `67fb06d5`) were re-verified in place;
quality-gate evidence from that pass stands (tests/lint were run for it and
no patch in this pass changes code, so no re-run was required).

## Auditor coverage notes

Auditors flagged as NOT COVERED (time-boxed) and orchestrator spot-checked
clean: `provider_transaction_id` write-once CHECK (verified above), zero-lane
column-map confinement (verified above), `.env.example` placeholder hygiene
(verified above), frontend funnel XSS sinks (none found under
`frontend/views/student/**` or `frontend/views/admin/finances/**`), ILIKE
wildcard escaping (`read.helpers:149`, verified by auditor A2), idempotency
FK oracle (purchase service `:212-222`, verified by A2). Migration SQL
internals beyond the provider-transaction CHECK and the admin-only read
filter internals were given a lighter pass — no injection surface exists
there (static DDL; filter predicates parameterized as noted in SEC-02).

## Sign-off

**PASS** — no Critical or High findings; branch is safe to merge with one
deliberate decision: accept the SEC-01 exposure (merchant account is
permanently one-step) or take the small mapper+reconcile follow-up before
enabling any two-step capture mode on the Paymob account.
