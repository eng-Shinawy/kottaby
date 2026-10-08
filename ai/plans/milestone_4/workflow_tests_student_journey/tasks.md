# Implementation Tasks: Workflow Tests (Student Journey)

> **Plan directory (verbatim):** `ai/plans/milestone_4/workflow_tests_student_journey`
> **Specs of record:** `ai/plans/milestone_4/workflow_tests_student_journey/specs.md` (REQ-000…REQ-014, rulings R1–R7) · **Design of record:** `ai/plans/milestone_4/workflow_tests_student_journey/plan.md` (D1–D8, step table specs §5.2)
> **Ticket (governing ruling):** Milestone 4 · Dev 1 · 5 SP · blocked by all M1–3 tickets, all verified implemented (`docs/planning/TICKETS.md:2704-2731`). Ship **ONE consolidated journey suite** `test/workflows/students/student-full-journey.journey.test.ts` (~31 sequential steps: registration → purchase/settle/credit → link chain → browse → book → lifecycle → confirm/wallet → report/parent-wave → portal reads; plus 3 edge legs + GraphQL parity leg + final consistency sweep + hardened teardown). **ZERO production code, ZERO schema change, ZERO new helpers, ZERO UI, ZERO locale keys.** The ONE non-test edit is the `linkStudentToParentFixture` stale-docblock fix (comment-only, task 2.1). The suite REUSES existing oracles and adds nothing new (composition ruling R6).

---

## Non-Negotiable Execution Protocol

1. **Pre-Execution Knowledge Read:** Before executing ANY task, read ALL files in `ai/plans/milestone_4/workflow_tests_student_journey/outcome/` in lexical order. Prior outcomes are binding context — never contradict a ratified ruling (R1–R7) without a ledger entry.
2. **Post-Edit Verification:** EVERY created/modified file MUST pass `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` (exit 0) before its task checkbox flips. The script auto-discovers applicable `AGENTS.md` + `.agents/instructions/*.instructions.md` files.
3. **Test Execution:** ALL runs via `bun run test/scripts/run-test.ts <test-path>` — NEVER raw `bun test` (it skips the `.env.test` preload pinning `DATABASE_URL` to `kottaby_test`). This suite: `bun run test/scripts/run-test.ts test/workflows/students/student-full-journey.journey.test.ts`. Whole layer: `bun run test/scripts/run-test.ts test/workflows`. Use `--last` / `--last --focus "<pattern>"` for AI-optimized re-reads.
4. **Semantic Review:** Every task includes an `.SR` self-review (registry completeness — EVERY service-created row tracked; no `runInRollback`; spies restored; enums as VALUE imports; no cross-layer imports; no `console.*`; no `any`).
5. **Outcome Documentation:** Every task writes `ai/plans/milestone_4/workflow_tests_student_journey/outcome/<task-id>-outcome.md` BEFORE the next task begins.
6. **Checkbox Tracking:** `[ ]` → `[x]` only when ALL subtasks (`.QL`/`.TE`/`.SEC`/`.SR`/`.IV`) complete. No partial flips.
7. **Ledger Discipline:** Forward/incomplete-looking items are recorded ONLY as ✅ resolved-pointer entries in `ai/plans/milestone_4/workflow_tests_student_journey/deferred-items.md`; the final gate is `grep -cE '^\s*\|.*(❌|⚠️)' deferred-items.md` = 0 (row-scoped; the template's legend lines contain the symbols but only ledger table rows count).
8. **Drizzle rule:** N/A — this plan touches ZERO schema. Neither `db push` nor `db migrate` is invoked.

**Mandatory 5-stage subtask pipeline (strict order) for EVERY implementation task X.Y:** `X.Y.QL` (per-file sub-loop) → `X.Y.TE` (test engineering — for this plan: run the suite leg green via the approved runner + tier mapping) → `X.Y.SEC` (denial/tenancy audit of the leg's assertions) → `X.Y.SR` (semantic review) → `X.Y.IV` (instruction verification). No skipping ahead: if tsgo fails, fix only tsgo before running oxlint/biome/lint/duplicates.

**Applicable rule files (auto-discovered by `sub-loop.ts`; read before fixing):** root `AGENTS.md` · `test/workflows/AGENTS.md` (ALL tasks — the layer law) · `.agents/instructions/tests.instructions.md` (all test files) · `backend/AGENTS.md` (task 2.1 touches `test/workflows/helpers/`, read the helper-layer context there).

**Incremental-green strategy (binding):** the suite is built as a ALWAYS-GREEN file — every Phase 1 task lands its steps and leaves the suite passing via the runner. Never land a red intermediate state; steps accumulate in declaration order (rule 11).

---

## Phase 0: Pre-Implementation Baseline

### 0.1 Record Error Baseline & Initialize Deferred-Items Ledger

- [ ] 0.1 [Record baseline + verify ledger]
  - Run and capture: `bun tsgo 2>&1 | grep "error TS" | wc -l > /tmp/baseline-tsgo.txt` · `bun biome:check 2>&1 | grep -c "warn" > /tmp/baseline-biome.txt` · `bun run scripts/lint-service.ts --json --id baseline > /tmp/baseline-lint.json`
  - VERIFY the pre-seeded `ai/plans/milestone_4/workflow_tests_student_journey/deferred-items.md` (ships with resolved-pointer rows D1–D6; do NOT re-create from template). Confirm D5 (stale docblock) is the only in-plan target (task 2.1).
  - Write `outcome/0-baseline-outcome.md` with the captured numbers (REQ-000 comparator).
  - _Requirements: REQ-000_

### 0.2 Anchor Verification (grep/Read, no edits — BLOCKS Phase 1)

- [ ] 0.2 [Verify every consumed anchor exists at its cited path:line]
  - Services: the 13 signatures in `plan.md` §4.3 (registration `registration.service.ts:89-92`, catalog `plan-catalog.service.ts:249`, purchase `subscription-purchase.service.ts:491`, settle `subscription-activation.service.ts:554-558`, handshake `student-handshake.service.ts:74`, link `parent-link-request.service.ts:168/:250`, browse `teacher-matching.service.ts:346-351`, lifecycle five `session-lifecycle.service.ts:201/:282/:361/:490/:749`, report `session-report.service.ts:357/:448`, portal six `parent-monitoring.service.ts:178-382`, arbitration `session-arbitration.service.ts:193/:313`).
  - Helpers: `TrackedFixtures` (`tracked-fixtures.ts:173-263`), `SpiedFanoutTransport` (`spied-transport.ts:49`), `InMemoryClaimCache` (`in-memory-claim-cache.ts:24`), `journeyPrefix` (`session-cast.ts:314`), `catchJourneyError` (`journey-fixtures.ts:226`), entity-setup factories (`entity-setup.ts:74/:104/:131/:169/:180/:550`).
  - Constants/enums: `SESSION_FEE_HIFZ = "25.00"` (`session-fees.constants.ts:35-38`), `FREE_TRIAL_SESSION_COUNT = 1` (`free-trial.constants.ts:11`), `SubscriptionCreditLane.Hifz` (`subscription-credit-lane.enum.ts:9`), `RecitationReading.HAFS_AN_ASIM` (`recitation-reading.enum.ts:39`), `SessionIntent.Hifz` (`session-intent.enum.ts:6`).
  - Precedents to copy: GraphQL harness (`subscription-purchase.journey.test.ts:87-105, 189-264, 731-771`), webhook fabrication (`:117-133, :540-550`), teardown suspensions (`:432-448`; `session-dual-confirmation.journey.test.ts:326-331`; `post-confirmation-dispute.journey.test.ts:429-451`), teacher fixture recipe (`on-demand-matching.journey.test.ts:435-465`, tokens: `HAFS = RecitationReading.HAFS_AN_ASIM :113`, `HIFZ_SUBJECT = SessionIntent.Hifz :119`, `jsonColumnPayload :435`).
  - IF any anchor drifted: record a ledger row and BLOCK the dependent task — never inline-patch a foreign layer.
  - _Requirements: REQ-000_

### 0.3 Phase 1.5 Plan-Review Gate (BLOCKING — executed at plan time)

- [x] 0.3 [Verify the recorded plan-review verdict]
  - The trio (`specs.md` + `plan.md` + this `tasks.md`) was reviewed via the `plan-review` skill during plan generation; the verdict + fixes are recorded in `ai/plans/milestone_4/workflow_tests_student_journey/outcome/plan-review-R1.md`.
  - Read that file; confirm it records ZERO unresolved violations and that all fixes landed. IF any violation remained unresolved, fix the plan files and re-run the review BEFORE starting Phase 1.
  - _Requirements: REQ-000 (execution protocol)_

---

## Phase 1: The Consolidated Journey Suite (`test/workflows/students/student-full-journey.journey.test.ts`)

### 1.1 Suite Scaffold, Cast Provisioning & Registration-Outcomes Step

- [ ] 1.1 [Scaffold suite + committed cast + step 1 — suite GREEN from first landing]
  - Read all `outcome/` files; then create `test/workflows/students/student-full-journey.journey.test.ts` with: imports (bun:test, `@/test/workflows/helpers`, entity-setup, services, `graphQLSchema` + Context factory, `getServerTranslations`, Drizzle tables + VALUE enums) — NO relative imports, NO `console.*`, NO `any`.
  - `beforeAll`: ONE committing `db.transaction`: register S via real `RegistrationService.registerUser({ ..., country: "EG", role: "student", preferredRecitation: RecitationReading.HAFS_AN_ASIM }, "en", tx)` and P (locale `"ar"`) the same way (D3); direct-insert T via `createTestUser` + `createTestTeacherRow` with the on-demand-matching metadata recipe (`isOnline: true`, `isApproved: true`, `recitations: JSON.stringify(["hafs_an_asim"])`, `subjects: JSON.stringify([SessionIntent.Hifz])`, languages per recipe, `averageRating`); A via `createTestAdmin`; S2 via `provisionStudentActor`-equivalent (zero lanes — `createTestStudent` grants NO trial); P2 via `createTestParent`; plan row via `createTestPlan(tx, { balanceLane: SubscriptionCreditLane.Hifz, sessionCount: 8, price: "200.00", currency: "EGP", intervalDays: 30, isActive: true })`. `tracked.register(...)` EVERY row (users first, then child — reverse-safe).
  - Step 1 (Student): assert registration outcomes — user row `role: "student"`, `preferredRecitation` echoed (`RegistrationReturnType`), `balanceTrial = 1`, all paid lanes 0, handshake code non-empty (`getMyHandshakeCode`), ZERO `recitation` rows (R3).
  - `afterAll` SKELETON (hardened in 1.7): restore spies → `tracked.cleanup()` → zero-residue re-probes.
  - **1.1.QL** sub-loop on the new file (exit 0) · **1.1.TE** run via `bun run test/scripts/run-test.ts test/workflows/students/student-full-journey.journey.test.ts` — green · **1.1.SEC** honest roles verified (real `users.role` + role-child rows; no permission stubs) · **1.1.SR** registry completeness: all 6 users + 2 students + 2 parents + 1 teacher + 1 admin + 1 plan tracked; prefix `journeyPrefix("students")` · **1.1.IV** read `test/workflows/AGENTS.md` + root `AGENTS.md` + `.agents/instructions/tests.instructions.md` (auto-printed by sub-loop) and validate.
  - Write `outcome/1.1-outcome.md`; flip checkbox.
  - _Requirements: REQ-001, REQ-003_

### 1.2 Catalog, Purchase, Settlement, Replay & GraphQL Parity Legs

- [ ] 1.2 [Steps 2-7: money-in + scope gates]
  - Step 2 (Student): `listActiveCatalog("en")` contains the journey plan (REQ-004.1).
  - Step 3 (Student): in-process GraphQL `planCatalog` query with student context — positive parity (copy harness from `subscription-purchase.journey.test.ts:189-264`; REQ-005.2).
  - Step 4 (Student): `purchase(S, { planId }, keyP, "en")` → pending pair + checkout ref; assert no network path (mock provider) (REQ-004.2).
  - Step 5 (Anonymous/Parent/Teacher): GraphQL `purchaseSubscription` denial probes — anonymous → `UNAUTHORIZED`, parent + teacher → `FORBIDDEN`; single-error shape per precedent `:731-771`; zero writes; pending rows byte-identical (REQ-005.3/.4).
  - Step 6 (System): fabricate confirmed `PaymentWebhookEvent` from `paymentReference` + plan `price`/`currency` (precedent `:540-550`) → `processWebhookEvent(..., { transport: spied, cache: claimCache })` → payment paid, subscription active, `balanceHifz` 0→8, ONE `PaymentConfirmation` wave `{S}` (publish-window discipline `workflow-journey-tests.md:95-103`) (REQ-004.3/.4).
  - Step 7 (System): replay the same event → `replayed` truthy; lane stays 8; NO second wave; zero extra rows (REQ-004.5).
  - Track service-created rows: subscriptions, student_payments (id for the trigger-suspension sweep), idempotency claim, junction (sweep-by-subscription-id at teardown), notifications.
  - **1.2.QL..IV** pipeline as in 1.1 (SEC: scope-gate denials resolve through the REAL GraphQL scope plugin — no stubs). Write `outcome/1.2-outcome.md`; flip checkbox.
  - _Requirements: REQ-004, REQ-005_

### 1.3 Parent Link Chain Leg (Real Production Flow)

- [ ] 1.3 [Steps 8-10: handshake → request → accept]
  - Step 8 (Student): `getMyHandshakeCode(S, "en")` returns the minted code (REQ-006 precondition).
  - Step 9 (Parent): `requestLink(code, P, "ar", undefined, { transport, cache })` → link-request row + student wave `{S}` (REQ-006.1).
  - Step 10 (Student): `respondToLinkRequest(requestId, true, S, "en", undefined, { transport, cache })` → `students.parentId = P`; parent acceptance wave `{P}`; `listLinkedChildren(P, "ar")` = [S] (REQ-006.2/.3). Assert P2 (unlinked) sees NOTHING (no fan-out).
  - Do NOT use `linkStudentToParentFixture` (ruling R5). Track the link-request + notification rows.
  - **1.3.QL..IV** pipeline. Write `outcome/1.3-outcome.md`; flip checkbox.
  - _Requirements: REQ-006_

### 1.4 Teacher Browse, Booking, Lifecycle, Confirmation & Wallet Legs

- [ ] 1.4 [Steps 11-17: the session core]
  - Step 11 (Student): `browseAvailableTeachers(S, { recitation: HAFS_AN_ASIM, intent: SessionIntent.Hifz, page: 1, pageSize: 25, search: null, minRating: null, sort: RATING_DESC }, "en")` — teacher T present (hard filters is_online + recitations token; REQ-007.1).
  - Step 12 (Student): `createSession(S, { teacherId: T, intent: Hifz }, keyA, "en")` → scheduled, `fee: "25.00"`, `feeHeld: true`, trial 1→0 with hifz UNCHANGED at 8 (ladder precedence), ONE request wave `{T}` (namespace spy on `publishReceipts` — D6). Track session + idempotency row (REQ-007.2-4).
  - Step 13 (Student): replay keyA → `DUPLICATE_REQUEST`, zero new rows (REQ-007.5).
  - Step 14 (Teacher): `startSession(T, sessionA, "en")` → started; `isOnline=false` (in-session lock) (REQ-008.1).
  - Step 15 (Teacher): `completeSession(T, sessionA, "en")` → completed; ONE prompt wave `{S}` (REQ-008.2).
  - Step 16 (Student): `confirmSessionCompletion(S, sessionA, "en")` → `feeHeld=false`; wallet ensured once + credited `"25.00"` (balance AND total_earning); ONE `earning` ledger row verbatim; ZERO publishes; `isOnline` restored; progress incremented; lanes unchanged (REQ-008.3/.4). Track wallet row.
  - Step 17 (Parent — denial): `confirmSessionCompletion(P, sessionA, "en")` → oracle-safe session-not-found; row byte-identical (REQ-008.5, REQ-009.6).
  - **1.4.QL..IV** pipeline (SEC: non-owner denial via real ownership predicate; wallet assertions via `countWalletsForTeacher`/`countTeacherTransactionsForTeacher` or direct row reads — immutable tables NOT tracked). Write `outcome/1.4-outcome.md`; flip checkbox.
  - _Requirements: REQ-007, REQ-008_

### 1.5 Report, Parent Wave & Portal Read Legs

- [ ] 1.5 [Steps 18-22: report → waves → portal]
  - Step 18 (Teacher): `submitSessionReport(T, sessionA, { teacherNotes, studentRatingByTeacher: 5, homework: HomeWorkAssignInput }, "en", undefined, { transport: spied, cache })` → report + homework rows; exactly TWO receipt waves `{S en, P ar}`; TWO publishes (injected seam — D6). Track report + homework + notification rows (REQ-009.1).
  - Step 19 (Student): `getSessionReport(S, sessionA, "en")` → own report visible (REQ-009 read).
  - Step 20 (Parent): inbox row carries `session_completion` type + `(type, "session", sessionA)` related-entity triple; `getSessionTarget(P, sessionA, "ar")` → `{ sessionId, studentId }`; landing URL shape `/parent/children/<studentId>?tab=reports&session=<sessionId>` asserted as data (REQ-009.2/.3).
  - Step 21 (Parent): portal reads — `listLinkedChildren` = [S]; `listChildSessions` shows completed A; `listChildReports` shows the ONE report; `listChildHomework` shows the ONE homework; `getChildProgress` reflects the confirmed increment (REQ-009.4).
  - Step 22 (P2 — denial): `listChildReports(P2, S)` (and `listChildSessions`) → constant 403; owner rows byte-identical (REQ-009.5).
  - **1.5.QL..IV** pipeline (SEC: read-only + linked-child gates resolve through the real `requireLinkedChild` path). Write `outcome/1.5-outcome.md`; flip checkbox.
  - _Requirements: REQ-009_

### 1.6 Edge Legs — Insufficient Balance, Cancellation, Post-Confirmation Dispute

- [ ] 1.6 [Steps 23-29: the three ticket edge cases]
  - Step 23 (S2 — edge): `createSession(S2, { teacherId: T, intent: Hifz }, keyD, "en")` via `catchJourneyError` → `INSUFFICIENT_BALANCE` (translated substring); zero session/hold/ledger rows; NO idempotency claim burned for keyD (REQ-010).
  - Step 24 (Student): `createSession(S, { teacherId: T, intent: Hifz }, keyB, "en")` → session B scheduled; paid-lane debit hifz 8→7 (trial exhausted); `feeHeld=true`; ONE request wave `{T}` (REQ-011.1).
  - Step 25 (Student): `cancelSession(S, sessionB, reason, "en")` → cancelled; `feeHeld=false`; hifz 7→8 (same-lane refund exactly once); ZERO waves (participant cancel is silent — verified no notify calls in the cancel path) (REQ-011.2/.3).
  - Step 26 (Student — denial): replay `cancelSession` on terminal session B → `SESSION_INVALID_TRANSITION`; byte-identical row (REQ-011.4).
  - Step 27 (Student/Teacher): session C — `createSession(keyC)` → hifz 8→7; `startSession` → started; `completeSession` → completed + prompt wave `{S}`; `confirmSessionCompletion` → `feeHeld=false`, wallet 25.00→50.00, second `earning` row (REQ-012.1).
  - Step 28 (Student): `openPostConfirmationDispute(S, sessionC, reason, "en")` → disputed; admin wave CONTAINS `{A}` (membership assertion — DB may hold other admins; REQ-012.2).
  - Step 29 (Admin): `arbitrateDispute(A, sessionC, "Refund", note, null, "en")` → wallet 50.00→25.00 (debited exactly fee); hifz 7→8; ONE `ArbitrationReversal` ledger row; participants wave `{S, T}`; terminal resolution status (REQ-012.3/.4). Assert the money story per `post-confirmation-dispute.journey.test.ts:654-688` precedent.
  - **1.6.QL..IV** pipeline (SEC: dispute predicates — student-only opener, admin-only resolver — via real roles). Write `outcome/1.6-outcome.md`; flip checkbox.
  - _Requirements: REQ-010, REQ-011, REQ-012_

### 1.7 Final Consistency Sweep, Teardown Hardening & Double-Run Proof

- [ ] 1.7 [Steps 30-31 + afterAll hardening + idempotent-run proof]
  - Step 30 (System): the ONE-step end-state table — re-read every money row (S lanes trial=0/hifz=8, wallet `"25.00"`, total_earning per shipped reversal semantics, 2 earnings + 1 reversal, all 3 sessions with expected statuses + `fee_held=false` + fee `"25.00"`), content rows (1 report, 1 homework, progress increment), billing rows (subscription active, payment paid, junction present), per-actor inbox deltas exactly as stepped, S2/P2 inboxes at zero (REQ-013).
  - Step 31 / `afterAll` HARDENING: restore spies (`spyOn` restores); `withImmutabilityTriggersSuspended(["student_payments", "teacher_transaction"])` delete-by-our-ids; `withAuditDeleteTriggersSuspended` audit sweep (actor + related-entity ids — precedent `post-confirmation-dispute.journey.test.ts:429-451`); junction sweep by subscription id + re-probe (`subscription-purchase.journey.test.ts:439-448`); `tracked.cleanup()` (reverse-registration); ZERO-RESIDUE re-probes for EVERY tracked row — a leak fails the suite (REQ-014.1/.2).
  - **Double-run proof:** run the suite twice consecutively via the approved runner — both green (REQ-014.3); then whole-layer sweep `bun run test/scripts/run-test.ts test/workflows` green (no neighbor breakage).
  - **1.7.QL..IV** pipeline. Write `outcome/1.7-outcome.md`; flip checkbox.
  - _Requirements: REQ-013, REQ-014_

---

## Phase 2: Hygiene, Final Gate & Knowledge Propagation

### 2.1 Stale Docblock Fix (`test/workflows/helpers/journey-fixtures.ts:157`)

- [ ] 2.1 [Comment-only fix — `linkStudentToParentFixture` docblock]
  - The docblock claims the production link flow "does not exist yet" — DISPROVEN by `backend/services/parents/parent-link-request.service.ts:145+` and by this plan's step 9-10 (real chain driven). Rewrite the docblock to state it is a DIRECT-WRITE fixture emulation kept for suites that need a committed link without driving the real chain; real journeys use `ParentLinkRequestService`. ZERO behavior change; do NOT touch the function body.
  - **2.1.QL** sub-loop on the helpers file (exit 0) · **2.1.TE** `bun run test/scripts/run-test.ts test/workflows/helpers/helpers.self-test.test.ts` + `journey-fixtures.smoke.test.ts` green (helper contract unchanged) · **2.1.SR** comment-hygiene sweep: no stale claims remain · **2.1.IV** validate against `test/workflows/AGENTS.md` + `backend/AGENTS.md` context.
  - Resolve ledger row D5. Write `outcome/2.1-outcome.md`; flip checkbox.
  - _Requirements: R5 hygiene; root AGENTS.md comment rule_

### 2.2 Final Quality Gate & Deferred-Items Enforcement (BLOCKING)

- [ ] 2.2 [Whole-layer green + zero-unresolved-ledger + baseline comparison]
  - `grep -cE '^\s*\|.*(❌|⚠️)' ai/plans/milestone_4/workflow_tests_student_journey/deferred-items.md` → **0**.
  - Whole-layer sweep green; suite double-run green; `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` exit 0 on BOTH touched files (the journey + the helper).
  - Compare against `/tmp/baseline-*.txt`: document any new errors introduced (expected: none — test-only plan).
  - Write `outcome/2.2-final-gate-outcome.md`; flip checkbox.
  - _Requirements: REQ-000, REQ-014_

### 2.3 Knowledge Propagation & Documentation (MANDATORY final task)

- [ ] 2.3 [Consolidate learnings into `docs/` — AGENTS.md files stay hand-curated]
  - Read ALL outcome files in `ai/plans/milestone_4/workflow_tests_student_journey/outcome/`; extract recurring patterns/gotchas (e.g. lane-choreography across sessions, membership-based admin-wave assertions, mixed interception seams, immutable-table sweep discipline).
  - Update `docs/testing/workflow-journey-tests.md` consolidated-examples list (`:150-157`): add `test/workflows/students/student-full-journey.journey.test.ts` with a one-line description (ticket chain: registration → purchase → session → confirmation → parent report). If a NEW pattern emerged that deserves a standalone canonical doc, create `docs/testing/<kebab-topic>.md` following the docs structure (Why → Pattern → Rules → Anti-patterns → Rollout Summary → Related) — otherwise the examples-list update suffices.
  - NEVER touch `AGENTS.md` or `.agents/instructions/*` (hand-curated only).
  - **2.3.QL** sub-loop on the touched docs file · **2.3.SR** no stale claims introduced · **2.3.IV** validate docs against the actual shipped suite.
  - Write `outcome/2.3-knowledge-propagation-outcome.md`; flip checkbox.
  - _Requirements: knowledge-propagation protocol (spec-driven-development skill)_

---

## Requirements Traceability Matrix

| REQ | Task(s) | Suite step(s) (specs §5.2) |
|---|---|---|
| REQ-000 (baseline/protocol) | 0.1, 0.2, 0.3, 2.2 | — |
| REQ-001 (layer compliance) | 1.1 (applies to all Phase 1 tasks) | all |
| REQ-002 (consolidated file) | 1.1-1.7 | all (1-31) |
| REQ-003 (registration leg) | 1.1 | 0-1 |
| REQ-004 (purchase/settle/credit) | 1.2 | 2, 4, 6-7 |
| REQ-005 (GraphQL parity) | 1.2 | 3, 5 |
| REQ-006 (parent link chain) | 1.3 | 8-10 |
| REQ-007 (browse + booking) | 1.4 | 11-13 |
| REQ-008 (lifecycle + confirm + wallet) | 1.4 | 14-17 |
| REQ-009 (report + wave + portal) | 1.5 | 17-22 |
| REQ-010 (insufficient balance) | 1.6 | 23 |
| REQ-011 (cancellation) | 1.6 | 24-26 |
| REQ-012 (dispute + arbitration) | 1.6 | 27-29 |
| REQ-013 (consistency sweep) | 1.7 | 30 |
| REQ-014 (teardown + double-run) | 1.7 | 31 |

**Coverage check (zero-miss):** every REQ-000…REQ-014 appears in ≥1 task above; every task cites its REQs. Rulings R1-R7 are implemented as design constraints across tasks (R1: 1.1 committed cast; R2: 1.2 harness; R3: 1.1 step 1; R4: 1.4 step 12/16; R5: 1.3 + 1.5; R6: whole plan; R7: 1.4 step 12/14).
