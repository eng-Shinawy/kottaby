# Plan Review Gate — R1 Verdict: T2-008 Cooldown State Machine

> **SUPERSEDED (2026-09-27)**: this review round examined the earlier **dual-deny** interpretation of the plan (stamping `users.suspended*` on rubric failure).
> The plan has since been **re-architected to the two-source split** — cooldown lives only in `applicants.cooldown_until`; login/session access stays allowed during cooldown — per the binding reconciliation at `docs/teachers/applicant-lifecycle.md:154` and the shipped `finalizeRubricFail` zero-delta contract (`backend/services/teachers/evaluation-rubric.helpers.ts:377-383`).
> The reworked plan's review is recorded in `outcome/plan-review-R2.md`. The findings below apply to the superseded artifacts and are preserved for the record.

> **Date**: 2026-09-27 · **Reviewer**: Phase 1.5 Plan Review Gate agent (`@plan-review` skill + root AGENTS.md layer rules)
> **Scope**: full-plan review of all four final-draft artifacts + the research evidence pack, against repo ground truth (grep/sed spot-verification of every cited `path:line`, symbol, and convention).
> **Artifacts reviewed**: `specs.md` (394 lines) · `plan.md` (459 lines after fix) · `tasks.md` (253 lines) · `deferred-items.md` (94 lines) · `outcome/00-research-evidence-pack.md` (input brief; 2 corrections applied).

## Verdict Table

| Dimension | Status | Findings |
|---|---|---|
| (a) Path/symbol errors (60+ citations spot-verified) | PASS after fixes | 2 (1 fixed, 1 range tightened) |
| (b) i18n compliance (namespaces, single-arg loader, no Translation. enum) | PASS | 0 |
| (c) GraphQL conventions (naming, authScopes, barrels, deep imports) | PASS | 0 |
| (d) Type-pattern compliance (backend/types/, no service .types.ts, no local Pothos types) | PASS | 0 |
| (e) Component/interface consistency (plan §4 ↔ tasks Files ↔ repo methods) | PASS | 0 |
| (f) Traceability (REQ-0..REQ-6 in tasks; plan §13 matrix) | PASS | 0 |
| (g) Anti-pattern sweep (runners, bottom-nav, oxlint-disable, comment discipline) | PASS after fixes | 1 (fixed across 8 locations) |
| (h) Structure check (all 13 required plan.md sections present) | PASS after fixes | 1 (fixed) |
| (i) Truncation check (last lines of all artifacts complete) | PASS | 0 |

**Totals: 5 findings — 1 HIGH, 2 MEDIUM, 2 LOW; all fixed in-place. 0 blockers remain.**

## Findings

**F1 — HIGH · plan.md §2 (lines 52–66): unclosed mermaid code fence.**
The ```mermaid block opened at plan.md:52 never closed — `### Component Inventory` followed the diagram body directly, breaking Markdown rendering of the entire System Context section. Fix applied: closing fence inserted at line 67; fence count now balanced (20 total); diagram renders as a fenced block.

**F2 — MEDIUM · all artifacts (8 locations): journey runner command violated `test/workflows/AGENTS.md`.**
The artifacts prescribed `bun test test/workflows`, but the layer's rule file (`test/workflows/AGENTS.md:87-98`) names the approved runner as `bun run test/scripts/run-test.ts test/workflows`, and every shipped plan under `ai/finished_plans/` uses the run-test.ts form. Fix applied consistently: specs.md:258 + :344, plan.md:420, tasks.md:20 + :51 + :145 + :187, and evidence-pack lines 72 + :144 (anti-patterns) now cite `bun run test/scripts/run-test.ts test/workflows` (with a dated correction note in the evidence pack). Single-file iteration is explicitly routed through the same runner per the AGENTS.md "Running" section.

**F3 — MEDIUM · specs.md:113 (G24 evidence cell): cited a nonexistent directory.**
G24 claimed "zero `suspended`/`cooldown` matches under `backend/services/cron/`" — that directory does not exist on disk (verified). The substantive claim (no cooldown-reactivation cron lane) is true but cited a phantom path. Fix applied: evidence now anchors to the real lanes — `app/api/cron/` (zero `suspended`/`cooldown` matches, verified by grep) and the shared gateway `backend/lib/gateway/cron-endpoint.ts` (no cooldown lane).

**F4 — LOW · plan.md:398 (§7 Logging): imprecise `path:line` range.**
The `logDomainError` precedent was cited as `applicant-lifecycle.service.ts:209-222`; the actual throw-site logging blocks sit at :213-218 (`APPLICANT_NOT_FOUND`) and :227-232 (`APPLICANT_COOLDOWN_ACTIVE`). Fix applied: range tightened to `:209-232` so it spans both precedent arms.

**F5 — LOW/cosmetic · specs.md:112 (G23) + :162 (REQ-0.5 AC1) + plan.md:92: off-by-one loader line.**
`ctx.t` was cited at `gqlContextFactory.ts:45` — that line is the docblock; the `readonly t` loader field is at :46. Fix applied: all three citations now read `:45-46`.

## Verified-accepted (no action needed)

- **Repo-level stale docs (NOT artifact violations, not editable by agents per plan §11):** the plan-review SKILL.md and root AGENTS.md reference `@/frontend/utils/logger`, which does not exist on disk — the real frontend logger is `@/frontend/lib/logger` (verified), which is what the artifacts use. Likewise `backend/services/AGENTS.md` shows a two-arg `getServerTranslations(locale, "<namespace>")`; the actual export is single-arg (`shared/locale/server-graphql.ts:3`), matching the artifacts.
- **specs G26/§7 `cooldownExpiryLine` at `ApplicantStatusZones.tsx:47,53,75`**: verified as accurate region anchors of the `CooldownZone` render (:57); the label key itself is expanded in `ApplicantStatusResolution.tsx:174` — accepted as region citations.
- **Evidence pack's `extendDays` vs artifacts' `extensionDays`**: the binding names are the mutation name (`adminExtendApplicantCooldown`) and the two i18n keys; the arg name was consistently standardized to `extensionDays` across specs/plan/tasks — accepted.
- **Signature consistency confirmed** (no drift): `applyCooldownSuspensionOnce(id, suspendedAt, periodDays, cooldownUntil, tx)`, `extendCooldownSuspension(…, tx)`, `clearCooldownSuspensionOnce(id, cooldownWindowEnd, tx)`, `extendCooldownUntil(userId, extensionDays, capturedNow, tx)`, extended `finalizeRubricFail(applicantUserId, cooldownUntil, capturedNow, periodDays, tx, t)`, `AdminApplicantCooldownService.extendApplicantCooldown/clearCooldownSourcedSuspension`, and the mutation snippet all match across plan §4 fences ↔ tasks Files bullets ↔ the repo methods they extend (`setSuspendedOnce` :456, `findGovernanceState` :563, `transitionToFailed` :468, `finalizeOnCertification` :507, `assertCanPurchaseVerification` :204, `getMyApplicantProfile` :142, `setSuspendedAxis` :230, `setUserSuspended` :399).

## Citation spot-verification (dimension (a) evidence)

60+ citations verified by direct view, all accurate — including: `users.ts:32-34`, `applicants.ts:21-24`, `students.ts:10`, `subscriptions.ts:11`, `evaluation-rubric.constants.ts:18/21/24`, both enums (`rubric-weakness-area.enum.ts:14-17/28`, `applicant-status.enum.ts:12-17/28`), `evaluation-rubric.helpers.ts:89/91/307/326/384/473/506-508`, `applicant.repository.ts:170/216/234/407/468/507`, `applicant-lifecycle.service.ts:142/165/177/204-233/263`, `verification-purchase.service.ts:310-312/319/355-358`, `suspension-window.ts:26/29-33/46`, `auth.service.ts:98/111/180/251`, `server-auth.ts:38-39/148-157`, `user-management.service.ts:253-255/297/309/399`, `user-governance.helpers.ts:30/32/169-170/230/270-276`, `admin-user.repository.ts:296/340/456/563`, `admin-governance.mutation.ts:8-14/44-74`, `admin-guards.helpers.ts:67`, `gqlContextFactory.ts:45-46`, `server-graphql.ts:3`, locale files (`en/ar errors:64`, `labels.ts:144`), types (`applicant.types.ts:30/35`, `admin-user.types.ts:192/193/259-266/289`), frontend (`ApplicantStatusZones.tsx:47/53/57/75`, `ApplicantStatusResolution.tsx:109-110/174`, `RoleDashboardPage.tsx:75`), docs (`error-handling-contract.md:49/64`, `state-machine-invariants.md:89/90/92/248`, `functional-requirements.md:117-121`), planning (`TICKETS.md:818-868/872/916`, `MILESTONE_PLAN.md:100-102/143-145/265/321`), tests (`db-cleanup.ts:229`, journey helpers `journeyPrefix`/`provisionCertifiedTeacherActor`/`createJourneyFixtures`/`catchJourneyError`/`secondPrecisionMs`/`TrackedFixtures`, all four existing teacher journeys), the full Layer → Rule Files table (all 15 absolute paths exist), `AdminUserUpdateDbPatch` (exactly five profile fields — the "adminUpdateUser whitelists five profile fields" claim verifies), `AuditActionType.Update`, `buildAuditContract(actorId, actionType, entityId, details)`, `withImmutabilityTriggersSuspended`, `describeGraphqlSuite`/`testClient`, and the side-effect barrel claim (`backend/graphql/mutation/admin/index.ts:12` already imports `admin-governance.mutation` — no barrel change needed, as plan §4.8 states).

## Dimension-by-dimension confirmation

- **(b) i18n**: services use single-arg `getServerTranslations(locale).errorsTranslations` (matches real usage at `applicant-lifecycle.service.ts:209`); resolvers use `await ctx.t("errorsTranslations")`; no `Translation.` enum, no two-arg `getTranslations`, no `next-intl`/`shared/messages`, no `@/frontend/utils/logger` (frontend logger cited as `@/frontend/lib/logger`, which exists); the two fixed key names (`applicantCooldownNotActive`, `cooldownExtensionInvalid`) are verbatim from the evidence pack and are confirmed absent today (CREATE).
- **(c) GraphQL**: `adminExtendApplicantCooldown` follows the `adminSetUserSuspended` idiom exactly (`$all` admin authScopes, `requirePositiveIntId` from `@/backend/graphql/shared`, null-user `UnauthorizedError`, `actorId` from `ctx.user.id` only, thin resolver); no `useLazyQuery` anywhere; deep imports throughout; side-effect barrel registration correctly declared as a no-change (file already imported); `bun run generate:gqlSchema` + `bun codegen` mandated (EARS-4.7).
- **(d) Types**: all types from `backend/types/` (`AdminUserSafeSelect`, `GovernanceProbeRowType`, `AdminUserDetailReturnType`, `ApplicantSelectType`, `ApplicantProfileReturnType`, `DBTransaction` via `@/backend/types`); no service-layer `.types.ts`; no local Pothos type definitions (reuses `AdminUserDetailPothosObject`).
- **(f) Traceability**: the REQ loop over specs.md → tasks.md reports zero MISSING ids (REQ-0, REQ-0.5, REQ-1..REQ-6 all covered); plan §13 matrix covers REQ-0..REQ-6 with design-section mappings.
- **(g) Anti-patterns**: no bottom-nav, no `oxlint-disable`, no `jscpd:ignore`, no hardcoded colors, no raw single-file journey runs, no REQ/task/plan-artifact comments inside code fences; all "console.*" and "two-arg getTranslations" mentions are prohibitions, not usage.
- **(h) Structure**: plan.md contains all required sections — §1 Overview + D1–D7 (each with *Consequence recorded*), §2 Architecture, §3 Data Models (zero-DDL per D6), §4 signature fences, §5 API Contract (SDL + permission matrix + error contract + concurrency assessment + journey state machine), §6 UX/Nav with the explicit no-new-UI ruling, §7 Security/Tenancy, §8 i18n, §9 Testing, §10 Migration, §11 Outcome protocol, §12 Drizzle binding, §13 Traceability.
- **(i) Truncation**: all four artifacts end on complete sentences/table rows (verified post-fix); every code fence in plan.md now balances.

## Fixes Applied (summary)

| # | File(s) | Change |
|---|---------|--------|
| 1 | `plan.md` (§2) | Closed the unclosed mermaid fence (line 67) |
| 2 | `specs.md:258,344` · `plan.md:420` · `tasks.md:20,51,145,187` · evidence pack `:72,:144` | Journey runner → `bun run test/scripts/run-test.ts test/workflows` (per `test/workflows/AGENTS.md`) |
| 3 | `specs.md:113` (G24) | Replaced phantom `backend/services/cron/` citation with verified `app/api/cron/` + `backend/lib/gateway/cron-endpoint.ts` anchors |
| 4 | `plan.md:398` | logDomainError precedent range `:209-222` → `:209-232` |
| 5 | `specs.md:112,162` · `plan.md:92` | `gqlContextFactory.ts:45` → `:45-46` |

Binding decisions untouched: REQ numbering, D1–D7, task numbers, J1 steps, i18n key names — all unchanged (none were factually wrong).

## Final Verdict

**Plan passes all AGENTS.md rules.** All 5 findings were fixed in-place and re-verified (runner grep clean, fence balanced, traceability loop zero-missing, all edited citations re-checked). The Phase 1.5 gate has actually run; `tasks.md` Task 1.5's checkbox may now be flipped by the executing wave.
