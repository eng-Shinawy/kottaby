# tasks.md — DEV3-018: Cold-Start Bootstrapping (Direct Sheikh Certification)

```markdown
# Trackable Implementation Tasks — DEV3-018 (Cold-Start Bootstrapping — Direct Sheikh Certification)

> **Plan directory (verbatim — every header, ledger path, outcome path, and self-reference in this file MUST use this exact string):** `ai/plans/sprint_3/dev3-018-cold-start-bootstrapping-direct-sheikh-c`
> **Specs:** `ai/plans/sprint_3/dev3-018-cold-start-bootstrapping-direct-sheikh-c/specs.md`
> **Plan:** `ai/plans/sprint_3/dev3-018-cold-start-bootstrapping-direct-sheikh-c/plan.md`
> **Ledger:** `ai/plans/sprint_3/dev3-018-cold-start-bootstrapping-direct-sheikh-c/deferred-items.md`
> **Outcomes:** `ai/plans/sprint_3/dev3-018-cold-start-bootstrapping-direct-sheikh-c/outcome/`
> **Blocked by:** DEV3-016 (SHIPPED — verified in-tree; import-by-reference obligations honored)
> **Scope shape:** Backend-dominant (types/i18n → repos → services → resolver) + ONE frontend GraphQL DOCUMENT (no UI — D-UI ledger deferral, REQ-063) + ONE mandatory test-first journey. **Zero DB schema tasks** (REQ-045 zero-drift gate). **No `.BF`/`.BS` browser loops anywhere** — REQ-063 ships no markup; those stages are explicitly recorded as N/A-with-rationale on the document task.

---

## NON-NEGOTIABLE EXECUTION PROTOCOL (applies to EVERY task)

1. **Pre-Execution Outcome Read:** Before starting any task, read ALL existing files under `ai/plans/sprint_3/dev3-018-cold-start-bootstrapping-direct-sheikh-c/outcome/` to accumulate cross-task knowledge (files changed, deliberately-NOT-changed files, pitfalls, verified line anchors).
2. **Post-Edit Quality Loop:** After EVERY file create/modify, run `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` and require exit code 0 BEFORE moving on.
3. **Test Execution Discipline:** Run tests ONLY via `bun run test/scripts/run-test.ts <test-path>` (NEVER raw `bun test` — it skips `--env-file=.env.test`).
4. **Semantic Review Self-Check:** For every `.SR` subtask, self-review: atomicity, env-config (no hardcoded secrets/URLs), zero dead code, no cross-layer imports (`shared/` NEVER imports `@/frontend/**` | `@/backend/**` | `@/app/**`), enums as VALUE imports, no `console.*`, no `next-intl`, no new error subclasses, no `{ ...input }` spreads.
5. **Outcome Documentation:** After completing each task, write `ai/plans/sprint_3/dev3-018-cold-start-bootstrapping-direct-sheikh-c/outcome/<task-id>-outcome.md` capturing: summary, files changed + deliberately-NOT-changed, verification outputs (exact commands + results), cross-file dependencies discovered, and deviations from plan (if any — each deviation MUST be justified or reverted).
6. **Checkbox Tracking:** Flip `[ ]` → `[x]` on the task AND every completed subtask as work lands. Never batch-flip at the end.
7. **Verification-First Ground Truth:** If any cited symbol/file/line is not locatable in the bundle, STOP, record a ❌ entry in `ai/plans/sprint_3/dev3-018-cold-start-bootstrapping-direct-sheikh-c/deferred-items.md`, and re-scope — never invent code to match docs prose.

---

## PHASE 0 — Pre-Implementation Baseline

- [x] 0.1 [Record baseline errors & initialize deferred-items ledger]
  - Run and capture: `bun tsgo`, `bun biome:check`, `bun run scripts/lint-service.ts --json --id baseline` — record exact error/warning counts.
  - Record pre-existing modified-file set: `git diff --name-only` (verbatim list in the outcome).
  - Record schema-drift pre-state: `git diff --stat -- backend/db/schema/** backend/db/migration/**` (expected empty NOW; re-verified empty at Phase 5).
  - Initialize `ai/plans/sprint_3/dev3-018-cold-start-bootstrapping-direct-sheikh-c/deferred-items.md` from `.agents/spec-process-guide/templates/deferred-items-template.md` and seed it with the five pre-registered RESOLVED-REFERENCE entries from plan.md: **D-UI** (admin certify affordance → admin teacher-management surface ticket), **D-EVALUATOR-ELEVATION** (raise `is_evaluator` on an already-certified teacher → separate governance mutation ticket), **D-LOCALE-ROUTING** (per-recipient notification localization → engine D2 lineage), **D-RATE-LIMIT** (bespoke certification limiter → rate-limiting hardening stream), **D-GATE-SHARING** (DEV3-022c/022d collision → consume-and-extend rule).
  - Write `ai/plans/sprint_3/dev3-018-cold-start-bootstrapping-direct-sheikh-c/outcome/0-baseline-outcome.md` with counts + diff set + ledger seed confirmation.
  - _Requirements: REQ-001, REQ-076_

- [x] 0.2 [Prerequisite verification — substrate existence audit (verify-then-claim)]
  - VERIFY each of the following exists in-tree (record `path:line` anchors in the outcome; ANY absence ⇒ ❌ ledger entry + dependent-task block, never inline-patch a foreign layer):
    - `AuditService.createAuditLog` + `AuditLogWriteContract`: `backend/services/admin/audit.service.ts:82-90`, `backend/types/contracts/admin-audit.contract.types.ts`
    - `AuditActionType.Override`: `backend/enum/audit/audit-action-type.enum.ts:10` + `override` pgEnum value `backend/db/schema/enums.ts:66-74`
    - `AdminUserManagementService.createUser`/`getUserDetail`/`getUserActivity` + private `assertActorAdmin`: `backend/services/admin/user-management.service.ts:240-271, 503-580`
    - `UserRepository.findById`: `backend/db/repo/users/user.repository.ts:75-95`
    - `ApplicantRepository.findByUserId`: `backend/db/repo/teachers/applicant.repository.ts`
    - `NotificationEngine.emitForUser`/`publishReceipts` + `NotificationEngineCallOptions` seam: `backend/services/notifications/notification-engine.service.ts:77-82, 327-369`
    - `withTransaction`: `backend/lib/db/with-transaction.ts` (imported at `user-management.service.ts:67`)
    - Pothos `$all` precedent: `backend/graphql/mutation/admin/admin-users.mutation.ts:64-66`
    - `AdminUserDetailPothosObject`: `backend/graphql/pothos/admin/admin-user.pothos.ts:235-300`
    - `ConflictError(code, message)` overload: `backend/lib/errors.ts:170-182` (+ cause-chain traversal parity: `translateDbError` at `backend/lib/errors.ts:200-208`, `isUniqueViolation` at `backend/services/shared/user-provisioning.helpers.ts:74`)
    - Frozen-six `PUBLIC_OPERATIONS`: `backend/lib/gateway/public-operations.ts:36-59`
    - Journey harness: `test/workflows/AGENTS.md`, `provisionAdminActor` factory family, `SpiedFanoutTransport`, `test/helpers/db-cleanup.ts:83` (`withAuditDeleteTriggersSuspended`, JSDoc 72-82), `docs/testing/workflow-journey-tests.md`
  - VERIFY ABSENCE (CREATE items, never "extend"): `backend/db/repo/teachers/teacher.repository.ts` absent (`backend/db/repo/teachers/index.ts:1` exports only `./applicant.repository`); `backend/services/admin/admin-gate.helpers.ts` absent; NO teacher-certification affordance on any `frontend/views/admin/**` surface (the views layer itself is shipped — users + plans surfaces; confirms D-UI deferral of the affordance only).
  - Write `ai/plans/sprint_3/dev3-018-cold-start-bootstrapping-direct-sheikh-c/outcome/0.2-outcome.md`.
  - [x] 0.2.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts ai/plans/sprint_3/dev3-018-cold-start-bootstrapping-direct-sheikh-c/outcome/0.2-outcome.md --lifecycle duplicates` (exit 0)
  - [x] 0.2.SR **Semantic Review**: every EXISTING claim carries a `path:line` anchor; every ABSENCE claim was grep-verified; no prose-only artifacts treated as real.
  - _Requirements: REQ-004_

---

## PHASE 1 — Types, Enums & i18n (NO DATABASE SCHEMA — zero-drift gate REQ-045)

- [x] 1.1 [Add canonical type `TeacherColdStartCertificationInput`]
  - UPDATE `backend/types/teachers/teacher.types.ts` (currently only `TeacherSelectType`/`TeacherInsertType`, lines 1-4) — ADD:
    ```typescript
    export interface TeacherColdStartCertificationInput {
      readonly userId: number;
      readonly makeEvaluator: boolean;
    }
    ```
  - Verify barrel: `backend/types/teachers/index.ts` already re-exports `./teacher.types` — NO barrel edit expected; if the barrel line is absent, add it (and record the delta in the outcome).
  - Instruction files: `.agents/instructions/backend.instructions.md`
  - [x] 1.1.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts backend/types/teachers/teacher.types.ts --lifecycle duplicates` (exit 0)
  - [x] 1.1.SR **Semantic Review**: canonical placement (NO service-layer `.types.ts`), `readonly` fields, no local duplicates elsewhere.
  - [x] 1.1.IV **Instruction Verification**: validate against `.agents/instructions/backend.instructions.md` (the ONLY instruction files are `.agents/instructions/{frontend,backend,tests}.instructions.md`).
  - _Requirements: REQ-003_

- [x] 1.2 [i18n keys — errors (3) + applicant notification copy (2), BOTH locales]
  - UPDATE `shared/locale/types/errors/index.ts` — add FLAT `ErrorsLabels` keys: `teacherAlreadyCertified`, `teacherRoleRequired`, `teacherAccountGoverned` (flat domain-prefixed convention; `userNotFound` is REUSED from the existing `adminUsers` group — never duplicated).
  - UPDATE `shared/locale/en/errors/index.ts` + `shared/locale/ar/errors/index.ts` — add the three keys with real translations in each.
  - UPDATE `shared/locale/types/applicant/index.ts` (ApplicantLabels) — add `coldStartCertifiedTitle`, `coldStartCertifiedBody`.
  - UPDATE `shared/locale/en/applicant/index.ts` + `shared/locale/ar/applicant/index.ts` — add both keys with certification copy (title + body) in each locale.
  - Do NOT mint new namespaces; the emit subject IS the (former) applicant, so the `applicant` namespace owns the copy.
  - Instruction files: `shared/AGENTS.md` (namespace registration checklist), `.agents/instructions/backend.instructions.md`
  - [x] 1.2.QL **Quality Loop**: run `bun run scripts/health/sub-loop.ts` on all six edited locale files (exit 0 each)
  - [x] 1.2.TE **Test**: `bun run test/scripts/run-test.ts shared/locale/errors-namespace.parity.test.ts` and `bun run test/scripts/run-test.ts shared/locale/applicant-namespace.parity.test.ts` — new keys are covered mechanically; the `applicant` key-set pins must NOT be loosened.
  - [x] 1.2.SR **Semantic Review**: ONE-argument `getTranslations(locale)` / `getServerTranslations(locale)` contract respected by future consumers; no `next-intl`, no `Translation` enum, no string-handle `useAppTranslation`.
  - [x] 1.2.IV **Instruction Verification**: `shared/AGENTS.md` checklist followed for key registration.
  - _Requirements: REQ-002, REQ-051, REQ-074_

- [x] 1.9 [PHASE 1.5 — `@plan-review` gate (MANDATORY before ANY implementation task below)]
  - Invoke `@plan-review` over `specs.md` + `plan.md` + this `tasks.md`; record the verdict in `ai/plans/sprint_3/dev3-018-cold-start-bootstrapping-direct-sheikh-c/outcome/plan-review-R1.md`.
  - GATE: `plan-review-R1.md` MUST exist with a PASS verdict before Phase 2 task 2.1 is checked off. Any review finding MUST be resolved in-file (plan amendment) or recorded as a ledger ❌ with an owner — never silently ignored.
  - _Requirements: REQ-083_

---

## PHASE 2 — Repositories & Backend Services (journey test FIRST)

- [x] 2.1 [Write Cold-Start Certification journey test — TEST-FIRST]
  - Create `test/workflows/admin/cold-start-certification.journey.test.ts` — one file covering ALL of journey J-1 (specs §2.9, steps 1–13). The harness is VERIFIED PRESENT: `test/workflows/admin/` already exists with two shipped journeys (admin-user-lifecycle, admin-user-denials) and all harness helpers exist per `test/workflows/AGENTS.md` — no scaffolding is needed before authoring the journey.
  - Provision the actor cast via `provisionAdminActor`-family helpers (Admin A certifier, Admin B observer, student denial probe, governed admin) with REAL permission/role rows — NEVER monkey-patch permission resolution; unique prefix `jrn_cold_<uuid8>`.
  - Steps as sequential service calls with honest `actorUserId`s implementing J-1 exactly:
    1. Committed cast in ONE `db.transaction` inside `beforeAll`.
    2. `AdminUserManagementService.createUser(teacherInput, adminA.id, locale)` → committed teacher-role user + `applicants(pending)`.
    3. `ColdStartCertificationService.certifyTeacherColdStart(adminA.id, { userId: target, makeEvaluator: true }, locale, { transport: spiedTransport })` → assert `teacher{isApproved:true, isEvaluator:true}` + `applicants{status:"passed", cooldownUntil:null}` + exactly ONE `audit_logs(Override, "teacher", entityId=target, details={makeEvaluator:true, applicantRow:"finalized", elevation:"created"})` + exactly ONE `notifications(evaluation_result, userId=target)` row + spied transport recorded EXACTLY ONE envelope addressed `[target]`.
    4. Sheikh-observer: engine inbox read shows the certification row; direct DB oracle confirms coherent trio.
    5. Admin B observer: `getUserDetail` shows teacher + applicant snapshots; `getUserActivity` lists Create + Override newest-first attributed to Admin A.
    6. Student actor → `ForbiddenError`, zero row movement, zero publishes.
    7. Governed admin (suspended flipped post-provisioning) → `ForbiddenError` governance deny, zero writes.
    8. Non-teacher target → `TEACHER_ROLE_REQUIRED`, zero writes.
    9. Governed target → `TEACHER_ACCOUNT_GOVERNED`; reactivate → certify succeeds (composition proof).
    10. Repeat call → `TEACHER_ALREADY_CERTIFIED`; audit count for target stays exactly 2; NO second notification.
    11. Cooldown supersession: failed + future `cooldownUntil` applicant certified → `passed` + `cooldownUntil:null`.
    12. Elevation path: fixture `{isApproved:false, isEvaluator:false}` + `makeEvaluator:false` → `{isApproved:true, isEvaluator:false}`; audit `details.elevation="elevated"`.
    13. Teardown: tracked hard-delete in FK-safe order incl. notifications + audit rows via `withAuditDeleteTriggersSuspended` (`test/helpers/db-cleanup.ts:83`, JSDoc 72-82); post-teardown re-probes prove ZERO residue.
  - Assertions MUST include cross-actor visibility after every step AND every denial path's zero-side-effect oracles.
  - `runInRollback` is FORBIDDEN here (services spawn their own transactions); committed fixtures in `beforeAll`; tracked teardown in `afterAll`.
  - Notification fan-out SPIED via the service `options` seam (`SpiedFanoutTransport`) — NEVER real email/SMS/push.
  - RED state expected initially (service does not exist yet); the file MUST still parse/typecheck as it grows green task by task.
  - Instruction files: `.agents/instructions/tests.instructions.md`, `test/workflows/AGENTS.md`, `docs/testing/workflow-journey-tests.md`
  - Verify: `bun run test/scripts/run-test.ts test/workflows/admin/cold-start-certification.journey.test.ts` (never raw `bun test`)
  - [x] 2.1.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts test/workflows/admin/cold-start-certification.journey.test.ts --lifecycle duplicates` (exit 0)
  - [x] 2.1.TE **Test Engineering**: journey = Tier-4 integration; confirm every J-1 step maps to ≥1 assertion; denial steps assert (a) typed error class + code, (b) zero row movement across `teacher`/`applicants`/`audit_logs`/`notifications`, (c) zero spied envelopes.
  - [x] 2.1.SEC **Security & Tenancy Audit**: honest actor ids only; governed-actor fixture flips `suspended` AFTER provisioning (stale-token simulation); no permission monkey-patching.
  - [x] 2.1.SR **Semantic Review**: `runInRollback` absent; unique prefix present; tracked teardown complete; spies scoped to the fan-out seam only.
  - [x] 2.1.IV **Instruction Verification**: `.agents/instructions/tests.instructions.md` + `test/workflows/AGENTS.md` validated.
  - _Requirements: REQ-075 (J-1), REQ-012..REQ-017, REQ-030/031/032, REQ-041/042/043_

- [x] 2.2 [Implement `TeacherRepository` — CREATE]
  - CREATE `backend/db/repo/teachers/teacher.repository.ts` with namespace `TeacherRepository`:
    - `findById(id: number, tx?: DBTransaction): Promise<TeacherSelectType | null>` — plain PK read via `(tx ?? db)` executor.
    - `insertColdStartCertified(id: number, makeEvaluator: boolean, tx: DBTransaction): Promise<TeacherSelectType>` — field-by-field INSERT `{ id, isApproved: true, isEvaluator: makeEvaluator }`; schema defaults carry `averageRating:null`, `isOnline:false`, `subjects:null`, `requestPreference:"queue"` (`backend/db/schema/teachers/teacher.ts:25-30`); raw 23505 surfaces untranslated (service concern).
    - `elevateToCertified(id: number, makeEvaluator: boolean, tx: DBTransaction): Promise<TeacherSelectType | null>` — SINGLE guarded `UPDATE … SET isApproved=true, isEvaluator=<flag>, updatedAt=now() WHERE id=? AND isApproved=false RETURNING *`.
  - UPDATE `backend/db/repo/teachers/index.ts` — add `export * from "./teacher.repository";` (currently line 1 only).
  - Repo rules: every method takes `tx` LAST; no prepared statements on writes; NO `inArray`+placeholder; NO inline `--` comments inside `sql` templates; never spread input objects.
  - Instruction files: `.agents/instructions/backend.instructions.md`, `docs/drizzle/prepared-statements.md`
  - [x] 2.2.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts backend/db/repo/teachers/teacher.repository.ts --lifecycle duplicates` (exit 0); same for the barrel edit.
  - [x] 2.2.TE **Test Engineering** — CREATE `backend/db/repo/teachers/teacher.repository.test.ts` per REQ-070: every test inside `runInRollback`; `tx` passed to EVERY call (param-position verified); fixtures ONLY via `backend/db/test/entity-setup.ts`; `expectRepoError` try/catch helper (NEVER `expect(...).rejects.toThrow()` inside rollback). Tiers: (T1) statement/branch on all three methods — insert defaults honored, elevate happy/zero-row paths, findById hit/miss; (T2) boundary — elevate on already-approved row returns null (guard evaluated), insert duplicate PK surfaces 23505 raw; (T3) chaos — concurrent double-insert inside one test asserts exactly one row + one 23505; concurrent double-elevate asserts exactly one RETURNING row; (T4) security — `tx` required on writes (no `?? db` shortcut on write paths), no cross-id bleed. Run: `bun run test/scripts/run-test.ts backend/db/repo/teachers/teacher.repository.test.ts`
  - [x] 2.2.SEC **Security & Tenancy Audit**: insert/elevate payloads built field-by-field (BOPLA); no caller-supplied columns beyond `{id, makeEvaluator}`; PK guard is the only authorization surface (service-layer gates above it).
  - [x] 2.2.SR **Semantic Review**: canonical type imports (`TeacherSelectType` from `@/backend/types`), zero dead code, executor discipline consistent.
  - [x] 2.2.IV **Instruction Verification**: `.agents/instructions/backend.instructions.md` validated.
  - _Requirements: REQ-003, REQ-010, REQ-011, REQ-042, REQ-070_

- [x] 2.3 [Implement `ApplicantRepository.finalizeOnCertification` — ADDITIVE]
  - UPDATE `backend/db/repo/teachers/applicant.repository.ts` — add:
    ```typescript
    export async function finalizeOnCertification(
      userId: number,
      tx?: DBTransaction
    ): Promise<boolean>;
    ```
    SINGLE `UPDATE applicants SET status=${ApplicantStatus.Passed}, cooldownUntil=null, updatedAt=now() WHERE id=? RETURNING id`; returns `true` iff a row was finalized. `ApplicantStatus` as VALUE import. Unconditional (supersedes any prior status/cooldown per REQ-012); `verificationAttempts`/`lastAttemptAt` NEVER touched; row NEVER deleted.
  - [x] 2.3.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts backend/db/repo/teachers/applicant.repository.ts --lifecycle duplicates` (exit 0)
  - [x] 2.3.TE **Test Engineering** — extend the existing applicant repo test file (create `backend/db/repo/teachers/applicant.finalize.test.ts` if needed): `runInRollback` discipline; entity-setup fixtures; `expectRepoError`; matrix: pending→passed+null cooldown; failed+future-cooldown→passed+null; in_evaluation→passed; absent row→false; `verificationAttempts`/`lastAttemptAt` byte-identical before/after. Run: `bun run test/scripts/run-test.ts` on the file.
  - [x] 2.3.SEC **Security & Tenancy Audit**: writes only `status`/`cooldownUntil`/`updatedAt`; id parameter bound, never concatenated.
  - [x] 2.3.SR **Semantic Review**: no existing method behavior drift (existing applicant suites stay green: `bun run test/scripts/run-test.ts backend/db/repo/teachers`).
  - [x] 2.3.IV **Instruction Verification**: `.agents/instructions/backend.instructions.md` validated.
  - _Requirements: REQ-012, REQ-044, REQ-070_

- [x] 2.4 [Extract shared admin gate — CREATE `admin-gate.helpers.ts`, REWIRE DEV3-016 service (first-lander)]
  - CREATE `backend/services/admin/admin-gate.helpers.ts`:
    - `assertActorAdmin(actorId, locale, outerTx?)` — moved VERBATIM (byte-parity) from `backend/services/admin/user-management.service.ts:240-271`.
    - NEW `assertActorAdminActive(actorId, locale, outerTx?)` — role gate PLUS governance clause in deterministic order `isDeleted → ForbiddenError(t.accountDeleted)`; `isBlocked → ForbiddenError(t.accountBlocked)`; `suspended → ForbiddenError(t.accountSuspended)` (existing flat keys `shared/locale/en/errors/index.ts:17-19` — no new keys). ONE `logger.logDomainError` per denial with `{ code, entity: "user", entityId: actorId, locale }`; ZERO reads/writes past the gate.
  - UPDATE `backend/services/admin/user-management.service.ts` — DELETE the private copy, import from the helper. ZERO behavior drift: the 61-test service suite + 3-test chaos suite are the regression lock — run both and require unchanged green.
  - UPDATE `backend/services/admin/index.ts` — add `export * from "./admin-gate.helpers";`.
  - Extraction-collision rule (REQ-004): re-verify `admin-gate.helpers.ts` is still absent before creating; if DEV3-022c/022d landed it first, consume-and-extend additively instead of creating (record which branch was taken in the outcome).
  - Instruction files: `.agents/instructions/backend.instructions.md`
  - [x] 2.4.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts backend/services/admin/admin-gate.helpers.ts --lifecycle duplicates` (exit 0); same for `user-management.service.ts` and the barrel.
  - [x] 2.4.TE **Test Engineering**: run existing locks green — `bun run test/scripts/run-test.ts backend/services/admin/user-management.service.test.ts` + `.../user-management.chaos.test.ts`. CREATE `backend/services/admin/admin-gate.helpers.test.ts`: Tier-1 role branches; Tier-2 governance ordering (deleted>blocked>suspended precedence when multiple flags set); Tier-4 BFLA — actorId=0 → UNAUTHORIZED; non-admin → FORBIDDEN; governed → FORBIDDEN; all pre-DB (spy/transaction-count proof of zero DB interaction past the gate).
  - [x] 2.4.SEC **Security & Tenancy Audit**: byte-parity extraction (diff the moved function verbatim); governance clause reads only governance columns; no new error subclasses.
  - [x] 2.4.SR **Semantic Review**: single source of gate truth; no duplicated gate logic left in user-management service; silent-success discipline.
  - [x] 2.4.IV **Instruction Verification**: `.agents/instructions/backend.instructions.md` validated.
  - _Requirements: REQ-004, REQ-031, REQ-050_

- [x] 2.5 [Implement `ColdStartCertificationService` — CREATE]
  - CREATE `backend/services/admin/cold-start-certification.service.ts` — namespace `ColdStartCertificationService`, exported `certifyTeacherColdStart(actorId, input, locale, options?, outerTx?): Promise<AdminUserDetailReturnType>` implementing plan §4.4 EXACTLY:
    1. `assertActorAdminActive(actorId, locale)` — pre-tx (REQ-031/D1).
    2. `userId` shape validation — `Number.isInteger && > 0 && <= MAX_SAFE_INTEGER` else `ValidationError` (code `VALIDATION`); `makeEvaluator = input.makeEvaluator ?? true` coalesced (D7).
    3. `withTransaction(outerTx, tx => …)` with SAME `tx` to every call (REQ-040):
       - `UserRepository.findById(userId, tx)`; null → `logDomainError` + `NotFoundError("USER", t.adminUsers.userNotFound)` (admin-surface oracle ruling)
       - `role !== UserRole.Teacher` → `ConflictError("TEACHER_ROLE_REQUIRED", t.teacherRoleRequired)`
       - governance NULL-safe OR → `ConflictError("TEACHER_ACCOUNT_GOVERNED", t.teacherAccountGoverned)` (no hysteresis — REQ-015)
       - `TeacherRepository.findById(userId, tx)` → branch D2: null ⇒ `insertColdStartCertified` with 23505-cause-chain → `ConflictError("TEACHER_ALREADY_CERTIFIED", t.teacherAlreadyCertified)` translation (`translateDbError`/`isUniqueViolation` precedent), other causes rethrow; `isApproved===true` ⇒ same conflict immediately; else `elevateToCertified` + zero-row ⇒ re-read ⇒ conflict or internal rethrow
       - `ApplicantRepository.finalizeOnCertification(userId, tx)`
       - `AuditService.createAuditLog({ actorId, actionType: AuditActionType.Override, entityType: "teacher", entityId: userId, details: JSON.stringify({ makeEvaluator, applicantRow: finalized?"finalized":"absent", elevation: "created"|"elevated" }) }, tx)` (D8)
       - `NotificationEngine.emitForUser({ userId, type: NotificationType.EvaluationResult, title, body, relatedEntityType: "teacher", relatedEntityId: userId }, locale, tx, options)` with `title`/`body` from `getServerTranslations(locale).applicantTranslations.coldStartCertifiedTitle/coldStartCertifiedBody` (admin locale — D12/A.4.3)
       - `AdminUserManagementService.getUserDetail(userId, locale, actorId, tx)` — same-tx refreshed read (REQ-018); return `{ detail, receipt }` bridge internally
    4. POST-COMMIT ONLY: `NotificationEngine.publishReceipts([receipt], locale, options)` (D4); structural unreachability on rollback (REQ-041).
    5. Return `detail` (receipt stripped).
  - Enum VALUE imports only: `UserRole`, `ApplicantStatus`, `AuditActionType`, `NotificationType`. Denial logging: ONE bounded `logDomainError` each, `{ code, entity, entityId, locale }` — never PII/details payload/tokens; happy path silent (REQ-034/053). NO try/catch swallowing — only the 23505 translation catch (cause-checked, rethrow otherwise).
  - UPDATE `backend/services/admin/index.ts` — add `export * from "./cold-start-certification.service";`.
  - Instruction files: `.agents/instructions/backend.instructions.md`
  - [x] 2.5.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts backend/services/admin/cold-start-certification.service.ts --lifecycle duplicates` (exit 0); barrel same.
  - [x] 2.5.TE **Test Engineering** — CREATE `backend/services/admin/cold-start-certification.service.test.ts` covering the full REQ-071 service matrix via `runInRollback` + entity-setup fixtures: row-absent create with `makeEvaluator` true AND false (committees + teacher-only flags pinned); elevation of unapproved row; finalize across prior statuses (pending/in_evaluation/failed + active cooldown cleared); applicant-absent → `details.applicantRow="absent"`; audit details shape exact-match (3-field JSON, PII-free); in-tx notification row verbatim copy in BOTH admin locales `en` + `ar` (REQ-074 sharpening); refreshed-detail return contains `{ teacher: { isApproved:true, isEvaluator }, applicant: { status: Passed } }`; EVERY REQ-050 denial with exact `extensions.code`-bearing class + localized message; REQ-052 deterministic ordering (multi-problem fixtures resolve in the mandated order); zero-write/zero-audit/zero-publish oracles on EVERY denial. Run: `bun run test/scripts/run-test.ts backend/services/admin/cold-start-certification.service.test.ts`
  - [x] 2.5.SEC **Security & Tenancy Audit (BFLA/BOLA/BOPLA)**: `actorId` is a parameter-never-input; shaped validation pre-DB; role/governance guards pre-write; payloads field-by-field; conflict codes ride the verified overload (no new subclasses); oracle ruling NOT exported (documented admin-surface-only).
  - [x] 2.5.SR **Semantic Review**: single transaction boundary; mixed `tx`/`db` ABSENT; publish strictly post-commit; no swallowed catches; no dead code; no cross-layer imports; `docs/admin/user-management.md` invariants (single audit writer, JR-C-1) honored.
  - [x] 2.5.IV **Instruction Verification**: `.agents/instructions/backend.instructions.md` validated against the final file.
  - _Requirements: REQ-010..REQ-019 (010-019), REQ-031..REQ-034 (031-034), REQ-040/041/043/044, REQ-050..REQ-053 (050-053)_

- [x] 2.M [PHASE 2.M — Mid-Point Review Gate (MANDATORY)]
  - Self-review pass over ALL Phase-2 outputs: read every `outcome/2.*-outcome.md`; re-run `bun tsgo` and the Phase-2 test files; reconcile plan-vs-actual (D1–D12 decisions honored — especially D2 guarded shapes, D4 publish-after-commit, D6 extraction, D12 emitter locale).
  - Verify journey task 2.1 file exists and exercises the service end-to-end (green now that the service landed).
  - GATE: any drift ⇒ fix before Phase 3; record verdict in `ai/plans/sprint_3/dev3-018-cold-start-bootstrapping-direct-sheikh-c/outcome/2M-midpoint-gate-outcome.md`.
  - _Requirements: REQ-076, REQ-083_

---

## PHASE 3 — GraphQL Resolvers & API Handlers

- [x] 3.1 [Implement `adminCertifyTeacherColdStart` mutation — CREATE + barrel]
  - CREATE `backend/graphql/mutation/admin/admin-teachers.mutation.ts` with the single field per plan §3.2 verbatim: `type: AdminUserDetailPothosObject`; args `userId: t.arg({ type: "Int", required: true })`, `makeEvaluator: t.arg({ type: "Boolean", required: false, defaultValue: true })`; `authScopes: { $all: { authenticated: true, role: [UserRole.Admin] } }`; full description string as drafted in plan §3.2; resolver: `if (!ctx.user)` → `ctx.t("errorsTranslations")` → `UnauthorizedError`; delegate `ColdStartCertificationService.certifyTeacherColdStart(ctx.user.id, { userId: args.userId, makeEvaluator: args.makeEvaluator }, ctx.locale)`. Field-by-field mapping ONLY (REQ-033); NO try/catch (DomainErrors propagate to the finalizer — REQ-053); NO new Pothos object/input types.
  - UPDATE `backend/graphql/mutation/admin/index.ts` — add ONE line `import "./admin-teachers.mutation";`.
  - DO NOT touch `PUBLIC_OPERATIONS` (`backend/lib/gateway/public-operations.ts` stays the frozen six).
  - Instruction files: `.agents/instructions/backend.instructions.md`
  - [x] 3.1.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts backend/graphql/mutation/admin/admin-teachers.mutation.ts --lifecycle duplicates` (exit 0); barrel same.
  - [x] 3.1.TE **Test Engineering**: covered by task 3.3 wire matrix — this task's gate is compile + registration (schema builds; introspection shows exactly one new field).
  - [x] 3.1.SEC **Security & Tenancy Audit**: `$all` conjunction VERBATIM (ANY-semantics hazard — cite `docs/teachers/applicant-lifecycle.md` §3 in code comment only if consistent with sibling style); `ctx.user.id` actor sourcing; BOPLA closed mapping.
  - [x] 3.1.SR **Semantic Review**: thin resolver (guard+delegate); no business logic at the resolver; no local types; canonical input type binding.
  - [x] 3.1.IV **Instruction Verification**: `.agents/instructions/backend.instructions.md` validated.
  - _Requirements: REQ-030, REQ-033, REQ-050, REQ-060_

- [x] 3.2 [Codegen + frozen-baseline re-pin — SAME change set]
  - Run `bun run generate:gqlSchema && bun codegen`; commit regenerated `frontend/graphql/generated/**` artifacts in the SAME change set.
  - UPDATE `backend/graphql/test/sdl-static-assertions.test.ts` — `FROZEN_MUTATION_FIELDS` gains `"adminCertifyTeacherColdStart"` (sorted).
  - UPDATE `backend/graphql/test/schema-surface.test.ts` — `PRE_3_1_MUTATION_FIELDS` re-pinned per plan §3.5 reconciliation rule: current LIVE inventory PLUS the new field (the bundle's frozen arrays visibly lag the live tree — `sdl-static-assertions.test.ts` `FROZEN_MUTATION_FIELDS` omits the already-shipped `adminCreateUser`/`adminUpdateUser`/`adminSetUserDeleted` AND `createPlan`/`updatePlan`/`setPlanActiveStatus`, its `FROZEN_QUERY_FIELDS` omits the shipped admin queries, and `schema-surface.test.ts` `PRE_3_1_MUTATION_FIELDS` omits the three admin mutations; re-pin to reality, never shrink to the stale view).
  - VERIFY untouched-green: `bun run test/scripts/run-test.ts backend/graphql/test/handshake-code-surface.test.ts` (frozen-six public allowlist unchanged) and the committed-vs-live SDL byte-parity check (`plan-catalog.schema.test.ts` precedent).
  - [x] 3.2.QL **Quality Loop**: sub-loop on both edited test files + regenerated artifact dirs (exit 0).
  - [x] 3.2.TE **Test Engineering**: `bun run test/scripts/run-test.ts backend/graphql/test/schema-surface.test.ts` + `sdl-static-assertions.test.ts` green with the new pins.
  - [x] 3.2.SR **Semantic Review**: re-pin is additive/sorted; no unrelated fields dropped silently (justify every baseline delta in the outcome); generated files committed (not stashed).
  - _Requirements: REQ-061_

- [x] 3.3 [GraphQL wire matrix — REQ-073]
  - CREATE/EXTEND the wire suite for the new mutation: `backend/graphql/test/admin-teachers.mutation.test.ts` (in-process `graphql()` execution; `setupTestServerLifecycle` + `testClient` variants where the port lifecycle allows).
  - Assertions: anonymous ⇒ `UNAUTHORIZED` (pre-resolver); authenticated student/teacher/parent ⇒ `FORBIDDEN` pre-resolver via the role scope; governed admin with live token ⇒ service-tier `FORBIDDEN`; happy-path payload shape — `id` selected, refreshed `teacher` snapshot visible in the SAME response; smuggled root args / extra fields ⇒ `GRAPHQL_VALIDATION_FAILED` pre-resolver; introspection pins the `$all` conjunction VERBATIM on the field; closed `extensions.code` surface per plan §3.3 table.
  - [x] 3.3.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts backend/graphql/test/admin-teachers.mutation.test.ts --lifecycle duplicates` (exit 0)
  - [x] 3.3.TE **Test Engineering**: Tiers 1/2 (each denial branch; malformed var shapes), Tier 4 (authN/authZ matrix complete; smuggling probes).
  - [x] 3.3.SEC **Security & Tenancy Audit**: BOPLA smuggle probes real; no identity bleed between contexts; tokens never logged.
  - [x] 3.3.SR **Semantic Review**: no prod-code changes inside tests; assertions name exact codes.
  - [x] 3.3.IV **Instruction Verification**: `.agents/instructions/tests.instructions.md` validated.
  - _Requirements: REQ-030, REQ-033, REQ-050, REQ-073_

---

## PHASE 4 — Frontend GraphQL Documents (DOCUMENT ONLY — no views, no stores, no browser loops)

- [x] 4.1 [Implement `adminCertifyTeacherColdStartMutationDocument` — CREATE document + barrel + contract test]
  - CREATE `frontend/graphql/sharedDocuments/admin/teacher-certification.documents.ts` with the EXACT document from plan §5.4: `TypedDocumentNode<AdminCertifyTeacherColdStartMutation, AdminCertifyTeacherColdStartMutationVariables>`, named operation `AdminCertifyTeacherColdStart`, selection set `id` FIRST then `role`, `isDeleted`, `suspended`, `isBlocked`, `applicant { id status }`, `teacher { isApproved isEvaluator isOnline averageRating }`, imports from `@apollo/client` + `@/frontend/graphql/generated/gql/graphql`.
  - UPDATE `frontend/graphql/sharedDocuments/admin/index.ts` — add `export * from "./teacher-certification.documents";`.
  - DO NOT touch: `frontend/graphql/sharedDocuments/index.ts` (already re-exports `./admin`, `frontend/graphql/sharedDocuments/index.ts:1`), `frontend/providers/apollo/apolloCache.ts` (identity type — no `keyFields` entry), `frontend/views/dashboard/navItems.ts` (D-UI), any page/view/component.
  - Applicable AGENTS.md (existence-verified): `frontend/graphql/sharedDocuments/AGENTS.md` if present in bundle (confirm in 0.2; otherwise `frontend/AGENTS.md`). NOTE: `frontend/views/AGENTS.md` and `frontend/components/ui/AGENTS.md` do NOT exist — never cite them.
  - [x] 4.1.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts frontend/graphql/sharedDocuments/admin/teacher-certification.documents.ts --lifecycle duplicates` (exit 0); barrel same.
  - [x] 4.1.TE **Test Engineering** — CREATE `frontend/graphql/sharedDocuments/admin/teacher-certification.documents.test.ts` mirroring `plan-catalog.documents.test.ts`: pins named operation, exact variable set `{userId, makeEvaluator}`, `id`-first selection, barrel-identity (top-level barrel re-exports the SAME instance — cache-key safety precedent `sharedDocuments/documents.contract.test.ts`). Run: `bun run test/scripts/run-test.ts frontend/graphql/sharedDocuments/admin/teacher-certification.documents.test.ts`
  - [x] 4.1.BF **Agent-Browser Functional Self-Loop** — **N/A (explicit, recorded)**: REQ-063 ships ZERO markup; no page exists to drive. Rationale recorded in `outcome/4.1-outcome.md`. The D-UI follow-up owns both browser loops.
  - [x] 4.1.BS **Agent-Browser Visual Self-Loop** — **N/A (explicit, recorded)**: no UI renders; D-UI forward constraint REQ-064 carries the MUI v9/RTL/touch-target rules to the owning ticket.
  - [x] 4.1.SR **Semantic Review**: generated-type imports only; operation name matches the backend field contract; document registered through the barrel (NOT imported deep by future consumers); no duplicate document of the same operation exists anywhere.
  - [x] 4.1.IV **Instruction Verification**: `.agents/instructions/frontend.instructions.md` validated.
  - _Requirements: REQ-062, REQ-063, REQ-064_

---

## PHASE 5 — Integration & Differential Testing

- [x] 5.1 [Chaos & concurrency tier — REQ-072]
  - CREATE/EXTEND `backend/services/admin/cold-start-certification.chaos.test.ts`:
    - (a) Concurrent double-certify, SAME target (row-absent path): `Promise.allSettled` ⇒ exactly one fulfillment + one `TEACHER_ALREADY_CERTIFIED`; DB oracle: ONE `teacher` row, ONE audit row TOTAL, ONE notification row TOTAL. Repeat over the elevation path (pre-existing unapproved row).
    - (b) Forced mid-transaction failure: spy-injected repo failure on the finalize stage ⇒ zero residue across `teacher`/`applicants`/`audit_logs`/`notifications`; spied transport proofs ZERO publishes (REQ-041).
    - (c) Hostile `userId` fuzz: `0, -1, 1.5, NaN, 2^53` ⇒ `VALIDATION` code class, pre-DB (transaction-count proof).
    - (d) 25-way parallel certify storm over DISTINCT targets ⇒ all-fulfilled with per-target correctness; honor `skip-when-pglite` convention.
  - `runInRollback` discipline for single-threaded assertions; committed-fixture + tracked-teardown style ONLY where true cross-transaction concurrency demands it (journeys convention).
  - [x] 5.1.QL **Quality Loop**: sub-loop on the chaos test file (exit 0).
  - [x] 5.1.TE **Test Engineering**: every REQ-072 sub-requirement maps to ≥1 assertion; totals-based oracles (COUNT queries) used for races.
  - [x] 5.1.SR **Semantic Review**: no flakiness by design (races resolved by constraints, not sleeps); provider-gated skips documented.
  - **Run**: `bun run test/scripts/run-test.ts backend/services/admin/cold-start-certification.chaos.test.ts`
  - _Requirements: REQ-041, REQ-042, REQ-072_

- [x] 5.2 [Cross-entity purity oracle + devil's-advocate differential run — REQ-020]
  - Extend service tests (5.x assertions live in `backend/services/admin/cold-start-certification.service.test.ts` or the chaos file): snapshot COUNTs of `users`, `wallet`, `subscriptions`, `plans`, `session`, `teacher_transaction`-adjacent tables before/after a successful certification ⇒ UNCHANGED; only `teacher`/`applicants`/`audit_logs`/`notifications` move.
  - Run the FULL affected sweep green: `bun run test/scripts/run-test.ts backend/services/admin`, `bun run test/scripts/run-test.ts backend/db/repo/teachers`, `bun run test/scripts/run-test.ts backend/graphql/test`, `bun run test/scripts/run-test.ts shared/locale`, `bun run test/scripts/run-test.ts frontend/graphql`, `bun run test/scripts/run-test.ts test/workflows/admin/cold-start-certification.journey.test.ts`.
  - Verify DEV3-016 regression locks unchanged-green (service 61 + chaos 3 suites).
  - [x] 5.2.SR **Semantic Review**: no test weakened to pass; every failure is fixed in implementation, not in the assertion.
  - _Requirements: REQ-020, REQ-070..REQ-076 (070-076)_

- [x] 5.3 [End-state gates — baseline delta, zero-drift, ledger, hygiene]
  - `bun tsgo`, `bun biome:check`, `bun run scripts/lint-service.ts` — deltas vs task-0.1 baseline MUST be ZERO new errors; record both vectors.
  - `git diff --name-only -- backend/db/schema/** backend/db/migration/**` MUST be EMPTY (REQ-045) — assert and paste output.
  - `grep -c "❌\|⚠️" ai/plans/sprint_3/dev3-018-cold-start-bootstrapping-direct-sheikh-c/deferred-items.md` MUST equal `0` (all D-* entries RESOLVED-REFERENCE with owning tickets).
  - `console.*` sweep over every created/modified file MUST be empty.
  - Record everything in `ai/plans/sprint_3/dev3-018-cold-start-bootstrapping-direct-sheikh-c/outcome/5.3-endgates-outcome.md`.
  - _Requirements: REQ-001, REQ-034, REQ-045, REQ-076_

---

## PHASE 6 — Post-Implementation Review Waves (parallel, then reconcile)

- [x] 6.1 [Wave A — review-types]
  - Review ALL type/locale deltas: `backend/types/teachers/teacher.types.ts`, `shared/locale/types/{errors,applicant}/index.ts`, four locale content files. Checklist: canonical placement; readonly contracts; flat `ErrorsLabels` convention; no namespace procreation; parity across `en`/`ar`.
  - Output findings to `outcome/6.1-review-types-outcome.md`; fix-forward or ledger each finding.
  - _Requirements: REQ-002, REQ-003, REQ-051_

- [x] 6.2 [Wave B — review-backend]
  - Review: `teacher.repository.ts`, `applicant.repository.ts` delta, `admin-gate.helpers.ts`, `cold-start-certification.service.ts`, `admin-teachers.mutation.ts`, both barrel edits. Checklist: D1–D12 decision conformance; tx propagation to EVERY call; guarded-write shapes (D2); publish-after-commit (D4); audit single-writer + D8 shape; JR-C-1 denial purity; silent happy path; closed error taxonomy.
  - Output findings to `outcome/6.2-review-backend-outcome.md`.
  - _Requirements: REQ-004, REQ-010..REQ-020, REQ-031..REQ-034, REQ-040..REQ-045, REQ-050..REQ-053_

- [x] 6.3 [Wave C — review-frontend]
  - Review: `teacher-certification.documents.ts` + barrel + contract test. Checklist: codegen-type imports; id-first selection; operation-name match with backend field; no UI/codegen drift; `apolloCache.ts` untouched.
  - Output findings to `outcome/6.3-review-frontend-outcome.md`.
  - _Requirements: REQ-062, REQ-063_

- [x] 6.4 [Wave D — pentester lens]
  - Adversarial review against plan §6 threat table: BFLA (`$all` + service re-check both present and pre-DB), governance window closure (REQ-031 divergence documented and enforced), BOLA/IDOR actor sourcing, BOPLA closed mapping, SQLi (parameter binding; no string concat; no inline `--`), PII-free audit/details/logs, oracle-ruling scoping (`USER_NOT_FOUND` admin-surface-only), error masking single point.
  - Attempt-at-least probes via the wire suite findings (task 3.3): confirm smuggling, governed-actor, and replay probes all deny correctly.
  - Output findings to `outcome/6.4-pentester-outcome.md`.
  - _Requirements: REQ-030..REQ-035, REQ-073_

- [x] 6.5 [Reconciliation + deferred-items final check]
  - Consolidate ALL wave findings; every finding is either FIXED (with re-verification evidence) or carried into `deferred-items.md` as a RESOLVED-REFERENCE with an owning ticket.
  - Final ledger gate: `grep -c "❌\|⚠️" ai/plans/sprint_3/dev3-018-cold-start-bootstrapping-direct-sheikh-c/deferred-items.md` = 0.
  - Re-run the full Phase-5 test sweep once after any fix-forward.
  - Record in `outcome/6.5-reconciliation-outcome.md`.
  - _Requirements: REQ-076_

---

## PHASE 7 — Knowledge Propagation & Documentation

- [x] 7.1 [Canonical doc — CREATE `docs/admin/cold-start-certification.md`]
  - Contents (mandatory sections per REQ-080): mutation contract + `makeEvaluator` committee semantics (FR-3.9); create-vs-elevate decision rule (D2); applicants-finalize rule (pass ⇒ cooldown cleared; supersession rationale); override-audit shape (D8 JSON + JR-C-1 denial purity); cross-entity purity envelope (REQ-020); actor-governance blast-radius divergence (REQ-031/D1 — documented divergence from the role-only gate); concurrency rulings (REQ-042 PK/row-lock mechanisms; explicit non-usage: no SELECT FOR UPDATE / advisory locks / Redis); idempotency ruling (REQ-043 conflict-not-keys); error-code table (§3.3 verbatim); What-NOT-To-Do list (never a second certification writer; never unset `cooldown_until` semantics elsewhere; never route through the purchase/evaluation lifecycle; never widen beyond admin callers; never re-litigate the emitter-locale rule inline).
  - [x] 7.1.QL **Quality Loop**: sub-loop on the doc file (exit 0).
  - _Requirements: REQ-080_

- [x] 7.2 [Inbound/outbound doc reconciliation — one-line pointers ONLY]
  - UPDATE `docs/admin/user-management.md` §6: DEV3-018 scope-split row gains a one-line SHIPPED pointer to `docs/admin/cold-start-certification.md` (NO renumbering, NO invariant re-litigation).
  - UPDATE `docs/teachers/applicant-lifecycle.md` §6 consumer table: "Direct admin onboarding" row gains a one-line link to the new canonical doc.
  - VERIFY untouched: `docs/specs/open-decisions-and-gaps.md` and `docs/specs/state-machine-invariants.md` MUST show zero diff (`git diff -- docs/specs/` empty) — this ticket mints no decisions/invariants.
  - [x] 7.2.QL **Quality Loop**: sub-loop on both edited docs (exit 0).
  - _Requirements: REQ-081_

- [x] 7.3 [AGENTS.md propagation — rule lines ONLY, no code]
  - UPDATE `backend/services/AGENTS.md`: ONE rule line — cold-start certification is the single writer of the certified-state (`is_approved=true`) path outside the evaluation loop; governed by `docs/admin/cold-start-certification.md`.
  - UPDATE `backend/db/repo/AGENTS.md`: ONE line for the NEW `TeacherRepository` (teachers-domain governed-write repo: insert + guarded elevate ONLY; no other teacher-table writers).
  - UPDATE root `AGENTS.md` Important References: ONE line for `docs/admin/cold-start-certification.md`.
  - [x] 7.3.QL **Quality Loop**: sub-loop on each edited AGENTS.md (exit 0).
  - [x] 7.3.IV **Instruction Verification**: only AGENTS.md files that exist in the bundle are edited; no new instruction files invented.
  - _Requirements: REQ-082_

- [x] 7.4 [Outcome synthesis & ticket closure]
  - Write `ai/plans/sprint_3/dev3-018-cold-start-bootstrapping-direct-sheikh-c/outcome/FINAL-outcome.md`: full task checklist snapshot (all `[x]`), baseline-vs-final gate table (tsgo/biome/lint/zero-drift/ledger), test inventory with commands + results, deferred-items final state (all RESOLVED-REFERENCE), deviations ledger (empty expected), and downstream-consumption notes (DEV2-006 committee availability; DEV3-020 audit read-back; DEV3-022c/022d gate sharing).
  - Final verification pass: every task's `outcome/<task-id>-outcome.md` exists; every checkbox is `[x]`; ALL Phase 5 commands re-verified green in ONE final run.
  - _Requirements: REQ-076, REQ-083_

---

## COMPLETION DEFINITION (ALL must hold)

- [x]-equivalent acceptance state when: Journey J-1 green end-to-end; closed error surface (`UNAUTHORIZED`, `FORBIDDEN`, `USER_NOT_FOUND`, `TEACHER_ROLE_REQUIRED`, `TEACHER_ACCOUNT_GOVERNED`, `TEACHER_ALREADY_CERTIFIED`, `VALIDATION`) each test-pinned; `$all` conjunction introspection-pinned; codegen artifacts committed alongside baseline re-pins; `git diff -- backend/db/schema/** backend/db/migration/**` EMPTY; tsgo/biome/lint deltas ZERO vs baseline; `grep -c "❌\|⚠️" ai/plans/sprint_3/dev3-018-cold-start-bootstrapping-direct-sheikh-c/deferred-items.md` = 0; `docs/admin/cold-start-certification.md` exists; AGENTS propagation lines present; DEV3-016 regression suites unchanged-green.
```
