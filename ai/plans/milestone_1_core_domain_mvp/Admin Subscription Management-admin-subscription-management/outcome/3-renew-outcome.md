# Task 3 Outcome — Renew expired subscription: service + mutation + tests (REQ-2, REQ-6, REQ-7)

**Date**: 2026-09-18
**Branch**: `feat/admin-subscription-management`
**Agent**: Task 3 Finisher Subagent (verification, fixes, test completion)
**Scope (exactly 7 modified files, no new files)**: `subscription-admin.service.ts` (renewSubscription + renew helpers), `subscription-admin.helpers.ts` (claim prefixes + lane mapper), `subscription-admin.service.test.ts` (renew suites), `subscription-admin.mutation.ts` (adminRenewSubscription), `subscription-admin.pothos.ts` (RenewSubscriptionInput), both billing GraphQL barrels.

---

## 1. Summary

The admin RENEW vertical is complete and verified. `SubscriptionAdminService.renewSubscription` renews a TRUE `expired` source row (the expiry sweep owns `active → expired` — active rows take extend, pending rows are payment-owned) into a fresh active period inside ONE `withTransaction`: the `renew:<sourceId>` idempotency claim (savepoint-bracketed, userId = the source row's owner) is inserted BEFORE any result write and is the flow's atomicity point; the fresh plan read supplies the period arithmetic and a certified credit lane (fail-closed when the lane is not configured — the claim rolls back with the transaction); the new row opens `active` at the renewal instant with `endDate = start + plan.intervalDays × MS_PER_DAY` and explicitly null payment columns; the owner's lane is credited exactly `plan.sessionCount`; the `student_subscriptions` junction row mirrors the purchase flow verbatim; the claim's subscription pointer is backfilled; exactly ONE `Create` audit row on the `subscription` entity carries `{ renewedFromSubscriptionId, planId, creditedSessions, intervalDays }` (ids/ints only) and shares the transaction's fate. A duplicate claim (23505) REPLAYS: the claim's subscription pointer is loaded and returned as the first result — no error, no second period, no second credit, no audit row; a pointer-less (or foreign-owner) claim surfaces the localized `alreadyRenewed` conflict in the default-code form. `adminRenewSubscription` exposes it admin-only through Pothos; both billing barrels are wired.

## 2. Files (all pre-existing from the prior agent's draft; verified + fixed, nothing new)

| # | File | Content |
|---|------|---------|
| 1 | `backend/services/billing/subscription-admin.service.ts` | + `renewSubscription` (admin gate → expired guard → savepoint-bracketed claim insert with 23505 → replay resolution → `readRenewalPlan` fail-closed fresh read → `insertRenewedSubscription` → `settleRenewalSideEffects` (credit + junction + claim backfill) → ONE `Create` audit row), module helpers `resolveRenewalReplayRow`, `readRenewalPlan`, `insertRenewedSubscription`, `settleRenewalSideEffects`; `STATUS_EXPIRED` widened-enum guard const; `SUBSCRIPTION_ADMIN_CLAIM_PREFIXES.renew` key construction |
| 2 | `backend/services/billing/subscription-admin.helpers.ts` | + `SUBSCRIPTION_ADMIN_CLAIM_PREFIXES` (`renew: "renew"` — server-constructed key space), + `subscriptionCreditLaneMemberOf` (total fail-closed lane vocabulary lookup, same idiom as the status/gateway mappers) |
| 3 | `backend/services/billing/subscription-admin.service.test.ts` | + 13 renew tests (fixtures + probes): happy path, 4 non-expired statuses + unknown id, balanceLane-null fail-closed, non-admin, anonymous, inactive-plan snapshot, replay-returns-first-result, pointer-less claim conflict, true-concurrency double renew |
| 4 | `backend/graphql/mutation/billing/subscription-admin.mutation.ts` | + `adminRenewSubscription` — `adminOnlyAuthScopes` + `requireAdminUser(ctx)`, `RenewSubscriptionInput`, returns `SubscriptionPothosObject`, strict id coercion, field-by-field whitelist copy, docblock contract |
| 5 | `backend/graphql/pothos/billing/subscription-admin.pothos.ts` | + `RenewSubscriptionInput` (the expired-source selector only — snapshot/claim/lane all server-derived) |
| 6 | `backend/graphql/mutation/billing/index.ts` | + docblock line naming `adminRenewSubscription` (side-effect import already present) |
| 7 | `backend/graphql/pothos/billing/index.ts` | re-exports `./subscription-admin.pothos` (docblock already covers the admin inputs) |

## 3. Fixes applied during verification (prior agent's draft → green)

1. **`max-lines-per-function` oxlint failure (`subscription-admin.service.ts`)** — `renewSubscription` measured 76 lines against the 75 limit after the renew flow landed inline. Extracted the fresh plan read + its two fail-closed guards into the module-level `readRenewalPlan(source, scopedTx, tErrors)` helper (mirroring the existing `insertRenewedSubscription` / `settleRenewalSideEffects` split). The helper returns `{ plan, lane }` with the lane ALREADY resolved through `subscriptionCreditLaneMemberOf`, so the caller receives a certified `SubscriptionCreditLane` instead of re-narrowing the nullable `balanceLane` column (no cast, no type regression) — the function dropped to ~54 lines and the orchestration reads as the design's numbered steps.

No semantic defects found: the denial ladder, replay semantics, claim ordering, junction shape, audit contract, and zero-write guarantees all matched the design on first read; the extend suites (Task 2's 15 tests) remained green untouched.

## 4. 3.QL Quality Loop — per-file sub-loop results

`bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates`. **All 7 files exit 0** (the service file re-run to exit 0 after the §3.1 fix).

Whole-repo confirmation: `bun tsgo` → **exit 0, 0 errors** (`grep -c "error TS"` = 0). Baseline was 0; delta remains 0.

## 5. 3.TE Tests (mandated runner, never raw `bun test`; Postgres 17 at 127.0.0.1:5432 confirmed up)

| Command | Result |
|---------|--------|
| `bun run test/scripts/run-test.ts backend/services/billing/subscription-admin.service.test.ts` | **28 pass / 0 fail** (218 expect calls) — re-run twice more, stable |
| `bun run test/scripts/run-test.ts backend/db/test/logic/billing/subscription.repository.test.ts` | **9 pass / 0 fail** (72 expect calls) — unchanged; Task 3 added NO repo methods (renew reuses `insertSubscription`, `findById`, `insertClaim`, `updateClaimSubscriptionId`, `findByKey`, `creditLaneBalance`) |

Renew-suite coverage map actually exercised: happy path (fresh active row beside the untouched expired source, window length EXACTLY `plan.intervalDays × MS_PER_DAY` derived from the result's own start — never a separate clock, payment columns null, lane credited exactly `plan.sessionCount`, junction row = 1, claim created with `userId = owner` and backfilled to the new row, ONE `Create` audit row on the NEW row id with the `{renewedFromSubscriptionId, planId, creditedSessions, intervalDays}` ids/ints quadruple parsed back verbatim, ZERO audits about the source) · not-expired denials ×4 statuses (active/pending/cancelled/suspended) + unknown id → localized `notExpired` conflict with the owner still holding exactly one row, no claim, lane 0, zero audits · balanceLane-null fail-closed → localized `conflict` and the pre-inserted claim ROLLED BACK (no idempotency residue) · replay → returns the FIRST result row, owner still at exactly 2 rows and one lane grant, zero replay audits, claim pointer untouched · pointer-less committed claim → localized `alreadyRenewed` conflict (`CONFLICT` default code, never a custom machine key) · inactive plan still renews (fresh read is the snapshot; activity is purchase-time) · non-admin → `FORBIDDEN` with row byte-identical, zero claims, zero audits · anonymous → `UNAUTHORIZED` · TRUE-concurrency double renew on independent transactions: the claim's unique index serializes — both calls FULFILL with the SAME first result, exactly one new period, one lane credit, one backfilled claim, one audit row; committed fixtures + FK-ordered teardown.

## 6. 3.SEC Security

- **BOLA/BFLA**: the actor id is server-bound (`requireAdminUser(ctx)` → `user.id`, never an arg) and re-asserted against the `users` table (`assertActorAdmin`) BEFORE any write — non-admin/anonymous denials leave the source row byte-identical, mint zero claims and zero audit rows (asserted).
- **BOPLA**: `RenewSubscriptionInput` whitelists only `subscriptionId`; the claim key is SERVER-CONSTRUCTED (`renew:<sourceId>` from the read row) — the caller never supplies claim material, so the shared claim store's admin key space cannot be spoofed; a foreign-owner replay pointer is denied, never returned.
- **Races**: the claim's unique index IS the serialization point (proven by the true-concurrency probe — no read barrier needed, the loser's duplicate insert blocks until the winner commits and then replays); every downstream failure rolls the claim back with the transaction, so a denied renew never poisons a future legitimate one.
- **Audit hygiene**: one `Create` row per committed renewal on the NEW row id; details = two ids + two integers, JSON-stringified inside `buildSubscriptionAuditContract`; denials mint zero rows.

## 7. 3.SR / 3.IV Semantic review & instruction verification

- **Enums-as-values**: `SubscriptionStatus.Expired`/`.Active` (value import; the widened `STATUS_EXPIRED`/`STATUS_ACTIVE` consts carry the vocabulary), `AuditActionType.Create`, `SubscriptionCreditLane` (resolved via the helpers' `Object.values` member lookup) — zero runtime status/action/lane string literals (`rg` over service/helpers/mutation: 0 matches).
- **Cross-layer imports**: service → repo/helpers/lib/enum/types only; mutation → pothos/shared/service/helpers; no service→GraphQL or repo→service edges; types via `@/backend/types`; the junction insert rides the service's `scopedTx` exactly like the purchase flow (`tx.insert(studentSubscriptions).values({studentId, subscriptionId})`).
- **Comments**: `rg "REQ-|Phase|Task 3|tasks\.md|specs\.md|plans/|plan\.md|milestone"` over all 7 files → **0 matches**; comments state domain constraints only (sweep-owned transition, claim-as-atomicity-point, savepoint-vs-replay-readability, server-constructed key space, set-null FK abort shape).
- **Default-code denials**: every renew denial uses the default-code form (`new ConflictError(localizedMessage)` / gate errors) — `extensions.code` stays inside `{UNAUTHORIZED, FORBIDDEN, VALIDATION, CONFLICT}`; the Task 2 lesson (no custom machine keys) honored throughout.
- **Scope**: `git status --porcelain` = exactly the 7 files above; no repo, schema, migration, codegen, or shared/ changes; `deferred-items.md` untouched (nothing deferred by this task).

## 8. Carry-forward knowledge (for Tasks 4–5)

- **Claim-pattern precedent for Task 5**: copy `renewSubscription`'s claim block verbatim with key `planChange:<sourceId>:<newPlanId>` (add a `planChange` member to `SUBSCRIPTION_ADMIN_CLAIM_PREFIXES`); the 23505 → `findByKey` → pointer-load → same-owner check → return-first-result ladder is exactly `resolveRenewalReplayRow`, and the pointer-less-claim denial localizes via a NEW `alreadyPlanChanged` key (already present in the Task 1 i18n group) in the default-code form.
- **Repo gaps Task 5 must fill** (none exist yet): `setLaneBalanceValue` on `student.repository.ts` (lane reset with explicit `updatedAt`), `findActiveWithPlan` on `subscription.repository.ts`; plus `computeProration` helpers (BigInt minor units, canonical decimal-string parsing) and the `ProrationDirection` enum registration in `shared/enum.pothos.ts` (deferred from Task 1). Each new repo method needs its own repo-test rows in `subscription.repository.test.ts` / the student repo suite.
- **Lane arithmetic**: `creditLaneBalance` returns the updated student row or `null` (vanished owner) — treat null as fail-closed `conflict`, as `settleRenewalSideEffects` does; Task 5's zero-then-credit sequence must keep the CHECK-constraint catch (negative lane) mapped to a domain conflict, not a raw driver error.
- **Audit verbs**: renew used `Create` on the new row; Task 4 cancel uses `AuditActionType.Suspend` with `{ fromStatus, toStatus, reason? }` (reason trimmed ≤200 chars — the ONLY free-text detail so far, keep it out of ids-only vocabulary assumptions in tests); Task 5 uses `AuditActionType.Override` with the REQ-4.5 quintuple.
- **max-lines-per-function**: the 75-line oxlint ceiling is real on service functions — Task 4/5 flows should split read/guard/write phases into module-level helpers from the start (the renew file now demonstrates the pattern).
- **Test conventions that made renew green**: `createExpiredFixture` builds a TRUE expired-status row with an existing `students` row (junction + lane credit key on it); `expectRenewDeniedForStatus` probes the whole zero-write contract in one assertion; concurrency probes on the claim path need NO barrier (unique index serializes) unlike the guarded-UPDATE path (which does).

## 9. Cross-file dependencies

- `subscription-admin.service.ts` → `subscription.repository.ts` (`findById`, `insertSubscription`), `plan.repository.ts` (`findById`), `subscription-purchase-idempotency.repository.ts` (`insertClaim`, `updateClaimSubscriptionId`, `findByKey`), `student.repository.ts` (`creditLaneBalance`), `student-subscriptions` schema (service-tx junction insert), `admin-gate.helpers`, `audit.service`, `plan-catalog.helpers` (`MAX_INTERVAL_DAYS` — NOT applied on renew by design: the fresh period is exactly one plan interval), `subscription-admin.helpers` (claim prefixes / audit contract / lane mapper / error translation / row mapping), `with-transaction`, `errors` (`isPgUniqueViolation`), `logger`, `@/shared/locale/server-graphql`.
- `subscription-admin.mutation.ts` → `subscription-admin.pothos.ts` (`RenewSubscriptionInput`) + `subscription.pothos.ts` (`SubscriptionPothosObject`) + `@/backend/graphql/shared` (`adminOnlyAuthScopes`, `requireAdminUser`) + helpers (`coerceSubscriptionId`) + service.
- Both billing barrels carry the renew surface alongside extend; Tasks 4–5 append their mutations/inputs to the SAME two barrels and the same service/helpers namespaces — no new barrels needed. SDL regeneration remains deliberately deferred to Task 6.
