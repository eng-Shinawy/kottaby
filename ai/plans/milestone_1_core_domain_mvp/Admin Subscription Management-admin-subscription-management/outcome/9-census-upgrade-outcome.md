# Task 9 Outcome — Audit-completeness census upgrade (REQ-6)

**Date**: 2026-09-19
**Branch**: `feat/admin-subscription-management`
**Agent**: Task 9 Subagent (Phase 6 — audit-completeness census upgrade)
**Scope (3 modified files)**: `test/workflows/admin/audit-completeness.catalog.ts`, `test/workflows/admin/audit-completeness.journey.test.ts`, `backend/graphql/mutation/billing/subscription-admin.mutation.ts` (scope extension forced by the census drift gate — see §2).

---

## 1. Summary

The audit census now tells the truth about the four shipped admin subscription mutations. The deferred D-001 composite row (`(future) adminExtendSubscription / adminCancelSubscription` → `[Update, Suspend]`) is REPLACED by four per-mutation `wired` rows pinned to the plan's verb mapping — extend→`Update`, renew→`Create`, cancel→`Suspend`, plan-change→`Override`, all on the `subscription` entity — and `DEFERRED_ADMIN_ACTION_IDS` keeps `D-001` reserved (never renumbered) exactly as the plan directs. The audit-completeness journey gained a fifth producer leg that executes all four mutations through the REAL gated service path (`SubscriptionAdminService.*`, `assertActorAdmin` exercised by the existing denial matrix) and pins the minted audit row shapes — action type, entity type, entity id, and the EXACT `details` contract — through the observer's read-back oracle alongside every pre-existing leg.

Census row contract (service `details` verified against `subscription-admin.service.ts` / `subscription-plan-change.helpers.ts`):

| Mutation | `AuditActionType` | `entity_id` anchor | `details` |
|---|---|---|---|
| `adminExtendSubscription` | `Update` | the extended row | `{ previousEndDate, newEndDate, addedDays }` — ISO strings + integer |
| `adminRenewSubscription` | `Create` | the NEW row | `{ renewedFromSubscriptionId, planId, creditedSessions, intervalDays }` — ids + ints |
| `adminCancelSubscription` | `Suspend` | the cancelled row | `{ fromStatus: 'active', toStatus: 'cancelled', reason }` — the trimmed reason is the trail's only free text |
| `adminChangeSubscriptionPlan` | `Override` | the NEW row | `{ direction, fromSubscriptionId, fromPlanId, toPlanId, carrySessions, forfeitedExcess }` |

## 2. Files changed + the forced scope extension

| # | File | Change |
|---|------|--------|
| 1 | `test/workflows/admin/audit-completeness.catalog.ts` | D-001 deferred composite row REMOVED; four `wired` subscription rows added (new "Admin subscription lifecycle" section before the deferred producers); `DEFERRED_ADMIN_ACTION_IDS` unchanged (`["D-001","D-002","D-003"]`) with a docblock line noting D-001 stays reserved. Wired census: 13 → 17 fields; deferred rows: 2 → 1 (D-003 only). |
| 2 | `test/workflows/admin/audit-completeness.journey.test.ts` | New `SUBSCRIPTION_ADMIN_LEG` + 4 census runners + committed fixtures (below) + side-effect probes + 4 denial-matrix attempts + teardown/probe updates. |
| 3 | `backend/graphql/mutation/billing/subscription-admin.mutation.ts` | **Scope extension (documented deviation).** The four fields declared `authScopes: adminOnlyAuthScopes` (shared constant) — the census drift test's static gate classifier records non-literal gates in its honest-skip ledger, which "must stay empty for the current corpus", so the drift suite was RED regardless of any census edit (4 skip notes). Fixed by inlining the byte-equivalent `$all` conjunction `{ authenticated: true, role: [UserRole.Admin] }` on all four fields — the same form every other admin mutation file uses (plan-catalog, admin-finance, admin-broadcast, admin-users) — plus the `UserRole` value import, dropping the now-unused `adminOnlyAuthScopes` import, and updating the file docblock. Gate semantics identical (same object literal the prelude exports); `generate:gqlSchema` re-run: exit 0, generated SDL byte-unchanged (scopes never emit SDL). |

## 3. Catalog before → after

Before (deferred row):
```ts
{
  mutationField: "(future) adminExtendSubscription / adminCancelSubscription",
  serviceEntry: "subscription management surface — unshipped",
  expectedActionTypes: [AuditActionType.Update, AuditActionType.Suspend],
  expectedEntityType: "subscription",
  kind: "deferred",
  deferredRef: "D-001",
},
```
After (wired rows, in the shipped section; deferred section keeps only D-003):
```ts
{ mutationField: "adminExtendSubscription",      serviceEntry: "SubscriptionAdminService.extendSubscription",      expectedActionTypes: [AuditActionType.Update],   expectedEntityType: "subscription", kind: "wired" },
{ mutationField: "adminRenewSubscription",       serviceEntry: "SubscriptionAdminService.renewSubscription",       expectedActionTypes: [AuditActionType.Create],   expectedEntityType: "subscription", kind: "wired" },
{ mutationField: "adminCancelSubscription",      serviceEntry: "SubscriptionAdminService.cancelSubscription",      expectedActionTypes: [AuditActionType.Suspend],  expectedEntityType: "subscription", kind: "wired" },
{ mutationField: "adminChangeSubscriptionPlan",  serviceEntry: "SubscriptionAdminService.changeSubscriptionPlan",  expectedActionTypes: [AuditActionType.Override], expectedEntityType: "subscription", kind: "wired" },
```
`ACTION_TYPE_COVERAGE` needed no change (every verb already `"wired"`; the new rows only add producers for Update/Create/Suspend/Override).

## 4. Journey legs added

Fixtures (inside the existing ONE committing `beforeAll` transaction, tracked in the registry): two ACTIVE same-lane plans (`sourcePlan` 8 × "200.00" = 25.00/session; `downgradeTarget` 4 × "50.00" = 12.50/session — strictly smaller unit value pins the Downgrade direction) + an active subscription on the source plan with a whole-second fixed window (2030-01-01 → 2030-01-31) + an expired source subscription on the same plan; owner = the existing cast student whose `balance_hifz` is seeded to 3 so the forfeit arithmetic is exact. The composite-PK junction rows are not registrable; they cascade and a post-teardown probe asserts zero residue.

Leg choreography (one execution per mutation, ordered `extend → cancel → renew → change`):
1. **extend** (+7d) — `Update` row on the shared row; details' ISO bounds derived from the row's read-back `endDate` (the server computes them from the same stored anchor).
2. **cancel** (reason carried verbatim into the expected details) — `Suspend` row; owner's four lane balances asserted byte-identical around the call (balance-preserving).
3. **renew** — `Create` row on the NEW row `{ renewedFromSubscriptionId, planId, creditedSessions: 8, intervalDays: 30 }`; the service-minted idempotency claim is located by its backfilled subscription pointer and registered for teardown; lane = 3 + 8 = 11.
4. **plan-change** → downgrade target — `Override` row on the NEW row `{ direction: "downgrade", fromSubscriptionId, fromPlanId, toPlanId, carrySessions: 0, forfeitedExcess: 11 }`; payload `carrySessions/forfeitedSessions` asserted before recording; lane settles to the target's exact 4.

The leg test asserts the pinned verb sequence `[Update, Suspend, Create, Override]`, the whole-table zero-missing deltas, and the committed side effects (extended-then-cancelled row, cancelled renewal source, active changed row with null gateway payload, exactly two junction rows, final lane totals). The four mutations were also appended to the denial matrix (valid-shaped inputs; FORBIDDEN + localized for each non-admin actor, UNAUTHORIZED for anonymous, zero mint) and the leg partition / fixture-count assertions of the first test were updated (tracked 18 → 22; legFields now cover all 17 wired rows).

## 5. Test results (runner-mandated; postgres 127.0.0.1:5432/app_db)

- `test/workflows/admin/audit-completeness.journey.test.ts` — **16 pass / 0 fail (598 expect()), ×2 consecutive runs stable** (run 2 doubles as the zero-residue re-run proof; teardown probes including the new junction probe green both times).
- `backend/db/test/logic/audit/audit-census-drift.test.ts` — **19 pass / 0 fail (115 expect()), ×2** — bijection holds in both directions over the 17 wired fields, skip ledger empty, deferred traceability + coverage accounting intact. (Before this task: 18 pass / 1 fail — the non-empty skip ledger from the shared-constant gates.)
- `bun tsgo` — exit 0, 0 errors. `bunx biome check` over the three touched files — clean, no fixes applied.

## 6. 9.QL / 9.SEC / 9.SR / 9.IV

- **9.QL**: `sub-loop.ts <file> --lifecycle duplicates` exit 0 on all three touched files.
- **9.SEC**: the new legs execute the REAL gated service path — the denial matrix drives all four mutations through `assertActorAdmin` for three non-admin actors (FORBIDDEN, zero writes, zero audits per actor) and anonymous (UNAUTHORIZED); audit `details` vocabulary respected: ids/ints/ISO strings only, with the cancel reason as the single bounded free-text field (service-trimmed, ≤ 200).
- **9.SR**: plan-artifact grep (`REQ-`, `Task 9`, `tasks.md`, `specs.md`, `plan.md`, `ai/plans`, `§`, `Phase 6`) over all touched files → 0 hits; statuses/verbs flow from enum members (`SubscriptionStatus.*`, `ProrationDirection.*`, `AuditActionType.*`), no runtime literals; `git status` = exactly the in-scope files (plus the plan-ledger edits); no commits made.
- **9.IV**: `test/workflows/AGENTS.md` honored — no `runInRollback`, one committing setup transaction, every fixture AND service-minted row (2 plans, 4 subscriptions incl. both minted rows, 2 idempotency claims) tracked with FK-safe reverse-order hard-delete + mandatory residue probes (junction rows cascade by design and are probed post-teardown), real role cast (owner = the provisioned student actor; producer = adminA), no `expect(...).rejects.toThrow()`, run-prefix uniqueness, `bun:test` + `@/` aliases; `tests.instructions.md` DB-test rules respected (entity-setup helpers with verified signatures, no seed data, no `getServerTranslations` calls added).

## 7. Carry-forward

- **Task 8** (admin lifecycle journey): the census is now the wired inventory — its journey reuses the same services; the four mutations' audit shapes are already pinned here, so Task 8 asserts lifecycle/state assertions (windows, lanes, replays, denials) and can lean on `readSubscriptionRow`-style read-back probes.
- **Task 10** (frontend + docs): audit-verbs mapping for the doc page — extend→Update, renew→Create, cancel→Suspend, plan-change→Override (entity `subscription`); the cancel reason is the trail's only free text on this surface.
- The census drift gate is now GREEN with the subscription mutations statically classified — any future admin mutation shipped with a shared-constant gate will re-open the skip ledger (the docblock on `subscription-admin.mutation.ts` documents the inline-literal convention and why).
