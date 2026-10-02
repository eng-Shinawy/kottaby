# Financial Safety Verification Reference Documentation

**Domain:** Billing & Subscriptions
**Lifecycle Status:** Active

---

## 1. Why — Adversarial Verification over the Shipped Escrow Substrate

The escrow substrate is already shipped and unmodified by this plan: a session fee is held at
request (`session.fee_held = true`), released on cancellation or sweep back to the provenance lane
(`session.held_balance_lane`), and consumed into the teacher's wallet on dual confirmation — all
over append-only financial ledgers (`student_payments`, `teacher_transaction`, `audit_logs`)
protected by DB immutability triggers and CHECK constraints.

What this surface adds is the **adversarial proof**: an automated suite that actively tries to
*break* those guarantees rather than assert their presence. Every invariant gets a named,
failing-capable test — double-spend races against a 1-credit balance, concurrent withdrawal
overdraft attempts, direct UPDATE/DELETE attacks on the ledger, and savepoint-bracketed
CHECK-constraint probes. If a probe fails, the failure is a **defect finding**: escalated as a
release-blocking item and fixed minimally and adjacently — never silently tolerated, never
redesigned inside the verification ticket.

This is a verification ticket: no production code, no schema, no resolvers, no services change.
The deliverable is executable evidence plus this knowledge-propagation doc, so every future
billing ticket inherits the invariants as permanent CI-enforced contracts.

---

## 2. Verified Invariants

| Invariant | Proof (test anchor) | Layer | Verified outcome |
|---|---|---|---|
| Confirm-vs-sweep race — exactly one financial outcome | `test/workflows/sessions/session-dual-confirmation.journey.test.ts:620` (step 10) | Journey (`test/workflows`, real services, real DB) | `Promise.allSettled` dispatches confirm + sweep concurrently over one expired completion: the escrow unit is consumed (credit once, no refund) XOR released (refund once, no credit) — never both, never neither; the loser is honestly classified as a conflict, never a crash. |
| Concurrent double-spend chaos (real PostgreSQL) | `backend/services/classes/session-lifecycle.service.test.ts:2314` (REQ-043(d), gated via `testOnRealPostgres`) | Service (real-PG chaos block) | Two concurrent `createSession` calls with ONE lane unit → exactly one session, exactly one `INSUFFICIENT_BALANCE`, lanes never negative (sum-invariant over `Promise.allSettled` outcomes). |
| Same-key replay chaos (real PostgreSQL) | `backend/services/classes/session-lifecycle.service.test.ts:2346` (REQ-043(e), gated via `testOnRealPostgres`) | Service (real-PG chaos block) | Same idempotency key replayed concurrently N=4 → exactly one session, exactly ONE net debit (losers' debits roll back), three `DUPLICATE_REQUEST` denials — the genuine 23505 race. |
| `student_payments` transition-trigger matrix | `backend/db/test/logic/billing/student-payment.repository.test.ts:206-213` (Tier 4 blocked rows) | DB/repo (`runInRollback`, savepoint-bracketed probes) | `paid → anything` (re-open, re-decide), amount tamper (even smuggled inside the permitted transition), and `DELETE` all raise the DB guard; only `pending → paid \| failed` with frozen financial columns is permitted. |
| Wallet SDL surface pinning | `backend/graphql/test/schema-surface.test.ts:218-225` (`myWallet`, `requestWithdrawal` field sets) | GraphQL schema surface | The teacher-only wallet read (`myWallet`) and payout write (`requestWithdrawal`) are pinned as exact root operations with exact arg shapes — the SDL grows only by named deltas. |
| Wallet repository coverage + CHECK constraints | `backend/db/test/repo/billing/wallet.repository.test.ts` — describes `WalletRepository — CHECK constraint probes (savepoint-bracketed)` and `WalletRepository — namespace closure` | DB/repo (`runInRollback`, savepoint-bracketed probes) | 100% lines & functions coverage of `WalletRepository` (14 tests); direct negative writes raise `wallet_balance_check` / `wallet_total_earning_check` / `teacher_transaction_amount_check` via `expectRepoError` + `constraintNameOf`; the API-surface assertion proves no update/delete method is exposed for the append-only ledger. |
| Financial immutability trigger tier | `backend/db/test/logic/billing/financial-immutability.test.ts` — `describeTriggerTier` blocks: `financial ledger immutability — trigger presence tier`, `— teacher_transaction tamper tier`, `— student_payments tamper tier` | DB/repo (`runInRollback`, savepoint-bracketed probes) | Trigger-presence probes on `teacher_transaction` / `student_payments` / `audit_logs` find both UPDATE and DELETE triggers present and enabled; tamper probes assert `teacher_transaction is immutable — UPDATE/DELETE is not permitted` with the row read back unchanged; the compensating-row doctrine holds (a corrective INSERT succeeds while mutation of the original fails); the re-probe fails identically (idempotent); on PGlite the tier skips via `describeTriggerTier`, never silently. |
| Cross-actor financial journey | `test/workflows/billing/financial-safety-verification.journey.test.ts` — describes `Journey — cross-actor adversarial financial-safety verification (real services)` (tasks.md Task 4) | Journey (`test/workflows`, real services, real DB) | 9 tests (Steps A–H): double-spend race (N=4 concurrent `createSession` over 1 credit — exactly one wins, losers classified), escrow cancel→release with re-cancel conflict, dual-confirm→credit with ledger↔wallet identity recompute, withdrawal drain race + input fuzz (zero-write rejections), wallet-first-earning race, adversarial immutability (direct ledger UPDATE blocked by the append-only trigger), and real-path auth denials — over committed fixtures with tracked cleanup and zero-residue teardown. |

---

## 3. How to Extend the Probes

Adding a new financial invariant follows one rule: **new invariant → new failing-capable test**.
A test that cannot fail proves nothing.

- **New invariant** (e.g. a new guarded transition, a new ledger rule): write the probe that would
  fail if the guard were removed, at the layer that owns the guarantee — DB/repo tier for
  constraints and triggers, service tier for domain guards, journey tier for cross-actor
  financial outcomes.
- **Savepoint-bracketed constraint probes** (DB/repo tier): a failed statement aborts the
  surrounding transaction. Open the SAVEPOINT **after** the probe row is inserted, run the
  violating statement via the `expectRepoError` try/catch helper, then
  `rollback to savepoint <name>` and assert the constraint via the error cause chain
  (`constraintNameOf` for CHECK names, message-substring walk for trigger raises — Drizzle masks
  driver errors behind a generic message, so the raised trigger text is reachable only through the
  chain).
- **Sum-invariant race assertions** (service/journey tiers): express concurrency outcomes as
  numeric sums over `Promise.allSettled` results — winners + losers = N, winners = 1, final
  balance = expected — never as "should not error". Sum invariants stay meaningful under both
  true-parallel PostgreSQL (gate with the `testOnRealPostgres` precedent) and the serialized
  single-connection PGlite sandbox (bounded N, deterministic predicate arbiter). True-parallel
  races need committed fixtures and separate connections, so they belong in the journey layer —
  `runInRollback` serializes one tx and cannot prove parallelism.
- **Mirror the existing patterns**: the trigger matrix follows
  `student-payment.repository.test.ts` (Tier 4 blocked rows); the immutability probe inventory
  follows the `audit-immutability.test.ts` trigger-presence precedent; SDL pinning follows
  `schema-surface.test.ts` exact-shape containment assertions.

---

## 4. Anti-Patterns (what NOT to do)

- **Never use float arithmetic on money.** Money moves as decimal strings end-to-end; compare
  exactly as strings. Never re-parse to `Number`, never `parseFloat`, never derive amounts.
- **Never `expect(...).rejects.toThrow()` inside `runInRollback`** — it causes deadlocks. Use the
  `expectRepoError` try/catch helper inside an explicit savepoint bracket.
- **Never use `runInRollback` in journey tests** (`test/workflows/`). Services spawn their own
  top-level transactions on the global `db`; an outer rollback wrapper deadlocks or misses
  committed rows. Journeys run on committed fixtures with tracked `afterAll` cleanup.
- **Gate the trigger tier with `describeTriggerTier`** (the
  `isPgliteProvider() ? describe.skip : describe` precedent). Probes must never fail because of a
  runtime capability gap; on the PGlite sandbox a skip is logged, never silent; on real PostgreSQL
  the tier runs un-gated.
- **Value-import enums only.** Any enum appearing in a runtime expression must be a value import
  (never `import type`), and only enum members — never string literals — where enum types are
  expected.
- **Never assert hand-typed English error sentences.** Match the canonical translated error
  substrings (`expectDomainDenial` at repo/service tier; `getServerTranslations("en").errorsTranslations`
  at journey tier).
- **Never query seed data.** Fixtures are fully self-provisioned via `entity-setup.ts` helpers.
- **Never trust app-level "no setter" as enforcement.** The DB trigger IS the guarantee; the API
  surface assertion is supplementary evidence, not a substitute.

---

## 5. Rollout Summary

The verification suite adds **no production code, no migrations, no seeds, no env keys**. Its only
deployment surface is CI: the new test files join the existing layer suites.

| Suite | Command | New tests joining |
|---|---|---|
| Database repository tests | `bun run test:db` | Wallet repository coverage + CHECK-constraint probes (`backend/db/test/repo/billing/wallet.repository.test.ts`, picked up via `backend/db/test/**` — brings `WalletRepository` to 100% lines & functions); financial immutability trigger-tier tests (`backend/db/test/logic/billing/financial-immutability.test.ts`, same pickup path) |
| Backend services tests | `bun run test:services` | Unchanged — no new service tests; real-PG chaos anchors (already present) remain green under the extended assertions |
| Workflow journey layer | `bun run test:scripts` via `bun run test/scripts/run-test.ts test/workflows` | Cross-actor financial-safety verification journey (`test/workflows/billing/financial-safety-verification.journey.test.ts` — see tasks.md Task 4: concurrent double-spend, cancel→release, dual-confirm→credit, withdrawal drain race, identity recomputation) |
| GraphQL integration | `bun run test:graphql` | SDL surface pinning remains green; wallet surface unchanged |

All runs are observed through the standard log-capture runner
(`bun run test/scripts/run-test.ts <test-path>`); the full-repo quality gate
(`bun quality-gate`) enforces lint/type parity on the new test files. Production behavior changes
only if a probe exposes a genuine defect — such a finding is escalated and ledgered, never
silently tolerated.
