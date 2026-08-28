# Trackable Implementation Tasks: DEV1-004 — Free Trial Session Provisioning

**Ticket**: DEV1-004 | **Stream**: Dev 1 | **Sprint**: 0 | **Points**: 3 | **Blocked By**: DEV1-002 ✅
**Spec**: `specs.md` (approved) | **Plan**: `plan.md` (approved) | **Plan Dir**: `ai/plans/dev1-004-free-trial-session-provisioning/`
**Nature of Slice**: **Backend-only vertical slice** — schema delta + shared constant + i18n key + repository method + domain service + registration hook. **Zero GraphQL surface, zero frontend views.** Phase 4 executes as contract-verification only (REQ-060/REQ-063); no Agent-Browser loops apply because no UI ships.

---

## Non-Negotiable Execution Protocol (MANDATORY — applies to EVERY task)

1. **Pre-Execution Knowledge Read**: Before touching any file for task `X.Y`, read its outcome anchor: all existing `outcome/*-outcome.md` files for prerequisite tasks in this plan, plus `ai/plans/dev1-002-*/outcome/` and `ai/plans/dev1-003-*/outcome/` (the upstream registration/auth outcomes this slice extends). Also re-read the source spec sections listed under the task's `_Requirements:` line.
2. **Post-Edit Verification**: After ANY file edit, run the duplicate/lint sub-loop:
   `bun run scripts/health/sub-loop.ts <file-path> --lifecycle duplicates`
   Exit code **0** is required before the checkbox may advance to `[x]`.
3. **Test Execution**: Any test file created/modified MUST be run via:
   `bun run test/scripts/run-test.ts <test-path>`
   (For coverage assertions: `bun test --coverage <suite-path>` per REQ-070.)
4. **Semantic Review Self-Check**: Before marking any `_X.Y.SR_` line done, re-read the edited file and validate: atomicity with surrounding tx, no env-var/config misuse, zero dead code, no cross-layer imports (`shared/` never imports `@/backend|@/frontend|@/app`), enums via value imports, no `console.*`, no hardcoded user-facing strings.
5. **Outcome Documentation**: On completion of every top-level task `X.Y`, write `ai/plans/dev1-004-free-trial-session-provisioning/outcome/<task-id>-outcome.md` containing: files touched, sub-loop results, test results, deviations, and any newly discovered deferred items (appended to `deferred-items.md`).
6. **Checkbox Tracking**: Advance `[ ]` → `[x]` ONLY after the corresponding artifact exists on disk and evidence is recorded in the outcome file. Never batch-skip checkboxes.

---

# Phase 0 — Pre-Implementation Baseline

- [x] **0.1 Record Error Baseline & Initialize Deferred-Items Ledger**
  - Run baseline suite and capture counts into `ai/plans/dev1-004-free-trial-session-provisioning/outcome/0.1-baseline-outcome.md`:
    - `bun tsgo` → record error count
    - `bun biome:check` → record diagnostic count
    - `bun run lint-service` (JSON mode) → record per-rule counts
  - Create `ai/plans/dev1-004-free-trial-session-provisioning/deferred-items.md` from the spec-implementation template and **pre-seed exactly two entries**:
    - **D1**: Trial-grant notification dispatch → target ticket DEV3-010 (notifications engine exists per A.4; dispatch deferred). Status: non-blocking, explicitly deferred per REQ-083.
    - **D2**: Trial eligibility + trial-first decrement *execution* → target tickets DEV3-004 / DEV3-013. Only the forward CONTRACT (REQ-020..022) ships here. Status: non-blocking.
  - Record `git rev-parse HEAD` and `git diff --name-only` baseline snapshot in the outcome file (used by REQ-076 deviation accounting).
  - _Requirements: REQ-001, REQ-076, REQ-083_

- [x] **0.2 Prerequisite & Blocker Verification (DEV1-002 Dependency Gate)**
  - Verify DEV1-002/DEV1-003 artifacts exist and are current:
    - `backend/services/auth/registration.service.ts` — `registerUser` + `createRoleChild` + `withTransaction(outerTx)` SAVEPOINT pattern
    - `backend/db/repo/students/student.repository.ts` — `createForRegistration` + handshake retry loop
    - `backend/types/students/student.types.ts` — `StudentSelectType`/`StudentInsertType` via `$inferSelect`/`$inferInsert`
    - `backend/lib/errors` — `ConflictError` / `DomainError` with `extensions.code`
    - `backend/lib/logger` — `logger.logDomainError` signature (domain context object)
    - `shared/locale/server-graphql` — `getServerTranslations(locale, "errors")`
  - Read the governing instruction files and quote their key rules into the outcome file:
    - `backend/AGENTS.md`, `backend/db/repo/AGENTS.md` (tx-optional-last, repo purity), `backend/db/test/AGENTS.md` (rules: `runInRollback`, `expectRepoError`, no `.rejects` inside `runInRollback`, no seed-data queries, localized-substring assertions), `backend/services/AGENTS.md`, `shared/AGENTS.md`, `shared/locale/AGENTS.md`, `backend/db/seeds/AGENTS.md` (service-bootstrap rule), `docs/drizzle/prepared-statements.md`, `docs/IDEMPOTENCY.md`, `docs/specs/state-machine-invariants.md` §4 (INV-B1..B5), `docs/specs/open-decisions-and-gaps.md` (FR-2.6, B.4, B.6, B.7), `docs/workflows/03-session-lifecycle.md` (Tas-heeh first-session context)
  - Sanity evidence anchor: `bun tsgo && bun biome:check` green at baseline.
  - Write `outcome/0.2-prerequisites-outcome.md`.
  - _Requirements: REQ-001, REQ-003, REQ-040, REQ-071_

---

# Phase 1 — Types, Enums & Database Schema

- [x] **1.1 Add Trial Columns & CHECK Constraint to `students` Table (REQ-010, REQ-035)**
  - Files to modify:
    - `backend/db/schema/students/students.ts`
  - Changes:
    - Inside `pgTable("students", { ... })` add:
      ```ts
      balanceTrial: integer("balance_trial").notNull().default(0),
      trialGrantedAt: timestamp("trial_granted_at"),
      ```
    - In the table `check(...)` array add:
      ```ts
      check("students_balance_trial_check", sql`${t.balanceTrial} >= 0`),
      ```
  - Notes: new column is `NOT NULL` (stricter inference than existing balance lanes): `StudentSelectType.balanceTrial: number`, `StudentInsertType.balanceTrial?: number`. No inline `--` comments inside any `sql`` template`. No new indexes (single-row PK lookups only).
  - Applicable instruction files: `backend/db/schema/AGENTS.md`, `docs/DATABASE_MIGRATIONS.md`
  - _Requirements: REQ-010, REQ-035, REQ-003_
  - [x] 1.1.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts backend/db/schema/students/students.ts --lifecycle duplicates` (exit code 0)
  - [x] 1.1.TE **Test Engineering**: Type-flow smoke test — `bun tsgo` confirms `StudentSelectType`/`StudentInsertType` now carry `balanceTrial`/`trialGrantedAt` with zero consumer breakage; `bun test` on existing students repo suite remains green.
  - [x] 1.1.SEC **Security & Tenancy Audit**: Confirm CHECK constraint is declared at table level (defense-in-depth, REQ-035); confirm no client-reachable input path can name these columns (they are server-derived only — gate re-verified in 3.1.SEC); no tenant filter applicable (single-tenant schema).
  - [x] 1.1.SR **Semantic Review**: Column names match plan exactly; default `0` present; marker nullable with no default; no drift between column JS names and snake_case SQL names; zero dead code.
  - [x] 1.1.IV **Instruction Verification**: Re-read `backend/db/schema/AGENTS.md`; confirm schema discipline (no custom SQL migration file authored).
  - Outcome: `outcome/1.1-schema-columns-outcome.md`

- [x] **1.2 Apply Schema via `bun run db push` (REQ-043)**
  - Steps:
    1. `bun run db push` — capture full push output in the outcome file. **`db reset` / `db cleanGenerate` are permanently disabled; never run them.**
    2. Verify live DB: `SELECT ... FROM information_schema.check_constraints WHERE constraint_name = 'students_balance_trial_check'` present via a rollback-wrapped probe.
  - Applicable instruction files: `docs/DATABASE_MIGRATIONS.md`, `db/AGENTS.md` (if present)
  - _Requirements: REQ-010, REQ-035, REQ-043_
  - [x] 1.2.QL **Quality Loop**: n/a (push-only task, no file edits) — record in outcome.
  - [x] 1.2.TE **Test Engineering**: DB-level constraint live-check (happy path deferred to 2.1.TE): insert probe with `balance_trial = 0` succeeds; probe confirmed inside `runInRollback`.
  - [x] 1.2.SEC **Security & Tenancy Audit**: Confirm push applied to dev database only; no production/data-mutation semantics; constraint name stable for future audit queries.
  - [x] 1.2.SR **Semantic Review**: Drizzle schema and runtime code landing in the same commit set (anti-drift, REQ-043).
  - [x] 1.2.IV **Instruction Verification**: Validate against `docs/DATABASE_MIGRATIONS.md` push-only rule.
  - Outcome: `outcome/1.2-db-push-outcome.md`

- [x] **1.3 Create Shared Constant `FREE_TRIAL_SESSION_COUNT` (REQ-014)**
  - Files to create/modify:
    - `shared/constants/free-trial.constants.ts` (NEW)
    - `shared/constants/index.ts` (append barrel line)
  - Contents:
    ```ts
    /** FR-2.6: number of free trial sessions granted once to each newly registered student (REQ-014).
     * Shared-layer isolation: imports nothing from @/backend, @/frontend, or @/app. */
    export const FREE_TRIAL_SESSION_COUNT = 1;
    ```
    Barrel: append `export * from "./free-trial.constants";` (relative per barrel rules).
  - Applicable instruction files: `shared/AGENTS.md`
  - _Requirements: REQ-014, REQ-060 (shared-layer isolation)_
  - [x] 1.3.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts shared/constants/free-trial.constants.ts --lifecycle duplicates` and run once for `shared/constants/index.ts` (exit code 0 each)
  - [x] 1.3.TE **Test Engineering**: Compile check (`bun tsgo`) confirms importability from both backend and shared test contexts; value `=== 1` asserted later in 2.2.TE role-matrix suite.
  - [x] 1.3.SEC **Security & Tenancy Audit**: Constant is compile-time only — no env var, no admin-secret surface, not client-overridable (BOPLA: ignores any smuggled `trialCount`).
  - [x] 1.3.SR **Semantic Review**: No imports in the constants file (shared-layer isolation); docstring references FR-2.6/REQ-014; no magic literal duplicated elsewhere (grep `balance_trial + 1`-style literals → zero).
  - [x] 1.3.IV **Instruction Verification**: Validate against `shared/AGENTS.md` isolation + barrel ordering rules.
  - Outcome: `outcome/1.3-shared-constant-outcome.md`

- [x] **1.4 Add Localized `trialAlreadyGranted` Error Key (REQ-051)**
  - Files to modify:
    - `shared/locale/types/errors/index.ts` — add to the errors `MessageSchema` interface:
      ```ts
      studentTrial: { trialAlreadyGranted: string; };
      ```
    - `shared/locale/en/errors/index.ts` — add:
      `studentTrial: { trialAlreadyGranted: "The free trial credit has already been granted for this student." }`
    - `shared/locale/ar/errors/index.ts` — add:
      `studentTrial: { trialAlreadyGranted: "تم منح رصيد الجلسة التجريبية لهذا الطالب مسبقًا." }`
  - Notes: the `errors` namespace already exists — **no namespace registration needed**; if the `studentTrial` grouping object is absent in any file, create it only in that file. Confirm locale contract parity across all registered locale contract files per `shared/locale/AGENTS.md`; verify the compile-time key-type test (if present in the locale test harness) stays green.
  - Applicable instruction files: `shared/locale/AGENTS.md`
  - _Requirements: REQ-051, REQ-002, REQ-050_
  - [x] 1.4.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts shared/locale/types/errors/index.ts --lifecycle duplicates` (repeat for the `en` and `ar` files — exit code 0 each)
  - [x] 1.4.TE **Test Engineering**: Property-access resolution test: `await getServerTranslations("en", "errors")` → `.studentTrial.trialAlreadyGranted` equals expected string; same for `"ar"`; `t("...")` function-call form MUST NOT be used.
  - [x] 1.4.SEC **Security & Tenancy Audit**: Error copy is generic — leaks no account state, ownership, or soft-delete internals (private-data-disclosure review).
  - [x] 1.4.SR **Semantic Review**: Property access only; English/Arabic contract parity (same key set in both); no hardcoded error string anywhere in backend (grep `trialAlreadyGranted` → only locale files + property access site).
  - [x] 1.4.IV **Instruction Verification**: Validate against `shared/locale/AGENTS.md` (type-first, all locales same commit).
  - Outcome: `outcome/1.4-i18n-error-key-outcome.md`

---

# Phase 2 — Repositories & Backend Services

- [x] **2.1 Implement `StudentRepository.grantFreeTrialOnce` (REQ-012, REQ-041, REQ-042)**
  - Files to modify:
    - `backend/db/repo/students/student.repository.ts` — append new exported method (no new repository file; no changes to existing methods)
    - Test file: `backend/db/repo/students/__tests__/student-grant-free-trial-once.test.ts` (NEW)
  - Implementation (exact shape per plan §4):
    ```ts
    export async function grantFreeTrialOnce(
      studentId: number,
      trialCount: number,
      tx?: DBTransaction,
    ): Promise<boolean> {
      const queryDb = tx ?? db; // Neon/HTTP fallback pattern
      const updated = await queryDb
        .update(students)
        .set({
          balanceTrial: sql`${students.balanceTrial} + ${trialCount}`,
          trialGrantedAt: new Date(),
        })
        .where(and(eq(students.id, studentId), isNull(students.trialGrantedAt)))
        .returning({ id: students.id });
      return updated.length > 0;
    }
    ```
  - Hard rules: single conditional UPDATE (no SELECT-then-UPDATE; TOCTOU window = 0); `tx` optional-last per `backend/db/repo/AGENTS.md`; bound parameters only inside `sql``` — no inline `--` comments; repo throws no domain errors and contains no i18n/permission logic; NOT a Prepared-Statements-2.0 candidate (write, not read).
  - Applicable instruction files: `backend/db/repo/AGENTS.md`, `docs/drizzle/prepared-statements.md`
  - _Requirements: REQ-012, REQ-041, REQ-042, REQ-035_
  - [x] 2.1.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts backend/db/repo/students/student.repository.ts --lifecycle duplicates` (exit code 0)
  - [x] 2.1.TE **Test Engineering** (4-Tier, all inside `runInRollback`, own entities via `entity-setup.ts`, `tx` propagated, `expectRepoError` for failures — **never** `.rejects.toThrow()` inside `runInRollback`):
    - Tier 1 (branch/stmt): grant on fresh student → returns `true`, `balanceTrial = trialCount`, `trialGrantedAt IS NOT NULL`;
    - Tier 1 (false branch): second call → returns `false`, balance unchanged (no silent no-op confusion — service converts to ConflictError);
    - Tier 2 (boundary): `trialCount = 0` behavior documented/guarded (constant guarantees 1; assert expression arithmetic path);
    - Tier 3 (chaos): nonexistent `studentId` → returns `false`, no row created, no side effects;
    - Tier 4 (security/constraint): direct raw insert with `balance_trial = -1` → `students_balance_trial_check` rejects (REQ-075 via `expectRepoError`);
    - Run: `bun run test/scripts/run-test.ts backend/db/repo/students/__tests__/student-grant-free-trial-once.test.ts`; then `bun test --coverage backend/db/repo/students/` → new method at 100% statement+branch (REQ-070).
  - [x] 2.1.SEC **Security & Tenancy Audit**: BOLA — `studentId` is the only identity input (callers server-derived; verified again at 2.3.SEC); BOPLA — set-clause touches exactly two columns, no input spread; tenant — single-tenant by PK; no LIKE/search input (no `escapeLikeWildcards` applicable).
  - [x] 2.1.SR **Semantic Review**: repo purity (returns `boolean`, no errors thrown), `tx ?? db` pattern matches neighboring methods, no dead code, no strings, atomic single-statement semantics confirmed by reading final SQL.
  - [x] 2.1.IV **Instruction Verification**: Re-validate against `backend/db/repo/AGENTS.md` and `backend/db/test/AGENTS.md`.
  - Outcome: `outcome/2.1-repo-grant-outcome.md`

- [x] **2.2 Implement `StudentTrialService.grantFreeTrial` Domain Service (REQ-013, REQ-017, REQ-050..052)**
  - Files to create:
    - `backend/services/students/student-trial.service.ts` (NEW)
    - `backend/services/students/__tests__/student-trial.service.test.ts` (NEW)
  - Implementation (exact shape per plan §4):
    ```ts
    import type { DBTransaction } from "@/backend/types";
    import { ConflictError } from "@/backend/lib/errors";
    import { logger } from "@/backend/lib/logger";
    import { StudentRepository } from "@/backend/db/repo";
    import { FREE_TRIAL_SESSION_COUNT } from "@/shared/constants/free-trial.constants";
    import { getServerTranslations } from "@/shared/locale/server-graphql";

    export namespace StudentTrialService {
      /** FR-2.6 / REQ-017: the ONLY trial-grant entry point. Idempotent at SQL level.
       * Future callers: DEV2-009 conversion, DEV3-019 direct onboarding. */
      export async function grantFreeTrial(
        studentId: number,
        locale: string,
        tx?: DBTransaction,
      ): Promise<void> {
        const granted = await StudentRepository.grantFreeTrialOnce(
          studentId, FREE_TRIAL_SESSION_COUNT, tx,
        );
        if (!granted) {
          logger.logDomainError("Trial grant rejected: already granted", {
            code: "TRIAL_ALREADY_GRANTED", entity: "students", entityId: studentId,
            attempt: "1",
          });
          const tErrors = await getServerTranslations(locale, "errors");
          throw new ConflictError(tErrors.studentTrial.trialAlreadyGranted);
        }
      }
    }
    ```
  - Hard rules: service owns error taxonomy + i18n + logging; no permission gates here (authorization enforced at caller boundary); no `try/catch` swallowing on the happy path (REQ-053); `ConflictError.extensions.code = CONFLICT` per `docs/graphql/domain-error-extensions-code.md`; service-local `.types.ts` PROHIBITED.
  - Applicable instruction files: `backend/services/AGENTS.md`, `docs/graphql/domain-error-extensions-code.md`, `backend/lib/logger` usage docs, `shared/locale/AGENTS.md`
  - _Requirements: REQ-013, REQ-014, REQ-017, REQ-019, REQ-050, REQ-051, REQ-052, REQ-053_
  - [x] 2.2.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts backend/services/students/student-trial.service.ts --lifecycle duplicates` (exit code 0)
  - [x] 2.2.TE **Test Engineering** (4-Tier, `runInRollback` + `tx` propagation for DB-backed asserts; mock-adapter tier for translation/logger):
    - Tier 1: fresh student (entity-setup) → `grantFreeTrial` resolves; row shows `balanceTrial = FREE_TRIAL_SESSION_COUNT` and non-null `trialGrantedAt`;
    - Tier 1 (re-grant): second invocation → `expectRepoError` catches `ConflictError`; message CONTAINS the *translated en string substring* from 1.4 (never the raw key); `balancedTrial` remains exactly `1` (REQ-074);
    - Tier 2: locale `"ar"` path resolves the Arabic message substring; undefined-locale → default-locale fallback per server-graphql harness behavior;
    - Tier 3: repo failure injected (mock adapter) → error propagates without wrapping, partial state absent;
    - Tier 4: `logger.logDomainError` spy confirms structured context (`code`, `entity: "students"`, `entityId`) exactly once per rejection; confirm no `console.*` in file (grep).
    - Run: `bun run test/scripts/run-test.ts backend/services/students/__tests__/student-trial.service.test.ts`; `bun test --coverage backend/services/students/` → 100% stmt+branch on new file (REQ-070).
  - [x] 2.2.SEC **Security & Tenancy Audit**: BFLA — no exported mutation surface (service-internal only, REQ-030); BOLA — identity ONLY from param; BOPLA — count comes EXCLUSIVELY from `FREE_TRIAL_SESSION_COUNT`; verify the conflict message is generic (no private state leak).
  - [x] 2.2.SR **Semantic Review**: single entry point (grep confirms this is the only file containing `grantFreeTrialOnce` callers beyond tests); zero plain `new Error(...)`; property-access i18n; `tx` forwarded verbatim; happy path logs nothing (REQ-053).
  - [x] 2.2.IV **Instruction Verification**: Validate against `backend/services/AGENTS.md` (namespacing, no service-local types, DomainError-only).
  - Outcome: `outcome/2.2-trial-service-outcome.md`

- [x] **2.3 Wire Grant into `RegistrationService.registerUser` — Student Branch Only (REQ-011, REQ-015, REQ-018, REQ-040, REQ-033)**
  - Files to modify:
    - `backend/services/auth/registration.service.ts`
    - Test file: `backend/services/auth/__tests__/registration-trial-provisioning.test.ts` (NEW)
  - Change (single insertion point): inside `createRoleChild`'s **student** branch, AFTER the handshake retry loop surrounding `StudentRepository.createForRegistration(userId, handshakeCode, tx)` resolves successfully:
    ```ts
    await StudentTrialService.grantFreeTrial(userId, locale, tx); // REQ-011 — same tx & locale
    ```
  - Explicitly NOT wired in: teacher branch (`ApplicantRepository.create`), parent branch (`ParentRepository.createForRegistration`), and `createAdminUser` (service-only path) — REQ-015/REQ-033.
  - Hard rules: grant inherits the existing `withTransaction(outerTx)` SAVEPOINT pattern (do NOT restructure the registration transaction); `UserRole` referenced via **value import** (REQ-002); `RegistrationSubmitInput` whitelist byte-identical (no new fields); **`userId` = shared PK of the freshly inserted `users` row — never client input** (REQ-032).
  - Applicable instruction files: `backend/services/AGENTS.md`, `docs/specs/state-machine-invariants.md` (INV-B1/B4/B5, B.6/B.7), `docs/IDEMPOTENCY.md`
  - _Requirements: REQ-011, REQ-015, REQ-016, REQ-018, REQ-023, REQ-031, REQ-032, REQ-033, REQ-040, REQ-041, REQ-044_
  - [x] 2.3.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts backend/services/auth/registration.service.ts --lifecycle duplicates` (exit code 0)
  - [x] 2.3.TE **Test Engineering** (4-Tier; all DB cases in `runInRollback`; own entities only; `expectRepoError` helper for throws):
    - Tier 1 (role matrix, REQ-072):
      - `registerUser(student)` → student row: `balanceTrial = 1`, `trialGrantedAt IS NOT NULL`; `balanceHifz/balanceTajweed/balanceReviews = 0` exactly (REQ-016);
      - `registerUser(teacher)` → `applicants.status = "pending"`, no student row, grant untouched;
      - `registerUser(parent)` → parent row created, zero trial;
      - `createAdminUser(...)` → no student row, grant untouched.
    - Tier 1 (response contract, REQ-023/061): mutation return type unchanged; re-reading the student row at service level shows the grant.
    - Tier 2 (boundary): duplicate-email re-registration → 23505 → `ConflictError` BEFORE any student row/grant (REQ-044, `expectRepoError`).
    - Tier 3 (chaos, REQ-073): force child-insert failure AFTER the grant line executes (inject via mock-adapter on the post-grant step) → assert zero residual `users` row, zero residual `students` row, no grant persists (SAVEPOINT/rollback atomicity fully verified under `outerTx`).
    - Tier 4: duplicate `registerUser` race simulation (two sequential calls same email) → exactly one grant total across the system.
    - Run: `bun run test/scripts/run-test.ts backend/services/auth/__tests__/registration-trial-provisioning.test.ts`; plus full existing registration suite: `bun run test/scripts/run-test.ts backend/services/auth/__tests__` → zero regressions; coverage on `registration.service.ts` new lines = 100% (REQ-070).
  - [x] 2.3.SEC **Security & Tenancy Audit**: BOLA — derived `users.id` only; BOPLA — grep registration file for `{ ...input` → zero occurrences; whitelist diff vs HEAD → empty; BFLA — no role can invoke grant except student registration path; teacher-side state (`applicants.status`) asserted untouched (REQ-033); rate-limiter posture untouched (REQ-034).
  - [x] 2.3.SR **Semantic Review**: single call-site; tx propagated to BOTH `createForRegistration` and `grantFreeTrial` within identical transaction scope; no silent try/catch added (REQ-053); review diff is minimal/additive; no dead branches.
  - [x] 2.3.IV **Instruction Verification**: Validate against `backend/services/AGENTS.md`, `docs/IDEMPOTENCY.md` (structural idempotency argument recorded in outcome), spec §2.4.
  - Outcome: `outcome/2.3-registration-hook-outcome.md`

- [x] **2.4 Seed Parity — `seed-students.ts` Bootstrap via Service (REQ-024, D7)**
  - Files to modify:
    - `backend/db/seeds/students/seed-students.ts`
  - Change: implement the **find-then-grant-if-null seed-or-get pattern** per `backend/db/seeds/AGENTS.md`: for each demo student, resolve existing row via the student service; if `trialGrantedAt IS NULL`, invoke `StudentTrialService.grantFreeTrial(studentId, locale)` (production entry point — never a raw field bypass); second `bun run db seed` run must be a no-op (never surfaces REQ-013 `ConflictError`).
  - Hard rules: never bypass `students_balance_trial_check`; never hardcode the grant count (use the constant via service); seeds must use the production service bootstrap, not raw inserts of trial columns.
  - Applicable instruction files: `backend/db/seeds/AGENTS.md`, `backend/services/AGENTS.md`
  - _Requirements: REQ-024, REQ-017_
  - [x] 2.4.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts backend/db/seeds/students/seed-students.ts --lifecycle duplicates` (exit code 0)
  - [x] 2.4.TE **Test Engineering**: Run `bun run db seed` twice in sequence (dev DB or rollback harness) → second run exits 0, no `TRIAL_ALREADY_GRANTED` log entries beyond seed-time diagnostics, seeded students show `balance_trial = 1` with marker set; Tier 3: re-run under partially-seeded DB state.
  - [x] 2.4.SEC **Security & Tenancy Audit**: Seed script remains dev-only entry (not reachable from GraphQL); no credentials/tokens logged.
  - [x] 2.4.SR **Semantic Review**: no raw `balanceTrial` column writes in seed file; uses exact production entry point; idempotent branching on `trialGrantedAt`.
  - [x] 2.4.IV **Instruction Verification**: Validate against `backend/db/seeds/AGENTS.md` service-bootstrap mandate.
  - Outcome: `outcome/2.4-seed-parity-outcome.md`

- [x] **2.M Phase 2 Mid-Point Review Gate (MANDATORY before Phase 3)**
  - Checklist gate (all must pass before proceeding):
    - `bun tsgo` → error count == baseline (±0)
    - `bun biome:check` → diagnostics == baseline (±0)
    - Full backend test run: `bun test backend/` → green; new suites at 100% stmt+branch
    - Grep audit: `grantFreeTrialOnce` called from exactly ONE service; `{ ...input` absent from registration path; `console.` absent from all touched files; `FREE_TRIAL_SESSION_COUNT` is the only occurrence of the literal count
    - Manual re-read of `registration.service.ts` diff: exactly one additive call site
    - `deferred-items.md` — verify ONLY D1/D2 present (no accidental new ❌/⚠️)
  - Document gate results: `outcome/2.M-midpoint-gate-outcome.md`
  - _Requirements: REQ-070, REQ-072, REQ-073, REQ-074, REQ-075, REQ-076 (early deviation tracking)_

---

# Phase 3 — GraphQL Resolvers & API Handlers (Verification-Only Slice)

> **Scope note**: No new resolvers ship in this ticket (REQ-060). This phase is a **contract-verification gate**, not an authoring phase. It exists to prove the GraphQL surface is byte-stable.

- [x] **3.1 GraphQL Schema Stability Verification (REQ-060, REQ-023, REQ-030)**
  - Files: none modified. Verification artifacts only.
  - Steps:
    1. Snapshot the current generated schema; run `bun run generate:gqlSchema && bun codegen`.
    2. Diff generated schema + generated documents against the Phase 0.1 snapshot → MUST contain **zero trial-related members** (no query, mutation, object-type field, or input-type field).
    3. Grep `backend/graphql/` for `balanceTrial|trial_granted|balance_trial|trialGranted` → expect ZERO hits (Pothos fields are explicit `t.expose*` enumerations; new DB columns must not leak, per `backend/graphql/AGENTS.md`).
    4. Verify `RegisterUserInput`, `RegisterPayload`, and `Student` Pothos objects are unchanged vs DEV1-002/DEV1-003 baseline.
    5. Record the forward-exposure contract note (REQ-062) verbatim in the outcome: any future exposure MUST use canonical `Student` object with `id` + `t.loadable()`/DataLoader batching per `docs/graphql/dataloader-batching.md` and canonical `@/backend/types` imports.
  - Applicable instruction files: `backend/graphql/AGENTS.md`, `docs/graphql/dataloader-batching.md`, `docs/graphql/domain-error-extensions-code.md`
  - _Requirements: REQ-023, REQ-030, REQ-060, REQ-061, REQ-062_
  - [x] 3.1.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts backend/graphql/schema.ts --lifecycle duplicates` (exit code 0; regenerated artifacts must remain sub-loop clean)
  - [x] 3.1.TE **Test Engineering**: Existing resolver integration suite pass-through: `bun run test/scripts/run-test.ts backend/graphql/__tests__` → green; registerUser integration test asserts payload shape identical to baseline (field-set equality check).
  - [x] 3.1.SEC **Security & Tenancy Audit**: **BFLA sweep** — enumerate schema Query/Mutation root members; prove no grant/top-up/manipulate operation for `balance_trial` exists for any role (anonymous/student/parent/teacher/supervisor/super_admin); confirm low-priv token has no function path to mint trial credits; finalize the permission-matrix table from plan §3 with ✅/❌ per role.
  - [x] 3.1.SR **Semantic Review**: codegen diff contains no unintended renames/orderings attributable to this ticket; no local types introduced in resolver files (canonical-type-only rule holds trivially).
  - [x] 3.1.IV **Instruction Verification**: Validate against `backend/graphql/AGENTS.md` (no-local-types, explicit exposes, DataLoader rules not yet applicable).
  - Outcome: `outcome/3.1-graphql-stability-outcome.md`

---

# Phase 4 — Frontend GraphQL Documents, Stores & UI Views (Contract-Only)

> **Scope note**: This ticket ships **zero frontend changes** (REQ-023, REQ-063). No UI component/page/view tasks exist; consequently the dual Agent-Browser self-loops (.BF functional + .BS screenshot analysis) have **no target surface** and are expressly out of scope by spec §2.6. This phase records the absence as a verified gate and locks the forward contract so downstream UI tickets inherit correct rules. If the executor finds ANY incidental frontend edit, the full UI pipeline (QL → TE → BF → BS → SR → IV) with both Agent-Browser loops becomes mandatory for that file — otherwise this phase remains verification-only.

- [x] **4.1 Frontend No-Op Verification & Forward-Contract Lock (REQ-023, REQ-063, REQ-002)**
  - Files: none modified. Verification artifacts only.
  - Steps:
    1. `git diff --name-only <baseline> -- frontend/ app/` → MUST be empty.
    2. Confirm no new/renamed Apollo documents: `registerUserMutationDocument`, `loginMutationDocument`, `meQueryDocument`, `refreshTokenMutationDocument`, `recitationReadingsQueryDocument` untouched (hash/compare).
    3. Confirm no `AppPermission` enum additions and no `requirePermissionForPage`/`RequirePermission` changes.
    4. Record forward UI contract note (for the future trial-balance dashboard ticket): MUI v9 `sx`-only styling, no direct style props, `*Outlined` icons, `useAppTranslation(Translation.<Namespace>)` property access (never `t('key')`), RTL bidirectional correctness, `FREE_TRIAL_SESSION_COUNT` imported from `@/shared/constants` (never re-declared), and Agent-Browser dual self-loops mandatory when the badge/banner UI ships.
  - Applicable instruction files: `frontend/AGENTS.md`, `frontend/views/AGENTS.md`, `frontend/components/ui/AGENTS.md`, `frontend.instructions.md`, `mobile-desktop.instructions.md` (reference only — to be enforced by the future UI ticket)
  - _Requirements: REQ-002, REQ-023, REQ-060, REQ-063_
  - [x] 4.1.QL **Quality Loop**: re-run `bun biome:check` scoped root-wide to prove zero frontend diagnostics delta vs baseline (exit code 0)
  - [x] 4.1.TE **Unit/Component Tests**: regression pass — existing frontend test suites (`bun test frontend/`) green with zero new snapshots; assert no `balanceTrial` references leaked into generated client types consumers.
  - [x] 4.1.SR **Semantic Review**: diff-empty assertion re-verified post-Phase-5; outcome file records that BF/BS browser loops are not applicable per approved spec §1 (non-goal #4) and §2.6 (REQ-063 "N/A for this ticket").
  - [x] 4.1.IV **Instruction Verification**: Record that `frontend/AGENTS.md` and instruction files were read; no rules violated (no files touched).
  - Outcome: `outcome/4.1-frontend-noop-outcome.md`

---

# Phase 5 — Integration & Differential Testing

- [x] **5.1 Full-Stack Integration & Differential Test Sweep (REQ-070..076)**
  - Steps:
    1. Full test suite: `bun test` (root) → green; record duration & counts.
    2. Coverage assertion: `bun test --coverage backend/services/students/ backend/db/repo/students/ backend/services/auth/` → new/modified code at **100% statement + branch**; export coverage summary into outcome.
    3. Differential run vs DEV1-002/003 outcomes: assert every previously-passing registration/auth suite still passes unchanged (no behavior drift on teacher/parent/admin paths).
    4. REQ-072/073/074/075 evidence mapping table in outcome: requirement → test name → file → result.
    5. Seed integration: `bun run db seed` twice → idempotent; inspect 2 sample seeded students.
    6. End-to-end registration smoke path (service-level, within `runInRollback`): student registers → row shows grant → simulated second provisioning attempt → localized `ConflictError`; verify `logger.logDomainError` captured with structured context.
    7. Deviation ledger update (REQ-076): `bun tsgo`, `bun biome:check`, `lint-service` JSON ⇒ three counts vs Phase 0.1 baseline (expected delta: **zero new errors**); `git diff --name-only` full file inventory vs baseline snapshot.
  - Applicable instruction files: `backend/db/test/AGENTS.md`, `docs/IDEMPOTENCY.md`
  - _Requirements: REQ-070, REQ-071, REQ-072, REQ-073, REQ-074, REQ-075, REQ-076_
  - Outcome: `outcome/5.1-integration-differential-outcome.md`

---

# Phase 6 — Post-Implementation Review Waves (Parallel)

> Launch as parallel sub-reviews; each wave writes its own outcome file. No wave may declare pass while any ❌/⚠️ item is unresolved (except pre-seeded D1/D2).

- [ ] **6.1 Review Wave: review-types**
  - Scope: `backend/types/students/student.types.ts` (confirm zero edits — inference flows), `shared/locale/types/errors/index.ts`, `shared/constants/*`, schema inference bankruptcy check (`bun tsgo`).
  - Verify: no new `.types.ts` files were created; no local types in services/repos; canonical-type imports only; `StudentSelectType.balanceTrial: number` (not nullable) confirmed by inspection/inference probe.
  - Outcome: `outcome/6.1-review-types-outcome.md`
  - _Requirements: REQ-003, REQ-002_

- [ ] **6.2 Review Wave: review-backend**
  - Scope: repo method (2.1), domain service (2.2), registration hook (2.3), seeds (2.4) — code + tests.
  - Checklist: single guarded UPDATE (no read-modify-write); `tx` propagation at every call site; DomainError-only throws; `logger.logDomainError` usage; no `console.*`; property-access i18n; no `try/catch` swallowing (REQ-053); role gating present; seed bootstrap pattern; atomic-registration rollback test evidence.
  - Outcome: `outcome/6.2-review-backend-outcome.md`
  - _Requirements: REQ-011..019, REQ-040..042, REQ-050..053_

- [ ] **6.3 Review Wave: review-frontend**
  - Scope: verify Phase 4 no-op claim independently: `git diff --name-only -- frontend/ app/` empty; generated client documents unchanged; no MUI/icon/i18n violations introduced anywhere in repo diff.
  - If any frontend file IS present in the diff: escalate — the receiving file MUST retroactively pass the full UI pipeline (QL, TE, **BF Agent-Browser functional loop: dev server + Playwright navigation/form/button/toast assertions**, **BS Agent-Browser visual loop: 1440×900 / 768×1024 / 375×812 × en-LTR / ar-RTL screenshots with MUI palette + RTL mirroring triage**, SR, IV) before this wave may pass.
  - Outcome: `outcome/6.3-review-frontend-outcome.md`
  - _Requirements: REQ-023, REQ-060, REQ-063_

- [ ] **6.4 Review Wave: pentester**
  - Scope: BOPLA/BOLA/BFLA threat review on the grant path.
  - Checks: smuggled-field fuzz (attempt `balanceTrial`/`trialCount`/`trial_granted_at` in `registerUser` input at integration level → rejected/ignored by whitelist); identity-derivation proof (no client-supplied studentId anywhere — grep + code path review); BFLA schema sweep (no balance-mutation ops, all roles); TOCTOU concurrency proof write-up (two concurrent `grantFreeTrialOnce` calls on same row → serialized by row lock; exactly ONE credit); negative-balance CHECK enforcement (REQ-035); privilege-escalation check (teacher/applicant states untouched, REQ-033); governance preservation (INV-U5: trial lane persists across suspend/block/soft-delete — documented review note).
  - Outcome: `outcome/6.4-pentester-outcome.md`
  - _Requirements: REQ-030..035, REQ-042, REQ-033_

- [ ] **6.5 Deferred-Items Ledger Gate**
  - Run: `grep -c "❌\|⚠️" ai/plans/dev1-004-free-trial-session-provisioning/deferred-items.md` → MUST equal **0**, with the explicit exception that D1 (→ DEV3-010) and D2 (→ DEV3-004/DEV3-013) are pre-seeded, targeted, documented as non-blocking per the deferred-items template enforcement rules.
  - If any NEW items surfaced during phases 1–5: either resolve them pre-close or formally append with target ticket + justification and record in outcome.
  - Outcome: `outcome/6.5-deferred-gate-outcome.md`
  - _Requirements: REQ-083, REQ-001_

---

# Phase 7 — Knowledge Propagation & Documentation

- [ ] **7.1 Canonical Doc: `docs/students/free-trial-provisioning.md` (REQ-080)**
  - Create `docs/students/free-trial-provisioning.md` covering, per spec §REQ-080:
    - **Why**: FR-2.6 acquisition mechanic + INV-B5/InV-B2 invariant protection (dedicated-lane ruling rationale) + conversion analytics;
    - **Grant-once pattern**: guarded single conditional `UPDATE … WHERE trial_granted_at IS NULL … RETURNING id` + `trial_granted_at` marker; TOCTOU-window-zero argument; why no advisory lock / no `SELECT FOR UPDATE`;
    - **DEV3 forward contract**: eligibility = paid lane > 0 OR `balance_trial > 0` (INV-B4 extension); trial-first decrement order (INV-B8); no expiry (INV-B3 explicitly non-applied); DataLoader/GraphQL exposure rules (REQ-062);
    - **Anti-patterns**: never credit `balance_hifz` with trials; never poll paid lanes for eligibility where trial applies first; never expose a grant mutation; never re-grant via admin UI without auditing;
    - **Rollout summary**: schema delta, push-only discipline, seed parity;
    - **Related documents**: links to `docs/auth/user-registration.md`, `docs/specs/state-machine-invariants.md`, `docs/workflows/03-session-lifecycle.md`, DEV1-002 outcomes.
  - Outcome: `outcome/7.1-canonical-doc-outcome.md`
  - _Requirements: REQ-080, REQ-020, REQ-021, REQ-022_

- [ ] **7.2 Invariant & Decisions Addenda (REQ-081)**
  - Modify:
    - `docs/specs/state-machine-invariants.md` §4.2 — append:
      - **INV-B7**: A trial credit is granted at most once per student record; enforced by the `trial_granted_at` marker and the guarded conditional UPDATE (grant-once at SQL level).
      - **INV-B8**: Session allowance consumption decrements `balance_trial` BEFORE any paid intent lane (`balance_hifz`/`balance_tajweed`/`balance_reviews`).
      - Note INV-B1 structural extension (4th non-negative lane), INV-B3 explicit NON-application, INV-B4 eligibility extension (trial OR paid).
    - `docs/specs/open-decisions-and-gaps.md` — append resolution note: trial-placement decision = dedicated `balance_trial` lane (NOT `balance_hifz`), per FR-2.6, with the three-point rationale (INV-B5 purity, INV-B2 subscription-binding, analytics separability).
  - Post-edit: `bun run scripts/health/sub-loop.ts docs/specs/state-machine-invariants.md --lifecycle duplicates` (and the decisions doc) — exit 0.
  - Outcome: `outcome/7.2-invariants-decisions-outcome.md`
  - _Requirements: REQ-081_

- [ ] **7.3 Cross-Doc & Layer AGENTS Updates (REQ-082)**
  - Modify (rule-only one-liners referencing the canonical doc, never duplicated logic):
    - `docs/auth/user-registration.md` — add trial-hook paragraph in the registration flow section (grant happens inside registration tx for `role = student` via `StudentTrialService.grantFreeTrial`; link canonical doc).
    - `backend/services/AGENTS.md` — one-liner: "Student trial provisioning flows exclusively through `StudentTrialService.grantFreeTrial` (grant-once, guarded UPDATE). See docs/students/free-trial-provisioning.md."
    - `shared/AGENTS.md` — one-liner constant note: "`shared/constants/free-trial.constants.ts` holds `FREE_TRIAL_SESSION_COUNT` — the single source of truth for trial sizing."
    - Root `AGENTS.md` Important References — one line pointing to `docs/students/free-trial-provisioning.md`.
  - Each modified file: run the duplicate sub-loop (exit 0).
  - Outcome: `outcome/7.3-cross-doc-agents-outcome.md`
  - _Requirements: REQ-082_

- [ ] **7.4 Outcome Synthesis & Final Quality Gate (REQ-076, REQ-083)**
  - Produce `ai/plans/dev1-004-free-trial-session-provisioning/outcome/FINAL-synthesis-outcome.md`:
    - Consolidated baseline-vs-final table: `tsgo` errors, `biome` diagnostics, lint counts (new errors introduced: **0 expected** — any nonzero delta requires explicit justification + remediation task);
    - `git diff --name-only` authoritative file inventory vs Phase 0.1 snapshot;
    - Requirement traceability closure: REQ-001..083 → task → outcome file (mark contract-only REQs REQ-019/020/021/022/034/062/063 as CONTRACT-RECORDED, not code);
    - Deferred-items final state: D1/D2 only, both non-blocking with target tickets;
    - Test evidence summary: all suites green, new code 100% stmt+branch, role-matrix/rollback/idempotency/constraint scenarios enumerated;
    - Knowledge artifacts delivered: canonical doc, INV-B7/B8 addendum, decisions addendum, AGENTS one-liners;
    - Sign-off checklist: entire `tasks.md` at `[x]`.
  - Final gate runs: `bun tsgo && bun biome:check && bun quality-gate` (staged where applicable) → **exit 0 across the board**.
  - _Requirements: REQ-076, REQ-083, REQ-080, REQ-081, REQ-082_

---

## Traceability Snapshot (Requirement → Task)

| Requirement(s) | Task |
|---|---|
| REQ-001, REQ-076 (baseline/ledger) | 0.1, 5.1, 6.5, 7.4 |
| REQ-002, REQ-003 (i18n/type discipline) | 0.2, 1.4, 4.1, 6.1 |
| REQ-010, REQ-035, REQ-043 (schema/push) | 1.1, 1.2 |
| REQ-014 (constant) | 1.3 |
| REQ-051 (localized error) | 1.4, 2.2 |
| REQ-012, REQ-041, REQ-042 (guarded UPDATE) | 2.1, 6.4 |
| REQ-013, REQ-017, REQ-050..053 (service) | 2.2 |
| REQ-011, 015, 016, 018, 023, 031..033, 040, 044 (registration hook) | 2.3 |
| REQ-024 (seed parity) | 2.4 |
| REQ-070..075 (tests) | 2.1–2.4 TE subtasks, 2.M, 5.1 |
| REQ-023, 030, 060, 061, 062 (GraphQL) | 3.1, 6.3 |
| REQ-063 (frontend N/A + contract) | 4.1, 6.3 |
| REQ-019..022, 034, 062 (forward contracts) | 7.1, 7.2, 7.4 |
| REQ-080..083 (knowledge) | 7.1, 7.2, 7.3, 7.4, 6.5 |
