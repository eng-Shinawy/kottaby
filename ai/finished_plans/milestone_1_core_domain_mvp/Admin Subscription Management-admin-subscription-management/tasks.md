# Tasks — Admin Subscription Management

**Plan Directory**: `ai/plans/sprint_1/Admin Subscription Management-admin-subscription-management/`
**Related**: `specs.md`, `plan.md`, `deferred-items.md`, `outcome/`
**Execution model**: 5-stage subtask pipeline (QL → TE → SEC → SR → IV) on every implementation task; journeys per `test/workflows/AGENTS.md`; the unified per-file check is `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` (exit 0). All DB tests via `bun run test/scripts/run-test.ts <path>`.

## Non-Negotiable Execution Protocol (applies to every task)

1. Read ALL of `outcome/` before starting.
2. After each file modification: `sub-loop.ts` on that file (exit 0) BEFORE moving on.
3. Semantic-review checkbox before marking `[x]` (authorization, races, env-config, dead code, cross-layer, enums-as-values, deferrals).
4. On completion: write `outcome/<task-id>-outcome.md` and flip the checkbox.
5. Any deferred work MUST appear as a row in `deferred-items.md` (❌/⚠️ entries block the final gate).

---

## Phase 0 — Baseline

- [x] **0. Establish baseline & ledger**
  - Capture: `bun tsgo 2>&1 | grep -c "error TS"` → `/tmp/baseline-tsgo.txt`; `bun biome:check 2>&1 | grep -c "warn"` → `/tmp/baseline-biome.txt`; `bun run scripts/lint-service.ts --json --id baseline > /tmp/baseline-lint.json`.
  - Verify `deferred-items.md` exists at plan root (it does — created with this plan).
  - Write `outcome/0-baseline-outcome.md` with the three counts.
  - _Requirements: REQ-0_

## Phase 0.5 — Plan Review Gate (EXECUTED AT GENERATION TIME)

- [x] **0.5 Plan review gate** — complete; the verdict and applied fixes are recorded in `outcome/plan-review-R1.md`.
  - _Requirements: REQ-0_

---

## Phase 1 — Foundation (types, enum, i18n skeleton)

- [x] **1. Types + enum + i18n skeleton**
  - Create `backend/types/billing/subscription-admin.types.ts` with the input/result types from plan.md §3.4 (ProrationComputation, Extend/Renew/Cancel/Change inputs); register `export * from "./subscription-admin.types"` in `backend/types/billing/index.ts`.
  - Create `backend/enum/billing/proration-direction.enum.ts` (`export enum ProrationDirection { Upgrade = "upgrade", Downgrade = "downgrade" }`); register in `backend/enum/billing/index.ts` (barrel re-export) — verify shape against `subscription-status.enum.ts:6-11`.
  - Extend errors namespace: add `subscriptionAdmin: { … }` group under errorsTranslations for the new denial messages (`notActive`, `notExpired`, `incompatibleLane`, `inactivePlan`, `samePlan`, `prorationOverflow`, `alreadyRenewed`, `alreadyPlanChanged`) — add to `shared/locale/types/errors/index.ts`, `shared/locale/en/errors/index.ts`, `shared/locale/ar/errors/index.ts` (verbatim translations, no machine-garbled Arabic).
  - [x] 1.QL **Quality Loop**: run `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` on every file touched (exit 0).
  - [x] 1.TE **Tests**: parity/quick unit checks for the type barrels (importability) — locale parity runs with the existing locale-parity suite: `bun run test/scripts/run-test.ts shared/locale/...` (verify suite path).
  - [x] 1.SEC **Security**: enum imported as value everywhere (runtime cast sites); no string literals.
  - [x] 1.SR **Semantic Review**: no `{Entity}.types.ts` inside services; types imported via `@/backend/types` alias only.
  - [x] 1.IV **Instruction Verification**: read `backend/types/AGENTS.md`, `backend/enum/AGENTS.md`, `shared/AGENTS.md`, `shared/locale/AGENTS.md` (auto-printed by sub-loop) and validate.
  - Write `outcome/1-foundation-outcome.md`.
  - _Requirements: REQ-0.5, partial REQ-1/2/3/4_

---

## Phase 2 — Backend: Repositories & Services

- [x] **2. Extend — repo + service + mutation**
  - Repo: add `extendActiveOnce` to `backend/db/repo/billing/subscription.repository.ts` per plan.md §3.1 (guarded UPDATE: `WHERE id AND status='active'`; set `endDate = endDate + INTERVAL '<days> days'` server-side via parameterised SQL interval multiply or JS-computed new date — pick ONE: compute `newEndDate = new Date(oldEndDate.getTime() + days * 86_400_000)` in the SERVICE (matches the `MS_PER_DAY` precedent at `subscription-activation.service.ts:118,384`), repo SETs the absolute value with the guard).
  - Service: implement `extendSubscription` in NEW `backend/services/billing/subscription-admin.service.ts` + audit contract helper in `subscription-admin.helpers.ts` (`entityType: "subscription"`, `actionType: AuditActionType.Update`, details `{ previousEndDate, newEndDate, addedDays }`).
  - Validation: `days` integer ≥ 1; resulting window ≤ `MAX_INTERVAL_DAYS` (import constant from `plan-catalog.helpers.ts:46-60`).
  - GraphQL: `adminExtendSubscription` in NEW `backend/graphql/mutation/billing/subscription-admin.mutation.ts`; input type in NEW `backend/graphql/pothos/billing/subscription-admin.pothos.ts`; side-effect wire in both billing barrels.
  - [x] 2.QL: sub-loop on each modified/new file (exit 0).
  - [x] 2.TE: repo test additions in `backend/db/test/logic/billing/subscription.repository.test.ts` (extend happy path, replay→zero-row path, wrong-status path) via `runInRollback` + `expectRepoError`; service test `backend/services/billing/subscription-admin.service.test.ts` (NEW — mock repo boundary? NO: services in this repo run against the DB per file-convention — mirror `subscription-expiry.service.test.ts` approach; four-tier framework: branch, boundary (days=0, days=3650+, non-active statuses ×5), chaos replay).
  - [x] 2.SEC: BOLA (id from input, but caller is admin — fine); BOPLA (explicit patch); BFLA (service re-asserts `assertActorAdmin`).
  - [x] 2.SR / 2.IV per protocol.
  - _Requirements: REQ-1, REQ-6, REQ-7_

- [x] **3. Renew expired subscription**
  - Repo: add `insertSubscription` reuse (existing) — plus junction insert reusing `studentSubscriptions` insert inside the service tx (verbatim from `subscription-purchase.service.ts:418` pattern).
  - Service: `renewSubscription`:
    1. `assertActorAdmin`; 2. read source row (must exist + `expired`); 3. claim key `renew:<sourceId>` via `SubscriptionPurchaseIdempotencyRepository.insertClaim` (userId = subscription.userId); 4. read plan fresh, fail closed if `balanceLane` null; 5. insert new subscription `{ status: active, startDate: now, endDate: now+intervalDays×MS_PER_DAY, paymentMethod: null, paymentReference: null, paymentVerifiedAt: null }`; 6. `creditLaneBalance(userId, lane, plan.sessionCount, tx)`; 7. junction insert; 8. `updateClaimSubscriptionId(claimId, newSub.id)`; 9. audit Create row with details from REQ-2.3.
  - Claim-conflict (23505 on the renew key) ⇒ read the claim, fetch its `subscriptionId`, return that row (REPLAY, no error).
  - GraphQL: `adminRenewSubscription`.
  - [x] 3.QL / 3.TE (service + repo replay paths; claim conflict returns first result; lane credit asserted) / 3.SEC / 3.SR / 3.IV.
  - _Requirements: REQ-2, REQ-6, REQ-7_

- [x] **4. Cancel (balance-preserving)**
  - Repo: `cancelActiveOnce` per plan.md §3.1.
  - Service: `cancelSubscription` — assert admin; guarded flip; audit row `Suspend` + details `{ fromStatus:'active', toStatus:'cancelled', reason? }` (reason ≤ 200 chars, trimmed; never PII).
  - GraphQL: `adminCancelSubscription`.
  - [x] 4.QL / 4.TE (cancel active path; idempotent double-cancel → second call fails conflict localized; lane balances byte-identical before/after — assert via repo read; audit row presence) / 4.SEC / 4.SR / 4.IV.
  - _Requirements: REQ-3, REQ-6, REQ-7_

- [x] **5. Plan change (upgrade/downgrade) with proration**
  - Helpers: `computeProration` per plan.md §3.3/D4 (BigInt minor units; price strings parsed exactly — reject non-canonical decimals with validation error).
  - Repo: `setLaneBalanceValue` on `student.repository.ts` per §3.2; `findActiveWithPlan` on `subscription.repository.ts` per §3.1.
  - Service `changeSubscriptionPlan`: assert admin; load sub+plan; guards (target plan active, same lane, different plan id, target `balanceLane` non-null); direction & carry computation; lane reset on old lane + credit on new lane; old row guarded-flip to `cancelled`; insert new active row + junction; claim `planChange:<sourceId>:<newPlanId>`; audit `Override` row with the REQ-4.5 details.
  - GraphQL: `adminChangeSubscriptionPlan` returning `ChangeSubscriptionPlanPayload` (incl. enum registration of `ProrationDirection` in `shared/enum.pothos.ts`).
  - [x] 5.QL / 5.TE (upgrade proration math incl. table of price-ratio cases; downgrade forfeiture; zero-price plan guard; MAX bounds; claim replay; cross-lane rejection; inactive-plan rejection) / 5.SEC (lane arithmetic cannot go negative — CHECK constraint catch mapped to domain conflict) / 5.SR / 5.IV.
  - _Requirements: REQ-4, REQ-6, REQ-7_

---

## Phase 2.5 — Mid-Point Review Gate (MANDATORY: plan has >15 subtasks and distinct backend/frontend phases)

- [x] **5.5 Backend architecture review checkpoint**
  - Dispatch read-only review agents over all backend files touched in Phases 2-5 (service+repo+types+pothos+mutation files).
  - Fix findings per-file via sub-loop; re-review until zero backend-specific findings.
  - Record `outcome/5.5-midpoint-review-R1.md`.
  - _Requirements: REQ-0_

---

## Phase 3 — GraphQL read surface + schema regen

- [x] **6. Admin query `adminStudentSubscriptions` + schema regeneration**
  - NEW `backend/graphql/query/billing/subscription-admin.query.ts` — `adminStudentSubscriptions(userId: ID!)` → `[StudentSubscription!]!` with `adminOnlyAuthScopes` + `requireAdminUser`; delegates to `SubscriptionAdminService.listForAdmin` (reuses `SubscriptionRepository.listByUserId`; verify its behavior at `subscription.repository.ts:169`).
  - Hard rule from `backend/graphql/query/AGENTS.md`: side-effect registration in `backend/graphql/query/billing/index.ts` + docblock update.
  - Run `bun run generate:gqlSchema` then `bun codegen` — frontend generated types refresh; verify SDL diff ONLY contains the 5 new fields + new input/payload types + the enum.
  - [x] 6.QL / 6.TE (GraphQL integration test — see Task 7) / 6.SEC (403 for non-admin) / 6.SR / 6.IV.
  - _Requirements: REQ-5, REQ-7_

## Phase 4 — GraphQL integration tests

- [x] **7. GraphQL integration tests (testClient)**
  - NEW `frontend/graphql/test/subscription-admin/subscription-admin.test.ts` — uses `setupTestServerLifecycle` + `testClient` per `frontend/graphql/test/AGENTS.md`; verifies: each mutation succeeds for admin (provisioned admin login via existing auth test helpers — read an existing admin integration test first), UNAUTHORIZED unauthenticated, FORBIDDEN for student/teacher/parent, replay-replay for renew/change-plan.
  - [x] 7.QL / 7.TE / 7.SEC (all three denial paths asserted on `extensions.code`) / 7.SR / 7.IV.
  - _Requirements: REQ-6, REQ-7_

## Phase 5 — Journey test (cross-actor, TEST-FIRST as required by the skill)

- [x] **8. Journey `admin-subscription-lifecycle` — written TEST-FIRST, then service verified against it**
  - NEW `test/workflows/billing/subscription-admin-lifecycle.journey.test.ts` implementing plan.md §7 EXACTLY (steps 1-11, cast: admin + student actor + unrelated student; prefix `jrn_billing_<8hex>`; `TrackedFixtures`, spied notifications boundary — NOTE: this feature deliberately emits NO notifications (document that in the journey header; the spy asserts ZERO dispatches), denial step via `catchJourneyError`, audit rows asserted via a light audit query helper or existing audit-trail query).
  - Run iteratively `bun run test/scripts/run-test.ts test/workflows/billing/subscription-admin-lifecycle.journey.test.ts` until green; then run the full layer: `bun run test/scripts/run-test.ts test/workflows` (NEVER raw `bun test` on workflows).
  - [x] 8.QL / 8.TE (journeys ARE the test) / 8.SEC (denial probe) / 8.SR / 8.IV (`test/workflows/AGENTS.md` + `tests.instructions.md`).
  - _Requirements: REQ-9, REQ-2..REQ-4, REQ-6, REQ-7_

## Phase 6 — Audit-completeness census upgrade

- [x] **9. Replace the deferred D-001 row**
  - Edit `test/workflows/admin/audit-completeness.catalog.ts`: replace the deferred `(future) adminExtendSubscription / adminCancelSubscription` row with wired rows for the four mutations per plan.md §5.2; keep `DEFERRED_ADMIN_ACTION_IDS` entries otherwise intact.
  - Extend the audit-completeness journey (`test/workflows/admin/audit-completeness*.journey.test.ts`) with legs executing the new mutations through the real service path and asserting audit shapes.
  - [x] 9.QL / 9.TE / 9.SEC / 9.SR / 9.IV.
  - _Requirements: REQ-6_

---

## Phase 7 — Frontend drawer surface

- [x] **10. Drawer UI: documents, hooks, section, dialogs, i18n namespace**
  - Documents: NEW `frontend/graphql/sharedDocuments/admin/admin-subscriptions.documents.ts` (+ `.documents.test.ts` contract) with `adminStudentSubscriptionsQueryDocument` and four mutation documents, each with `id` in every selection set; exported via `sharedDocuments/admin/index.ts`.
  - Hooks: `frontend/views/admin/students/subscriptions/hooks/useSubscriptionAdminActions.ts` — four `useMutation` wrappers, Apollo cache refresh via refetch of the drawer query.
  - UI: `SubscriptionAdminSection.tsx` + `dialogs/{Extend,Renew,Cancel,ChangePlan}SubscriptionDialog.tsx` — MUI v9 `sx` only; dir under `frontend/views/admin/students/`; mobile-friendly (existing card layout of the drawer).
  - Mount: edit `AdminStudentDetailDrawer.tsx` to include the section (READ THE FILE FIRST; place below balances).
  - i18n: NEW `subscriptionAdmin` namespace — the five-step registration per REQ-0.5 + parity test; drawer renders via `useAppTranslation(<handle>)`.
  - [x] 10.QL / 10.TE (rls of dialogs: stub-Apollo or contract tests; follow existing dialogs' test precedent in `frontend/views/admin/plans/`) / 10.SEC (actions only render for admin — page is admin-gated; confirm no student-facing leak) / 10.SR / 10.IV.
  - _Requirements: REQ-8, REQ-0.5_

---

## Phase 8 — Final gates

- [x] **11. Final quality gate + deferred-items enforcement**
  - `grep -c "❌\|⚠️" deferred-items.md` MUST equal 0 (expected ledger entries D1-D3 are resolved-by-design rows with status ✅ at planning time; see deferred-items.md).
  - Re-run baselines: `bun tsgo`, `bun biome:check`, lint — compare vs `/tmp/baseline-*`; document deltas in `outcome/11-final-gate-outcome.md`.
  - Full test sweep: `bun run test/scripts/run-test.ts` for every new/modified test file; GraphQL suite; journey layer.
  - `bun quality-gate` clean.
  - _Requirements: REQ-0, all REQ-N gates_

- [x] **12. Knowledge propagation**
  - NEW `docs/billing/admin-subscription-management.md` (transition table, audit verbs, proration formula, idempotency keys, interplay with expiry sweep).
  - Update `docs/specs/state-machine-invariants.md` §4: add the `active → cancelled` producer row (admin mutation), and note the cancel-vs-expiry zeroing asymmetry.
  - Update `docs/billing/paymob-gateway.md` "Related documents" only if it references lifecycle docs; otherwise skip.
  - Write `outcome/12-knowledge-propagation-outcome.md`.
  - _Requirements: REQ-10_

---

## Requirement → Task matrix (authoritative)

| REQ | Tasks |
|-----|-------|
| REQ-0 | 0, 0.5, 5.5, 11 |
| REQ-0.5 | 1, 10 |
| REQ-1 | 2 |
| REQ-2 | 3 |
| REQ-3 | 4 |
| REQ-4 | 5 |
| REQ-5 | 6 |
| REQ-6 | 2,3,4,5,6,9 |
| REQ-7 | 2-9 (SEC legs), 7 |
| REQ-8 | 10 |
| REQ-9 | 8 |
| REQ-10 | 12 |
