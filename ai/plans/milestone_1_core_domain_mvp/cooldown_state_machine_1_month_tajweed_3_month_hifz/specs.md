# Requirements — Cooldown State Machine (1-Month Tajweed / 3-Month Hifz)

> **Plan directory (verbatim):** `ai/plans/milestone_1_core_domain_mvp/cooldown_state_machine_1_month_tajweed_3_month_hifz/`
> **Ticket:** `Cooldown State Machine (1-Month Tajweed / 3-Month Hifz)` (`docs/planning/TICKETS.md:818-868`) — Dev 2 · Milestone 1 · 5 SP · Blocked By `Evaluation Rubric Scoring (≥80% Threshold)` (SHIPPED)
> **Specs of record:** this file · **Design:** `plan.md` (same directory) · **Tasks:** `tasks.md` (same directory) · **Ledger:** `deferred-items.md` (same directory)
> **Decision Refs:** FR-3.7 (`docs/specs/functional-requirements.md:117`), FR-3.6 (`:110`), INV-TV3 (`docs/specs/state-machine-invariants.md:89`), INV-TV4 (`:90`), INV-TV6 (`:92`), INV-U2 (`:248`)
> **Reconciliation authority:** `docs/teachers/applicant-lifecycle.md:60-67,154` (two-source split — binding reading over the ticket's draft-era Gherkin)

## Document Information

| Field | Value |
|---|---|
| Feature Name | Cooldown State Machine (1-Month Tajweed / 3-Month Hifz) |
| Milestone | M1 (`milestone_1_core_domain_mvp`) |
| Owner Stream | Dev 2 |
| Story Points | 5 |
| Version / Date | 2.0 · 2026-09-27 (supersedes the dual-deny draft of 2026-09-26) |
| Plan kind | backend-only slice — zero schema delta; one new admin service method + GraphQL mutation, one derived read-model field, one journey test; no frontend files |
| Hard inputs (EXISTING, verified) | `backend/db/schema/users/users.ts:32-36` (suspended family) · `backend/db/schema/teachers/applicants.ts:23-24` (cooldown_until, status) · `backend/db/schema/enums.ts:53` (rubricWeaknessArea) · `shared/constants/evaluation-rubric.constants.ts:21,24` (TAJWEED/HIFZ_COOLDOWN_DAYS) · `backend/services/teachers/applicant-lifecycle.service.ts:142-281` (read/gate) · `backend/services/teachers/evaluation-rubric.helpers.ts:384-395` (write-on-fail) |
| Downstream consumers (blocked by this ticket) | `Failed Applicant → Student Record Conversion` (`docs/planning/TICKETS.md:872-912`) · `Admin Override of Evaluation Results` (`docs/planning/TICKETS.md:916-958`) — both Blocked By the Cooldown State Machine ticket |

## Introduction

A teacher applicant who fails the 5-session rubric verification cycle is barred from re-purchasing the verification plan for a cooldown window: **30 days** when the primary failure area is Tajweed, **90 days** when it is Hifz (`docs/specs/functional-requirements.md:117`, FR-3.7). The cooldown is the platform's honesty gate against endless free re-attempts: an applicant who cannot demonstrate the memorization or recitation standard must study before re-entering the evaluation loop.

The blocker ticket (`Evaluation Rubric Scoring (≥80% Threshold)`) shipped the **mechanical** cooldown: the failure writer stamps `applicants.cooldown_until` (`backend/services/teachers/evaluation-rubric.helpers.ts:384-395` → `ApplicantRepository.transitionToFailed` at `backend/db/repo/teachers/applicant.repository.ts:468-485`) and the re-purchase guard rejects with `APPLICANT_COOLDOWN_ACTIVE` → HTTP 422 (`backend/services/teachers/applicant-lifecycle.service.ts:204-250`). What does **not** exist yet is the cooldown as a **first-class state machine**: an admin primitive to extend the cooldown beyond its minimum (INV-TV4: "These are minimums"; ticket test scenario: "can be extended by admin"), an explicitly observable expired state, audit logging of admin cooldown mutations, and a workflow-journey test that locks the full active→expired→re-apply arc end-to-end.

### Feature Summary

Formalize the cooldown as a state machine owned by `ApplicantLifecycleService`: add the admin cooldown-extension primitive (service + GraphQL mutation + audit log), expose a derived `cooldownState` read-model (`None | Active | Expired` on the wire; real TS enum per REQ-002.4) on `ApplicantProfile`, enforce the two-source split (re-purchase gating reads `applicants.cooldown_until` ONLY — never `users.suspended`), and ship a journey test covering the full cooldown lifecycle.

### Business Value

The academy can extend a cooldown when an applicant's weakness is judged deeper than the default window (FR-3.7 minimums, INV-TV4); every admin cooldown mutation is auditable for compliance; the frontend gets an explicit "cooldown expired — you may re-apply" signal instead of inferring it from `cooldownActive=false`; the two-source split (login/session gating via `users.suspended` vs re-purchase gating via `applicants.cooldown_until`) is test-locked so a future writer cannot regress it.

### Scope

**In scope:** the admin cooldown-extension primitive (service + GraphQL mutation + audit log); the derived `cooldownState` read-model field; two-source-split enforcement (cooldown writer MUST NOT touch `users.suspended`); the cross-actor journey test (`test/workflows/teachers/cooldown-state-machine.test.ts`); i18n plumbing for the new admin mutation/error copy; SDL/codegen refresh.

**Out of scope (explicit — deferred to child tickets):**
- Failed applicant → `students` record conversion (`docs/planning/TICKETS.md:872-912`, Blocked By this ticket) — deferred item D1.
- Admin override of evaluation results: certify / reject / grant-re-evaluation (`docs/planning/TICKETS.md:916-958`, Blocked By this ticket) — deferred item D2; this ticket ships ONLY the low-level cooldown-extension primitive those compose.
- `users.suspended` login/session-class gating (INV-U2) — separate governance domain (`backend/services/admin/user-governance.helpers.ts:230`); the cooldown state machine MUST NOT touch it.
- Frontend UI / routes / nav items — the consuming UI arrives with the child tickets.

## Requirements

### REQ-001: Pre-Implementation Baseline & Execution Protocol

**User Story:** As the executing agent, I want an error baseline and persistent outcome tracking, so that new issues are distinguishable from pre-existing ones and past research is never redone.

#### Acceptance Criteria

1. WHEN implementation begins THEN the agent SHALL record baseline counts (`bun tsgo`, `bun biome:check`, `bun run scripts/lint-service.ts --json --id baseline`) and write `ai/plans/milestone_1_core_domain_mvp/cooldown_state_machine_1_month_tajweed_3_month_hifz/outcome/0-baseline-outcome.md`.
2. WHEN implementation begins THEN the agent SHALL confirm `deferred-items.md` exists in the plan directory (created with this plan, seeded with D1..D5).
3. WHEN an executing agent starts any task THEN it SHALL read ALL existing files in the plan's `outcome/` directory first.
4. WHEN an executing agent completes any task THEN it SHALL write `outcome/<task-id>-outcome.md` with research findings, implementation details, cross-file dependencies, and carry-over points.
5. WHEN an executing agent completes any subtask THEN it SHALL flip the checkbox `[ ]` → `[x]` in `tasks.md`.
6. WHEN any file is modified THEN the agent SHALL run `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` on it and SHALL NOT proceed until exit code 0.
7. WHEN any subtask is marked complete THEN the agent SHALL have completed the semantic-review checklist (race conditions, tenancy, enums-as-values, dead code, deferred items logged) — the sub-loop script cannot detect these.

### REQ-002: Translation & Enum Compliance

**User Story:** As a maintainer, I want user-facing strings compile-time checked and enums imported as values, so locale and type errors surface at build time.

#### Acceptance Criteria

1. WHEN any new user-facing error string is added THEN it SHALL live in the `errorsTranslations` namespace as a typed `ErrorsLabels` leaf with identical key sets in `shared/locale/en/errors/index.ts` and `shared/locale/ar/errors/index.ts` (parity tests green).
2. WHEN backend code needs localized text THEN it SHALL call `getServerTranslations(locale)` from `@/shared/locale/server-graphql` (single-arg) and access leaves by property — never hardcoded English, never `next-intl`, never `shared/messages/`.
3. WHEN an enum is referenced in a runtime expression (cast, conditional, object literal) THEN it SHALL be imported as a value (never `import type`) and members used instead of string literals (`ApplicantStatus`, `AuditActionType`, `RubricWeaknessArea`).
4. WHEN a GraphQL enum is added (`ApplicantCooldownState`) THEN it SHALL be a real TS enum in `backend/enum/teachers/applicant-cooldown-state.enum.ts` (mirroring `applicant-status.enum.ts:12` — members `None = "none"`, `Active = "active"`, `Expired = "expired"` + a fail-closed guard), registered as a Pothos enum in `backend/graphql/pothos/shared/enum.pothos.ts` by passing the enum OBJECT (the `ApplicantStatusPothosEnum` idiom at `:116-119`) — NOT a new `pgEnum` (derived read-model; no DB column backs it), NOT a string-literal union. Wire names follow the TS member names (`None | Active | Expired`, the `ApplicantStatus` precedent).

### REQ-003: Cooldown Write on Failure — Tajweed 30d / Hifz 90d (EXISTING — formalize ownership)

**User Story:** As the academy, I want a failed applicant's cooldown stamped the instant their rubric cycle fails, so the re-application clock starts deterministically from the failure event (INV-TV4).

#### Acceptance Criteria

1. WHEN the 5th rubric submission finalizes a FAILED verdict (`deriveRubricVerdict` at `backend/services/teachers/evaluation-rubric.helpers.ts:293`) THEN the system SHALL stamp `applicants.cooldown_until = now + durationDays × MS_PER_DAY` via `finalizeRubricFail` (`evaluation-rubric.helpers.ts:384-395`) → `ApplicantRepository.transitionToFailed` (`backend/db/repo/teachers/applicant.repository.ts:468-485`).
2. WHEN the primary failure area is `RubricWeaknessArea.Tajweed` THEN `durationDays` SHALL equal `TAJWEED_COOLDOWN_DAYS` (30, `shared/constants/evaluation-rubric.constants.ts:21`); WHEN it is `RubricWeaknessArea.Hifz` THEN `durationDays` SHALL equal `HIFZ_COOLDOWN_DAYS` (90, `:24`); resolved by `resolveFinalizationCooldownUntil` (`evaluation-rubric.helpers.ts:326`).
3. WHEN the guarded `transitionToFailed` matches zero rows (a concurrent finalization won) THEN the system SHALL surface `ConflictError("APPLICANT_ALREADY_FINALIZED")` and roll back the whole transaction (`evaluation-rubric.helpers.ts:391-394`).
4. WHEN the FAIL finalization commits THEN the system SHALL write NOTHING else: no `users.suspended` fields, no `students` row, no role flips (docblock contract at `evaluation-rubric.helpers.ts:377-383` — test-locked by REQ-006).
5. This ticket SHALL consume the existing write path with ZERO delta to `finalizeRubricFail` / `transitionToFailed` / `resolveFinalizationCooldownUntil` — the state machine is formalized, not re-implemented.

### REQ-004: Re-Purchase Cooldown Gate — 422 "Cooldown active" (EXISTING — formalize ownership)

**User Story:** As the platform, I want a cooldown-active applicant rejected from purchasing the verification plan with HTTP 422, so the cooldown is enforced at the only gateway that mints a new evaluation cycle (INV-TV3).

#### Acceptance Criteria

1. WHEN `purchaseVerificationPlan` runs (`backend/graphql/mutation/verification-plan-purchase.mutation.ts:46`) THEN the system SHALL call `ApplicantLifecycleService.assertCanPurchaseVerification(userId, locale, tx)` (`backend/services/teachers/applicant-lifecycle.service.ts:204-250`) BEFORE the purchase write, inside the purchase transaction's `tx`.
2. WHEN `applicants.cooldown_until IS NOT NULL AND cooldown_until > now()` (strict `>`, captured-now discipline at `applicant-lifecycle.service.ts:223-225`) THEN the system SHALL throw `ValidationError("APPLICANT_COOLDOWN_ACTIVE")` (`:233`) which the error taxonomy maps to HTTP 422 (`backend/lib/errors/error-code-taxonomy.ts:47`).
3. WHEN `applicants.cooldown_until <= now()` OR `cooldown_until IS NULL` THEN the system SHALL permit the purchase (strict boundary: a cooldown expiring exactly NOW no longer blocks — `docs/teachers/applicant-lifecycle.md:39`).
4. WHEN the applicant status is `passed` THEN the system SHALL throw `ValidationError("APPLICANT_ALREADY_CERTIFIED")` (`applicant-lifecycle.service.ts:240-248`) — checked AFTER the cooldown arm so the time-gated deny wins.
5. This ticket SHALL consume the existing gate with ZERO delta to `assertCanPurchaseVerification` — the state machine is formalized, not re-implemented.

### REQ-005: Cooldown Expiry → Re-Application Allowed (EXISTING behavior + NEW observability)

**User Story:** As a failed applicant whose cooldown has expired, I want my profile to signal "cooldown expired — you may re-apply" and my next purchase to succeed, so I can re-enter the evaluation loop without manual intervention.

#### Acceptance Criteria

1. WHEN `applicants.cooldown_until` is in the past (`cooldown_until <= now()`) THEN the cooldown SHALL be considered EXPIRED and `assertCanPurchaseVerification` SHALL permit the purchase (REQ-004.3).
2. WHEN a re-purchase succeeds on an expired cooldown THEN the system SHALL call `recordReapplication` (`applicant-lifecycle.service.ts:263-281`) → `ApplicantRepository.recordVerificationAttempt` (atomic single-statement increment) and transition `status: failed → in_evaluation` via the purchase flow's `transitionToInEvaluation` (`backend/db/repo/teachers/applicant.repository.ts:407`, predicate `status IN ('pending','failed')`).
3. WHEN the applicant reads `myApplicantProfile` with an expired cooldown THEN the derived `cooldownState` SHALL equal `Expired` (REQ-008) so the frontend can render the "you may re-apply" affordance without inferring it.
4. WHEN the applicant reads `myApplicantProfile` with NO cooldown (`cooldown_until IS NULL`) THEN `cooldownState` SHALL equal `None`.
5. WHEN the applicant reads `myApplicantProfile` with an active cooldown THEN `cooldownState` SHALL equal `Active` AND `canPurchaseVerification` SHALL be `false`.

### REQ-006: Two-Source Split — Cooldown MUST NOT Touch `users.suspended` (FORMALIZE + TEST-LOCK)

**User Story:** As the platform, I want the cooldown state machine to gate re-purchase via `applicants.cooldown_until` ONLY and leave `users.suspended` to the login/session-class governance domain, so the two concerns never couple and a suspended-for-other-reasons user is not accidentally re-purchase-eligible (or vice versa).

> **Reconciliation authority:** `docs/teachers/applicant-lifecycle.md:60-67,154` — the ticket's draft-era Gherkin (`users.suspended = true`, `suspended_period_days = 30`) is SUPERSEDED. The binding reading: re-purchase gating reads `applicants.cooldown_until`; login/session-class gating reads `users.suspended`. No edit to `docs/specs/state-machine-invariants.md` is required or made — the reconciliation paragraph IS the addendum-free record.

#### Acceptance Criteria

1. WHEN the cooldown is written on failure (REQ-003) THEN the system SHALL NOT set `users.suspended`, `users.suspended_at`, or `users.suspended_period_days` — the FAIL finalization writes ONLY `applicants.status` + `applicants.cooldown_until` (docblock at `evaluation-rubric.helpers.ts:377-383`).
2. WHEN the cooldown is extended by admin (REQ-007) THEN the system SHALL NOT set any `users.suspended*` field — the extension writes ONLY `applicants.cooldown_until`.
3. WHEN the cooldown is read for re-purchase gating (REQ-004) THEN `assertCanPurchaseVerification` SHALL read `applicants.cooldown_until` ONLY — never `users.suspended` (grep-verified absence, documented at `applicant-lifecycle.service.ts:18-20`).
4. WHEN `assertActorGovernanceClean` (`backend/services/classes/session-lifecycle.governance.ts:47`) re-checks the caller's `users.suspended` family THEN it SHALL be independent of the cooldown gate — a cooldown-active applicant who is NOT `users.suspended` SHALL still be able to login and attend sessions as a student (REQ-010).
5. WHEN the journey test (REQ-011) runs the fail-then-read arc THEN it SHALL assert `users.suspended === false` AND `users.suspendedPeriodDays === null` after the cooldown is stamped, test-locking the split against regression.

### REQ-007: Admin Cooldown Extension Primitive (NEW — INV-TV4 "minimums")

**User Story:** As an admin, I want to extend an applicant's cooldown beyond the 30/90-day minimum when their weakness is judged deeper, so the re-application lock reflects the academy's assessment (INV-TV4: "These are minimums"; ticket test scenario: "Cooldown period is a minimum (can be extended by admin)").

#### Acceptance Criteria

1. WHEN an admin calls `adminExtendApplicantCooldown(applicantId: Int!, additionalDays: Int!)` THEN the system SHALL compute the new expiry as `max(currentCooldownUntil, now) + additionalDays × MS_PER_DAY` and write it to `applicants.cooldown_until` via a new guarded repository method, inside one transaction.
2. WHEN the applicant's current cooldown has ALREADY expired OR is NULL THEN the system SHALL treat the base as `now` (the extension starts a fresh cooldown from today) — an extension on a non-cooldowned applicant is permitted (the admin is overriding the automated result; FR-3.8 lineage).
3. WHEN `additionalDays` is not an integer in `[1, 3650]` THEN the system SHALL reject with `ValidationError("APPLICANT_COOLDOWN_EXTENSION_INVALID")` (bounds mirror the suspension-window max at `backend/services/admin/user-governance.helpers.ts:169-170`: `SUSPENSION_PERIOD_MIN_DAYS = 1`, `SUSPENSION_PERIOD_MAX_DAYS = 3650`).
4. WHEN the applicant row does not exist THEN the system SHALL reject with `NotFoundError("APPLICANT", …)` → `APPLICANT_NOT_FOUND` (localized, same entity-label discipline as `applicant-lifecycle.service.ts:55`).
5. WHEN the extension commits THEN the system SHALL append exactly ONE `audit_logs` row via `AuditService.createAuditLog` (`backend/services/admin/audit.service.ts:82`) with `actionType: AuditActionType.Adjust`, `entityType: "applicant"`, `entityId: applicantId`, `actorId: ctx.user.id` (never from input), and a `details` JSON carrying field NAMES + the old/new expiry ISOs only (no PII) — the audit row shares the transaction's commit/rollback fate.
6. WHEN a non-admin calls the mutation THEN the Pothos `authScopes: adminOnlyAuthScopes` (`backend/graphql/shared/admin-prelude.ts:24`) SHALL deny with `FORBIDDEN` (403) before the resolver runs.
7. WHEN the applicant is `passed` (certified) THEN the system SHALL reject with `ValidationError("APPLICANT_ALREADY_CERTIFIED")` — a certified applicant has no cooldown to extend (terminal status, REQ-004.4 lineage).

### REQ-008: Cooldown State Read-Model (NEW — derived field)

**User Story:** As a frontend consumer (and the journey test), I want an explicit `cooldownState` enumeration on `ApplicantProfile`, so "cooldown expired — you may re-apply" is a single observable value instead of inferred from `cooldownActive=false && cooldownUntil !== null`.

#### Acceptance Criteria

1. WHEN `getMyApplicantProfile` (`applicant-lifecycle.service.ts:142-181`) shapes the profile THEN it SHALL compute `cooldownState: ApplicantCooldownState` (the real TS enum — wire names `None | Active | Expired`) from the same captured `now` already driving `cooldownActive`:
   - `None` ⇔ `cooldown_until IS NULL`
   - `Active` ⇔ `cooldown_until IS NOT NULL AND cooldown_until > now`
   - `Expired` ⇔ `cooldown_until IS NOT NULL AND cooldown_until <= now`
2. WHEN the profile is returned THEN `cooldownState` SHALL be a new non-nullable field on `ApplicantProfileReturnType` (`backend/types/teachers/applicant.types.ts`) typed as the `ApplicantCooldownState` enum from `backend/enum/teachers/applicant-cooldown-state.enum.ts`, and exposed on `ApplicantProfilePothosObject` (`backend/graphql/pothos/teachers/applicant.pothos.ts:33-55`) via the new `ApplicantCooldownState` Pothos enum registered in `backend/graphql/pothos/shared/enum.pothos.ts` by passing the enum object (NOT a `pgEnum` — derived read-model, REQ-002.4).
3. WHEN `cooldownState === Active` THEN `cooldownActive` SHALL be `true` AND `canPurchaseVerification` SHALL be `false`; WHEN `Expired` or `None` THEN `cooldownActive` SHALL be `false` AND `canPurchaseVerification` SHALL be `true` (unless `status === passed`) — the three fields stay mutually consistent (no drift).
4. WHEN the admin extends the cooldown (REQ-007) THEN a subsequent `myApplicantProfile` read SHALL reflect the new expiry on `cooldownUntil` and `cooldownState === Active` without a page reload beyond Apollo cache re-fetch.

### REQ-009: Audit Logging of Admin Cooldown Mutations (NEW)

**User Story:** As a compliance officer, I want every admin cooldown extension recorded in the append-only `audit_logs` table, so the academy can review who extended which applicant's cooldown and by how much.

#### Acceptance Criteria

1. WHEN `adminExtendApplicantCooldown` commits THEN exactly ONE `audit_logs` row SHALL be appended via `AuditService.createAuditLog(input, tx)` (`backend/services/admin/audit.service.ts:82`) inside the SAME transaction as the cooldown write — the audit row shares the mutation's commit/rollback fate.
2. WHEN the audit contract is composed THEN `actorId` SHALL come exclusively from `ctx.user.id` (never from the mutation input — `audit.service.ts:14-15`); `actionType` SHALL be `AuditActionType.Adjust` (value import, `backend/enum/audit/audit-action-type.enum.ts`); `entityType` SHALL be the lowercase string `"applicant"`; `entityId` SHALL be the applicant's `users.id`.
3. WHEN the `details` JSON is composed THEN it SHALL carry field NAMES + the old/new cooldown expiry ISO strings only (`{"field":"cooldown_until","from":"<iso>","to":"<iso>","additionalDays":N}`) — NEVER contact PII, credentials, or token values (per `audit.service.ts:74-77`); the writer truncates defensively to `varchar(2000)` (`audit.service.ts:51-63`).
4. WHEN the mutation rolls back (e.g. applicant not found) THEN NO audit row SHALL persist — the append is in-transaction (atomicity guarantee at `audit.service.ts:19-22`).
5. WHEN the audit row is later queried THEN `audit_logs.entity_type_entity_id_idx` (`backend/db/schema/audit/audit-logs.ts:45`) SHALL return the applicant's full cooldown-extension history in `created_at ASC` order.

### REQ-010: Failed Applicant Retains Student Privileges During Cooldown (FORMALIZE — child-ticket boundary, INV-TV6)

**User Story:** As a failed applicant who is converted to a student, I want to subscribe to plans and attend sessions during my cooldown, so I can keep studying while I wait to re-apply (INV-TV6).

> **Boundary note:** the `students` row creation itself is the NEXT ticket (`Failed Applicant → Student Record Conversion`, `docs/planning/TICKETS.md:872-912`, Blocked By this ticket — deferred item D1). This requirement formalizes the COOLDOWN STATE MACHINE's obligation: the cooldown MUST NOT block student privileges.

#### Acceptance Criteria

1. WHEN an applicant is in cooldown (`cooldownState === Active`) AND has a `students` row (created by the child ticket) THEN the cooldown SHALL NOT prevent the student from subscribing to plans or attending sessions — the re-purchase gate (REQ-004) gates ONLY `purchaseVerificationPlan`, never `purchaseSubscription`/`createSession`.
2. WHEN the cooldown state machine writes the cooldown (REQ-003, REQ-007) THEN it SHALL NOT set `users.suspended` (REQ-006) — the `assertActorGovernanceClean` session-class gate (`backend/services/classes/session-lifecycle.governance.ts:47`) is independent of the cooldown, so a cooldown-active applicant's session requests are NOT denied on cooldown grounds.
3. WHEN the journey test (REQ-011) asserts the cooldown-active-student path THEN it SHALL verify `canPurchaseVerification === false` (cooldown blocks re-apply) AND a normal subscription/session flow is NOT blocked by the cooldown (the two-source split observable, REQ-006).
4. WHEN the applicant later passes re-evaluation THEN `finalizeOnCertification` (`backend/db/repo/teachers/applicant.repository.ts:507-530`) SHALL clear `cooldown_until → NULL` (status → `passed`) — the cooldown is terminal-on-pass, and the students record co-exists (not deleted).

### REQ-011: Cross-Actor Journey — Cooldown Lifecycle (admin ↔ applicant ↔ system)

**User Story:** As the platform, I want a workflow-journey test that exercises the full cooldown lifecycle end-to-end, so the state machine, the two-source split, the admin extension, and the re-application arc are all locked against regression.

This is the domain's cross-actor workflow, so the journey is captured here (mapping 1:1 onto `test/workflows/teachers/cooldown-state-machine.test.ts`).

#### Actor Table

| Actor | Role (`users.role`) | Can Do | Cannot Do |
|---|---|---|---|
| Applicant (failed) | `teacher` | read own `myApplicantProfile`; attempt `purchaseVerificationPlan` (rejected during cooldown); attend sessions as a student (once converted — D1) | extend own cooldown; bypass cooldown |
| Admin | `admin` | `adminExtendApplicantCooldown`; read any applicant profile via admin surface | write `users.suspended` for cooldown purposes (two-source split) |
| System (rubric finalization) | — | stamp `cooldown_until` on FAIL verdict via `finalizeRubricFail` | touch `users.suspended` (REQ-006) |

#### Ordered Step List (Journey J1 — cooldown lifecycle)

1. Fixtures: certified evaluators, applicant with `status='in_evaluation'`, 5 rubric submissions where the lowest-scoring failing area is `tajweed`.
2. System → finalizes the 5th submission (FAIL verdict) → `applicants.cooldown_until = now + 30d`, `applicants.status = 'failed'`, `users.suspended === false` (two-source split lock, REQ-006.5).
3. Applicant → reads `myApplicantProfile` → `cooldownState === Active`, `cooldownActive === true`, `canPurchaseVerification === false`.
4. Applicant → `purchaseVerificationPlan` → DENIED `APPLICANT_COOLDOWN_ACTIVE` → HTTP 422 (REQ-004.2).
5. Admin → `adminExtendApplicantCooldown(applicantId, additionalDays: 60)` → `cooldown_until` becomes `now + 90d` (30 base extended by 60), audit row appended (`AuditActionType.Adjust`).
6. Applicant → reads `myApplicantProfile` → `cooldownUntil` reflects the extended instant, `cooldownState === Active`.
7. System → advances the clock past the EXTENDED expiry (90d) → `cooldownState === Expired` (REQ-008.1).
8. Applicant → `purchaseVerificationPlan` → SUCCEEDS (cooldown expired, REQ-004.3) → `recordReapplication` increments attempts, `status: failed → in_evaluation`.
9. Non-admin → `adminExtendApplicantCooldown` → DENIED 403 (authScopes, REQ-007.6).
10. Admin → `adminExtendApplicantCooldown` on a `passed` applicant → DENIED `APPLICANT_ALREADY_CERTIFIED` (REQ-007.7).
11. Admin → `adminExtendApplicantCooldown(applicantId, additionalDays: 0)` → DENIED `APPLICANT_COOLDOWN_EXTENSION_INVALID` (REQ-007.3).
12. Replay the Hifz arc (fixture: lowest-scoring failing area = `hifz`) → `cooldown_until = now + 90d` (REQ-003.2).

#### Acceptance Criteria (cross-actor, observer-perspective EARS)

1. WHEN the system finalizes a FAIL verdict THEN the applicant SHALL observe `cooldownState === Active` on their next `myApplicantProfile` read AND `users.suspended` SHALL remain `false` (two-source split).
2. WHEN the applicant attempts `purchaseVerificationPlan` during an active cooldown THEN the system SHALL reject with `APPLICANT_COOLDOWN_ACTIVE` (422) AND the applicant SHALL observe NO change to `applicants.status` (the rejection writes nothing).
3. WHEN the admin extends the cooldown THEN the applicant SHALL observe the extended `cooldownUntil` on their next read AND the audit trail SHALL contain exactly one `Adjust` row for the extension.
4. WHEN the cooldown expires THEN the applicant SHALL observe `cooldownState === Expired` AND a subsequent `purchaseVerificationPlan` SHALL succeed AND `applicants.status` SHALL transition `failed → in_evaluation`.
5. IF a non-admin calls `adminExtendApplicantCooldown` THEN the scope layer SHALL deny with `FORBIDDEN` (403) before any DB read.
6. IF the admin extends a `passed` applicant's cooldown THEN the system SHALL reject with `APPLICANT_ALREADY_CERTIFIED` (terminal status guard).

## UX / Navigation Requirements (Explicit No-UI Ruling)

| Aspect | Ruling | Evidence / Rationale |
|---|---|---|
| New routes | NONE | Ticket scope is the cooldown state machine + admin primitive + read-model; the consuming UI arrives with the child tickets (Student Conversion, Admin Override) |
| Sidebar / nav | UNCHANGED | `frontend/views/dashboard/nav/navItems.ts` untouched (verified absence pattern in the milestone-2 progress ticket, same repo) |
| Mobile bottom nav | NONE | The repo has no bottom-nav surface anywhere (confirmed across shipped plans) |
| Role surfaces | `myApplicantProfile` query (existing) gains `cooldownState` field; `adminExtendApplicantCooldown` mutation (new, admin-scoped); per-role behavior in REQ-011 | No frontend Apollo document, store, or view is added in this ticket |
| Frontend deps | NONE | Zero `frontend/` and zero `app/` changes; codegen refresh only (`bun run generate:gqlSchema` + `bun codegen`) so the new field/enum/mutation are typed for the NEXT ticket |

## Non-Functional Requirements

### Performance

1. WHEN `getMyApplicantProfile` runs THEN the `cooldownState` derivation SHALL add ZERO queries — it is pure compute against the SAME captured `now` and the SAME single `findByUserId` read already driving `cooldownActive` (`applicant-lifecycle.service.ts:150,164`).
2. WHEN `adminExtendApplicantCooldown` runs THEN it SHALL perform ≤ 3 statements (one `findByUserId` read for the status guard, one guarded `update` write, one `audit_logs` insert) — all equality-indexed on `applicants.id` / `audit_logs.entity_type_entity_id_idx`.
3. WHEN the journey test runs THEN the 12-step lifecycle SHALL complete in ≤ 5s wall-clock against the rollback-isolated test DB (no real sleeps; clock advance is a fixture helper).

### Security

1. WHEN any resolver path executes THEN caller identity SHALL come exclusively from `ctx.user` (verified JWT → `UserRepository.findById`); `applicantId` / `additionalDays` are resource selectors / inputs, never identity claims.
2. WHEN the admin mutation runs THEN `actorId` for the audit row SHALL come exclusively from `ctx.user.id` — never from the mutation input (`audit.service.ts:14-15`); a forged `actorId` in the input is ignored (not read).
3. WHEN DTOs are constructed THEN they SHALL be field-picked (no `{ ...row }` spread into the wire shape — BOPLA, the existing `ApplicantProfilePothosObject` discipline at `applicant.pothos.ts:6-10`).
4. WHEN the cooldown extension writes THEN it SHALL write only `applicants.cooldown_until` + `updated_at` via strict column picks (no input spread exists — `additionalDays` is a scalar, not a row).

### Reliability

1. WHEN a concurrent admin-extension + rubric-finalization race occurs THEN the guarded `transitionToFailed` predicate (`status = 'in_evaluation'`, `applicant.repository.ts:482`) SHALL make one writer win and the other surface a typed conflict — no partial writes (REQ-003.3 lineage).
2. WHEN the admin extension transaction fails mid-way (audit insert throws) THEN the cooldown write SHALL roll back with it (in-transaction atomicity, REQ-009.4) — the trail never survives a rolled-back mutation.

### Observability

1. WHEN the admin mutation succeeds THEN exactly ONE `logger` structured log SHALL carry `{ code: "APPLICANT_COOLDOWN_EXTENDED", applicantId, additionalDays, oldExpiry, newExpiry }` (entity ids only, no PII) — mirroring the `logDomainError` discipline at `applicant-lifecycle.service.ts:213-218`.

## Constraints and Assumptions

### Technical Constraints

- Zero schema delta (REQ-003.5, REQ-004.5): `db push`/`migrate` are NOT part of this plan; only `bun run generate:gqlSchema` + `bun codegen` for the GraphQL surface (new field + enum + mutation).
- The cooldown extension MUST run inside one `withTransaction` boundary co-joining the cooldown write + the audit insert — no post-commit async job (no event mechanism exists in the codebase; direct sequential calls on the same `tx` are the established side-effect convention, per the milestone-2 progress ticket `plan.md`).
- All repo writes take `tx` as the LAST parameter (per-repo docblock convention, e.g. `backend/db/repo/teachers/applicant.repository.ts:468-472`); bare non-transactional reads fall back to `queryDb` (rule: "Bare Reads" in `backend/AGENTS.md`).

### Business Constraints

- 5 SP · Dev 2 · Milestone 1. Anything requiring schema change, the student-conversion write, or the full admin-override (certify/reject/re-evaluation) surface is deferred (D1, D2), not expanded.
- The 30d/90d values are MINIMUMS (INV-TV4); the admin extension may only LENGTHEN, never shorten below the original minimum within the same cycle (the `max(currentCooldownUntil, now)` base, REQ-007.1, prevents shrinking an active cooldown below its remaining window).

### Assumptions

- The rubric-scoring blocker ticket (SHIPPED) reliably stamps `cooldown_until` on FAIL; this ticket consumes that path with zero delta (REQ-003.5).
- `applicants.status` is a plain varchar enforced at the service layer (no pgEnum, `applicants.ts:13-15`); the fail-closed guard `isApplicantStatus` (`applicant-lifecycle.service.ts:159-161`) is the sole runtime vocabulary authority — the new `cooldownState` is a DERIVED read-model, not a stored status.
- The journey test's clock advance uses the existing test-DB fixture pattern (no production time-mock); `getMyApplicantProfile` reads wall-clock ONCE per invocation so a fixture-set `cooldown_until` in the past deterministically yields `cooldownState === Expired`.

## Success Criteria

### Definition of Done

- [ ] All REQ-001…REQ-011 acceptance criteria are met
- [ ] `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` exits 0 for every modified/new file
- [ ] Service tests (`backend/services/teachers/applicant-lifecycle.service.test.ts` extended), repo tests (`backend/db/test/repo/teachers/applicant.repository.test.ts` extended), GraphQL wire/role tests green
- [ ] Journey `test/workflows/teachers/cooldown-state-machine.test.ts` green via `bun run test/scripts/run-test.ts test/workflows`
- [ ] `deferred-items.md` contains zero ❌/⚠️ entries at the final gate
- [ ] Phase 1.5 gate passed (this plan): `outcome/plan-review-R2.md` records a clean verdict for the reworked two-source-split artifacts (R1 reviewed the superseded dual-deny draft and carries the supersession banner)

### Acceptance Metrics

- 100% branch coverage on the new `extendApplicantCooldown` service method + the `cooldownState` derivation (repo: `runInRollback` + `tx` discipline)
- Zero new tsgo/biome/lint errors vs baseline (`outcome/0-baseline-outcome.md`)
- Journey: 12 ordered steps (REQ-011) asserted, including both denial probes (403, INVALID bounds, ALREADY_CERTIFIED) and the two-source-split lock (`users.suspended === false` after cooldown stamp)
- Grep proof: zero `users.suspended` writes in the cooldown-extension code path (REQ-006.2 enforcement)

## Glossary

| Term | Definition |
|---|---|
| Cooldown | The re-application lock window stamped on `applicants.cooldown_until` when an applicant FAILS the 5-session rubric cycle; gates ONLY `purchaseVerificationPlan` (INV-TV3) |
| Two-source split | The binding reconciliation (`docs/teachers/applicant-lifecycle.md:60-67,154`): re-purchase gating reads `applicants.cooldown_until` ONLY; login/session-class gating reads `users.suspended` (+ governance family). The cooldown state machine writes NEITHER `users.suspended*` field. |
| Cooldown state (read-model) | A DERIVED three-valued enumeration (`none \| active \| expired`) computed from `applicants.cooldown_until` + a captured `now`; NOT a stored column, NOT a pgEnum — a Pothos enum on the wire |
| Minimum (INV-TV4) | The 30d (Tajweed) / 90d (Hifz) values are floor minimums; the admin extension (REQ-007) may only lengthen, never shorten below the remaining active window |
| Captured-now discipline | The wall clock is read ONCE per invocation (`new Date()`); every cooldown comparison is pure compute against that single instant — no drift between `cooldownActive` and `cooldownState` (`applicant-lifecycle.service.ts:164`) |
| Strict `>` boundary | `cooldownActive ⇔ cooldown_until > now`; a cooldown expiring exactly NOW no longer blocks (`docs/teachers/applicant-lifecycle.md:39`) |
| Terminal-on-pass | `finalizeOnCertification` (`applicant.repository.ts:507-530`) clears `cooldown_until → NULL` and sets `status → passed`; the cooldown is superseded and cannot be re-extended (REQ-007.7) |

---

## Requirements Review Checklist

- [x] User stories have roles/features/benefits · EARS throughout · NFRs present · Success criteria measurable
- [x] UX/navigation defined for all roles (explicit no-UI ruling with evidence)
- [x] Cross-actor journey captured: actor table + 12 ordered steps + observer-perspective EARS (REQ-011)
- [x] Terminology consistent with `docs/specs/state-machine-invariants.md`, `docs/specs/functional-requirements.md`, and the binding reconciliation at `docs/teachers/applicant-lifecycle.md:154`
- [x] Every EXISTING code claim verified with `path:line` (no invented symbols; `LocaleType`-style failures avoided — services take `locale: string`)
- [x] Two-source split test-locked (REQ-006.5) — the ticket's draft-era `users.suspended` Gherkin is reconciled, not implemented literally
