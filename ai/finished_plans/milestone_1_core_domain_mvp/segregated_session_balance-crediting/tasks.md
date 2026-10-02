# Implementation Tasks: Segregated Session Balance Crediting (DEV1-007)

**Plan directory:** `ai/plans/milestone_1_core_domain_mvp/Segregated Session Balance-crediting/`
**Specs:** `ai/plans/milestone_1_core_domain_mvp/Segregated Session Balance-crediting/specs.md` · **Plan:** `ai/plans/milestone_1_core_domain_mvp/Segregated Session Balance-crediting/plan.md`
**Deferred items:** `ai/plans/milestone_1_core_domain_mvp/Segregated Session Balance-crediting/deferred-items.md` · **Outcome:** `ai/plans/milestone_1_core_domain_mvp/Segregated Session Balance-crediting/outcome/`
**Version**: 1.0 · **Date**: 2026-09-11

> Phase 1.5 (plan review gate) is executed by the plan generator itself; its verdict lives in `outcome/plan-review-R1.md`.
> Nature of this plan: verification + gap closure + ratification. The substrate shipped under DEV1-006 / DEV3-004 / DEV3-012 — DO NOT re-implement or fork it.

## Non-Negotiable Execution Protocol

- **P1.** Before ANY task: read ALL files under `ai/plans/milestone_1_core_domain_mvp/Segregated Session Balance-crediting/outcome/`.
- **P2.** After EVERY file edit: `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` → exit 0 before moving on.
- **P3.** DB tests: `runInRollback` + `tx` everywhere + `expectRepoError` (never `rejects.toThrow`); fixtures only from `backend/db/test/entity-setup.ts` (`createTestUser/createTestStudent/createTestPlan/createTestSubscription`).
- **P4.** Workflows: NEVER `runInRollback`; committed `beforeAll` fixtures + tracked `afterAll` cleanup; run via `bun run test/scripts/run-test.ts test/workflows/...` (never raw `bun test`).
- **P5.** GraphQL integration tests: `testClient` against the dev-server harness (`bun run test:graphql`), never raw fetch.
- **P6.** i18n: single-arg `getTranslations(locale)` (server components), `ctx.t("errorsTranslations")` (resolvers), `getServerTranslations(locale).errorsTranslations` (services/scripts/tests). FORBIDDEN: two-arg calls, `Translation.` enums, function-call keys.
- **P7.** Every completed task: semantic-review checklist + outcome file + checkbox flip.

---

## Phase 0 — Baseline & Ledger

- [x] 0.1 Establish error baseline and confirm the deferred-items ledger
  - Record baseline counts: `bun tsgo 2>&1 | grep -c "error TS"`; `bun biome:check 2>&1 | grep -c "warn"`; `bun run scripts/lint-service.ts --json --id baseline > /tmp/baseline-lint.json`
  - Confirm `deferred-items.md` exists (created at plan generation) and note its initial entries D1–D5
  - Write `outcome/0-baseline-outcome.md` with the counts
  - _Requirements: REQ-001, REQ-002_

## Phase 1 — Substrate Verification Audit

- [x] 1.1 Verify the shipped substrate against every ticket AC and record execution evidence
  - Run and cite (green output pasted into the outcome):
    - `bun run test/scripts/run-test.ts backend/db/test/repo/students/student.repository.test.ts` (credit lanes :351-483; CHECK rejection :428-460)
    - `bun run test/scripts/run-test.ts backend/services/billing/subscription-activation.service.test.ts` (credit :523-573, replay :380-404/861-885, NULL-lane quarantine :450-482)
    - `bun run test/scripts/run-test.ts backend/services/classes/session-lifecycle.service.test.ts` then view the denial cases via `bun run test/scripts/run-test.ts --last --focus "INSUFFICIENT_BALANCE" backend/services/classes/session-lifecycle.service.test.ts` (`--focus` only applies to the `--last` view), plus the chaos case (:2314-2334)
    - `bun run test/scripts/run-test.ts test/workflows/billing/subscription-purchase.journey.test.ts` and `.../sessions/session-lifecycle-denials.journey.test.ts`
  - Build the AC↔evidence matrix: each gherkin AC of `docs/planning/TICKETS.md:508-526` + test scenarios :528-535 → executing test ref
  - Verify tenancy/security posture read-only (REQ-029): no mutation accepts caller-supplied balance deltas; balance fields only on admin read types (`admin-students.pothos.ts:49-52`)
  - Confirm locale parity for `insufficientBalance` (en `shared/locale/en/errors/index.ts:85` / ar `shared/locale/ar/errors/index.ts:84`)
  - Record the four documented divergences as "ratify-pending" (timing, trial-first, reviews-credit-only, 422-phrasing) for Task 3.2
  - **QL**: outcome file only (`bun run scripts/health/sub-loop.ts ai/plans/milestone_1_core_domain_mvp/"Segregated Session Balance-crediting"/outcome/1.1-substrate-verification-outcome.md --lifecycle duplicates`)
  - **SR/IV**: checklist + read printed rule files
  - Outcome: `outcome/1.1-substrate-verification-outcome.md`
  - _Requirements: REQ-003, REQ-008, REQ-009, REQ-010, REQ-011, REQ-012, REQ-013, REQ-014, REQ-015, REQ-016, REQ-019, REQ-020, REQ-022, REQ-023, REQ-027, REQ-029_

## Phase 2 — Gap Closure (test-tier only)

- [x] 2.1 Tajweed-lane service-level credit test (close REQ-017)
  - File: `backend/services/billing/subscription-activation.service.test.ts` — add one test mirroring the Hifz case (:523-542) with a `SubscriptionCreditLane.Tajweed`-laned plan: confirmed webhook → `balance_tajweed += sessionCount`, hifz/reviews/trial untouched
  - This retires the file's own "hifz/tajweed byte-identical" assumption note (:39) with an executable proof
  - - [x] 2.1.QL `bun run scripts/health/sub-loop.ts backend/services/billing/subscription-activation.service.test.ts --lifecycle duplicates` → exit 0
  - [x] 2.1.TE Tier 1–4 per house pipeline; service tier: mock external adapters (`backend/services/AGENTS.md` testing rules)
  - [x] 2.1.SEC no new input surface (assert no caller-controlled lane/amount path is introduced)
  - [x] 2.1.SR + 2.1.IV semantic checklist + read printed rule files (`backend/services/AGENTS.md`, `backend/AGENTS.md`, `.agents/instructions/backend.instructions.md`, `.agents/instructions/tests.instructions.md`)
  - Run: `bun run test/scripts/run-test.ts backend/services/billing/subscription-activation.service.test.ts` (green)
  - Outcome: `outcome/2.1-tajweed-service-test-outcome.md`
  - _Requirements: REQ-017, REQ-030_

- [x] 2.2 Tajweed journey leg (close REQ-018)
  - File: `test/workflows/billing/subscription-purchase.journey.test.ts` — extend J1 with a Tajweed-laned plan leg (pattern after the Hifz leg :506-545 and Reviews leg :765-813): purchase (mock gateway) → signed webhook → `balance_tajweed == PLAN_SESSION_COUNT`, sibling lanes untouched; duplicate webhook replay ⇒ no second credit
  - Fixtures via `createTestPlan(tx, { balanceLane: SubscriptionCreditLane.Tajweed, ... })` + the suite's tracked registry; per-run `jrn_billing_<8hex>` prefix
  - [x] 2.2.QL sub-loop on the journey file → exit 0
  - [x] 2.2.TE follows `test/workflows/AGENTS.md` (NO runInRollback; tracked cleanup; spied transports)
  - [x] 2.2.SEC denial probe stays green; foreign-actor invariance asserted per journey rules
  - [x] 2.2.SR + 2.2.IV semantic checklist + printed rule files (`test/workflows/AGENTS.md`, tests.instructions.md)
  - Run: `bun run test/scripts/run-test.ts test/workflows/billing/subscription-purchase.journey.test.ts` (green, twice → idempotent teardown proof)
  - Outcome: `outcome/2.2-tajweed-journey-outcome.md`
  - _Requirements: REQ-018, REQ-031_

- [x] 2.3 GraphQL-transport pin for `INSUFFICIENT_BALANCE` (close REQ-021)
  - New file: `backend/graphql/test/session-booking-balance.test.ts` — drive `createSession` via `testClient` as a zero-balance student (trial = 0 and intent lane = 0); assert `errors[0].extensions.code === "INSUFFICIENT_BALANCE"` and the localized message matches `getServerTranslations("en").errorsTranslations.insufficientBalance`; assert no `sessions` row was created and the subscription/payment rows are untouched; repeat with a funded lane → success control
  - Follow the harness/patterns of `backend/graphql/test/session-lifecycle-mutations.test.ts` (setupTestServerLifecycle + testClient, no raw fetch)
  - [x] 2.3.QL sub-loop on the new test file → exit 0
  - [x] 2.3.TE Tier 1–4; Tier 4 includes unauthenticated call → UNAUTHORIZED, and teacher-role call → FORBIDDEN (BFLA probe)
  - [x] 2.3.SEC verifies no balance values leak in the denied response payload
  - [x] 2.3.SR + 2.3.IV semantic checklist + printed rule files (`backend/graphql/AGENTS.md`, backend instructions, tests instructions)
  - Run: `bun run test:graphql` (green)
  - Outcome: `outcome/2.3-graphql-insufficient-balance-outcome.md`
  - _Requirements: REQ-021, REQ-032_

## Phase 3 — Documentation Sync & Ratification

- [x] 3.1 DBML parity sync (close REQ-028)
  - `db/schema.dbml`: students table (:218-231) — add `balance_trial` (default 0, not null), `trial_granted_at`, and the four `students_balance_*_check` CHECK notes; `plans` (:277-288) — add `balance_lane` (enum `subscription_credit_lane`, nullable) with a note that NULL lanes fail closed; subscriptions — add the `subscriptions_payment_reference_unique` partial index entry (mirror `backend/db/schema/billing/subscriptions.ts:53-55`)
  - Docs-only; MUST NOT diverge from `backend/db/schema/` (re-verify each line against the Drizzle source while editing)
  - [x] 3.1.QL sub-loop on `db/schema.dbml` → exit 0; no dedicated DBML validator exists in the repo today (verified — `scripts/validate-mermaid.ts` is absent), so parity is enforced by re-reading the Drizzle source per edited line
  - [x] 3.1.TE N/A (documentation artifact); 3.1.SEC N/A; 3.1.SR checklist; 3.1.IV read printed rule files
  - Outcome: `outcome/3.1-dbml-sync-outcome.md`
  - _Requirements: REQ-028_

- [x] 3.2 Ratification record + readiness check-off + canonical doc (REQ-024, REQ-025, REQ-026, REQ-033, REQ-034)
  - Ratify D1–D4 (plan.md §1.3) by recording them in the canonical doc with invariant bindings
  - Tick `docs/planning/PRODUCTION_READINESS.md:243-248` §5.3.1–5.3.5 with evidence refs collected in Task 1.1 + Phase 2 executions (5.3.1→REQ-010; 5.3.2→REQ-013/017/018; 5.3.3 (expiry — NON-ticket item, leave unchecked and note WHY: DEV1-008 scope); 5.3.4→REQ-020/021; 5.3.5→REQ-015/018) — only tick boxes whose evidence actually executed
  - Create `docs/billing/segregated-session-balance.md` (Why → Lane model → Credit path → Hold/refund path → Guarded-mutation rules → Ratified semantics D1–D4 → Anti-patterns → Test map → Related docs), cross-linking `docs/billing/subscription-purchase.md`, `docs/sessions/session-lifecycle.md`, `docs/specs/state-machine-invariants.md` §4.2
  - [x] 3.2.QL sub-loop on each modified/created file → exit 0 (nothing-to-lint-for-.md counts as pass — tsgo stage green, oxlint/lint report no files; recorded in outcome)
  - [x] 3.2.TE N/A (docs); 3.2.SEC N/A; 3.2.SR checklist (verify no REQ/Task/Phase ids leak into product code comments — docs may reference them); 3.2.IV printed rule files
  - Outcome: `outcome/3.2-ratification-and-docs-outcome.md`
  - _Requirements: REQ-024, REQ-025, REQ-026, REQ-033, REQ-034_

## Phase 4 — Review Wave & Closeout

- [x] 4.1 Review wave + final quality gate (REQ-035)
  - Dispatch review subagents scoped ONLY to files this plan touched: `review-backend` (test changes), `review-types` (none expected — confirm), security-probing (booking denial + purchase gating diff)
  - Fix findings; re-verify each file via sub-loop
  - Deferred-items enforcement: `awk '/^## Ledger Table/,/^## Status Values/' "ai/plans/milestone_1_core_domain_mvp/Segregated Session Balance-crediting/deferred-items.md" | grep -c "❌\|⚠️"` ⇒ expected 0 (D1–D5 carry recorded dispositions)
  - Baseline delta: rerun Phase 0 commands; zero new errors vs `/tmp/baseline-*`
  - Full suites: `bun run test:db`; `bun run test:services`; targeted workflow runs; `bun run test:graphql`
  - Outcome: `outcome/4.1-review-wave-outcome.md`
  - _Requirements: REQ-001, REQ-002, REQ-035_

- [x] 4.2 Knowledge propagation closeout
  - Read ALL outcome files; synthesize recurring gotchas into `docs/billing/segregated-session-balance.md` (final section) if gaps surfaced
  - Confirm AGENTS.md / `.agents/instructions/` untouched (hand-curated)
  - Write `outcome/4.2-knowledge-propagation-outcome.md`
  - _Requirements: REQ-004, REQ-005, REQ-006, REQ-007, REQ-034_

---

## Requirements Coverage Matrix (traceability)

| REQ | Task | REQ | Task | REQ | Task |
|---|---|---|---|---|---|
| REQ-001 | 0.1, 4.1 | REQ-013 | 1.1 | REQ-025 | 3.2 |
| REQ-002 | 0.1, 4.1 | REQ-014 | 1.1 | REQ-026 | 3.2 |
| REQ-003 | 1.1 | REQ-015 | 1.1 | REQ-027 | 1.1 |
| REQ-004 | 4.2 | REQ-016 | 1.1 | REQ-028 | 3.1 |
| REQ-005 | 4.2 | REQ-017 | 2.1 | REQ-029 | 1.1 |
| REQ-006 | P2, 4.2 | REQ-018 | 2.2 | REQ-030 | 2.1 |
| REQ-007 | P7, 4.2 | REQ-019 | 1.1 | REQ-031 | 2.2 |
| REQ-008 | 1.1 | REQ-020 | 1.1 | REQ-032 | 2.3 |
| REQ-009 | 1.1 | REQ-021 | 2.3 | REQ-033 | 3.2 |
| REQ-010 | 1.1 | REQ-022 | 1.1 | REQ-034 | 3.2, 4.2 |
| REQ-011 | 1.1 | REQ-023 | 1.1 | REQ-035 | 4.1 |
| REQ-012 | 1.1 | REQ-024 | 3.2 | | |

## Completion Definition

- All tasks `[x]`; every ticket AC bound to executed evidence; Phase-2 gaps closed green; DBML synced; §5.3.1–5.3.5 dispositioned with evidence; canonical doc shipped; deferred ledger clean (zero ❌/⚠️); baseline delta zero; review wave clean.
- Plan then moves to `ai/finished_plans/milestone_1_core_domain_mvp/` per house convention.
