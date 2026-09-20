# Task 5 Outcome — Plan change (upgrade/downgrade) with proration: repo + helpers + service + mutation + tests (REQ-4, REQ-6, REQ-7)

**Date**: 2026-09-18
**Branch**: `feat/admin-subscription-management`
**Agent**: Task 5 Verifier Subagent
**Scope (12 modified + 3 new files)**: new — `subscription-proration.helpers.ts`, `subscription-plan-change.helpers.ts`, `student.repository.lane-value.helpers.ts`; modified — `subscription.repository.ts` (+`findActiveWithPlan`), `student.repository.ts` (+`setLaneBalanceValue` delegation), `subscription.repository.test.ts`, `subscription-admin.service.ts` (+`changeSubscriptionPlan`), `subscription-admin.service.test.ts` (+26 plan-change tests), `subscription-admin.pothos.ts` (+`ChangeSubscriptionPlanInput`/`ChangeSubscriptionPlanPayload`), `subscription-admin.mutation.ts` (+`adminChangeSubscriptionPlan`), `shared/enum.pothos.ts` (+`ProrationDirection` pothos enum), `pothos/billing/index.ts`, `mutation/billing/index.ts`, `subscription-admin.types.ts`.

---

## 1. Summary

The admin PLAN-CHANGE vertical is complete and verified. `SubscriptionRepository.findActiveWithPlan` loads the active subscription row and its plan in ONE round-trip (`JOIN` keyed on `id AND status='active'`, plan join fail-closed) and is reused by the whole admin service family. `StudentRepository.setLaneBalanceValue` lands ONE prepared exact lane total through a frozen enum-keyed setter map (`Record<SubscriptionCreditLane, ...>` — a missing lane member is a compile error; deliberately separate from the RELATIVE `COALESCE(...) + amount` credit map, because a settlement must overwrite, never increment). `computeProration` (`subscription-proration.helpers.ts`) runs in EXACT BigInt minor units over the plans' `decimal(10,2)` price strings: canonical-regex-gated parsing (`/^\d{1,8}\.\d{2}$/` rejects non-canonical decimals with a localized validation reject before any arithmetic can drift), cross-multiplied unit-value comparison (never divides), direction = strictly greater unit value → `Upgrade`, strictly smaller → `Downgrade`, tie → break on session count (same-shape swap is the value-neutral upgrade whose carry formula reproduces the remainder exactly); upgrades carry `floor(remaining × priceOld × scNew / (scOld × priceNew))` sessions clamped to `MAX_SESSION_COUNT`, downgrades forfeit the remainder as `forfeitedSessions`.

`SubscriptionAdminService.changeSubscriptionPlan` (`subscription-plan-change.helpers.ts` orchestrator, split from `subscription-admin.service.ts` to honor the 300-line file ceiling) is fail-closed: `assertActorAdmin` first (zero writes on denial), then guards (source must be `active` with its plan; target plan must exist, be active, non-null `balanceLane`, same lane as source, different plan id — every denial zero-write with one bounded id-only log), then ONE `withTransaction` owning: the idempotency claim `planChange:<sourceId>:<newPlanId>` (replay of a fulfilled claim → `alreadyPlanChanged` localized conflict with the FIRST change's row and zero carry/forfeit — replayed calls move nothing; the original arithmetic lives in the committed audit row), `setLaneBalanceValue` reset of the OLD lane to exact zero, the guarded old-row flip to `cancelled` (zero rows = a concurrent writer won — logged and failed closed), the new active row + junction insert, the exact-prepare lane settlement on the new lane, claim backfill (`updateClaimSubscriptionId`), and the exactly-one `AuditActionType.Override` audit row. A raw balance CHECK violation (23514) surfaces as the localized conflict with NO partial commit (tx rollback). `adminChangeSubscriptionPlan` exposes it admin-only through Pothos (`ChangeSubscriptionPlanInput { subscriptionId: ID!, newPlanId: ID! }` → `ChangeSubscriptionPlanPayload { subscription, direction, carrySessions, forfeitedSessions }`), with `ProrationDirection` registered as a GraphQL enum in `shared/enum.pothos.ts` (derived vocabulary on the payload, never a stored column). Both billing barrels carry the surface.

## 2. Files created / modified

| # | File | Change |
|---|------|--------|
| 1 | `backend/services/billing/subscription-proration.helpers.ts` | NEW — `computeProration` (BigInt minor units, canonical price regex gate, cross-multiplied direction, upgrade-carry clamp to `MAX_SESSION_COUNT`, downgrade forfeit), `resolveProrationDirection` closed-vocabulary mapping; `ProrationDirection` value-imported |
| 2 | `backend/services/billing/subscription-plan-change.helpers.ts` | NEW — plan-change orchestrator helpers: guard ladder, claim acquire/replay (`planChange:<sourceId>:<newPlanId>`), old-lane zero reset, guarded old-row cancel, new row + junction + settlement, claim backfill, exactly-one `Override` audit row; `AuditService`, `AuditActionType.Override` |
| 3 | `backend/db/repo/students/student.repository.lane-value.helpers.ts` | NEW — frozen enum-keyed exact-value SET-clause map + one-to-one `setLaneBalanceValue` implementation (tx-last convention; `null` = vanished student row; no business logic) |
| 4 | `backend/db/repo/billing/subscription.repository.ts` | + `findActiveWithPlan(id, tx?)` — active row + plan in one round-trip, null for every non-active lifecycle state and unknown ids |
| 5 | `backend/db/repo/students/student.repository.ts` | + `setLaneBalanceValue` public method delegating one-to-one to the lane-value helper module |
| 6 | `backend/services/billing/subscription-admin.service.ts` | + `changeSubscriptionPlan(input, actorId, locale, tx?)` — BFLA gate → helper orchestration → `toSubscriptionAdminDomainError` mapping; header docblock documents the claim semantics |
| 7 | `backend/graphql/pothos/shared/enum.pothos.ts` | + `ProrationDirectionPothosEnum` (`upgrade|downgrade`, derived from the enum object — no runtime literals) |
| 8 | `backend/graphql/pothos/billing/subscription-admin.pothos.ts` | + `ChangeSubscriptionPlanInput` + `ChangeSubscriptionPlanPayload` (`subscription`, `direction` ← pothos enum, `carrySessions`, `forfeitedSessions` exposeInt) |
| 9 | `backend/graphql/mutation/billing/subscription-admin.mutation.ts` | + `adminChangeSubscriptionPlan` — `adminOnlyAuthScopes` + `requireAdminUser(ctx)`, id coercion (`coerceSubscriptionId`, `PlanCatalogService.coercePlanId`), locale propagation, side-effect registration |
| 10 | `backend/graphql/pothos/billing/index.ts`, `backend/graphql/mutation/billing/index.ts` | barrel docblocks + side-effect imports |
| 11 | `backend/types/billing/subscription-admin.types.ts` | + plan-change result/proration shapes |
| 12 | `backend/db/test/logic/billing/subscription.repository.test.ts` | + 7 plan-change repo tests (see §4) |
| 13 | `backend/services/billing/subscription-admin.service.test.ts` | + 26 plan-change service tests (see §4) |

## 3. 5.QL Quality Loop — per-file sub-loop results

`bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` over all 15 files → **15/15 exit 0, 0 fixes needed** (75-line function / 300-line file ceilings already honored — the arithmetic lives in `subscription-proration.helpers.ts`, the orchestration in `subscription-plan-change.helpers.ts`).

## 4. 5.TE Tests (mandated runner, Postgres 17 up at 127.0.0.1:5432/app_db) — ×2 runs each, both stable

- **Repo suite** `subscription.repository.test.ts`: **19 pass / 0 fail** (150 expect() calls) — runs 1 & 2 identical. Plan-change additions: `findActiveWithPlan` happy path (one round-trip shape `{ subscription, plan }`), null for every non-active lifecycle state + unknown ids, bare-read arm shape parity; `setLaneBalanceValue` exact one-lane write (other lanes untouched), enum-keyed setter-map lane coverage, unknown student → null; negative lane value raises the raw balance CHECK violation (23514) untranslated.
- **Service suite** `subscription-admin.service.test.ts`: **65 pass / 0 fail** (528 expect() calls) — runs 1 & 2 identical. Plan-change additions across 5 describe blocks: upgrade carry table (price-ratio cases incl. unit-value tie broken on session count), committed change (lane reset to exact zero on old lane + exact prepared total on new lane, new active row + junction, `Override` audit details), target/source guard ladder (inactive target, null-balanceLane target, cross-lane rejection, same plan id, non-active source ladder), replay (duplicate claim → FIRST result, zero carry/forfeit, zero extra writes/audits) + chaos (23514 → localized conflict, no partial commit; concurrent identical changes both fulfill with the first result). All 39 prior extend/renew/cancel tests green untouched.

**Combined: 84/84 tests green, stable across repeated runs.**

## 5. 5.SEC / 5.SR / 5.IV checklist

- **5.SEC**: BOPLA (wire carries only the two ids; repo writes are explicit column SETs, no spreads); BFLA (scopes + `requireAdminUser` + `assertActorAdmin` before any read/write); lane arithmetic cannot go negative — the DB CHECK is the last line (23514 raw in repo, mapped to the localized conflict with no partial commit in the service); denial logs carry ids only; the claim makes a replayed duplicate unable to double-settle.
- **5.SR**: enums value-imported everywhere (`ProrationDirection`, `SubscriptionCreditLane`, `SubscriptionStatus`, `AuditActionType.Override`); pothos enum derives from the enum object; plan-artifact scan (`REQ-`, `Task 5`, `Phase 2`, `specs.md`, `tasks.md`, `.ai/plans`) over all 15 files → **0 matches**; no cross-layer imports (repo helpers stay logic-free, proration helpers take no GraphQL types); no dead branches (every guard branch test-pinned).
- **5.IV**: helper-module conventions honored (tx-last params, sibling-helper split under 300-line ceiling, `Object.freeze` on the lane map, fail-closed `: never`-style ladders); mutation side-effect registration + barrel docblock conventions; outerTx-last single-writer convention preserved.

## 6. Carry-forward for Tasks 6–10

- **Task 6 (Phase 2 frontend)**: the generated SDL does not yet contain `adminChangeSubscriptionPlan` — run gqlSchema regeneration first; consume `ChangeSubscriptionPlanPayload.subscription/direction/carrySessions/forfeitedSessions`; replay surfaces as a localized generic/`alreadyPlanChanged` conflict the UI should render as "already changed" (first result already in force).
- **Task 9 (census)**: plan change uses `AuditActionType.Override` on the `subscription` entity — add the audit-completeness catalog row for it alongside the other admin mutations.
- **Task 8 (journey)**: `findActiveWithPlan` is the canonical one-round-trip active+plan read — prefer it over separate reads in the admin journey surface.
- The claim key vocabulary now has four members (`extend:`, `renew:`, `planChange:`, plus cancel's replay-free semantics) — keep `SUBSCRIPTION_ADMIN_CLAIM_PREFIXES` the single source of truth for any future admin mutation.
- Proration is report-only on replay: zero carry/forfeit integers, real arithmetic recovered from the committed audit row — frontend must not recompute.
