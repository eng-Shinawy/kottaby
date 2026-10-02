# Tasks: DEV2-006 — 5-Session Evaluation Loop Booking

> **Plan directory**: `ai/plans/milestone_1_core_domain_mvp/5_session_evaluation_loop_booking/`
> **Specs**: `specs.md` · **Design**: `plan.md` · **Ledger**: `deferred-items.md` · **Outcome dir**: `outcome/`

## Non-Negotiable Execution Protocol (every task)

1. Read ALL files in `outcome/` before starting.
2. After ANY file edit: `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` → exit 0.
3. Semantic self-review before `[x]`: tenancy filters; no read-then-write races; enums value-imports; no cross-layer imports; no plan-artifact references (`REQ-x`, "Task X.Y", phase labels) in code comments or JSDoc; no `console.*`.
4. Write `outcome/<task-id>-outcome.md`; flip the checkbox here.
5. Deferred work lands immediately in `deferred-items.md` (source + target task IDs).
6. **Never** run raw `bun test` for a single file — repo/service tests go through `bun run test/scripts/run-test.ts <path>`; GraphQL integration via `bun run test:graphql`; journey via the run-test path dictated in Task 12/13.

## Layer → Rule Files (discovery: sub-loop prints the authoritative list; READ IT)

| Layer | AGENTS.md | Instructions |
|-------|-----------|--------------|
| Root | `/home/ahmed/Projects/kottaby_kottaby/AGENTS.md` | — |
| Schema | `backend/db/schema/AGENTS.md`, `backend/AGENTS.md` | `.agents/instructions/backend.instructions.md` |
| Repos | `backend/db/repo/AGENTS.md`, `backend/AGENTS.md` | same |
| Repo tests | `backend/db/test/` layer docs surfaced by sub-loop | `backend.instructions.md` + `tests.instructions.md` |
| Services | `backend/services/AGENTS.md`, `backend/AGENTS.md` | same |
| GraphQL | `backend/graphql/AGENTS.md`, `backend/graphql/mutation/AGENTS.md`, `backend/graphql/query/AGENTS.md`, `backend/graphql/pothos/AGENTS.md` (whichever exist) | same |
| Types | `backend/types/AGENTS.md`, `backend/AGENTS.md` | same |
| Shared locale | `shared/AGENTS.md`, `shared/locale/AGENTS.md` | — |
| Frontend sharedDocuments | `frontend/graphql/AGENTS.md`, `frontend/graphql/sharedDocuments/AGENTS.md`, `frontend/AGENTS.md` | `frontend.instructions.md` |
| Frontend views | `frontend/views/AGENTS.md`, `frontend/AGENTS.md` | same |
| Journeys | `test/workflows/AGENTS.md` | `tests.instructions.md` |
| UI tests (existing suite fixtures; nothing new added) | `test/ui/AGENTS.md` | `tests.instructions.md` |

## Drizzle Convention (binding)

- Schema changes: `bun run db push` ONLY; no hand-rolled migrations.
- No `sql"…-- comment …"` — comments live outside template literals.

---

## Task 0 — Pre-Implementation Baseline

- [x] 0. Record error baselines WITHOUT touching code
  - `bun tsgo 2>&1 | grep "error TS" | wc -l > /tmp/DEV2-006-baseline-tsgo.txt`
  - `bun biome:check 2>&1 | grep -c "warn" > /tmp/DEV2-006-baseline-biome.txt`
  - `bun run scripts/lint-service.ts --json --id baseline > /tmp/DEV2-006-baseline-lint.json`
  - Seed `deferred-items.md` with D1–D4 rows from specs §11 (keep as live ledger; add new rows as the plan discovers them).
  - Write `outcome/0-baseline-outcome.md`.
- _Requirements: REQ-0_

## Phase 1.5 — Plan Review Gate (MANDATORY — this generation pass)

- [x] 1.5 Review the complete plan (specs/plan/tasks) with the `@plan-review` checklist; fix all violations; record verdict + findings in `outcome/plan-review-R1.md`
  - Dimensions: paths-exist, i18n key-sets (ar/en parity on new keys), GraphQL veneer conventions, Pothos field names, permission matrix, journey mapping, references to real symbols/line numbers.
- _Requirements: REQ-0_

---

## Phase 2 — Backend Foundation

- [x] 2. **Schema + repo extensions (FK retarget + lock reads + cycle aggregates)**
  - `backend/db/schema/classes/session.ts`: FK target change ONLY (see plan §3.1). `bun run db push`; inspect the DDL diff before applying.
  - `backend/db/repo/teachers/applicant.repository.ts`: add `findForBookingGate(userId, tx)`.
  - `backend/db/repo/teachers/teacher.repository.ts`: add `findForEvaluationGateById(teacherId, tx)` returning `{id, isApproved, isEvaluator}` under `FOR UPDATE`.
  - `backend/db/repo/classes/session.repository.evaluation.helpers.ts` (NEW): `resolveCurrentEvaluationCycle`, `countEvaluationBookingsInCycle`, `listEvaluationSessionsForApplicant` — each returns plain row shapes; NO business rule inside repository modules.
  - Update `backend/db/repo/classes/session.repository.ts`: namespace delegates to the new helpers (mirrors the wave-helpers/arbitration-helpers pattern).
  - QL sub-loop per edited file.
  - TE — repo suites (`bun run test/scripts/run-test.ts <path>`):
    • `backend/db/test/repo/teachers/applicant.repository.transition.test.ts` EXTEND += `findForBookingGate` cases (lock-acquiring read returns the row; missing id → null).
    • `backend/db/test/repo/teachers/teacher.repository.test.ts` EXTEND += `findForEvaluationGateById` cases (returns `{id,isApproved,isEvaluator}` under lock; missing id → null).
    • `backend/db/test/repo/classes/session.repository.evaluation.test.ts` CREATE — cycle resolution + aggregate + list; FK allows session insert with an applicant-user id (no students row) post-retarget.
    All run under `runInRollback` + tx propagation, denials via `expectRepoError` try/catch pattern.
  - SEC: all input bound params, no LIKE, no template-interpolated user text.
  - SR: enums value imports; no plan-artifact references anywhere.
  - IV: `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` re-run prints the per-file applicable rule files; read every printed AGENTS.md and .agents/instructions file and validate the file against each.
  - Write `outcome/2-schema-repo-outcome.md` (includes DDL diff block).
  - _Requirements: REQ-2, REQ-3, REQ-4, REQ-5, REQ-6.1-6.3, REQ-7.1-7.4, REQ-8.1_

- [x] 3. **Backend types & i18n keys**
  - `backend/types/classes/session.types.ts`: add `BookEvaluationSessionInput { readonly evaluatorId: number }`.
  - CREATE `backend/types/teachers/evaluation-booking.types.ts` — `EvaluationLoopStatusReturnType`, `EvaluationEvaluatorOptionType`, `EvaluationEvaluatorOptionPageReturnType` per `plan.md` §4.1 (verbatim shape).
  - UPDATE `backend/types/teachers/index.ts` to re-export the new module (one-line barrel addition).
  - i18n: `errors` and `applicant` namespace type leaves + en/ar values + parity test extension per `plan.md` §6.3 table (all five error keys + the eight applicant keys, both locales).
  - QL sub-loop per edited file.
  - TE (compile-static): add `backend/types/teachers/evaluation-booking.types.static-assertions.test.ts` mirroring the existing `backend/types/classes/session.types.static-assertions.test.ts` convention; extend the locale parity tests.
  - SR: no two-arg `getTranslations`, no hardcoded strings; enums value-imports only.
  - IV: `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` re-run prints the per-file applicable rule files; read every printed AGENTS.md and .agents/instructions file and validate the file against each.
  - Write `outcome/3-types-i18n-outcome.md`.
  - _Requirements: REQ-0.5, REQ-8.1, REQ-9.2-9.4, REQ-10 error keys, REQ-11 codes_

---

## Phase 2.5 — Mid-Point Backend Review Gate (MANDATORY for >10 tasks; this plan has >10)

- [x] 4. **Mid-point review wave + fixes** (backend scope only)
  - Review subagents over Tasks 2-3's files: signature parity to `plan.md` §4.2, i18n keys en/ar completeness, Drizzle conventions, fk retarget correctness.
  - Fix anything found; rerun review wave until clean.
  - Write `outcome/midpoint-review-R1.md`.
  - _Requirements: REQ-0_

---

## Phase 3 — Service & GraphQL

- [x] 5. **Service: `EvaluationBookingService` (write path + reads)**
  - CREATE `backend/services/teachers/evaluation-booking.service.ts` implementing `plan.md` §4.3 EXACTLY (boundary → governance → tx: applicant lock → status/sub/credits/distinctness/evaluator gates → claim → insert → backfill; notification post-commit).
  - Export via `backend/services/teachers/index.ts` (match sibling namespace patterns).
  - QL sub-loop per edited file.
  - TE `backend/services/teachers/evaluation-booking.service.test.ts` — the full 4-tier matrix from `plan.md` §13 (booking SQL semantics, cancellation re-opens evaluator, capacity tire-spike ordering, concurrency races, replay, governance denials, field assertions incl. NULLs and deadline, notification spying).
  - SEC: tenancy assertions (no cross-applicant visibility); BOLA/BOPLA behavioral.
  - SR: no module state, no raw strings; enums as value imports.
  - IV: `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` re-run prints the per-file applicable rule files; read every printed AGENTS.md and .agents/instructions file and validate the file against each.
  - Write `outcome/5-service-outcome.md`.
  - _Requirements: REQ-1, REQ-2, REQ-3, REQ-4, REQ-5, REQ-6, REQ-10, REQ-11_

- [x] 6. **GraphQL surfaces (Pothos + mutation + queries)**
  - CREATE `backend/graphql/pothos/teachers/evaluation-booking.pothos.ts` — `BookEvaluationSessionInput`, `EvaluationLoopStatus`, `EvaluationEvaluatorOption`, `EvaluationEvaluatorOptionPage`.
  - CREATE `backend/graphql/mutation/evaluation-booking.mutation.ts` — registration-by-import `bookEvaluationSession`, `authenticated: true` scope ONLY (service gates), resolver delegates and maps `args.input.evaluatorId` (shape-only `Number(...)` parse; service re-validates). Flat root sibling of `verification-plan-purchase.mutation.ts` (no `mutation/teachers/` subdir exists — this matches the shipped pattern).
  - CREATE `backend/graphql/query/teachers/evaluation-booking.query.ts` — registers `myEvaluationLoopStatus`, `availableEvaluators`, `myEvaluationSessions` with `authenticated: true` scope, args normalized at service.
  - Update `backend/graphql/mutation/index.ts` (add `import "./evaluation-booking.mutation";` to the registration list).
  - Update `backend/graphql/query/teachers/index.ts` with a side-effect import for the new query module (and its header doc-comment).
  - Run `bun run generate:gqlSchema && bun codegen` — commit the regenerated artifacts.
  - QL sub-loop per edited file.
  - TE `frontend/graphql/test/teachers/evaluation-booking.test.ts`: anonymous (UNAUTHORIZED); non-applicant (APPLICANT_NOT_FOUND); pending/failed (APPLICANT_NOT_IN_EVALUATION); happy on in_evaluation-applicant loop; 6th attempt → typed code via `extensions.code`.
  - SR: no named exports from mutation/query files; SDL matches design §5.1 verbatim.
  - IV: `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` re-run prints the per-file applicable rule files; read every printed AGENTS.md and .agents/instructions file and validate the file against each.
  - Write `outcome/6-graphql-outcome.md`.
  - _Requirements: REQ-8, REQ-9.2-9.4, REQ-10, REQ-11_

---

## Phase 4 — Journey (test-first discipline for the shared-state loop)

- [x] 7. **Journey test FIRST** (RED: expected failing write-up at commit time)
  - CREATE `test/workflows/teachers/evaluation-loop-booking.journey.test.ts` implementing specs §6 steps end-to-end (purchase via DEV2-005 service + webhook emit via `SubscriptionActivationService.processWebhookEvent` → booking with 5 evaluators → ticket denials → cancel/rebook → 6th-booking codes → replay probes → notification receipt assertions via `spyOn(NotificationEngine, "publishReceipts")`).
  - Use `createJourneyFixtures(prefix)` and extendable raw tx inserts for any extra evaluators; per-run prefix `jrn_evalloop_${randomUUID().slice(0, 8)}`; full cleanup coverage of generated user ids.
  - QL sub-loop on the new test file (green compile, allow red runtime).
  - Document the CURRENT failing expectation list in the outcome file.
  - Write `outcome/7-journey-first-outcome.md`.
  - _Requirements: REQ-12_

- [x] 8. **Drive journey green + cross-suite sweeps**
  - Rerun the journey after Tasks 5-6 land (expect full green).
  - Full sweeps: `bun run test/scripts/run-test.ts backend/services/teachers/` + `bun run test/scripts/run-test.ts backend/db/test/repo/classes/` + targeted teacher/parent replays; `bun run test:graphql` on the new test.
  - Write `outcome/8-journey-green-outcome.md`.
  - _Requirements: REQ-12, REQ-13_

---

## Phase 5 — Frontend

- [x] 9. **Frontend GraphQL documents + barrel**
  - CREATE `frontend/graphql/sharedDocuments/teachers/evaluation-booking.documents.ts` (sibling of `applicant.documents.ts` / `student-evaluation.documents.ts`): `bookEvaluationSessionMutationDocument`, `myEvaluationLoopStatusQueryDocument`, `availableEvaluatorsQueryDocument`, `myEvaluationSessionsQueryDocument` — EVERY object selection includes `id` (Apollo cache normalization).
  - Update the teachers barrel's `index.ts` (pure re-export, side-effect imports elsewhere not needed).
  - QL sub-loop per edited file.
  - TE: contract test bump in `frontend/graphql/sharedDocuments/teachers/` (the documents contract suite MO for typed documents).
  - SR: `TypedDocumentNode` generics come from codegen; no untyped `gql` bodies.
  - IV: `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` re-run prints the per-file applicable rule files; read every printed AGENTS.md and .agents/instructions file and validate the file against each.
  - Write `outcome/9-frontend-docs-outcome.md`.
  - _Requirements: REQ-8, REQ-0.5_

- [x] 10. **Dashboard evaluation zone + booking dialog**
  - UPDATE `frontend/views/teachers/dashboard/ApplicantStatusResolution.tsx`: in the `InEvaluation` branch, render the new `EvaluationLoopZone` (new sibling file) between the attempts row and the reminder prompt.
  - CREATE `frontend/views/teachers/dashboard/EvaluationLoopZone.tsx`: progress line (interpolation of translation function with `{booked,completed,remaining,total}`), one CTA opening the dialog.
  - CREATE `frontend/views/teachers/dashboard/EvaluationBookingDialog.tsx`: list from `availableEvaluators` query; confirm fires the mutation with a fresh UUID key per open; typed error mapping exactly per `plan.md` §6.
  - UPDATE `frontend/views/teachers/dashboard/ApplicantStatusCard.tsx` ONLY IF the zone needs additional prop threading; keep the dialog's open state local to the zone component where feasible (minimize churn).
  - QL sub-loop per edited file.
  - TE — **no UI component tests and no new E2E suite exist in this project (Playwright is reserved for the Paymob checkout suite)**; frontend test coverage comes from the GraphQL integration suite (Task 6 covers the same resolvers/services the UI calls). Instead, CREATE Storybook stories `frontend/stories/teachers/EvaluationLoopZone.stories.tsx` and `frontend/stories/teachers/EvaluationBookingDialog.stories.tsx` covering the visual state matrix (zero-progress, mid-loop, loop-complete, no-credits, evaluator-already-used error copy, empty evaluator list) so the compiled TSX exercises every render branch end-to-end through `build-storybook`/tsgo; copy correctness asserted through the GraphQL integration tests.
  - SR: MUI v9 props only in `sx` (never style props); Apollo hooks from `@apollo/client/react`; NO `useLazyQuery` (stateful `useQuery` only); no hardcoded colors/strings.
  - IV: `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` re-run prints the per-file applicable rule files; read every printed AGENTS.md and .agents/instructions file and validate the file against each.
  - Write `outcome/10-frontend-outcome.md`.
  - _Requirements: REQ-9, REQ-10, REQ-13_

---

## Phase 6 — Final Gate & Knowledge Propagation

- [x] 11. **Post-implementation review wave (MANDATORY)**
  - Scope: diff of this plan only (`git diff --name-only origin/main…HEAD` scoped to the plan's files).
  - Run twin reviewers: `review-backend` + `review-frontend` (+ `security-probing` reading list only) — aggregate CRITICAL/HIGH/MEDIUM/LOW; fix per-file; re-review until zero feature findings.
  - Write `outcome/post-implementation-review.md`.
  - _Requirements: REQ-0, REQ-10_

- [x] 12. **Global quality plus deferred-items enforcement**
  - `grep -c "❌\|⚠️" deferred-items.md` → 0 (or converted into known cross-ticket coordination items with the receiving ticket referenced).
  - Baseline-vs-current comparison in the outcome file (`bun tsgo`, `bun biome:check`, lint) — deltas must be ≤ baseline + 0.
  - `bun quality-gate` green.
  - `bun run test/scripts/run-test.ts test/workflows/teachers/evaluation-loop-booking.journey.test.ts` — green (twice in a row back-to-back for idempotency proof).
  - Write `outcome/12-final-gate-outcome.md`.
  - _Requirements: REQ-0, REQ-13_

- [x] 13. **Knowledge propagation & documentation**
  - CREATE `docs/teachers/evaluation-loop-booking.md` (canonical doc; journey flow, credit derivation, distinctness, idempotency, FK retarget rationale, links to applicant-lifecycle.md, session-lifecycle.md, verification-plan-purchase.md).
  - UPDATE `docs/teachers/applicant-lifecycle.md` §6 consumer table: this flow reads `in_evaluation`, own gates, writes nothing to the lifecycle table.
  - UPDATE `docs/sessions/session-lifecycle.md`: one subsection noting the evaluation rows' participation (`fee=null`, `fee_held=false`, no escrow handoff, same sweeps).
  - UPDATE `db/schema.dbml` — FK edge targets `users`.
  - **Never edit** AGENTS.md or `.agents/instructions/*`.
  - Write `outcome/13-knowledge-propagation-outcome.md`.
  - _Requirements: REQ-0, REQ-6.6, REQ-7.5_

---

## Traceability Matrix

| Requirements | Tasks |
|--------------|-------|
| REQ-0, REQ-0.5 | 0, 1.5, 3, 11 |
| REQ-1 (booking surface) | 5, 6, 7, 8 |
| REQ-2 (evaluator gate) | 2, 5, 7, 8 |
| REQ-3 (distinctness) | 2, 5, 7, 8 |
| REQ-4 (capacity) | 2, 5, 7, 8 |
| REQ-5 (cycle isolation) | 2, 5, 7, 8 |
| REQ-6 (lifecycle integration) | 2, 5, 7, 12, 13 |
| REQ-7 (schema delta) | 2, 12, 13 |
| REQ-8 (mutation + docs) | 3, 6, 9 |
| REQ-9 (dashboard UX) | 3 (i18n keys), 10 |
| REQ-10 (security/tenancy) | 5, 6, 7, 11 |
| REQ-11 (idempotency) | 5, 6, 7 |
| REQ-12 (journey) | 7, 8 |
| REQ-13 (access matrix) | 6, 8, 10 |
