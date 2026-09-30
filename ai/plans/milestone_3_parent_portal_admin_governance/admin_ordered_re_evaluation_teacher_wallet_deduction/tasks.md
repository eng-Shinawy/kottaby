# Tasks — Admin-Ordered Re-Evaluation (Teacher Wallet Deduction)

> **Plan directory (verbatim):** `ai/plans/milestone_3_parent_portal_admin_governance/admin_ordered_re_evaluation_teacher_wallet_deduction/`
> **Specs of record:** `specs.md` (requirements + design brief — authoritative) · `plan.md` (design; same directory) · `deferred-items.md` (ledger; same directory) · `outcome/` (per-task evidence)
> **Ticket:** `Admin-Ordered Re-Evaluation (Teacher Wallet Deduction)` (`docs/planning/TICKETS.md:2143-2180`) — Dev 2 · M3 · 5 SP
> **Reconciliation rulings:** R1 (409 `WALLET_INSUFFICIENT_FUNDS`, not 422) · R2 (new `decertifyOnce` writer; subject is a certified teacher) · R3 (guarded `passed → in_evaluation` + cycle anchor; reuse `teacher_evaluation` loop) — binding over ticket prose (`specs.md:51-61`)
> **Feature shape:** full-stack slice — 1 nullable schema column (`applicants.re_evaluation_started_at`), 3 repository additions, 1 new admin service, 1 GraphQL mutation + 1 Pothos object, 1 admin UI action (no new route), i18n keys, 4 test tiers, 1 journey test.

## Document Information

| Field | Value |
|---|---|
| Feature Name | Admin-Ordered Re-Evaluation (Teacher Wallet Deduction) |
| Target Directory | `ai/plans/milestone_3_parent_portal_admin_governance/admin_ordered_re_evaluation_teacher_wallet_deduction/` |
| Outcome Directory | `ai/plans/milestone_3_parent_portal_admin_governance/admin_ordered_re_evaluation_teacher_wallet_deduction/outcome/` |
| Version / Date | 1.0 · 2026-09-30 |
| Author | Dev 2 |
| Related Documents | Requirements: `specs.md` · Design: `plan.md` · Ledger: `deferred-items.md` |

## Non-Negotiable Execution Protocol for All Tasks

1. **Pre-Execution Outcome Knowledge Read:** before ANY task, the agent MUST read ALL existing files in `outcome/` to absorb prior research, search results, docs, and pitfalls so analysis is not repeated.
2. **Per-File Quality Verification Loop:** whenever a file is modified, run `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` BEFORE moving on. It runs `tsgo → oxlint → biome:check → lint:type-aware → check:duplicates` in strict progressive order, short-circuiting at the first failure, and auto-discovers the applicable `AGENTS.md` + `.agents/instructions/*.instructions.md` for the target file. Exit code `0` = passed.
3. **Semantic Review Checklist:** before marking any subtask complete, self-review against the semantic checklist (race conditions, tenancy, enums-as-values, dead code, cross-layer imports, deferred items logged). `sub-loop.ts` cannot detect these.
4. **Global Health Check:** re-run the sub-loop on ALL modified files before marking an implementation subtask complete. All MUST exit `0`.
5. **Post-Execution Outcome File:** write `outcome/<task-id>-outcome.md` (research, implementation, cross-file dependencies, carry-over) on task completion.
6. **Task Progress Tracking:** flip `[ ]` → `[x]` in THIS file upon successful subtask completion.

## MANDATORY 5-Stage Subtask Pipeline

**EVERY implementation subtask (X.Y) MUST carry these 5 nested checkboxes in strict order** — `QL → TE → SEC → SR → IV` — then be marked `[x]`:

- `X.Y.QL` **Quality Loop** — `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` (exit 0). Fix within the same file; report cross-file deps.
- `X.Y.TE` **Test Engineering** — 4-Tier framework. Tier 1: 100% branch/statement coverage. Tier 2: boundaries (empty/unicode/RTL, numeric limits, tz/date boundaries). Tier 3: concurrency fuzz (`Promise.allSettled`) + out-of-order transitions. Tier 4: security/abuse (LIKE wildcards, unauthenticated/role rejection). DB tests: `runInRollback` + `tx` to every repo method (`expectRepoError` try/catch). Service tests: mock WhatsApp/Resend/Twilio/Fixer/Upstash. GraphQL tests: `setupTestServerLifecycle()` + `testClient`. Journey tests: real services + real DB, committed fixtures + tracked `afterAll`, NO `runInRollback`.
- `X.Y.SEC` **Security & Tenancy Audit** — BOLA/IDOR (identity from `ctx.user.id`, never input); BOPLA (strict DTO mapping, no `...input` spread into `update`/`set`); BFLA (non-admin roles cannot call the admin mutation); `escapeLikeWildcards` where search strings are used.
- `X.Y.SR` **Semantic Review** — atomicity (no read-then-write), env-config registration, no dead branches, no cross-layer imports, enums-as-values, schema↔migration parity, deferred items logged.
- `X.Y.IV` **Instruction Verification** — read ALL AGENTS.md + `.agents/instructions` files printed by `sub-loop.ts` and validate the file against them.

## Task-to-Requirement Traceability

Every requirement and reconciliation ruling maps to at least one task. Zero misses.

| Req / Ruling | Title | Covering Task(s) | Component(s) |
|---|---|---|---|
| REQ-001 | Pre-Implementation Baseline & Execution Protocol | 0, 14 | outcome/, deferred-items.md |
| REQ-002 | Translation & Enum Compliance | 1.4, 12.1, 2.1/3.1 enum imports | C10, C12 |
| REQ-003 | Admin Order Authority & Subject Eligibility Gating | 5 (service), 6 (authScopes) | C6, C8 |
| REQ-004 | Re-Evaluation Fee — Single Source of Truth | 1.1, 5 (carry verbatim), 6 (no wire fee) | C1 |
| REQ-005 | Wallet Deduction — withdrawal ledger row + guarded debit | 5 | C6 (via C-a `debitAdjustmentOnce`) |
| REQ-006 | Insufficient-Balance Denial — zero committed rows | 5, 10 (journey scenario c) | C6 |
| REQ-007 | Teacher De-Certification During Re-Evaluation | 3, 5 | C4, C6 |
| REQ-008 | Loop Re-Entry — guarded `passed → in_evaluation` + cycle anchor | 2, 4, 5 | C2, C3, C5 |
| REQ-009 | Audit Logging of the Order | 5, 8 | C6, C13 |
| REQ-009.5 | Audit-census `wired` row registration (from REQ-009.5) | 8 | C13 |
| REQ-010 | Exactly-Once Ordering & Concurrency | 5, 10 | C6 |
| REQ-011 | GraphQL Surface, SDL/Codegen Pins & Census | 6, 7, 8 | C8, C9, C13 |
| REQ-012 | Admin UI Order Action (existing surface — no new route) | 11, 12 | C11, C12 |
| REQ-013 | Cross-Actor Journey Test | 10 | C14 |
| REQ-014 | Knowledge Propagation & Documentation | 13 | C15 |
| R1 | Insufficient balance = 409 `WALLET_INSUFFICIENT_FUNDS`, not 422 | 1.4, 5 (denial), 10, 12 | C6, C10 |
| R2 | New guarded `decertifyOnce`; subject is a certified teacher (has wallet) | 3, 5 | C4 |
| R3 | Guarded `passed → in_evaluation` + cycle anchor; loop reused unchanged | 2, 4, 5 | C3, C5 |

**Component inventory coverage:** C1→1.1 · C2→1.2 · C3→2 · C4→3 · C5→4 · C6→5 · C7→1.3 · C8→6 · C9→7 · C10→1.4 · C11→11,12 · C12→12 · C13→8 · C14→10 (+ repo/service/wire tests in 2–8) · C15→13.

## Implementation Overview

### Implementation Strategy

- **Foundation first:** constant → schema column → types → i18n keys ship before any consumer imports them, each verified with the mandatory pipeline.
- **Guard-as-arbiter:** every money/state write fuses its precondition into the `UPDATE … WHERE` predicate (no probe read). `decertifyOnce` (`is_approved=true`) and `reopenForReEvaluation` (`status='passed'`) are the exactly-once arbiters (REQ-010).
- **Compose, never fork:** the service composes the EXISTING `WalletRepository.debitAdjustmentOnce` guarded writer (REQ-005.5) and the EXISTING audit writer — no new debit primitive, no new ledger vocabulary, no wallet schema change.
- **Test-first journey:** the cross-actor journey (Phase 5) is authored against the real DB before the UI phase, locking the loop re-entry contract.

### Development Approach

- **Testing Strategy:** TDD at the journey layer; paired repo tests in the SAME task as their repo method; service test alongside the service.
- **Integration Strategy:** bottom-up — repos → service → GraphQL → journey → UI, each layer gated by the 5-stage pipeline.
- **Deployment Strategy:** one nullable column added via `bun run db push`; no data backfill (`NULL` = never re-evaluated).

---

## Phase 0 — Pre-Implementation Baseline & Deferred-Items Confirmation

### Task 0: Error baseline, deferred-items ledger confirmation, outcome scaffolding [REQ-001]

- [ ] 0.1 **Record baseline error counts BEFORE any implementation**
  - `bun tsgo 2>&1 | grep "error TS" | wc -l > /tmp/baseline-tsgo.txt`
  - `bun biome:check 2>&1 | grep -c "warn" > /tmp/baseline-biome.txt`
  - `bun run scripts/lint-service.ts --json --id baseline > /tmp/baseline-lint.json`
  - _Requirements: REQ-001.1_

- [ ] 0.2 **Confirm the deferred-items ledger exists** in the plan directory
  - Verify `ai/plans/milestone_3_parent_portal_admin_governance/admin_ordered_re_evaluation_teacher_wallet_deduction/deferred-items.md` exists and carries D-001 (product fee confirmation), D-002 (`re_evaluation` SessionType unused by writers), D-005 (teacher notification) from `specs.md:44-49`.
  - _Requirements: REQ-001.2, REQ-014.5_

- [ ] 0.3 **Write the baseline outcome file** `outcome/0-baseline-outcome.md` documenting baseline counts and the ledger row inventory.
  - [ ] 0.3.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts ai/plans/milestone_3_parent_portal_admin_governance/admin_ordered_re_evaluation_teacher_wallet_deduction/outcome/0-baseline-outcome.md --lifecycle duplicates` (exit 0)
  - [ ] 0.3.IV **Instruction Verification**: read the AGENTS.md + `.agents/instructions` files printed by sub-loop.ts and validate the outcome doc against them.
  - _Requirements: REQ-001.1, REQ-001.4_

- [ ] 0.4 **Read ALL existing `outcome/` files** before any implementation task begins; confirm `outcome/` is created.
  - _Requirements: REQ-001.3_

---

## Phase 1 — Foundation: Shared Constant, Schema Column, Type, i18n Keys [REQ-002, REQ-004]

### Task 1.1: Re-evaluation fee constants [C1 — REQ-004]

- [ ] 1.1 **Create `shared/constants/re-evaluation.constants.ts`**
  - Export `RE_EVALUATION_FEE` (decimal string, EGP; provisional value with a docblock marking it a product-input value → deferred item D-001) and `RE_EVALUATION_FEE_CURRENCY = "EGP"`, mirroring `shared/constants/verification-plan.constants.ts:27-33`.
  - Add `export * from "./re-evaluation.constants";` to `shared/constants/index.ts` (barrel exports constants — verified: `shared/constants/index.ts:7`).
  - Never parse to number, never re-round (money discipline, `docs/billing/escrow-and-wallet-crediting.md` §5.4).
  - [ ] 1.1.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts shared/constants/re-evaluation.constants.ts --lifecycle duplicates` (exit 0)
  - [ ] 1.1.TE **Test Engineering**: assert the constant is a decimal STRING (regex `^\d+(\.\d{1,2})?$`), currency is `"EGP"`, and no `Number()`/`parseFloat` coercion exists in the module (Tier 1 + Tier 2).
  - [ ] 1.1.SEC **Security & Tenancy Audit**: confirm the fee is server-owned and not derived from any request input (mass-assignment of price structurally impossible — REQ-004.4).
  - [ ] 1.1.SR **Semantic Review**: no cross-layer import (shared must not import `@/frontend`/`@/backend`); no dead export; D-001 logged in `deferred-items.md`.
  - [ ] 1.1.IV **Instruction Verification**: read `shared/AGENTS.md` + printed rule files; validate against them.
  - _Requirements: REQ-004.1, REQ-004.2, REQ-004.3, C1_

### Task 1.2: `applicants.re_evaluation_started_at` schema column [C2 — REQ-008.2]

- [ ] 1.2 **Extend `backend/db/schema/teachers/applicants.ts`**
  - Add nullable `reEvaluationStartedAt: timestamp("re_evaluation_started_at")`; `NULL` means "never ordered a paid re-evaluation".
  - Apply via `bun run db push` (Drizzle schema convention — new column). Confirm the migration matches the Drizzle schema.
  - [ ] 1.2.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts backend/db/schema/teachers/applicants.ts --lifecycle duplicates` (exit 0)
  - [ ] 1.2.TE **Test Engineering**: schema-invariant assertion that the column is nullable with no default; round-trip insert `NULL` and an ISO timestamp (Tier 1 + Tier 2).
  - [ ] 1.2.SEC **Security & Tenancy Audit**: no PII in the column; no cross-tenant query impact (Tier 4: schema is app-global by design).
  - [ ] 1.2.SR **Semantic Review**: schema↔migration parity verified; no dead column; nullable (no backfill).
  - [ ] 1.2.IV **Instruction Verification**: read `backend/db/schema/AGENTS.md` + `backend/AGENTS.md` + `backend.instructions.md`; validate.
  - _Requirements: REQ-008.2, C2_

### Task 1.3: `TeacherReEvaluationOrderReturnType` [C7 — REQ-004]

- [ ] 1.3 **Create `backend/types/teachers/teacher-re-evaluation.types.ts`**
  - `export type TeacherReEvaluationOrderReturnType = { teacherId: number; amountCharged: string; currency: string; walletBalance: string; reEvaluationStartedAt: Date };` (money carried as STRING — REQ-004.2).
  - Add to `backend/types/teachers/index.ts` barrel.
  - [ ] 1.3.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts backend/types/teachers/teacher-re-evaluation.types.ts --lifecycle duplicates` (exit 0)
  - [ ] 1.3.TE **Test Engineering**: static type assertion that `amountCharged`/`currency`/`walletBalance` are `string` (not `number`) (Tier 1).
  - [ ] 1.3.SEC **Security & Tenancy Audit**: no client-controlled fields in the return type (server-derived only).
  - [ ] 1.3.SR **Semantic Review**: no local type duplication; single canonical definition in `backend/types/`; barrel is consumed by ≥1 importer.
  - [ ] 1.3.IV **Instruction Verification**: read `backend/types/AGENTS.md` + printed files; validate.
  - _Requirements: REQ-004, C7_

### Task 1.4: i18n error leaves (en + ar) [C10 — REQ-002, REQ-004.3, REQ-006]

- [ ] 1.4 **Extend the `errorsTranslations` namespace**
  - Type schema `shared/locale/types/errors/labels.ts`: ADD `applicantNotAwaitingReEvaluation` and `reEvaluationReasonRequired` typed leaves.
  - en `shared/locale/en/errors/index.ts` + ar `shared/locale/ar/errors/index.ts`: ADD both leaves with identical keys (parity).
  - REUSE existing leaves only: `insufficientBalance` (`labels.ts:253`; en `:113`, ar `:111`), `teacherNotFound` (`labels.ts:249`; en `:111`), `teacherNotCertified` (`labels.ts:243`; en `:108`) — NO new funds-denial key (R1; `docs/billing/escrow-and-wallet-crediting.md` §5.6).
  - No string literal appears in a `throw`; access leaves by property.
  - [ ] 1.4.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts shared/locale/en/errors/index.ts --lifecycle duplicates` (exit 0) and repeat for the ar file + `labels.ts`.
  - [ ] 1.4.TE **Test Engineering**: parity test asserts the en/ar key sets are identical and each new leaf is a non-empty string; unicode/RTL sanity for the ar leaf (Tier 1 + Tier 2).
  - [ ] 1.4.SEC **Security & Tenancy Audit**: no error copy leaks token values / PII / amounts.
  - [ ] 1.4.SR **Semantic Review**: no `next-intl`, no `shared/messages/`; no hardcoded English; `insufficientBalance` reused not duplicated.
  - [ ] 1.4.IV **Instruction Verification**: read `shared/AGENTS.md` + printed rule files; validate.
  - _Requirements: REQ-002.1, REQ-002.2, REQ-002.3, REQ-002.4, REQ-004.3, R1, C10_

- [ ] 1.5 **Phase-1 checkpoint: outcome + progress**
  - Read all `outcome/` files; write `outcome/1-foundation-outcome.md`; flip all Phase-1 checkboxes to `[x]`.
  - _Requirements: REQ-001.4, REQ-001.5_

---

## Phase 2 — Repository Additions (each with its paired repo test in the SAME task)

### Task 2: `ApplicantRepository.reopenForReEvaluation` + repo test [C3 — REQ-008.1]

- [ ] 2.1 **Implement `reopenForReEvaluation(userId, tx?)` in `backend/db/repo/teachers/applicant.repository.ts`** (beside `transitionToInEvaluation:407`)
  - Guarded `UPDATE … WHERE id = $1 AND status = ApplicantStatus.Passed` → set `status = ApplicantStatus.InEvaluation`, `reEvaluationStartedAt = now()`, `returning()`; zero rows → `null`.
  - Import `ApplicantStatus` as a VALUE (never `import type`); never string literals.
  - [ ] 2.1.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts backend/db/repo/teachers/applicant.repository.ts --lifecycle duplicates` (exit 0)
  - [ ] 2.1.TE **Test Engineering**: new `backend/db/test/repo/teachers/applicant.repository.re-evaluation.test.ts` (runInRollback + `tx` to every method; `expectRepoError` try/catch) — happy `passed → in_evaluation` sets `re_evaluation_started_at`; zero-row miss on `in_evaluation`/`failed`/absent returns `null`; boundary `NULL` pre-state; concurrent double-call via `Promise.allSettled` → exactly one non-null (Tier 1–3). Run: `bun run test/scripts/run-test.ts backend/db/test/repo/teachers/applicant.repository.re-evaluation.test.ts`.
  - [ ] 2.1.SEC **Security & Tenancy Audit**: `userId` is an internal id passed by the service (not client-supplied); predicate is ownership-agnostic by design but the caller enforces admin scope upstream (BOLA note recorded).
  - [ ] 2.1.SR **Semantic Review**: guard fused into the UPDATE predicate (no read-then-write); `tx` observed; no dead branches.
  - [ ] 2.1.IV **Instruction Verification**: read `backend/db/repo/AGENTS.md` + `backend/AGENTS.md` + printed files; validate.
  - _Requirements: REQ-008.1, REQ-008.6, R3, C3_

### Task 3: `TeacherRepository.decertifyOnce` + repo test [C4 — REQ-007.1]

- [ ] 3.1 **Implement `decertifyOnce(id, tx?)` in `backend/db/repo/teachers/teacher.repository.ts`** (beside `elevateToCertified:319-331`)
  - Guarded `UPDATE … WHERE id = $1 AND is_approved = true` → set `isApproved = false`, `returning()`; zero rows → `null`.
  - This is the FIRST-ever `is_approved=false` writer in the repo (R2 — no prior false writer exists: `insertColdStartCertified:286` and `elevateToCertified:319-331` both write `isApproved: true`).
  - [ ] 3.1.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts backend/db/repo/teachers/teacher.repository.ts --lifecycle duplicates` (exit 0)
  - [ ] 3.1.TE **Test Engineering**: extend `backend/db/test/repo/teachers/teacher.repository.test.ts` (runInRollback + `tx`) — happy certified→decertified returns row with `isApproved=false`; zero-row miss on already-decertified returns `null`; concurrent double-call via `Promise.allSettled` → exactly one non-null (Tier 1–3); `expectRepoError` for the miss path (never `rejects.toThrow` inside rollback). Run: `bun run test/scripts/run-test.ts backend/db/test/repo/teachers/teacher.repository.test.ts`.
  - [ ] 3.1.SEC **Security & Tenancy Audit**: no `...input` spread; only `id` predicate; the caller enforces admin scope (documented BOLA boundary).
  - [ ] 3.1.SR **Semantic Review**: guard fused into predicate; `tx` observed; no dead branch; de-certification excludes the teacher from booking structurally via `session.repository.lifecycle.helpers.ts:56` (`EXISTS … is_approved = true`) — no new gate added.
  - [ ] 3.1.IV **Instruction Verification**: read `backend/db/repo/AGENTS.md` + `backend/AGENTS.md` + printed files; validate.
  - _Requirements: REQ-007.1, REQ-007.3, R2, C4_

### Task 4: Cycle-resolver re-evaluation arm + repo test [C5 — REQ-008.3]

- [ ] 4.1 **Extend `resolveCurrentEvaluationCycle` in `backend/db/repo/classes/session.repository.evaluation.helpers.ts:157-178`** (wrapper `session.repository.ts:798`)
  - Add exactly ONE precedence arm: when there is NO active verification subscription AND the applicant is `in_evaluation` with a non-null `re_evaluation_started_at`, return `{ cycleStart: re_evaluation_started_at, activeSubscriptionId: null }`.
  - The existing active-verification-subscription arm remains the PRIMARY path for first-time applicants (do NOT reorder it ahead of the new arm's condition).
  - `countEvaluationBookingsInCycle` stays filtered on `session.session_type = 'teacher_evaluation'` AND `created_at >= cycleStart` — UNCHANGED (D-002; `SessionType.ReEvaluation` stays unused by writers).
  - The helper MUST observe the caller `tx`.
  - [ ] 4.1.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts backend/db/repo/classes/session.repository.evaluation.helpers.ts --lifecycle duplicates` (exit 0)
  - [ ] 4.1.TE **Test Engineering**: extend `backend/db/test/repo/teachers/evaluation.repository.test.ts` (runInRollback + `tx`) — re-evaluating applicant (no active subscription, non-null anchor) resolves to the anchor; first-time applicant still resolves via the active subscription; anchor `NULL` falls through unchanged; boundary timestamp equality (`created_at == cycleStart`) counts; concurrency: booking-count stable under parallel inserts (Tier 1–3). Run: `bun run test/scripts/run-test.ts backend/db/test/repo/teachers/evaluation.repository.test.ts`.
  - [ ] 4.1.SEC **Security & Tenancy Audit**: no cross-tenant leakage — cycle resolution scoped to the subject's own applicant/session rows; no client-supplied `cycleStart`.
  - [ ] 4.1.SR **Semantic Review**: no read-then-write; `tx` observed; enum value import where referenced; no dead arm; precedence documented to avoid shadowing the subscription arm.
  - [ ] 4.1.IV **Instruction Verification**: read `backend/db/repo/AGENTS.md` + `backend/AGENTS.md` + printed files; validate.
  - _Requirements: REQ-008.3, REQ-008.4, REQ-008.5, R3, C5_

- [ ] 4.2 **Phase-2 checkpoint: outcome + progress**
  - Read all `outcome/` files; write `outcome/2-repositories-outcome.md`; flip Phase-2 checkboxes to `[x]`.
  - _Requirements: REQ-001.4, REQ-001.5_

---

## Phase 3 — `TeacherReEvaluationService` (10-step pipeline) + service test [C6]

### Task 5: Create `backend/services/teachers/teacher-re-evaluation.service.ts` [REQ-003, REQ-005, REQ-006, REQ-007, REQ-008, REQ-009, REQ-010]

Authoritative signature (`specs.md:313-323`):

```ts
export namespace TeacherReEvaluationService {
  export async function orderReEvaluation(
    actorUserId: number,
    input: { readonly teacherId: number; readonly reason: string },
    locale: string,
    outerTx?: DBTransaction
  ): Promise<TeacherReEvaluationOrderReturnType>;
}
```

- [ ] 5.1 **Create the service module + local helpers**
  - File `backend/services/teachers/teacher-re-evaluation.service.ts`; helpers in `teacher-re-evaluation.service.helpers.ts` (`normalizeReason` modelled on `normalizeAdjustmentReason` at `admin-financial-auditing.service.helpers.ts:86-92`, `MAX_REASON_LENGTH = 229`; `composeReEvaluationDescription(reason)`).
  - `getServerTranslations(locale)` from `@/shared/locale/server-graphql` (single-arg); import enums as VALUES (`TransactionType`, `TransactionStatus`, `AuditActionType`, `ApplicantStatus`, `UserRole` where referenced).
  - [ ] 5.1.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts backend/services/teachers/teacher-re-evaluation.service.helpers.ts --lifecycle duplicates` (exit 0)
  - [ ] 5.1.TE **Test Engineering**: unit-test `normalizeReason` — trim; empty/whitespace-only → `ValidationError(t.reEvaluationReasonRequired)`; length `229` passes, `230` rejects; unicode/RTL reason preserved verbatim (Tier 1 + Tier 2); LIKE-wildcard chars in reason are stored literally (no SQL interpolation) (Tier 4).
  - [ ] 5.1.SEC **Security & Tenancy Audit**: reason is never interpolated into SQL; no PII extraction/logging.
  - [ ] 5.1.SR **Semantic Review**: helpers split per project rule (no service-layer `.types.ts`); enums as values; no dead code.
  - [ ] 5.1.IV **Instruction Verification**: read `backend/services/AGENTS.md` + `backend/AGENTS.md` + `backend.instructions.md`; validate.
  - _Requirements: REQ-002.5, REQ-004, C6_

- [ ] 5.2 **Implement the 10-step transaction pipeline** (authoritative order — REQ-010.2)
  - Pre-DB: `assertValidPositiveInt(actorUserId)` / `(input.teacherId)` → `ValidationError(t.validation)`.
  - `withTransaction(outerTx, async tx => { … })`:
    1. `assertActorAdminActive(actorUserId, locale, tx)` (`backend/services/admin/admin-gate.helpers.ts:133`).
    2. teacher = `TeacherRepository.findById(input.teacherId, tx)` → `NotFoundError("TEACHER", t.teacherNotFound)`; `isApproved !== true` → `ConflictError("TEACHER_NOT_CERTIFIED", t.teacherNotCertified)`.
    3. applicant = `ApplicantRepository.findByUserId(input.teacherId, tx)` → null/`status !== Passed` → `ConflictError("APPLICANT_NOT_AWAITING_RE_EVALUATION", t.applicantNotAwaitingReEvaluation)`.
    4. wallet = `WalletRepository.ensureWalletOnce(input.teacherId, tx)`.
    5. ledger = `WalletRepository.debitAdjustmentOnce({ walletId: wallet.id, amount: RE_EVALUATION_FEE, description: composeReEvaluationDescription(reason) }, tx)`; `null` → `logger.logDomainError(t.insufficientBalance, {code:"WALLET_INSUFFICIENT_FUNDS", entity:"wallet", entityId: wallet.id})` + `ConflictError("WALLET_INSUFFICIENT_FUNDS", t.insufficientBalance)`.
    6. `TeacherRepository.decertifyOnce(input.teacherId, tx)`; `null` → `ConflictError("TEACHER_NOT_CERTIFIED", …)`.
    7. `ApplicantRepository.reopenForReEvaluation(input.teacherId, tx)`; `null` → `ConflictError("APPLICANT_NOT_AWAITING_RE_EVALUATION", …)`.
    8. read back `WalletRepository.findById(wallet.id, tx)` for `balanceAfter`.
    9. `AuditService.createAuditLog({ actorId: actorUserId, actionType: AuditActionType.Override, entityType: "teacher", entityId: input.teacherId, details: JSON.stringify({ action:"re_evaluation_ordered", amount:RE_EVALUATION_FEE, walletId: wallet.id, balanceAfter, reEvaluationStartedAt }) }, tx)`.
    10. return `{ teacherId: input.teacherId, amountCharged: RE_EVALUATION_FEE, currency: RE_EVALUATION_FEE_CURRENCY, walletBalance: balanceAfter.balance, reEvaluationStartedAt: reopened.reEvaluationStartedAt }`.
  - Actor id comes EXCLUSIVELY from `actorUserId` (never input); no `ctx.idempotencyKey` is read.
  - [ ] 5.2.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts backend/services/teachers/teacher-re-evaluation.service.ts --lifecycle duplicates` (exit 0)
  - [ ] 5.2.TE **Test Engineering**: covered by 5.3 (service test); ensure 100% branch coverage of every guard/denial arm.
  - [ ] 5.2.SEC **Security & Tenancy Audit**: BOLA — actor from parameter only; BOPLA — no input spread into any repo write; BFLA — `assertActorAdminActive` re-asserted in-tx (defense in depth).
  - [ ] 5.2.SR **Semantic Review**: atomicity — ONE `withTransaction`, no nested/partial commits, zero committed rows on any denial; `total_earning` untouched (via `debitAdjustmentOnce`); no new debit primitive; audit append in-tx so rollback removes it.
  - [ ] 5.2.IV **Instruction Verification**: read `backend/services/AGENTS.md` + printed files; validate.
  - _Requirements: REQ-003.2, REQ-003.3, REQ-003.4, REQ-003.5, REQ-003.6, REQ-003.7, REQ-003.8, REQ-005.1, REQ-005.2, REQ-005.3, REQ-005.4, REQ-005.5, REQ-005.6, REQ-006.1, REQ-006.3, REQ-007.2, REQ-008.1, REQ-009.1, REQ-009.2, REQ-009.3, REQ-009.4, REQ-010.1, REQ-010.2, REQ-010.3, REQ-010.4, C6_

- [ ] 5.3 **Author the service test** `backend/services/teachers/teacher-re-evaluation.service.test.ts`
  - Mock all external channels (WhatsApp/Resend/Twilio/Fixer/Upstash); use the rollback pattern for DB assertions.
  - Cases (Tier 1–4):
    - Happy path: returns `amountCharged = RE_EVALUATION_FEE` verbatim, `currency = "EGP"`, `walletBalance` decremented by fee, `reEvaluationStartedAt` set; wallet `balance −= fee`, `total_earning` UNCHANGED; exactly ONE `withdrawal`/`completed` ledger row with `amount = RE_EVALUATION_FEE`, `session_id = NULL`; `teacher.is_approved = false`; applicant `in_evaluation`; exactly ONE `audit_logs` row (`override`, `entityType:"teacher"`, `entityId = teacherId`, `actorId` from param).
    - Insufficient balance → `ConflictError("WALLET_INSUFFICIENT_FUNDS")`; ZERO committed rows (no ledger, no balance change, no de-certification, no status change, no audit); exactly ONE bounded `logDomainError` carrying wallet id only (never amount / other identity).
    - Non-certified teacher → `TEACHER_NOT_CERTIFIED`; absent teacher → `NotFoundError("TEACHER")` → `TEACHER_NOT_FOUND`; applicant absent/not `passed` → `APPLICANT_NOT_AWAITING_RE_EVALUATION`; invalid ids → `ValidationError`.
    - Non-governance-authority actor (deleted/blocked/suspended admin) → denied by `assertActorAdminActive`; zero rows.
    - Tier 3: two concurrent orders via `Promise.allSettled` on the same teacher → exactly one charge (arbiter: `decertifyOnce` + `reopenForReEvaluation`); the loser rolls back its debit.
    - Tier 3: `ensureWalletOnce` creates an honest zeroed wallet for a certified teacher with no wallet history, then the debit is attempted.
    - Tier 2: reason boundaries (empty, `230` chars, unicode/RTL).
  - Run: `bun run test/scripts/run-test.ts backend/services/teachers/teacher-re-evaluation.service.test.ts`.
  - [ ] 5.3.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts backend/services/teachers/teacher-re-evaluation.service.test.ts --lifecycle duplicates` (exit 0)
  - [ ] 5.3.SEC **Security & Tenancy Audit**: assert an authenticated non-admin / student / parent caller cannot reach the service path (BFLA); assert no actor id is read from input.
  - [ ] 5.3.SR **Semantic Review**: no `rejects.toThrow` inside `runInRollback` (use `expectRepoError` try/catch); every repo call inside the tx receives `tx`; no dead assertions.
  - [ ] 5.3.IV **Instruction Verification**: read `backend/services/AGENTS.md` + `backend/db/test/AGENTS.md` + `backend.instructions.md` + `tests.instructions.md`; validate.
  - _Requirements: REQ-003.8, REQ-005.3, REQ-005.5, REQ-005.6, REQ-006.1, REQ-006.2, REQ-006.3, REQ-006.4, REQ-007.2, REQ-009.1, REQ-009.3, REQ-009.4, REQ-010.1, REQ-010.3, REQ-010.4_

- [ ] 5.4 **Export the service + checkpoint**
  - Add `export * from "./teacher-re-evaluation.service";` to `backend/services/teachers/index.ts`.
  - Read all `outcome/` files; write `outcome/3-service-outcome.md`; flip Phase-3 checkboxes to `[x]`.
  - [ ] 5.4.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts backend/services/teachers/index.ts --lifecycle duplicates` (exit 0)
  - [ ] 5.4.IV **Instruction Verification**: read the AGENTS.md + `.agents/instructions` files printed by sub-loop.ts; validate.
  - _Requirements: REQ-001.4, REQ-001.5_

---

## Phase 4 — GraphQL Surface, Pothos Object, SDL/Codegen Pins, Census, Wire Test [C8, C9, C13]

### Task 6: `adminOrderTeacherReEvaluation` mutation [C8 — REQ-011.1, REQ-011.2, REQ-003.1]

- [ ] 6.1 **Create `backend/graphql/mutation/admin/admin-re-evaluation.mutation.ts`**
  - Root field: `adminOrderTeacherReEvaluation(teacherId: ID!, reason: String!): TeacherReEvaluationOrder!`.
  - `authScopes`: the explicit `$all` conjunction `{ authenticated: true, role: [UserRole.Admin] }`, inline — matching `admin-teachers.mutation.ts:45-50` and `admin-finance.mutation.ts:114-119` (anonymous → `UNAUTHORIZED` 401; authenticated non-admin → `FORBIDDEN` 403, before the resolver runs).
  - Map args field-by-field (never spread): `requirePositiveIntId` on the `ID`, `reason` copied explicitly (`admin-finance.mutation.ts:120-138` precedent). Narrow `ctx.user` (`requireAdminUser`) and delegate to `TeacherReEvaluationService.orderReEvaluation(ctx.user.id, { teacherId, reason }, ctx.locale)`; the resolver never reads an actor id from input.
  - Register via a side-effect import in `backend/graphql/mutation/admin/index.ts` (no named exports — `mutation/AGENTS.md:29-32`).
  - [ ] 6.1.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts backend/graphql/mutation/admin/admin-re-evaluation.mutation.ts --lifecycle duplicates` (exit 0)
  - [ ] 6.1.TE **Test Engineering**: covered by Task 9 wire test; ensure the resolver branch set is fully exercised.
  - [ ] 6.1.SEC **Security & Tenancy Audit**: BFLA — `authScopes` denies non-admin; BOLA — actor from `ctx.user.id`; BOPLA — no arg spread; input id validated via `requirePositiveIntId`.
  - [ ] 6.1.SR **Semantic Review**: `UserRole` imported as a value; no dead branches; locale passed through (`ctx.locale`).
  - [ ] 6.1.IV **Instruction Verification**: read `backend/graphql/AGENTS.md` + `backend/AGENTS.md` + `backend.instructions.md`; validate.
  - _Requirements: REQ-003.1, REQ-003.2, REQ-011.1, REQ-011.2, REQ-004.4, C8_

### Task 7: `TeacherReEvaluationOrderPothosObject` [C9 — REQ-011.3]

- [ ] 7.1 **Create `backend/graphql/pothos/admin/admin-re-evaluation.pothos.ts`**
  - Define object `TeacherReEvaluationOrderPothosObject` exposing non-null `amountCharged: String!`, `currency: String!`, `walletBalance: String!`, `reEvaluationStartedAt: String!` (ISO), `teacherId: ID!`.
  - NO input object (`OrderTeacherReEvaluationInput` is NOT used — the two scalar args suffice).
  - Import types from `@/backend/types` (never redefine locally); register via the `backend/graphql/pothos/admin/index.ts` barrel.
  - Document in the file/plan: admin-only (SUPER_ADMIN does not exist; `UserRole` = `Admin | Teacher | Student | Parent`, `backend/enum/users/user-role.enum.ts:5-10`).
  - [ ] 7.1.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts backend/graphql/pothos/admin/admin-re-evaluation.pothos.ts --lifecycle duplicates` (exit 0)
  - [ ] 7.1.TE **Test Engineering**: schema-shape assertion that all five fields are non-null with the declared types (Tier 1); ISO-8601 format for `reEvaluationStartedAt` (Tier 2).
  - [ ] 7.1.SEC **Security & Tenancy Audit**: no client-controlled scalar exposed; money fields are read-only strings.
  - [ ] 7.1.SR **Semantic Review**: single canonical object per entity; no local type definitions; barrel side-effect registration correct.
  - [ ] 7.1.IV **Instruction Verification**: read `backend/graphql/AGENTS.md` + printed files; validate.
  - _Requirements: REQ-011.3, REQ-011.6, C9_

### Task 8: SDL/codegen pin refresh + audit-census `wired` row [C13 — REQ-011.4, REQ-011.5, REQ-009.5]

- [ ] 8.1 **Refresh frozen SDL pins + regenerate artifacts**
  - Update `backend/graphql/test/sdl-static-assertions.test.ts:140-145` (`FROZEN_MUTATION_FIELDS`) and `backend/graphql/test/schema-surface.test.ts:726,1160` (mutation-set pins) to include `adminOrderTeacherReEvaluation`.
  - Add a contains-pin for the new signature in `backend/graphql/test/schema-surface.test.ts`, mirroring the `adjustTeacherWallet` pin at `:2954`.
  - Regenerate the committed SDL artifact byte-identical: `bun run generate:gqlSchema && bun codegen`.
  - [ ] 8.1.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts backend/graphql/test/schema-surface.test.ts --lifecycle duplicates` (exit 0) and repeat for `sdl-static-assertions.test.ts`.
  - [ ] 8.1.TE **Test Engineering**: pin tests fail before the SDL update and pass after; assert the frozen inventory matches the generated schema exactly (Tier 1).
  - [ ] 8.1.SEC **Security & Tenancy Audit**: the new field appears in the mutation set with its admin authScopes pinned (no accidental public exposure).
  - [ ] 8.1.SR **Semantic Review**: SDL artifact byte-identical (no incidental drift); codegen output regenerated.
  - [ ] 8.1.IV **Instruction Verification**: read `backend/graphql/AGENTS.md` + printed files; validate.
  - _Requirements: REQ-011.4, REQ-011.5, C13_

- [ ] 8.2 **Register the audit-census `wired` row**
  - Add `adminOrderTeacherReEvaluation` as a `wired` row in `test/workflows/admin/audit-completeness.catalog.ts` (bijection-locked by `backend/db/test/logic/audit/audit-census-drift.test.ts`).
  - Run: `bun run test/scripts/run-test.ts backend/db/test/logic/audit/audit-census-drift.test.ts`.
  - [ ] 8.2.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts test/workflows/admin/audit-completeness.catalog.ts --lifecycle duplicates` (exit 0)
  - [ ] 8.2.TE **Test Engineering**: drift test green — every mutation root field has a catalog row, and every catalog row maps to a real field (Tier 1).
  - [ ] 8.2.SEC **Security & Tenancy Audit**: the catalog row's actor scope matches the mutation's admin-only authScopes.
  - [ ] 8.2.SR **Semantic Review**: no dead catalog rows; no duplicate entries.
  - [ ] 8.2.IV **Instruction Verification**: read `test/workflows/AGENTS.md` + printed files; validate.
  - _Requirements: REQ-009.5, C13_

### Task 9: GraphQL wire test [C14 — REQ-011, REQ-003.1]

- [ ] 9.1 **Author the wire test** under `backend/graphql/test/` (or `frontend/graphql/test/`)
  - Setup via `setupTestServerLifecycle()` + execute via `testClient` (never raw `fetch`).
  - Cases: admin happy path returns all five object fields + the fee with `extensions.code` absent; anonymous caller → `UNAUTHORIZED`; authenticated non-admin → `FORBIDDEN`; insufficient balance → `extensions.code = "WALLET_INSUFFICIENT_FUNDS"` with localized `insufficientBalance` message; non-certified → `TEACHER_NOT_CERTIFIED`; not-awaiting → `APPLICANT_NOT_AWAITING_RE_EVALUATION`; missing/blank reason → validation error; invalid `teacherId` → validation error.
  - [ ] 9.1.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts backend/graphql/test/admin-re-evaluation.wire.test.ts --lifecycle duplicates` (exit 0)
  - [ ] 9.1.TE **Test Engineering**: Tier 4 abuse — non-admin role probes (teacher/student/parent/anonymous); boundary — `reason` at `230` chars and unicode; concurrency — two parallel `testClient` calls (`Promise.allSettled`) charge once (Tier 1–3).
  - [ ] 9.1.SEC **Security & Tenancy Audit**: BFLA confirmed at the GraphQL boundary; error `extensions.code` carries no PII.
  - [ ] 9.1.SR **Semantic Review**: correct testing setup helper; localized message asserted in the caller's locale.
  - [ ] 9.1.IV **Instruction Verification**: read `backend/graphql/AGENTS.md` + `backend/db/test/AGENTS.md` + `tests.instructions.md`; validate.
  - _Requirements: REQ-003.1, REQ-006.4, REQ-011.1, REQ-011.2, C14_

- [ ] 9.2 **Phase-4 checkpoint**: read all `outcome/` files; write `outcome/4-graphql-outcome.md`; flip Phase-4 checkboxes to `[x]`.
  - _Requirements: REQ-001.4, REQ-001.5_

---

## Phase 5 — Cross-Actor Journey Test (TEST-FIRST: admin → teacher → evaluator) [C14 — REQ-013]

### Task 10: `test/workflows/teachers/admin-ordered-re-evaluation.journey.test.ts`

- [ ] 10.1 **Author the journey test test-first** (before Phase 6 UI)
  - Real services + real DB; committed fixtures in `beforeAll` + tracked hard-delete in `afterAll`; NO `runInRollback` (`test/workflows/AGENTS.md:8-11`).
  - Actor cast (real roles, honest authorization — never stubs, `test/workflows/AGENTS.md:23-26`):
    - Academy Admin (`UserRole.Admin`, governance-active).
    - Subject Teacher (`UserRole.Teacher`, `is_approved=true` + wallet).
    - Two Certified Evaluators (`is_approved=true, is_evaluator=true`) + enough distinct certified evaluators for the 5-session loop.
    - A non-admin actor (Teacher/Student/Parent) for the denial probe.
  - Steps as `actor → action → expected shared-state change + side effects`:
    - (a) Admin → `adminOrderTeacherReEvaluation` → `wallet.balance −= RE_EVALUATION_FEE`; +1 `teacher_transaction(withdrawal, completed)`, `session_id = NULL`; `teacher.is_approved=false`; `applicants.status: passed → in_evaluation`; `applicants.re_evaluation_started_at = now`; +1 `audit_logs(override, teacher)`; `total_earning` UNCHANGED.
    - (b) Teacher → `bookEvaluation` ×5 against 5 distinct certified evaluators → +5 `session(teacher_evaluation)` within the re-evaluation cycle; credit ceiling (5) enforced; Evaluator → `submitRubricEvaluation` ×5 → at the 5th the aggregation verdict PASS ⇒ `is_approved=true` (re-certified) + `applicants.status=passed`.
    - (b′) FAIL variant: aggregation FAIL ⇒ cooldown stamped; teacher stays de-certified.
    - (c) Low-balance teacher → denied `WALLET_INSUFFICIENT_FUNDS` with ZERO committed rows.
    - (d) Non-admin actor → denied `FORBIDDEN` / UNAUTHORIZED with zero rows (real actor row).
  - Assert audit rows via the journey-registry counters / whole-table oracle (`journey-fixture-registry.ts:211`; `audit-trail.journey.test.ts:103-104`). Spy the notification boundary — NEVER hit real channels.
  - Run: `bun run test/scripts/run-test.ts test/workflows/teachers/admin-ordered-re-evaluation.journey.test.ts` until green, then `bun run test/scripts/run-test.ts test/workflows`.
  - [ ] 10.1.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts test/workflows/teachers/admin-ordered-re-evaluation.journey.test.ts --lifecycle duplicates` (exit 0)
  - [ ] 10.1.TE **Test Engineering**: Tier 3 — re-order concurrency: after the loop passes, a fresh order is only reachable from `passed` again (an order against an `in_evaluation` applicant is denied). Tier 2 — timestamp boundary (`created_at == cycleStart`) counts toward the ceiling. Tier 4 — the denial probes use REAL non-admin actors.
  - [ ] 10.1.SEC **Security & Tenancy Audit**: permission resolution uses real DB role rows (never monkey-patched); assert the admin mutation cannot be driven by a non-admin token.
  - [ ] 10.1.SR **Semantic Review**: committed fixtures + tracked `afterAll` cleanup (no leaks); no `runInRollback`; side effects spied; WALLET debit never touches `total_earning`.
  - [ ] 10.1.IV **Instruction Verification**: read `test/workflows/AGENTS.md` + `tests.instructions.md`; validate.
  - _Requirements: REQ-013.1, REQ-013.2, REQ-013.3, REQ-013.4, REQ-006.2, REQ-007.4, REQ-007.5, REQ-008.5, REQ-008.6, REQ-010.1, C14_

- [ ] 10.2 **Phase-5 checkpoint**: read all `outcome/` files; write `outcome/5-journey-outcome.md`; flip Phase-5 checkboxes to `[x]`.
  - _Requirements: REQ-001.4, REQ-001.5_

---

## Phase 6 — Admin UI: Document, Hook, Dialog, Action Wiring (existing surface, no new route) [C11, C12]

### Task 11: GraphQL document + hook [C11 — REQ-012.3]

- [ ] 11.1 **Create `frontend/graphql/sharedDocuments/admin/admin-re-evaluation.documents.ts`**
  - Export `adminOrderTeacherReEvaluationMutationDocument` (naming per `sharedDocuments/AGENTS.md:84-98`); include `id` on every selection whose type has one (the id-less `TeacherReEvaluationOrder` payload exposes `teacherId: ID!` instead).
  - Register the new id-less payload type `TeacherReEvaluationOrder` in `frontend/providers/apollo/apolloCache.ts` `typePolicies` with `keyFields: false` — it has no `id` field (`frontend/graphql/AGENTS.md:87-97`; mirrors the `PurchaseSubscriptionPayload` inline mutation-payload registration).
  - [ ] 11.1.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts frontend/graphql/sharedDocuments/admin/admin-re-evaluation.documents.ts --lifecycle duplicates` (exit 0)
  - [ ] 11.1.TE **Test Engineering**: documents-test (mirroring `admin-teacher-applicants.documents.test.ts`) asserting the operation name, variables (`teacherId`, `reason`), and selected fields match the SDL (Tier 1).
  - [ ] 11.1.SEC **Security & Tenancy Audit**: no actor id in the wire variables (server derives it); no fee on the wire (REQ-004.4).
  - [ ] 11.1.SR **Semantic Review**: `id` present on selections where the type has one; the id-less `TeacherReEvaluationOrder` is `keyFields: false`-registered; no cross-layer import; no dead export.
  - [ ] 11.1.IV **Instruction Verification**: read `frontend/graphql/AGENTS.md` + `frontend/graphql/sharedDocuments/AGENTS.md` + `frontend.instructions.md`; validate.
  - _Requirements: REQ-012.3, REQ-004.4, C11_

- [ ] 11.2 **Create the `useOrderTeacherReEvaluation` hook**
  - Import `useMutation` from `"@apollo/client/react"` (NO `useLazyQuery` — `AGENTS.md`).
  - On success: close the dialog and refetch the affected caches (admin user detail + the teacher's admin wallet view).
  - [ ] 11.2.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts frontend/hooks/useOrderTeacherReEvaluation.ts --lifecycle duplicates` (exit 0)
  - [ ] 11.2.TE **Test Engineering**: hook test asserting the mutation document is used, success triggers both cache refetches, and failure leaves state intact (Tier 1 + Tier 2).
  - [ ] 11.2.SEC **Security & Tenancy Audit**: error handling reads `extensions.code` (never HTTP status); no token logging.
  - [ ] 11.2.SR **Semantic Review**: correct Apollo import path; no dead code; cache refetch keys correct.
  - [ ] 11.2.IV **Instruction Verification**: read `frontend/AGENTS.md` + printed files; validate.
  - _Requirements: REQ-012.3, REQ-012.4, C11_

### Task 12: Admin UI locale keys + dialog + action wiring [C11, C12 — REQ-012.1, REQ-012.2, REQ-012.5, REQ-012.6, REQ-002.6]

- [ ] 12.1 **Extend admin-UI locale keys (en + ar) [C12]**
  - Type schema `shared/locale/types/adminUsers/index.ts` (`AdminUsersLabels`) + en `shared/locale/en/adminUsers/index.ts` + ar `shared/locale/ar/adminUsers/index.ts` (the `AdminUsers` namespace already exists and is consumed; or a small new namespace): dialog title, reason label + required hint, confirm label, fee-explanation copy.
  - Identical key sets in en + ar (parity).
  - [ ] 12.1.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts shared/locale/en/adminUsers/index.ts --lifecycle duplicates` (exit 0) and repeat for the ar file + `labels.ts`.
  - [ ] 12.1.TE **Test Engineering**: en/ar parity test; non-empty leaves; RTL sanity (Tier 1 + Tier 2).
  - [ ] 12.1.SEC **Security & Tenancy Audit**: copy explains the fee deduction truthfully; no amount hardcoded in copy (reads the server-returned fee).
  - [ ] 12.1.SR **Semantic Review**: no `next-intl`; no hardcoded English.
  - [ ] 12.1.IV **Instruction Verification**: read `shared/AGENTS.md` + `frontend/AGENTS.md` + printed files; validate.
  - _Requirements: REQ-002.1, REQ-002.4, REQ-012.2, C12_

- [ ] 12.2 **Create `frontend/views/admin/users/dialogs/OrderReEvaluationDialog.tsx`**
  - Modeled on `frontend/views/admin/users/dialogs/CertifyTeacherDialog.tsx`: collects a MANDATORY `reason`, explains the fee deduction, calls the new hook.
  - On success: close + refetch. On failure: stay open, render localized copy mapped from `extensions.code` (`WALLET_INSUFFICIENT_FUNDS`, `TEACHER_NOT_CERTIFIED`, `APPLICANT_NOT_AWAITING_RE_EVALUATION`) via the existing error-link map — NEVER an HTTP-status branch (`frontend/AGENTS.md:63-67`).
  - MUI v9 `sx`-only styling, theme-palette-only colors, reduced-motion + aria rules (`frontend/AGENTS.md:1-9,30-38,52-56`).
  - [ ] 12.2.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts frontend/views/admin/users/dialogs/OrderReEvaluationDialog.tsx --lifecycle duplicates` (exit 0)
  - [ ] 12.2.TE **Test Engineering**: dialog renders for a certified teacher; blank reason blocks submit; success closes; each error code renders its localized copy; keyboard/aria (focus trap, esc) (Tier 1 + Tier 2).
  - [ ] 12.2.SEC **Security & Tenancy Audit**: renders only for `UserRole.Teacher` + certified; no token/PII surfaced; error branch on `extensions.code`.
  - [ ] 12.2.SR **Semantic Review**: no hardcoded colors (theme only); no dead props; no cross-layer import.
  - [ ] 12.2.IV **Instruction Verification**: read `frontend/views/AGENTS.md` + `frontend/AGENTS.md` + `frontend.instructions.md`; validate.
  - _Requirements: REQ-012.2, REQ-012.5, REQ-012.6, REQ-002.6, C11_

- [ ] 12.3 **Wire the action into the existing admin user-detail governance surface**
  - Add an "Order re-evaluation" action in `frontend/views/admin/users/detail/UserHeroActions.tsx` and/or `frontend/views/admin/users/detail/GovernanceActionsSection.tsx`, rendered ONLY for a `teacher`-role user whose teacher row is certified. Extend `useGovernanceActions.ts` to open the dialog.
  - NO new route and NO new sidebar entry (`navItems.ts:158-199`).
  - [ ] 12.3.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts frontend/views/admin/users/detail/GovernanceActionsSection.tsx --lifecycle duplicates` (exit 0) and repeat for `UserHeroActions.tsx` + `useGovernanceActions.ts`.
  - [ ] 12.3.TE **Test Engineering**: action visible only for certified teachers (hidden for students/parents/non-certified); opens the dialog on click (Tier 1 + Tier 2).
  - [ ] 12.3.SEC **Security & Tenancy Audit**: visibility is role+state gated in the UI; server still re-asserts admin scope (UI is not the authz boundary).
  - [ ] 12.3.SR **Semantic Review**: no new route/sidebar; no dead branches; existing surface extended, not duplicated.
  - [ ] 12.3.IV **Instruction Verification**: read `frontend/views/AGENTS.md` + printed files; validate.
  - _Requirements: REQ-012.1, C11_

- [ ] 12.4 **Phase-6 checkpoint**: read all `outcome/` files; write `outcome/6-ui-outcome.md`; flip Phase-6 checkboxes to `[x]`.
  - _Requirements: REQ-001.4, REQ-001.5_

---

## Phase 7 — Knowledge Propagation & Documentation [C15 — REQ-014]

### Task 13: Canonical docs + propagation edits

- [ ] 13.1 **Create `docs/teachers/admin-ordered-re-evaluation.md`**
  - Consolidate: the order flow, the guarded-transition arbiters (`decertifyOnce` `is_approved=true` / `reopenForReEvaluation` `passed`), the fee discipline (decimal-string carry, `total_earning` untouched), and the loop re-entry (cycle anchor + `teacher_evaluation` reuse). Structure: Why → Pattern → Rules → Anti-patterns → Rollout Summary → Related Documents.
  - [ ] 13.1.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts docs/teachers/admin-ordered-re-evaluation.md --lifecycle duplicates` (exit 0)
  - [ ] 13.1.TE **Test Engineering**: n/a (doc) — verify internal links resolve to real paths/anchors.
  - [ ] 13.1.SEC **Security & Tenancy Audit**: no secrets/PII/token examples in the doc.
  - [ ] 13.1.SR **Semantic Review**: statements match shipped behavior (no draft-era claims); cites the real service symbol + file.
  - [ ] 13.1.IV **Instruction Verification**: read root `AGENTS.md` + printed rule files; validate.
  - _Requirements: REQ-014.1, C15_

- [ ] 13.2 **Update `docs/teachers/applicant-lifecycle.md` §1**
  - Add the `passed → in_evaluation` (paid re-evaluation) transition row with its write-ownership note (the new governance writer `reopenForReEvaluation`). This is a propagation edit, not a guard-layer change.
  - [ ] 13.2.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts docs/teachers/applicant-lifecycle.md --lifecycle duplicates` (exit 0)
  - [ ] 13.2.TE **Test Engineering**: n/a (doc) — confirm the transition row's predicate matches `ApplicantRepository.reopenForReEvaluation`.
  - [ ] 13.2.SEC **Security & Tenancy Audit**: n/a.
  - [ ] 13.2.SR **Semantic Review**: doc table matches code predicate exactly; no contradiction with the shipped guard layer.
  - [ ] 13.2.IV **Instruction Verification**: read printed rule files; validate.
  - _Requirements: REQ-014.2, C15_

- [ ] 13.3 **Mark `docs/billing/escrow-and-wallet-crediting.md` §8.2 hand-off delivered**
  - Mark the re-evaluation hand-off delivered with a pointer to `TeacherReEvaluationService.orderReEvaluation` and the new `docs/teachers/admin-ordered-re-evaluation.md`. Propagation edit only — do NOT re-litigate the invariants.
  - [ ] 13.3.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts docs/billing/escrow-and-wallet-crediting.md --lifecycle duplicates` (exit 0)
  - [ ] 13.3.TE **Test Engineering**: n/a (doc) — confirm the pointer symbol/path exist.
  - [ ] 13.3.SEC **Security & Tenancy Audit**: n/a.
  - [ ] 13.3.SR **Semantic Review**: no AGENTS.md / `.agents/instructions/*.instructions.md` edited (hand-curated only — REQ-014.4).
  - [ ] 13.3.IV **Instruction Verification**: read printed rule files; validate.
  - _Requirements: REQ-014.3, REQ-014.4, C15_

- [ ] 13.4 **Phase-7 checkpoint**: read all `outcome/` files; write `outcome/13-knowledge-propagation-outcome.md`; flip Phase-7 checkboxes to `[x]`.
  - _Requirements: REQ-001.4, REQ-001.5_

---

## Phase 8 — Final Quality Gate & Execution-Protocol Verification [REQ-001]

### Task 14: Deferred-items enforcement, baseline comparison, outcome synthesis, protocol compliance

- [ ] 14.1 **Deferred-items enforcement (BLOCKING)**
  - `grep -c "❌\|⚠️" ai/plans/milestone_3_parent_portal_admin_governance/admin_ordered_re_evaluation_teacher_wallet_deduction/deferred-items.md` — expected `0`.
  - Resolve D-001 (product fee confirmation), D-002 (`re_evaluation` SessionType unused — documented), D-005 (teacher notification deferred) with status + verification references, or create explicit target tasks.
  - _Requirements: REQ-001.2, REQ-014.5_

- [ ] 14.2 **Baseline comparison**
  - Compare current `bun tsgo` / `bun biome:check` / `bun run scripts/lint-service.ts --json --id final` against `/tmp/baseline-tsgo.txt`, `/tmp/baseline-biome.txt`, `/tmp/baseline-lint.json`; document every NEW error introduced (expected: none).
  - Run the full-suite gates: `bun tsgo`, `bun biome:check`, `bun run lint`, `bun run check:unused`, `bun run check:duplicates`.
  - _Requirements: REQ-001.1, REQ-001.6_

- [ ] 14.3 **Whole-feature verification (deliverable-as-received)**
  - Run the repo/service tests: `bun run test/scripts/run-test.ts backend/db/test/repo/teachers/applicant.repository.re-evaluation.test.ts`, `.../teacher.repository.test.ts`, `.../evaluation.repository.test.ts`, `bun run test/scripts/run-test.ts backend/services/teachers/teacher-re-evaluation.service.test.ts`.
  - Run the journey: `bun run test/scripts/run-test.ts test/workflows/teachers/admin-ordered-re-evaluation.journey.test.ts`.
  - Confirm the wire test + SDL pins + audit-census drift test are green.
  - _Requirements: REQ-001.6, REQ-013.1_

- [ ] 14.4 **Outcome synthesis + protocol compliance**
  - Read ALL `outcome/` files and synthesize; confirm the deferred-items ledger is final.
  - Confirm every subtask flipped `[ ]` → `[x]` (REQ-001.5), every modified file passed the sub-loop (REQ-001.6), and the semantic-review checklist was executed for each (REQ-001.7).
  - Confirm NO AGENTS.md or `.agents/instructions/*.instructions.md` file was edited (REQ-014.4).
  - Write `outcome/14-final-outcome.md`.
  - [ ] 14.4.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts ai/plans/milestone_3_parent_portal_admin_governance/admin_ordered_re_evaluation_teacher_wallet_deduction/outcome/14-final-outcome.md --lifecycle duplicates` (exit 0)
  - [ ] 14.4.IV **Instruction Verification**: read the AGENTS.md + `.agents/instructions` files printed by sub-loop.ts; validate.
  - _Requirements: REQ-001.3, REQ-001.4, REQ-001.5, REQ-001.6, REQ-001.7, REQ-014.4, REQ-014.5_
