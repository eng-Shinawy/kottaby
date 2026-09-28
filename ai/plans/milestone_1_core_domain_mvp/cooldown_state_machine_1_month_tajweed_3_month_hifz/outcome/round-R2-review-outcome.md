# Round R2 — Independent Review Outcome

Reviewer: R2 subagent (independent; no prior round-R*.md read — `midpoint-review-R1.md` / `plan-review-R*.md` were NOT opened).
Baseline → HEAD: `94160b9..480fde4` (9 commits; 27 code/test files + plan docs + generated SDL).

## Scope used

`git diff 94160b9..HEAD --name-only` (35 files). Code cluster under review:

- `backend/enum/teachers/applicant-cooldown-state.enum.ts` (+ index barrel, + 4-tier enum test)
- `backend/db/repo/teachers/applicant.repository.ts` (`extendCooldownOnce`) + repo test
- `backend/services/teachers/applicant-lifecycle.service.ts` (`deriveCooldownState`, `extendApplicantCooldown`, `ApplicantCooldownExtensionAudit`) + service test
- `backend/services/admin/user-management.mappers.ts` (`buildApplicantSnapshot` cooldown observables)
- `backend/graphql/mutation/admin/admin-governance.mutation.ts` (`adminExtendApplicantCooldown`)
- `backend/graphql/pothos/shared/enum.pothos.ts`, `backend/graphql/pothos/teachers/applicant.pothos.ts`
- `backend/types/teachers/applicant.types.ts` (`cooldownState` + audit contract)
- `shared/locale/{en,ar}/errors/index.ts`, `shared/locale/types/errors/labels.ts`, parity test
- `backend/graphql/test/schema-surface.test.ts`, `backend/graphql/test/admin-applicant-cooldown.wire.test.ts`
- `test/workflows/teachers/cooldown-state-machine.test.ts`, `test/workflows/admin/audit-completeness.{catalog,journey.test}.ts`
- `frontend/graphql/generated/schema.graphql` (generated — SDL-tier review only)

Environment constraint honored: no `bun quality-gate` / `bun oxlint` / `bun lint:type-aware` / `bun biome:check`; verification via `bun tsgo`, per-file `sub-loop.ts --lifecycle duplicates`, and `bun run test/scripts/run-test.ts <path>`.

## Per-perspective evidence

### 1. review-types
- Read: enum file, `applicant.types.ts`, `admin-user.types.ts` (lines 1–232), `applicant.pothos.ts`, `enum.pothos.ts`, mappers, service.
- `ApplicantProfileReturnType` construction sites enumerated via `rg "ApplicantProfileReturnType" backend` (non-test): exactly TWO — `getMyApplicantProfile` (service, 8 fields incl. `cooldownState`) and `buildApplicantSnapshot` (mappers — returns `AdminUserDetailReturnType["applicant"]`, which IS `ApplicantProfileReturnType` composition-only per `admin-user.types.ts:193`). Both build the closed 8-field shape; no third producer; no drift possible (tsgo green proves exhaustiveness since the interface is not optional-field).
- Enum value-import discipline: `applicant.types.ts` imports BOTH enums `import type` (type-only positions, NOTE docblock retained/updated); runtime consumers (`service`, `enum.pothos`, `mappers`) each keep their own value imports. Import ordering verified sorted (`applicant-cooldown-state.enum` < `applicant-status.enum` in both `enum.pothos.ts` and `schema-surface.test.ts`).
- No TS2308 collision: `ApplicantCooldownState` exported once in the teachers enum barrel; tsgo clean confirms.
- Wire-name convention: Pothos `enumType` emits member NAMES (`None/Active/Expired`) — matches generated SDL and wire test pin.

### 2. review-backend
- Read: full current `applicant-lifecycle.service.ts` (532 lines), `applicant.repository.ts` (new method + `findByUserId`), `admin-guards.helpers.ts`, `admin-gate.helpers.ts`, `with-transaction.ts`, `audit.service.ts` (`createAuditLog`), `admin-audit.contract.types.ts`, `logger.ts`, `server-graphql.ts`/`server.ts` (memoization check).
- TOCTOU: guard read → `passed` check → guarded UPDATE whose WHERE re-evaluates `status IN (pending, in_evaluation, failed)` atomically at write time → audit + profile re-read INSIDE the same tx (savepoint/top-level via `withTransaction`). Concurrent-extension last-write-wins nuance is a PRE-DOCUMENTED deferral (D4 row in `deferred-items.md` — accepted for scope, audit-observable, never-shortens vs. the original base) — NOT re-reported.
- Corrupt-status fail-closed: a corrupt (non-member) status never matches the guarded UPDATE → collapses onto the typed certified rejection (no illegal write); acceptable fail-closed arm.
- Dead code: `isApplicantCooldownState` has no production consumer — PRE-DOCUMENTED deferral (D6, ships with the enum per the mirror discipline, 4-tier test-covered). Not re-reported.
- Logging: denials log exactly once each via `logger.logDomainError`; the post-commit `APPLICANT_COOLDOWN_EXTENDED` event is the plan-pinned contract (tasks.md Task 5 pseudocode); `getServerTranslations` is a cheap map lookup (double-call nit is a non-issue).
- Cross-layer imports: teachers service → admin guards/audit (mirrors sibling governance pipelines); admin mappers → `deriveCooldownState` (single derivation boundary, commit 7d781ef). No module cycle.
- Gates: `assertActiveActorAdmin` (strict governance variant, `admin-guards.helpers`) is the canonical import surface used by 5+ sibling admin services — consistent.
- Two-source split: `git diff 94160b9..HEAD | rg "^\+" | rg -i suspended` → ZERO matches in code lines (only plan docs). Repo test + wire test + journey test runtime-lock the governance triple.

### 3. review-frontend (generated-SDL tier only)
- `git diff` on `schema.graphql` = exactly 2 hunks: `enum ApplicantCooldownState {Active, Expired, None}` + `cooldownState: ApplicantCooldownState!` on `ApplicantProfile` (hunk 1); `adminExtendApplicantCooldown(additionalDays: Int!, applicantId: Int!): ApplicantProfile!` (hunk 2). Matches the Pothos sources byte-semantically (member names, non-nullability, arg set/order); no hand-edits; no description — consistent with sibling governance mutations (`adminSetUserSuspended`/`adminSetUserBlocked` also description-less).
- `frontend/graphql/generated/gql/graphql.ts` unchanged — CORRECT, not stale: it is client-preset document-scoped output and no frontend document changed (verified: fragments in `admin-users.documents.ts`/`admin-student-onboarding.documents.ts` request the pre-existing field set; `ApplicantCooldownState` absent there is expected). `bun run generate:gqlSchema` output artifact is committed in the same change set (sdl-static tier exists precisely for this).

### 4. pentester
- BOLA/IDOR: three layers — `authScopes: {$all:{authenticated, role:[Admin]}}` (pre-resolver), `requireAdminUser(ctx)` (narrowing belt), `assertActiveActorAdmin` (service-side anonymous/missing/non-admin/deleted/blocked/suspended ladder, zero writes on denial). Applicant ids are global PKs; admin scope is global by design — any-admin→any-applicant is the sanctioned semantics; no tenant axis exists to cross.
- actorId trust path: sourced ONLY from `requireAdminUser(ctx).id`; no actor arg exists on the field — wire test proves a smuggled `actorId` root arg dies `GRAPHQL_VALIDATION_FAILED` pre-resolver with zero audit rows.
- Injection: `extendCooldownOnce` = Drizzle parameterized `eq`/`inArray` (enum members as bound values); `findByUserId` = parameterized SQL; audit `details` = `JSON.stringify` of a closed interface (field NAME + ISO instants + int). Repo test pins no string literals / no interpolation / no `--` comments / required tx.
- Error-code leakage: `APPLICANT_NOT_FOUND` / `APPLICANT_ALREADY_CERTIFIED` / `APPLICANT_COOLDOWN_EXTENSION_INVALID` — generic domain codes; localized copies carry zero identifiers (parity test pins zero ICU placeholders); admin-only audience anyway.
- GraphQL abuse: `Int!` args only; `additionalDays` bounds [1,3650] fail-closed BEFORE any DB contact (service test proves 0-case precedes the read); `applicantId` positive-safe-int guard; admin-gated (no cost amplification surface); no notification fan-out (wire-asserted).
- `requirePositiveIntId` non-localized message: pre-existing shared-helper behavior at baseline (byte-identical at 94160b9) — not a finding.

## Findings

### [MEDIUM] backend/graphql/test/sdl-static-assertions.test.ts:140/453/545 — frozen SDL pins NOT re-anchored for the new mutation (2 failing tests)
The plan re-anchored `schema-surface.test.ts` but missed the artifact-side twin suite. After the diff added the 53rd mutation op, `bun run test/scripts/run-test.ts backend/graphql/test/sdl-static-assertions.test.ts` failed:
1. `Mutation root is EXACTLY the refreshed frozen 52-op baseline …` — expected list missing `adminExtendApplicantCooldown` (received 53 ops).
2. `both governance mutations sit at their SORTED positions …` — `expectedBandWindow` missing `adminExtendApplicantCooldown` (band slice mismatch, `+ "adminExtendApplicantCooldown"` between `adminCreateUser` and `adminExtendSubscription`).
This file was passing at 94160b9 (frozen list = 52 ops, pre-mutation) — a regression introduced by the diff, violating the file's own contract ("gateway Rule 8.5 … fails when the committed SDL drifts from the sanctioned contract" — here the sanctioned contract grew without the pin following).
**Fix applied:** re-anchored exactly as the file's documented convention demands (a documented one-time reconciliation, NOT a silent baseline flip): added `adminExtendApplicantCooldown` to `FROZEN_MUTATION_FIELDS` (sorted position), bumped the two test titles/counts 52→53, added the op to `expectedBandWindow` with its sort-position comment, and extended the baseline-history docblocks. No plan-artifact references; mirrors the existing `adminOnboardStudentWithOfflinePayment` re-anchor wording.
**Re-verification:** 57 pass / 0 fail (was 55 pass / 2 fail); neighbor suites (`lesson.schema`, `plan-catalog.schema`) green; sub-loop exit 0; tsgo clean.

### [LOW] backend/services/teachers/applicant-lifecycle.service.ts:230 — stale self-scope docblock on `getMyApplicantProfile`
The docblock claimed the userId "comes exclusively from the resolver-derived `ctx.user.id`" (self-scope). The same diff made `extendApplicantCooldown` call this shaper with the admin-supplied applicant id inside its transaction — the "exclusively" claim became false, blurring the BOPLA boundary documentation of the self surface.
**Fix applied:** docblock-only amendment (no behavior change) stating both GraphQL callers: `myApplicantProfile` remains self-scope; the admin extension re-shapes its post-write read through the same shaper with its service-validated applicant id (admin-gated upstream; the self surface still never accepts a client-supplied id).
**Re-verification:** sub-loop exit 0; service suite 56 pass / 0 fail; tsgo clean; diff contains no `console.*`, no plan-artifact tokens.

Explicit zero elsewhere: no other findings across all four perspectives (the concurrent-extension and unused-guard observations are pre-documented D4/D6 deferrals; the pre-existing `assertActorAdminActive`/`assertActiveActorAdmin` variants and `requirePositiveIntId` copy predate 94160b9 byte-identical).

## Verification ledger (R2)

| Check | Result |
|---|---|
| `bun tsgo` (×2, incl. after fixes) | clean, 0 errors |
| sub-loop duplicates ×10 files (8 prod + enum test + fixed test file) | exit 0 all |
| enum guard suite | 22 pass |
| i18n parity suite | 50 pass |
| repo suite | 17 pass |
| service suite (incl. after docblock fix) | 56 pass |
| schema-surface suite | 93 pass |
| wire suite | 12 pass |
| cooldown-state-machine journey | 12 pass |
| audit-completeness journey | 19 pass |
| sdl-static-assertions (before fix) | 55 pass / **2 fail** |
| sdl-static-assertions (after fix) | **57 pass / 0 fail** |
| `lesson.schema` + `plan-catalog.schema` | green |
| grep: added code lines → `console.*` / plan-artifact tokens / `users.suspended*` writes | 0 / 0 / 0 |

## Files modified by R2

1. `backend/graphql/test/sdl-static-assertions.test.ts` — frozen-SDL re-anchor (MEDIUM finding fix).
2. `backend/services/teachers/applicant-lifecycle.service.ts` — docblock accuracy (LOW finding fix).

No git commit performed (per instructions).

## Verdict

**R2: 2 findings (fixed)** — 1 MEDIUM (frozen SDL artifact pins not re-anchored → 2 red tests; re-anchored, suite green) + 1 LOW (stale self-scope docblock; amended). Zero remaining findings; all suites green post-fix.
