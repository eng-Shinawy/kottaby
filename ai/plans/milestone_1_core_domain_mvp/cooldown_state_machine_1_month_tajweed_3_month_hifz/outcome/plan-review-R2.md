# Plan Review Gate — R2 Verdict: T2-008 Cooldown State Machine (Two-Source-Split Rework)

> **Date**: 2026-09-27 · **Reviewer**: R2 Plan Review Gate agent (read-only audit of the reworked artifacts) + orchestrator fix pass
> **Scope**: full-plan review of the reworked two-source-split artifacts against repo ground truth — ~50 cited `path:line` spot-checks, two-source-split coherence, cross-file consistency, command validity, AGENTS.md convention compliance, internal structure.
> **Artifacts reviewed**: `specs.md` (2.0) · `plan.md` (2.0, 539 lines) · `tasks.md` (2.0, restored mid-point gate + post-implementation wave) · `deferred-items.md` (2.0, row-anchored enforcement) · `outcome/00-research-evidence-pack.md` (rewritten for the two-source split) · `outcome/plan-review-R1.md` (supersession banner only — historical content out of scope).
> **Predecessor**: R1 (banner-superseded) reviewed the dual-deny draft; this round reviews the rework that PR #250's architecture won and the `plans` branch's rigor was ported onto.

## Verdict Table

| Dimension | Status | Findings |
|---|---|---|
| (a) Path/symbol errors (~50 citations spot-verified) | PASS after fixes | 3 (F1 enum idiom, F3 nonexistent pathspec, F5 helper path) |
| (b) Enum idiom compliance (backend/graphql AGENTS enum rule — real TS enums, no string unions) | PASS after fix | 1 (F1 — HIGH) |
| (c) i18n compliance (namespaces, single-arg loader, parity) | PASS | 0 |
| (d) GraphQL conventions (authScopes, mutation idiom, barrels, deep imports) | PASS after fix | 1 (F7 barrel-chain naming) |
| (e) Two-source-split coherence (no `users.suspended*` writes anywhere) | PASS after fix | 1 (F2 false grep claim in Task 4) |
| (f) Traceability (REQ-001..REQ-011 specs ↔ plan ↔ tasks) | PASS | 0 |
| (g) Command validity (sub-loop, run-test, codegen, quality-gate, ledger grep) | PASS after fixes | 2 (F3, plus the ledger grep verified by execution → 0) |
| (h) Version/date coherence + gate references | PASS after fix | 1 (F4 stale 1.0 header + R1 DoD reference) |
| (i) Evidence-pack alignment (D3 enum prescription, journey-lock scope) | PASS after fixes | 2 (F1-D3, F6) |

**Totals: 7 findings — 1 HIGH, 3 MEDIUM, 3 LOW; all fixed in-place. 0 blockers remain.**

## Findings

**F1 — HIGH · plan.md D1/§3.3/§4.1 · tasks.md Task 1/Task 6 · specs.md REQ-002.4/REQ-008 · evidence pack D3 · `ApplicantCooldownState` was prescribed as a string-literal union, violating the backend/graphql enum rule.** The repo mandates real TS enums in `backend/enum/` for GraphQL enums (precedent: `ApplicantStatus` at `backend/enum/teachers/applicant-status.enum.ts:12`, registered at `enum.pothos.ts:116-119`, wire names = member names per `schema.graphql:642-647`). The union prescription was also internally contradictory (Task 6 demanded a byte-for-byte mirror of `ApplicantStatusPothosEnum`, which requires an enum object). **Fixed:** a real TS enum `ApplicantCooldownState { None = "none", Active = "active", Expired = "expired" }` + fail-closed `isApplicantCooldownState` guard in `backend/enum/teachers/applicant-cooldown-state.enum.ts` (+ enum unit test); Pothos registration passes the enum object; wire names `None/Active/Expired`; all assertions, SDL blocks, and the types task aligned across all four artifacts.

**F2 — MEDIUM · tasks.md Task 4 · grep-verification claim was factually false.** The service docblock at `applicant-lifecycle.service.ts:18-20` legitimately mentions `users.suspended` (documented absence), so a raw grep returns ≥1 today. **Fixed:** the grep now excludes the pre-existing docblock mention and demands zero matches in the NEW code — consistent with Task 8's correctly-nuanced gate.

**F3 — MEDIUM · tasks.md Task 8 · zero-delta gate referenced a nonexistent file.** `backend/services/teachers/evaluation-rubric.constants.ts` does not exist (git would exit 128 and break the gate). **Fixed:** pathspec corrected to `shared/constants/evaluation-rubric.constants.ts`.

**F4 — MEDIUM · specs.md header + Definition of Done · stale version and gate reference.** Header still read 1.0 · 2026-09-26; DoD pointed at R1, which now carries the supersession banner. **Fixed:** header → 2.0 · 2026-09-27 (supersedes the dual-deny draft); DoD → `outcome/plan-review-R2.md`.

**F5 — LOW · plan.md §5.3 · wrong helper path.** `withTransaction` cited at `backend/lib/db/withTransaction.ts`. **Fixed:** `backend/lib/db/with-transaction.ts`.

**F6 — LOW · evidence pack Journey lock · lock-scope mismatch.** Pack claimed the journey asserts the split "at every checkpoint"; specs REQ-006.5 and journey step 2 assert it after the FAIL stamp. **Fixed:** pack aligned to the post-FAIL lock (REQ-006.5); `cooldownState` phase values aligned to wire names.

**F7 — LOW · tasks.md Task 6 · barrel-chain naming slightly off.** Registration chain is `mutation/index.ts` → `mutation/admin/index.ts:12` (`import "./admin-governance.mutation"`) → the mutation file. **Fixed:** chain corrected; conclusion (barrel already imports the file) unchanged.

## Verified Clean (no fix needed)

- **(a) Ground truth**: both binding authorities exact — `docs/teachers/applicant-lifecycle.md:60` (§2.3) and `:154` (vocabulary reconciliation). Rubric chain (`resolveFinalizationCooldownUntil` :326, `finalizeRubricFail` docblock :377-383, ConflictError arm :391-394), repo transitions (`transitionToFailed` :468-485, `finalizeOnCertification` :507-530), service surface (`getMyApplicantProfile` :142-181, `assertCanPurchaseVerification` :204 with cooldown arm :225-233, `recordReapplication` :263-281), admin prelude `:24,31`, `adminSetUserSuspended` `admin-governance.mutation.ts:45` (+`requirePositiveIntId` exists), `AuditActionType.Adjust` `audit-action-type.enum.ts:11`, constants 30/90 and bounds 1/3650, audit service contract lines, `session-lifecycle.governance.ts:47`, 422 mapping `error-code-taxonomy.ts:47`, in-tx wiring `verification-purchase.service.ts:319`, schema anchors, FR/INV citations, TICKETS.md ranges, i18n group + key inventory (en/ar), parity test existence — all exact.
- **(e) Two-source split**: no artifact prescribes a `users.suspended*` write; the only `users` touch in the repo layer is an unrelated admin-directory read; journey locks `users.suspended === false` post-FAIL.
- **(f) Cross-file consistency**: REQ-001..011 identical everywhere; mutation contract `adminExtendApplicantCooldown(applicantId: Int!, additionalDays: Int!): ApplicantProfile!` identical; `GREATEST(current, now) + additionalDays` consistent (30+60→90d journey math correct); eligible statuses, terminal-on-pass, bounds, 30/90 minimums, strict `>`, zero DDL / no new UI / no cron — all uniform.
- **(g) Commands**: all real (`sub-loop.ts`, `run-test.ts` accepting file-or-directory, `generate:gqlSchema`, `codegen`, `quality-gate`, `tsgo`, `biome:check`, `lint-service.ts --json/--id`); the ledger enforcement grep `grep -cE "^\| D[0-9]+ .*(❌|⚠️)"` **executed during review → returns 0** as written.
- **(i) Internal structure**: no truncation, all code fences balanced, all implementation checkboxes unchecked `[ ]`, supersession banner in R1 correctly references this file.

## Final Verdict

**Plan passes — implementation-ready.** All 7 findings fixed in-place and re-swept (no lowercase wire assertions, union prescriptions, stale paths, or stale version headers remain). The rework keeps PR #250's two-source-split architecture (binding per `applicant-lifecycle.md:154` + the shipped `finalizeRubricFail` zero-delta contract) with the `plans` branch's rigor restored on top: mid-point review gate, post-implementation review wave, knowledge-doc propagation, row-anchored ledger enforcement, and the zero-delta rubric-path diff gate.
