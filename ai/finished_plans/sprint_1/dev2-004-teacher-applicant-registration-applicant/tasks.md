# Trackable Implementation Tasks: DEV2-004 — Teacher Applicant Registration & Applicants Table

> **Plan directory:** `ai/plans/dev2-004-teacher-applicant-registration/`
> **Governing documents:** `specs.md` (REQ-001..REQ-083), `plan.md`, `.agents/skills/spec-implementation/SKILL.md`, `tasks-template.md`
> **Nature of ticket:** Mostly-verification + small-additive. The registration→applicants write path ALREADY EXISTS (DEV1-002). Do NOT rebuild it. Net-new scope: `ApplicantStatus` enum, `ApplicantLifecycleService`, one new repo method, `myApplicantProfile` query, applicant status card, and permanent contract-lock tests.

---

## Non-Negotiable Execution Protocol

The following protocol applies to EVERY task in this file. It is not optional and is not repeated inline per task to avoid redundancy; treat it as globally binding.

1. **Pre-Execution Outcome Knowledge Read (MANDATORY before starting ANY task)**
   - Read ALL existing files under `ai/plans/dev2-004-teacher-applicant-registration/outcome/` before beginning work. Respect every recorded decision, verified signature, discovered gotcha, and deferred item.
   - Read `deferred-items.md`. If any ❌/⚠️ entry blocks the current task, resolve it as the second coordinated fix line or stop and record — never work around it silently.

2. **Post-Edit Quality Loop Verification (MANDATORY after EVERY file create/modify)**
   - Immediately after editing a file, run:
     `bun run scripts/health/sub-loop.ts <file-path> --lifecycle duplicates`
   - Exit code MUST be 0 before proceeding to the next file. Never batch-then-verify.

3. **Test Execution**
   - DB-bound tests MUST run via: `bun run test/scripts/run-test.ts <test-path>`
   - Service/unit suites via the project's service test runner; coverage measured with `bun test --coverage`.
   - NEVER declare a task complete with failing or skipped tests (.skip/.only forbidden).

4. **Semantic Review Checklist Self-Review (MANDATORY per task)**
   - Self-review every produced file against: atomicity & tx propagation, env-config compliance, zero dead code, zero cross-layer imports (`shared/` purity; no `frontend/`→`backend/` leaks), enums as VALUE imports in runtime positions, canonical types only, `DomainError` discipline, i18n-only strings, no `console.*`, no hardcoded colors/style props.

5. **Outcome Documentation (MANDATORY after EVERY task)**
   - Write `outcome/<task-id>-outcome.md` containing: summary of what was done, files changed, files DELIBERATELY NOT changed (especially DEV1-001/DEV1-002-owned surfaces), verification command outputs, cross-file dependencies introduced, deviations vs plan, follow-ups for later tasks.

6. **Outcome Section Updates for Review/Repair Tasks**
   - For review-task outcomes, explicitly list: findings, repair file paths, which tests were re-run, and residual risk.

7. **Checkbox Tracking**
   - Mark boxes `[x]` ONLY after the two agent-browser/health self-loops (where applicable) and verification commands pass. Unsupported claims of completion are protocol violations.

8. **Scope Freeze Discipline**
   - Files owned by DEV1-001 (`backend/db/schema/**`), DEV1-002 (`RegistrationService`, `auth.mutation.ts`, `RegisterPublicRole`), DEV2-001/DEV2-002 (auth context, authScopes engine) are VERIFY-ONLY unless a contract-lock test proves a defect. Any such defect ⇒ defer via `deferred-items.md` + coordinated fix; never inline-patch as a workaround.

---

## Phase 0: Pre-Implementation Baseline

### Task 0.1 — Baseline Recording & Deferred-Items Ledger Initialization

- [x] 0.1 Record baseline and initialize the deferred-items ledger
  - Files to create:
    - `ai/plans/dev2-004-teacher-applicant-registration/deferred-items.md` (from `.agents/spec-process-guide/templates/deferred-items-template.md`)
    - `ai/plans/dev2-004-teacher-applicant-registration/outcome/phase0-baseline-outcome.md`
  - Commands to run and record (redirect output into the outcome file):
    - `bun tsgo` → record total error count
    - `bun biome:check` → record total issue count
    - `bun run scripts/lint-service.ts --json --id baseline` → record baseline JSON
    - `git diff --name-only` → record the pre-existing modified-file set (these files are EXEMPT from this ticket's "your changes must be clean" gate)
    - `git diff -- backend/db/schema/** backend/db/migration/**` → MUST be empty; record as evidence
  - _Requirements: REQ-001, REQ-045_
  - [x] 0.1.SR **Semantic Review**: outcome file contains all five command outputs verbatim; ledger is initialized with zero ❌/⚠️ entries.
  - [x] 0.1.OC **Outcome**: write `outcome/0.1-outcome.md` with counts and exempt-file list.

### Task 0.2 — Prerequisite Verification (Reuse, Don't Rebuild)

- [x] 0.2 Verify and DO NOT reimplement existing artifacts
  - Read and verify existence + exact signatures of:
    - `backend/db/schema/teachers/applicants.ts` — `applicants` table (id shared PK→users.id cascade, `verification_attempts integer default 0`, `last_attempt_at timestamp`, `cooldown_until timestamp`, `status varchar(50) default 'pending'`)
    - `backend/db/schema/enums.ts` — `user_role` pgEnum contains `parent` (C.1)
    - `backend/db/schema/users/users.ts` — governance fields (A.7)
    - `backend/types/teachers/applicant.types.ts` — `ApplicantSelectType`, `ApplicantInsertType` exist
    - `backend/db/repo/teachers/applicant.repository.ts` — `create(userId, tx)` exists (DEV1-002); NOTE whether `findByUserId` already exists and its exact signature (+ whether it uses the `queryDb(tx)` Neon-HTTP pattern — this determines REQ-044 approach)
    - `backend/services/auth/` (or DEV1-002 location) `RegistrationService` — teacher branch calls applicant create inside `withTransaction(outerTx)`; record exact dispatch path (CreateRoleChild dispatcher)
    - DEV2-002 authScope engine: `role` scope implementation, canonical UNAUTHORIZED/FORBIDDEN codes
    - `backend/db/test/entity-setup.ts` — verify `createTestUser`/registration helpers; NOTE whether a `createTestApplicant` helper exists
    - `backend/db/test/logic/auth/` — locate the existing DEV1-002 registration test module (target of REQ-071 extension)
    - `shared/locale/types/**` + `shared/locale/ar/**` + `shared/locale/en/**` — existing `errors` namespace keys; determine whether an `applicant` namespace exists
    - `frontend/graphql/sharedDocuments/teachers/` — barrel conventions
    - `docs/specs/open-decisions-and-gaps.md` (B.6, B.7, A.7, C.2), `docs/specs/state-machine-invariants.md` (INV-TV1..TV7), `docs/workflows/01-teacher-verification-workflow.md`, `docs/auth/user-registration.md`, `docs/auth/jwt-authentication-service.md`, `docs/graphql/domain-error-extensions-code.md`, `docs/drizzle/prepared-statements.md`, `docs/graphql/dataloader-batching.md`
  - Applicable AGENTS.md: root `AGENTS.md`, `backend/db/AGENTS.md`, `backend/db/repo/AGENTS.md`, `backend/services/AGENTS.md`, `backend/types/AGENTS.md`, `backend/enum/AGENTS.md`, `shared/locale/AGENTS.md`
  - _Requirements: REQ-002, REQ-083_
  - [x] 0.2.BLOCK **Missing Artifact Gate**: IF any required artifact is missing/mismatched THEN record a ❌ entry in `deferred-items.md` and block dependent tasks — NEVER patch DEV1-001/DEV1-002-owned files in place as a workaround without an explicit, second coordinated fix line.
  - [x] 0.2.SR **Semantic Review**: verification outcome records exact file paths, method signatures, and the findByUserId/queryDb determination as facts for downstream tasks.
  - [x] 0.2.OC **Outcome**: write `outcome/0.2-outcome.md` with the verified artifact inventory and signature catalog.

### Task 0.3 — Phase 1.5 Plan Review Gate

- [x] 0.3 Invoke `@plan-review` on the complete plan package
  - Inputs: `specs.md`, `plan.md`, this `tasks.md`, plus all Phase-0 outcomes
  - Output required: `ai/plans/dev2-004-teacher-applicant-registration/plan-review-R1.md` MUST exist before ANY implementation task begins
  - _Requirements: REQ-083_
  - [x] 0.3.SR **Semantic Review**: every reviewer action item from plan-review-R1.md is either resolved in-ticket or filed as a resolvable deferred entry (never ❌/⚠️ debt targeted at unknown owners).
  - [x] 0.3.OC **Outcome**: write `outcome/0.3-outcome.md` summarizing review verdicts and dispositions.

---

## Phase 1: Types, Enums & Database Schema

> Schema work in this phase is **TypeScript-canonical-only**. Per REQ-045, `git diff` for `backend/db/schema/**` and `backend/db/migration/**` MUST be EMPTY at ticket end. There is NO `pgEnum` addition and NO `bun run db push`.

### Task 1.1 — ApplicantStatus Canonical Enum & Type Guard

- [x] 1.1 Implement the `ApplicantStatus` TS enum and `isApplicantStatus` guard
  - Files to create/modify:
    - CREATE `backend/enum/teachers/applicant-status.enum.ts` — EXACT members: `Pending = "pending"`, `InEvaluation = "in_evaluation"`, `Failed = "failed"`, `Passed = "passed"` (matching the canonical value set recorded for `applicants.status`); export `isApplicantStatus(value: unknown): value is ApplicantStatus` (string check + `Object.values` membership)
    - MODIFY `backend/enum/teachers/index.ts` — add `export * from "./applicant-status.enum"`
    - VERIFY-ONLY `backend/enum/index.ts` — confirm top-level barrel already re-exports `teachers/`; edit ONLY if it does not (record disposition in outcome)
  - Applicable AGENTS.md: `backend/enum/AGENTS.md`, root `AGENTS.md`
  - _Requirements: REQ-012, REQ-004_
  - Invariants enforced: value import semantics for runtime usage; NO raw status string literals anywhere outside this file and its tests; NO page in DB schema touched.
  - [x] 1.1.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts backend/enum/teachers/applicant-status.enum.ts --lifecycle duplicates` (exit code 0); repeat for modified barrel.
  - [x] 1.1.TE **Test Engineering** — 4-Tier:
    - Tier 1 (branch/stmt): every enum member passes the guard; non-members fail — 100% coverage of the guard function.
    - Tier 2 (boundary): `"Pending"` (case mismatch), `"pending "` (whitespace), `""`, numeric `0`, `undefined`, `null` — all rejected.
    - Tier 3 (fuzz/chaos): random strings, long strings, unicode/Arabic/RTL strings, strings containing `%`, `_`, `\`, `'` — ALL rejected (guard fails closed; REQ-075).
    - Tier 4 (security): object with `toString` override, prototype-polluted objects (`Object.create(null)`, crafted `__proto__`-bearing payload as unknown) — rejected without throwing.
    - Test file: `backend/enum/teachers/applicant-status.enum.test.ts` (pure unit tier — no DB needed).
  - [x] 1.1.SEC **Security & Tenancy Audit**: guard is the sole canonical value validator (REQ-012); no export outside `backend/enum/**` bypasses it when runtime-validating stored values.
  - [x] 1.1.SR **Semantic Review**: enum exported by VALUE (enum + guard function, no `export type`); zero dead code; no cross-layer import (enum file imports NOTHING outside `backend/enum/` conventions); names match REQ-012 exactly.
  - [x] 1.1.IV **Instruction Verification**: validate against `backend/enum/AGENTS.md` conventions and auto-discovered instruction files.
  - [x] 1.1.OC **Outcome**: write `outcome/1.1-outcome.md`.

### Task 1.2 — ApplicantProfileReturnType Canonical Type

- [x] 1.2 Add `ApplicantProfileReturnType` to the canonical applicant types file
  - Files to modify:
    - MODIFY `backend/types/teachers/applicant.types.ts` — extend (existing `ApplicantSelectType`/`ApplicantInsertType` UNCHANGED) with:
      ```typescript
      export interface ApplicantProfileReturnType {
        readonly id: number;                    // shared PK (= users.id)
        readonly status: ApplicantStatus;       // guard-validated at service boundary
        readonly verificationAttempts: number;
        readonly lastAttemptAt: Date | null;
        readonly cooldownUntil: Date | null;
        readonly cooldownActive: boolean;       // computed server-side
        readonly canPurchaseVerification: boolean; // computed server-side
      }
      ```
      `ApplicantStatus` imported as VALUE import from `backend/enum/teachers/applicant-status.enum.ts`.
  - VERIFY-ONLY `backend/types/teachers/index.ts` — barrel already exports `applicant.types.ts` (confirm; edit only if absent).
  - Applicable AGENTS.md: `backend/types/AGENTS.md`
  - _Requirements: REQ-004, REQ-017, REQ-032 (closed readonly output shape; no write fields)_
  - Invariants enforced: NO governance fields, NO secrets, NO client-writable fields in the return type; NO new `.types.ts` file outside `backend/types/`.
  - [x] 1.2.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts backend/types/teachers/applicant.types.ts --lifecycle duplicates` (exit code 0).
  - [x] 1.2.TE **Test Engineering**: compile-time tier — tsgo passes; a shape-assertion unit test (type-level or trivial runtime construction validating all 7 fields present) is NOT required for a pure interface, but the enum→type wiring is exercised indirectly by Task 2.2 service tests.
  - [x] 1.2.SEC **Security & Tenancy Audit**: BOPLA — readonly closed shape; confirm no field mirrors a client-provided input name/writability surface.
  - [x] 1.2.SR **Semantic Review**: zero duplicated type definitions; canonical-type-file location respected; no imports from `app/`/`frontend/`/`shared/` beyond allowed conventions.
  - [x] 1.2.IV **Instruction Verification**: `backend/types/AGENTS.md` naming/wholeness rules satisfied.
  - [x] 1.2.OC **Outcome**: write `outcome/1.2-outcome.md`.

### Task 1.3 — i18n Keys: `applicant` Namespace (NEW) + `errors` Extensions

- [x] 1.3 Register compile-time i18n keys for applicant lifecycle and error surfaces
  - Files to modify/create (follow `shared/locale/AGENTS.md` namespace-registration procedure EXACTLY; verify the actual registration mechanism in 0.2 before authoring):
    - `shared/locale/types/` — add `applicant` namespace type surface entries (status labels: pending / inEvaluation / failed / passed; dashboard card copy: pending prompt, attempt count label, cooldown expiry line, eligible-to-reapply affordance, certified summary copy) AND new `errors` namespace entries (`applicantNotFound`, `applicantCooldownActive` — message interpolates cooldown expiry timestamp, `applicantStatusCorrupt` if the ValidationError path surfaces a distinct message)
    - `shared/locale/en/` — English implementations for ALL above keys
    - `shared/locale/ar/` — Arabic implementations for ALL above keys (parity MUST be exact; Arabic copy must be natural, RTL-correct)
    - Namespace index/registration file per `shared/locale/AGENTS.md` (register the new `applicant` namespace in the `Translation` enum ONLY if that enum is the established registration mechanism — VERIFY first in 0.2; record mechanism choice in outcome)
  - Applicable AGENTS.md: `shared/locale/AGENTS.md`, `shared/AGENTS.md`
  - _Requirements: REQ-003, REQ-051, REQ-018, REQ-015 (message interpolation), REQ-050_
  - Invariants enforced: `shared/` imports NOTHING from `frontend/`, `backend/`, or `app/`; keys are accessed via property (`t.key`), never `t('key')`; both locales registered atomically.
  - [x] 1.3.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts <each touched locale/types file> --lifecycle duplicates` (exit code 0 for each).
  - [x] 1.3.TE **Test Engineering**: locale-parity tier — ar/en key-sets identical for `applicant` namespace and new `errors` keys; interpolation placeholder name for cooldown timestamp identical across both locales; no next-intl references, no `shared/messages/`, no `getBackendTranslations` anywhere in diff (grep-gated).
  - [x] 1.3.SEC **Security & Tenancy Audit**: cooldown error message interpolates ONLY the timestamp + generic copy — no leakage of other users' data, no internal flags (REQ-035 discipline applies to message construction).
  - [x] 1.3.SR **Semantic Review**: zero hardcoded user-facing strings; symmetric ar/en coverage property-accessible (type error if key missing — verified via tsgo); Translation enum value-import where consumed at runtime.
  - [x] 1.3.IV **Instruction Verification**: read and validate against every auto-discovered `shared/locale/**` AGENTS.md and instruction file; namespace registration procedure followed verbatim.
  - [x] 1.3.OC **Outcome**: write `outcome/1.3-outcome.md`.

### Task 1.4 — Schema-Drift Prohibition Verification Gate

- [x] 1.4 Prove zero schema drift before leaving Phase 1
  - Commands:
    - `git diff -- backend/db/schema/** backend/db/migration/**` → MUST be EMPTY
  - Files to create: append evidence to `outcome/1.4-outcome.md`
  - _Requirements: REQ-045, REQ-001_
  - [x] 1.4.SR **Semantic Review**: `ApplicantStatus` has NO `pgEnum` counterpart (deliberate, per plan D1); varchar contract remains untouched.
  - [x] 1.4.OC **Outcome**: write `outcome/1.4-outcome.md` with command outputs.

---

## Phase 2: Repositories & Backend Services

### Task 2.1 — ApplicantRepository Read + Atomic Attempt-Increment Methods

- [x] 2.1 Implement `findByUserId` (only if absent per 0.2 finding) and `recordVerificationAttempt`
  - Files to modify:
    - MODIFY `backend/db/repo/teachers/applicant.repository.ts` — ADD ONLY (existing `create` untouched):
      - `findByUserId(userId: number, tx?: DBTransaction): Promise<ApplicantSelectType | null>` — follow 0.2 determination: if the repository already presents a `queryDb(tx)` Neon-HTTP-pattern method to mirror, use it; otherwise a plain parameterized Drizzle query (REQ-044).
      - `recordVerificationAttempt(userId: number, tx?: DBTransaction): Promise<ApplicantSelectType | null>` — SINGLE statement, in-place increment:
        `UPDATE applicants SET verification_attempts = verification_attempts + 1, last_attempt_at = now(), updated_at = now() WHERE id = @userId RETURNING *` expressed via Drizzle (`sql` expressions for the increment/`now()`; parameterized id; NO SELECT-then-UPDATE; NO `sql.placeholder` on a write; NO `inArray`; NO inline `--` comments inside the `sql` template). Returns null when zero rows matched (service converts to NotFoundError).
  - Applicable AGENTS.md: `backend/db/repo/AGENTS.md`, `backend/db/AGENTS.md`, root `AGENTS.md`; instruction refs: `docs/drizzle/prepared-statements.md`, `docs/IDEMPOTENCY.md`
  - _Requirements: REQ-014, REQ-041, REQ-042, REQ-044, REQ-032 (zero client input lands here)_
  - Invariants enforced: every method takes optional `tx?: DBTransaction` as the LAST parameter; no global-`db` reads mixed with `tx` writes in flows; no prepared statements for the write; `RETURNING *` provides audit row.
  - [x] 2.1.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts backend/db/repo/teachers/applicant.repository.ts --lifecycle duplicates` (exit code 0).
  - [x] 2.1.TE **Test Engineering** — 4-Tier (`backend/db/test/logic/teachers/applicant-lifecycle.test.ts` begins here; ALL tests inside `runInRollback`, `tx` passed to EVERY repo/Drizzle call after verifying actual param positions, entities via `entity-setup.ts` only — add `createTestApplicant` helper ONLY if 0.2 proved it missing, `expectRepoError` try/catch helper ONLY — `expect(...).rejects.toThrow()` PROHIBITED):
    - Tier 1 (branch/stmt): findByUserId returns row / null; recordVerificationAttempt increments 0→1 with `last_attempt_at` set and returns the updated row; missing-row call returns null.
    - Tier 2 (boundary): attempts already high (e.g., set 3 via setup) → becomes 4; `last_attempt_at` monotonic advance with a setup-forced older value.
    - Tier 3 (chaos/concurrency): two SEQUENTIAL calls → 0→1→2 (REQ-072); two CONCURRENT calls via `Promise.allSettled` inside the same `runInRollback` → final `verification_attempts = 2`, no lost update (REQ-042); randomized-UUID emails for all created users.
    - Tier 4 (security/tenancy): recordVerificationAttempt for user A inside a tx cannot touch user B's row (verify B's attempts unchanged); the `UPDATE` is provably parameterized (static review: no string concatenation of the id).
    - Coverage: 100% statement/branch on NEW repo logic (`bun test --coverage`).
    - Runner: `bun run test/scripts/run-test.ts <test-path>`.
  - [x] 2.1.SEC **Security & Tenancy Audit**: BOLA — methods key strictly off the provided PK used ONLY with caller-derived ids by services; BOPLA — zero client input surface in the write; no wildcard/LIKE usage (nothing to escape); no `console.*`.
  - [x] 2.1.SR **Semantic Review**: atomicity (single UPDATE, DB-side `+1` server-side, never read-modify-write in application code); tx propagation consistent; zero dead code; canonical types only (`ApplicantSelectType` import); no cross-layer imports; enum not needed here (no status writes).
  - [x] 2.1.IV **Instruction Verification**: validated against `backend/db/repo/AGENTS.md`, `docs/drizzle/prepared-statements.md` (write-exclusion rule honored), auto-discovered instruction files.
  - [x] 2.1.OC **Outcome**: write `outcome/2.1-outcome.md`.

### Task 2.2 — ApplicantLifecycleService (Profile Shaping, Cooldown Guard, Re-application Contract)

- [x] 2.2 Implement `backend/services/teachers/applicant-lifecycle.service.ts` (NEW)
  - Files to create:
    - CREATE `backend/services/teachers/applicant-lifecycle.service.ts` — namespace pattern `export namespace ApplicantLifecycleService` with EXACTLY three functions (plan §4.1):
      - `getMyApplicantProfile(userId: number, locale: string, tx?: DBTransaction): Promise<ApplicantProfileReturnType | null>` — ONE read via `findByUserId`; no row ⇒ `null` (certified / never-applicant — SAME null answer, REQ-035 no-oracle); row ⇒ validate stored status with `isApplicantStatus` (junk ⇒ `ValidationError`, custom validation code per `docs/graphql/domain-error-extensions-code.md` — fail closed, REQ-012/075); capture `now` ONCE; compute `cooldownActive = cooldownUntil !== null && cooldownUntil > now`; `canPurchaseVerification = !cooldownActive && status !== ApplicantStatus.Passed`; shape `ApplicantProfileReturnType`.
      - `assertCanPurchaseVerification(userId: number, locale: string, tx?: DBTransaction): Promise<void>` — single read + pure compute against captured `now`; missing row ⇒ `NotFoundError` (`APPLICANT_NOT_FOUND`, localized via `getServerTranslations(locale, "errors")`); active cooldown ⇒ `ValidationError` with CUSTOM code `APPLICANT_COOLDOWN_ACTIVE` + localized message interpolating `cooldownUntil` (INV-TV3; authoritative read source is `applicants.cooldown_until` ONLY — NEVER `users.suspended`, REQ-015/016); no-op otherwise. `logger.logDomainError` on the domain rejection ONLY (REQ-052; context `{ code, entity: "applicants", entityId: userId }` — no PII-heavy payloads; NOT for NotFound on profile path where null-return is the contract).
      - `recordReapplication(userId: number, locale: string, tx?: DBTransaction): Promise<ApplicantSelectType>` — delegates to `ApplicantRepository.recordVerificationAttempt(userId, tx)`; null return ⇒ `NotFoundError` (`APPLICANT_NOT_FOUND`) + `logDomainError`; returns row for audit log use.
  - Applicable AGENTS.md: `backend/services/AGENTS.md`, root `AGENTS.md`; refs: `docs/graphql/domain-error-extensions-code.md`, `docs/specs/state-machine-invariants.md` (INV-TV3/TV4), `docs/IDEMPOTENCY.md`
  - _Requirements: REQ-004, REQ-013, REQ-014, REQ-015, REQ-016, REQ-017, REQ-041, REQ-043, REQ-050, REQ-051, REQ-052, REQ-053_
  - Invariants enforced:
    - Service-layer `.types.ts` files PROHIBITED — all types from `backend/types/teachers/applicant.types.ts`.
    - `ApplicantStatus`/`UserRole` as VALUE imports (runtime use).
    - Plain `new Error(...)` PROHIBITED — `DomainError` subclasses only with `extensions.code`.
    - NO writes in the guard/profile paths (pure read+compute); NO locks introduced (advisory-at-isolation-level documented, REQ-043).
    - Cooldown math duration-AGNOSTIC (INV-TV4 durations are a DEV2-008 write-time concern).
    - `logger.logDomainError` for expected domain rejections ONLY; happy path emits NOTHING (REQ-053); unexpected internals bubble to GraphQL masking boundary; `logger.error` reserved for true 5xx; `console.*` forbidden.
  - [x] 2.2.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts backend/services/teachers/applicant-lifecycle.service.ts --lifecycle duplicates` (exit code 0).
  - [x] 2.2.TE **Test Engineering** — 4-Tier (`backend/services/teachers/applicant-lifecycle.service.test.ts` — mocked-repo pure service tier where appropriate + DB-tier cases via `runInRollback`):
    - Tier 1 (branch/stmt): 100% branch coverage of all three functions — profile null path / pending / in_evaluation / failed-active / failed-expired / passed; guard allow / block / missing-row; reapplication success / missing-row.
    - Tier 2 (boundary): `cooldownUntil` NULL ⇒ allowed; future ⇒ blocked with `APPLICANT_COOLDOWN_ACTIVE` AND the error message asserted as a SUBSTRING of the TRANSLATED message (never the raw key, never hardcoded); EXACTLY `now` ⇒ ALLOWED (strict `>` comparator — REQ-072); past ⇒ allowed; missing applicant ⇒ `APPLICANT_NOT_FOUND`.
    - Tier 3 (chaos): stored status junk strings rejected by `isApplicantStatus` fail-closed path (`ValidationError`); rapid repeated guard calls deterministic across a captured-now boundary; concurrent `recordReapplication` ×2 via `Promise.allSettled` (DB tier) ⇒ attempts = 2 with no lost update.
    - Tier 4 (security): service derives identity ONLY from the `userId` argument supplied by the resolver from `ctx.user.id` (no alternate identity channel exists in signatures); error messages contain no foreign-user data (REQ-035); localized `errors` keys resolve in BOTH ar and en.
    - Assertions against translated messages use `expectRepoError`-class try/catch helper; never `.rejects.toThrow()` in DB tier.
    - Runner: DB-tier via `bun run test/scripts/run-test.ts <test-path>`; pure tier via standard runner with `--coverage` on the service file.
  - [x] 2.2.SEC **Security & Tenancy Audit**: BOLA — identity has no parameter-surface beyond caller-supplied PK; BOPLA — zero write input shapes accepted; BFLA — service does not self-gate (gate lives at resolver authScopes, Task 3.3) but performs NO certification-adjacent writes (teacher.is_approved / is_evaluator / is_online / subjects / request_preference untouched — REQ-033); wildcard escaping N/A (no LIKE).
  - [x] 2.2.SR **Semantic Review**: captured-now discipline; no swallowed try/catch; no silent paths on happy path (REQ-053); no dead code; env-config compliant; canonical localized messages; zero cross-layer imports; logging levels correct (`logDomainError` ≠ `logger.error`).
  - [x] 2.2.IV **Instruction Verification**: validate against `backend/services/AGENTS.md`, `docs/graphql/domain-error-extensions-code.md`, auto-discovered instruction files.
  - [x] 2.2.OC **Outcome**: write `outcome/2.2-outcome.md`.

### Task 2.M — Mid-Point Review Gate (MANDATORY)

- [x] 2.M Mid-Point Review of Phases 0–2 before ANY GraphQL/frontend work begins
  - Verify checklist (record pass/fail per item):
    - All 2.1/2.2 tests GREEN via `run-test.ts`; coverage ≥100% on new logic.
    - `git diff -- backend/db/schema/** backend/db/migration/**` EMPTY.
    - `ApplicantStatus` is TS-enum-only (no pgEnum anywhere in diff).
    - Zero hardcoded status string literals outside `applicant-status.enum.ts` and tests (grep-gated).
    - `bun tsgo`, `bun biome:check` counts vs baseline — ZERO new issues attributable to this ticket.
    - `deferred-items.md` — no ❌/⚠️ accrued in Phases 1–2.
    - Every read/path signature matches what the resolver/frontend tasks will assume (contract coherence check against plan §3).
  - Files to create: `outcome/2.M-outcome.md`
  - _Requirements: REQ-076, REQ-083 (partially — review-wave discipline anticipates Phase 6 findings)_
  - [x] 2.M.SR **Semantic Review**: unresolved findings are converted to tasks or deferred entries NOW; do not proceed to Phase 3 with open defects.
  - [x] 2.M.OC **Outcome**: write `outcome/2.M-outcome.md`.

---

## Phase 3: GraphQL Resolvers & API Handlers

### Task 3.1 — ApplicantStatus Pothos Enum Registration

- [x] 3.1 Register `ApplicantStatus` once in the shared Pothos enum module (enum-object form — CRITICAL RULE)
  - Files to modify:
    - MODIFY `backend/graphql/pothos/shared/enum.pothos.ts` — add `export const ApplicantStatusPothosEnum = gqlSchemaBuilder.enumType(ApplicantStatus, { name: "ApplicantStatus" })` using the canonical TS enum VALUE import — NEVER a `values: [...]` literal registration (per `backend/graphql/pothos/AGENTS.md` CRITICAL rule, plan D6).
  - Applicable AGENTS.md: `backend/graphql/pothos/AGENTS.md`, `backend/graphql/AGENTS.md`
  - _Requirements: REQ-061, REQ-012_
  - [x] 3.1.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts backend/graphql/pothos/shared/enum.pothos.ts --lifecycle duplicates` (exit code 0).
  - [x] 3.1.TE **Test Engineering**: schema-introspection tier — regenerated SDL contains `enum ApplicantStatus { PENDING IN_EVALUATION FAILED PASSED }` exactly (verified after Task 3.4 codegen; asserted in integration suite).
  - [x] 3.1.SEC **Security & Tenancy Audit**: registration name collision check (grep SDL for single occurrence); no literal-values drift risk.
  - [x] 3.1.SR **Semantic Review**: single registration site; value import of the enum; no duplicate enum definitions anywhere in `backend/graphql/**`.
  - [x] 3.1.IV **Instruction Verification**: `backend/graphql/pothos/AGENTS.md` enum registration rule satisfied verbatim.
  - [x] 3.1.OC **Outcome**: write `outcome/3.1-outcome.md`.

### Task 3.2 — ApplicantProfile Pothos Object Type

- [x] 3.2 Implement the `ApplicantProfile` object reference with all seven fields
  - Files to create:
    - CREATE `backend/graphql/pothos/teachers/applicant.pothos.ts` — `gqlSchemaBuilder.objectRef<ApplicantProfileReturnType>("ApplicantProfile").implement({ ... })` exposing: non-nullable `id` (str.required or per-project ID exposure pattern — REQUIRED for Apollo cache normalization / DataLoader rules, REQ-060), `status` typed via `ApplicantStatusPothosEnum`, `verificationAttempts`, nullable `lastAttemptAt`, nullable `cooldownUntil`, non-nullable `cooldownActive`, non-nullable `canPurchaseVerification`. DateTime scalar for timestamp fields follows the EXACT pattern DEV1-002 established for timestamp exposure on existing objects (VERIFY that pattern first — plan §3.1 note; record choice in outcome).
    - MODIFY the teachers-domain Pothos barrel if conventions require it (per `backend/graphql/pothos/**` AGENTS.md).
  - Applicable AGENTS.md: `backend/graphql/pothos/AGENTS.md`
  - _Requirements: REQ-060, REQ-004 (canonical return type is the object shape), REQ-032 (closed output)_
  - [x] 3.2.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts backend/graphql/pothos/teachers/applicant.pothos.ts --lifecycle duplicates` (exit code 0).
  - [x] 3.2.TE **Test Engineering**: exposed-field tier — integration suite (Task 5.3) selects ALL seven fields including `id`; any missing field fails the build/codegen.
  - [x] 3.2.SEC **Security & Tenancy Audit**: fields expose only what `ApplicantProfileReturnType` holds — no governance flags, no foreign ids, no write-typed fields.
  - [x] 3.2.SR **Semantic Review**: NO local type definitions (object shape = canonical `ApplicantProfileReturnType`); no inline resolvers containing business logic (fields map structurally); nullability matches plan §3.1 exactly.
  - [x] 3.2.IV **Instruction Verification**: validate against `backend/graphql/pothos/AGENTS.md` object/field exposure conventions.
  - [x] 3.2.OC **Outcome**: write `outcome/3.2-outcome.md`.

### Task 3.3 — myApplicantProfile Query Resolver (BOLA / BFLA Hardened)

- [x] 3.3 Implement the zero-argument, role-gated `myApplicantProfile` query
  - Files to create/modify:
    - CREATE `backend/graphql/query/teachers/applicant.query.ts` — `gqlSchemaBuilder.queryField("myApplicantProfile", (t) => t.field({ type: ApplicantProfileRef, nullable: true, authScopes: { role: [UserRole.Teacher] }, resolve: async (_root, _args, ctx) => ApplicantLifecycleService.getMyApplicantProfile(ctx.user.id, ctx.locale) }))` — VERIFY the exact authScopes/key/ctx-locale access pattern against the DEV2-002 engine and an existing role-gated query before authoring.
    - MODIFY the teachers query-domain index/barrel per existing conventions so the field registers.
    - VERIFY-ONLY the top-level query barrel re-exports teachers domain (edit only if missing).
  - Applicable AGENTS.md: `backend/graphql/AGENTS.md`, `backend/graphql/pothos/AGENTS.md`, root `AGENTS.md`
  - _Requirements: REQ-017, REQ-030 (ZERO args — identity exclusively `ctx.user.id`), REQ-031 (`{ role: [UserRole.Teacher] }`; 401 anonymous / 403 non-teacher via DEV2-002), REQ-035, REQ-050 (DomainError discipline; localized via `ctx.t("errors")` where the service needs it — VERIFY ctx.locale propagation pattern in 0.2), REQ-034 (no new rate-limit surface)_
  - Invariants enforced: `UserRole` is a VALUE import; resolver body contains NO business logic and NO try/catch swallowing; NEVER `new Error`; no local types; query sits in the AUTHENTICATED surface (not public).
  - [x] 3.3.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts backend/graphql/query/teachers/applicant.query.ts --lifecycle duplicates` (exit code 0), plus barrel file.
  - [x] 3.3.TE **Test Engineering** — 4-Tier (detailed assertions implemented in Task 5.3; this subtask authors the integration test file `frontend/graphql/test/teachers/applicant-profile.test.ts` — or the established GraphQL test location per 0.2 conventions — using `setupTestServerLifecycle` + `testClient`):
    - Tier 1: happy path — teacher-applicant caller receives full shape + `id`.
    - Tier 2 (boundary): certified teacher (has `teacher` row, no live applicants semantics) ⇒ payload `null`; status-corrupt row scenario asserted via forced setup (if constructible in test harness) ⇒ `VALIDATION` code.
    - Tier 3 (authz matrix via `CombinedGraphQLErrors` / `expectMutationError`-class helpers): anonymous ⇒ `UNAUTHORIZED`; student ⇒ `FORBIDDEN`; parent ⇒ `FORBIDDEN` (C.1 role-confusion probe); admin ⇒ `FORBIDDEN`; `extensions.code` matches `docs/graphql/domain-error-extensions-code.md` for EVERY denial path.
    - Tier 4 (BOLA probe): attempt to pass ANY args / craft payload variants targeting foreign ids ⇒ schema rejects unknown-args by construction (no-parameter-surface proof, REQ-030/075); denies disclose nothing about target existence (uniform localized deny, REQ-035).
  - [x] 3.3.SEC **Security & Tenancy Audit**: BOLA — inspect generated SDL: NO args on the field; BFLA — authScopes exactly `{ role: [UserRole.Teacher] }`; role≠certification boundary intact (REQ-033); no write path granted; deny messages canonical localized (no oracle).
  - [x] 3.3.SR **Semantic Review**: one-line delegation resolver; ctx identity only; zero dead code; canonical types; value imports; no cross-layer imports.
  - [x] 3.3.IV **Instruction Verification**: validate against `backend/graphql/**` AGENTS.md, DEV2-002 authScope instruction files, auto-discovered instructions.
  - [x] 3.3.OC **Outcome**: write `outcome/3.3-outcome.md`.

### Task 3.4 — Schema Regeneration & Codegen Commit

- [x] 3.4 Regenerate SDL + frontend codegen artifacts in the SAME change set
  - Commands (run after 3.1–3.3 complete):
    - `bun run generate:gqlSchema` → regenerates `schema.graphql` (or project SDL path)
    - `bun codegen` → regenerates `frontend/graphql/generated/**` (includes `ApplicantStatus` codegen enum + `MyApplicantProfileQuery` types)
  - Files to verify-modify: `schema.graphql`, `frontend/graphql/generated/**` — commit in the same change set as resolver work (REQ-061).
  - _Requirements: REQ-061, REQ-004 (frontend consumes codegen types only)_
  - [x] 3.4.QL **Quality Loop**: run sub-loop on each newly authored source file (generated files excluded per health-tool conventions — VERIFY exclusion in outcome).
  - [x] 3.4.TE **Test Engineering**: SDL diff contains EXACTLY the plan §3.1 additions and nothing else (diff review); `ApplicantStatus` enum present once; `myApplicantProfile` on `Query` nullable with zero args.
  - [x] 3.4.SEC **Security & Tenancy Audit**: SDL grep — `myApplicantProfile` accepts zero arguments (BOLA no-surface proof artifact, cited in REQ-075 suite).
  - [x] 3.4.SR **Semantic Review**: no stale codegen artifacts; generated files not hand-edited.
  - [x] 3.4.IV **Instruction Verification**: codegen workflow per `backend/graphql/AGENTS.md` / frontend graphql conventions followed.
  - [x] 3.4.OC **Outcome**: write `outcome/3.4-outcome.md` including the SDL diff summary.

---

## Phase 4: Frontend GraphQL Documents, Stores & UI Views

### Task 4.1 — myApplicantProfile Frontend GraphQL Document

- [x] 4.1 Implement `myApplicantProfileQueryDocument` in the teachers shared-documents domain
  - Files to create/modify:
    - CREATE `frontend/graphql/sharedDocuments/teachers/applicant.documents.ts` — `myApplicantProfileQueryDocument` via `gql` from `@apollo/client` typed as `TypedDocumentNode<MyApplicantProfileQuery>` (no variables); selection set: `myApplicantProfile { id status verificationAttempts lastAttemptAt cooldownUntil cooldownActive canPurchaseVerification }` — `id` INCLUDED (Apollo normalization, REQ-060/062).
    - MODIFY `frontend/graphql/sharedDocuments/teachers/index.ts` (barrel registration per conventions verified in 0.2).
    - Run `bun codegen` if document-side codegen artifacts update (`frontend/graphql/generated/**`).
  - Applicable AGENTS.md: `frontend/graphql/**` AGENTS.md (as discovered), `frontend/AGENTS.md`
  - _Requirements: REQ-062, REQ-061_
  - [x] 4.1.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts frontend/graphql/sharedDocuments/teachers/applicant.documents.ts --lifecycle duplicates` (exit code 0), plus barrel.
  - [x] 4.1.TE **Unit/Document Tests**: document parses (graphql-tag validation); selection set snapshot includes `id`; TypedDocumentNode type compiles against `MyApplicantProfileQuery` (tsgo gate).
  - [x] 4.1.SEC **Security & Tenancy Audit**: document requests NO fields beyond the seven public profile fields (BOPLA read-side hygiene); no variables means no injection surface at all.
  - [x] 4.1.SR **Semantic Review**: naming convention (`...QueryDocument` suffix) followed; imports from `@apollo/client` / hooks from `@apollo/client/react` discipline preserved for consumers; zero duplicates; no hardcoded strings in documents.
  - [x] 4.1.IV **Instruction Verification**: validate against discovered frontend-graphql AGENTS.md/instructions.
  - [x] 4.1.OC **Outcome**: write `outcome/4.1-outcome.md`.

### Task 4.2 — ApplicantStatusCard UI Component (all five render branches)

- [x] 4.2 Implement the `ApplicantStatusCard` client component with full status-branch rendering
  - Files to create:
    - CREATE `frontend/views/teachers/dashboard/` (or the established teacher-dashboard view location per 0.2 conventions) `ApplicantStatusCard.tsx` — CLIENT component:
      - `useAppTranslation(Translation.<Applicant | established namespace>)` with ENUM namespace + property access (`t.someLabel`) — NEVER string-literal namespaces, NEVER `t('key')` (REQ-003).
      - `useQuery(myApplicantProfileQueryDocument)` from `@apollo/client/react` — `useQuery` ONLY, `useLazyQuery` PROHIBITED (REQ-062).
      - Branches (REQ-018, plan §5.5 visual state matrix):
        1. Loading → MUI `Skeleton` card (title + badge line + CTA placeholder).
        2. Permission-denied class errors (UNAUTHORIZED/FORBIDDEN) → existing `PermissionDeniedFallback` pattern — never bare null on page-level deny.
        3. `data.myApplicantProfile === null` (certified) → CertifiedSummary branch ("You are certified" style copy — translated; NOT applicant copy).
        4. `Pending` → status chip + awaiting-purchase prompt (purchase CTA routes are DEV2-005 scope — render affordance as out-of-scope informational if no route exists; document).
        5. `InEvaluation` → chip + attempt counter + progress hint.
        6. `Failed` + `cooldownActive` → warning chip + ICU-formatted locale-aware cooldown expiry date + DISABLED re-apply CTA with explanatory copy.
        7. `Failed` + `canPurchaseVerification` → info/success affordance + ENABLED re-apply CTA (dev2-005 target route; if route undefined in this sprint, CTA is present but routes to the documented placeholder per plan consumers note — record decision in outcome).
        8. Corrupt/unknown status (defensive, though server fails closed) → generic inline alert per DEV3-002 mapping contract — never crash.
      - MUI v9 rules STRICTLY: all styling via `sx={{ ... }}` ONLY — NO direct style props (`fontWeight`, `mb`, `mt`, `p`, `textAlign`, `display`, …) on Typography/Box/Stack/Grid; colors EXCLUSIVELY via `theme.palette.*` (no hex/rgb literals); icons `*Outlined` ONLY (e.g., `ErrorOutline` FORBIDDEN → `ErrorOutlined`); `React.SubmitEvent`/`React.SyntheticEvent<HTMLFormElement>` for any form (none expected here); `<Box component="alert">`/`aria-busy` patterns per `frontend/AGENTS.md`.
      - RTL discipline: logical properties (`marginInlineStart/End`, `text-align: start`); locale-aware date formatting via existing project i18n date util (VERIFY util location in 0.2; do NOT introduce raw `toLocaleDateString` bypasses).
  - Applicable AGENTS.md: `frontend/AGENTS.md`, `frontend/views/AGENTS.md`, `frontend/components/ui/AGENTS.md`, plus discovered instruction files (`frontend.instructions.md`, `mobile-desktop.instructions.md`)
  - _Requirements: REQ-003, REQ-018, REQ-062, REQ-063_
  - [x] 4.2.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts <component path> --lifecycle duplicates` (exit code 0).
  - [x] 4.2.TE **Unit / Component Tests** — Happy DOM + Apollo `MockedProvider` (`test/ui/components/teachers/ApplicantStatusCard.test.tsx`): translation-preload via `translation-preload.ts` + `readTranslation(handle, locale)` + `TestWrapper locale`; assert rendered output against PRELOADED translated labels — ZERO hardcoded Arabic/English strings in assertions (REQ-074); one render case per branch (loading, error-denied, null-certified, pending, in_evaluation, failed-active-cooldown with mocked future expiry, failed-eligible); `useLazyQuery` absence statically verified; form-submit tests N/A but React.SubmitEvent discipline asserted if any button handlers evolve (n/a noted in outcome).
  - [x] 4.2.BF **Agent-Browser Functional Self-Loop**:
    - Launch dev server / connect via agent-browser (Playwright) with a seeded test applicant session (use existing auth test-login harness; roles: applicant-pending, applicant-in_evaluation, applicant-failed-active, applicant-failed-expired, certified-teacher).
    - Navigate to `/teacher/dashboard` per role; execute end-to-end interactive workflows: card appearance per role, disabled-vs-enabled CTA click behavior, certified-branch rendering, loading skeleton flash, error-fallback rendering under a forced FORBIDDEN response.
    - Assert network requests: exactly one `myApplicantProfile` operation with NO variables; GraphQL payload/response shapes match codegen; no unexpected refetch loops.
    - Iterative self-loop: if any interaction, branch, or request assertion fails, patch code and re-test until clean.
  - [x] 4.2.BS **Agent-Browser Visual & Styling Self-Loop (Screenshot Analysis)**:
    - Capture high-resolution screenshots across Viewports (Desktop 1440x900, Tablet 768x1024, Mobile 375x812) × Locales (English LTR, Arabic RTL) × every reachable branch (pending / in_evaluation / failed-active / failed-eligible / certified-null / loading / denied).
    - Visually inspect and analyze screenshots for: MUI v9 theme palette compliance (no hardcoded hex/rgb — verify computed styles), typography hierarchy, padding/margin rhythm, text truncation/overflows (Arabic long-copy case), RTL mirroring alignment (chips, CTAs, date line), CTA ≥44px hit area on mobile, dark/light contrast where theme supports it.
    - Iterative self-loop: inspect screenshot → identify UI defect → patch MUI `sx` tokens → re-capture screenshot → repeat until visually polished.
  - [x] 4.2.SR **Semantic Review**: zero direct style props (sx only); zero hardcoded strings/colors; `useAppTranslation` enum + property access; `*Outlined` icons only; no dead branches; authenticated-context assumptions honored (card is UI affordance only — server guards remain the boundary); `Translation` enum value import.
  - [x] 4.2.IV **Instruction Verification**: validate against `frontend.instructions.md`, `mobile-desktop.instructions.md`, `frontend/AGENTS.md`, `frontend/views/AGENTS.md`, `frontend/components/ui/AGENTS.md`.
  - [x] 4.2.OC **Outcome**: write `outcome/4.2-outcome.md` including branch-coverage matrix and screenshot-evidence references.

### Task 4.3 — Teacher Dashboard Integration

- [x] 4.3 Mount `ApplicantStatusCard` inside the existing teacher dashboard surface
  - Files to modify:
    - MODIFY the existing teacher dashboard container/view (path identified in 0.2 — e.g., `frontend/views/teachers/dashboard/<container>.tsx` and/or `app/(dashboard)/teacher/dashboard/page.tsx`) — insert `<ApplicantStatusCard />` above the fold inside the existing role-gated region; EXISTING page-level guards (`withPageAuth({ roles: [UserRole.Teacher] })` / layout guard from DEV2-001/002) MUST remain the only server-side boundary — NO new guard logic, NO route changes.
  - Applicable AGENTS.md: `app/AGENTS.md` (if present), `frontend/AGENTS.md`, `frontend/views/AGENTS.md`
  - _Requirements: REQ-062, REQ-063 (per-audience: student/parent/admin/supervisor never reach it; certified sheikh sees certified branch)_
  - [x] 4.3.QL **Quality Loop**: sub-loop on every modified dashboard file (exit code 0).
  - [x] 4.3.TE **Unit / Component Tests**: Happy DOM mount test — card renders within the dashboard composition under applicant mock; certified mock renders certified branch; RoleMismatch (covered by page guard) documented as unreachable (server guard evidence from DEV2-001/002 referenced, not re-implemented).
  - [x] 4.3.BF **Agent-Browser Functional Self-Loop**:
    - Launch dev server / connect via Playwright as applicant + certified teacher; load `/teacher/dashboard`; assert card position/composition, network call ordering (no duplicate `myApplicantProfile` calls), tab/scroll interactions stable.
    - Role-negative sweep: log in as student/parent/admin and request `/teacher/dashboard` directly — assert the EXISTING guard denies (observe canonical deny UX; if guard misbehaves, that is a DEFECT in DEV2-001/002 surface ⇒ `deferred-items.md` ❌ + block, DO NOT patch here).
    - Iterative self-loop until clean.
  - [x] 4.3.BS **Agent-Browser Visual & Styling Self-Loop (Screenshot Analysis)**:
    - Screenshot the FULL dashboard page (not just the card) at Desktop 1440x900 / Tablet 768px / Mobile 375px × en-LTR / ar-RTL; verify card grid behavior (desktop multi-column → tablet 2-col → mobile single full-bleed per plan §5.2/§5.5), no layout regressions to pre-existing dashboard elements, spacing rhythm consistency.
    - Iterative self-loop: inspect → patch `sx` tokens → re-capture → repeat until polished.
  - [x] 4.3.SR **Semantic Review**: no duplicated guard logic; no props drilling that assumes applicant state client-side (server answers drive everything via Apollo); zero style props; imports per barrel conventions.
  - [x] 4.3.IV **Instruction Verification**: `frontend.instructions.md`, `mobile-desktop.instructions.md`, view-layer AGENTS.md.
  - [x] 4.3.OC **Outcome**: write `outcome/4.3-outcome.md`.

---

## Phase 5: Integration & Differential Testing

### Task 5.1 — Registration Contract Lock Tests (REQ-010 / REQ-011)

- [x] 5.1 Permanently lock the DEV1-002 registration → applicants contract
  - Files to modify/create:
    - MODIFY the existing registration logic test module identified in 0.2 (e.g., `backend/db/test/logic/auth/<registration test file>.test.ts`) — ADD the contract-lock cases (do NOT rewrite existing DEV1-002 tests):
      1. Teacher registration via the production `registerUser` path ⇒ EXACTLY one `users` row + EXACTLY one `applicants` row (shared PK assertion) + `teacher` table rowcount delta = 0 (REQ-010, B.7).
      2. Exact defaults: `status = 'pending'`, `verification_attempts = 0`, `last_attempt_at IS NULL`, `cooldown_until IS NULL`, timestamps set (REQ-011, B.6).
      3. Forced child-insert failure (inject failure at the applicants insert inside the nested transaction) ⇒ ZERO residual `users` AND `applicants` rows (SAVEPOINT-aware rollback proof, REQ-040).
      4. Duplicate-email concurrent registration race via `Promise.allSettled` inside `runInRollback` ⇒ exactly one success, one `ConflictError` (23505 inheritance, REQ-040 / idempotency).
    - CREATE `backend/db/test/logic/teachers/applicant-lifecycle.test.ts` was already established in 2.1 — ensure no duplication between the two modules (registration cases live in the auth module; lifecycle cases live in the teachers module).
  - Test discipline: ALL inside `runInRollback`; `tx` to EVERY call (verify param positions); `entity-setup.ts` helpers ONLY (no seed data); `expectRepoError` try/catch helper ONLY — `.rejects.toThrow()` PROHIBITED; randomized emails.
  - Runner: `bun run test/scripts/run-test.ts <test-path>`
  - _Requirements: REQ-010, REQ-011, REQ-040, REQ-070, REQ-071_
  - [x] 5.1.QL **Quality Loop**: sub-loop on modified test file (exit code 0).
  - [x] 5.1.SEC **Security & Tenancy Audit**: forced-failure test proves no orphaned identity surfaces (no half-registered accounts reachable by auth).
  - [x] 5.1.SR **Semantic Review**: tests lock behavior WITHOUT modifying `RegistrationService`/`auth.mutation.ts` (verify `git diff` shows zero changes to those files — cite in outcome).
  - [x] 5.1.IV **Instruction Verification**: DB-test-layer AGENTS.md + `docs/IDEMPOTENCY.md` replay-safety contract.
  - [x] 5.1.OC **Outcome**: write `outcome/5.1-outcome.md`.

### Task 5.2 — Lifecycle Guard & Attempt-Counter Contract Tests Consolidation (REQ-072)

- [x] 5.2 Consolidate and certify the REQ-072 matrix (authored in 2.1/2.2 — run as a dedicated certified pass)
  - Files: `backend/db/test/logic/teachers/applicant-lifecycle.test.ts`, `backend/services/teachers/applicant-lifecycle.service.test.ts`
  - Certified matrix (each asserted with `expectRepoError` + translated-message SUBSTRING assertions, never raw keys):
    - `cooldownUntil IS NULL` ⇒ allowed (no-op).
    - Future cooldown ⇒ `APPLICANT_COOLDOWN_ACTIVE` + localized message includes formatted expiry.
    - Exactly `now` ⇒ ALLOWED (strict `>` boundary).
    - Past cooldown ⇒ allowed.
    - Missing applicant row ⇒ `APPLICANT_NOT_FOUND`.
    - Sequential `recordVerificationAttempt` ×2 ⇒ attempts 0→1→2; `last_attempt_at` monotonic.
    - Concurrent `Promise.allSettled` ×2 ⇒ final attempts = 2, no lost update (REQ-042).
    - Coverage: `bun test --coverage` ⇒ 100% statement/branch on NEW repo + service logic (REQ-070).
  - _Requirements: REQ-014, REQ-015, REQ-042, REQ-043, REQ-070, REQ-072_
  - [x] 5.2.QL **Quality Loop**: sub-loop on both test files (exit code 0).
  - [x] 5.2.SEC **Security & Tenancy Audit**: tests prove boundary exclusivity (no caller can expand attempts for another user through any arg surface).
  - [x] 5.2.SR **Semantic Review**: no test uses `.rejects.toThrow()`; no raw key assertions; no seed-data reliance.
  - [x] 5.2.IV **Instruction Verification**: repo/service test-layer AGENTS discipline.
  - [x] 5.2.OC **Outcome**: write `outcome/5.2-outcome.md` with coverage numbers.

### Task 5.3 — GraphQL Integration Matrix Certification (REQ-073)

- [x] 5.3 Run the full `myApplicantProfile` authorization & shape matrix via test server lifecycle
  - Files: the integration test authored in 3.3.TE (e.g., `frontend/graphql/test/teachers/applicant-profile.test.ts` or established location) — run and certify:
    - Anonymous ⇒ `UNAUTHORIZED` (extensions.code per `docs/graphql/domain-error-extensions-code.md`).
    - student / parent / admin / supervisor ⇒ `FORBIDDEN` each (REQ-031 matrix; C.1 parent probe).
    - Applicant ⇒ full seven-field shape incl. `id`; `cooldownActive`/`canPurchaseVerification` server-computed values correct for engineered fixtures (pending / failed-active / failed-expired).
    - Certified teacher ⇒ `null` top level, NO error (D5).
    - Uniform deny ⇒ no existence disclosure (REQ-035 oracle check).
  - Runner: `bun run test/scripts/run-test.ts <test-path>` (or established graphql test script per 0.2).
  - _Requirements: REQ-030, REQ-031, REQ-035, REQ-060, REQ-073_
  - [x] 5.3.QL **Quality Loop**: sub-loop on test file (exit code 0).
  - [x] 5.3.SEC **Security & Tenancy Audit**: `CombinedGraphQLErrors`-class assertions verify error codes — no stack/PII leakage in errors.
  - [x] 5.3.SR **Semantic Review**: matrix table in outcome maps every row to its REQ.
  - [x] 5.3.IV **Instruction Verification**: graphql test-layer conventions + DEV2-002 contract doc.
  - [x] 5.3.OC **Outcome**: write `outcome/5.3-outcome.md`.

### Task 5.4 — Security Tier Probes & Fuzz Lock (REQ-075)

- [x] 5.4 Author and run the monkey/fuzz-tier security probes for the applicant surface
  - Cases (spread across the enum test, service test, and integration suite as established):
    - Role escalation: crafted payloads cannot induce elevation (no write surface exists; verified by SDL zero-args grep + integration attempt with extra/unknown fields rejected by schema).
    - `isApplicantStatus` fails closed on `%`, `_`, `\`, `'`, unicode/RTL, overlong, numeric-coercible, prototype-polluted inputs (extends Task 1.1 fuzz into the service boundary path).
    - No operation accepts a foreign `userId` (REQ-030 no-parameter-surface proof — cite SDL diff from 3.4).
    - Cooldown guard cannot be bypassed by replay: sequential guard-then-record flows remain consistent under `runInRollback`-replay simulation.
  - _Requirements: REQ-012, REQ-030, REQ-031, REQ-033, REQ-035, REQ-075_
  - [x] 5.4.QL **Quality Loop**: sub-loop on touched test files (exit code 0).
  - [x] 5.4.SEC **Security & Tenancy Audit**: every probe maps to a threat row in plan §6 table; findings ⇒ immediate repair or ❌ deferred entry (blocking).
  - [x] 5.4.SR **Semantic Review**: probes are deterministic in CI (seeded randomness where applicable).
  - [x] 5.4.IV **Instruction Verification**: security-test conventions per discovered instructions.
  - [x] 5.4.OC **Outcome**: write `outcome/5.4-outcome.md`.

### Task 5.5 — Differential & Baseline Gate (REQ-076)

- [x] 5.5 Produce the deviation-from-baseline report and deferred-items zero-gate
  - Commands & artifacts:
    - `bun tsgo`, `bun biome:check`, `bun run scripts/lint-service.ts --json --id final` → diff counts vs 0.1 baseline (target: ZERO new issues attributable to this ticket; pre-existing exempt files from 0.1 remain exempt).
    - Full suite runs: `bun run test:db`, service tests, `bun run test:graphql`, `bun run test:ui:components` (as applicable per 0.2 script inventory) — ALL GREEN.
    - `git diff -- backend/db/schema/** backend/db/migration/**` EMPTY (final re-proof, REQ-045).
    - `grep -c "❌\|⚠️" deferred-items.md` MUST equal 0 — forward items for DEV2-005 (purchase wiring consuming `assertCanPurchaseVerification` + `recordReapplication`) MUST be expressed as RESOLVED reference entries targeted at DEV2-005, not open debt.
    - Files deliberately NOT changed (list verbatim): `RegistrationService`, `auth.mutation.ts`, `RegisterPublicRole` enum path, all `backend/db/schema/**`, DEV2-001/002 auth files.
  - _Requirements: REQ-001, REQ-045, REQ-076_
  - [x] 5.5.SR **Semantic Review**: any nonzero Δ is either fixed or is a filed deferred entry with an owning ticket; no silent red.
  - [x] 5.5.OC **Outcome**: write `outcome/5.5-outcome.md` with the full differential table.

---

## Phase 6: Post-Implementation Review Waves (Parallel)

> Phase 6 begins ONLY after Phase 5.5 is complete. Waves are dispatched in PARALLEL review lanes; findings become repair subtasks in the same wave. Every repair re-runs the touched test suites and updates the affected outcome files (outcome-update protocol §7 of Non-Negotiables).

### Task 6.0 — Phase 5 Completion Gate

- [x] 6.0 Confirm Phase 5 exit criteria before dispatching review waves
  - All 5.x outcomes exist; all suites green; zero ❌/⚠️ in ledger at gate time.
  - [x] 6.0.OC **Outcome**: write `outcome/6.0-outcome.md` (gate checklist).

### Task 6.1 — Review Wave: review-types

- [x] 6.1 Dispatch `review-types` lane across ALL created/modified files in this ticket
  - Review scope: `ApplicantStatus` enum + guard, `ApplicantProfileReturnType`, Pothos object/enum registrations, codegen artifacts consumed, resolver signature types, test helper types.
  - Checks: canonical location discipline (REQ-004); no local types in resolvers/services/repos; no service-layer `.types.ts`; value-vs-type import correctness; readonly output shapes.
  - Repairs: fix in place → rerun affected suites + sub-loops → update affected outcomes.
  - [x] 6.1.OC **Outcome**: write `outcome/6.1-outcome.md` (findings, repair paths, suites re-run, residual risk).

### Task 6.2 — Review Wave: review-backend

- [x] 6.2 Dispatch `review-backend` lane
  - Review scope: repository methods (atomicity, tx discipline, prepared-statement exclusion on writes, no inline `--` comments), service (captured-now, DomainError discipline, logDomainError scoping, no silent paths), resolver (authScopes correctness, zero-arg contract, delegation purity), all backend tests (runInRollback/tx/expectRepoError discipline).
  - [x] 6.2.OC **Outcome**: write `outcome/6.2-outcome.md`.

### Task 6.3 — Review Wave: review-frontend

- [x] 6.3 Dispatch `review-frontend` lane
  - Review scope: `ApplicantStatusCard` + dashboard integration + document file. Checks: sx-only discipline (no direct style props), `theme.palette.*` only, `*Outlined` icons, `React.SubmitEvent` discipline, `useQuery`-only, `useAppTranslation` enum + property access, RTL logical properties, Apollo `id` in selection, i18n parity consumed correctly, no `useLazyQuery`, no hardcoded strings.
  - [x] 6.3.OC **Outcome**: write `outcome/6.3-outcome.md`.

### Task 6.4 — Review Wave: pentester

- [x] 6.4 Dispatch `pentester` lane against plan §6 threat table
  - Scope probes: BOLA (no-parameter-surface re-verification against shipped SDL + crafted request attempts), BOPLA (grep diff for any `...input` spread — must be zero in this ticket; verify recordVerificationAttempt accepts no client shape), BFLA (authScopes matrix replay incl. supervisor + parent), error-oracle uniformity (REQ-035 timing/message parity sampling), tenant-integrity (applicant row isolation across users in concurrent test), governance non-interference (no users.suspended write anywhere in diff — static grep proof for REQ-016).
  - [x] 6.4.OC **Outcome**: write `outcome/6.4-outcome.md` (threat-table verdict per row).

### Task 6.5 — Deferred-Items Check & Wave Closure

- [x] 6.5 Reconcile all wave findings and close the ledger
  - Any wave finding not resolved in-wave ⇒ classify: repair now, or RESOLVED-reference entry targeting the owning ticket (DEV2-005 forward wiring entries must read as contracts-ready notes, not debt).
  - Final: `grep -c "❌\|⚠️" deferred-items.md` = 0; all outcome files updated with repair evidence.
  - _Requirements: REQ-076_
  - [x] 6.5.OC **Outcome**: write `outcome/6.5-outcome.md`.

---

## Phase 7: Knowledge Propagation & Documentation

### Task 7.1 — Canonical Doc: Applicant Lifecycle Reference

- [x] 7.1 Author `docs/teachers/applicant-lifecycle.md` (introduce `docs/teachers/` subdir per domain-mapping conventions)
  - Files to create:
    - CREATE `docs/teachers/applicant-lifecycle.md` containing:
      1. **Applicant state machine** (REQ-013): `pending → in_evaluation` (DEV2-005 purchase), `in_evaluation → passed | failed` (DEV2-007 aggregation), `failed → in_evaluation` (re-purchase after full cooldown via this ticket's guard), `passed → teacher row exists` (DEV2-007 write); transition table binding on Sprint-1 DEV2-005..DEV2-010 chain.
      2. **Cooldown & attempt contracts** (REQ-014/015/016): authoritative read source `applicants.cooldown_until` ONLY; `cooldownActive ⇔ cooldown_until IS NOT NULL AND cooldown_until > now()` (strict `>`); atomic single-statement increment contract; the two-source split — login/session gating reads `users.suspended` (DEV2-001/002 domain, INV-U2); re-purchase gating reads `applicants.cooldown_until` (INV-TV3); duration-setting (30d Tajweed / 90d Hifz, INV-TV4) is a DEV2-008 WRITE-time concern — DEV2-004's guard is deliberately duration-agnostic (record so DEV2-008 does not re-litigate); INV-TV6 note (failed applicant keeps student privileges post DEV2-009 conversion; applicants row untouched).
      3. **Query contract & precedence** (REQ-017/D5): zero-args `myApplicantProfile`, role-gated, `null` = certified / no active applicant file (single non-oracular answer); governed accounts never reach the resolver (DEV2-002 fail-closed context).
      4. **Advisory-isolation note** (REQ-043): guard is advisory-at-its-isolation-level; racing purchase writes are DEV2-005's transactional responsibility.
      5. **"Registration already ships in DEV1-002" grounding note** — REQ-002/010: the write path was verified & test-locked, never rebuilt; cite the REQ-071 lock suite.
      6. **Consumer guidance table** for DEV2-005 (call `assertCanPurchaseVerification` before purchase; call `recordReapplication` on successful re-purchase — both accept optional `tx` and MUST receive the purchase transaction's tx), DEV2-006/007 (status transition write-offs), DEV2-008 (cooldown writer contract), DEV2-009 (failed→student conversion co-existence), DEV2-010 (override surface reads AUDIT_LOGS), DEV3-019 (direct onboarding boundary).
      7. **Invariant anchoring** (REQ-081): explicit bindings to INV-TV1..TV7 (with the per-invariant service note from specs §3), B.6/B.7, Workflow 01 stage mapping; change/addendum section (empty unless a gap was discovered — none expected; state explicitly if so).
  - Applicable AGENTS.md: root `AGENTS.md` (doc conventions), `docs/` conventions
  - _Requirements: REQ-013, REQ-080, REQ-081_
  - [x] 7.1.SR **Semantic Review**: doc is canonical (no code beyond illustrative snippets marked non-authoritative); every claim traceable to a REQ; no contradiction with `docs/specs/state-machine-invariants.md` (NO edits to the invariant file's numbering are permitted — verify diff empty there).
  - [x] 7.1.OC **Outcome**: write `outcome/7.1-outcome.md`.

### Task 7.2 — Backward Cross-Link & AGENTS.md Propagation

- [x] 7.2 Propagate references across the knowledge graph
  - Files to modify (one-line rule/reference entries ONLY — no code, no implementation detail, REQ-082):
    - MODIFY `docs/auth/user-registration.md` — add a one-line link in its Applicant/lifecycle section pointing to `docs/teachers/applicant-lifecycle.md` (REQ-081).
    - MODIFY `backend/services/AGENTS.md` — one-line rule: applicant lifecycle logic lives in `ApplicantLifecycleService` (cooldown/attempt contracts); reference `docs/teachers/applicant-lifecycle.md`.
    - MODIFY `backend/enum/AGENTS.md` — add the `ApplicantStatus` enum entry IF the file's listing conventions require per-enum entries (verify convention first; otherwise note skip rationale in outcome).
    - MODIFY root `AGENTS.md` Important References — one line for the new canonical doc.
  - _Requirements: REQ-081, REQ-082_
  - [x] 7.2.QL **Quality Loop**: sub-loop on each modified AGENTS/doc file where the health tool applies (exit code 0 or documented non-applicability).
  - [x] 7.2.SR **Semantic Review**: entries are rules/references only; no duplicated content; links resolve.
  - [x] 7.2.IV **Instruction Verification**: validate against each layer's AGENTS.md editing conventions.
  - [x] 7.2.OC **Outcome**: write `outcome/7.2-outcome.md`.

### Task 7.3 — Phase 7 Outcome Synthesis & Final Ticket Gate

- [x] 7.3 Synthesize the complete ticket outcome package
  - Files to create:
    - `outcome/final-synthesis-outcome.md` containing: full task-checkbox ledger (every `[x]` evidenced by command output), final baseline-vs-final differential (tsgo/biome/lint — REQ-076), test inventory with run commands + results (5.x suites, coverage numbers), schema-drift empty-diff proof, SDL/codegen delta summary, security matrix verdicts (pentester waiver references), deferred-items final state (count of ❌/⚠️ = 0; list of resolved forward-reference entries for DEV2-005), files-deliberately-NOT-changed list, cross-references to all phase outcomes, and the M1-gate contribution statement (applicant can register, see lifecycle position, consume cooldown/eligibility contract).
  - [x] 7.3.SR **Semantic Review**: synthesis contains NO unsupported claims — every assertion cites a file path or command output in an outcome file.
  - [x] 7.3.OC **Outcome**: the synthesis file IS the outcome artifact.

---

## Master Acceptance Traceability (final verification before ticket close)

| Acceptance Criterion (ticket) | Locked by |
|---|---|
| Teacher registration → `applicants` row, status `'pending'`, attempts 0, `cooldown_until` null, NO `teacher` record | Task 5.1 (REQ-010/011 lock suite) |
| Applicant views profile → sees applicant status, not teacher status | Tasks 3.3, 4.2, 5.3 (REQ-017/018/063; certified→null precedence) |
| Failed applicant: `cooldown_until` set; after expiry re-purchase permitted; attempts incremented; `last_attempt_at` updated | Tasks 2.1, 2.2, 5.2 (REQ-014/015/042/072 boundary+concurrency matrix); duration-agnostic guard contract documented for DEV2-008 writer (Task 7.1) |

**Final gates (ALL must be green):** zero new tsgo/biome/lint vs baseline · empty schema diff · all test suites green · 100% stmt/branch on new logic · `grep -c "❌\|⚠️" deferred-items.md` = 0 · `docs/teachers/applicant-lifecycle.md` exists · cross-links in `docs/auth/user-registration.md`, `backend/services/AGENTS.md`, root `AGENTS.md`.
