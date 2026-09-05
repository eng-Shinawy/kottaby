# Trackable Implementation Tasks — DEV3-017 Account Soft-Delete Governance (users.is_deleted)

# tasks.md — DEV3-017 Account Soft-Delete Governance (users.is_deleted)

> **Plan directory (verbatim — every header, ledger path, outcome path, and self-reference in this document uses this exact string):** `ai/plans/sprint_3/dev3-017-account-soft-delete-governance-usersis-d`
> **Specs of record:** `ai/plans/sprint_3/dev3-017-account-soft-delete-governance-usersis-d/specs.md` (REQ-001..REQ-095)
> **Plan of record:** `ai/plans/sprint_3/dev3-017-account-soft-delete-governance-usersis-d/plan.md` (D1..D12)
> **Property-Based Testing notes:** This ticket carries no property-based libraries; invariant coverage is expressed as branch matrices, chaos single-winner proofs, and row-count/count-oracle assertions per REQ-070..075.

---

## Non-Negotiable Execution Protocol (MANDATORY for EVERY task)

1. **Pre-Execution Outcome Knowledge Read (MANDATORY):** BEFORE starting any task, read ALL existing files under `ai/plans/sprint_3/dev3-017-account-soft-delete-governance-usersis-d/outcome/`. Incorporate every prior decision, discovered hazard, baseline count, and ledger entry into the current task's execution. Never re-litigate a resolved item; never contradict a recorded ruling without a new ledger entry.
2. **Post-Edit Verification (MANDATORY):** after EVERY file creation/modification, run `bun run scripts/health/sub-loop.ts <file-path> --lifecycle duplicates` and require exit code 0 before proceeding.
3. **Test Execution (MANDATORY):** run test files ONLY via `bun run test/scripts/run-test.ts <test-path>` (NEVER raw `bun test` — it skips `--env-file=.env.test`).
4. **Semantic Review Self-Check (MANDATORY):** before marking a task complete, self-review against the semantic checklist: atomicity of writes, env-config discipline, ZERO dead code, NO cross-layer imports (`shared/` never imports `@/frontend/**`/`@/backend/**`/`@/app/**`), enums as VALUE imports, `DomainError`-only taxonomy, `logger` only (never `console.*`), field-by-field DTO construction (no `{ ...input }`), i18n via the sanctioned channel per layer.
5. **Outcome Documentation (MANDATORY):** after completing a task, write `ai/plans/sprint_3/dev3-017-account-soft-delete-governance-usersis-d/outcome/<task-id>-outcome.md` capturing: what was done, files touched, verification evidence (commands + results), deviations, hazards discovered, and ledger updates.
6. **Checkbox Tracking (MANDATORY):** tick `[ ]` → `[x]` on the task line AND each completed subtask line immediately upon completion.

---

## Phase 0: Pre-Implementation Baseline

- [x] 0.1 [Record baseline error counts & initialize deferred-items ledger]
  - Record baseline counts: `bun tsgo` (capture exit + error count), `bun run biome:check` (capture count), and the lint service count — write all three into the baseline outcome.
  - Capture the pre-existing modified-file set: `git diff --name-only` output recorded verbatim in the outcome.
  - Initialize `ai/plans/sprint_3/dev3-017-account-soft-delete-governance-usersis-d/deferred-items.md` from `.agents/spec-process-guide/templates/deferred-items-template.md`, PRE-SEEDED with the seven resolved-pointer rows from plan.md §Deferred-Items Ledger Pointers (D1 lapse sweep, D2 session-creation predicate consumption, D3 governance-notification, D4 DEV3-016 strict-guard backport ownership, D5 context-boundary governance gate, D6 audit_vocabulary widening, D7 SSR test seam) — ALL as resolved-pointer status, ZERO ❌/⚠️ markers.
  - Write `ai/plans/sprint_3/dev3-017-account-soft-delete-governance-usersis-d/outcome/0-baseline-outcome.md` with counts, diff set, and ledger-initialization confirmation.
  - _Requirements: REQ-001_

- [x] 0.2 [Verify reuse substrate & conditional-shape probes (Reuse-Not-Rebuild guard)]
  - Verify-then-claim against the LIVE tree (read the files, record `path:line` anchors in the outcome):
    - `AdminUserRepository.setDeletedOnce` NULL-safe guarded UPDATE + RETURNING (`backend/db/repo/admin/admin-user.repository.ts:627-647`) and its zero-row classifier consumption.
    - `AuditService.createAuditLog(input, tx)` (`backend/services/admin/audit.service.ts:82-90`) and the private `buildAuditContract` closure inside `user-management.service.ts`.
    - `AdminUserManagementService.setUserDeleted` (`backend/services/admin/user-management.service.ts:972-1028`) incl. the self-protection placement (lines 988-996) and `getUserDetail` composition (lines 809-833).
    - `assertUserActive` (`backend/services/auth/auth.service.ts:91-98`) and its call sites (login ~line 156, refreshToken ~line 244); SSR gate (`backend/lib/auth/server-auth.ts:99-106`).
    - `isGovernanceExcludedFromDiscovery` suspended-branch math (`backend/services/students/student-handshake.helpers.ts:39-59`) — the extraction source of truth.
    - `AuditActionType.Suspend`/`Reactivate` members (`backend/enum/audit/audit-action-type.enum.ts:12-13`); `audit_action_type` pgEnum inventory (`backend/db/schema/enums.ts:66-74`).
    - `withTransaction` (`backend/lib/db/with-transaction.ts` — anchor via its import at `user-management.service.ts:67`); `withAuditDeleteTriggersSuspended` (`test/helpers/db-cleanup.ts:83-109`); journey harness presence (`test/workflows/AGENTS.md`, `test/workflows/helpers/`).
    - `AdminUserDetailPothosObject` governance fields (`backend/graphql/pothos/admin/admin-user.pothos.ts:235-300`); `AdminUserDetailFields` fragment `id`-first (`frontend/graphql/sharedDocuments/admin/admin-users.documents.ts:50-103`); existing error keys `accountDeleted/accountBlocked/accountSuspended` (`shared/locale/en/errors/index.ts:17-19`, ar twin).
    - Frontend container VERIFY: `app/(dashboard)/admin/users/[id]/page.tsx` and `frontend/views/admin/users/AdminUserDetailContainer.tsx` are CONFIRMED on disk — read the container's internal structure and props BEFORE editing (update-in-place; if the container's shape diverges from expectation, record a ⚠️ hazard in the outcome and scope task 4.3 accordingly).
    - `admin-guards.helpers.ts` CONDITIONAL: record PRESENT/ABSENT. If PRESENT, record whether its strict variant (if any) evaluates `suspended` as plain flag or via a window predicate (drives task 2.2's consume vs upgrade path).
  - Verify schema-surface baseline freshness: empirically compare `printSchema(lexicographicSortSchema(graphQLSchema))` Mutation/Query roots against `backend/graphql/test/schema-surface.test.ts` and `backend/graphql/test/sdl-static-assertions.test.ts` inventories; record STALE or CURRENT (drives task 4.3's reconcile-then-extend branch).
  - IF any reuse artifact is missing → record a ❌ ledger entry in `ai/plans/sprint_3/dev3-017-account-soft-delete-governance-usersis-d/deferred-items.md` and BLOCK dependent tasks — never fork a second writer/guard/transition engine.
  - _Requirements: REQ-004, REQ-020, REQ-061_

- [x] 0.3 [Phase 1.5 Plan-Review Gate]
  - Invoke `@plan-review` over the complete plan trio (`specs.md`, `plan.md`, `tasks.md`) for `ai/plans/sprint_3/dev3-017-account-soft-delete-governance-usersis-d/`.
  - Resolve ALL findings (no silent skips); iterate until the review passes clean.
  - Write `ai/plans/sprint_3/dev3-017-account-soft-delete-governance-usersis-d/outcome/plan-review-R1.md` with the verdict, findings, and resolutions.
  - GATE: implementation (Phases 1–6) MUST NOT begin until this outcome file exists with a passing verdict.
  - _Requirements: REQ-083_

---

## Phase 1: Types, Enums & Shared Predicate Foundation

> Schema work is scope-excluded by REQ-045 (zero schema drift). This phase carries ONLY the canonical-type addition, the shared predicate module, its unit matrix, and the refactor-consumption — the foundation every later layer depends on.

- [x] 1.1 [Add `GovernanceProbeRowType` to canonical admin types]
  - Modify `backend/types/admin/admin-user.types.ts` (EXISTING — add ONE interface, nothing else):
    ```typescript
    export interface GovernanceProbeRowType {
      readonly isDeleted: boolean | null;
      readonly suspended: boolean | null;
      readonly suspendedAt: Date | null;
      readonly suspendedPeriodDays: number | null;
      readonly isBlocked: boolean | null;
    }
    ```
  - Confirm the barrel `backend/types/admin/index.ts:1` re-exports it automatically (verify only — do not edit if already wildcard-exporting).
  - NO new input/submit types; NO new ReturnType; NO service-layer `.types.ts` file anywhere.
  - Applicable instruction files: `.agents/instructions/backend.instructions.md`.
  - _Requirements: REQ-003_
  - [ ] 1.1.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts backend/types/admin/admin-user.types.ts --lifecycle duplicates` (exit code 0) + `bun tsgo` clean on the file.
  - [ ] 1.1.TE **Test Engineering**: type-level only — covered transitively by repo/service tiers (tsgo is the gate).
  - [ ] 1.1.SEC **Security & Tenancy Audit**: the probe row type carries ZERO PII columns (no email/phone/name/passwordHash) — confirm by inspection.
  - [ ] 1.1.SR **Semantic Review**: canonical placement only; readonly fields; no duplicated shape elsewhere.
  - [ ] 1.1.IV **Instruction Verification**: validate against `.agents/instructions/backend.instructions.md`.

- [x] 1.2 [Create shared suspension-window predicate `backend/lib/auth/suspension-window.ts`]
  - CREATE `backend/lib/auth/suspension-window.ts` — pure runtime module exporting:
    ```typescript
    export function isSuspensionActive(
      state: { readonly suspended: boolean | null; readonly suspendedAt: Date | null; readonly suspendedPeriodDays: number | null },
      now: Date
    ): boolean
    ```
  - EXACT semantics (extracted from `student-handshake.helpers.ts:39-59`): `suspended` falsy → `false`; `suspendedAt` missing OR `suspendedPeriodDays` missing OR `≤ 0` → `true` (fail-CLOSED); otherwise `suspendedAt.getTime() + suspendedPeriodDays × 86_400_000 > now.getTime()` (STRICT `>` — an expiry landing exactly on `now` has LAPSED).
  - ZERO imports beyond inline types; no logging; no side effects; pure function.
  - Instruction files: `.agents/instructions/backend.instructions.md`.
  - _Requirements: REQ-017_
  - [ ] 1.2.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts backend/lib/auth/suspension-window.ts --lifecycle duplicates` (exit 0).
  - [ ] 1.2.TE **Test Engineering**: NEW `backend/lib/auth/suspension-window.test.ts` — branch matrix: (a) not suspended (`false`, `null`) → false; (b) suspended + missing `suspendedAt` → true; (c) suspended + missing `suspendedPeriodDays` → true; (d) suspended + `periodDays = 0` → true; (e) suspended + negative `periodDays` → true; (f) active window (now inside) → true; (g) EXACT boundary (`now === suspendedAt + days`) → false (lapsed); (h) fully lapsed → false. Source pins: static grep-style assertions in the suite proving BOTH `backend/services/auth/auth.service.ts` and `backend/lib/auth/server-auth.ts` import `isSuspensionActive` (enforced after task 3.2 lands — the pins live here, green once 3.2 completes; author them as TODO-guarded or land 1.2.TE re-run at 3.2 completion — recorded in outcome).
  - [ ] 1.2.SEC **Security & Tenancy Audit**: fail-closed bias confirmed — NO input shape widens access; corrupt data always denies.
  - [ ] 1.2.SR **Semantic Review**: pure function, no hidden Date construction leaks, `MS_PER_DAY` single source, zero dead code.
  - [ ] 1.2.IV **Instruction Verification**: `.agents/instructions/backend.instructions.md`.

- [x] 1.3 [Refactor `student-handshake.helpers.ts` to consume the shared predicate]
  - Modify `backend/services/students/student-handshake.helpers.ts` (lines 3-18): keep the isDeleted/isBlocked pre-checks; REPLACE ONLY the inline window math with `isSuspensionActive({ suspended, suspendedAt, suspendedPeriodDays }, new Date())`.
  - Behavior-preserving: NO semantic delta — the existing suite IS the regression net.
  - Instruction files: `.agents/instructions/backend.instructions.md`.
  - _Requirements: REQ-017, REQ-072_
  - [ ] 1.3.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts backend/services/students/student-handshake.helpers.ts --lifecycle duplicates` (exit 0).
  - [ ] 1.3.TE **Test Engineering**: run `bun run test/scripts/run-test.ts backend/services/students/student-handshake.service.test.ts` — MUST stay byte-green with ZERO edits beyond the helper import (any required edit ⇒ STOP and investigate; the refactor is wrong).
  - [ ] 1.3.SEC **Security & Tenancy Audit**: INV-U2 read-side semantics unchanged; fail-closed bias preserved.
  - [ ] 1.3.SR **Semantic Review**: no residual duplicated window math; import hygiene.
  - [ ] 1.3.IV **Instruction Verification**: `.agents/instructions/backend.instructions.md`.

- [x] 1.4 [Add localized error keys — `errorsTranslations.adminUsers` group, both locales]
  - Modify `shared/locale/types/errors/index.ts` (EXISTING flat-group shape at lines 36-44): add to the `adminUsers` group EXACTLY: `userAlreadySuspended`, `userNotSuspended`, `userAlreadyBlocked`, `userNotBlocked`, `userSelfSuspensionForbidden`, `userSelfBlockForbidden`, `suspensionPeriodInvalid`.
  - Modify `shared/locale/en/errors/index.ts` and `shared/locale/ar/errors/index.ts`: implement the seven keys in BOTH locales (Arabic slots carry Arabic script); NO new namespace; NO new top-level `ErrorsLabels` group; actor-governance denials REUSE existing flat `accountDeleted/accountBlocked/accountSuspended`.
  - Machine code ↔ key bijection: `USER_ALREADY_SUSPENDED`↔`userAlreadySuspended`, `USER_NOT_SUSPENDED`↔`userNotSuspended`, `USER_ALREADY_BLOCKED`↔`userAlreadyBlocked`, `USER_NOT_BLOCKED`↔`userNotBlocked`, `USER_SELF_SUSPENSION_FORBIDDEN`↔`userSelfSuspensionForbidden`, `USER_SELF_BLOCK_FORBIDDEN`↔`userSelfBlockForbidden`, `periodDays` validation ↔`suspensionPeriodInvalid`.
  - Instruction files: `.agents/instructions/backend.instructions.md` (shared-layer edits follow its i18n section); verify `shared/AGENTS.md` namespace checklist — this is an EXISTING-namespace key addition, not a new registration.
  - _Requirements: REQ-002, REQ-051_
  - [ ] 1.4.QL **Quality Loop**: sub-loop `--lifecycle duplicates` on all three touched files (exit 0) + `bun tsgo` green (typed-leaf parity forces both locales at compile time).
  - [ ] 1.4.TE **Test Engineering**: run the existing translation-parity suite(s) (`bun run test/scripts/run-test.ts` on the shared locale parity tests) — en/ar leaf parity MUST stay green.
  - [ ] 1.4.SEC **Security & Tenancy Audit**: N/A (copy only).
  - [ ] 1.4.SR **Semantic Review**: flat-group discipline; no nested restructure; no hardcoded usage yet.
  - [ ] 1.4.IV **Instruction Verification**: validate against `shared/AGENTS.md` + the auto-discovered instruction files from sub-loop output.

---

## Phase 2: Repositories & Backend Services

> Phase 2.M Mid-Point Review Gate fires after task 2.4 and BEFORE Phase 3.

- [x] 2.1 [Write account-governance journey test — TEST-FIRST (before any service surface)]
  - Create `test/workflows/admin/account-governance.journey.test.ts` — one file for the Workflow 05 §5 cross-actor lifecycle (specs §2.9, steps 1-11). `test/workflows/` harness EXISTS (verified in 0.2): reuse `test/workflows/helpers/` + `test/workflows/AGENTS.md` rules; only ADD a per-domain cast helper `test/workflows/helpers/admin-governance-cast.ts` if the cast shape (Admin A/B, Teacher T, Governed Admin G, registered Student S) is not already expressible — record either choice in the outcome.
  - Actor provisioning (committed in `beforeAll`, tracked IDs, hard-delete in `afterAll`): Admin A & Admin B via `createTestUser` + `createTestAdmin` (REAL permission/role rows — NEVER monkey-patched); Teacher T via the REAL `RegistrationService.registerUser` teacher branch; Governed Admin G = admin row + `isBlocked: true`; Student S via REAL `registerUser` with a recorded password. Unique prefix `jrn_gov_<uuid8>`. ZERO `runInRollback` around service calls (services spawn their own transactions).
  - Sequential actor-attributed steps (each = service call with `actorUserId` → shared-state assertion → cross-actor visibility assertion → side-effect oracles):
    1. Fixtures committed (all five actors).
    2. A suspends S (7 days) → `users(S)` columns set; EXACTLY ONE `audit_logs` row (`Suspend`, `entityType "user"`, `entityId S.id`, `actorId A`).
    3. S calls `AuthService.login(S.email, password)` → `ForbiddenError` (active suspension denies); B observes detail + the ONE audit row attributed to A.
    4. A unsuspends S → three columns cleared; ONE `Reactivate` audit row; S's login SUCCEEDS.
    5. A blocks S → `isBlocked/blockedAt` set; ONE `Suspend`-mapped audit row (REQ-011 mapping, `changedFields: [isBlocked, blockedAt]`); S's login → `ForbiddenError` (NO lapse semantics).
    6. A unblocks S → ONE `Reactivate` audit row; login succeeds.
    7. A soft-deletes S via the EXISTING DEV3-016 `setUserDeleted` (consumed, never forked) → login denied; A then attempts suspend on DELETED S → `USER_ALREADY_DELETED` + ZERO new audit rows; A reactivates S (existing path) → login succeeds (full lifecycle loop).
    8. Fixture-write S into a LAPSED suspension (`suspended=true`, `suspendedAt = now−10d`, `periodDays = 7` via direct fixture update) → S's login SUCCEEDS; columns BYTE-IDENTICAL before/after (REQ-019 zero-write proof); B's detail read still shows the window fields; A unsuspends S → columns cleared under audit.
    9. Denial battery: S (non-admin) calls `setUserSuspended` → `ForbiddenError` zero writes; A self-targets → `USER_SELF_SUSPENSION_FORBIDDEN` zero writes/zero audit; A re-suspends active S → `USER_ALREADY_SUSPENDED`; A unsuspends a clean user → `USER_NOT_SUSPENDED`; Governed Admin G calls governance → strict-guard `ForbiddenError`; `actorId = 0` (anonymous) → `UnauthorizedError`.
    10. Teacher T control: `users(T)` + `applicants(T)` rows byte-identical across the whole journey (cross-role containment, REQ-015).
    11. Teardown: tracked hard-delete in FK-safe order via `withAuditDeleteTriggersSuspended` (`test/helpers/db-cleanup.ts:83-109`) + `deleteUsersByIds`; notifications row counts asserted unchanged; residue re-probes = 0.
  - Side-effect channel: ROW-COUNT oracles only (this surface emits ZERO notifications — D12; NO `SpiedFanoutTransport` wiring).
  - The journey MUST fail-red at authoring time (service surface absent) and turn green only after Phase 2/3 tasks land — that progression is recorded in the outcome.
  - Verify: `bun run test/scripts/run-test.ts test/workflows` (NEVER raw `bun test`).
  - Instruction files: `.agents/instructions/tests.instructions.md`, `test/workflows/AGENTS.md`.
  - _Requirements: REQ-090, REQ-091, REQ-092, REQ-093, REQ-094, REQ-095_

- [x] 2.2 [Create-or-consume shared admin guard module + strict window-aware variant]
  - Target: `backend/services/admin/admin-guards.helpers.ts`.
  - **Branch A (ABSENT — sibling DEV3-018 not landed):** CREATE the module via BEHAVIOR-PRESERVING extraction of the private `assertActorAdmin` (`user-management.service.ts:240-271`) — identical behavior; delete the private copy from `user-management.service.ts` and import the helper (DEV3-016's EXISTING methods keep RELAXED semantics — REQ-031; their existing suites are the byte-equivalence net). ADD:
    ```typescript
    export async function assertActiveActorAdmin(actorId: number, locale: string, outerTx?: DBTransaction): Promise<void>;
    ```
    composing the base check on the SAME fetched actor row (no second query), then deterministic-order denials: `isDeleted` → `ForbiddenError(tErrors.accountDeleted)`; `isBlocked` → `ForbiddenError(tErrors.accountBlocked)`; `isSuspensionActive({…}, new Date())` → `ForbiddenError(tErrors.accountSuspended)`; ONE `logger.logDomainError` ({ code: "FORBIDDEN", entity: "user", entityId }) per denial; ZERO writes, ZERO audit rows.
  - **Branch B (PRESENT):** consume it. If its strict variant evaluates `suspended` as a plain flag, UPGRADE it to `isSuspensionActive` in the SAME changeset and record the upgrade in the outcome (sibling suites are the net).
  - Instruction files: `.agents/instructions/backend.instructions.md`.
  - _Requirements: REQ-030, REQ-031_
  - [ ] 2.2.QL **Quality Loop**: sub-loop `--lifecycle duplicates` on `admin-guards.helpers.ts` AND `user-management.service.ts` (exit 0).
  - [ ] 2.2.TE **Test Engineering**: unit tier for `assertActiveActorAdmin` — active admin passes; deleted → `accountDeleted`; blocked → `accountBlocked`; actively suspended → `accountSuspended`; lapsed suspension PASSES (window honesty); deterministic-order precedence proofs (deleted+blocked actor yields `accountDeleted`); relaxed `assertActorAdmin` byte-behavior preserved (run DEV3-016's existing user-management service suite green — zero edits). Framework: `runInRollback` + service-call pattern; 4-Tier framing (statement/branch coverage, boundary on the order-of-checks, chaos = n/a here, security = denial taxonomy).
  - [ ] 2.2.SEC **Security & Tenancy Audit**: BFLA service-side second line verified; denial copy keys are the EXISTING flat keys only; ZERO audit rows on denial (JR-C-1).
  - [ ] 2.2.SR **Semantic Review**: single canonical admin-gate home; no private copy survives; `DomainError` subclasses only; `logger` only.
  - [ ] 2.2.IV **Instruction Verification**: `.agents/instructions/backend.instructions.md` + auto-discovered AGENTS.md from sub-loop.

- [x] 2.3 [Extend `AdminUserRepository` — guarded governance transitions + classifier probe]
  - Modify `backend/db/repo/admin/admin-user.repository.ts` (EXTEND — mirror `setDeletedOnce` at lines 627-647):
    - `setSuspendedOnce(id, target: boolean, periodDays: number | null, tx: DBTransaction): Promise<AdminUserSafeSelect | null>` — NULL-safe guarded single statement; suspend direction sets `suspended=true, suspended_at=now, suspended_period_days=<periodDays>, updated_at=now` guarded by `(suspended = false OR suspended IS NULL) AND (is_deleted = false OR is_deleted IS NULL)`; unsuspend direction clears ALL THREE to `false/NULL/NULL` guarded by `suspended = true AND (is_deleted = false OR is_deleted IS NULL)`; `RETURNING <SAFE_USER_SELECT>`.
    - `setBlockedOnce(id, target: boolean, tx): Promise<AdminUserSafeSelect | null>` — block sets `is_blocked=true, blocked_at=now, updated_at=now` guarded by `(is_blocked = false OR is_blocked IS NULL) AND (is_deleted …)`; unblock clears both guarded by `is_blocked = true AND (is_deleted …)`; `RETURNING <SAFE_USER_SELECT>`.
    - `findGovernanceState(id, tx?: DBQueryExecutor): Promise<GovernanceProbeRowType | null>` — SELECTs ONLY the five probe columns (NEVER `passwordHash`, NEVER `*`).
    - Drizzle `sql`` form with NULL-safe predicates; NO prepared statements on writes; NO inline `--` comments inside `sql` templates; `tx` as final parameter.
  - Instruction files: `.agents/instructions/backend.instructions.md`.
  - _Requirements: REQ-010, REQ-011, REQ-013, REQ-041, REQ-042_
  - [ ] 2.3.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts backend/db/repo/admin/admin-user.repository.ts --lifecycle duplicates` (exit 0).
  - [ ] 2.3.TE **Test Engineering**: NEW/extended suite under `backend/db/test/logic/admin/` per the layer layout — `runInRollback` + `tx` propagated to EVERY call + `expectRepoError` try/catch (NEVER `rejects.toThrow()`). Matrix: both directions of BOTH transitions happy paths; legacy-NULL axis columns (`suspended = NULL` / `is_blocked = NULL` rows accept the ON direction); not-deleted guard rejects mutations on a soft-deleted row; zero-row outcomes disambiguated by `findGovernanceState` (missing row / deleted row / already-on row / already-off row) per axis; `periodDays` persisted only in the ON direction; SAFE-user RETURNING carries no PII column beyond the approved select. Target 100% statement/branch on new repo code (Tier 1), boundary values for periodDays persistence (Tier 2), chaos deferred to 2.4.TE (Tier 3), security column-hygiene (Tier 4).
  - [ ] 2.3.SEC **Security & Tenancy Audit**: guarded single statement = no TOCTOU; closed literal `set` maps (BOPLA); probe selects five columns only.
  - [ ] 2.3.SR **Semantic Review**: mirrors `setDeletedOnce` idioms; no duplicated guard-builder beyond shared SQL idioms; zero `tx`/`db` mixing.
  - [ ] 2.3.IV **Instruction Verification**: `.agents/instructions/backend.instructions.md`.

- [x] 2.4 [Extend `AdminUserManagementService` — `setUserSuspended` / `setUserBlocked`]
  - Modify `backend/services/admin/user-management.service.ts` (EXTEND; `setUserDeleted` stays byte-untouched per REQ-020):
    ```typescript
    export async function setUserSuspended(id, suspended, periodDays: number | null, actorId, locale, outerTx?: DBTransaction): Promise<AdminUserDetailReturnType>;
    export async function setUserBlocked(id, blocked, actorId, locale, outerTx?: DBTransaction): Promise<AdminUserDetailReturnType>;
    ```
  - Ordered pipeline (suspend shown; block mirrors with its axis/codes): (1) `assertActiveActorAdmin(actorId, locale, outerTx)` PRE-transaction when no outerTx; (2) `id` positive-safe-int re-assertion (`ValidationError` with the existing validation key, mirroring lines 181-183); (3) `suspended === true` ⇒ `periodDays` integer in `1..3650` else `ValidationError(tErrors.adminUsers.suspensionPeriodInvalid, [{ field: "periodDays", code: "SUSPENSION_PERIOD_INVALID", message: tErrors.adminUsers.suspensionPeriodInvalid }])` PRE-DB; `suspended === false` ⇒ `periodDays` IGNORED (never validated, never forwarded); (4) `withTransaction(outerTx, async tx => …)`: self-check `id === actorId` → `ConflictError("USER_SELF_SUSPENSION_FORBIDDEN", …)` / `"USER_SELF_BLOCK_FORBIDDEN"` BEFORE any write (placement mirrors lines 988-996); guarded repo call → row ⇒ proceed; `null` ⇒ classifier via `findGovernanceState(id, tx)` → `null` ⇒ `NotFoundError("USER", tErrors.adminUsers.userNotFound)`; `isDeleted === true` → `ConflictError("USER_ALREADY_DELETED", …)`; axis already-ON (ON direction) → `USER_ALREADY_SUSPENDED`/`USER_ALREADY_BLOCKED`; axis not-ON (OFF direction) → `USER_NOT_SUSPENDED`/`USER_NOT_BLOCKED` (verified `ConflictError(code, message)` overload, `backend/lib/errors.ts:170-182`); (5) ONE in-tx audit row via the EXISTING private `buildAuditContract`: suspend → `AuditActionType.Suspend` + `details { changedFields: ["suspended","suspendedAt","suspendedPeriodDays"], suspended: true, suspendedPeriodDays }`; unsuspend → `Reactivate` + `{ changedFields: […], suspended: false }`; block → `Suspend` + `{ changedFields: ["isBlocked","blockedAt"], blocked: true }`; unblock → `Reactivate` + `{ …, blocked: false }` (ZERO PII in details); (6) return `getUserDetail(id, locale, actorId, tx)` (composition reuse — document the relaxed inner re-check pass as a reviewer note).
  - Every denial: EXACTLY ONE `logger.logDomainError({ code, entity: "user", entityId, locale })`; ZERO audit rows; ZERO notification rows; happy path SILENT (REQ-053).
  - `AuditActionType` as VALUE import with MEMBERS (never string literals).
  - Instruction files: `.agents/instructions/backend.instructions.md`.
  - _Requirements: REQ-010, REQ-011, REQ-012, REQ-013, REQ-014, REQ-015, REQ-016, REQ-032, REQ-034, REQ-040, REQ-041, REQ-042, REQ-050, REQ-052, REQ-053_
  - [ ] 2.4.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts backend/services/admin/user-management.service.ts --lifecycle duplicates` (exit 0).
  - [ ] 2.4.TE **Test Engineering — 4-Tier**: NEW `backend/services/admin/user-governance.service.test.ts`:
    - **Tier 1 (statement/branch, `runInRollback`):** both directions of BOTH mutations happy path incl. `getUserDetail` re-composition payload equivalence; ALL REQ-012/013 conflicts; invalid/unknown-id branches.
    - **Tier 2 (boundary):** `periodDays` matrix — `null/0/-3/1.5/3651/non-integer` → `ValidationError` with `fields[]` naming `periodDays`; `1` and `3650` ACCEPTED; unsuspend direction ignores any `periodDays`.
    - **Tier 3 (chaos):** repo-failure unmasked propagation (forced repo throw ⇒ error surfaces unwrapped, ZERO residual rows); forced post-update failure ⇒ rollback leaves `users` state and `audit_logs` count unchanged (REQ-040).
    - **Tier 4 (security):** non-admin actor → `ForbiddenError` pre-DB; governed actor (deleted/blocked/actively-suspended) → strict denials in deterministic key order; denial count-probes: ZERO writes, ZERO `audit_logs`, ZERO `notifications` (JR-C-1); cross-role containment oracles (byte-identical `students`/`applicants`/`teacher`/control rows, REQ-015).
    - **Committed-fixture auth-consumption block (D11 — NEVER `runInRollback`):** users provisioned with REAL hashed credentials (registration path or `hashPassword` + committed fixture, tracked for teardown) proving `AuthService.login`: denies ACTIVE suspension; ALLOWS lapsed suspension with columns BYTE-IDENTICAL before/after (REQ-019); denies blocked; denies deleted.
    - Run via `bun run test/scripts/run-test.ts backend/services/admin/user-governance.service.test.ts`; ALSO re-run the EXISTING DEV3-016 user-management suite — MUST stay byte-green with ZERO edits (REQ-020).
  - [ ] 2.4.SEC **Security & Tenancy Audit**: BOLA — `actorId` from caller param only, never from a target payload; BOPLA — field-by-field payload construction, no spread; BFLA — strict actor re-check first line inside service; denial oracle messages constant-shape; no PII in audit `details`.
  - [ ] 2.4.SR **Semantic Review**: `withTransaction` single boundary; `tx` propagated to EVERY inner call; `DomainError` subclasses only; happy-path silence; zero dead code; no cross-layer import.
  - [ ] 2.4.IV **Instruction Verification**: `.agents/instructions/backend.instructions.md` + auto-discovered AGENTS.md.

- [x] 2.5 [Chaos tier — concurrent single-winner proofs]
  - Extend the governance test surface (dedicated chaos block in `backend/services/admin/user-governance.service.test.ts` or its sibling chaos file following the `user-management.chaos.test.ts:122-147` committed-fixture lifecycle): `Promise.allSettled` over (a) suspend×2 same target, (b) suspend⚡unsuspend opposing race, (c) block×2 — assert EXACTLY ONE winner, loser receives the REQ-013 conflict, final state ≡ winner's direction, and EXACTLY ONE new audit row for the winning direction; SKIP under `isPgliteProvider()` (`test/helpers/skip-when-pglite.ts:48-50`) with the skip recorded.
  - Verify: `bun run test/scripts/run-test.ts` on the chaos suite.
  - Instruction files: `.agents/instructions/tests.instructions.md`, `.agents/instructions/backend.instructions.md`.
  - _Requirements: REQ-043_
  - [ ] 2.5.QL **Quality Loop**: sub-loop `--lifecycle duplicates` on the new/edited test file (exit 0).
  - [ ] 2.5.TE **Test Engineering**: the chaos matrices ARE the deliverable (Tier 3) — assertions: winner count, conflict code on loser, audit-row count = 1, final row state.
  - [ ] 2.5.SEC **Security & Tenancy Audit**: races never mint double audit rows or phantom state (A.5 integrity under concurrency).
  - [ ] 2.5.SR **Semantic Review**: skip-guard correct; fixtures committed/torn down; no flaky time dependence.
  - [ ] 2.5.IV **Instruction Verification**: `.agents/instructions/tests.instructions.md`.

> **Phase 2.M — Mid-Point Review Gate (MANDATORY):** before entering Phase 3, re-run: journey test (expected RED on service surface, GREEN scaffolding), the repo/service/chaos suites, the handshake regression suite, the predicate suite, `bun tsgo`, `bun run biome:check`, and sub-loop on every Phase-1/2 file. Record results + any drift in `ai/plans/sprint_3/dev3-017-account-soft-delete-governance-usersis-d/outcome/2M-midpoint-review-outcome.md`. Ledger must hold ZERO ❌ not either resolved or explicitly blocking a recorded dependent task.

---

## Phase 3: GraphQL Resolvers & API Handlers

- [x] 3.1 [Register `adminSetUserSuspended` / `adminSetUserBlocked` mutations]
  - CREATE `backend/graphql/mutation/admin/admin-governance.mutation.ts`: registers BOTH fields —
    ```graphql
    adminSetUserSuspended(id: Int!, suspended: Boolean!, periodDays: Int): AdminUserDetail!
    adminSetUserBlocked(id: Int!, blocked: Boolean!): AdminUserDetail!
    ```
    with `authScopes: { $all: { authenticated: true, role: [UserRole.Admin] } }` on EACH (`$all` conjunction load-bearing; `UserRole` as VALUE import with MEMBER). Thin resolvers: `if (!ctx.user) throw new UnauthorizedError((await ctx.t("errorsTranslations")).unauthorized)`; delegate `AdminUserManagementService.setUserSuspended(requirePositiveIntId(args.id, "id"), args.suspended, args.periodDays ?? null, ctx.user.id, ctx.locale)` and `…setUserBlocked(requirePositiveIntId(args.id, "id"), args.blocked, ctx.user.id, ctx.locale)`; NO try/catch (DomainErrors propagate to the finalizer); NO local types (args derive from the Pothos field inference; canonical types only).
  - Modify `backend/graphql/mutation/admin/index.ts`: add `import "./admin-governance.mutation";` to the existing barrel.
  - `PUBLIC_OPERATIONS` (`backend/lib/gateway/public-operations.ts:36-46`) UNTOUCHED — verify unchanged.
  - Run `bun run generate:gqlSchema && bun codegen`; commit regenerated artifacts in the SAME changeset; committed-SDL↔live-SDL parity test (`backend/graphql/test/plan-catalog.schema.test.ts:67-73`) green.
  - Instruction files: `.agents/instructions/backend.instructions.md`.
  - _Requirements: REQ-002, REQ-003, REQ-030, REQ-032, REQ-033, REQ-050, REQ-060_
  - [ ] 3.1.QL **Quality Loop**: sub-loop `--lifecycle duplicates` on the new mutation file + barrel (exit 0).
  - [ ] 3.1.TE **Test Engineering**: covered by the wire tier (task 3.3) — scope matrix, payload-oracle, hostilities; PLUS the committed-vs-live SDL parity test MUST stay green.
  - [ ] 3.1.SEC **Security & Tenancy Audit**: scope double-line wired (pre-resolver 401/403); scalar args only → smuggled fields die as `GRAPHQL_VALIDATION_FAILED`; `actorId` exclusively from `ctx.user.id`.
  - [ ] 3.1.SR **Semantic Review**: thin-resolver discipline; no business logic in the resolver; no try/catch swallowing.
  - [ ] 3.1.IV **Instruction Verification**: `.agents/instructions/backend.instructions.md`.

- [x] 3.2 [Auth boundary consumption — window-honest `assertUserActive` + SSR gate]
  - Modify `backend/services/auth/auth.service.ts`: widen `assertUserActive`'s input type to include `{ suspendedAt, suspendedPeriodDays }` and change the denial condition to `user.isDeleted || user.isBlocked || isSuspensionActive(user, new Date())` (lines 91-98). Call sites (`login` ~line 156, `refreshToken` ~line 244) pass the SAME fetched row — ZERO call-site signature churn. Denial copy channel UNCHANGED (`t.accountBlocked` — wire-shape constancy).
  - Modify `backend/lib/auth/server-auth.ts`: `getServerUserContext` line 33 condition becomes `fetched.isDeleted || fetched.isBlocked || isSuspensionActive(fetched, new Date())`; the existing domain log line unchanged.
  - `createGraphQLContext` (`backend/graphql/gqlContextFactory.ts:167-239`) UNTOUCHED — verify byte-identical; this ticket makes NO context-level governance claim.
  - Regression lock: `notification-integration.matrix.test.ts:514-533`'s governed-tier `applyGovernanceState` sets `suspended: true` + `suspendedAt: now` WITHOUT a period → fail-closed predicate STILL denies → the governed-tier matrix (lines 1139-1272) MUST stay green with ZERO edits; any required edit ⇒ STOP and investigate the semantics.
  - Instruction files: `.agents/instructions/backend.instructions.md`.
  - _Requirements: REQ-017, REQ-018, REQ-019, REQ-035_
  - [ ] 3.2.QL **Quality Loop**: sub-loop `--lifecycle duplicates` on both touched files (exit 0).
  - [ ] 3.2.TE **Test Engineering**: the committed-fixture auth-consumption block from 2.4.TE covers login allow/deny; ADD/extend assertUserActive unit tier (active suspension denies; lapsed allows; blocked denies; deleted denies); wire-login HTTP probes live in 3.3.TE; run the governed-tier matrix suite green; consume the 1.2.TE source pins proving both consumption sites import `isSuspensionActive` (flip them active now if authored guarded).
  - [ ] 3.2.SEC **Security & Tenancy Audit**: both boundaries fail-closed on corrupt windows; lapse path performs ZERO writes (REQ-019 — byte-identical column proof lives in the journey step 8 and the committed-fixture block).
  - [ ] 3.2.SR **Semantic Review**: ONE condition line per gate; no duplicated window math; no log-shape change; login/refresh/SSR consume the SAME predicate (no divergence — redirect-loop class prevention).
  - [ ] 3.2.IV **Instruction Verification**: `.agents/instructions/backend.instructions.md`.

- [x] 3.3 [Wire-tier matrix — NEW `backend/graphql/test/admin-governance.matrix.test.ts`]
  - Create the wire suite using `setupTestServerLifecycle` + `testClient`/`fetch`, mirroring `notification-integration.matrix.test.ts` patterns (seeded-admin credentials; `registerUser` for targets).
  - Matrix per mutation: anonymous → `UNAUTHORIZED`; student/parent/teacher → `FORBIDDEN` (pre-resolver, both lines proven); admin happy path payload ≡ post-write DB detail (wire ≡ oracle); invalid ids (`0`, `-5`, non-integer) → validation code; `periodDays` hostilities on the suspend direction → `VALIDATION` with `fields[]` naming `periodDays`; every conflict code (`USER_ALREADY_*`/`USER_NOT_*`/self-protection/`USER_ALREADY_DELETED`/unknown-id `USER_NOT_FOUND`) at its REQ-050 envelope; smuggled/undeclared args → `GRAPHQL_VALIDATION_FAILED`; the EXACT `$all` scope declaration pinned on both fields (introspection/materialization assertion à la `handshake-code-surface.test.ts:125-157`); HTTP governed-login probes: actively-suspended target's `login` → single-error `FORBIDDEN`; lapsed target's `login` → SUCCESS with session payload.
  - Verify: `bun run test/scripts/run-test.ts backend/graphql/test/admin-governance.matrix.test.ts`.
  - Instruction files: `.agents/instructions/tests.instructions.md`, `.agents/instructions/backend.instructions.md`.
  - _Requirements: REQ-030, REQ-032, REQ-050, REQ-052, REQ-060, REQ-073_
  - [ ] 3.3.QL **Quality Loop**: sub-loop `--lifecycle duplicates` on the new test file (exit 0).
  - [ ] 3.3.TE **Test Engineering**: the matrix IS the deliverable — ensure per-class single-error envelope assertions and zero-audit count probes on denials (JR-C-1 at the wire).
  - [ ] 3.3.SEC **Security & Tenancy Audit**: BFLA 401/403 lines proven over HTTP; BOPLA smuggling probes; denial envelopes leak no sibling state.
  - [ ] 3.3.SR **Semantic Review**: no duplicated fixture harnesses beyond the sanctioned pattern; teardown complete.
  - [ ] 3.3.IV **Instruction Verification**: `.agents/instructions/tests.instructions.md`.

- [x] 3.4 [Schema-surface baselines — reconcile-then-extend (documented, conditional)]
  - Using the 0.2 probe verdict: **IF STALE**, FIRST re-anchor `backend/graphql/test/schema-surface.test.ts` + `backend/graphql/test/sdl-static-assertions.test.ts` expected inventories to the LIVE built schema (empirical `printSchema(lexicographicSortSchema(graphQLSchema))` evidence captured in the outcome) as a DOCUMENTED reconciliation; **IF already reconciled** by a sibling, verify-only. THEN extend with `adminSetUserBlocked` + `adminSetUserSuspended` at SORTED positions (`adminCreateUser` < `adminSetUserBlocked` < `adminSetUserDeleted` < `adminSetUserSuspended` < `adminUpdateUser`) plus exact arg shapes (`id: Int!, suspended: Boolean!, periodDays: Int` / `id: Int!, blocked: Boolean!`) and the `$all` scope pins.
  - `handshake-code-surface.test.ts` frozen allowlist UNTOUCHED — verify green.
  - Both steps + rationale + probe evidence recorded in the task outcome — NEVER a silent baseline flip.
  - Verify: `bun run test/scripts/run-test.ts backend/graphql/test/schema-surface.test.ts` and the sdl-static suite.
  - _Requirements: REQ-061_
  - [ ] 3.4.QL **Quality Loop**: sub-loop `--lifecycle duplicates` on both edited baseline files (exit 0).
  - [ ] 3.4.TE **Test Engineering**: baseline suites green; parity test green; sorted-position assertions explicit.
  - [ ] 3.4.SEC **Security & Tenancy Audit**: scope pins included in the frozen surface (no scope drift possible silently).
  - [ ] 3.4.SR **Semantic Review**: reconciliation documented; no unrelated inventory edits.
  - [ ] 3.4.IV **Instruction Verification**: `.agents/instructions/backend.instructions.md`, `.agents/instructions/tests.instructions.md`.

---

## Phase 4: Frontend GraphQL Documents, Stores & UI Views

- [x] 4.1 [Frontend mutation documents — extend admin shared documents]
  - Modify `frontend/graphql/sharedDocuments/admin/admin-users.documents.ts`: ADD `adminSetUserSuspendedMutationDocument: TypedDocumentNode<AdminSetUserSuspendedMutation, AdminSetUserSuspendedMutationVariables>` and `adminSetUserBlockedMutationDocument` analog; BOTH named operations reusing the EXISTING `AdminUserDetailFields` fragment (`id` selected FIRST → Apollo merges into the same `AdminUserDetail:<id>` normalized entry — the detail page re-renders WITHOUT a refetch). NO `useLazyQuery`; hooks will come from `@apollo/client/react` in the view task.
  - NO `apolloCache.test.ts` or `typePolicies` changes (default normalization applies — verify `frontend/providers/apollo/apolloCache.test.ts:176-185` stays untouched/green).
  - Instruction files: `.agents/instructions/frontend.instructions.md`, `frontend/graphql/AGENTS.md` (verified existing).
  - _Requirements: REQ-062_
  - [ ] 4.1.QL **Quality Loop**: sub-loop `--lifecycle duplicates` on the documents file (exit 0).
  - [ ] 4.1.TE **Test Engineering**: documents contract test for the admin documents module — VERIFY FIRST whether one exists (siblings may have created it): CREATE `admin-users.documents.test.ts` if ABSENT (naming, variables shape, `id`-first fragment pins, barrel identity) or EXTEND it; do NOT touch the unrelated `documents.contract.test.ts` baseline table. Run via `bun run test/scripts/run-test.ts`.
  - [ ] 4.1.SEC **Security & Tenancy Audit**: documents declare ONLY the sanctioned args — no smuggling surface.
  - [ ] 4.1.SR **Semantic Review**: fragment reuse; no bespoke inline selection duplicating the fragment.
  - [ ] 4.1.IV **Instruction Verification**: `.agents/instructions/frontend.instructions.md` + `frontend/graphql/AGENTS.md`.

- [x] 4.2 [i18n — `AdminUsers.governanceActions` group + `detail.governanceNote` copy fix, both locales]
  - Modify `shared/locale/types/adminUsers/index.ts`: add ONE group `governanceActions` with EXACTLY 20 slots — `suspendAction`, `unsuspendAction`, `blockAction`, `unblockAction`, `suspendDialogTitle`, `suspendDialogMessage`, `suspendPeriodLabel`, `suspendPeriodHelper`, `unsuspendDialogTitle`, `unsuspendDialogMessage`, `blockDialogTitle`, `blockDialogMessage`, `unblockDialogTitle`, `unblockDialogMessage`, `confirm`, `cancel`, `suspendSuccessToast`, `unsuspendSuccessToast`, `blockSuccessToast`, `unblockSuccessToast`.
  - Modify the EXISTING `AdminUsers` namespace `en` and `ar` implementations: fill all 20 slots in both (Arabic slots in Arabic script); UPDATE the stale `detail.governanceNote` copy (currently "managed in the Governance module") in BOTH locales to describe inline management; UPDATE any component assertion referencing the old copy in the SAME changeset.
  - Typed-leaf parity is free via `AdminUsersLabels` — `bun tsgo` enforces both locales.
  - Instruction files: `.agents/instructions/frontend.instructions.md`, `shared/AGENTS.md`.
  - _Requirements: REQ-002, REQ-064_
  - [ ] 4.2.QL **Quality Loop**: sub-loop `--lifecycle duplicates` on the three touched locale files (exit 0) + `bun tsgo` green.
  - [ ] 4.2.TE **Test Engineering**: existing translation-parity suites green; the `AdminUsers` handle exposes the new group (compile-time proof + component tier in 4.3).
  - [ ] 4.2.SEC **Security & Tenancy Audit**: N/A (copy only).
  - [ ] 4.2.SR **Semantic Review**: EXACTLY 20 slots — no extras; no hardcoded copy consumers introduced.
  - [ ] 4.2.IV **Instruction Verification**: `shared/AGENTS.md` checklist (existing-namespace extension).

- [x] 4.3 [Governance Actions UI — `GovernanceActionsSection` on the EXISTING detail page]
  - Files: CREATE `frontend/views/admin/users/components/GovernanceActionsSection.tsx` (client component — or the sibling path the VERIFIED container structure in 0.2 dictates; record the chosen path in the outcome) + minimal insertion into the EXISTING `AdminUserDetailContainer` (`frontend/views/admin/users/…` — verify-first per 0.2/REQ-063; if the container is absent from the live tree, escalate via the ledger rather than fabricating a different page). NO new route, NO nav change (`frontend/views/dashboard/navItems.ts` untouched).
  - Behavior: state-gated actions — Suspend (only `suspended === false`, opens dialog with REQUIRED `periodDays` field, client-mirrored integer `1..3650` gate), Unsuspend (only `suspended === true`), Block (`isBlocked === false`), Unblock (`isBlocked === true`); deleted target → actions disabled; `useMutation` with the two documents from 4.1; confirm DISABLED in-flight + `CircularProgress size={20}` (REQ-044); success → localized snackbar (the four toasts) + cache-merge re-render; conflict codes → inline `Alert` in-dialog carrying the SERVER-localized message via `extractErrorCode`/`extractErrorMessage` (`frontend/lib/graphql-error-utils.ts`), `severity="info"` for state conflicts / `"warning"` for `USER_ALREADY_DELETED`; `periodDays` `VALIDATION` → field-level error via the `fields[]` projection (`frontend/components/ui/fieldError.ts`); `FORBIDDEN` rides the existing `GraphQLErrorSurfaceHost` toast path.
  - i18n: `useAppTranslation(AdminUsers)` handle + property access (`t.governanceActions.*`) ONLY.
  - MUI v9 discipline: `sx`-only (NO direct style props); `theme.palette.*` only (NO hex/rgb); `*Outlined` icons (e.g. `ShieldOutlined`); `focusVisibleRingSx` on interactive elements; ≥44px touch targets; logical CSS properties; `React.SubmitEvent`/`React.SyntheticEvent<HTMLFormElement>` for form wrappers (NO `FormEvent`).
  - Instruction files: `.agents/instructions/frontend.instructions.md`, `frontend/AGENTS.md`, `app/AGENTS.md` (NOTE: `frontend/views/AGENTS.md` and `frontend/components/ui/AGENTS.md` do NOT exist — do not cite them).
  - _Requirements: REQ-002, REQ-063, REQ-064, REQ-065_
  - [ ] 4.3.QL **Quality Loop**: sub-loop `--lifecycle duplicates` on every created/modified frontend file (exit 0).
  - [ ] 4.3.TE **Unit / Component Tests**: NEW Happy DOM suite for the section — translation-preloaded via the `AdminUsers` handle per `test/ui/AGENTS.md`; mocked Apollo via the sanctioned wrapper. Coverage: action visibility across ALL four governance states (+ deleted-disabled state), suspend dialog `periodDays` gating (invalid disables confirm; `1`/`3650` accepted), in-flight disable, conflict inline alerts (both severities), success snackbars, RTL pass — ZERO hardcoded ar/en strings. Run under the EXISTING `bun run test:ui:components` harness discipline.
  - [ ] 4.3.BF **Agent-Browser Functional Self-Loop**:
    • `bun run scripts/browser-login.ts --inject` (admin session) → navigate to a `role=student` fixture user's `/admin/users/[id]`.
    • DOM-first assertions (`agent-browser snapshot`): action visibility tracks governance state.
    • Execute end-to-end: open Suspend dialog → attempt confirm with invalid `periodDays` (client gate blocks) → valid `7` → submit → assert GraphQL mutation payload (network), localized success snackbar, chip/state flip WITHOUT refetch.
    • Exercise Unsuspend, Block, Unblock flows; on a soft-deleted fixture assert actions disabled; force a conflict (state changed elsewhere) and assert the inline `Alert` with the server-localized message.
    • Iterative self-loop: any interaction/validation failure → patch code → re-run until clean.
  - [ ] 4.3.BS **Agent-Browser Visual & Styling Self-Loop (Screenshot Analysis)**:
    • Capture screenshots across viewports (Desktop 1440×900, Tablet 768×1024, Mobile 375×812) and locales (English LTR, Arabic RTL) of the detail page with each dialog open — via a short-lived visual-inspection subagent (NEVER `ReadMediaFile` in the orchestrating session, per `test/ui/AGENTS.md`).
    • Inspect for: MUI v9 theme palette compliance (no hardcoded hex/rgb), typography hierarchy, spacing rhythm, dialog maxWidth ≤480 desktop / full-width-minus-gutters mobile, text truncation/overflow (Arabic copy wraps without truncation), RTL mirroring of actions and dialog chrome, ≥44px touch targets, focus-ring visibility.
    • Iterative self-loop: screenshot → identify defect → patch `sx` tokens → re-capture → repeat until visually polished in BOTH locales.
  - [ ] 4.3.SR **Semantic Review**: ZERO direct style props (`sx` only); zero hardcoded strings/colors; `useAppTranslation(AdminUsers)` property access only; `*Outlined` icons only; `React.SubmitEvent` discipline; no `useLazyQuery`.
  - [ ] 4.3.IV **Instruction Verification**: `.agents/instructions/frontend.instructions.md` + `frontend/AGENTS.md` + `app/AGENTS.md` (the ONLY existing instruction/AGENTS files for this layer).

---

## Phase 5: Integration & Differential Testing

- [x] 5.1 [Full-suite integration run + regression nets]
  - Run and record: journey (`bun run test/scripts/run-test.ts test/workflows`), predicate suite, handshake regression suite, repo logic tier, service governance suite, chaos tier, wire matrix, schema-surface + sdl-static + SDL-parity suites, governed-tier notification matrix, documents contract test, UI component tier (`bun run test:ui:components`), translation parity suites.
  - DEV3-016 suites MUST be byte-green with ZERO edits (REQ-020 lock).
  - Differential check: REQ-001 baselines — `bun tsgo`, `bun run biome:check`, lint service counts ≡ baseline with ZERO new errors (any delta ⇒ fix or justified ledger entry).
  - Write `ai/plans/sprint_3/dev3-017-account-soft-delete-governance-usersis-d/outcome/5-integration-outcome.md` with the full matrix of commands + results.
  - _Requirements: REQ-020, REQ-070, REQ-071, REQ-072, REQ-073, REQ-074, REQ-075_

- [x] 5.2 [Static locks & INV-U4 grep-lock suite]
  - Add/static-verify the lock suite: (a) prove NO production-code hard-delete writer exists for `users`/`students`/`teacher`/`parents`/`applicants` — `.delete(` scan over `backend/db/repo/**` + `backend/services/**` excluding tests, honoring the test-janitorial whitelist (journey teardown + `db-cleanup.ts` helpers are whitelisted with an explicit, enumerated list — no glob-by-convenience); (b) prove the built schema exposes ZERO `hardDelete*`/`deleteUser`-class Mutation fields (inventory-pinned within the schema-surface assertions).
  - Zero-drift gate: `git diff -- backend/db/schema/** backend/db/migration/**` MUST be EMPTY — capture output in the outcome; `bun run db` NEVER invoked (attest).
  - Final ledger gate: `grep -c "❌\|⚠️" ai/plans/sprint_3/dev3-017-account-soft-delete-governance-usersis-d/deferred-items.md` = 0 (all forward items remain resolved-pointer rows D1-D7).
  - Instruction files: `.agents/instructions/tests.instructions.md`, `.agents/instructions/backend.instructions.md`.
  - _Requirements: REQ-045, REQ-075_
  - [ ] 5.2.QL **Quality Loop**: sub-loop `--lifecycle duplicates` on the lock-test file (exit 0).
  - [ ] 5.2.TE **Test Engineering**: the lock suite IS the deliverable; whitelist enumerated explicitly inside the test with rationale comments.
  - [ ] 5.2.SEC **Security & Tenancy Audit**: INV-U4 now grep-locked against regression; no destructive GraphQL surface possible.
  - [ ] 5.2.SR **Semantic Review**: the scan can't be trivially bypassed by helper indirection (verify it scans repo + service layers, not only one).
  - [ ] 5.2.IV **Instruction Verification**: `.agents/instructions/tests.instructions.md`.

---

## Phase 6: Post-Implementation Review Waves (Parallel)

> Launch the four review wave agents IN PARALLEL over the full changeset; each writes its finding set into `ai/plans/sprint_3/dev3-017-account-soft-delete-governance-usersis-d/outcome/`. Resolve EVERY finding (fix or ledger-justified rejection) before Phase 7.

- [x] 6.1 [Wave: review-types] — canonical-type discipline: `GovernanceProbeRowType` placement; no local resolver types; no service-layer `.types.ts`; canonical imports everywhere; enum VALUE imports with members (`AuditActionType`, `UserRole`). Output: `outcome/6-review-types-outcome.md`.
- [x] 6.2 [Wave: review-backend] — atomicity (`withTransaction` single boundary, `tx` propagation), guarded-statement/no-TOCTOU construction, classifier honest disambiguation, `DomainError` taxonomy + localized keys, ONE domain log per denial / silent happy path, strict actor guard determinism, predicate fail-closed parity across BOTH auth boundaries + handshake consumption, JR-C-1 zero-audit-on-denial. Output: `outcome/6-review-backend-outcome.md`.
- [x] 6.3 [Wave: review-frontend] — MUI v9 `sx`-only, `theme.palette.*` only, `*Outlined` icons, `useAppTranslation(AdminUsers)` property access, in-flight disable, fragment reuse (cache merge without refetch), RTL correctness, no new routes/nav, no `useLazyQuery`. Output: `outcome/6-review-frontend-outcome.md`.
- [x] 6.4 [Wave: pentester] — BFLA double line (scopes + strict service re-check), BOLA actor sourcing, BOPLA mass-assignment absence (scalar args, no spreads, smuggling probes green), governance-window honesty (no false fail-closed context claim), denial-envelope consistency (no sibling-state leakage), audit-trail integrity under concurrency (A.5), permanent-lockout safety (1..3650 + fail-closed + always-available release path), INV-U4 grep-lock soundness (whitelist bypass analysis). Output: `outcome/6-pentester-outcome.md`.
- [x] 6.5 [Deferred-items cross-check] — re-read `ai/plans/sprint_3/dev3-017-account-soft-delete-governance-usersis-d/deferred-items.md`; confirm ZERO ❌/⚠️; confirm resolved-pointer rows D1-D7 intact and referenced (never silently absorbed): lapsed-suspension sweep; session-creation predicate consumption; notification-on-governance; DEV3-016 strict-guard backport ownership; context-boundary gate; audit vocabulary widening; SSR test seam. Output appended to the integration outcome.

---

## Phase 7: Knowledge Propagation & Documentation

- [x] 7.1 [Canonical doc — `docs/admin/account-governance.md`]
  - CREATE with sections: **Why** (four-state lifecycle, Workflow 05 §5 ownership); **Pattern** (guarded single-statement transitions + zero-row classifier + ONE in-tx audit row; audit-vocabulary mapping for block/unblock; the shared predicate + both auth consumers + handshake consumer); **Rules** (suspend window rules `1..3650` mandatory on ON direction; self-protection; uniform `USER_ALREADY_DELETED` deleted-target rule; axis independence; lapse = READ-ONLY on the auth path; strict active-actor guard on governance mutations); **What NOT to Do** (never SELECT-then-UPDATE governance; never hard-delete; never extend a suspension in place — use the audited unsuspend+re-suspend pair; never write on the auth path; never fork the predicate; never widen `audit_action_type` outside a governed schema decision); **Rollout Summary** (mutations, files, baseline reconciliation); **Related Documents** (user-management.md, jwt-authentication-service.md, workflow 05, state-machine-invariants §6).
  - _Requirements: REQ-080_

- [x] 7.2 [Inbound/outbound doc reconciliation pointers]
  - `docs/admin/user-management.md` §6 scope-split row for DEV3-017 → flip to shipped (ONE line pointer; NO renumbering, NO re-litigating JR-C-1).
  - `docs/auth/jwt-authentication-service.md` §5.3/§5.7 → add note: the window predicate NOW EXISTS at `backend/lib/auth/suspension-window.ts` and is consumed by login/refresh/SSR; session-creation gating remains the owning consumer (forward pointer).
  - `docs/parents/handshake-code-discovery.md` → ONE-line pointer that window math lives in the shared predicate (its R3 table stays the semantic source).
  - `docs/specs/open-decisions-and-gaps.md` and `docs/specs/state-machine-invariants.md` — NOT edited (bindings by reference only).
  - _Requirements: REQ-081_

- [x] 7.3 [AGENTS.md propagation]
  - `backend/services/AGENTS.md`: ONE rule line — governance mutations (suspend/block) use guarded single-statement transitions + the strict `assertActiveActorAdmin` + the Suspend/Reactivate audit-vocabulary mapping for block/unblock.
  - `backend/db/repo/AGENTS.md`: ONE entry — guarded governance-transition pattern (`setSuspendedOnce`/`setBlockedOnce` + `findGovernanceState` classifier) mirroring `setDeletedOnce`.
  - Root `AGENTS.md` Important References: add `docs/admin/account-governance.md` line.
  - Rules/references only — NO code dumps.
  - _Requirements: REQ-082_

- [x] 7.4 [Outcome synthesis & final gates]
  - Write `ai/plans/sprint_3/dev3-017-account-soft-delete-governance-usersis-d/outcome/7-completion-outcome.md`: synthesis of ALL task outcomes; final verification table (every plan.md Verification Anchor 1-12 with command + result evidence); baseline diff = 0 attestation; zero-drift `git diff` attestation; codegen artifacts committed attestation; journey green attestation; final `grep -c "❌\|⚠️" ai/plans/sprint_3/dev3-017-account-soft-delete-governance-usersis-d/deferred-items.md` = 0 proof.
  - Confirm EVERY checkbox in this file is `[x]` and every task has a corresponding outcome file.
  - _Requirements: REQ-075, REQ-083_

---

## Traceability: Task → Requirements Index

| Task | Requirements |
|---|---|
| 0.1 | REQ-001, REQ-075 |
| 0.2 | REQ-004, REQ-020, REQ-061 |
| 0.3 | REQ-083 |
| 1.1 | REQ-003 |
| 1.2 | REQ-017, REQ-072 |
| 1.3 | REQ-017, REQ-072 |
| 1.4 | REQ-002, REQ-051 |
| 2.1 | REQ-090..REQ-095 |
| 2.2 | REQ-030, REQ-031, REQ-052 |
| 2.3 | REQ-010, REQ-011, REQ-013, REQ-041, REQ-042, REQ-070 |
| 2.4 | REQ-010..016, REQ-032, REQ-034, REQ-040..042, REQ-050, REQ-052, REQ-053, REQ-071 |
| 2.5 | REQ-043, REQ-073 |
| 2.M | REQ-083 (gate evidence) |
| 3.1 | REQ-002, REQ-003, REQ-030, REQ-032, REQ-033, REQ-050, REQ-060 |
| 3.2 | REQ-017, REQ-018, REQ-019, REQ-035, REQ-071 |
| 3.3 | REQ-030, REQ-032, REQ-050, REQ-052, REQ-060, REQ-073 |
| 3.4 | REQ-061 |
| 4.1 | REQ-062 |
| 4.2 | REQ-002, REQ-064 |
| 4.3 | REQ-002, REQ-063, REQ-064, REQ-065, REQ-074 |
| 5.1 | REQ-020, REQ-070..075 |
| 5.2 | REQ-045, REQ-075 |
| 6.1–6.5 | REQ-075, REQ-083 |
| 7.1–7.4 | REQ-080, REQ-081, REQ-082, REQ-083, REQ-075 |

**End of tasks.md — DEV3-017.** Execution begins at Phase 0; the Phase 1.5 plan-review gate (task 0.3) MUST pass before any implementation task starts.
