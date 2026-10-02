# Plan Review — R1

**Plan:** `ai/plans/milestone_3_parent_portal_admin_governance/admin_ordered_re_evaluation_teacher_wallet_deduction/`
**Artifacts reviewed:** `specs.md`, `plan.md`, `tasks.md`, `deferred-items.md` (all read in full)
**Reviewer skill:** `.agents/skills/plan-review/SKILL.md` (read in full)
**Date:** 2026-09-30

## Verdict

**Plan passes all AGENTS.md rules for affected layers** — after **3 violations** were found and fixed in-plan.

Three findings (2 MEDIUM, 1 LOW), all corrected by minimal edits to the plan files only; no code, no `AGENTS.md`, no `.agents/instructions/**`, no other plan was touched. The corrected plan is now conformant.

| # | Severity | Rule | File(s) fixed |
|---|---|---|---|
| V1 | MEDIUM | Invented file path (`shared/locale/types/adminUsers/labels.ts` does not exist) | `specs.md` (C12), `tasks.md` (12.1) |
| V2 | MEDIUM | Missing `apolloCache.ts` `keyFields: false` registration for an id-less GraphQL object (`frontend/graphql/AGENTS.md:87-97`) | `specs.md` (C11), `tasks.md` (11.1) |
| V3 | LOW | Off-by-range citation (`applicants.ts:31-33` is past EOF; the file has 30 lines) | `plan.md` (§Data Models) |

## Dimensions checked

- Type imports — all types come from `@/backend/types`; Pothos file (C9/task 7.1) explicitly forbids local type definitions. **PASS**
- Service boundaries — Server Components call services directly; Client Components use Apollo hooks (`useMutation` from `@apollo/client/react`). **PASS**
- MUI v9 `sx`-only styling + theme-palette-only colours (REQ-012.6). **PASS**
- i18n — no hardcoded strings; `getServerTranslations(locale)` single-arg; `useAppTranslation(AdminUsers)` for client; en/ar parity. **PASS**
- Logging — `logger.logDomainError`, no `console.*`; no `oxlint-disable`. **PASS**
- Test conventions — repo/service tests use `runInRollback` + `tx`; journey under `test/workflows/` uses **no** `runInRollback` + committed fixtures; workflows run via `bun run test/scripts/run-test.ts` (never raw `bun test`). **PASS**
- GraphQL documents — `adminOrderTeacherReEvaluationMutationDocument` naming; `id` on selections where the type has one; `useMutation` import path. **PASS** (see V2)
- No local type definitions in Pothos files. **PASS**
- No barrel/shim violations — all touched barrels are pre-existing and legitimately consumed; no re-export shims. **PASS**
- Traceability — every `REQ-00x` in `specs.md` appears in `tasks.md` (`for r in $(grep -oE 'REQ-[0-9]+' specs.md | sort -u); do grep -q "$r" tasks.md || echo MISSING; done` → **zero misses**). **PASS**
- M1 non-duplication — the generic "Admin Override of Evaluation Results" (`docs/planning/TICKETS.md:916-958`) is explicitly deferred (D-003); `grep -rn "adminRejectApplicant\|adminGrantReEvaluation"` returns nothing. **PASS**
- No wallet-debit primitive fork — the service composes the existing `WalletRepository.debitAdjustmentOnce`; no new debit/ledger vocabulary, no wallet schema change. **PASS**

## Citations spot-checked (25 verified)

| # | Citation | Result |
|---|---|---|
| 1 | `backend/db/schema/billing/wallet.ts:27-28,36-38` | PASS — `balance`/`total_earning` at 27-28; check constraints at 36-38 |
| 2 | `backend/db/repo/billing/wallet.repository.shared-writer.ts:77` | PASS — fused guard `UPDATE … WHERE id=$1 AND balance >= $2` |
| 3 | `backend/db/repo/billing/wallet.repository.shared-writer.ts:76,91` | PASS — `.set` touches balance only; ledger `sessionId: null` / `Withdrawal` |
| 4 | `backend/db/repo/teachers/applicant.repository.ts:407,468,507` | PASS — `transitionToInEvaluation`/`transitionToFailed`/`finalizeOnCertification` |
| 5 | `transitionToInEvaluation` rejects `passed` (REQ-R3) | PASS — predicate is `inArray(status,[Pending,Failed])` |
| 6 | `backend/db/repo/teachers/teacher.repository.ts:286,319-331` | PASS — `insertColdStartCertified`/`elevateToCertified` (both `isApproved:true`) |
| 7 | `backend/services/admin/audit.service.ts:82` (and `:41-63`) | PASS — `createAuditLog`; truncation helper span |
| 8 | `backend/lib/errors/error-code-taxonomy.ts:45-47,113-115` | PASS — `CONFLICT:409`/`VALIDATION:422`; `normalizeErrorCode` |
| 9 | `backend/lib/errors.ts:171-183` | PASS — `ConflictError` (custom-code `(code, message)` form) |
| 10 | `shared/locale/types/errors/labels.ts:243,249,253` | PASS — `teacherNotCertified`/`teacherNotFound`/`insufficientBalance` |
| 11 | `shared/locale/en/errors/index.ts:108,111,113` + ar `:111` | PASS — same three leaves in both locales |
| 12 | `backend/services/admin/admin-gate.helpers.ts:133` | PASS — `assertActorAdminActive(actorId, locale, tx?)` |
| 13 | `backend/db/repo/billing/wallet.repository.admin.helpers.ts:427-432` | PASS — `debitAdjustmentOnce` → `debitWithLedgerRow(…, Completed, …)` |
| 14 | `backend/db/repo/billing/wallet.repository.ts:59-64,472-477` | PASS — `ensureWalletOnce`; `debitAdjustmentOnce` namespace wrapper |
| 15 | `backend/graphql/mutation/admin/admin-teachers.mutation.ts:45-50` | PASS — inline `$all { authenticated, role:[Admin] }` |
| 16 | `backend/graphql/mutation/admin/admin-finance.mutation.ts:114-119,120-138` | PASS — same authScopes; field-by-field arg mapping + `requirePositiveIntId`/`coerceDecimalSessionId` |
| 17 | `backend/enum/audit/audit-action-type.enum.ts:10` | PASS — `Override = "override"` |
| 18 | `backend/enum/users/user-role.enum.ts:5-10` | PASS — `Admin|Teacher|Student|Parent`; no `SUPER_ADMIN` |
| 19 | `backend/graphql/test/sdl-static-assertions.test.ts:140-145` | PASS — `FROZEN_MUTATION_FIELDS` array start |
| 20 | `backend/graphql/test/schema-surface.test.ts:726,1160,2954` | PASS — mutation-set entries; `adjustTeacherWallet` contains-pin at 2954 |
| 21 | `backend/db/repo/classes/session.repository.evaluation.helpers.ts:157-178` | PASS — `resolveCurrentEvaluationCycle` |
| 22 | `backend/db/repo/classes/session.repository.ts:798` | PASS — namespace wrapper |
| 23 | `backend/services/teachers/evaluation-booking.helpers.ts:118,257` | PASS — `in_evaluation` gate; `sessionType: TeacherEvaluation` |
| 24 | `backend/db/repo/classes/session.repository.lifecycle.helpers.ts:56` | PASS — `EXISTS (… teacher.is_approved = true)` |
| 25 | `backend/graphql/shared/admin-prelude.ts:24-29` | PASS — `adminOnlyAuthScopes` |
| 26 | `backend/services/billing/admin-financial-auditing.service.ts:360-459,426-432,432` | PASS — `adjustTeacherWallet`; funds-denial `ConflictError("WALLET_INSUFFICIENT_FUNDS")` |
| 27 | `backend/services/billing/admin-financial-auditing.service.helpers.ts:86-92` (`MAX_REASON_LENGTH = 229`) | PASS — `normalizeAdjustmentReason`; 229 confirmed |
| 28 | `backend/services/billing/wallet.service.ts:295-306,305` | PASS — funds-denial `ConflictError("WALLET_INSUFFICIENT_FUNDS", t.insufficientBalance)` at 305 |
| 29 | `backend/services/admin/cold-start-certification.service.ts:201-214` | PASS — `AuditService.createAuditLog({actionType: Override, entityType:"teacher"})` precedent |
| 30 | `backend/enum/scheduling/session-type.enum.ts:9` | PASS — `ReEvaluation = "re_evaluation"` |
| 31 | `frontend/views/admin/users/detail/UserHeroActions.tsx:41-42` | PASS — `showCertify` guard |
| 32 | `test/workflows/helpers/journey-fixture-registry.ts:211` | PASS — `countAuditLogsForActor` counter oracle |
| 33 | `test/workflows/admin/audit-trail.journey.test.ts:103-104` | PASS — `countAllAuditRows` whole-table oracle |
| 34 | `docs/billing/escrow-and-wallet-crediting.md:131,117,126` | PASS — re-eval hand-off; SDL-freeze note; D3 ledger entry |
| 35 | `docs/planning/TICKETS.md:2143-2180,916-958` | PASS — the two tickets (this one; M1 override) |
| 36 | `docs/teachers/applicant-lifecycle.md:124` / `functional-requirements.md:123` / `state-machine-invariants.md:91` / `workflows/01-…:180` / `open-decisions-and-gaps.md:103` | PASS — all resolve to the cited claims |
| 37 | `backend/graphql/mutation/admin/index.ts`, `pothos/admin/index.ts`, `services/teachers/index.ts`, `types/teachers/index.ts` | PASS — all exist as barrels |
| 38 | `frontend/views/admin/.../OrderReEvaluationDialog` siblings (`CertifyTeacherDialog.tsx`, `AdjustWalletDialog.tsx`, `useGovernanceActions.ts`) | PASS — all exist |

## Fixes applied (in-plan only)

### V1 — Invented locale type path (MEDIUM)
- **Files:** `specs.md` (C12 row), `tasks.md` (task 12.1 body)
- **Was:** `shared/locale/types/adminUsers/labels.ts` + "en/ar leaves"
- **Reality:** `shared/locale/types/adminUsers/` contains only `index.ts` (which defines `AdminUsersLabels`); there is no `labels.ts`. (The *errors* namespace does legitimately use `types/errors/labels.ts` — the plan pattern-matched that structure onto `adminUsers`.)
- **Now:** `shared/locale/types/adminUsers/index.ts` (`AdminUsersLabels`) + en `shared/locale/en/adminUsers/index.ts` + ar `shared/locale/ar/adminUsers/index.ts` (the `AdminUsers` namespace already exists and is registered/consumed).

### V2 — Id-less GraphQL object not registered in `apolloCache.ts` (MEDIUM)
- **Files:** `specs.md` (C11 row), `tasks.md` (task 11.1 — added a sub-bullet + tightened the 11.1.SR line)
- **Rule:** `frontend/graphql/AGENTS.md:87-97` — "If you add a new GraphQL type without an `id` field, add it to `typePolicies` in `apolloCache.ts` with `keyFields: false`."
- **Why it applies:** the new `TeacherReEvaluationOrder` object (`REQ-011.3`) exposes `teacherId: ID!` but **no `id`**, and is a scalar-only mutation payload read back inline — exactly the shape `frontend/providers/apollo/apolloCache.ts` already registers for `PurchaseSubscriptionPayload` / `PaymentCheckout`.
- **Now:** C11 and task 11.1 require registering `TeacherReEvaluationOrder` in `frontend/providers/apollo/apolloCache.ts` with `keyFields: false`.

### V3 — Off-by-range schema citation (LOW)
- **File:** `plan.md` (§Data Models, "Schema change" target-file sentence)
- **Was:** `backend/db/schema/teachers/applicants.ts:31-33`
- **Reality:** the file is 30 lines; `cooldownUntil` is at line 23 and `status` at line 24.
- **Now:** `backend/db/schema/teachers/applicants.ts:23-24`.

## Residual findings (NOT fixed — for the implementer to watch)

- **INFO — bare-basename path shorthand.** Several prose citations give only a basename for files that live under a domain sub-directory, e.g. `wallet.service.ts:305` (real: `backend/services/billing/wallet.service.ts`) and `admin-financial-auditing.service.ts:432` / `admin-financial-auditing.service.helpers.ts:86-92` (real: `backend/services/billing/…`). All referenced symbols and line numbers were verified correct; only the directory prefix is omitted. Left as-is (shorthand, not an invented symbol) but the implementer should resolve them to the `backend/services/billing/` path.
- **LOW — `shared/constants/index.ts:7` citation.** task 1.1 cites `shared/constants/index.ts:7` as proof the barrel "exports constants"; line 7 is `export * from "./verification-plan.constants";` (an example export, not the barrel's only line). Correct in substance; the line pointer is illustrative.
- **LOW — `verification-plan.constants.ts:27-33` mirror pointer.** REQ-004.1 / task 1.1 cite this range as the fee-constant mirror; the actual price/currency/interval constants sit at lines 24/27/30 within 23-33. Substantively accurate.
- **INFO — mutation-set pin ranges.** `backend/graphql/test/schema-surface.test.ts:726,1160` point at two *different* frozen mutation-name arrays (reconciled broadcast/certify set; sorted live-schema `adminMutationNames`). Both must be refreshed when the new field ships, plus the `sdl-static-assertions.test.ts:140-145` list; the plan's C13/task 8.1 covers exactly these. No action beyond what the plan already states.
- **INFO — sharedDocuments sub-directory note.** `frontend/graphql/sharedDocuments/admin/` already exists (holds `admin-teacher-applicants.documents.test.ts`), so no new sub-directory is created and `sharedDocuments/AGENTS.md` step 5 ("document any new sub-directory") is not triggered. No `AGENTS.md` edit is needed (consistent with REQ-014.4).
- **INFO — `db push` vs migration.** The plan applies the new nullable column via `bun run db push` (no hand-authored migration), consistent with `backend/db/schema/AGENTS.md`. Confirm schema↔database parity during task 1.2 as the plan already requires.
