# 0 — Planning Outcome (pre-implementation research record)

**Plan:** `ai/plans/milestone_4/workflow_tests_student_journey` · **Ticket:** `Workflow Tests: Student Journey` (`docs/planning/TICKETS.md:2704-2731`) · **Date:** 2026-10-08

This file records the exploration that produced `specs.md`/`plan.md`/`tasks.md`, so executing agents absorb it instead of re-deriving. Read BEFORE implementing (execution-protocol rule 1).

## 1. How the ground truth was gathered

Four parallel read-only exploration passes over: (a) `test/workflows/helpers/*` (every exported signature), (b) the 15 per-domain suites adjacent to the student arc (per-file coverage), (c) the service + GraphQL surface for all 10 arc fragments, (d) layer docs + `entity-setup.ts` + runner wiring + M0–M3 ticket status. Every citation in the plan was then spot-verified by direct grep/read during plan writing.

## 2. Verified facts that SHAPE the plan (do not re-verify, do not contradict)

1. **NO single existing suite chains the arc.** Closest: `billing/subscription-full-lifecycle.journey.test.ts` (stops after booking debit), `parents/parent-full-journey.journey.test.ts` (no purchase/confirm/wallet), `sessions/session-dual-confirmation.journey.test.ts` (no purchase/parent). The consolidated gap is the ticket's genuine build item (ruling R6; composition guidance `docs/testing/workflow-journey-tests.md:141-158`).
2. **`runInRollback` is FORBIDDEN** in `test/workflows/` (`test/workflows/AGENTS.md:8-11`) — the ticket's Given wording is stale (R1).
3. **GraphQL touch = in-process harness only** (`graphql()` + `graphQLSchema` + hand-built `Context`; precedent `subscription-purchase.journey.test.ts:87-105, 189-264`). No HTTP/`testClient` anywhere in the layer (R2).
4. **Recitation selection is echo-only** (`RegistrationSubmitInput.preferredRecitation` validated, never persisted; `RegistrationReturnType` echoes it — `registration.types.ts:42-65, :106-109`) (R3).
5. **Money semantics: hold-as-debit.** Lane decrements at `createSession` via the trial-first ladder (`session-lifecycle.booking.ts:127-158`); confirmation flips `fee_held` + credits wallet in one tx (`session-lifecycle.confirmation.ts:123-139`) and is notification-free (R4).
6. **Parent wave = report-ready wave** (`session-report-notification.service.ts:147`, type `session_completion`), gated on `students.parent_id` → the real link chain must run mid-journey (R5).
7. **Teacher browse hard filters**: `eq(teacher.isOnline, true)` + `ilike(recitations, token)` + optional language filter (`teacher.repository.matching.helpers.ts:131-137`). Teacher fixture recipe: `createTestTeacherRow` + JSON-stringified token arrays — copy `on-demand-matching.journey.test.ts:435-465` (`HAFS = RecitationReading.HAFS_AN_ASIM :113`, `HIFZ_SUBJECT = SessionIntent.Hifz :119`, `jsonColumnPayload :435`).
8. **Plan lane column**: `plans.balanceLane` (nullable pgEnum; NULL fails closed at purchase) — the fixture plan MUST set `balanceLane: SubscriptionCreditLane.Hifz` (`backend/db/schema/billing/plans.ts:29`; enum `backend/enum/billing/subscription-credit-lane.enum.ts:9-13`) (R4, D8).
9. **Free trial**: `FREE_TRIAL_SESSION_COUNT = 1`, granted inside `registerUser`; `createTestStudent` does NOT grant a trial (zero-balance actor is a direct-insert student) (`shared/constants/free-trial.constants.ts:11`; `student-trial.service.ts:29`).
10. **Fees**: `SESSION_FEE_HIFZ = "25.00"` EGP (`shared/constants/session-fees.constants.ts:35-38`); `session.fee`/`fee_held` at `backend/db/schema/classes/session.ts:67-68`.
11. **Participant `cancelSession` is notification-silent** (refund + lock release only — no notify calls in `session-lifecycle.service.ts:490-540`); admin governance cancel DOES wave (in-session-lock-release suite).
12. **Immutable/append-only teardown**: `student_payments` + `teacher_transaction` DELETE-blocked → sweep under `withImmutabilityTriggersSuspended` (`test/helpers/db-cleanup.ts:229`); `audit_logs` → `withAuditDeleteTriggersSuspended`. Precedents: `subscription-purchase.journey.test.ts:432-448`, `session-dual-confirmation.journey.test.ts:326-331`, `post-confirmation-dispute.journey.test.ts:429-451`.
13. **Registry choice**: `createSessionFixtureRegistry` tracks only 9 tables (no billing/parents vocabulary — `journey-fixture-registry.ts:73-83`); the journey uses table-generic `TrackedFixtures` (`tracked-fixtures.ts:173-263`, 43-suite dominant pattern).
14. **Interception seams**: inject `{ transport: SpiedFanoutTransport, cache: InMemoryClaimCache }` where `options?: NotificationEngineCallOptions` exists (report, link, settle); `spyOn(NotificationEngine, "publishReceipts")` for lifecycle methods without the seam (D6; precedents `session-lifecycle.journey.test.ts:250-263`, `subscription-purchase.journey.test.ts:150`).
15. **CI gap**: no workflows job in `.github/workflows/ci.yml` (ledger D1). **Runner**: `bun run test/scripts/run-test.ts <path>` pins `DATABASE_URL` from `.env.test` (`kottaby_test` DB).
16. **Webhook fabrication precedent**: build the confirmed `PaymentWebhookEvent` from the pending purchase's `paymentReference` + plan's verbatim `price`/`currency` (`subscription-purchase.journey.test.ts:117-133, :540-550`); mock gateway = no network.
17. **Admin dispute wave is a SUPERSET**: `notifyAdminsOfDisputeOpened` fans out to every governance-clean admin in the DB — assert membership (`contains adminId`), never set-equality.
18. **Wallet reads**: `WalletService.getMyWallet` / ledger reads, or direct row reads; `total_earning` reversal semantics follow `post-confirmation-dispute.journey.test.ts:654-688`.

## 3. Carry-over points for implementers

- The suite MUST stay green after every Phase 1 task (incremental-green strategy, tasks.md protocol).
- Step numbering in `specs.md` §5.2 is the canonical order; tasks 1.1–1.7 map onto it exactly.
- If a service signature drifts between plan-time and implementation: STOP, record a ledger row, and re-run the Phase 1.5 review on the affected section — never silently adapt a ratified ruling.
- The plan's `plan.md` §5.4 end-state table is the acceptance oracle for task 1.7's sweep step — implement it as literally as the shipped semantics allow.
