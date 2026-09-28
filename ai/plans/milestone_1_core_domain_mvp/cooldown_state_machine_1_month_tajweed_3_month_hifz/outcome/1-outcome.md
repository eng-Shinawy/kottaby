# Task 1 Outcome — `ApplicantCooldownState` Enum + Types Extension

> **Date:** 2026-09-27 · **Ticket:** `docs/planning/TICKETS.md:818-868` (T2-008 — Dev 2 · M1 · 5 SP)
> **Plan directory (verbatim):** `ai/plans/milestone_1_core_domain_mvp/cooldown_state_machine_1_month_tajweed_3_month_hifz/`
> **Specs:** `specs.md` (REQ-002, REQ-008) · **Design:** `plan.md` §3.3 · **Task def:** `tasks.md` Phase 1 · **Ledger:** `deferred-items.md`
> **Outcome of record:** `outcome/plan-review-R2.md` gate passed; this file records Task 1 execution.

---

## 1. Files created / modified

| File | Change | Evidence |
|---|---|---|
| `backend/enum/teachers/applicant-cooldown-state.enum.ts` | CREATE — real TS enum `ApplicantCooldownState { None = "none", Active = "active", Expired = "expired" }` + pre-allocated `APPLICANT_COOLDOWN_STATE_MEMBERS` ReadonlySet + fail-closed guard `isApplicantCooldownState` | mirrors `applicant-status.enum.ts:12-30` and `rubric-weakness-area.enum.ts:14-30` discipline exactly (enum → members set → guard); docblock cites the strict-`>` boundary contract (`docs/teachers/applicant-lifecycle.md` §2.1); NOT a pgEnum, NOT a string-literal union (zero `backend/db/schema/` delta) |
| `backend/enum/teachers/applicant-cooldown-state.enum.test.ts` | CREATE — 4-tier guard suite (22 tests / 283 expects), mirroring `applicant-status.enum.test.ts` tier-for-tier: Tier 1 branch coverage (frozen canonical value set `none\|active\|expired`, all three members admitted, narrowing probe), Tier 2 boundaries (case/whitespace/empty/near-miss/primitives + cross-vocabulary rejection of all four `ApplicantStatus` values), Tier 3 chaos/fuzz (deterministic LCG fuzz ×200, 10k payloads, unicode/RTL, LIKE wildcards, control chars), Tier 4 security (toString override, throwing coercion, `Object.create(null)`, `__proto__` payload, Symbol, arrays/functions — all reject WITHOUT throwing) |
| `backend/types/teachers/applicant.types.ts` | EXTEND — (a) `readonly cooldownState: ApplicantCooldownState` appended as the 8th field of `ApplicantProfileReturnType` (after `canPurchaseVerification`, matching plan §3.3 field order exactly; existing 7 fields untouched); (b) NEW `ApplicantCooldownExtensionAudit` interface (plan §3.3): `readonly field: "cooldown_until"`, `readonly from: string \| null`, `readonly to: string`, `readonly additionalDays: number` — audit carries field NAME + old/new expiry ISO instants only, never PII; (c) type-only import of `ApplicantCooldownState` added beside the existing `ApplicantStatus` type import (Biome `useImportType` note updated to cover both enums) |
| `backend/enum/teachers/index.ts` | EXTEND — added `export * from "./applicant-cooldown-state.enum";` (line 2, `./` relative path per barrel mechanics). No TS2308 collision → no named re-export needed. Top-level `backend/enum/index.ts` re-exports the sub-barrel — unchanged. |
| `backend/types/teachers/index.ts` | NO CHANGE — already `export * from "./applicant.types";`, so `cooldownState` + `ApplicantCooldownExtensionAudit` flow through the barrel automatically (verified) |

## 2. Verification results

| Gate | Command | Result |
|---|---|---|
| Sub-loop | `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` (tsgo → oxlint → biome → lint:type-aware → check:duplicates) | ✅ exit 0 on each of the 4 touched files, run individually (the sub-loop script is SINGLE-FILE ONLY — `scripts/health/sub-loop.ts:12` — so the task's 3-file one-liner processes only its last pathspec; each file was verified separately) |
| Enum guard unit test | `bun run test/scripts/run-test.ts backend/enum/teachers/applicant-cooldown-state.enum.test.ts` | ✅ 22 pass / 0 fail / 283 expects, exit 0 |
| Project-wide typecheck | `bun tsgo` | ⚠️ exactly **2 new errors**, both in construction sites of `ApplicantProfileReturnType` (expected type-first sequencing, see §3) |

## 3. Cross-file dependencies discovered (CARRY-OVER — must be resolved by later tasks)

`bun tsgo` after this task reports exactly 2 new errors — both are **missing-`cooldownState` construction sites** (TS2741), i.e. the intended downstream consumers, NOT defects in Task 1:

1. **`backend/services/teachers/applicant-lifecycle.service.ts:168`** — `getMyApplicantProfile`'s return object. **Assigned: Task 4** extends this function to compute `cooldownState` from the same captured `now` (`:164`) that drives `cooldownActive` (plan §5.4 `deriveCooldownState`). No action in Task 1.
2. **`backend/services/admin/user-management.mappers.ts:120-128`** — `buildApplicantSnapshot` constructs an `ApplicantProfileReturnType`-shaped object (the admin user-detail `applicant` role-child snapshot) and does NOT yet set `cooldownState`. **NOT explicitly assigned in `tasks.md`** (the file is absent from both the Task 1 file list and the plan's "Extended files" table — a plan gap surfaced by the type-first change). It must derive `cooldownState` from `row.applicantCooldownUntil` vs a captured `now` (same strict-`>` boundary) before the final gate (Task 8: "zero new tsgo errors vs baseline"). Reported to the orchestrator per the fix-or-report rule — this file was NOT modified by Task 1.

Both errors are attributable 1:1 to this plan's diff (baseline was 0/0/0 per `outcome/0-baseline-outcome.md`).

## 4. Pipeline checklist evidence

- **1.QL** ✅ — sub-loop `--lifecycle duplicates` exit 0 on all four files (see §2).
- **1.TE** ✅ — enum guard unit test green (three member values admitted; wrong type / case / whitespace / foreign values / hostile objects fail closed). Type-level usage probe: the narrowing test (`true result narrows unknown to ApplicantCooldownState`) pins the type-predicate behavior; the service-level type probe + runtime derivation land in Task 4's service test (its file was out of Task 1's allowed edit scope).
- **1.SEC** ✅ — `cooldownState` is an enum member value (one of `none|active|expired`), never a `Date`; the only `Date`-typed fields on the profile return shape are the pre-existing `lastAttemptAt`/`cooldownUntil` (serialized by the `DateTime` scalar). No new `Date` surface.
- **1.SR** ✅ — all new interface fields `readonly` (`cooldownState`, `ApplicantCooldownExtensionAudit.*`); `ApplicantCooldownState` is a REAL TS enum living in `backend/enum/teachers/` (not a string-literal union, not a `pgEnum` — zero DDL, zero schema delta, deferred-item D5 respected); the guard mirrors the `isApplicantStatus` discipline byte-for-byte in shape (members set pre-allocated at module scope, `typeof` short-circuit, fail-closed membership check, `value is` predicate). Enums-as-values: the members set is built from `Object.values(ApplicantCooldownState)` — no hardcoded value arrays.
- **1.IV** ✅ — rule files read in full before/while editing: root `AGENTS.md`, `backend/AGENTS.md`, `backend/types/AGENTS.md`, `backend/enum/AGENTS.md`, `backend/graphql/AGENTS.md` (Pothos enum-registration rule — the reason the enum is a real TS enum), `.agents/instructions/backend.instructions.md`, `.agents/instructions/tests.instructions.md`, plus what the sub-loop printed for each file.

## 5. Comment discipline

Zero references to REQ IDs, task numbers, phases, or `ai/plans/…` artifacts in any code comment or JSDoc. Docblocks describe domain behavior only (derived read-model semantics, strict-`>` boundary contract, audit content guarantees, type-import normalization note).

## 6. Notes for downstream tasks

- Task 4: consume `ApplicantCooldownState` as a VALUE import (enum members, never string literals) in the service + Pothos registration; compute `cooldownState` in `getMyApplicantProfile` (fixes tsgo error #1); compose `ApplicantCooldownExtensionAudit` for the audit `details` payload.
- Task 6: register `gqlSchemaBuilder.enumType(ApplicantCooldownState, { name: "ApplicantCooldownState" })` in `backend/graphql/pothos/shared/enum.pothos.ts` passing the enum OBJECT (the `ApplicantStatusPothosEnum` idiom at `enum.pothos.ts:116-119`); wire names will follow TS member names (`None | Active | Expired`).
- Orchestrator/Task 4 wave: resolve the `user-management.mappers.ts` gap (§3.2) before the final gate.
