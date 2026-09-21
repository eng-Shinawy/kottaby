# Tasks: DEV2-007 — Evaluation Rubric Scoring (≥80% Threshold)

> **Plan directory**: `ai/plans/milestone_1_core_domain_mvp/evaluation_rubric_scoring/`
> **Specs**: `specs.md` · **Design**: `plan.md` · **Ledger**: `deferred-items.md` · **Outcome dir**: `outcome/`

## Non-Negotiable Execution Protocol (every task)

1. Read ALL files in `outcome/` before starting (at `ai/plans/milestone_1_core_domain_mvp/evaluation_rubric_scoring/outcome/`).
2. After ANY file edit: `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` → exit 0.
3. Semantic self-review before `[x]`: tenancy/BOLA gate chain; guarded single-statement writes + tx discipline; enums as value imports; no cross-layer imports; no plan-artifact references (`REQ-x`, "Task X.Y", phase labels) in code comments/JSDoc; no `console.*`; no dead branches (env-config n/a for this plan — no new env keys).
4. Write `outcome/<task-id>-outcome.md` (command + exit code evidence); flip the checkbox here.
5. Deferred work lands immediately in `deferred-items.md` (source + target ticket pointer) BEFORE the task completes.
6. **Never** run raw `bun test` — repo/service tests via `bun run test/scripts/run-test.ts <path>`; suites via `bun run test:db` / `bun run test:services` / `bun run test:graphql`; journey via `bun run test/scripts/run-test.ts test/workflows/teachers/evaluation-rubric-scoring.journey.test.ts`.

## Layer → Rule Files (discovery: sub-loop prints the authoritative list; READ IT)

| Layer | AGENTS.md | Instructions |
|-------|-----------|--------------|
| Root | `/home/ahmed/Projects/kottaby_kottaby/AGENTS.md` | — |
| Schema | `backend/db/schema/AGENTS.md`, `backend/AGENTS.md` | `.agents/instructions/backend.instructions.md` |
| Enums | `backend/enum/AGENTS.md`, `backend/AGENTS.md` | same |
| Repos | `backend/db/repo/AGENTS.md`, `backend/AGENTS.md` | same |
| Repo tests | `backend/db/test/AGENTS.md`, `backend/AGENTS.md` | `backend.instructions.md` + `tests.instructions.md` |
| Services | `backend/services/AGENTS.md`, `backend/AGENTS.md` | `backend.instructions.md` |
| Types | `backend/types/AGENTS.md`, `backend/AGENTS.md` | same |
| GraphQL | `backend/graphql/AGENTS.md` (+ `mutation/`/`query/`/`pothos/` AGENTS.md if present), `backend/AGENTS.md` | same |
| Shared constants + locale | `shared/AGENTS.md`, `shared/locale/AGENTS.md` | — |
| Frontend sharedDocuments | `frontend/graphql/AGENTS.md`, `frontend/graphql/sharedDocuments/AGENTS.md`, `frontend/AGENTS.md` | `frontend.instructions.md` |
| Frontend views + stories | `frontend/views/AGENTS.md`, `frontend/AGENTS.md` | same |
| App Router | `app/AGENTS.md` — should NOT be touched by this plan (no new routes); if sub-loop surfaces it, stop and re-check scope | `frontend.instructions.md` |
| Journeys | `test/workflows/AGENTS.md` | `tests.instructions.md` |

## Drizzle Convention (binding)

- Schema delta (pgEnum `rubric_weakness_area` + nullable `weakness_area` column): `bun run db push` ONLY — no hand-written migrations, no `drizzle-kit generate`.
- No `--` comments inside `sql` template literals (parameter-binding hazard); explanations live in docblocks outside templates.
- After GraphQL changes: `bun run generate:gqlSchema` + `bun codegen`, committed artifacts.

---

## Task 0 — Pre-Implementation Baseline (pre-recorded at plan time)

- [ ] 0. Verify the existing baseline — counts were recorded at plan time; do NOT re-capture from scratch
  - Confirm `outcome/0-baseline-outcome.md` exists and `deferred-items.md` carries D1–D4 from specs §11.
  - Re-run and compare unchanged at execution start: `bun tsgo 2>&1 | grep "error TS" | wc -l` (expect 0), `bun biome:check 2>&1 | grep -c "warn"` (expect 0), `bun run scripts/lint-service.ts --json --id baseline` (expect clean) — counts must match the stored `/tmp/baseline-*` values; any NEW pre-existing error is documented before Task 2.
  - Write `outcome/0-baseline-verified-outcome.md` (verification note + counts).
- _Requirements: REQ-0_

## Phase 1.5 — Plan Review Gate (MANDATORY)

- [ ] 1.5 Review the complete plan (specs.md + plan.md + tasks.md) with the `@plan-review` skill; fix all violations until "Plan passes all AGENTS.md rules"; record verdict + findings in `outcome/plan-review-R1.md`
  - Dimensions: paths-exist vs plan §2 inventory, i18n key-sets (ar/en/types/parity on every new key), Pothos/GraphQL veneer conventions, error-code bijection (plan §5.3), journey mapping, no invented paths/symbols.
- _Requirements: REQ-0_

---

## Phase 2 — Backend Foundation

- [ ] 2. **Schema delta: weakness enum + column + constants + docblock/DBML parity**
  - `backend/db/schema/enums.ts`: add `rubricWeaknessArea = pgEnum("rubric_weakness_area", ["tajweed", "hifz"])` after `sessionIntent` (plan §3.1).
  - `backend/db/schema/teachers/evaluations.ts`: add nullable `weaknessArea: rubricWeaknessArea("weakness_area")` after `notes`; CORRECT the `:9-13` header docblock — rubric rows are session-linked (`session_id` NOT NULL for rubric submissions) and `evaluations_session_evaluator_unique` is the write-once arbiter for both flows.
  - `bun run db push`; inspect the DDL diff before applying (expect exactly: CREATE TYPE + ADD COLUMN, nothing else — plan §10).
  - CREATE `backend/enum/teachers/rubric-weakness-area.enum.ts` (`RubricWeaknessArea` + fail-closed `isRubricWeaknessArea`, the `applicant-status.enum.ts` pattern) + `backend/enum/teachers/rubric-weakness-area.enum.test.ts` (colocated guard tests); UPDATE `backend/enum/teachers/index.ts` barrel.
  - CREATE `shared/constants/evaluation-rubric.constants.ts` (`RUBRIC_PASS_THRESHOLD=80`, `TAJWEED_COOLDOWN_DAYS=30`, `HIFZ_COOLDOWN_DAYS=90`, `RUBRIC_NOTES_MAX_LENGTH=2000`); UPDATE `shared/constants/index.ts`.
  - UPDATE `db/schema.dbml:348-365` mirror (enum + column; Drizzle stays canonical).
  - QL sub-loop per edited file.
  - TE: Tier-1 enum test (value-for-value pgEnum parity, fail-closed guard probes) via `bun run test/scripts/run-test.ts backend/enum/teachers/rubric-weakness-area.enum.test.ts`.
  - SEC: schema additive-only — no FK/tenancy surface touched.
  - SR: nothing else in the schema changes — no new table, no pass/fail column, no index (plan §3.1); enums value-imports.
  - IV: sub-loop prints per-file rule files — read + validate each.
  - Write `outcome/2-schema-outcome.md` (includes DDL diff block).
  - _Requirements: REQ-0.5.2, REQ-4_

- [ ] 3. **Backend types + i18n keys (errors, applicant, sessions) + error-map rows**
  - `backend/types/teachers/evaluation.types.ts`: append `RubricEvaluationSubmitInput`, `RubricSubmissionInsertInput`, `RubricCycleSubmissionRow`, `RubricEvaluationReturnType` verbatim per plan §4.1 (canonical `EvaluationReturnType`/`EvaluationSubmitInput` untouched).
  - i18n — 7 new `errors` keys (`rubricScoreInvalid`, `rubricNotesRequired`, `rubricWeaknessRequired`, `rubricWeaknessNotAllowed`, `rubricWeaknessInvalid`, `rubricSessionNotCompleted`, `applicantAlreadyFinalized`) beside the rubric-adjacent block (`labels.ts:298-312`); 4 `applicant` notification keys (`evaluationPassedTitle/Body`, `evaluationFailedTitle`, `evaluationFailedBody` with `{cooldownUntil}` interpolation — parity test pins template order); ~10 `sessions` dialog keys per plan §6.2 — each key: type leaf + en + ar + parity-test extension in THIS task.
  - UPDATE `frontend/providers/apollo/error-link.map.ts`: one row per new code → `Errors` key.
  - QL sub-loop per edited file.
  - TE: extend `shared/locale/errors-namespace.parity.test.ts`, `applicant-namespace.parity.test.ts`, `sessions-namespace.parity.test.ts`; run each via `bun run test/scripts/run-test.ts <path>`.
  - SEC: n/a (compile-time copy) — confirm no free-text `notes` ever enters a log key.
  - SR: no hardcoded strings, no two-arg `getTranslations`, no `Translation` enum, no `next-intl`; enums value-imports.
  - IV: sub-loop prints per-file rule files — read + validate each.
  - Write `outcome/3-types-i18n-outcome.md`.
  - _Requirements: REQ-0.5, REQ-9.1, REQ-10_

- [ ] 4. **Repository extensions + repo tests**
  - `backend/db/repo/teachers/evaluation.repository.ts`: widen the `insertOnce` Pick with `notes`/`weaknessArea` (student-rating call site stays type-compatible — added members optional in `EvaluationInsertType`); ADD `findBySessionAndEvaluator(sessionId, evaluatorId, tx)` + `listCycleRubricSubmissions(applicantUserId, cycleStart, tx)` per plan §4.2 (typed Drizzle join, `isNotNull(evaluations.score)`, `SessionType.TeacherEvaluation` + `SessionStatus.Completed` as value-import enum expressions).
  - `backend/db/repo/teachers/applicant.repository.ts`: ADD `transitionToFailed(userId, cooldownUntil, tx)` — single guarded UPDATE (`status='in_evaluation'` folded into WHERE, `.returning()`), the `transitionToInEvaluation` pattern; returns null on 0 rows.
  - `backend/db/repo/classes/session.repository.evaluation.helpers.ts` + `session.repository.ts`: namespace delegate `listCompletedRubricPendingSessions` (LEFT JOIN anti-join on `evaluations`, pagination normalized page=1/pageSize=25/max 100).
  - NO repository holds business rules (AGENTS); `findForBookingGate`/`finalizeOnCertification`/`findForEvaluationGateById`/`insertColdStartCertified`/`elevateToCertified` are reused unchanged.
  - QL sub-loop per edited file.
  - TE — repo suites via `bun run test/scripts/run-test.ts <path>`, ALL under `runInRollback` + `tx` passed to every repo method, denials via `expectRepoError` try/catch (NEVER `rejects.toThrow`):
    • `backend/db/test/repo/teachers/evaluation.repository.test.ts` EXTEND: `insertOnce` with notes+weakness (NULL weakness too) + 23505 duplicate on the unique index; `findBySessionAndEvaluator` hit/miss; `listCycleRubricSubmissions` count correctness (DISTINCT sessions/evaluators, `score IS NOT NULL`, cycle-window bound).
    • `backend/db/test/repo/teachers/applicant.repository.transition.test.ts` EXTEND: `transitionToFailed` flips `in_evaluation → failed` + stamps `cooldown_until`; 0-row guard on `passed`/`failed`/`pending` pre-states returns null.
    • `session.repository.evaluation` test EXTEND: pending-sessions anti-join (own completed evaluation rows un-submitted only; pagination bounds).
    • Tier-2: cooldown instant stored verbatim; Tier-4: non-positive ids rejected pre-DB.
  - SEC: all inputs typed/bound parameters; no LIKE, no string interpolation into SQL.
  - SR: guarded single-statement writes only; no read-modify-write; enums value-imports; `tx` mandatory on the new methods (the finalization atomicity IS the contract).
  - IV: sub-loop prints per-file rule files — read + validate each.
  - Write `outcome/4-repos-outcome.md`.
  - _Requirements: REQ-3, REQ-8.1-8.2, REQ-14.2, REQ-15_

---

## Phase 2.5 — Mid-Point Review Gate (MANDATORY — >10 tasks, distinct backend+frontend phases)

- [ ] 5. **Mid-point review wave + fixes** (backend scope only: Tasks 2–4)
  - Review subagents in parallel: `review-backend` (schema + enums + repos + repo tests), `review-types` (backend/types + constants), `review-config` (db push diff, DBML mirror, i18n parity).
  - Aggregate backend-specific findings; fix per file using `.agents/instructions/backend.instructions.md` guardrails; re-run sub-loop per fixed file; re-review until zero findings.
  - Write `outcome/midpoint-review-R1.md`.
  - _Requirements: REQ-0_

---

## Phase 3 — Service & GraphQL

- [ ] 6. **Service: `EvaluationRubricService` + in-tx aggregation helpers + service tests**
  - CREATE `backend/services/teachers/evaluation-rubric.service.ts` + `backend/services/teachers/evaluation-rubric.helpers.ts` implementing plan §4.3 EXACTLY and in the fixed in-tx order: pre-DB validation (REQ-1 codes, zero reads) → actor governance → `withTransaction(outerTx, …)`: session gate (`SESSION_NOT_FOUND` for unknown/foreign/untyped) → completed gate → in-tx certification re-check (`TEACHER_NOT_CERTIFIED`) → applicant lock via `findForBookingGate` + `in_evaluation` gate (the evaluated applicant MUST be `session.studentId`, REQ-2.4) → cycle membership (prior-cycle folds into `SESSION_NOT_FOUND`) → duplicate pre-check → `insertOnce` (23505 in cause-chain → `EVALUATION_ALREADY_SUBMITTED`) → quorum read under the applicant lock (REQ-5.6: `FOR UPDATE` from the status read onward) → count<5 return alone; count=5 finalize in the SAME tx (REQ-5.2 — the 5th submission is the ONLY trigger): PASS = `insertColdStartCertified(studentId, false, tx)` / on 23505 elevate with the LOCKED row's own `isEvaluator` (demotion guard), then `finalizeOnCertification` (false → `APPLICANT_ALREADY_FINALIZED` + rollback, REQ-7.1); FAIL = `derivePrimaryFailureArea` (lowest score, ties → earliest `created_at`) → `transitionToFailed(now + 30/90d)` (null → `APPLICANT_ALREADY_FINALIZED` + rollback) — NO `users.suspended*` write, NO `students` row, NO role flip.
  - In-tx notification: compose in the APPLICANT'S persisted locale (`users.locale`, fallback `defaultLocale`) from `applicant` keys, `emitForUser(…, NotificationType.EvaluationResult, tx)`; return the receipt out of the tx; `publishReceipts` STRICTLY post-commit (never retried, never rolls back the verdict).
  - NO `ctx.idempotencyKey` machinery (the unique index is the replay arbiter). Export via `backend/services/teachers/index.ts` sibling pattern.
  - QL sub-loop per edited file.
  - TE `backend/services/teachers/evaluation-rubric.service.test.ts` via `bun run test:services` (real DB, `runInRollback` + `tx` propagation, `expectRepoError` try/catch, notifications spied):
    • Tier-1: every gate + both finalization branches + both read arms (`myRubricPendingSessions`, `myRubricEvaluation`).
    • Tier-2 BOUNDARY pair: five 80s → PASS; one 79 among 100s → FAIL (+ `{100,100,79,100,100}` mean-95.8 FAILS — pins the per-evaluation minimum); weakness-required-below-80 / weakness-forbidden-at-80+; tie-break `{65 tajweed, 65 hifz earlier}` → tajweed duration; cooldown `now+30d`/`now+90d` exactness.
    • Tier-3: `Promise.allSettled` concurrent #4/#5 (exactly one finalizes) + concurrent duplicate (one row + typed error); induced mid-tx abort leaves zero rows.
    • Tier-4: wrong-evaluator (`SESSION_NOT_FOUND`), non-certified teacher, non-`in_evaluation` applicant, invalid weakness strings (fail-closed guard), non-positive ids.
  - SEC (X.SEC): BOLA — evaluated subject always `session.studentId`, never client-supplied; unknown/foreign/untyped/prior-cycle indistinguishable. BOPLA — sealed insert payload, never `...input` spread. BFLA — role scope asserted in Task 7; service re-checks certification in-tx.
  - SR: guarded single-statement writes; every read/write on `tx`; `logger.logDomainError` (code + ids only, `notes` NEVER logged); enums value-imports; no plan-artifact references in comments.
  - IV: sub-loop prints per-file rule files — read + validate each.
  - Write `outcome/6-service-outcome.md`.
  - _Requirements: REQ-2 (incl. 2.4), REQ-3, REQ-5 (incl. 5.2, 5.6), REQ-6, REQ-7 (incl. 7.1), REQ-8, REQ-9, REQ-15 (incl. REQ-15.4: whole-transaction rollback — no committed state between the 5th submission and the verdict)_

- [ ] 7. **GraphQL surfaces (Pothos types + mutation + queries + codegen + transport tests)**
  - CREATE `backend/graphql/pothos/teachers/evaluation-rubric.pothos.ts` — `RubricEvaluationSubmitPothosInput` + `RubricEvaluationPothosObject` backed ONLY by `@/backend/types` (no local types; `id` first).
  - UPDATE `backend/graphql/pothos/shared/enum.pothos.ts`: register `RubricWeaknessAreaPothosEnum` via `gqlSchemaBuilder.enumType(RubricWeaknessArea, …)` (the `SessionTypePothosEnum` pattern).
  - CREATE `backend/graphql/mutation/evaluation-rubric.mutation.ts` — flat root, no named exports, `gqlSchemaBuilder.mutationField("submitRubricEvaluation")`, scope `$all: { authenticated: true, role: [UserRole.Teacher] }`; resolver i18n `await ctx.t("errorsTranslations")`, delegates `ctx.user.id` + `ctx.locale` ONLY; no `ctx.idempotencyKey`.
  - CREATE `backend/graphql/query/teachers/evaluation-rubric.query.ts` — `myRubricPendingSessions(page, pageSize): SessionPage!` (reuses canonical `SessionPage`) + `myRubricEvaluation(sessionId)` with the same `$all` Teacher scope.
  - UPDATE `backend/graphql/mutation/index.ts` + `backend/graphql/query/teachers/index.ts` (side-effect imports). Run `bun run generate:gqlSchema` + `bun codegen`; commit artifacts. NO new applicant read surface; NO admin/cross-applicant fields.
  - QL sub-loop per edited file.
  - TE `frontend/graphql/test/teachers/evaluation-rubric.test.ts` via `bun run test:graphql` + `testClient` (the `evaluation-booking.test.ts` convention): anonymous → UNAUTHORIZED; student/parent → FORBIDDEN at the role scope (never reaches the service); happy submissions; every typed code surfaces via `errors[].extensions.code` with localized messages; pending read + own-submission read happy/denial.
  - SEC: BFLA scope conjunction pinned behaviorally; BOLA — no field accepts an evaluated/applicant id; notes never in any selection set.
  - SR: mutation/query files flat + side-effect-registered; SDL matches plan §5.1 verbatim; enums value-imports.
  - IV: sub-loop prints per-file rule files — read + validate each.
  - Write `outcome/7-graphql-outcome.md`.
  - _Requirements: REQ-2.5, REQ-10, REQ-11, REQ-14.3_

---

## Phase 4 — Journey (TEST-FIRST discipline for the cross-actor loop)

- [ ] 8. **Journey test FIRST** — `test/workflows/teachers/evaluation-rubric-scoring.journey.test.ts` (RED: expected failing list documented at authoring time)
  - Provision via `createJourneyFixtures(prefix)` (+ an evaluator-variant helper): applicant, FIVE distinct certified evaluators, one non-evaluator certified teacher, a verification plan row — per-run prefix, committed fixtures in `beforeAll`, tracked `afterAll` cleanup, residue probes; NO `runInRollback` anywhere in this layer; notifications SPIED at the dispatch boundary (assert target userId, never published).
  - Encode specs §6 + plan §5.5: PASS trajectory (5 submissions all ≥ 80 → teacher row `is_approved=true, is_evaluator=false`, `status='passed'`, `cooldown_until` NULL, exactly one `evaluation_result` notification); FAIL trajectory (tajweed-79 → `failed` + `now+30d` strict-boundary re-purchase denial, hifz variant → `now+90d`, NO teacher/students/`users.suspended*` rows); denial legs (non-assigned certified teacher → `SESSION_NOT_FOUND`, student call → FORBIDDEN scope, duplicate → `EVALUATION_ALREADY_SUBMITTED`, non-completed session → `RUBRIC_SESSION_NOT_COMPLETED`, <80 without weakness → `RUBRIC_WEAKNESS_REQUIRED`, ≥80 with weakness → `RUBRIC_WEAKNESS_NOT_ALLOWED`); cross-actor visibility (pending read loses the row post-submission; `applicantStatus` on the 5th return).
  - QL sub-loop on the new test file; run via `bun run test/scripts/run-test.ts test/workflows/teachers/evaluation-rubric-scoring.journey.test.ts`; document the CURRENT failing expectation list in the outcome.
  - Write `outcome/8-journey-first-outcome.md`.
  - _Requirements: REQ-13, REQ-14.4, REQ-15_

- [ ] 9. **Drive journey green + cross-suite sweeps**
  - Rerun the journey — expect full green; fix any service/GraphQL layer gap the RED list exposed (with sub-loop per file).
  - Sweeps: `bun run test:db`, `bun run test:services`, `bun run test:graphql`, and the journey again — twice back-to-back for idempotency proof.
  - Write `outcome/9-journey-green-outcome.md`.
  - _Requirements: REQ-13, REQ-14, REQ-15_

---

## Phase 5 — Frontend

- [ ] 10. **Frontend GraphQL documents + barrel**
  - CREATE `frontend/graphql/sharedDocuments/teachers/evaluation-rubric.documents.ts`: `submitRubricEvaluationMutationDocument`, `myRubricPendingSessionsQueryDocument`, `myRubricEvaluationQueryDocument` — `TypedDocumentNode`, `id` FIRST on every object selection (Apollo normalization), `{entity}QueryDocument`/`{verb}MutationDocument` naming; add the teachers documents-barrel import row.
  - QL sub-loop per edited file.
  - TE: extend the documents contract suite MO for typed documents (no server calls).
  - SEC: n/a — read shapes carry no notes/applicant-foreign fields.
  - SR: no `useLazyQuery` anywhere; documents consume codegen types only.
  - IV: sub-loop prints per-file rule files — read + validate each.
  - Write `outcome/10-frontend-docs-outcome.md`.
  - _Requirements: REQ-11.5, REQ-0.5_

- [ ] 11. **Evaluator UI: row action + dialog + hook + wiring + storybook (ZERO routes/nav)**
  - UPDATE `frontend/views/teacher/sessions/teacherSessionCacheArms.ts`: `teacherActionsForSession` gains a `submitEvaluation` affordance on completed `teacher_evaluation` rows (after the existing `report` descriptor, `:132-165`) + `TeacherActionsWiring` extension; EXTEND `teacherSessionCacheArms.test.ts` affordance-matrix rows.
  - CREATE `frontend/views/teacher/sessions/RubricEvaluationDialog.tsx` — MUI v9 `Dialog fullWidth maxWidth="xs"`, `sx`-only, theme-palette callbacks, `*Outlined` icons: score `TextField type="number"` 0-100, multiline notes, Tajweed/Hifz `Select` rendered ONLY while entered score < 80 (client mirrors the iff rule; server stays the authority); `aria-invalid` on errors.
  - CREATE `frontend/views/teacher/sessions/useRubricEvaluation.ts` — mutation arm + stateful `useQuery` pending-read arm (from `@apollo/client/react`), typed `extensions.code` → localized toast mapping, post-success pending-read refetch, localized success snackbar.
  - UPDATE `frontend/views/teacher/sessions/TeacherSessionsContainer.tsx` + `useTeacherLifecycleMutations.ts`: mount the dialog keyed by session id (report-dialog pattern), route the new action intent.
  - UNTOUCHED: `navItems.ts`, `app/(dashboard)/teacher/sessions/page.tsx`, applicant dashboard views (existing branches light up on the status flip).
  - QL sub-loop per edited file.
  - TE: **no UI component/E2E test layer exists (Playwright is Paymob-only)** — coverage comes from the Task 7 GraphQL suite; CREATE `frontend/stories/teachers/RubricEvaluationDialog.stories.tsx` covering pristine / passing-draft (select hidden) / failing-draft (select visible + required) / typed-denial states (the `EvaluationBookingDialog.stories.tsx` convention).
  - SEC: dialog submits only `sessionId` + score/notes/weakness; no applicant/evaluator ids client-side (BOPLA).
  - SR: copy ONLY from `sessions`/`errors` namespace handles via property access — never hardcoded strings, never function-form `t`; MUI v9 style props forbidden (sx only).
  - IV: sub-loop prints per-file rule files — read + validate each.
  - Write `outcome/11-frontend-outcome.md`.
  - _Requirements: REQ-10, REQ-12, REQ-14.5_

---

## Phase 6 — Final Gate & Knowledge Propagation

- [ ] 12. **Post-implementation review wave (if warranted) + deferred-items enforcement**
  - Scope: this plan's diff only. Twin reviewers `review-backend` + `review-frontend` (+ security-probing reading list) over schema→service→GraphQL→journey→UI; fix per file, re-review until zero feature findings.
  - Deferred enforcement (BLOCKING): `grep -c "❌\|⚠️" ai/plans/milestone_1_core_domain_mvp/evaluation_rubric_scoring/deferred-items.md` → **0** unresolved; D1–D4 stay as documented cross-ticket items with receiving-ticket pointers.
  - Write `outcome/12-review-wave-outcome.md`.
  - _Requirements: REQ-0_

- [ ] 13. **Global quality gate + baseline comparison**
  - `bun quality-gate` green (tsgo → oxlint → biome → lint → duplicates).
  - Baseline-vs-current comparison in the outcome file (`bun tsgo`, `bun biome:check`, lint) — deltas must be ≤ baseline + 0.
  - Full suite re-run: `bun run test:db`, `bun run test:services`, `bun run test:graphql`, and `bun run test/scripts/run-test.ts test/workflows/teachers/evaluation-rubric-scoring.journey.test.ts` — twice back-to-back.
  - Write `outcome/13-final-gate-outcome.md` (include the plan's Self-Verification Line: `____ out of 15 REQs implemented and verified · BUN cmd(s) that passed: ____ · requirements deferred (IDs): ____`).
  - _Requirements: REQ-0, REQ-14_

- [ ] 14. **Knowledge propagation & documentation**
  - CREATE `docs/teachers/evaluation-rubric-scoring.md` (canonical doc: 5th-submission trigger, per-evaluation ≥80 semantics + 80/79 boundary, failure-area derivation + 30/90-day cooldown, error-code table, teacher insert-or-elevate PASS path with the isEvaluator demotion guard, the two evaluation-table write paths).
  - UPDATE `docs/teachers/applicant-lifecycle.md` §6 consumer-guidance row: this flow becomes the `in_evaluation → passed | failed` writer (pointer to `transitionToFailed` + the strict-boundary read at `applicant-lifecycle.service.ts`).
  - UPDATE `docs/graphql/domain-error-extensions-code.md`: add the 7 DEV2-007 codes to the registry.
  - **Never edit** AGENTS.md or `.agents/instructions/*`.
  - Write `outcome/14-knowledge-propagation-outcome.md`.
  - _Requirements: REQ-0, REQ-8, REQ-10_

---

## Traceability Matrix

| Requirement | Tasks |
|-------------|-------|
| REQ-0 (baseline & protocol) | 0, 1.5, 5, 12, 13 |
| REQ-0.5 (i18n & enum imports) | 2, 3, 10, 11 |
| REQ-1 (input contract & validation) | 6 |
| REQ-2 (identity & ownership gates) | 6, 7, 8, 9 |
| REQ-3 (session linkage & write-once) | 4, 6, 8, 9 |
| REQ-4 (schema delta) | 2 |
| REQ-5 (aggregation engine) | 6, 8, 9 |
| REQ-6 (failure area & cooldown) | 6, 8, 9 |
| REQ-7 (PASS finalization) | 6, 8, 9 |
| REQ-8 (FAIL finalization) | 4, 6, 8, 9, 14 |
| REQ-9 (applicant notifications) | 3 (keys), 6, 8, 9 |
| REQ-10 (error-code contract) | 3, 6, 7, 11, 14 |
| REQ-11 (GraphQL contract) | 7, 10 |
| REQ-12 (evaluator UI, no routes/nav) | 11 |
| REQ-13 (journey) | 8, 9 |
| REQ-14 (test tiers) | 2, 4, 6, 7, 8, 9, 11, 13 |
| REQ-15 (idempotency & concurrency) | 4, 6, 8, 9 |
