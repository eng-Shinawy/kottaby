# Task 1 Outcome — Foundation: types, enum, i18n skeleton (REQ-0.5, partial REQ-1/2/3/4)

**Date**: 2026-09-18
**Branch**: `feat/admin-subscription-management`
**Agent**: Task 1 Foundation Subagent
**Scope**: `backend/types/billing/subscription-admin.types.ts` (new) · `backend/enum/billing/proration-direction.enum.ts` (new) · both `billing` barrels · `errors`-namespace labels + en/ar leaves. No schema, no codegen, no migrations.

---

## 1. Summary

Created the five admin-subscription input/result types from plan §3.4 verbatim, the `ProrationDirection` TS enum (values `upgrade` / `downgrade`), and extended the **existing** `errors` translations namespace with a `subscriptionAdmin` group (8 keys, en + authentic ar). Registered both new modules in their sub-directory barrels. REQ-0.5's five-step namespace registration was correctly **not** applied: this is a key group inside `ErrorsLabels` (the `errors` namespace already exists in `Translations`, `en/ar messages.ts`, and the parity suite), not a new namespace — verified against `shared/locale/types/message.ts:27` and `shared/locale/{en,ar}/messages.ts:28`.

## 2. Files created / modified

| # | File | Change |
|---|------|--------|
| 1 | `backend/types/billing/subscription-admin.types.ts` | **NEW** — `ExtendSubscriptionSubmitInput`, `RenewSubscriptionSubmitInput`, `CancelSubscriptionSubmitInput`, `ChangeSubscriptionPlanSubmitInput`, `ProrationComputation` (all `readonly`, JSDoc in the house style of `subscription.types.ts`; zero imports; zero plan-artifact references) |
| 2 | `backend/types/billing/index.ts` | +1 line `export * from "./subscription-admin.types";` inserted before `./subscription.types` (alphabetical adjacency with the other `subscription*` entries) |
| 3 | `backend/enum/billing/proration-direction.enum.ts` | **NEW** — `export enum ProrationDirection { Upgrade = "upgrade", Downgrade = "downgrade" }` with JSDoc matching `subscription-status.enum.ts` / `subscription-credit-lane.enum.ts` shape |
| 4 | `backend/enum/billing/index.ts` | +1 line `export * from "./proration-direction.enum";` between `./payment-status.enum` and `./subscription-credit-lane.enum` |
| 5 | `shared/locale/types/errors/labels.ts` | + `SubscriptionAdminErrorsLabels` interface (8 keys, per-leaf JSDoc describing the domain deny each key serves) + `subscriptionAdmin` member on `ErrorsLabels` placed directly after `subscriptionPurchase` |
| 6 | `shared/locale/en/errors/index.ts` | + `subscriptionAdmin` group with 8 human-quality English sentences (self-contained, no key echo, no identifiers — matching the `planCatalog`/`subscriptionPurchase` group conventions) |
| 7 | `shared/locale/ar/errors/index.ts` | + `subscriptionAdmin` group, authentic Arabic mirroring neighboring group style (`بالفعل` conflict phrasing, `مسار الرصيد` lane vocabulary from `planLaneUnconfigured`, `الخطة غير مفعلة` inactive-plan phrasing from `planCatalog`) |

Environment-only (gitignored, not source): created `/home/z/my-project/.env.test` (`TEST_CI=false`) — the mandated test runner spawns `bun --env-file=.env.test` (`test/scripts/run-test.ts:176`) and hard-fails when the file is missing; `.env.example:272-291` instructs creating it locally. Required once per sandbox to run any `run-test.ts` suite.

## 3. Files NOT modified (and why)

- `shared/locale/types/message.ts` — `errorsTranslations: ErrorsLabels` already registered; group keys ride inside `ErrorsLabels`.
- `shared/locale/{en,ar}/messages.ts` — aggregate `errorsEn`/`errorsAr` wholesale; no per-group wiring exists.
- `shared/locale/errors-namespace.parity.test.ts` — its compile-time `ErrorsLabels` typing + depth-first zero-dead-key walker + top-level key-set parity already cover the new group; no pins required by the suite's contract, and the task forbids new scaffolding.
- `shared/locale/namespaces/*` — no new namespace handle (see §1).
- `shared/enum.pothos.ts` — `ProrationDirection` GraphQL registration is Task 5 scope (`tasks.md` task 5).
- `backend/types/index.ts` — already re-exports `./billing`; top-level barrel needed no change.
- Any schema/db file — plan D1 forbids schema/enum changes; nothing to push.

## 4. 1.QL Quality Loop — per-file sub-loop results

`bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` (progressive tsgo → oxlint → biome → lint:type-aware → check:duplicates):

| File | Result |
|------|--------|
| `backend/types/billing/subscription-admin.types.ts` | ✅ all 5 checks passed, **exit 0** |
| `backend/types/billing/index.ts` | ✅ all 5 checks passed, **exit 0** |
| `backend/enum/billing/proration-direction.enum.ts` | ✅ all 5 checks passed, **exit 0** |
| `backend/enum/billing/index.ts` | ✅ all 5 checks passed, **exit 0** |
| `shared/locale/types/errors/labels.ts` | ✅ all 5 checks passed, **exit 0** |
| `shared/locale/en/errors/index.ts` | ✅ all 5 checks passed, **exit 0** |
| `shared/locale/ar/errors/index.ts` | ✅ all 5 checks passed, **exit 0** |

Additional whole-repo confirmation: `bun tsgo` → **exit 0, 0 errors** (baseline was 0; delta remains 0).

## 5. 1.TE Tests

- Locale-parity suite exists: `shared/locale/errors-namespace.parity.test.ts`. Run via the mandated runner:
  `bun run test/scripts/run-test.ts shared/locale/errors-namespace.parity.test.ts` → **33 pass / 0 fail (266 expect calls)**, including top-level ar/en key-set parity with the new `subscriptionAdmin` group and the depth-first non-empty-leaf walk over its 8 nested leaves.
- Type-barrel importability: covered by the `duplicates` lifecycle's project-wide tsgo pass on every barrel touch (§4) + the full `bun tsgo` exit 0.
- No new test files created (existing suite suffices; per task instruction).

## 6. 1.SEC Security

- `ProrationDirection` is a real value `enum`; no file in this task imports it yet (first runtime consumers arrive in Task 5), so no `import type` misuse exists. **Carry-forward: Tasks 5/2-4 must VALUE-import it** (`import { ProrationDirection } from "@/backend/enum/billing/proration-direction.enum"`) wherever it appears in runtime expressions (payload direction, comparisons).
- No runtime string literals for statuses/directions in any touched file. Grep sweep found only: the enum member definitions themselves (canonical definitions, required) and the compile-time union `readonly direction: "upgrade" | "downgrade"` in `ProrationComputation` — a type position, mandated verbatim by plan §3.4, mirroring the enum's canonical values and documented as such in its JSDoc.

## 7. 1.SR Semantic Review checklist

| Item | Result |
|------|--------|
| No dead branches | ✅ No conditionals/branches exist in the touched files; every type/key has a defined downstream consumer (Tasks 2-5 services, Task 10 UI) — they are the declared foundation surface, not dead code |
| No cross-layer imports | ✅ Types file and enum file have **zero imports**; locale leaves import only `@/shared/locale/types/errors`; no `backend/types → services/frontend` edges |
| No manual ReturnType construction | ✅ No `SubscriptionReturnType` (or any ReturnType) redefined or hand-built; existing types untouched and reused by reference where applicable (none of the five §3.4 shapes composes it) |
| Domain-only comments | ✅ `rg "REQ-|Phase|Task 1|tasks\.md|specs\.md|plans/|plan\.md"` over all 7 files → **0 matches**; JSDoc describes lifecycle/proration/i18n domain behavior only |
| No trivial comments | ✅ Every JSDoc states a non-obvious domain constraint (client-cannot-influence rules, balance-preserving semantics, replay meaning, forfeit asymmetry, identifier-free copy rule) |
| Only in-scope files modified | ✅ `git status --short` = exactly the 7 files above (5 M + 2 ??); `.env.test` is gitignored and invisible to the tree |

## 8. 1.IV Instruction Verification

Sub-loop auto-printed the applicable rule files per target; ALL were read in full before/while fixing:

- `.agents/instructions/backend.instructions.md` — ✅ types from `backend/types/` only, `SubmitInput` naming, barrels via `./` `export *`, no local Pothos types (none created), no enum duplication against `shared/constants/` (verified: `ProrationDirection` pre-existed nowhere — `rg -l` found only the two new files).
- `backend/types/AGENTS.md` — ✅ single canonical pattern respected; no duplicate entity types; barrel mechanics exact.
- `backend/AGENTS.md` — ✅ naming conventions (`{Entity}SubmitInput`), no `oxlint-disable`, no error-status literals.
- `backend/enum/AGENTS.md` — ✅ file at `backend/enum/billing/proration-direction.enum.ts`, registered in the sub-directory barrel (no new sub-directory ⇒ top-level `backend/enum/index.ts` correctly untouched); backend-only (no shared/ import of it).
- `AGENTS.md` (root) — ✅ barrel conventions (`export * from "./module"`, relative `./`, re-export-only), i18n compile-time system rules, logger rule (no logging in this task's files).
- `shared/AGENTS.md` + `shared/locale/AGENTS.md` — ✅ `@/` alias discipline inside shared/locale, leaf modules contain only plain literals, no frontend/backend imports, no new namespace registration needed for a group key.

## 9. Carry-forward knowledge (for Tasks 2-6, 10)

**Exact export paths**
- Types: `import type { ExtendSubscriptionSubmitInput, RenewSubscriptionSubmitInput, CancelSubscriptionSubmitInput, ChangeSubscriptionPlanSubmitInput, ProrationComputation } from "@/backend/types/billing/subscription-admin.types"` (also reachable via `@/backend/types` barrel).
- Enum (VALUE import at runtime sites): `import { ProrationDirection } from "@/backend/enum/billing/proration-direction.enum"`.
- Error copy (services): `getServerTranslations(locale).errorsTranslations.subscriptionAdmin.<key>`; resolvers: `await ctx.t("errorsTranslations")` then `.subscriptionAdmin.<key>`.

**Enum value strings (canonical)**: `ProrationDirection.Upgrade = "upgrade"`, `ProrationDirection.Downgrade = "downgrade"` — SDL `enum ProrationDirection { UPGRADE DOWNGRADE }` (plan §5) maps via Pothos registration in Task 5.

**Translation keys** (`errorsTranslations.subscriptionAdmin.*`, identical set in en + ar, all non-empty, zero ICU placeholders): `notActive` · `notExpired` · `incompatibleLane` · `inactivePlan` · `samePlan` · `prorationOverflow` · `alreadyRenewed` · `alreadyPlanChanged`.

**Type shapes (verbatim §3.4)**: `ExtendSubscriptionSubmitInput{subscriptionId,days}` · `RenewSubscriptionSubmitInput{subscriptionId}` · `CancelSubscriptionSubmitInput{subscriptionId,reason?}` · `ChangeSubscriptionPlanSubmitInput{subscriptionId,newPlanId}` · `ProrationComputation{direction,carrySessions,forfeitedSessions,newSessionCount}` (all fields `readonly`; `direction` union `"upgrade"|"downgrade"` mirrors the enum values).

## 10. Cross-file dependencies discovered

- **None blocking.** No cross-layer or cross-file violations requiring the fix-or-report protocol.
- Forward obligations recorded for later tasks (not violations): Task 5 registers `ProrationDirection` in `shared/enum.pothos.ts` + codegen; Tasks 2-5 services consume `errorsTranslations.subscriptionAdmin.*` and must value-import the enum; the `prorationOverflow` key intentionally covers BOTH the extend-window bound (Task 2, `MAX_INTERVAL_DAYS`) and the plan-change resulting-window bound (Task 5) — its en/ar copy is phrased generically for both.
