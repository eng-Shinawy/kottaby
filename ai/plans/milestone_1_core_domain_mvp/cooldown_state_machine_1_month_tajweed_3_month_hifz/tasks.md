# Tasks — Cooldown State Machine (1-Month Tajweed / 3-Month Hifz)

> **Plan directory (verbatim):** `ai/plans/milestone_1_core_domain_mvp/cooldown_state_machine_1_month_tajweed_3_month_hifz/`
> **Specs:** `specs.md` (REQ-001..REQ-011) · **Design:** `plan.md` · **Ledger:** `deferred-items.md` · **Outcomes:** `outcome/`
> **Ticket:** `docs/planning/TICKETS.md:818-868` — Dev 2 · M1 · 5 SP · Blocked By Evaluation Rubric Scoring (SHIPPED)

## Document Information

| Field | Value |
|---|---|
| Version / Date | 2.0 · 2026-09-27 |
| Sequencing | Foundation-first with interleaved tests; journey authored test-first (Task 5 red) before the service + mutation (Task 4/6 green) |
| Phase 2.5 mid-point gate | RESTORED — backend review wave over Tasks 1–5 before the GraphQL phase (see Phase 2.5) |
| Drizzle | ZERO schema delta → NO `db push`/`db migrate`; GraphQL additions require `bun run generate:gqlSchema` + `bun codegen` (Task 7) |
| New files | `backend/enum/teachers/applicant-cooldown-state.enum.ts` (+ `.enum.test.ts`) · `test/workflows/teachers/cooldown-state-machine.test.ts` (journey) |
| Extended files | `backend/types/teachers/applicant.types.ts` · `backend/db/repo/teachers/applicant.repository.ts` · `backend/services/teachers/applicant-lifecycle.service.ts` · `backend/services/teachers/applicant-lifecycle.service.test.ts` · `backend/db/test/repo/teachers/applicant.repository.test.ts` · `backend/graphql/pothos/shared/enum.pothos.ts` · `backend/graphql/pothos/teachers/applicant.pothos.ts` · `backend/graphql/mutation/admin/admin-governance.mutation.ts` · `shared/locale/types/errors/labels.ts` · `shared/locale/en/errors/index.ts` · `shared/locale/ar/errors/index.ts` |

## Non-Negotiable Execution Protocol (all tasks)

1. Read ALL files in `outcome/` before starting a task.
2. After ANY file edit: `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` → exit 0 (sub-loop auto-prints applicable AGENTS.md + `.agents/instructions/*` — read them).
3. Complete the semantic-review checklist before `[x]` (tenancy, races, enums-as-values, no cross-layer imports, no dead code, two-source-split grep proof).
4. Write `outcome/<task-id>-outcome.md`; flip the checkbox.
5. Never `console.*` — `logger` from `@/backend/lib/logger`; domain rejections via `logger.logDomainError`.
6. No `Translation.` enum, no two-arg `getTranslations` calls, no frontend logging imports (this plan ships zero frontend code); workflow tests run via `bun run test/scripts/run-test.ts`, never raw `bun test`.

### Layer → rule-file map (absolute; sub-loop re-prints them)

| Layer touched here | AGENTS.md | `.agents/instructions/` |
|---|---|---|
| Types `backend/types/teachers/` | `…/backend/types/AGENTS.md`, `…/backend/AGENTS.md`, root | `backend.instructions.md` |
| Repos `backend/db/repo/teachers/` | `…/backend/db/repo/AGENTS.md`, `…/backend/AGENTS.md`, root | `backend.instructions.md` |
| DB tests `backend/db/test/repo/teachers/`, `backend/db/test/logic/teachers/` | `…/backend/db/test/AGENTS.md`, `…/backend/AGENTS.md`, root | `backend.instructions.md`, `tests.instructions.md` |
| Services `backend/services/teachers/` | `…/backend/services/AGENTS.md`, `…/backend/AGENTS.md`, root | `backend.instructions.md` |
| GraphQL `backend/graphql/` | `…/backend/graphql/AGENTS.md`, `…/backend/AGENTS.md`, root | `backend.instructions.md` |
| Shared locale `shared/locale/` | `…/shared/locale/AGENTS.md`, `…/shared/AGENTS.md`, root | — |
| Journeys `test/workflows/teachers/` | `…/test/workflows/AGENTS.md`, root | `tests.instructions.md` |

## Phase 0 — Baseline

- [ ] 0. Baseline + ledger check
  - Record: `bun tsgo 2>&1 | grep -c "error TS" > /tmp/baseline-tsgo.txt`; `bun biome:check 2>&1 | grep -c "warn" > /tmp/baseline-biome.txt`; `bun run scripts/lint-service.ts --json --id baseline > /tmp/baseline-lint.json`
  - Read `deferred-items.md` (D1..D5 ledger understanding; D1/D2 are intentional child-ticket deferrals, NOT blockers)
  - Read `docs/teachers/applicant-lifecycle.md` §2.3/§2.4/§7.3 (the two-source split + duration-agnostic guard + reconciliation — the binding authority for REQ-006)
  - Write `outcome/0-baseline-outcome.md`
  - _Requirements: REQ-001_

## Phase 1 — Types, Repository, i18n

- [ ] 1. `ApplicantCooldownState` enum (backend/enum) + types extension
  - CREATE `backend/enum/teachers/applicant-cooldown-state.enum.ts`: real TS enum `ApplicantCooldownState { None = "none", Active = "active", Expired = "expired" }` + `isApplicantCooldownState` fail-closed guard + pre-allocated members set — mirror `backend/enum/teachers/applicant-status.enum.ts:12` byte-for-byte in discipline (per the `backend/graphql/AGENTS.md` enum rule: GraphQL enums are backed by real TS enums in `backend/enum/`; string-literal unions and hardcoded value arrays in Pothos files are PROHIBITED)
  - CREATE `backend/enum/teachers/applicant-cooldown-state.enum.test.ts` mirroring `applicant-status.enum.test.ts` (guard admits the three member values; fails closed on wrong type/case/foreign values)
  - Extend `backend/types/teachers/applicant.types.ts`: add `cooldownState: ApplicantCooldownState` to `ApplicantProfileReturnType` (verify the existing interface's exact field order before editing — read the file first; do NOT spread-invent fields)
  - Add `ApplicantCooldownExtensionAudit` interface per plan §3.3
  - Verify barrels re-export the new symbols (`backend/enum/teachers/index.ts`, `backend/types/teachers/index.ts`; named export only on TS2308 collision; none expected)
  - [ ] 1.QL `bun run scripts/health/sub-loop.ts backend/enum/teachers/applicant-cooldown-state.enum.ts backend/enum/teachers/applicant-cooldown-state.enum.test.ts backend/types/teachers/applicant.types.ts --lifecycle duplicates` → 0
  - [ ] 1.TE enum guard unit test (the three member values admitted; fail-closed otherwise); type-level usage probe inside the service test (Task 4 covers runtime)
  - [ ] 1.SEC no `Date` leaks to wire (the `DateTime` scalar serializes; `cooldownState` is an enum member, not a Date)
  - [ ] 1.SR semantic: `readonly` fields; `ApplicantCooldownState` is a REAL TS enum in `backend/enum/teachers/` (NOT a string-literal union, NOT a pgEnum — D1); guard mirrors the `isApplicantStatus` discipline
  - [ ] 1.IV read printed rule files (types layer)
  - _Requirements: REQ-008, REQ-002_

- [ ] 2. Repository — `ApplicantRepository.extendCooldownOnce` (+ repo tests)
  - `backend/db/repo/teachers/applicant.repository.ts`: APPEND `extendCooldownOnce(userId, newExpiry, tx)` per plan §5.2 — guarded single-statement UPDATE, predicate `status IN (Pending, InEvaluation, Failed)`, writes ONLY `cooldownUntil` + `updatedAt`; returns `ApplicantSelectType | null`
  - CRITICAL (two-source split, REQ-006.2): the `users` table MUST NOT be imported in this method; grep-verify `rg "users.suspended|users\.suspended|suspendedPeriodDays" backend/db/repo/teachers/applicant.repository.ts` returns ZERO matches in the new method's diff
  - `ApplicantStatus` imported as a VALUE (REQ-002.3); `sql`, `and`, `eq`, `inArray` from `drizzle-orm`; NO inline `--` comments in any `sql\`\`` template (plan §9.1)
  - Extend `backend/db/test/repo/teachers/applicant.repository.test.ts`: add `extendCooldownOnce` cases — happy path (failed → lengthened), zero-row on `passed` (returns null), zero-row on missing applicant, `pending`/`in_evaluation` admitted, hostile ids (0, negative). All `runInRollback` + `tx` propagation + `expectRepoError` try/catch (never `.rejects`)
  - [ ] 2.QL sub-loop `--lifecycle duplicates` → 0 on both files
  - [ ] 2.TE T1 100% branches; T2: `passed` zero-row, missing-applicant zero-row, `pending`/`in_evaluation` admitted, expired-cooldown base path; T4 hostile ids
  - [ ] 2.SEC raw SQL parameterized only (`eq`/`inArray` bind values; the three `ApplicantStatus` members are enum values, never concatenated strings)
  - [ ] 2.SR tx-last signature; bare-reads fallback N/A (this is a write); no `users` import added
  - [ ] 2.IV rule files per table above
  - _Requirements: REQ-007, REQ-006, REQ-003_

- [ ] 3. i18n errors leaf `applicantCooldownExtensionInvalid`
  - `shared/locale/types/errors/labels.ts`: add `applicantCooldownExtensionInvalid: string` to the EXISTING `applicant` errors group (locate the group first — do NOT create a new group; the blocker ticket shipped `applicantNotFound`/`applicantCooldownActive`/`applicantAlreadyCertified`/`applicantStatusCorrupt`)
  - `shared/locale/en/errors/index.ts` + `shared/locale/ar/errors/index.ts`: add the localized copy (en: "Cooldown extension days must be between 1 and 3650."; ar: formal MSA, no ids in copy)
  - Run the existing errors-parity test to green (the ar/en key sets MUST match byte-for-byte)
  - [ ] 3.QL sub-loop `--lifecycle duplicates` on all 3 files → 0
  - [ ] 3.TE parity test green; copy contains no interpolations (static leaf — the bounds are not interpolated into the string)
  - [ ] 3.SEC no identifiers inside copy
  - [ ] 3.SR no `Translation.` enum, no two-arg `getTranslations` anywhere in diff
  - [ ] 3.IV shared/locale AGENTS.md rules
  - _Requirements: REQ-002, REQ-007_

## Phase 2 — Service, Journey (test-first), Mutation wiring

- [ ] 4. `ApplicantLifecycleService` — `extendApplicantCooldown` + `deriveCooldownState` (+ service tests)
  - `backend/services/teachers/applicant-lifecycle.service.ts`:
    - APPEND module-private `deriveCooldownState(cooldownUntil, now)` per plan §5.4 (pure compute, strict `>`)
    - APPEND module-private `MS_PER_DAY` + `EPOCH_PAST = new Date(0)` constants (sibling of `COOLDOWN_FORMATTERS` at `:84`)
    - EXTEND `getMyApplicantProfile` (`:142-181`) to compute `cooldownState` from the SAME captured `now` (`:164`) and add it to the return object (do NOT touch the existing `cooldownActive`/`canPurchaseVerification` derivations — additive only)
    - APPEND `extendApplicantCooldown(applicantId, additionalDays, actorId, locale)` to the namespace per plan §5.3: bounds validation → `ValidationError("APPLICANT_COOLDOWN_EXTENSION_INVALID")`; `withTransaction` → `findByUserId` (status guard + old expiry) → `APPLICANT_ALREADY_CERTIFIED` on `passed` → `extendCooldownOnce` → `AuditService.createAuditLog` (compose `AuditActionType.Adjust`, `entityType: "applicant"`, details JSON) → post-commit `logger.logDomainError("APPLICANT_COOLDOWN_EXTENDED", …)` → return `getMyApplicantProfile(applicantId, locale)`
    - CRITICAL (two-source split, REQ-006.2): the `users` table MUST NOT be imported in this file's NEW code; grep-verify `rg "users.suspended|suspendedAt|suspendedPeriodDays" backend/services/teachers/applicant-lifecycle.service.ts` returns ZERO matches OUTSIDE the pre-existing `:18-20` docblock (the documented-absence comment legitimately mentions `users.suspended` — a comment is not a write; the NEW code must add no further mention)
    - `ApplicantStatus`, `AuditActionType` imported as VALUES; `getServerTranslations(locale)` single-arg + property access (`.errorsTranslations.applicantCooldownExtensionInvalid`)
    - `actorId` parameter comes from the resolver's `ctx.user.id` — the service signature takes it as the 3rd positional arg, NEVER from a mutation input field
  - `backend/services/teachers/applicant-lifecycle.service.test.ts`: add cases —
    - `deriveCooldownState`: none (null cooldown), active (future), expired (past), exact-now boundary (strict `>` → expired)
    - `getMyApplicantProfile` cooldownState: all three states observed; mutual consistency with `cooldownActive`/`canPurchaseVerification` (REQ-008.3)
    - `extendApplicantCooldown`: happy (failed, active → lengthened, audit row present), expired-base (starts from now), null-cooldown-base (starts from now), `passed` → `APPLICANT_ALREADY_CERTIFIED`, missing applicant → `APPLICANT_NOT_FOUND`, `additionalDays=0`/`3651`/negative → `APPLICANT_COOLDOWN_EXTENSION_INVALID`, two-source-split assertion (`users.suspended === false` after extension — read the `users` row via a separate test query, NOT via the service)
  - All service tests `runInRollback` + `tx` propagation + `expectRepoError` try/catch (never `.rejects`); lessons-service precedent `backend/db/test/logic/teachers/applicant-lifecycle.test.ts`
  - [ ] 4.QL sub-loop `--lifecycle duplicates` → 0 on both files
  - [ ] 4.TE T1 100% on `extendApplicantCooldown` branches + `deriveCooldownState` arms; T2 boundaries above; T3 concurrent admin-extend vs rubric-finalize (`Promise.allSettled` — one wins, the other surfaces `APPLICANT_ALREADY_FINALIZED` or lengthens); T4 role/actor probes (actorId from ctx only)
  - [ ] 4.SEC `actorId` from `ctx.user.id` only (service signature enforces); bounds validation before any DB read; no client input reaches the cooldown write (the write takes `newExpiry: Date`, a server-computed value — never the raw `additionalDays` int spread)
  - [ ] 4.SR no `evaluation-rubric.*` import (cycle risk); `AuditActionType`/`ApplicantStatus` value imports; `getServerTranslations(locale)` single-arg; the `users` table is NOT imported; `withTransaction` used for the write+audit atomicity
  - [ ] 4.IV services-layer rule files
  - _Requirements: REQ-003, REQ-005, REQ-006, REQ-007, REQ-008, REQ-009, REQ-010_

- [ ] 5. Journey test (test-first — RED before Task 4/6 GREEN)
  - `test/workflows/teachers/cooldown-state-machine.test.ts` — NEW file, authored BEFORE the mutation (Task 6) so the test drives the contract
  - 12 ordered steps per plan §7 + specs REQ-011:
    1. Fixtures: certified evaluators, applicant `status='in_evaluation'`, 5 rubric submissions (lowest-scoring failing area = `tajweed`)
    2. System → `submitRubricEvaluation` (5th) → assert `applicants.cooldown_until ≈ now+30d`, `status='failed'`, `users.suspended === false` (two-source-split lock — REQ-006.5)
    3. Applicant → `myApplicantProfile` → `cooldownState === "Active"`, `cooldownActive === true`, `canPurchaseVerification === false`
    4. Applicant → `purchaseVerificationPlan` → DENIED `APPLICANT_COOLDOWN_ACTIVE` (assert extensions.code === "APPLICANT_COOLDOWN_ACTIVE", HTTP 422 via the error finalizer)
    5. Admin → `adminExtendApplicantCooldown(applicantId, additionalDays: 60)` → assert `cooldown_until ≈ now+90d` (30 base + 60), audit row present (`actionType=adjust`, `entityType="applicant"`)
    6. Applicant → `myApplicantProfile` → `cooldownUntil` reflects extended instant, `cooldownState === "Active"`
    7. Fixture: set `applicants.cooldown_until` to a past instant (clock-advance helper) → Applicant → `myApplicantProfile` → `cooldownState === "Expired"` (REQ-008.1)
    8. Applicant → `purchaseVerificationPlan` → SUCCEEDS → `recordReapplication` incremented attempts, `status: failed → in_evaluation`
    9. Non-admin → `adminExtendApplicantCooldown` → DENIED 403 (authScopes — assert `FORBIDDEN`)
    10. Admin → extend on a `passed` applicant → DENIED `APPLICANT_ALREADY_CERTIFIED`
    11. Admin → extend with `additionalDays: 0` → DENIED `APPLICANT_COOLDOWN_EXTENSION_INVALID`
    12. Replay the Hifz arc (fixture: lowest-scoring failing area = `hifz`) → `cooldown_until ≈ now+90d` (REQ-003.2)
  - Run via `bun run test/scripts/run-test.ts test/workflows` (NEVER raw `bun test` on workflows — execution protocol §6)
  - [ ] 5.QL sub-loop `--lifecycle duplicates` on the journey file → 0
  - [ ] 5.TE all 12 steps asserted; both denial probes (403, INVALID, ALREADY_CERTIFIED) + the two-source-split lock (`users.suspended === false` at step 2); the hifz arc (step 12)
  - [ ] 5.SEC no PII in assertions; actor identities from fixture-created users only
  - [ ] 5.SR workflow-test discipline (`runInRollback` or the journey harness's isolation; verify the exact harness in `test/workflows/AGENTS.md` before authoring); no `console.*`; the clock-advance uses a fixture helper (no production time-mock)
  - [ ] 5.IV journeys-layer rule files
  - _Requirements: REQ-011, REQ-006, REQ-003, REQ-004, REQ-007, REQ-008_

### Phase 2.5 — Mid-Point Backend Review Gate

- [ ] 2.5 **Backend review wave + fixes**
  - Dispatch review subagents scoped to the backend files of Tasks 1–5 (types, repo, locale, service, journey): `review-backend` + `review-types`; include the concurrency/TOCTOU spot-check over the `plan.md` §6 race table (extend-vs-extend last-write-wins, extend-vs-repurchase snapshot semantics, extend-vs-status-transition guarded WHERE, purchase-gate TOCTOU).
  - Fix findings per file; each fixed file re-runs `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` → exit 0. Re-review until zero backend findings; write `outcome/midpoint-review-R1.md`.
  - _Requirements: REQ-001_

## Phase 3 — GraphQL (Pothos), SDL/codegen

- [ ] 6. GraphQL — `ApplicantCooldownState` enum + `cooldownState` field + `adminExtendApplicantCooldown` mutation
  - `backend/graphql/pothos/shared/enum.pothos.ts`: APPEND the `ApplicantCooldownStatePothosEnum` registration passing the enum OBJECT (Pothos `enumType`, NOT a pgEnum — D1/REQ-002.4): `gqlSchemaBuilder.enumType(ApplicantCooldownState, { name: "ApplicantCooldownState" })` — mirror the existing `ApplicantStatusPothosEnum` registration (`enum.pothos.ts:116-119`) exactly. Wire names follow the TS member names (`None/Active/Expired`, same as `ApplicantStatus` exposes `Failed/InEvaluation/Passed/Pending` — `frontend/graphql/generated/schema.graphql:642`).
  - `backend/graphql/pothos/teachers/applicant.pothos.ts`: EXTEND `ApplicantProfilePothosObject` (`:33-55`) with `cooldownState: t.field({ type: ApplicantCooldownStatePothosEnum, resolve: parent => parent.cooldownState })` — additive, do NOT touch the existing 7 fields
  - `backend/graphql/mutation/admin/admin-governance.mutation.ts`: APPEND `adminExtendApplicantCooldown` mutationField per plan §4.4 — `authScopes: adminOnlyAuthScopes`, args `applicantId: Int!` + `additionalDays: Int!`, resolve → `requireAdminUser(ctx)` then `ApplicantLifecycleService.extendApplicantCooldown(args.applicantId, args.additionalDays, ctx.user.id, ctx.locale)`. Mirror the `adminSetUserSuspended` shape at `:45-72`.
  - CRITICAL: the resolver passes `ctx.user.id` as `actorId` (3rd arg) — NEVER `args.actorId` (there is no such arg). The resolver carries NO try/catch (domain errors propagate uncaught — `docs/teachers/applicant-lifecycle.md:97`).
  - Verify the mutation barrel chain imports the file (side-effect registration: `mutation/index.ts` → `mutation/admin/index.ts:12` (`import "./admin-governance.mutation"`) → the mutation file itself); the barrel should already import the file (it's an existing mutation file, just appended)
  - [ ] 6.QL sub-loop `--lifecycle duplicates` → 0 on all 3 files
  - [ ] 6.TE wire/role tests: `adminExtendApplicantCooldown` success (admin → 200), non-admin → 403 (`FORBIDDEN`), anonymous → 401 (`UNAUTHORIZED`); the `cooldownState` field appears on `myApplicantProfile` SDL. Add to `backend/graphql/test/` (locate the existing applicant wire-test file; mirror its shape). GraphQL wire tests run via the repo's standard test runner (NOT the workflow harness).
  - [ ] 6.SEC `authScopes: adminOnlyAuthScopes` on the mutation; `requireAdminUser(ctx)` narrows before the service call; `actorId` from `ctx.user.id` only
  - [ ] 6.SR `UserRole`/`AuditActionType` value imports; no `Translation.` enum; the enum registration mirrors `ApplicantStatusPothosEnum` byte-for-byte in shape
  - [ ] 6.IV graphql-layer rule files
  - _Requirements: REQ-007, REQ-008, REQ-011_

- [ ] 7. SDL/codegen refresh
  - `bun run generate:gqlSchema` → writes `frontend/graphql/generated/schema.graphql` (the new `ApplicantCooldownState` enum, the `cooldownState` field, the `adminExtendApplicantCooldown` mutation appear)
  - `bun codegen` → generates the frontend typed-document-node types (no frontend code consumes them in THIS ticket — they're typed for the NEXT ticket)
  - Verify the generated SDL contains: `enum ApplicantCooldownState { None Active Expired }` (wire names follow TS member names, the ApplicantStatus precedent), `cooldownState: ApplicantCooldownState!` on `ApplicantProfile`, `adminExtendApplicantCooldown(applicantId: Int!, additionalDays: Int!): ApplicantProfile!`
  - Commit the regenerated `schema.graphql` + codegen artifacts (they are checked in — verify `.gitignore` does not exclude them; the milestone-2 progress ticket committed its SDL regen)
  - [ ] 7.QL sub-loop on the generated files is N/A (they are generated, not authored); run `bun tsgo` once to confirm the codegen introduced zero type errors
  - [ ] 7.TE the SDL-surface test (`backend/graphql/test/schema-surface.test.ts` or sibling — verify the exact file) asserts the new enum/field/mutation exist on the generated schema
  - [ ] 7.SEC no secrets in generated artifacts
  - [ ] 7.SR codegen config untouched (`codegen.ts`); no manual edits to `schema.graphql` (it is generated, never hand-edited)
  - [ ] 7.IV graphql-layer rule files
  - _Requirements: REQ-002.4, REQ-008, REQ-007_

## Phase 4 — Final Quality Gate

- [ ] 8. Final quality gate + deferred-items enforcement
  - Two-source-split grep proof (REQ-006.2 enforcement): `rg "suspended" backend/services/teachers/applicant-lifecycle.service.ts backend/db/repo/teachers/applicant.repository.ts` → ZERO matches in the NEW code (the existing `applicant-lifecycle.service.ts:18-20` docblock MENTIONS `users.suspended` in a comment — that is the documented absence, NOT a write; verify the grep distinguishes the comment from a write)
  - Zero-delta rubric-path check (REQ-003.5): `git diff --stat backend/services/teachers/evaluation-rubric.helpers.ts shared/constants/evaluation-rubric.constants.ts` (vs the Task 0 baseline commit) → EMPTY — the failure-time write path is consumed, never modified; any delta is a scope violation
  - Deferred-items ledger check: `grep -cE "^\| D[0-9]+ .*(❌|⚠️)" ai/plans/milestone_1_core_domain_mvp/cooldown_state_machine_1_month_tajweed_3_month_hifz/deferred-items.md` → expected 0 (row-anchored regex per the ledger's Enforcement section — legend/prose glyphs never match; D1..D5 are intentional deferrals marked 📋, NOT ❌/⚠️ blockers)
  - Traceability check: `for r in $(grep -oE 'REQ-[0-9]+' specs.md | sort -u); do grep -q "$r" tasks.md || echo MISSING: $r; done` → zero misses
  - Full-suite: `bun tsgo` (zero new errors vs baseline), `bun biome:check` (zero new warnings), `bun run scripts/lint-service.ts --id final` (zero new lint), repo tests + service tests + GraphQL wire tests green, journey `test/workflows/teachers/cooldown-state-machine.test.ts` green via `bun run test/scripts/run-test.ts test/workflows`
  - Write `outcome/8-final-gate-outcome.md` recording the baseline-delta (new errors must be 0) + the grep proofs + the journey pass
  - [ ] 8.QL sub-loop `--lifecycle duplicates` on every file touched in Tasks 1-7 → 0 (re-run as a batch)
  - [ ] 8.TE full suite green; journey green; the 12-step journey asserted
  - [ ] 8.SEC the two-source-split grep proof is the security gate (zero `users.suspended` writes in the new code)
  - [ ] 8.SR semantic-review checklist complete on every task (tenancy, races, enums-as-values, no cross-layer imports, no dead code, two-source-split logged)
  - [ ] 8.IV read all rule files one final time
  - _Requirements: REQ-001, REQ-006 (grep proof), all REQs (traceability)_

## Phase 5 — Post-Implementation Review Wave

- [ ] 9. Post-implementation review wave + full gates
  - Dispatch PARALLEL review subagents over the git diff of this plan only: `review-backend` (repo, service, mutation — incl. concurrency/TOCTOU over `plan.md` §6), `review-types` (type usage, enums-as-value-imports, `backend/types/` discipline), `security-probing` (BOLA/BOPLA/BFLA on `adminExtendApplicantCooldown`, wildcard/LIKE probes, the two-source-split no-transport guarantee).
  - Review scope (the plan's file cluster): `backend/types/teachers/applicant.types.ts` · `backend/db/repo/teachers/applicant.repository.ts` · `backend/services/teachers/applicant-lifecycle.service.ts` (+ `.test.ts`) · `backend/db/test/repo/teachers/applicant.repository.test.ts` · `backend/graphql/pothos/shared/enum.pothos.ts` · `backend/graphql/pothos/teachers/applicant.pothos.ts` · `backend/graphql/mutation/admin/admin-governance.mutation.ts` · `shared/locale/types/errors/labels.ts` + `shared/locale/{en,ar}/errors/index.ts` · `test/workflows/teachers/cooldown-state-machine.test.ts`
  - Aggregate CRITICAL/HIGH/MEDIUM/LOW; filter pre-existing noise; fix per file cluster; each fix re-runs `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` → exit 0; re-review until zero feature-specific findings.
  - Write `outcome/post-implementation-review.md`; then run `bun quality-gate` → green (resume from the last failed stage on re-runs; NEVER clear caches).
  - _Requirements: REQ-001, REQ-006_

## Phase 6 — Knowledge Propagation

- [ ] 10. Knowledge doc + close-out
  - CREATE `docs/teachers/applicant-cooldown.md`: the cooldown state machine as consumed (zero-delta `finalizeRubricFail` path), the admin extension primitive (`max(currentCooldownUntil, now) + additionalDays`, eligible `pending`/`in_evaluation`/`failed`, terminal-on-pass `APPLICANT_ALREADY_CERTIFIED`, bounds 1..3650), the derived `cooldownState` read-model (non-pgEnum Pothos enum), the two-source-split boundary (cooldown machinery never writes `users.suspended*` — the binding reconciliation), the `AuditActionType.Adjust` contract, and the child-ticket hand-offs (ledger D1 Student Conversion, D2 Admin Override). Link from `docs/teachers/applicant-lifecycle.md` §2.3 and from the rubric-scoring / verification-purchase docs.
  - NEVER edit `AGENTS.md` or any `.agents/instructions/*` file (hand-curated). Write `outcome/10-knowledge-propagation-outcome.md`.
  - _Requirements: REQ-001, REQ-006 (consolidated evidence)_

---

## Task Sequencing Summary

| Phase | Task | Kind | Depends on | REQs |
|---|---|---|---|---|
| 0 | 0. Baseline | setup | — | REQ-001 |
| 1 | 1. Types | foundation | 0 | REQ-008, REQ-002 |
| 1 | 2. Repository `extendCooldownOnce` | foundation + tests | 1 | REQ-007, REQ-006, REQ-003 |
| 1 | 3. i18n leaf | foundation | 0 | REQ-002, REQ-007 |
| 2 | 4. Service `extendApplicantCooldown` + `deriveCooldownState` | core + tests | 1, 2, 3 | REQ-003..REQ-010 |
| 2 | 5. Journey test (RED) | test-first | 1, 2, 3 (drives 4/6) | REQ-011, REQ-006, REQ-003, REQ-004, REQ-007, REQ-008 |
| 2.5 | 2.5 Mid-point backend review gate | review | 1–5 | REQ-001 |
| 3 | 6. GraphQL enum + field + mutation | surface | 4 (GREEN), 2.5 | REQ-007, REQ-008, REQ-011 |
| 3 | 7. SDL/codegen | codegen | 6 | REQ-002.4, REQ-008, REQ-007 |
| 4 | 8. Final quality gate | gate | all | REQ-001, REQ-006, traceability |
| 5 | 9. Post-implementation review wave | review | 8 | REQ-001, REQ-006 |
| 6 | 10. Knowledge doc + close-out | docs | 9 | REQ-001, REQ-006 |


